import type { AnalyzedStories } from "./types.js";

// Model JSON is untrusted even when it parses successfully. Validate before
// saving it or handing it to stages that require source evidence.
export function validateAnalyzedStories(value: unknown): AnalyzedStories {
  function object(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${field} must be an object`);
    }
    return value as Record<string, unknown>;
  }
  function text(value: unknown, field: string): void {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`${field} must be a non-empty string`);
    }
  }
  const data = object(value, "analysis");
  text(data.episodeDate, "episodeDate");
  if (!Array.isArray(data.clusters) || data.clusters.length === 0) {
    throw new Error("clusters must be a non-empty array");
  }
  const ids = new Set<string>();
  data.clusters.forEach((value, index) => {
    const field = `clusters[${index}]`;
    const cluster = object(value, field);
    for (const key of ["id", "segment", "headline", "summary", "significance"]) {
      text(cluster[key], `${field}.${key}`);
    }
    if (ids.has(cluster.id as string)) throw new Error(`${field}.id must be unique`);
    ids.add(cluster.id as string);
    if (typeof cluster.rank !== "number" || !Number.isFinite(cluster.rank)) {
      throw new Error(`${field}.rank must be a finite number`);
    }
    if (!Array.isArray(cluster.sources) || cluster.sources.length === 0) {
      throw new Error(`${field}.sources must be a non-empty array of source URLs`);
    }
    cluster.sources.forEach((source, index) => {
      const sourceField = `${field}.sources[${index}]`;
      text(source, sourceField);
      let url: URL;
      try { url = new URL(source as string); }
      catch { throw new Error(`${sourceField} must be an HTTP(S) URL`); }
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error(`${sourceField} must be an HTTP(S) URL`);
      }
    });
  });
  if (!Array.isArray(data.skipped)) throw new Error("skipped must be an array");
  data.skipped.forEach((value, index) => {
    const item = object(value, `skipped[${index}]`);
    text(item.headline, `skipped[${index}].headline`);
    text(item.reason, `skipped[${index}].reason`);
  });
  return value as AnalyzedStories;
}
