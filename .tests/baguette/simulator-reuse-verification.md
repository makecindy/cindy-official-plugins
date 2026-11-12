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

## 0.3.48 keyboard/text checkpoint — 2026-11-11

The invariant is that browser text is delivered exactly once, accepted editing chords cannot invalidate neighbouring input, and every complete JSON request fits the next transport's byte limit. `screen.js` alone owns the existing waiting/sending queue; `keys.cjs` owns the shared Apple HID and Android chord validation and is now served as the same browser-loadable source. No second key table, queue, retry or polling mechanism is introduced. The remote transport uses each provider’s supported host key subset: Android retains F1–F12 and Delete; Apple rejects these before enqueueing. Numpad codes are outside the host wire contract.

| Browser event | Browser still composing/layout text | Live device, queue idle or sending | Transport boundary |
| --- | --- | --- | --- |
| IME, Dead, Option printable, AltGr | Keep browser default; input/compositionend owns resulting text | Append resulting text once | Split at code-point boundaries, at most 4,000 UTF-16 units and 12,000 escaped UTF-8 bytes per text event |
| Cmd/Ctrl+V | Keep browser paste event | Paste listener appends text once | Same text queue and byte splitter |
| Supported editing chord | Not intercepted while composing | Validate with shared provider mapping before preventDefault/enqueue | Worker converts complete chords to bounded host down/up batches |
| Unsupported shortcut | Keep browser default | No key event enters queue, so neighbours survive | Nothing to reject as part of a mixed batch |
| Large mixed/multibyte paste | Text path | Existing serial queue, in order | Page bounds the entire UTF-8 JSON body to 60,000 bytes; worker retains host 16 KiB/64-event bounds |
| Failed request / close | No replay | Existing discard/release path | Partial delivery remains unknown, never automatically retried |

Discriminating tests drive the real page with unsupported Ctrl+F5, numpad and Delete around valid chords, Dead/Option/AltGr and IME/paste events, then over 50,000 UTF-16 units of Chinese, emoji, quotes, backslashes and escaped control characters (excluding the provider-forbidden NUL). They compare text exactly, enforce complete-body UTF-8 limits, validate emitted keys against the actual provider mapping and load the shared key source in a browser VM. HTTP coverage checks that the exact shared source is served by the worker. These are automated browser/protocol tests, not physical-keyboard/two-computer acceptance.

0.3.48 results: targeted real-page/worker suites 8 passed; full simulator and required repository suites 1,740 passed, zero failed (54.86 seconds). Forge validated and packed the final 0.3.48 source. No installation or two-computer/native-keyboard acceptance performed. The earlier automated fixture incorrectly included NUL, which the provider intentionally forbids; the final escaped-control coverage uses U+0001 and still validates against the actual provider contract.

## Round 5 convergence checkpoint — 2026-11-11

Remaining prerequisites are the two failure families below, current-head CI/review, paired host release, two-computer evidence and explicit merge authorization. The cancelled non-required guidance job is covered by its workflow concurrency policy; all four required checks on 9d4720dc passed.

- Device selection is independent of picture availability: `task.js` owns side/state/choosing; every loaded device state offers the existing selector when no usable picture is available. The same selector renderer routes both computers; transport failures do not change management authority.
- Ending or failing input must issue a device-wide release after any in-flight input settles. The serial page queue owns delivery order. Remove the speculative local `held` table: the provider's existing `release` event is the sole remote cleanup meaning. Local gesture cancellation is shared and cannot enqueue more gestures while resetting. Cleanup failure is best effort, never recursively retried or replayed.

| Event | Device state unreadable | Device loaded, picture absent/failed | Input idle | Input in flight |
| --- | --- | --- | --- | --- |
| Refresh/failure | Shared selector shows available side | Device error plus selector | No input effect | No input effect |
| Select/create other side | Existing routing, late reads ignored | Existing routing, late reads ignored | Clear old view by existing lifecycle | Existing lifecycle release |
| Blur/hidden/explicit release | No picture input | No picture input | Clear queued stale gestures, send universal release | Replace waiting gestures with release; send after current result |
| Close/pagehide | Existing lifecycle | Existing lifecycle | Best-effort universal release | Same queued terminal release, allowed after closed |
| Input rejection/timeout | Not applicable | Not applicable | No replay | Drop waiting gestures, cancel local state, one universal cleanup request |
| Cleanup failure | Not applicable | Not applicable | No retry | No recursive cleanup, no replay |

