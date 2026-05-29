import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { config } from "../config.js";

function expandHome(p: string): string {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

interface PiperOptions {
  model: string;
  text: string;
  outputPath: string;
  lengthScale?: number;
}

export async function synthesize(opts: PiperOptions): Promise<void> {
  const dataDir = expandHome(config.piperDataDir);
  const modelPath = path.join(dataDir, `${opts.model}.onnx`);

  const args = ["-m", modelPath, "-f", opts.outputPath];
  if (opts.lengthScale != null) {
    args.push("--length-scale", String(opts.lengthScale));
  }

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("piper", args, { stdio: ["pipe", "ignore", "pipe"] });

    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`piper exited ${code}: ${stderr.slice(-500)}`));
    });

    proc.stdin.write(opts.text);
    proc.stdin.end();
  });
}
