#!/usr/bin/env python3
"""Batch Chatterbox TTS. Reads a JSON job from stdin, loads the model once,
synthesizes every chunk, and writes a WAV per chunk.

Expressive tags like [laugh], [chuckle], [cough] in the text are interpreted
natively by Chatterbox.

stdin JSON:
{
  "chunks": [
    {
      "text": "...",
      "audioPrompt": "/abs/ref.wav" | "",   # optional reference voice for cloning
      "exaggeration": 0.5,
      "cfgWeight": 0.5,
      "outputPath": "/abs/chunk-000.wav"
    }
  ]
}
"""
import json
import os
import sys


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def pick_device():
    import torch

    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def main() -> int:
    job = json.load(sys.stdin)
    chunks = job["chunks"]

    import soundfile as sf
    from chatterbox.tts import ChatterboxTTS

    device = pick_device()
    log(f"Loading Chatterbox model on {device}...")
    model = ChatterboxTTS.from_pretrained(device=device)

    for i, chunk in enumerate(chunks):
        out = chunk["outputPath"]
        if os.path.exists(out):
            log(f"  [{i}] exists, skipping")
            continue

        kwargs = {
            "exaggeration": chunk.get("exaggeration", 0.5),
            "cfg_weight": chunk.get("cfgWeight", 0.5),
        }
        prompt = chunk.get("audioPrompt") or ""
        if prompt:
            kwargs["audio_prompt_path"] = os.path.expanduser(prompt)

        wav = model.generate(chunk["text"], **kwargs)
        # wav is a torch tensor shaped [1, samples] on the compute device.
        audio = wav.squeeze(0).detach().cpu().numpy()
        sf.write(out, audio, model.sr)
        log(f"  [{i}] wrote {out}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
