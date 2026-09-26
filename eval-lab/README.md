<p align="right"><a href="README.zh-CN.md">简体中文</a> · English</p>

# Evaluation Lab

Compare your models on real project tasks, create private questions from selected task excerpts, and export a standalone results webpage.

## Release status

This is the first publication candidate, **1.0.0**. It requires the companion Cindy model-directory, downloads, task/team and delegated Auto-context changes. These changes are not yet verified in a stable/Beta release. The existing manifest floor `0.1.93` is provisional, **not a claim that this release supports the APIs**; maintainers must set the verified minimum and complete real-device package verification before merging. Initial provisioning has an empty staged audience and installs for nobody automatically. Missing APIs display an upgrade/error message rather than falling back to a paid discovery task.

## Use

1. Open the main page. Storage is assigned automatically; folder selection is optional.
2. Choose a bank and model/effort combinations, then start. Connected model visibility follows Cindy's selector.
3. One coordinator manages parallel Orca Workers. Advanced settings limit concurrency. Host Auto approval remains active; the plugin cannot grant Full access or impersonate user instructions.
4. Progress updates automatically. Stop remains available during preparation and execution. Unknown execution states are reconciled, never blindly resent or scored zero.
5. History defaults to the latest valid score per question for each model configuration. Average mode averages each question before summing. Version/content hashes remain separate. Export the leaderboard or selected results as one HTML file.

The coordinator and Workers use the selected accounts and can incur model charges. USD values are shown only when known; missing cost is not zero. Timing is an observed execution window, not pure computation time. A Worker report is not itself proof of completion: the plugin checks Host task/team evidence before grading. These receipts are not cryptographic certification.

## Questions and local execution

Default source: [makecindy/eval-bank](https://github.com/makecindy/eval-bank), pinned [Release](https://github.com/makecindy/eval-bank/releases/tag/eval-bank-20260925). Seven question families cover audio, Agent Island, automatic recovery, composer sending, mobile history order, remote files and projection caches. Each question is worth one point according to its frozen assessment weights. Incomplete coverage and environment-invalid results are shown separately.

Only selected questions/runtimes are downloaded. Archives have byte/hash/path checks and are enabled after complete verification. Existing versions remain available offline; updates never rewrite active answers. The default runtime currently requires **macOS Apple Silicon and Python 3**. Large bank artifacts are kept in GitHub Releases, outside the plugin package.

Grading and calibration **execute local code supplied by the bank**, including candidate programs, with local user permissions. Use trusted banks only. Hashes prove integrity, not safety. Keeping graders/reference files outside answer directories is workflow separation, not an OS sandbox.

## Personal banks and privacy

Paste or explicitly select task excerpts; the plugin does not scan all history. Remove credentials/private material before submitting it to the authoring model. Drafts contain the product contract, candidate, reference, independent grader and incomplete controls. Calibration must pass before the user freezes a new version; existing versions are immutable. Mechanical calibration does not replace product-contract review and mutation checks.

Answers, snapshots, diagnostics and drafts stay in local storage. Library contains settings and exported reports. Public reports omit raw diagnostics, chats, source files and local paths. Publishing a report means exporting a file; there is no automatic public hosting. Uninstalling does not delete your Library or external evaluation directory.

## Development

- `node --test test/core.test.cjs test/bridge.test.cjs test/online.test.cjs test/defaults.test.cjs test/standings.test.cjs test/execution-quality.test.cjs test/task-scope.test.cjs test/engine.test.cjs`
- `EVAL_BROWSER_RUNTIME=<composer candidate/runtime> node --test test/view.test.cjs`
- Optional real bank test: `EVAL_TEST_BANK=<restored bank> node --test test/engine.test.cjs`
- `python3 dev/build_online_bank.py <offline bank> <asset output> <fixed GitHub Release URL>` builds publication assets outside this directory.

Browser tests use a Host bridge fixture. They do not prove stable/Beta device compatibility, real-provider execution or complete restart/account-switch behavior. Repository CI produces a `.cindy` verification artifact; package/install/device evidence must be recorded before release. No bundled third-party Node dependencies are added; question/runtime licences travel with the bank.
