import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { chatJson } from "./lib/ai.js";
import { loadJson, writeJson, fileExists, recapPath } from "./lib/storage.js";
import type {
  EpisodeScript,
  EpisodeRecap,
  FactCheckedStories,
} from "./lib/types.js";

// Continuity memory improves future scripts, but it is not part of the episode
// being published. If the recap model is unavailable, preserve useful topic
// memory from the already fact-checked cluster headlines instead of failing the
// audio and publishing stages.
export function buildFallbackRecap(
  script: EpisodeScript,
  factChecked: FactCheckedStories | null,
): EpisodeRecap {
  const topics = Array.from(
    new Set(
      (factChecked?.clusters ?? [])
        .map((cluster) => cluster.headline.trim())
        .filter(Boolean),
    ),
  ).slice(0, 6);

  return {
    number: script.episodeNumber,
    date: script.episodeDate,
    title: script.title,
    topics: topics.length > 0 ? topics : [script.title],
    threads: [],
    predictions: [],
  };
}

// Distills the finished episode script into a compact recap (topics, ongoing
// threads, predictions) and writes it as one dated file under episodes/recaps/.
// The script stage reads the most recent of these to give the hosts light,
// occasional continuity with earlier episodes.
export async function run(episodeDir: string): Promise<void> {
  const inputPath = path.join(episodeDir, "04-script.json");
  const script = loadJson<EpisodeScript | null>(inputPath, null);
  if (!script) throw new Error("No script found in 04-script.json");

  const outputPath = recapPath(script.episodeDate);
  if (fileExists(outputPath)) {
    console.log("Stage 04c: recap for this episode already exists, skipping.");
    return;
  }

  const systemPrompt = fs.readFileSync(
    path.resolve("prompts", "recap.md"),
    "utf-8"
  );

  console.log("Stage 04c: distilling episode recap for continuity...");

  let result: EpisodeRecap;
  let usedFallback = false;
  try {
    result = await chatJson<EpisodeRecap>({
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Distill this finished episode into a continuity recap as JSON.\n\n${JSON.stringify(
            script,
            null,
            2
          )}`,
        },
      ],
      temperature: 0.3,
      maxTokens: 1024,
      model: config.ai.recapModel,
    });
  } catch (err) {
    usedFallback = true;
    const factChecked = loadJson<FactCheckedStories | null>(
      path.join(episodeDir, "03-fact-checked.json"),
      null,
    );
    result = buildFallbackRecap(script, factChecked);
    console.warn(
      `Stage 04c: AI recap unavailable; using fact-checked topic fallback so publication can continue. ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Authoritative identity comes from the script, not the model.
  const recap: EpisodeRecap = {
    number: script.episodeNumber,
    date: script.episodeDate,
    title: script.title,
    topics: Array.isArray(result.topics) ? result.topics : [],
    threads: Array.isArray(result.threads) ? result.threads : [],
    predictions: Array.isArray(result.predictions) ? result.predictions : [],
  };

  // One dated file per episode (episodes/recaps/<date>.json).
  writeJson(outputPath, recap);

  console.log(
    `Stage 04c: recap stored${usedFallback ? " (fallback)" : ""} — ${recap.topics.length} topics, ${recap.threads.length} threads, ${recap.predictions.length} predictions.`
  );
}
