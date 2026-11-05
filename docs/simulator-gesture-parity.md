# Simulator two-contact parity — 2026-11-06

Source: `cindy/noble-lederberg`, simulator plugin 0.3.38. This extends the same
feature line as the Fit/rotation fixes; no host changes are required.

## Scope and cause

The reference is ordinary iPhone interaction. iPhone/iPad flat views and Android
already opt into native AppKit contact frames. Duo's 3D Interact view did not mark
a native capture surface; its wheel/Safari/hover sources also used the entire
canvas bounds, while mouse and raw contacts used screen projection. The marker
cannot simply go on the canvas: native capture scales movement by the marked
surface's long edge, so camera margins would amplify motion and accept blank space.

The new 3D surface follows the bounds of lit screen pieces and clips hit testing
to those pieces. It uses the existing `data-cindy-trackpad="contacts"` contract.
Every Baguette gesture source now receives the same forward/inverse projection;
HUD points are projected from dispatched device coordinates, relative to the HUD
host, including rotated/half-folded screens. Pointer input, Option/Option+Shift,
wheel fallback, Safari fallback and native contacts retain their original meanings.
iOS wheel pinch now consumes invisible scale at the edges, matching the existing
Android immediate-reversal rule and line/page wheel normalization. Geometry updates
do not rebind active gestures. Panel/hinge/orientation changes, mode switches,
stream stop and the existing blur/hide/parent-release boundary release old input.
While the embedded rotation snapshot is visible, the hidden live stage does not
accept pointer input; normal hit testing resumes when the transition finishes.
Native pairs remain atomic. When one finger lifts, iOS switches between its
single/two-contact protocols; Android releases that pointer independently.

Supported parity: iPhone, iPad, Duo closed/half-open/flat and Android touch-screen
simulators. Apple TV sends Siri Remote contacts; Vision Pro sends spatial input.
Those transports do not implement ordinary phone two-touch gestures and retain
their platform meanings. Physical-device input is outside this simulator change.

## Reproduction and dependency review

Only local Web JavaScript changes within the verified Baguette v0.2.10 source;
no native binary/dependency version, network destination or host permission changes.
`vendor-web.patch` has the changed files regenerated against the existing pinned
source archive. Dry-run applying the complete patch to that source succeeds.
`vendor-inventory.json` updates only the ten changed Web files; records for
unchanged optional downloaded artifacts are retained. `native/inventory.mjs
--check` passes. A whole-record regeneration requires optional OCR/3D assets not
present in this checkout; none of those assets changed. License attribution and
`VENDOR-REVIEW.md` record this patch.

## Evidence and acceptance limits

- The required full suite passed 853 tests. After the final rotation input gate,
  the affected rotation, gesture projection and cancellation suites passed all
  15 tests; `git diff --check` also passed.
- Forge updated the existing local simulator instance to 0.3.38. The final
  installed package (without source overrides) repeated the runtime cases below
  successfully, and the original Boli Duo was reopened in the Cindy task sidebar
  (`previewOpened: true`) in standard memory mode.
- Shared deterministic cases compare flat and rotated 3D mouse pinch/pan, wheel
  pinch/pan, native atomic pair/move/reversal/liftoff, Safari scale/rotation and
  hover previews. Dispatched device contacts match after coordinate projection.
- Geometry tests round-trip contacts through both folded halves, validate the
  native marker bounds/clip path and remove native capture in camera Pose mode.
- Existing iPhone/Android parity and all-source cancellation cases are retained;
  dedicated edge cases check immediate pinch reversal instead of hidden-scale lag.
- Source-override runtime: original plugin-managed Boli Duo UI v25, iOS 27.1,
  standard memory mode; headless Chrome at 540×1000 CSS pixels/DPR 2. Real 3D stream
  metadata was used for closed, flat, half-open and closed again, then both rotation
  directions. Both projected contacts hit the lit capture surface in each pose.
  Synthetic native contact frames sent exactly touch2-down / two touch2-move /
  touch2-up messages through the real socket; there was no artificial touch1
  prelude. The stationary point stayed fixed through reversal; HUD positions
  matched projected contacts and cleared on end. No script error or extra 3D
  stream occurred. This proves browser-to-simulator delivery, not physical AppKit
  capture or an App's gesture recognition behavior.

**User acceptance:** after 0.3.38 was installed and the original Duo reopened in
the Cindy development task sidebar, the user confirmed the result was satisfactory
and requested the PR on 2026-11-06. This is user-reported acceptance of the installed
Duo, separate from the automated evidence above. The user did not provide a
per-gesture/per-device checklist, so it does not establish fresh physical testing
of every iPhone/iPad/Android model. AGENTS.md requires real sidebar trackpad input
covering pinch, immediate reversal, rotation and pan; independent windows and
synthetic replay cannot substitute for any remaining physical comparison.
