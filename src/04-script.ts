import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { chatJson } from "./lib/ai.js";
import {
  episodeContextFromMetadata,
  getEpisodeContext,
  promptPath,
} from "./lib/episode-mode.js";
import { analyzeScriptQuality } from "./lib/script-quality.js";
import { loadJson, writeJson, fileExists, loadRecentRecaps } from "./lib/storage.js";
import { getSpeakerIds } from "./show.js";
import { findBestRecapMatch } from "./lib/continuity.js";
import { supportedAndUnsupportedClaims } from "./lib/research.js";
import type {
  FactCheckedStories,
  EpisodeScript,
  EpisodeManifest,
  ProductStatusFact,
} from "./lib/types.js";

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A script should be allowed to say that a new product is unproven, but never
// that it is a rumor or unavailable when the fact-checker has documented it as
// launched. Keep this narrow and fail before audio/publish rather than letting
// a single generated line undo a source-backed product chronology.
export function findLaunchedProductContradictions(
  script: EpisodeScript,
  factChecked: FactCheckedStories
): string[] {
  const statuses = factChecked.clusters.flatMap(
    (cluster) => cluster.factCheck.productStatuses ?? []
  );
  const launched = new Map<string, ProductStatusFact>();
  for (const status of statuses) {
    if (status.status === "launched" && status.product.trim()) {
      launched.set(status.product.toLowerCase(), status);
    }
  }

  const contradiction =
    /\b(?:rumou?red|leak(?:\s+thread)?|speculat(?:ion|ive)|unconfirmed|not\s+(?:yet\s+)?(?:released|available|shipping)|can(?:not|'t)\s+confirm\s+(?:is|are|it(?:'s)?|they(?:'re)?|shipping))\b/i;
  const failures: string[] = [];

  // Keep contradiction terms scoped to the sentence/clause that actually
  // mentions the product. A line such as "Confirmed versus speculative.
  // Confirmed: Factor 4 Plus is shipping" must not make the second sentence
  // look speculative merely because both sentences share one dialogue turn.
  const clauses = (text: string): string[] =>
    text.match(/[^.!?;]+(?:[.!?;]+|$)/g) ?? [text];

  // Product families often use prefix names (for example, "Factor 4" and
  // "Factor 4 Plus"). A regex for the shorter name also matches the longer
  // one, so only count an occurrence when it is not the start of a known,
  // longer launched-product name.
  const mentionsExactProduct = (text: string, status: ProductStatusFact): boolean => {
    const product = new RegExp(`\\b${escapeRegex(status.product)}\\b`, "gi");
    const statusName = status.product.toLowerCase();
    const longerNames = [...launched.values()]
      .map((candidate) => candidate.product.toLowerCase())
      .filter((candidate) => candidate.startsWith(`${statusName} `));

    for (const match of text.matchAll(product)) {
      const at = match.index ?? 0;
      const shadowed = longerNames.some(
        (candidate) => text.slice(at, at + candidate.length).toLowerCase() === candidate
      );
      if (!shadowed) return true;
    }
    return false;
  };

  for (const status of launched.values()) {
    for (const line of script.lines) {
      for (const clause of clauses(line.text)) {
        if (mentionsExactProduct(clause, status) && contradiction.test(clause)) {
          failures.push(
            `${status.product} is documented as launched (${status.evidence}); contradictory line: ${line.text}`
          );
          break;
        }
      }
    }
  }

  return failures;
}

export async function run(episodeDir: string): Promise<void> {
  const outputPath = path.join(episodeDir, "04-script.json");
  const qualityPath = path.join(episodeDir, "04-script-quality.json");
  if (fileExists(outputPath)) {
    console.log("Stage 04: output already exists, skipping.");
    return;
  }

  const inputPath = path.join(episodeDir, "03-fact-checked.json");
  const factChecked = loadJson<FactCheckedStories | null>(inputPath, null);
  if (!factChecked) throw new Error("No fact-checked stories found in 03-fact-checked.json");

  const episodeContext =
    episodeContextFromMetadata(factChecked) ?? getEpisodeContext();
  const systemPrompt = fs.readFileSync(promptPath("script", episodeContext), "utf-8");

  const manifest = loadJson<EpisodeManifest>(
    path.resolve("episodes", "manifest.json"),
    { episodes: [] }
  );
  const episodeNumber =
    Math.max(0, ...manifest.episodes.map((episode) => episode.number)) + 1;
  const publishedDates = new Set(manifest.episodes.map((episode) => episode.date));

  // Lightweight continuity: feed at most one older recap so hosts can make an
  // occasional, relevant callback (see "Continuity" in prompts/script.md).
  // Fresh recaps are intentionally excluded; repeating a two-week-old episode
  // makes the show feel like it is rehashing itself.
  const eligibleRecaps = loadRecentRecaps(config.episode.continuityWindow, {
    beforeDate: factChecked.episodeDate,
    minAgeDays: config.episode.continuityMinAgeDays,
    includeDates: publishedDates,
  });
  const continuityMatch =
    eligibleRecaps.length > 0
      ? findBestRecapMatch(
          eligibleRecaps,
          factChecked,
          config.episode.continuityMinSharedTerms
        )
      : null;
  if (continuityMatch) {
    console.log(
      `Continuity: episode #${continuityMatch.recap.number} (${continuityMatch.recap.date}) cleared age/overlap filters on [${continuityMatch.sharedTerms.join(
        ", "
      )}] — attaching recap hook only.`
    );
  }

  const continuityBlock =
    continuityMatch
      ? "\n\n## Older episode memory (only if it changes this week's story)\n\n" +
        "One older episode appears related. Use at most one brief callback, and do not recap or re-explain that episode.\n\n" +
        [continuityMatch.recap]
          .map((r) => {
            const lines = [`#${r.number} (${r.date}) "${r.title}"`];
            if (r.topics.length) lines.push(`  Topics: ${r.topics.join("; ")}`);
            if (r.threads.length) lines.push(`  Threads: ${r.threads.join("; ")}`);
            if (r.predictions.length)
              lines.push(`  Predictions: ${r.predictions.join("; ")}`);
            return lines.join("\n");
          })
          .join("\n\n")
      : "";

  const storyBrief = factChecked.clusters
    .map((c) => {
      const fc = c.factCheck;
      const { supported, unsupported } = supportedAndUnsupportedClaims(fc);
      const claimLines = supported
        .map((cl) => `  - [${cl.rating}] ${cl.claim}: ${cl.note}`)
        .join("\n");

      // Derive a fact-check verdict from the objective signals (claim ratings +
      // hype flags) so the script model knows which stories are solid and which
      // genuinely earn a caveat. Without this, every cluster carried a
      // "skeptical angle" into the brief and the script grew a predictable
      // "but here's the catch" beat in every single segment.
      const hasDubious = supported.some((cl) => cl.rating === "dubious");
      const hasHype = fc.hypeFlags.length > 0;
      const hasSoft = supported.some((cl) => cl.rating === "plausible");

      let verdict: string;
      if (hasDubious || hasHype) {
        verdict =
          "Needs scrutiny — there's a real soft spot here; this story earns a caveat or some pushback.";
      } else if (hasSoft) {
        verdict =
          'Mostly solid — single-source or unconfirmed in spots; a light "that\'s their number" touch is plenty, don\'t dwell.';
      } else {
        verdict =
          "Checks out — no caveats worth raising. Play it straight; do NOT manufacture skepticism for this one.";
      }

      // Only feed hype flags / skeptical angles into the brief when the story
      // actually has a soft spot — a clean story shouldn't arrive pre-loaded
      // with doubts for the script model to weave in.
      const concernLines =
        hasDubious || hasHype || hasSoft
          ? [
              hasHype ? `Hype flags: ${fc.hypeFlags.join("; ")}` : "",
              fc.skepticalAngles.length > 0
                ? `Caveats worth raising (only if they earn a beat): ${fc.skepticalAngles.join("; ")}`
                : "",
            ]
              .filter(Boolean)
              .join("\n")
          : "";

      const unsupportedLines = unsupported.length
        ? "Unsupported claims (OFF-AIR instructions: omit these claims; do not discuss the research gap):\n" +
          unsupported
            .map((claim) => `  - ${claim.claim}: ${claim.note}`)
            .join("\n")
        : "";

      return [
        `### ${c.segment.toUpperCase()}: ${c.headline}`,
        `Summary: ${c.summary}`,
        `Significance: ${c.significance}`,
        `Sources: ${c.sources.join(", ")}`,
        `Fact-check verdict: ${verdict}`,
        `Claims:`,
        claimLines || "  - No supported discrete claims were returned; stay within the sourced summary.",
        concernLines,
        unsupportedLines,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");

  console.log(
    episodeContext.type === "company-profile"
      ? "Generating two-host company profile script..."
      : "Generating two-host script..."
  );

  const userContent =
    episodeContext.type === "company-profile"
      ? `Write episode #${episodeNumber} for ${factChecked.episodeDate}.\n\nCompany: ${episodeContext.companyName}\n\nHere is the fact-checked company profile brief:\n\n${storyBrief}${continuityBlock}\n\nGenerate the full podcast script as JSON.`
      : `Write episode #${episodeNumber} for ${factChecked.episodeDate}.\n\nHere are the fact-checked stories for this episode:\n\n${storyBrief}${continuityBlock}\n\nGenerate the full podcast script as JSON.`;

  let result = await chatJson<EpisodeScript>({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    temperature: 0.7,
    // Episodes target ~20-25 min (3200-4000 words) across 5-7 stories, so the
    // JSON script runs long — give the model room not to truncate mid-line.
    maxTokens: 32000,
    // Reasoning tokens are drawn from max_tokens for several OpenRouter models.
    // Cap thinking so the full JSON script still has comfortable output room.
    reasoning: { max_tokens: 8000 },
    model: config.ai.scriptModel,
  });

  const applyAuthoritativeMetadata = (script: EpisodeScript): void => {
    script.episodeNumber = episodeNumber;
    script.episodeDate = factChecked.episodeDate;
    script.episodeType = episodeContext.type;
    if (episodeContext.companyName) script.companyName = episodeContext.companyName;
  };
  applyAuthoritativeMetadata(result);

  const requiredSegments = [
    "opening",
    ...factChecked.clusters.map((cluster) => cluster.segment),
    ...(episodeContext.type === "company-profile" ? ["closing"] : []),
  ];
  const qualityOptions = {
    expectedSpeakers: getSpeakerIds(),
    requiredSegments,
  };
  const initialQuality = analyzeScriptQuality(result, qualityOptions);
  const initialContradictions =
    episodeContext.type === "company-profile"
      ? findLaunchedProductContradictions(result, factChecked)
      : [];
  const revisionReasons = [
    ...initialQuality.blockingIssues,
    ...initialQuality.warnings,
    ...initialContradictions.map(
      (contradiction) => `Factual product-status contradiction: ${contradiction}`,
    ),
  ];

  // The old engine recorded warnings and published anyway. A single focused
  // revision is cheaper and safer than letting a 15-minute, one-sided, or
  // clockwork-alternating episode reach TTS. The original brief remains in the
  // conversation so the reviser has no reason to invent facts.
  if (revisionReasons.length > 0) {
    console.warn(
      `Stage 04: first draft needs revision (${revisionReasons.length} quality issue(s)).`,
    );
    for (const reason of revisionReasons) console.warn(`  - ${reason}`);

    result = await chatJson<EpisodeScript>({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
        { role: "assistant", content: JSON.stringify(result) },
        {
          role: "user",
          content:
            "Revise the draft and return the complete EpisodeScript JSON. " +
            "Preserve every factual claim, source cue, product status, and required story from the brief; do not add facts. " +
            "Fix every quality issue below through substantive editing, not padding. Deepen useful context and practical implications if the draft is short. " +
            "Keep both hosts analytical, vary turn shapes, include natural same-speaker follow-ons, and replace repeated verbal tics with direct language.\n\n" +
            revisionReasons.map((reason) => `- ${reason}`).join("\n"),
        },
      ],
      temperature: 0.45,
      maxTokens: 32000,
      reasoning: { max_tokens: 6000 },
      model: config.ai.scriptModel,
    });
    applyAuthoritativeMetadata(result);
  }

  const quality = analyzeScriptQuality(result, qualityOptions);
  quality.revisionAttempted = revisionReasons.length > 0;
  if (revisionReasons.length > 0) quality.initialWarnings = revisionReasons;

  if (quality.blockingIssues.length > 0) {
    throw new Error(
      `Script failed the post-revision quality gate:\n- ${quality.blockingIssues.join("\n- ")}`,
    );
  }

  if (episodeContext.type === "company-profile") {
    const contradictions = findLaunchedProductContradictions(result, factChecked);
    if (contradictions.length > 0) {
      throw new Error(
        `Script contradicts documented product release status:\n- ${contradictions.join("\n- ")}`
      );
    }
  }

  writeJson(outputPath, result);
  writeJson(qualityPath, quality);
  console.log(
    `Stage 04: script generated — ${quality.lineCount} lines, ~${quality.wordCount} words, ~${quality.estimatedMinutes} min.`
  );
  console.log(
    `Stage 04: quality — switch ${quality.switchRatePct}%, same-speaker follow-ups ${quality.sameSpeakerFollowUpCount}, max run ${quality.maxSameSpeakerRun}, questions ${quality.questionLinePct}%, callbacks ${quality.callbackCount}, handoffs ${quality.handoffPhraseCount}, speaker words ${JSON.stringify(
      quality.speakerWordSharePct
    )}.`
  );
  for (const warning of quality.warnings) {
    console.warn(`Stage 04 residual quality warning: ${warning}`);
  }
}
