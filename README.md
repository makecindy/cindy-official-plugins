# Cindy Official Plugins

<p align="center">
  <strong>English</strong> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License" /></a>
  <a href="https://github.com/makecindy/cindy-official-plugins/actions/workflows/pr-verify.yml"><img src="https://github.com/makecindy/cindy-official-plugins/actions/workflows/pr-verify.yml/badge.svg" alt="Verify pull request" /></a>
  <a href="https://github.com/makecindy/cindy-official-plugins/actions/workflows/publish-cindy-plugins.yml"><img src="https://github.com/makecindy/cindy-official-plugins/actions/workflows/publish-cindy-plugins.yml/badge.svg" alt="Publish (CN)" /></a>
  <a href="https://github.com/makecindy/cindy-official-plugins/actions/workflows/publish-cindy-plugins-global.yml"><img src="https://github.com/makecindy/cindy-official-plugins/actions/workflows/publish-cindy-plugins-global.yml/badge.svg" alt="Publish (Global)" /></a>
  <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs welcome" /></a>
</p>

<p align="center">
  🌐 <a href="https://cindy.app">International</a> | <a href="https://cindy.cn">Mainland China</a>
  &nbsp;·&nbsp;
  ⬇️ <a href="https://cindy.app/#download">Download</a> | <a href="https://cindy.cn/#download">下载</a>
</p>

