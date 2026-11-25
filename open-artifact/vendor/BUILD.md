# Bundled Open Artifact runtime

Use the npm registry packages `@open-artifact/cli@0.14.6`,
`@open-artifact/harness-kit@0.14.6` and `@open-artifact/protocol@0.14.6`.
Keep the CLI tarball unchanged as `runtime.tgz`. Its pinned SHA-512 is in
`node/worker.cjs`. The runtime is extracted locally from this signed plugin's
contents to stay within the marketplace's archive entry limit.

To regenerate `adapter.mjs`, copy `adapter.entry.mjs` to a dependency build
directory containing these two Open Artifact libraries and tar 7.5.22. Run
esbuild 0.28.1 with `--bundle --platform=node --format=esm --target=node22
--minify --legal-comments=eof`. The tar dependency tree used here is the one
in the Cindy client lockfile. Keep the bundle, runtime, schemas, generated
Skill content and third-party notices in sync when upgrading.

Regenerate `runtime-integrity.json` from regular files in the pinned tarball.
Use each path relative to the archive's package directory and the SHA-256
of its file content. Keep the entries sorted by path.
