# Device Simulator

The live sidebar's Add Device dialog also offers iOS memory modes. Successful creation selects the new device through the existing switch flow and updates the current task binding, keeping the source device running and the new device off until explicitly started. The selected mode carries into that device's startup picker. A failed selection is reported separately from completed creation; it does not replay creation.

New-device sheets offer Saving (default), Standard and Minimal for iOS runtimes only, with the same tradeoff descriptions as the startup picker. After creation, the existing page-local choice is assigned to the new device for its next explicit boot; creation does not start it. Reloading the page clears this choice, as with existing startup selections.

Restart & apply now completes shutdown and startup as one worker operation. Task and management refreshes retain the controller during restart, so an intermediate off state cannot interrupt applying the selected memory mode.

The Chinese saving-mode label is shortened to “节省” throughout the GUI; its behavior and `saving` identifier are unchanged.

The memory-mode dialog offers Restart & apply after selecting a different mode, or Restart simulator for the current mode. Selection alone keeps apps running. Restart closes current apps, preserves apps and data, and boots the chosen mode only after confirming the exact device has shut down.

The viewer shows its memory mode in parentheses after memory usage, without a separate mode row. Only the mode text is underlined; the parentheses are plain. Click the parenthesized mode to change it; pending changes remain identified as taking effect after restart.

0.2.43 fixes the blank Chinese viewer caused by missing mode/resource elements in its HTML template. Controller tests now derive elements from both shipped templates and verify screen loading in standalone and embedded views.

Device rows use three lines at the default width: name, model and OS, then resource usage. Only More remains beside the name; “Go to Related Task” is in the context/More menu, and memory modes are viewed and changed in the simulator view. Task activity is available in the device icon's tooltip. Full names and metadata remain available on hover; task navigation and selection behave as before.

List rows keep the OS version beside an ellipsized model name. Resource readings may wrap in very narrow panes to remain readable. The More button reserves its space so hover and selection do not shift text; touch devices show it without hovering.

Each mode's introduction directly states its tradeoffs: Saving disables some services, Standard typically uses more memory, and Minimal may affect login, purchases, photos, push and game services. These remain visible below the picker without opening the info dialog.

Device rows use familiar list selection: click to view one device, ⌘/Ctrl-click to add or remove a selection, and Shift-click to select a visible range. There is no selection mode, checkbox or batch toolbar. Right-click a selected row to operate on the selection; right-click an unselected row to target only that device. The row’s More button opens the same menu. ⌘/Ctrl+A selects current search results; arrow keys move through rows, Shift extends the range, and Escape clears selection. The menu reports selected devices hidden by search. Batch shutdown skips devices already off. Shutdown and deletion confirm the exact devices, then run sequentially; successful devices are deselected and unfinished devices remain selected. Uncertain outcomes stop the remaining batch without automatic retries. Modifier selection and context menus preserve the current preview.

Device metadata and list rows show disk usage inline, plus memory while running. There is no resource card or refresh button. Memory is cached for 15 seconds, disk for 5 minutes; off devices reuse readings for 5 minutes. Only visible rows and the selected device request readings, sharing pending work with at most two reads per page at a time. Switching devices reuses cached values; failures preserve previous readings and retry automatically. Hover over a reading for its scope, sample time and stale status. Caches remain in process memory only. Drag the divider between the device list and screen to resize it horizontally or, in narrow windows, vertically. List width and height are remembered independently. The matching arrow keys adjust the active dimension; double-click or Enter resets it. Resizing preserves the current screen. Memory estimates the device process tree (macOS physical footprint; Linux RSS, which can repeat shared pages), excluding shared simulator services and the viewer. Disk shows allocated blocks in the device directory, including app data and snapshots, excluding shared OS images/SDKs; it is not a promise of space freed on deletion. There is no disk polling while the device view is hidden, device startup or idle-timer renewal. Unavailable readings show a dash with an explanatory tooltip, not zero; Windows measurements are currently unsupported. See [verification and remaining gaps](VERIFICATION-memory-gui.md).

The live view and device lists show the current iOS memory mode, including devices started by the Agent. Click the mode and choose a new profile while the device is running. Only after a different profile is chosen does the panel explain that it takes effect after a restart; the badge distinguishes the active and pending modes. Choosing or inspecting a mode sends no device command and keeps the current screen. The existing per-page device choice is reused on the next explicit boot from that page; it is not a saved global device preference and does not carry across page reloads or different viewer pages. Status reads verify active service overrides; if verification fails, the UI shows “Unconfirmed” instead of assuming the default. Running iOS entries in `devices` also include this `memoryMode` evidence.

iOS startup now offers `saving` (default), `standard`, and `minimal` memory modes in every start UI and `device action=boot memoryMode=…`. Saving keeps the nine categories tested previously but disables search, health, some game services and diagnostics/DeviceCheck; minimal also affects account, payment, photo, push and other system integrations. Use standard for full acceptance and affected features. A new profile takes effect on the next cold boot; booting an already running device never restarts it or silently changes its mode. Read `memoryMode.mode`, `verified` and `limitations` in the boot result. Service overrides persist across shutdown; each new cold boot without a mode applies saving. Other platforms are unchanged. No fixed memory saving is promised.

