import Parser from "rss-parser";
import { config } from "../config.js";
import type { RawStory, SourceType } from "./types.js";

let _parser: Parser | null = null;

const FETCH_TIMEOUT_MS = 20_000;

function isValidXmlCodePoint(codePoint: number): boolean {
  return (
    codePoint === 0x9 ||
    codePoint === 0xa ||
    codePoint === 0xd ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  );
}

/**
 * XML 1.0 rejects control characters, including when they appear as numeric
 * entities.  A single invalid character otherwise makes rss-parser reject an
 * entire feed, so remove only the characters that XML cannot represent.
 */
export function sanitizeXml(xml: string): string {
  const withoutInvalidCharacters = Array.from(xml)
    .filter((character) => isValidXmlCodePoint(character.codePointAt(0)!))
    .join("");

  return withoutInvalidCharacters.replace(
    /&#(?:x([0-9a-f]+)|([0-9]+));/gi,
    (entity, hexadecimal: string | undefined, decimal: string | undefined) => {
      const numericValue = hexadecimal ?? decimal;
      if (!numericValue) return "";
      const codePoint = Number.parseInt(numericValue, hexadecimal ? 16 : 10);
      return Number.isSafeInteger(codePoint) && isValidXmlCodePoint(codePoint)
        ? entity
        : "";
    },
  );
}

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
  // rss-parser's parseURL timeout does not cover every network phase. Fetching
  // ourselves gives every source the same hard deadline, including Reddit and
  // feeds that keep a response body open indefinitely.
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; LayerLinesWeekly/1.0)" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Status code ${res.status}`);

  return getParser().parseString(sanitizeXml(await res.text()));
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
