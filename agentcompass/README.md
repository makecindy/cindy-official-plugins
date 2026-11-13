# AgentCompass (`agentcompass`)

Hand independent work from a Cindy session to the model that fits it, and get the exact result back. 简体中文: [README.zh-CN.md](./README.zh-CN.md).

## What it is

A [Cindy](https://github.com/makecindy/cindy) plugin with four tools: `roll`, `status`, `stop` and `cleanup`. `roll` takes a whole task, decides whether it should be
split, answered in the current session or delegated, and if delegated picks the harness, model and effort from the models **this Cindy can actually run**,
starts that route as an ordinary Cindy task, checks that Cindy runs what was routed, and later hands back the task's final message. The scoring is the
[AgentCompass](https://github.com/akiiwa-games/AgentCompass) v0.6.0 engine, carried inside the plugin as plain JavaScript: nothing else has to be installed, and
the plugin makes no network request.

## Rules you must know

- **A Cindy account is required.** While Cindy is signed out, every tool of the plugin stops at Cindy's Setup card; Codex, Claude or Grok sign-ins do not count. The plugin
  asks Cindy's quick-text channel to profile each task (`cindy.text: ["oneshot"]`), and Cindy demands its own account for any plugin that declares that. Measured on
  Cindy 0.1.121: [evidence](https://github.com/akiiwa-games/cindy-agentcompass-plugin/blob/main/docs/sandbox-real-e2e/README.md). Signed in, the classifier ran on Cindy 0.1.135:
  [evidence](https://github.com/akiiwa-games/cindy-agentcompass-plugin/blob/main/docs/real-cindy-0.1.135-plugin-0.4.0/README.md).
- **What it reads.** The live model catalog from Cindy (`tasks.models()`), and nothing else of Cindy's own data or of any Codex home. Routing on Cindy uses capability fit (the plugin keeps no continuity between rolls),
  with no quota economy and no fast mode until Cindy offers connection kind and quota through its plugin API: the catalog cannot tell the user's own sign-in from the Cindy gateway, so no quota is attached to any connection and fast mode is never chosen.
  A model changed on the plugin card is picked up by the next classification once the cached answer (10 minutes) or a cooldown (at most 5 minutes) has run out. It writes receipts and caches under `~/.agent-compass/cindy-plugin/`.
- **What it never does.** No network, no credentials, no model API of its own. A task is classified by a model, never by keywords in its text. A model, connection, effort or
  permission Cindy cannot reproduce exactly is refused, never widened. A send whose answer was lost is never sent again.
- **When nothing can be routed**, `roll` answers `status: "blocked"` with a `decision.reason` (for example `no_route`, `classifier_no_candidate`) and says what to
  change. Nothing is started. `split` and `self` answers also start nothing. Each classification spends your model quota, including one that ends in `split` or `self`.
- **Every worker** is created in the parent session's project directory with `bypassPermissions` (Claude) or `full-access` (Codex, Pi), whatever the parent's own mode.

## Install and first use

1. Install `agentcompass` from the Cindy plugin market and approve Node, sessionContext and tasks.
2. On the plugin's page set **Write access** to **Full access** and **Working folder** to the project you delegate.
3. Delegate with `ghost_call`:

   ```json
   {"ghost_id":"agentcompass","tool":"roll","args":{"task":"<the complete task, unchanged>"}}
   ```

4. Call the `next_tool` it returns (`status`) until the run is terminal **and** `messages_complete` is `true`. There is no automatic callback.
5. Call `cleanup`. Cindy 0.1.121 has no archive API, so it answers `manual_cleanup_required` with the task ID: archive that task from Cindy's task list.

`stop` cancels the run and waits up to ten seconds for Cindy to confirm. Tool arguments, answers, the profile contract, the optional external `agentcompass` CLI
(`~/.agent-compass/cindy-plugin/config.json` with `{"engine":"cli"}`) and every refusal code are in the
[reference](https://github.com/akiiwa-games/cindy-agentcompass-plugin/blob/main/docs/REFERENCE.md).

## Tests

This directory is a copy of the plugin's `plugin/` folder; its source, unit tests, sandbox end-to-end tests and run records are in
[cindy-agentcompass-plugin](https://github.com/akiiwa-games/cindy-agentcompass-plugin). The market's own checks of it run with `node --test .tests/agentcompass.test.mjs`.

## Fits with the other hosts

The same engine routes Claude Code, Codex CLI, Pi, Paseo and others through `agentcompass roll`, and Magpie requests through
[magpie-agentcompass-router](https://github.com/akiiwa-games/magpie-agentcompass-router). Scoring and quota rules live once, in AgentCompass's
[technical reference](https://github.com/akiiwa-games/AgentCompass/blob/v0.6.0/docs/technical-reference.md).
