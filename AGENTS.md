# Agent instructions for cindy-official-plugins

Instructions for any AI agent authoring plugins, reviewing pull requests, or
acting as an automated reviewer (Codex, Greptile, Claude, etc.).
本文件面向在本仓工作的一切 AI agent：写插件、审 PR、或作为自动 reviewer。

## Repository nature / 仓库性质

Source of Cindy's official plugins (Ghosts). CN submission remains removed;
merging to `main` submits changed packages to Global Plugin Platform as
**pending releases** (approval happens on Platform before users see them).
合入 `main` 自动向海外 Plugin Platform 提交待审包，上架审核在 Platform 完成。

## Automated review & circuit breaker / 自动审查与防熔断

Authoritative contract: [`.greptile/rules.md`](./.greptile/rules.md),
[`.greptile/config.json`](./.greptile/config.json), and
[`.github/plugin-owners.json`](./.github/plugin-owners.json).

Every AI reviewer (including **Codex** and **Greptile**) MUST follow these rules:

1. **Block ONLY on confirmed P0/P1**: security/permission boundary violations,
   data loss/corruption, crashes, or core functional regressions with a
   concrete trigger path.
2. **No blocking P2 threads**: do NOT open inline review threads for P2
   suggestions, style/wording preferences, or speculative edge cases. Keep
   non-blocking notes brief (or omit them) so threads do not stall merges.
3. **No device-verification merge gate**: do NOT block merges or ask for manual
   Cindy client testing logs/screenshots. Unit tests + green CI dry-run
   packaging + automated review are sufficient to merge; release QA happens on
   Platform. Do not re-check items already verified by CI (SemVer bump,
   manifest schema, 4 locales, DCO).
4. **2–3 round circuit breaker / 2–3 轮防熔断**:
   - Round 1 surfaces confirmed P0/P1 defects.
   - Follow-up rounds ONLY verify whether prior P0/P1 items were fixed and
     whether the fix introduced a new crash or security bug.
   - **Never** expand follow-up rounds with new P2s or recursively critique
     defensive safeguards added solely to satisfy an earlier review comment.
   - After 3 rounds, stop iterating: if **no confirmed P0/P1 remains unresolved**,
     proceed to merge; if a confirmed P0/P1 (security, data loss, or core
     regression) is still unresolved, escalate to a maintainer rather than
     waiving an old defect. Prioritize user experience and shipping important
     fixes over chasing low-probability edge cases.
5. **Compatibility proportional to `audience`**: check `provisioning.json`.
   For opt-in / early plugins (`audience` ≠ `"all"`), do NOT require
   multi-generation local state or cache migration — clean reset or graceful
   fallback is acceptable. Reserve strict backward-compatibility review for
   `audience: "all"` plugins touching persistent user data or credentials.
6. **Reply language**: reply in the PR author's primary language (Simplified
   Chinese for Chinese-speaking authors; English otherwise).

## Tiered merge policy & Owner Fast-Lane / 分级合并与快车道

- **Approval gate equivalence / 审批门禁等价规则**: whenever required CI is green
  (including `Greptile Review` `SUCCESS`, ignoring cancelled optional checks)
  and no confirmed P0/P1 remains unresolved, either **`Greptile APPROVED`** or
  an **`APPROVED` review on the current head from any registered maintainer**
  (`.github/plugin-owners.json` `maintainers`) satisfies the approval gate. Do
  not wait for an extra Greptile `APPROVED` review when a maintainer has already
  approved the current head, and do not police the approval comment wording.
- **L1 Routine maintenance (Fast-Lane)**: bugfixes, perf, small enhancements,
  copy/locales/icons, tests, and traceable dependency maintenance on existing
  plugins without widening boundaries.
  - **Maintainers & listed plugin owners** (`.github/plugin-owners.json`):
    **Required CI green + approval gate satisfied + no unresolved Codex P0/P1 →
    auto-merge directly.** No manual re-review and no device-verification wait.
  - **Unlisted external contributors**: automated review runs as usual, then a
    maintainer or plugin owner gives a quick human check and `Approve` before
    merging (no unattended auto-merge).
