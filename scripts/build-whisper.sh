#!/bin/bash
# Builds the whisper-cli binary the editor's auto captions use (resources/bin/whisper-cli).
#
# Pinned to a whisper.cpp release. cmake comes from PyPI into a throwaway folder, so nothing is
# installed on the Mac. The binary is static (no dylibs to ship), Apple Silicon only, with the
# Metal shaders built in, and tuned for every Apple Silicon Mac rather than just this one.
#
#   scripts/build-whisper.sh
#
# Then commit resources/bin/whisper-cli. Needs Xcode Command Line Tools and python3.
set -euo pipefail

TAG=v1.9.5
CMAKE_VERSION=4.4.5
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "Building whisper-cli from whisper.cpp $TAG in $WORK"
python3 -m venv "$WORK/venv"
"$WORK/venv/bin/pip" install --quiet "cmake==$CMAKE_VERSION"
CMAKE="$WORK/venv/bin/cmake"

git clone --quiet --depth 1 --branch "$TAG" https://github.com/ggml-org/whisper.cpp "$WORK/src"

"$CMAKE" -S "$WORK/src" -B "$WORK/build" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES=arm64 \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=13.0 \
  -DBUILD_SHARED_LIBS=OFF \
  -DGGML_NATIVE=OFF \
  -DGGML_METAL=ON \
  -DGGML_METAL_EMBED_LIBRARY=ON \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_BUILD_SERVER=OFF \
  -DWHISPER_SDL2=OFF \
  >/dev/null
"$CMAKE" --build "$WORK/build" --config Release --target whisper-cli -j "$(sysctl -n hw.ncpu)" >/dev/null

mkdir -p "$ROOT/resources/bin"
cp "$WORK/build/bin/whisper-cli" "$ROOT/resources/bin/whisper-cli"
strip -x "$ROOT/resources/bin/whisper-cli"
echo "whisper.cpp $TAG" > "$ROOT/resources/bin/whisper-cli.version"
echo "Built resources/bin/whisper-cli ($(du -h "$ROOT/resources/bin/whisper-cli" | cut -f1))"
otool -L "$ROOT/resources/bin/whisper-cli" | sed 1d
