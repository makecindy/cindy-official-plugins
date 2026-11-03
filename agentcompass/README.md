<p align="right">
  <strong>English</strong> · <a href="README.zh-CN.md">简体中文</a>
</p>

# AgentCompass

Lets a Cindy session hand work to [AgentCompass](https://github.com/akiiwa-games/AgentCompass) and get the exact result
back. AgentCompass profiles the task and picks the account, model and effort against your accounts' live quota; the
plugin starts that route as an ordinary Cindy task, checks that Cindy really runs what was routed, and collects the task's
final message.

Source, issue tracker and the full sandbox suite: [akiiwa-games/cindy-agentcompass-plugin](https://github.com/akiiwa-games/cindy-agentcompass-plugin).

## Requirements

- Cindy 0.1.121 or later with the experimental public tasks API enabled. The plugin uses `sessionContext`, `agent.tasks`
  and a Node worker (`json-rpc-stdio`).
- AgentCompass installed on the same machine (`uv tool install agentcompass` or its Windows installer) and set up with
  `agentcompass setup`. The plugin carries no router, credentials or model API of its own.
- The plugin's task directory set to the project being delegated.

## Zero configuration

On every `roll` the Node worker looks for the router in this order and runs `<it> roll`:

1. `~/.agent-compass/cindy-plugin/router.json`, if present: `{"command": [...complete roll command...], "accountMappings": [...]}`;
2. `agentcompass` on `PATH` (Windows: `agentcompass.exe`);
3. `~/.local/bin/agentcompass` (Windows: `%USERPROFILE%\.local\bin\agentcompass.exe`), where `uv tool install` puts it.

If none is found the call fails with that explanation and nothing is routed.

When a routed account has a different name from its Cindy connection, map it in
`~/.agent-compass/cindy-plugin/account-map.json`:

```json
[{"routerProvider": "pi", "routerAccount": "codex", "providerId": "<Cindy connection ID>", "agentKind": "pi"}]
```

`agentKind` is `cc`, `codex` or `pi`. Without the file a routed account must match a Cindy connection of the same name.

## Tools

| Tool | What it does |
| --- | --- |
| `roll` | Routes the full task unchanged (`agentcompass roll --parent-host native --local-only ...`) and starts one exact Cindy catalog route with `bypassPermissions`. Router answers that are not a native route (`self`, `split`, ...) come back unchanged and start nothing. |
| `status` | Collects the run: durable host runs and paged messages; the full output is saved on disk, a bounded summary of the exact final message returns. |
| `stop` | Cancels through Cindy's scoped cancel API; `stopping` is reported as such until Cindy confirms a terminal state. |
| `cleanup` | Archives the inactive task when Cindy offers archiving, otherwise returns its confirmed task ID for manual archiving. |

There is no automatic callback: call `status` (the `next_tool` every reply names) until the run is terminal.

## Boundaries

- Only Cindy's injected `session_context` identifies the parent; a caller-supplied one is replaced. Remote or read-only
  workdirs are refused before anything is routed.
- Only Claude, Codex and Pi routes run, each on the exact catalog row (connection, model, effort, fast mode); anything
  Cindy cannot reproduce is refused, never substituted. A draft with the wrong route, permission or directory receives
  no input and is archived.
- The worker starts exactly one local program, the AgentCompass `roll` command, with fixed arguments and the task on
  stdin; it removes other agent hosts' session variables from its environment. The plugin makes no network requests;
  AgentCompass itself reads your local account usage and calls the classifier you configured for it.
- Receipts and message pages stay under `~/.agent-compass/cindy-plugin/`.
