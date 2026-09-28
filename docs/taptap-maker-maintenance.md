# TapTap Maker upgrade and compatibility checklist

[简体中文](./taptap-maker-maintenance.zh-CN.md)

## Read first

- Do not remove Cindy safeguards merely to obtain an unmodified upstream bundle.
- The current vendor has **five** patches, not only executed.
- **Logging is not globally disabled.** Cindy relinquished remote-watcher ownership and idle cleanup; system Node runs the watcher and Maker owns its lifetime.
- Maker CLI already validates and persists PAT. Cindy adds status detection, masking, UI and process compatibility; those are not all redundant implementations.
- New versions or matching keywords do not prove equivalent fixes. Inspect released artifacts and behavior.
- This is a maintenance deliverable, not an immediate refactoring instruction. Preserve behavior before replacing implementations.

## Scope and evidence

Audited 2026-09-21 against Cindy 3c26b0b, plugin 2.1.13, Runtime 0.0.33.
Evidence: current code, HEAD history for taptap-maker, individual diffs and .tests/taptap-maker.test.mjs.
Additional 0.0.31 branch evidence is labeled separately; --all does not prove shipment.

A fresh official @taptap/maker@0.0.33 tarball was compared with current dist/maker.js;
differences match V1-V5. Static inspection of the previously downloaded official
0.0.34 package found its normalizer still accepts only not_executed/unknown,
accessStatePromise still caches startup access, blocked lists lack _meta.maker_access,
and blocked calls lack the corresponding structured execution state.
The earlier claim that 0.0.34 absorbed executed and could replace vendor unchanged was incorrect.
Equivalent Skill write protection requires behavioral investigation, not function-name matching.

Historical test/device claims apply only to those builds. Some entries originated
in review rather than a confirmed production incident.

## 1. Five direct Runtime patches

Location: taptap-maker/vendor/taptap-maker/dist/maker.js. Matching inventory:
both READMEs and taptap-maker/THIRD-PARTY-LICENSES.txt.

| ID | Failure and safeguard | Evidence | Upgrade acceptance |
| --- | --- | --- | --- |
| V1 | Explicit executed was downgraded to unknown; accept all three states. | ff54f59, 577da80 | Preserve states through Runtime and Cindy, without inferring retry permission. |
| V2 | Pre-dispatch BLACKLISTED lacked structured state; include structuredContent, message and not_executed. | a5d85df, 431213e | Final result says not executed; zero remote calls. |
| V3 | Startup access cache survived PAT changes; check per list/resource/call request. | 2a80b28 | Reevaluate changed credentials/restrictions within the same instance, without bypassing restrictions. |
| V4 | Restricted list became missing-tool error; retain reason in _meta.maker_access. | c0e3c5b, d54ef28 | Preserve reason/not_executed without widening the restricted list. |
| V5 | Symlinked Skill roots could escape the project; check before pull and installation. | a506b40, 6c4f223 | Reject existing symlinks along .installer/skills, .codex/skills, .cursor/skills and .workbuddy/skills before writes. |

This is Cindy's safeguard inventory, not an upstream acceptance requirement.
A patch inside the Maker bundle does not automatically belong upstream.
Keep equivalent safeguards until the replacement is verified.

### Ownership: Maker remains independent of Cindy-specific requirements

Ask: does the problem exist without Cindy, do Maker or other consumers benefit,
can existing CLI/MCP interfaces solve it, and is the maintenance cost justified?
Only changes with independent value and reasonable benefit belong in Maker.
These are recommendations, not proof that upstream must adopt a particular
implementation or authorization to modify the Maker repository.

