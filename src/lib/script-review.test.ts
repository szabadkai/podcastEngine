import assert from "node:assert/strict";
import test from "node:test";
import {
  materialScriptReviewReasons,
  normalizeScriptReview,
} from "./script-review.js";

test("material findings trigger revision even when the raw decision says approve", () => {
  const review = normalizeScriptReview(
    {
      decision: "approve",
      issues: [
        {
          severity: "material",
          category: "host-voice",
          lineIndexes: [4, 4, 5, 999],
          problem: "The hosts sound interchangeable.",
          revisionInstruction: "Give Alex the mechanism and Jordan the practical consequence.",
        },
      ],
    },
    20,
  );

  assert.equal(review.decision, "revise");
  assert.deepEqual(review.issues[0].lineIndexes, [4, 5]);
  assert.equal(materialScriptReviewReasons(review).length, 1);
});

test("advisory-only feedback does not trigger a rewrite", () => {
  const review = normalizeScriptReview(
    {
      decision: "revise",
      issues: [
        {
          severity: "advisory",
          category: "tone",
          lineIndexes: [2],
          problem: "One aside could be drier.",
          revisionInstruction: "Consider trimming the setup.",
        },
      ],
    },
    10,
  );

  assert.equal(review.decision, "approve");
  assert.equal(materialScriptReviewReasons(review).length, 0);
});

test("rejects a structurally invalid reviewer response", () => {
  assert.throws(
    () => normalizeScriptReview({ decision: "approve" }, 10),
    /issues must be an array/,
  );
});