Symmetric audit covers local/remote device states, Booted/Shutdown/paused/operation, HTTP rejection/network loss, ended touch still in flight, blur/hidden/close and cleanup itself rejecting. Tests must distinguish the last head by rejecting touch-up after an acknowledged down while video stays live, and by rejecting picture open while task management succeeds. No new acknowledgement ledger, timer, lock, queue or retry mechanism is added.

0.3.49 results: 37 targeted page/worker/task tests passed (1.01 seconds); full simulator and required repository suites 1,742 passed, zero failed (55.88 seconds). Regression scenarios keep video live while touch-up delivery rejects, make cleanup itself reject without recursion, then close during a pending touch-down and require release after its settlement. The task-page scenario loads a manageable Booted remote device with HOST_UPDATE_REQUIRED from picture open, switches to a local device and creates another locally. Forge validated and packed 0.3.49; no installation or two-computer/native-gesture acceptance in this round.

## 0.3.50 input-result notice — 2026-11-12

User approved the conservative Chinese/English notice. Invariant: a failed input
request must not imply that earlier batches or a request with a lost response did
nothing, or invite replay. The page owns the existing queue and notice; the worker
owns execution metadata. All failure paths reuse the same notice and existing
one-shot release. No new delivery state, retry or confirmation bookkeeping.

| Input outcome | Notice | Pending input / cleanup |
| --- | --- | --- |
| Explicit not_executed | Check the device before entering again | Drop queue, one best-effort release |
| Unknown response | Same conservative notice | Same cleanup, no replay |
| Earlier batch succeeded, later batch failed | Same conservative notice | Same cleanup, no replay |
| Cleanup itself fails | No stronger delivery claim | No recursive cleanup retry |

The real page VM regression now exercises iOS/Android × zh-CN/en. It drives long
paste events and checks request counts, the visible notice, and no automatic
replay for the first three outcomes; the existing lost-up/failed-cleanup and
in-flight-down close cases still run. Before the copy change, all four variants
failed on the old misleading notice; afterward all 10 remote-viewer tests pass.
Forge validated and packed 0.3.50. No installation or two-computer testing in this
round; this change adds no host API dependency or transport behavior.
- Required repository suites plus `.tests/cindy-simulator.test.mjs`: 904 passed,
  zero failed (55.88 seconds). This invocation runs the simulator aggregate once;
  older totals above also included its constituent files separately.

## Upstream response lifecycle checkpoint — 2026-11-12

Invariant: every terminal HTTP request/response outcome settles `send`; only a
complete parsed acknowledgement establishes execution/refusal. Interrupted or
unreadable replies remain unknown and are never replayed. `send` alone owns its
Promise; native Promise settlement handles duplicate terminal events. The page
keeps its existing queue/drop/release ownership. No new state table or retries.

| Event | Awaiting headers | Reading body | Already settled |
| --- | --- | --- | --- |
| request error/timeout | Reject unknown | Reject unknown | No second effect |
| response aborted/error/incomplete close | N/A | Reject unknown | No second effect |
| complete valid ok:true / ok:false | N/A | Resolve / reject not_executed | No second effect |
| complete invalid or empty JSON | N/A | Reject unknown | No second effect |

All existing send callers (input batches, press, retry and best-effort release)
share this terminal handling. Input preserves unknown after earlier successful
batches. Release retains its existing swallowed failure, and the page retains its
approved conservative notice. Real loopback HTTP regression interrupts a partial
body, resets before headers, returns malformed/empty bodies and interrupts a later
batch; it verifies one request per operation and subsequent input availability.
- Before the fix, the real truncated-body case hit its one-second test deadline;
  after the fix, all 11 remote-viewer cases pass (0.44 seconds).
- Required repository suites plus the simulator aggregate: 905 passed, zero
  failed (56.33 seconds). Forge validated and packed version 0.3.51 without
  installation. This is loopback/VM evidence, not two-computer acceptance;
  host release and native two-computer/trackpad validation remain outstanding.
