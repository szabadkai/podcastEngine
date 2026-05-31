/**
 * Render bake-off scripts to audio with the best LOCAL TTS (Kokoro).
 * Throwaway tool. Reuses the pipeline's chunking + kokoro batch + ffmpeg
 * normalize logic without touching pipeline config (ttsProvider stays as-is).
 *
 * Usage:
 *   KOKORO_PYTHON=~/.local/share/kokoro/venv/bin/python \
 *   tsx --env-file-if-exists=.env scripts/render-bakeoff-audio.ts
 *
 * Reads every scripts/bakeoff-out/*.json and writes scripts/bakeoff-out/audio/<slug>.mp3
 */
import fs from "node:fs";
import path from "node:path";
import { loadShow } from "../src/show.js";
import { setShowConfig, config } from "../src/config.js";
import { synthesizeBatch } from "../src/lib/kokoro.js";
import { concatAndNormalize } from "../src/lib/audio.js";
import { normalizeForTTS } from "../src/lib/pronunciation.js";
import { stripTags } from "../src/lib/tags.js";
import type { EpisodeScript, TtsChunk } from "../src/lib/types.js";

const SRC = path.resolve("scripts", "bakeoff-out");
const AUDIO = path.join(SRC, "audio");

// Same chunking rule as src/05-audio.ts: merge consecutive same-speaker lines
// up to chunkMaxChars so the voice model gets coherent passages.
function chunkScript(script: EpisodeScript): TtsChunk[] {
  const chunks: TtsChunk[] = [];
  let current: TtsChunk | null = null;
  for (const line of script.lines) {
    if (
      !current ||
      current.speaker !== line.speaker ||
      current.text.length + line.text.length + 2 > config.audio.chunkMaxChars
    ) {
      if (current) chunks.push(current);
      current = { index: chunks.length, speaker: line.speaker, text: line.text };
    } else {
      current.text += "\n\n" + line.text;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function renderOne(scriptFile: string): Promise<void> {
  const slug = path.basename(scriptFile, ".json");
  const outMp3 = path.join(AUDIO, `${slug}.mp3`);
  if (fs.existsSync(outMp3)) {
    console.log(`  ${slug}: already rendered, skipping.`);
    return;
  }

  const script = JSON.parse(fs.readFileSync(scriptFile, "utf-8")) as EpisodeScript;
  // Kokoro doesn't support expressive tags → strip any, then normalize pronunciation.
  const chunks = chunkScript({
    ...script,
    lines: script.lines.map((l) => ({ ...l, text: stripTags(l.text) })),
  });
  for (const c of chunks) c.text = normalizeForTTS(c.text);

  const chunksDir = path.join(AUDIO, `${slug}-chunks`);
  fs.mkdirSync(chunksDir, { recursive: true });
  const chunkPaths = chunks.map((c) =>
    path.join(chunksDir, `chunk-${String(c.index).padStart(3, "0")}-${c.speaker}.wav`)
  );

  // Voice overrides for this bake-off (keeps show.config.ts untouched):
  //   alex  → am_michael (US male, top-tier Kokoro grade)
  //   jordan→ bm_daniel  (British male, as configured)
  // Override via env e.g. KOKORO_VOICE_ALEX=am_fenrir.
  const voiceOverride: Record<string, string> = {
    alex: process.env.KOKORO_VOICE_ALEX || "am_michael",
    jordan: process.env.KOKORO_VOICE_JORDAN || "bm_daniel",
  };
  const jobChunks = chunks.map((c, i) => {
    const cfg = config.voices.kokoro[c.speaker];
    const voiceName = voiceOverride[c.speaker] || cfg?.voice;
    if (!voiceName) throw new Error(`No kokoro voice mapped for speaker "${c.speaker}"`);
    return { text: c.text, voice: voiceName, speed: cfg?.speed ?? 1.0, outputPath: chunkPaths[i] };
  });

  console.log(`  ${slug}: synthesizing ${chunks.length} chunks via Kokoro...`);
  await synthesizeBatch(jobChunks);

  console.log(`  ${slug}: concat + loudness normalize...`);
  await concatAndNormalize(chunkPaths, outMp3);

  // cleanup chunks
  for (const p of chunkPaths) if (fs.existsSync(p)) fs.unlinkSync(p);
  try { fs.rmdirSync(chunksDir); } catch { /* not empty */ }

  const mb = (fs.statSync(outMp3).size / 1024 / 1024).toFixed(1);
  console.log(`  ${slug}: → ${path.relative(process.cwd(), outMp3)} (${mb} MB)`);
}

async function main() {
  const show = await loadShow();
  setShowConfig(show);
  fs.mkdirSync(AUDIO, { recursive: true });

  const files = fs
    .readdirSync(SRC)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(SRC, f));

  if (files.length === 0) {
    console.error("No bake-off scripts found in scripts/bakeoff-out/. Run model-bakeoff.ts first.");
    process.exit(1);
  }

  console.log(`Rendering ${files.length} script(s) with Kokoro (best local TTS):`);
  for (const f of files) await renderOne(f);
  console.log(`\nDone. Audio in: ${path.relative(process.cwd(), AUDIO)}/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
