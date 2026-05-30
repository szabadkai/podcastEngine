import Parser from "rss-parser";
import { config } from "../config.js";
import type { RawStory, SourceType } from "./types.js";

let _parser: Parser | null = null;

const MANUAL_FETCH_HOSTS = new Set(["www.reddit.com", "reddit.com"]);

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

async function parseFeed(url: string): Promise<Parser.Output<Record<string, unknown>>> {
  let host: string | undefined;
  try { host = new URL(url).hostname; } catch { /* fall through */ }

  if (host && MANUAL_FETCH_HOSTS.has(host)) {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LayerLinesWeekly/1.0)" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Status code ${res.status}`);
    const xml = await res.text();
    return getParser().parseString(xml);
  }

  return getParser().parseURL(url);
}

export async function fetchFeed(
  url: string,
  sourceName: string,
  sourceType: SourceType = "core"
): Promise<RawStory[]> {
  const feed = await parseFeed(url);
  return (feed.items || []).map((item, i) => ({
    id: `${sourceName.toLowerCase().replace(/\s+/g, "-")}-${i}`,
    title: item.title?.trim() || "Untitled",
    url: item.link || "",
    source: sourceName,
    sourceType,
    published: item.isoDate || item.pubDate || new Date().toISOString(),
    snippet: (item.contentSnippet || item.content || "").slice(0, 500).trim(),
  }));
}
