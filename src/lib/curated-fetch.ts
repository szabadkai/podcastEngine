// Fetches curated links from GitHub Issues labeled "episode-link".
// Requires GITHUB_TOKEN in env (available by default in GitHub Actions).

import { execSync } from "node:child_process";
import { config } from "../config.js";
import type { CuratedLink, RawStory } from "./types.js";

const LABEL = "episode-link";
const URL_RE = /https?:\/\/[^\s)<>"]+/;
const FETCH_TIMEOUT = 15_000;

// ---------------------------------------------------------------------------
// Repo identity — derived from git remote, cached on first call.
// ---------------------------------------------------------------------------

let _repo: string | null = null;

function getRepo(): string {
  if (_repo) return _repo;
  try {
    const url = execSync("git remote get-url origin", { encoding: "utf-8" }).trim();
    const match = url.match(/github\.com[/:]([^/]+\/[^/.]+)/);
    if (match) {
      _repo = match[1];
      return _repo;
    }
  } catch { /* ignore */ }
  throw new Error("Could not determine GitHub repo from git remote");
}

// ---------------------------------------------------------------------------
// GitHub API helpers
// ---------------------------------------------------------------------------

function ghHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) throw new Error("No GITHUB_TOKEN");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Query open GitHub Issues with the episode-link label.
 * Returns an empty array (with a warning) if the token is missing or the API fails.
 */
export async function fetchCuratedLinks(): Promise<CuratedLink[]> {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    console.log("  Curated links: GITHUB_TOKEN not set — skipping.");
    return [];
  }

  let issues: GitHubIssue[];
  try {
    const repo = getRepo();
    const res = await fetch(
      `https://api.github.com/repos/${repo}/issues?labels=${LABEL}&state=open&per_page=50`,
      { headers: ghHeaders(), signal: AbortSignal.timeout(FETCH_TIMEOUT) },
    );
    if (!res.ok) {
      console.warn(`  Curated links: GitHub API ${res.status} — skipping.`);
      return [];
    }
    issues = (await res.json()) as GitHubIssue[];
  } catch (err) {
    console.warn(`  Curated links: GitHub API error — ${(err as Error).message}`);
    return [];
  }

  const links: CuratedLink[] = [];
  for (const issue of issues) {
    const text = `${issue.title}\n${issue.body ?? ""}`;
    const urlMatch = text.match(URL_RE);
    if (!urlMatch) {
      console.warn(`  Curated links: issue #${issue.number} has no URL — skipping.`);
      continue;
    }

    // Everything in the body that isn't the URL is the editorial note.
    const bodyWithoutUrl = (issue.body ?? "")
      .replace(URL_RE, "")
      .trim();

    links.push({
      url: urlMatch[0],
      title: issue.title !== urlMatch[0] ? issue.title : undefined,
      note: bodyWithoutUrl || undefined,
      issueNumber: issue.number,
    });
  }

  return links;
}

/**
 * Fetch page metadata for a curated link and convert to a RawStory.
 */
export async function linkToStory(
  link: CuratedLink,
  fallbackDate: string,
): Promise<RawStory> {
  let html = "";
  try {
    const res = await fetch(link.url, {
      headers: { "User-Agent": `${config.podcast.title.replace(/\s+/g, "")}/1.0 (podcast news aggregator)` },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
    if (res.ok) html = await res.text();
  } catch { /* fall through to defaults */ }

  const title =
    link.title ||
    extractMeta(html, /<title[^>]*>([^<]+)<\/title>/i) ||
    link.url;

  const description =
    extractMeta(html, /<meta\s+(?:property="og:description"|name="description")\s+content="([^"]+)"/i) ||
    extractMeta(html, /<meta\s+content="([^"]+)"\s+(?:property="og:description"|name="description")/i) ||
    "";

  const published =
    extractMeta(html, /<meta\s+property="article:published_time"\s+content="([^"]+)"/i) ||
    fallbackDate;

  let snippet = description.slice(0, 500);
  if (link.note) {
    snippet += `\n\n[Editor note: ${link.note}]`;
  }

  return {
    id: `curated-${link.issueNumber}`,
    title: title.trim(),
    url: link.url,
    source: "Curated",
    sourceType: "core" as const,
    published,
    snippet,
    curated: true,
  };
}

/**
 * Close processed GitHub Issues so they don't appear in the next run.
 */
export async function closeProcessedIssues(issueNumbers: number[]): Promise<void> {
  if (issueNumbers.length === 0) return;
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) return;

  const repo = getRepo();
  for (const num of issueNumbers) {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${repo}/issues/${num}`,
        {
          method: "PATCH",
          headers: { ...ghHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            state: "closed",
            state_reason: "completed",
          }),
          signal: AbortSignal.timeout(FETCH_TIMEOUT),
        },
      );
      if (res.ok) {
        console.log(`  Closed issue #${num}.`);
      } else {
        console.warn(`  Failed to close issue #${num}: ${res.status}`);
      }
    } catch (err) {
      console.warn(`  Failed to close issue #${num}: ${(err as Error).message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractMeta(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? decodeHtmlEntities(m[1].trim()) : null;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&hellip;/g, "…")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&nbsp;/g, " ");
}
