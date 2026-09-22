# App Edit Audit And History

## 内容导航

- 提交审核
- 字段回退（F）
- 版本生命周期：撤审 / 撤定时 / 改时间 / 定时到期强制生效 / 重置 / 恢复（G）
- 版本历史回溯（H）
- 整套推进：更新版本 / 补齐资料 / 帮我处理这一版（I）

### 提交审核

提审是不可逆的敏感操作（过审后游戏可能按选择的上线方式发布）。

#### 提审意图门禁

哪些请求算提审意图、哪些只算目标方向，以 [shared execution](taptap-suite/references/shared-execution.md)「提审意图门禁」的唯一词表为准，本文件不另立清单；本节流程从“用户已明确提审”开始。

标准流程固定为：`prepare-review-snapshot` → `precheck-app-review` → 单独最终确认 → `submit-app-review --idempotency-key <submit-key> --yes`。**第 2、3 步必须传完全相同的 `release_schedule`**；第 1 步的入参只有 scope，不接受该字段（`additionalProperties: false`，多传即校验失败）。用 `version_id` 校验第 2、3 步仍在复核第 1 步的同一版本（`revision` 只有第 1 步返回）。当前 metadata 把前两步标为 `read`，无需 `--yes` 与幂等键；`submit-app-review` 仍为 `write`，需稳定幂等键与 `--yes`。CLI 不覆盖其风险分类。

发布前必须把“版本发布”和“平台分发状态”拆开处理：

- 调 `get-app-module` 并传 `{"module_id":"platform-status"}`，只筛选接口当次实际返回且可见的 `region_flag_*` 字段，读取各字段的 `current_value`、`value_labels` 和 `options`。
- 不要把同模块的 `app_platforms`、`itunes_id`、`steam_id` 当成分发状态入口，也不要预设游戏类型、包体方向与状态枚举之间的映射；工具未返回的入口不要猜测或补写。
- 使用 `value_labels[String(current_value)]` 逐项解释当前状态；不要把字段自身的 `label` 当成状态文案。若任一可见分发状态入口是“敬请期待”，说明发布版本不会自动改变该入口；如需开放下载或游玩，应在提审前把该入口改为当前 options 中的可用值、随本次版本一起审核生效，并询问保留当前值还是调整。
- 用户选择修改时，先展示当前状态、目标状态、该字段动态 `options` 和影响，并执行带最新 `expected`、稳定 `--idempotency-key` 的 `save-changes --dry-run`。用户明确确认后复用同一个 key，去掉 `--dry-run` 并追加 `--yes` 写入；成功后重新读取 `platform-status`。
- 用户不修改时保留原值。执行 `submit-app-review --yes` 前必须再次读取 `platform-status`；若可见字段、当前值或 options 变化，废弃旧摘要并按最新结果重新确认。

三步：

#### 步骤 ① `prepare-review-snapshot`

进入步骤 ① 前，先按 [review risk checklist](taptap-suite/references/taptap-app-edit/references/review-risk-checklist.md) 输出本地风险清单，分开列出官方规则、当前事实、历史审核、测试证据和无法验证项；其中**资质确认**转 qualification 手册（见其「提审前资质确认」执行规则）。该清单不替代服务端 blocker，也不能把历史拒审写成官方规则。

然后确定本次上线方式，只允许 `{"kind":"immediate"}` 或 `{"kind":"scheduled_exact","release_time":<Unix秒>}`；不传时沿用草稿设置。**步骤 ① 的 operation 只接受 scope，不接受这个字段**，所以此处只确定取值，到步骤 ② 才作为 `release_schedule` 传入。调用后：

- 用 `prepare-review-snapshot` 返回的 `changes` 和 `warnings` 向用户复核资料、包体、资质和风险提示；未填写与不适用要明确区分。
- 合并展示本地风险清单与服务端结果时保留来源；服务端结果优先，不能静默删除其 blocker 或 warning。
- `prepare-review-snapshot` 返回的 `warnings` 非空时，说明当前无法确认的风险事实，不能把它们当作已通过。
- 保存本次返回的 `revision` 和 `version_id`，后续两步用它校验复核对象未漂移；禁止自行生成或修改。（`preaudit_passed` / `blockers` 不在本步的返回里，属于步骤 ②。）

