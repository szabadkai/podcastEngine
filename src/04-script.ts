import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { chatJson } from "./lib/ai.js";
import {
  episodeContextFromMetadata,
  getEpisodeContext,
  promptPath,
} from "./lib/episode-mode.js";
import { loadJson, writeJson, fileExists, loadRecentRecaps } from "./lib/storage.js";
import { findBestRecapMatch } from "./lib/continuity.js";
import type {
  FactCheckedStories,
  EpisodeScript,
  EpisodeManifest,
  ProductStatusFact,
} from "./lib/types.js";

interface ScriptQualityReport {
  wordCount: number;
  lineCount: number;
  estimatedMinutes: number;
  avgWordsPerLine: number;
  switchRatePct: number;
  sameSpeakerFollowUpCount: number;
  maxSameSpeakerRun: number;
  questionLinePct: number;
  callbackCount: number;
  handoffPhraseCount: number;
  speakerWordSharePct: Record<string, number>;
  warnings: string[];
}

const WORD_RE = /\b[\w'-]+\b/g;
const CALLBACK_RE =
  /\b(last week|previous|earlier|episode \d+|episode one|episode two|episode three|episode four|episode five|episode six|few episodes|few weeks|as we covered|we covered|we talked|we flagged|listeners will remember|ties back|back in episode)\b/gi;
const HANDOFF_RE =
  /\b(right, and|yeah, and|exactly|that's the|the bigger thing|the catch is|which is|and that's|so the)\b/gi;

function countWords(text: string): number {
  return text.match(WORD_RE)?.length ?? 0;
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

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

function analyzeScriptQuality(script: EpisodeScript): ScriptQualityReport {
  const text = script.lines.map((l) => l.text).join("\n");
  const wordCount = countWords(text);
  const lineCount = script.lines.length;
  const speakerWords: Record<string, number> = {};
  let switches = 0;
  let sameSpeakerFollowUpCount = 0;
  let currentSpeakerRun = 0;
  let maxSameSpeakerRun = 0;
  let questionLines = 0;

  for (let i = 0; i < script.lines.length; i++) {
    const line = script.lines[i];
    speakerWords[line.speaker] =
      (speakerWords[line.speaker] ?? 0) + countWords(line.text);
    if (i === 0 || script.lines[i - 1].speaker !== line.speaker) {
      if (i > 0) switches++;
      currentSpeakerRun = 1;
    } else {
      sameSpeakerFollowUpCount++;
      currentSpeakerRun++;
    }
    maxSameSpeakerRun = Math.max(maxSameSpeakerRun, currentSpeakerRun);
    if (line.text.includes("?")) questionLines++;
  }

  const speakerWordSharePct = Object.fromEntries(
    Object.entries(speakerWords).map(([speaker, words]) => [
      speaker,
      wordCount > 0 ? round1((words / wordCount) * 100) : 0,
    ])
  );
  const switchRatePct =
    lineCount > 1 ? round1((switches / (lineCount - 1)) * 100) : 0;
  const questionLinePct =
    lineCount > 0 ? round1((questionLines / lineCount) * 100) : 0;
  const callbackCount = countMatches(text, CALLBACK_RE);
  const handoffPhraseCount = countMatches(text, HANDOFF_RE);
  const minWords = script.episodeType === "company-profile" ? 3500 : 3200;
  const maxWords = script.episodeType === "company-profile" ? 4300 : 4000;
  const warnings: string[] = [];

  if (wordCount < minWords) {
    warnings.push(
      `Script is short for this format (${wordCount} words; target floor ${minWords}).`
    );
  }
  if (wordCount > maxWords) {
    warnings.push(
      `Script is long for this format (${wordCount} words; target ceiling ${maxWords}).`
    );
  }
  if (switchRatePct > 88) {
    warnings.push(
      `Speaker switching is too regular (${switchRatePct}% of turns switch speaker).`
    );
  }
  const minSameSpeakerFollowUps = Math.max(3, Math.floor(lineCount / 12));
  if (lineCount >= 30 && sameSpeakerFollowUpCount < minSameSpeakerFollowUps) {
    warnings.push(
      `Conversation is too strictly alternating (${sameSpeakerFollowUpCount} same-speaker follow-ups; target at least ${minSameSpeakerFollowUps}).`
    );
  }
  if (maxSameSpeakerRun > 4) {
    warnings.push(
      `One speaker holds the floor for ${maxSameSpeakerRun} consecutive turns; check that it still sounds like a dialogue.`
    );
  }
  for (const [speaker, share] of Object.entries(speakerWordSharePct)) {
    if (share > 58) {
      warnings.push(`${speaker} dominates the script (${share}% of words).`);
    }
  }
  if (callbackCount > 1) {
    warnings.push(`Too many continuity callbacks (${callbackCount}; target 0-1).`);
  }
  if (handoffPhraseCount > Math.max(20, lineCount * 0.3)) {
    warnings.push(
      `Handoff phrases may be repetitive (${handoffPhraseCount} matches).`
    );
  }
  if (questionLinePct > 32) {
    warnings.push(
      `Question-heavy pacing (${questionLinePct}% of lines contain a question).`
    );
  }

  return {
    wordCount,
    lineCount,
    estimatedMinutes: Math.round(wordCount / 155),
    avgWordsPerLine: lineCount > 0 ? round1(wordCount / lineCount) : 0,
    switchRatePct,
    sameSpeakerFollowUpCount,
    maxSameSpeakerRun,
    questionLinePct,
    callbackCount,
    handoffPhraseCount,
    speakerWordSharePct,
    warnings,
  };
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
  const episodeNumber = manifest.episodes.length + 1;

  // Lightweight continuity: feed at most one older recap so hosts can make an
  // occasional, relevant callback (see "Continuity" in prompts/script.md).
  // Fresh recaps are intentionally excluded; repeating a two-week-old episode
  // makes the show feel like it is rehashing itself.
  const eligibleRecaps = loadRecentRecaps(config.episode.continuityWindow, {
    beforeDate: factChecked.episodeDate,
    minAgeDays: config.episode.continuityMinAgeDays,
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
      const claimLines = fc.claims
        .map((cl) => `  - [${cl.rating}] ${cl.claim}: ${cl.note}`)
        .join("\n");

      // Derive a fact-check verdict from the objective signals (claim ratings +
      // hype flags) so the script model knows which stories are solid and which
      // genuinely earn a caveat. Without this, every cluster carried a
      // "skeptical angle" into the brief and the script grew a predictable
      // "but here's the catch" beat in every single segment.
      const hasDubious = fc.claims.some((cl) => cl.rating === "dubious");
      const hasHype = fc.hypeFlags.length > 0;
      const hasSoft = fc.claims.some(
        (cl) => cl.rating === "plausible" || cl.rating === "unverifiable"
      );

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

      return [
        `### ${c.segment.toUpperCase()}: ${c.headline}`,
        `Summary: ${c.summary}`,
        `Significance: ${c.significance}`,
        `Sources: ${c.sources.join(", ")}`,
        `Fact-check verdict: ${verdict}`,
        `Claims:`,
        claimLines,
        concernLines,
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

  const result = await chatJson<EpisodeScript>({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    temperature: 0.7,
    // Episodes target ~20-25 min (3200-4000 words) across 5-7 stories, so the
    // JSON script runs long — give the model room not to truncate mid-line.
    maxTokens: 32000,
    // The script model (Claude Opus 4.8) is a reasoning model, and on OpenRouter
    // reasoning tokens are drawn from max_tokens. Left unbounded, the thinking
    // pass can consume the whole 32k budget and the script truncates mid-line
    // (finish_reason=length). Cap reasoning so the ~6-8k-token script always has
    // room: 8k thinking + ~9k output leaves comfortable headroom under 32k.
    reasoning: { max_tokens: 8000 },
    model: config.ai.scriptModel,
  });

  result.episodeNumber = episodeNumber;
  result.episodeDate = factChecked.episodeDate;
  result.episodeType = episodeContext.type;
  if (episodeContext.companyName) result.companyName = episodeContext.companyName;

  if (episodeContext.type === "company-profile") {
    const contradictions = findLaunchedProductContradictions(result, factChecked);
    if (contradictions.length > 0) {
      throw new Error(
        `Script contradicts documented product release status:\n- ${contradictions.join("\n- ")}`
      );
    }
  }

  const quality = analyzeScriptQuality(result);

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
    console.warn(`Stage 04 quality warning: ${warning}`);
  }
}
