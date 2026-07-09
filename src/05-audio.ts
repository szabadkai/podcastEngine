import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { textToSpeech } from "./lib/elevenlabs.js";
import { synthesize as piperSynthesize } from "./lib/piper.js";
import { synthesize as edgeSynthesize } from "./lib/edge-tts.js";
import { synthesizeBatch as kokoroSynthesizeBatch } from "./lib/kokoro.js";
import { synthesizeBatch as chatterboxSynthesizeBatch } from "./lib/chatterbox.js";
import { concatAndNormalize, getAudioDurationSeconds } from "./lib/audio.js";
import { normalizeForTTS } from "./lib/pronunciation.js";
import { stripTags } from "./lib/tags.js";
import { loadJson, fileExists, ensureDir } from "./lib/storage.js";
import type {
  EpisodeScript,
  TaggedEpisodeScript,
  TtsChunk,
} from "./lib/types.js";

function chunkScript(script: EpisodeScript): TtsChunk[] {
  const chunks: TtsChunk[] = [];

  for (const line of script.lines) {
    for (const text of splitTtsText(line.text, config.audio.chunkMaxChars)) {
      chunks.push({ index: chunks.length, speaker: line.speaker, text });
    }
  }
  return chunks;
}

// Splitting only at speaker changes leaves some very long monologues for the
// model. Keep those requests short, but preserve complete sentences whenever
// possible so neither the input nor an audio join bisects a thought.
function splitTtsText(text: string, maxChars: number): string[] {
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  const sentences = Array.from(segmenter.segment(text), ({ segment }) =>
    segment.trim()
  ).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    for (const part of splitLongSentence(sentence, maxChars)) {
      if (current && current.length + part.length + 1 > maxChars) {
        chunks.push(current);
        current = part;
      } else {
        current = current ? `${current} ${part}` : part;
      }
    }
  }

  if (current) chunks.push(current);
  return chunks.length ? chunks : [text.trim()];
}

function splitLongSentence(sentence: string, maxChars: number): string[] {
  if (sentence.length <= maxChars) return [sentence];

  const parts: string[] = [];
  let current = "";
  for (const word of sentence.split(/\s+/)) {
    if (current && current.length + word.length + 1 > maxChars) {
      parts.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function wordCount(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

async function hasPlausibleDuration(
  audioPath: string,
  text: string
): Promise<{ valid: boolean; duration: number; minimum: number }> {
  const duration = await getAudioDurationSeconds(audioPath);
  const minimum = Math.max(0.5, wordCount(text) * config.audio.minSecondsPerWord);
  return { valid: duration >= minimum, duration, minimum };
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

  // Normalize before splitting so spoken-out prices and quantities still obey
  // the per-request cap used to prevent incomplete generations.
  const normalizedScript: EpisodeScript = {
    ...script,
    lines: script.lines.map((line) => ({
      ...line,
      text: normalizeForTTS(line.text),
    })),
  };
  const chunks = chunkScript(normalizedScript);
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

  for (const chunk of chunks) {
    const chunkPath = chunkPaths[chunk.index];

    if (fs.existsSync(chunkPath)) {
      if (provider !== "elevenlabs") {
        console.log(`  Chunk ${chunk.index}: already exists, skipping.`);
        continue;
      }

      const quality = await hasPlausibleDuration(chunkPath, chunk.text);
      if (quality.valid) {
        console.log(`  Chunk ${chunk.index}: already exists, skipping.`);
        continue;
      }
      console.warn(
        `  Chunk ${chunk.index}: only ${quality.duration.toFixed(2)}s for ${wordCount(chunk.text)} words; regenerating.`
      );
      fs.unlinkSync(chunkPath);
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
      const previousText = chunks[chunk.index - 1]?.text;
      const nextText = chunks[chunk.index + 1]?.text;
      let accepted = false;

      for (let attempt = 0; attempt <= config.audio.shortAudioRetries; attempt++) {
        if (attempt > 0) {
          console.warn(`  Chunk ${chunk.index}: retrying short audio (${attempt}/${config.audio.shortAudioRetries}).`);
        }
        const result = await textToSpeech({
          voiceId: voice.voiceId,
          text: chunk.text,
          stability: voice.stability,
          similarityBoost: voice.similarityBoost,
          style: voice.style,
          previousText,
          nextText,
        });
        fs.writeFileSync(chunkPath, result.audio);

        const quality = await hasPlausibleDuration(chunkPath, chunk.text);
        if (quality.valid) {
          accepted = true;
          break;
        }
        console.warn(
          `  Chunk ${chunk.index}: ${quality.duration.toFixed(2)}s is below the ${quality.minimum.toFixed(2)}s minimum for ${wordCount(chunk.text)} words.`
        );
        fs.unlinkSync(chunkPath);
      }

      if (!accepted) {
        throw new Error(
          `TTS chunk ${chunk.index} remained implausibly short after ${config.audio.shortAudioRetries + 1} attempts.`
        );
      }

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
