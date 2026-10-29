# Continuous physical input feasibility — 2026-10-29

The requested behavior is touch-down immediately, successive movement while
the same contact stays down, then release. Dispatching a complete XCTest path
after release does not meet this requirement, regardless of completion speed.
At the time of this initial investigation, installed package 0.3.9 used that
deferred path. The subsequent 0.3.20 integration replaces interactive viewer
input and video; see physical-verification.md for installed-device evidence
and remaining acceptance boundaries. The experiment below is historical.

## Hardware experiment

- Current target: task-selected iPhone Air, iOS 27.2, paired local-network
  CoreDevice tunnel on the Mac. No other phone was operated.
- Tested official PyPI `pymobiledevice3==11.47.0` in an isolated temporary
  Python 3.12 environment. It is an experimental external dependency, not
  included in the plugin package. Sources:
  <https://github.com/doronz88/pymobiledevice3> and its
  `remote/core_device/hid_service.py`, `display_service.py`, `screen_stream.py`.
- The device advertises Universal HID and media streaming. An explicit native
  paired-tunnel connection successfully started video on display 1 and received
  media packets. A screenshot request during a held contact did not complete;
  canceled the bounded experiment manually, sent release in finally, and
  confirmed media sessions were empty. Do not use this request as live feedback.
- A separate password-protected loopback-only upstream viewer supplied decoded
  HEVC frames in headless Chrome. Clipboard endpoints were blocked in the test
  browser. Home was used to leave the user's foreground app/folder before the
  drag; no account, message, payment or system preference was modified.
- Browser pointer-down sent a contact at normalized (49807,36044). Ten movement
  samples moved left to (32768,36044). A browser screenshot taken before any
  release shows the actual home-screen icons between pages. Movement back to
  (49807,36044), still without release, returned the icons toward their original
  positions. Only then was a release sent. The request log confirms no earlier
  release. This establishes actual incremental device touch, not an overlay or
  completed-swipe replay. Upstream browser counter displayed roughly 50–58 fps;
  this is not glass-to-glass latency or installed Cindy sidebar evidence.
- The original upstream viewer duplicates movement requests through canvas and
  document handlers. Reusing its UI directly would preserve a known defect and
  would replace the requested simulator UI; neither is the intended integration.
- The three-minute experimental server shut down and a fresh media status
  query returned running=false, sessions=[]. Original installed 0.3.9 control
  still reports ready. No persistent service or public listener was installed.

## Integration constraints established by the experiment

- Replace interactive viewer input with persistent contact reports. Keep the
  existing phone shell, toolbar, zoom and pointer-to-screen mapping. XCTest can
  remain for accessibility/automation; its completed-path route is not a
  substitute for interactive input.
- Pair input with continuous video to observe intermediate contact state.
  Transport and decoder queues must stay bounded and favor current frames.
- Keep pairing/device identity checks and release contacts on cancellation,
  view closure, disconnect, device change and geometry change. Never replay an
  old gesture after reconnect or silently fall back to deferred input.
- Upstream native RSD shares Apple's tunnel and documents connection eviction
  risk with remoted. Its userspace USB transport did not find this Wi-Fi-only
  Air through usbmux. Product integration must establish a reliable transport
  with the existing CoreDevice queries, rather than assume one short test proves
  long-running coexistence.
- Upstream stop uses stop_all=True and returned media status lacks an obvious
  per-session token. Product teardown must not terminate another client's stream.
- Upstream audio_default_on=False suppresses browser autoplay but still starts
  device audio internally. A viewing/touch implementation must explicitly omit
  audio startup unless needed; no audio artifact was saved in this experiment.
- Upstream has extra clipboard, style and accessibility mutation endpoints;
  product integration should expose only reviewed functionality through the
  current authenticated viewer, not forward the whole experimental server.
- Do not bundle a machine-specific temporary Python path. A production runtime
  needs pinned, reviewed and reproducible dependencies within package limits,
  license notices, and lifecycle tests. The upstream package is GPL-3.0-or-later.

Temporary local evidence: `tmp/simulator-real-devices/hid-video-input.log`,
`hid-video-held.png`, `hid-video-return-held.png`, `hid-video-probe.log`.
These contain real device content and are not included in the repository.
