# game-sign runbook:主体、奖励、集卡、自检与提审

本文是 Agent 的执行参考，不是默认用户回复模板。业务回复按 [game-sign 手册](taptap-suite/references/taptap-game-sign/MANUAL.md) 与 shared execution 的输出规则组织；用户明确要求技术细节时才展示调用细节。

示例 ID、时间、数量和链接只说明结构，执行时替换为当前目标与用户已授权的值。写操作先 `dry_run: true` 预览，用户确认后用相同参数加 `yes: true`，同一意图复用 `idempotency_key`。

## 顺序与完成条件

新建按下表顺序；编辑先回读，从最早有变更的阶段继续，未涉及的阶段核对后跳过，不重写。局部编辑/只建主体按用户范围结束，不擅自扩展为完整配置。

| 顺序 | 动作 | 进入下一阶段的条件 |
| --- | --- | --- |
| 1 主体 | 新建收集方案后 create；编辑回读后 update | `get-game-sign-activity` 核对标题、时间、兑换配置与开关；记录 `review_id`，仍是草稿 |
| 2 每日奖励及库存 | 按累计天数升序保存每档内容与图片，再处理该档兑换码 | `get-game-sign-config` 核对对应 `award_id`；本次导入完成且库存符合预期 |
| 3 集卡及库存 | 仅开启时：读取预置卡，必要时新增取得 `card_id` → 保存卡片和奖品 → 按类型补库存 | 回读同一 `card_id` 的类型、封面、概率、奖品及库存 |
| 4 自检 | 配置和库存回读完成后 `check-game-sign-readiness` | `ready_to_submit=true`；解释 warning，不用通过结果覆盖未完成的用户要求 |
| 5 提审 | 仅授权包含提审时 `submit-game-sign-review` | 回读进入审核中；只要求配置时在此之前交付摘要 |
| 6 审核结果核对 | 回读审核状态、时间及活动链接 | 区分审核中、通过未开始和可签到；不承诺自动审核或后台轮询 |

任一步失败/结果未知即停在该阶段，记录已完成项、目标 ID、未确认结果和下一步；恢复先回读，避免重复加库存、重复导码或重建活动。

## 状态与可执行动作

| `review_status` | 含义 | 可编辑 | 可提审 | 可撤回 |
| --- | --- | --- | --- | --- |
| `PENDING_COMMIT` | 待提交 | 是 | 是 | 否 |
| `UNDER_REVIEW` | 审核中 | 否 | 否 | 是 |
| `REJECT` | 审核拒绝（`review_remark` 给驳回原因，可直接改后重提） | 是 | 是 | 否 |
| `ACCEPT` | 审核通过，未到签到开始 | 否 | 否 | 否 |
| `GAME_SIGN_START` | 签到进行中 | 否 | 否 | 否 |
| `ACTIVITY_END` | 活动结束 | 否 | 否 | 否 |

```text
# 无 review_id 时定位活动（分页需要实际读取）
call_tool(name:"game-sign list-game-sign-activities", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{page:1, page_size:20}, page_all:true, page_limit:1000})

# 读活动/审核状态
call_tool(name:"game-sign get-game-sign-activity", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{review_id:"<reviewId>"}})

# 读主体、奖励、集卡与库存
call_tool(name:"game-sign get-game-sign-config", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{review_id:"<reviewId>"}})
```

优先复用已记录的 `review_id`；否则完整分页后核对标题与时间，同标题多候选让用户选择。覆盖不完整时停止创建，不把未找到当成不存在。

## 1. 创建活动主体

创建前先定基础方案，再了解奖励和素材；用户一次给齐就直接预览。时间、标题、主题色、兑换方式、集卡和推荐内容需求先确定，再写入。可选推荐无需求不追问。

兑换方式只有两种，提问围绕玩家操作：

- **游戏内兑换**：补问“请提供玩家在游戏里的兑换步骤或说明”，填 `redeem_method`；新建且没有网页入口时 `redeem_url` 留空。
- **网页兑换**：补问“请提供兑换页面链接”，填 `redeem_url`；用户有补充说明时再填 `redeem_method`。
- 说明和入口不能都为空；不得把邮件发放列为选项，也不得把示例说明当成已确认的游戏能力。

