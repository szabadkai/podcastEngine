import type { EpisodeType } from "./types.js";

// One episode a week, every Friday, alternating company profile and news.
// Both scheduled workflows fire each Friday and skip the week that belongs
// to the other type; manual runs are never skipped.
const FIRST_ALTERNATING_PROFILE = Date.UTC(2026, 9, 2); // Friday 2026-10-02
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function scheduledEpisodeType(date: string): EpisodeType {
  const time = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(time)) throw new Error(`Invalid episode date: ${date}`);
  const weeks = Math.round((time - FIRST_ALTERNATING_PROFILE) / WEEK_MS);
  return weeks % 2 === 0 ? "company-profile" : "news";
}
