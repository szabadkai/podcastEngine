import path from "node:path";
import { config } from "./config.js";
import { fetchFeed } from "./lib/rss-fetch.js";
import { loadJson, writeJson, fileExists } from "./lib/storage.js";
import type { RawStory } from "./lib/types.js";

const SEEN_URLS_PATH = path.resolve("data", "seen-urls.json");

function isWithinDays(dateStr: string, days: number): boolean {
  const cutoff = Date.now() - days * 86400000;
  return new Date(dateStr).getTime() >= cutoff;
}

export async function run(episodeDir: string): Promise<void> {
  const outputPath = path.join(episodeDir, "01-raw-stories.json");
  if (fileExists(outputPath)) {
    console.log("Stage 01: output already exists, skipping.");
    return;
  }

  console.log(`Fetching ${config.sources.length} RSS feeds...`);

  const results = await Promise.allSettled(
    config.sources.map((s) => fetchFeed(s.url, s.name))
  );

  const allStories: RawStory[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const source = config.sources[i];
    if (result.status === "fulfilled") {
      console.log(`  ${source.name}: ${result.value.length} items`);
      allStories.push(...result.value);
    } else {
      console.warn(`  ${source.name}: FAILED — ${result.reason}`);
    }
  }

  if (allStories.length === 0) {
    throw new Error("All feeds failed. Aborting.");
  }

  const seenUrls = new Set<string>(loadJson<string[]>(SEEN_URLS_PATH, []));

  let stories = allStories.filter(
    (s) =>
      !seenUrls.has(s.url) &&
      isWithinDays(s.published, config.episode.storyWindowDays)
  );

  if (stories.length < config.episode.minStories) {
    console.log(
      `Only ${stories.length} stories in ${config.episode.storyWindowDays}d window, widening to ${config.episode.fallbackWindowDays}d...`
    );
    stories = allStories.filter(
      (s) =>
        !seenUrls.has(s.url) &&
        isWithinDays(s.published, config.episode.fallbackWindowDays)
    );
  }

  if (stories.length < config.episode.minStories) {
    throw new Error(
      `Only ${stories.length} stories found (need ${config.episode.minStories}). Not enough for an episode.`
    );
  }

  stories.sort(
    (a, b) => new Date(b.published).getTime() - new Date(a.published).getTime()
  );

  for (const s of stories) seenUrls.add(s.url);
  const trimmedUrls = [...seenUrls].slice(-config.episode.maxSeenUrls);
  writeJson(SEEN_URLS_PATH, trimmedUrls);

  writeJson(outputPath, stories);
  console.log(`Stage 01: collected ${stories.length} stories.`);
}
