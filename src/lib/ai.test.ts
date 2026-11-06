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

test("chat grows the token cap when reasoning consumes the whole budget", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    if (bodies.length === 1) {
      return Response.json({
        choices: [{ message: { content: null }, finish_reason: "length" }],
      });
    }
    return Response.json({
      choices: [{ message: { content: "recovered" }, finish_reason: "stop" }],
    });
  };

  const content = await chat({
    messages: [{ role: "user", content: "distill this episode" }],
    maxTokens: 1024,
  });

  assert.equal(content, "recovered");
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].max_tokens, 1024);
  assert.equal(bodies[1].max_tokens, 2048);
});

test("JSON validation and transport failures share three total attempts", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return new Response("busy", { status: 503 });
    return Response.json({ choices: [{ message: { content: "invalid JSON" }, finish_reason: "stop" }] });
  };
  const { chatJson } = await import("./ai.js");
  await assert.rejects(chatJson({ messages: [] }), /JSON parse/);
  assert.equal(calls, 3);
});

test("truncation cannot escalate past the request ceiling", async () => {
  const limits: number[] = [];
  globalThis.fetch = async (_input, init) => {
    limits.push(JSON.parse(String(init?.body)).max_tokens);
    return Response.json({ choices: [{ message: { content: null }, finish_reason: "length" }] });
  };
  await assert.rejects(chat({ messages: [], maxTokens: 32000 }), /request ceiling/);
  assert.deepEqual(limits, [32000, 48000]);
});

test("permanent insufficient-credit errors fail without retries", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ error: { message: "can only afford 449" } }, { status: 402 });
  };
  await assert.rejects(chat({ messages: [], maxTokens: 32000 }), /402/);
  assert.equal(calls, 1);
});

test("temporary budget errors honor Retry-After before retrying", async (t) => {
  const waits: number[] = [];
  t.mock.method(globalThis, "setTimeout", (callback: () => void, delay: number) => {
    waits.push(delay);
    queueMicrotask(callback);
    return 0;
  });
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return Response.json({ error: {
      message: "in-flight requests", metadata: { headers: { "Retry-After": "120" } },
    } }, { status: 402 });
    return Response.json({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] });
  };
  assert.equal(await chat({ messages: [] }), "ok");
  assert.deepEqual(waits, [120000]);
});

test("Retry-After supports HTTP dates and invalid-value fallback", async () => {
  const { retryDelay } = await import("./ai.js");
  assert.equal(retryDelay("120", "", 0), 120000);
  assert.equal(retryDelay("invalid", "", 120000), 120000);
  const future = new Date(Date.now() + 120000).toUTCString();
  assert.ok(retryDelay(future, "", 0) > 118000);
});