#### 步骤 ② `precheck-app-review`

传入完全相同的 `release_schedule`。`precheck-app-review` 返回 `blockers` 非空 或 `preaudit_passed === false` 时，向用户逐项展示 `blockers`（阻塞，提交会被服务端拒绝）与 `warnings`（风险提示），并询问是否继续。预检是**可跳过**的：用户明确「强制提交」时允许进入步骤 ③ 执行 `submit-app-review`，由服务端做最终校验裁决；未明确时建议先修复 `blockers`。

向用户展示预检结果时保留业务语义，不直接回显字段名或布尔值。正式预检通过（`preaudit_passed === true`）、且没有阻断项（`blockers` 为空）时，固定输出：

- 阻塞项：无
- 提交状态：可提交审核

`preaudit_passed === false`（机审未通过）时，仍输出「阻塞项：无」「提交状态：可提交审核」，但**必须同时说明「内容预审未通过：不阻断提交，但提交后可能被审核驳回」**并逐项展示 `PREAUDIT` warnings——「可提交」与「机审未过」两者要同时说清，不能只报其一。

`preaudit_passed` 只用于内部流程判断，不得向用户原样输出 `Blocker`、`preaudit_passed=true` 等机器字段。存在阻断项时，逐项展示服务端返回的阻断原因，不得输出“可提交审核”；用户明确「强制提交」时说明提交可能被服务端拒绝，允许继续。

| 返回 | 含义 | 处理 |
| --- | --- | --- |
| `blockers` 非空 | 存在阻断项 | 逐项展示阻断原因（提交会被服务端拒绝），询问是否「强制提交」；用户确认时允许进入步骤 ③ |
| `preaudit_passed === false` | 机审未通过 | 展示 `PREAUDIT` warnings，说明「不阻断提交，但提交后可能被审核驳回」；询问是否继续 |
| `warnings` 非空 | 有风险提示 | 展示 `warnings`，询问"是否继续提交？" |
| `preaudit_passed === true` 且 `blockers` 为空 | 可提交 | 等待最终提交确认 |
| `version_id` 与步骤 ① 不一致 | 复核后版本已变化 | 回到步骤 ①重新生成快照并复核，禁止沿用旧快照 |
| 顶层 `ok: false` | 工具失败 | 按 `error.type` / `error.subtype` 告知失败，停止；业务成功或状态读取当前 operation 已声明字段 |

#### 步骤 ③ `submit-app-review`

步骤 ② 预检是**可跳过**的：`preaudit_passed === true` 且 `blockers` 为空时可直接提交；否则向用户展示卡点后，用户明确「强制提交」仍可进入本步执行 `submit-app-review`，最终由服务端校验（`blockers` 拒绝 / `warnings` 不拒）裁决。

参数：

- 复用步骤 ②的同一个 `release_schedule`；`version_id` 与第一步不一致时回到步骤 ①。
- 传与前两步一致的 `release_schedule`；精确定时的 `release_time` 必须是 Unix 秒。
- 精确定时上线时间必须 **≥ 当前时间 + 6 小时**（这是 taptap-cli 与 tds-dc 共同遵循的**前端校验**约定，不是后端硬约束；BFF 在 `submit-core` 自校验后再调后端）。
- 若步骤 ①返回的 `warnings` 非空，必须展示无法确认的事实。`submit-app-review` 只接受 `release_schedule`，不能补造本地 flag 或请求字段；`--yes` 不代表已核对。

《创意工坊内容授权协议》由 `analyze-app-status` 提前暴露，**不要在 precheck 时才处理**：

