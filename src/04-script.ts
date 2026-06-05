import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { chatJson } from "./lib/ai.js";
import { loadJson, writeJson, fileExists, loadRecentRecaps } from "./lib/storage.js";
import {
  findBestRecapMatch,
  getPastTranscript,
  transcriptToDialogue,
} from "./lib/continuity.js";
import type {
  FactCheckedStories,
  EpisodeScript,
  EpisodeManifest,
} from "./lib/types.js";

export async function run(episodeDir: string): Promise<void> {
  const outputPath = path.join(episodeDir, "04-script.json");
  if (fileExists(outputPath)) {
    console.log("Stage 04: output already exists, skipping.");
    return;
  }

  const inputPath = path.join(episodeDir, "03-fact-checked.json");
  const factChecked = loadJson<FactCheckedStories | null>(inputPath, null);
  if (!factChecked) throw new Error("No fact-checked stories found in 03-fact-checked.json");

  const systemPrompt = fs.readFileSync(
    path.resolve("prompts", "script.md"),
    "utf-8"
  );

  const manifest = loadJson<EpisodeManifest>(
    path.resolve("episodes", "manifest.json"),
    { episodes: [] }
  );
  const episodeNumber = manifest.episodes.length + 1;

  // Lightweight continuity: feed the most recent episode recaps so hosts can make
  // occasional, relevant callbacks (see "Continuity" in prompts/script.md).
  // loadRecentRecaps returns oldest-first, already capped to the window.
  const recentRecaps = loadRecentRecaps(config.episode.continuityWindow);
  const continuityBlock =
    recentRecaps.length > 0
      ? "\n\n## Recent episodes (for continuity — reference only when genuinely relevant)\n\n" +
        recentRecaps
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

  // If one of the recent episodes is genuinely on-topic with this week's stories,
  // give the model that episode's FULL transcript so any callback is accurate —
  // not paraphrased from the compressed recap. Best single match only; skipped
  // entirely when nothing overlaps (the common case).
  let transcriptBlock = "";
  if (recentRecaps.length > 0) {
    const match = findBestRecapMatch(recentRecaps, factChecked);
    if (match) {
      const past = await getPastTranscript(match.recap.date);
      if (past) {
        console.log(
          `Continuity: episode #${match.recap.number} (${match.recap.date}) overlaps on [${match.sharedTerms.join(
            ", "
          )}] — attaching its transcript for an accurate callback.`
        );
        transcriptBlock =
          `\n\n## Transcript of episode #${match.recap.number} (${match.recap.date}) — "${match.recap.title}"\n` +
          `This earlier episode covers a story related to one of this week's. If you make a callback to it, draw the details from THIS transcript, not from memory. Only reference it if the connection is genuine.\n\n` +
          transcriptToDialogue(past);
      } else {
        console.log(
          `Continuity: episode #${match.recap.number} matched but its transcript was unavailable — using recap only.`
        );
      }
    }
  }

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

  console.log("Generating two-host script...");

  const result = await chatJson<EpisodeScript>({
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Write episode #${episodeNumber} for ${factChecked.episodeDate}.\n\nHere are the fact-checked stories for this episode:\n\n${storyBrief}${continuityBlock}${transcriptBlock}\n\nGenerate the full podcast script as JSON.`,
      },
    ],
    temperature: 0.7,
    maxTokens: 16384,
    model: config.ai.scriptModel,
  });

  result.episodeNumber = episodeNumber;
  result.episodeDate = factChecked.episodeDate;

  const wordCount = result.lines.reduce(
    (sum, l) => sum + l.text.split(/\s+/).length,
    0
  );
  const estMinutes = Math.round(wordCount / 150);

  writeJson(outputPath, result);
  console.log(
    `Stage 04: script generated — ${result.lines.length} lines, ~${wordCount} words, ~${estMinutes} min.`
  );
}
