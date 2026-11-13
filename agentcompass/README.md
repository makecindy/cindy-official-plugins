# AgentCompass (`agentcompass`)

A [Cindy](https://github.com/makecindy/cindy) plugin that lets a Cindy session hand work to an AgentCompass route and get the exact
result back. The plugin carries its own copy of the [AgentCompass](https://github.com/akiiwa-games/AgentCompass) routing engine: it
profiles the task, decides whether it should be split, done in the session itself or delegated, picks the harness, model, effort and
fast mode from the models this Cindy can actually run, starts that route as an ordinary Cindy task, checks that Cindy really runs what
was routed, and collects the task's final message. Every delegated child task is created with `bypassPermissions` (Claude) or `full-access` (Codex, Pi) in the parent session's project directory regardless of the parent session's own mode, and the built-in router reads the tail of local Codex session logs (`~/.codex` and Cindy's `codex-home`) for quota, and the `errand` map of Cindy's `owners/*/ghost-errand-prefs.json` to notice a change of the model on the plugin card (keeping only a digest).

Installing it from the plugin market is enough, once Cindy is signed in to a Cindy account (see the next section). It needs nothing else on the
machine: no AgentCompass install, no Python, no network service and no npm dependency. A machine that does have the AgentCompass CLI can switch the
plugin over to it (see [Engines](#engines)).

## A Cindy account is required

**Sign in to a Cindy account before using this plugin.** While Cindy is signed out, every tool of the plugin, `roll`, `status`, `stop` and `cleanup`
alike, stops at a Setup card ("AI 模型服务", with 打开模型设置 and 取消). Cancelling answers `SETUP_CANCELLED` and the plugin does not run at all, even with
an explicit `profile`. Codex, Claude and Grok sign-ins do not count, even when Cindy's agents run on them. This was measured on real Cindy 0.1.121
([evidence](https://github.com/akiiwa-games/cindy-agentcompass-plugin/blob/main/docs/sandbox-real-e2e/README.md)).

The cause is on Cindy's side and the plugin cannot opt out: the live classifier needs `cindy.text` in the manifest, and Cindy requires its own
account for any plugin that declares a `cindy` capability, on every tool. Two things there do not line up
([draft upstream issue](https://github.com/akiiwa-games/cindy-agentcompass-plugin/blob/main/docs/sandbox-real-e2e/upstream-issue-draft.md)): the card speaks of image or video capabilities although this plugin only uses
text, and `ghosts.setupStatus` answers `ready: true` while `ghost_call` is stopped.

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

- `ghost.json`: Cindy v3 manifest (`minCindyVersion: "0.1.121"`, `sessionContext`, `agent.tasks`, `cindy.text`, a Node worker)
  with four tools: `roll` (accepting `task` and an optional explicit `profile` override), `status`, `stop`, `cleanup`; the icon
  `assets/icon.png` and `en`, `zh-CN`, `ja`, `ko` resources in `locales/`.
- `engine/`: the built-in router. `route.mjs` holds the live model classifier prompt/schema/validator/cache, the profile-driven
  split and self gates, the catalog scoring, the quota reading and fast mode; the sixteen other modules (`axis-scores`, `allocator`,
  `candidate-eval`, `candidate-ranking`, `catalog`, `continuity`, `fleet`, `plans`, `profiler`, `quota-economy`, `quota-loader`, `quota-pools`,
  `quota`, `reference-data`, `task-intake`, `user-scores`) are the AgentCompass v0.6.0 scoring engine as ported to
  [`magpie-agentcompass-router`](https://github.com/akiiwa-games/magpie-agentcompass-router) (MIT): each is its source at the commit in its header,
  with only the header and import paths added by the standalone repository's `scripts/vendor_engine.mjs`, which reads one Magpie commit and never a working tree, and a test there pins the digests. They read no file and no environment variable; the router hands
  the engine only a profile it has checked. `classifier-cases.json` is the AgentCompass rubric and calibration set, unchanged.
- `main.js`: the logic page. Requires the experimental tasks API, puts the classification to Cindy's quick-text channel when the
  built-in engine needs a live task profile, picks the one catalog route that exactly matches the routed
  harness/connection/model/effort/fast setting, creates and checks the draft, sends the full prompt once, and collects results.
- `worker.cjs`: the node bridge. Validates the host context, coordinates the two-step built-in classification and routing, turns the
  route into an explicit Cindy contract (only `claude`, `codex`, `pi`; Claude `bypassPermissions`, Codex and Pi `full-access`; an explicitly
  different mode is refused), appends the return-channel contract, and keeps durable receipts and message pages under
  `~/.agent-compass/cindy-plugin/`.

## The built-in engine and live classifier

`roll` routes the complete task, unchanged, against the catalog Cindy reports for this machine (`tasks.models()`). All task profile fields
(`work_kind`, `interaction_style`, `reasoning_depth`, `code_complexity`, `axis_demand` with `divergence`, `coding`, `aesthetics` and
`tool_operation` each 0..3, `access`, `multi_task`/`task_count`, `needs_visual`, `needs_gui`, `local_only`, `expected_hours`, `hours_confidence`, `urgency`,
`self`, `wants_fast`, `read_only_review`) come strictly from the live classifier model's semantic judgment or an explicit caller-supplied `profile`—never from
keyword, regex or length heuristics on the task text:

- **live model classification**: when no caller `profile` is supplied and the task input is not already cached, the logic page makes one
  request on Cindy's quick-text channel (`cindy.send({type:'cindy-request',kind:'oneshot_text',expectJson:true})`, manifest
  `cindy.text: ["oneshot"]`): one model request with no Agent, no tools, no task and no session, so nothing appears in the task list. It
  spends the user's model quota, including when the answer is `split` or `self`. **Cindy chooses the model**: the one picked on the plugin
  card, else the manifest's `oneshotModel` (this plugin sets none), else the auxiliary chain in Cindy settings. The plugin cannot name it and
  learns it from the answer (`classifier_model`). Cindy runs this channel on its Cindy account (`xd`), OpenAI, xAI and Anthropic API-key
  connections; a Claude subscription adds no quick-text model.
- **the prompt**: the AgentCompass `SCORER_PROMPT` without its CRITICAL RULES 2-5 (each one repeats, more briefly, an entry of the rubric that follows),
  then `engine/classifier-cases.json` (the AgentCompass file `skills/agent-compass/references/classifier-cases.json`, unchanged: route
  definitions, rubric, 66 calibration cases; the standalone repository compares it with AgentCompass's own file), the schema as one entry per field
  with every constraint and every description but the four the rubric covers (`local_only`, `wants_fast`, `read_only_review`, `axis_demand`), and last the
  whole task inside an `untrusted_task_evidence` JSON envelope with prompt-injection rules. The answer is validated against `TASK_PROFILE_SCHEMA` with every
  field required, so one without `self`, `wants_fast` or `read_only_review` is `invalid_classifier_output` and starts nothing (including `axis_demand`, exactly the four keys with an integer 0..3 each, and `expected_hours` in
  `0.05..24`; a non-empty `reason` longer than 240 characters is truncated to 300 characters and accepted, as in AgentCompass). `task_count` is a JSON string and the prompt says so; a positive whole number is read as its bucket (1, 2, 3, 4 and up as `">3"`) and then
  checked like the string. Any other value, or one that contradicts `multi_task`, is invalid. The answer is cached in memory and in
  `~/.agent-compass/cindy-plugin/score-cache.json`, keyed by prompt/schema digest and full task input.
- **the 32,768-character budget**: this channel takes a single `prompt` of at most 32,768 characters and has no separate context field, so the
  task and the instructions share it. The rubric and route definitions always go whole; calibration cases take what is left, whole ones only, in
  an order computed from the fields of the case file alone (`calibrationCaseOrder`), never from what the task says: the `multi_task` case, one case of
  each `reasoning_depth` rarest first, one case of each demand level of each `axis_demand` category rarest first, then one of each `work_kind` in turn,
  shortest first. 63 of the 66 fit a short task; 57 fit at 3,000 characters, 48 at 6,000, 37 at 9,000, 27 at 12,000 and 16 at 15,000. Every one of those
  signals (the `multi_task` case, every depth and every demand level) is there up to about 17,550 characters; above that, whatever still fits goes in,
  in that order, so tool_operation 1 goes first at about 17,560. `decision.classifier_calibration_cases` records `{included, total}`. A task that does
  not fit with no cases left (about 19,800 characters once JSON-escaped) is refused with `task_too_long_for_classifier`, never cut; give it an explicit
  `profile`.
- **when the classifier is unavailable**: on any failure the built-in engine **never** falls back to keyword profiling. It returns
  `status: "blocked"` with `profile_source: "unavailable"`, a `decision.reason` of `classifier_<Cindy's code>` (`classifier_no_candidate`,
  `classifier_timeout`, `classifier_rate_limited`, ...) or `invalid_classifier_output`, no `prepared` receipt, and a `next_action` saying the model
  can be changed on the plugin card (for `classifier_rate_limited`, Cindy's limit on requests in flight, to roll again shortly). An existing receipt is
  left in place.
- **a failed classification cools down**: Cindy chooses the model, so a retry cannot go elsewhere. For 30 s, doubling to 5 min with each
  consecutive failure, `roll` answers at once with `classifier_cooling_down`, the original failure, the wait and what else works, without asking Cindy
  (`classifier-cooldowns.json` in the state directory). `classifier_no_candidate` and `classifier_permission_denied` say the channel cannot answer and
  hold up every task. Any other failure (`INTERNAL`, `TIMEOUT`, a malformed answer) may be that task's doing and holds up only that task's text, in every
  session. `classifier_rate_limited` holds up nothing. A classified task clears it, and so does any change of what picks the model: the card, `oneshotModel`
  or the catalog. The card has no API, so that one is seen through `errand` in `<app data>/owners/*/ghost-errand-prefs.json`, an undocumented Cindy file; if
  Cindy changes it, the cooldown just runs out. The plugin cannot see the auxiliary model in Cindy settings or a permission at all, so a fix there waits out
  the cooldown, up to 5 minutes, and the answer says so. No wait is longer than 5 minutes, even with the clock moved back. Cached tasks and explicit
  profiles are not held up.
- **an explicit `profile`** must give every field in the tool schema's `required` list (including `wants_fast` and `read_only_review`; only `self` and `reason` may be omitted), otherwise `invalid_caller_profile` and nothing starts;
  `profile: null` is the same as no profile.
  The external CLI classifies for itself and takes no profile: passing one answers `profile_not_supported_by_cli`.
- **a named model or effort**: `routeTask` takes `constraintModel` or `pinnedModel` (`gpt-6-astra`, or `gpt-6-astra:high`) and `constraintEffort`, and holds
  every task to them, as AgentCompass does with a pin; only the caller can give them, never the task text, and `decision.pinned` records them. When nothing
  on offer matches, `roll` is `blocked` (`decision.refusal` says `pin_not_in_pool` or `pin_unavailable`); nothing else stands in. The `roll` tool takes only
  `task` and `profile`, so today a user in Cindy cannot name one.
- **a row with a gap in its data leaves automatic routing**: AgentCompass v0.6.0 has no default for a missing number. A model with no scores for a category the
  task demands (`gpt-5.3-codex-spark` has none), a billed account with no price, or an account whose capacity is unknown is a data error: that row is out of
  automatic routing and `decision.excluded` says why, one line per reason with the rows it takes out. Naming the model dispatches it anyway, with the
  data error in `decision.warnings`. A catalog in which nothing can be routed is `blocked` with `decision.reason: "no_route"`.
- **split**: when the profile has `multi_task: true`, `roll` returns `status: "split"` with `task_count`; nothing starts. Roll each task
  separately.
- **self**: when the profile has `self: true` (or `delegate: false`), `roll` returns `status: "self"`; nothing starts.
- **native**: otherwise the engine (`selectBestRoute`) scores every Claude, Codex and Pi row with each effort the row offers against the profile: how well
  the model fits each demanded category (`axis_demand`, `code_complexity`, `reasoning_depth` and the work kind), plus continuity, minus what the route spends
  of the quota window of the account it draws on, and the best net score is started. A row the profile leaves out (`read_only_review`, `access`, `needs_visual`,
  `needs_gui`) is excluded with its reason. Where one model at one effort is offered by both Pi and its native CLI at the same score, the harness order of the
  work kind decides (Pi first for read-and-report work, the native CLI otherwise), as in AgentCompass; this order is no part of a score and moves no other model.
  `decision.axis_demand`, `decision.components`, `decision.score` and `decision.alternatives` say what was demanded and why this row won.
- **quota and account state**: the newest rate-limit snapshot the Codex CLI wrote to its session logs (`$CODEX_HOME`, else `~/.codex` and
  Cindy's own `<app data>/CindyGlobal/codex-home`) is the one account the engine prices: the plan it reports (`plus`, `pro`) and the usage of its
  `usage` (weekly) and `five_hour` windows. **The plan is read, never assumed**: a reading with no plan, or with no window the plan can price, takes
  that account's Codex and Pi rows out of automatic routing (`capacity_unknown`, `no weekly quota window`), while rows that draw on no quota account (Claude
  rows, or Codex rows when no Codex log exists yet) are an unmetered account and route. A window the plan has no data for (a `five_hour` window on `pro`) is
  named in `decision.warnings` and not priced. More of a window used never makes a route cheaper, and a window that is spent takes the account out. Accounts
  are tracked as `ready`, `plan_inactive`, `usage_failing` or `auth_failed`, and `roll` / `status` surface `warnings` and compact `accounts`. Because Codex writes
  session logs only while running, session log `mtime` is never treated as a reading failure: snapshots whose windows have reset are treated as unknown quota.
  True read failures (unreadable file or corrupt `rate_limits` JSON with no valid earlier snapshot in the file) persist their first-seen time in
  `quota-state.json` in the state directory, warn immediately, exclude the account after 6 h of continuous failure, and clear when a healthy log is read. A
  `plan_inactive` reading (such as `free`) within 6 h excludes the account; one older than 6 h warns and dispatches so the run refreshes telemetry. With several
  Codex connections the snapshot is applied only to one a caller bound to it (`providerId`), never to all.
- **fast mode**: a task whose profile sets `wants_fast: true` gets Codex fast mode when the row is a Codex row Cindy offers fast mode for, the model's own
  AgentCompass data says it has a fast mode, and the quota snapshot shows less than 60% used (`urgency: "high"` is informational and never turns fast mode on by itself). Unknown quota never turns fast mode on.
- **refused routes cool down**: when Cindy refuses `tasks.create` because of the route itself (`ROUTE_UNAVAILABLE`,
  `UNSUPPORTED_CAPABILITY`, `PERMISSION_DENIED`), that route is skipped for 15 min, doubling with each consecutive refusal up to 2 h,
  so the retry goes elsewhere (`route-cooldowns.json` in the state directory; the decision lists `cooling_down`). A task created on
  the route clears it. When every runnable route is cooling down, the roll still routes and warns (`cooldown_warning`).
- **blocked**: a catalog with no Claude, Codex or Pi model (`no_runnable_model`), an unavailable/failed classifier without a caller profile,
  every candidate account excluded (`accounts_unavailable`), or no row that can run the task (`no_route`) is refused (`status: "blocked"`); nothing is
  guessed. On `accounts_unavailable`, `roll` returns `reason: "accounts_unavailable"`, `decision.reason: "accounts_unavailable"`, the failing/excluded
  `accounts` and `warnings`, a clear `error`, and an actionable `next_action`.

Every decision is saved with the receipt (`router.stdout.json`): `profile_source` (`"classifier"`, `"caller"` or `"unavailable"`),
`classifier_model`, `profile`, `axis_demand`, chosen route, score components, alternatives and quota.

### What the plugin does not carry from AgentCompass v0.6.0

- No user scores (`agentcompass score set`, the tray's Manual Scores panel) and no pricing or subscription configuration: the engine's scores are its public
  data, and the one account the plugin prices is the Codex plan its own session logs report. Metered (billed) accounts are not read.
- No `--constraint` or `--effort` option on the `roll` tool and no session continuity between rolls: each roll routes alone.
- No fleet of accounts from AgentCompass's own configuration: the accounts are the Cindy connections in the catalog.
- No Python and no network, as before: the engine modules above are pure JavaScript and read no file.

### Classifier configuration (`~/.agent-compass/cindy-plugin/config.json`)

All classifier fields in `config.json` are optional. The model is not one of them: pick it on the plugin card.

- `classifierTimeoutMs` (`integer`, `100..65000`, default `65000`): how long the logic page waits for Cindy, which itself answers within 60 s.
- `classifierCacheTtlMs` (`integer`, `0..86400000`, default `600000`): TTL in milliseconds for cached profiles in `score-cache.json` (`0`
  disables cache hits).

`classifierModel`, `classifierModels` and `classifierEffort` of earlier versions are ignored.

## Engines

The worker reads its configuration again on every request; the first match wins:

1. `router.json` next to `worker.cjs` (written by the standalone repository's `scripts/build_plugin.py`), then `~/.agent-compass/cindy-plugin/router.json`:
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
- No private IPC, no credentials, no network and no model API of its own (the classification goes through Cindy's quick-text channel, one request with no Agent, tool, task or session); full output stays on disk and only a bounded summary returns to the session.

## Tests

From the root of this repository (`cindy-official-plugins`), run the plugin suite and repository gates:

```sh
node --test .tests/agentcompass.test.mjs .tests/localization.test.mjs .tests/provisioning.test.mjs
```

The standalone development repository [`akiiwa-games/cindy-agentcompass-plugin`](https://github.com/akiiwa-games/cindy-agentcompass-plugin)
also contains the Windows and Linux sandbox end-to-end harness (`npm run test:sandbox` / `npm run test:sandbox:linux` after cloning and
switching to that repository) and its recorded report at
[`docs/sandbox-e2e-report.json`](https://github.com/akiiwa-games/cindy-agentcompass-plugin/blob/main/docs/sandbox-e2e-report.json).
