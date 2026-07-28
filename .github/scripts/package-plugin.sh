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