```text
call_tool(name:"game-sign create-game-sign-activity", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{title:"<活动标题>", color:"#FF8800",
        game_sign_start_time:<秒级时间戳>, game_sign_end_time:<秒级时间戳>,
        activity_end_time:<秒级时间戳>, enable_card_collection:false,
        moment_url:"<可选>", redeem_method:"<游戏内兑换说明>", redeem_url:""},
  idempotency_key:"<stable-key>", dry_run:true})
```

字段：`title`、`color`、`game_sign_start_time`（签到开始）、`game_sign_end_time`（签到结束）、`activity_end_time`（奖励兑换截止，不早于签到结束）、`enable_card_collection`、可选 `moment_url` / `redeem_url` / `redeem_method` / `recommends`（≤2 条）。

返回 `review_id`、`activity_id`、`review_status=PENDING_COMMIT`、`award_id`、`card_id`。`activity_id` 此时可能已有值（草稿活动），但**未生效**；生效要等审核通过。修改要求 `editable=true`，不传 `enable_tap_link` 时保留存量值。

时间限制：签到结束不早于开始，签到跨度 <45 天；兑换截止不早于签到结束，且不超过签到结束日期后 14 天（按服务端自然日）。建议为兑换预留至少 7 日，但这是运营建议，不是强制最短窗口。

## 2. 本地图片交接

- 累计签到奖品图：144×144 透明 PNG；集卡封面：342×426 PNG；集卡奖品图：216×216 透明 PNG；活动头图用游戏 16:9 宣传图。
- 本地图片交给 `taptap-materials` 的 `upload` shortcut，交接时带游戏、`review_id`、目标天数/`award_id`/`card_id` 和用途；回传 `data.url` 与 `data.info` 后写目标字段（奖励 `picture`、卡片 `cover_url`），不修改游戏资料，不要求用户复制 URL。
- 上传成功不代表符合展示要求；上传预览没有远端 URL，不能提前假设上传结果。

## 3. 每日奖励

奖励文案用「、」分隔道具，用「*」连接道具与数量，不手动换行；内容和数量由用户确认。按累计天数升序配置。

```text
# 新增第 1 天
call_tool(name:"game-sign save-game-sign-award", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{review_id:"<reviewId>", days:1, content:"钻石x100",
        picture:"https://cdn.example.com/a1.png", state:"<游戏内兑换说明>"},
  idempotency_key:"<stable-key>", dry_run:true})

# 修改已有奖励：带 award_id
call_tool(name:"game-sign save-game-sign-award", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{review_id:"<reviewId>", award_id:"<awardId>", days:1, content:"钻石x200",
        picture:"https://cdn.example.com/a1.png", state:"<兑换说明>"},
  idempotency_key:"<stable-key>", dry_run:true})

# 删除奖励（纠错）
call_tool(name:"game-sign delete-game-sign-award", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{review_id:"<reviewId>", award_id:"<awardId>"},
  idempotency_key:"<stable-key>", dry_run:true})
```

返回的 `award_id` 是这条奖励的 ID；为 `null` 时用 `get-config` 按 `label`（如 `1日签到礼包`）核对。奖励缺 `picture` 会被 `check-readiness` 标为 `award_incomplete` 并阻断提审。

## 4. 兑换码导入

本地文件走 [导码与恢复](taptap-suite/references/taptap-game-sign/references/code-import.md) 的 `game-sign +import-codes`；每日奖励用 `award_id`，集卡用 `card_id`，两者互斥。提交受理不等于本文件导入完成，必须回读目标库存：

```text
call_tool(name:"game-sign get-game-sign-code-import", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{review_id:"<reviewId>", award_id:"<awardId>"}})
```

- `NOT_UPLOADED`：等待上传；`PROCESSING`：继续查询；`FAILED`：核对失败原因和已成功数量后再补码；`COMPLETED`：核对目标与库存后继续。
- 该查询只有目标最近记录，没有稳定批次 ID；不能把旧的 `COMPLETED` 当成本次文件成功。无法对应本次上传时保持待完成并在页面核实。

