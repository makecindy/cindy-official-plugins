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
  Once your PR merges to `main`, the package is submitted automatically to the
  CN and Global review queues. It becomes visible in a region only after that
  region approves it. Start at
  [Submit your plugin](#submit-your-plugin).

Already-installed marketplace plugins follow their recorded source and update
silently. A merged version bump can therefore reach installed users without
another click or capability-confirmation dialog. Treat capability expansion and
runtime changes as immediate production changes: declare the minimum required
capabilities in the package's `ghost.json`, and preserve Host authorization and
credential boundaries. Marketplace summaries are not a separate installation
permission gate.

## Plugins

|  | Plugin | Directory | Description |
| --- | --- | --- | --- |
| <img src="./cindy-art/assets/icon.png" width="22" alt=""> | Art | [`cindy-art`](./cindy-art) | Image / short-video generation, with edits and restyling based on previously generated images |
| <img src="./cindy-github/assets/icon.png" width="22" alt=""> | GitHub | [`cindy-github`](./cindy-github) | Full GitHub workflow: issues / PRs / code review / Actions / releases |
| <img src="./cindy-gitlab/assets/icon.png" width="22" alt=""> | GitLab | [`cindy-gitlab`](./cindy-gitlab) | GitLab (gitlab.com and self-hosted) issues / MRs / repository operations |
| <img src="./cindy-mermaid/assets/icon.jpg" width="22" alt=""> | Mermaid | [`cindy-mermaid`](./cindy-mermaid) | Mermaid diagram source normalization and common syntax fixes |
| <img src="./cindy-notion/assets/icon.png" width="22" alt=""> | Notion | [`cindy-notion`](./cindy-notion) | Read/write Notion pages, databases, and knowledge bases |
| <img src="./cindy-web-search/assets/icon.png" width="22" alt=""> | Web Search | [`cindy-web-search`](./cindy-web-search) | Public web search (Cindy AI by default; optional user-provided Brave / Tavily key) |
| <img src="./world-bank-open-data/assets/icon.png" width="22" alt=""> | World Bank Open Data | [`world-bank-open-data`](./world-bank-open-data) | Public country, economic, social, and development indicators with no API key; staged rollout |
| <img src="./google-gmail/assets/icon.png" width="22" alt=""> | Gmail | [`google-gmail`](./google-gmail) | Search, read, and organize Gmail, create drafts, and send messages; host-managed OAuth |
| <img src="./google-drive/assets/icon.png" width="22" alt=""> | Google Drive | [`google-drive`](./google-drive) | Search, read, download, upload, move, and delete Drive files |
| <img src="./google-calendar/assets/icon.png" width="22" alt=""> | Google Calendar | [`google-calendar`](./google-calendar) | View schedules and availability; create and update meetings |
| <img src="./google-sheets/assets/icon.png" width="22" alt=""> | Google Sheets | [`google-sheets`](./google-sheets) | List worksheets, read ranges, and write cells |
| <img src="./163-mail/assets/icon.png" width="22" alt=""> | 163 Mail | [`163-mail`](./163-mail) | Search, read, organize, compose, and send 163 Mail via IMAP/SMTP |
| <img src="./icloud-mail/assets/icon.png" width="22" alt=""> | iCloud Mail | [`icloud-mail`](./icloud-mail) | Cindy stores the app-specific password securely; manage iCloud Mail via IMAP/SMTP on demand |
| <img src="./qq-mail/assets/icon.png" width="22" alt=""> | QQ Mail | [`qq-mail`](./qq-mail) | Cindy stores the authorization code securely; search, read, organize, and send via IMAP/SMTP on demand |
| <img src="./yahoo-mail/assets/icon.png" width="22" alt=""> | Yahoo Mail | [`yahoo-mail`](./yahoo-mail) | Cindy stores the app password securely; manage and send Yahoo Mail via IMAP/SMTP on demand |
| <img src="./taptap-maker/assets/icon.png" width="22" alt=""> | TapTap Maker | [`taptap-maker`](./taptap-maker) | Account connection, project sync, builds, and official news tools |
| <img src="./ios-simulator/assets/icon.png" width="22" alt=""> | iOS Simulator | [`ios-simulator`](./ios-simulator) | Host-owned embedded workflow; Host-authorized fallback hands off the exact task and device to a named external workflow; staged rollout |
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
   describing the scenario, boundaries, and any autonomous Host capabilities
   (network hosts, credentials, long-lived Node runtime). Wait for a maintainer ack before writing
   code — it keeps you from building something that overlaps or won't be
   accepted.
3. **Build** — follow the [harness-independent quick path](#harness-independent-quick-path)
   with any coding Agent or development environment. The repository documents
   the file format, runtime messages, validation command, and packaging format;
   no Cindy-specific authoring tool is required.
4. **Open a PR** — title `feat(<directory>): …`; bump `ghost.json.version`;
   add the `provisioning.json` entry; complete four-language locales
   (`zh-CN` / `en` / `ja` / `ko`); sign off every commit (`git commit -s`,
   [DCO](./DCO)). Details in [`CONTRIBUTING.md`](./CONTRIBUTING.md).
5. **Review** — CI validates each manifest and the Server/Desktop delivery
   limits within this repository, checks localization / provisioning,
   and dry-runs the exact package; automated review enforces the full ruleset in
   [`.greptile/rules.md`](./.greptile/rules.md); a maintainer reviews against
   the same [review standards](#review-standards). Walk through the self-check
   list below before requesting review.
6. **Submit and approve** — after merge to `main`, the CN and Global workflows
   submit the real package through Plugin Platform. Each region reviews its own
   pending release; only an approved release becomes available to compatible
   clients and is then picked up silently by installations following that market
   source. Rejection leaves the previous approved release in service.

## Review standards

Every official plugin is installed by real users who carry its security and
experience risk, so review is strict by design. Four hard principles:

1. **Pure sandbox by default; authorization follows the executor.** Regular
   plugins run in Cindy's isolated sandbox. Whether a plugin tool runs is decided
   by the current `ghost_call` and Cindy's existing Agent authorization. Ordinary
   HTTPS and workdir operations use the Host-issued, strictly in-flight `callId`;
   bundled code and CLIs continue to use the existing Node worker. Do not add a
   Slot or manifest field just to pre-register a specific command, host, or path.
   A plugin that uses Host capabilities autonomously from a panel,
   subscription, scheduler, or long-lived process must declare the corresponding
   direct field in `ghost.json`. An autonomous Node Runtime still requires the
   top-level `node` field, a fixed entry point, and a minimal child-process boundary.
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

- [ ] Execution ownership is explicit: plugin tools use existing Agent authorization,
      HTTPS/workdir operations use the current `callId`, and CLIs use the existing
      Node worker without pre-registering individual commands
- [ ] Node plugins: explicit `node` field, fixed entry, minimal child-process
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
- [ ] Every changed plugin's packaged `.cindy` was installed and exercised on a
      real device running a stable production Cindy build, and the PR
      verification box is checked; when the plugin declares `minCindyVersion`,
      the verified Cindy build is greater than or equal to it
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

## Automated submission and review

In one sentence: **merging to `main` submits automatically to both regions;
public availability still requires Plugin Platform approval in each region.**

Two workflows publish, and both only from `main`:

- [`publish-cindy-plugins.yml`](./.github/workflows/publish-cindy-plugins.yml) —
  `Publish Cindy Plugins (CN)`
- [`publish-cindy-plugins-global.yml`](./.github/workflows/publish-cindy-plugins-global.yml) —
  `Publish Cindy Plugins (Global)`

Both are active and use the same submission flow:

- A regular push to `main` submits only the plugin directories changed in that
  push. A push that touches no plugin directory submits nothing.
- Manually running a workflow from the Actions page submits all current plugins
  in full — for initial setup after a repository migration or an explicit
  re-submission.
- Each workflow uses GitHub Actions OIDC (audience `cindy-plugin`) to call its
  protected Plugin Platform endpoint. Platform creates a pending release and
  notifies reviewers; it does not bypass review by calling Plugin Server
  directly.
- The two regions package, submit, review, and report independently. Failure or
  rejection in one region does not affect the other. There is no development
  publishing workflow.

After approval, compatible clients receive that release; clients below its
`minCindyVersion` continue to receive the newest older compatible release, when
one exists. Desktop trusts this Server projection and does not add a second
version-confirmation step.

When changing plugin content you must bump `ghost.json.version` in the same
change. The new `major.minor.patch` SemVer must be greater than the version on
`main`; otherwise CI blocks the pull request before Server submission.

## Local development

The authoring contract is defined by this repository: the guidance below and in
[`CONTRIBUTING.md`](./CONTRIBUTING.md), the pinned Cindy Manifest validator under
`.tests/contracts/`, and the repository packaging checks. It is independent of
the Agent or harness used to edit files. Cindy's Forge tools are optional
shortcuts, not part of the plugin format and not a prerequisite for development.

For existing-plugin maintenance, v2/v3 field mappings, and concrete HTTPS,
file, and Node/CLI calls, use the
[authoring and migration reference](./docs/plugin-authoring.md). An Agent can
derive the required adaptations from this reference and the existing code;
authors do not need to perform a separate migration checklist.

New plugins use `schemaVersion: 3` and declare capabilities directly through
fields such as `tools`, `network`, `node`, or `notify: true`; v3 must not contain
`slots`. Every v3 package declares its own `minCindyVersion`: use the first
stable Cindy version that supports every Host capability and manifest field
the concrete plugin actually depends on. Manifest v3 itself does not impose a
repository-wide Cindy version floor. Existing v2 manifests stay untouched until
that plugin's packaged content actually changes. The PR that changes it must
migrate the manifest to v3—there is no repository-wide bulk migration or
release solely for the schema change.

Direct fields describe plugin contributions and **autonomous** Host use. They are
not a pre-registration list for a specific command, host, or path. Whether the
plugin tool runs is decided by the current `ghost_call` and existing Agent
authorization; ordinary HTTPS and workdir operations pass the Host-issued
`callId` to `cindy.fetch` or `cindy.fs`. Bundled code and CLIs continue to use the
existing Node worker. Managed credentials and any use outside that in-flight call
still require the corresponding explicit declaration.

### Harness-independent quick path

Paste this into any coding Agent or harness that can edit files and run commands:

```text
Using only the authoring contract in this repository, build a Cindy plugin for
[what it should do]. Read AGENTS.md and docs/plugin-authoring.md, infer the
necessary declarations and runtime interfaces from the task, and clarify only
product choices or verification gaps that the repository cannot establish. Create a new
Manifest-v3 plugin directory without copying an existing v2 ghost.json. Validate
its manifest with the repository validator, package the directory contents as a
.cindy ZIP archive, and report the artifact path. Do not install it unless I
explicitly ask you to.
```

Create a new directory with this minimum layout:

```text
my-plugin/
├── ghost.json
├── main.js
└── assets/
    └── icon.png
```

Do **not** copy an existing official plugin's `ghost.json`: the repository
intentionally retains legacy v2 manifests until those plugins change. Existing
source may be consulted only for implementation patterns.

Start `ghost.json` from this minimal runnable Manifest-v3 shape:

The `1.2.3` below is only an example. Replace it with the first stable Cindy
version that supports the concrete plugin you are building.

```json
{
  "schemaVersion": 3,
  "minCindyVersion": "1.2.3",
  "id": "my-plugin",
  "name": "My Plugin",
  "description": "A one-sentence description for people.",
  "whenToUse": "Use this when the user needs the plugin's capability.",
  "version": "1.0.0",
  "kind": "chip",
  "entry": "main.js",
  "icon": "assets/icon.png",
  "tools": [
    {
      "name": "hello",
      "description": "Return a greeting to verify that the plugin works.",
      "parameters": { "type": "object", "properties": {} }
    }
  ]
}
```

Place a real PNG at `assets/icon.png`. If no icon is ready, remove both the
`icon` field and the unused `assets/` entry; never package a path declared by
the Manifest without its file.

Implement the declared tool in `main.js` using the Host message contract:

```js
cindy.onHostMessage(async function (message) {
  if (message.type !== 'tool-call' || message.tool !== 'hello') return;

  await cindy.send({
    type: 'tool-result',
    callId: message.callId,
    ok: true,
    result: { message: 'The plugin is working.' }
  });
});
```

The `callId` belongs to that one in-flight tool call. Return exactly one
`tool-result` with the same `callId`. Ordinary HTTPS and workdir file operations
also carry this Host-issued `callId` through `cindy.fetch` and `cindy.fs`; they
use Cindy's existing runtime authorization instead of pre-registering a command,
host, or path in the Manifest. Declare a direct top-level capability only for a
plugin contribution or autonomous Host use outside that in-flight call.

Validate the Manifest from the repository root:

```bash
node scripts/validate-plugin-manifest.mjs ./my-plugin
```

A `.cindy` file is a ZIP archive whose root contains `ghost.json`, `main.js`,
and the declared resources—do not wrap them in an extra `my-plugin/` directory.
After reviewing and committing the plugin files, create the exact archive from
Git-tracked `HEAD` content with the repository packager:

```bash
.github/scripts/package-plugin.sh my-plugin /tmp/my-plugin-1.0.0.cindy
unzip -Z1 /tmp/my-plugin-1.0.0.cindy
```

The script uses `git archive` for the plugin directory, adds the fixed repository
legal files, and validates the result. It intentionally excludes uncommitted and
untracked files from the plugin directory. Never
recursively ZIP a plugin working directory: local `.env`, `.npmrc`, private keys,
or other credentials may be included. If a harness packages an uncommitted
working copy, it must select an explicit reviewed file list. Before installation
or sharing, inspect the archive listing for the expected files, no outer plugin
directory, and no credentials.

The user can import that file through Cindy's local plugin entry. If the chosen
harness exposes Cindy Forge tools, `ghost_forge_scaffold` can create the same v3
baseline, `ghost_forge_pack` can validate and package it, and
`ghost_forge_install` can install it after an explicit user request. These are
optional accelerators; the source and `.cindy` format are identical.

Before submitting to this official repository, add a `provisioning.json` entry
and declare locale files for exactly `zh-CN`, `en`, `ja`, and `ko`, covering the
plugin text and every tool description. Then follow
[`CONTRIBUTING.md`](./CONTRIBUTING.md) and install the exact packaged `.cindy` on
a real device running an eligible stable production Cindy build.

`taptap-maker/vendor/taptap-maker/` ships the official `@taptap/maker@0.0.32`
with the plugin. When upgrading, replace the published npm package content
wholesale and bump the plugin version accordingly — do not edit the generated
`dist/maker.js` by hand.

`console-cli/node/worker.cjs` is a plugin-owned, deterministic entry artifact,
not vendored third-party code. The build in `console-cli/package.json` copies
`src/entry.cjs` to that declared runtime entry; run `npm ci && npm run build`
from `console-cli/` and verify the two files are identical before changing the
worker. PRs changing this artifact must include the source/build provenance,
external-domain list, and dynamic-code scan results.

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
- `yahoo-mail/THIRD-PARTY-LICENSES.txt` — same, for the Yahoo Mail plugin
- `taptap-maker/vendor/taptap-maker/LICENSE` — vendored `@taptap/maker` (MIT)

Apache-2.0 grants no trademark rights. These plugins are unofficial integrations
with the services they connect to; third-party names and logos belong to their
owners — see [`TRADEMARKS.md`](./TRADEMARKS.md).
