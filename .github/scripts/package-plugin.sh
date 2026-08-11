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

git -c core.autocrlf=false archive \
  --format=zip \
  --output="${output_file}" \
  --add-file=LICENSE \
  --add-file=NOTICE \
  --add-file=TRADEMARKS.md \
  --add-file=TRADEMARKS.zh-CN.md \
  "HEAD:${plugin_directory}"

# Enforce the intersection of the Server acceptance limits and Desktop install
# limits on the exact archive that will be uploaded. Server is stricter for
# Node packages; Desktop is stricter for regular sandbox packages.
archive_bytes="$(wc -c < "${output_file}" | tr -d '[:space:]')"
uncompressed_bytes="$(unzip -l "${output_file}" | awk 'END { print $1 }')"
entry_count="$(unzip -Z1 "${output_file}" | wc -l | tr -d '[:space:]')"
if jq -e '.node != null' "${plugin_directory}/ghost.json" >/dev/null; then
  max_archive_bytes=$((64 * 1024 * 1024))
  max_uncompressed_bytes=$((64 * 1024 * 1024))
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
  echo "Plugin archive contains ${entry_count} entries; Server limit is 256: ${output_file}" >&2
  exit 1
fi
