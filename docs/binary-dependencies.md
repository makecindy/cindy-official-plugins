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
4. For local development, prepare the declared files and package with Cindy Forge
   or a reviewed explicit file list, as described below. This path needs no Python;
   Forge does not download dependencies for you.
5. Bump the plugin version, commit source, declarations and licenses under the
   contribution rules, and open a Ready PR. Leave device verification unchecked
   until actually verified; that gate failing does not prevent obtaining test packages.
6. Download the PR verification package and test it on a stable or Beta Cindy
   build meeting its minimum version. Record the artifact, version, channel and
   results before checking the attestation. URL/hash/file-selection updates also
   change package content; ensure verification covers the latest contents.

No client installation or first-use download is added. Users download the final
package through the existing OSS/CDN distribution path, not from upstream.

## Migrate an existing bundled binary

These examples target only `my-plugin/vendor/example-cli/`; substitute the actual
target before running a command. Do not delete all of vendor or unrelated dependencies.

1. Inventory the old package's files, platforms, version, licenses and modes.
   Select the matching upstream release and obtain SHA-256 for the original
   download, not its extracted members. System tools include macOS
   `shasum -a 256 archive.zip`, Linux `sha256sum archive.zip`, or PowerShell
   `Get-FileHash archive.zip -Algorithm SHA256`; use lowercase in the declaration.
   Check against trusted upstream release information; downloading successfully
   alone does not establish provenance.
2. Add a declaration mapping archive `source` members to the old package's
   `target` paths. Targets must live under `vendor/<dependency-name>/`; preserve
   old paths when compatible, otherwise update and verify the adapter's paths.
   Set `executable: true` for executable files and keep full licenses tracked.
3. Untrack files that CI will generate, while retaining working copies for development:
   ```bash
   git rm -r --cached -- my-plugin/vendor/example-cli/
   ```
   Add `/my-plugin/vendor/example-cli/` to local `.git/info/exclude` to prevent
   accidentally re-adding them. If that directory contains adapter source or
   licenses that must be committed, untrack/ignore only the specific binaries.
   Do not rewrite Git history; this does not shrink past commits.
4. Keep all six platform outputs locally, matching declared paths, bytes and modes.
   Inspect upstream archives and copy only selected regular files; keep downloads,
   temporary archives and unrelated files outside the plugin directory. Brotli
   encoding is optional; if selected, local outputs must use the same encoding,
   not raw executable bytes masquerading as encoded data.
5. Use `ghost_forge_pack` on the prepared directory, or a reviewed explicit file
   list, for local debugging. Include `ghost.json`, code, resources, dependency
   declaration, licenses and all outputs, plus the repository's `LICENSE`, `NOTICE`,
   `TRADEMARKS.md` and `TRADEMARKS.zh-CN.md`. Never recursively ZIP a credential-bearing
   worktree. Git ignore controls tracking, not necessarily Forge inclusion; inspect
   the archive. Existing Host limits still apply; a local debug package does not
   replace final CI package verification below.
6. Inspect the staged diff: only necessary source, declaration, license, version
   changes and old binary deletions, with no newly downloaded binaries.
   **Ignoring an already tracked file does not stop it entering the archive.**
   A tracked target conflicts with collection and fails CI. After commit, CI
   regenerates the files from the declaration.

For later upgrades, update the version, URL, original archive hash, mappings if
needed, licenses and plugin version together; replace local copies and verify the
latest CI package. Authors maintain source/declarations; the repository builds
dependencies into the package. User devices never fill in missing dependencies.

## Download PR verification packages (no local Python)

1. From a Ready PR's Checks, open the **Verify pull request** run using Details.
   Fork workflows may first need maintainer approval; do not pre-check device
   verification to trigger a build.
2. Wait for **Upload PR verification packages** in **Test and dry-run packaging for
   changed plugins**, then download `pr-plugins-<PR>-<head SHA>-<run id>-<attempt>`
   from the run's Artifacts. Sign in with repository read access. Earlier test or
   packaging failures prevent upload; a failure of only the final attestation
   gate leaves the already-uploaded artifact available.
3. Extract GitHub's outer artifact ZIP. Each changed plugin directory contains
   `plugin.cindy`, `plugin.cindy.sha256` and `source.json`; install the inner `.cindy`,
   not the outer artifact. `source.json` records the plugin directory, PR head,
   base and actual temporary merge commit used for the build. Check that it matches
   the intended latest source, and verify the package SHA-256. These are provenance
   and integrity checks, **not signatures or security certification**. PR packages
   contain unreviewed code; install only with explicit acceptance of that risk,
   never automatically execute them.
4. After device verification, record the artifact/run link, `buildCommit`, package
   SHA-256, Cindy version/channel and exercised behavior in the PR, then check the
   existing attestation. Editing the body reruns checks. A rerun with unchanged
   source and dependency outputs can refer to prior evidence; ZIP timestamp-only
   hash differences do not automatically require retesting. If head/base changes
   affect packaged content, download and verify the new package. CI does not
   automatically prove two packages equivalent.
5. Artifacts expire after 7 days; an authorized contributor can rerun the workflow.
   Documentation-only PRs produce no plugin artifact. Verification packages never
   go to Platform/OSS; after merge, CN/Global independently rebuild and use the
   existing release review flow.

## Optional: reproduce the repository build locally

Only local CI reproduction needs Git, Bash, jq, unzip and Python 3.11+; Brotli
encoding also needs Node. Existing Node validation/test commands retain their own
Node requirements; Python is not a prerequisite for every author's development.
Cindy's bundled plugin runtime does not mean system Node/npm or Python is installed.

