# Simulator gesture parity and native trackpad acceptance

## Single-touch compatibility follow-up — 0.2.60, 2026-10-28

Chromium's contact path omitted the legacy iPhone single-touch edge hint.
A newly-down single finger now uses the existing orientation-aware EdgeBands
classifier (0.85/0.15), with the same real coordinates. That stream's options
follow down/move/up and the existing release path clears them on cancel, blur,
pagehide, detach, invalid mapping or contact-count changes. Atomic pairs receive
no edge hint; lifting one finger from a pair does not reclassify its already-down
survivor. Interior starts do not inherit an earlier hint. No new transport,
queue, retry, permission, native binary or host mapping was introduced.

Two production-source regressions failed before repair and pass afterward.
The five native-contacts cases complete in 59.7 ms, including top/bottom and
orientation, all release paths, single/pair transitions and atomic pair start.
Repository contracts and simulator files pass 1423 test invocations with zero
failures/skips (including aggregate/single-file duplication as below). The full
vendor Web patch reconstructs packaged sources with zero fuzz/offset, inventory
verification passes, and Forge validates/packs 0.2.60 without installing it.

Real Electron 42.11.12 Chromium/CDP input through the production TouchGestureSource,
Screen, Transport and GestureEnvelope sends actual local WebSocket messages.
All 25 orientation × release scenarios preserve the exact edge field on
touch1-down/move/up. Atomic DOM pair → surviving single → cancel emits
touch2-down/up then touch1-down/up, with no edge hint. Receipt:
`pr235-single-edge-receipt.json` in the task artifact directory. This validates
browser-to-wire compatibility, not SimulatorKit recognition, physical AppKit
capture or user hand-feel. The existing physical double-contact acceptance and
0.2.59 wheel/HTTP evidence remain applicable to their unchanged paths; none is
claimed as a physical retest of this restored single-touch metadata.

## Edge-indicator follow-up — 0.2.59, 2026-10-28

iPhone wheel pinch previously drew raw offscreen contacts while the native
backend clipped the dispatched positions. Wheel moves now calculate one bounded
pair used by both dispatch and overlay projection. Raw scale, native contacts,
host mapping, backend binaries and input queues are unchanged.

The convergence invariant is: every wheel-move dot centre equals the corresponding
dispatched screen position. The wheel source remains the sole owner of raw
pan/pinch state; bounded move points are local derived values. Pan and pinch use
the same projection, including off-centre anchors and reversal. With no overlay,
dispatch is identical. Idle end and kind changes still use the existing close
path, clear the timer/overlay, and send release; native, Option-drag and Safari
gesture-event paths retain their existing semantics. No new state, queue or retry was added.

The new production-source edge regression fails on 0.2.58 and passes on 0.2.59.
The three wheel-overlay cases complete in 52.6 ms. Repository contracts plus all
simulator files pass 1419 test invocations, zero failures or skips (the aggregate
command also loads simulator files separately, as in the previous 1417 run).
The full vendor Web patch applies to the pinned v0.2.10 source with zero fuzz or
offset and reconstructs each patched packaged file; inventory verification passes.

A real Electron 42.11.12 renderer exercises 24 combinations: four edges, three
display scales, pan/pinch, and an expand/reverse delta pair. Actual iPhone and
Android dot DOM styles stay bounded and match their dispatched contacts; Android
HTTP contacts agree with iPhone and the iPhone idle overlay clears. CSS length
serialization is compared within 0.001 display pixels. The fixture uses fixed
integer layout origins because synthetic WheelEvent client coordinates are
integer-valued; its first flow-layout run exposed a fractional-origin mismatch,
not a production mapping change. Receipt: `pr235-edge-overlay-receipt.json` in
the task artifact directory. It is synthetic renderer/HTTP evidence, not AppKit
capture, a running device or a new physical hand-feel acceptance. Forge validates
and packs 0.2.59 without installing it. Earlier physical evidence applies only to
the unchanged paths described below.

The previous Electron delayed-HTTP fixture was also rerun on 0.2.59 and passed:
four native boundary samples, seven kind-switch samples, immediate pan reversal
and rejection of the superseded iPhone idle timer.

