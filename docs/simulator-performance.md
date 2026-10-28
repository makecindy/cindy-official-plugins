# Simulator performance replay

[简体中文](simulator-performance.zh-CN.md)

## Scope and reproducibility

This is a fixed toolchain replay, not an end-to-end Agent benchmark. No model,
harness or reasoning-effort speedup is inferred. Raw histories, App bundles,
device identifiers, profiles and screenshots are private local artifacts and
must not be committed.

The baseline is commit `64bbaf3f253b3f118c2a0a40ee67020d945d94dd`, plugin
`0.2.23`; the measured candidate is the frozen `0.2.24` source diff retained
in private evidence. Both measured versions use the same bundled native runtime.
Before PR submission, the implementation was rebased onto `b825436` (plugin
`0.2.29`, screenshot orientation/export fixes) and versioned `0.2.30`. The
statistics below remain the original 0.2.23/0.2.24 comparison, not measurements
of 0.2.30. The installation/verification code is unchanged by that rebase.
Review follow-up `0.2.31` adds a confirmation scan before reusing a receipt;
its affected performance results are reported separately below.
This PR introduces no dependency, permission, platform authorization, plugin
identity or publication setting changes.

The replay adapter in `.tests/baguette/replay-worker.cjs` loads each revision's
actual runtime and core. It substitutes only the private state root, equally
for both revisions. It never replaces an installed Cindy plugin. The state
directory must contain a `replay-only` sentinel and a dedicated simulator set;
do not point it at shared devices. Fault modes intercept only viewer readiness
or screenshot transport, retaining real native App launch and touch delivery.
They do not inject App functions. Fault results are separate from normal
latency, and do not prove reproduction of a historical native-library failure.

Create a private JSON config with `baseline`, `candidate` (plugin source
directories), `root`, `udid`, `appPath`, `bundleId` and `output`. Keep it outside
version control. The root's `runtime-settings.json` should contain
`{"enabled":true,"idleMinutes":0}`. Create a fresh device in `root/devices`
using an installed runtime and boot that exact set/device. Freeze the App and
its complete file-content manifest before testing; keep executable, resource
and signing-resource fingerprints for historical identity checks.

Run the checked-in scripts from the repository root:

```sh
python3 .tests/baguette/performance-replay.py /private/replay/config.json --case install --first --rounds 3
python3 .tests/baguette/performance-replay.py /private/replay/config.json --case info --rounds 5
python3 .tests/baguette/performance-replay.py /private/replay/config.json --case install --rounds 3
python3 .tests/baguette/recovery-replay.py /private/replay/config.json --mode touch --rounds 5
python3 .tests/baguette/recovery-replay.py /private/replay/config.json --mode capture --rounds 5
python3 .tests/baguette/recovery-replay.py /private/replay/config.json --mode viewer --rounds 5
```

Use a distinct `output` directory per run. Recovery config also needs `env`,
`arguments`, `initialText`, `targetText` and a `tap` object. A restored live scene
can set `keepRunning: true`, its verified `appPid`, and native `prepareSteps` /
`cleanupSteps`; this avoids activating or relaunching the App between trials.
Only rejected preparation with an explicit `not_executed` geometry error permits
one retry, after a successful independent screenshot. Measured input is never
retried. Failed calls remain in the raw record. Resolve these inputs from
the historical build and a fresh screenshot; verify the intended screen after
every action. `--first` uninstalls only the configured App from the dedicated
set. Other cases do not erase devices. Trials alternate AB/BA order, with
preparation recorded separately. OS caches are not purged: "first install"
means App absent, not cold storage. Repeated-info preparation performs one full
comparison per worker; subsequent rounds retain those receipts. Repeat-install
preparation fully verifies each revision before measurement because the older
revision may replace the installed container.

## Verification contract

Metadata reads do not assert build equality. Full comparisons checksum all
bundle content with rsync and compare executable identity. Symlink targets are
compared independently because macOS openrsync can omit them from dry-run
itemization. A receipt is local
to the worker, valid for at most one hour, and reused only after both complete
trees still have identical paths, inode/device, type/mode, size, nanosecond
mtime/ctime and symlink targets. In 0.2.31, two successive traversals of both
trees must match the receipt, so changing an already-visited resource during
the first traversal invalidates reuse. Equal-size resource edits with restored
mtime invalidate it. A change during full verification cannot produce a receipt.
This assumes normal local-filesystem change semantics; it does not verify App
data, running memory or external content, or continuously monitor later writes.

