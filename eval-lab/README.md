<p align="right"><a href="README.zh-CN.md">简体中文</a> · English</p>

# Evaluation Lab

Compare your models on real project tasks, create private questions from selected task excerpts, and export a standalone results webpage.

## Release status

This is the first publication candidate, **1.0.0**. It requires the companion Cindy model-directory, downloads, task/team and delegated Auto-context changes. The manifest floor is `0.1.95`, the latest stable release when selected on 2026-10-01. **This version selection does not establish API support or completed device verification.** Real-device package verification on a stable/Beta release containing the required Host interfaces remains pending before merging. Initial provisioning has an empty staged audience and installs for nobody automatically. Missing APIs display an upgrade/error message rather than falling back to a paid discovery task.

## Use

1. Open the main page. Storage is assigned automatically; folder selection is optional.
2. Choose a bank and model/effort combinations, then start. Connected model visibility follows Cindy's selector.
3. One coordinator manages parallel Orca Workers. Advanced settings limit concurrency. Host Auto approval remains active; the plugin cannot grant Full access or impersonate user instructions.
4. Progress updates automatically. Stop remains available during preparation and execution. Unknown execution states are reconciled, never blindly resent or scored zero.
5. History defaults to the latest valid score per question for each model configuration. Average mode averages each question before summing. Version/content hashes remain separate. Export the leaderboard or selected results as one HTML file.

The coordinator and Workers use the selected accounts and can incur model charges. USD values are shown only when known; missing cost is not zero. Timing is an observed execution window, not pure computation time. A Worker report is not itself proof of completion: the plugin checks Host task/team evidence before grading. These receipts are not cryptographic certification.

Before model dispatch, preparation checks that `python3` runs in the plugin Node process environment. This is a runtime prerequisite check, not proof that every grader dependency is installed. Coordination plan/state files reside in the Host coordinator task directory. Unpublished plans from the former data-directory layout are not migrated; their files remain untouched. Reloading a current batch reuses its frozen plan, including interruption between saving a send receipt and saving scheduler progress.

Before resuming model dispatch or grading, the same Python probe runs again. Host receipt checks and settlement of saved results do not require this probe; an unavailable interpreter leaves ungraded submissions for the existing recovery loop, without replaying model work. Unpublished single-answer batches only observe, grade or stop already accepted work; they never create, prepare, grant permissions for or dispatch new work. Lost receipts are recovered read-only and ambiguous receipts are rejected. Stop the old batch before starting a new coordinator batch; existing answers and reports remain available. The data directory cannot change during authoring/calibration (including standalone draft, calibration and freeze calls), or while a failed author task retains a run to recover. An explicitly passing report or an explicit end after confirming no running or unknown execution ends that hold; failed reports remain visible and can be retried after correction. Folder selection is rechecked before saving. Standalone draft creation saves its identity in the existing author record before writing files; the directory remains bound after the tool returns and across reloads. A lost response retains that identity; confirmed missing input permits selecting materials again. Selected source text stays in the chosen directory, not in the configuration record.

## Questions and local execution

