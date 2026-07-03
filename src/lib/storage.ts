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
    files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json") && DATE_RE.test(path.basename(f, ".json")));
  } catch {
    return [];
  }

  const beforeMs = options.beforeDate ? dateToUtcMs(options.beforeDate) : null;
  const minAgeDays = options.minAgeDays ?? 0;
  if (options.beforeDate || minAgeDays > 0) {
    files = files.filter((f) => {
      const recapDate = path.basename(f, ".json");
      const recapMs = dateToUtcMs(recapDate);
      if (recapMs === null) return false;
      if (beforeMs !== null && recapMs >= beforeMs) return false;
      if (beforeMs !== null && minAgeDays > 0) {
        return (beforeMs - recapMs) / DAY_MS >= minAgeDays;
      }
      return true;
    });
  }

  files.sort(); // chronological for YYYY-MM-DD names
  const recent = files.slice(-limit);
  const recaps: EpisodeRecap[] = [];
  for (const f of recent) {
    const recap = loadJson<EpisodeRecap | null>(path.join(dir, f), null);
    if (recap) recaps.push(recap);
  }
  return recaps;
}
