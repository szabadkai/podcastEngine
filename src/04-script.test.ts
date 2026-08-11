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
