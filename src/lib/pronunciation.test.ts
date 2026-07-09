import assert from "node:assert/strict";
import test from "node:test";
import { normalizeForTTS } from "./pronunciation.js";

test("spells out large dollar prices for TTS", () => {
  assert.equal(
    normalizeForTTS("The Fuse X1 costs $84,999."),
    "The Fuse X1 costs eighty-four thousand nine hundred ninety-nine dollars."
  );
  assert.equal(
    normalizeForTTS("They just launched an $84,999 machine."),
    "They just launched an eighty-four thousand nine hundred ninety-nine dollar machine."
  );
});

test("normalizes compact monetary values and percentages", () => {
  assert.equal(
    normalizeForTTS("They raised $42.5M and cut emissions by 90%."),
    "They raised forty-two point five million dollars and cut emissions by ninety percent."
  );
});
