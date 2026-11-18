# PR follow-up wake batching verification — 2026-11-10

## Scope and baseline

This change builds on #311 / `0a380468f5d1a9f417cd9642d2d1da09de07a310`.
The installed gate, follow-wait and follow-pacing source were byte-equal to that
baseline during investigation: this was a decision-logic gap, not a missed deployment.
Candidate plugin: cindy-github 1.5.8. Environment: macOS, Node.js v22.21.1.
The executing Cindy reports development version 0.0.0; its exact host source was
not established. No new host API, permissions, dependencies, state schema or schedule
is introduced; minimum host version and existing delivery protocol are unchanged.

## Root causes and changes

- #311 filters unrelated base changes, but each successful named check separately
  generates `wait-changed`. That bypasses the ordinary aggregated checks milestone.
  A checks wait now absorbs partial successes while another named check is pending,
  including the ordinary required-check success event. It retains the original deadline.
- #287 treated any bot comment, inline finding or reaction as an answer. A Running
  summary or EYES could close the window early. Only a submitted APPROVED,
  CHANGES_REQUESTED or COMMENTED review, or THUMBS_UP, now counts. Existing head/time
  matching remains. Unknown/comment-only output waits at most the original 20 minutes.
- Missing targets, failure results, and recovery of an already-failed target remain
  actionable. Human/baseline/retry waits retain their per-target semantics.

Do not change only `inspectWait`: the ordinary required-check milestone is a second
route to a model wake. Do not infer completion from arbitrary comment text. The tests
below cover the two routes together, using the actual gate and persisted state.

## Reproduction and regression evidence

Three new replay tests failed against the unchanged baseline before the production
code was edited: partial CI success woke the model; the safety matrix could not get
past its initial quiet partial-success step; bot progress closed the settle window.
The same tests now pass.

- Twenty named checks complete one by one, with the first required and every poll
  host-triggered: first 19 successes skip, final completion wakes once. Progress never
  extends the original deadline; acknowledging completion prevents duplicate delivery.
- During the batch: failure, human/bot feedback, reopened thread, conflict, missing
  check, incomplete observation, merge, closure and deadline each still wake.
- Bot Running + EYES + an inline finding stays held, then a submitted review releases
  the accumulated failure and finding. Pending reviews and unknown comment-only output
  do not prove completion; the existing maximum window remains bounded.
- Actual Node CLI child processes (synthetic snapshots, isolated temporary state):
  install wait, skip first success, release final completion, receive later feedback,
  and finish the slower first round. The earliest pending observation remains intact
  and the later feedback is released after the first acknowledgement.
- Existing replay coverage remains green: unrelated base churn, baseline recovery,
  same-result reruns, head changes, reopened threads, deadlines, interrupted rounds,
  retry backoff, host triggers and human interruptions of bot batching.

Command:

```sh
node --test .tests/cindy-github-pr/*.test.mjs .tests/cindy-github.test.mjs \
  .tests/plugin-contract.test.mjs .tests/localization.test.mjs \
  .tests/provisioning.test.mjs .tests/publish-workflows.test.mjs
```

Result: 411 passed, 0 failed, 0 skipped. `git diff --check` passed.
Forge produced `cindy-github-1.5.8.cindy`; archive inspection confirmed root manifest
version 1.5.8 and byte equality of all three changed scripts with candidate source.

## Validation boundary

Replays use controlled GitHub facts and exercise the real gate/CLI and disk state;
they do not run a model, change GitHub, or mutate live scheduler records. The candidate
has not been installed. No claim is made that live tasks are already using it or that
minimum-host compatibility was newly exercised. After authorized deployment, verify
an actual task's loaded script and confirm that sequential successful CI completions
produce skips, with a single wake at batch completion or its original deadline.
