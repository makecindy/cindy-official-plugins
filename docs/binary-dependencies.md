# Build-time binary dependencies

[中文](binary-dependencies.zh-CN.md)

Plugins may declare prebuilt resources in `binary-dependencies.json`, next to
`ghost.json`. Authors maintain the declaration, adapter code and redistribution
licenses; the repository packager downloads and verifies the resources. Cindy
still installs an ordinary, self-contained `.cindy` archive.

This is a packaging convention, **not a new Manifest/runtime permission**.
The collector does not run dependencies, install packages, compile source, or
accept plugin build hooks. Existing runtime authorization remains unchanged.

This mechanism is opt-in, not mandatory for every binary. Small binaries (up to
10 MiB combined per plugin, across all platforms) may remain tracked and be archived normally, subject to the same
license/review and total package limits. No dependency declaration or Python is
required for that path. Untouched legacy large files are not forcibly migrated.

## Author workflow

1. Select a fixed upstream release, inspect its provenance and redistribution
   terms, and obtain the SHA-256 of each original download.
2. Commit the declaration, adapter code and full applicable license texts. Do not
   commit large binaries. `THIRD-PARTY-LICENSES.txt` must be present; each
   dependency's `license` points to a nonempty tracked file containing its terms.
3. Declare each upstream download once. Shared resources need one URL/hash;
   platform-specific downloads declare which targets they cover. Together they
   must support macOS, Linux and Windows, each x64 and arm64. All resources go
   into one distributable; the adapter selects variants at runtime if needed.
   The packager checks declared coverage, not whether a binary actually runs.
4. After committing the source, run from the repository root (Git, Bash and
   Python 3.11+ required):
   ```bash
   .github/scripts/package-plugin.sh my-plugin /tmp/my-plugin.cindy
   unzip -l /tmp/my-plugin.cindy
   ```
5. Validate the exact package on a supported stable or Beta Cindy build, bump the
   plugin version, and submit it under the existing contribution/review process.
   Changing a pinned URL, hash or file selection changes package content too.

No client installation or first-use download is added. Users download the final
package through the existing OSS/CDN distribution path, not from upstream.

## Declaration

The following is a **shape example**, not a working dependency. Replace every
example URL and zero hash with reviewed release URLs and actual archive hashes.
This example uses one portable resource shared by all platforms. There are no
templates, shell expansions or glob patterns; single-platform plugins remain unsupported.

```json
{
  "schemaVersion": 1,
  "dependencies": [
    {
      "name": "example-wasm",
      "version": "1.2.3",
      "license": "THIRD-PARTY-LICENSES.txt",
      "assets": [
        {
          "url": "https://downloads.example.com/example-wasm/v1.2.3/module.wasm",
          "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
          "format": "file",
          "files": [
            {
              "target": "vendor/example-wasm/module.wasm"
            }
          ]
        }
      ]
    }
  ]
}
```

- `schemaVersion`: exactly `1`; unknown fields are rejected.
- `dependencies`: 1–16 uniquely named dependencies. `version` is a fixed release
  label, not `latest`, `main`, `master` or `HEAD`; it is metadata, not a URL
  template. SHA-256 locks actual bytes even if upstream changes a URL.
- `assets`: 1–32 actual upstream downloads per dependency. Each entry is downloaded
  once and can select multiple files from an archive. One all-platform archive
  therefore needs one URL/hash, not six copies of the declaration.
- Optional asset `platforms`: a nonempty list drawn from `darwin-x64`,
  `darwin-arm64`, `linux-x64`, `linux-arm64`, `windows-x64`, `windows-arm64`.
  Omit it to declare a resource shared by all platforms or an archive containing
  all variants. For example, a macOS archive containing both architectures uses
  `"platforms": ["darwin-x64", "darwin-arm64"]`; other assets must cover Linux
  and Windows. Each dependency must cover all six targets overall. This is an
  author's support declaration, not executable-format detection. Every asset is
  included regardless of the build machine; no platform-specific package is produced.
- `url`: public HTTPS on port 443, without credentials or fragments. Private,
  loopback and link-local destinations are rejected, including redirect targets.
  Downloads do not use local proxy, netrc, cookie or authorization credentials.
- `sha256`: 64 lowercase hexadecimal characters, hashing the **downloaded
  archive/file**, before decompression.
- `format`: `file`, `zip` or `tar.gz`. For an archive, each `source` names an
  exact regular member. A conventional leading `./` in tar members is accepted.
  For `file`, use exactly one mapping and omit `source`.
- `files`: 1–32 mappings per asset. `target` must be below
  `vendor/<dependency-name>/`; platform subdirectories are recommended but not required.
  Nothing may overwrite committed files
  or another output. `executable: true` writes mode 0755; otherwise 0644.
  The adapter must handle the client's existing extraction/execution behavior.
