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

test("chat retries a credit-limited request within the affordable token budget", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    if (bodies.length === 1) {
      return new Response(
        JSON.stringify({
          error: {
            message:
              "This request requires more credits, or fewer max_tokens. You requested up to 32000 tokens, but can only afford 15001.",
            code: 402,
          },
        }),
        { status: 402, headers: { "content-type": "application/json" } },
      );
    }
    return Response.json({
      choices: [{ message: { content: "recovered" }, finish_reason: "stop" }],
    });
  };

  const content = await chat({
    messages: [{ role: "user", content: "write a full episode" }],
    maxTokens: 32000,
    reasoning: { max_tokens: 8000 },
  });

  assert.equal(content, "recovered");
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].max_tokens, 32000);
  assert.deepEqual(bodies[0].reasoning, { max_tokens: 8000 });
  assert.equal(bodies[1].max_tokens, 14700);
  assert.deepEqual(bodies[1].reasoning, { max_tokens: 3675 });
});
