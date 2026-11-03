# official-message-push runbook:额度、预览、查重与发送

本文是 Agent 的执行参考，不是默认用户回复模板。业务回复按 [official-message-push 手册](taptap-suite/references/taptap-official-message-push/MANUAL.md) 与 shared execution 的输出规则组织；用户明确要求技术细节时才展示调用细节。

示例 ID、链接、时间和数量只说明结构，执行时替换为当前目标与用户已授权的值。写操作先 `dry_run: true` 预览，用户确认后用相同参数加 `yes: true`，同一意图复用 `idempotency_key`。

## 信息确认

- 内容已明确、范围和时间缺失：先说明已定位的内容，再用交互提问工具收集“发送给哪些用户？”（全部关注用户／Android 关注用户／iOS 关注用户）和“什么时候发送？”（立即发送／定时发送）。不把第一项预选视为授权。
- 用户已给具体发送时间，直接按定时处理，不再问立即还是定时；只选定时但没有日期/时刻时，用自由输入补问。
- 内容有多个候选时，先按已知条件验证，只把已确认可继续配置的候选交给用户选择；说明仍存在的质量告警。时间未知且候选是否可用依赖时间时，先收集时间再验证。
- 调整已有任务只问变更缺项；查额度、查效果不发发送问卷。

## 执行顺序与完成条件

1. **定位目标**：确认游戏与源内容；已有 task_id 先读原任务，无 ID 时按标题、链接、范围和时间定位。缺内容不擅自发帖；文案只能修改来源后重新预览。
2. **补齐方案**：只问尚缺的接收范围、立即/定时与具体时间；沿用已知信息和授权。
3. **检查额度和任务**：读额度与关注规模；完整分页查重及相邻任务。唯一待发任务与方案一致则回读复用，不创建。
4. **按实际时间预览**：定时携带用户选定的 `push_time`；检查时间有效性、源内容有效期和内容质量，取得最新指纹。质量建议与发送阻塞分别解释。
5. **展示并执行**：用中文汇总实际标题/摘要/封面、范围、带时区时间、额度口径与尚存问题；`dry_run` 后按已有授权执行。只要预览则停在此处。
6. **回读结果**：按 task_id 核对真实状态、范围、计划时间与当前额度，并完整复查同源待发任务；分别报告已排期、发送中、已发送和效果数据是否可用。

任何阻塞先解决当前问题，不继续依赖它的写入。写入结果未知保留目标与请求，不自动重发；查询覆盖不全不得以“没找到”作重建依据。

### 调整已有任务：先验证新方案，再取消重建

回读原任务并确认 `can_cancel`；不可取消则停止。保留未变的内容与范围，只收集要改的部分。按上述检查与预览验证新方案；原任务占用额度时不能据余额为 0 断言替换必然失败。授权覆盖取消与重建且新方案没有已知阻塞后，取消原任务并回读已取消；随后刷新额度、查重、预览，再创建新任务，逐步回读，不并发执行。取消结果未知不得创建。

## 1. 读额度与关注规模

```text
call_tool(name:"official-message-push get-official-message-push-info", args:{
  developer_id:"<developerId>", app_id:"<appId>"})
```

```json
{"weekly_push_limit": 3, "remaining_push_count": 2, "fans_count": 1840,
 "scopes": ["all","android","ios"], "data_time": 1760000000}
```

- 每次创建前重新读取，不复用缓存；额度受信用策略影响，不写死为 1 或把示例的 3 当固定值。
- `remaining_push_count=0` 表示本周普通推送不可继续创建；定时跨周不能据此推断下一周余额，最终以服务端按计划时间所在周校验为准。
- `fans_count=0` 表示本次没有接收人；用户明确要测试才在创建时传 `confirmed_zero_fans=true`。`fans_count` 不代表所选平台实际接收人数，不编造分平台人数。

## 2. 预览推送内容

```text
call_tool(name:"official-message-push preview-official-message-push-object", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{url:"https://www.taptap.cn/moment/123"}})
```

