# TapTap Maker upgrade and compatibility checklist

[简体中文](./taptap-maker-maintenance.zh-CN.md)

## Read first

### 2.1.30: Windows PAT integration verification

On 2026-11-12, installed commit 5896bcc from fix/taptap-maker-pat-stdin in place
as local 2.1.30 on Windows 10 / Cindy 0.1.133 (source commit
95e70d24407638cac83220f46f0751c42017fe1e). A temporary verification package used
the real Cindy account worker, childSpawn, and Runtime 0.0.41: both user-provided
valid PATs saved successfully, replacement and repeated saving succeeded, an
invalid placeholder returned PAT_AUTH_REQUIRED / HTTP 401, and restoring a valid
PAT returned connected status and a working project query.

The original settings.html / settings.js were also loaded inside the plugin
sandbox, exercising the original form submission, BroadcastChannel, main.js,
and account worker. Valid saves cleared the input, displayed success, and loaded
projects. Invalid input displayed the localized error and error class; recovery
cleared that error state. Test placeholders were mapped to the PAT file only
inside the temporary account entry; credentials were not returned to the page
or model. This is settings-script integration verification in the actual host,
not manual interaction with the plugin detail page or visual color verification;
it does not replace the recorded macOS visual evidence.

After testing, removed the temporary tools and file-reading entry and reinstalled
the original 5896bcc package, retaining the valid account. All 109 Maker tests
and 53 contract/localization/provisioning tests passed, as did the 0.0.41 recipe
check. Publishing workflow tests had 8 passes and 4 failures because jq is absent
on this computer; no publishing scripts or assertions were weakened. Neither
PAT appeared in the main or Agent log. No additional production code or logging
was needed to verify this fix.

### 2.1.30: Account error message color

Settings uses the host error color for account failures, restoring normal text
when messages are cleared, another operation starts, or an operation succeeds.
On 2026-11-12, installed local 2.1.30 on macOS / Cindy 0.1.133 showed a red
credential error after saving a numeric placeholder in the actual dark-mode
settings page. Restoring the valid Prod PAT succeeded and removed the red color.
All 187 regressions passed. Colors use theme variables; light mode was not
tested in this run. PAT validation still calls /api/v1/user/taptap-token;
nonempty input is not accepted based on local format alone. The server can
reject bad credentials quickly. Runtime still persists the PAT before validation.

### 2.1.29: PAT failure reasons and repeated saves

A single successful save in 2.1.28 did not cover credential replacement failures.
On 2026-11-12, querying projects with the credential persisted after the user's
failure returned HTTP 401 / AUTH_TOKEN_EXPIRED. Three consecutive settings saves
with a valid Prod PAT succeeded on that same installation. A failure on the second
save alone does not establish a stdin regression.
The account adapter maps 401, 403 and network failures to fixed codes and recovery
messages. The main entry preserves those codes and settings renders localized
messages in all four languages, without exposing raw Runtime errors or credentials.
Runtime 0.0.41 and V1–V12 remain unchanged, including the existing save-before-token-
exchange behavior. Failed validation does not roll back the previous credential;
save a valid PAT again to recover.
Verified on 2026-11-12 with macOS / Cindy 0.1.133 and installed local 2.1.29:
two successful Prod PAT saves → invalid placeholder rejected with the credential
error message → successful Prod PAT restoration, all through the settings UI.
The final input was empty, status connected, and the plugin's project query
succeeded. All 187 regressions passed. The 403 and network classifications have
automated coverage only; no real permission/network outage was induced.
Windows/Linux settings pages were not tested in this run.

### 2.1.28: PAT stdin compatibility

Runtime remains at 0.0.41. Add V12-pat-virtual-stdin to the recipe and retain V1–V11.
`pat set --pat-stdin` (including the `--pat-from-stdin` alias) reads `process.stdin`
asynchronously through EOF instead of reading OS fd 0; Cindy supplies virtual stdin
over IPC. Preserve UTF-8 chunks, empty-input rejection and stream errors. Runtime
continues to own credential persistence and account verification; PATs stay out of
command arguments, logs and Cindy storage. Regressions cover buffered input, delayed
EOF, whitespace and stream failures. Before release, also save a PAT through the
actual Cindy settings page and verify connected status and project loading.
Verified on 2026-11-12 with macOS, Cindy 0.1.133 and installed local plugin 2.1.28:
clicking Save PAT succeeded, the input cleared, the persisted credential matched,
and a subsequent project query succeeded. No Maker child-process abnormal exit
or plaintext PAT appeared in the operation's host log. Windows/Linux settings
pages were not tested in this run.

### 2.1.27: Runtime 0.0.41

