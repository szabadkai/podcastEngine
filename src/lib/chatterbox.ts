import { spawn } from "node:child_process";
import path from "node:path";

export interface ChatterboxJobChunk {
  text: string;
  audioPrompt: string;
  exaggeration: number;
  cfgWeight: number;
  outputPath: string;
}

export async function synthesizeBatch(
  chunks: ChatterboxJobChunk[]
): Promise<void> {
  const scriptPath = path.resolve("scripts", "chatterbox_tts.py");
  const job = JSON.stringify({ chunks });

  const python = process.env.CHATTERBOX_PYTHON || "python3";

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(python, [scriptPath], {
      stdio: ["pipe", "inherit", "inherit"],
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`chatterbox_tts.py exited ${code}`));
    });
    proc.stdin.write(job);
    proc.stdin.end();
  });
}
