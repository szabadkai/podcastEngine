import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeXml } from "./rss-fetch.js";

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