- **L2 Boundary changes**:
  - **New plugin launch or `provisioning.json` changes** (new plugin or widening
    `audience`): always require human maintainer review & `Approve`
    (`provisioning.json` is in Greptile `excludePaths`, so these never
    auto-approve).
  - **Existing-plugin L2 adjustments** (new/widened permissions, credentials,
    autonomous hosts, events, or subprocesses):
    - **Registered maintainers** (`maintainers` in `.github/plugin-owners.json`):
      opening a Ready PR already constitutes maintainer boundary confirmation.
      **Required CI green + approval gate satisfied + no unresolved confirmed
      P0/P1 → auto-merge directly** (unless waiting on an unmerged Cindy host PR
      or an unapproved third-party OAuth grant).
    - **Non-maintainers** (plugin owners or external contributors): **Required
      CI green + no unresolved confirmed P0/P1 + registered maintainer
      `Approve`** on the current head.
  - **Unready third-party OAuth / unmerged host capabilities** (even without
    editing `ghost.json`): hold when a required third-party OAuth scope is not
    yet approved by the provider, or when the required Cindy host capability has
    not yet merged to `makecindy/cindy` `main`. Once the host PR is merged to
    `main`, plugins that isolate older clients via `minCindyVersion` (the plugin
    platform filters releases by `minCindyVersion` and falls back for older
    clients) or degrade safely on older hosts do **not** need to wait for a
    stable Cindy client release.
- **L3 Repository governance & publish trust**: `.github/workflows/**`,
  `.greptile/**`, `AGENTS.md`, `.github/plugin-owners.json`, weakening `.tests/`
  gates, or renaming/deleting a published plugin. **Required CI green + no
  unresolved confirmed P0/P1 + explicit maintainer `Approve`** (Greptile does
  not auto-approve L3 paths; maintainer `Approve` satisfies the approval gate).

Reviewers never bypass GitHub ruleset protections or self-approve; authorized
merge automation executes once the applicable tier's conditions are met.

## Security redlines / 安全红线摘要

Full definitions live in `.greptile/config.json`:
- No hardcoded secrets; fixtures use placeholder domains (`example.test`).
- Credentials only via `network.secrets[].inject`,
  `network.connections[].inject`, or `node.secretBindings[]`. Two approved
  exceptions must NOT be flagged: settings pages saving user input through
  same-origin `PUT /secrets/<key>`, and handing credentials to an approved
  third-party runtime (e.g. TapTap Maker) without copying them into Cindy
  KV/Secret or retaining plaintext.
- Autonomous network targets ⊆ `ghost.json` `network.hosts`. Ordinary HTTPS
  inside an active Agent tool call may reuse Agent authorization via in-flight
  `callId` (do not flag as undeclared host). Local preview URLs matching
  `preview.hosts` and fixed endpoints of top-level `node` workers are exempt.
- Tools with irreversible external side effects must distinguish
  `not_executed / executed / unknown` on failure and never suggest blind retry
  on `unknown`.
- Use Web Crypto / Node `crypto` (never `Math.random`) for external ids/nonces.

## Hard gates before commit / 提交前必查

- Do not lower `ghost.json.version` below `main`. Manual patch bumps are
  optional for routine updates (`.github/scripts/package-plugin.sh`
  auto-computes a strictly increasing patch version on `main` when unchanged;
  bump manually only for explicit minor/major releases). Changed legacy v2
  plugins must migrate to `schemaVersion: 3` with `minCindyVersion` and no
  `slots`.
- Run repo gates + changed plugin tests:
  `node --test .tests/plugin-contract.test.mjs .tests/localization.test.mjs .tests/provisioning.test.mjs .tests/publish-workflows.test.mjs`
  plus `.tests/<plugin>.test.mjs` when present.
- Keep `zh-CN / en / ja / ko` locales valid (`docs/localization.md` allows
  English fallback for settings UI — do not flag allowed fallback).
- Sign off every commit (`git commit -s`, DCO). Reviewers must audit ONLY the
  PR's actual GitHub commits (or DCO check), never local harness scaffold commits.
- Update `THIRD-PARTY-LICENSES.txt` when bundled dependencies change.
- Update paired bilingual docs (`README.md` ↔ `README.zh-CN.md`,
  `CONTRIBUTING.md` ↔ `CONTRIBUTING.zh-CN.md`) in the same PR.

## Authoring & plugin-specific notes / 编写与插件专项说明

- Authoring & v2→v3 reference: [`docs/plugin-authoring.md`](./docs/plugin-authoring.md)
  ([中文](./docs/plugin-authoring.zh-CN.md)). Handle routine adaptations from
  existing code rather than asking authors for manual migration checklists.
- `taptap-maker`: read [`docs/taptap-maker-maintenance.md`](./docs/taptap-maker-maintenance.md)
  ([中文](./docs/taptap-maker-maintenance.zh-CN.md)) before upgrading vendor.
- `cindy-simulator`: use iPhone as the reference for equivalent Android
  interactions and gestures.
