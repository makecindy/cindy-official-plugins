# TapTap CLI 插件:测试计划(test-plan)

本手册管理 TapTap 游戏测试计划:创建/修改/结束 CBT/OBT,配置招募,管理资格发放批次、用户资格和激活码汇总。完整名单导出、文件上传和讨论群设置当前不是 CLI 可执行能力。命令行示例按 taptap-suite 手册的映射表转成 call_tool 调用。

**CRITICAL — 创建或推荐测试计划前必须读取 overview、预约量和版本状态;CBT 的创建、修改或重开还必须实时读取 `test-plan get-test-plan-policy`,不要凭经验或旧结果给方案。**

**CRITICAL — 批量发放、删除、结束测试、修改配额等高影响动作必须先 dry-run 或明确确认。**

**CRITICAL — 测试计划首次创建、重开成功后必须重新读取 overview;只有 `test_plan.status` 精确为 `not_started` 或 `running` 时,才按共享「运营阶段手册交接」(`ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/operation-handbooks.md"})`)输出"测试期运营手册"。`ended`、`null`、单独的 `created` / `updated` 结果都不能证明当前处于测试期。**

## 快速决策

| 用户意图 | 首选调用 / 流程 |
| --- | --- |
| 用户说"测试包 / 测试资格 / 给玩家测试" | 先区分:开 CBT/OBT 测试计划走本手册;包体自测二维码转 packages 手册 |
| 查看当前测试状态 | `call_tool(name:"test-plan get-test-plan-overview", args:{dev_id, app_id})` |
| 创建 CBT/OBT、推荐测试方案 | 先完成三项前置读取;CBT 再查 policy(见 creation reference) |
| 已上线正式服继续测试 | overview 判定 `can_use_ahead_server=true` → 确认后 `test-plan get-or-create-ahead-server` → 使用返回的 `ahead_app_id` 重新读取先行服 scope |
| 修改或重新开启计划 | 先 overview;已结束计划仅在用户明确要求时用 `update-test-plan`(reopen:true) |
| 修改招募开关、招募时间、平台或问卷 | 先 overview,再用 `test-plan update-recruitment` |
| 管理资格批次、停止发放、改配额 | 先查批次状态,再 dry-run / 确认后执行 |
| 按指定用户 ID 发放资格 | `test-plan create-delivery-batch`,使用 `delivery_type:"specified-user"` 和最多 100 个 `user_ids` |
| 添加/取消/恢复单个用户资格 | 确认用户标识、计划、批次和当前状态 |
| 管理激活码 | 先查激活码批次状态;可执行能力按 schema,完整下载/文件上传说明 CLI 暂不支持 |
| 结束测试、删除/批量变更资格 | 展示目标、范围、数量和影响,确认后执行 |
| H5 试玩、自测二维码 | 不创建 CBT/OBT;转 packages 手册查询 H5 版本并生成自测二维码 |
| 要求 H5 进入 CBT/OBT | 说明当前测试计划契约不支持 H5 平台或 H5 版本绑定;不得用 Android 计划代替 |
| 联网测试申请、版号前联网测试 | 当前 CLI 不覆盖;说明边界 |

## 常用调用

```text
call_tool(name:"test-plan get-test-plan-overview", args:{dev_id, app_id})
call_tool(name:"test-plan get-test-plan-policy", args:{dev_id, app_id})
call_tool(name:"test-plan get-or-create-ahead-server", args:{dev_id, app_id, idempotency_key, dry_run:true})
call_tool(name:"test-plan create-test-plan", args:{dev_id, app_id, data:<见下>, idempotency_key, dry_run:true})
call_tool(name:"test-plan create-delivery-batch", args:{dev_id, app_id, data:<specified-users>, idempotency_key, dry_run:true})
call_tool(name:"test-plan update-delivery-batch-quota", args:{dev_id, app_id, data:<quota-change>, idempotency_key, dry_run:true})
```

`create-test-plan` 的 `data` 必须包含顶层 `body`,不能把 CBT/OBT 字段直接放在最外层:

```json
{
  "body": {
    "test_type": "closed",
    "name": "<plan name>",
    "participant_limit": 500,
    "start_time": 1760000000,
    "end_time": 1760604800,
    "is_paid": false,
    "is_wipe_data": false
  }
}
```

OBT 的 `body` 使用 `"test_type":"open"`,必须包含 `platforms`,且 `is_wipe_data` 只能为 `true` 或省略。时间均为 Unix 秒。

## 平台与包体边界

- `create-test-plan` 不是包体绑定操作。CBT/OBT 请求都不接收包体类型、包体 ID 或 H5 版本 ID,创建结果也不返回最终使用的包体。
- OBT 必须显式传 `platforms`,当前只允许 `"android"`、`"windows"` 或两者;不支持 `"h5"`。
- CBT 的 `body` 不接收 `platforms`。后续资格发放批次有独立的 `platforms` 输入,但当前公开 schema 没有声明数字值的平台语义;不要自行映射,也不要把 CBT 未声明平台解释为默认 Android。
- 当前契约不能证明 CBT/OBT 会隐式使用资料页已绑定的 H5 主包,也不能锁定某个 H5 版本。用户要求 H5 进入玩家测试计划时,说明需要服务端补充 H5 平台及版本绑定契约,不要创建 Android 测试作为替代。
- H5 当前明确可执行的测试能力属于包体管理自测:转 packages 手册,先读取 H5 overview 的真实候选,再用选定的 `h5_version` 目标生成自测二维码。
- "当前游戏没有 H5 版本""H5 上传解析失败"只能根据本次真实包体列表、上传状态或错误结果陈述;不能从测试计划 schema 推断。

