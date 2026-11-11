# Simulator UI reuse — 2026-11-11

Source: `dash/simulator-remote-view`, based on c218ec0d; package 0.3.44.

- Task device selection uses one group-rendering path for local and remote tasks.
- Controller menus use one row renderer for both computers; operation routing remains separate.
- Physical-phone and remote screens use the same DeviceShell class in `node/physical/shell.js`. Existing physical asset URL/path retained; remote viewer serves the same source at `/device-shell.js`.
- Shell tests exercise both definition URL strategies, stale orientation responses, preserved canvas identity, cached orientations, missing/mismatched definitions and retry delay. Remote HTTP integration verifies the shared asset is served.
- Full regression command: `node --test .tests/baguette/*.test.cjs .tests/cindy-simulator.test.mjs .tests/plugin-contract.test.mjs .tests/localization.test.mjs .tests/provisioning.test.mjs .tests/publish-workflows.test.mjs`: 1723 passed, one package-contract failure caused by moving a file while the contract enumerates HEAD. Retained the existing source path, then reran the contract plus shell/remote-viewer tests: 55 passed, zero failed. No outstanding test failures.
- Forge validated and packed 0.3.44 successfully. No installation or publication performed.
- This round used local automated tests, not a running Cindy UI. Current host version discovery returned no available operation. No new host API dependency introduced. Two-computer runtime verification remains outstanding; prior runtime evidence is not claimed as verification of this package.
