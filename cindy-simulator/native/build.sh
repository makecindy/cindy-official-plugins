#!/bin/sh
set -eu
cd "$(dirname "$0")"
xcrun clang -fobjc-arc -fblocks -O2 -arch arm64 -mmacosx-version-min=15.0 -framework Foundation keyboard.m -o keyboard
codesign --force --sign - keyboard
codesign --verify --strict keyboard
xcrun clang -fobjc-arc -fblocks -O2 -arch arm64 -mmacosx-version-min=15.0 -framework Foundation remote.m -o remote
codesign --force --sign - remote
codesign --verify --strict remote
xcrun clang -fobjc-arc -fblocks -O2 -arch arm64 -mmacosx-version-min=15.0 -framework Foundation spatial.m -o spatial.new
codesign --force --sign - spatial.new
codesign --verify --strict spatial.new
mv spatial.new spatial
xcrun clang -fobjc-arc -fblocks -O2 -arch arm64 -mmacosx-version-min=15.0 -framework Foundation trackpad.m -o trackpad
codesign --force --sign - trackpad
codesign --verify --strict trackpad
xcrun clang -fobjc-arc -fblocks -O2 -arch arm64 -mmacosx-version-min=15.0 -framework Foundation -framework VideoToolbox -framework CoreMedia -framework CoreVideo -framework Accelerate android-encoder.m -o android-encoder.new
codesign --force --sign - android-encoder.new
codesign --verify --strict android-encoder.new
mv android-encoder.new android-encoder
