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

// Returns the most recent `limit` recaps, oldest-first (ready to render into a
// prompt). Reads the recaps directory, ignores anything that isn't a dated JSON,
// and never throws if the directory doesn't exist yet (first episode).
export function loadRecentRecaps(limit: number): EpisodeRecap[] {
  const dir = getRecapsDir();
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
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
