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


## Main merge compatibility checkpoint — 2026-11-18

Merged main `ded6b33b` (#345). Only manifest version and release notes conflicted.
Version is now 0.3.52; both existing release notes are retained. No new behavior
is designed in this resolution: main owns its foldable/Apple TV/Vision Pro
gestures, and this PR retains shared keyboard validation and the existing
provider rotation lookup. The automatic merge keeps main’s live-screen changes.

Invariant: input validation remains shared through keys.cjs, orientation remains
owned by live-screen.cjs, and merging main must retain both existing feature sets.
The event/state ownership and failure cleanup matrices above are unchanged.
Symmetric audit: compared the merged provider and its tests to main; the remaining
provider difference is shared Android key mapping plus the rotation getter, with
rotation assertions in the existing stream/orientation tests. The aggregate
simulator suite includes the upstream foldable/TV/Vision Pro regressions and this
PR’s remote viewer/task/chrome regressions. No additional locks, retries or state.

This is local automated evidence only; no install/restart or real two-computer
acceptance was performed. Host support has since shipped in stable v0.1.139.

Validation: required repository suites plus the simulator aggregate: 908 passed,
zero failed (57.53 seconds). Manifest validation and git diff --check passed.


## Shared-body download checkpoint — 0.3.53, 2026-11-18

Failure family: independently ordered downloads of identical content wrote the
same partial prefix. Invariant: any interleaving of valid downloads for one
content key must produce the same verified body as a single complete download,
including when another download stops early. createChromeStore alone owns the
partial prefix and verified ready entry; individual device views only reference
the verified content key. No transfer ids, extra caches, locks or retries.

| Event | No prefix | Prefix present | Verified body |
| --- | --- | --- | --- |
| Chunk 0 | Start prefix | Identical duplicate is a no-op | Already complete |
| Next ordered chunk | Reject | Append once | Already complete |
| Duplicate received chunk | N/A | Same total/index/data: no-op | Already complete |
| One source stops/fails before delivering its next chunk | No change | Other ordered source continues | No change |
| Skipped or conflicting chunk | Existing validation/reset semantics | Existing validation/reset semantics | Already complete |
| Last chunk | Verify hash, shape and PNG data | Same single verification/cleanup path | Already complete |

Symmetric audit: duplicate first/middle/last chunks, fast/slow and abandoned
producers all use the same put predicate. Existing malformed/order/hash/PNG tests
remain; the content and chunk-count limits are unchanged. No automatic replay or
network contract changes. All valid interleavings for two three-chunk downloads,
including every possible early stop of the second source, are enumerated (35
schedules). A real loopback viewer regression opens two device pages and feeds
independent identical sources in A0/B0/A1/B1 order, then reads both definitions
through the public HTTP routes and checks cache reuse. Both new regressions fail
on 088e12c3 with CHROME_OUT_OF_ORDER and pass after the fix.

This is source/store and loopback viewer evidence, not real two-computer runtime
acceptance. No client installation or restart was performed.

Before synchronizing the next upstream fix: 910 required repository/simulator
tests passed, zero failures (57.16 seconds). The focused body suite passed all
five cases (0.12 seconds); both new cases failed on the previous implementation.

Final combined result also merges main c7f3e375 (#346), retaining its stationary
TV/Vision Pro touch fix without changing its implementation. Manifest conflicts
retain version 0.3.53 and both release notes. The final required repository suites
and simulator aggregate pass 913 tests, zero failures (65.63 seconds). Manifest
validation and git diff --check pass. Package/runtime verification remains CI
and genuine two-computer acceptance; no installed version was claimed tested.

## Creation result notice checkpoint — 0.3.54, 2026-11-18

User approved the maintainer's exact bilingual notice and manual-create behavior
in https://github.com/makecindy/cindy-official-plugins/pull/324#issuecomment-6961935602.
Invariant: a failed create may offer retry advice only when its result explicitly
says `execution: 'not_executed'`. Unknown, missing, timed-out or rejected replies
must ask the user to inspect the correct computer's device list first. The shared
pages.js create sheet owns the notice and button state for local and remote
creation; its existing call adapter identifies the computer. No additional state,
request bookkeeping, locks, retries or automatic replay are introduced.

| Event | Catalog loading | Create in flight | Failed create settled |
| --- | --- | --- | --- |
| Success | Populate existing model/runtime controls | Close sheet with returned device | No automatic request |
| Explicit not_executed | Existing catalog error | Existing backend/platform error and retry advice, re-enable Create | User may explicitly submit again |
| Unknown, missing reply or rejected call | Existing catalog error, no creation claim | Bilingual local/remote list notice, re-enable Create | No automatic request |
| Request timeout | Existing catalog error | Same conservative list notice, re-enable Create | Late response cannot replace settled notice |
| User submits after checking | Not enabled without model/runtime | Existing disabled Create button | Exactly one new create |

Symmetric audit covers local BroadcastChannel RPC and remote call adapter,
iOS/Android, Chinese/English, explicit unknown with misleading backend text,
missing execution evidence, undefined remote result, thrown error, actual local
post-dispatch timeout and late success, known not_executed, catalog errors and
manual subsequent success. Existing shared-sheet tests still preserve detailed
backend errors for known non-execution. The new regression fails on 186e671e
because it displays "Not created. Try again." for explicit unknown; after the
change all 14 focused page-RPC tests pass (40 creation outcome combinations plus
catalog cases in the new regression). These are real source scripts executed in
a VM with a DOM fixture and transport fakes, not two-computer or installed-client
acceptance. Existing controller-side forms do not claim failed creation or offer
retry on unknown; this change keeps the shared sheet as the only changed UI path.

No new Host APIs, permissions, dependencies, installation or restart. The current
task exposes no Forge pack tool; repository validation and CI packaging remain
the package evidence. Genuine two-computer runtime acceptance remains outstanding.

Validation on Node.js v22.21.1: required repository suites plus the simulator
aggregate passed 914 tests, zero failures (64.35 seconds). Manifest validation
and git diff --check passed. No installed-client or visual-theme acceptance is
claimed for this copy change; the existing layout and theme styles are unchanged.

## Main #347 conflict integration — 0.3.55, 2026-11-18

Merged upstream 05cdd227 (#347). The only conflict was cindy-simulator's version:
main 0.3.45 versus this branch 0.3.54. The combined version is 0.3.55 and retains
upstream mainView.preferredIcon=tablet-smartphone. The other upstream icon and
manifest changes match origin/main exactly. No simulator page, worker, transport,
creation-copy or test implementation changed. Existing source-level evidence for
0.3.54 therefore remains applicable; it is not installed-client acceptance.

Required repository suites and simulator aggregate passed 914 tests, zero failed
(60.34 seconds), on Node.js v22.21.1. Manifest validation and git diff --check
passed. No new machinery, permissions, dependencies, install or restart. Actual
two-computer runtime acceptance is still incomplete; the maintainer must assess
that evidence on the then-current head before merge.

## Round 12 input-lifetime convergence — 0.3.56, 2026-11-18

Failure family: page requests were split again by the worker, so hidden worker
batches could outlive the page's 15s input timeout and universal cleanup.
Chosen convergence: remove the worker's second batching loop, its batch/executed
state and partial-batch bookkeeping. The page's existing serial queue is the sole
batch owner. Shared keys.hostEvents computes the exact chord expansion for both
page sizing and worker forwarding; the page respects host 64-event/16-KiB limits
without cutting chords or text, and the worker rejects oversized packets before
sending anything. Each page input request forwards at most one host request.

| Event | Page waiting | One host request in flight | Settled |
| --- | --- | --- | --- |
| More input | Existing serial queue, with exact expanded host bounds | Existing queue waits | Next page packet only after confirmation |
| Complete success | No hidden worker work | Resolve once | Existing queue advances |
| Refusal / interruption / malformed result | Existing failure path | Settle once with existing execution semantics | Existing discard and best-effort release, no replay |
| Slow response, including continuous body activity | No independent worker queue | Absolute 10s AbortSignal ends request before page's 15s timeout | Unknown; no later worker batch exists |
| Release / page close | Existing release replaces unsent page input | Existing page queue preserves its current ordering | No worker tail can execute after cleanup |
| Oversized raw control request | No state mutation | Reject before forwarding, not_executed | No automatic splitting or retry |

Symmetric audit: input, press, retry and release share the existing send/settle
function and its absolute timeout; response aborted/error/close/invalid JSON
handling stays intact. The transport cannot revoke input already accepted by the
remote Host/device: such unconfirmed in-flight execution remains unknown and
requires checking the device. This fix removes unsent worker tails, not a claim of
remote transactional cancellation. No locks, additional queue, request ledger,
retry or persistence were added; the former inactivity timer was replaced by an
absolute limit with the same 10s value.

Regressions run real screen.js in a VM/DOM fixture for iOS/Android and zh-CN/en:
long escaped/multibyte paste and a burst of four-modifier chords must fit a single
host packet per page request, preserve text/chords and keep existing failure and
release behavior. Real loopback HTTP tests verify one forwarded packet, rejection
before dispatch, interrupted results and subsequent cleanup/new input. Six cases
fail on 8647025d and pass after removing worker batching. A separate real HTTP
response sends body activity every100ms: old code remains unresolved until the
12s test-side deadline; new code returns unknown at10s, then accepts release/new
input in order. Focused suite:12 passed (10.47s). This is VM/loopback evidence,
not installed-client or genuine two-computer acceptance; that remains incomplete.

Required repository suites plus simulator aggregate:915 tests passed, zero
failures (70.91s), Node.js v22.21.1. Manifest validation, git diff --check and
preflight passed. Main05cdd227 remains included. No install or restart performed.

## Round 13 computer-bound memory controls - 0.3.57, 2026-11-18

The user chose full remote memory-mode restart support, rather than removing
its action. Remaining families are execution-side identity and real two-computer
acceptance; previous input and creation decisions remain unchanged.

Invariant: every memory choice and restart retains the computer and device it
was created for; no remote operation may fall back to this computer's worker.
The shared page owns [computer, device] choices. The task page owns routing,
including requests from the live controller. The provider's existing remoteOps
owns progress; the existing worker owns the atomic shutdown/boot and device
validation. No new queue, lock, retry, cache or persisted state is introduced.

| Event / state | Expected result |
| --- | --- |
| Choose a mode, running or off, same ID on two computers | Only the selected computer's page-local choice changes |
| Create on either computer | Keep chosen mode under that computer for its next explicit boot |
| Restart from a row, current device, or live controller | Same shared dialog; one request to the owning computer |
| Change selected side after opening a dialog | Its captured computer remains the target |
| Provider restart still running / duplicate explicit request | Existing progress continues; duplicate returns BUSY without execution |
| Restart resolves / fails / reply becomes unknown | Poll state; no automatic restart replay; failures stay visible even over a recovered screen |
| Old remote plugin rejects restart | No local fallback and no loss of its older management capabilities |
| Physical phone or unsupported platform | Existing worker validates before shutdown; memory UI stays limited to iOS simulators |

Symmetric audit covers both computer groups, the current device, off-device
startup, shared creation, live controller forwarding, and local settings/viewer
callers retaining their default local scope. The live remote controller receives
only the validated mode and verification bit, not private provider paths.
The same dialog and theme styles are reused in Chinese and English.

Tests use actual page/model scripts in DOM fixtures, two plugin logic pages
connected by a simulated Host channel, and the real remote viewer HTTP server.
These are not genuine two-computer Cindy acceptance. No installed plugin or
user device was restarted. The execution Host reports an unversioned 0.0.0
build; it cannot establish stable runtime compatibility. This change uses only
existing plugin RPC/deviceSync and worker interfaces, with no new Host grant.
The stable host prerequisite remains v0.1.139 containing #9950.

Validation: the two new computer-isolation/remote-restart regressions failed on
fb33b459 before the fix. Final focused page, task, controller and HTTP suites:
111 passed, 0 failed (10.50 seconds). Required repository suites plus the single
simulator aggregate: 919 passed, 0 failed (76.97 seconds), Node v22.21.1.
Manifest validation, diff whitespace check and PR preflight passed. Forge pack
is unavailable on this task's tool surface; packaging is checked by PR CI,
not claimed as a local Forge artifact. No real two-computer test was performed.

## Round 14 terminal outcomes and computer identity - 0.3.58, 2026-11-18

Two failure families: a terminal operation outcome must reach the UI whether it
arrives in the action response or a poll; every viewer route must retain its
computer and device. The user already authorized complete remote memory restart
support. This round restores the existing local warning behavior remotely.

Owners: remoteOps retains its existing single operation, now including a bounded
memory outcome until the existing one-time state delivery. acceptOperation is the
single terminal-outcome consumer for action and polling responses. The existing
views map uses [peer, udid], carried through main, worker, controller URL, device
frame, stream, input and body queries. No second registry or new lock, queue,
retry, persistence or timer is added. Deleting these identity/outcome fields
would break the original correct-device operation and full restart parity goals.
The growing diff also includes tests, paired documentation and integrated main;
previous worker batching machinery was already removed in 0.3.56.

| Event | Running | Failed | Completed with memory outcome |
| --- | --- | --- | --- |
| Action response | Show existing progress | Show failure, return false | Shared local memory notice |
| State poll | Show existing progress | Same failure consumer | Same memory notice consumer |
| Next read after terminal delivery | No replay | No repeat delivery | No repeat delivery |
| Two peers share a UDID | Separate upstream, input, stream and body binding | Renewal affects only same peer | No cross-peer mutation |

Symmetric audit: boot, shutdown and restart; immediate and deferred worker
completion; known mismatch, unverified and warning-only successful boot; both
controller and device frame routing; address renewal and shell fetches. Only
mode/requested/verified and at most 500 warning characters cross the outcome
boundary. Remote artwork remains content-addressed in the existing store, while
its per-view attachment and wanted picture are scoped by peer.

Three regressions fail against 32588485: lost completed restart outcome, task
handling of immediate terminal outcomes, and two real HTTP upstreams with the
same simulator ID. The latter checks separate status, input, renewal, stream and
body queries. Actual controller/screen-script fixtures additionally verify peer
propagation. These remain VM/loopback tests, not real two-computer Cindy testing.
No device was installed or restarted. Genuine two-computer acceptance remains
required. Main bfadffb3 was merged without simulator conflicts.

Final validation: focused real-page/logic/HTTP suites 80 passed, 0 failed
(10.46 seconds). Required repository suites and single simulator aggregate:
922 passed, 0 failed (69.11 seconds), Node v22.21.1. Manifest validation and
whitespace checks passed. No local Forge package or runtime install is claimed;
CI packaging will run on the pushed head.

## Round 16 execution-outcome checkpoint (2026-11-25, 0.3.60)

Invariant: boot, shutdown and restart preserve the worker's execution evidence;
only explicit `not_executed` may eventually receive retry advice. Missing,
unclassified or rejected results mean `unknown`, never non-execution. This is
one outcome-loss family, not three independent action-specific fixes.

Owner: the existing provider remoteOps entry owns each operation's terminal
outcome. The existing state response delivers it once; reading it does not run
another mutation. task.js acceptOperation remains the single consumer of
immediate and polled terminal results. No new state machine, queue, retry,
lock, cache or persistence is needed. Existing per-computer identity remains
necessary for the original correct-device requirement.

| Event | Running | Terminal, not yet read | After terminal read |
| --- | --- | --- | --- |
| Worker resolves failure with valid execution | Store code + exact execution | Keep | No replay |
| Missing/invalid evidence or worker rejection | Store code + unknown | Keep | No replay |
| Initial response or later task-state read | Report running | Deliver same code + execution, remove once | No repeat delivery |
| Approved UI choice | Existing progress | Only not_executed keeps retry hint; otherwise inspect remote state | Buttons stay usable; no auto replay |

Symmetric audit covers task_boot, shutdown and restart_device, both immediate
and deferred completion, all three execution values, missing/invalid values,
and rejection. A single matrix regression covers all 36 combinations, one-time
delivery, no replay on reads, and no viewing-computer fallback. It fails against
69de9005's main.js and passes with the prepared transport fix. Existing remote
page tests pass. This is VM/channel regression evidence, not dual-computer
runtime acceptance. The user approved the boot/shutdown copy on 2026-11-25.
The page now preserves retry advice only for explicit not_executed; unknown,
executed-but-failed, omitted and invalid evidence use the approved conservative
notice in both languages. Restart keeps its existing conservative notice.
A shared formatter covers terminal responses and action exceptions; read-only
connection failures remain separate. The bilingual actual-page fixtures cover
80 outcome/action/delivery combinations plus 12 timeout/unavailable/offline cases,
usable buttons, one mutation per action, no local fallback and no replay on reads.
Both new language regressions fail against 69de9005's task.js and pass after the fix.

Validation: focused remote-task suite 16 passed, 0 failed (5.23 seconds).
Both old-page counterexamples fail on unknown immediate boot results as expected;
the prior old-main counterexample also fails. Forge validated and packaged
cindy-simulator-0.3.60.cindy successfully; this did not install or restart anything.
Required repository suites and simulator aggregate: 934 passed, 0 failed
(77.00 seconds). JavaScript syntax, whitespace and preflight checks passed.
The updated package was not installed; real dual-computer memory-mode restart
acceptance remains outstanding under the existing user authorization.

## Round 17 post-operation read checkpoint (2026-11-25)

Invariant: execution evidence describes the requested operation, never the
follow-up task-state read. The worker owns its operation outcome; the task-state
worker owns only observation. remoteServe must project a failed observation as
unknown for an operation request. Standalone task_state keeps its read error.
The existing remoteOps entry remains available for a later successful read;
failed observation does not consume terminal outcomes or repeat the operation.

| Request / event | Follow-up read fails | Later read recovers |
| --- | --- | --- |
| Boot / shutdown / restart dispatched, running or completed | unknown; inspect remote device | Deliver existing terminal result; never dispatch again |
| Worker operation failed with any execution evidence | unknown observation response, preserve operation entry | Deliver original operation execution evidence once |
| Task binding succeeded | unknown observation response | Read binding without binding again |
| Standalone task_state | Its own read failure remains not_executed | Read only |
| Invalid/refused operation before dispatch | Existing operation rejection | No operation to replay |

This recurrence comes from composing mutation and observation failures through
one implicit result. Shrink that ambiguity at the existing remoteServe boundary:
read failure has one explicit projection based on request kind, with no new
state, queue, lock, cache, retry or persistence. Operation-owned terminal delivery
and the approved UI formatter remain the sole owners of their existing roles.
Audit covers all three long operations plus binding, completion before and after
read failure, explicit failure, rejection, and pure reads. Tests must fail on
1b72b4cc and verify actual provider-to-viewer results through the bilingual page.

The transport regression covers 19 dispatched-operation/read-failure cases:
three long operations × six completion outcomes, plus successful binding.
The bilingual page fixtures additionally consume actual provider/channel replies
for successful boot and shutdown followed by failed reads, showing conservative
copy and enabled actions. All three regressions fail against 1b72b4cc's main.js.
Forge validated and packaged 0.3.61 successfully, without installation or restart.
Required repository suites and simulator aggregate: 935 passed, 0 failed
(80.08 seconds), including the updated bilingual integrated regressions.
Focused transport/page suite: 17 passed before the final integrated page addition;
the full aggregate above validates that addition. Syntax and whitespace passed.
No new dual-computer runtime result is claimed; existing authorization persists.

## Round 18 binding outcome checkpoint (2026-11-25)

Invariant: only explicit not_executed for the requested remote mutation may
suggest retrying it. A saved binding followed by failed observation is unknown,
not a failed binding. The user approved the bilingual binding-specific notice.
The page's existing operationErrorText owns all mutation advice; remoteServe
owns the operation/read evidence boundary. No additional state or mechanism.

| Binding result / observation | Page advice | Recovery |
| --- | --- | --- |
| Explicit not_executed | Existing failure/retry hint | User may choose again |
| Unknown, executed failure, absent or invalid evidence | Inspect this task's binding on the remote computer | Read only; no replay |
| Saved binding, state read returns failure or rejects | Same conservative binding notice | Show saved binding once reading recovers |
| Timeout, unavailable, offline | Same conservative binding notice | Buttons stay usable |
| Successful binding | Existing success path | Existing refresh |

The shared bilingual page matrix now includes binding response failures and
exceptions across five execution values, plus timeout/unavailable/offline.
Four integrated provider/channel/page regressions cover a saved binding followed
by returned/rejected reads in both languages: exact approved copy, usable actions,
recovered SIM-2 binding, exactly one provider bind and no viewing-side bind.
All four fail against 9a62bbce's task.js, so they discriminate the previous fix.
Deleting the existing outcome projection would violate the original correct-device
operation guarantee; this fix only extends its single page formatter. No queues,
locks, caches, persistence or retries were introduced. Real dual-computer memory
mode restart remains separate and authorized; these are VM/page regressions.

Validation: focused remote-task suite 21 passed, 0 failed (8.75 seconds).
Required repository suites plus simulator aggregate: 939 passed, 0 failed
(80.00 seconds). Four integrated counterexamples fail on the prior task.js.
Syntax, whitespace and preflight passed. Forge validated and packaged 0.3.62;
no installation, Cindy restart, simulator restart or merge was performed.