## Review follow-up — 0.2.58, 2026-10-28

The first review identified Android boundary samples being coalesced while a
previous touch request was pending: a second native begin could disappear, and a
wheel pan/pinch switch discarded the new event. Starts and releases now take
immutable snapshots through the existing serialized input queue; released
records leave the active map synchronously. Only moves coalesce. Cancellation
continues to invalidate queued work through the existing epoch. No additional
queue, lock, retry or persistence mechanism was introduced.

Both wheel-pan implementations now consume offscreen travel with one bounded
translation for the visible pair, preserving spacing and responding to the next
reverse event. The iPhone source also clears the old idle timer before switching
gesture kind, so it cannot close the new stream early. Native host mapping,
native Baguette binary, permissions and transport endpoints are unchanged.

The three review reproductions failed before and passed after repair. The
production-source regression also covers both wheel-kind directions, four screen
edges, and blur while native boundaries are waiting for transport. The focused
Android gesture file passes all 10 cases in 3.83 seconds. Repository contracts and
all simulator files pass 1417 checks, zero failures or skips. The wheel vendor
patch reconstructs the exact packaged source and the vendor inventory is current.

A real Electron 42.11.12 renderer loaded the revised production scripts and used
real DOM events and an HTTP server holding the first input response. It observed
two native begins and two complete releases (four immutable samples), seven
pan-to-pinch samples retaining both new deltas, immediate reverse after edge pan,
and matching iPhone pan positions. The old iPhone pan idle timer did not close
the following pinch. Receipt: `pr235-runtime-receipt.json` in the task artifact
directory. This is synthetic renderer/HTTP verification, not a running device,
physical AppKit capture, end-to-end latency measurement or fresh user hand-feel
acceptance. Forge validates and packs 0.2.58 without installing it.

The 0.2.56 physical acceptance below still documents the unchanged host mapping
and native backends. It is not evidence that the newly repaired queue handoffs
or wheel boundaries were physically retested; those use the targeted regression
and Electron backpressure evidence above.

## Actual development sidebar follow-up — 2026-10-28

The isolated desktop worktree now runs the actual Cindy task sidebar, with local
plugin 0.2.56 installed through its normal permission prompt (explicitly confirmed
by the user). The ordinary installed Cindy app is unchanged.

This acceptance exposed a real embedding bug that the standalone window missed:
AppKit's pointer was in window coordinates (observed x=1096), while CDP hit testing
expected the 510-pixel-wide guest viewport. Hit testing returned “No node found at
given location”, leaving native capture inactive. The host now uses a fixed native
window-content coordinate space and subtracts the exact owning webview's bounds,
with separate host/guest zoom factors. Stale asynchronous bounds replies are
invalidated on blur/navigation. The plugin receives no new bridge or privileges.

Three new regression cases failed before and passed after the coordinate fix:
embedding offset, different host/guest zoom plus absent embedding, and blur during
bounds lookup. All 69 input/security tests pass. The existing nested-frame Electron
runtime check passes, with 120/120 atomic samples received (adapter p95 1 ms).
The final desktop typecheck and the 11-test native-input regression rerun pass.
These are not measurements of physical gesture-to-display latency.

Native test Apps now cover all requested operations. iOS uses simultaneous UIKit
pinch/rotation/two-finger-pan recognizers and records UITouch pairs. Android records
MotionEvent pointer IDs and applies the pair's similarity transform. The arrow
shape and displayed metrics make rotation and translation visible.

- Actual dev iOS sidebar DOM replay: 152 samples, stable two-contact identity,
  expand/reverse, approximately 90° rotation and pan, followed by complete release.
- Android installed viewer DOM replay: 117 native samples after transport
  coalescing, stable two-contact identity and the same combination/release checks.
- Actual dev Android sidebar replay: 152 emitted samples, 127 native App samples
  after coalescing; stable contact IDs, expansion/reversal, rotation, translation
  and full release all pass the receipt verifier. Pacing runs outside the renderer
  because the initial background-renderer timer replay timed out; that incomplete
  run is not an acceptance result.
