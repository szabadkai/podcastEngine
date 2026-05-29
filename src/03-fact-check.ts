import fs from "node:fs";
import path from "node:path";
import { chatJson } from "./lib/ai.js";
import { loadJson, writeJson, fileExists } from "./lib/storage.js";
import type {
  AnalyzedStories,
  FactCheckedStories,
  FactCheckResult,
} from "./lib/types.js";

export async function run(episodeDir: string): Promise<void> {
  const outputPath = path.join(episodeDir, "03-fact-checked.json");
  if (fileExists(outputPath)) {
    console.log("Stage 03: output already exists, skipping.");
    return;
  }

  const inputPath = path.join(episodeDir, "02-analyzed.json");
  const analyzed = loadJson<AnalyzedStories | null>(inputPath, null);
  if (!analyzed) throw new Error("No analyzed stories found in 02-analyzed.json");

  const systemPrompt = fs.readFileSync(
    path.resolve("prompts", "fact-check.md"),
    "utf-8"
  );

  const clusterSummary = analyzed.clusters
    .map(
      (c) =>
        `### ${c.id}: ${c.headline}\nSegment: ${c.segment}\nSummary: ${c.summary}\nSignificance: ${c.significance}\nSources: ${c.sources.join(", ")}`
    )
    .join("\n\n");

  console.log(`Fact-checking ${analyzed.clusters.length} clusters...`);

  const result = await chatJson<{
    clusters: Array<{ id: string; factCheck: FactCheckResult }>;
  }>({
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Fact-check these ${analyzed.clusters.length} story clusters:\n\n${clusterSummary}\n\nReturn JSON with fact-check results for each cluster.`,
      },
    ],
    temperature: 0.2,
    // Headroom for the reasoning model's trace + the JSON answer (see analyze).
    maxTokens: 16384,
  });

  const factChecked: FactCheckedStories = {
    episodeDate: analyzed.episodeDate,
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