```json
{"title":"双十一活动开启","summary":"参与活动领取奖励","image_url":"https://.../cover.png",
 "url":"https://www.taptap.cn/moment/123","preview_fingerprint":"9f2c…","quality_issues":[]}
```

- `quality_issues`：`title_too_short`（<8 字）、`title_too_long`（>40 字）、`missing_cover`、`missing_summary`。有问题只给建议；改文案要改原内容后重新预览，不能编造推送文案。
- 支持的链接：帖子、动态、签到活动、图集活动、新版本活动、直播间、抽奖活动；不支持时返回 `failed_precondition`，让用户换站内链接。游戏商店页不属于推送内容。
- 预览后链接或原内容变化，`preview_fingerprint` 会变；创建时必须用最新值。
- 定时预览必须传 `push_time`，回读 `send_time_valid`、`send_time_issue`、`checked_push_time`；false 时不创建。省略时间只校验立即发送条件，不代表用户授权立即发送。

## 3. 查重与相邻任务

```text
# 分页需要实际读取，不能与 dry_run 组合
call_tool(name:"official-message-push list-official-message-push-tasks", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{status:"created", page:1, page_size:20},
  page_all:true, page_limit:1000})
```

```json
{"list":[{"task_id":456,"status":"created","status_label":"待发送","scope":"all",
  "push_time":"<业务时区展示时间>","title":"双十一活动开启","url":"https://www.taptap.cn/moment/123",
  "push_user_count":0,"page_view":0,"page_view_push":0,"page_view_rate":"0.00%",
  "can_cancel":true,"stat_time":0}],"page":1,"page_size":20,"total":1}
```

- 同源按 `canonical_url` 比较，不只比链接文本、末尾数字或标题；不同路径的数字不一定是同一类 ID，不能把 moment ID 拼成 topic ID。
- 同一规范链接已有 `status=created` 任务：核对 scope、发送时间和可读内容；唯一任务符合目标则回读复用，不创建、不取消。信息不足不能判为相同；多候选或目标不一致时展示差异让用户选择。
- 相近时间（30 分钟内）、范围重叠（任一为 `all` 或两者相同）的待发送任务：提醒可能连续触达同一批用户，只有用户明确接受后才传 `confirmed_nearby_pending_task=true`。
- 上游单页上限 20 条；查重、定位取消对象及结果未知后的核对必须遍历全部页。超时、错误、分页截断或覆盖不完整时停止创建/取消，不把未找到当成不存在。
- 找取消对象必须匹配用户确认的 `task_id`；多候选列出标题、时间和范围让用户选择。

## 4. 创建推送

```text
# 定时（push_time 用带偏移的 RFC3339）
call_tool(name:"official-message-push create-official-message-push-task", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{url:"https://www.taptap.cn/moment/123", scope:"android",
        send_mode:"scheduled", push_time:"2026-11-03T20:00:00+08:00",
        preview_fingerprint:"<指纹>"},
  idempotency_key:"<stable-key>", dry_run:true})

# 立即
call_tool(name:"official-message-push create-official-message-push-task", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{url:"https://www.taptap.cn/moment/123", scope:"all",
        send_mode:"now", preview_fingerprint:"<指纹>"},
  idempotency_key:"<stable-key>", dry_run:true})
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `url` | 是 | 站内链接，必须能预览 |
| `scope` | 是 | `all` / `android` / `ios`，不默认全量 |
| `send_mode` | 是 | `now` / `scheduled` |
| `push_time` | scheduled 必填 | 带时区偏移的 RFC3339 |
| `preview_fingerprint` | 必填 | 防止“预览后内容变了还照旧发” |
| `confirmed_zero_fans` | 0 关注时必填 | 用户明确接受“没有接收人” |
| `confirmed_nearby_pending_task` | 相近任务冲突时必填 | 用户明确接受连续触达 |

返回 `task_id`、`status`、`scope`、`push_time`、`can_cancel`、`remaining_push_count`、`applied_at`。创建成功不等于触达完成；余额不变不意味着创建失败。

失败分支：

| 返回 | 含义 | 下一步 |
| --- | --- | --- |
| `failed_precondition` 本周推送次数已用完 | 额度为 0 | 下周再发或换运营方式 |
| `failed_precondition` 没有关注用户 | 0 关注未确认 | 说明没有接收人；用户坚持测试才传 `confirmed_zero_fans` |
| `failed_precondition` 同一链接已有待发送任务 | 可能上次创建已成功 | 重新查询并匹配目标；一致则回读复用，不一致才展示差异并确认处理 |
| `failed_precondition` 相近时间已有范围重叠任务 | 连续触达 | 错开时间，或用户确认后传 `confirmed_nearby_pending_task` |
| `failed_precondition` 预览后内容已变化 | 指纹不匹配 | 重新 `preview-official-message-push-object` 再创建 |
| `invalid_argument`（定时规则） | 时间太近/不是今天明天/在 01:00–07:00 | 按返回的 `error.message` / `error.hint` 改时间 |
| `result_unknown` | 提交后没回读到任务 | 用 `list-official-message-push-tasks` 核实，不直接重试 |

## 5. 取消待发送任务

```text
call_tool(name:"official-message-push cancel-official-message-push-task", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{task_id:"<taskId>"},
  idempotency_key:"<stable-key>", dry_run:true})
