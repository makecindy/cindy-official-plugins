# Physical viewer parity — installed 0.3.1

2026-10-28, local Cindy host, macOS/Xcode 27 and paired iPhone Duo/iOS 27.2.
Source: `dash/simulator-real-devices`, uncommitted development package.

- Required repository/plugin suite: **761 passed, 0 failed** (40.8 seconds).
  `git diff --check` and vendor inventory validation passed.
- Current browser controller rendered the real phone at 800×900/dark and
  320×640/light, without page errors or horizontal overflow. Zoom menus,
  screenshot/Home controls and keyboard toggle use the simulator controller.
  The ID field and separate text-input form are absent.
- Browser input tests with intercepted device APIs verified deferred control
  preparation without stale-input replay, point coordinates, Unicode input,
  keyboard disable and Option two-contact paths. This is synthetic input
  evidence, not physical gesture or native-trackpad-feel acceptance.
- Forge returned `updated`, version `0.3.1`, enabled, preserving the existing
  `xd` plugin instance/configuration/data. No marketplace publication.
- Installed plugin discovery reported the phone connected with control
  disconnected. `viewer open` then returned `previewOpened:true` with location
  Cindy task sidebar / Device Simulator. Installed `screenshot` succeeded on
  display 2, 669×951 points, without starting the control runner.
- The isolated test runtime selected the existing runner's signing team without
  a supplied team ID and reached ready. Later, the foreground app changed and
  the control connection refused requests; input testing stopped and its owned
  runner/harness were terminated. No visible tap/text success is claimed.
- Local desktop GUI automation lacked host consent, so the actual Cindy panel
  screenshot and native trackpad feel were not verified. Browser UI evidence
  and a successful host open receipt do not replace those checks.

Remaining: visible click/text/swipe/pinch acceptance in a stable foreground
test app, native sidebar trackpad feel, disconnect/reconnect on physical
hardware, USB-only and iPad compatibility. The frame transport remains periodic
screenshots and XCTest dispatches gestures after release; streaming latency is
not equivalent to the simulator.

## 0.3.2 latency and physical touch follow-up — 2026-10-28

- Reproduced the no-op: shared `core.dispatch` rejected `physical_touch` before physical device routing. Earlier isolated adapter/browser mocks bypassed this layer. Added regression through the real core dispatcher; installed viewer now traverses core and reaches the real device.
- Original capture path on Duo inner display: discovery 99 ms, screen query 760 ms, capture 1109 ms, second screen query 429 ms, PNG decode 106 ms, JPEG encode 152 ms (~2.65 s excluding client polling). Outer-display comparison later: 149 + 416 + 858 + 552 + 175 + 75 ms (~2.23 s).
- Added read-only phone JPEG preview to the existing paired tunnel listener, max 1280 px long edge. Display information has a one-second cache for preview only; input still reads fresh geometry. Unsigned viewing/export uses the unchanged CoreDevice path. Transport loss clears ready and falls back to unsigned viewing, without retrying input.
- Xcode 27 build-for-testing passes. Required repo suites: 764 passed / 0 failed, 41.8 s. `git diff --check`, vendor inventory and changed JS syntax checks pass.
- Host install receipt: action updated, version 0.3.2, namespace xd, original instance `_ns__xd__baguette-simulator`, enabled. Actual control returned ready; app launch returned previewOpened=true in Cindy task sidebar.
- Current physical phone was folded onto display 1 (466×678 points). Eight authenticated installed-viewer frame requests: 744, 229, 167, 175, 231, 166, 624, 209 ms; mean 318 ms. These are frame request times, not glass-to-glass or click-to-display latency. Preview image visually matched IntegrationApp.
- Real browser canvas click through the installed controller at the freshly observed Attributes button (233,144) changed the real phone from the main menu to the Attributes screen. Screenshot and fresh AX tree confirmed the transition. This fixes the concrete no-input regression; it does not establish native Cindy trackpad feel.
- Clicking the aIdentifier field brought up the real keyboard. Typing immediately after that click returned accepted but left the field empty. A later viewer keyboard action with the keyboard already visible produced `Cindy test 032`, confirmed in the phone AX value. First-focus keyboard readiness remains an explicit compatibility gap; do not equate XCTest acceptance with visible insertion or replay uncertain typing.
- Mocked browser regressions also pass: lazy setup without replay, point coordinates, Unicode transport, keyboard-off gate, Option two-contact path. Those mocks are not physical input evidence.
- This turn did not physically unfold the phone, validate inner-panel input or run native Cindy trackpad gestures. Those remain separate acceptance items. No account dialog, game input, formal app reinstall or unrelated phone was touched. No commit, push or public release.
- With the keyboard already ready, a second viewer insertion ` 中文输入 👋` produced the exact combined AX value `Cindy test 032 中文输入 👋`. Unicode visible insertion is confirmed in that state; the first-focus timing gap above remains.

