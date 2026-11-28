<p align="right">
  <a href="CONTRIBUTING.zh-CN.md">简体中文</a> · <strong>English</strong>
</p>

# Contributing

Thank you for contributing code, documentation, and feedback to Cindy's official
plugins. This repository holds the source of the official plugins (Ghosts); each
subdirectory is one complete plugin. The Cindy client and the Plugin Server are
maintained in separate repositories and are outside the scope of this repository.

## Before you start

- Read [`README.md`](README.md) first. It is the source of truth for the
  repository layout, the plugin list, the review standards, and the publish
  flow; this guide does not duplicate them.
- The repository's source, validation, and publishing contract lives here:
  `README.md`, this guide, the pinned Manifest validator under `.tests/contracts/`,
  and the packaging checks. It is independent of the Agent or harness used to create
  the files. Cindy Forge commands are optional shortcuts only.
  For Host API details, follow the target version's bundled reference through the
  [version and capability map](docs/plugin-authoring.md#target-host-reference-and-capability-map).
- Use the [authoring and migration reference](docs/plugin-authoring.md) for
  field mappings and concrete runtime calls. The implementing Agent handles
  adaptations from existing code; authors do not need to supply migration steps.
- Decide who performs an operation before adding a manifest field. Whether the
  plugin tool runs is decided by existing Agent authorization. Ordinary HTTPS and
  workdir operations use the Host-issued in-flight `callId`; CLIs continue through
  the existing Node worker. Specific commands, hosts, and paths are not pre-registered;
  autonomous Host use outside that call requires the corresponding declaration.
  Bundled Node entries and Host-managed credentials remain explicitly declared,
  including when used inside a tool call.
- Follow [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) when participating in
  the community. For ordinary usage questions, see [`SUPPORT.md`](SUPPORT.md).
- Do not commit credentials, tokens, mailbox authorization codes, OAuth refresh
  tokens, personal data, or real user mail content. Test fixtures must use
  placeholder domains such as `example.test` / `git.example.com` and dummy UUIDs.

## Development and verification

Start with the
[harness-independent quick path in `README.md`](README.md#harness-independent-quick-path):

1. Align the design and minimum capabilities, verify the target Host version,
   and choose a user-supplied icon or obtain consent before generating one.
   Then create a new root-level plugin directory using ordinary file operations.
2. Start from the documented Manifest-v3 and `main.js` examples. Do **not** copy
   an existing official plugin's `ghost.json`: unchanged official plugins may
   intentionally retain legacy v2 manifests. Existing source may be consulted
   only for implementation patterns.
3. Validate the Manifest with
   `node scripts/validate-plugin-manifest.mjs ./<plugin-directory>`.
4. Package the directory contents—not the directory itself—as a `.cindy` ZIP
   archive and import that exact package through Cindy's local plugin entry.
5. If the chosen harness exposes Cindy Forge commands, they may replace the
   manual scaffold/package steps, but they do not change the source format or
   the review contract. Installation still requires an explicit user request.
   Do not retain a scaffold placeholder icon. Official repository changes are
   published through PRs; client community submission and organization publishing
   are separate paths, not substitutes for an official-plugin PR.
6. Before opening an official-plugin PR, add the `provisioning.json` entry and
   complete exactly four locale resources: `zh-CN`, `en`, `ja`, and `ko`.

For large prebuilt dependencies, follow the [dependency guide](docs/binary-dependencies.md):
retain local outputs for debugging, commit only source/declarations/licenses,
and let CI download and package. Python is not a local development prerequisite.
You may open a Ready PR to obtain test packages from **Verify pull request**
Artifacts (retained 7 days, unreviewed, never pushed to Platform/OSS).

**What happens after submission:**

- **Verify pull request** runs with read-only permissions (no publishing
  secrets) and checks manifest contracts, locales, provisioning, changed-plugin
  tests, and dry-run packaging. First-time fork runs may wait for maintainer
  workflow approval.
- **PR contributor guidance** maintains one comment for DCO and fork-run status.
  It reads metadata only and never executes PR code.
- **Tiered merge (L1 / L2 / L3)**: routine updates to existing plugins (L1 —
  especially by maintainers or plugin owners listed in
  `.github/plugin-owners.json`) merge directly once CI is green, Greptile
  approves, and Codex reports no P0/P1 defects. Manual Cindy device testing is
  not a merge gate; release QA happens on Global Plugin Platform after merge.
  Boundary changes (L2: new plugins, `audience: "all"`, widened permissions/hosts,
  or unready OAuth/host grants) and repo governance changes (L3) require
  maintainer confirmation.

See the [review contract](.greptile/rules.md) for the complete decision rules.

The `*.test.mjs` files under `.tests/` run on Node's built-in test runner:

```bash
node --test .tests/localization.test.mjs
```

The `*.test.ts` files under `.tests/` are written for vitest, which this
repository does not currently wire up (there is no root `package.json`). They
are archived until a runner is configured and cannot be run as-is.

After changing any plugin's `ghost.json` or `locales/`, you **must** run
`node --test .tests/localization.test.mjs`. The publish pipeline runs the same
check before packaging, and incomplete four-language resources (`zh-CN` / `en` /
`ja` / `ko`) fail the entire publish.

CI also checks every `ghost.json` and validates the exact `.cindy` archive
against the Server/Desktop delivery limits (including text lengths, declared
files, safe paths, package sizes, and entry count). These checks live entirely
in this repository, so contributors do not need another repository checkout.

For plugins with a Node Worker (`163-mail`, `icloud-mail`, `qq-mail`),
`node/worker.cjs` is an esbuild artifact — do not edit it by hand. After changing
`src/`, rebuild in the plugin directory and commit the artifact along with the
source:

```bash
cd 163-mail && npm ci && npm run build
```

If the change adds or upgrades a bundled dependency, update that plugin's
`THIRD-PARTY-LICENSES.txt` as well (every bundled package, its version, and the
full license text; for dual-licensed packages state which license is elected).

`taptap-maker/vendor/taptap-maker/` ships the official `@taptap/maker` npm package
with the plugin. When upgrading, replace the published package content wholesale —
do not edit the generated `dist/maker.js` by hand.

## Opening a pull request

1. Create a short-lived branch from the latest `main` and keep each pull request
   focused on one clear problem.
2. Use `<type>(<scope>): <short description>` for the pull request title, with the
   plugin directory as the scope — for example
   `fix(qq-mail): validate the move result`. Available types: `feat`, `fix`,
   `refactor`, `perf`, `chore`, `docs`, `test`, `revert`, `build`, `ci`.
3. **Do not downgrade `ghost.json.version` below `main`.** Manual patch bumps
   are optional for routine plugin updates — `.github/scripts/package-plugin.sh`
   automatically computes a strictly increasing `major.minor.patch` SemVer on
   `main` when `ghost.json.version` is unchanged (eliminating version-bump merge
   conflicts across parallel PRs). Bump `ghost.json.version` manually when you
   want an explicit minor or major version jump.
   The same change must migrate an existing schema-v2 manifest to
   `schemaVersion: 3`: add `minCindyVersion`, remove `slots`, and express the
   same capabilities through their direct fields. Follow the
   [mapping table](docs/plugin-authoring.md#manifest-v2-to-v3-preserve-behavior-change-representation),
   retaining presence-only capabilities such as `card` and `sessionContext`;
   deleting `slots` alone is not a complete migration. Set `minCindyVersion` to the
   first published Cindy (stable or Beta) release that supports the concrete plugin's required Host
   capabilities and manifest fields; Manifest v3 has no repository-wide Cindy
   version floor.
   Unchanged v2 plugins are intentionally left alone; do not bulk-migrate them.
   Plugin Server selects the newest previously listed release compatible with the
   user's Cindy version. If the current release is incompatible, an eligible
   historical release is delivered instead; without one, the plugin is hidden.
   Desktop treats that Server selection as authoritative and does not add a
   second `minCindyVersion` filter or install confirmation, so keep this field accurate.
   Release notes in `ghost.json.releaseNotes` are **optional, but recommended**
   for version updates. If included, use a plain-text string describing the
   changes; missing or empty notes do not block validation or publication.
   See the [release-note reference](docs/plugin-authoring.md#release-notes-optional-recommended).
4. When changing tool declarations, note any Agent-facing behavior changes and
   include the automated tests you ran. Manual Cindy client verification is not
   a merge gate for routine updates. If you change OAuth scopes or depend on an
   unready Cindy host authorization, list the scope, platform approval, and host
   release status in the PR description.

Every non-draft PR's **Verify pull request** runs the Server/Desktop contract,
localization, provisioning, changed-plugin tests and actual dry-run packaging.
CN uploads remain removed; merging or manually dispatching from main submits
Global pending releases.

5. Review the complete diff and confirm it contains no credentials, unrelated
   generated files, or an accidentally committed `node_modules`.
6. Wait for review; do not push directly to `main`. After merge, changed packages
   are submitted to Global Plugin Platform. Approval is required before a release
   becomes visible to compatible clients. CN submission remains removed.
7. Paired bilingual documents move together: a pull request that changes
   `README.md`, `CONTRIBUTING.md`, or any other document with a `.zh-CN`
   counterpart must update both files in the same pull request, and vice
   versa. A pull request that updates only one side will not be merged.

Bug fixes and small improvements are welcome as direct PRs (L1 fast-lane).
New plugins, built-in providers, and audience changes require **no prior
proposal approval** — you can open a PR directly (a proposal issue or Draft PR
is optional), and maintainers confirm the L2 boundary during PR review against
the standard below.

### Admission and audience

Apply this uniformly. When a useful plugin does not clearly earn `all`, accept
it as opt-in instead of waiting for a case-by-case decision.

1. `audience: "all"` (installed for everyone): most users benefit; works out of
   the box with no self-obtained third-party key or account; not tied to one
   person's or one team's workflow; stable quality. Popularity or many
   submissions alone never justify `all`.
2. Accept as opt-in (provisioning audience `{ "emails": [] }`; users choose it
   in the marketplace): useful but niche, or needs the user's own key or account.
3. Not accepted: very personal (serves only the author's own data, workflow, or
   private service), a pure demo or sample (put it in `docs/` instead), or
   something the agent can already do directly without a plugin.

The `author` field must be the real author, not an impersonation of the official
team. A mismatch is a concrete review finding. L2 boundary confirmations (new
plugins, widening to `all`, permission/credential/autonomous-host/subprocess
widening) and L3 repository governance changes (`.github/workflows/**`,
`.greptile/**`, `AGENTS.md`, `.github/plugin-owners.json`, weakening `.tests/`
gates, renaming or deleting a published plugin) require maintainer confirmation
or approval before merge.

## Licensing of contributions (DCO)

This repository is licensed under [Apache-2.0](LICENSE). Per Section 5 of the
license, any contribution you intentionally submit for inclusion is accepted
under the Apache-2.0 terms — no separate CLA is required.

We do require every commit to carry a
[Developer Certificate of Origin](https://developercertificate.org/) sign-off
(DCO 1.1; the full text is in the [`DCO`](DCO) file at the repository root):
commit with `git commit -s`, which appends a
`Signed-off-by: Your Name <your@email>` trailer stating that you have the right
to submit the contribution under these terms. Both the name and the address in
the trailer must match the commit's author (or committer) — the trailer is a
statement about yourself and cannot be made on someone else's behalf. Do not
submit code you are not entitled to license (for example proprietary code copied
without permission).

The **DCO check** on every pull request (the
[DCO GitHub App](https://github.com/apps/dco)) validates each commit in the pull
request; merge commits and bot commits are exempt, and history from before the DCO
requirement is never examined. You can check locally that each commit's author and
sign-off line up:

```bash
git log origin/main..HEAD --format='%h %an <%ae>%n  %(trailers:key=Signed-off-by,valueonly)'
```

If a commit is missing its sign-off:

```bash
# only the most recent commit is missing a sign-off
git commit --amend -s --no-edit

# several commits are missing sign-offs (<base> is the pull request base commit)
git rebase --signoff <base>

# update the pull request afterwards
git push --force-with-lease
```

If you would rather not rewrite history — say the pull request already carries
review discussion worth keeping — push a **remediation commit** instead. Its
message must contain the following line verbatim, where the sha is the full
40-character sha of the commit being signed off, and the remediation commit itself
must also carry your sign-off:

```text
I, Your Name <your@email>, hereby add my Signed-off-by to this commit: <full 40-char sha>

Signed-off-by: Your Name <your@email>
```

The author of both commits, and the name and address on that line, all have to
match exactly. To sign off on someone else's commit:

```text
On behalf of Author Name <author@email>, I, Your Name <your@email>, hereby add my Signed-off-by to this commit: <full 40-char sha>

Signed-off-by: Your Name <your@email>
```

Git has no configuration option that signs commits off automatically
(`format.signOff` only affects `git format-patch` / `git am`), so either pass `-s`
every time or install your own `prepare-commit-msg` hook.

## Security issues

### Prebuilt dependencies

Use [binary-dependencies.json](docs/binary-dependencies.md) for build-time
collection of large dependencies; small binaries may still be committed directly.
CI caps directly tracked binaries at 10 MiB combined per plugin, across all
platforms. New plugins and binary additions/modifications trigger the check;
source/docs-only edits and binary deletions do not force legacy migrations.
Both paths retain license/review/package-size requirements.
Custom build hooks are not accepted.
Dependency declaration changes require a plugin version bump and review of
provenance, hashes and redistribution licenses. Routine maintenance can be reviewed
automatically; real permission/trust expansion or missing evidence needs maintainer
attention.
`node --test .tests/binary-dependencies.test.mjs` runs the offline packaging
regressions; PR CI also dry-runs the actual changed packages. Downloads and
packaging run separately from the OIDC publishing job.

Do not disclose vulnerabilities, credentials, or exploitable details in public
issues, pull requests, or discussions. Follow the private reporting process in
[`SECURITY.md`](SECURITY.md).
