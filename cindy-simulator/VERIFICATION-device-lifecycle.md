# Device lifecycle verification — 0.3.42

Scope: Agent/manual provenance, reuse without erase, persistent idle eligibility,
72-hour excess / seven-day retained reclamation, use protection and audit results.
No UI additions, native/vendor changes, permissions or new Host APIs.

Automated runtime tests execute the production runtime, task bindings and lifecycle
store against temporary files and a deterministic device backend/clock. They cover
reuse and task isolation, explicit permanent retention, manual/legacy/physical
protection, threshold boundaries, worker restart, active viewing/running/unknown
states, external-use conservatism, long waits, read-only polling, failed/partial
deletions, corrupt records and a concurrent boot during collection.

The same common runtime serves Apple and Android creation/deletion. Native device
operations retain their existing backend implementation. These tests do not claim
real-device deletion, elapsed wall-clock 72-hour testing, or installed-plugin UI
acceptance. The new package has not been installed or published by this change.

Host check on 2026-11-07 reported a development build (`0.0.0`). Local application
provenance named `ff53fc22b9cd251e48e786f121206c412349bf0b`, unavailable in the
local official source repository/its remote. Matching historical Host source could
not be verified. Existing `cindy.node.request` and tool-call routes are reused;
there is no new Host API dependency or compatibility version claim.

Validation on 2026-11-07:

- Repository gates plus `.tests/cindy-simulator.test.mjs`: 875 passed, 0 failed.
- Final `.tests/baguette/device-lifecycle.test.cjs`: 16 passed, 0 failed,
  including an additional post-delete bookkeeping failure case and final
  provenance metadata changes after the full run.
- `git diff --check`: passed.
- Host Forge validated and packed version 0.3.42; no installation/publication.
