import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { chatJson } from "./lib/ai.js";
import {
  episodeContextFromMetadata,
  getEpisodeContext,
  promptPath,
} from "./lib/episode-mode.js";
import { loadJson, writeJson, fileExists } from "./lib/storage.js";
import {
  researchEvidenceForCluster,
  researchSourceUrls,
  sanitizeResearchFindings,
  selectResearchRequests,
} from "./lib/research.js";
import type {
  AnalyzedStories,
  EpisodeResearch,
  FactCheckedStories,
  FactCheckResult,
  RawStory,
} from "./lib/types.js";

const MAX_EVIDENCE_SOURCES_PER_CLUSTER = 8;
const MAX_EVIDENCE_EXCERPT_CHARS = 800;

interface FactCheckResponse {
  clusters: Array<{ id: string; factCheck: FactCheckResult }>;
}

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

function clusterSummary(analyzed: AnalyzedStories, rawStories: RawStory[]): string {
  return analyzed.clusters
    .map(
      (cluster) =>
        `### ${cluster.id}: ${cluster.headline}\nSegment: ${cluster.segment}\nSummary: ${cluster.summary}\nSignificance: ${cluster.significance}\nSources: ${cluster.sources.join(", ")}\n\nCaptured source evidence:\n${evidenceForCluster(cluster, rawStories)}`,
    )
    .join("\n\n");
}

function assembleFactChecked(
  analyzed: AnalyzedStories,
  result: FactCheckResponse,
  research?: EpisodeResearch,
): FactCheckedStories {
  return {
    episodeDate: analyzed.episodeDate,
    episodeType: analyzed.episodeType,
    companyName: analyzed.companyName,
    clusters: analyzed.clusters.map((cluster) => {
      const match = result.clusters.find((candidate) => candidate.id === cluster.id);
      const researchUrls = research
        ? researchSourceUrls(research, cluster.id)
        : [];
      return {
        ...cluster,
        sources: [...new Set([...cluster.sources, ...researchUrls])],
        factCheck: match?.factCheck || {
          claims: [],
          hypeFlags: [],
          missingContext: [],
          skepticalAngles: [],
          researchRequests: [],
        },
      };
    }),
  };
}

