# Cindy Official Plugins

<p align="center">
  <strong>English</strong> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License" /></a>
  <a href="https://github.com/makecindy/cindy-official-plugins/actions/workflows/pr-verify.yml"><img src="https://github.com/makecindy/cindy-official-plugins/actions/workflows/pr-verify.yml/badge.svg" alt="Verify pull request" /></a>
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
  CN package submission has been removed. Merging to `main` automatically submits
  changed packages to Global Plugin Platform; releases become visible only after
  approval. Start at
  [Submit your plugin](#submit-your-plugin).

Already-installed marketplace plugins follow their recorded source and update
silently. After a release is approved, a version bump can
reach installed users without another click or capability-confirmation dialog. Treat capability expansion and
runtime changes as immediate production changes: declare the minimum required
capabilities in the package's `ghost.json`, and preserve Host authorization and
credential boundaries. Marketplace summaries are not a separate installation
permission gate.

## Plugins

|  | Plugin | Directory | Description |
| --- | --- | --- | --- |
| <img src="./cindy-art/assets/icon.png" width="22" alt=""> | Art | [`cindy-art`](./cindy-art) | Image / short-video generation, with edits and restyling based on previously generated images |
| <img src="./opendesign-trial/assets/icon.png" width="22" alt=""> | OpenDesign | [`opendesign-trial`](./opendesign-trial) | Session-owned HTML design previews, element annotations and manual editing using Cindy’s conversation model |
| <img src="./cindy-github/assets/icon.png" width="22" alt=""> | GitHub | [`cindy-github`](./cindy-github) | Full GitHub workflow: issues / PRs / code review / Actions / releases |
| <img src="./cindy-gitlab/assets/icon.png" width="22" alt=""> | GitLab | [`cindy-gitlab`](./cindy-gitlab) | GitLab (gitlab.com and self-hosted) issues / MRs / repository operations |
| <img src="./gitea/assets/icon.png" width="22" alt=""> | Gitea | [`gitea`](./gitea) | Self-hosted Gitea repos, files, issues, PRs, Actions runs and logs, releases; writes ask for confirmation; opt-in, needs your own instance and token |
| <img src="./cindy-mermaid/assets/icon.jpg" width="22" alt=""> | Mermaid | [`cindy-mermaid`](./cindy-mermaid) | Mermaid diagram source normalization and common syntax fixes |
| <img src="./cindy-ping/assets/icon.png" width="22" alt=""> | Cindy Ping | [`cindy-ping`](./cindy-ping) | Configurable desktop emote wheel and project, conversation or companion delivery; macOS 14+; manual install |
| <img src="./cindy-notion/assets/icon.png" width="22" alt=""> | Notion | [`cindy-notion`](./cindy-notion) | Read/write Notion pages, databases, and knowledge bases |
| <img src="./cindy-web-search/assets/icon.png" width="22" alt=""> | Web Search | [`cindy-web-search`](./cindy-web-search) | Public web search (Cindy AI by default; optional user-provided Brave / Tavily / DeepSeek key) |
| <img src="./world-bank-open-data/assets/icon.png" width="22" alt=""> | World Bank Open Data | [`world-bank-open-data`](./world-bank-open-data) | Public country, economic, social, and development indicators with no API key; staged rollout |
| <img src="./google-gmail/assets/icon.png" width="22" alt=""> | Gmail | [`google-gmail`](./google-gmail) | Search, read, and organize Gmail, create drafts, and send messages; host-managed OAuth |
| <img src="./google-drive/assets/icon.png" width="22" alt=""> | Google Drive | [`google-drive`](./google-drive) | Search, read, download, upload, move, and delete Drive files |
| <img src="./google-calendar/assets/icon.png" width="22" alt=""> | Google Calendar | [`google-calendar`](./google-calendar) | View schedules and availability; create and update meetings |
| <img src="./google-sheets/assets/icon.png" width="22" alt=""> | Google Sheets | [`google-sheets`](./google-sheets) | List worksheets, read ranges, and write cells |
| <img src="./163-mail/assets/icon.png" width="22" alt=""> | 163 Mail | [`163-mail`](./163-mail) | Search, read, organize, compose, and send 163 Mail via IMAP/SMTP |
| <img src="./icloud-mail/assets/icon.png" width="22" alt=""> | iCloud Mail | [`icloud-mail`](./icloud-mail) | Cindy stores the app-specific password securely; manage iCloud Mail via IMAP/SMTP on demand |
| <img src="./outlook-mail/assets/icon.png" width="22" alt=""> | Outlook Mail | [`outlook-mail`](./outlook-mail) | Microsoft mail via Host-managed OAuth and Microsoft Graph; search/read/draft/send/organize; proposed, no automatic provisioning |
| <img src="./qq-mail/assets/icon.png" width="22" alt=""> | QQ Mail | [`qq-mail`](./qq-mail) | Cindy stores the authorization code securely; search, read, organize, and send via IMAP/SMTP on demand |
| <img src="./yahoo-mail/assets/icon.png" width="22" alt=""> | Yahoo Mail | [`yahoo-mail`](./yahoo-mail) | Cindy stores the app password securely; manage and send Yahoo Mail via IMAP/SMTP on demand |
| <img src="./taptap-maker/assets/icon.png" width="22" alt=""> | TapTap Maker | [`taptap-maker`](./taptap-maker) | Account connection, project sync, builds, and official news tools |
| <img src="./baguette-simulator/assets/icon.png" width="22" alt=""> | Device Simulator | [`baguette-simulator`](./baguette-simulator) | Cindy's official Device Simulator (built on open-source Baguette) with a private device set and live sidebar control; replaces the retired embedded simulator; marketplace install |
| <img src="./ios-simulator/assets/icon.png" width="22" alt=""> | iOS Simulator | [`ios-simulator`](./ios-simulator) | Host-owned embedded workflow; Host-authorized fallback hands off the exact task and device to a named external workflow; staged rollout |
| <img src="./x-manager/assets/icon.png" width="22" alt=""> | X Manager | [`x-manager`](./x-manager) | Search X (Twitter) and post to it — xAI x_search with Grok-subscription / API-key fallback, posting via the official X API v2; currently in a targeted rollout |
| <img src="./ntfy/assets/icon.png" width="22" alt=""> | ntfy | [`ntfy`](./ntfy) | Push notifications to your phone or desktop through your own ntfy server; the access token is stored by Cindy and sent only to that server; opt-in |

Missing a plugin you want? [Propose it](#submit-your-plugin) — or build it
yourself and submit it here.

## Submit your plugin

The full path from idea to marketplace:

1. **Idea** — check the table above for overlap first. Official plugins avoid
   duplicating each other's scenarios; same-provider product families
   (Gmail / Drive / Calendar) and same-protocol different providers
   (163 / iCloud / QQ mail) are fine, but a second generic web search is not.
2. **Check the standard** — admission and audience are judged by the
   [admission and audience standard](.greptile/rules.md#插件准入与受众标准).
   A plugin that fits needs no separate maintainer approval and no prior proposal.
   A [proposal issue](https://github.com/makecindy/cindy-official-plugins/issues/new?template=new_plugin_proposal.yml)
   or Draft PR may record the scenario, boundaries, and autonomous Host
   capabilities (network hosts, credentials, long-lived Node runtime); it is not
   an approval gate. `all` is only for plugins most users benefit from, that work
   out of the box with no self-obtained third-party key or account, that are not
   tied to one person's or one team's workflow, and that are stable. Popularity
   or many submissions alone never justify `all`. Useful but niche plugins, or
   plugins that need the user's own key or account, are accepted as opt-in
   (`{ "emails": [] }`; users choose them in the marketplace). Very personal
   plugins, pure demos (use `docs/` instead), and tasks the agent can already
   do without a plugin are not accepted. `author` must be the real author.
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
   [`.greptile/rules.md`](./.greptile/rules.md); the maintainers apply the same
   [review standards](#review-standards). Once checks, effective review, and
   verification are satisfied, already-authorized merge automation may execute
   without another confirmation for routine maintenance. A fitting admission
   needs no extra decision. A plugin that uses or depends on a Cindy host
   authorization still waits until that grant is approved and released; see
   [Review standards](#review-standards).
6. **Submit and approve** — merging to `main` submits changed packages to Global
   Plugin Platform. Only approved releases become available to compatible clients;
   rejection leaves the previous approved release in service. CN submission remains
   removed.

## Review standards

Published plugin ID changes require a separately reviewed
[migration registration](./docs/plugin-id-migrations.md) and coordinated Server
and client rollout before the renamed package is released.

Every official plugin is installed by real users who carry its security and
experience risk. Review actual behavior, impact and evidence: routine packaging
fixes, dependency maintenance, traceable generated artifacts and static images
do not require human approval just because of their paths. Admission and
audience that fit the standard need no separate maintainer approval; a mismatch
is a concrete review finding. Real permission, credential, or publish-trust
widening, undisclosed network access, and renaming or deleting a published
plugin still need the maintainers' explicit decision. Review of a plugin also
checks any Cindy host authorization it uses or depends on, besides scopes the
plugin itself requests: which grant, whether the platform has approved it, and
whether a host release contains it. If that grant changed or is not ready, do
not merge, and plan the scopes that still need requesting together. Leave
unused ones out. Other changes that fit the existing standard are still judged
directly. Details are in
[第三方平台授权](.greptile/rules.md#第三方平台授权).
Separate code defects, verification gaps, boundary decisions, and platform
approval. Four principles:

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
- [ ] Actual runtime evidence for affected paths, or linked valid prior evidence
      with applicability across the full subsequent diff; accurate environment,
      version, results and gaps. No fixed PR checkbox; green CI is not runtime proof
- [ ] `ghost.json.version` bumped; `provisioning.json` audience matches the
      standard (`all`, or opt-in `{ "emails": [] }`); `author` is the real author
- [ ] Scopes the plugin requests are unchanged, and it does not use or depend on
      a changed or unready Cindy host authorization; otherwise the pull request
      lists those scopes and, for each host grant, platform approval and host
      release
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

**Global package publishing is enabled; CN publishing remains removed.** The
[`Global workflow`](./.github/workflows/publish-cindy-plugins-global.yml)
submits changed plugins on pushes to `main` and all current plugins on manual
dispatch from `main`. PR verification and its test artifacts remain separate from
production publishing.

Restoring the workflow does not automatically publish plugins merged during the
maintenance pause. After confirming the Global service is ready, manually dispatch
the workflow from `main` once to include those plugins.
Publishing uses GitHub Actions OIDC (audience `cindy-plugin`) and the protected
Plugin Platform endpoint; it must not bypass review by calling Plugin Server
directly. Platform creates pending releases for review.

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
Unknown capability declarations must not block plugin development or publication.
Acceptance does not grant runtime permissions. Even with `minCindyVersion`, users
may directly install on unsupported clients; plugins must handle missing APIs
with a supported fallback or an upgrade prompt. See the reference's capability
compatibility section.

New plugins use `schemaVersion: 3` and declare capabilities directly through
fields such as `tools`, `network`, `node`, or `notify: true`; v3 must not contain
`slots`. Every v3 package declares its own `minCindyVersion`: use the first
published Cindy version (stable or Beta) that supports every Host capability and manifest field
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

The `1.2.3` below is only an example. Replace it with the first published Cindy (stable or Beta)
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
For local development, use Forge below or a reviewed explicit file list. After
source submission, PR CI provides downloadable verification packages; reproducing
the repository build locally is optional:

Small binaries (up to 10 MiB combined per plugin, across all platforms) may stay in Git under the existing
license/review/package-size rules. To keep larger prebuilt dependencies out of
Git, opt into the declarative
[build-time dependency mechanism](docs/binary-dependencies.md). It collects all
platforms into the same package. Python 3.11+ is a collector build-environment
requirement only when reproducing that step locally, not a prerequisite for
plugin development. Legacy plugins keep the original toolchain; there is no
client-side dependency download.

```bash
.github/scripts/package-plugin.sh my-plugin /tmp/my-plugin-1.0.0.cindy
unzip -Z1 /tmp/my-plugin-1.0.0.cindy
```

The script uses `git archive` for the plugin directory, adds the fixed repository
legal files, collects declared binary dependencies when present, and validates
the result. It intentionally excludes uncommitted and
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
optional accelerators; the source and `.cindy` format are identical. Forge does
not interpret dependency declarations; prepare the output files locally first.
See the [dependency guide](docs/binary-dependencies.md) for migration steps,
complete declaration examples and downloading PR verification packages.

Before submitting to this official repository, add a `provisioning.json` entry
and locale files for `zh-CN`, `en`, `ja` and `ko`, covering plugin text and tool
descriptions. Follow [`CONTRIBUTING.md`](./CONTRIBUTING.md). Open a PR to obtain a
test package; authors or maintainers supply runtime and compatibility evidence
appropriate to the affected behavior before merge. Valid evidence for unaffected
paths can be reused without reinstalling after every wording change.

`taptap-maker/vendor/taptap-maker/` ships the official `@taptap/maker@0.0.39`
with the plugin. When upgrading, replace the published npm package content
wholesale and bump the plugin version accordingly. Preserve these reviewed Cindy
compatibility patches until the official package includes equivalent fixes:

- `normalizeRemoteProxyExecutionState` accepts `executed`, preserving confirmed
  execution through the new state aggregator too (original patch: `ff54f59`); conflicting states become `unknown`.
- The BLACKLISTED `tools/call` rejection includes `structuredContent` with
  `success: false`, its message, and `execution_state: "not_executed"`, so Cindy's
  error sanitizer retains the execution state.
- The BLACKLISTED `tools/list` response retains the restricted tool list and adds
  `_meta.maker_access` with the original code and message. Cindy returns the account
  restriction and `not_executed` before dispatch rather than a generic missing-tool error.
- `user-skills pull` rejects existing symlinks in all project/client skill roots before any write.
- `tools/list`, `resources/read`, and `tools/call` check account access per request
  instead of using a startup-only `accessStatePromise`; PAT changes take effect
  without waiting for the old Runtime process to expire. This adds an authentication
  check to each of these requests; it does not change the upstream access policy.
- MAC-expiry recovery retries only explicitly `not_executed` requests, once;
  executed, unknown and unstated results are not replayed.
- Cindy console identity includes its distribution and entry path, preventing
  reuse of a same-version standalone or different plugin Runtime.
- In Cindy distribution, the console hides model settings, rejects custom API
  configuration and uses Server API recognition only; unavailable service reports an error without provider fallback.

- Preserve unknown cloud Git commit outcomes when verification fails, suppress
  blind retry guidance, recognize both cloud-blocking messages, and distinguish
  completed cloud commits from unfinished local steps.
- Keep uncertain canvas requests protected from automatic resubmission; waiting
  limits pause the 015 workflow, whose stop control also covers preparation and
  recovery waits without cancelling submitted remote tasks.

Apart from these patches and the retained `LICENSE`, vendor files must match the
official npm package. Recheck the patch list and regression tests on every upgrade;
do not add unrelated manual bundle edits.

Historical failures, superseded fixes and upgrade checks are recorded in the
[Maker maintenance checklist](./docs/taptap-maker-maintenance.md).

Plugin 2.1.25 raises the request window for all dynamic Maker tools, tool discovery
and long-running account operations from 60 to 120 seconds. Existing progress-based
renewal and the 15-minute total ceiling remain unchanged; no periodic heartbeat is
added. Requests without progress can still time out after 120 seconds, so this is
not an unlimited wait or a guarantee that large generation requests will finish.

Plugin 2.1.17 adds `maker_validate` for local Lua checks/screenshots through the
trusted current workspace and bundled Runtime. Cindy's Manual supplies the workflow
without requiring a project Skill. It does not install Runtime, submit or build;
original reports and Skill-maintenance warnings remain separate from game PASS.

Plugin 2.1.19 also checks that validation evidence is ignored and untracked in Git,
rejects incompatible mode arguments, removes structured Runtime paths from responses,
and returns bounded summaries for large reports with links to the full evidence.

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
