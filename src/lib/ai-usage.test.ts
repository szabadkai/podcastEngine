import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordAiUsage, withAiUsage, summarizeAiUsage } from "./ai-usage.js";

test("usage survives failure and counts unsuccessful paid attempts", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-usage-"));
  try {
    await assert.rejects(withAiUsage(dir, "script", async () => {
      recordAiUsage({ model: "test", label: "draft", outcome: "invalid-json", usage: {
        cost: 0.1, prompt_tokens: 100, completion_tokens: 200,
        completion_tokens_details: { reasoning_tokens: 50 },
      } });
      recordAiUsage({ model: "test", label: "draft", outcome: "network-error" });
      throw new Error("failed");
    }), /failed/);
    const report = summarizeAiUsage(dir);
    assert.match(report, /2 \| 100 \| 200 \| 50 \| \$0.1000 \| 1/);
    assert.equal(fs.readFileSync(path.join(dir, "ai-usage-summary.md"), "utf8"), report);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
