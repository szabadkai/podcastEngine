import assert from "node:assert/strict";
import test from "node:test";
import { findLaunchedProductContradictions } from "./04-script.js";
import type { EpisodeScript, FactCheckedStories } from "./lib/types.js";

const factChecked = {
  clusters: [
    {
      factCheck: {
        productStatuses: [
          { product: "Factor 4", status: "launched", evidence: "launch source" },
          { product: "Factor 4 Plus", status: "launched", evidence: "launch source" },
        ],
      },
    },
  ],
} as FactCheckedStories;

function script(text: string): EpisodeScript {
  return { lines: [{ speaker: "alex", text }] } as EpisodeScript;
}

test("does not treat contrast language in the preceding sentence as a contradiction", () => {
  const result = findLaunchedProductContradictions(
    script(
      "Confirmed versus speculative, then. Confirmed: Factor 4 Plus shipping into industrial and defense positioning."
    ),
    factChecked
  );

  assert.deepEqual(result, []);
});

test("does not report a shorter product name contained in a longer product name", () => {
  const result = findLaunchedProductContradictions(
    script("Factor 4 Plus is speculative."),
    factChecked
  );

  assert.equal(result.length, 1);
  assert.match(result[0], /^Factor 4 Plus is documented as launched/);
});

test("still blocks a direct launched-product contradiction", () => {
  const result = findLaunchedProductContradictions(
    script("Factor 4 is not yet shipping."),
    factChecked
  );

  assert.equal(result.length, 1);
  assert.match(result[0], /^Factor 4 is documented as launched/);
});

test("advisory style warnings do not trigger a second paid generation", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { loadShow } = await import("./show.js");
  const { setShowConfig } = await import("./config.js");
  const { run } = await import("./04-script.js");
  setShowConfig(await loadShow());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "script-advisory-"));
  const savedFetch = globalThis.fetch;
  const savedKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  try {
    fs.writeFileSync(path.join(dir, "03-fact-checked.json"), JSON.stringify({
      episodeDate: "2026-11-06", episodeType: "news", clusters: [],
    }));
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
        title: "Test episode", description: "A test episode",
        lines: Array.from({ length: 90 }, (_, i) => ({
          speaker: i % 2 ? "alex" : "jordan", segment: "opening",
          text: Array.from({ length: 40 }, (_, j) => `detail${i}x${j}`).join(" "),
        })),
      }) } }] });
    };
    await run(dir);
    assert.equal(calls, 1);
    const report = JSON.parse(fs.readFileSync(path.join(dir, "04-script-quality.json"), "utf8"));
    assert.equal(report.revisionAttempted, false);
    assert.ok(report.warnings.length >= 2);
    assert.deepEqual(report.blockingIssues, []);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = savedKey;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
