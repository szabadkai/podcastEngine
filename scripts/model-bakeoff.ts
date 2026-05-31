/**
 * Script-model bake-off harness (throwaway tool, not part of the pipeline).
 *
 * Runs the SAME script-generation call as src/04-script.ts across several
 * OpenRouter models, against one fixture (03-fact-checked.json), with
 * continuity neutralized so it's apples-to-apples. Captures words / lines /
 * runtime / cost / latency and writes each full script to disk for reading.
 *
 * Usage:
 *   tsx --env-file-if-exists=.env scripts/model-bakeoff.ts <fixture-dir>
 * e.g.
 *   tsx --env-file-if-exists=.env scripts/model-bakeoff.ts episodes/2026-05-29
 *
 * Output: scripts/bakeoff-out/<model-slug>.json  + a printed summary table.
 */
import fs from "node:fs";
import path from "node:path";
import { loadShow } from "../src/show.js";
import { setShowConfig, config } from "../src/config.js";
import { chatJson } from "../src/lib/ai.js";
import type { FactCheckedStories, EpisodeScript } from "../src/lib/types.js";

// --- Models under test. Opus is reused from a saved run, not re-called. ---
// in/out are USD per 1M tokens, for the cost estimate column.
const MODELS: Array<{ slug: string; label: string; in: number; out: number }> = [
  { slug: "anthropic/claude-sonnet-4.6", label: "Sonnet 4.6", in: 3.0, out: 15.0 },
  { slug: "openai/gpt-5.5", label: "GPT-5.5", in: 5.0, out: 30.0 },
  { slug: "deepseek/deepseek-v4-pro", label: "DeepSeek v4-pro", in: 0.43, out: 0.87 },
  { slug: "moonshotai/kimi-k2.6", label: "Kimi K2.6", in: 0.68, out: 3.42 },
];

const OUT_DIR = path.resolve("scripts", "bakeoff-out");

function buildStoryBrief(factChecked: FactCheckedStories): string {
  // Mirror of the brief construction in src/04-script.ts so the prompt is identical.
  return factChecked.clusters
    .map((c) => {
      const claimLines = c.factCheck.claims
        .map((cl) => `  - [${cl.rating}] ${cl.claim}: ${cl.note}`)
        .join("\n");
      const hypeLines =
        c.factCheck.hypeFlags.length > 0
          ? `Hype flags: ${c.factCheck.hypeFlags.join("; ")}`
          : "";
      const skeptical =
        c.factCheck.skepticalAngles.length > 0
          ? `Skeptical angles: ${c.factCheck.skepticalAngles.join("; ")}`
          : "";
      return `### ${c.segment.toUpperCase()}: ${c.headline}
Summary: ${c.summary}
Significance: ${c.significance}
Sources: ${c.sources.join(", ")}
Claims:
${claimLines}
${hypeLines}
${skeptical}`;
    })
    .join("\n\n---\n\n");
}

function wordCount(s: EpisodeScript): number {
  return s.lines.reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0);
}

// Rough token estimate (chars/4) for the cost column — good enough to rank by.
const estTokens = (s: string) => Math.ceil(s.length / 4);

async function main() {
  const fixtureDir = process.argv[2];
  if (!fixtureDir) {
    console.error("Usage: tsx scripts/model-bakeoff.ts <fixture-dir-with-03-fact-checked.json>");
    process.exit(1);
  }

  const show = await loadShow();
  setShowConfig(show);

  const inputPath = path.resolve(fixtureDir, "03-fact-checked.json");
  const factChecked = JSON.parse(fs.readFileSync(inputPath, "utf-8")) as FactCheckedStories;

  const systemPrompt = fs.readFileSync(path.resolve("prompts", "script.md"), "utf-8");
  const storyBrief = buildStoryBrief(factChecked);
  // Continuity intentionally omitted — neutralized, fresh-episode behavior.
  const userContent = `Write episode #99 for ${factChecked.episodeDate}.\n\nHere are the fact-checked stories for this episode:\n\n${storyBrief}\n\nGenerate the full podcast script as JSON.`;

  const promptTokens = estTokens(systemPrompt + userContent);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  type Row = {
    label: string; slug: string; words: number; lines: number;
    minutes: number; wpl: number; costUsd: number; latencyS: number; ok: boolean; note: string;
  };
  const rows: Row[] = [];

  for (const m of MODELS) {
    process.stdout.write(`\n→ ${m.label} (${m.slug}) ... `);
    const t0 = Date.now();
    try {
      const result = await chatJson<EpisodeScript>({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        temperature: 0.7,
        maxTokens: 16384,
        model: m.slug,
      });
      const latencyS = (Date.now() - t0) / 1000;
      const words = wordCount(result);
      const outTokens = estTokens(JSON.stringify(result));
      const costUsd = (promptTokens / 1e6) * m.in + (outTokens / 1e6) * m.out;
      const slugFile = m.slug.replace(/[\/.]/g, "_");
      fs.writeFileSync(path.join(OUT_DIR, `${slugFile}.json`), JSON.stringify(result, null, 2));

      const floorFail = words < 2500 ? " (UNDER FLOOR)" : "";
      rows.push({
        label: m.label, slug: m.slug, words, lines: result.lines.length,
        minutes: Math.round(words / 150), wpl: +(words / result.lines.length).toFixed(1),
        costUsd: +costUsd.toFixed(4), latencyS: +latencyS.toFixed(1), ok: true,
        note: (words >= 2500 ? "ok" : "short") + floorFail,
      });
      console.log(`${words} words, ${result.lines.length} lines, ${latencyS.toFixed(0)}s`);
    } catch (err) {
      const latencyS = (Date.now() - t0) / 1000;
      rows.push({
        label: m.label, slug: m.slug, words: 0, lines: 0, minutes: 0, wpl: 0,
        costUsd: 0, latencyS: +latencyS.toFixed(1), ok: false,
        note: `FAILED: ${(err as Error).message.slice(0, 80)}`,
      });
      console.log(`FAILED: ${(err as Error).message.slice(0, 120)}`);
    }
  }

  // --- Summary table ---
  console.log("\n\n=== BAKE-OFF SUMMARY (fixture: " + path.relative(process.cwd(), fixtureDir) + ") ===");
  console.log("Note: Opus 4.8 reused from prior run — 2570 words / 57 lines / ~17 min / ~45.1 wpl / ~$0.12.\n");
  const header = ["Model", "Words", "Lines", "~min", "w/line", "Cost", "Latency", "Note"];
  const widths = [16, 7, 6, 5, 7, 9, 8, 22];
  const pad = (s: string, w: number) => String(s).padEnd(w);
  console.log(header.map((h, i) => pad(h, widths[i])).join(""));
  console.log("-".repeat(widths.reduce((a, b) => a + b, 0)));
  for (const r of rows) {
    console.log([
      pad(r.label, widths[0]),
      pad(r.ok ? r.words : "—", widths[1]),
      pad(r.ok ? r.lines : "—", widths[2]),
      pad(r.ok ? r.minutes : "—", widths[3]),
      pad(r.ok ? r.wpl : "—", widths[4]),
      pad(r.ok ? "$" + r.costUsd : "—", widths[5]),
      pad(r.latencyS + "s", widths[6]),
      pad(r.note, widths[7]),
    ].join(""));
  }
  console.log(`\nFull scripts saved to: ${path.relative(process.cwd(), OUT_DIR)}/`);
  console.log("(Opus 4.8 not in table — reused from earlier; rerun separately if you want it saved here.)");
}

main().catch((e) => { console.error(e); process.exit(1); });