- Optional `encoding: "brotli"` encodes the selected file using the repository's
  Node built-in Brotli encoder (quality 11, a five-minute limit per file).
  Omit it or use `"identity"` to copy bytes unchanged. Encoded output is data,
  cannot be marked executable, and must be decoded by the plugin at runtime.
  This is a fixed data transformation, not an author script or build hook.
  Input bounds remain in force; package limits count the encoded files actually shipped.
- Paths are relative and cross-platform safe. Traversal, links, special files,
  duplicate/case-conflicting entries and encrypted ZIPs are rejected. Archives
  are inspected without extracting their supplied paths into the workspace.
- The declaration remains in the final package as build provenance. Cindy does
  not process it at installation. Forge does not implement this collection step;
  use the repository packager for plugins with this declaration.
- Manifest entry/resource references may defer to an exact declared output
  instead of a tracked file. The final package must contain it; merely listing
  a target cannot make missing output pass. Locale, Skill and Manual content
  still uses the existing tracked-source checks.

## Limits and failure behavior

Delivery limits: up to 256 ZIP entries; Node packages
up to 128 MiB compressed and 256 MiB expanded, other packages up to 8 MiB compressed and 32 MiB
expanded. These limits include all platforms and existing plugin contents. A
dependency that cannot fit requires a separate delivery decision, not bypassing
the limit or publishing a single-platform package.

These are packaging limits, not a guarantee that every server or client download path
accepts that size. Before publishing packages beyond the old 64 MiB server limits,
the corresponding server limit change must be deployed. The current client market downloader still caps packages at
8 MiB; reconciling that limit is a separate client task, not part of this change.

Each download is capped at 128 MiB, each dependency archive at 4,096 entries and
256 MiB expanded (including the full tar stream), and configuration at 256 KiB.
Downloads have bounded socket waits, a 120-second transfer deadline and at most
five redirects; CI also bounds the packaging job. There is no persistent binary
cache in this first version. Missing files/platforms, bad hashes, unavailable
downloads or exceeded limits fail the entire package. Temporary data is cleaned
up, and an existing output is replaced only after successful assembly.

Plugins without a declaration do not download anything and retain the original
`git archive` bytes. Plugin source and dependency declarations come from committed
`HEAD`; fixed repository legal documents are added as before.

PR CI limits directly tracked binary content to **10 MiB combined per plugin**:
- Count every tracked binary path in that plugin, including unchanged files,
  icons, archives and all platform variants; splitting files does not evade the cap.
- Inspect committed bytes: NUL bytes or invalid UTF-8 mark binary content.
  Text source/docs are excluded; filenames and `.gitattributes` cannot override detection.
- Build-time downloads and untracked files do not count toward this Git limit;
  the final package limits still apply separately.
- Check new plugins and plugins with added/modified binaries. Unchanged legacy
  binaries are grandfathered for source/docs-only changes and binary deletions.
  Once a binary is added/modified, the whole remaining binary total must fit.

## Reproduce the packaging checks

`node --test .tests/binary-dependencies.test.mjs` covers raw files, ZIP/tar.gz,
unsafe members, missing outputs, bad hashes, all-platform assembly, atomic
failure, small tracked binaries and the legacy path without Python.

Opt into an actual HTTPS round-trip with:

```bash
CINDY_BINARY_LIVE_SMOKE=1 node --test .tests/binary-dependencies.test.mjs
```

It uses an isolated temporary Git fixture and a commit/hash-pinned MDN
WebAssembly resource with its CC0 license. It downloads and packages that shared
resource once, checks the final archive, and cleans up. It never installs a plugin, executes a
dependency, changes a real plugin or publishes a release. This verifies packaging,
not native execution on six operating-system/architecture combinations.

## CI and trust boundary

PR CI runs offline collector regression cases and dry-runs changed plugins using
the same packager. CN and Global retain independent publishing workflows. Each
workflow packages in a job with read-only repository access, no persisted checkout
credentials, no release secrets and no OIDC permission. Its immutable artifact
contains the complete package, SHA-256, source commit and plugin directory.

A separate publishing job obtains that run's artifact, checks its identity and
digest, and uploads it through the existing Platform/OIDC path. It does not check
out the repository, fetch dependencies or run plugin/build code. A failed package
has no artifact and cannot publish; other successful plugins can proceed.

This reduces exposure of publishing credentials; it is **not a claim that
downloaded binaries are safe**. SHA-256 verifies selected bytes, not their
behavior. Dependency/URL/hash/license changes require maintainer review, and
regional Platform approval remains in place. Existing PR plugin tests may still
execute source code; this mechanism adds no author-controlled lifecycle hooks.
