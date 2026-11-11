# Simulator UI reuse — 2026-11-11

Source: `dash/simulator-remote-view`, based on c218ec0d; package 0.3.44.

- Task device selection uses one group-rendering path for local and remote tasks.
- Controller menus use one row renderer for both computers; operation routing remains separate.
- Physical-phone and remote screens use the same DeviceShell class in `node/physical/shell.js`. Existing physical asset URL/path retained; remote viewer serves the same source at `/device-shell.js`.
- Shell tests exercise both definition URL strategies, stale orientation responses, preserved canvas identity, cached orientations, missing/mismatched definitions and retry delay. Remote HTTP integration verifies the shared asset is served.
- Full regression command: `node --test .tests/baguette/*.test.cjs .tests/cindy-simulator.test.mjs .tests/plugin-contract.test.mjs .tests/localization.test.mjs .tests/provisioning.test.mjs .tests/publish-workflows.test.mjs`: 1723 passed, one package-contract failure caused by moving a file while the contract enumerates HEAD. Retained the existing source path, then reran the contract plus shell/remote-viewer tests: 55 passed, zero failed. No outstanding test failures.
- Forge validated and packed 0.3.44 successfully. No installation or publication performed.
- This round used local automated tests, not a running Cindy UI. Current host version discovery returned no available operation. No new host API dependency introduced. Two-computer runtime verification remains outstanding; prior runtime evidence is not claimed as verification of this package.

## 0.3.45 review regressions — 2026-11-11

- Reproduced remote key rejection through the real browser page and provider `validEvents`: two key events carrying `down` were invalid. The page now emits one complete `{kind:'key',code}` event. Coverage includes all nine supported special keys and text in the same input queue.
- Reproduced the missing local picker when the remote task state rejects, returns an unsupported-host error, or remains pending. The other-side read now starts independently, and the shared picker also renders without a current-side state. Tests cover selecting and creating on the available side, ignoring late old-side responses, and the symmetric local-read failure.
- The reported corrupted reconnect title is not present in e87f2774 or current source. A real-page VM test reads reconnect stream metadata and asserts the displayed Chinese title is `正在重新连接`.
- Targeted remote-task and remote-viewer tests: 15 passed, zero failed (under one second). These are browser-page/protocol regressions with fake streams and RPCs, not two-computer or native-trackpad acceptance.
- Forge validated and packed 0.3.45 without installation. Host merge/release and two-computer runtime evidence remain outstanding.
- Full simulator + required repository suites: 1,734 passed, zero failed (54.91 seconds), using the same full regression command listed above.
