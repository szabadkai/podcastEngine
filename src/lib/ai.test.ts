import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

test("chat records provider token usage for each billed attempt", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "podcast-ai-usage-"));
  const usagePath = path.join(tempDir, "token-usage.jsonl");
  let requestBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return Response.json({
      choices: [{ message: { content: "measured" }, finish_reason: "stop" }],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 3,
        total_tokens: 15,
        cost: 0.001,
      },
    });
  };

  try {
    await chat({
      messages: [{ role: "user", content: "measure me" }],
      telemetry: { label: "test-call", filePath: usagePath },
    });
    const entries = fs
      .readFileSync(usagePath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].label, "test-call");
    assert.equal(entries[0].outcome, "success");
    assert.equal(entries[0].usage.total_tokens, 15);
    assert.equal(entries[0].usage.cost, 0.001);
    assert.ok(requestBody);
    assert.deepEqual(
      (requestBody as Record<string, unknown>)["usage"],
      { include: true },
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