## 高影响动作矩阵

| 动作 | 影响 | 协议 |
| --- | --- | --- |
| 创建测试计划 | 新增 CBT/OBT 计划,影响玩家报名/测试入口 | 先预览类型、时间、人数、平台、招募方式 |
| 修改测试计划 | 改时间、人数、平台、付费/删档等 | 先展示旧值/新值 |
| 结束测试 | 所有测试用户无法继续游玩 | 不可逆,必须确认 |
| 新建/删除资格批次 | 改变资格发放规则 | 展示批次类型、范围、数量 |
| 修改批次配额 | 改变可领取人数 | 展示旧配额/新配额 |
| 停止发放 | 暂停新增资格,已领取用户仍可玩 | 不等于结束测试,必须说明 |
| 取消/恢复用户资格 | 影响具体用户资格 | 展示用户标识和目标计划 |
| 追加激活码 | 增加可发放激活码批次 | 展示批次和数量 |

## 执行规则

- 缺 `developerId` / `appId` 时转 identity 手册;创建或推荐前先读 overview 的真实计划、平台、招募和资格批次。
- 推荐或创建前还要读取 `app list-app-versions`;是否需要先行服只看 overview 的 `environment.can_use_ahead_server`,不要从版本 flag 猜。本插件不提供预约量等经营数据查询:需要预约量作为判断依据时,请用户从开发者后台查看后提供,不要尝试调用数据接口,也不要凭历史对话估算。
- CBT 的当前准入、人数上限、单次时长上限和季度次数只能来自本 scope 的实时 `test-plan get-test-plan-policy`。创建、修改人数/时间或 `reopen=true` 前重读;失败、准入关闭或超限时停止写入,成功后再读一次展示最新权益。
- 明确状态层级:测试计划、招募、资格批次、用户资格、激活码。不要把"停止发放"说成"结束测试"。
- 已有进行中计划时可管理现有计划;若用户要新建,说明创建前置会拒绝,必须先确认并结束现有计划,再重新读取后创建。
- `environment.can_use_ahead_server=true` 时禁止在正式服直接创建计划。说明先行服是独立应用且创建后仍需提审;用户确认后执行带稳定 `idempotency_key` 的 `get-or-create-ahead-server`(yes:true)。只使用本次返回的 `ahead_app_id` 作为新的 `app_id`,并在该 scope 重新读取 overview 和版本;`open_target` 只作为页面路径展示,不能替代 scope。
- 已结束计划不能普通修改;用户明确要求重新开启时才传 `reopen:true`。CBT 必须同时提供新的 `start_time`、`end_time` 并通过实时 policy,OBT 按工具当前 schema 执行。
- 平台和包体按契约分层判断:OBT 平台来自 `create-test-plan.body.platforms`,CBT 资格平台来自 `create-delivery-batch.platforms`,H5 自测目标来自包体管理;三者不能互相推断或替代。
- 用户直接提供 TapTap 用户 ID 列表时,可创建指定用户批次:`delivery_type` 传 `"specified-user"`,`user_ids` 原样传入且一次最多 100 个;`limit` 仍是独立必填的批次配额,用户未给时先追问,不能根据 ID 数量静默推断。先展示计划、批次名、配额、平台、时间范围和用户数量并 dry-run,明确确认后复用同一 payload 与 idempotency key 加 `yes:true`,成功后重新读取批次状态。用户提供的是名单文件而非 ID 数组时仍说明 CLI 不支持文件上传,不要自行解析后静默发放。
- 高影响动作展示目标、范围、数量和影响,先 dry-run 或等待明确确认;状态变化后重新读取。
- 首次创建或重开测试计划成功后,重新读取 overview;`test_plan.status` 为 `not_started` 或 `running` 时按共享"运营阶段手册交接"读取并提供测试期运营手册,`ended` 或 `test_plan=null` 时不输出测试期手册。资格、批次和配额的普通后续操作不重复输出该链接。
- 完整激活码明细、报名/资格名单导出、延长有效期、讨论群、激活码文件和指定名单文件上传当前只能给页面入口或说明 CLI 暂不支持。
- 面向用户报告具体状态层级、当前值、影响和下一步,不默认倾倒 raw JSON。

## References

| Reference | 什么时候读 | 读取方式 |
| --- | --- | --- |
| test-plan creation | 创建 CBT/OBT、推荐测试方案、确定时间/人数/平台/招募配置 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-test-plan/references/test-plan-creation.md"})` |
| test-plan operations | 组合工具完成创建、招募、资格发放或配额调整 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-test-plan/references/test-plan-operations.md"})` |
| test-plan faq | 用户问规则概念且无需调工具时 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-test-plan/references/test-plan-faq.md"})` |

## 不在本手册范围

- 游戏资料提审/上线/发布、创建新游戏:转 app-edit 手册。
- 包体库状态、自测二维码、上传包状态:转 packages 手册。
- 联网测试申请等 server-only 能力不在当前 CLI 范围。