```

取消后回读任务及额度；跨周任务不一定改变当前周余额，不能把余额未变当作取消失败。`can_cancel=false`（已发送/发送中/已取消/已过发送时间）时返回 `failed_precondition`，不要重试；已触达的消息无法撤回。已取消任务不计入计划发送周的额度。

## 6. 发送后效果

用 `list-official-message-push-tasks` 取 `status=sent` 的任务：

- 事实数据：`push_user_count`（推送人数）、`page_view`（浏览）、`page_view_push`（推送带来的浏览）、`page_view_rate`（转化率）。
- 数据缺口：`stat_time=0` 或样本很少 → 提醒可能回流延迟，稍后复查。
- 不推导下载、付费、留存、ROI；不编造分平台关注人数。

## 原因码与中文标签

错误处理读取 `errors[]` 的 `reason_code`，时间预览读取 `send_time_reason_code` / `send_time_issue`；不通过匹配中文 message 决定下一步。

| 原因码 | 中文原因与下一步 |
| --- | --- |
| `non_site_link` / `unsupported_link` / `unsupported_region` | 非站内链接／不支持的内容类型／地区不支持；核对支持清单，换合法来源 |
| `non_official_content` / `content_app_mismatch` | 非官方内容／不属于当前游戏；修正来源，不换游戏 ID 绕过 |
| `activity_not_started` / `activity_ended` | 活动未开始／已结束；核对来源状态及有效期 |
| `send_before_activity_start` / `send_after_activity_end` / `invalid_schedule` | 发送早于开始／晚于结束／定时不合法；计算可行窗口后让用户选择 |
| `weekly_quota_exhausted` / `admin_push_restricted` | 周额度用完／管理员推送受限；解释原因，不凭管理员身份绕过 |
| `zero_followers` / `nearby_pending_task` | 无关注用户／相邻任务连续触达；仅缺对应影响授权时询问 |
| `duplicate_pending_task` / `preview_changed` | 已有同源待发任务／预览内容变化；回读复用或重新预览 |
| `content_unavailable` | 未分类的业务拒绝；展示具体诊断，停止依赖该结果的写入 |

中文展示：`scope` → 全部/Android/iOS 关注用户；`status` → 待发送/发送中/已发送/已取消/状态待核实；`can_cancel` 不能解读为已发送可撤回；`remaining_push_count` 是本周剩余普通推送次数；`quota_exemption_reason` 说明任务是否计额度。任务状态优先用服务端 `status_label`，未知值保留原值并说明尚未识别。

运营参考：[如何让官方信息更好地触达到玩家](https://developer.taptap.cn/docs/store/operation/advanced-guide/op-skills/information-dissemination/)（2026-10-30 核对）。
