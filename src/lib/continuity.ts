import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config.js";
import { getSpeakerLabel } from "../show.js";
import { loadJson, fileExists } from "./storage.js";
import type { EpisodeRecap, EpisodeScript, FactCheckedStories } from "./types.js";

const execFileAsync = promisify(execFile);

const BASE_STOPWORDS = [
  "the", "a", "an", "and", "or", "of", "for", "to", "in", "on", "with", "at",
  "by", "from", "as", "is", "are", "be", "new", "first", "more", "its", "into",
];

function getStopwords(): Set<string> {
  return new Set([...BASE_STOPWORDS, ...config.continuityStopwords]);
}

function tokenize(text: string): Set<string> {
  const stopwords = getStopwords();
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopwords.has(w))
  );
}

// Significant tokens drawn from a recap's topics + threads (what the episode was about).
function recapTokens(recap: EpisodeRecap): Set<string> {
  return tokenize([...recap.topics, ...recap.threads].join(" "));
}

// Significant tokens for this week's episode, from cluster headlines + summaries.
function currentTokens(factChecked: FactCheckedStories): Set<string> {
  return tokenize(
    factChecked.clusters.map((c) => `${c.headline} ${c.summary}`).join(" ")
  );
}

function overlapCount(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

export interface RecapMatch {
  recap: EpisodeRecap;
  score: number;
  sharedTerms: string[];
}

// Picks the single recent recap whose topics/threads overlap most strongly with
// this week's stories, provided it clears `minShared` significant shared terms.
// Returns null when nothing is a genuine match — the common case, since callbacks
// are meant to be rare.
export function findBestRecapMatch(
  recaps: EpisodeRecap[],
  factChecked: FactCheckedStories,
  minShared = 2
): RecapMatch | null {
  const current = currentTokens(factChecked);
  let best: RecapMatch | null = null;
  for (const recap of recaps) {
    const rt = recapTokens(recap);
    const shared: string[] = [];
    for (const t of rt) if (current.has(t)) shared.push(t);
    const score = shared.length;
    if (score >= minShared && (!best || score > best.score)) {
      best = { recap, score, sharedTerms: shared };
    }
  }
  return best;
}

// Retrieves the full transcript (04-script.json) for a past episode by date.
// Prefers a local copy (present during local/dry-run development); otherwise
// downloads it from that episode's GitHub Release, where it lives as an asset
// after our move of episode working dirs out of git. Returns null if neither
// source is available, so continuity degrades gracefully to recap-only.
export async function getPastTranscript(
  episodeDate: string
): Promise<EpisodeScript | null> {
  const localPath = path.resolve("episodes", episodeDate, "04-script.json");
  if (fileExists(localPath)) {
    return loadJson<EpisodeScript | null>(localPath, null);
  }

  const tag = `episode-${episodeDate}`;
  const slug = config.podcast.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `${slug}-transcript-`));
  try {
    await execFileAsync("gh", [
      "release",
      "download",
      tag,
      "--pattern",
      "04-script.json",
      "--dir",
      tmpDir,
    ]);
    const downloaded = path.join(tmpDir, "04-script.json");
    return fileExists(downloaded)
      ? loadJson<EpisodeScript | null>(downloaded, null)
      : null;
  } catch {
    return null;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Flattens an episode's dialogue into plain "Speaker: text" lines for embedding
// in the script prompt as source-of-truth for an accurate callback.
export function transcriptToDialogue(script: EpisodeScript): string {
  return script.lines
    .map((l) => `${getSpeakerLabel(l.speaker)}: ${l.text}`)
    .join("\n");
}
