# Test Plan Creation

### 触发条件

用户意图为「在 TapTap 对玩家开测试计划」时进入本流程。典型表述：

- "如何在 Tap 开测试"
- "如何对用户开测试"
- "我想开测试计划"
- "帮我开测试计划"

不命中（意图不是"对玩家开测试计划"）：

- "怎么测试"（可能问 QA / 功能验证）
- "我想测试一下"（可能指试玩）
- "测试环境怎么配"（开发环境问题）
- "试玩 H5 / 生成 H5 自测二维码"（转 `taptap-package-management`）

用户明确要求“让 H5 包进入 CBT/OBT”时，当前契约无法执行：OBT 只支持 Android/Windows，CBT 创建不接收平台或包体，当前公开契约也没有提供 H5 版本绑定。说明服务端需补充 H5 平台及版本绑定契约；不得创建 Android 测试计划冒充 H5 测试。

### 命中后决策链

步骤 1 → 创建前置读取 → 步骤 2 → 路由判断 → 步骤 3 → 推荐策略让用户选 → 步骤 4 → 执行创建

**步骤 1：完成创建前置读取**

1. `list-test-plans`：按 `test_type` 分页读取计划列表，确认是否存在未结束计划、当前计划状态、平台、招募和资格发放计划。
2. 预约量：转 `taptap-dashboard-stats` 手册的数据查询获取当前预约量，不凭历史对话估算。
3. 版本状态：按 `app list-app-versions` 获取（app-edit 手册的版本列表查询）；不要凭游戏类型推断。
4. 创建 CBT 时再调用 `get-test-plan-policy`，读取当前准入、人数/时长上限和季度次数。任一前置读取失败时说明缺少判断依据，不按经验推荐或写入。

版本状态只用于创建前判断，不表示测试计划已经绑定某个包体。尤其不能因为资料页存在 H5 主包，就宣称新建 CBT/OBT 会使用该 H5 版本。

**步骤 2：路由判断**

| 游戏状态 | agent 行为 |
| --- | --- |
| 已有未结束测试计划 | 告知当前计划状态；管理现有计划转 update/recruitment/delivery-plan/lifecycle。若用户要新建，说明必须先确认并结束现有计划，再重新读取后创建 |
| `get-test-plan-environment` 返回 `type=primary` | 当前是正式服 scope；说明先行服是独立应用、创建后仍需提审，用户确认后调用 `app get-or-create-ahead-server` |
| 无计划、游戏状态正常 | 继续步骤 3 |

**步骤 3：推荐策略 + 让用户选**

根据游戏数据匹配下方策略表，给出 1-2 个最相关的方案，附理由，让用户选择。不要一次列出全部 6 行——只挑匹配当前游戏状态的。

| 场景 | 推荐方案 | 理由 |
| --- | --- | --- |
| 新资料页、预约量少 | 预约 + 小规模 CBT + 招募/先到先得 | 预约积攒玩家，CBT 控量验证体验，评分不计入正式分 |
| 有一定预约量 | CBT + 招募 + 先到先得 | 正常推进少量→大量，CBT 评分不计入正式分 |
| 预约量大、需筛选 | CBT + 问卷招募 + 多批次先到先得 | 筛选高质量测试玩家 |
| 需要精确控制人数 | CBT + 指定用户 | 精准分发 |
| 需要用户传播 | CBT + 玩家分享资格 | 裂变拉人 |
| 已有 Steam 页面 | CBT + 开预约 + 绑 Steam ID | 预约引导 Steam 心愿单 |

输出示例：

> 你的游戏目前预约量 XX，建议：
>
> 1. CBT + 招募 + 先到先得（正常推进，CBT 评分不计入正式分）
> 2. 或直接 OBT（无门槛积攒评分）
>
> 你想用哪种？还是有其他想法？

末尾带兜底出口：
> "如果需要做版署联网测试备案，告诉我就行。"

**步骤 4：用户选完后执行创建**

根据用户选择，确认关键参数后调 create-test-plan + create-delivery-plan 组合完成创建。

- OBT：在 `create-test-plan.body.platforms` 明确选择 `android`、`windows` 或两者。
- CBT：`create-test-plan.body` 不传平台；创建成功后的资格发放计划按当前 `create-delivery-plan` schema 执行。公开 schema 将平台声明为 `android` / `ios` / `windows` 平台名，不要自行映射数字值，也不要把缺少平台字段解释为默认 Android。
- 两条流程都不能传 H5 包体或 H5 版本 ID。

### 先行服 CLI 接力

1. 正式服 scope 完成上述三项读取，并确认没有未结束计划。
2. 告知用户：先行服是独立应用，创建后默认为草稿，需要提交审核后生效。
3. 用户明确说“采用 / 使用 / 创建 / 进入先行服”即视为确认；首个真实调用直接执行 `app get-or-create-ahead-server --idempotency-key <ahead-server-key> --yes`，不要先故意触发确认失败。
4. 按当前 catalog 校验 `data.result`，读取稳定、非空的 `ahead_app_id`；`open_target` 只作为页面路径展示，`continuation` 必须为 `test-plan`。
5. 使用本次 `ahead_app_id` 作为新的 `app_id`，在先行服 scope 重新依次读取计划列表（`list-test-plans`）、测试服环境（`get-test-plan-environment`）和版本；创建 CBT 时再读取本 scope 的 policy。正式服旧结果不能代替这些读取。
6. 请求中断或结果不明确时，先重新调用正式服 `get-test-plan-environment` 与 `list-test-plans` 确认当前 scope 和计划状态，再使用稳定幂等键查询或复用创建结果；禁止猜测 App ID 或无条件重试写操作。

### 先行服返回合同

截至当前动态 catalog：

- operation：`app.get-or-create-ahead-server`
- `data.result` 已声明字段：`ahead_app_id`、`open_target`、`continuation`、`status`
- `ahead_app_id` 是先行服 App 全局稳定 ID，可直接作为后续测试计划操作的 `app_id`
- “新建”和“已存在”结果必须返回同一先行服 App ID；缺失、空值或格式不合法时停止接力

### 辅助类型推断（用户额外提到时覆盖推荐）

- 提到人数（"500人""一千名额"）→ CBT
- "公测/开放测试/不限人数" → OBT
- "封测/限量" → CBT
- 能从上下文推断类型时，不要再反问"是 CBT 还是 OBT"。

### 改口出口（任何步骤中用户改口时）

| 用户改口 | 路由 |
| --- | --- |
| "版署" / "联网测试备案" | 告知"这个由「联网测试申请」处理"，结束 |
| "我只是想上个游戏" / "直接开下载" | 引导走发布流程（补包体和资料后提审） |
| "我有 Steam 页面" | 建议走测试计划 + 开预约 + 绑 Steam ID（预约引导心愿单） |
