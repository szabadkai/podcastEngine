#!/usr/bin/env bash
# Install Chatterbox TTS into a dedicated venv.
# Model weights are fetched automatically on first run (cached under ~/.cache/huggingface).
# Usage: bash scripts/setup-chatterbox.sh
set -euo pipefail

VENV_DIR="${CHATTERBOX_VENV:-$HOME/.local/share/chatterbox/venv}"

mkdir -p "$(dirname "$VENV_DIR")"

echo "Creating venv at $VENV_DIR..."
python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/python" -m pip install --quiet --upgrade pip
echo "Installing chatterbox-tts (this pulls in torch and is large)..."
"$VENV_DIR/bin/python" -m pip install --quiet chatterbox-tts soundfile

echo ""
echo "Done. Chatterbox installed."
echo "Python interpreter: $VENV_DIR/bin/python"
echo "Set CHATTERBOX_PYTHON to this path (the pipeline reads it):"
echo "  export CHATTERBOX_PYTHON=$VENV_DIR/bin/python"
echo ""
echo "Model weights download automatically on first synthesis (cached in ~/.cache/huggingface)."
echo "On CPU, generation is slow (no GPU acceleration); a GPU or Apple MPS is much faster."
