import type {
  EpisodeResearch,
  EpisodeResearchRequest,
  FactCheckedStories,
  ResearchFinding,
  ResearchSource,
} from "./types.js";

export const MAX_PROFILE_RESEARCH_GAPS = 10;
export const MAX_NEWS_RESEARCH_GAPS = 6;

function normalizedQuestion(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

export function selectResearchRequests(
  factChecked: FactCheckedStories,
): EpisodeResearchRequest[] {
  const limit =
    factChecked.episodeType === "company-profile"
      ? MAX_PROFILE_RESEARCH_GAPS
      : MAX_NEWS_RESEARCH_GAPS;
  const candidates = factChecked.clusters.flatMap((cluster) => {
    const rawRequests = Array.isArray(cluster.factCheck.researchRequests)
      ? cluster.factCheck.researchRequests
      : [];
    return rawRequests
      .filter(
        (request) =>
          request &&
          request.publicAnswerLikely &&
          typeof request.question === "string" &&
          request.question.trim() &&
          typeof request.query === "string" &&
          request.query.trim() &&
          (request.priority === "critical" || request.priority === "useful"),
      )
      .map((request, index) => ({
        ...request,
        id: `${cluster.id}-gap-${index + 1}`,
        clusterId: cluster.id,
        clusterHeadline: cluster.headline,
      }));
  });

  const priorityOrder = { critical: 0, useful: 1 } as const;
  candidates.sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority],
  );

  const seen = new Set<string>();
  const selected: EpisodeResearchRequest[] = [];
  for (const request of candidates) {
    const key = normalizedQuestion(request.question);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    selected.push(request);
    if (selected.length === limit) break;
  }
  return selected;
}

function cleanText(value: unknown, maxChars: number): string {
  if (typeof value !== "string") return "";
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.slice(0, maxChars);
}

function sanitizeSource(value: unknown): ResearchSource | null {
  if (typeof value === "string") {
    const url = safeHttpUrl(value);
    if (!url) return null;
    const publisher = new URL(url).hostname.replace(/^www\./, "");
    return {
      url,
      title: publisher,
      publisher,
      sourceClass: "independent",
      evidence: "",
    };
  }
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<ResearchSource>;
  const url = safeHttpUrl(typeof source.url === "string" ? source.url : "");
  if (!url) return null;
  const validClasses = new Set(["primary", "independent", "community"]);
  return {
    url,
    title: cleanText(source.title, 300) || new URL(url).hostname,
    publisher: cleanText(source.publisher, 160) || new URL(url).hostname,
    sourceClass: validClasses.has(source.sourceClass ?? "")
      ? source.sourceClass!
      : "independent",
    evidence: cleanText(source.evidence, 900),
  };
}

export function sanitizeResearchFindings(
  requests: EpisodeResearchRequest[],
  values: unknown,
): ResearchFinding[] {
  const requestById = new Map(requests.map((request) => [request.id, request]));
  const raw = Array.isArray(values) ? values : [];
  const validStatuses = new Set([
    "resolved",
    "partially-resolved",
    "not-found",
    "not-public",
  ]);
  const byRequest = new Map<string, ResearchFinding>();

  for (const value of raw) {
    if (!value || typeof value !== "object") continue;
    const finding = value as Partial<ResearchFinding>;
    const request = requestById.get(finding.requestId ?? "");
    if (!request || byRequest.has(request.id)) continue;
    const status = validStatuses.has(finding.status ?? "")
      ? finding.status!
      : "not-found";
    const seenUrls = new Set<string>();
    const sources = (Array.isArray(finding.sources) ? finding.sources : [])
      .map(sanitizeSource)
      .filter((source): source is ResearchSource => {
        if (!source || seenUrls.has(source.url)) return false;
        seenUrls.add(source.url);
        return true;
      })
      .slice(0, 3);

    // A model summary without a usable URL is not evidence. Preserve the note,
    // but never let it enter the final fact-check as a resolved finding.
    const evidenceStatus =
      sources.length === 0 && (status === "resolved" || status === "partially-resolved")
        ? "not-found"
        : status;
    byRequest.set(request.id, {
      requestId: request.id,
      clusterId: request.clusterId,
      question: request.question,
      status: evidenceStatus,
      answer: cleanText(finding.answer, 1500),
      sources,
      residualUncertainty: cleanText(finding.residualUncertainty, 900),
    });
  }

  return requests.map(
    (request) =>
      byRequest.get(request.id) ?? {
        requestId: request.id,
        clusterId: request.clusterId,
        question: request.question,
        status: "not-found",
        answer: "No research finding was returned.",
        sources: [],
        residualUncertainty: "The targeted research pass returned no usable evidence.",
      },
  );
}

export function researchEvidenceForCluster(
  research: EpisodeResearch,
  clusterId: string,
): string {
  const findings = research.findings.filter(
    (finding) => finding.clusterId === clusterId,
  );
  if (findings.length === 0) return "- No targeted follow-up was requested for this cluster.";

  return findings
    .map((finding) => {
      const sources = finding.sources.length
        ? finding.sources
            .map(
              (source) =>
                `  - ${source.title} — ${source.publisher} [${source.sourceClass}]\n` +
                `    URL: ${source.url}\n` +
                `    Evidence: ${source.evidence || "No extract was returned; use cautiously."}`,
            )
            .join("\n")
        : "  - No usable public source found.";
      return [
        `Question: ${finding.question}`,
        `Status: ${finding.status}`,
        `Answer: ${finding.answer || "No supported answer found."}`,
        `Residual uncertainty: ${finding.residualUncertainty || "None stated."}`,
        "Sources:",
        sources,
      ].join("\n");
    })
    .join("\n\n");
}

export function researchSourceUrls(
  research: EpisodeResearch,
  clusterId: string,
): string[] {
  return [
    ...new Set(
      research.findings
        .filter(
          (finding) =>
            finding.clusterId === clusterId &&
            (finding.status === "resolved" ||
              finding.status === "partially-resolved"),
        )
        .flatMap((finding) => finding.sources.map((source) => source.url)),
    ),
  ];
}

export function supportedAndUnsupportedClaims(
  factChecked: FactCheckedStories["clusters"][number]["factCheck"],
) {
  return {
    supported: factChecked.claims.filter(
      (claim) => claim.rating !== "unverifiable",
    ),
    unsupported: factChecked.claims.filter(
      (claim) => claim.rating === "unverifiable",
    ),
  };
}
