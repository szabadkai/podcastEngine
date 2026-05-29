import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { chatJson } from "./lib/ai.js";
import { loadJson, writeJson, fileExists, recapPath } from "./lib/storage.js";
import type { EpisodeScript, EpisodeRecap } from "./lib/types.js";

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

  const result = await chatJson<EpisodeRecap>({
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
    `Stage 04c: recap stored — ${recap.topics.length} topics, ${recap.threads.length} threads, ${recap.predictions.length} predictions.`
  );
}
