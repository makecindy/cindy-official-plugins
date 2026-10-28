# Screenshot export orientation — 2026-10-25

## User acceptance

On 2026-10-25, after installation of 0.2.28, Dash explicitly confirmed that
the changes in this task had all been tested in actual use and requested the
PR record that confirmation ("开PR,记得说下我都实测完了"). This covers the
reported screenshot orientation, task-switch orientation, clipboard latency
and durable Desktop/Clipboard selection. The measurements and automation
below are separate engineering evidence; their stated limits remain intact.

Source: plugin 0.2.24, branch `dash/simulator-screenshot-orientation`, based on
`64bbaf3`. macOS 27.0.1, Apple Silicon, Xcode 27.1 (27A9269), iOS 27.0,
Baguette 0.2.10. The installed Cindy plugin was not replaced.

## Runtime verification

Used the plugin's previously shut-down iPhone 11, launched Safari, and ran the
modified source worker's actual `dispatch('screenshot', {destination:'desktop'})`
path after confirming each orientation. Opened the exported PNGs to verify
upright text and the complete Safari screen, and checked PNG pixel dimensions:

| Orientation | PNG dimensions | Result |
| --- | --- | --- |
| landscape-left | 1792 × 828 | Upright landscape image |
| landscape-right | 1792 × 828 | Upright landscape image |
| portrait | 828 × 1792 | Upright portrait image |

These retain the iPhone 11's native pixel resolution. Exported files were moved
off the Desktop into the task's local artifacts. The test device was restored to
portrait/Home and shut down. Other tasks' running devices were not used.

## Automated verification

621 tests passed: plugin contract, localization, provisioning, publishing
workflows, and the complete simulator suite. Regression coverage includes all
four rotations, exporting after the Agent's density cache is populated, rotation
during capture, both export destinations, pre-export time-budget exhaustion,
uncertain writes and successful writes despite temporary-file cleanup failure.
The clipboard tests verify that the transformed PNG path reaches the pasteboard
command and is subsequently removed; they do not change the user's clipboard.

Forge validated and packed 0.2.24. Packaged installation and an embedded Cindy
button walkthrough remain unverified. Actual clipboard readback, upside-down
rotation, Duo, TV and Vision were not re-tested at runtime for this change.
Android's separate screenshot pipeline is unchanged.

## Task-switch orientation and startup follow-up

The task sidebar disposes its webview when switching sessions. The flat native
viewer previously always mounted portrait and waited for the stream's live
orientation response. It now restores a per-device visual orientation hint
synchronously after mounting, then reconciles with the same live response. The
hint never rotates the guest. Template, device metadata and hinge reads now
start together; physical-device and foldable views retain their existing paths.

Compared HEAD and modified `sim-native.js` against the same source Baguette
server, iPhone 11 and Chrome page, using a temporary localhost proxy to select
the script and sample rendered bezel geometry with requestAnimationFrame:

| Page | First rendered bezel | Subsequent pose |
| --- | --- | --- |
| HEAD, guest already landscape-left | portrait at 340 ms | landscape-left at 2923 ms |
| Modified, after prior live orientation read | landscape-left at 317 ms | no portrait frame in the 10-second sample |

The old page therefore displayed the wrong pose for about 2.58 seconds. On the
modified reload, template/metadata/hinge requests all started at 162 ms, compared
with 152/261/280 ms for HEAD. These are single-run local observations, not a
general loading-time benchmark. The screenshot confirmed the landscape bezel;
the test proxy showed no decoded video frames, so this comparison measures
layout and orientation only, not time to live video. Actual Cindy task switching
with an installed build remains unverified.

Regression tests cover all four cached poses, per-device isolation, invalid or
unavailable storage, live correction, no implicit rotation writes, independent
startup reads, and skipping the flat hint for physical/foldable devices. The
updated vendor patch applies to the pinned upstream file, inventory verification
passes, and Forge successfully repacked 0.2.24 with both fixes.

## 0.2.25 installed follow-up: preserve the viewer pose

The 0.2.24 check above covered Safari, whose interface follows device rotation.
It missed portrait-only screens: on the same iPhone 11 Home screen, setting
landscape-left succeeded but the live AX screen still reported portrait. The
later read consequently undid the restored bezel pose. This supersedes the
earlier assumption that reconciling the bezel with AX always preserves what the
user selected.

0.2.25 keeps a known viewer pose across reloads and stream reconnects. Only an
unknown pose is initialized from AX; a manual turn supersedes any pending read.
The screenshot button passes the visible flat-view pose through the controller
and worker to the native-resolution renderer. Actual screen geometry is still
checked before/after capture, and foldable/TV/Vision paths retain native geometry.

Forge packed and installed 0.2.25 by updating the existing local instance
`_ns__xd__baguette-simulator`; no publication or second installation was made.
In the running Cindy personal client, opened this task's iPhone 11 sidebar,
pressed Rotate Right on Home, navigated to another task (confirmed the simulator
control frame was destroyed), then returned. All 21 observations from the
recreated page through the next 10 seconds remained landscape-left. A desktop
capture of Cindy confirmed the live Home screen inside the landscape bezel.

Pressed the installed sidebar's screenshot button. It reported success and
exported a 1792 × 828 PNG matching the sideways Home screen in the bezel. Moved
this test export from Desktop to local task artifacts. This test device remains
available in the task sidebar; other tasks' devices were not rotated or stopped.
Actual clipboard readback and native pixel sampling of video startup time remain
unverified. No claim of eliminating video connection latency is made.