- Receipts and a verifier are in `artifacts/trackpad-touch-probe/` in the task
  workspace. Apps accumulate transforms and native recognizers have slop, so these
  checks compare within-sequence motion; absolute final transforms need reset.

Synthetic DOM replay does not establish AppKit capture. Following the coordinate
fix, the user tested the named development window and confirmed completion.
The observer in the actual iPhone sidebar recorded 31 native begins, 2043 changes,
30 ends and one cancellation, with at most two contacts. Main-process native
sequence logs corroborate capture. The same observation interval also contained
121 wheel events; this does not establish zero fallback input across the session.
The observer generates no input. This establishes physical capture in the sidebar,
but the user's completion reply is not a quantified responsiveness score.
The actual Android dev sidebar subsequently recorded 3 physical begins, 327
changes, 3 ends, no cancellation and no wheel events. The user identified that
same sidebar and reported slow two-finger translation, so capture is verified but
the pre-adjustment movement gain did not pass subjective acceptance.

### Translation gain follow-up

The host previously scaled both axes by the surface width. In the 263.25 × 585
portrait Android sidebar that compressed travel. Both platforms now use the
surface's long edge for the initial pair and subsequent displacements (2.22×
travel at this size). A single isotropic factor preserves stationary contacts,
pinch ratios and angles away from clipping; initial touch separation also grows,
so edge clipping still limits available travel. No centroid-only acceleration or
gesture classification was introduced.

The new regression failed before the change and passes afterward; all 70
input/security tests pass. It checks translation, constant-distance rotation and
pinch ratio, with existing stationary-contact and immediate edge reversal tests.
The first updated standalone runtime attempt lost focus mid-sequence and correctly
cancelled; it is not counted as a successful run. After the development restart
finished, a fresh runtime run passed: 120/120 atomic samples, adapter p95 1 ms,
stationary finger, independent motion, liftoff and blur cancellation. Desktop
typecheck also passes. The isolated development build was restarted with the new
mapping and its actual Android sidebar restored. The user tested it and explicitly
accepted: “平移速度合适，缩放旋转也正常”. The observation-only listener recorded 6
begins, 1644 changes, 6 ends, one cancellation and zero wheel events; native
main-process sequence logs corroborate physical capture. The test App's latest
receipt ends with zero live contacts. The latest receipt is only the last gesture,
not a complete recording of the whole session.

The iPhone was then retested in the same development sidebar with the adjusted
host mapping. Its 247.75 × 539.62 surface uses approximately 2.18× the previous
travel, compared with Android's 2.22×; both use the same long-edge rule. A fresh
152-sample DOM combination replay passed in UIKit: 2.0× contact-span expansion,
reversal to 0.5× peak span, 88.3° recognized rotation, pan and complete release.
This replay checks App semantics, not physical input latency.

After the replay, the App was relaunched and an observation-only listener started.
The physical iPhone test recorded 2 begins, 563 changes, 2 ends, zero cancellations
and zero wheel events. Native capture was also observed in the main-process log;
the App's last-gesture receipt ended with no live contacts. The user explicitly
confirmed: “和安卓一致，平移跟手，缩放旋转正常”. Both iPhone and Android have now
passed post-adjustment development-sidebar hand-feel acceptance. Receipts are
`ios-pan-dev-combination.json`, `ios-pan-physical-receipt.json` and
`ios-pan-physical-app.json` in the task artifact directory.

Exact end-to-end parity with Apple's Simulator is not benchmarked. No production
release was performed.

### PR candidate 0.2.57

The reviewed candidate is rebased onto plugin main 0.2.54. Compared with the
user-tested local 0.2.56 artifact, both platforms' gesture handlers, native Baguette
binary, viewer proxy and screen input code are byte-identical. Differences are
manifest/version and documentation, equivalent placement of the opt-in meta tag,
control-help text, and main's device-management fixes (create response, memory
mode on boot, rename focus). Those management paths do not alter an already-open
sidebar's touch stream. Downloaded resources and local package/trust files are
not acceptance evidence. The host input implementation is unchanged by its
rebase. The manual acceptance above applies to the unchanged gesture paths;
0.2.57 is not claimed as a fresh physical-trackpad session.