- 关卡 / TapTap 制造游戏（`isLevel || isTapMaker`）未签署时，`analyze-app-status` 返回 `SCE_AGREEMENT_REQUIRED` blocker（含协议 url）。体检阶段就要引导签约，不要等到提审卡控。
- 展示协议：名称《创意工坊内容授权协议》，url `https://www.taptap.cn/doc/ugcgame-agreement`。
- 用户在当前对话明确同意后，调 `call_tool(name:"app agree-sce-agreement", args:{app_id:"<appId>", developer_id:"<developerId>", yes:true})` 签署，再重查 `analyze-app-status` 确认 blocker 消失。
- 用户不愿用 CLI 签时，给协议 url 引导去开发者后台签约，签完回来重查。
- `--yes` 只确认签署动作，不代表用户已同意协议；签署前必须用户明确同意，不得自行声称已同意。
- 签署失败或协议状态无法确认时停止，不继续调用提审；向用户说明工具返回的错误。
- `submit-app-review` 仍会做最终卡控（未签署 → 拒绝提交）；签约后该卡控自动通过。
- 若 `version_id` 与步骤 ① 不一致，回到步骤 ①，不得用旧快照重试。

询问上线方式："立即上线"还是"精确定时上线"。**草稿已有受支持的上线方式设置时优先沿用，不要重复询问**（从 `release-settings` 模块读取当前 `release_schedule`）。

**用户说"今晚 10 点发布 / 帮我定到明早 9 点 / X 时间上线"**——把换算后的 `release_schedule={"kind":"scheduled_exact","release_time":<Unix秒>}` 从步骤 ② 开始传入两步，不要先提审通过再去单独设时间。用户说"2026 年 Q4 / 暑期 / 春节前后"这类非精确档期时，说明当前链路只支持精确时间或立即上线，要求补充具体时间或选择立即上线。

**相对时间表达必须先取精确时间再换算**：当用户说"5 小时后 / N 小时后 / 明早 9 点 / 今晚 10 点"等相对时间或仅含时分的表达时，使用本地系统时间（Asia/Shanghai）换算成 Unix 秒传给 `submit-app-review`；如果无法可靠取得当前时分秒，就要求用户给绝对时间。不要凭空估算时分。

成功后告知"已成功提交审核，请耐心等待审核结果，通常 1-3 个工作日"，并附最新读回的各可见 `region_flag_*` 分发状态。仍为“敬请期待”的入口要说明：本次提交未调整该入口，发布后它仍会保持“敬请期待”；如需开放下载或游玩，请在下一轮提审前先调整对应分发状态。这不代表发布失败。

最后按 shared execution 的“运营阶段手册交接”补充一个后续运营入口和一句官方描述摘要；进入提审链路时先用 `list-app-versions --page-all` 读取完整发布历史并保存本次证据，作为后续阶段判定的输入。提审成功本身不能证明运营阶段，历史不完整或证据冲突时只给快速入门总入口。

### F. 撤销 / 回退（字段级）

> 注意：本节是**字段值的撤销**（再次 `save-changes` 改回旧值）。版本级的撤销审核 / 撤销定时 / 重置见下文 G 段（同 skill）。

查看之前 `save-changes` 返回的 `changes[].from` 值，再次调 `save-changes` 把字段恢复（`from` 为 `null` 时传 `value: null` 清空）。撤销同样要遵守 read-before-write —— 必须先重新读取该字段最新值（用户可能在中间又改了别的）。

### G. 版本生命周期（撤审 / 撤定时 / 改时间 / 重置 / 恢复）

> **背景**：unpublished Version 是一个有状态机的对象。除了"改字段 → 提交审核"主流程（上文 B-E），还有以下「状态机分支」需要 agent 介入。下文每个工具的前置/后置状态见 schema 注释，违反前置时工具会返回业务化错误。
>
> lifecycle 写动作前**始终先**用 `list-app-versions` / `get-app-version` 确认当前声明的 `status`、版本 ID、`revision` 和版本详情；需要判断历史事件时读取 `logs`，但写入仍必须重新读取当前模块的最新 `expected`。

#### G-1. 撤销审核 → `withdraw-app-review`

用户场景："撤回审核 / 不上了 / 改一下再提"——当前 `status="reviewing"`（审核中）时。

先 `withdraw-app-review --dry-run` 或展示动作影响；用户明确确认后追加 `--yes` 执行。成功后版本回到 `status="draft"`（草稿），可继续 `save-changes`。