623 tests passed in the complete gate, including saved-pose precedence,
portrait-only AX responses, late reads after a full turn, frontend screenshot
pose forwarding (including folded hinge=0), all export rotations and live
screen-change rejection. Vendor inventory and upstream patch dry-run passed.

## 0.2.26 installed follow-up: clipboard latency

Profiled the same iPhone 11 flat landscape screenshot path. In 0.2.25 a cold
source-worker call took 3070 ms: AX geometry 1351 ms, screenshot 512 ms,
post-capture input/geometry confirmation 623 ms, render 163 ms and pasteboard
write 138 ms (plus device/platform preflight). The installed sidebar button took
3015 ms from click to its successful clipboard notice.

Flat exports now capture one original-resolution PNG and rotate it to the
button's explicit viewer pose, using that PNG's own pixel dimensions. They do
not query AX or open an input session: those checks serve coordinate planning,
while this operation exports a single coherent framebuffer and plans no input.
Agent screenshots and exports without an explicit flat pose retain their
existing geometry/panel checks. Capture, render and final clipboard write still
share the original deadline, and partial temporary files are removed on failure.

Forge packed and updated the same local instance to 0.2.26. Source-worker
profile: 1469 ms; installed sidebar button: 992 ms from click to successful
clipboard notice. Read the resulting PNG back from NSPasteboard, confirmed
1792 × 828 pixels and visually verified the complete sideways Home screen.
These are local single-run timings, not a cross-device performance guarantee.
The test device remains in this task's sidebar with Clipboard selected.

624 tests passed in the complete gate. Regression coverage verifies all four
viewer rotations, native scale after warming the Agent density cache, no AX or
input probes, unchanged Agent/panel verification, capture/render cleanup,
one transient read retry, expired deadlines and export execution outcomes.

## 0.2.27 installed follow-up: render directly into the pasteboard

Flat-view clipboard exports now encode the rotated native PNG and write it to
NSPasteboard in the same AppKit process. There is no intermediate rotated file
or second AppleScript process. Encoding finishes before the pasteboard is
cleared. The command is marked as a mutation; missing/malformed success receipts
are uncertain writes and are never retried. PNG byte counts are converted from
JXA's NSString-like numeric return values before validating the receipt.
Desktop, Agent and non-flat screenshot paths retain the previous behavior.

Alternated the installed 0.2.26 core and modified source on the same booted
iPhone 11 Home screen, three pairs in one run:

| Pair | 0.2.26 | 0.2.27 source |
| --- | --- | --- |
| 1 | 645 ms | 543 ms |
| 2 | 639 ms | 539 ms |
| 3 | 645 ms | 555 ms |

The medians improve from 645 to 543 ms (about 16%). Each pair produced the same
PNG byte count. These are core-dispatch timings, not button-to-notice timings;
they must not be directly compared with the previous session's single-run
992 ms sidebar measurement, because machine load and the measured path differ.

626 tests passed in the complete gate. Forge packed and updated the same local
instance `_ns__xd__baguette-simulator` to 0.2.27. Its authenticated screenshot
control endpoint (the endpoint used by the button) completed three requests in
655, 637 and 589 ms. Read the resulting PNG from the actual system pasteboard:
1792 × 828, 1,851,272 bytes, complete sideways Home screen. The actual embedded
button timing was not completed: the main window moved to Settings and its
task webview was no longer mounted. Testing continued through the installed
endpoint without navigating the user's window again. No additional instance or
marketplace publication was created.

## 0.2.28 installed follow-up: durable screenshot destination

The Desktop/Clipboard selection now saves to the existing runtime settings
file outside the plugin installation directory. Apple and Android controller
bridges share the same preference and validation. Changing the idle/run settings
preserves it. The page restores it from status even with no localStorage, waits
for a successful save before changing the selection, and prevents a late status
response from undoing that save. A failed save retains the previous selection.

629 tests passed, including both destinations across fresh runtime instances,
unrelated settings changes, invalid values, failed disk writes, no device
operations when saving, empty browser storage and late status responses.
Forge packed and updated the existing local instance to 0.2.28. Immediately
before installation, the actual embedded page reported Clipboard selected.
After installation, saved that existing selection through the installed,
authenticated control endpoint and received `execution: executed`. A separate
fresh Node process loaded the installed runtime and the real settings file,
recovering `screenshotDestination: clipboard`, `enabled: true`, `idleMinutes: 15`.
The host app was not restarted; the final task webview was not mounted, so its
visual restore was covered by the controller regression test rather than a new
embedded-page walkthrough. No host partition or app-wide storage behavior was
changed. The preference survives ordinary plugin replacement because its file
is outside the replaced package, using the existing settings persistence path.

## 0.2.29 review follow-up: fallback capture failure cleanup

The native fallback (no explicit viewer orientation) uses the Agent screenshot
pipeline. Its raw capture and post-capture geometry read previously ran before
the cleanup block, leaving a partial raw PNG when either failed. Cleanup now
covers the full operation, including capture retries and geometry validation;
errors also remove partial rendered output while preserving the original error.
Successful captures retain their exported file and unchanged image processing.

The regression test first failed against 0.2.28, then passed after the fix. It
covers Agent and native fallback entry points for double capture failure,
post-capture geometry failure, stale geometry and partial renderer output.
Forge validated and packed 0.2.29. This follow-up changes failure cleanup only;
the 0.2.28 installed/user acceptance evidence above remains applicable to the
unchanged successful screenshot, viewer and preference paths. 0.2.29 was not
installed into the user's running client during this scheduled review.
