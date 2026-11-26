# Bundled Open Artifact runtime

The runtime is the official npm package `@open-artifact/cli@0.16.1`
from upstream commit `5757cdf5348d8e33da0ed31cc44d5bb8547869c8`.
The repository packager uses `binary-dependencies.json` to download the CLI
tarball, verify its SHA-256 and bundle it unchanged as
`vendor/open-artifact-runtime/runtime.tgz`. For a local Forge build, download
and verify the same tarball before placing it at that path. The installed
plugin extracts the bundled tarball locally to fit the marketplace's archive
entry limit. Its SHA-512 is pinned in `node/worker.cjs`.

The daemon enables upstream workspace confinement with
`OPEN_ARTIFACT_WORKSPACE_FOLDERS_ONLY=1`. The plugin verifies the extracted
files against `runtime-integrity.json` before using them.

To regenerate `adapter.mjs`, copy `adapter.entry.mjs` to a dependency build
directory containing `@open-artifact/harness-kit@0.14.6`,
`@open-artifact/protocol@0.14.6` and tar 7.5.22. Run
esbuild 0.28.1 with `--bundle --platform=node --format=esm --target=node22
--minify --legal-comments=eof`. The tar dependency tree used here is the one
in the Cindy client lockfile. Keep the bundle, runtime, schemas, generated
Skill content and third-party notices in sync when upgrading.

When updating the upstream archive, regenerate `runtime-integrity.json`
from regular files in the pinned tarball.
Use each path relative to the archive's package directory and the SHA-256
of its file content. Keep the entries sorted by path.