#### G-2. 撤销定时上线 → `cancel-scheduled-release` ⚠️ 文案陷阱

用户场景："撤销定时 / 不定时了"——当前 `status="scheduled"`（待上线）时。

先 `cancel-scheduled-release --dry-run` 或展示动作影响；用户明确确认后追加 `--yes` 执行。成功后**后端 status 会变成 `2`（与"审核失败"复用同一状态值）**，但业务事件是"撤销定时"。

<critical>
告知用户时**禁止**复述"已变更为审核失败 / status=2"（原始值 2 与"审核失败"复用，归一化后表现为 `status="rejected"`）。统一说"已撤销定时上线，可以修改后重新提审"。
工具返回 `last_event='schedule_cancelled'`、归一化的 `status`、`version_id`、`revision` 和已清除的 `release_time`；业务文案以 `last_event` 为准，不把 `status='rejected'` 误报成审核失败。
通过当前版本的 `logs` 区分 `schedule_cancelled` 与 `review_rejected`；日志缺失或事件为 `unknown` 时才报告“审核历史无法确认”。
</critical>

#### G-3. 修改定时时间 → `reschedule-release`

用户场景："改一下上线时间 / 推迟 2 天 / 提前到明早"——**当前 `status="scheduled"`（待上线）时**。

参数与 `submit-app-review` 的定时分支同构：只传 Unix 秒形式的 `release_time`；必须 ≥ 当前+6 小时。用户给的是绝对或相对时间表达（如「N 小时后」）时，使用本地系统时间换算为 Unix 秒；无法可靠换算时要求用户给绝对时间。

成功后状态仍是 `status="scheduled"`，仅 `release_time` 更新。

⚠️ **不要用本工具处理"草稿首次定时发布"的诉求**——草稿状态下 `reschedule-release` 会直接返回前置不满足。草稿首次定时发布走 `submit-app-review` 一次性指定 `release_schedule`，或先写草稿 `release_schedule` 后提审沿用。

#### G-4. 定时到点仍未发布 → `publish-scheduled-release` ⚠️ 不可逆

用户报告“定时到了还没上线”时：

1. 用 `list-app-versions` 重新读取当前版本；状态已经是 `status="online"` 时说明平台已发布，再读取 `platform-status` 报告分发入口状态。
2. 只有当前仍为 `status="scheduled"` 且 `release_time <= 当前时间` 时，才可展示“将立即把待上线版本发布为线上版本”的影响，并用稳定 key 执行 `publish-scheduled-release --dry-run`。
3. 用户明确确认后复用同一 key，加 `--yes` 执行；成功后重新读取版本和 `platform-status`，确认状态为已上线并报告各分发入口。
   - 按 shared execution「运营阶段手册交接」用提审前保存的历史证据判定运营阶段；缺少前置快照时使用快速入门总入口。
4. `release_time` 尚未到、状态已变化或无法确认时间时停止；如需改变计划，按前置使用 `reschedule-release` 或 `cancel-scheduled-release`，不得绕过状态门禁。

⚠️ **HITL 不可逆动作（submit-app-review / reset-draft）返回 `stale`、`status` 或 `submitted=false` 等当前 schema 声明的漂移/失败字段时**，说明用户确认期间状态可能已变化。此时必须重新读取版本、目标模块与包体状态再决策，不能基于 preflight 时的旧快照重试；不要读取未声明的 `data.result.ok` 或 `stale_reason`。

#### G-5. 重置为线上版本 → `reset-draft` ⚠️ 不可逆

用户场景："这一版改乱了 / 重来 / 回到线上那一版重新改"——当前 `status` 为 `"draft"` 或 `"rejected"` 且**存在线上版本**。

⚠️ **不可逆**：当前 draft 相对线上版本的所有未发布改动都会丢失（包括已保存到草稿但尚未发布的内容；用户的"草稿里改了一半"不会被保留）。底层实现是 `delete + create` 两步组合，**非原子**——第二步失败会留下无 unpublished 的中间态，由下方「失败恢复」段的重试 + `create-draft` 兜底。

