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
- The plugin-authoring contract lives in this repository: `README.md`, this
  guide, the pinned Manifest validator under `.tests/contracts/`, and the
  packaging checks. It is independent of the Agent or harness used to create
  the files. Cindy Forge commands are optional shortcuts only.
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

1. Align the design and minimum capabilities, then create a new root-level
   plugin directory using ordinary file operations.
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
6. Before opening an official-plugin PR, add the `provisioning.json` entry and
   complete exactly four locale resources: `zh-CN`, `en`, `ja`, and `ko`.

For large prebuilt dependencies, follow the [dependency guide](docs/binary-dependencies.md):
retain local outputs for debugging, commit only source/declarations/licenses,
and let CI download and package. Python is not a local development prerequisite.
You may open a Ready PR to obtain test packages from **Verify pull request**
Artifacts. They expire after 7 days, are unreviewed and never go to Platform/OSS.
Tests and packaging must pass. CI no longer fails on a device checkbox or exempts
authors by identity. Reviewers assess actual runtime evidence for affected paths;
authors or maintainers may supply it. Green CI does not prove runtime testing.

**What happens after submission:**

- **Verify pull request** runs on source pushes with read-only permissions and no
  publishing secrets. A first-time fork run may need maintainer approval; this is
  a maintainer action, not a code change for the author.
- **PR contributor guidance** maintains one comment for DCO and fork-run actions,
  recomputing from current commits and accepting DCO remediation without rewriting
  history. It reads metadata only and never executes PR code.
- PR edits refresh guidance and validation (including target-branch changes).
  Put verification in the body or a linked comment: actual version/environment,
  exercised paths and gaps. No fixed wording, checkbox or copied artifact hash is
  required. Explain applicability across the full diff since reused evidence;
  affected behavior still needs verification.
- Once required checks, effective review, and runtime evidence are satisfied,
  already-authorized merge automation may execute without asking again.
  Packaging scripts, dependency updates, or images do not require manual
  approval just because of their paths. Admission and audience that fit the
  standard below need no separate maintainer approval. Real permission,
  credential, or publish-trust widening, undisclosed network access, and
  renaming or deleting a published plugin still need the maintainers' explicit
  decision for that scope. A plugin pull request also records any Cindy host
  authorization it uses: which grant, whether the platform has approved it, and
  whether a host release contains it. If that grant changed or is not ready, do
  not merge. Other changes that fit the existing standard are still judged
  directly.
- Before merging, verify the current target and combined result. Retargeting a PR
  requires fresh validation; checks for its previous target are insufficient.
  Merge and public release are separate stages.

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
3. **Any change to plugin content must bump `ghost.json`'s `version` in the same
   pull request.** The new `major.minor.patch` SemVer must be greater than the
   version on `main`; otherwise CI blocks the pull request.
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
4. Explain the Agent-facing impact of changed tool declarations. Supply actual
   verification for affected paths; reuse valid evidence for unaffected ones,
   with accurate environments and compatibility limitations. Lowering/removing
   `minCindyVersion` still needs the maintainers' review and old-version evidence.
   Besides scopes the plugin itself requests, name any Cindy host authorization
   it uses or depends on, whether the platform has approved it, and whether a
   host release contains it. If that grant changed or is not ready, do not
   merge. Plan the scopes that still need requesting together, and do not
   request unused ones. Only this platform-gated authorization waits.

Every non-draft PR's **Verify pull request** runs the Server/Desktop contract,
localization, provisioning, changed-plugin tests and actual dry-run packaging.
There is no device-checkbox parsing or identity exemption. CN uploads remain
removed; merging or manually dispatching from main submits Global pending releases.

5. Review the complete diff and confirm it contains no credentials, unrelated
   generated files, or an accidentally committed `node_modules`.
6. Wait for review; do not push directly to `main`. After merge, changed packages
   are submitted to Global Plugin Platform. Approval is required before a release
   becomes visible to compatible clients. CN submission remains removed.
7. Paired bilingual documents move together: a pull request that changes
   `README.md`, `CONTRIBUTING.md`, or any other document with a `.zh-CN`
   counterpart must update both files in the same pull request, and vice
   versa. A pull request that updates only one side will not be merged.

Bug fixes and small improvements are welcome as direct PRs. New plugins,
built-in providers, and audience changes are judged by the standard below. A
match needs no separate maintainer approval. A proposal issue or Draft PR may
record design notes; it is not an approval gate, and no duplicate proposal is
required.

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
team. A mismatch is a concrete review finding. Only a genuine boundary expansion
needs the maintainers' explicit decision: real permission, credential, or
publish-trust widening; undisclosed network access; renaming or deleting a
published plugin.

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
