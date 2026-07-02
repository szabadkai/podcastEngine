import path from "node:path";
import { config } from "./config.js";
import { fetchFeed } from "./lib/rss-fetch.js";
import {
  fetchCuratedLinks,
  linkToStory,
  closeProcessedIssues,
} from "./lib/curated-fetch.js";
import { fetchCompanyProfileSources } from "./lib/company-profile.js";
import { getEpisodeContext } from "./lib/episode-mode.js";
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

  const episodeContext = getEpisodeContext();
  if (episodeContext.type === "company-profile") {
    await collectCompanyProfile(outputPath, episodeContext.companyName!);
    return;
  }

  // ── RSS feeds ──────────────────────────────────────────────────────────
  console.log(`Fetching ${config.sources.length} RSS feeds...`);

  const results = await Promise.allSettled(
    config.sources.map((s) => fetchFeed(s.url, s.name, s.type ?? "core"))
  );

  const rssStories: RawStory[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const source = config.sources[i];
    if (result.status === "fulfilled") {
      console.log(`  ${source.name}: ${result.value.length} items`);
      rssStories.push(...result.value);
    } else {
      console.warn(`  ${source.name}: FAILED — ${result.reason}`);
    }
  }

  // ── Curated links (GitHub Issues) ──────────────────────────────────────
  const curatedLinks = await fetchCuratedLinks();
  const curatedStories: RawStory[] = [];
  const processedIssueNumbers: number[] = [];

  if (curatedLinks.length > 0) {
    console.log(`  Fetching metadata for ${curatedLinks.length} curated link(s)...`);
    const today = new Date().toISOString();
    for (const link of curatedLinks) {
      const story = await linkToStory(link, today);
      curatedStories.push(story);
      processedIssueNumbers.push(link.issueNumber);
      console.log(`  Curated #${link.issueNumber}: "${story.title}"`);
    }
  }

  if (rssStories.length === 0 && curatedStories.length === 0) {
    throw new Error("All feeds failed and no curated links. Aborting.");
  }

  // ── Dedup & filtering ─────────────────────────────────────────────────
  const seenUrls = new Set<string>(loadJson<string[]>(SEEN_URLS_PATH, []));

  // Curated stories bypass the time-window filter but still respect seen-urls.
  const freshCurated = curatedStories.filter((s) => !seenUrls.has(s.url));

  // Build a set of curated URLs so we can prefer curated over RSS duplicates.
  const curatedUrls = new Set(freshCurated.map((s) => s.url));

  // RSS stories: dedup against seen-urls AND curated (prefer curated version),
  // then apply the time-window filter.
  const deduped = rssStories.filter(
    (s) => !seenUrls.has(s.url) && !curatedUrls.has(s.url),
  );

  let rssFiltered = deduped.filter((s) =>
    isWithinDays(s.published, config.episode.storyWindowDays),
  );

  const totalBeforeWindow = freshCurated.length + rssFiltered.length;
  if (totalBeforeWindow < config.episode.minStories) {
    console.log(
      `Only ${totalBeforeWindow} stories in ${config.episode.storyWindowDays}d window, widening to ${config.episode.fallbackWindowDays}d...`
    );
    rssFiltered = deduped.filter((s) =>
      isWithinDays(s.published, config.episode.fallbackWindowDays),
    );
  }

  const stories = [...freshCurated, ...rssFiltered];

  if (stories.length < config.episode.minStories) {
    throw new Error(
      `Only ${stories.length} stories found (need ${config.episode.minStories}). Not enough for an episode.`
    );
  }

  stories.sort(
    (a, b) => new Date(b.published).getTime() - new Date(a.published).getTime()
  );

  // ── Persist ────────────────────────────────────────────────────────────
  for (const s of stories) seenUrls.add(s.url);
  const trimmedUrls = [...seenUrls].slice(-config.episode.maxSeenUrls);
  writeJson(SEEN_URLS_PATH, trimmedUrls);

  writeJson(outputPath, stories);
  const curatedCount = stories.filter((s) => s.curated).length;
  console.log(
    `Stage 01: collected ${stories.length} stories${curatedCount > 0 ? ` (${curatedCount} curated)` : ""}.`
  );

  // Close processed GitHub Issues after successful write.
  await closeProcessedIssues(processedIssueNumbers);
}

async function collectCompanyProfile(
  outputPath: string,
  companyName: string,
): Promise<void> {
  console.log(`Collecting company profile sources for ${companyName}...`);
  const stories = await fetchCompanyProfileSources(companyName);

  if (stories.length < config.episode.minStories) {
    throw new Error(
      `Only ${stories.length} company profile source(s) found for ${companyName}. ` +
        "Add official, leadership, product, and background URLs via COMPANY_PROFILE_URLS."
    );
  }

  writeJson(outputPath, stories);
  const profileCount = stories.filter((s) => s.sourceType === "profile").length;
  console.log(
    `Stage 01: collected ${stories.length} company profile source(s)` +
      (profileCount > 0 ? ` (${profileCount} official/profile)` : "") +
      "."
  );
}
