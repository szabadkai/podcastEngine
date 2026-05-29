import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface EdgeOptions {
  voice: string;
  text: string;
  outputPath: string;
  rate?: string;
  pitch?: string;
}

export async function synthesize(opts: EdgeOptions): Promise<void> {
  const textFile = path.join(
    os.tmpdir(),
    `edge-tts-${process.pid}-${Date.now()}.txt`
  );
  fs.writeFileSync(textFile, opts.text);

  const args = [
    "--voice", opts.voice,
    "--file", textFile,
    "--write-media", opts.outputPath,
  ];
  if (opts.rate) args.push("--rate", opts.rate);
  if (opts.pitch) args.push("--pitch", opts.pitch);

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("edge-tts", args, { stdio: ["ignore", "ignore", "pipe"] });

      let stderr = "";
      proc.stderr.on("data", (d) => (stderr += d.toString()));
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`edge-tts exited ${code}: ${stderr.slice(-500)}`));
      });
    });
  } finally {
    fs.rmSync(textFile, { force: true });
  }
}