## 0.3.3 preview scheduling and first-focus input — 2026-10-29

- Direct paired WDA JPEG frame requests on the current outer display took 40–111 ms. This identified per-frame CoreDevice discovery and blocking metadata refresh as the remaining avoidable latency.
- Preview-only metadata now refreshes in the background at 750 ms age, with a two-second hard reuse limit. Open views share an in-flight frame rather than queueing captures. Input and exports retain fresh target/geometry reads. No independent periodic timer survives viewer closure.
- Source preview module connected to the already-running real 0.3.2 JPEG endpoint: 40 frames, first 645 ms; remaining 39 mean 74.56 ms, median 67 ms, p95 107 ms, maximum 134 ms (30 ms client pause between requests). This is source-to-phone request evidence, not the subsequently installed Cindy sidebar's frame rate or glass-to-glass latency.
- Native read-only keyboard readiness route compiled successfully using Xcode 27. It waits at most two seconds for a hittable keyboard key. The first-party caller sends no text on readiness timeout. Adjacent unsent text batches preserve key/gesture boundaries and cancellation; sent input is never replayed. External hardware-keyboard compatibility remains unverified.
- Required repo suites: 768 passed, 0 failed, 40.86 s. Additional latest physical tests: 22 passed including text batch ordering, queued-text cancellation, refresh sharing/staleness/failure, keyboard-not-ready outcome and application-error/transport distinction. Installed-page browser mocks passed lazy setup/no replay, point coordinates, Unicode transport, keyboard gate and Option pair. Xcode build, diff check and vendor inventory pass.
- Host receipt confirms original xd instance updated to 0.3.3, enabled; viewer open returned previewOpened=true in Cindy task sidebar. The device automatically locked before the rebuilt component could launch. Xcode requested unlocking the selected Duo; connect_status subsequently returned RUNNER_NOT_READY after its bounded wait. Asked the user to unlock; no bypass, automatic unlocking or repeated input.
- Pending after unlock: connect the installed 0.3.3 runner, run the 40-frame installed endpoint profile and the immediate-click/type test in com.makecindy.DeviceProbe, verify actual field value via fresh AX/screenshot. Do not claim first-focus loss is resolved or installed-sidebar latency verified yet. Native trackpad feel and inner-panel input remain separate acceptance gaps.

## 0.3.4 physical phone shell — 2026-10-29

- Matches physical hardware model identifiers to the installed Xcode device catalog and uses the unchanged Baguette chrome CLI plus `_Bezel` component. Body, static button artwork, cutout and mask come from local DeviceKit resources; no Apple assets are packaged. Screen geometry selects the Duo panel independently of CoreDevice/simulator display-ID differences. Artwork is loaded and cached outside frame polling; live canvas/input listeners survive body replacement. Whole-body zoom and screen-only touch coordinates remain separate.
- Browser validation uses current source, real local Xcode artwork and a previously captured IntegrationApp image. Device state/frame reads and all mutations are mocked. Visually inspected Duo cover (asymmetric corners), inner panel rot180 (crease), iPhone Air, and 320px light layout. Also exercised inner landscape, fit/percentage zoom, screen-relative click positions and noninteractive shell edges. Browser errors: none. This is layout/input-coordinate evidence, not live phone execution or native Cindy sidebar/trackpad acceptance.
- Required suites: 771 passed / 0 failed, 41.29 s. Includes panel selection independent of IDs and pixel/alpha/cutout rotation. Vendor inventory and git diff check pass. Vendor bytes unchanged by this shell update.
- Host installation receipt confirms 0.3.4 updated and enabled in original xd instance `_ns__xd__baguette-simulator`. Subsequent plugin devices reports the selected Duo disconnected; no installed live-view or input verification claimed. Did not switch to or manipulate unrelated connected phones. After Duo reconnects, reopen its viewer and complete installed-shell, immediate-first-focus typing and latency checks. Prior native trackpad and inner-panel input gaps remain.

## 0.3.5 Air screen availability and recovery — 2026-10-29

