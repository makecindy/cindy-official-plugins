# Memory modes, input and presentation verification

Date: 2026-10-27 (Pacific/Auckland). Candidate: 0.2.32, based on main `daccdd7`.

## Automated checks

Repository contract, localization, provisioning, publishing and simulator suites:

```sh
node --test .tests/plugin-contract.test.mjs .tests/localization.test.mjs .tests/provisioning.test.mjs .tests/publish-workflows.test.mjs .tests/baguette-simulator.test.mjs
```

659 tests passed for the combined memory/input candidate (0 failures, skips or cancellations). Added cases exercise the real controller/keyboard scripts, native release adapter and mocked subprocess boundaries: device keyboard gating on iOS/Android, workbench fields/buttons remaining usable, storage unavailable, focus/page-hide cancellation, complete listener removal, delayed Apple keyboard cleanup, advanced-panel stylesheet toggling without replacing the iframe, and ABI-check failure preserving usable catalogs. The existing deadline fixture now supplies the timer APIs used by native keyboard cleanup; its original partial-input and deadline assertions are unchanged. Memory tests cover tested service sets, default/switch/restore, preserving unrelated overrides, live-device refusal, external startup, corrupt/symlink stores, actual override parsing, partial boot failures, page/settings RPC parameter forwarding, and retaining UI choices across polling. Vendor inventory and `git diff --check` pass.

## Real source runtime

- Apple Silicon Mac, macOS 27.0.1, Xcode 27.1 build 27A9269, iPhone 17 Pro / iOS 27.0, existing dedicated SimSlim comparison device and native SwiftUI probe.
- Rebuilt/ad-hoc-signed `native/keyboard` from the source and flags in `native/build.sh`; signature verification passed. `--check` returned `ready:true, scope:keyboard-abi`. Actual `environment` returned both catalogs and that scoped diagnostic.
- Served the candidate Baguette binary, current controller and clipboard proxy in a separate source-only server; no installed plugin or saved viewer-session address was replaced. The small preview adapter restricts input to the dedicated test device and delegates its input to the source core.
- Focused the probe field by real simulator touch. A browser keyboard event delivered `a`, verified from the native accessibility tree (`Echo: a`). Disabled Computer keyboard input through the menu; another browser event (`b`) was blocked and the native field remained `a`. The choice persisted after navigation. The guest's `HardwareKeyboardLastSeen` read back as `0` after the existing delayed cleanup.
- On the final controller source, started a real browser recording and expanded advanced tools through its menu. The iframe Document identity stayed equal, recording remained active, and the embedding stylesheet became disabled so the complete workbench was available. Stopping produced a nonempty MP4 blob (2,126,344 bytes). The test did not export the movie to the user's files.
- Live light-mode screen and the new keyboard checkbox were inspected. The checkbox uses existing menu components and theme styles.

## Memory mode integration

- The source core booted the existing dedicated iPhone 17 Pro / iOS 27.0 device without memoryMode: active launchd overrides read back as saving, verified=true, 56 catalog services disabled.
- Requesting minimal while it was running failed with MEMORY_MODE_REQUIRES_SHUTDOWN before any shutdown or rewrite. Explicit shutdown followed by minimal boot read back 168 disabled; shutdown followed by standard boot read back 0. The existing native probe then launched successfully. No user devices were stopped or modified.
- A separate source controller server exposed the exact new control page and delegated boot to the source core. Its start UI showed saving by default; choosing standard and clicking Open booted the device. A separate core boot read (already Booted, execution=not_executed) returned standard, verified=true, 0 disabled, confirming the UI choice reached the actual simulator.
- Inspected the stopped-device start card in light/dark modes and at a 320×700 CSS viewport (dark). Document width/scrollWidth were both 320; selector, explanation and start button remained visible without horizontal scrolling. Other page boot bridges and the shared picker have automated coverage; packaged Cindy task/settings/main-view integration was not installed in this session.
- This change redistributes only pinned SimSlim 0.12.2 category/service labels, not its executable. Live tests confirm service settings, not a fresh performance benchmark. Earlier 0.12.2 measurements (saving about 12–17%, minimal about 64–66%) used the same 56/168 service sets and are specific to that environment; no fixed reduction or complete game compatibility is claimed. Previously observed minimal-mode photo and Live Activity failures inform the new warnings.
- Cleanup: restored standard, shut down only the dedicated test device, closed the test browser tab and stopped the source preview server. Installed plugin and saved viewer-session addresses remain untouched.

## Review follow-up: boot warnings

- The final follow-up suite passed 662 tests (0 failures, skips or cancellations). Three added tests cover the shared result formatter, warning persistence over the live controller through polling and dismissal, and task/management/settings entry points retaining the original boot result and requested mode. Unverified, mismatched and custom modes are covered; backend diagnostics use text nodes, including an HTML-shaped test string.
- A local static preview loaded the exact shared renderer and both page/controller stylesheets with an injected unverified/mismatched result above a viewer placeholder. Light/dark screenshots at 320×700 showed the complete, wrapping notice and its dismissal button; width and scrollWidth were both 320. Clicking Dismiss removed it. This verifies presentation, not a real service-verification failure or packaged Cindy integration.
- The simulator core, service configuration and input/recording implementation did not change in this follow-up; the real source evidence above remains applicable. No simulator was started for the injected warning preview.

## Remaining limits

This is source/browser/native evidence, not installation acceptance of the packaged candidate in Cindy. Android input gating has automated coverage; no Android device was booted for this change. Moving a whole Cindy task panel between host windows and physical-phone remote viewing were not repeated. No new host-window ownership architecture is claimed. Keyboard ABI availability does not prove gesture support, input delivery, or exclusive display ownership. No global Xcode host routing/preferences or Device Hub processes were changed. Memory mode runtime evidence covers iOS 27.0/Xcode 27.1; other iOS runtime versions and full game login/payment/ads/controller flows remain unverified. External tools must not concurrently start the same private device during its stopped-store update.