**前置条件警示**：

- 首版应用 / 无线上版本时，工具会直接返回错误"还没有线上版本，无法重置"——这种情况下用户的意图通常是"清空当前 draft 的字段"，引导用户用 `save-changes` 清空具体字段而不是 reset。
- 当前版本若处于 `1/3/4/5` 状态，不能 reset；先按 G-1 撤审或 G-2 撤定时让版本回到可编辑态。

**失败恢复**：底层是 `delete + create` 两步。第二步上游故障时工具内部已做有限重试（500ms / 1s 间隔），若仍失败会返回明确错误：

- 收到错误时**不要**告诉用户"系统会自动新建"；先用 `list-app-versions` 重新确认是否仍有 unpublished。
- 正确做法：直接调 `create-draft` 基于线上版本把草稿建回来（zeus 端会拷贝线上 form_data，不是空白草稿）；仍失败时明确说明 CLI 未能完成恢复。该写错误不保证返回资料编辑 `page_path`；若 app scope 已明确，可提供 CLI 推导的规范资料页地址并标记来源，其它页面仍只有后续读取接口实际返回时才能作为人工入口，不得自行猜测。

#### G-6. 基于线上版本开新草稿 → `create-draft`

用户场景（**仅恢复用，不主动诱导**）：

1. `reset-draft` 失败后看到错误提示，主动调本工具把草稿建回来。
2. 当前状态分析显示 `has_unpublished=false && has_published=true`——常见于网页端误删草稿、上游瞬时故障、reset-draft 部分失败。

前置：`has_unpublished=false`（已有草稿时拒绝）且 `has_published=true`（首版应用无线上版本时拒绝——这种情况告知用户首版还没有可回退的基线，引导走开发者后台首版流程）。

纯恢复路径通常不需要额外确认；但如果工具标记为不可逆或返回确认门禁，仍按 shared execution rules 处理。

### H. 版本历史回溯

#### H-1. "上一版为什么被拒？" / "刚才那次提审什么结果？"

```text
call_tool(name:"app list-app-versions", args:{app_id:"<appId>", developer_id:"<developerId>", page:1, page_size:20})
```

- 按返回 `list` 顺序从新到旧扫描每个 item
- 读取每个版本的 `logs`，在 `event='review_rejected'` 的记录中按非空 `updated_time`
  取最大值；有 `reason` 或 `note` 时原样解释，没有时明确说明服务端未提供具体原因。
- 同一版本可能反复提审；不要把 `schedule_cancelled` 当作审核拒绝，也不要用第一条日志替代最近一次事件。

#### H-2. "最近发了几版？" / "这个月上了几次新版本？"

```text
call_tool(name:"app list-app-versions", args:{app_id:"<appId>", developer_id:"<developerId>", page:1, page_size:50})
```

- 按当前声明的 `status === 'online'` 过滤已上线版本，并使用 `version` 和 `release_time` 报告。
- 可以使用当前声明的 `created_time`；字段为 `null` 时保持未知，不自行补造时间。

#### H-3. "我想看下 X.Y.Z 版本当时改了什么字段"

```text
call_tool(name:"app get-app-version", args:{app_id:"<appId>", developer_id:"<developerId>", data:{version:"X.Y.Z"}})
```

- `version` 必须取自 `list-app-versions.result.list[].version`；列表项的 `version_id`
  当前只是兼容别名，不能作为另一个查询键。
- 读取 `detail.form_data` 作为该历史版本的只读字段快照，并与用户指定的另一个版本或当前模块读取结果做解释性比较。
- 历史快照不是当前 draft 的并发控制值；任何修改仍要重新读取目标模块的最新 `current_value` / `expected`。

⚠️ 用户**不能**通过 `get-app-version` 修改字段——它是只读快照。要改当前 draft 走 `save-changes`。

### I. 整套推进（"更新版本" / "补齐资料" / "帮我处理这一版"）

按固定顺序连续推进，不要每步停下等用户：

