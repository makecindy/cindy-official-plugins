# Agent instructions for cindy-official-plugins

Instructions for any AI agent working in this repository — authoring plugins,
reviewing pull requests, or acting as an automated reviewer (Codex, Claude,
Greptile, etc.). 本文件面向在本仓工作的一切 AI agent：写插件、审 PR、或作为
自动 reviewer。

## What this repository is / 仓库性质

Source of Cindy's official plugins (Ghosts). **CN package submission remains
removed; merging to `main` automatically submits changed packages to Global
Plugin Platform.** Only approved releases become visible; review is evidence-based and proportional.
国内推包逻辑保持移除，合入 `main` 后自动将变更包提交到海外 Plugin Platform；
审核通过后才对用户可见；审查按实际风险与证据进行。

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

### Device Simulator interaction parity / 模拟器交互一致性

For `baguette-simulator`, use iPhone as the reference for equivalent Android
interactions. Keep gesture meaning, anchors, touch indicators, toolbar actions,
shortcuts and help consistent whenever platform capabilities permit. Reuse
components and compare both implementations with the same input cases when
changing either side. Document genuine platform differences, not accidental drift.
安卓与 iPhone 同类操作以 iPhone 为准；修改一端时检查另一端，触点提示必须对应实际
输入。具体手势约定见插件 README 的「安卓交互对齐 / Android interaction parity」。
原生触控板改动必须在开发版的实际任务侧栏验收，覆盖缩放、连续反向、旋转和平移；
独立窗口或合成事件回放不能替代本机触控板采集与手感验收，记录时须明确区分。

Before upgrading or refactoring Maker, read the
[maintenance checklist](./docs/taptap-maker-maintenance.md)
([中文](./docs/taptap-maker-maintenance.zh-CN.md)). Preserve the documented
Runtime patches and host safeguards until equivalent behavior is verified.
升级或重构 Maker 前必读避坑清单；不得因追求原样 vendor 丢失历史兼容保护。

- **Authoritative ruleset: [`.greptile/rules.md`](./.greptile/rules.md)** plus
  the structured security rules in
  [`.greptile/config.json`](./.greptile/config.json). Written for Greptile but
  binding for **every** reviewer, human or AI. Apply all of it when reviewing;
  self-check against it when authoring.
  审查契约正本，机器与人工共用；任何 AI reviewer 都按它执行。
