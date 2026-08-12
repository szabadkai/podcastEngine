import assert from "node:assert/strict";
import test from "node:test";
import {
  extractFeedSnippet,
  extractPublishedDate,
  filterFeedStories,
  sanitizeXml,
} from "./rss-fetch.js";
import type { RawStory } from "./types.js";

test("removes XML 1.0 illegal literal characters", () => {
  assert.equal(sanitizeXml("Valid\u0000 text\u001f."), "Valid text.");
});

test("removes XML 1.0 illegal numeric entities", () => {
  assert.equal(
    sanitizeXml("<title>Good&#x1; title&#0;</title>"),
    "<title>Good title</title>",
  );
});

test("keeps valid XML whitespace and entities", () => {
  assert.equal(
    sanitizeXml("<title>One\tTwo&#10;Three&#x20;</title>"),
    "<title>One\tTwo&#10;Three&#x20;</title>",
  );
});

test("normalizes lowercase RSS date tags", () => {
  assert.equal(
    sanitizeXml("<lastbuilddate>x</lastbuilddate><pubdate>y</pubdate>"),
    "<lastBuildDate>x</lastBuildDate><pubDate>y</pubDate>",
  );
});

test("extracts ScienceDirect publication dates from descriptions", () => {
  assert.equal(
    extractPublishedDate(
      {
        content:
          "<p>Publication date: Available online 18 July 2026</p><p>Source: Additive Manufacturing</p>",
      },
      "2026-07-19T00:00:00.000Z",
    ),
    "2026-07-18T00:00:00.000Z",
  );
});

test("uses YouTube media descriptions when standard summaries are absent", () => {
  assert.equal(
    extractFeedSnippet({
      mediaGroup: {
        "media:description": [
          "A pressure vessel printed with directed energy deposition. https://example.com",
        ],
      },
    }),
    "A pressure vessel printed with directed energy deposition.",
  );
});

test("filters broad feeds and removes nightly posts", () => {
  const stories: RawStory[] = [
    {
      id: "1",
      title: "OrcaSlicer Nightly Builds",
      url: "https://example.com/1",
      source: "test",
      sourceType: "maker",
      published: "2026-07-19T00:00:00.000Z",
      snippet: "Nightly build release",
    },
    {
      id: "2",
      title: "OrcaSlicer 2.4 official release",
      url: "https://example.com/2",
      source: "test",
      sourceType: "maker",
      published: "2026-07-18T00:00:00.000Z",
      snippet: "Stable release with useful fixes",
    },
  ];

  assert.deepEqual(
    filterFeedStories(stories, {
      include: ["release"],
      excludeTitle: ["nightly"],
    }).map((story) => story.id),
    ["2"],
  );
});
