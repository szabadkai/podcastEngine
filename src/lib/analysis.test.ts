import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateAnalyzedStories } from "./analysis.js";
import { chatJson } from "./ai.js";
import { config, setShowConfig } from "../config.js";
import type { ShowConfig } from "../show.js";
import { run as factCheck } from "../03-fact-check.js";

const valid = {
  episodeDate: "2026-09-11",
  clusters: [{ id: "cluster-1", segment: "big-print", headline: "Launch",
    summary: "A new printer", significance: "Faster printing", rank: 1,
    sources: ["https://example.test/story"] }],
  skipped: [],
};

test("analysis requires usable source evidence", () => {
  assert.deepEqual(validateAnalyzedStories(valid), valid);
  for (const sources of [undefined, null, "https://example.test", [], [null], [""], ["not a URL"]]) {
    assert.throws(() => validateAnalyzedStories({ ...valid,
      clusters: [{ ...valid.clusters[0], sources }] }), /clusters\[0\]\.sources/);
  }
});

test("invalid model analysis is retried, with bounded failure", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;
  setShowConfig({ podcast: { title: "Test", siteUrl: "https://example.test" } } as ShowConfig);
  process.env.OPENROUTER_API_KEY = "test-key";
  let calls = 0;
  let recover = true;
  globalThis.fetch = async () => {
    calls++;
    const content = recover && calls > 1 ? valid : { ...valid,
      clusters: [{ ...valid.clusters[0], sources: undefined }] };
    return Response.json({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }] });
  };
  try {
    const opts = { messages: [{ role: "user" as const, content: "Analyze" }], validate: validateAnalyzedStories };
    assert.deepEqual(await chatJson(opts), valid);
    assert.equal(calls, 2);
    recover = false;
    calls = 0;
    await assert.rejects(chatJson(opts), /clusters\[0\]\.sources/);
    assert.equal(calls, config.ai.maxRetries);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  }
});

test("fact-check rejects invalid saved analysis with recovery instructions", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "analysis-test-"));
  try {
    fs.writeFileSync(path.join(dir, "02-analyzed.json"), JSON.stringify({ ...valid,
      clusters: [{ ...valid.clusters[0], sources: undefined }] }));
    await assert.rejects(factCheck(dir), /Invalid 02-analyzed.json; rerun the analyze stage.*sources/);
    assert.equal(fs.existsSync(path.join(dir, "03-fact-checked.json")), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