Install and verification share the existing job API. Stage names and elapsed
times are actual observations, not invented percentages. Status waits return
early on completion and recommend 85 seconds; different devices can wait in
parallel. A failed comparison remains unconfirmed, not evidence for reinstall.
After confirmed input, observation has a separate bounded budget. Recovery
never repeats that input or relaunches a confirmed App. Existing orientation,
panel and uncertain-dispatch protections remain in place.

## Results

Measured on 2026-10-25: Mac Studio M5 Ultra, 36 cores, 256 GB; macOS 27.0.1
`26A434`; Xcode 27.1 `27A9269`; dedicated iPhone Air, iOS 27.0 `24A434`.
The frozen historical game bundle contains 6,759,470,259 bytes and 99,469 files.
Executable, main resource, resource-index and signing-resource fingerprints
match the historical record; strict deep code-signature verification succeeds.

The historical reward scene was restored from its temporary save in an isolated
profile. Native joystick movement and NPC interaction recreated the scene;
there was no injected driver or App-function call. The original reward tap,
observation parameters and equipment-detail goal were replayed. Both versions
start each measured click with the same unselected reward panel. The displayed
reward names and equipment statistics match the archived screenshots. Scene
preparation and the camera's world position differ from the historical injected
fixture; this is not a claim of replaying the entire original Agent session.

These measurements include the real plugin runtime, native input, file capture,
jobs and OCR goal checks. They exclude Cindy bridge/Host page rendering, model
image attachment and model reasoning. Setup and cleanup are recorded separately.
P90 uses nearest rank; with fewer than ten samples it is the maximum. Small
samples describe these runs, not a population-level speed guarantee.

Both scripts use `wait=85` for status queries. This isolates runtime changes; it
does not assume the historical `wait=1` calls were all separate model turns.
The wait recommendation is a usability improvement, not a measured model-speed
claim. First-install timing ends at confirmed build identity; launch and visible
scene acceptance are recorded in the subsequent native scene/recovery runs.

The viewer fault case uses an already-running App and an explicit
`launch(relaunch=false)`, then fails viewer readiness after 12 seconds. It tests
retaining that process and obtaining a frame; it is not a cold-launch benchmark.
Capture faults affect the attached screenshot after an acknowledged native tap.
Both revisions then independently capture and verify the equipment-detail goal.

| Case | Rounds per version | Old median / P90 (s) | New median / P90 (s) | Goal success old / new |
|---|---:|---:|---:|---:|
| First install + full build check | 2 / 2 | 105.33 / 110.13 | 104.94 / 106.94 | 2/2 / 2/2 |
| Repeated build check, warm receipt | 5 / 5 | 65.06 / 92.88 | 2.02 / 6.26 | 5/5 / 5/5 |
| Normal click → goal (initial series) | 5 / 5 | 9.45 / 9.72 | 9.37 / 9.77 | 5/5 / 5/5 |
| Normal click → goal (additional series) | 3 / 3 | 8.36 / 8.92 | 8.50 / 10.38 | 3/3 / 3/5 |
| Capture timeout → goal | 5 / 5 | 48.38 / 49.90 | 19.08 / 21.15 | 5/5 / 5/5 |
| Viewer failure → observed goal | 5 / 5 | 20.28 / 20.62 | 20.61 / 34.22 | 5/5 / 5/5 |
| Repeat install + build check | 2 / 2 | 91.39 / 101.17 | 3.00 / 3.45 | 2/2 / 2/2 |

| Case | Version | Measured / attempted calls | Failed calls | Measured wait (s, sum) | Preparation + cleanup (s, sum) | Separate observation retries | Input retries |
|---|---|---:|---:|---:|---:|---:|---:|
| First install + full build check | baseline | 6 / 8 | 0 | 66.79 | 0.79 | 0 | 0 |
| First install + full build check | candidate | 8 / 10 | 0 | 203.43 | 0.70 | 0 | 0 |
| Repeated build check, warm receipt | baseline | 5 / 6 | 0 | 0.00 | 97.50 | 0 | 0 |
| Repeated build check, warm receipt | candidate | 5 / 7 | 0 | 0.00 | 105.82 | 0 | 0 |
| Normal click → goal (initial series) | baseline | 10 / 35 | 0 | 26.09 | 96.55 | 0 | 0 |
| Normal click → goal (initial series) | candidate | 10 / 35 | 0 | 25.91 | 96.97 | 0 | 0 |
| Normal click → goal (additional series) | baseline | 6 / 18 | 0 | 13.76 | 47.08 | 0 | 0 |
| Normal click → goal (additional series) | candidate | 6 / 22 | 2 | 15.11 | 69.99 | 0 | 0 |
| Capture timeout → goal | baseline | 15 / 35 | 0 | 20.78 | 66.63 | 5 | 0 |
| Capture timeout → goal | candidate | 15 / 35 | 0 | 22.10 | 70.64 | 5 | 0 |
| Viewer failure → observed goal | baseline | 15 / 35 | 0 | 20.87 | 66.24 | 5 | 0 |
| Viewer failure → observed goal | candidate | 10 / 30 | 0 | 27.79 | 81.43 | 0 | 0 |
| Repeat install + build check | baseline | 6 / 8 | 0 | 89.11 | 129.41 | 0 | 0 |
| Repeat install + build check | candidate | 6 / 8 | 0 | 0.71 | 114.33 | 0 | 0 |

