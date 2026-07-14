import { config } from "../config.js";
import { fetchFeed } from "./rss-fetch.js";
import type { RawStory } from "./types.js";

const FETCH_TIMEOUT = 15_000;
const MAX_QUERY_ITEMS = 8;
const MAX_TOTAL_ITEMS = 70;
const MAX_DISCOVERED_PROFILE_PAGES = 18;
const MAX_ENRICHED_NEWS_ITEMS = 24;
const PROFILE_SNIPPET_CHARS = 2600;
const NEWS_SNIPPET_CHARS = 1500;

interface ProfileQuery {
  label: string;
  query: string;
}

interface FetchedPage {
  requestedUrl: string;
  finalUrl: string;
  host: string | null;
  html: string;
  title: string;
  description: string;
  published: string;
  readableText: string;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function googleNewsSearchUrl(query: string): string {
  const params = new URLSearchParams({
    q: query,
    hl: "en-US",
    gl: "US",
    ceid: "US:en",
  });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

function profileQueries(companyName: string): ProfileQuery[] {
  const quoted = `"${companyName}"`;
  return [
    {
      label: "company overview",
      query: `${quoted} ("3D printing" OR "additive manufacturing")`,
    },
    {
      label: "history and founders",
      query: `${quoted} (founded OR founder OR history OR origin)`,
    },
    {
      label: "leadership",
      query: `${quoted} (CEO OR founder OR leadership OR executive OR management)`,
    },
    {
      label: "products and technology",
      query: `${quoted} (printer OR material OR resin OR software OR platform OR technology)`,
    },
    {
      label: "product releases and availability",
      query: `${quoted} (launch OR launched OR release OR released OR available OR shipping OR "end of life" OR retired)`,
    },
    {
      label: "customers and market",
      query: `${quoted} (customer OR partnership OR case study OR aerospace OR medical OR dental OR industrial)`,
    },
    {
      label: "turning points",
      query: `${quoted} (funding OR acquisition OR IPO OR layoff OR lawsuit OR recall OR pivot)`,
    },
    {
      label: "strategy and future",
      query: `${quoted} (strategy OR roadmap OR expansion OR future OR investor OR annual report)`,
    },
  ];
}

function parseProfileUrls(): string[] {
  const raw = [
    process.env.COMPANY_WEBSITE,
    process.env.COMPANY_PROFILE_URLS,
    process.env.PROFILE_URLS,
  ]
    .filter(Boolean)
    .join("\n");

  return raw
    .split(/[\n,]+/)
    .map((url) => url.trim())
    .filter(Boolean);
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function dedupeStories(stories: RawStory[]): RawStory[] {
  const seen = new Set<string>();
  const result: RawStory[] = [];
  for (const story of stories) {
    const key = normalizeUrl(story.url || story.title);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(story);
  }
  return result;
}

function sortByPublishedDesc(stories: RawStory[]): RawStory[] {
  return [...stories].sort((a, b) => {
    const aTime = new Date(a.published).getTime();
    const bTime = new Date(b.published).getTime();
    const safeA = Number.isFinite(aTime) ? aTime : 0;
    const safeB = Number.isFinite(bTime) ? bTime : 0;
    return safeB - safeA;
  });
}

function prioritizeProfile(stories: RawStory[]): RawStory[] {
  const score = (story: RawStory): number => {
    let value = 0;
    if (story.sourceType === "profile") value += 100;
    if (story.curated) value += 25;
    if (/about|company|history|founder|leadership|team/i.test(story.url)) value += 12;
    if (/product|printer|material|software|technology|platform/i.test(story.url)) value += 10;
    if (/investor|press|news|case|customer|solution|industr/i.test(story.url)) value += 6;
    value += Math.min(story.snippet.length / 250, 10);
    return value;
  };

  return [...stories].sort((a, b) => {
    const scoreDiff = score(b) - score(a);
    if (scoreDiff !== 0) return scoreDiff;
    return new Date(b.published).getTime() - new Date(a.published).getTime();
  });
}

export async function fetchCompanyProfileSources(
  companyName: string,
): Promise<RawStory[]> {
  const slug = slugify(companyName);
  const stories: RawStory[] = [];

  const seedUrls = parseProfileUrls();
  if (seedUrls.length > 0) {
    console.log(`  Fetching ${seedUrls.length} seeded company URL(s)...`);
    stories.push(...(await fetchSeededProfileStories(seedUrls, companyName)));
  } else {
    console.log(
      "  No COMPANY_PROFILE_URLS supplied - profile will rely on news/search sources."
    );
  }

  const queries = profileQueries(companyName);
  console.log(`  Fetching ${queries.length} company research feed(s)...`);
  const results = await Promise.allSettled(
    queries.map((q) =>
      fetchFeed(
        googleNewsSearchUrl(q.query),
        `Google News: ${q.label}`,
        "discovery",
      ),
    ),
  );

  const newsStories: RawStory[] = [];
  for (let queryIndex = 0; queryIndex < results.length; queryIndex++) {
    const result = results[queryIndex];
    const query = queries[queryIndex];
    if (result.status === "fulfilled") {
      const items = result.value.slice(0, MAX_QUERY_ITEMS).map((story, itemIndex) => ({
        ...story,
        id: `company-profile-${slug}-q${queryIndex + 1}-${itemIndex + 1}`,
        snippet: withResearchCategory(query.label, story.snippet),
      }));
      newsStories.push(...items);
      console.log(`  ${query.label}: ${items.length} items`);
    } else {
      console.warn(`  ${query.label}: FAILED - ${result.reason}`);
    }
  }

  stories.push(...(await enrichNewsStories(newsStories, companyName)));

  const deduped = dedupeStories(stories);
  const profileCount = deduped.filter((s) => s.sourceType === "profile").length;
  const discoveryCount = deduped.filter((s) => s.sourceType === "discovery").length;
  console.log(
    `  Research packet: ${profileCount} official/profile source(s), ${discoveryCount} news/search source(s).`
  );

  return prioritizeProfile(sortByPublishedDesc(deduped)).slice(0, MAX_TOTAL_ITEMS);
}

async function fetchSeededProfileStories(
  seedUrls: string[],
  companyName: string,
): Promise<RawStory[]> {
  const fetched = new Map<string, FetchedPage>();
  const stories: RawStory[] = [];
  const discoveryCandidates = new Map<string, number>();

  for (const seedUrl of seedUrls) {
    const page = await fetchProfilePage(seedUrl);
    const key = normalizeUrl(page.finalUrl);
    fetched.set(key, page);
    stories.push(pageToProfileStory(page, companyName, `seed-${stories.length + 1}`, true));

    for (const url of discoverInternalLinks(page)) {
      discoveryCandidates.set(
        normalizeUrl(url),
        Math.max(discoveryCandidates.get(normalizeUrl(url)) ?? 0, scoreProfileUrl(url)),
      );
    }

    for (const url of await discoverSitemapUrls(page)) {
      discoveryCandidates.set(
        normalizeUrl(url),
        Math.max(discoveryCandidates.get(normalizeUrl(url)) ?? 0, scoreProfileUrl(url)),
      );
    }
  }

  const discoveredUrls = [...discoveryCandidates.entries()]
    .filter(([url, score]) => score > 0 && !fetched.has(url))
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_DISCOVERED_PROFILE_PAGES)
    .map(([url]) => url);

  if (discoveredUrls.length > 0) {
    console.log(`  Fetching ${discoveredUrls.length} discovered profile page(s)...`);
  }

  const pages = await Promise.allSettled(discoveredUrls.map((url) => fetchProfilePage(url)));
  for (const result of pages) {
    if (result.status !== "fulfilled") continue;
    const page = result.value;
    const key = normalizeUrl(page.finalUrl);
    if (fetched.has(key)) continue;
    fetched.set(key, page);
    stories.push(pageToProfileStory(page, companyName, `discovered-${stories.length + 1}`, false));
  }

  return stories;
}

async function enrichNewsStories(
  stories: RawStory[],
  companyName: string,
): Promise<RawStory[]> {
  const deduped = dedupeStories(stories);
  const enriched: RawStory[] = [];
  const toEnrich = deduped.slice(0, MAX_ENRICHED_NEWS_ITEMS);
  const rest = deduped.slice(MAX_ENRICHED_NEWS_ITEMS);

  if (toEnrich.length > 0) {
    console.log(`  Enriching ${toEnrich.length} news/search item(s) with page text...`);
  }

  const pages = await Promise.allSettled(
    toEnrich.map(async (story) => ({
      story,
      page: await fetchProfilePage(story.url),
    })),
  );

  for (const result of pages) {
    if (result.status !== "fulfilled") {
      enriched.push(toEnrich[enriched.length]);
      continue;
    }

    const { story, page } = result.value;
    if (!page.html || isGoogleNewsHost(page.finalUrl)) {
      enriched.push(story);
      continue;
    }

    const excerpt = selectExcerpt(page.readableText, companyName, NEWS_SNIPPET_CHARS);
    enriched.push({
      ...story,
      url: page.finalUrl || story.url,
      source: page.host || story.source,
      published: page.published || story.published,
      snippet: compactParts([
        story.snippet,
        page.description,
        excerpt,
      ], NEWS_SNIPPET_CHARS),
    });
  }

  return [...enriched, ...rest];
}

async function fetchProfilePage(url: string): Promise<FetchedPage> {
  let html = "";
  let finalUrl = url;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": `${config.podcast.title.replace(/\s+/g, "")}/1.0 (company profile research)`,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
    finalUrl = res.url || url;
    const contentType = res.headers.get("content-type") || "";
    if (res.ok && /html|xml|text/i.test(contentType)) {
      html = await res.text();
    }
  } catch {
    // Keep the URL as a source even if metadata fetch fails.
  }

  const title =
    extractMeta(html, /<meta\s+(?:property="og:title"|name="twitter:title")\s+content="([^"]+)"/i) ||
    extractMeta(html, /<meta\s+content="([^"]+)"\s+(?:property="og:title"|name="twitter:title")/i) ||
    extractMeta(html, /<title[^>]*>([^<]+)<\/title>/i) ||
    finalUrl;

  const description =
    extractMeta(html, /<meta\s+(?:property="og:description"|name="description")\s+content="([^"]+)"/i) ||
    extractMeta(html, /<meta\s+content="([^"]+)"\s+(?:property="og:description"|name="description")/i) ||
    "";

  const published =
    extractMeta(html, /<meta\s+property="article:published_time"\s+content="([^"]+)"/i) ||
    extractMeta(html, /<meta\s+property="og:updated_time"\s+content="([^"]+)"/i) ||
    new Date().toISOString();

  return {
    requestedUrl: url,
    finalUrl,
    host: hostname(finalUrl),
    html,
    title: title.trim(),
    description,
    published,
    readableText: extractReadableText(html),
  };
}