| Change | Does Maker need it? | What stays in Cindy? |
| --- | --- | --- |
| V1 states / non-replayable operations | Generic correctness: confirmed execution should not be downgraded and disconnects should not duplicate charges/resources. Maker defines its own field contract. | State preservation, host messages and retry gates, not upstream Cindy-specific wording. |
| V5 Skill write safety | Project escape risk exists independently; suitable for Maker after checking the threat and existing safeguards. | Artifact verification and local protection until equivalent coverage exists. |
| V2 structured pre-dispatch rejection | Useful diagnostic/safety candidate for other callers; not a requirement to adopt Cindy's entire result shape. | Adapt Maker errors to Cindy's final three-state contract. |
| V3 PAT/access cache invalidation | Conditional: establish whether standalone Maker supports live credential/permission changes and when they take effect. Do not mandate per-request authentication merely for Cindy hot switching. | Existing compatibility; evaluate reliable restart/invalidation. Per-request auth is the current implementation, not a mandated upstream design. |
| V4 restricted-list reason | Conditional diagnostic value; _meta.maker_access is today's adaptation, not a mandatory Maker API. First assess existing status surfaces. | Convert restricted status into UI guidance without forcing list changes to fix Cindy wording. |
| PAT / project management | Existing Maker CLI already validates, persists and operates projects; this does not establish a need for a new Host API. Add only proven general status/error gaps. | Input UI, redaction, multi-selection, batch orchestration, folder selection and host permissions. |
| Media toggles, aliases, identity recovery, UI | Cindy policies; no evidence Maker needs these features. Calling Maker QR generation does not make Cindy recovery policy upstream business logic. | Settings, interception, names, authorization, messages, retries and preview presentation. |
| Electron stdio, childSpawn, watcher exceptions, roots proxy | Cindy host compatibility. Propose generic fixes separately only if standalone Maker has the same defect. | Compatibility code and regressions; do not remove protections for tidiness. |
| Console / local preview integration | Reuse existing CLI and JSON capabilities; no prerequisite new protocol, SDK or rewritten lifecycle just for Cindy. | Authorization, host launch adaptation, opening pages and presenting results; discuss upstream changes only for real general gaps. |

The previously proposed full Host Integration protocol/SDK is not the default
prerequisite. Reuse existing capabilities and add only necessary interfaces for
demonstrated general gaps; do not force the repositories into lockstep releases.

## 2. Host/process compatibility

### H1. Log watcher repeatedly launched Cindy

- df08857 added Cindy idle cleanup; 5305627 removed that ownership.
- Electron process.execPath is not ordinary Node; the watcher manages PIDs and starts its own proxy.
- node/child-process-adapter.cjs runs logs watch using system node, not spawnEntry. Missing Node fails once and Maker degrades; never fall back to Cindy.exe. Build __maker-proxy still uses spawnEntry.
- Tests cover routing/failure. Commit 5305627 records Windows production verification of logs without repeated processes; this audit did not repeat it.
- Console/preview supervisors require executable/ownership verification too. Remote-watcher and local-preview logs are separate paths.

### H2. Pinned stdio broke all Windows tools

- 14cfc58; node/maker-mcp.cjs. Non-configurable process.stdin getters caused Cannot redefine property: stdin.
- Select replacement or in-place routing by property descriptors, not platform names; preserve buffered initialize bytes and avoid recursion.
- Test real Runtime with pinned stdin/stdout and buffered initialize, not only ordinary node startup.

### H3. childSpawn differs from spawn

- Introduced in 41d53ce; node/child-process-adapter.cjs, node/maker-child.cjs, node/account.cjs.
- Bridge asynchronous handles without losing early PAT stdin bytes.
- Redirect only the fixed Maker entry; reject undeclared process.execPath scripts. Use supported proxy JSON arguments, not arbitrary environment/command execution.
- Electron ParentPort may keep completed CLI workers alive. Detect command-specific final JSON, not progress, before cleanup.
- Test fixed-entry routing, final output and buffered PAT; retain heartbeats, total timeout and output limits.

### H4. MCP roots and timeout isolation

- Introduced in 41d53ce; node/mcp-root-router.cjs.
- Host lacks generic reverse RPC. Provide one trusted root only to the active tools/list; reject other reverse methods.
- Queue lists; timeout rejects stale responses and queued work and rebuilds the worker to avoid cross-project contexts.
- Test roots, timeout and real Runtime. 52f15ee fixed a Windows test assumption: derive expected URIs with pathToFileURL too.

## 3. Account, project and tool safeguards

