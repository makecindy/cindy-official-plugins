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
- Decide who performs an operation before adding a manifest field. Whether the
  plugin tool runs is decided by existing Agent authorization. Ordinary HTTPS and
  workdir operations use the Host-issued in-flight `callId`; CLIs continue through
  the existing Node worker. Specific commands, hosts, and paths are not pre-registered;
  only autonomous Host use outside that call is declared in `ghost.json`.
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
   same capabilities through their direct fields. The v3 floor is `0.1.61`;
   when a required Host capability or manifest field first appeared in a later
   stable Cindy release, use that later version instead.
   Unchanged v2 plugins are intentionally left alone; do not bulk-migrate them.
   Plugin Server selects the newest previously listed release compatible with the
   user's Cindy version. If the current release is incompatible, an eligible
   historical release is delivered instead; without one, the plugin is hidden.
   Desktop treats that Server selection as authoritative and does not add a
   second `minCindyVersion` filter or install confirmation, so keep this field accurate.
4. When changing `ghost.json` tool declarations (`tools[].description` or
   parameters), explain the impact on Agent behaviour in the pull request
   description — that description is the usage manual the Agent reads.
   Check the production Cindy verification item only after installing every
   changed plugin's packaged `.cindy` on a real device running a stable
   production Cindy build and exercising its core functionality. If a plugin
   declares `minCindyVersion`, that Cindy build must be greater than or equal to
   it. Lowering or removing the field expands claimed compatibility and
   requires maintainer review.

Every non-draft pull request is verified by the `Verify pull request`
workflow: it runs the Server/Desktop delivery contract, localization and
provisioning gates, runs the `*.test.mjs` tests of every changed plugin
(installing that plugin's dependencies first), and dry-runs the exact packaging
step the publish pipeline uses. For every changed plugin package, CI also
requires the production Cindy verification checkbox in the pull request body.
The actual upload still happens only after merge to `main`.

5. Review the complete diff and confirm it contains no credentials, unrelated
   generated files, or an accidentally committed `node_modules`.
6. Wait for review; do not push directly to `main`. After a merge to `main`, the
   regional workflows submit changed packages to Plugin Platform. CN and Global
   review independently; a package becomes visible in a region only after that
   region approves it.
7. Paired bilingual documents move together: a pull request that changes
   `README.md`, `CONTRIBUTING.md`, or any other document with a `.zh-CN`
   counterpart must update both files in the same pull request, and vice
   versa. A pull request that updates only one side will not be merged.

Bug fixes and small improvements are welcome as direct pull requests. For a new
official plugin, open an issue first to discuss positioning and boundaries
(avoiding overlap with existing plugins), then submit a pull request once aligned.

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

Do not disclose vulnerabilities, credentials, or exploitable details in public
issues, pull requests, or discussions. Follow the private reporting process in
[`SECURITY.md`](SECURITY.md).
