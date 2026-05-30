import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { textToSpeech } from "./lib/elevenlabs.js";
import { synthesize as piperSynthesize } from "./lib/piper.js";
import { synthesize as edgeSynthesize } from "./lib/edge-tts.js";
import { synthesizeBatch as kokoroSynthesizeBatch } from "./lib/kokoro.js";
import { synthesizeBatch as chatterboxSynthesizeBatch } from "./lib/chatterbox.js";
import { concatAndNormalize } from "./lib/audio.js";
import { normalizeForTTS } from "./lib/pronunciation.js";
import { stripTags } from "./lib/tags.js";
import { loadJson, fileExists, ensureDir } from "./lib/storage.js";
import { getSpeakerIds } from "./show.js";
import type {
  EpisodeScript,
  TaggedEpisodeScript,
  TtsChunk,
} from "./lib/types.js";

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

export async function run(episodeDir: string): Promise<void> {
  const outputPath = path.join(episodeDir, "episode.mp3");
  if (fileExists(outputPath)) {
    console.log("Stage 05: output already exists, skipping.");
    return;
  }

  const provider = config.ttsProvider;
  const providerSupportsTags = !!config.tagSupport[provider];

  // Prefer the tagged script (04b) when the provider can use tags; otherwise the
  // plain script. Either way, resolve each line's text for THIS provider: keep
  // tags if supported, strip them if not, so non-supporting engines never read
  // "[laugh]" aloud.
  const taggedPath = path.join(episodeDir, "04b-script-tagged.json");
  const tagged =
    providerSupportsTags
      ? loadJson<TaggedEpisodeScript | null>(taggedPath, null)
      : null;
  const plain = loadJson<EpisodeScript | null>(
    path.join(episodeDir, "04-script.json"),
    null
  );

  let script: EpisodeScript;
  if (tagged) {
    console.log("  Using tagged script (04b) with expressive tags.");
    script = {
      ...tagged,
      lines: tagged.lines.map((l) => ({
        speaker: l.speaker,
        segment: l.segment,
        text: l.taggedText,
      })),
    };
  } else if (plain) {
    script = providerSupportsTags
      ? plain
      : {
          ...plain,
          lines: plain.lines.map((l) => ({ ...l, text: stripTags(l.text) })),
        };
  } else {
    throw new Error("No script found in 04-script.json");
  }

  const chunks = chunkScript(script);
  for (const chunk of chunks) {
    chunk.text = normalizeForTTS(chunk.text);
  }
  const totalChars = chunks.reduce((sum, c) => sum + c.text.length, 0);
  console.log(
    `Stage 05: ${chunks.length} audio chunks, ${totalChars} total characters.`
  );

  const chunksDir = path.join(episodeDir, "chunks");
  ensureDir(chunksDir);

  const ext =
    provider === "piper" || provider === "kokoro" || provider === "chatterbox"
      ? "wav"
      : "mp3";
  console.log(`  TTS provider: ${provider}`);

  const chunkPaths = chunks.map((chunk) =>
    path.join(
      chunksDir,
      `chunk-${String(chunk.index).padStart(3, "0")}-${chunk.speaker}.${ext}`
    )
  );

  // Kokoro runs as a single batch process (loads the model once).
  if (provider === "kokoro") {
    const jobChunks = chunks.map((chunk, i) => {
      const voice = config.voices.kokoro[chunk.speaker];
      return {
        text: chunk.text,
        voice: voice.voice,
        speed: voice.speed,
        outputPath: chunkPaths[i],
      };
    });
    await kokoroSynthesizeBatch(jobChunks);
    return finalize(chunkPaths, chunksDir, outputPath);
  }

  // Chatterbox also runs as a single batch process (PyTorch model loaded once).
  if (provider === "chatterbox") {
    const jobChunks = chunks.map((chunk, i) => {
      const voice = config.voices.chatterbox[chunk.speaker];
      return {
        text: chunk.text,
        audioPrompt: voice.audioPrompt,
        exaggeration: voice.exaggeration,
        cfgWeight: voice.cfgWeight,
        outputPath: chunkPaths[i],
      };
    });
    await chatterboxSynthesizeBatch(jobChunks);
    return finalize(chunkPaths, chunksDir, outputPath);
  }

  const requestIds: Record<string, string[]> = Object.fromEntries(
    getSpeakerIds().map((id) => [id, []])
  );

  for (const chunk of chunks) {
    const chunkPath = chunkPaths[chunk.index];

    if (fs.existsSync(chunkPath)) {
      console.log(`  Chunk ${chunk.index}: already exists, skipping.`);
      continue;
    }

    console.log(
      `  Chunk ${chunk.index}/${chunks.length - 1} (${chunk.speaker}): ${chunk.text.length} chars...`
    );

    if (provider === "piper") {
      const voice = config.voices.piper[chunk.speaker];
      await piperSynthesize({
        model: voice.model,
        text: chunk.text,
        outputPath: chunkPath,
        lengthScale: voice.lengthScale,
      });
    } else if (provider === "edge") {
      const voice = config.voices.edge[chunk.speaker];
      await edgeSynthesize({
        voice: voice.voice,
        text: chunk.text,
        outputPath: chunkPath,
        rate: voice.rate,
        pitch: voice.pitch,
      });
    } else {
      const voice = config.voices.elevenlabs[chunk.speaker];
      const result = await textToSpeech({
        voiceId: voice.voiceId,
        text: chunk.text,
        stability: voice.stability,
        similarityBoost: voice.similarityBoost,
        style: voice.style,
        previousRequestIds: requestIds[chunk.speaker],
      });
      fs.writeFileSync(chunkPath, result.audio);
      if (result.requestId) requestIds[chunk.speaker].push(result.requestId);

      if (chunk.index < chunks.length - 1) {
        await new Promise((r) =>
          setTimeout(r, config.audio.delayBetweenChunksMs)
        );
      }
    }
  }

  await finalize(chunkPaths, chunksDir, outputPath);
}

async function finalize(
  chunkPaths: string[],
  chunksDir: string,
  outputPath: string
): Promise<void> {
  console.log("  Concatenating and normalizing audio...");
  await concatAndNormalize(chunkPaths, outputPath);

  console.log("  Cleaning up chunks...");
  for (const p of chunkPaths) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  try {
    fs.rmdirSync(chunksDir);
  } catch {
    // ignore if not empty
  }

  const size = fs.statSync(outputPath).size;
  console.log(
    `Stage 05: episode.mp3 generated (${(size / 1024 / 1024).toFixed(1)} MB).`
  );
}
