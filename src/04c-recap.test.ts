import assert from "node:assert/strict";
import test from "node:test";
import { buildFallbackRecap } from "./04c-recap.js";
import type { EpisodeScript, FactCheckedStories } from "./lib/types.js";

const script: EpisodeScript = {
  episodeNumber: 16,
  episodeDate: "2026-08-07",
  title: "A Test Episode",
  description: "Test description",
  lines: [],
};

test("fallback recap preserves authoritative metadata and cluster topics", () => {
  const factChecked = {
    clusters: [
      { headline: "Printer launch" },
      { headline: "Materials research" },
      { headline: "Printer launch" },
    ],
  } as FactCheckedStories;

  assert.deepEqual(buildFallbackRecap(script, factChecked), {
    number: 16,
    date: "2026-08-07",
    title: "A Test Episode",
    topics: ["Printer launch", "Materials research"],
    threads: [],
    predictions: [],
  });
});

test("fallback recap uses the episode title without fact-check data", () => {
  assert.deepEqual(buildFallbackRecap(script, null).topics, ["A Test Episode"]);
});