Repeated build-check median fell by 96.9%; repeated install by 96.7%. Both are
warm, previously verified cases. The first full verification remains necessary.
This historical bundle omits optional `CFBundleSupportedPlatforms`; the old
installer recopies it, whereas the candidate may safely skip an unchanged,
verified native iOS bundle. It still reserves incremental sync for explicitly
native platform metadata and retains full installation for Vision compatibility.

First installation and ordinary clicks show no meaningful improvement. The
capture-timeout recovery median fell by 60.6%, including the successful follow-up
frame and goal check. The tap call itself fell from 42.41 to 12.94 seconds: the
old observation makes two capture attempts; the bounded observation makes one.
Each version still uses one separate screenshot afterward. Every measured click
has one native input envelope and zero input retries. Both fault groups verify
the original App PID remains alive.

Viewer recovery is not a latency win: median 20.28 → 20.61 seconds, P90
20.62 → 34.22 seconds. The candidate incorporates one screenshot per trial,
reducing measured calls from 15 to 10 over five trials; it does not relaunch the
App automatically. Five expected observation failures per version in each fault
group are retained as partial results, not thrown tool errors. The zero failed
calls in those rows do not mean no injected failures occurred.

Call and preparation totals include failed attempts. Wait time is elapsed time
inside measured `install_status` / `wait_for` calls, including checksum, capture
or OCR work; it is not CPU-idle time. The candidate's first-install wait total is
larger because full verification is in the job, whereas the old version blocks
inside `info`. P90 and medians include only completed goals; failure rates remain
visible alongside them. Initial ordinary-click preparation includes an explicit
non-relaunching activation before each trial; the additional series and final
fault groups keep the App running without that activation.

### Interrupted runs and remaining limits

The first dedicated device completed initial install/info and the five-round
ordinary-click comparison. During later exploratory fault runs, four preparation
attempts aborted with five failed calls across both versions: screen geometry or
native display binding was unavailable. Those records are retained. We shut down
that test device and created a second device with the same specifications and
frozen build. Final viewer/capture groups each completed five rounds per version
on the second device.

An additional ordinary-click series on the second device completed three goals
per version, but candidate preparation aborted twice (`SCREEN_UNAVAILABLE`,
`INPUT_FAILED`, both `not_executed`). An independent screenshot recovered once
in 4.58 seconds with the same PID; cancelling the observed panel added 5.06
seconds (two extra calls, outside the timing table). A later input-binding failure
ended the series without resending input. Baseline preparation for a separate
extended acceptance check then reported the same binding failure. These failures
are not assigned to the optimization without causal evidence, and this patch
does not establish a fix for native geometry/display-binding instability.

The original exploratory implementation used asynchronous stat calls per file
and was slower. It was replaced with small yielding batches, refrozen and
remeasured; those earlier results are retained separately, not included as final
candidate measurements. The final Host routing correction preserves the resolved
device and task context during fallback. Backend measured files are unchanged;
Host behavior is covered by mocked regressions, not real Host latency evidence.

Android, tvOS and Vision Pro were not runtime-benchmarked here. No dependency,
permission or Host grant changed. At the 0.2.24 freeze, the required
repository/plugin suite passed 623/623 tests and the official packer validated
and created version 0.2.24. No plugin was installed into shared Cindy.

A separate, untimed extended acceptance run initialized the dedicated device
after ending the interrupted series. Both revisions restored the same native
save and passed reward selection, shield-detail switching, cancel/reset, and one
claim followed by the next quest page. This initialization is not recovery.
Two incorrect OCR expectations were corrected from observed text; the failed
assertions remain in the private record. No input was blindly repeated and no
App functions were injected. Both dedicated devices were shut down afterward.