function pageToProfileStory(
  page: FetchedPage,
  companyName: string,
  idSuffix: string,
  curated: boolean,
): RawStory {
  const category = classifyProfileUrl(page.finalUrl);
  const excerpt = selectExcerpt(page.readableText, companyName, PROFILE_SNIPPET_CHARS);

  return {
    id: `company-profile-${idSuffix}`,
    title: page.title,
    url: page.finalUrl,
    source: page.host || "Company profile source",
    sourceType: "profile",
    published: page.published,
    snippet: compactParts(
      [
        `[Research category: ${category}]`,
        page.description,
        excerpt,
      ],
      PROFILE_SNIPPET_CHARS,
    ),
    curated,
  };
}

function discoverInternalLinks(page: FetchedPage): string[] {
  if (!page.html || !page.host) return [];
  const links = new Set<string>();
  const root = rootDomain(page.host);
  const hrefRe = /href\s*=\s*["']([^"'#]+)["']/gi;
  let match: RegExpExecArray | null;

  while ((match = hrefRe.exec(page.html))) {
    const rawHref = match[1].trim();
    if (
      !rawHref ||
      rawHref.startsWith("mailto:") ||
      rawHref.startsWith("tel:") ||
      rawHref.startsWith("javascript:")
    ) {
      continue;
    }

    try {
      const url = new URL(rawHref, page.finalUrl);
      if (!["http:", "https:"].includes(url.protocol)) continue;
      if (rootDomain(url.hostname) !== root) continue;
      if (isAssetUrl(url.pathname)) continue;
      url.hash = "";
      links.add(normalizeUrl(url.toString()));
    } catch {
      // Ignore malformed hrefs.
    }
  }

  return [...links]
    .filter((url) => scoreProfileUrl(url) > 0)
    .sort((a, b) => scoreProfileUrl(b) - scoreProfileUrl(a))
    .slice(0, MAX_DISCOVERED_PROFILE_PAGES);
}

