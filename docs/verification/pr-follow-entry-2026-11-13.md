# PR 跟进入口回执验证

候选：`cindy-github` 1.5.48；基线：`728b5e48`；环境：Windows、Node.js 22.22.3。

## 受影响行为与不变量

`pr_card`、`pr_follow_settings` 的成功回执及发布／草稿／旧宿主跟进按钮的 Agent
交接携带 `follow_workflow`，指向包内 `skills/pr/SKILL.md` 和
`skills/pr/scripts/pr-heartbeat-gate.mjs`。Agent 按会话可用 Skills 中同一 namespace
的实际路径读取；未声明 Manual 时仍走随包入口，不搜索业务仓库或另写替代脚本。

入口由 `prFollowWorkflow()` 统一构造，只生成数据，不新增状态写入者、调度、重试、
权限或网络目标。Host 负责 Skill 暴露及事件交付；VM 无法证明真实 Host 集成。

| 路径 | 预期行为及本地验证范围 |
| --- | --- |
| 成功的 pr_card / pr_follow_settings | 返回相同入口；仅查询设置不创建卡片或任务 |
| 发布 / 草稿 / 旧宿主跟进交接 | Agent 事件携带相同入口，保留上游交接结果处理 |
| 原生启动 / 停止 / 归属与状态同步 | 保留上游实现，不重复调度或新增交接 |
| 错误 / 交接拒绝或结果不明 / 导航 / status_watch | 保留上游语义，不用入口字段冒充成功 |
| 手册未声明 / Skill 不可用 | 前者继续读取入口；后者报告具体缺口，不自编脚本 |

四语言工具契约和回执文案同步；英文 pr_card 说明为 1008 字符（上限 1024）。

## 当前基线适配

2026-11-27，实际冲突触发 rebase 到 `728b5e48`，候选由基线 1.5.47 升至 1.5.48。
保留上游 #393 的跟进偏好／模型预设与设置工具、#387 的各渠道任务卡片交付、
#403 的调度错误恢复、#412 的截图确认说明及新增回归。pr_follow_settings 的四语言说明采用上游新用法，
再追加本 PR 入口指引。相对 main，Skill、检查器、Node worker 和设置页均无差异；
main.js 仍仅新增原定的 24 行回执代码，现有调度及主 checkout 检查器来源未修改。

## 验证与证据复用

执行真实 main.js 的现有 Node VM 宿主桩，验证工具回执及 Agent 按钮交接；
这是本地协议验证，不能替代下述真实 Cindy 验收。

完整门禁命令：

```text
node --test .tests/plugin-contract.test.mjs .tests/localization.test.mjs .tests/provisioning.test.mjs .tests/publish-workflows.test.mjs .tests/cindy-github.test.mjs
```

本轮完整门禁：441 项，411 通过、25 跳过、5 失败，119.71 秒。包契约、多语言、
provisioning、回执交接及可在本机执行的上游回归通过。Manifest 校验、main.js 语法
及 git diff --check 通过。

此前 1.5.44（基线 `1758878d`）完整门禁为 428 项：398 通过、25 跳过、5 失败。
5 项既有环境失败为 4 项 WSL bash 无法读取 Windows 临时脚本，以及 1 项
Windows/POSIX stateFilePath 路径断言。初次 1.5.14 验证已在未修改的基线复现；
本轮上游及本 PR 未改发布脚本／测试、stateFilePath 或该断言，沿用该证据，未弱化
或跳过门禁。重复逐轮记录已合并；[完整历史证据与复现说明](https://github.com/yan-xdt/cindy-official-plugins/blob/7bd336dc843125d445a16cec37f8596f69a2485c/docs/verification/pr-follow-entry-2026-11-13.md)仍可追溯。

[维护者确认既有回执和按钮交接记录可按对应改动沿用](https://github.com/makecindy/cindy-official-plugins/pull/333#issuecomment-7207651113)。
本轮入口构造函数和四语言恢复指引不变；冲突适配保留上游新语义并重新执行现有回归。

## 仍缺的真实 Cindy 验收

未安装候选包、未发布、未触发真实模型跟进，不声称已完成客户端端到端验证。
仍需作者或维护者在获授权环境记录包来源、实际 Cindy 版本、以下结果和未测项：

- pr_card / pr_follow_settings 工具回执，以及发布／草稿／跟进按钮向 Agent 的交接。
- 同一 namespace 下，回执对应的实际 Skill 路径可读，且 Agent 收到 follow_workflow。
- ghost_manual 返回未声明手册后，Agent 沿入口读到 SKILL.md 与原装 checker。

[维护者要求补证后按届时 head 复审](https://github.com/makecindy/cindy-official-plugins/pull/333#issuecomment-7005560240)。
已解决线程、VM 和绿色 CI 均不代表完成此项。当前任务仍禁止安装、发布与合并。
