# Agent instructions for cindy-official-plugins

Instructions for any AI agent working in this repository — authoring plugins,
reviewing pull requests, or acting as an automated reviewer (Codex, Claude,
Greptile, etc.). 本文件面向在本仓工作的一切 AI agent：写插件、审 PR、或作为
自动 reviewer。

## What this repository is / 仓库性质

Source of Cindy's official plugins (Ghosts). **Every merge to `main`
automatically submits the real package to the CN and Global Plugin Platform
review queues; only approved releases become visible** — security and
experience risks land on real users, so review is strict by design.
每次合入 `main` 都会自动向 CN / Global 审核队列提交真实包，审核通过后才对用户
可见，审查从严。

## Authoring reference / 编写参考

For plugin creation or maintenance, read the
[authoring and migration reference](./docs/plugin-authoring.md)
([中文](./docs/plugin-authoring.zh-CN.md)) alongside the README. It documents
equivalent v2/v3 declarations, existing runtime APIs, and verification boundaries.
Infer routine adaptations from the requested functionality and existing code;
do not require authors to perform the migration checklist themselves.
编写或维护插件时，依据上述参考与现有代码自行完成格式适配、声明保留和校验；
只把无法从事实确定的功能取舍、目标版本或实机验证缺口交给作者，不增加手工迁移步骤。

## Review contract / 审查契约

- **Authoritative ruleset: [`.greptile/rules.md`](./.greptile/rules.md)** plus
  the structured security rules in
  [`.greptile/config.json`](./.greptile/config.json). Written for Greptile but
  binding for **every** reviewer, human or AI. Apply all of it when reviewing;
  self-check against it when authoring.
  审查契约正本，机器与人工共用；任何 AI reviewer 都按它执行。
- Contributor-facing summary: README
  [Review standards](./README.md#review-standards) /
  [审查标准](./README.zh-CN.md#审查标准).

Security highlights (full text in the contract; violations are P1):
credentials only via the three host-injection channels
(`network.secrets[].inject` / `network.connections[].inject` /
`node.secretBindings[]`) — with two approved exceptions that must NOT be
flagged: a settings page saving the user-entered credential through same-origin
`PUT /secrets/<key>` (the sanctioned write-only path), and handing credentials
to an approved third-party runtime (e.g. TapTap Maker) without copying them
into Cindy KV/Secret or retaining plaintext anywhere else (logs, page state);
autonomous plugin network targets ⊆ `ghost.json` allowlist (ordinary HTTPS
performed inside the current Agent tool call may instead use the Host-issued,
strictly in-flight `callId`; managed credentials still require an explicit
declaration and matching host); plugins declaring the top-level `node` field
have their autonomous workers reviewed against fixed endpoints instead; tools with
irreversible external side effects must distinguish "not executed / executed /
unknown" on every failure path; no `Math.random` for externally-visible ids;
vendor/dist changes require itemized evidence, never a bare "looks fine".

## Hard gates before any commit / 提交硬门禁

- Bump `ghost.json.version` for every plugin whose packaged content changed;
  the new `major.minor.patch` SemVer must be greater than the version on `main`.
- CI must enforce the official repository manifest and package contract in
  `.tests/plugin-contract.test.mjs` without checking out another repository.
- Run `node --test .tests/plugin-contract.test.mjs .tests/localization.test.mjs
  .tests/provisioning.test.mjs .tests/publish-workflows.test.mjs`, plus the changed plugin's own
  `.tests/<plugin>.test.mjs` if present.
- Four-language locales (`zh-CN` / `en` / `ja` / `ko`) complete;
  `docs/localization.md` defines the English-fallback contract — do not demand
  translations the contract allows to fall back.
- DCO: every commit signed off (`git commit -s`), author matching the sign-off.
  Reviewers: audit ONLY the PR's actual commit list on GitHub
  (`gh pr view <N> --json commits` or the DCO status check) — never a local
  `git log`. Commits that exist only in your own sandbox checkout (e.g. a
  scaffold commit your harness created to materialize the diff) are NOT part
  of the PR and must not be flagged.
- Bundled third-party dependencies changed → update that plugin's
  `THIRD-PARTY-LICENSES.txt`.
- Every changed plugin package requires the PR's production Cindy verification
  checkbox, attesting that its packaged `.cindy` was installed and exercised on
  a real device running a stable production Cindy build. If the plugin declares
  `minCindyVersion`, that Cindy build must be greater than or equal to it.
  Lowering/removing the field requires maintainer review.
- Paired bilingual docs (`README.md` ↔ `README.zh-CN.md`, etc.) must change in
  the same PR. 双语文档必须同 PR 同步。
- Never commit credentials, real user data, or `node_modules`; fixtures use
  placeholder domains (`example.test`).

## New plugins / 新插件

Open a [new plugin proposal](./.github/ISSUE_TEMPLATE/new_plugin_proposal.yml)
issue and get a maintainer ack **before** writing code. Duplicate check is
mandatory: compare against every existing plugin's `ghost.json`
(description / whenToUse / tools / hosts). Same-provider product families and
same-protocol different providers coexist; duplicate generic capabilities do
not. New plugins also need: a `provisioning.json` entry with an explicit
audience decision (prefer staged rollout over `"all"` for first release), and
real-device verification notes in the PR description. New plugin admission is
a product decision and always requires maintainer review.

## Merge policy / 合并纪律

PR-first; `main` must be protected by the `main-pr-first` ruleset (required CI
checks, 1 current-head approving review, all threads resolved). Reviewers
report; **merge decisions belong to maintainers**. Greptile may approve only a
clean 5/5, non-sensitive PR allowed by the `autoApprove` gate in
`.greptile/config.json`; sensitive changes always require maintainer approval.
Automated reviewers may authorize but must never merge or close.
Greptile 仅可自动授权通过配置门禁的非敏感 5/5 PR；敏感变更必须由维护者人工
review。自动 reviewer 不合并、不关闭 PR。

## Reply language / 回复语言

When reviewing, commenting on, or requesting changes to a pull request, reply
in the **PR author's primary language** — infer it from the PR description,
commit messages, and the author's previous comments. Use Simplified Chinese
for Chinese-speaking authors, English for everyone else or when unsure. The
rule files being written in Chinese does not mean replies must be Chinese.
一切 agent reviewer（Greptile / Codex / Cindy 巡检等）审 PR、评论、打回时，
用 PR 作者的主语言回复（从 PR 描述、commit message、作者历史评论判断）：
中文作者用简体中文，其余或无法判断用英文；规则条文是中文不代表必须用中文回复。
