import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);

const CHUNK_LOUDNORM = "loudnorm=I=-18:TP=-2:LRA=7";
const MASTER_LOUDNORM = "loudnorm=I=-16:TP=-1.5:LRA=11";

export async function concatAndNormalize(
  chunkPaths: string[],
  outputPath: string
): Promise<void> {
  const dir = path.dirname(outputPath);
  const workDir = fs.mkdtempSync(path.join(dir, "audio-work-"));
  const concatFile = path.join(workDir, "concat.txt");
  const rawOutput = path.join(workDir, "raw-concat.wav");

  try {
    const leveledChunkPaths = await normalizeChunks(chunkPaths, workDir);
    const lines = leveledChunkPaths.map((p) => `file '${p}'`).join("\n");
    fs.writeFileSync(concatFile, lines);

    await execFileAsync("ffmpeg", [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", concatFile,
      "-c:a", "pcm_s16le",
      "-ar", "44100",
      "-ac", "1",
      rawOutput,
    ]);

    await execFileAsync("ffmpeg", [
      "-y",
      "-i", rawOutput,
      "-af", MASTER_LOUDNORM,
      "-c:a", "libmp3lame",
      "-b:a", "128k",
      "-ar", "44100",
      "-ac", "1",
      outputPath,
    ]);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

async function normalizeChunks(
  chunkPaths: string[],
  workDir: string
): Promise<string[]> {
  const leveledDir = path.join(workDir, "leveled-chunks");
  fs.mkdirSync(leveledDir, { recursive: true });

  const leveledChunkPaths: string[] = [];
  for (let i = 0; i < chunkPaths.length; i++) {
    const output = path.join(leveledDir, `chunk-${String(i).padStart(3, "0")}.wav`);
    await execFileAsync("ffmpeg", [
      "-y",
      "-i", chunkPaths[i],
      "-af", CHUNK_LOUDNORM,
      "-c:a", "pcm_s16le",
      "-ar", "44100",
      "-ac", "1",
      output,
    ]);
    leveledChunkPaths.push(output);
  }

  return leveledChunkPaths;
}

export async function getAudioDurationSeconds(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  const duration = parseFloat(stdout.trim());
  if (!Number.isFinite(duration) || duration < 0) {
    throw new Error(`Unable to read audio duration for ${filePath}`);
  }
  return duration;
}

export async function getAudioDuration(filePath: string): Promise<number> {
  return Math.round(await getAudioDurationSeconds(filePath));
}
