import fs from "node:fs";
import path from "node:path";

interface CompanyProfile {
  name: string;
  website?: string;
  profileUrls?: string[];
  enabled?: boolean;
}

interface CompanyProfileQueue {
  profiles: CompanyProfile[];
}

interface CompanyProfileHistory {
  completed: Array<{
    name: string;
    date: string;
    releaseTag?: string;
    completedAt: string;
  }>;
}

interface Manifest {
  episodes: Array<{
    date: string;
    title: string;
    description: string;
  }>;
}

const QUEUE_PATH = path.resolve(
  process.env.COMPANY_PROFILE_QUEUE_PATH || "data/company-profile-queue.json",
);
const HISTORY_PATH = path.resolve(
  process.env.COMPANY_PROFILE_HISTORY_PATH || "data/company-profile-history.json",
);
const MANIFEST_PATH = path.resolve("episodes/manifest.json");

function loadJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function parseUrlInput(value: string | undefined): string[] {
  return (value || "")
    .split(/[\n,]+/)
    .map((url) => url.trim())
    .filter(Boolean);
}

function manifestMentionsCompany(manifest: Manifest, companyName: string): boolean {
  const normalized = normalizeName(companyName);
  return manifest.episodes.some((episode) => {
    const title = normalizeName(episode.title);
    const description = normalizeName(episode.description);
    // A weekly news description may mention a company without profiling it.
    // History remains the primary completion ledger; this manifest fallback
    // only recognizes the title/description patterns used by profile episodes.
    const isProfileDescription =
      description.includes("weprofile") || description.includes("companyprofile");
    return (
      isProfileDescription &&
      (title.includes(normalized) || description.includes(normalized))
    );
  });
}

function writeGitHubEnv(vars: Record<string, string>): void {
  const envPath = process.env.GITHUB_ENV;
  if (!envPath) return;

  const chunks: string[] = [];
  for (const [key, value] of Object.entries(vars)) {
    if (value.includes("\n")) {
      const delimiter = `EOF_${key}_${Date.now()}`;
      chunks.push(`${key}<<${delimiter}\n${value}\n${delimiter}`);
    } else {
      chunks.push(`${key}=${value}`);
    }
  }
  fs.appendFileSync(envPath, chunks.join("\n") + "\n");
}

function queueProfiles(): CompanyProfile[] {
  return loadJson<CompanyProfileQueue>(QUEUE_PATH, { profiles: [] }).profiles;
}

function selectProfile(): CompanyProfile | null {
  const profiles = queueProfiles();
  const history = loadJson<CompanyProfileHistory>(HISTORY_PATH, { completed: [] });
  const manifest = loadJson<Manifest>(MANIFEST_PATH, { episodes: [] });
  const completed = new Set(history.completed.map((item) => normalizeName(item.name)));

  const manualName = (process.env.MANUAL_COMPANY_NAME || "").trim();
  if (manualName) {
    const queued = profiles.find(
      (profile) => normalizeName(profile.name) === normalizeName(manualName),
    );
    const manualUrls = parseUrlInput(process.env.MANUAL_COMPANY_PROFILE_URLS);
    return {
      name: manualName,
      website: (process.env.MANUAL_COMPANY_WEBSITE || queued?.website || "").trim() || undefined,
      profileUrls: manualUrls.length > 0 ? manualUrls : queued?.profileUrls,
    };
  }

  return (
    profiles.find((profile) => {
      if (profile.enabled === false) return false;
      const key = normalizeName(profile.name);
      if (completed.has(key)) return false;
      if (manifestMentionsCompany(manifest, profile.name)) return false;
      return true;
    }) || null
  );
}

function emitSelection(profile: CompanyProfile | null): void {
  if (!profile) {
    console.log("No queued company profile selected.");
    writeGitHubEnv({
      COMPANY_PROFILE_SELECTED: "false",
    });
    return;
  }

  const profileUrls = profile.profileUrls?.join("\n") || "";
  const vars = {
    COMPANY_PROFILE_SELECTED: "true",
    SELECTED_COMPANY_NAME: profile.name,
    SELECTED_COMPANY_SLUG: slugify(profile.name),
    SELECTED_COMPANY_WEBSITE: profile.website || "",
    SELECTED_COMPANY_PROFILE_URLS: profileUrls,
  };

  console.log(`Selected company profile: ${profile.name}`);
  if (profile.website) console.log(`Website: ${profile.website}`);
  if (profileUrls) console.log(`Profile URLs: ${profile.profileUrls!.length}`);
  writeGitHubEnv(vars);
}

function markComplete(): void {
  const name = (
    process.env.COMPANY_NAME ||
    process.env.SELECTED_COMPANY_NAME ||
    process.env.MANUAL_COMPANY_NAME ||
    ""
  ).trim();
  if (!name) throw new Error("COMPANY_NAME is required to mark a profile complete");

  const date =
    (process.env.EPISODE_DATE || "").trim() ||
    new Date().toISOString().slice(0, 10);
  const releaseTag = process.env.RELEASE_TAG || `episode-${date}`;
  const history = loadJson<CompanyProfileHistory>(HISTORY_PATH, { completed: [] });
  const key = normalizeName(name);

  const existing = history.completed.find((item) => normalizeName(item.name) === key);
  if (existing) {
    existing.date = date;
    existing.releaseTag = releaseTag;
    existing.completedAt = new Date().toISOString();
  } else {
    history.completed.push({
      name,
      date,
      releaseTag,
      completedAt: new Date().toISOString(),
    });
  }

  writeJson(HISTORY_PATH, history);
  console.log(`Marked company profile complete: ${name} (${date})`);
}

if (process.argv.includes("--mark-complete")) {
  markComplete();
} else {
  emitSelection(selectProfile());
}