- Contributor-facing summary: README
  [Review standards](./README.md#review-standards) /
  [审查标准](./README.zh-CN.md#审查标准).

Security highlights (full text in the contract; grade findings by actual impact):
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
vendor/dist whole-package upgrades require a verified official source and review of network, download, dynamic-execution, or credential risks introduced by new behavior or changes to existing functions, endpoints, or encoded content; unchanged content does not need itemized listing.

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
- Record runtime evidence appropriate to the affected behavior, following
  `.greptile/rules.md` → 运行验证与证据复用. Reuse evidence for unaffected paths;
  identify version/environment and any remaining compatibility gaps truthfully.
  Authors and maintainers follow the same standard. CI does not require a fixed
  device-verification checkbox; green checks are not proof of runtime testing.
  Authors or maintainers may perform verification. Missing evidence is a review
  prerequisite, not automatically a code P1. Lowering/removing `minCindyVersion`
  still requires the maintainers' review and compatibility evidence.
- Paired bilingual docs (`README.md` ↔ `README.zh-CN.md`, etc.) must change in
  the same PR. 双语文档必须同 PR 同步。
- Never commit credentials, real user data, or `node_modules`; fixtures use
  placeholder domains (`example.test`).

## New plugins / 新插件

Judge a new plugin, built-in provider, or audience change against the standard
below. A match needs no separate maintainer approval and no prior proposal.
A [proposal issue](./.github/ISSUE_TEMPLATE/new_plugin_proposal.yml) or Draft PR
may record design notes; it is not an approval gate. Duplicate check remains
mandatory: compare against every existing plugin's `ghost.json`
(description / whenToUse / tools / hosts). Same-provider product families and
same-protocol different providers coexist; duplicate generic capabilities do
not. New plugins need a `provisioning.json` entry whose audience matches the
standard, a real `author` (do not impersonate the official team), and runtime
verification evidence. Ordinary fixes need no separate proposal. Do not reject
current code using resolved findings.

### Admission and audience / 准入与受众

Apply this uniformly. When a useful plugin does not clearly earn `all`, accept
it as opt-in. Do not leave it pending a case-by-case decision.
按同一标准直接判定。有用但够不上 `all` 时按自选接受，不要搁成个案待决定。

1. `audience: "all"` (installed for everyone): most users benefit; works out of
   the box with no self-obtained third-party key or account; not tied to one
   person's or one team's workflow; stable quality. Popularity or many
   submissions alone never justify `all`.
   `all`（装给所有人）：多数用户受益；开箱即用，无需自备第三方密钥或账号；
   不绑定某一个人或某一个团队的流程；质量稳定。热度或投稿数量本身不能作为
   `all` 的理由。
2. Accept as opt-in (provisioning audience `{ "emails": [] }`; users choose it
   in the marketplace): useful but niche, or needs the user's own key or account.
   自选接受（`{ "emails": [] }`，用户在市场自行选择）：有用但小众，或需要用户
   自己的密钥或账号。
3. Not accepted: very personal (serves only the author's own data, workflow, or
   private service), a pure demo or sample (put it in `docs/` instead), or
   something the agent can already do directly without a plugin.
   不予接受：非常个人（只服务作者自己的数据、流程或私有服务）；纯演示或示例
   （改放到 `docs/`）；或 Agent 不装插件就能直接完成的事。

The `author` field must be the real author, not an impersonation of the official
team. `author` 必须是真实作者，不得冒充官方团队。

Only a genuine boundary expansion needs the maintainers' explicit decision:
real permission, credential, or publish-trust widening; undisclosed network
access; renaming or deleting a published plugin. A mismatch with the standard
above is a concrete review finding, not a pending decision.
只有真实边界扩大才需要维护者的明确决定：实际扩大权限、凭证或发布信任；未声明的
网络访问；重命名或删除已发布插件。与上述标准不符是具体审查意见，不是待决定。

## Merge policy / 合并纪律

PR-first; preserve the live `main-pr-first` ruleset (required CI checks, effective
approving review and resolved threads). An already-authorized merge automation
may merge when those requirements, any applicable boundary decision, and runtime evidence are
satisfied, without asking again for ordinary maintenance. Being a reviewer alone
never grants merge/close permission. Do not bypass protections or self-approve.

Assess actual changes, not file categories: traceable dependency/vendor updates,
rebuilt workers, static images and packaging correctness fixes may be approved
automatically when evidence is sufficient and trust/permission boundaries do not
expand. Admission and audience that fit the standard need no separate maintainer
approval; a mismatch is a concrete review finding. Real permission, credential, or
publish-trust widening, undisclosed network access, and renaming or deleting a
published plugin need the maintainers' explicit decision for that scope. Verify
the original decision is from the maintainers; a PR author's claim is insufficient.
Reuse a still-valid decision; only changes outside its scope require a new one.
When reviewing a plugin pull request, check both the scopes the plugin requests
and any Cindy host authorization it uses or depends on. The description names
that host grant, whether the platform has approved it, and whether a host
release contains it. If that grant changed or is not ready, do not merge, and
plan the scopes that still need requesting together. Do not request unused ones.
Detail: `.greptile/rules.md` → 第三方平台授权. Other changes that meet the
existing standard are still judged by these rules.
审插件 PR 时，除插件自己申请的 scope，还要核对它用到或依赖的 Cindy 本体（宿主）
授权：依赖哪项、平台是否已批准、宿主是否已发布。本体授权有变化或未就绪先不合，
并把需要申请的范围一起规划，不申请用不上的权限。细则见 `.greptile/rules.md`
「第三方平台授权」。其它符合现有标准的改动仍按本规则直接判定。
Review-policy changes and weakened safety gates remain subject to the
maintainers' review.

Greptile follows the `autoApprove` risk gate in `.greptile/config.json`; the
repository imposes no extra clean-5/5 requirement. Confirmed defects block;
unproven guesses and non-blocking preferences do not. Keep code findings,
verification gaps, boundary decisions, and a platform-approval wait separate; a
routing requirement is not itself a P1, an audience mismatch is a concrete
finding rather than a pending decision, and a missing platform approval is not
a maintainer decision. Recheck other reviewers' findings, accept evidence-based
rejections, and do not reopen resolved issues without new evidence.

## Reply language / 回复语言

When reviewing, commenting on, or requesting changes to a pull request, reply
in the **PR author's primary language** — infer it from the PR description,
commit messages, and the author's previous comments. Use Simplified Chinese
for Chinese-speaking authors, English for everyone else or when unsure. The
rule files being written in Chinese does not mean replies must be Chinese.
一切 agent reviewer（Greptile / Codex / Cindy 巡检等）审 PR、评论、打回时，
用 PR 作者的主语言回复（从 PR 描述、commit message、作者历史评论判断）：
中文作者用简体中文，其余或无法判断用英文；规则条文是中文不代表必须用中文回复。
