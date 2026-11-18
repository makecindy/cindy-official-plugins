#!/usr/bin/env bash
# Package one official plugin directory into a .cindy archive, exactly the way
# the publish workflows do. Both publish-cindy-plugins*.yml and the PR dry-run
# call this script so the two never drift apart.
#
# Usage: package-plugin.sh <plugin-directory> <output-file>
#
# Apache-2.0 4(a)/(d): a redistributed artifact must carry the License and the
# NOTICE. Both live at the repository root, so an archive of a plugin
# subdirectory would omit them without --add-file. A plugin's own
# THIRD-PARTY-LICENSES.txt already travels, being inside its directory.
# -c core.autocrlf=false: the root .gitattributes is outside the archived
# subtree, so its eol=lf pins do not apply here. Without this, a runner
# defaulting to autocrlf=true would silently ship CRLF copies of the committed
# bundles instead of the LF blobs.
set -euo pipefail

plugin_directory="${1:?usage: package-plugin.sh <plugin-directory> <output-file>}"
output_file="${2:?usage: package-plugin.sh <plugin-directory> <output-file>}"
# Opt-in only. Legacy plugins keep the original toolchain and archive bytes.
if git cat-file -e "HEAD:${plugin_directory}/binary-dependencies.json" 2>/dev/null; then
  python3 "$(dirname "$0")/binary-dependencies.py" "${plugin_directory}" "${output_file}"
else

git -c core.autocrlf=false archive \
  --format=zip \
  --output="${output_file}" \
  --add-file=LICENSE \
  --add-file=NOTICE \
  --add-file=TRADEMARKS.md \
  --add-file=TRADEMARKS.zh-CN.md \
  "HEAD:${plugin_directory}"

fi

# Cindy Chrome's native connector is built from source for every package,
# independent of binary-dependencies.json: ghost.json's nativeHost.binary
# points at native-host/bin, and a package without it cannot connect.
if [[ "$plugin_directory" == "my-browser" ]] && git cat-file -e "HEAD:my-browser/native-host/go.mod" 2>/dev/null; then
  stage=$(mktemp -d)
  trap 'rm -rf "$stage"' EXIT
  git archive HEAD:my-browser/native-host | tar -x -C "$stage"
  node scripts/build-browser-native.mjs "$stage" "$stage/package/native-host/bin"
  absolute_output=$(python3 -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$output_file")
  (cd "$stage/package" && zip -qr "$absolute_output" native-host/bin)
  native_entries="$(unzip -Z1 "${output_file}")"
  for platform in darwin-x64 darwin-arm64 linux-x64 linux-arm64 win32-x64 win32-arm64; do
    binary="cindy-browser-native"
    [[ "$platform" == win32-* ]] && binary="${binary}.exe"
    grep -qx "native-host/bin/${platform}/${binary}" <<<"${native_entries}" || {
      echo "Package is missing native-host/bin/${platform}/${binary}: ${output_file}" >&2
      exit 1
    }
  done
fi

# `git archive --format=zip` emits directory records. Remove them so local
# packages have the same shape as published packages. The package cap applies
# to the complete archive, including the required legal records.
zip -q -d "${output_file}" '*/' >/dev/null 2>&1 || true

# Enforce the intersection of the Server acceptance limits and Desktop install
# limits on the exact archive that will be uploaded. Regular sandbox packages
# retain their smaller Desktop limits.
archive_bytes="$(wc -c < "${output_file}" | tr -d '[:space:]')"
uncompressed_bytes="$(unzip -l "${output_file}" | awk 'END { print $1 }')"
entry_count="$(unzip -Z1 "${output_file}" \
  | awk '$0 !~ /\/$/' \
  | wc -l | tr -d '[:space:]')"
if jq -e '.node != null' "${plugin_directory}/ghost.json" >/dev/null; then
  max_archive_bytes=$((128 * 1024 * 1024))
  max_uncompressed_bytes=$((256 * 1024 * 1024))
else
  max_archive_bytes=$((8 * 1024 * 1024))
  max_uncompressed_bytes=$((32 * 1024 * 1024))
fi

if (( archive_bytes > max_archive_bytes )); then
  echo "Plugin archive is ${archive_bytes} bytes; limit is ${max_archive_bytes}: ${output_file}" >&2
  exit 1
fi
if (( uncompressed_bytes > max_uncompressed_bytes )); then
  echo "Plugin archive expands to ${uncompressed_bytes} bytes; limit is ${max_uncompressed_bytes}: ${output_file}" >&2
  exit 1
fi
if (( entry_count > 256 )); then
  echo "Plugin archive contains ${entry_count} files including legal records; Server limit is 256: ${output_file}" >&2
  exit 1
fi
