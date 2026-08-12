import type { FactCheckedStories, RawStory } from "./types.js";

export interface TranscriptReference {
  title: string;
  source: string;
  url: string;
}

function sourceName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Source";
  }
}

function normalizedHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function referenceLookupKey(url: string): string {
  const parsed = new URL(url);
  if (parsed.hostname === "news.google.com") parsed.search = "";
  return parsed.href;
}

export function collectTranscriptReferences(
  stories: RawStory[],
  factChecked: FactCheckedStories | null,
): TranscriptReference[] {
  if (!factChecked) return [];

  const storyByUrl = new Map(
    stories.flatMap((story) => {
      const normalized = normalizedHttpUrl(story.url);
      return normalized ? [[referenceLookupKey(normalized), story] as const] : [];
    }),
  );
  const seen = new Set<string>();
  const references: TranscriptReference[] = [];

  for (const cluster of factChecked.clusters) {
    for (const sourceUrl of cluster.sources) {
      const url = normalizedHttpUrl(sourceUrl);
      if (!url) continue;
      const lookupKey = referenceLookupKey(url);
      if (seen.has(lookupKey)) continue;
      seen.add(lookupKey);

      const story = storyByUrl.get(lookupKey);
      const source = story?.source?.trim() || sourceName(url);
      references.push({
        title: story?.title?.trim() || cluster.headline.trim() || source,
        source,
        url,
      });
    }
  }

  return references;
}

export function formatTranscriptReferences(
  references: TranscriptReference[],
): string {
  if (!references.length) return "";

  return `\n\nReferences\n\n${references
    .map((reference, index) =>
      `${index + 1}. ${reference.title} — ${reference.source}\n   ${reference.url}`,
    )
    .join("\n\n")}`;
}
