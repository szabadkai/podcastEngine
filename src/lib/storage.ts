import fs from "node:fs";
import path from "node:path";
import type { EpisodeRecap } from "./types.js";

export function loadJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

export function writeJson(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, filePath);
}

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function getEpisodeDir(dateStr?: string): string {
  const date = dateStr || new Date().toISOString().split("T")[0];
  const dir = path.resolve("episodes", date);
  ensureDir(dir);
  return dir;
}

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

// Directory holding one recap JSON per episode, named "<episodeDate>.json"
// (e.g. episodes/recaps/2026-05-29.json). Because YYYY-MM-DD sorts
// lexicographically as chronologically, "recent" is just the tail of a sort.
export function getRecapsDir(): string {
  return path.resolve("episodes", "recaps");
}

export function recapPath(episodeDate: string): string {
  return path.join(getRecapsDir(), `${episodeDate}.json`);
}

export interface RecentRecapOptions {
  beforeDate?: string;
  minAgeDays?: number;
  // When supplied, drafts/orphaned recaps are excluded before the window is
  // sliced. The script and analysis stages pass dates from the published
  // manifest so off-air test episodes cannot leak into continuity.
  includeDates?: ReadonlySet<string>;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function dateToUtcMs(date: string): number | null {
  if (!DATE_RE.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

// Returns the most recent `limit` eligible recaps, oldest-first (ready to render
// into a prompt). Reads the recaps directory, ignores anything that isn't a
// dated JSON, and never throws if the directory doesn't exist yet (first
// episode).
export function loadRecentRecaps(
  limit: number,
  options: RecentRecapOptions = {}
): EpisodeRecap[] {
  if (limit <= 0) return [];

  const dir = getRecapsDir();
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }

  files = selectRecentRecapFiles(files, limit, options);

  const recaps: EpisodeRecap[] = [];
  for (const f of files) {
    const recap = loadJson<EpisodeRecap | null>(path.join(dir, f), null);
    if (recap) recaps.push(recap);
  }
  return recaps;
}

// Pure filename selection kept separate from disk I/O so continuity window and
// published-manifest filtering can be tested without mutating the real archive.
export function selectRecentRecapFiles(
  files: string[],
  limit: number,
  options: RecentRecapOptions = {},
): string[] {
  if (limit <= 0) return [];

  let eligible = files.filter(
    (file) => file.endsWith(".json") && DATE_RE.test(path.basename(file, ".json")),
  );

  const beforeMs = options.beforeDate ? dateToUtcMs(options.beforeDate) : null;
  const minAgeDays = options.minAgeDays ?? 0;
  if (options.beforeDate || minAgeDays > 0 || options.includeDates) {
    eligible = eligible.filter((f) => {
      const recapDate = path.basename(f, ".json");
      if (options.includeDates && !options.includeDates.has(recapDate)) return false;
      const recapMs = dateToUtcMs(recapDate);
      if (recapMs === null) return false;
      if (beforeMs !== null && recapMs >= beforeMs) return false;
      if (beforeMs !== null && minAgeDays > 0) {
        return (beforeMs - recapMs) / DAY_MS >= minAgeDays;
      }
      return true;
    });
  }

  eligible.sort(); // chronological for YYYY-MM-DD names
  return eligible.slice(-limit);
}
