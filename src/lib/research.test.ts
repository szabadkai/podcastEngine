import assert from "node:assert/strict";
import test from "node:test";
import {
  researchEvidenceForCluster,
  mergeResearchedFactChecks,
  sanitizeResearchFindings,
  selectResearchRequests,
  supportedAndUnsupportedClaims,
} from "./research.js";
import type {
  EpisodeResearch,
  FactCheckedStories,
  FactCheckResult,
} from "./types.js";

function factCheckedWithRequests(): FactCheckedStories {
  return {
    episodeDate: "2026-08-12",
    episodeType: "company-profile",
    companyName: "Example AM",
    clusters: [
      {
        id: "cluster-1",
        segment: "origin-story",
        headline: "How it started",
        summary: "An origin summary.",
        sources: ["https://example.com/about"],
        significance: "Foundational context.",
        rank: 1,
        factCheck: {
          claims: [], hypeFlags: [], missingContext: [], skepticalAngles: [],
          researchRequests: [
            {
              question: "When was Example AM founded?",
              reason: "The profile needs an origin date.",
              priority: "critical",
              query: '"Example AM" founded',
              preferredSources: ["Official company history"],
              publicAnswerLikely: true,
            },
            {
              question: "What are its private monthly financials?",
              reason: "Would show momentum.",
              priority: "useful",
              query: '"Example AM" monthly revenue',
              preferredSources: ["Financial filing"],
              publicAnswerLikely: false,
            },
          ],
        },
      },
      {
        id: "cluster-2",
        segment: "leadership",
        headline: "Leadership",
        summary: "A leadership summary.",
        sources: [],
        significance: "Who makes decisions.",
        rank: 2,
        factCheck: {
          claims: [], hypeFlags: [], missingContext: [], skepticalAngles: [],
          researchRequests: [
            {
              question: "When was Example AM founded?",
              reason: "Duplicate question from another cluster.",
              priority: "useful",
              query: '"Example AM" company history',
              preferredSources: ["Independent profile"],
              publicAnswerLikely: true,
            },
          ],
        },
      },
    ],
  };
}

test("selects public, consequential research gaps and deduplicates questions", () => {
  const requests = selectResearchRequests(factCheckedWithRequests());
  assert.equal(requests.length, 1);
  assert.equal(requests[0].id, "cluster-1-gap-1");
  assert.equal(requests[0].priority, "critical");
});

test("does not spend the automatic research pass on useful-only gaps", () => {
  const factChecked = factCheckedWithRequests();
  factChecked.clusters[0].factCheck.researchRequests = [
    {
      question: "Which conference mentioned Example AM?",
      reason: "Extra color only.",
      priority: "useful",
      query: '"Example AM" conference',
      preferredSources: ["Conference program"],
      publicAnswerLikely: true,
    },
  ];
  factChecked.clusters[1].factCheck.researchRequests = [];
  assert.deepEqual(selectResearchRequests(factChecked), []);
});

test("downgrades unsupported model answers and sanitizes cited findings", () => {
  const requests = selectResearchRequests(factCheckedWithRequests());
  const [withoutSource] = sanitizeResearchFindings(requests, [
    { requestId: requests[0].id, status: "resolved", answer: "It was founded in 2020.", sources: [] },
  ]);
  assert.equal(withoutSource.status, "not-found");

  const [cited] = sanitizeResearchFindings(requests, [
    {
      requestId: requests[0].id,
      status: "resolved",
      answer: "It was founded in 2020.",
      sources: [
        {
          url: "https://example.com/history#start",
          title: "Our history",
          publisher: "Example AM",
          sourceClass: "primary",
          evidence: "The history page identifies 2020 as the founding year.",
        },
        "https://independent.example/profile",
        { url: "file:///private", title: "Unsafe" },
      ],
      residualUncertainty: "",
    },
  ]);
  assert.equal(cited.status, "resolved");
  assert.deepEqual(cited.sources.map((source) => source.url), [
    "https://example.com/history",
    "https://independent.example/profile",
  ]);
});

test("renders bounded source evidence for the final fact-check", () => {
  const requests = selectResearchRequests(factCheckedWithRequests());
  const findings = sanitizeResearchFindings(requests, [
    {
      requestId: requests[0].id,
      status: "resolved",
      answer: "It was founded in 2020.",
      sources: [{
        url: "https://example.com/history",
        title: "Our history",
        publisher: "Example AM",
        sourceClass: "primary",
        evidence: "The page gives a 2020 founding date.",
      }],
      residualUncertainty: "",
    },
  ]);
  const research: EpisodeResearch = {
    episodeDate: "2026-08-12",
    episodeType: "company-profile",
    companyName: "Example AM",
    completed: true,
    requests,
    findings,
  };
  const rendered = researchEvidenceForCluster(research, "cluster-1");
  assert.match(rendered, /Status: resolved/);
  assert.match(rendered, /https:\/\/example\.com\/history/);
  assert.match(rendered, /2020 founding date/);
});

test("separates unverifiable claims from the on-air claim set", () => {
  const factCheck: FactCheckResult = {
    claims: [
      { claim: "Supported", rating: "verified", note: "Two sources." },
      { claim: "Unknown", rating: "unverifiable", note: "No evidence." },
      { claim: "Overclaim", rating: "dubious", note: "Contradicted." },
    ],
    hypeFlags: [], missingContext: [], skepticalAngles: [],
  };
  const split = supportedAndUnsupportedClaims(factCheck);
  assert.deepEqual(split.supported.map((claim) => claim.claim), ["Supported", "Overclaim"]);
  assert.deepEqual(split.unsupported.map((claim) => claim.claim), ["Unknown"]);
});

test("merges researched cluster patches without regenerating untouched clusters", () => {
  const initial = factCheckedWithRequests();
  const requests = selectResearchRequests(initial);
  const research: EpisodeResearch = {
    episodeDate: initial.episodeDate,
    episodeType: "company-profile",
    completed: true,
    requests,
    findings: [
      {
        requestId: requests[0].id,
        clusterId: "cluster-1",
        question: requests[0].question,
        status: "resolved",
        answer: "Founded in 2020.",
        sources: [
          {
            url: "https://example.com/history",
            title: "History",
            publisher: "Example AM",
            sourceClass: "primary",
            evidence: "Gives the founding year.",
          },
        ],
        residualUncertainty: "",
      },
    ],
  };
  const updatedFactCheck: FactCheckResult = {
    claims: [{ claim: "Founded in 2020", rating: "verified", note: "Primary source" }],
    hypeFlags: [],
    missingContext: [],
    skepticalAngles: [],
  };

  const merged = mergeResearchedFactChecks(
    initial,
    [{ id: "cluster-1", factCheck: updatedFactCheck }],
    research,
  );
  assert.equal(merged.clusters[0].factCheck, updatedFactCheck);
  assert.deepEqual(merged.clusters[0].sources, [
    "https://example.com/about",
    "https://example.com/history",
  ]);
  assert.equal(merged.clusters[1].factCheck, initial.clusters[1].factCheck);
});
