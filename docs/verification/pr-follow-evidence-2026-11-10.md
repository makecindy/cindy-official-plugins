# PR 跟进：修订后的验证结论

以下修订替代初版 1.5.9 的交付判断。初版虽通过单测，worker 用真实时序复现三处空转，
因此没有发布。#313 已合并；工作区已合入主干 9404121e，待 reviewer 明确确认后才提交发布。

## 三个反例

使用 worker 的真实快照和 sim2.mjs，固定五分钟步长、关闭 pacing；不是线上模型调用统计。
修订前：late=2，swap=2，unavailable=13 次放行。
第一轮修订：late=1，swap=1，早期人工标记的 unavailable=2；这不足以验收故障路径。
第二轮使用 reviewer 的真实正常/403 故障快照 sim3：green-during-outage 在 +15 分钟放行
checks-passed；flap 在八小时内只初始放行一次；permanent 在七十二小时内四次放行
（初始一次、0.5/24.5/48.5 小时各一次故障提醒），所有人工无限期等待均可登记。
对应 healthy 场景分别一次放行。固定时钟与--no-pacing回放，不是线上模型统计。
检查仍运行时不报汇总项未注册；占位转真实不改变批次等待或期限；resume 不清除故障提醒记录。
旧状态中的 required-app:* 占位项也可过渡，不要求用户清理跟进状态。

规则接口 HTTP 403 单独返回未知规则，保留已获取的 CI；不退出整个快照。
没有引入规则缓存。未知规则禁止声称可合并，但不吞新失败/评论。连续两次完整读取失败才提醒；短暂恢复不清提醒时间。已确认故障提醒每天至多一次，
未确认事件仍按原重试/退避。--expect-base 已删除，只保留 head 校验和 GitHub 合并保护。

## 真实轨迹与连续回放

新增本地限长轨迹（每PR 2 MiB × 2、状态目录共享32 MiB、写入时清理十四天前的记录），包括输入快照的无正文表示、时钟、探测、触发和收尾动作。
可用 pr-follow-replay.mjs 连续回放；只有开头加载记录的状态，之后沿用候选自己的状态。
未读取任何新输入的pacing轮不写日志。评论/评审正文替换为空或固定语义标记，不保存模型等待/恢复的解释。日志仍含 PR/检查标识，
属于本地诊断数据，不应未经脱敏提交仓库。写入失败不影响判断。超大记录、失败快照或候选需要
额外输入都会报告回放缺口，不编造结果。改变策略后模型本来会选择什么，也不能由录制证明。

已有 .tests/helpers/pr-follow-shadow.mjs 仍只是单次真实读取对照；不可当作连续影子运行。
本轮未安装候选、未创建线上影子调度，未进行真实模型端到端演练。下一阶段仍需一个专用 PR
跑两轮延迟汇总/失败/修复及一次任务中断恢复，核对 GitHub、preRunHook、模型收尾三层证据。
不声称仅靠单测/回放已经验收生产调度。

## 验证命令

```sh
node --test .tests/cindy-github.test.mjs .tests/plugin-contract.test.mjs \
  .tests/localization.test.mjs .tests/provisioning.test.mjs .tests/publish-workflows.test.mjs
node cindy-github/skills/pr/scripts/pr-follow-replay.mjs <trace.jsonl> <candidate-scripts-dir>
```

环境：macOS / Node v22.21.1；宿主只读版本 0.0.0 开发构建。未引入宿主接口或权限变更。
Forge 打包仅验证产物，不安装。本机真实快照原始材料不纳入提交。

非管理员的 GraphQL branchProtectionRule=null 不证明没有经典保护。本实现补充可见规则，
不宣称获得不可见经典清单，最终仍依赖 GitHub 合并保护与状态。

第三轮复验补充：移除规则故障静默时的提前 skip，沿用普通等待/defer/重试路径。
sim5 defer-outage 的 +10 分钟单次故障不再丢掉 nextAllowAt，+30 分钟正常 defer-expired。
未知规则曾导致一次实际交付的结果为 NOT_READY 时，在该 head 的 watch 中记录待复核标记；
规则恢复且快照 READY 后产生一次 rules-recovered，经既有 pending/ack 确认才清除。
sim6 outage 在 +15 分钟恢复后放行并报告 READY；未确认恢复事件可重试，确认后不重复。
此标记不是每次规则恢复都通知：纯人工等待的 flap 仍一次，permanent 仍七十二小时四次。
