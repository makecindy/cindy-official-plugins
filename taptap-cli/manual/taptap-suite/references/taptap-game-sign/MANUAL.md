# TapTap CLI 插件:签到(game-sign)

game-sign 管理签到活动主体、每日奖励、集卡与兑换码；提审/撤回是独立动作。开始前先读 [shared execution](taptap-suite/references/shared-execution.md)(身份、JSON 输出外壳、错误处理)。命令行示例按 [taptap-suite](taptap-suite/MANUAL.md) 的映射表转成 call_tool 调用。

**CRITICAL — 配置顺序固定：主体 → 每日奖励及库存 → 集卡及库存（如开启）→ 自检 → 提审（已获授权）→ 回读审核状态。** 每阶段保存后回读确认，再进入下一阶段；不并发写不同阶段。编辑从最早需要变更的阶段继续，已确认且无需修改的阶段直接跳过。

**CRITICAL — `review_id` 是后续写操作的句柄，`activity_id` 非空不代表生效。** 每日奖励用 `award_id`，卡片用 `card_id`，三者不可互换；只在可编辑状态修改配置。

**CRITICAL — 提审前必须通过 `check-game-sign-readiness`，并核实奖励库存。** 自检通过只说明当前配置可提审，不代表用户要求提审，也不代表活动已开始或客户端可见。审核中、已通过、活动进行中和客户端可见是不同事实，分别核实。

**CRITICAL — 导码受理 ≠ 本文件已入库。** `game-sign +import-codes` 返回的 `submitted` 只表示导入请求已受理；必须回读目标库存并结合任务状态核实实际入库。结果未知时停止重试，不换 key 重导，不重复提交。

**CRITICAL — 不编造奖励、库存或道具；保留原奖品类型和测试目标。** 实物库存失败不能换成兑换码后汇报实物场景通过；确需改变方案时先说明差异并取得用户同意。写入结果未知时回读同一目标的类型、名称、图片、概率、兑换配置和库存，只看标题不能证明未生效。

## 快速决策

| 用户意图 | Reference | 起手调用 |
| --- | --- | --- |
| 查活动、审核状态 | [runbook](taptap-suite/references/taptap-game-sign/references/game-sign-runbook.md)「状态与可执行动作」 | 有 `review_id` 时 `call_tool(name:"game-sign get-game-sign-activity", args:{developer_id:"<developerId>", app_id:"<appId>", data:{review_id:"<reviewId>"}})`；否则 `call_tool(name:"game-sign list-game-sign-activities", args:{developer_id:"<developerId>", app_id:"<appId>", data:{page:1, page_size:20}, page_all:true, page_limit:1000})` |
| 看奖励、集卡和库存 | [runbook](taptap-suite/references/taptap-game-sign/references/game-sign-runbook.md)「每日奖励」「集卡」 | `call_tool(name:"game-sign get-game-sign-config", args:{developer_id:"<developerId>", app_id:"<appId>", data:{review_id:"<reviewId>"}})` |
| 创建/修改主体 | [runbook](taptap-suite/references/taptap-game-sign/references/game-sign-runbook.md)「创建活动主体」 | `call_tool(name:"game-sign create-game-sign-activity", args:{developer_id:"<developerId>", app_id:"<appId>", data:{...}, dry_run:true})` |
| 保存/删除每日奖励 | [runbook](taptap-suite/references/taptap-game-sign/references/game-sign-runbook.md)「每日奖励」 | `call_tool(name:"game-sign save-game-sign-award", args:{developer_id:"<developerId>", app_id:"<appId>", data:{...}, dry_run:true})` |
| 新增/配置/删除卡片 | [runbook](taptap-suite/references/taptap-game-sign/references/game-sign-runbook.md)「集卡」 | `call_tool(name:"game-sign save-game-sign-card", args:{developer_id:"<developerId>", app_id:"<appId>", data:{...}, dry_run:true})` |
| 增加实物库存 | [runbook](taptap-suite/references/taptap-game-sign/references/game-sign-runbook.md)「集卡」 | `call_tool(name:"game-sign add-game-sign-card-stock", args:{developer_id:"<developerId>", app_id:"<appId>", data:{...}, dry_run:true})` |
| 导入兑换码/恢复任务 | [code import](taptap-suite/references/taptap-game-sign/references/code-import.md) | `call_tool(name:"game-sign +import-codes", args:{_positional:["./day1.csv"], developer_id:"<developerId>", app_id:"<appId>", review_id:"<reviewId>", award_id:"<awardId>", idempotency_key:"<stable-key>", dry_run:true})` |
| 导出实物中奖名单 | [runbook](taptap-suite/references/taptap-game-sign/references/game-sign-runbook.md)「名单导出」 | `call_tool(name:"game-sign export-game-sign-physical-prize-recipients", args:{developer_id:"<developerId>", app_id:"<appId>", data:{review_id:"<reviewId>"}})` |
| 自检、提审/撤回 | [runbook](taptap-suite/references/taptap-game-sign/references/game-sign-runbook.md)「提审前自检」「提交/撤回审核」 | `call_tool(name:"game-sign check-game-sign-readiness", args:{developer_id:"<developerId>", app_id:"<appId>", data:{review_id:"<reviewId>"}})`；提审为写操作，先 `dry_run` 再 `yes` |

