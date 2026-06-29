#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/src-tauri/resources/runtime"
BUILD_DIR="$ROOT_DIR/.tmp/runtime-build"

rm -rf "$RUNTIME_DIR" "$BUILD_DIR"
mkdir -p "$RUNTIME_DIR" "$BUILD_DIR"

build_binary() {
  local name="$1"
  local script_path="$2"
  shift 2

  uv run --python 3.11 \
    --with pyinstaller \
    --with faster-whisper \
    --with imageio-ffmpeg \
    pyinstaller \
    --noconfirm \
    --clean \
    --distpath "$BUILD_DIR/dist" \
    --workpath "$BUILD_DIR/work-$name" \
    --specpath "$BUILD_DIR/spec-$name" \
    --onefile \
    --name "$name" \
    "$@" \
    "$script_path"

  cp "$BUILD_DIR/dist/$name" "$RUNTIME_DIR/$name"
  chmod +x "$RUNTIME_DIR/$name"
}

build_binary "add_subtitles" "$ROOT_DIR/scripts/add_subtitles.py" \
  --collect-all faster_whisper \
  --collect-all ctranslate2 \
  --collect-all tokenizers \
  --collect-all imageio_ffmpeg

build_binary "analyze_auto_edit" "$ROOT_DIR/scripts/analyze_auto_edit.py"
build_binary "capcut_editor" "$ROOT_DIR/scripts/capcut_editor.py"
build_binary "export_bridge" "$ROOT_DIR/scripts/export_bridge.py"
