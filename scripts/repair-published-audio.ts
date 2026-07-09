import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { run as renderAudio } from "../src/05-audio.js";
import { generateFeedXml } from "../src/06-publish.js";
import { setShowConfig } from "../src/config.js";
import { getAudioDuration } from "../src/lib/audio.js";
import { fileExists, getEpisodeDir, loadJson, writeJson } from "../src/lib/storage.js";
import type { EpisodeManifest } from "../src/lib/types.js";
import { loadShow } from "../src/show.js";

const execFileAsync = promisify(execFile);
const MANIFEST_PATH = path.resolve("episodes", "manifest.json");
const FEED_PATH = path.resolve("episodes", "feed.xml");

const date = process.env.EPISODE_DATE?.trim();
if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  throw new Error("EPISODE_DATE must be set to YYYY-MM-DD");
}

const show = await loadShow();
setShowConfig(show);

const episodeDir = getEpisodeDir(date);
const scriptPath = path.join(episodeDir, "04-script.json");
const outputPath = path.join(episodeDir, "episode.mp3");
if (!fileExists(scriptPath)) {
  throw new Error(`04-script.json not found in ${episodeDir}`);
}

// A repaired episode must render from the preserved script rather than a newly
// generated one. Clear any partial output from an earlier repair attempt first.
fs.rmSync(outputPath, { force: true });
fs.rmSync(path.join(episodeDir, "chunks"), { recursive: true, force: true });

await renderAudio(episodeDir);

const tag = `episode-${date}`;
await execFileAsync("gh", ["release", "upload", tag, outputPath, "--clobber"]);

const manifest = loadJson<EpisodeManifest>(MANIFEST_PATH, { episodes: [] });
const entry = manifest.episodes.find((episode) => episode.date === date);
if (!entry) throw new Error(`Episode ${date} is missing from episodes/manifest.json`);

entry.duration = await getAudioDuration(outputPath);
entry.fileSize = fs.statSync(outputPath).size;
writeJson(MANIFEST_PATH, manifest);
fs.writeFileSync(FEED_PATH, generateFeedXml(manifest));

console.log(
  `Repaired ${tag}: ${entry.duration}s, ${(entry.fileSize / 1024 / 1024).toFixed(1)} MB.`
);