## PR submission verification: 0.2.30

After integrating main's screenshot orientation/export fixes, the required suite
passes 635/635 and the official packer produces 0.2.30. The final source was
loaded in an isolated worker on the same dedicated device, historical build and
native save. One visual acceptance run per path confirmed:

- Normal reward tap: the upright screenshot shows the selected equipment and
  59 damage per second; exactly one native touch envelope.
- Capture timeout after selecting the shield: one delivered input, one failed
  capture, observation bounded to 12.003 seconds. A separate screenshot shows
  the selected shield and 8 physical defense; no input replay and the same PID.
- Viewer failure with `launch(relaunch=false)`: one explicit launch request,
  the original PID retained, and the inline fallback screenshot still shows
  the shield details. No recovery launch or termination.

These are compatibility checks, not new A/B statistics. The fixed recovery
script first aborted in preparation: `wait_for` returned `met=false` with no
recognized text after its 30-second search, although its attached screenshot
visibly showed the correct reward panel. That failed attempt is retained. An
independent screenshot established the current state before the separate visual
acceptance run; it does not turn the failed automatic assertion into a pass.
This PR does not claim to fix text-wait reliability. The dedicated device was
shut down after verification; shared devices and plugin installations were untouched.

## Review follow-up: 0.2.31

Receipt reuse now requires a second complete metadata traversal of both trees.
The regression changes an already-visited file while the first traversal
continues, preserving size and mtime; info must report a mismatch and install
must synchronize instead of skipping. Source and installed trees are both
covered. Android now resets the post-`until` observation deadline to the lesser
of the original deadline and 12 seconds from the wait result. Fast/slow waits
and an earlier original deadline are covered. The required suite passes
644/644 and the official packer produces 0.2.31. Android evidence is simulated;
the Apple screenshot and viewer paths are unchanged from the 0.2.30 visual checks.

Two fresh attempts to repeat the 0.2.23 baseline on the same dedicated device
aborted during preparation: checksum comparison returned unconfirmed after
110.079 and 110.020 seconds. Neither established build equality; neither counts
as a successful latency sample, and neither triggered a recovery installation.
Both raw attempts are retained, including the second attempt with OS caches
already partly warmed. They do not replace the earlier completed 0.2.23/0.2.24
data.

The supplemental comparison uses the submitted 0.2.30 commit `3716260` versus
the frozen 0.2.31 candidate, the same dedicated device and historical bundle,
and the unchanged replay script. This isolates the cost of the confirmation
scan; it is not the original optimization baseline. Each worker first completes
full verification, then trials alternate AB/BA without purging OS caches.

| Repeated build check | Rounds / successful goals | Median / P90 (s) | Measured / total calls | Full preparation (s) | Measured status-wait (s) |
|---|---:|---:|---:|---:|---:|
| 0.2.30 | 5 / 5 | 18.59 / 33.27 | 5 / 10 | 347.21 | 0 |
| 0.2.31 | 5 / 5 | 32.08 / 40.67 | 5 / 9 | 305.36 | 0 |

There were no failed calls, input retries or observation retries in this group.
The confirmation scan adds 72.6% to the median in this supplemental series;
it is a correctness cost, not a speed improvement. These workers both ran at
nice level 5, with no CPU isolation or storage-cache purge. Host load and cache
conditions were not held constant across series, so do not compare absolute
latencies across series or apply the original percentage improvement to 0.2.31.

| Repeated install + build check | Rounds / successful goals | Median / P90 (s) | Measured / total calls | Preparation (s) | Measured status-wait (s) |
|---|---:|---:|---:|---:|---:|
| 0.2.30 | 2 / 2 | 81.62 / 93.59 | 6 / 10 | 241.91 | 72.29 |
| 0.2.31 | 2 / 2 | 77.26 / 86.65 | 6 / 13 | 506.44 | 75.57 |

All four installs returned `unchanged`; each subsequent check confirmed the
bundle. Failed calls and retries were zero. With only two samples per version,
this group does not establish a consistent speedup. The unchanged script forces
candidate full verification before each install round; 0.2.30 auto verification
can reuse its receipt in round two. Preparation is therefore reported separately
and is not a comparison of full-verification performance. Both dedicated devices
were confirmed shut down after the replay. Raw records, frozen sources and
scripts remain private local evidence.
