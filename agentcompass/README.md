# AgentCompass (`agentcompass`)

A [Cindy](https://github.com/makecindy/cindy) plugin that lets a Cindy session hand work to an AgentCompass route and get the exact
result back. The plugin carries its own copy of the [AgentCompass](https://github.com/akiiwa-games/AgentCompass) routing engine: it
profiles the task, decides whether it should be split, done in the session itself or delegated, picks the harness, model, effort and
fast mode from the models this Cindy can actually run, starts that route as an ordinary Cindy task, checks that Cindy really runs what
was routed, and collects the task's final message. Every delegated child task is created with `bypassPermissions` (Claude) or `full-access`
(Codex, Pi) in the parent session's project directory regardless of the parent session's own mode, and the built-in router reads the tail of
local Codex session logs (`~/.codex` and Cindy's `codex-home`) for quota.

Installing it from the plugin market is enough. It needs nothing else on the machine: no AgentCompass install, no Python, no network
service and no npm dependency. A machine that does have the AgentCompass CLI can switch the plugin over to it (see
[Engines](#engines)).

## How it works

```text
Cindy session ──ghost_call {tool:"roll", args:{task}}──▶ main.js (Cindy logic page)
                                                           │  Cindy injects the trusted session_context;
                                                           │  the live catalog comes from cindy.tasks.models()
                                                           ▼
                                                 worker.cjs (Cindy node bridge, JSON-RPC over stdio)
                                                           │  built-in engine (engine/), or the configured
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

- `ghost.json`: Cindy v3 manifest (`minCindyVersion: "0.1.121"`, `sessionContext`, `agent.tasks`, a Node worker) with four tools:
  `roll`, `status`, `stop`, `cleanup`; the icon `assets/icon.png` and `en`, `zh-CN`, `ja`, `ko` resources in `locales/`.
- `engine/`: the built-in router. `route.mjs` holds the split and self gates, the catalog scoring, the quota reading and fast mode;
  `catalog.mjs`, `profiler.mjs` and `allocator.mjs` are the AgentCompass model catalog, task profiler and allocator (MIT, vendored).
- `main.js`: the logic page. Requires the experimental tasks API, picks the one catalog route that exactly matches the routed
  harness/connection/model/effort/fast setting, creates and checks the draft, sends the full prompt once, and collects results.
- `worker.cjs`: the node bridge. Validates the host context, routes the task, turns the route into an explicit Cindy contract (only
  `claude`, `codex`, `pi`; Claude `bypassPermissions`, Codex and Pi `full-access`; an explicitly different mode is refused), appends the
  return-channel contract, and keeps durable receipts and message pages under `~/.agent-compass/cindy-plugin/`.

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

1. `router.json` next to `worker.cjs`, then `~/.agent-compass/cindy-plugin/router.json`:
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

To bind a custom external AgentCompass CLI checkout instead of writing `~/.agent-compass/cindy-plugin/router.json` by hand, clone and
switch to the standalone plugin repository [`akiiwa-games/cindy-agentcompass-plugin`](https://github.com/akiiwa-games/cindy-agentcompass-plugin)
and run its helper script [`scripts/build_plugin.py`](https://github.com/akiiwa-games/cindy-agentcompass-plugin/blob/main/scripts/build_plugin.py).
Setup details, the support boundary, the real acceptance on Cindy 0.1.121 and the optional local cancel hotfix are documented in the
standalone repository at
[`docs/CINDY_REAL_ACCEPTANCE_AND_CANCEL_FIX.md`](https://github.com/akiiwa-games/cindy-agentcompass-plugin/blob/main/docs/CINDY_REAL_ACCEPTANCE_AND_CANCEL_FIX.md)
and [`docs/real-cindy-0.1.121/acceptance.json`](https://github.com/akiiwa-games/cindy-agentcompass-plugin/blob/main/docs/real-cindy-0.1.121/acceptance.json).

## Safety boundary

- Only Cindy's injected `session_context` identifies the parent; a caller-supplied one is replaced by the host. Remote or read-only
  workdirs and missing context are refused before anything is routed.
- The worker runs as a Cindy task in the local project: the built-in engine routes only to this Cindy's catalog, and the external CLI is
  told `--local-only`, so no remote worker is ever started. `split`, `self` and blocked answers come back unchanged and start nothing.
- No substitution: a model, connection, effort or permission Cindy cannot reproduce exactly is refused, never widened. A draft with the
  wrong route, permission or directory receives no input and is archived (or handed back for manual archiving).
- Idempotent and honest: one operation per session and task, stable request keys. A send whose answer was lost is reconciled through
  `listRuns` and claimed only when the run's input message carries this prompt; it is never resent. Definite pre-creation and pre-send
  refusals are recorded as `create_rejected` / `send_rejected`. `stopping` is not reported as stopped; cleanup never claims an archive
  that did not happen.
- Concurrency: each operation has its own lock, so a slow route in one session never blocks another session's calls.
- No private IPC, no credentials, no model API of its own; full output stays on disk and only a bounded summary returns to the session.

## Tests

From the root of this repository (`cindy-official-plugins`), run the plugin suite and repository gates:

```sh
node --test .tests/agentcompass.test.mjs .tests/localization.test.mjs .tests/provisioning.test.mjs
```

The standalone development repository [`akiiwa-games/cindy-agentcompass-plugin`](https://github.com/akiiwa-games/cindy-agentcompass-plugin)
also contains the Windows and Linux sandbox end-to-end harness (`npm run test:sandbox` / `npm run test:sandbox:linux` after cloning and
switching to that repository) and its recorded report at
[`docs/sandbox-e2e-report.json`](https://github.com/akiiwa-games/cindy-agentcompass-plugin/blob/main/docs/sandbox-e2e-report.json).