Source paths below are relative to taptap-maker/. Tests are in .tests/taptap-maker.test.mjs.

| ID | Required behavior | Evidence / location | Acceptance focus |
| --- | --- | --- | --- |
| A1 PAT | Maker pat set --pat-stdin --json validates/persists; Cindy reads environment/current/legacy paths for presence and masked hints. Strip hints/storage paths from Agent results, clear input, no copy to Cindy KV/Secret. | 41d53ce, 9029599; node/account.cjs, settings.js, main.js | No PAT in args/logs/model results; network failure is not definite logout. Replace file compatibility only with an equivalent safe Maker interface. |
| A2 Diagnostics | Recognize existing missing/expired/401/403 formats; distinguish Git/Python/directory/network failures. | 3b8f23d, 8475e33, 6e4affe; node/account.cjs | Actionable sanitized errors; preserve classification when adopting error codes, no broader retries. |
| A3 Sync directories | Stable names with ID disambiguation; accept empty or verified same-project config/ID/Git origin; reject relevant symlinks/unverifiable metadata. | ddcc0b7, 675d2c3, e58a241, d5132e4, 9cbebaa; node/account.cjs | Never overwrite another project; production/RND origins match selected environment. |
| A4 Settings jobs | Deduplicate reqId, serialize account mutations, at most five projects with individual results, --skip-mcp-install. | 41d53ce, 9029599; main.js, node/account.cjs | No duplicate login/clone, visible partial failure, no extra Agent MCP registration. |
| T1 Workspace/read-only | Override target_dir with host local workdir; block possible writes in read-only sessions. Settings batch sync separately uses explicit folder selection. | 41d53ce, df08857, 7280910; main.js | query_video_task writes videos and feedback queries download attachments; names do not establish read-only safety. |
| T2 Media toggles | Default enabled; disabling blocks matching requests only, without hiding catalogs, forwarding or canceling submitted jobs. | 3e0dffb, 6602807, 431213e; main.js, settings.js | Fail closed on unreadable/corrupt settings, recheck on retries, retain video queries, no false save success or unrelated-setting overwrite. |
| T3 Identity | Explicit missing identity plus absent/not_executed permits coalesced workspace QR initialization and one retry; missing build requires authorization. | 9029599, 891868e; main.js | No executed/unknown recovery, endless retry or implicit build after QR/second-call/orientation errors. |
| T4 Errors/states | Parse structuredContent, remote_result, error_details and fixed texts; retain unknown after recovery/retry and request remote verification. | 891868e, d0b428c, 7465ceb; main.js | Sanitization preserves state, hides credentials/paths/stacks, retains exact balance signal without misclassifying unrelated errors. |
| T5 Status/catalog | Alias fixed tools to maker_status/maker_build, exclude dynamic dispatch; catalog is a bundled snapshot; status can emit /tracking. | 891868e, bdc6bdd; main.js, manifest, locales | Preserve detail/skip_remote_sync, no zero-network claim or skipped access/project checks. |
| T6 Guidance | Map standalone CLI/npm/env instructions to Cindy actions; distinguish missing/ready/upgrade-suggested dependencies; both entries set cindy_plugin. | 891868e; main.js, node/maker-mcp.cjs, node/maker-child.cjs | No standalone npm replacement of bundled runtime. Text parsing is debt, not disposable behavior. |
| U1 Build UI | Validate maker_url, retain localDev=1, add hide_chat=1/sessionId, open sidebar and return link. | 41d53ce, df08857; main.js | Page failure does not erase build success or resubmit. This is remote preview, not UrhoX local window. |
| U2 Docs/UI | Four locales, error-code mapping, Skill-to-Manual migration, Maker-specific recall, fixed ads resource and UrhoX library restrictions. | e5e1396, 7f00a60, a887ccc, 20b0b06 | Do not guide Agents around the plugin; these remain delivery behavior even without Runtime patches. |

## 4. Branch history and superseded fixes

