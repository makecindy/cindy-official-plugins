# tvOS and visionOS input adapters

The plugin uses the same owned CoreSimulator device set and run permission as
its iOS tools. These helpers do not launch an app, install software, contact a
network endpoint, read credentials, or inject code into the guest app process.
They accept a UUID, resolve it only in the specified device set, require a booted
device, and serialize input with the existing per-device keyboard lock.

- `remote.m`: tvOS DTUHID messages to the fixed guest service
  `com.apple.coredevice.feature.remote.hid.digitizer`. Protocol reference:
  [facebook/idb](https://github.com/facebook/idb/tree/1de1629a8e5e9838d841689e122d0bd0085a92b6),
  MIT; license included in `THIRD-PARTY-LICENSES.txt`. Only bounded keyboard,
  consumer-button and keyboard-sequence payloads are accepted. A guest barrier
  reply confirms the final release; transport failure is not reported as success.
- `trackpad.m`: native Siri Remote continuous contacts through SimulatorKit's
  `IndigoHIDMessageForTrackpadMoveEvent` and `SimDeviceLegacyHIDClient`, dedicated
  target `0x16`. Began/changed/ended masks follow the same pinned MIT idb reference
  above. No Apple binaries are bundled. Opening a TV view prepares its connection;
  only active contacts hold the existing keyboard lock. The Node worker owns the
  helper's stdin; EOF, malformed input, SIGTERM, or 750 ms without an active-contact
  update releases the finger and closes the helper. Contacts are capped at 20 s
  and 2000 samples. Idle connections wait on stdin without polling the simulator.
  Every sample uses the existing viewer origin, capability and run-permission
  checks. Ownership/platform is established on opening; subsequent samples must
  match the live gesture ID instead of rediscovering the device per frame.
  The stage coalesces only pending absolute positions, lifts after 100 ms without
  wheel events, and ends on blur, hidden page, stream loss or page exit. Clicks and
  keys wait for finger release. OS wheel acceleration/momentum and inferred
  finger-up mean this is not an exact hardware timing/feel replica. Game-specific
  remote gesture behavior remains unverified.
- `spatial.m`: Paloma gaze, single/two-hand manipulation and camera messages through Xcode's existing
  `SimDeviceLegacyHIDClient`. Layout inspected from the installed Xcode 27
  VisionDeviceKitExtension; no Apple library or executable is redistributed.
  The current camera pose is read from the fixed guest `com.apple.vhmdd` service.
  Image coordinates become a 90-degree horizontal-FOV ray, transformed by that
  pose. A single-hand gesture presses the left pinch/contact; two-hand gestures
  move two mirrored hands, changing their separation and angle. Camera controls
  send Paloma pose event 300 **and** update the service pose; updating only the
  service leaves the rendered camera unchanged and makes later selections miss.
  Tilt rotates in place, pan/dolly/move translate in camera space, and orbit uses
  a pivot one metre ahead. Reset returns to the identity pose. Relative pointer
  collections use SimulatorKit's mouse service and IOKit events; leaf motion
  events are wrapped as collections before forwarding. Mouse service is removed
  when its helper closes. These events reached a guest `GCMouse` handler.
  The continuous helper reuses the trackpad manager's ownership/acknowledgement
  lifecycle, keyboard lock, EOF/750 ms release and viewer origin/capability/run
  checks. The 20 s/2000-sample cap applies to spatial gestures; relative pointer
  capture stays active until release or cancellation. Pointer cumulative x/y
  offsets use 1000 pixels per unit and a separate finite +/-1e9 bound, while
  other modes keep their +/-10 coordinate bound. Browser motion coalesces but
  mouse button transitions remain ordered within the same gesture; partial
  release retains the remaining buttons. Both TV and Vision controllers own
  every unfinished contact, discard all queued motion/starts on cancellation
  or failure, and notify queued discrete input of cancellation. Loss of focus,
  visibility, stream or page uses that same cancellation path. Failure never
  replays an uncertain input.
- The helpers load system CoreSimulator and SimulatorKit from the selected Xcode,
  following the existing keyboard helper. Rebuild all helpers with `sh build.sh`;
  outputs are arm64, macOS 15 minimum, ad-hoc signed and signature-verified.
- Protocol compatibility was exercised on macOS 27.0.1, Xcode 27,
  CoreSimulator 1174.9.2, tvOS 27 and visionOS 27. Older/newer combinations are
  unverified. These are private Apple protocols and may change; missing service,
  missing symbols or invalid camera pose fails the operation. Treat an uncertain
  delivery as unknown and observe before retrying.

## Scope and verification

Apple TV has a rectangular stream and remote navigation; Vision Pro has a
rectangular stream, gaze, pinch/hold/drag, depth dragging, two-hand scale/rotate,
camera navigation, keyboard/pointer capture and recording. OCR is available on
both; accessibility trees and IDs are not. Orientation, fold posture, status-bar
override, accessibility scroll-to and heal are not offered on these platforms.
This implements simulator input, not physical hand tracking. Standard gamepad
navigation uses left stick / triggers / right stick for translation, elevation
and orientation, combined in one camera pose. It consumes input only with the
display focused and visible; neutral sticks are required after uncertain input.
Physical gamepad testing is pending. SharePlay participants and scene/immersion
configuration are outside these input controls. Capture is subject to the focused
host browser's support; installed Cindy capture acceptance is pending.

The original TV/Vision adapter tests used disposable devices under `/tmp`;
the default Xcode set was not touched. Native simulator apps were built, installed and
launched for both platforms. TV remote selection changed an app counter, and keyboard events reached a focused text field.
The tvOS runtime rejects simctl pasteboard access; auto typing therefore uses
US-keyboard events and rejects unsupported text before clearing a field. Vision left,
center and right buttons were selected and a coordinate-reporting app confirmed
ray projection against screenshot coordinates. Agent screenshots and OCR were
exercised on both. The local browser preview displayed both live streams; its
TV remote and Vision canvas click reached the test apps. Vision keyboard and
clipboard paste also reached a focused field. The controller was inspected at
desktop and 320/390-pixel widths, including the dark CSS theme (forced in the
test page without changing host appearance). Immersive-app coverage remains unverified.

The Vision controls follow [Apple's Device Hub interaction guide](https://developer.apple.com/documentation/xcode/interacting-with-your-visionos-app-in-device-hub)
and the Xcode 27 Device Hub action bar, including its orbit control. On 2026-10-23,
the plugin's idle development Vision Pro was used for a separate SwiftUI probe
(`.tests/baguette/VisionControls.swift`). Browser input through the real controller,
API and native helper produced taps, a 112-point drag, 1.8x magnification and a
28.8-degree rotation. All four camera modes changed the pose and rendered view;
reset restored identity. WASD navigation and recording/download succeeded.
Both a translated and a rotated camera were followed by successful selections
at the newly observed coordinates (the rotated case used Agent OCR and `tap`).
Relative mouse motion (100, -100) and button release reached guest GCMouse.
The controller rendered at 1100 and 320 pixels in both light and dark modes.
The 217 spatial API responses in the main browser run all confirmed delivery.
A standard-gamepad browser fixture also moved and turned the real camera;
this does not attest a physical game controller. Native EOF, malformed input,
SIGTERM and 750 ms inactivity released held input before a subsequent tap.
Planner and lifecycle tests cover invalid/bounded inputs, deadlines, quick
clicks, coalescing, mode/depth stability, input failure and focus/page/stream loss.

On 2026-10-23, the actual controller and compiled trackpad helper were exercised
against a 30-item native SwiftUI tvOS list in the disposable device set. From
focus 0, a 55 CSS-px downward gesture reached item 1; a 220 CSS-px gesture reached
item 4 (500 ms and 150 ms input sequences), and an upward gesture returned to
item 2. All 50 contact API responses confirmed delivery. Page exit released the
contact; native EOF, malformed input, SIGTERM and the idle deadline each exited
and allowed the next remote key to acquire the lock. The test used browser input
through the real controller/API/native stack, not direct App focus assignment.

This is not stable/Beta Cindy package acceptance. Installing the final `.cindy`
and exercising its host preview on a supported production or Beta Cindy remains
required before release.

Input follow-up: the stage bounds its existing key/click/paste queue to 16
outstanding operations. Blur, hidden page, stream loss, page exit, queue overflow
and uncertain input discard unsent operations; nothing is replayed on returning.
The remote and spatial helpers handle SIGTERM/SIGINT by ending an interruptible
hold, sending release, waiting for delivery and exiting unsuccessfully. Their
existing Node command timeout now requests SIGTERM; other commands retain
SIGKILL. Cancellation remains unknown even when the release is confirmed.
Rectangular zoom uses the same simctl screen geometry as Agent observations,
including UI density, instead of an unavailable phone definition.