## 常用调用

```text
# 先看该域操作与参数
list_tools(category:"game-sign")

# 定位活动（无 review_id 时）
call_tool(name:"game-sign list-game-sign-activities", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{page:1, page_size:20}, page_all:true, page_limit:1000})

# 读主体、奖励、集卡和库存
call_tool(name:"game-sign get-game-sign-config", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{review_id:"<reviewId>"}})

# 创建主体（先 dry_run，确认后 yes:true）
call_tool(name:"game-sign create-game-sign-activity", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{title:"<活动标题>", color:"#FF8800",
        game_sign_start_time:<秒级时间戳>, game_sign_end_time:<秒级时间戳>,
        activity_end_time:<秒级时间戳>, enable_card_collection:false,
        redeem_method:"<游戏内兑换说明>", redeem_url:""},
  idempotency_key:"<stable-key>", dry_run:true})

# 每日奖励（按累计天数升序；修改已有奖励带 award_id）
call_tool(name:"game-sign save-game-sign-award", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{review_id:"<reviewId>", days:1, content:"钻石x100",
        picture:"https://cdn.example.com/a1.png", state:"<兑换说明>"},
  idempotency_key:"<stable-key>", dry_run:true})

# 自检
call_tool(name:"game-sign check-game-sign-readiness", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{review_id:"<reviewId>"}})

# 提审（不可逆写：先预览，用户明确要求提审后再执行）
call_tool(name:"game-sign submit-game-sign-review", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{review_id:"<reviewId>"},
  idempotency_key:"<stable-key>", dry_run:true})
```

## 执行规则

- 新建：先收集基础方案，再了解奖励及素材准备，之后创建主体；活动标题必须来自用户提供或认可的名称。编辑先回读主体、奖励/集卡配置和审核状态，只问缺项或冲突，不重新创建。
- 兑换方式只提供“游戏内兑换”和“网页兑换”；先问玩家在哪里兑换，再补操作说明或页面链接。兑换码属于奖励/库存配置，不是第三种兑换方式。
- 奖励按累计天数升序配置；集卡先读配置复用目标卡片，不能因存在预置卡就禁止新增，也不能自动删除卡片腾位。概率单位和奖品类型见 runbook。
- 每次写操作先 `dry_run: true` 预览，用户确认后用相同参数加 `yes: true`；同一意图固定 `idempotency_key`。失败或结果未知时停在当前阶段，保留已完成配置和目标 ID，核实后从断点继续，不通过换 key、删卡或重建绕过。
- 导码只推进 readiness，不自动提审、公告上线或推送；受理不等于入库，必须回读库存。上传准备/上传失败可重试；已受理的任务只查询，结果未知禁止自动再提交或换 key。
- 审核等待：提审后报告“审核中”，不说活动已开始；审核通过后回读活动状态与生效时间；被拒绝时按实际原因修正后重提，不编造通过结果。
- 用户明确要求串联签到、公告和推送时，先读 [跨域流程](taptap-suite/references/interactive-operations-flow.md)；单域操作不自动加载或执行其他域。

## 面向用户的回复

- 默认说明活动名称与时间、奖励/集卡配置、库存就绪情况、审核进度和当前缺口；只解释当前状态允许的动作，不展示完整枚举表或调用清单。
- 每轮只说当前阶段、已完成内容、尚缺信息和下一步；不要求用户提供尚未生成的活动/奖励 ID。
- 导码结果未知时说“兑换码已提交，实际入库仍待核实”；仅在确认受理时使用该表述，未确认受理则说“提交结果尚未确认”。
- 示例（仅在配置回读确认时）：“每日奖励已配置，兑换码入库仍待核实，暂不能确认已具备提审条件。”提审后报告“审核中”，不说活动已开始。

## References

| Reference | 什么时候读 | 读取方式 |
| --- | --- | --- |
| game-sign runbook | 状态与可执行动作、主体/奖励/集卡配置、自检、提审/撤回、审核结果、错误与名单导出 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-game-sign/references/game-sign-runbook.md"})` |
| code import | 本地 CSV 导码、确认 hash、任务恢复与库存核实 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-game-sign/references/code-import.md"})` |
| 跨域运营流程 | 用户明确要求串联签到、公告和推送 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/interactive-operations-flow.md"})` |

## 不在本手册范围

- 本地图片交给 `taptap-materials`，带回原目标和用途；字段映射见 runbook。
- 公告位转 `taptap-whats-new`，关注用户推送转 `taptap-official-message-push`；这些交接不自动授权上线或发送。
- 通用礼包、TapLink 后台及其他运营模块不在本插件范围。
