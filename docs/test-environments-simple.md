# 1.2.1: choose a project, then start

[简体中文](test-environments-simple.zh-CN.md)

Home retains local/SSH, project and Start. A running instance uses one status panel
with sign-in guidance and available sample/check/capture/results/stop actions,
rather than five step cards and a project-creation form.

## Use

1. Choose project… opens **Cindy's native directory dialog** for the source folder.
2. Start test. Complete first sign-in normally in the target app; subsequent runs
   reuse the same persistent test profile.
3. Prepare/check as instructed, capture before stopping, then Stop.

Selection/cancellation never launches. Re-selecting a canonical directory reuses
its project/profile and account selection without another name/path/ID/isolation
form. Advanced management retains custom configuration, history and diagnostics.
SSH still previews its exact PR revision before explicit start.

## Reuse

- Public cindy.pick({mode:'directory'}) delegates native UI, consent, cancellation,
  throttling, busy handling and pick grants to Cindy. No copied picker or Host DB scan.
- The Host-picked absolute path goes through main to Node; the page receives
  project/profile references, not the raw picker receipt.
- Node atomically reuses/creates test references/defaults, without modifying Cindy's
  global project registry.
- pick:true is solely for user-selected directories; existing node filesystem
  authority does not expand. No workspace/background Agent capability is added.
- Only a user click opens the chooser. Cancellation never saves/starts/reopens;
  unsupported clients get explicit execution-computer/advanced guidance. Requests
  remain deduplicated while the dialog is open, resend stops after acknowledgment,
  and selection can wait up to 30 minutes.

Cindy's useProjectPickerOptions/FolderPickerPopover use recent directories/aliases
but are private renderer components without a current plugin picker API. This
reuses native directory selection, not the Host recent-project list. No private
component copying, database reading or main-application changes are introduced.

Source checked: Cindy 70eb974da4d3792cc5feabc8bdc9ee1e1f06233d,
apps/desktop/src/main/cindy-brain/pickSlot.ts and
apps/desktop/src/renderer/hooks/useProjectPickerOptions.ts; SDK contract from the
current Host Forge §4.14. Missing native support fails explicitly while preserving
other functionality.

## Evidence boundaries

Tests cover native SDK bridging/cancel/deduplication/unavailable/busy, project reuse,
no automatic launch, browser clicks, unpacking and real Git/OpenSSH loopback.
Browser picker responses use an explicit adapter, not actual OS-dialog acceptance.
Formal accounts, two real computers and hardware still need their own evidence.
Author remains omitted. Final results/package digest are recorded in #309.

The 1.2.1 combined run passed **134/134, zero failures/skips**: 101 repository/local/SSH
checks, 3 native-picker bridge checks, 28 browser cases, 1 unpacked-package workflow
and 1 real OpenSSH loopback (13 internal assertions). Environment: macOS 26.7.1,
Node v22.23.2, Chromium 157.0.8103.38, OpenSSH 10.3p1. Final repackaging only
clarifies existing loopback evidence in the READMEs; runtime bytes match the tested package.