The sections below retain earlier test stages and their limitations; the current
development-sidebar results above supersede their pending-sidebar statements.

## Native pinch responsiveness follow-up — 2026-10-28

Installed local test package **0.2.56** through Cindy Forge, updating the existing
`_ns__xd__baguette-simulator` instance. Desktop changes remain in the independent
`设备模拟器 · 原生双指测试` Electron window; the running production Cindy app was
not replaced. Ordinary production sidebars do not gain native capture from the
plugin update alone.

### Changes and verified behavior

- Opted-in `data-cindy-trackpad="contacts"` surfaces receive one atomic DOM
  sample per native two-contact sample, including both initial contacts. The
  legacy Chromium touch-injection fallback remains for other marked surfaces.
- Mapping consumes off-screen overshoot at the boundary. A small reversal moves
  the touch immediately instead of first traversing an invisible clipped range.
- Same-document navigation releases old capture but preserves the document's
  explicit opt-in; full navigation, blur and owner changes still disable input.
  Follow-up regression: if blur or a same-document route update occurs while
  the initial opt-in read is pending, input teardown must not discard that
  document's reply forever. Document and capture generations are now separate;
  a replaced or crashed document still invalidates the pending reply.
- iOS two-contact input uses a digitizer parent and two distinct finger children,
  with stable contact identifiers throughout down/move/up. Message patching
  validates and updates all three actual records. The older mouse-based pair
  transport also recognized pinches in direct testing; it was not universally
  broken and is not claimed as the sole cause of the reported poor feel.
- Interactive native and proxy sockets explicitly disable Nagle buffering.
  Controlled comparisons below did **not** establish a frame-rate benefit from
  this setting; do not describe it as a proven responsiveness fix.

### Measurements and limits

On the existing iPhone 18 Pro Max / iOS 27.0 simulator in the plugin's private
device set, a small UIKit TouchProbe app records real UIPinchGestureRecognizer
updates. These are synthetic repeatable input tests, not human trackpad scores.

| Layer and test | Observed result | Interpretation |
| --- | --- | --- |
| Electron main → nested viewer, 120 samples | Previous CDP touch path p95 15 ms; atomic DOM path p95 1 ms, 120/120 received | Input-adapter latency only, not end-to-end display latency |
| Actual UIKit expand then reverse via installed viewer transport | 194 updates, two contacts throughout; first reverse step immediately reduced scale | Confirms two-contact semantics and reversal |
| Installed 0.2.56 authenticated proxy, Node receiver | 103 video frames / 2119 ms, 48.6 fps, p95 frame gap 21.3 ms, zero errors | Background transport; no AppKit or browser painting |
| Browser DOM playback through installed 0.2.56 | 99 received, decoded and painted / 2015 ms | No extra decode/paint frame loss in this run |
| Controlled native server 0.2.55 vs 0.2.56 | Both 116 frames / approximately 2.11 s, 54.9 fps | No measured native socket-setting benefit |
| Controlled proxy 0.2.55 vs 0.2.56, Node receiver | 54.9 vs 54.5 fps | No measured proxy-setting benefit with Node client |
| Controlled browser DOM playback 0.2.55 vs 0.2.56 | Both 95 received, decoded and painted / approximately 2.01 s | No measured socket-setting benefit with Chromium either |

After unlocking, the full host-module playback reproduced 21 received/decoded/
painted frames in 2062 ms, despite delivering all 199 moves. Removing the
test harness's immediately preceding `webContents.capturePage()` produced
104 received/decoded/painted frames in 2063 ms with the same 199 moves. A separate
CDP-only probe observed 97 frames without capture and 71 with capture in roughly
2 s. This identifies screenshot-induced measurement interference, not a
production gesture fix or a claim about the exact macOS/Chromium mechanism.
The runtime helper now takes its evidence screenshot only after measurement.
It also rejects interrupted/mixed input and video cadence below 70 painted
frames for this controlled 199-move replay.

