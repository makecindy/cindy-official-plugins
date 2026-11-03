# Physical device support — 0.3.21

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

## Historical verification (0.3.1)

The record below describes that earlier implementation; its screenshot/gesture
transport and pending Air input checks are superseded by the 0.3.21 evidence above.

# Physical device support — 0.3.1

2026-10-28. Scope: shared device discovery, management/task pages and a physical
XCTest control backend. No changes to existing simulator native binaries.

## Interaction follow-up (0.3.1)

- The physical page now serves the same controller HTML/JS/CSS as simulators:
  device switching, zoom, Home, screenshot destinations, keyboard toggle and
  controls help. No separate Connect/team-ID form or text-entry footer remains.
- Selected-device viewing/capture uses CoreDevice's active integrated display,
  independent of runner/signing state. A fresh capture of the active Duo inner
  panel succeeded before starting any control runner in the test process.
- A connect request without teamId automatically selected the team of the
  installed runner and reached ready with the final patched native source.
  Public certificate OU metadata was matched against valid signing identities;
  no private key or account credentials were exported.
- Real headless Chrome loaded the current viewer with the physical phone's
  screen at 800×900/dark and 320×640/light. Checked common toolbar, zoom menus,
  absent ID form, no horizontal overflow and no page exceptions. This is browser
  integration evidence, not native Cindy trackpad-feel acceptance.
- Browser input regression with intercepted device APIs passed first-click
  preparation without replay, view-point mapping, Unicode keyboard input,
  disabled-keyboard gating and Option two-contact paths. These checks sent no
  input to the phone.
- During a separate real input check the foreground changed from the probe to
  another app, then the runner connection refused requests. Testing stopped
  and the owned runner was disconnected. A successful touch receipt is not
  counted as proof of visible input to the probe. Unicode/pinch acceptance on
  the phone remains pending.
- 0.3.0 was installed in Cindy earlier in this task. The follow-up installation
  result is recorded in the conversation's Forge receipt; no marketplace release
  or Git publication has been performed.

## Runtime evidence

- macOS / Xcode 27, paired iPhone running iOS 27.2, CoreDevice network tunnel.
  Test data/builds used an isolated directory outside production plugin state.
- Discovered physical phones with stable CoreDevice UUIDs, connection state,
  device type, developer mode and private tunnel address. Public listings omit
  hardware UDID and network endpoint.
- Built and signed pinned WebDriverAgent v15.1.6; installed the runner through
  Xcode and reached its status/session endpoints on the CoreDevice IPv6 tunnel.
  The initial IPv6 binding failure was diagnosed from Xcode test logs; the local
  CocoaAsyncSocket patch preserves bare IPv6 addresses. The patched runner
  subsequently reported ready. Unused MJPEG listener is disabled.
- Final lifecycle implementation: explicitly disconnected an active runner,
  then started setup and cancelled it. The receipt reported disconnected and
  a process read-back found no remaining Xcode build/test process for that run.
- Installed a separately signed probe `.app` using the physical app tool. The
  install receipt reported done and returned its bundle ID. Launch, Home and
  swipe requests received successful XCTest acknowledgements.
- Initial WDA screenshot read the inactive primary/outer Duo panel, returning a
  black 466 × 678 image while the inner panel was active. After the user unlocked
  the device, CoreDevice display inspection established display 1 inactive and
  display 2 active (669 × 951 points, rotation 180°). An explicit display-2
  CoreDevice screenshot showed the probe app's visible menu, confirming launch
  and the display-selection diagnosis.
- The native patch now targets the selected display for screenshots and touch/
  text records. Host geometry comes from the active integrated CoreDevice
  display; display identity participates in stale-coordinate checks. With one
  foreground non-system app, accessibility explicitly selects it, avoiding the
  inactive panel's SpringBoard. Multiple foreground apps retain WDA detection;
  multi-window accessibility remains unverified.
- Built the final display-targeting and text-redaction patch successfully with
  Xcode 27 after isolating compiler include variables, disabling explicit
  modules and keeping upstream warning-only diagnostics nonfatal. Before its runner could start,
  the phone auto-locked and Xcode waited for unlock; the first bounded setup expired. A later final-build launch also encountered
  device auto-lock.
  Therefore visible touch and Unicode entry after this fix remain pending. The
  prior successful input acknowledgements are not claimed as visible success.
- Device log collection failed with macOS exit 77, “Must be root to collect logs
  from attached device”. The adapter now reports DEVICE_LOG_PERMISSION without
  attempting elevation. No claim of successful log retrieval.

## Automated verification

The repository suite includes physical-device cases for discovery and tunnel
validation, rejecting simulator lifecycle writes, preserving real phones during
global stop, cancelling setup through its held lock, stale-coordinate rejection,
Unicode payload preservation, observation failure retaining input outcome,
loopback viewer origin/token/device checks, lost-response execution uncertainty,
and keeping the worker alive only for actual physical control. Existing mocked
simulator fixtures explicitly supply an empty physical backend to remain isolated
from attached host hardware.

Follow-up verification: **759 tests passed, 0 failed**, including 15 physical
tests. After additional controller regressions and help/viewport changes,
the targeted 65-test suite passed. Coverage includes view-only capture without
signing, active-panel selection/temporary-file cleanup, automatic team choice,
the shared controller and disconnected-phone presentation.

Required suite:

```sh
node --test .tests/plugin-contract.test.mjs .tests/localization.test.mjs .tests/provisioning.test.mjs .tests/publish-workflows.test.mjs .tests/baguette-simulator.test.mjs
```

## Remaining acceptance

- Keep the connected test phone awake/unlocked and verify patched screenshots, tap,
  Unicode input, swipe, drag, pinch/pan and post-input screenshots.
- Verify the updated package in the actual Cindy task sidebar, device switching
  and native trackpad feel. Browser viewport evidence does not replace this.
- USB-only transport, iPad, older Xcode/iOS, portrait/landscape changes and network
  reconnection remain compatibility gaps. Do not describe them as hardware-tested.
- The physical viewer uses periodic screenshots and completed gestures. Native
  trackpad contacts are collected but sent after release; this does not provide
  simulator streaming latency. Android hardware is excluded.
- Runner/probe apps installed for testing remain on the phone. Disconnect leaves
  phone apps/data intact; local runner build artifacts are retained for diagnostics.