- Current task selection was Air. Its live CoreDevice response showed backlightState=activeOn and one primary integrated display, but omitted active and uniqueId. This reproduced the permanent DISPLAY_UNAVAILABLE error despite the phone being awake. Duo returns these optional fields and was unaffected by that omission. Fixed single-display selection and the documented primary-display screenshot default; explicit inactive/multiple unknown panels and unidentified secondary capture remain rejected.
- Source capture succeeded on the real Air at 420×912 view points, without starting/signing a control runner. Existing preview retries continue automatically; removed the extra status fetch from the failed-frame path, reduced read-only timeout, and use one-second retry spacing. Unavailable frames cannot accept input. State UI now has phone icon, short title/body and an automatic-connection indicator; no raw “unique active screen / observe again” instruction.
- Browser mock validates two unavailable→available transitions without navigation/reload, clears status on fresh frames, sends zero mutations when the stale screen is clicked, and reports zero page errors. Light/dark 320px state screenshots visually inspected. This tests recovery handling, not an actual lock/wake cycle on the phone.
- Required repository suites: 773 passed / 0 failed, 40.31 s. Vendor inventory and diff check pass. No new vendor bytes or dependencies.
- Host receipt confirms 0.3.5 updated/enabled in original xd instance; Air viewer returned previewOpened=true in the Cindy task sidebar. Read-only browser inspection of that installed viewer received two successful live frames at 420×912, rendered matching Air shell, hid the old error, and had zero page errors. Inspected installed-page screenshot. No device input, app launch, sign-in or clipboard operation performed. Control first-focus/native trackpad and Duo inner-input gaps from earlier versions remain outside this screen-availability check.

## 0.3.6 stable percentage zoom — 2026-10-29

- Reproduced zoom feedback in the source viewer: repeatedly setting the same 67% changed body dimensions from approximately 329×443 through alternating sizes to 898×1207. The inferred fit percentage used the prior fit estimate rather than the applied frame, causing drift without any user percentage change.
- Physical percentages now size the original body directly, accounting for fixed parent/child padding. Body/artwork changes trigger parent measurement. Generic handheld measurement derives the applied scale from actual frame bounds. Added regressions for repeated measurements, resize, panel aspect changes and fit restoration.
- Required repository suites: 775 passed / 0 failed, 40.44 s. Targeted controller/physical tests: 68 passed. Vendor inventory and diff check pass. No vendor bytes or native build changed in this follow-up.
- Source browser checks used real Xcode Air artwork and mocked device frames. Installed-viewer browser checks used the real Air endpoint. Both validated 25/33/50/67/75/100/300%, repeated 67%, window resize, stored percentage after reload and fit at 320px width. Air body at 67% stayed 329.48×663 CSS px; at 100%, 492×990. Zero page errors. Screenshots inspected. Only viewer zoom was changed; no device input was sent.
- Host receipt confirms 0.3.6 updated/enabled in original xd instance `_ns__xd__baguette-simulator`; Air viewer open returned previewOpened=true in Cindy task sidebar. Browser layout checks do not establish native sidebar trackpad feel or physical input latency; earlier input acceptance gaps remain separate.

## 0.3.7–0.3.8 control notices and third-party keyboard — 2026-10-29

- Reproduced the hidden notice: bezel children had positive stacking levels while the notice had none. The body now isolates its stacking context below status/notice UI. Source browser checks with real Xcode Air artwork confirm notice hit-testing above the body, full text within 320px light/dark layouts, no input while preparing, and notice clearing on successful input. Mock touch evidence remains distinct from hardware acceptance.
- Current Air runner log explicitly said Xcode could not launch because the device was locked. Existing bounded startup polling now reads at most the last 16 KiB of its own runner log and exposes waiting_unlock; timeout gives a specific PHONE_LOCKED reason. No new poller or replay. User subsequently unlocked Air; installed control reached ready.
- Installed 0.3.7 viewer browser canvas click on the observed Settings Wi-Fi row opened the real Wi-Fi page; a fresh accessibility tree and screenshot confirmed navigation. Back navigation also worked. No network settings were changed.
- An immediate search-field click/type then returned not_executed for text. The field stayed empty even with the third-party keyboard visible. Its real accessibility tree contained Key descendants but no Keyboard container, exposing the overly strict readiness guard. In 0.3.8 the existing native read-only readiness route checks visible key descendants, retaining the two-second timeout and no-send-on-timeout behavior. The upstream archive is unchanged; only the reproducible native patch changed.
- Updated component built successfully with Xcode 27 and the installed 0.3.8 runner reached ready. Through the installed viewer canvas/keyboard, a click and typing General both returned executed. A fresh real-device accessibility read confirmed Search.value exactly General and search results appeared; installed screenshot also showed the typed text. This confirms third-party keyboard insertion with an already-visible keyboard, not every first-focus timing case or external hardware keyboards.
- Final required suites: 776 passed / 0 failed, 40.54 s. Targeted physical tests: 27 passed; lock-log diagnostics and existing no-text-on-readiness-timeout tests pass. Vendor inventory and diff checks pass. Both 0.3.7 and final 0.3.8 Host receipts identify the original enabled xd instance; final Air viewer receipt confirms Cindy task sidebar opened.
- Native Cindy trackpad feel, latency measurements and Duo inner-panel input were not rerun. No account, network toggle, message or payment was changed. No commit, push or public release.