async function discoverSitemapUrls(page: FetchedPage): Promise<string[]> {
  if (!page.host) return [];
  const origins = new Set<string>();
  try {
    origins.add(new URL(page.finalUrl).origin);
  } catch {
    return [];
  }

  const candidates = [...origins].flatMap((origin) => [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
  ]);

  const found = new Set<string>();
  const sitemapResults = await Promise.allSettled(candidates.map((url) => fetchText(url)));
  for (const result of sitemapResults) {
    if (result.status !== "fulfilled" || !result.value) continue;
    for (const loc of extractSitemapLocs(result.value).slice(0, 80)) {
      if (/\.xml(\?|$)/i.test(loc)) {
        const nested = await fetchText(loc);
        for (const nestedLoc of extractSitemapLocs(nested).slice(0, 120)) {
          if (scoreProfileUrl(nestedLoc) > 0) found.add(normalizeUrl(nestedLoc));
        }
      } else if (scoreProfileUrl(loc) > 0) {
        found.add(normalizeUrl(loc));
      }
    }
  }

  return [...found]
    .sort((a, b) => scoreProfileUrl(b) - scoreProfileUrl(a))
    .slice(0, MAX_DISCOVERED_PROFILE_PAGES);
}

async function fetchText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": `${config.podcast.title.replace(/\s+/g, "")}/1.0 (company profile research)`,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
}

