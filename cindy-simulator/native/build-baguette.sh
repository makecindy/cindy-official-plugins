#!/bin/sh
# Rebuild only the patched native payloads from the verified official source.
set -eu
PLUGIN_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SOURCE_ARCHIVE=${1:?Pass the official v0.2.10 source archive (see VENDOR-REVIEW.md)}
EXPECTED_SHA=b41596dc629e9a87472fc9b6737c0bfeae79da002f4b859504cdf54d63b22221
ACTUAL_SHA=$(shasum -a 256 "$SOURCE_ARCHIVE" | cut -d ' ' -f 1)
[ "$ACTUAL_SHA" = "$EXPECTED_SHA" ] || { echo 'Source archive hash mismatch' >&2; exit 1; }
BUILD_DIR=$(mktemp -d "${TMPDIR:-/tmp}/baguette-native.XXXXXX")
trap 'rm -rf "$BUILD_DIR"' EXIT
/usr/bin/tar -xzf "$SOURCE_ARCHIVE" -C "$BUILD_DIR" --strip-components=1
cd "$BUILD_DIR"
/usr/bin/patch -p1 < "$PLUGIN_DIR/vendor-native.patch"
BAGUETTE_INJECTED_ARCHS=arm64 /bin/bash Injected/HingeControl/build.sh
# Whole-program LTO keeps the host binary within the repository binary budget.
swift build -c release -j 6 --force-resolved-versions --experimental-lto-mode=full -Xswiftc -Osize
/usr/bin/strip .build/release/Baguette
/usr/bin/codesign --force --sign - --timestamp=none .build/release/Baguette
DEST="$PLUGIN_DIR/vendor/baguette"
# Replace, never overwrite in place: macOS caches a signed executable's code
# signature per file, and processes that map the rewritten file get killed.
install_new() { cp "$1" "$2.new" && mv -f "$2.new" "$2"; }
install_new .build/release/Baguette "$DEST/Baguette"
install_new Injected/HingeControl/HingeControl "$DEST/Baguette_Baguette.bundle/HingeControl/HingeControl"
cp Injected/HingeControl/Sources/LICENSE.idb "$DEST/Baguette_Baguette.bundle/HingeControl/LICENSE.idb"
echo 'Rebuilt Baguette and HingeControl; run node native/inventory.mjs --write before packaging.'
