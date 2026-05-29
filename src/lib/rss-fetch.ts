import Parser from "rss-parser";
import type { RawStory } from "./types.js";

const parser = new Parser({
  timeout: 15000,
  headers: {
    "User-Agent": "LayerLinesWeekly/1.0 (podcast news aggregator)",
  },
});

export async function fetchFeed(
  url: string,
  sourceName: string
): Promise<RawStory[]> {
  const feed = await parser.parseURL(url);
  return (feed.items || []).map((item, i) => ({
    id: `${sourceName.toLowerCase().replace(/\s+/g, "-")}-${i}`,
    title: item.title?.trim() || "Untitled",
    url: item.link || "",
    source: sourceName,
    published: item.isoDate || item.pubDate || new Date().toISOString(),
    snippet: (item.contentSnippet || item.content || "").slice(0, 500).trim(),
  }));
}
