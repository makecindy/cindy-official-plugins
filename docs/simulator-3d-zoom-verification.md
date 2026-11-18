# Foldable zoom, centering and standard stream resolution — 2026-11-06

Source: `cindy/noble-lederberg`, plugin `cindy-simulator` 0.3.38.
The sections below retain the version under which each runtime result was obtained.
Final gesture changes and user acceptance are recorded in
[the gesture parity evidence](simulator-gesture-parity.md).

## Percentage size and centering

100% uses device logical points, as 2D phones do. The controller compares the
lit screen's projected long edge with the active viewport's logical long edge.
3D frame margins, object-fit letterboxing and fixed toolbar insets are excluded.
Fit to Window uses the projected screen plus a 4% long-edge bezel allowance and hardware-button positions; the native metadata does not expose the body silhouette. Fixed glyph footprints and the controller toolbar are reserved separately. Unused camera margins are clipped rather than fitted. The resulting region is centred in the usable window, including when control anchors are asymmetric. Fixed percentages preserve screen size
across window changes; inner/cover changes refresh the active logical viewport.
Perspective poses use the projected long edge, not an unprojected mesh ruler.
Missing metadata retains the last calibrated size; retired page/panel results
are rejected. The existing posture tick handles late frames and panel changes.

Window resize preserves the previous valid scroll focus. A layout snapshot
prevents mixing new viewport dimensions with old scroll offsets after reflow.
User panning updates the focus while geometry matches the snapshot; Fit returns
to centre. Browser scroll anchoring is disabled because the controller owns it.

## Standard stream, independent of display size

The first connection requests a fixed 4096-pixel long edge, using the device's
screen dimensions for aspect. This is the native 3D renderer's maximum edge;
it describes the composed model frame, including its margins, not one-to-one
native screen pixel fidelity. Zoom, Fit, window dimensions and display DPR only
scale the existing canvas. There is no stage ResizeObserver or window resize
listener which changes stream resolution or reconnects it. A layout-only observer
repositions hardware buttons from their cached normalized anchors; the server
sends those anchors on pose changes, not CSS resize. Detach removes the observer. Reopening the same
device in a differently sized window uses the same resolution and aspect.

The earlier adaptive-resolution implementation was removed following the user's
clarification that zoom must reuse a standard-resolution source. It caused
visible reloads and unnecessary reconnections. The fixed source retains high
quality from the first frame instead of fetching more pixels when zooming in.

## H.264 black-screen recovery

Live Boli Duo testing exposed a native H.264 failure at 2560×4096: ten seconds
of AVCC yielded only a tag-4 JPEG seed, no configuration/keyframe/delta frames.
The seed showed the body before its screen texture was ready. MJPEG at the same
resolution showed the home screen; 2048×4096 AVCC did yield a keyframe.

Above 8,388,608 pixels, the panel uses existing MJPEG support while retaining
the requested resolution and saved codec preference. This is a conservative
measured budget, not a hardware-wide H.264 capability claim. Smaller frames
retain H.264. Decoder/configuration errors recover on the next event turn;
a single painted seed without another paint within four seconds falls back to
MJPEG for that attached panel. Stop/detach clear the timer; session/generation
checks reject retired callbacks. Hidden-page pacing and 2D playback are unchanged.

## Verification

VM regressions run the production controller and stage helper, including the
vendor panel's actual start/stop callbacks. Coverage includes:

- 100%/200% versus Fit, Retina independence, panel changes and quarter turns.
- Repeated narrow/wide/tall/short resizing, automatic scroll clamping and panning.
- A high-resolution first stream even in a small window; zoom, resize and DPR
  changes keep the same session and schedule no restart.
- H.264 pixel budget, successful startup, seed-only stall, immediate decoder
  failure, stale callbacks and detach cleanup.

Real-browser regression uses a fresh headless Chrome test profile against the
same plugin-managed Boli Duo and authenticated loopback viewer. It counts 3D
WebSocket connections and frame navigations, inspects the actual canvas, switches
100% → 200% → 50% → 150% → Fit → 100%, and changes viewport sizes. It checks that
the home screen stays colored rather than displaying the black seed, and that
no additional stream connection or navigation occurs after initial loading.
This is renderer/codec coverage, not native trackpad-feel acceptance.

The executing Cindy is a development build reporting version 0.0.0; its exact
build commit was not verified. No new Host API, permission, endpoint or vendor
asset is introduced, and the existing minimum-version declaration is unchanged.
The target is the user-authorized local instance `_ns__local__cindy-simulator`;
no market release was published during local testing.

Final 0.3.33 results: **844 tests passed** and `git diff --check` passed. The live
browser scenario passed both before installation (source helper override) and
after installation (no override). Boli Duo used one 2816×4096 MJPEG connection
through all six zoom selections and three window sizes. Navigation count stayed
at the initial three; no resize or zoom navigated either page. The fixed backing
size and colored screen were confirmed at every step. A final 100% screenshot
showed the Settings icon, wallpaper and clock without the seed-only black screen.

