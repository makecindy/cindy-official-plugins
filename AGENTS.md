# Agent instructions for cindy-official-plugins

Instructions for any AI agent working in this repository — authoring plugins,
reviewing pull requests, or acting as an automated reviewer (Codex, Claude,
Greptile, etc.). 本文件面向在本仓工作的一切 AI agent：写插件、审 PR、或作为
自动 reviewer。

## What this repository is / 仓库性质

Source of Cindy's official plugins (Ghosts). **Every merge to `main`
auto-publishes to the plugin marketplace for all users** — security and
experience risks land on real users, so review is strict by design.
每次合入 `main` 都会自动发布给全体用户，审查从严。

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
`node.secretBindings[]`); network targets ⊆ `ghost.json` allowlist (Node
workers reviewed against their fixed endpoints instead); tools with
irreversible external side effects must distinguish "not executed / executed /
unknown" on every failure path; no `Math.random` for externally-visible ids;
vendor/dist changes require itemized evidence, never a bare "looks fine".

## Hard gates before any commit / 提交硬门禁

- Bump `ghost.json.version` for every plugin whose packaged content changed.
- Run `node --test .tests/localization.test.mjs .tests/provisioning.test.mjs
  .tests/publish-workflows.test.mjs`, plus the changed plugin's own
  `.tests/<plugin>.test.mjs` if present.
- Four-language locales (`zh-CN` / `en` / `ja` / `ko`) complete;
  `docs/localization.md` defines the English-fallback contract — do not demand
  translations the contract allows to fall back.
- DCO: every commit signed off (`git commit -s`), author matching the sign-off.
- Bundled third-party dependencies changed → update that plugin's
  `THIRD-PARTY-LICENSES.txt`.
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
real-device verification notes in the PR description.

## Merge policy / 合并纪律

PR-first; `main` is protected by the `main-pr-first` ruleset (1 approving
review, all threads resolved, required checks including the automated
`Cindy Plugin Review` verdict). Reviewers report; **merge decisions belong to
maintainers**. Automated reviewers must never merge, close, or approve.
自动 reviewer 只出结论，不合并、不关闭、不 approve。

## Reply language / 回复语言

When reviewing, commenting on, or requesting changes to a pull request, reply
in the **PR author's primary language** — infer it from the PR description,
commit messages, and the author's previous comments. Use Simplified Chinese
for Chinese-speaking authors, English for everyone else or when unsure. The
rule files being written in Chinese does not mean replies must be Chinese.
一切 agent reviewer（Greptile / Codex / Cindy 巡检等）审 PR、评论、打回时，
用 PR 作者的主语言回复（从 PR 描述、commit message、作者历史评论判断）：
中文作者用简体中文，其余或无法判断用英文；规则条文是中文不代表必须用中文回复。
