# Memory mode and resource GUI verification — 2026-10-27

Source: branch `dash/simulator-memory-gui`, based on `29860bf`, plugin
`baguette-simulator` 0.2.54 source, 0.2.53 installed. macOS 27.0.1, Xcode 27.1 (27A9269).
The test package was installed in the current Cindy with explicit user authorization. No new Host capability,
permission, profile semantics, automatic restart or plugin identity change.

## First review follow-up — 0.2.54

- The Android controller bridge now forwards the selected memoryMode to
  settings_boot when an off iOS device was created/selected from that view.
  Both create bridges return the completed creation without an unrelated
  status read that could hide success. Device selection still does not boot.
- Regression uses the shared controller script and the real authenticated
  Android HTTP bridge with a fixture worker: Android view → create iOS →
  select it while off → explicit boot, for saving, standard and minimal.
  This verifies request routing, not a live Android emulator or iOS boot.
- List redraw restores row focus only when not renaming. The menu regression
  starts from a focused row and verifies the new name input keeps focus without
  issuing a rename request before the user edits it.
- No new package installation or user-device interruption in this follow-up.
  Earlier installed evidence below remains limited to its stated versions;
  0.2.54 has not been exercised in the native Cindy task frame.
- Complete repository gates: 726 passed, 0 failed
  (`/tmp/simulator-review-round1-gates.log`); Forge validated and packaged 0.2.54.

## Live-sidebar creation — 0.2.52

- The live controller has a separate add/rename form, missed by 0.2.51. Both
  shipped templates now mount the shared iOS mode picker there. It is hidden
  for rename and unsupported runtimes. Creation captures the selected mode,
  disables the form while pending, closes on success, then uses the existing
  switch flow to select/bind the returned UDID without starting either device.
- The create endpoint returns the completed creation directly, avoiding an
  unrelated status-read failure that could conceal a successfully created device.
- Controller regression tests cover both templates, all three modes retained in
  the new device's startup picker, task identity on switch, no boot/shutdown,
  unsupported runtime visibility and a switch failure after successful create.
- Installed-package test created a temporary iOS 27.0 device from the actual
  controller with minimal selected. The controller switched to the returned
  UDID, showed the off-device minimal picker, and devices independently reported
  thisTask=true and Shutdown. Light/dark narrow screenshots:
  `/tmp/simulator-sidebar-create-installed-light.png`,
  `/tmp/simulator-sidebar-create-installed-dark.png`,
  `/tmp/simulator-sidebar-create-selected.png`.
- Both temporary devices were deleted after restoring the original task binding.
  User devices were not booted or shut down by these tests. The original Pro Max
  was started by another task during verification; its running state was preserved.

## Creation choice handoff — 0.2.53

- Follow-up inspection found the outer task page replaces its controller with
  an off-device page after polling the new binding. The creation choice now
  transfers to that page's existing in-memory map before binding changes.
  The receiver checks the embedded window, origin and task; this is not a
  persistent preference and does not start devices.
- Regression runs the actual task page and shared choice map through the
  controller-to-off-page transition, rejects unrelated message sources, then
  verifies the next boot receives minimal. Controller coverage checks both
  shipped templates and all three modes send the handoff.
- Dash explicitly authorized interrupting the Pro Max to install 0.2.53.
  Forge updated the existing xd instance to 0.2.53. Restored only the previously
  running Pro Max in standard mode (verified=true, disabledServices=0), then
  viewer open returned previewOpened=true in the current Cindy task sidebar.
  No App was relaunched; the other two user devices remained off.
  Required checks: 724 passed, 0 failed
  (`/tmp/simulator-sidebar-final-gates.log`). The first run's four failures were
  older VM fixtures missing the browser window event API; those fixtures were
  corrected and the complete gates rerun successfully.
  Native task-frame rendering was not
  visually verified; the installed 0.2.52 controller test alone does not cover
  the parent refresh, so 0.2.52 still has that choice-handoff limitation.

## Creation-time mode choice — 0.2.51

- The shared create sheet shows the existing mode picker only for iOS runtimes.
  Success assigns the submitted choice to the new UDID in the existing page
  map; it does not boot or add persistent preferences. The choice is captured
  before the asynchronous create request so later edits cannot change it.
