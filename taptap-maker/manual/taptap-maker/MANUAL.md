# TapTap Maker 工作流

本手册只适用于明确的 TapTap Maker 游戏项目操作。仅提到 TapTap、非 Maker 的平台/SDK/上架任务或本插件源码维护时，不调用 Maker Runtime。

下面的 `maker_*` 都通过 `ghost_call({ ghost_id: "taptap-maker", tool: "<maker_* 工具名>", args: { ... } })` 调用；上下文没有工具清单时先调用 `ghost_info({ ghost_id: "taptap-maker" })`。Maker 项目操作不要通过 Shell、`npx`、外部 CLI、直接 MCP、通用浏览器或运行时内部工具绕行；插件会复用随包 Runtime、当前账号和宿主可信工作区。

## 基本流程

1. Maker 项目中的广告、激励视频、广告位或 `ShowRewardVideoAd` 请求先调用 `maker_ads_guide`，再按官方指南检查项目状态、调用 `get_ad_config`，并读取项目内 `engine-docs/recipes/sdk.md` 后修改广告代码。
2. 其它项目任务先调用 `maker_status`；广告请求在读取指南后调用。需要更完整的环境诊断时调用 `maker_doctor`。
3. 未连接账号时调用 `maker_login`，等待浏览器授权完成后继续原任务，不要求用户重新发起。
4. 初始化已有项目时先用 `maker_apps` 获取 `app_id`，再调用 `maker_init`。只有用户明确要求新建项目时才传 `create=true` 和 `name`。
5. 构建、运行或预览用 `maker_build`。成功结果含 `user_facing_markdown` 时原样引用，不放进代码块；右侧预览由插件打开。
6. 使用素材、广告、调试或其它 Maker 能力前，先调用 `ghost_call({ ghost_id: "taptap-maker", tool: "maker_list_tools", args: {} })` 获取随包 Runtime 固定发布的工具目录与参数 schema 快照；它不表示当前工作区实时可用，实际可用性以调用结果为准。再通过 `ghost_call({ ghost_id: "taptap-maker", tool: "maker_call_tool", args: { name: "<刚返回的工具名>", args: { ... } } })` 调用，不凭记忆猜工具名。

## 约束与恢复

- 所有项目操作只针对当前 Cindy 会话的本地工作区。目标项目在别处时，请用户先在 Cindy 中打开该目录，不要绕过插件。
- 当前会话处于计划或只读模式时，只做广告指南、状态、诊断和工具列表等只读检查；不要尝试初始化、构建或调用动态工具。
- 如果缺少 `.project/project.json`，且用户已经要求构建、运行或预览，调用 `maker_build` 后重试；否则先说明构建会提交并推送项目，获得确认后再构建。
- `missing_taptap_identity` 仅在 Runtime 返回可安全恢复结果（`execution_state` 未提供或明确为 `not_executed`）时由插件自动初始化并重试一次；`executed` 或 `unknown` 时不自动重试。仍失败时把插件返回的可操作提示交给用户。
- 只有完整错误 `MCP error -32600: INSUFFICIENT_BALANCE` 表示 Maker 积分不足。此时提示用户，并在获得确认后再建议使用 Art 插件替代；其它错误不要按积分不足处理。
- 不回显 PAT、令牌、本地凭证路径或插件已脱敏掉的内部信息。
- 生成或修改 UrhoX Lua 代码时，避开沙箱中不可用的标准库（如 `os.clock()`、`io.*`）：这类调用会让预览静默卡死且无错误提示。计时逻辑默认用 Update 事件的 `eventData["TimeStep"]:GetFloat()` 累积；预览「卡住」而无报错时，优先用 Maker 运行日志排查是否命中了沙箱不可用函数。
