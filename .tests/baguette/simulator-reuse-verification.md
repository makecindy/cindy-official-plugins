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

## Review convergence checkpoint — 2026-11-11

Invariants and owners:
- Task page owns `side`, `pending` and its one refresh timer. A superseded initial read cannot postpone observer registration or overwrite a newer side's state.
- The remote page's keyboard listener owns normalization: special keys and editing chords keep modifiers, ordinary text stays on the IME/text path, and paste remains a browser event.
- `live-screen.cjs` owns the observed device rotation. Existing remote task-state queries carry that value; chrome generation and every existing chrome cache key include it. Picture width/height alone are not an orientation.

Event/state audit:

| Event | Initial read pending | Other side selected | Current device streaming |
| --- | --- | --- | --- |
| Refresh/visibility | Observers already registered; current pending read is not duplicated | Read the new side independently of the old read | Read current binding; Agent changes remain visible |
| Old read resolves/rejects | Accept only if still current | Ignore it | Ignore it |
| Special key / editing chord | No input until device is live | Route only to displayed device | One complete key with modifiers |
| IME / paste | No input until live | Route only to displayed device | Text once; paste shortcut is not also forwarded |
| Rotation 0/1/2/3 | No model orientation guessed without observed rotation | Use that device's rotation | Existing state poll updates rotation; same-size turns use a different chrome cache entry |

Tests must distinguish the previous commit: a pending initial read followed by local selection and an Agent binding change; modifier chords and browser paste; all four bezel rotations, including equal-width/height pairs, through chrome request/cache paths. No new polling loop or cache is introduced.

0.3.46 results:
- Registers task refresh/visibility observers before the first read. The pending-read regression now follows selection of a streaming local device with a later Agent binding change while the original remote request is still pending.
- Preserves Shift/Control/Option/Command on special/editing key chords. Ordinary composition remains text; Cmd/Ctrl+V reaches the existing browser paste handler exactly once.
- Threads the live stream's observed rotation through existing remote task-state reads, the controller status, definition requests, artwork generation and existing cache keys. No new probe or polling loop. Older providers without pose metadata retain a plain body instead of an inferred mask. Orientation follows the existing task/controller refresh cadence, not frame-by-frame synchronization.
- Direction tests cover all four artwork rotations (distinguished with asymmetric pixels), opposite equal-size poses through the HTTP/cache path, browser shell selection and stale-cache reuse, plus runtime state propagation without opening a local viewer. The existing live-stream orientation test verifies the same rotation source.
- Targeted suites: 41 passed, zero failed (2.13 seconds). Full simulator/repository suites: 1,736 passed, zero failed (54.88 seconds). Forge validated and packed 0.3.46. No installation or two-computer/native-trackpad acceptance in this round.

## 0.3.47 host transport regression — 2026-11-11

- The page and provider use complete key/chord events; host PR #9950 uses desktop key-down/up on its loopback transport, then its existing source-side `LiveScreenInputMapper` reconstructs complete provider events. The worker now translates at that boundary, preserving Shift/Control/Option/Command. Prior page/provider-only tests did not cover this intermediate wire contract.
- The real worker HTTP test covers 64 chords, key-up order and host-size batching, invalid modifiers before execution, and a later rejected batch reported as unknown after an earlier batch executed. No retry or new input queue is added.
- Full simulator and required repository suites: 1,738 passed, zero failed (57.23 seconds). Forge validated and packed 0.3.47. No installation, two-computer or native-trackpad acceptance performed.