- Tests cover all three choices reaching the next boot and hide the picker for
  Android/tvOS/visionOS. Browser fixture checks switch all four runtimes and
  verify light/dark at 700/320 px, visible tradeoffs and cancellation without
  creating or booting a device. Screenshots:
  `/tmp/simulator-create-mode-dark-320.png` and corresponding variants.
- Required gates: 721 passed (`/tmp/simulator-create-mode-gates.log`). No new
  real device was allocated for this UI change.
- Host source investigation: the full-page main view omits tab chrome and
  reserves a drag band outside fullscreen. The existing sidebar navigation
  context menu contains Open in Window. No Host code or window preferences
  were changed; that menu action was not executed in this round.

## Simplified row actions — 0.2.50

- Removed management-row memory-mode and task-arrow icons. Only More remains
  beside the name; the related-task action is in the single-device context menu.
  Memory usage readings and mode controls in the live viewer are unchanged.
- Browser source checks: light/dark at 1000 and 320 px, three text lines, one
  row action, no horizontal overflow. Choosing the task menu item sent exactly
  one go_to_task request and no device mutation. Screenshots use fixture data:
  `/tmp/simulator-clean-list-dark-320.png` and corresponding light/desktop files.
- Required gates: 720 passed (`/tmp/simulator-row-clean-gates.log`).

## Compact management rows — 0.2.49

- Name/model/resource rows replace the separate task link and wrapping activity
  text. Task navigation is an accessible arrow button beside the mode icon;
  activity details remain in tooltips. The device glyph is 32 px; text sizes
  are unchanged. Very narrow panes may wrap resource readings.
- Source browser verification covers light/dark, Chinese/English and panes of
  220/300/480 px plus a 320 px viewport. Default rows measure about 73 px tall,
  with no horizontal list overflow. Task navigation dispatches once without
  starting or shutting down a device. Existing selection tests pass.
- Required repository gates: 720 passed, 0 failed
  (`/tmp/simulator-compact-list-gates.log`). Source screenshots:
  `/tmp/simulator-compact-dark-300.png`,
  `/tmp/simulator-compact-light-320.png`. These use fixture data, not a live
  simulator stream or a capture of the native Cindy window.
- Forge updated the existing xd instance to 0.2.49. The update shut down the
  running Pro Max; restored only that device with saving verified (56 disabled
  services), then reopened the current task viewer (`previewOpened=true`). The
  other device was already off. No App was relaunched and no native-window
  screenshot is claimed for this version.

## Restart continuity — 0.2.48

- Reproduced the reported failure with the real management page and controller
  against a delayed fixture: shutdown took six seconds, the parent refreshed at
  four seconds and replaced the controller with about:blank. The only mutation
  received was shutdown; no boot followed, and the device stayed off.
- Restart now uses one authenticated request to the existing runtime owner,
  holding its existing per-device exclusion across stop verification and boot.
  Invalid mode, non-iOS or foreign device, and paused runtime fail before stop.
  An unconfirmed stop never boots; failed operations are not automatically retried.
- Task state retains the existing viewer URL during this operation; management
  retains its existing controller. The same delayed browser fixture now retains
  the document and pending dialog, then completes in verified standard mode.
- Regression coverage includes refresh during shutdown, competing boot requests,
  one shared deadline, failed stop/boot, all three requested modes, and an accepted
  authenticated request continuing after its viewer disconnects.
- Required gates passed: 720 tests (`/tmp/simulator-restart-owner-gates.log`).
  Forge installed 0.2.48 into the existing `xd` instance.
- Real installed controller on the dedicated Pro Max test device:
  verified the loaded script uses the single restart request, then clicked
  standard → saving → standard → saving. Captured one `restart_device` request
  per click, with the selected mode and verified result. Independent devices reads
  confirmed standard disabledServices=0 and saving disabledServices=56. Final
  state is Booted / saving / verified=true; the other device stayed Shutdown.
  The live home screen was visually checked in the browser. Minimal remained
  covered by regression tests, not a real-device cycle in this follow-up.