## 5. 集卡（可选）

开启集卡后先读 `get-game-sign-config`，核对服务端预置卡片、类型与 ID。配置现有卡片时复用原 `card_id`；确需新增且当前限制允许时才 `add-game-sign-card`，用返回的 `card_id` 保存。存在预置卡不等于禁止新增；满额时不自动删卡腾位。可补回缺失的 SR/SSR 奖品卡，不能新增基础卡或任意扩充等级。

```text
# 开启集卡（仅本次要求开启且当前未开启时；新建已开启则跳过）
call_tool(name:"game-sign update-game-sign-activity", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{review_id:"<reviewId>", title:"<活动标题>", color:"#224488",
        game_sign_start_time:<start>, game_sign_end_time:<end>,
        activity_end_time:<end>, enable_card_collection:true},
  idempotency_key:"<stable-key>", dry_run:true})

# 基础卡：名称与封面，rate=0
call_tool(name:"game-sign save-game-sign-card", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{review_id:"<reviewId>", card_id:"<cardId>", card_title:"基础卡",
        cover_url:"https://cdn.example.com/c.png", rate:0},
  idempotency_key:"<stable-key>", dry_run:true})

# 奖品卡（非 BASIC）：10% 对应 rate=10000（100000 为 100%），必须带 award
call_tool(name:"game-sign save-game-sign-card", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{review_id:"<reviewId>", card_id:"<cardId>", card_title:"紫卡",
        cover_url:"https://cdn.example.com/c.png", rate:10000,
        award:{title:"钻石x500", picture_url:"https://cdn.example.com/a.png",
               type:"GOODS", redemption_conditions:"<集卡规则>",
               state:"<实物领奖说明>", expire_time:<秒级时间戳>}},
  idempotency_key:"<stable-key>", dry_run:true})

# 实物库存
call_tool(name:"game-sign add-game-sign-card-stock", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{review_id:"<reviewId>", card_id:"<cardId>", add_count:100},
  idempotency_key:"<stable-key>", dry_run:true})
```

`award` 字段：`title`、`picture_url`、`type`（`GOODS` 实物 / `REDEEM_CODE` 兑换码）、`sub_type`（`REDEEM_CODE_GAME` / `REDEEM_CODE_JD`）、`expire_time`（秒级时间戳，必填）、`redemption_conditions`、`state`、`exchange_url`。

配置必填条件：

| 场景 | 必填 | 不额外要求 |
| --- | --- | --- |
| 基础卡 BASIC | 名称、封面 | 集卡规则、奖品说明 |
| 奖品卡 SR/SSR | `award.redemption_conditions` | 不自动套占位示例 |
| 实物奖品卡 GOODS | `award.state`（实际领奖/发放流程） | 网页兑换链接 |
| 兑换码奖品卡（文字说明） | `award.state` | `award.exchange_url` |
| 兑换码奖品卡（网页兑换） | 有效 `award.exchange_url` | 无关文字说明 |
| 每日奖励 | 游戏内兑换 `state` / 网页兑换 `exchange_url` | 未选择方式的空字段 |
| 活动主体 | 游戏内兑换 `redeem_method` / 网页兑换 `redeem_url` | 未选择方式的空字段 |

这些信息缺失时，即使保存成功也不能视为配置完整。奖品卡规则与中奖说明是不同信息，不能相互替代。库存按类型处理：`GOODS` 用 `add-game-sign-card-stock`，`REDEEM_CODE` 用导码。基础卡不可删除；删奖品卡前核实目标与授权，删除后回读配置。

## 6. 提审前自检

运营审核要求每日奖励每档不少于 1000，集卡奖品卡每张不少于 5 件（不要套到实物奖品卡）。自检通过不替代提交时的最终校验。

```text
call_tool(name:"game-sign check-game-sign-readiness", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{review_id:"<reviewId>"}})
```

