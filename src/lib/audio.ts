import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);

export async function concatAndNormalize(
  chunkPaths: string[],
  outputPath: string
): Promise<void> {
  const dir = path.dirname(outputPath);
  const concatFile = path.join(dir, "concat.txt");
  const rawOutput = path.join(dir, "raw-concat.mp3");

  const lines = chunkPaths.map((p) => `file '${p}'`).join("\n");
  fs.writeFileSync(concatFile, lines);

  await execFileAsync("ffmpeg", [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", concatFile,
    "-c:a", "libmp3lame",
    "-b:a", "128k",
    "-ar", "44100",
    "-ac", "1",
    rawOutput,
  ]);

  await execFileAsync("ffmpeg", [
    "-y",
    "-i", rawOutput,
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
    "-c:a", "libmp3lame",
    "-b:a", "128k",
    outputPath,
  ]);

  fs.unlinkSync(concatFile);
  fs.unlinkSync(rawOutput);
}

export async function getAudioDuration(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  return Math.round(parseFloat(stdout.trim()));
}