- An already open browser tab retained its old loaded script despite navigating
  to the identical URL; it was explicitly reloaded before the above evidence.
  Finally closed/reopened only the viewer via plugin tools, obtaining a fresh
  address and successful current Cindy task-sidebar opening, without stopping
  the device. Native Cindy window visuals were not separately captured.

## Short saving label — 0.2.47

- Chinese mode option and shared label now use “节省”, including startup pickers,
  inline readings, icon tooltips, mode dialogs and pending-restart notices.
  Descriptive text about saving memory and the `saving` wire value are unchanged.

## Mode underline — 0.2.46

- Split the inline mode into three spans: plain opening parenthesis, underlined
  mode text, plain closing parenthesis. Click target and accessible label remain
  the existing button. Browser computed styles confirmed none / underline / none;
  light and dark screenshots were visually inspected.
- Updated the controller test DOM to aggregate descendant text like the browser;
  existing controller tests still check the full parenthesized label and actions.

## Explicit restart entry — 0.2.45

- Mode dialogs in the viewer and shared page badges offer Restart & apply
  after a changed selection, or Restart simulator for the verified current mode.
  Selecting a mode alone still does not stop the device. The dialog states that
  restart closes current apps while preserving apps and data.
- Both surfaces reuse shutdown then boot, requiring the exact target's confirmed
  Shutdown state before boot. Duplicate clicks are blocked while pending. Failed
  or unconfirmed operations remain visible, with no automatic retry.
- Required repository gates: 716 tests passed (`/tmp/simulator-restart-gates.log`).
  Added coverage for target confirmation, all three requested modes, duplicate
  clicks, locked pending dialog, failed shutdown and successful viewer recovery.
- Browser layout checks passed in Chinese and English, light and dark, at 320
  and 700 px widths. Screenshots inspected at 320 px; fixture video was a
  placeholder, not native streaming evidence.
- Forge installed 0.2.45 into the existing `xd` instance. After the update's
  worker teardown, restored the dedicated Pro Max test device to its observed
  standard mode. Clicked the installed viewer's Restart simulator button once:
  dialog closed after completion, devices read returned Booted / standard /
  verified=true, and the live iOS home screen was visually checked in the browser.
  The other device remained Shutdown. Current Cindy task sidebar was opened via
  the plugin viewer tool; the native Cindy window was not separately captured.
- Changed-mode restart ordering was tested with mocks; this follow-up did not
  cycle the real device through saving and minimal or rerun game acceptance.

## Device and browser evidence

- Used the existing dedicated iPhone 17 Pro / iOS 27.0 test device
  in the plugin's private device set.
  It was shut down before testing.
- Booted the source core in saving mode: verified=true, 56 managed services
  disabled. A local preview served the actual control HTML/JS/CSS and connected
  its status, boot and shutdown actions to the source runtime, restricted to
  this exact device. Its video iframe was a placeholder; this run did not
  re-test native streaming or recording.
- The browser showed “内存：节省内存 · 查看与更改”. Opened the mode details,
  used “关闭设备以更改”, selected standard in the startup picker and clicked
  Open. The browser then showed “内存：标准 · 查看与更改”.
- An independent source `devices` read returned standard, verified=true,
  disabledServices=0, in 409 ms (one running iOS device). This is one measured
  read, not a performance guarantee.
- The dedicated device was shut down again with standard overrides retained.
  Preview processes and the test browser tab were closed.
- Inspected the actual management and settings pages with fixture device/RPC
  data for saving, standard and minimal. These layout previews do not claim
  Cindy Host integration or three real devices.
- At 320 × 700, the live mode dialog, management list and settings page fit
  without horizontal overflow (innerWidth=scrollWidth=320). Inspected light
  and dark screenshots. The dialog was 288 px wide with 16 px side margins.
  Screenshots are local test artifacts under
  `/tmp/simulator-memory-gui-*-320.png`; they were not published.

## Resource usage follow-up

- The same dedicated device was booted in saving mode for this follow-up.
  Source `resource_usage` returned memory=1,913,500,672 bytes across 178
  processes and disk=5,393,772,544 bytes in 1,324 ms. This is one snapshot,
  not a benchmark or guaranteed memory saving.
