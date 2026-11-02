# TapTap CLI 插件:官方消息推送(official-message-push)

official-message-push 管理面向游戏关注用户的站内推送，通过消息中心红点提醒传达重要更新、活动或公告。标题、摘要和封面来自链接预览，不能在创建推送时改文案；已发送消息无法撤回。开始前先读 [shared execution](taptap-suite/references/shared-execution.md)(身份、JSON 输出外壳、错误处理)。命令行示例按 [taptap-suite](taptap-suite/MANUAL.md) 的映射表转成 call_tool 调用。

**CRITICAL — 接收范围必须由用户明确选择：`all` / `android` / `ios`，不能默认全部。** “推送一下”不构成范围授权，也不自动解释成立即发送；范围和立即/定时都要确认或沿用已有明确选择。

**CRITICAL — 创建必须带本次预览的 `preview_fingerprint`。** 先 `preview-official-message-push-object` 取最新指纹；内容、链接或时间变化后重新预览，不能用旧指纹绕过。预览成功、`quality_issues` 为空都不等于发送条件全部通过。

**CRITICAL — 先查额度和查重，再创建。** 每次创建前读 `get-official-message-push-info` 的 `weekly_push_limit` / `remaining_push_count` / `fans_count`；完整分页查同源待发任务和相邻任务。唯一待发任务符合目标时回读复用，不重复创建；结果未知或分页不全时停止，不以“没找到”作为不存在。

**CRITICAL — 已发送不可撤回；只有 `can_cancel=true` 的待发任务能取消。** 调整已有任务没有直接编辑能力：先验证新方案可创建，确认授权覆盖“取消 + 重建”，再取消原任务并回读，随后刷新额度、查重、预览并创建；新方案不可行时保留原任务。

**CRITICAL — 创建成功 ≠ 已发送。** `created` / `sending` / `sent` 按 task_id 回读区分；`push_user_count`、`page_view`、`page_view_push`、`page_view_rate` 是触达效果，不能推导下载、付费或 ROI。

## 快速决策

| 用户意图 | Reference | 起手调用 |
| --- | --- | --- |
| 查额度和关注规模 | [runbook](taptap-suite/references/taptap-official-message-push/references/push-runbook.md) 第 1 节 | `call_tool(name:"official-message-push get-official-message-push-info", args:{developer_id:"<developerId>", app_id:"<appId>"})` |
| 看链接预览 | [runbook](taptap-suite/references/taptap-official-message-push/references/push-runbook.md) 第 2 节 | `call_tool(name:"official-message-push preview-official-message-push-object", args:{developer_id:"<developerId>", app_id:"<appId>", data:{url:"<站内链接>"}})` |
| 查任务、去重或核实未知结果 | [runbook](taptap-suite/references/taptap-official-message-push/references/push-runbook.md) 第 3 节 | `call_tool(name:"official-message-push list-official-message-push-tasks", args:{developer_id:"<developerId>", app_id:"<appId>", data:{page:1, page_size:20}, page_all:true, page_limit:1000})` |
| 立即/定时发送 | [runbook](taptap-suite/references/taptap-official-message-push/references/push-runbook.md) 第 4 节 | `call_tool(name:"official-message-push create-official-message-push-task", args:{developer_id:"<developerId>", app_id:"<appId>", data:{url:"<站内链接>", scope:"all", send_mode:"now", preview_fingerprint:"<指纹>"}, idempotency_key:"<stable-key>", dry_run:true})` |
| 取消待发送任务 | [runbook](taptap-suite/references/taptap-official-message-push/references/push-runbook.md) 第 5 节 | `call_tool(name:"official-message-push cancel-official-message-push-task", args:{developer_id:"<developerId>", app_id:"<appId>", data:{task_id:"<taskId>"}, idempotency_key:"<stable-key>", dry_run:true})` |
| 修改范围或时间 | [runbook](taptap-suite/references/taptap-official-message-push/references/push-runbook.md)「调整已有任务」 | 无直接修改；核实可取消后取消并重建，需授权覆盖两个动作 |
| 看发送效果 | [runbook](taptap-suite/references/taptap-official-message-push/references/push-runbook.md) 第 6 节 | `call_tool(name:"official-message-push list-official-message-push-tasks", args:{developer_id:"<developerId>", app_id:"<appId>", data:{page:1, page_size:20}})` |

## 常用调用