Two subsequent replays lost focus partway through and correctly released the
contacts (109 and 84 moves delivered). They are failed acceptance runs, not
performance measurements. Focus guards were preserved. The unchanged production
module's complete 104-frame replay is the available full-path evidence; manual
trackpad acceptance remains separate. Earlier 18–35-frame results must not be
presented as a before/after production performance gain.

Validation: 8 desktop native input unit tests passed (including the opt-in
race's failing-before/passing-after proof); desktop typecheck passed after the fix;
1216 plugin repository tests passed with no failures/skips; 21 digitizer/input
native tests and the real accepted-socket test passed. Release native binary
was rebuilt from the verified official 0.2.10 source archive, signed locally,
and its inventory verified. All 13 native patch paths apply cleanly and match
the build sources. No source commit, push or release was performed.

Reproduction helpers in the desktop worktree:
`apps/desktop/scripts/native-trackpad.verify.mjs` (nested-frame fixture or
`--viewer <private-url-file> --exercise`) and
`apps/desktop/scripts/native-trackpad-transport.verify.mjs <private-url-file>`.
The URL file contains a capability and is intentionally excluded from reports.
TouchProbe source, non-secret benchmark scripts and receipts are preserved in
`/Users/dash/Code/Cindy/artifacts/trackpad-touch-probe/`.

Manual feedback on 2026-10-28: the user reported “明显跟手了，反向也正常”.
The preview log had no native-capture marker for that gesture, although UIKit
recorded a completed two-contact pinch. Its exact window/input source is still
being clarified, so this is positive feel feedback, not proof of native contact
delivery. After the opt-in race fix, a grounded native click in the reopened
test window produced `NATIVE_CAPTURE_READY` (capture id 1). That proves arming,
not physical NSTouch delivery. The interactive window remains available.

Remaining acceptance: confirm physical native-contact delivery for the user's
successful feel test, exact parity against Apple's Simulator, and Android device
playback. Physical parity is not yet claimed.

## Native Mac trackpad mapping — 2026-10-27

Implemented with the `dash/native-trackpad-mapping` desktop worktree. Public
AppKit NSTouch events retain each finger's identity and position, including a
stationary finger. The cursor anchors the initial pair; movement is scaled by
the physical trackpad aspect ratio and clipped to the visible device surface.
The local adapter sends standard Chromium touch events through opted-in nested
viewers. Native wheel/magnify duplicates are suppressed during capture. Blur,
navigation, owner revocation and cancellation release contacts. This requires
both the new desktop build and plugin markers; a plugin-only update cannot
enable native capture in an older desktop build.

- Desktop typecheck and 62 input/security tests passed. The Electron runtime
  check passed with cross-origin plus same-origin nested frames, asymmetric
  movement, a stationary finger, individual liftoff and blur cancellation.
- The real AppKit addon loaded and emitted multiple `NATIVE_CONTACTS_BEGIN`
  packets in the interactive preview. This proves native input arrived, not
  acceptance of perceived latency or pinch sensitivity.
- Interactive teardown exposed a missing `stop` export in the native module.
  The descriptor count now uses the array size. The runtime check explicitly
  verifies/calls `stop` and passed again after rebuilding.
- Plugin repository checks passed: 627 tests. Native contact tests cover stable
  IDs, immediate reversal, displayed coordinates and release on cancel/detach.
- Installed test package 0.2.53 through Cindy Forge into the existing
  `_ns__xd__baguette-simulator` instance. It preserves the latest installed
  0.2.52 features and adds the native markers/touch source. Earlier test package
  0.2.52 had been replaced by a concurrent plugin update; it is superseded.
- Opened the real iPhone viewer and Maps in the standalone window titled
  `设备模拟器 · 原生双指测试`, using the production input module and native addon.
  After the fix, mouse entry armed capture successfully. Production Cindy was
  not replaced. No release, source commit or PR was published.

Remaining acceptance: physical trackpad feel and real Android device playback.
Android uses its existing independent pointer stream. iPhone's existing native
transport separates one- and two-contact streams, so lifting one finger ends
the pair and starts a single-contact stream; this boundary is not equivalent
to an uninterrupted physical iPhone contact. Windows/Linux and unsupported
hosts retain the existing wheel fallback.

## Android pinch follow-up — 0.2.27

Verified 2026-10-25 on the same Android API 36 device, installed in place through
Cindy Forge. The user clarified the problem as pinch magnitude and unresponsive
reverse pinch, not scrolling. This follow-up changes Android pinch only.

- Reproduced on 0.2.25: expand beyond both screen edges repeatedly, then reverse
  by `deltaY=20` within the same gesture. Actual contacts stayed at `[1, 0]`:
  the internal scale had accumulated beyond the usable screen span.
- On 0.2.27 the same reversal moved contacts to approximately `[0.9522, 0.0437]`
  within 16 ms. Every observed request succeeded. Subsequent inward movement
  continued shrinking the span; the final request released both contacts and
  the overlay contained no dots.
- A single `deltaY=-180` pinch reached its final contacts at 82 ms versus 192 ms
  in the earlier local measurement. These are individual viewer-input timings,
  not a general benchmark or a measurement of physical-trackpad latency.
- Google Maps 25.11.01 on the emulator visibly zoomed in on a single fast pinch
  and zoomed out during the reverse sequence. Two initial intermediate moves
  are retained for Android interception and scale recognition; subsequent moves
  follow the newest input directly. One intermediate move alone was insufficient
  in this App and was corrected before completing verification.
- Full repository gates: 625 tests passed, zero failures or skips; manifest
  validation, vendor inventory and diff whitespace checks passed. Regression
  tests cover repeated edge expansion and small reversal at left/centre/right
  anchors, delayed input, bounded recognition moves and final contact release.

These were browser-generated wheel events sent through the installed viewer's
real HTTP/native touch path, with screenshots of the running Maps App. Physical
trackpad feel in Cindy's embedded viewer still needs the user's acceptance.
Maps remains open in the task viewer for that check. The cross-platform
interaction rule and existing iPhone comparison tests remain in effect.

## Earlier parity verification — 0.2.25

Verified 2026-10-25 from `dash/simulator-scroll-overlay`, including the preceding
iPhone wheel-overlay correction. The plugin was installed through Cindy Forge
as an in-place update to the existing `xd/baguette-simulator` instance. No Cindy
client replacement or App installation was needed.

## Automated checks

The repository manifest, localization, provisioning, publish-workflow and
simulator suites passed: 623 tests, zero failures or skips.

- The same wheel events run against iPhone's wheel source and Android's input
  handler agree on both final touch coordinates for pan and pinch, at three
  display scales, including cursor movement and direction reversal.
- Android's delayed initial touch test retains intermediate motion, two parallel
  contacts and a final release for both contacts.
- Option-drag and Option-Shift-drag tests verify mirrored pinch versus parallel
  pan, the displayed dot coordinates and cleanup on release, blur and page exit.
- Android serves the existing iPhone PinchOverlay component; no separate dot
  style or rendering implementation is introduced.

## Running device and viewer

macOS Apple Silicon, existing Android API 36 Google Play arm64 device, GPU
renderer. The controller was opened through the installed plugin and exercised
in Cindy's external Chrome automation browser. Browser-generated wheel events
went through the real viewer HTTP endpoint and emulator touch input; they were
not injected into the Settings App process.

- A two-contact vertical wheel stream scrolled the Android Settings list. A
  viewer screenshot showed both dots at the same height and fixed spacing.
  All 37 touch requests succeeded, each carried two contacts, and the final
  request released both contacts.
- Ctrl+wheel expanded the contact span around an off-centre cursor. Every touch
  request succeeded, the two dots matched the touch positions, both contacts
  were released, and the overlay contained zero dots after settling.
- The only browser console error was an unrelated `/favicon.ico` 403. No gesture
  request failed and the viewer showed no input error.

The device remains on Settings for the user's trackpad check. Physical-trackpad
feel, App-specific pinch-to-zoom behavior, and the same walkthrough inside the
Cindy embedded viewer remain user acceptance items. Settings is not a zoomable
App, so the accepted pinch contacts are not claimed as visual content zoom.
Windows/Linux and new iPhone runtime testing were not performed for this change;
iPhone's previously corrected wheel logic is covered by the shared input tests.