- macOS memory uses `top -l 1 -stats pid,ppid,mem,command` after finding the
  exact private device's `launchd_sim` bootstrap path. Local `top(1)` documents
  MEM as physical footprint. A raw RSS sum on this device was about 27 GB
  because of repeated resident shared libraries; that is not used on macOS.
  Linux uses RSS and explicitly documents the shared-page limitation.
- Disk uses `du -sk -P -x` on the owned device directory (allocated blocks,
  not virtual capacity; no symlink following or crossing mounted filesystems).
  Shared runtimes/SDKs and shared host/viewer services are excluded. APFS
  sharing/compression means the number is not guaranteed reclaimable space.
- The source controller's resource action was connected to the source runtime
  in the isolated local preview. Opened the dialog and clicked Refresh; the
  browser displayed 1.81 GiB / 5.02 GiB with an updated sampling time. The
  native screen was still a placeholder, not a streaming/recording test.
- Inspected final resource dialogs at 320 × 700 in both light and dark modes;
  innerWidth=scrollWidth=320. Statistics explanations are expandable. Also
  inspected management (light) and settings (dark) with fixture data; each
  device has its own resource entry. Test artifacts:
  `/tmp/simulator-resources-{light,dark,manage,settings}-320.png`.
- Shut down the dedicated device. A fresh source read returned memory=0,
  processCount=0 and disk=5,394,296,832 bytes. Restored its previous standard
  override configuration while it remained shut down (not a live-mode check).
- In the original on-demand implementation, reads were explicit; the cached
  visible-device follow-up below supersedes that refresh policy. Tests cover
  exact process attribution, unrelated devices, changed process trees, partial
  failures, malformed output, unavailable/unsupported values, request budgets,
  page routing, repeated-click suppression, closing during a read, and no
  idle-timer renewal or device lock contention.
- No Android/Linux live measurement or Windows implementation in this round;
  Windows displays unsupported. No new permissions, persistent telemetry,
  background refresh loop, or public Agent tool schema was added.

## Automated validation

`node --test .tests/plugin-contract.test.mjs .tests/localization.test.mjs .tests/provisioning.test.mjs .tests/publish-workflows.test.mjs .tests/baguette-simulator.test.mjs`

700 tests passed, zero failures. Latest full log: `/tmp/simulator-ui-refinement-final-gates.log`.
The final task-page placement adjustment also passed 85 task/review-invariant
checks in `/tmp/simulator-ui-refinement-task-check.log`.
The tests exercise fresh status after external mode changes, failed probes
retaining the device list, platform filtering, unverified/unknown presentation,
inspection without iframe reload, cancel without mutation, explicit shutdown
followed by a separately selected boot, and the shared page badge.
`git diff --check` passed. Forge validated and packed version 0.2.34.

## Installed startup UI follow-up

- Replaced the native select with three themed mode buttons shared by the
  management, task, settings and controller pages. Only the selected mode's
  concise explanation is shown. Full limitations open in a native dialog so
  polling cannot interrupt reading; selection alone never boots a device.
- Grouped management startup controls in a compact card, reduced the device
  icon, and fixed the device list's minimum width at narrow viewport sizes.
- Inspected real source layout with shutdown fixture data at desktop size and
  320 × 740 in light/dark themes; innerWidth=scrollWidth=320. English mode
  labels fit by wrapping. Local artifacts: `/tmp/simulator-start-ui-*-320.png`.
- Forge installed the updated 0.2.33 test build in place into the existing
  `_ns__xd__baguette-simulator` instance, namespace `xd`, enabled=true.
  Its receipt confirmed configuration and data preservation; no second copy.
- Reopened the simulator main view in the current Cindy personal client and
  visually verified the new mode controls and startup card. Evidence:
  `/tmp/simulator-start-ui-installed.png`. No device was booted during this
  presentation-only follow-up.

## Visible readings, cache and divider — 0.2.34

- The startup-mode heading now contains a labeled info icon. Current-device
  memory/disk readings are shown directly on startup/task/controller surfaces.
  Full explanations remain in dialogs; mode selection retains its focus/DOM
  across unchanged status polls. Management list rows omit duplicate resource
  links, leaving room for device names.
