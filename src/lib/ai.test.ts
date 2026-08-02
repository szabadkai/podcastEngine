import assert from "node:assert/strict";
import test from "node:test";
import { setShowConfig } from "../config.js";
import type { ShowConfig } from "../show.js";
import { chat } from "./ai.js";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.OPENROUTER_API_KEY;

const testShow = {
  podcast: {
    title: "Test Show",
    siteUrl: "https://example.test",
  },
} as ShowConfig;

test.beforeEach(() => {
  setShowConfig(testShow);
  process.env.OPENROUTER_API_KEY = "test-key";
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalApiKey;
});

test("chat retries a truncated successful OpenRouter response", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      return new Response('{"choices":[', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return Response.json({
      choices: [{ message: { content: "recovered" }, finish_reason: "stop" }],
    });
  };

  const content = await chat({
    messages: [{ role: "user", content: "hello" }],
  });

  assert.equal(content, "recovered");
  assert.equal(calls, 2);
});

test("chat retries a successful response with no message choice", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return Response.json({ choices: [] });
    return Response.json({
      choices: [{ message: { content: "recovered" }, finish_reason: "stop" }],
    });
  };

  const content = await chat({
    messages: [{ role: "user", content: "hello" }],
  });

  assert.equal(content, "recovered");
  assert.equal(calls, 2);
});