function extractSitemapLocs(xml: string): string[] {
  const locs: string[] = [];
  const re = /<loc>\s*([^<]+)\s*<\/loc>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    locs.push(decodeHtmlEntities(match[1].trim()));
  }
  return locs;
}

function scoreProfileUrl(url: string): number {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 0;
  }

  const path = `${parsed.pathname} ${parsed.search}`.toLowerCase();
  if (isAssetUrl(parsed.pathname)) return 0;
  if (/privacy|terms|cookie|login|cart|checkout|support\/ticket|unsubscribe/.test(path)) return 0;

  const rules: Array<[RegExp, number]> = [
    [/about|company|who-we-are|our-story|story|history|mission/, 14],
    [/founder|leadership|management|executive|team|board|ceo/, 13],
    [/product|printer|material|resin|filament|software|platform|technology|process/, 11],
    [/launch|released|release|announcement|announc|available|shipping|eol|retir/, 11],
    [/solution|industr|customer|case-stud|application|market/, 8],
    [/investor|press|news|media|financial|annual|quarterly|sec|reports/, 7],
    [/partnership|acquisition|funding|ipo|expansion|roadmap|strategy/, 7],
    [/blog|resources|white-paper|webinar/, 4],
  ];

  return rules.reduce((sum, [re, value]) => (re.test(path) ? sum + value : sum), 0);
}

function classifyProfileUrl(url: string): string {
  const lower = url.toLowerCase();
  if (/founder|leadership|management|executive|team|board|ceo/.test(lower)) return "leadership";
  if (/about|company|who-we-are|our-story|story|history|mission/.test(lower)) return "origin/history";
  if (/product|printer|material|resin|filament|software|platform|technology|process|launch|released|release|announcement|announc|available|shipping|eol|retir/.test(lower)) return "products/technology";
  if (/solution|industr|customer|case-stud|application|market/.test(lower)) return "market/customers";
  if (/investor|press|news|media|financial|annual|quarterly|sec|reports/.test(lower)) return "strategy/turning points";
  return "company profile";
}

function withResearchCategory(label: string, snippet: string): string {
  return compactParts([`[Research category: ${label}]`, snippet], NEWS_SNIPPET_CHARS);
}

function selectExcerpt(text: string, companyName: string, maxChars: number): string {
  const clean = text.trim();
  if (!clean) return "";

  const terms = [
    companyName,
    "found",
    "founder",
    "CEO",
    "leadership",
    "printer",
    "material",
    "software",
    "technology",
    "customer",
    "market",
    "investor",
    "future",
    "strategy",
  ];

  const lower = clean.toLowerCase();
  const firstHit = terms
    .map((term) => lower.indexOf(term.toLowerCase()))
    .filter((idx) => idx >= 0)
    .sort((a, b) => a - b)[0];

  const start = firstHit === undefined ? 0 : Math.max(0, firstHit - 250);
  const excerpt = clean.slice(start, start + maxChars);
  return start > 0 ? `...${excerpt}` : excerpt;
}

function compactParts(parts: Array<string | undefined>, maxChars: number): string {
  return parts
    .map((part) => (part || "").trim())
    .filter(Boolean)
    .join("\n\n")
    .replace(/\s+\n/g, "\n")
    .slice(0, maxChars)
    .trim();
}

function hostname(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function rootDomain(host: string): string {
  const parts = host.replace(/^www\./, "").split(".");
  return parts.slice(Math.max(0, parts.length - 2)).join(".");
}

function isGoogleNewsHost(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith("news.google.com");
  } catch {
    return false;
  }
}

function isAssetUrl(pathname: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|svg|css|js|ico|zip|gz|mp3|mp4|mov|avi|woff2?|ttf)$/i.test(pathname);
}

function extractMeta(html: string, re: RegExp): string | null {
  const match = html.match(re);
  return match ? decodeHtmlEntities(match[1].trim()) : null;
}

function extractReadableText(html: string): string {
  if (!html) return "";
  return decodeHtmlEntities(
    html
      .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, " ")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/(p|div|section|article|header|footer|li|h[1-6])>/gi, ". ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .replace(/(\.\s*){2,}/g, ". ")
      .trim(),
  );
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ");
}