## 0.3.9 gesture stalls — 2026-10-29

- Profiled installed 0.3.8 on the selected real iPhone Air. Forty frame requests (30 ms pause): cold 2590 ms; remaining 39 mean 377.05 ms, median 74 ms, p95 707 ms, maximum 8417 ms. Interaction stalls, rather than ordinary JPEG requests, dominated the perceived delay.
- Native WDA handles gestures and preview on its main queue. The default animationCoolOffTimeout was two seconds; resolving XCUICoordinate.screenPoint for each sampled pointer movement also repeatedly snapshots accessibility. New sessions disable the post-gesture settling wait. The reproducible native patch uses backend-validated whole-display viewport coordinates directly when Cindy display mode is active; generic origins retain upstream coordinate resolution. Bounds/display checks, gesture duration and no-input-replay behavior remain unchanged.
- Matched real home-screen swipes through the installed viewer browser canvas used ten moves at 20 ms intervals, y=500 and x=320→100 / 100→320. On 0.3.8, Page 2→3 / Page 3→2 action completion took 6557 / 6358 ms, with longest concurrent frame requests 5634 / 5354 ms. Disabling only the settling wait still took 5107 ms with a 4155 ms frame stall, so that setting alone did not resolve the bottleneck.
- Installed 0.3.9 with both fixes: the same Page 2→3 / Page 3→2 gestures took 1647 / 1540 ms; longest concurrent frame requests were 694 / 692 ms. Fresh accessibility reads after each measurement confirmed Page 3 and Page 2 respectively; the installed viewer screenshot was inspected. An initial Page 1→2 preparation swipe took 1619 ms. These action durations include browser gesture entry, fresh device geometry and dispatch completion; they are not glass-to-glass latency or native Cindy trackpad measurements. Accessibility verification ran after, not during, timed gestures.
- Final installed endpoint profile: 40 requests, cold 610 ms; remaining 39 mean 84.92 ms, median 75 ms, p95 142 ms, maximum 149 ms. This measures frame request completion on the Mac, excluding remote viewing from the user's phone. Periodic screenshots and dispatch-after-release remain; no continuous video transport was introduced.
- A preliminary tap trial was excluded from comparisons because an incoming notification changed its target and opened TapTap. Returned to Home and used matched middle-screen swipes for the recorded comparison. No message, payment or account setting was changed. Left Air on Home Page 2.
- Xcode 27 native build succeeded. User unlocked after build; the installed runner reached ready and actual swipes executed. Forge receipt identifies version 0.3.9, original enabled xd instance; viewer open receipt confirms Cindy task sidebar. Required repository suites: 776 passed / 0 failed, 40.62 s. Native patch dry-run against the pinned archive, vendor inventory and diff checks pass. Upstream archive unchanged; no new dependency or public endpoint. No commit, push or public release.
- Native sidebar trackpad feel, remote phone-to-Mac display latency, Duo inner-panel input, physical rotation and external keyboard cases remain outside this measurement.

## 0.3.10–0.3.20 continuous physical input and video — 2026-10-29

- Replaced the interactive viewer's completed XCTest paths with persistent
  Universal HID contacts over the selected paired tunnel. Pointer down sends
  immediately; movement updates the held contact; release/cancel ends it.
  Backpressure coalesces only unsent movement, never a whole gesture. The
  existing shell, toolbar, zoom, screen coordinates and native-contact entry
  remain. Unicode text/AX automation still uses the signed WDA component.
- Added independent HEVC media and WebCodecs decoding through the existing
  authenticated viewer. A separate GPL helper uses pinned, hash-checked
  pymobiledevice3 11.47.0 in a private Python runtime. No upstream web server,
  clipboard or audio session is started. Closing the last stream releases
  input and retires its helper; teardown never sends stop_all to the device.