[简体中文](README.zh-CN.md)

0.2.32 borrows input and presentation lifecycle ideas from [NeoSimulator](https://github.com/lynnswap/NeoSimulator), implemented in the existing browser viewer. More → Computer keyboard input toggles guest keys/paste on iOS and Android, remembered per device in this browser; touch, Agent tools, toolbar shortcuts and workbench fields keep working. Pending Apple viewer keys are dropped on window blur/page hide and attachment listeners are removed on detach. Apple viewer input now uses the existing delayed soft-keyboard cleanup as Agent input does; it does not guarantee that iOS immediately shows its keyboard. Expanding advanced tools changes the current page layout without restarting its stream or recording. `environment.diagnostics.keyboard` checks the selected Xcode's native keyboard interfaces without connecting to a device or sending input; it does not certify runtime input delivery or detect another display host. No global Xcode preferences or additional permissions are changed. Moving an entire Cindy panel between host windows still requires separate host-level acceptance.

0.2.24 separates Apple metadata reads from whole-bundle verification using the existing install jobs. Completed verification is reused only after checking every entry in both bundle trees, including ctime; source/container changes, expiry or worker restart invalidate it. Version/executable hashes alone never prove resource equality. Install/status results expose real phases and suggest an interruptible 85-second wait. Input observation has a separate short budget; viewer failure attempts independent capture without relaunching the App. Screenshots report capture time and attachment status. See the workflow manual and [performance replay report](../docs/simulator-performance.md) for verification scope and measurements.

0.2.21 integrates Android with upstream main e13abcd (#199), retaining Apple TV/Vision Pro input and keeping Android on the handheld screen/rotation path. Dash reconfirmed the prior 0.2.14 Beta acceptance on 2026-10-24. Subsequent package testing is not claimed; maintainers can assess that acceptance alongside the technical checks.

0.2.20 unifies touch, text and hardware/sensor RPC dispatch evidence at one per-operation boundary. Synchronous first-request budget/validation rejection stays not_executed without cleanup writes. Started requests retain unknown on later failures; touch release, long-key release and shake restoration run only after dispatch. Existing ADB installation evidence and all platform behavior remain intact. No new queue, retry, lock or recovery mechanism.

0.2.21 corrects the Agent input descriptions: touch-menu paste supports iOS and Android focused fields with an available paste menu; only iOS performs hardware-keyboard record cleanup. Input implementations are unchanged.

One plugin (`baguette-simulator`), one device manager and one task-sidebar controller for both platforms. Devices belong to this plugin; Android Studio and Xcode default devices remain separate. The run switch, task bindings, idle shutdown, live screen, touch input, keyboard, screenshots and device switching share the same workflow. Requires Cindy 0.1.116 or later with the declared task-view capability.

## Android setup and use

Android supports Apple Silicon/Intel Mac, Windows x64 and Linux x64. Enable hardware virtualization; Windows needs a working emulator hypervisor and Linux needs usable KVM. Open plugin settings → **Set up Android**. Existing SDK components are reused. Missing components come only from Google's official Android repository: the dialog shows each component, total compressed bytes and SDK licenses before the user checks consent and starts installation. The installer verifies the catalog checksum, safely extracts to the plugin directory, reports progress and keeps running if the dialog closes. No Android Studio or Java is needed just to run these devices; building apps remains the project's responsibility. Setup does not change system virtualization settings or replace an existing SDK.

Call `devices` first and choose `platform: android`. For a new device, `environment` returns Android Phone/Tablet and compatible installed runtime identifiers; pass those to `device action=create`. Boot, install a built **single APK** with an absolute `appPath`, poll the install job, then launch its Android package ID. `info` compares the full APK SHA-256 to the installed base APK. Identical APKs are skipped; changed APKs get a full reinstall preserving data where Android/signing permits. AAB and split-APK installs are not supported.

The controller streams the official emulator screen and sends actual touch events without opening an emulator window. It shares the iOS toolbar and adds **Back** in More. Android's `set_state` and `logs` tools provide device controls; Baguette's iOS-only advanced workbench is hidden. Switching only selects the target: it never stops, starts or transfers an App on either platform. A stopped device waits for Open.

Tools use displayed view points (Android density-independent points), including rotated screenshots and gestures. Accessibility comes from UIAutomator; local Tesseract OCR supplies English and Simplified Chinese for custom-drawn screens. Unicode paste uses the guest clipboard; `type` supports up to 300 ASCII characters. `touch` uses a focused field's paste menu. Android Back, Home, power, volume, app switcher, notifications and shake are supported. `press action` and `pull-down-to-lock-screen` are iOS-only and rejected before Android input; use `pull-down-to-notification-center` to expand notifications. Capture requires unchanged screen orientation and size; action outcomes survive recording failures.

Platform boundaries: Android phones/tablets have no foldable hinge; arbitrary packet-loss profiles, iOS launch arguments/environment and iOS crash-report summaries do not apply. Network bandwidth/latency/offline, location, appearance, font size, clean status bar and specific runtime permissions are available subject to the Android image and App declarations. `heal` reboots Android and terminates Apps, so requires the user's acceptance. `viewer close` stops streaming; `device shutdown` stops the emulator while keeping data. Android reports completed field/step pairs in `appliedSteps`, complete fields in `applied`, and the failing step in `stateError.step`; a partial field is never reported as not executed. Android permissions support grant/revoke only; reset is rejected before all mutations. Android logs default to 120 seconds, default (warning+) and 150 lines, filtered from at most the latest 3000 raw logcat records. main/crash buffers are included, or main only with crashes=false; no iOS crash summaries. Scoped reads use only the current exact PID; logs/crashes from earlier PIDs after exit/restart are not checked. processRunning=false means the process is absent; empty logs do not prove no crash. For historical evidence, explicitly omit process scope and inspect device logs. Transport/identity errors are retained. Contact-sheet frames share screenshot orientation normalization, and initial frame/budget failures return `captureError` before any action.

Data lives under `BaguetteCindy/android`: macOS `~/Library/Application Support`, Windows `%LOCALAPPDATA%`, Linux `$XDG_DATA_HOME` (default `~/.local/share`). SDK, private AVDs and artifacts stay local. Loopback HTTP/gRPC require random capabilities; ADB verifies the private AVD before each command. Screenshot contents can be sent to the user's selected model as part of the requested task. No guest account credentials are extracted.

Drag upward from the bottom Home bar: release after a short swipe to return Home, or pause near the middle before releasing to open recent apps. Rotation buttons turn the device frame with its physical pose, including on the Home screen. Frame and screen turn together with the same 320 ms easing as iPhone, without a scale animation. Rotation preserves the portrait body size when it fits; landscape only reduces that size when the window is too narrow. Reduce Motion skips the animation. Android and the active app choose the content orientation: portrait-locked content turns with the device, while apps supporting landscape can rearrange their content. Shaking preserves the original device pose afterward.

Android location={lat,lon} enables location services; location=clear is iOS-only and rejected before all Android batch writes without disabling location. network=offline/100-loss disables Wi-Fi/data; other profiles enable both, and clear restores full bandwidth/no delay. Android screenshots are rectangular framebuffers without added physical corner/cutout masks; corners=true is iOS-only, while Android accepts omitted/false and cannot verify physical occlusion/safe areas. On the next confirmed SDK install, the existing one-day retention policy removes downloads entries older than a day, retaining newer entries and leaving SDK/AVDs and symlink targets untouched.

## Android interaction parity

**Ongoing rule: use iPhone as the reference for equivalent Android interactions.** Changes to gestures, toolbars, shortcuts or indicators must check both platforms, reuse components where possible, and compare the same input cases. Retain only genuine platform capability differences.

0.2.58 keeps rapid consecutive gestures and pan/pinch switches responsive while input is pending. Wheel pan stops the pair at the screen edge without accumulating hidden travel, so reversing moves immediately on both platforms.

0.2.59 clips iPhone wheel touch indicators to the same screen positions sent to the device, including pinches near the edge; Android already uses bounded indicator positions.

0.2.60 preserves iPhone edge-swipe hints for Chromium single-touch input throughout movement and release. Adding a second finger clears the single-touch hint; lifting a finger from a pair does not invent a new edge swipe.

With a Cindy Mac host that includes native trackpad input, the flat iPhone and Android screens use real AppKit contacts. Move the cursor to the desired centre, then place two fingers: independent positions drive pinch, pan and rotation, including a stationary finger and immediate reversal. Trackpad width maps to the screen’s long edge, with the same physical scale on both axes for initial spacing and movement; edge positions are clipped and reversal responds immediately. Lift/cancel ends the gesture without a wheel-idle timeout. Three fingers remain system gestures. The iPhone transport closes/reopens its single/two-contact stream when one finger lifts; Android releases that contact independently. This requires the updated desktop host as well as plugin 0.2.57 or later; reinstalling the plugin alone does not add native capture. Older hosts and ordinary browsers retain the following wheel behavior. The 3D workbench keeps its existing input.

On both platforms, two-finger trackpad scrolling starts at the cursor with two contacts 80 view points either side, moving in parallel. Pinch or Ctrl+wheel scales around the cursor. Touches end after about 120 ms without wheel input (Android first drains pending moves). Option/Alt-drag pinches around the screen centre; Option/Alt+Shift-drag pans both contacts. Android reuses iPhone's touch-dot component: parallel dots for pan, separating/converging dots for pinch, cleared on release or leaving the page. Android clips edge contacts to its valid screen bounds and stops accumulating scale once both contacts reach the edges, so reversing a pinch responds immediately. After the initial gesture-recognition moves, pinch follows the latest input without incremental catch-up; the app determines how two-finger gestures respond. Top-bar +/− changes only the viewing size.

Scroll the screen with a wheel or trackpad; pinch sends a two-finger gesture to the App (pinching outside the screen still zooms the viewer). Copy selected text with Cmd/Ctrl+C, or use More → Copy device clipboard; paste with Cmd/Ctrl+V. Drop APKs, images or videos onto the screen, or choose Import in More (128 MiB per file). APKs use the same verified installation jobs as Agent tools; media is copied to Downloads and scanned. Agents use `device action=import_media path=…`; inspect `copied`, `scanRequested`, `path` and any `importError` before retrying.

More → Start recording captures the visible screen as silent WebM, with Stop & save visible while recording. It stops at 5 minutes or 128 MiB. Rotation preserves the complete picture inside the initial video dimensions with letterboxing. Save before switching devices or closing the view. For Agent transition inspection, use `capture` contact sheets and `wait_for.goalMet`; continuous browser video export is a user control.

## Android implementation verification

Real Apple Silicon Mac / Android Emulator 37.1.11 / API 36 Google Play arm64 testing covers private boot, install and SHA-256 verification of Appium API Demos, launch, accessibility, portrait/landscape touch, Unicode input and capture. Automated regressions cover cross-platform SDK discovery, consent, checksums, archive extraction, private-device identity, gRPC authentication/cancellation and viewer capabilities. Windows/Linux real-emulator runs, a fresh multi-gigabyte Google SDK installation and a production/Beta Cindy `.cindy` installation are **not yet verified**. See `VERIFICATION.json`; do not treat source tests as those acceptance checks.

## iOS implementation and existing behavior

The following details describe the retained iOS backend; Android differences are specified above.


[简体中文](README.zh-CN.md)

## Shared controls

iPhone, iPad, Apple TV and Vision Pro share Home, Screenshot, viewing zoom and
Controls help. Action buttons execute once; selected modes, toggles and foldable
postures use the same highlight. Temporary camera-button dragging preserves the
selected mode. Hover tips explain operations and shortcuts; the shared help
dialog is also available on touch screens and describes the current device's
input. Toolbar wrapping reserves space beneath the view on narrow screens.

## Screen streaming

Every device streams H.264 and sends nothing while the screen is still:

- **iPhone, iPad, Apple TV, Vision Pro**: Baguette encodes. The plugin's patch delivers the requested rate (60 fps; previously about 45). Once the screen stops changing it sends six more frames ending on a keyframe, then stops until the pixels change. Apple TV and Vision Pro fall back to MJPEG when the browser lacks WebCodecs. A hidden page drops to 2 fps.
- **Android**: renders on the Mac's GPU. Headless `auto` selects CPU software rendering, which used about eleven cores while scrolling. If the GPU mode fails to start, the emulator restarts with software rendering, `devices` reports `renderer: software` and the device list shows it. On Apple Silicon the emulator writes native-resolution pixels to a private shared file and `native/android-encoder` encodes them with VideoToolbox; gRPC carries no pixels and no adb command runs per frame. A failed encoder reconnects; two failures within a minute switch new streams to PNG for a while. Intel Macs, Windows, Linux and pages without WebCodecs use unthrottled PNG.
- Agent screenshots, captures and OCR are unchanged and still read complete single frames.

## Apple TV and Vision Pro

Create either device in the management view or task tab using an installed tvOS
or visionOS runtime (`xrOS` in runtime identifiers). Build for `tvOS Simulator`
or `visionOS Simulator`, then install and launch the matching `.app` as usual.
Both support a live rectangular view, screenshots, local OCR, waits and logs.
Switching between platforms does not copy the previous platform's app.

Apple TV uses the on-screen remote or `press` with `up`, `down`, `left`, `right`,
`select`, `back`, `menu`, `home`, or `play-pause`; arrow keys, Return, Escape and
Space also work. `type_text auto/type` sends up to 300 US-keyboard characters; keys are also supported.
tvOS has no simulator clipboard: paste and Unicode text are not supported.
In the live display, two-finger trackpad motion sends a continuous native Siri
Remote touch contact. Longer swipes can cross multiple items; tvOS handles focus
movement from the touch trajectory. A primary click selects the focused item and
a right-click goes back (Control-click also works on macOS). Click position does
not select a TV screen coordinate. With macOS natural scrolling, focus follows
finger movement; both wheel axes are inverted from document-scrolling deltas.
The desktop wheel stream includes OS acceleration/momentum and lacks physical
finger-up events, so its timing and feel are not identical to a hardware remote.
Vision Pro follows [Apple's Device Hub controls](https://developer.apple.com/documentation/xcode/interacting-with-your-visionos-app-in-device-hub):
click/hold/drag to pinch and move, Shift-drag for depth, Control-drag to look,
and toolbar modes for tilt, pan, orbit, dolly and reset. Drag a camera-mode button
directly to adjust the view temporarily without changing the selected pointer mode;
click it to select how subsequent canvas drags behave. Hover tips explain both actions. WASD/arrows move
forward/back/left/right; Q/E move down/up. Two-finger scrolling pans and trackpad pinch
moves forward/back. Option-drag (or the two-hands button) scales horizontally
and rotates vertically. Keyboard capture sends text/keys and paste into the guest;
when disabled, only camera navigation keys are handled.
pointer capture forwards relative mouse motion/buttons. Escape releases capture.
The recording button saves the live view as a video. Capture requires a focused
desktop viewer and browser support; it reports failure if capture is denied.
Standard game controllers navigate while the display has focus: left stick
moves, R2/L2 raise/lower, and right stick turns. Release the sticks after an input
error before continuing. Physical-controller acceptance is still pending.

Agents use `tap` with screenshot coordinates/OCR text, `press digital-crown`
(or `home`), ordinary drag/swipe/pinch/pan, or `gesture kind=spatial` with
`action=drag|pinch|rotate|gaze|tilt|pan|orbit|dolly|move|reset`.
Coordinates are screenshot view points; spatial camera translation is in metres
and rotation in degrees. Spatial `pan` takes `by=[right,up]` (two axes only);
use `move` with `[right,up,back]` or `dolly distance` for depth.
Take another screenshot after moving the camera.

Among Apple platforms, orientation, posture, status-bar override, touch-menu paste, `scroll_to` and `heal` remain
iOS-only; Android has its own support described above. Soft-keyboard recovery is iOS-only. tvOS/visionOS return OCR text lists in all query modes, including
`mode=full` and `x,y` hit tests, instead of accessibility trees/IDs. Input adapters
were exercised with Xcode 27 and tvOS/visionOS 27; other versions are unverified.
See [native protocol and verification notes](native/platform-support.md).
Stable/Beta Cindy package installation and embedded-preview acceptance are pending.

Screenshots fall back to a file path on older hosts or when JPEG compression still exceeds the 130 KB inline budget. Open that path with an image tool before choosing coordinates; the full-resolution file is preserved.

Viewer screenshot exports to the Mac clipboard or Desktop report confirmed writes as `executed` and command failures after dispatch as `unknown`; inspect the destination before retrying. Temporary clipboard-image cleanup cannot replace the export outcome. `environment.baguette` is the detected binary version; compatibility notes do not repeat a fixed version.

Failed automatic OCR in `describe_ui` returns an error; only successful recognition can report an empty text list. Task binding returns its saved `boundUdid` and `execution: executed` even if subsequent status or viewer reads fail (`taskStateError`). Task boot/create pages also preserve the completed step on a failed follow-up. Refresh task state; do not repeat the completed operation. A task page unloads its old screen when the new binding's status is unavailable.

Capture waits for a complete first frame and confirms the screen before starting the action. If the stream fails or the deadline expires first, it returns `captureError` with `execution: not_executed`. An interrupted recording or output that cannot drain within the cleanup deadline also returns `captureError`, retaining the action outcome without generating a contact sheet. Diagnostic read failures return `crashesError` alongside the logs; an empty `crashes` list means the scan completed without matching reports. `crashes=false` skips that scan.

Installation compares bundle content checksums, including resources whose timestamps were preserved. Registration or signing changes use a full install. Container lookup failures are errors, not evidence that the App is absent; automatic installation stops before writing, and log queries retain their scope. A background install keeps the device busy until its writes settle. `method=touch` rejects `clear=true` and `keys` to preserve the on-screen keyboard; capture results retain the action's execution state.

Cindy's official Device Simulator for Apple Silicon Macs, using bundled Baguette 0.2.10. It replaces the retired embedded simulator; Cindy shows previous users a one-time migration notice pointing here (plugin id `baguette-simulator`).
The name leaves room for future devices and platforms; it does not add platform support.
Requires macOS 15.0+, Apple Silicon, Cindy 0.1.83+, full Xcode and an installed iOS runtime. No first-run dependency download. Packaging collects nine portable USDZ model assets from the hash-pinned official release via `binary-dependencies.json`; the native executables remain tracked and macOS-only.

Use it by default for iOS Simulator tasks. Run `environment` and `devices`, reuse a suitable logged-in device, then `device action=boot` if needed. Build the App with the project's normal workflow (for a private device use `-destination 'generic/platform=iOS Simulator'`), then `app action=install` and `app action=launch` its Simulator `.app`. Launching opens the current task's simulator tab by default. Check `viewer.previewOpened`; a running process does not prove a visible preview. Reopen an existing device with `viewer action=open` after changing sessions.

The 16 Agent tools are grouped by intent: `environment`, `devices`, `device` (create / boot / shutdown / rename / erase / delete / activity / release), `app` (install / install_status / info / launch / terminate / uninstall / open_url), `screenshot`, `describe_ui`, `tap`, `gesture`, `type_text`, `press`, `wait_for`, `capture`, `set_state`, `logs`, `heal` and `viewer`. Their design comes from what models actually struggled with in past Cindy tasks:

- **Real touches, no window.** `tap` and `gesture` (swipe, drag, pinch, two-finger pan, system edge gestures, scroll-to-element, double tap, long press) go through the simulator's HID touch path, so they work with the Mac locked and the App receives finger touches. The manual tells models not to inject events into the App process, which bypasses the touch chain and produced false passes before.
- **One coordinate space.** Everything is in view points as the user sees the screen. Screenshots are turned upright (landscape, foldable inner panel), drawn with the screen's corners and Dynamic Island, and by default 1 pixel = 1 point, optionally with a labelled grid or a cropped region; `describe_ui` returns a compact element list with view-space frames and centres; `tap` can target an element by text, identifier and role. On iPhone Duo's unfolded panel, SpringBoard's accessibility frames are turned a quarter from the framebuffer (measured on iOS 27.1); the plugin corrects for that.
- **Games.** Where there is no accessibility tree (games, engine-drawn UI), `describe_ui`, `tap text=…` and `wait_for text=…` work on text read off the screen with Apple's on-device Vision OCR (nothing leaves the Mac). `type_text` pastes in regular apps and types key by key in games, which often ignore paste, switching a Pinyin or similar input source to English first. Coordinate taps are pinned to the screen they were read on, so a screen turned since the last look is refused instead of tapped in the wrong place.
- **Waiting and transitions.** `wait_for` waits for an element to appear or disappear, the screen (or a region) to settle within a tolerance for animated scenes, or a log line, and returns the current screen when it does not happen; `capture` performs an action while recording frames and returns a time-labelled contact sheet.
- **Installing the right build.** `app action=install` skips an identical build, syncs a few changed files, or installs the whole bundle. Apple install jobs include full content verification. `app action=info appPath=…` checks all bundle resources or rechecks a valid receipt; pending verification returns a job. Only `matchesLocal: true` confirms equality. Metadata-only reads do not prove the build.
- **State and diagnostics.** `set_state` changes orientation, foldable posture, appearance, contrast, text size, network conditioning, location, a clean status bar and privacy grants. All steps and readbacks share the request deadline. `applied` lists completed fields; failure or expiry stops later steps and returns `stateError` with `field`, `code`, `message` and `execution`. Inspect that field before retrying; do not replay the entire request. Screen information after rotation/posture changes is returned only when confirmed within the remaining time; `null` in `current` means unconfirmed. `logs` reads an App's recent unified log and summarizes this device's crash reports. On iOS, level=default retains ordinary Default messages; it is not Android's warning threshold.

The manual (`manual/workflow/MANUAL.md`) holds the full workflow, build recipe, verification principles and recovery. One operation runs at a time per device. Device input and App launches can run on different devices concurrently; shared App record writes are serialized briefly. Global settings, stop-all and viewer closure remain exclusive. Reads (`describe_ui`, `wait_for`, `logs`) never wait for input.

In the **simulator main view**, devices assigned to a task have an **Open Simulator Sidebar** button. It navigates to the most recently assigned task and opens its **simulator sidebar**, without starting a shut-down device or changing task bindings. This navigation needs a Cindy host supporting `taskView({focus:true})`; older hosts show an update message instead of claiming the jump succeeded.

Two views: each task gets its own **Device Simulator** tab in the right sidebar (screen and controller only, no address bar), and **Simulators** in the left navigation manages every device regardless of task in a split view modelled on Xcode's Device Hub: a list grouped into Running and Shut Down (searchable past six devices) showing each device's model, iOS version and its task selection, recent activity or unknown usage, and the selected device's live screen on the right. **+** creates an iPhone or iPad from a sheet with Name, OS Version and Model (models filtered to the chosen runtime; the name follows the model until edited). Each row's ⋯ / context menu offers Start or Shut Down, Open in Current Task (only when a task is in front and does not already use it; companion chats count), Rename, Erase All Content and Settings… and Delete… (both confirmed; a running device is shut down first, and deleting also clears its task bindings). Which device a task uses is decided when the AI opens the simulator: `devices` distinguishes current selection (`tasks`, `thisTask`) from recent activity (`activeTasks`, `thisTaskActive`, `usage`, `operation`); running devices without activity evidence are unknown, not free; booting, opening the viewer and launching an app bind the device to the calling task (`~/Library/Application Support/BaguetteCindy/task-bindings.json`, mode 0600). Without a task tab (no device yet, or the device is off) the tab offers the device list or Start instead of a blank page. Hosts without task views fall back to the sidebar preview.

The controller is Cindy's own: a device chip (status dot, name, device menu for switching, adding and renaming), a zoom control (−, a percentage menu with Fit to Window, Actual Size and fixed steps, +), and a More menu (Shake, App Switcher, release stuck keys, recover view, full Baguette tools, confirmed shutdown). Home, Screenshot, Rotate Left / Right and, on foldables, the Closed / Half Open / Flat posture float over the screen. Shortcuts follow Simulator: ⌘+ / ⌘− / ⌘0 (fit) / ⌘1 (actual size), Ctrl-wheel zoom, ⌘← / ⌘→ rotate, ⇧⌘H Home, ⌘S screenshot. Zoom is remembered per device; opening or reloading reads the guest orientation without rotating it; zoom keeps the centre and scrolls when larger than the window. The screenshot button's caret chooses where screenshots go: the Desktop (with a “Show in Finder” action) or the clipboard; the choice is remembered. The Baguette page inside renders the device with its bezel (`?handheld=0`; foldables keep the 3D view); its workbench chrome is hidden by an injected stylesheet. A lost view, the idle countdown and a shut-down device appear in place of the screen with Recover / Keep using / Start buttons; nothing restarts the simulator or app without an explicit action. Agent recovery uses `press` with `button=release-input`. Unicode paste replaces the simulator clipboard; browser Copy replaces the Mac clipboard. Observe the focused field before input and inspect the result afterwards. Keyboard delivery acknowledgements are not App completion acknowledgements.

Pages wait for the logic page to listen before sending each operation once; slow device queries are not replayed during startup. Viewer controls wait through the worker's request budget, including saving a screenshot to the Desktop or clipboard. Device UDIDs are case-insensitive across task bindings, device operations and installation polling; existing bindings remain usable. Erase and delete return their operation result directly; the management page refreshes its device list separately.

Devices live under `~/Library/Application Support/BaguetteCindy/devices`, Agent screenshots and captures under its siblings `screenshots` and `captures` (removed after a day). No default/Cindy embedded device access; devices are erased or deleted only from the confirmed menu items above. Reinstalling the same bundle ID normally preserves App data, but App migrations/logout/server session expiry still govern authentication. Concurrent agents must not interleave operations on one device.

`heal` explicitly restarts SpringBoard and terminates running apps: require user acceptance of that effect. Try releasing stuck keys first. `device action=shutdown` stops the selected simulator but retains its data. `viewer action=close` stops streaming, not the simulator. `device action=erase|delete` and `app action=uninstall` remove data and are used only when the user asks.

Explicitly closing the viewer retires its saved reconnect address; task-page polling and worker restart do not reopen it. A new open, boot or task assignment can show the screen again. Unexpected worker exits retain the saved address so an open task tab can reconnect.

## User controls

Open **Plugins → Device Simulator** to view actual private-device states, start or stop a device, open its live view, add a device, or stop all devices. Turning off **Allow simulators to run** first persists the restriction, then shuts down devices and stops the viewer. Failed shutdown remains visible; tools cannot restart a device while the switch is off. Turning it back on never boots a device. Data and login storage are preserved.

Batch shutdown shares one request deadline across enumeration, every device, viewer closure and verification. Expiry stops further dispatches; results retain `completed`, per-device `outcomes` and `unprocessed`. `devicesError` marks an unverified last-known list, so it cannot prove all devices stopped. Tool and viewer keyboard/clipboard inputs share the existing device lock: the same UDID remains exclusive regardless of case, while other devices can proceed.

Shut down (with confirmation) lives in the More menu; the screen fits the window by default. App pinch gestures remain Option-drag or Ctrl-wheel, separate from view size. The idle setting defaults to 15 minutes, with 30 minutes, 1 hour and manual-only options. A device is not stopped while a viewer window is open or another tool or script names it in its own command line (for example `simctl`, `xcodebuild -destination id=…` or the Baguette CLI); device input and tool operations restart the timer, status polling does not. Cindy keeps the plugin worker running while any device or viewer window is up. A device shutdown terminates its apps and connections. All private devices share this inactivity clock; changing the idle setting starts a new period.

The device chip menu provides **Switch**, **Add device** and **Rename**. Adding is prefilled with the newest iPhone and its newest installed iOS runtime (both editable); the new device stays shut down until you click **Open**. Plugin settings offer a one-tap **Create your first iPhone** when no device exists. Renaming preserves apps and data. Changing model or runtime creates a separate device, keeping the original. Switching only selects the target: a running device shows its current screen; a stopped device shows **Open** and starts only when clicked. The previous device and its apps keep running. Other running private devices do not block switching. The existing shared idle timeout and manual shutdown controls still apply.

The plugin remembers the last app it successfully launched on each device in `runtime-settings.json.apps.json`. Selecting a device does not read or change those records, install or launch apps, or copy app data, logins or credentials. Each device keeps its own apps and state.

Runtime preferences are stored beside the private device set in `runtime-settings.json`, shared by local users of that set. The worker attempts shutdown on normal exit, but forced termination can interrupt it. Use the settings run switch **before** disabling the plugin in Cindy, and verify the displayed device states. A closed/disconnected preview is never proof of shutdown.

## Security and limitations

The Node Worker runs with local user permissions. Executable paths and command shapes are fixed; there is no arbitrary shell tool. The controller listens only on 127.0.0.1; clipboard/control requests require a matching Origin, random capability (kept with the viewer port in `~/Library/Application Support/BaguetteCindy/viewer-session.json`, mode 0600, so an open tab reconnects after the Worker restarts; turning simulators off retires it) and an opened private device. No account tokens are extracted or copied into Cindy storage. Screenshot analysis may send images to the configured model. Actions inside apps can have external side effects and remain subject to the task’s authorization.

The viewer’s optional location map requests reach OpenStreetMap through the fixed-endpoint Node proxy; see VENDOR-REVIEW.md. The farm page uses local font fallbacks without remote font requests. These features do not synchronize simulator accounts. No background dependency installation occurs.

Upstream 0.2.7 adds an app UserDefaults editor (Defaults card) that can read or rewrite any installed app's preferences and relaunch apps with an injected dylib. Those routes ignore the private device set, so the plugin hides the card, returns 404 for them at the viewer proxy and does not bundle `DefaultsLookups.dylib`. Handheld mode is unchanged upstream behavior and stays loopback-only.

Known upstream limitation: stream disconnects can SIGABRT on iOS 27. The supervisor restarts at most five times per minute; the independent controller remains available for manual recovery. This is mitigation, not a native crash fix. Disabling the plugin or quitting Cindy stops the controller too; recovery after Worker exit requires Cindy to start it again. Device data persists across tasks; each task tab remembers its own device.

## Build and verification

Run `sh native/build.sh` on an Apple Silicon Mac with Xcode. This compiles the included Objective-C source and ad-hoc signs the helper. No dependency download. Baguette and HingeControl are rebuilt from v0.2.10 with `vendor-native.patch` (version constant, 3D scene release, and H.264 frame pacing with idle stop; see VENDOR-REVIEW.md); `native/build.sh` also builds the Android H.264 encoder helper; use `sh native/build-baguette.sh <verified-source-archive>` to reproduce the build, then `node native/inventory.mjs --write`. The release build uses whole-program LTO and Swift `-Osize`, strips symbols and ad-hoc signs the host executable to keep tracked binary content below the repository limit. The private device-set and 3D memory fixes this plugin needed were merged upstream (tddworks/baguette#122, #123). `node .tests/baguette/real-simulator-smoke.mjs --foldable` checks a build against real simulators in a throwaway device set.

Run the repository contracts and `.tests/baguette-simulator.test.mjs`. Review VENDOR-REVIEW.md, THIRD-PARTY-LICENSES.txt and the proposal [#119](https://github.com/makecindy/cindy-official-plugins/issues/119). Initial provisioning is an empty targeted audience, not all users. Final package installation in eligible Cindy must be recorded separately from direct Node/native tests.

The optional location panel sends search text and requested map tiles to OpenStreetMap through the Node Worker (fixed nominatim.openstreetmap.org and tile.openstreetmap.org HTTPS endpoints). Browser requests remain same-origin; redirects and arbitrary upstream URLs are rejected. No account credentials are forwarded.

The viewer proxy requires a capability session for HTTP and WebSocket access. The controller exchanges its fragment token for an HttpOnly session cookie. This is not a sandbox against processes with the same macOS user permissions or direct access to the upstream Baguette listener.

## iPhone Duo and Xcode compatibility

Ordinary devices retain the Xcode 26/27 paths. iPhone Duo requires the selected Xcode 27.1 and an installed iOS 27.1 runtime. The upstream viewer includes the Duo 3D model, inner/outer displays, pose buttons and hinge slider; changing the pose changes the simulated device and foreground app layout. The model is read from Xcode, not downloaded by this plugin. The plugin uses the selected Xcode; it does not install, switch or downgrade Xcode automatically. Clipboard writes prefer CoreDevice and fall back to private-set simctl on older or unsupported environments.

Duo preview, closed/open poses, touch and Unicode input were exercised on iOS 27.1 in Cindy 0.1.93 Beta. Xcode 26 integration remains unverified; See VERIFICATION.json for the exact boundary.

## Upstream and license

This plugin is built on [Baguette](https://github.com/tddworks/baguette) by tddworks, licensed under Apache-2.0. Cindy maintains the integration, the Node Worker and the local patches documented in VENDOR-REVIEW.md (`vendor-native.patch`, `vendor-web.patch`). It is not affiliated with or endorsed by tddworks. The bundled HingeControl includes code adapted from Meta's idb (MIT). Full license texts are in THIRD-PARTY-LICENSES.txt and `HingeControl/LICENSE.idb`; the icon is Cindy's own iOS Simulator icon.

If settings cannot be read, device status and shutdown remain available while startup and settings edits stay blocked. Restore the settings file before enabling operation.

The live view also allows file and App installation (which may replace an existing App), copy/paste that replaces the Mac or simulator clipboard, and remote notification injection that can trigger App behavior. Tell the user about these capabilities before opening; opening alone performs none of them. Unreadable task bindings make device assignment queries fail instead of reporting devices as free. Unreadable recent App records do not block device selection or live controls.

Completed device results retain `taskBindingError` / `appContextError` when task or recent App records cannot be saved. Switch jobs retain `taskBindingError` alongside the selected device, which can be stopped; deletion attempts both record cleanups independently. Check records and storage before assigning or switching devices; do not repeat a device operation to repair bookkeeping. Task and management polling wait for the current status read to settle; user actions and viewer pushes can still supersede its result.

Agent health: viewer readiness probes the live HTTP service even after its startup log has scrolled away. `appLaunched: true` with `outcome: partial` preserves a successful launch when the preview fails; retry viewer open only. `wait_for.goalMet` mirrors `met`, and install `modeReason` explains skip/sync/full decisions. `settle` accepts 0–5 seconds (default 0.6); use `until` or `wait_for` for longer waits. BUSY names the active operation and supplies an install job when available; device calls wait at most one second before execution and never replay an uncertain mutation.

Task activity lasts 15 minutes in worker memory and can cover multiple devices. Long scripts may renew with `device action=activity` every five minutes and finish with `device action=release`; release keeps the device and App running. This is usage evidence, not an exclusive reservation. Ordinary operations renew activity; device/status polling does not. Restart clears activity, leaving running devices unknown.

App content comparison failures retain `comparisonError` and `verification: unconfirmed`; Apple reports `matchesLocal: null` when unconfirmed. Android may report false alongside an unconfirmed comparison. Neither proves a different build; do not reinstall based on an incomplete comparison.

Android lifecycle results preserve partial progress: failed launch includes `appLaunched: false`, `appTerminated` (null means unconfirmed), `launchError` and `execution`. Device delete/erase failures retain `completedSteps`, `failedStep`, `shutdown` and `deviceError`; they do not clear task or recent-App records. Inspect actual state before retrying. A confirmed launch with only a preview failure still permits viewer-only retry. Install/info take an absolute iOS simulator `.app` or Android `.apk` path.

Native Mac contact samples now reach the viewer atomically, avoiding an artificial single-finger prelude and Chromium touch ACK delay. Older hosts keep the standard touch/wheel fallback.