function reusableResearch(
  research: EpisodeResearch | null,
  requests: EpisodeResearch["requests"],
): research is EpisodeResearch {
  if (
    !research ||
    !research.completed ||
    research.requests.length !== requests.length
  ) {
    return false;
  }
  return requests.every((request, index) => {
    const saved = research.requests[index];
    return saved?.id === request.id && saved.question === request.question;
  });
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

  const renderedClusters = clusterSummary(analyzed, rawStories);
  const initialPath = path.join(episodeDir, "03-fact-check-initial.json");
  let initialFactChecked = loadJson<FactCheckedStories | null>(initialPath, null);
  if (!initialFactChecked) {
    console.log(`Running first-pass audit on ${analyzed.clusters.length} clusters...`);
    const userContent =
      episodeContext.type === "company-profile"
        ? `Company: ${episodeContext.companyName}\n\nFact-check these ${analyzed.clusters.length} company-profile clusters and identify targeted public-web research requests:\n\n${renderedClusters}\n\nReturn JSON with fact-check results for each cluster.`
        : `Fact-check these ${analyzed.clusters.length} story clusters and identify targeted public-web research requests:\n\n${renderedClusters}\n\nReturn JSON with fact-check results for each cluster.`;
    const initialResult = await chatJson<FactCheckResponse>({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature: 0.2,
      maxTokens: 24000,
    });
    initialFactChecked = assembleFactChecked(analyzed, initialResult);
    initialFactChecked.episodeType = analyzed.episodeType ?? episodeContext.type;
    initialFactChecked.companyName = analyzed.companyName ?? episodeContext.companyName;
    writeJson(initialPath, initialFactChecked);
  } else {
    console.log("Stage 03: reusing saved first-pass audit.");
  }

  const requests = selectResearchRequests(initialFactChecked);
  const researchPath = path.join(episodeDir, "03-research.json");
  let research = loadJson<EpisodeResearch | null>(researchPath, null);

  if (!reusableResearch(research, requests)) {
    research = {
      episodeDate: analyzed.episodeDate,
      episodeType: analyzed.episodeType ?? episodeContext.type,
      companyName: analyzed.companyName ?? episodeContext.companyName,
      completed: false,
      requests,
      findings: [],
    };

    if (requests.length > 0) {
      console.log(
        `Researching ${requests.length} consequential gap(s) with bounded web search...`,
      );
      const researchPrompt = fs.readFileSync(
        path.resolve("prompts", "research-gaps.md"),
        "utf-8",
      );
      const requestContext = requests.map((request) => {
        const cluster = analyzed.clusters.find(
          (candidate) => candidate.id === request.clusterId,
        );
        return {
          ...request,
          clusterSummary: cluster?.summary ?? "",
          clusterSources: cluster?.sources ?? [],
        };
      });

      try {
        const researched = await chatJson<{ findings: unknown[] }>({
          messages: [
            { role: "system", content: researchPrompt },
            {
              role: "user",
              content:
                `Episode date: ${analyzed.episodeDate}\n` +
                `Episode type: ${episodeContext.type}\n` +
                (episodeContext.companyName
                  ? `Company: ${episodeContext.companyName}\n`
                  : "") +
                `\nResearch every request below, then return the complete findings JSON.\n\n${JSON.stringify(requestContext, null, 2)}`,
            },
          ],
          temperature: 0.1,
          maxTokens: 20000,
          reasoning: { max_tokens: 5000 },
          model: config.ai.model,
          tools: [
            {
              type: "openrouter:web_search",
              parameters: {
                engine: "exa",
                max_results: 5,
                max_total_results: 30,
                search_context_size: "medium",
              },
            },
            {
              type: "openrouter:web_fetch",
              parameters: {
                engine: "openrouter",
                max_uses: 10,
                max_content_tokens: 12000,
              },
            },
          ],
          toolChoice: "required",
        });
        research.findings = sanitizeResearchFindings(
          requests,
          researched.findings,
        );
        research.completed = true;
      } catch (error) {
        research.findings = sanitizeResearchFindings(requests, []);
        research.failure = (error as Error).message;
        writeJson(researchPath, research);
        throw new Error(`Targeted research pass failed: ${(error as Error).message}`);
      }
    } else {
      research.completed = true;
    }
    writeJson(researchPath, research);
  } else {
    console.log("Stage 03: reusing saved targeted research.");
  }

  let factChecked: FactCheckedStories;
  if (requests.length === 0) {
    factChecked = initialFactChecked;
  } else {
    console.log("Running final fact-check with the targeted evidence...");
    const finalInstructions = fs.readFileSync(
      path.resolve("prompts", "fact-check-final.md"),
      "utf-8",
    );
    const finalClusterSummary = analyzed.clusters
      .map((cluster) => {
        const initial = initialFactChecked.clusters.find(
          (candidate) => candidate.id === cluster.id,
        );
        return [
          `### ${cluster.id}: ${cluster.headline}`,
          `Segment: ${cluster.segment}`,
          `Summary: ${cluster.summary}`,
          `Significance: ${cluster.significance}`,
          `Original sources: ${cluster.sources.join(", ")}`,
          `\nCaptured source evidence:\n${evidenceForCluster(cluster, rawStories)}`,
          `\nFirst-pass audit:\n${JSON.stringify(initial?.factCheck ?? {}, null, 2)}`,
          `\nTargeted follow-up evidence:\n${researchEvidenceForCluster(research, cluster.id)}`,
        ].join("\n");
      })
      .join("\n\n---\n\n");
    const finalResult = await chatJson<FactCheckResponse>({
      messages: [
        {
          role: "system",
          content: `${systemPrompt}\n\n## Final-pass instructions\n\n${finalInstructions}`,
        },
        {
          role: "user",
          content:
            (episodeContext.companyName
              ? `Company: ${episodeContext.companyName}\n\n`
              : "") +
            `Produce the final fact-check for all ${analyzed.clusters.length} clusters using both evidence rounds:\n\n${finalClusterSummary}`,
        },
      ],
      temperature: 0.1,
      maxTokens: 24000,
    });
    factChecked = assembleFactChecked(analyzed, finalResult, research);
  }

  factChecked.episodeType = analyzed.episodeType ?? episodeContext.type;
  factChecked.companyName = analyzed.companyName ?? episodeContext.companyName;
  for (const cluster of factChecked.clusters) {
    cluster.factCheck.researchRequests = [];
  }

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
    `Stage 03: ${totalClaims} claims checked, ${hypeCount} hype flags raised, ${requests.length} research gap(s) pursued.`
  );
}
