import assert from "node:assert/strict";
import test from "node:test";
import {
  collectTranscriptReferences,
  formatTranscriptReferences,
} from "./transcript.js";
import type { FactCheckedStories, RawStory } from "./types.js";

const stories: RawStory[] = [
  {
    id: "story-1",
    title: "A useful primary source",
    url: "https://example.com/report#details",
    source: "Example Research",
    sourceType: "research",
    published: "2026-08-01T00:00:00.000Z",
    snippet: "Evidence",
  },
  {
    id: "story-2",
    title: "Tracked article title",
    url: "https://news.google.com/rss/articles/article-id?oc=5",
    source: "Publisher Name",
    sourceType: "discovery",
    published: "2026-08-01T00:00:00.000Z",
    snippet: "Evidence",
  },
];

const factChecked: FactCheckedStories = {
  episodeDate: "2026-08-01",
  clusters: [
    {
      id: "cluster-1",
      segment: "news",
      headline: "Headline",
      summary: "Summary",
      sources: [
        "https://example.com/report#details",
        "https://second.example/article",
        "https://news.google.com/rss/articles/article-id",
      ],
      significance: "Significant",
      rank: 1,
      factCheck: {
        claims: [],
        hypeFlags: [],
        missingContext: [],
        skepticalAngles: [],
      },
    },
    {
      id: "cluster-2",
      segment: "news",
      headline: "Another headline",
      summary: "Summary",
      sources: ["https://example.com/report#details", "file:///private.txt"],
      significance: "Significant",
      rank: 2,
      factCheck: {
        claims: [],
        hypeFlags: [],
        missingContext: [],
        skepticalAngles: [],
      },
    },
  ],
};

test("collects selected sources in order, deduplicates, and rejects unsafe URLs", () => {
  assert.deepEqual(collectTranscriptReferences(stories, factChecked), [
    {
      title: "A useful primary source",
      source: "Example Research",
      url: "https://example.com/report",
    },
    {
      title: "Headline",
      source: "second.example",
      url: "https://second.example/article",
    },
    {
      title: "Tracked article title",
      source: "Publisher Name",
      url: "https://news.google.com/rss/articles/article-id",
    },
  ]);
});

test("formats a readable plain-text references section", () => {
  assert.equal(
    formatTranscriptReferences([
      { title: "Source title", source: "Publisher", url: "https://example.com/" },
    ]),
    "\n\nReferences\n\n1. Source title — Publisher\n   https://example.com/",
  );
});

test("omits the section when no references are available", () => {
  assert.equal(formatTranscriptReferences([]), "");
});
