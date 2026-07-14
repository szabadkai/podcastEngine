import fs from "node:fs";
import path from "node:path";
import { chatJson } from "./lib/ai.js";
import {
  episodeContextFromMetadata,
  getEpisodeContext,
  promptPath,
} from "./lib/episode-mode.js";
import { loadJson, writeJson, fileExists } from "./lib/storage.js";
import type {
  AnalyzedStories,
  FactCheckedStories,
  FactCheckResult,
  RawStory,
} from "./lib/types.js";

const MAX_EVIDENCE_SOURCES_PER_CLUSTER = 6;
const MAX_EVIDENCE_EXCERPT_CHARS = 500;

function compactEvidence(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > MAX_EVIDENCE_EXCERPT_CHARS
    ? `${compact.slice(0, MAX_EVIDENCE_EXCERPT_CHARS - 1)}…`
    : compact;
}

// The analysis stage only retains source URLs in each cluster. Reattach the
// captured title, date, and excerpt here so the fact checker can distinguish
// an explicit launch report from a forum rumor with the same model name.
function evidenceForCluster(cluster: AnalyzedStories["clusters"][number], stories: RawStory[]): string {
  const byUrl = new Map(stories.map((story) => [story.url, story]));
  const seen = new Set<string>();
  const evidence: string[] = [];

  for (const url of cluster.sources) {
    if (seen.has(url)) continue;
    seen.add(url);
    const story = byUrl.get(url);
    if (!story) continue;
    evidence.push(
      [
        `- ${story.title}`,
        `  Source: ${story.source} (${story.sourceType}), published ${story.published}`,
        `  URL: ${story.url}`,
        story.snippet ? `  Excerpt: ${compactEvidence(story.snippet)}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    );
    if (evidence.length === MAX_EVIDENCE_SOURCES_PER_CLUSTER) break;
  }

  return evidence.length
    ? evidence.join("\n")
    : "- No captured source metadata is available for these URLs. Do not infer a release status from an unverified model name.";
}

export async function run(episodeDir: string): Promise<void> {
  const outputPath = path.join(episodeDir, "03-fact-checked.json");
  if (fileExists(outputPath)) {
    console.log("Stage 03: output already exists, skipping.");
    return;
  }

  const inputPath = path.join(episodeDir, "02-analyzed.json");
  const analyzed = loadJson<AnalyzedStories | null>(inputPath, null);
  if (!analyzed) throw new Error("No analyzed stories found in 02-analyzed.json");
  const rawStories = loadJson<RawStory[]>(
    path.join(episodeDir, "01-raw-stories.json"),
    []
  );

  const episodeContext = episodeContextFromMetadata(analyzed) ?? getEpisodeContext();
  const systemPrompt = fs.readFileSync(
    promptPath("fact-check", episodeContext),
    "utf-8"
  );

  const clusterSummary = analyzed.clusters
    .map(
      (c) =>
        `### ${c.id}: ${c.headline}\nSegment: ${c.segment}\nSummary: ${c.summary}\nSignificance: ${c.significance}\nSources: ${c.sources.join(", ")}\n\nCaptured source evidence:\n${evidenceForCluster(c, rawStories)}`
    )
    .join("\n\n");

  console.log(`Fact-checking ${analyzed.clusters.length} clusters...`);
  const userContent =
    episodeContext.type === "company-profile"
      ? `Company: ${episodeContext.companyName}\n\nFact-check these ${analyzed.clusters.length} company-profile clusters:\n\n${clusterSummary}\n\nReturn JSON with fact-check results for each cluster.`
      : `Fact-check these ${analyzed.clusters.length} story clusters:\n\n${clusterSummary}\n\nReturn JSON with fact-check results for each cluster.`;

  const result = await chatJson<{
    clusters: Array<{ id: string; factCheck: FactCheckResult }>;
  }>({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    temperature: 0.2,
    // Headroom for the reasoning model's trace + the JSON answer (see analyze).
    // Scales with cluster count, which is now 7-10 per episode.
    maxTokens: 24000,
  });

  const factChecked: FactCheckedStories = {
    episodeDate: analyzed.episodeDate,
    episodeType: analyzed.episodeType ?? episodeContext.type,
    companyName: analyzed.companyName ?? episodeContext.companyName,
    clusters: analyzed.clusters.map((cluster) => {
      const fc = result.clusters.find((r) => r.id === cluster.id);
      return {
        ...cluster,
        factCheck: fc?.factCheck || {
          claims: [],
          hypeFlags: [],
          missingContext: [],
          skepticalAngles: [],
        },
      };
    }),
  };

  writeJson(outputPath, factChecked);

  const totalClaims = factChecked.clusters.reduce(
    (sum, c) => sum + c.factCheck.claims.length,
    0
  );
  const hypeCount = factChecked.clusters.reduce(
    (sum, c) => sum + c.factCheck.hypeFlags.length,
    0
  );
  console.log(
    `Stage 03: ${totalClaims} claims checked, ${hypeCount} hype flags raised.`
  );
}