- Resource sampling shares an in-process cache across GUI requests: memory
  15 seconds, disk 5 minutes; concurrent reads join existing metric work.
  The UI keeps previous values visible while refreshing. Separate timestamps
  disclose the age of each metric. Failed refreshes retain the last successful
  metric, mark it stale, and wait 30 seconds before another automatic attempt.
  First-read failures remain unavailable. Manual refresh bypasses TTL.
- Memory is invalidated on observed device lifecycle/PID changes. Late results
  cannot replace a different device or lifecycle selection. Only displayed
  devices request refresh, using existing page polling; there is no independent
  background scanner or cache persistence. Hidden task content does not sample
  alongside its visible controller. Disk may lag device writes by up to 5
  minutes unless explicitly refreshed.
- Tested actual source reads of the same dedicated shut-down device: first
  read 1,662 ms, second 129 ms. Both returned memory=0 and disk=5,393,539,072
  bytes with unchanged per-metric timestamps. Instrumented native command
  counts across both reads: ps=1, du=1, top=0. This is one measurement, not a
  general performance guarantee. No boot or data mutation was performed.
- Browser fixture checks: divider drag changed 300 to 420 px and stored the
  width; keyboard Left changed 443 to 427 px; reload retained the preference,
  reset restored 300 px. The divider changes CSS without recreating the viewer.
  Pointer capture, cancellation/lost capture and blur release the drag state.
  Narrow windows stack vertically and hide the drag handle.
- Inspected management light/dark at 320 × 740: scrollWidth=innerWidth=320,
  startup button bottom=687 px. English controller at 320 px also fit without
  horizontal overflow. Artifacts: `/tmp/simulator-ui-refinement-*-320.png`,
  `/tmp/simulator-ui-controller-light-320.png`. Browser devices were fixtures;
  these checks do not claim native streaming or recording validation.
- Installed 0.2.34 into the same `_ns__xd__baguette-simulator` instance,
  namespace `xd`, enabled=true; Forge confirmed config/data preservation.
  Reopened the actual Cindy main view and observed the new controls and real
  selected-device usage (disk 10.13 GiB). Screenshot:
  `/tmp/simulator-ui-refinement-installed-ready.png`.

## Inline metadata and automatic readings — 0.2.35

This section supersedes the separate resource card and manual refresh UI above.

- Removed the redundant off-device paragraph. Selected-device metadata now
  combines model, runtime, task state and disk usage; running devices also
  show estimated memory. List rows show the same readings, including settings
  and task device pickers. Off devices never show a memory value.
- Removed the resource dialog/card and its refresh controls. Metric tooltips
  retain scope, sample time and stale-reading explanations. The worker's
  15-second memory / 5-minute disk cache remains unchanged. Off-device GUI
  reads reuse their result for 5 minutes. Existing page refreshes request
  expired values; failures retain previous values and wait 30 seconds.
- A shared page cache joins selected-device/list requests. IntersectionObserver
  reads only visible rows; disconnected rows are discarded and hidden pages
  do not start reads. At most two requests per page execute at once. Device
  lifecycle changes clear memory while retaining disk until refreshed; late
  replies from an older lifecycle cannot replace current values.
- Full repository gates: 701 tests passed, zero failures
  (`/tmp/simulator-inline-full-gates.log`). Tests cover off-device TTL, shared
  pending reads, invisible rows, stale selection/lifecycle responses, automatic
  retry, hidden pages and absence of manual resource controls.
- Browser fixtures: inspected management at 320 × 700 in light and dark modes,
  with metadata, mode picker and Start all visible. Inspected the English hub
  controller at 320 × 700 and fixed its header to grow when metadata wraps.
  Verified running list rows include memory while shut-down rows omit it.
  Evidence: `/tmp/simulator-inline-320-{light,dark}.png`,
  `/tmp/simulator-inline-controller-320-final.png`.
  Fixtures do not prove native streaming or recording behavior.
- Final controller follow-up: 31 tests passed after the responsive header
  adjustment (`/tmp/simulator-inline-controller-final-tests.log`).
