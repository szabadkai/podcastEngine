import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { setShowConfig, config } from "../src/config.js";
import { generateFeedXml } from "../src/06-publish.js";
import { getAudioDuration } from "../src/lib/audio.js";
import { fileExists, loadJson, recapPath, writeJson } from "../src/lib/storage.js";
import type { EpisodeManifest, EpisodeRecap, EpisodeScript, RawStory } from "../src/lib/types.js";
import { getSpeakerLabel, loadShow } from "../src/show.js";

const execFileAsync = promisify(execFile);
const MANIFEST_PATH = path.resolve("episodes", "manifest.json");
const FEED_PATH = path.resolve("episodes", "feed.xml");
const TRANSCRIPTS_DIR = path.resolve("pages", "transcripts");
const SEEN_URLS_PATH = path.resolve("data", "seen-urls.json");

const date = process.env.EPISODE_DATE?.trim();
if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  throw new Error("EPISODE_DATE must be set to YYYY-MM-DD");
}

const show = await loadShow();
setShowConfig(show);

const tag = `episode-${date}`;
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `${tag}-recovery-`));

try {
  await execFileAsync("gh", [
    "release",
    "download",
    tag,
    "--pattern",
    "04-script.json",
    "--pattern",
    `${date}.json`,
    "--pattern",
    "01-raw-stories.json",
    "--pattern",
    "episode.mp3",
    "--dir",
    workDir,
  ]);

  const script = loadJson<EpisodeScript | null>(path.join(workDir, "04-script.json"), null);
  const recap = loadJson<EpisodeRecap | null>(path.join(workDir, `${date}.json`), null);
  const stories = loadJson<RawStory[]>(path.join(workDir, "01-raw-stories.json"), []);
  const mp3Path = path.join(workDir, "episode.mp3");
  if (!script || !recap || !fileExists(mp3Path)) {
    throw new Error(`Release ${tag} is missing one or more recovery artifacts`);
  }
  if (script.episodeDate !== date || recap.date !== date) {
    throw new Error(`Release ${tag} contains artifacts for a different episode date`);
  }

  const { stdout } = await execFileAsync("gh", [
    "release",
    "view",
    tag,
    "--json",
    "assets",
  ]);
  const assets = JSON.parse(stdout).assets as Array<{ name: string; url: string }>;
  const mp3Url = assets.find((asset) => asset.name === "episode.mp3")?.url;
  if (!mp3Url) throw new Error(`Release ${tag} has no episode.mp3 asset`);

  const manifest = loadJson<EpisodeManifest>(MANIFEST_PATH, { episodes: [] });
  if (manifest.episodes.some((episode) => episode.date === date)) {
    throw new Error(`Episode ${date} is already present in episodes/manifest.json`);
  }

  const imagePath = path.resolve("pages", "episodes", `${date}.png`);
  const imageUrl = fileExists(imagePath)
    ? `${config.podcast.siteUrl}/episodes/${date}.png`
    : undefined;

  manifest.episodes.unshift({
    number: script.episodeNumber,
    date,
    title: script.title,
    description: script.description,
    duration: await getAudioDuration(mp3Path),
    fileSize: fs.statSync(mp3Path).size,
    releaseUrl: mp3Url,
    guid: `${config.guidPrefix}-${date}`,
    ...(imageUrl ? { imageUrl } : {}),
    transcriptUrl: `${config.podcast.siteUrl}/transcripts/${date}.txt`,
  });

  fs.mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
  const transcript = `${config.podcast.title} — ${script.title}\nEpisode ${script.episodeNumber} · ${date}\n\n${script.lines
    .map((line) => `${getSpeakerLabel(line.speaker)}: ${line.text}`)
    .join("\n\n")}\n`;
  fs.writeFileSync(path.join(TRANSCRIPTS_DIR, `${date}.txt`), transcript);
  writeJson(recapPath(date), recap);

  const seenUrls = new Set(loadJson<string[]>(SEEN_URLS_PATH, []));
  for (const story of stories) seenUrls.add(story.url);
  writeJson(
    SEEN_URLS_PATH,
    [...seenUrls].slice(-config.episode.maxSeenUrls)
  );

  writeJson(MANIFEST_PATH, manifest);
  fs.writeFileSync(FEED_PATH, generateFeedXml(manifest));

  console.log(
    `Recovered ${tag}: episode #${script.episodeNumber}, ${stories.length} URLs, ${recap.topics.length} recap topics.`
  );
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
}
