import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";

const context = new AsyncLocalStorage<{ dir: string; stage: string }>();

export function recordAiUsage(details: Record<string, unknown>): void {
  const current = context.getStore();
  if (!current) return;
  try {
    fs.mkdirSync(current.dir, { recursive: true });
    fs.appendFileSync(path.join(current.dir, "ai-usage.jsonl"), JSON.stringify({
      timestamp: new Date().toISOString(), stage: current.stage, ...details,
    }) + "\n");
  } catch (error) {
    console.warn(`Unable to save AI usage: ${(error as Error).message}`);
  }
}

export function summarizeAiUsage(dir: string): string {
  const file = path.join(dir, "ai-usage.jsonl");
  if (!fs.existsSync(file)) return "No AI requests recorded.";
  const rows = new Map<string, { attempts: number; cost: number; missing: number; input: number; output: number; reasoning: number }>();
  for (const line of fs.readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    const entry = JSON.parse(line);
    const key = `${entry.stage}/${entry.label ?? "request"} · ${entry.actualModel ?? entry.model}`;
    const row = rows.get(key) ?? { attempts: 0, cost: 0, missing: 0, input: 0, output: 0, reasoning: 0 };
    row.attempts++;
    const usage = entry.usage;
    if (typeof usage?.cost === "number") row.cost += usage.cost;
    else row.missing++;
    row.input += usage?.prompt_tokens ?? 0;
    row.output += usage?.completion_tokens ?? 0;
    row.reasoning += usage?.completion_tokens_details?.reasoning_tokens ?? 0;
    rows.set(key, row);
  }
  return [
    "| Stage / model | Attempts | Input tokens | Output tokens | Reasoning tokens | Reported cost (USD) | Missing cost records |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...Array.from(rows, ([key, r]) => `| ${key} | ${r.attempts} | ${r.input} | ${r.output} | ${r.reasoning} | $${r.cost.toFixed(4)} | ${r.missing} |`),
    "",
    "Reported cost includes retries with returned usage. Missing usage is unknown, not zero. Reasoning tokens are included in output tokens. TTS is billed separately.",
  ].join("\n");
}

export async function withAiUsage<T>(dir: string, stage: string, run: () => Promise<T>): Promise<T> {
  return context.run({ dir, stage }, async () => {
    try { return await run(); }
    finally {
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "ai-usage-summary.md"), summarizeAiUsage(dir));
      } catch (error) {
        console.warn(`Unable to summarize AI usage: ${(error as Error).message}`);
      }
    }
  });
}