- Actual installed runtime is Xcode Python 3.9. Its missing loop.sock_sendto
  initially killed media feedback; a nonblocking UDP adapter restores both
  RTCP and RCTL. Additional fixes cover concurrent startup, cold first frames,
  decoder bursts, process exit before pipe closure, late packets, hidden views,
  cancellation leases and bounded connection diagnostics.
- Do not treat an unchanged frame counter alone as disconnection. On installed
  0.3.20, Air stayed at 925 frames for at least 18 seconds while idle; Home and
  the following held swipe resumed video in the same generation. Earlier
  five-second idle resets manufactured reconnect pauses. Idle now has a longer
  budget, while an input starts a fresh bounded video-response deadline;
  repeated input cannot postpone it. A regression verifies this distinction.
- Host receipt confirms 0.3.20 updated and enabled in original instance
  `_ns__xd__baguette-simulator`, namespace xd. Viewer receipt confirms the
  selected Air opened in the Cindy task sidebar. Verification used headless
  Chrome against that installed authenticated controller, with real phone
  input/video, not mocked frames. Device: iPhone Air / iOS 27.2, paired network
  connection, 420×912 logical points. No other phone was operated.
- On 0.3.20, a 12-sample left drag visibly shifted Home icons while the pointer
  stayed down. Twelve reverse samples moved them back before release. Fresh
  held/reversed screenshots and the request sequence were inspected: begin,
  moves and heartbeat preceded the sole end. Cancel via __nativeRelease sent
  cancel and no deferred swipe. Home worked. Browser page errors: zero.
  Earlier 0.3.17/0.3.19 continuous-video samples were 178/168 frames in three
  seconds; the 0.3.20 post-gesture sample was 129 in three seconds. These are
  local decoded-frame counts, not glass-to-glass latency or remote phone FPS.
- Required repository suites: 781 passed, 0 failed, 41.37 seconds. Vendor
  inventory and git diff check pass. Raw screen evidence and capability URLs
  remain in the local temporary test directory, outside the repository.
- Final endurance sample: 90 polls over 178 seconds retained one generation;
  received frames increased from 1,031 to 9,044 and the final helper queue was
  empty. Some damaged media was discarded rather than queued. The same helper
  had been running for 3m45s before fault injection. Terminating only this
  viewer-owned helper with SIGTERM automatically started a new generation;
  fresh media was observed by the four-second status sample. No user unlock,
  reload or input replay was used. Installed manifest, helper, viewer scripts
  and vendor review match the final source bytes.
- Actual native Cindy trackpad feel, the user's remote phone-to-Mac network
  latency, Duo panels/rotation and other iOS versions were not physically
  revalidated in this integration. No zero-latency or all-device claim. No
  commit, push or public release.

## Agent live transport — 0.3.21 (2026-10-29)

- Forge updated/enabled the existing xd instance to 0.3.21. Actual ghost_call
  tools selected the same paired Air (iPhone18,4 / iOS 27.2, 420×912 points).
  The private PyAV runtime installed successfully and decoded the shared HEVC
  stream. Coordinate input and capture worked before XCTest was connected.
- A complete Agent swipe visibly changed Home pages. Separate gesture begin,
  three moves, screenshot, three reverse moves, screenshot, end visibly shifted
  icons in both directions before the sole end. Snapshots used live-video with
  advancing sequences. Warm phase calls took 232–265 ms; standalone snapshot
  calls took 413 ms. Observed receiver-side frameAgeMs was 15–92 ms during input;
  none of these timings measure model thought or glass-to-glass latency.
- XCTest connect auto-selected the existing team and reached ready. Text-targeted
  Back buttons navigated Settings; Chinese text entered a blank Settings search
  and both fresh accessibility values and live screenshot showed the exact
  input. Removed the test text and returned Home without changing settings.
- Headless Chrome loaded the installed authenticated viewer: 126 decoded frames
  in three seconds, continuous 12-sample left movement and 12 reverse samples
  before end, zero page exceptions. This exercises the same real phone transport
  but is not native sidebar trackpad-feel acceptance. Raw images stay outside
  the repository. No personal screen contents are included here.
- Required suites: 785 passed, 0 failed (44.02 s). Added tests cover held-contact
  observation/reversal, lease cleanup, preflight-before-input, no replay after
  uncertain delivery, live snapshot provenance, Unicode retention, operation
  without a viewer, viewer closure during Agent input and post-input frame waits.
  Vendor inventory and whitespace checks pass. Xcode runner log was inspected;
  no waiting_unlock occurred during this run.
- Unchanged gaps: real native trackpad feel, remote phone-to-Mac latency, USB-only
  transport, iPad, Duo panels/rotation and other iOS versions. No commit/push or
  public release.
