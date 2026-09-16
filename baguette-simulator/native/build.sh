#!/bin/sh
set -eu
cd "$(dirname "$0")"
xcrun clang -fobjc-arc -fblocks -O2 -arch arm64 -mmacosx-version-min=15.0 -framework Foundation keyboard.m -o keyboard
codesign --force --sign - keyboard
codesign --verify --strict keyboard