Use the official npm release with a separate 0.0.41 recipe. Retain V1-V10:
adapt V1/V5/V10 bundle aliases, including the injected stop-state check, and
retain both Chinese and English cloud-workspace blocking messages in V9.
The new project-check and UI-motion assets come from the verified release.
V11 removes the requested Neon Ink demo and its dedicated resource mappings;
the other six styles and all 43 motion effects remain.
Fengari and sprintf-js license texts are included. On 2026-11-11, LuaTween's
author liangdong confirmed authorship and MIT licensing; the complete MIT
notice is bundled. An unavailable source URL does not invalidate that confirmation.
Use an existing published, working local game for plugin acceptance. Attribute
game-resource and native-engine errors separately; do not expand a Maker MCP
upgrade into engine fixes or gameplay acceptance for unchanged input paths.
The 0.0.41 recipe also records exact patches for three bundled files: explicit
positions skip automatic anchoring only on the specified axis; furniture exports
reject animations exceeding 128 MiB of retained RGBA pixels before allocating
frames and release each animation after export; preview directories cannot overlap
the output directory or ZIP path; the furniture guide links to the bundled Skill.
These patches run in staging alongside bundle patches before the complete inventory
check, so failure leaves the installed vendor unchanged.

### 2.1.26: Runtime 0.0.40

Use the official npm release and a separate 0.0.40 recipe, retaining V1-V10.
V5 follows the new bundle aliases; V10 follows the updated 015 live-canvas read
and import-error message while preserving stop and uncertain-request safeguards.
New Git cloud-status/cloud-diff/cloud-commit guidance maps to the Maker project
page and authorized plugin build entry; uncertain outcomes must not be retried blindly.
Upstream adds preview validate --network; maker_validate still exposes only
single-player parameters, so upstream support is not plugin network-validation support.

### 2.1.25: Runtime 0.0.39 and request windows

Use the official npm release from local cache with a dedicated 0.0.39 recipe,
preserving V1–V8. Raise the former 60-second window to 120 seconds for all dynamic
tools, tool discovery and long-running account operations. Short requests remain
at 30 seconds; existing progress renewal and the 15-minute total ceiling remain
unchanged, with no new periodic heartbeat. Calls without progress may still time
out; this does not provide unlimited waiting.

Follow 0.0.39 automatic divergence merging and cloud-workspace commits, with
matching guidance and regressions. V9 preserves unknown cloud-commit outcomes and
recovery guidance and recognizes both cloud-blocking messages. It adds no Git
implementation or retry layer. Ordinary Git and Cindy savepoints continue sharing
the native repository; see the PR for the actual runtime verification scope.
V10 retains uncertain canvas requests and recognition pending IDs, pauses recovery
at its wait limit, and extends the 015 stop control to preparation and recovery
waits. Late replies after stopping must not start subsequent requests.
The tools/list root router uses 115 seconds inside the 120-second host window.
Post-cloud-commit merge/HEAD exceptions retain executed state. Git guidance uses
authorized host Git sync, maker_build for submission, and the Maker project page
for checking cloud state; it does not recommend unavailable standalone commands.

### 2.1.19: validation arguments and evidence boundaries

Validation checks Git ignore rules and the index without changing either. Unignored evidence,
tracked files or failed checks prevent dispatch. Invalid mode-specific arguments are rejected.
Structured Runtime absolute-path fields are removed from responses; relative evidence locations
and original archived reports remain available.

### 2.1.18: Large validation reports

Only local validation raises the CLI stdout limit to 8 MiB to receive Runtime's
4 MiB reports plus their wrapper; account commands and stderr retain 2 MiB limits.
Results above 64 KiB return an explicitly marked summary and original archive paths,
without duplicating multi-MiB reports into MCP text and structuredContent. Read the
evidence files for the full report. The 14-minute CLI and 15-minute Host limits remain;
a per-attempt budget does not guarantee that all automatic retries can finish.

### 2.1.17: Cindy local validation entry

`maker_validate` calls bundled `preview status` and `preview validate` through the
existing fixed Node entry. It does not modify vendor, standalone MCP or project Skills.
Cindy's Manual supplies the workflow; source files, installed copies and conflicting
links are reported separately. The official 0.0.37 source-directory check is identical
to the bundled one and must not be classified as a Cindy-only defect.

Preserve trusted-workspace overriding, readonly enforcement, no takeover of active or
unverified previews, fixed CLI arguments, CLI disposal only after final JSON, failed
reports and partial evidence on nonzero exit, and COMPLETED versus game PASS. Evidence
is confined to project `.maker/validation-evidence/` and directory links are rejected.
Do not automatically install Runtime, update the dev kit or replace project files.
Pass each valued validation option as a single `--flag=value` argument. Even with
all options enabled, argv must fit Cindy childSpawn's 16-entry limit; otherwise
the host discards the request and spawning times out.

Previous upgrade: plugin 2.1.22 / Runtime 0.0.37, with eight bundle patches
listed in the repository README and updated child-process compatibility.
The inventory and device results below describe the historical 0.0.33/0.0.34
baseline, not device acceptance of 0.0.37.

- Do not remove Cindy safeguards merely to obtain an unmodified upstream bundle.
- The historical 0.0.34 vendor has **five** patches, not only executed; 0.0.37 has eight.
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
| U1 Build UI | Validate maker_url, retain localDev=1, add hide_chat=1/sessionId, open sidebar (unless the user turned off the `makerPreviewEnabled` setting) and return link. | 41d53ce, df08857; main.js, settings.js | Page failure does not erase build success or resubmit. With the setting off, or if it cannot be read, the sidebar is not opened and the link is still returned (`preview.skipped`). This is remote preview, not UrhoX local window. |
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
