import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { chatJson } from "./lib/ai.js";
import { getEpisodeContext, promptPath } from "./lib/episode-mode.js";
import {
  loadJson,
  writeJson,
  fileExists,
  loadRecentRecaps,
} from "./lib/storage.js";
import type { RawStory, AnalyzedStories, EpisodeManifest } from "./lib/types.js";

export async function run(episodeDir: string): Promise<void> {
  const outputPath = path.join(episodeDir, "02-analyzed.json");
  if (fileExists(outputPath)) {
    console.log("Stage 02: output already exists, skipping.");
    return;
  }

  const inputPath = path.join(episodeDir, "01-raw-stories.json");
  const stories = loadJson<RawStory[]>(inputPath, []);
  if (stories.length === 0) throw new Error("No stories found in 01-raw-stories.json");

  const episodeContext = getEpisodeContext();
  const systemPrompt = fs.readFileSync(promptPath("analyze", episodeContext), "utf-8");

  const today = path.basename(episodeDir);
  const manifest = loadJson<EpisodeManifest>(
    path.resolve("episodes", "manifest.json"),
    { episodes: [] },
  );
  const publishedDates = new Set(manifest.episodes.map((episode) => episode.date));
  const recentPublishedRecaps =
    episodeContext.type === "news"
      ? loadRecentRecaps(config.episode.continuityWindow, {
          beforeDate: today,
          includeDates: publishedDates,
        })
      : [];
  const recentCoverageBlock =
    recentPublishedRecaps.length > 0
      ? "\n\nRecently published coverage (editorial memory, not source material):\n" +
        recentPublishedRecaps
          .map(
            (recap) =>
              `- ${recap.date}: ${[...recap.topics, ...recap.threads].join("; ")}`,
          )
          .join("\n") +
        "\n\nDo not select a story merely because it resembles one above. Reuse a topic only when this week's item is a concrete new event or materially advances an unresolved thread; make that advancement explicit in the cluster summary and significance."
      : "";
  const storyList = stories
    .map(
      (s, i) =>
        `${i + 1}. [${s.curated ? "Curated — editor pick" : s.source}] [${s.sourceType}] "${s.title}" (${s.published})\n   URL: ${s.url}\n   ${s.snippet}`
    )
    .join("\n\n");

  console.log(`Analyzing ${stories.length} stories...`);
  const userContent =
    episodeContext.type === "company-profile"
      ? `Today's date: ${today}\nEpisode type: company-profile\nCompany: ${episodeContext.companyName}\n\nHere are ${stories.length} source items for a company-profile episode:\n\n${storyList}\n\nAnalyze, organize into profile segments, rank, and return JSON.`
      : `Today's date: ${today}${recentCoverageBlock}\n\nHere are ${stories.length} stories from this week:\n\n${storyList}\n\nAnalyze, cluster, rank, and assign segments. Return JSON.`;

  const result = await chatJson<AnalyzedStories>({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    temperature: 0.3,
    // Reasoning models (deepseek-v4-pro) emit a long internal trace before the
    // JSON; 4096 truncates the answer mid-string. Give it ample headroom —
    // more so now that we shortlist 7-10 clusters plus the skipped list.
    maxTokens: 24000,
  });

  result.episodeDate = today;
  result.episodeType = episodeContext.type;
  if (episodeContext.companyName) result.companyName = episodeContext.companyName;

  writeJson(outputPath, result);
  console.log(
    `Stage 02: ${result.clusters.length} clusters selected, ${result.skipped.length} skipped.`
  );
}