- Forge validated, packed and updated version 0.2.35 in the existing
  `_ns__xd__baguette-simulator` instance, namespace `xd`, enabled=true,
  preserving config/data. Reopened the actual Cindy main view: selected-device
  metadata and its list row both showed disk 10.13 GiB and no memory while off;
  subsequent native inspection confirmed all 12 visible rows acquired disk
  readings automatically. Evidence: `/tmp/simulator-inline-installed.png`.
  No device boot or app/data mutation was performed during this follow-up.

## Row multi-selection and batch actions — 0.2.36

- Multi-selection uses whole-row backgrounds and inverted device icons, with
  no checkboxes. Select/Done enables direct row toggling; Cmd/Ctrl-click and
  Shift-click select individual devices or a contiguous visible-list range.
  Select all applies to search results; hidden selected devices remain counted.
  Selection alone keeps the current screen unchanged.
- Batch shutdown omits devices already off. Both actions confirm exact device
  names and identity suffixes before sending sequential existing worker RPCs.
  Success clears that device's selection; known failures retain it. Unknown
  transport/execution outcomes stop the rest, without replaying mutations.
  Completed operations with record-write warnings are not offered for repetition.
- Six focused tests cover selection/ranges without switching devices, search
  scope, confirmation/cancel/frozen targets, sequential partial failures,
  uncertain results, and completed operations with record warnings.
  Selection plus existing invariants: 73 passed
  (`/tmp/simulator-batch-row-tests.log`).
- Browser fixture verification: zero checkboxes; selecting two rows sent no
  mutation. Batch deletion sent exactly fixture-0 and fixture-2 once each,
  retained fixture-1, cleared completed selections and showed 2 / 2 completed.
  Shutdown and deletion cancellation were also exercised against fixture RPCs.
  Light/dark 320 × 700 screenshots:
  `/tmp/simulator-batch-rows-{light,dark}-320.png`.
  The exact-device confirmation was inspected at 320 px; no real user device
  was shut down or deleted in these checks.
- Final repository gates: 707 tests passed, zero failures
  (`/tmp/simulator-batch-final-gates.log`). Forge validated, packed and updated
  0.2.36 in the existing `_ns__xd__baguette-simulator` instance, namespace `xd`,
  preserving configuration and data. Reopened the actual Cindy main view and
  entered Select mode: row icons remain, no row checkboxes appear, and the
  compact action bar shows the selection count and batch actions. Screenshot:
  `/tmp/simulator-batch-installed.png`. Installed-package batch mutations were
  not executed against user devices; those paths were exercised with fixtures.

## Both splitter orientations — 0.2.37

- Narrow windows retain a horizontal divider with a 10 px drag target. Dragging
  adjusts list height; wide windows retain the vertical divider for list width.
  The two preferences persist independently. Matching arrow keys adjust by
  16 px, Home/End use the available bounds, double-click/Enter resets only the
  active dimension. Responsive changes cancel pointer capture and preserve
  the saved size when temporarily clamped to a smaller window.
- Three focused interaction tests cover vertical dragging, grab offset,
  independent persistence/reopen, keyboard/reset, bounds and interrupted drags.
  Full repository gates: 710 passed, zero failures
  (`/tmp/simulator-splitter-gates.log`).
- Actual source UI with fixture RPCs: mouse-dragged width 300 → 360 px at
  1000 × 800 and height 320 → 400 px at 400 × 800. Switching layouts restored
  each size, kept the same iframe document, and 320 × 700 had no horizontal
  overflow while preserving 290 px for the detail pane. Keyboard adjustment
  survived page reload. Multi-selection was visible during light/dark checks:
  `/tmp/simulator-splitter-light.png`, `/tmp/simulator-splitter-dark.png`.
  The fixture viewer is a placeholder, so this proves iframe continuity but
  does not re-test native streaming or recording. Touch hardware was not tested.
- Forge validated, packed and updated 0.2.37 in the existing
  `_ns__xd__baguette-simulator` instance (namespace `xd`), preserving config/data.
  Reopened the current Cindy main view and observed the divider and device GUI:
  `/tmp/simulator-splitter-installed.png`. Native window size was left unchanged;
  stacked dragging was verified in the browser fixture, not against live devices.

## Direct list selection and context actions — 0.2.38