| code | 含义 | 下一步 |
| --- | --- | --- |
| `time_range_invalid` | 开始≥结束，或兑换截止早于签到结束 | 改 `update-game-sign-activity` |
| `no_award` | 没有任何奖励 | 先 `save-game-sign-award` |
| `award_incomplete` | 奖励缺图片 | 补 `picture` |
| `code_not_imported` | 缺礼包码：未导入兑换码且无可用库存 | 按 code-import 导入对应奖励 |
| `code_processing` | 兑换码导入中 | 等 `COMPLETED` 再提审 |
| `card_incomplete` | 开启集卡但没卡或缺封面 | 用 `save-game-sign-card` 补封面 |
| `card_no_stock` | 奖品卡没有奖品或库存为 0 | 配置奖品；GOODS 补实物库存、REDEEM_CODE 导码 |
| `status_not_editable` | 状态不允许再次提审 | 看是否需要撤回或等下一期 |

`ready_to_submit=true` 且用户已授权提审才进入下一步。

## 7. 提交 / 撤回审核

```text
call_tool(name:"game-sign submit-game-sign-review", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{review_id:"<reviewId>"},
  idempotency_key:"<stable-key>", dry_run:true})

call_tool(name:"game-sign withdraw-game-sign-review", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{review_id:"<reviewId>"},
  idempotency_key:"<stable-key>", dry_run:true})
```

- 提交后服务端会再次校验主体、奖励、集卡、库存与导码，材料不全会拒绝并给出中文原因。
- 撤回只允许 `UNDER_REVIEW`；其它状态返回 `failed_precondition`。
- 提交成功 ≠ 通过 ≠ 开始；用 `list-activities` / `get-activity` 跟状态。官方说明 2 个工作日内处理，不保证具体通过时间。

## 8. 审核结果与生效

- 驳回：`review_status=REJECT`，`review_remark` 是后台填写的驳回原因；改完配置可直接重新提审。
- 通过后 `activity.activity_id` 有值、`review_status` 进入 `ACCEPT`/`GAME_SIGN_START`、`activity.activity_url` 可读，才算真正生效。
- 时间驱动：审核通过未到开始为 `ACCEPT`；`game_sign_start_time` 后为 `GAME_SIGN_START`；`activity_end_time`（领奖截止，不是签到结束）后为 `ACTIVITY_END`。判断玩家能否签到还要核对 `game_sign_end_time`。

签到启用后会自动收录到“活动与公告”，上线与置顶仍受容量限制；用户要求核对展示时转 `taptap-whats-new`，不重复创建普通活动，也不通过改名或下架再上架触发刷新。

## 9. 权限与错误

- `app_id` 必须属于传入的 `developer_id`，否则读写都返回 `permission_denied`（403）；查询也需要满足归属限制，权限失败不能当作没有活动，不换厂商 ID 探测或绕过。
- `not_found`：`review_id`/`award_id` 不属于当前游戏，用 `list-activities` 重新取 ID。
- `failed_precondition`：状态不允许、未开集卡、集卡集合未生成、只有审核中可撤回；按返回的 `error.message` / `error.hint` 处理。
- `invalid_argument`：字段非法（时间、`oss_key` 前缀、天数、概率）或上游业务拒绝；按括号里的中文原因处理（如“兑换方式和兑换入口不能都为空”“签到礼包缺少礼包码”“集卡奖品库存不足”）。
- `result_unknown`：用 `get-config` / `list-activities` 核实后再决定；不自动重试、删卡或换 key。

更新主体时必填字段仍需完整传入；可选链接、兑换说明、推荐位省略或 null 保留，显式空字符串/空列表才清空。已有奖品不支持在实物与兑换码之间直接切换；补库存失败不能靠改概率或替换奖品类型修复。

## 10. 名单导出

```text
call_tool(name:"game-sign export-game-sign-physical-prize-recipients", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{review_id:"<reviewId>"}})
```

导出实物中奖收货信息并返回下载地址，需要当前应用的签到管理权限。地址与文件可能含个人信息，仅交付给请求者，不写入日志或共享报告。实物中奖名单不等于全部签到参与者；当前不支持查询/导出完整参与名单，不从签到人数、库存或码文件推断用户明细。

运营参考：[利用签到活动，拉动玩家活跃](https://developer.taptap.cn/docs/store/operation/advanced-guide/op-skills/game-sign/)（2026-10-30 核对）。
