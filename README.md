# Cindy Official Plugins

<p align="center">
  <strong>English</strong> · <a href="README.zh-CN.md">简体中文</a>
</p>

Source repository for Cindy's official public plugins (Ghosts). Once a plugin
lands on `main`, GitHub Actions publishes it to the Cindy Plugin Server via
OIDC, and clients discover and install it from the plugin marketplace — plugins
are no longer bundled with the desktop app as submodules or seeded at startup.

## Plugins

| Plugin           | Directory                                | Description                                                        |
| ---------------- | ---------------------------------------- | ------------------------------------------------------------------ |
| Art              | [`cindy-art`](./cindy-art)               | Image / short-video generation, with edits and restyling based on previously generated images |
| GitHub           | [`cindy-github`](./cindy-github)         | Full GitHub workflow: issues / PRs / code review / Actions / releases |
| GitLab           | [`cindy-gitlab`](./cindy-gitlab)         | GitLab (gitlab.com and self-hosted) issues / MRs / repository operations |
| Mermaid          | [`cindy-mermaid`](./cindy-mermaid)       | Mermaid diagram source normalization and common syntax fixes       |
| Notion           | [`cindy-notion`](./cindy-notion)         | Read/write Notion pages, databases, and knowledge bases            |
| Web Search       | [`cindy-web-search`](./cindy-web-search) | Public web search (Brave / Tavily, user-provided API key)          |
| 163 Mail         | [`163-mail`](./163-mail)                 | Search, read, organize, compose, and send 163 Mail via IMAP/SMTP   |
| Microsoft Outlook | [`microsoft-outlook`](./microsoft-outlook) | Connect Outlook independently to search, read, organize, draft, and send mail |
| QQ Mail          | [`qq-mail`](./qq-mail)                   | Cindy stores the authorization code securely; search, read, organize, and send via IMAP/SMTP on demand |
| TapTap Maker     | [`taptap-maker`](./taptap-maker)         | Account connection, project sync, builds, and official news tools  |

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

The `.tests/` directory holds plugin behavior tests (vitest style; currently
archived until a CI runner is wired up).

## Design principles

Official plugins follow a few hard constraints, and PRs are reviewed against
them:

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
   returns).
4. **Error messages speak human.** User-facing errors must be actionable
   (e.g. 401 → tell the user where to fill in the token), not raw HTTP status
   codes.

Official plugins are wired into host-driven `zh-CN / en / ja / ko` locale
resources; see [`docs/localization.en.md`](./docs/localization.en.md) for
language selection and the English-fallback contract.

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

`taptap-maker/vendor/taptap-maker/` ships the official `@taptap/maker@0.0.26`
with the plugin. When upgrading, replace the published npm package content
wholesale and bump the plugin version accordingly — do not edit the generated
`dist/maker.js` by hand.

## Automated publishing

The repository's
[`publish-cindy-plugins.yml`](./.github/workflows/publish-cindy-plugins.yml)
only publishes from `main`:

- A regular push to `main` publishes only the plugin directories changed in
  that push.
- Manually running `Publish Cindy Plugins` from the Actions page publishes all
  current plugins in full — for initial setup after a repository migration or
  an explicit re-release.
- Prod and Dev use two independent workflow runs, both publishing via GitHub
  Actions OIDC (audience `cindy-plugin`). Prod publishes to
  `https://plugin.cindy.com.cn`; Dev publishes to
  `https://plugin-dev.cindy.com.cn`. The two pipelines package, run, and report
  independently; a failure on one side does not affect the other's workflow
  status. Both URLs are fixed in the workflow — no Repository Secret, API key,
  or Actions variable is needed. Future overseas publishing will use a separate
  target.

When changing plugin content you must bump `ghost.json.version` in the same
change. Publishing different content under the same version is rejected by the
server with `RELEASE_VERSION_CONFLICT` and will not overwrite an existing
release.

## Contributing

**PRs welcome!** Whether it's a bug fix, an improvement to an existing plugin,
or a proposal for a new official plugin.

- **Bug fixes / small improvements**: open a PR directly, describing what
  changed and why.
- **New official plugins**: open an issue first to discuss positioning and
  boundaries (avoiding overlap with existing plugins), then submit a PR once
  aligned.
- **Changes to `ghost.json` tool declarations**: explain the impact on Agent
  behavior in the PR description.
- After merging to `main`, the publish workflow syncs the plugin to the Cindy
  marketplace automatically.

When filing an issue, please include the plugin name, reproduction steps, and
expected behavior.

Please do not disclose security vulnerabilities in public issues — see
[SECURITY.md](./SECURITY.md) for the reporting channel.

## License

The code in this repository is open-sourced under the
[Apache License 2.0](./LICENSE).

Third-party open-source components contained in bundled artifacts are
attributed in the corresponding plugin directories:

- `qq-mail/THIRD-PARTY-LICENSES.txt` — full license texts of the dependencies
  embedded in `node/worker.cjs`
- `163-mail/THIRD-PARTY-LICENSES.txt` — same, for the 163 Mail plugin
- `taptap-maker/vendor/taptap-maker/LICENSE` — vendored `@taptap/maker` (MIT)