- Removed Select/Done, selection mode and the batch toolbar. Plain click views
  one device; Cmd/Ctrl toggles a row, Shift selects a visible range. Right-click
  keeps an existing selected group or replaces it with the unselected target.
  Row More opens the same menu; the detail pane's menu remains device-specific.
  Cmd/Ctrl+A selects search results; arrows and Shift navigate/extend selection.
- Browser fixture checks exercised real modifier mouse clicks, right-click on
  selected/unselected rows, row More, cancellation and confirmed batch deletion.
  Exactly fixture-0 and fixture-2 were deleted once; fixture-1 remained. No real
  device shutdown/deletion was performed. Modifier selection and context menus
  retained the same preview iframe document. Light/dark at 320 × 700 fit without
  horizontal overflow: `/tmp/simulator-context-{light,dark}.png`.
- Focused selection/splitter/invariant checks passed (77 tests), followed by
  full repository gates (711 tests): `/tmp/simulator-context-focused.log` and
  `/tmp/simulator-context-gates.log`.
- After retaining batch progress and restoring focus when menus close, the
  77 focused checks passed again (`/tmp/simulator-context-final-focused.log`)
  and the browser interaction checks above were repeated successfully.
- Forge validated, packed and updated 0.2.38 in the existing
  `_ns__xd__baguette-simulator` instance, namespace `xd`, preserving config/data.
  The current Cindy main view showed the selected row and no Select/Done or
  batch toolbar: `/tmp/simulator-context-installed.png`. Installed-package
  device mutations were not exercised against user devices.

## Choose a mode before the restart notice — 0.2.39

- Running-device mode details now contain the same mode picker as startup.
  A restart notice appears after choosing a different mode, disappears when
  returning to the verified active mode, and the badge distinguishes the active
  profile from the pending choice. Removed the prerequisite shutdown wording
  and the shutdown button from this panel. Choosing never sends a device command.
- Reuses the existing per-page device-choice map: polling and reopening the
  dialog preserve the choice; the next explicit boot from that page sends it.
  This does not add a durable, cross-page device preference. Reloading or moving
  to another viewer page can lose the choice; Agent boot defaults are unchanged.
- Full repository gates: 712 tests passed (`/tmp/simulator-pending-mode-gates.log`).
  Shared page and controller tests verify no boot/shutdown on selection, actual
  versus pending labels, choice isolation between devices, no iframe reload,
  and propagation of the selected mode to a subsequent explicit boot.
- Actual source UI with fixture data: changed a running Standard device to
  Minimal, observed the notice only after selection, closed/reopened the panel,
  then chose Standard again and saw the notice disappear. No boot/shutdown
  request was sent and the iframe document stayed identical. Inspected 320 × 700
  light/dark layouts without horizontal overflow:
  `/tmp/simulator-pending-mode-{light,dark}.png`. No native device was restarted.
- Forge validated, packed and updated 0.2.39 in the same
  `_ns__xd__baguette-simulator` instance, namespace `xd`, preserving config/data.
  Native GUI inspection after installation returned `screen_locked`; no input
  was attempted. This version's installed GUI was not visually verified.

## Inline mode tradeoffs — 0.2.40

- Updated the shared Chinese/English mode introductions to state the main
  tradeoffs directly below the picker, including Minimal's potential impact
  on login, purchases, photos, push and game services. Behavior is unchanged.
- Full repository gates: 712 passed (`/tmp/simulator-mode-cost-gates.log`).
  Browser source fixture checked all three descriptions at 320 × 700; no
  horizontal overflow or device boot/shutdown requests. Light/dark evidence:
  `/tmp/simulator-mode-cost-{light,dark}.png`. No new native device test.
- Forge validated, packed and updated 0.2.40 in the existing
  `_ns__xd__baguette-simulator` instance, namespace `xd`, preserving config/data.
  This version's installed GUI was not visually verified.

## Device list text alignment — 0.2.41

- Moved the runtime label into wrapping device metadata, removing the separate
  right-side label. Usage readings wrap within the text column; the More button
  keeps a fixed 26 px slot during hover and selection.
