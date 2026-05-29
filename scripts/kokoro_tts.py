#!/usr/bin/env python3
"""Batch Kokoro TTS. Reads a JSON job from stdin, loads the model once,
synthesizes every chunk, and writes a WAV per chunk.

stdin JSON:
{
  "modelDir": "/path/to/dir-with-onnx-and-bin",
  "chunks": [
    {"text": "...", "voice": "af_sarah", "speed": 1.0, "outputPath": "/abs/chunk-000.wav"}
  ]
}
"""
import json
import os
import sys


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def main() -> int:
    job = json.load(sys.stdin)
    model_dir = os.path.expanduser(job["modelDir"])
    chunks = job["chunks"]

    onnx_path = os.path.join(model_dir, "kokoro-v1.0.onnx")
    voices_path = os.path.join(model_dir, "voices-v1.0.bin")
    for p in (onnx_path, voices_path):
        if not os.path.exists(p):
            log(f"Missing model file: {p}")
            return 2

    import soundfile as sf
    from kokoro_onnx import Kokoro

    log("Loading Kokoro model...")
    kokoro = Kokoro(onnx_path, voices_path)

    for i, chunk in enumerate(chunks):
        out = chunk["outputPath"]
        if os.path.exists(out):
            log(f"  [{i}] exists, skipping")
            continue
        samples, sample_rate = kokoro.create(
            chunk["text"],
            voice=chunk["voice"],
            speed=chunk.get("speed", 1.0),
            lang="en-us",
        )
        sf.write(out, samples, sample_rate)
        log(f"  [{i}] wrote {out}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