1. 按 [skill analysis](taptap-suite/references/taptap-app-edit/references/app-edit-analysis.md) 读取当前状态与阻断项
2. 只处理当前可填字段（按 `get-app-module` 的 visibility 过滤）
3. 能批量的尽量一次 `save-changes`（每批 ≤10 字段）
4. 修改后重新读取受影响模块，并按 skill analysis 确认进度
5. 满足条件再进入预审

例外：缺用户必要输入（图片素材、文案选择）或到正式提交确认点时停下。

### I-1. 用户说"更新版本 / 发新版"

这类话术的真实意图通常不是"立刻提审"，而是"把这次版本要发的东西梳理清楚并发出去"。处理顺序：

1. 先按 [skill analysis](taptap-suite/references/taptap-app-edit/references/app-edit-analysis.md) 读取当前 draft 状态、是否可编辑、是否已有明显阻断项
2. 再判断**当前 draft 相对线上版是否已经有明确变化**
3. 如需理解最近线上版 / 历史版本语义，可用 `list-app-versions` 找最近 published，再用 `get-app-version` 做回溯辅助
4. **如果当前还看不出本次更新内容**（例如 draft 与线上版没有可识别差异，或只有很弱的零散改动），不要直接说"那就提审"；应明确告诉用户"我这边还看不出你这次准备更新哪些内容"，然后追问本次更新核心是什么：
   - 包体更新
   - 游戏名 / 简介 / 宣传文案更新
   - 截图 / 宣传图 / 视频更新
   - 开放预约 / 开放测试 / 正式上线
5. 用户补充目标后，再进入对应模块的 read-before-write 修改流
6. 修改完成后重新读取并分析；用户明确提审后，再由正式预审确认 blocker 清零

关键约束：

- **没有识别到"本次版本要发什么"之前，不要把流程机械推进到提审**
- 若用户只说"更个版本"，优先帮他澄清"本次变化是什么"，而不是只复述当前状态
- `get-app-version` 是**只读回溯**，不能直接拿历史 `form_data` 当当前 draft 的 `expected`

### I-2. 用户说"发布资料 / 帮我发布"

这类话术过于宽泛，必须先理解业务阶段，再决定要补什么资料。处理顺序：

1. 先按 [skill analysis](taptap-suite/references/taptap-app-edit/references/app-edit-analysis.md) 读取当前草稿、缺失项、发布设置和包体
2. 先识别本次发布目标属于哪一类：
   - **首曝**：重点通常是基础信息 + 素材展示 + 对外呈现文案
   - **开放预约**：除基础资料外，重点确认分发状态 / 发布时机 / 预约相关展示信息
   - **开放测试**：重点确认测试阶段对应的资料、包体、展示状态
   - **版本更新**：重点确认这次相对线上版到底改了什么
   - **正式上线**：重点确认资料完整度、包体、上线方式（立即 / 定时）
   - **分发状态**：读取工具当次实际返回且可见的 `region_flag_*` 与各自 options，确认哪些入口保持“敬请期待”、哪些入口要切换到其他可用状态
3. 若用户没说清楚是哪一种，先追问**一个**高价值问题，不要连发问卷式问题：
   - "这次是想做首曝、开放预约、开放测试、更新版本，还是正式上线？"
4. 目标明确后，再只围绕该目标需要的模块补资料；不要一上来把所有可选字段全盘罗列给用户
5. 资料与设置补齐后，只报告准备状态和提审选项；只有用户明确说“提交审核 / 提审”后，才进入 `prepare-review-snapshot` → `precheck-app-review`，预审结果后仍需最终确认才进入 `submit-app-review`

关键约束：

- **"发布资料" ≠ "直接提交审核"**
- **“正式上线” ≠ “提交审核”**：正式上线只确认目标阶段，不授权调用提审工具
- 先判断目标阶段，再决定要补哪些资料、是否需要调整 `release_schedule`
- 发布版本不会自动改变分发入口状态；用户确认前和发布结果中都要逐项说明工具返回且可见的 `region_flag_*` 实际状态
- 用户未明确目标时，先做意图采集；不要让用户在不知道差异和目标的情况下直接过 approval