- 0.0.31 branch: e4e5f63 prevents confirm_character_voice replay; aec91dd separates pre-dispatch initialization from post-dispatch uncertainty; a3d295d handles remote isError states. These are --all branch evidence, not current HEAD's merged commit list. 891868e later replaced the bundle with 0.0.32. Verify non-replay behavior instead of reapplying old lines.
- df08857 watcher cleanup was replaced by 5305627; do not restore the deleted controller.
- 577da80 documented one patch at that time; four followed. One upgrade message is not the full inventory.
- 52f15ee fixed dependency attribution and packaged licenses; check new dependencies and final .cindy notices too.

## 5. Minimum upgrade acceptance

### Implemented repeatable upgrade

From the repository root:

    node .github/scripts/sync-maker-runtime.mjs 0.0.34
    node .github/scripts/sync-maker-runtime.mjs 0.0.34 --check

The version recipe at .github/maker-runtime/0.0.34.json records tarball SHA-512,
original/patched bundle SHA-256, five exact patches and the full vendor inventory.
Only reviewed recipes are accepted. Download and verify identity, integrity,
anchors, syntax and inventory in staging before replacing vendor. Failures leave
the old directory intact; failed replacement attempts rollback and preserves the
backup if rollback itself fails. Upstream docs/Skills remain unchanged; the
repository-maintained LICENSE is restored. --check validates vendor offline.
The script does not infer new-version patches or update plugin version, public
contracts or license notices automatically. Add a separately reviewed recipe for
each new version rather than editing an old recipe to hide differences.

This upgrade is plugin 2.1.15 / Runtime 0.0.34 with all five patches retained.
Added notices cover long, marked, protobufjs, ws and Lucide/Feather icons.
.tests/taptap-maker-upgrade.test.mjs covers reproducibility, anchor rejection and
inventory validation. Historical baseline results do not replace new-package checks.

### 2026-09-21 live verification and boundaries

- Cindy 0.1.89 on macOS: Host Forge packaged and updated plugin 2.1.15 in place, retaining enabled state, preferences and data.
- Real ghost_call maker_status returned version 0.0.34 and managed_by_plugin with PAT/TapTap auth recognized. The plugin-source workspace correctly remained unbound; it was not initialized or built.
- maker_apps, maker_list_tools and maker_ads_guide succeeded. An intentionally nonexistent tool returned not_executed / automatic_retry: false; no paid generation was dispatched.
- All 84 automated tests passed, including the upgrade and console-entry checks. Windows production, changed PAT/restricted accounts, remote builds, real log polling and game visuals were not reverified on devices this round.
- The plugin adds a `maker_console` entry tool and a settings-page button. They reuse the Runtime's `console open --no-open --json` command, validate loopback URLs, and open the page through Cindy preview; they do not build or install a game runtime.
- Console background launch uses system Node via `execFile('node', ...)`, not Cindy's Electron executable. It keeps the process outside `maker-child`; ownership, shutdown and cross-session behavior still need real-device verification.
- The console page and UrhoX native game window are different. Keep existing remote maker_build behavior. The plugin explicitly declares loopback preview access and validates the returned loopback URL before opening it; this does not make the native game window an Agent preview.

This records the completed upgrade and the remaining verification boundaries;
it does not claim that the UrhoX native game window is an Agent preview.

1. Pin source version, record tarball/integrity, compare vendor/upstream, then review intervening fixes.
2. Mark V1-V5 as equivalent upstream fix, still needed or unverified. Unverified is not absorbed.
3. Run Maker tests and four repository commit-gate suites; cover real Runtime, pinned stdio, absent Node, PAT stdin, roots, irreversible errors, toggles and directories.
4. Verify new package processes/UI on Windows/macOS; separately exercise restrictions, PAT changes and recovery. String/extracted-function tests do not prove all end-to-end behavior.
5. The new console entry uses system Node, validates loopback URLs, and opens the page in Cindy; cross-session shutdown and the native UrhoX window still need real-device verification.
6. Synchronize bilingual docs, four-language contracts, licenses, plugin version and actual device notes; state gaps.

Not all low-level logic belongs upstream; establish independent value before changing Maker.
Remove old compatibility only after its replacement passes corresponding checks.
