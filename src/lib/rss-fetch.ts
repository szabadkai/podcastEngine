import Parser from "rss-parser";
import { config } from "../config.js";
import type { RawStory } from "./types.js";

let _parser: Parser | null = null;

function getParser(): Parser {
  if (!_parser) {
    const slug = config.podcast.title.replace(/\s+/g, "");
    _parser = new Parser({
      timeout: 15000,
      headers: {
        "User-Agent": `${slug}/1.0 (podcast news aggregator)`,
      },
    });
  }
  return _parser;
}

export async function fetchFeed(
  url: string,
  sourceName: string
): Promise<RawStory[]> {
  const feed = await getParser().parseURL(url);
  return (feed.items || []).map((item, i) => ({
    id: `${sourceName.toLowerCase().replace(/\s+/g, "-")}-${i}`,
    title: item.title?.trim() || "Untitled",
    url: item.link || "",
    source: sourceName,
    published: item.isoDate || item.pubDate || new Date().toISOString(),
    snippet: (item.contentSnippet || item.content || "").slice(0, 500).trim(),
  }));
}
