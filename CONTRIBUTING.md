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
  repository layout, the plugin list, the four design principles, and the publish
  flow; this guide does not duplicate them.
- The complete plugin-authoring contract (all `ghost.json` fields, slots, the
  `cindy.send` pipe API, the packaging flow) is defined by the manual returned by
  the `ghost_forge_guide` tool built into the Cindy client — just say "help me
  build a plugin" in a Cindy conversation to get the current version.
- Follow [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) when participating in
  the community. For ordinary usage questions, see [`SUPPORT.md`](SUPPORT.md).
- Do not commit credentials, tokens, mailbox authorization codes, OAuth refresh
  tokens, personal data, or real user mail content. Test fixtures must use
  placeholder domains such as `example.test` / `git.example.com` and dummy UUIDs.

## Development and verification

Typical flow:

1. Scaffold with the client's `ghost_forge_scaffold`, or copy the layout of any
   plugin in this repository.
2. In a dev environment, import the plugin directory or a `.cindy` package
   directly for verification.
3. When done, package it with `ghost_forge_pack` into a `.cindy` and install it to
   verify.

The `*.test.mjs` files under `.tests/` run on Node's built-in test runner:

```bash
node --test .tests/localization.test.mjs
```

The mail plugins (`163-mail`, `icloud-mail`, `qq-mail`) have their own test
files that require the plugin's dependencies first:

```bash
cd 163-mail && npm ci && cd ..
node --test .tests/163-mail.test.mjs
```

After changing any plugin's `ghost.json` or `locales/`, you **must** run
`node --test .tests/localization.test.mjs`. The publish pipeline runs the same
check before packaging, and incomplete four-language resources (`zh-CN` / `en` /
`ja` / `ko`) fail the entire publish.

## Audience registration (provisioning.json)

`provisioning.json` at the repository root controls who gets each official
plugin installed by default. **A plugin directory that is not registered here
is seeded to every user on merge** — that is the host's default, not an
explicit choice. Every pull request that adds a plugin directory must register
it in the same pull request, and `.tests/provisioning.test.mjs` fails the
build otherwise.

`audience` values:

- `"all"` — install for everyone.
- `{ "userIds": [...], "emails": [...] }` — install only for the listed users;
  either dimension matching is enough. Targeted installs land at login and are
  reclaimed on logout or when the user no longer matches.
- `{ "userIds": [], "emails": [] }` — install for no one. Use this to stage a
  plugin: merge the code safely, then widen the audience in a follow-up once a
  maintainer signs off.

The marketplace is public and `"all"` is the normal choice for any plugin
meant for general availability. If a plugin spends the user's real money or
credentials (paid API quotas, metered calls, OAuth grants), say so plainly in
its `ghost.json` `description` so users see the cost before installing — the
audience stays `"all"`.

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
   pull request.** Publishing different content under the same version is rejected
   by the server with `RELEASE_VERSION_CONFLICT` and will not overwrite an existing
   release.
4. When changing `ghost.json` tool declarations (`tools[].description` or
   parameters), explain the impact on Agent behaviour in the pull request
   description — that description is the usage manual the Agent reads.

Every non-draft pull request is verified by the `Verify pull request`
workflow: it runs the localization and provisioning gates, runs the `*.test.mjs`
tests of every changed plugin (installing that plugin's dependencies first),
and dry-runs the exact packaging step the publish pipeline uses. The archived
`*.test.ts` files are skipped — they target vitest, which this repository does
not wire up (see [`README.md`](README.md#repository-layout)). The actual upload
still happens only after merge to `main`.

Tip: `gh repo clone -- --depth N` creates a single-branch shallow clone whose
refspec only fetches `main`; `gh pr create` then fails with "must first push
the current branch" until you run
`git config --add remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'`
and `git fetch`. Plain `git clone --depth 1` does not have this problem.
5. Review the complete diff and confirm it contains no credentials, unrelated
   generated files, or an accidentally committed `node_modules`.
6. Wait for review; do not push directly to `main`. After a merge to `main`, the
   publish workflow syncs the changed plugins to the Cindy marketplace
   automatically.

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
