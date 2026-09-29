import path from "node:path";
import { loadJson, writeJson, fileExists, recapPath } from "./lib/storage.js";
import { buildMechanicalRecap } from "./lib/recap.js";
export { buildMechanicalRecap as buildFallbackRecap } from "./lib/recap.js";
import type {
  EpisodeScript,
  FactCheckedStories,
} from "./lib/types.js";

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

  console.log("Stage 04c: building mechanical continuity recap...");
  const factChecked = loadJson<FactCheckedStories | null>(
    path.join(episodeDir, "03-fact-checked.json"),
    null,
  );
  const recap = buildMechanicalRecap(script, factChecked);

  // One dated file per episode (episodes/recaps/<date>.json).
  writeJson(outputPath, recap);

  console.log(
    `Stage 04c: recap stored (mechanical) — ${recap.topics.length} topics, ${recap.threads.length} threads, ${recap.predictions.length} predictions.`
  );
}
