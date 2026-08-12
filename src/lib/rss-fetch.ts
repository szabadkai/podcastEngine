import Parser from "rss-parser";
import { config } from "../config.js";
import type { RawStory, SourceType } from "./types.js";

let _parser: Parser | null = null;

const FETCH_TIMEOUT_MS = 20_000;

export interface FeedFilterOptions {
  include?: string[];
  exclude?: string[];
  excludeTitle?: string[];
  maxItems?: number;
}

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

  return withoutInvalidCharacters
    .replace(
      /&#(?:x([0-9a-f]+)|([0-9]+));/gi,
      (entity, hexadecimal: string | undefined, decimal: string | undefined) => {
        const numericValue = hexadecimal ?? decimal;
        if (!numericValue) return "";
        const codePoint = Number.parseInt(numericValue, hexadecimal ? 16 : 10);
        return Number.isSafeInteger(codePoint) && isValidXmlCodePoint(codePoint)
          ? entity
          : "";
      },
    )
    // XML names are case-sensitive. Some WordPress feeds emit lowercase RSS
    // date tags, making otherwise old posts appear freshly published.
    .replace(/<(\/?)pubdate>/gi, "<$1pubDate>")
    .replace(/<(\/?)lastbuilddate>/gi, "<$1lastBuildDate>");
}

function getParser(): Parser {
  if (!_parser) {
    const slug = config.podcast.title.replace(/\s+/g, "");
    _parser = new Parser({
      timeout: 15000,
      headers: {
        "User-Agent": `${slug}/1.0 (podcast news aggregator)`,
      },
      customFields: {
        item: [
          ["media:group", "mediaGroup"],
          ["summary", "summary"],
          ["dc:date", "dcDate"],
        ],
      },
    });
  }
  return _parser;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_entity, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#([0-9]+);/g, (_entity, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'");
}

function plainText(value: unknown): string {
  if (typeof value !== "string") return "";
  return decodeXmlEntities(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mediaDescription(item: Record<string, unknown>): string {
  const group = item.mediaGroup;
  if (!group || typeof group !== "object") return "";
  const description = (group as Record<string, unknown>)["media:description"];
  if (Array.isArray(description)) return plainText(description[0]);
  return plainText(description);
}

function normalizedDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function extractPublishedDate(
  item: Record<string, unknown>,
  fallback: string,
): string {
  for (const candidate of [
    item.isoDate,
    item.pubDate,
    item.published,
    item.dcDate,
  ]) {
    const date = normalizedDate(candidate);
    if (date) return date;
  }

  const sourceText = [item.contentSnippet, item.content, item.summary]
    .map(plainText)
    .join(" ");
  const publicationDate = sourceText.match(
    /Publication date:\s*(?:Available online\s*)?(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i,
  )?.[1];
  return normalizedDate(publicationDate ? `${publicationDate} UTC` : undefined) ?? fallback;
}

export function extractFeedSnippet(item: Record<string, unknown>): string {
  const candidates = [
    item.contentSnippet,
    item.content,
    item.summary,
    mediaDescription(item),
  ];
  return candidates.map(plainText).find(Boolean)?.slice(0, 500) ?? "";
}

export function filterFeedStories(
  stories: RawStory[],
  options: FeedFilterOptions = {},
): RawStory[] {
  const includes = options.include?.map((term) => term.toLowerCase()) ?? [];
  const excludes = options.exclude?.map((term) => term.toLowerCase()) ?? [];
  const titleExcludes =
    options.excludeTitle?.map((term) => term.toLowerCase()) ?? [];
  const filtered = stories.filter((story) => {
    const haystack = `${story.title}\n${story.snippet}`.toLowerCase();
    const title = story.title.toLowerCase();
    if (includes.length > 0 && !includes.some((term) => haystack.includes(term))) {
      return false;
    }
    if (titleExcludes.some((term) => title.includes(term))) return false;
    return !excludes.some((term) => haystack.includes(term));
  });
  return options.maxItems ? filtered.slice(0, options.maxItems) : filtered;
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
  sourceType: SourceType = "core",
  options: FeedFilterOptions = {},
): Promise<RawStory[]> {
  const feed = await parseFeed(url);
  const fallbackDate = new Date().toISOString();
  const stories = (feed.items || []).map((item, i) => ({
    id: `${sourceName.toLowerCase().replace(/\s+/g, "-")}-${i}`,
    title: plainText(item.title) || "Untitled",
    url: item.link || "",
    source: sourceName,
    sourceType,
    published: extractPublishedDate(item, fallbackDate),
    snippet: extractFeedSnippet(item),
  }));
  return filterFeedStories(stories, options);
}
