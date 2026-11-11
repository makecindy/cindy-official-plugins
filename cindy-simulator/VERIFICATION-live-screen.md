# Live Screen (phone view) verification — 2026-11-03

Plugin `cindy-simulator` 0.3.29 source (developed as `baguette-simulator` before
the rename merged from `main`), Baguette 0.2.10. Host: Cindy desktop dev build
from `makecindy/cindy` branch `dash/simulator-on-phone` (isolated profile) and the
Cindy mobile app from the same branch. Mac Studio M5 Ultra, macOS 27, Xcode 27.1,
iOS 27.0 simulators. Only test devices created for this work were started, shut
down or turned; no other task's devices were touched.

## Paths

- Worker side: top-level `liveScreen: true`; worker JSON-RPC `liveScreen.list`,
  `open`, `input`, `control`, `close`, routed before Agent dispatch and absent from
  `ghost.json` tools. `main.js` refuses any tool call named `liveScreen.*`.
  Older Cindy keeps the field as an unknown v3 field, so `minCindyVersion` is unchanged.
- Orientation: the interface orientation is read from Baguette's
  `describe-ui.json` over HTTP, never on the stream socket.
- Turning: `rotate-left` / `rotate-right` step a quarter turn (an iPhone skips
  upside down), `orientation-portrait` / `orientation-landscape` set an absolute pose
  so the phone can make the device follow its own. A requested turn shows once the
  picture visibly follows it (12 changed frames within 1.5 s); a probe confirms it.
- Input: consecutive moves of the same finger in one batch are sent as the latest
  position only; a run of keys is one keyboard process.
- Shutdown: a device shut down while shown is detected once its picture has been
  still for 4 s (one device list read at a time, abandoned after 15 s) and ends its stream.

## End-to-end on a phone simulator

A second simulator ran the Cindy mobile app on the live screen page. A script sent
touches to the phone simulator and timed the device's and the phone's frames
(tap Settings, Home Screen swipes, Safari scroll, 2 s slow drag; 3 rounds each).

| Action | Before (orientation probe on the stream) | After |
|---|---|---|
| Tap Settings, touch → device frame | 453–1136 ms, sometimes no reaction | 36–61 ms, opened 3/3 |
| Home Screen swipe | 468–521 ms | 89–156 ms |
| Safari scroll | 2.3–3.1 s, or lost | about 120 ms |

Isolated cause: a swipe sent while a `describe_ui` probe was pending on the same
stream reached the device after 1713–2032 ms (no probe: 69–267 ms; probe over HTTP:
86–106 ms). Phone → desktop 10–40 ms; device frame → phone picture 80–200 ms.

Also checked on the phone: rotate left/right and follow-phone in both directions
(the device's reported orientation changed as requested); touch positions in
landscape; Home, App Switcher; typing through the device's own software keyboard;
shutting the device down ended the phone screen and the phone showed the device is off;
restarting the plugin worker reopened the screen by itself.

A real iPhone (Release test build) viewed and operated the simulator over the relay;
it had the earlier latency, which the end-to-end runs above isolated and fixed.

## Tests

- `.tests/baguette/live-screen.test.cjs`: 23 cases, including the probe never sharing
  the stream with touches and a shut-down device ending its stream while a still
  running one does not.
- Before the rename merge: Device Simulator suites 1528/1528.

## Not verified

- Android emulator, iPad, Apple TV and Vision Pro on the phone (unit-tested only).
- iPhone Duo posture on the phone; Apple TV remote and Vision Pro spatial input
  (not offered on the phone).
- The packaged 0.3.29 `.cindy` installed in a released Cindy build.

# Viewing on another computer — 2026-11-11

Plugin `cindy-simulator` 0.3.43 source. Viewer: Cindy desktop dev build from
`makecindy/cindy` branch `dash/desktop-live-screen` in an isolated profile, with
this source installed from a local `.cindy` package. Provider: a released Cindy on
the same Mac Studio (macOS 27, Xcode 27.1) running one iOS 27.3 simulator
(`Cindy iPhone Air`) bound to the task. Both sides were on one machine and one
network; only that test device was started or turned.

## Checked in the task sidebar

- Without the plugin on the viewer, Cindy shows the notice and the entry that lead
  to this plugin's page; nothing of the device is drawn.
- With it, the task page opens by itself with `device=<computer>` and shows the
  controller (device chip, zoom, More, Home, screenshot, rotate, help) around the
  remote device at 1260×2736.
- Click opens an App; a held drag scrolls a list; the wheel sends two touches 80
  points either side with the touch indicators shown; Home returns to the Home
  Screen; rotate turns Safari to landscape and the page lays out 2736×1260.
- Screenshot to Desktop writes `<device name> <date time>.png` on the viewer.
- A stream that ends (the page hidden, the address renewed) reconnects on its own.

## Not checked

- Real two-finger trackpad contacts, Option pinch and pan, typing and paste were not
  exercised by hand: script-driven key events do not reach the device page. They use
  the same gesture modules as the local page (`.tests/baguette/remote-viewer.test.cjs`
  asserts the modules and the trackpad declaration are loaded).
- A viewer on Windows or Linux, Android, iPad, Apple TV and Vision Pro devices, two
  computers on different networks, dark mode and a detached sidebar window.
- The picture is re-encoded on the way; sharpness and latency were judged by eye only.
- With providers before the still-picture fix in the same Cindy branch, the first
  picture appears only once the device's screen changes.
