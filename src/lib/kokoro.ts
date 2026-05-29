import { spawn } from "node:child_process";
import path from "node:path";
import { config } from "../config.js";

export interface KokoroJobChunk {
  text: string;
  voice: string;
  speed: number;
  outputPath: string;
}

export async function synthesizeBatch(chunks: KokoroJobChunk[]): Promise<void> {
  const scriptPath = path.resolve("scripts", "kokoro_tts.py");
  const job = JSON.stringify({ modelDir: config.kokoroModelDir, chunks });

  const python = process.env.KOKORO_PYTHON || "python3";

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(python, [scriptPath], {
      stdio: ["pipe", "inherit", "inherit"],
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`kokoro_tts.py exited ${code}`));
    });
    proc.stdin.write(job);
    proc.stdin.end();
  });
}
