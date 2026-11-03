# cindy-agentcompass-plugin

A [Cindy](https://github.com/makecindy/cindy) plugin that lets a Cindy session hand work to an AgentCompass route and get the exact
result back. The plugin carries its own copy of the [AgentCompass](https://github.com/akiiwa-games/AgentCompass) routing engine: it
profiles the task, decides whether it should be split, done in the session itself or delegated, picks the harness, model, effort and
fast mode from the models this Cindy can actually run, starts that route as an ordinary Cindy task, checks that Cindy really runs what
was routed, and collects the task's final message. Every delegated child task is created with `bypassPermissions` (Claude) or `full-access` (Codex, Pi) in the parent session's project directory regardless of the parent session's own mode, and the built-in router reads the tail of local Codex session logs (`~/.codex` and Cindy's `codex-home`) for quota.

Installing it from the plugin market is enough. It needs nothing else on the machine: no AgentCompass install, no Python, no network
service and no npm dependency. A machine that does have the AgentCompass CLI can switch the plugin over to it (see
[Engines](#engines)).

## How it works

```text
Cindy session ──ghost_call {tool:"roll", args:{task}}──▶ plugin/main.js (Cindy logic page)
                                                           │  Cindy injects the trusted session_context;
                                                           │  the live catalog comes from cindy.tasks.models()
                                                           ▼
                                                 plugin/worker.cjs (Cindy node bridge, JSON-RPC over stdio)
                                                           │  built-in engine (plugin/engine/), or the configured
                                                           │  `agentcompass roll --parent-host native ... --local-only`
                                                           ▼
                                   split / self ◀── gates ── profile → score every catalog route → one exact route
                                                           │
                                   harness/permission made explicit, Cindy return channel appended, receipt saved
                                                           ▼
             cindy.tasks: create (exact route, bypassPermissions) → verify draft → send (expectedRevision)
                                                           │
             status → getRun / readMessages (every page saved on disk) → exact outputMessageId → final report
```

- `plugin/ghost.json`: Cindy v3 manifest (`minCindyVersion: "0.1.121"`, `sessionContext`, `agent.tasks`, a Node worker) with four tools:
  `roll`, `status`, `stop`, `cleanup`; the icon `plugin/assets/icon.png` (from `scripts/make_icon.mjs`) and `en`, `zh-CN`, `ja`, `ko`
  resources in `plugin/locales/`, as the official plugin repository requires.
- `plugin/engine/`: the built-in router. `route.mjs` holds the split and self gates, the catalog scoring, the quota reading and fast mode;
  `catalog.mjs`, `profiler.mjs` and `allocator.mjs` are the AgentCompass model catalog, task profiler and allocator (MIT, vendored).
- `plugin/main.js`: the logic page. Requires the experimental tasks API, picks the one catalog route that exactly matches the routed
  harness/connection/model/effort/fast setting, creates and checks the draft, sends the full prompt once, and collects results.
- `plugin/worker.cjs`: the node bridge. Validates the host context, routes the task, turns the route into an explicit Cindy contract (only
  `claude`, `codex`, `pi`; Claude `bypassPermissions`, Codex and Pi `full-access`; an explicitly different mode is refused), appends the
  return-channel contract, and keeps durable receipts and message pages under `~/.agent-compass/cindy-plugin/`.
- `scripts/build_plugin.py`: writes a plugin source directory bound to one external AgentCompass install (optional).
- `scripts/cindy_0_1_121_cancel_hotfix.py` and `patches/cindy-0.1.121-cancel.patch`: the opt-in local fix for cancellation on Cindy 0.1.121.

## The built-in engine

`roll` routes the complete task, unchanged, against the catalog Cindy reports for this machine (`tasks.models()`):

- **split**: an assignment with two or more independent deliverables (task headings, or listed items marked independent) returns
  `status: "split"` with `task_count`; nothing starts. Roll each task separately.
- **self**: an explicit request not to delegate, or a short question with no work in it, returns `status: "self"`; nothing starts.
- **native**: otherwise the AgentCompass profiler sets the work kind and difficulty, and the allocator scores every Claude, Codex and Pi
  row with each effort the row offers. The best one is started. Where one model is offered by both Pi and its native CLI, Pi wins for
  read-and-report work and the native CLI otherwise, as in AgentCompass.
- **quota**: the newest rate-limit snapshot the Codex CLI wrote to its session logs (`$CODEX_HOME`, else `~/.codex` and Cindy's own
  `<app data>/CindyGlobal/codex-home`) lowers the score of routes on that connection when it is high or exhausted. The decision lists
  `quota_penalized_routes` and warns when the chosen route itself is short of quota.
- **fast mode**: a task that asks for it ("fast mode", "urgent", "ASAP", "加急", …) gets Codex fast mode when the row supports it and the
  quota snapshot shows less than 60% used. Unknown quota never turns fast mode on.
- **blocked**: a catalog with no Claude, Codex or Pi model, or none that meets the task's floor, is refused; nothing is guessed.

Every decision is saved with the receipt (`router.stdout.json`): profile, chosen route, score components, alternatives and quota.

## Engines

The worker reads its configuration again on every request; the first match wins:

1. `router.json` next to `worker.cjs` (written by `scripts/build_plugin.py`), then `~/.agent-compass/cindy-plugin/router.json`:
   `{"command": [...complete roll command...], "accountMappings": [...], "stateRoot": "..."}`. The external CLI routes:
   `<command> --parent-host native --parent-id <session_id> --parent-address <session_id> --local-only "<reason>" --task - --verbose`.
2. `~/.agent-compass/cindy-plugin/config.json` with `{"engine": "cli"}`: the `agentcompass` on `PATH`, then in `~/.local/bin` (Windows:
   `agentcompass.exe`, `%USERPROFILE%\.local\bin`). If it is not installed the built-in engine routes and the answer says so in
   `engine_note`. `{"engine": "builtin"}` is the same as no file.
3. Nothing (a market install): the built-in engine.

An unreadable `router.json` or `config.json` fails the call with the file named; nothing is routed. With the external CLI, Cindy
connection bindings come from `router.json`, else from `~/.agent-compass/cindy-plugin/account-map.json`
(`[{"routerProvider":"codex","routerAccount":"codex","providerId":"<Cindy connection ID>","agentKind":"codex"}]`, `agentKind` is
`cc`, `codex` or `pi`), else a routed account needs a Cindy connection of the same name. The built-in engine routes to catalog rows
directly and needs no mapping.

## Install and use

1. Install the `agentcompass` plugin in Cindy and approve Node, sessionContext and tasks.
2. On the plugin's page set **Write access** to **Full access** and **Working folder** to the project being delegated.
3. Delegate: `ghost_call` with `{"ghost_id":"agentcompass","tool":"roll","args":{"task":"<complete task unchanged>"}}`.
4. Call the `next_tool` it returns (`status`) until the run is terminal **and** `messages_complete` is `true`. There is no automatic
   callback. A terminal run whose pages are not all read yet keeps pointing at `status`.
5. Call `cleanup`. Cindy 0.1.121 has no archive API, so it answers `manual_cleanup_required` with the confirmed task ID: archive that
   task from the task list.

`stop` cancels the run and waits up to ten seconds for Cindy to confirm a terminal state (`confirmed_terminal`). `cleanup` refuses
(`cleanup_refused`, with the tool to call next) while delivery is unconfirmed, while any run of the task is active, before every message
page is read, and whenever it cannot verify the task.

To bind one external AgentCompass install instead, build a source directory and install that:

```sh
python -X utf8 scripts/build_plugin.py --output <new-absolute-directory> [--router-cmd <agentcompass|checkout|JSON command>] [--account-map map.json]
```

The build installs nothing and refuses an existing output directory. In Cindy use `ghost_forge_pack({dir:"<plugin source>"})` and the
official installation flow.

Setup details, the support boundary, the real acceptance on Cindy 0.1.121 and the cancel fix:
[docs/CINDY_REAL_ACCEPTANCE_AND_CANCEL_FIX.md](docs/CINDY_REAL_ACCEPTANCE_AND_CANCEL_FIX.md).

## Safety boundary

- Only Cindy's injected `session_context` identifies the parent; a caller-supplied one is replaced by the host. Remote or read-only
  workdirs and missing context are refused before anything is routed.
- The worker runs as a Cindy task in the local project: the built-in engine routes only to this Cindy's catalog, and the external CLI is
  told `--local-only`, so no remote worker is ever started. `split`, `self` and blocked answers come back unchanged and start nothing.
- No substitution: a model, connection, effort or permission Cindy cannot reproduce exactly is refused, never widened. A draft with the
  wrong route, permission or directory receives no input and is archived (or handed back for manual archiving).
- Idempotent and honest: one operation per session and task, stable request keys. A send whose answer was lost is reconciled through
  `listRuns` and claimed only when the run's input message carries this prompt; it is never resent. A definite refusal is recorded as
  `send_rejected` and its draft archived. `stopping` is not reported as stopped; cleanup never claims an archive that did not happen.
- Concurrency: each operation has its own lock, so a slow route in one session never blocks another session's calls.
- No private IPC, no credentials, no model API of its own; full output stays on disk and only a bounded summary returns to the session.

## Tests

```sh
npm test                    # node: market gate, engine, plugin boundary, real worker.cjs bridge; python: build script, hotfix refusals
npm run test:sandbox        # end-to-end in an isolated home: market install -> fake Cindy host -> real worker.cjs -> both engines
npm run test:sandbox:linux  # the same plus unit tests in the WSL docker-desktop distro, in a /run tmpfs with musl Node and Python
```

`test/test_market_contract.mjs` checks `plugin/` against the makecindy/cindy-official-plugins CI gate: the pinned Cindy
`validateGhostManifest` (vendored unmodified under `test/vendor/`, Apache-2.0) plus the repository's id, version, tool, icon,
locale and package rules, and that the engine imports only Node built-ins and package files.

`test/sandbox-e2e.mjs` substitutes only the Cindy host (`test/zero_cindy_host.mjs`, fed the catalog a real Cindy 0.1.121 reported), the
model behind the external router's classifier (a local OpenAI-compatible fixture) and discovery placeholders for provider CLIs. Everything
else runs for real: the market install with nothing else on the machine; the built-in engine producing Codex, Claude and Pi routes,
`split`, `self`, fast mode and quota moves from real Codex telemetry files; the external `agentcompass roll` when opted in, and the
built-in fallback when the CLI is missing; concurrent rolls across sessions, a forged `session_context`, 12 message pages, a 2.6 MB reply,
stop to a confirmed `cancelled` state, archive and `manual_cleanup_required` cleanup, drafts that fail verification, and PR #274
review cases 1, 2, 5, 6 and 7 end to end (all seven are unit-tested). Set `AGENTCOMPASS_CHECKOUT` to an AgentCompass checkout for the CLI scenarios (default `../route_manager`). The latest
Windows and Linux runs are in [docs/sandbox-e2e-report.json](docs/sandbox-e2e-report.json), with every scenario's input and host record
under `docs/sandbox-artifacts/`; machine paths are replaced by `<sandbox>`, `<repo>`, `<home>` and similar names.

The real Cindy 0.1.121 run of this version, with every tool call and answer, is in
[docs/real-cindy-0.1.121/](docs/real-cindy-0.1.121/acceptance.json).

## How AgentCompass fits with the other hosts

AgentCompass is the router: a profiler classifies each task, the allocator picks an owner/model/effort against live quota, and every
decision is recorded. Hosts own the sessions and the worker processes:

| Host | How work reaches AgentCompass | How the worker reports back |
|---|---|---|
| **Cindy** (this plugin) | the plugin's `roll` tool → the built-in engine, or `agentcompass roll --parent-host native` | the Cindy task's final message, collected with `status` |
| **Paseo** | `agentcompass roll` inside a Paseo agent (`PASEO_AGENT_ID`); AgentCompass launches the worker through Paseo | the worker messages its parent agent; AgentCompass notifies completion |
| **Herdr core** | `agentcompass roll` inside an `hc` terminal (`HC_TERMINAL_ID`); AgentCompass starts an owned child terminal | `hc send <parent>` from the worker |
| **Magpie** | [`magpie-agentcompass-router`](https://github.com/akiiwa-games/magpie-agentcompass-router): a Magpie gateway plugin that applies AgentCompass's task profiling and allocation to model requests | in the Magpie request path (routing, not task dispatch) |

Raw shell `roll` inside Cindy is refused by AgentCompass, because a Cindy shell exposes no addressable parent; use this plugin instead.

## License

MIT
