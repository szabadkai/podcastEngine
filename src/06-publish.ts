import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.js";
import { loadJson, writeJson, fileExists, recapPath } from "./lib/storage.js";
import { getAudioDuration } from "./lib/audio.js";
import type { EpisodeScript, EpisodeManifest, EpisodeEntry } from "./lib/types.js";

const execFileAsync = promisify(execFile);

const MANIFEST_PATH = path.resolve("episodes", "manifest.json");
const FEED_PATH = path.resolve("episodes", "feed.xml");

// Creates the release with every asset attached (MP3 + intermediate JSON
// artifacts), then returns the download URL of the MP3 specifically — that URL
// becomes the RSS enclosure, so it must be the audio file, not whichever asset
// happens to sort first.
async function createGitHubRelease(
  tag: string,
  title: string,
  body: string,
  assetPaths: string[]
): Promise<string> {
  const { stdout } = await execFileAsync("gh", [
    "release",
    "create",
    tag,
    ...assetPaths,
    "--title", title,
    "--notes", body,
  ]);
  const releaseUrl = stdout.trim();

  const { stdout: assetJson } = await execFileAsync("gh", [
    "release",
    "view",
    tag,
    "--json", "assets",
  ]);
  const assets = JSON.parse(assetJson).assets as Array<{
    name: string;
    url: string;
  }>;
  const mp3 = assets.find((a) => a.name.endsWith(".mp3"));
  return mp3?.url || assets[0]?.url || releaseUrl;
}

function generateFeedXml(manifest: EpisodeManifest): string {
  const items = manifest.episodes
    .map(
      (ep) => `    <item>
      <title>${escapeXml(ep.title)}</title>
      <description>${escapeXml(ep.description)}</description>
      <pubDate>${new Date(ep.date).toUTCString()}</pubDate>
      <enclosure url="${escapeXml(ep.releaseUrl)}" length="${ep.fileSize}" type="audio/mpeg"/>
      <guid isPermaLink="false">${escapeXml(ep.guid)}</guid>
      <itunes:duration>${ep.duration}</itunes:duration>
      <itunes:episode>${ep.number}</itunes:episode>
      <itunes:explicit>false</itunes:explicit>
    </item>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(config.podcast.title)}</title>
    <description>${escapeXml(config.podcast.description)}</description>
    <language>${config.podcast.language}</language>
    <link>${escapeXml(config.podcast.siteUrl)}</link>
    <atom:link href="${escapeXml(config.podcast.feedUrl)}" rel="self" type="application/rss+xml"/>
    <itunes:author>${escapeXml(config.podcast.author)}</itunes:author>
    <itunes:image href="${escapeXml(config.podcast.imageUrl)}"/>
    <itunes:category text="${escapeXml(config.podcast.category)}"/>
    <itunes:explicit>${config.podcast.explicit ? "true" : "false"}</itunes:explicit>
${items}
  </channel>
</rss>
`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function run(episodeDir: string): Promise<void> {
  const mp3Path = path.join(episodeDir, "episode.mp3");
  const scriptPath = path.join(episodeDir, "04-script.json");

  if (!fileExists(mp3Path)) throw new Error("episode.mp3 not found — run audio stage first");

  const script = loadJson<EpisodeScript | null>(scriptPath, null);
  if (!script) throw new Error("04-script.json not found");

  const manifest = loadJson<EpisodeManifest>(MANIFEST_PATH, { episodes: [] });
  const tag = `episode-${script.episodeDate}`;

  const alreadyPublished = manifest.episodes.some(
    (ep) => ep.date === script.episodeDate
  );
  if (alreadyPublished) {
    console.log("Stage 06: episode already in manifest, skipping.");
    return;
  }

  console.log("Creating GitHub Release...");
  const duration = await getAudioDuration(mp3Path);
  const fileSize = fs.statSync(mp3Path).size;

  // The release is the per-episode archive: the MP3 plus every intermediate JSON
  // artifact (raw stories, analysis, fact-check, script, tagged script) and the
  // continuity recap. Git only keeps the feed, manifest, and recaps; everything
  // else is preserved here rather than committed.
  const jsonArtifacts = fs
    .readdirSync(episodeDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(episodeDir, f));
  const recapFile = recapPath(script.episodeDate);
  if (fileExists(recapFile)) jsonArtifacts.push(recapFile);
  const assetPaths = [mp3Path, ...jsonArtifacts];

  let releaseUrl: string;
  try {
    releaseUrl = await createGitHubRelease(
      tag,
      `${config.podcast.title} #${script.episodeNumber} — ${script.title}`,
      script.description,
      assetPaths
    );
  } catch (err) {
    console.warn(
      `GitHub Release creation failed: ${err}. Using placeholder URL.`
    );
    releaseUrl = `${config.podcast.siteUrl}/releases/tag/${tag}`;
  }

  const entry: EpisodeEntry = {
    number: script.episodeNumber,
    date: script.episodeDate,
    title: script.title,
    description: script.description,
    duration,
    fileSize,
    releaseUrl,
    guid: `layer-lines-weekly-${script.episodeDate}`,
  };

  manifest.episodes.unshift(entry);
  writeJson(MANIFEST_PATH, manifest);

  const feedXml = generateFeedXml(manifest);
  fs.writeFileSync(FEED_PATH, feedXml);

  console.log(
    `Stage 06: published episode #${script.episodeNumber} (${Math.round(duration / 60)} min, ${(fileSize / 1024 / 1024).toFixed(1)} MB).`
  );
}
