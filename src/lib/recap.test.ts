import assert from "node:assert/strict";
import test from "node:test";
import { buildMechanicalRecap } from "./recap.js";
import type { EpisodeScript, FactCheckedStories } from "./types.js";

const script: EpisodeScript = {
  episodeNumber: 12,
  episodeDate: "2026-08-13",
  title: "A practical week",
  description: "Description",
  lines: [],
};

test("builds bounded continuity metadata from fact-checked clusters", () => {
  const factChecked: FactCheckedStories = {
    episodeDate: script.episodeDate,
    clusters: [
      {
        id: "one",
        segment: "big-print",
        headline: "Confirmed launch",
        summary: "Summary",
        sources: [],
        significance: "Why",
        rank: 1,
        factCheck: {
          claims: [{ claim: "Launched", rating: "verified", note: "Source" }],
          hypeFlags: [],
          missingContext: [],
          skepticalAngles: [],
        },
      },
      {
        id: "two",
        segment: "hype-signal",
        headline: "Unproven speed claim",
        summary: "Summary",
        sources: [],
        significance: "Why",
        rank: 2,
        factCheck: {
          claims: [{ claim: "Ten times faster", rating: "dubious", note: "No method" }],
          hypeFlags: ["No test method"],
          missingContext: [],
          skepticalAngles: [],
        },
      },
    ],
  };

  const recap = buildMechanicalRecap(script, factChecked);
  assert.deepEqual(recap.topics, ["Confirmed launch", "Unproven speed claim"]);
  assert.deepEqual(recap.threads, ["Unproven speed claim"]);
  assert.deepEqual(recap.predictions, []);
});

test("falls back to script title when no fact-check artifact exists", () => {
  assert.deepEqual(buildMechanicalRecap(script, null).topics, [script.title]);
});