Forge updated the existing local instance to 0.3.33. The original Boli Duo was
booted in standard mode and opened in this task's simulator tab; the receipt
reported `ready: true` and `previewOpened: true`. The installed viewer's automated
browser regression is recorded above; this revision did not force desktop focus
or claim a native trackpad gesture test.


## 0.3.34 Fit correction

The previous Fit formula divided by the whole stream extent. Its camera margins
made the phone unnecessarily small. The corrected controller divides usable
window space by the device/controls extent, scales the existing iframe and crops
its blank margins. Percentage sizing and the fixed 4096-pixel source are unchanged.
Fit clips overflow; percentage views retain scrolling. The controller centres
using fresh post-layout projected bounds and reserves its asymmetric bottom
padding, rather than centring the entire camera frame.

The controller regression checks repeated tall/narrow/wide Fit changes, asymmetric
control placement, usable toolbar space, no measurement drift and unchanged 100%
size. The helper regression checks bezel allowance and hardware anchors. The live
browser scenario additionally checks all projected bounds and each actual button
DOM rectangle stay inside the usable stage after repeated Fit resizing, with no
additional WebSocket or page navigation.

0.3.34 results: required suites passed **845 tests**; diff whitespace checks passed.
The source and then installed-browser runs both passed all six zoom selections,
three fixed-percentage resizes and three Fit resizes. Each used one 2816×4096
MJPEG connection, with no navigation after the initial three document loads.
The projected device/control bounds and all four button DOM rectangles remained
inside the usable stage, above the bottom toolbar. At a 540×1000 viewport the
Fit screen grew from approximately 159×231 CSS pixels to 393×570 CSS pixels;
the final screenshot shows the full body. These numbers compare the same device
and viewport, not a universal scale multiplier.

Forge updated the existing local instance to 0.3.34. The same Boli Duo was booted
in standard mode and reopened; `ready` and `previewOpened` were true. Actual
native trackpad gestures and arbitrary free-orbit/back-side poses remain outside
this runtime evidence. Device body extent is a bezel allowance around the screen
and hardware anchors, since the bundled metadata has no exact mesh silhouette.


## 0.3.35 First-frame calibration — 2026-11-06

Previously the decoded 3D canvas became visible immediately, while fitting waited
for a posture tick (700 ms) or delayed load/resize callbacks and an asynchronous
viewport read. The user saw the full-frame miniature, then the fitted device.

The stage now keeps its existing loading state and hides only the canvas and
hardware buttons until the first decoded frame has been fitted and centred.
First-paint and pose/geometry callbacks notify the same-origin controller
immediately. The default 300×150 canvas dimensions are not usable geometry.
Concurrent requests for the same document/device/panel share one viewport read;
the controller refreshes metadata after that read, rejects retired documents,
applies size and scroll centring, and only then reveals the picture. The helper
repositions controls before revealing. Errors remain visible while waiting.
The periodic tick remains a recovery fallback. Standalone pages without the
embedded controller do not wait for this handshake. No new host API or timer
is introduced, and the fixed stream is unaffected.

The new VM regressions cover metadata-before-paint, immediate notification,
no repeated notifications on ordinary paints, loading/error visibility,
idempotent reveal, detached panels, joined geometry reads and stale document
responses. All required suites pass **847 tests**.

Runtime testing uses a temporary Chrome context with local-network-access
permission granted only to the simulator's loopback origin. The first attempt
was blocked by Chrome's local-network access checks; no normal browser profile
or application setting was changed. The first-frame test samples every browser
animation frame, including an artificially delayed viewport response, and checks
that every visible painted frame already has the final Fit geometry. It also
counts viewport requests and 3D WebSocket connections.

0.3.35 runtime results: source-override and installed-package runs both passed
first opening with delayed geometry and a real page reload. Every sampled visible
paint already had the fitted 393px-wide screen (540×1000 test viewport); no
miniature frame was exposed. Both scenarios issued one viewport read and opened
one 3D stream. Decoded frames remained hidden behind the loading state while the
geometry response was pending. The initial loading duration still includes model,
video and viewport readiness; this change does not promise instant device startup.

Forge updated `_ns__local__cindy-simulator` to 0.3.35. The original Boli Duo was
booted in standard mode and reopened in this task, with `ready: true` and
`previewOpened: true`. Final checks: 847-test required suite, strengthened targeted
latest-metadata regression, and `git diff --check` passed. No market publication
or PR was performed.


## 0.3.36 Fold Fit responsiveness — 2026-11-06

The controller previously awaited the system viewport read when the lit panel
changed. Fit only needs the ratio between projected bounds and available space:
its logical-point basis cancels out. With an existing fitted view, it now follows
new pose metadata immediately and calibrates point dimensions in the background.
Initial layout and fixed percentage calibration retain the awaited read. Responses
for an old device, document or panel are ignored; concurrent reads are joined.

Pose notifications request a 180 ms cubic ease of frame size and centre. Each
retarget starts at the displayed size and normalized visible centre; the start
clock is captured before scheduling rAF so frequent metadata cannot starve the
motion. Manual zoom and iframe replacement cancel it. Reduce Motion bypasses it.
First-frame reveal remains immediate after calibration, without a scale animation.