This is the source for every official plugin (Ghost) in the
[Cindy](https://github.com/makecindy/cindy) plugin marketplace.

- **Using Cindy?** You don't need this repository — open **Plugins** in the
  Cindy client and install any generally available plugin below with one click
  (rows marked "targeted rollout" are still being staged and not yet
  installable for everyone).
- **Want to build a plugin?** This repository accepts external contributions.
  Once your PR merges to `main`, the plugin is published to the marketplace
  automatically — usually live within minutes. Start at
  [Submit your plugin](#submit-your-plugin).

## Plugins

|  | Plugin | Directory | Description |
| --- | --- | --- | --- |
| <img src="./cindy-art/assets/icon.png" width="22" alt=""> | Art | [`cindy-art`](./cindy-art) | Image / short-video generation, with edits and restyling based on previously generated images |
| <img src="./cindy-github/assets/icon.png" width="22" alt=""> | GitHub | [`cindy-github`](./cindy-github) | Full GitHub workflow: issues / PRs / code review / Actions / releases |
| <img src="./cindy-gitlab/assets/icon.png" width="22" alt=""> | GitLab | [`cindy-gitlab`](./cindy-gitlab) | GitLab (gitlab.com and self-hosted) issues / MRs / repository operations |
| <img src="./cindy-mermaid/assets/icon.jpg" width="22" alt=""> | Mermaid | [`cindy-mermaid`](./cindy-mermaid) | Mermaid diagram source normalization and common syntax fixes |
| <img src="./cindy-notion/assets/icon.png" width="22" alt=""> | Notion | [`cindy-notion`](./cindy-notion) | Read/write Notion pages, databases, and knowledge bases |
| <img src="./cindy-web-search/assets/icon.png" width="22" alt=""> | Web Search | [`cindy-web-search`](./cindy-web-search) | Public web search (Brave / Tavily, user-provided API key) |
| <img src="./world-bank-open-data/assets/icon.png" width="22" alt=""> | World Bank Open Data | [`world-bank-open-data`](./world-bank-open-data) | Public country, economic, social, and development indicators with no API key; staged rollout |
| <img src="./google-gmail/assets/icon.png" width="22" alt=""> | Gmail | [`google-gmail`](./google-gmail) | Search, read, and organize Gmail, create drafts, and send messages; host-managed OAuth |
| <img src="./google-drive/assets/icon.png" width="22" alt=""> | Google Drive | [`google-drive`](./google-drive) | Search, read, download, upload, move, and delete Drive files |
| <img src="./google-calendar/assets/icon.png" width="22" alt=""> | Google Calendar | [`google-calendar`](./google-calendar) | View schedules and availability; create and update meetings |
| <img src="./google-sheets/assets/icon.png" width="22" alt=""> | Google Sheets | [`google-sheets`](./google-sheets) | List worksheets, read ranges, and write cells |
| <img src="./163-mail/assets/icon.png" width="22" alt=""> | 163 Mail | [`163-mail`](./163-mail) | Search, read, organize, compose, and send 163 Mail via IMAP/SMTP |
| <img src="./icloud-mail/assets/icon.png" width="22" alt=""> | iCloud Mail | [`icloud-mail`](./icloud-mail) | Cindy stores the app-specific password securely; manage iCloud Mail via IMAP/SMTP on demand |
| <img src="./qq-mail/assets/icon.png" width="22" alt=""> | QQ Mail | [`qq-mail`](./qq-mail) | Cindy stores the authorization code securely; search, read, organize, and send via IMAP/SMTP on demand |
| <img src="./taptap-maker/assets/icon.png" width="22" alt=""> | TapTap Maker | [`taptap-maker`](./taptap-maker) | Account connection, project sync, builds, and official news tools |
| <img src="./x-manager/assets/icon.png" width="22" alt=""> | X Manager | [`x-manager`](./x-manager) | Search X (Twitter) and post to it — xAI x_search with Grok-subscription / API-key fallback, posting via the official X API v2; currently in a targeted rollout |

Missing a plugin you want? [Propose it](#submit-your-plugin) — or build it
yourself and submit it here.

## Submit your plugin

The full path from idea to marketplace:

1. **Idea** — check the table above for overlap first. Official plugins avoid
   duplicating each other's scenarios; same-provider product families
   (Gmail / Drive / Calendar) and same-protocol different providers
   (163 / iCloud / QQ mail) are fine, but a second generic web search is not.
2. **Align** — open a
   [new plugin proposal](https://github.com/makecindy/cindy-official-plugins/issues/new?template=new_plugin_proposal.yml)
   describing the scenario, boundaries, and required capabilities (network
   hosts, credentials, Node runtime). Wait for a maintainer ack before writing
   code — it keeps you from building something that overlaps or won't be
   accepted.
3. **Build** — in a Cindy conversation, say "help me build a plugin" to get
   the complete authoring manual (`ghost_forge_guide`: every `ghost.json`
   field, slots, the `cindy.send` pipe API, packaging). Scaffold with
   `ghost_forge_scaffold` or copy the layout of any plugin here. Import the
   directory or a packaged `.cindy` into a dev environment to verify.
4. **Open a PR** — title `feat(<directory>): …`; bump `ghost.json.version`;
   add the `provisioning.json` entry; complete four-language locales
   (`zh-CN` / `en` / `ja` / `ko`); sign off every commit (`git commit -s`,
   [DCO](./DCO)). Details in [`CONTRIBUTING.md`](./CONTRIBUTING.md).
5. **Review** — CI runs the localization / provisioning gates plus a packaging
   dry-run; automated review enforces the full ruleset in
   [`.greptile/rules.md`](./.greptile/rules.md); a maintainer reviews against
   the same [review standards](#review-standards). Walk through the self-check
   list below before requesting review.
6. **Ship** — after merge to `main`, the CN and Global publish workflows
   release the plugin automatically. No manual publishing step; it typically
   appears in the marketplace within minutes.

## Review standards

Every official plugin is installed by real users who carry its security and
experience risk, so review is strict by design. Four hard principles:

1. **Pure sandbox by default, capabilities declared explicitly.** Regular
   plugins run in Cindy's isolated sandbox and may only use the network
   allowlist and host channels declared in `ghost.json`. Official plugins that
   genuinely need the Node Runtime must explicitly declare the `node` slot, a
   fixed entry point, and a minimal child-process boundary.
2. **Clear secret ownership.** Ordinary API tokens are stored through the
   host's write-only `/secrets` channel. When a Node plugin needs plaintext
   credentials, use `node.secretBindings` to restrict them to specific Worker
   methods, injected transiently by the host — never passing through the
   browser `main.js`, Agent parameters, or logs. If an official third-party
   runtime manages account credentials itself (e.g. TapTap Maker), the plugin
   only hands credentials to the runtime; it does not copy them into Cindy
   KV/Secret or keep plaintext in logs or page state.
3. **Tool descriptions are contracts.** Each tool's `description` in
   `ghost.json` is the usage manual the Agent reads; it must accurately
   describe behavioral boundaries (what it does, what it doesn't, what it
   returns, and any side effects).
4. **Error messages speak human.** User-facing errors must be actionable
   (e.g. 401 → tell the user where to fill in the token), not raw HTTP status
   codes.

### Self-check before requesting review

- [ ] `ghost.json` declares only the network hosts and host channels actually
      used; no `node` slot unless genuinely required
- [ ] Node plugins: explicit `node` slot, fixed entry, minimal child-process
      boundary; `node/worker.cjs` is an esbuild artifact rebuilt from `src/`
- [ ] No plaintext credentials anywhere: tokens go through the write-only
      `/secrets` channel or `node.secretBindings`; never through `main.js`,
      Agent parameters, logs, KV, or page state
- [ ] Tools with irreversible external side effects (send / post / delete)
      distinguish "definitely not executed / definitely executed / unknown"
      in every failure path, and never suggest a blind retry on "unknown"
- [ ] Every tool `description` matches actual behavior — capabilities, limits,
      return values, side effects
- [ ] User-facing errors are actionable; no raw status codes or stack traces
- [ ] Four-language locales complete; `node --test .tests/localization.test.mjs`
      passes
- [ ] `ghost.json.version` bumped; `provisioning.json` entry present with an
      audience decision stated in the PR
- [ ] No credentials, real user data, `node_modules`, or unrelated generated
      files in the diff; fixtures use placeholder domains (`example.test`)
- [ ] Bundled dependency changes reflected in `THIRD-PARTY-LICENSES.txt`
- [ ] Every commit signed off (`git commit -s`)

The complete machine-and-human review contract lives in
[`.greptile/rules.md`](./.greptile/rules.md) — automated review enforces it on
every PR, and maintainers apply the same standards.

## Repository layout

Each subdirectory is the complete source of one plugin ("consciousness pack"):

```
cindy-github/
├── ghost.json      # Identity card: plugin id, description, tool declarations, network & secret declarations
├── main.js         # Entry point: plugin logic running in the sandbox
├── settings.html   # (optional) Settings page, e.g. for pasting an API token
├── settings.js
└── assets/         # (optional) Static assets such as icons
cindy-art/
├── ghost.json
├── main.js
└── panel.*         # (optional) Custom panel UI
```

`provisioning.json` at the repository root declares, per plugin, which audience
receives it as a built-in. Every plugin directory has a corresponding entry, so
adding a plugin means adding a row there too.

The `.tests/` directory holds plugin behavior tests; `*.test.mjs` files run on
Node's built-in test runner (`node --test .tests/<file>.test.mjs`) and back both
the PR verification workflow and the publish gates. See
[`CONTRIBUTING.md`](./CONTRIBUTING.md) for the verification workflow.

Official plugins are wired into host-driven `zh-CN / en / ja / ko` locale
resources; see [`docs/localization.md`](./docs/localization.md) for
language selection and the English-fallback contract. The shared resources cover
the catalog layer; self-rendered settings pages are being migrated independently
to the same host-driven locale contract, while runtime error copy is still
primarily Chinese-only.

## Automated publishing

In one sentence: **merging to `main` releases automatically to both regions —
there is no manual publishing step.**

Two workflows publish, and both only from `main`:

- [`publish-cindy-plugins.yml`](./.github/workflows/publish-cindy-plugins.yml) —
  `Publish Cindy Plugins (CN)`
- [`publish-cindy-plugins-global.yml`](./.github/workflows/publish-cindy-plugins-global.yml) —
  `Publish Cindy Plugins (Global)`

Both are active and behave identically:

- A regular push to `main` publishes only the plugin directories changed in
  that push. A push that touches no plugin directory publishes nothing.
- Manually running a workflow from the Actions page publishes all current
  plugins in full — for initial setup after a repository migration or an
  explicit re-release.
- Each publishes via GitHub Actions OIDC (audience `cindy-plugin`) to its own
  endpoint, supplied by a repository secret. The two runs package, execute, and
  report independently; a failure on one side does not affect the other's
  workflow status. There is no development publishing workflow.

Because both fire on the same push, one merge that changes a plugin produces two
releases of it — one per region.

When changing plugin content you must bump `ghost.json.version` in the same
change. Publishing different content under the same version is rejected by the
server with `RELEASE_VERSION_CONFLICT` and will not overwrite an existing
release.

## Local development

The complete plugin-authoring contract (all `ghost.json` fields, slots, the
`cindy.send` pipe API, packaging flow) is defined by the manual returned by the
`ghost_forge_guide` tool built into the Cindy client — just say "help me build
a plugin" in a Cindy conversation to get it on the spot.

Typical flow:

1. Scaffold with the client's `ghost_forge_scaffold`, or copy the layout of any
   plugin in this repository.
2. In a dev environment, import the plugin directory or a `.cindy` package
   directly for verification.
3. When done, package it with `ghost_forge_pack` into a `.cindy` and install it
   to verify.

`taptap-maker/vendor/taptap-maker/` ships the official `@taptap/maker@0.0.28`
with the plugin. When upgrading, replace the published npm package content
wholesale and bump the plugin version accordingly — do not edit the generated
`dist/maker.js` by hand.

## Community

Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) before opening a PR — it covers
the PR title convention, the mandatory `ghost.json` version bump, the
localization check, how to rebuild the bundled Node Workers, and the
[DCO](./DCO) sign-off required on every commit (`git commit -s`).

Participation is governed by
[`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md). For usage questions and what
to include in an issue, see [`SUPPORT.md`](./SUPPORT.md).

Please do not disclose security vulnerabilities in public issues — see
[SECURITY.md](./SECURITY.md) for the reporting channel.

## License

The code in this repository is open-sourced under the
[Apache License 2.0](./LICENSE).

Copyright 2026 心动网络股份有限公司 (X.D. Network Inc.) — see
[`NOTICE`](./NOTICE).

Third-party open-source components contained in bundled artifacts are
attributed in the corresponding plugin directories:

- `qq-mail/THIRD-PARTY-LICENSES.txt` — full license texts of the dependencies
  embedded in `node/worker.cjs`
- `163-mail/THIRD-PARTY-LICENSES.txt` — same, for the 163 Mail plugin
- `icloud-mail/THIRD-PARTY-LICENSES.txt` — same, for the iCloud Mail plugin
- `taptap-maker/vendor/taptap-maker/LICENSE` — vendored `@taptap/maker` (MIT)

Apache-2.0 grants no trademark rights. These plugins are unofficial integrations
with the services they connect to; third-party names and logos belong to their
owners — see [`TRADEMARKS.md`](./TRADEMARKS.md).
