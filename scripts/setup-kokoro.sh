#!/usr/bin/env bash
# Install Kokoro TTS into a dedicated venv and download model files.
# Usage: bash scripts/setup-kokoro.sh
set -euo pipefail

MODEL_DIR="${KOKORO_MODEL_DIR:-$HOME/.local/share/kokoro}"
VENV_DIR="${KOKORO_VENV:-$HOME/.local/share/kokoro/venv}"
BASE="https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"

mkdir -p "$MODEL_DIR"

echo "Creating venv at $VENV_DIR..."
python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/python" -m pip install --quiet --upgrade pip
echo "Installing kokoro-onnx, soundfile..."
"$VENV_DIR/bin/python" -m pip install --quiet kokoro-onnx soundfile

if [ ! -f "$MODEL_DIR/kokoro-v1.0.onnx" ]; then
  echo "Downloading kokoro-v1.0.onnx (~310 MB)..."
  curl -fL "$BASE/kokoro-v1.0.onnx" -o "$MODEL_DIR/kokoro-v1.0.onnx"
fi

if [ ! -f "$MODEL_DIR/voices-v1.0.bin" ]; then
  echo "Downloading voices-v1.0.bin..."
  curl -fL "$BASE/voices-v1.0.bin" -o "$MODEL_DIR/voices-v1.0.bin"
fi

echo ""
echo "Done. Kokoro ready in $MODEL_DIR"
echo "Python interpreter: $VENV_DIR/bin/python"
echo "Set KOKORO_PYTHON to this path (the pipeline reads it):"
echo "  export KOKORO_PYTHON=$VENV_DIR/bin/python"
echo "Note: espeak-ng must be installed (brew install espeak-ng / apt install espeak-ng)."