Automated coverage includes held viewport promises, early Fit progress, concurrent
read deduplication, final centring, calibration without a size jump, rapid reversal,
stale responses, cancellation, reduced motion and first-frame notification options.

Runtime source test: same plugin-managed Boli Duo / iOS 27.1, standard memory mode,
headless Chrome at 540×1000 CSS pixels / DPR 2, same loopback viewer service. Only
the disposable test context grants loopback local-network access. Viewport reads
were deliberately delayed by 1.8 seconds. Closing began changing frame width
82 ms after the first pose metadata, opening in 65 ms; both followed intermediate
hinge angles and filled the usable window at rest. The first visible size change
threshold was 1 CSS pixel. One 3D socket remained throughout, with no navigation.
The native hinge animation itself still takes about a second; Fit now follows it
instead of waiting afterwards. This does not claim zero device/transport latency
or native WebView timing identical to headless Chrome.

The required repository suites passed: 848 tests, zero failures. Source runtime
startup regression also passed with a delayed viewport read and a warm reopen:
every visible first-frame sample was already fitted, one viewport query and one
3D stream per open. Forge updated `_ns__local__cindy-simulator` to 0.3.36; the same
Boli Duo was booted in verified standard memory mode and reopened in the task's
simulator tab (`previewOpened: true`). No device was recreated or erased.

Installed 0.3.36 also passed real closed→flat→closed and four rapid reversals
(120 ms between button presses), retaining one stream and unchanged navigation
count. First size changes followed pose metadata by 54 ms / 66 ms respectively;
final bounds filled the window. The largest frame-width step during rapid
reversal was 10.2%, with 145 sampled frames; deterministic tests additionally
verify no immediate jump when a motion is retargeted. The cold post-boot opening
received its first pose metadata about 0.6 seconds after the click; this native
command/metadata latency is distinct from Fit, which no longer waits for the
viewport query. Device left closed, matching its post-boot starting posture.
Installed-package startup regression passed both delayed geometry and warm reopen:
all visible first-frame samples were already fitted, with one viewport read and
one stream per open. No source overrides were used for installed-package runs.


## 0.3.37 Rotation Fit synchronization — 2026-11-06

The earlier rotation snapshot had fixed coordinates inside the iframe while Fit
resized and scrolled that iframe beneath it. The new embedded path places its
snapshot in controller coordinates and gives one 320 ms animation ownership of
angle, scale and centre. The hidden live stage can fit immediately on metadata;
its geometry is the snapshot's destination, followed by a 140 ms crossfade.
Intermediate diagonal bounds reserve bezel/toolbar space. The overlay is clipped
to the usable stage so its background cannot cover the bottom controls. Consecutive
turns reuse the displayed transform. Reduce Motion skips the overlay; fold changes,
iframe navigation, pagehide and panel detach clean it up and restore visibility.
The standalone Baguette viewer keeps its existing rotation path. No native/vendor
bytes, stream settings, device data or orientation input semantics changed.

Deterministic tests cover snapshot independence from live layout, uninterrupted
retargeting, final scale/centre alignment, diagonal Fit, reduced motion and cleanup.
Source runtime test used the same plugin-managed Boli Duo, iOS 27.1, standard mode,
headless Chrome/DPR 2 in light mode, at 540×1000, 1000×650 and 360×800 CSS pixels.
Left/right turns at all sizes remained inside usable bounds, with animated and
live screen dimensions/centres matching within 2 CSS pixels at crossfade. Four
rapid turns (right/right/left/left, 70 ms apart) completed and removed the overlay.
Reduced-motion turns created no overlay. One viewport query, one 3D stream and
unchanged navigation count were retained for the whole sequence. A trial that
also changed the color scheme observed the pre-existing background restart;
final rotation checks kept color scheme fixed to isolate rotation from that path.
These are real service/browser checks, not a claim of native WebView timing or
physical trackpad acceptance. Parent overlay snapshots contain only the temporary
viewer frame and are removed after use; no screenshot data is stored in the repo.

Required repository suites: 849 tests passed. After adding pagehide cleanup and a
nonnegative scale guard for collapsed windows, the 69 affected control/viewer/
orientation tests were rerun and passed. `git diff --check` passed. Forge updated
`_ns__local__cindy-simulator` in place to 0.3.37; the original Boli Duo was booted in
verified standard mode and reopened in the simulator task tab (`previewOpened:
true`). Its data and the separate marketplace plugin instance were preserved.

Installed-package rotation checks also passed in dark mode at all three sizes,
including rapid reversals and reduced motion. No source overrides were used;
one viewport query / one stream / unchanged navigation count remained. The live
stage was visible again after each overlay was removed. Source screenshots were
also visually checked during a diagonal turn; the installed dark-mode endpoint
was inspected after restoring the original portrait orientation.
Installed 0.3.37 also passed the earlier folding regression with the viewport read
delayed by 1.8 seconds, closed/flat transitions and rapid reversals, retaining one
stream and unchanged navigation count. Device left in its original closed portrait
posture, ready in the task's simulator tab.