After committing source, run at the repository root (reads committed HEAD, not
uncommitted plugin changes):

```bash
.github/scripts/package-plugin.sh my-plugin /tmp/my-plugin.cindy
unzip -l /tmp/my-plugin.cindy
```

The local packager uses local HEAD, PR CI uses a temporary head/base merge, and
publishing uses the merged main commit. Compare actual source, contents and modes,
not merely filenames, when establishing equivalence.

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
  Compression parameters belong to the packager, not the plugin contract.
  The shared collector verifies upstream downloads against the declared `sha256`;
  package integrity verification belongs to the shared distribution and client
  installation flow. Plugins should not add duplicate runtime hash checks for
  bundled binaries, whether compressed or decoded. The adapter selects the platform,
  decodes when needed and invokes the binary; compression tuning must not require
  changes to plugin verification data. This does not remove the shared download
  checks, package checks or runtime decoding limits.
- Paths are relative and cross-platform safe. Traversal, links, special files,
  duplicate/case-conflicting entries and encrypted ZIPs are rejected. Archives
  are inspected without extracting their supplied paths into the workspace.
- The declaration remains in the final package as build provenance. Cindy does
  not process it at installation. Forge does not collect dependencies; prepare
  local outputs first. Repository releases use the CI collector.
- Manifest entry/resource references may defer to an exact declared output
  instead of a tracked file. The final package must contain it; merely listing
  a target cannot make missing output pass. Locale, Skill and Manual content
  still uses the existing tracked-source checks.

## ZIP / tar.gz and platform example

This is a complete all-platform ZIP declaration shape, again with placeholders
that must not be downloaded as-is. One upstream archive containing all six
variants needs one URL and six mappings. Commit the license text separately.

```json
{
  "schemaVersion": 1,
  "dependencies": [
    {
      "name": "example-cli",
      "version": "1.2.3",
      "license": "THIRD-PARTY-LICENSES.txt",
      "assets": [
        {
          "url": "https://downloads.example.com/example-cli/v1.2.3/all-platforms.zip",
          "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
          "format": "zip",
          "files": [
            {
              "source": "release/darwin-x64/example-cli",
              "target": "vendor/example-cli/darwin-x64/example-cli",
              "executable": true
            },
            {
              "source": "release/darwin-arm64/example-cli",
              "target": "vendor/example-cli/darwin-arm64/example-cli",
              "executable": true
            },
            {
              "source": "release/linux-x64/example-cli",
              "target": "vendor/example-cli/linux-x64/example-cli",
              "executable": true
            },
            {
              "source": "release/linux-arm64/example-cli",
              "target": "vendor/example-cli/linux-arm64/example-cli",
              "executable": true
            },
            {
              "source": "release/windows-x64/example-cli.exe",
              "target": "vendor/example-cli/windows-x64/example-cli.exe",
              "executable": true
            },
            {
              "source": "release/windows-arm64/example-cli.exe",
              "target": "vendor/example-cli/windows-arm64/example-cli.exe",
              "executable": true
            }
          ]
        }
      ]
    }
  ]
}
```

For an upstream `.tar.gz` with equivalent contents, use its actual URL, set
`format` to `tar.gz`, replace SHA with that archive's hash and set `source`
to actual member paths. For separately distributed platforms, split the asset
into entries with their own URL, SHA, format, files and `platforms` (for example,
`["darwin-x64", "darwin-arm64"]`), covering all six together. Do not duplicate
one download or omit platforms to pretend a single-platform binary is portable.
The adapter selects these package paths by OS/architecture; no Cindy registry change is needed.

Common failures:

- Existing target: check whether Git still tracks the old binary; collection never overwrites source.
- Missing platforms: each dependency must cover the full set, not only the development machine.
- SHA mismatch: hash the original download; never accept different bytes without checking provenance.
- Missing source: inspect archive members instead of guessing names or using globs.
- Works locally, fails CI: check uncommitted source/licenses, local-only dependencies, path case and modes.

## Limits and failure behavior

The collector prints `[timing]` JSON lines for `source_archive`, `download_verify`
(network transfer and SHA-256 verification), `extract`, `brotli`, `zip_source`,
`zip_dependency`, `validate_package`, `assemble_total` and `package_total`.
Each record includes monotonic `elapsed_s` and `status` (`ok` / `failed`), plus
dependency/asset/file identifiers where applicable; URLs and response bodies are
not logged. Total stages include their child stages: do not add totals to the
per-stage durations. Timings are logs only and do not enter the package.

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

## Implementation choice and boundaries

Retaining Python minimizes maintenance for this repository step; it is not a
claim of universal language superiority:

- Python's standard library covers downloading, SHA and ZIP/tar; reuse the existing
  implementation and regression coverage. The repository already had Python
  packaging scripts. Optional Brotli uses a fixed Node built-in module, not author hooks.
- Node aligns with JS code, but under the current version/requirements needs archive
  dependencies or system tools. npm/pnpm manage dependencies/scripts, not the
  collector itself; not every author can be assumed to have them installed.
- Rust suits a separately distributed CLI but adds compilation, caching or
  prebuilt-tool maintenance here.
- CI-only use imposes no local interpreter setup; local reproduction does. End users
  have no new tooling requirements.

Keep HTTPS, public-address checks including redirects, time/size limits and SHA
verification; do not add a separate domain-allowlist registry at this stage.
A public hosting domain does not make every hosted project trustworthy. Maintainers
still review actual provenance, versions, hashes and licenses. Build checks neither
add runtime permission mechanisms nor prove binary behavior safe.

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
