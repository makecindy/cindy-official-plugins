# Test Plan Operations

### 状态层级

- **测试计划状态**：未开始、进行中、已结束，决定能否修改或结束。
- **招募状态**：招募开关、报名时间、平台和问卷；这些字段使用 `update-recruitment`。
- **资格发放计划状态**：由 `list-delivery-plans` 返回的 `status` 判断（每项带 `limit` 与 `granted_count`），决定能否修改配额、停止或删除。
- **用户资格状态**：已领取、已取消、可恢复。
- **激活码状态**：`list-activation-codes` 返回每个激活码的 `total_count`、`distributed_count` 和 `expires_at`。

回答和写操作前必须指出当前对象层级，不把停止资格发放说成结束测试。

### 用户说"帮我开一个先到先得的测试" / "创建 500 人封闭测试"

1. 调 `list-test-plans`（`test_type` 按目标类型）确认当前无进行中计划。
2. 若有未结束计划，管理请求转现有计划流程；只有用户明确要新建时，才说明需先确认并结束当前计划。
3. 若无进行中计划且为 CBT，调用 `get-test-plan-policy` 校验当前权益。
4. 向用户确认关键参数（名称、时间、人数、是否付费/删档）。
5. 调带稳定 `--idempotency-key` 的 `create-test-plan --dry-run` 预览；用户明确确认后复用同一个 key 并追加 `--yes` 创建计划。
6. 创建成功后若为 CBT，再读一次 policy，并继续用 `create-delivery-plan` 建立先到先得资格发放计划。

### 用户修改参数（创建前或创建后）

**创建前**：用户说"改成 2000 人""时间改到下周五""不要付费了"等，直接用**新参数**和稳定 `--idempotency-key` 调用 `create-test-plan --dry-run`，不要说"无法修改"或要求重新开始。用户最终确认前的所有参数都是可变的——把最新一轮对话中的参数作为最终值；业务意图未变化时真实执行复用预览 key。

**创建后**：测试计划创建后仍可编辑。名称、人数上限、开始/结束时间、是否付费、是否删档用 `update-test-plan`；招募开关、招募时间、招募平台和问卷用 `update-recruitment`。测试类型（CBT/OBT）不可修改。

已结束计划只在用户明确要求重新开启时使用 `update-test-plan`，并在 `--data` 中传 `{"reopen":true,"start_time":<Unix秒>,"end_time":<Unix秒>}`。CBT 重开前实时读取 `get-test-plan-policy` 校验准入、人数、单次时长和季度次数；普通修改仍要求计划未结束。不要因历史计划超过当前上限而阻止只改名称，只有改对应受限字段或重开时按当前 policy 校验。

**展示变更摘要**：调用 `create-test-plan` 或 `update-test-plan` 前，必须在文字中列出即将生效的关键参数，例如：

- 创建时："将创建 CBT 封闭测试：人数 500、明天 10:00 ~ 6/15 22:00、不付费、不删档"
- 修改时："将修改：人数上限 500 → 20000"

让用户在明确确认执行之前看到完整预期。

**执行完成后的引导**：CLI 顶层返回 `ok=true` 后，按具体 operation 的已声明结果字段判断完成状态。例如 `createTestPlan` 读取 `data.result.status`（固定为 `created`）和 `test_plan_id`，`updateTestPlan` 只读 `test_plan_id`。当前 test-plan output schema 没有通用的 `data.result.ok`、`stale`、`updated_fields` 或 `next_steps`；不要凭空读取这些字段，也不要自行发明“确认修改”“确认提交”等重复确认动作。

首次创建或以 `reopen=true` 重开成功后必须再次调用 `list-test-plans`。只有返回列表中存在 `status` 为 `new` 或 `published` 的计划时，才按 shared execution 的“运营阶段手册交接”从内置 manifest 读取测试期运营手册的官方描述与 URL；`ended`、空列表、单独的 `created` 返回都不输出。资格发放计划、配额或招募等普通后续操作不要重复展示该入口。

### 用户说"把配额加到 5000"

1. 调 `list-test-plans` 找到进行中的计划，拿到 `test_plan_id`。
2. 调 `list-delivery-plans` 确认目标发放计划当前 `limit` 和 `granted_count`。
3. 若 5000 > `granted_count`，调 `update-delivery-plan` 修改。
4. 若 5000 ≤ `granted_count`，告知用户新配额需大于已使用量。

### 用户说"暂停一下"

1. 确认用户意图是“停止发放”还是“结束测试”。
2. 若是停止发放 → 调 `list-delivery-plans` 确认目标发放计划，再调 `stop-delivery-plan` 停止。
3. 若是结束测试 → 走 `end-test-plan` 流程。

### 追加激活码

1. 调 `list-activation-codes` 查看当前激活码、`total_count` 与 `distributed_count`。
2. 上传激活码文件：`upload-activation-code`（`multipart/form-data`，输入 `file`）得到 `oss_key`。
3. 用该 `oss_key` 调 `import-activation-code` 导入到目标计划（必填 `activation_code_oss_key`、`platforms`、`test_plan_id`）。
4. 需要改过期时间时调 `update-activation-code-expire-time`。