Default source: [makecindy/eval-bank](https://github.com/makecindy/eval-bank), pinned [Release](https://github.com/makecindy/eval-bank/releases/tag/eval-bank-20260925). Seven question families cover audio, Agent Island, automatic recovery, composer sending, mobile history order, remote files and projection caches. Each question is worth one point according to its frozen assessment weights. Incomplete coverage and environment-invalid results are shown separately.

Only selected questions/runtimes are downloaded. Archives have byte/hash/path checks and are enabled after complete verification. Existing versions remain available offline; updates never rewrite active answers. The default runtime currently requires **macOS Apple Silicon and Python 3**. Unsupported platforms are rejected before requesting bank downloads or installation; catalog browsing remains available. Large bank artifacts are kept in GitHub Releases, outside the plugin package.

Grading and calibration **execute local code supplied by the bank**, including candidate programs, with local user permissions. The first release is for trusted banks only: official banks are supplied and reviewed by maintainers; other banks are generated at the user’s request for their own use or reviewed by maintainers. User-initiated authoring includes automatic calibration, without a separate post-generation approval step. Generation and calibration are not security reviews. Do not use it to execute unknown or untrusted packages. This release adds no OS sandbox or Host isolation API. Hashes prove integrity, not safety. Keeping graders/reference files outside answer directories is workflow separation, not an OS sandbox.

Bank `distribution.json` and question `question.json` metadata are each limited to 16 MiB and read with a byte bound before JSON parsing. Bank-relative paths use forward slashes on all platforms; backslashes are rejected. This metadata limit does not reduce the approved archive or expanded-workspace limits. Online index downloads and their saved `{url,index}` cache wrappers are separately limited to 16 MiB; a near-limit source must leave room for the wrapper to be published.

## Personal banks and privacy

Paste or explicitly select task excerpts; the plugin does not scan all history. Remove credentials/private material before submitting it to the authoring model. Drafts contain the product contract, candidate, reference, independent grader and incomplete controls. Calibration must pass before the user freezes a new version; existing versions are immutable. Mechanical calibration does not replace product-contract review and mutation checks.

Answers, snapshots, diagnostics and drafts stay in local storage. Library contains settings and exported reports. Public reports omit raw diagnostics, chats, source files and local paths. Publishing a report means exporting a file; there is no automatic public hosting. Uninstalling does not delete your Library or external evaluation directory.

Calibration runs the candidate, reference and incomplete control as separate bounded requests. The draft snapshot determines a stable check ID, including after a lost response. Completed step receipts are reused; an interrupted step with an unknown outcome is not automatically executed again. Draft changes invalidate the calibration. The published completion report governs retry and ending authoring, without re-auditing archived step receipts. A completed failed report can be explicitly retried with a new attempt while retaining the original report. Repeating that request recovers the same retry. Ending authoring preserves its identity and prevents reusing the same question ID/revision.

Preparation persists its identity before publishing complete files. Recovery only fills in original unchanged content; modified or unknown files are preserved. The Python process executing the grader holds an OS file lock: a running grader is not duplicated, and the OS releases its lock when it exits. After interruption without a complete receipt, resuming the evaluation grades the saved answer locally without calling the model again. Complete receipts restore official results directly. Incomplete grading snapshots are retained separately without overwriting the paid answer directory or automatic cleanup; they can consume additional disk space. A Python writer publishes frozen manifests while holding an OS file lock, which the OS releases when that writer exits. Repeating a freeze verifies the same content and returns the existing result. Pre-release development `freeze.lock` and `grading.lock` files and random calibration IDs do not gate current operations; their files are preserved. Concurrent writes from old and new development builds into the same directory are not supported.

One preparation failure does not block other answers. Once the planned answers finish and the team is idle, a batch whose remaining answers were never prepared ends with those omissions explicitly unscored, allowing a new evaluation. Frozen plans never acquire omitted members; saved scores remain intact. Older partial batches can be stopped before starting the omitted questions again.

## Development

Authoring copies selected inputs into the host task's own directory. After the host confirms completion, the plugin validates question identity and regular-file contents, imports a fixed snapshot, and calibrates it. Original inputs and later task edits do not overwrite that snapshot. If import fails, the existing `calibrate_question` action can retry the handoff after the task is complete.

Damaged online banks are rebuilt and verified before replacement. The old bank is retained under local `online/backups`; verification failures or cancellation before publication leave it in place. Publication failures attempt to restore it. This is not a cross-process transaction or crash-recovery guarantee; backups are not automatically deleted. Answers and scores are untouched.

Installation has one implementation: `online_begin` / `online_step` / `online_cancel`. Tests and the local asset verifier drive that same path with borrowed archive files. Artifact downloading and download-cache reuse belong to the Host; the plugin fetches only the small index itself.

- `node --test test/core.test.cjs test/bridge.test.cjs test/online.test.cjs test/defaults.test.cjs test/standings.test.cjs test/execution-quality.test.cjs test/task-scope.test.cjs test/engine.test.cjs`
- `EVAL_BROWSER_RUNTIME=<composer candidate/runtime> node --test test/view.test.cjs`
- Optional real bank test: `EVAL_TEST_BANK=<restored bank> node --test test/engine.test.cjs`
- `python3 dev/build_online_bank.py <offline bank> <asset output> <fixed GitHub Release URL>` builds publication assets outside this directory.

Browser tests use a Host bridge fixture. They do not prove stable/Beta device compatibility, real-provider execution or complete restart/account-switch behavior. Repository CI produces a `.cindy` verification artifact; package/install/device evidence must be recorded before release. No bundled third-party Node dependencies are added; question/runtime licences travel with the bank.

Each question allows up to **8 GiB of unique downloaded archives** and **32 GiB of cumulative extracted layers**. Repeated mounts count again toward extraction; old banks and backups occupy additional disk space. Installation advances copying, extraction and verification across bounded requests, each still limited to15 minutes. An operation temporarily stores up to8 GiB of archive copies; cancellation stops extraction before cleaning its own staging. Unknown staging after a process restart is not adopted or deleted automatically.

Storage must support hard links. Folder selection checks this using a private temporary probe; incompatible storage is rejected without overwriting existing files.

Batch progress and exported reports follow Cindy's language: Simplified Chinese or English fallback. Question titles, model names and external diagnostic details remain unchanged; shared reports still exclude raw diagnostics. `prepare_run` returns the answer workspace, prompt, authorization scope and version metadata; it does not run the model.
