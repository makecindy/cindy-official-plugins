#!/bin/sh
# Rebuild only the patched native payloads from the verified official source.
set -eu
PLUGIN_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SOURCE_ARCHIVE=${1:?Pass the official v0.2.0 source archive (see VENDOR-REVIEW.md)}
EXPECTED_SHA=5414809d0217a128a99508f7d9a36e8ab5da524125c3180e86bdc509cf948559
ACTUAL_SHA=$(shasum -a 256 "$SOURCE_ARCHIVE" | cut -d ' ' -f 1)
[ "$ACTUAL_SHA" = "$EXPECTED_SHA" ] || { echo 'Source archive hash mismatch' >&2; exit 1; }
BUILD_DIR=$(mktemp -d "${TMPDIR:-/tmp}/baguette-native.XXXXXX")
trap 'rm -rf "$BUILD_DIR"' EXIT
/usr/bin/tar -xzf "$SOURCE_ARCHIVE" -C "$BUILD_DIR" --strip-components=1
cd "$BUILD_DIR"
/usr/bin/patch -p1 < "$PLUGIN_DIR/vendor-native.patch"
BAGUETTE_INJECTED_ARCHS=arm64 /bin/bash Injected/HingeControl/build.sh
swift build -c release -j 6 --force-resolved-versions
DEST="$PLUGIN_DIR/vendor/baguette-v0.2.0-macOS-arm64"
cp .build/release/Baguette "$DEST/Baguette"
cp Injected/HingeControl/HingeControl "$DEST/Baguette_Baguette.bundle/HingeControl/HingeControl"
echo 'Rebuilt Baguette and HingeControl; regenerate vendor-inventory.json before packaging.'