```text
# 先看该域操作与参数
list_tools(category:"official-message-push")

# 额度与关注规模（每次创建前重新读，不复用缓存）
call_tool(name:"official-message-push get-official-message-push-info", args:{
  developer_id:"<developerId>", app_id:"<appId>"})

# 预览：内容变化后指纹会变，创建时必须用最新值
call_tool(name:"official-message-push preview-official-message-push-object", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{url:"https://www.taptap.cn/moment/123"}})

# 定时发送：预览必须带用户选定的 push_time，否则只校验立即发送条件
call_tool(name:"official-message-push preview-official-message-push-object", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{url:"https://www.taptap.cn/moment/123", push_time:"2026-11-03T20:00:00+08:00"}})

# 分页查任务/查重（需要实际读取，不能与 dry_run 组合）
call_tool(name:"official-message-push list-official-message-push-tasks", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{status:"created", page:1, page_size:20},
  page_all:true, page_limit:1000})

# 定时创建（push_time 用带偏移的 RFC3339；先 dry_run，确认后 yes:true）
call_tool(name:"official-message-push create-official-message-push-task", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{url:"https://www.taptap.cn/moment/123", scope:"android",
        send_mode:"scheduled", push_time:"2026-11-03T20:00:00+08:00",
        preview_fingerprint:"<指纹>"},
  idempotency_key:"<stable-key>", dry_run:true})

# 取消（先确认 can_cancel=true；取消后回读任务与额度）
call_tool(name:"official-message-push cancel-official-message-push-task", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{task_id:"<taskId>"},
  idempotency_key:"<stable-key>", dry_run:true})
```

## 执行规则

- 创建前按“定位内容 → 补齐范围和时间 → 查额度/查重 → 按实际时间预览 → 展示方案 → 执行 → 回读”的顺序；任一步阻塞就停在当前阶段，保留已确认方案。
- 定时时间：先读取当前时间，按 Asia/Shanghai 解析“今天/明天”，发送时间至少晚于当前 3 分钟、处于今天或明天、避开 01:00–07:00；最终以服务端 `send_time_valid` / `send_time_issue` 为准。超出窗口时保留待办，不改成立即发送，也不承诺自动稍后执行。
- 同源查重按 `canonical_url`，不要只比较链接文本、末尾数字或标题。发现多条待发任务时列出任务与差异，保留现场等用户选择，不自动取消或再建。相邻 30 分钟内且范围重叠的任务要提醒连续触达；只有用户明确接受后才传对应确认字段。
- 零关注：`fans_count=0` 时说明没有实际接收人；用户明确要测试才传 `confirmed_zero_fans=true`。总关注规模不等于所选平台实际人数。
- 内容质量告警（标题过短/过长、缺封面、缺摘要）只给建议；改文案要改原内容后重新预览，不能编造推送文案。
- 结果未知时用 `list-official-message-push-tasks` 按 task_id 或规范链接核实，不直接重试、不换 key 重发、不把定时改成立即发送。
- 错误优先读取 `reason_code` / `send_time_reason_code`，按原因码给下一步；不通过匹配中文 message 猜动作，原因未知时明确说尚未查明。
- 用户明确要求串联签到、公告和推送时，先读 [跨域流程](taptap-suite/references/interactive-operations-flow.md)；单域操作不自动加载或执行其他域。

## 面向用户的回复

- 默认展示推送内容、接收范围（全部/Android/iOS 关注用户）、带时区的发送时间、剩余额度和真实发送状态；预览指纹、确认字段、幂等键由 Agent 内部处理。
- 任务状态优先用服务端 `status_label`，未知值明确说尚无法识别；不把总关注规模当作分平台实际接收人数。
- 没有关注用户或预览失败时，先说“没有实际接收人”或具体内容问题，以及当前尚未创建/发送的事实，不随后展开完整发送手册。
- “待发送/发送中/已发送”按回读区分；统计未取得时说明缺口，不以请求成功代替触达成功。

## References

| Reference | 什么时候读 | 读取方式 |
| --- | --- | --- |
| push runbook | 额度、预览、查重、创建、取消、效果分析、原因码与中文标签 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-official-message-push/references/push-runbook.md"})` |
| 跨域运营流程 | 用户明确要求串联签到、公告和推送 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/interactive-operations-flow.md"})` |

## 不在本手册范围

- 创建或修改推送源内容（帖子、活动、公告）：先在来源模块完成，再回到本域推送。
- 内容未就绪时按其类型转 `taptap-game-sign` 或 `taptap-whats-new`；论坛发帖、短信/邮件及消息中心设置不在本插件范围。
