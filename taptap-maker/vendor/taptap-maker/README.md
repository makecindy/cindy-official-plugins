# @taptap/maker

TapTap Maker local development CLI and MCP server.

## Usage

```bash
npx -y @taptap/maker init
```

Common commands:

```bash
taptap-maker init
taptap-maker doctor
taptap-maker apps --json
taptap-maker pat set
taptap-maker install
taptap-maker mcp verify
taptap-maker mcp install --launcher npx
taptap-maker mcp verify --mode npx
npx -y --package @taptap/maker@0.0.32 taptap-maker mcp report --ide <client> --target-dir <project> --context-stdin --consent --json
taptap-maker agents update
taptap-maker upgrade
taptap-maker dev-kit update
```

`taptap-maker install` is a shortcut alias for `taptap-maker mcp install`.
`mcp install` defaults to a stable versioned self runtime under the Maker home directory, using
the current absolute Node executable without an npx cache or network dependency. The explicit
`--launcher npx` compatibility mode pins this package version and persists a dedicated writable
npm cache for both verification and the AI client.
`taptap-maker upgrade` refreshes the current machine MCP config and the current bound project's
managed `AGENTS.md` policy block. The user-level MCP entry never stores a project `cwd`;
reinstall and upgrade also remove legacy project `cwd` values. On upgrade, `--target-dir` only
selects the project whose managed `AGENTS.md` policy is updated. Clients with one unambiguous MCP
Roots workspace resolve it automatically; clients without usable Roots pass `target_dir` on each
concrete Maker tool call. Initial install or a package/static-schema change can require one client
reconnect to load the new MCP tools. Binding or switching Maker projects does not rewrite MCP config
and does not require a new conversation.

DeepSeek Harness (DSH) uses the `@deepseek-ai/dsh-mcp-client` plugin instead of `mcp.json`.
`taptap-maker install` auto-detects DSH and merges the user-level `$DSH_HOME/cordis.patch.yml`, uses the
stable self runtime, enables visible startup failures, and extends tool calls to one hour. DSH hot
reloads that patch without an IDE restart. Because DSH does not currently advertise MCP Roots, its
Agent must pass the active Maker game directory as `target_dir` on project-related tool calls.
New plugin rows use Cordis `insert` patches; existing profile-scoped Maker rows are updated in place
to avoid a duplicate server namespace.

This package contains only the Maker CLI/MCP bundle and Maker workflow skills.
It does not include the legacy TapTap Open API MCP server, proxy, native signer,
or OpenClaw plugin package contents.

For likely Maker MCP/proxy infrastructure failures, the bundled workflow asks for user consent once
before running `npx -y --package @taptap/maker@0.0.32 taptap-maker mcp report`. The command submits a sanitized GitHub Issue only with
`--consent`; unavailable GitHub CLI, auth, or network returns `manual_required` with a copyable
report and never blocks the original Maker task.

Full connection and tool-call troubleshooting guide: `docs/MAKER_MCP_CONNECTION_TROUBLESHOOTING.md`.

Version: 0.0.32