- Browser source fixtures with two running devices and one off device, long
  names, memory modes, usage readings and task links passed at 220/300/480 px
  list widths and a 320 px stacked window, in light and dark themes. Measured
  no list overflow or text/button overlap; selection kept text geometry stable.
  No boot, shutdown or delete request was sent. Screenshots inspected:
  `/tmp/simulator-row-layout-{light,dark}-{300,320}.png`.
- This round does not claim installed GUI or live device testing.
- Full repository gates: 712 passed (`/tmp/simulator-row-layout-gates.log`).
  Forge updated 0.2.41 in `_ns__xd__baguette-simulator`, namespace `xd`,
  preserving config/data and enabled state.

## Compact mode icon and clearer task link — 0.2.42

- Management rows show a clickable memory icon beside the name, retaining
  current/pending mode text in its tooltip and accessible label. Other views
  retain their existing mode labels. The task link now says Go to Related Task
  and always explains its destination in the tooltip.
- A Booted device without confirmed task activity shows Running; task activity
  evidence and device lifecycle behavior are unchanged.
- Browser source fixture verified icon-only rendering, opening the picker,
  changing mode without a device command, and updating both tooltip and
  accessible label without replacing the icon. Off devices have no active-mode
  icon. All three rows passed 220/300/480 px panes and a 320 px window in both
  themes, with no overflow or overlap; selection retained text geometry.
  Screenshots: /tmp/simulator-row-icon-{light,dark}-{300,320}.png.
- Full repository gates: 712 passed (/tmp/simulator-row-icon-gates.log).
  Installed GUI and live device testing are not claimed for this round.
- Forge updated 0.2.42 in the existing _ns__xd__baguette-simulator instance,
  namespace xd, preserving configuration, data and enabled state.

## Chinese viewer initialization fix — 0.2.43

- The Chinese controller HTML lacked memory-strip, memory-mode and resources.
  Its shared script stopped at the memory-mode event listener before status
  polling or screen loading. Added the same elements as the English template.
- Controller tests now derive available IDs from shipped HTML instead of a
  manually maintained list. The regression test failed before the fix with
  TypeError at control.js:375, then passed for both languages and both standalone
  and hub modes. Full gates: 713 passed (/tmp/simulator-viewer-blank-gates.log).
- Forge updated 0.2.43 in the existing xd instance. The Pro Max test device
  was Shutdown after the update. Restored
  its observed standard profile with an explicit boot; verified=true. Did not
  relaunch the previously running App. viewer open returned previewOpened=true
  for the current Cindy task sidebar.
- Opened the installed Chinese controller URL in the browser: saw the live iOS
  home screen, loaded nativeDeviceFrame and a 1320 × 2868 stream canvas. Repeated
  with embed=hub and dark theme; the title and live screen both rendered.
  Visually inspected /tmp/simulator-viewer-blank-fixed.png and
  /tmp/simulator-viewer-blank-fixed-hub.png. Native Cindy window rendering was
  not separately captured.

## Inline viewer mode — 0.2.44

- Removed the separate mode strip in both shipped templates. A clickable
  parenthesized mode now follows the memory reading; tooltip/accessibility
  retain the full mode description, including pending restart choices.
- Browser source checks covered both languages, standalone/hub, light/dark,
  same-line placement at 700 px, no overflow at 320 px, and changing the pending
  mode from the inline button. Full gates: 713 passed
  (/tmp/simulator-inline-mode-gates.log).
- Forge updated the existing xd instance to 0.2.44. After warning that the plugin
  update closes the device, restored the Pro Max's verified standard mode and
  reopened the current Cindy task viewer (previewOpened=true). No App relaunched.
- Inspected the installed Chinese live viewer: home screen renders, no mode
  strip, memory reading and （标准） share a line. Evidence:
  /tmp/simulator-inline-mode-installed.png. Native Cindy window not captured.

## Boundaries

The installed-package boot/streaming check above covers iOS 27.0 only. No Android
live run, other iOS runtimes or full game acceptance test in this round. UI text follows the existing Chinese /
English fallback convention. Existing service-profile and input evidence in
`VERIFICATION-input-lifecycle.md` remains applicable to unchanged behavior;
installed-package evidence is limited to the receipts and observations above.
