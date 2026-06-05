import fs from "node:fs";
import path from "node:path";
import { chatJson } from "./lib/ai.js";
import { loadJson, writeJson, fileExists } from "./lib/storage.js";
import type { RawStory, AnalyzedStories } from "./lib/types.js";

export async function run(episodeDir: string): Promise<void> {
  const outputPath = path.join(episodeDir, "02-analyzed.json");
  if (fileExists(outputPath)) {
    console.log("Stage 02: output already exists, skipping.");
    return;
  }

  const inputPath = path.join(episodeDir, "01-raw-stories.json");
  const stories = loadJson<RawStory[]>(inputPath, []);
  if (stories.length === 0) throw new Error("No stories found in 01-raw-stories.json");

  const systemPrompt = fs.readFileSync(
    path.resolve("prompts", "analyze.md"),
    "utf-8"
  );

  const today = path.basename(episodeDir);
  const storyList = stories
    .map(
      (s, i) =>
        `${i + 1}. [${s.curated ? "Curated — editor pick" : s.source}] [${s.sourceType}] "${s.title}" (${s.published})\n   URL: ${s.url}\n   ${s.snippet}`
    )
    .join("\n\n");

  console.log(`Analyzing ${stories.length} stories...`);

  const result = await chatJson<AnalyzedStories>({
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Today's date: ${today}\n\nHere are ${stories.length} stories from this week:\n\n${storyList}\n\nAnalyze, cluster, rank, and assign segments. Return JSON.`,
      },
    ],
    temperature: 0.3,
    // Reasoning models (deepseek-v4-pro) emit a long internal trace before the
    // JSON; 4096 truncates the answer mid-string. Give it ample headroom —
    // more so now that we shortlist 7-10 clusters plus the skipped list.
    maxTokens: 24000,
  });

  writeJson(outputPath, result);
  console.log(
    `Stage 02: ${result.clusters.length} clusters selected, ${result.skipped.length} skipped.`
  );
}
