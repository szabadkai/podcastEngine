import path from "node:path";
import { getEpisodeDir } from "./lib/storage.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const requestedStage = args.find((a) => !a.startsWith("--"));

const dateOverride = process.env.EPISODE_DATE || undefined;
const episodeDir = getEpisodeDir(dateOverride);

console.log(`\nLayer Lines Weekly — Pipeline`);
console.log(`Episode dir: ${path.relative(process.cwd(), episodeDir)}`);
if (dryRun) console.log("Mode: DRY RUN (skipping audio + publish)\n");
else console.log("");

type StageFn = (dir: string) => Promise<void>;

const stages: Array<{ name: string; run: () => Promise<StageFn> }> = [
  { name: "collect", run: () => import("./01-collect.js").then((m) => m.run) },
  { name: "analyze", run: () => import("./02-analyze.js").then((m) => m.run) },
  { name: "fact-check", run: () => import("./03-fact-check.js").then((m) => m.run) },
  { name: "script", run: () => import("./04-script.js").then((m) => m.run) },
  { name: "tag", run: () => import("./04b-tag.js").then((m) => m.run) },
  { name: "recap", run: () => import("./04c-recap.js").then((m) => m.run) },
  { name: "audio", run: () => import("./05-audio.js").then((m) => m.run) },
  { name: "publish", run: () => import("./06-publish.js").then((m) => m.run) },
];

const SKIP_IN_DRY_RUN = new Set(["audio", "publish"]);

async function runStage(name: string, loadFn: () => Promise<StageFn>) {
  if (dryRun && SKIP_IN_DRY_RUN.has(name)) {
    console.log(`=== Stage: ${name} — SKIPPED (dry run) ===\n`);
    return;
  }
  console.log(`=== Stage: ${name} ===`);
  const fn = await loadFn();
  await fn(episodeDir);
  console.log("");
}

async function main() {
  if (requestedStage) {
    const stage = stages.find((s) => s.name === requestedStage);
    if (!stage) {
      console.error(
        `Unknown stage: ${requestedStage}\nAvailable: ${stages.map((s) => s.name).join(", ")}`
      );
      process.exit(1);
    }
    await runStage(stage.name, stage.run);
  } else {
    for (const stage of stages) {
      await runStage(stage.name, stage.run);
    }
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(`\nPipeline failed: ${err.message}`);
  process.exit(1);
});
