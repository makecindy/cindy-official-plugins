# Version 状态机（字段可编辑性 + lifecycle 前置约束）

状态码（与 tds-dc `AppApproveStatus` 枚举对齐）：

```
未发布(0) ──提交审核──> 审核中(1) ──通过──> 已上线(4) 或 定时上线(3)
   ↑                       └──拒绝──> 审核失败(2) ──修改后再提交
   └────────────────────────────────────────────────────── 已下架(5)
```

> 状态值变迁里 `status="scheduled"`（定时上线）是「审核通过 + 提审时选择定时发布」**自动**进入的——发布档期是在 `submit-app-review` 一次性传入或沿用草稿 `release_schedule` 的，**不是**审核通过后再去单独设置时间。

> 注：`status_value === null` 表示后端未下发 status（草稿创建中或边缘态）。这种情况下 `isReadOnly = false`（与网页端资料编辑行为对齐），可继续走编辑/补资料路径——但要意识到这是非常规态，建议主动复查或刷新数据。BFF adapter 内部还存在历史 fallback 把缺失值表示为 `-1`，但 analysis 层已统一收敛为 `null`，模型不应再依赖 `-1` 这个值。

### 字段可编辑性

| 状态码 | 名称（归一化 `status`） | 是否只读 | 行为 |
|---|---|---|---|
| `0` | 未发布（`draft`） | ❌ 可编辑 | 正常调修改工具 |
| `2` | 审核失败（`rejected`） | ❌ 可编辑 | 正常调修改工具 |
| `1` | 审核中（`reviewing`） | ✅ 全锁 | 不要调 save-changes；告知用户"当前应用处于审核中，资料暂时无法修改"，建议等审核完毕或撤回审核（`withdraw-app-review`） |
| `3` | 定时上线（`scheduled`） | ✅ 全锁 | 同上保守处理（如需修改定时时间用 `reschedule-release`；如需撤销定时用 `cancel-scheduled-release`） |
| `4` | 已上线（`online`） | ✅ 全锁 | 同上 |
| `5` | 已下架（`offline`） | ✅ 全锁 | 同上 |

判断依据：用 `list-app-versions` 找当前版本，并在需要时用 `get-app-version` 读取当前声明的 `status` 和 `revision`；字段是否可编辑同时以目标模块当次返回为准。`status_value` 仅用于兼容排查，业务判断优先使用归一化的 `status`。**永远以当前读取结果为准**，不要凭对话历史推断。

⚠️ 遇到无法由 `status` 判断的生命周期状态时一律停止并报告“无法确认”。游戏资料编辑页可在 app scope 已明确时使用 CLI 的规范固定地址；公开商店页只有在审核通过且已确认上线后才展示，未确认上线前即使能按 app scope 推导地址也不要输出或描述该入口；包体管理等其它页面不由 CLI 承诺入口地址，不要从读取结果推导或拼接。

### 状态值与业务事件

历史事件读取 `get-app-version.result.logs[]`（或 `list-app-versions.result.list[].last_event`）区分。不能仅凭当前 `status` 还原以下业务事件：
- 真的"被审核驳回"（`logs[].event === 'review_rejected'`，可能附 `reason` 或 `note`）
- 用户主动"撤销定时上线"（`logs[].event === 'schedule_cancelled'`）

仅看当前 `status` 不能区分历史事件。用户询问具体拒审或撤定时原因时，先按
`updated_time` 选择对应 `event` 的最近记录；`updated_time` 缺失时保持服务端返回顺序，
不能假定数组尾部一定最新。日志缺失、原因为空或事件为 `unknown` 时明确说明无法确认。

| event | 业务事件 |
|---|---|---|
| `draft_created` | 创建新版本 |
| `review_submitted` | 提交审核；本次提审可一次性携带或沿用 `release_schedule` |
| `review_withdrawn` | 撤销审核 |
| `review_approved` | 审核通过 |
| `review_rejected` | 审核失败（真驳回，可能附 `reason` 或 `note`） |
| `schedule_changed` | 更改定时上线时间（可能附 `release_time`） |
| `schedule_cancelled` | 撤销定时上线（**不是真驳回**） |
| `published` | 游戏上线 |
| `unknown` | 上游返回了尚未识别的新事件，不能自行解释 |

OpenAPI 只承诺 `logs` 按 Zeus 返回顺序排列，不承诺时间正序。回溯"最近一次发生了
什么"时，对目标 `event` 的记录按非空 `updated_time` 取最大值；无法比较时间时只报告
候选事件和服务端顺序，不宣称哪条最新。同一版本可能反复提审被拒，"上一版为什么被拒"
应寻找最近的 `review_rejected`，读取它的 `reason` 或 `note`。找不到该事件说明无法证明
发生过真实驳回，不能把 `schedule_cancelled` 当成拒审。

### 发布档期何时设置——⚠️ 一图看清两种工具的分工

根级发布档期优先使用 `release_schedule` / `release_schedule`。精确定时的 `release_time` 不是审核通过后再单独设置的字段，而是**伴随提审动作一次性传入**的。

| 场景 | 用哪个工具 | 何时传发布档期 |
|---|---|---|
| 草稿首次发布且要精确定时上线 | `submit-app-review` | 在提审这一次调用里传 `release_schedule={kind:"scheduled_exact", release_time:<Unix秒>}`；先把用户给出的绝对或相对时间换算为 Unix 秒，审核通过后系统按它自动进入 `status="scheduled"`（待上线） |
| 草稿首次发布且要立即上线 | `submit-app-review` | 传 `release_schedule={kind:"immediate"}`，审核通过后立即进入 `status="online"`（已上线） |
| 已经在 `status="scheduled"`（待上线）想推迟 / 提前 | `reschedule-release` | 传新的 `release_time`；不能用 `submit-app-review` |
| 已经在 `status="scheduled"`（待上线）但定时到点仍未发布 | `publish-scheduled-release` | 重新读取并确认 `release_time <= 当前时间`；展示立即上线影响，用户确认后执行并读回版本与分发状态 |
| 已经在 `status="scheduled"`（待上线）想撤销定时 | `cancel-scheduled-release` | 撤销定时回到 `status="rejected"`（审核失败），可重新提审 |

提审链路只接受 `release_schedule={kind:"immediate"}` 或 `{kind:"scheduled_exact", release_time:<Unix秒，非毫秒>}`。用户只给季度、月份或节日前后等模糊档期时，要求补充具体时间或选择立即上线；不要构造 schema 不支持的 `scheduled_vague`。

⚠️ **不要先把草稿 submit-app-review 提审，再单独调 reschedule-release 设时间**——`reschedule-release` 的前置是 `status="scheduled"`，草稿状态下根本调不通。"定时上线时间必须 ≥ 当前 + 6 小时"是 taptap-cli 与开发者后台网页端定时面板共同遵循的**前端 / BFF 校验**约定，不是 zeus 后端硬约束；`submit-app-review` 的 `submit-core` 与 `reschedule-release` 各自校验。用户问"为什么必须 6 小时"时应解释为「上线发布缓冲，避免临到点改时间错过推送」，不要描述成 zeus 后端拒绝。
