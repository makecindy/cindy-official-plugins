# whats-new runbook:查重、创建、编辑与巡检

本文是 Agent 的执行参考，不是默认用户回复模板。业务回复按 [whats-new 手册](taptap-suite/references/taptap-whats-new/MANUAL.md) 与 shared execution 的输出规则组织；用户明确要求技术细节时才展示调用细节。

示例 ID、链接、时间和数量只说明结构，执行时替换为当前目标与用户已授权的值。写操作先 `dry_run: true` 预览，用户确认后用相同参数加 `yes: true`，同一意图复用 `idempotency_key`。

## 信息确认

- 新建且置顶未明确：用当前宿主可用的交互提问工具展示“不置顶／游戏详情页置顶／PC 库置顶／两处都置顶”。只缺置顶就只问置顶；时间也缺时同轮补一个自由输入的展示时间问题。
- 工具无法容纳四项时，先问“不置顶／需要置顶”，选择需要后再问具体位置；不默默省略位置选项，不把默认预选当作回答。
- 编辑先 `get-whats-new` 回读并保留现有置顶配置；用户只改排期且时间已明确，不重问位置。要求变更位置但目标不明时，先说明当前位置再补问。
- 源内容有多个候选时，先查询核对，再用可区分的中文标题提供选择；已知不可用的内容不列为可选候选。

## 执行顺序

1. **定位源内容**：确认目标游戏与站内可用链接。没有源内容先处理来源缺口；不把公告配置当作发帖，不擅自创建源内容。
2. **查重并分流**：已知 `content_id` 直接回读；否则按源链接查重。唯一已有条目走编辑/重新上线，系统同步条目只做允许的调整；完整查询无匹配才新建，多候选让用户选择，覆盖不完整则停止。
3. **补齐配置**：新建收集用途/标签、起止时间与置顶；编辑只问本次变更缺项或冲突，未涉及字段保留，不把缺省当清空。
4. **检查容量**：分类和动作明确后读 `get-whats-new-overview`，只检查本次要占用的在线容量与置顶位。已有在线条目改排期不新增占用；满额时展示实际占用，由用户选择替换对象。
5. **预览与执行**：用中文展示来源名称、分类、标签、排期、置顶与影响，明确创建即启用。只准备方案就停在预览；有执行授权且方案未变不重复确认。多步变更逐步回读，不并发写。
6. **结果核对**：回读条目状态、有效性、实际起止时间和置顶集合；改变在线占用或置顶后再读总览。配置在线与客户端已展示分别报告。

任一步失败或结果未知，停在当前步骤并保留目标和已完成项；先核实，不自动重建或重复上线。

## 查重

```text
# 按源链接查重（返回匹配条目的 content_id、type、label_type、status、top_types）
call_tool(name:"whats-new find-whats-new-by-url", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{url:"<站内链接>"}})

# 跨类型/状态分页查重：省略 type/status，分页需要实际读取，不能与 dry_run 组合
call_tool(name:"whats-new list-whats-new", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{page:1, page_size:20},
  page_all:true, page_limit:1000})
```

完整分页后把每条 `url` 与用户给的链接比对；覆盖不完整时停止创建。唯一已有条目先回读再按用户目标复用；多候选让用户选择，避免同一链接配两次。`label_type=check_in|gift|new_version|lottery` 是系统同步条目，不要重复创建。

## 容量与置顶

```text
call_tool(name:"whats-new get-whats-new-overview", args:{
  developer_id:"<developerId>", app_id:"<appId>"})
```

返回结构：

```json
{
  "capacity": [
    {"content_type": "announcement", "used": 2, "limit": 2},
    {"content_type": "activity", "used": 3, "limit": 10},
    {"content_type": "new_version", "used": 1, "limit": 1}
  ],
  "top_slots": [
    {"top_type": "app_detail", "used": 1, "content_ids": [123]},
    {"top_type": "pc_inventory", "used": 0, "content_ids": []}
  ],
  "online_count": 5,
  "checked_at": 1760000000
}
```

判定：本次新增在线占用且 `used >= limit` 时列出占用，让用户选择并确认替换对象，不自动下线旧内容。在线容量与置顶容量分别处理；置顶满时优先取消所选条目的对应置顶，不必下线整条内容。`top_slots[].content_ids` 是当前占位条目，用业务名称说明占用，不要求用户处理无关位置。

## 创建

```text
# 先预览；确认后用相同参数把 dry_run 换成 yes:true
call_tool(name:"whats-new create-whats-new", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{url:"https://www.taptap.cn/moment/123", type:"announcement",
        label_type:"announcement", start_time:0, end_time:1800100000,
        top_types:["app_detail"]},
  idempotency_key:"<stable-key>", dry_run:true})
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `url` | 是 | TapTap 站内链接（帖子/动态/视频/签到/图集/新版本/礼包后台） |
| `type` | 是 | `announcement` 公告类、`activity` 活动类；创建后不可改 |
| `label_type` | 是 | 手动：`announcement` / `feedback` / `activity` / `contribution`；创建后不可改 |
| `start_time` / `end_time` | 是 | 秒级时间戳；避免同时为 0，0/0 重新上线可能变成当前时间起 30 天 |
| `top_types` | 是 | `app_detail` / `pc_inventory`，可空数组 |

创建即启用（online）。返回 `content_id`、`status`、`type`、`label_type`、`top_types`、`sort`、`start_time`、`end_time`、`applied_at`。回读与预期不符时保留待核实，不盲目重复创建或上线。

失败分支：

| 返回 | 含义 | 下一步 |
| --- | --- | --- |
| `invalid_argument`（错误的链接） | 链接不是站内可用内容或不属于当前游戏 | 让用户换正确链接 |
| `failed_precondition`（label_type 是系统同步内容） | 想手动创建签到/礼包/新版本/抽奖 | 去来源模块创建并等待收录 |
| `failed_precondition`（容量/置顶位） | 超过上限或置顶位已满 | 让用户选择并确认替换对象 |
| `result_unknown` | 未回读到创建结果 | 用 `list-whats-new` 核实，不直接重试 |

## 回读与上线

```text
call_tool(name:"whats-new get-whats-new", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{content_id:"<contentId>"}})

call_tool(name:"whats-new update-whats-new-status", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{content_id:"<contentId>", status:"online"},
  idempotency_key:"<stable-key>", dry_run:true})
```

核对 `title`、`url`、`source`、`status`、`start_time`/`end_time`、`invalid`/`invalid_reason`、`top_types`、`sort`。创建/重新上线/置顶变更后再读总览确认占用和目标位置；`invalid=true` 说明内容本身不可展示（帖子被删、活动缺图等），先解决内容问题再上线。`status=online` 只表示配置生效，需要展示证据时说明“配置已生效，展示待验证”。

## 编辑排期/置顶/排序

```text
call_tool(name:"whats-new update-whats-new", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{content_id:"<contentId>", type:"announcement", label_type:"announcement",
        start_time:1800000000, end_time:1800100000,
        top_types:["app_detail", "pc_inventory"]},
  idempotency_key:"<stable-key>", dry_run:true})
```

- `top_types` 是整份替换；编辑先回读，用户只改排期就原样保留，空数组只用于明确取消全部置顶。
- 换链接只能“新建条目 + 下线旧条目”，`update` 不提供改 URL。
- 置顶顺序由加入时间决定，改 `top_types` 不改变置顶区先后；要调整先后只能取消后重新设置。
- 签到类型可附 `check_in_award_ids`（≤3 个）用于公告位展示累签奖励。

## 下线与失效巡检

```text
call_tool(name:"whats-new check-whats-new-readiness", args:{
  developer_id:"<developerId>", app_id:"<appId>"})

call_tool(name:"whats-new update-whats-new-status", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{content_id:"<contentId>", status:"offline"},
  idempotency_key:"<stable-key>", dry_run:true})
```

巡检 `issues[].code`：

| code | 含义 | 下一步 |
| --- | --- | --- |
| `content_invalid` | 链接或对象不可展示 | 下线，或换链接后新建 |
| `content_expired` | 已过结束时间仍在线（清理有窗口） | 需要继续就改 `end_time`，否则下线 |
| `capacity_full` | 某类在线容量已满 | 让用户选择并确认替换对象 |
| `top_duplicate` | 同一置顶场景被多条占用 | 用 `save-whats-new-top` 调整集合 |

未展示时先查源内容是否生效、条目是否收录、排期、失效原因、容量和置顶占用；收录缺失时交回来源模块，不通过改标题、下架再上架等无关写入触发刷新。配置在线不证明客户端可见，也不保证曝光量。

## 字段与枚举

- `type`：`announcement`｜`activity`
- `label_type`：`announcement`｜`feedback`｜`activity`｜`contribution`（手动）；`check_in`｜`gift`｜`new_version`｜`lottery`（系统同步）
- `status`：`online`｜`offline`
- `top_types`：`app_detail`｜`pc_inventory`
- `source`：`moment`｜`topic`｜`video`｜`check_in`｜`activity`｜`gift`｜`new_version`｜`lottery`｜`image_gallery`｜`unknown`
- 运营数据：`exposure_count`、`click_count`、`click_rate`；`stat_updated_at=0` 表示本次没取到统计。

中文展示用业务名称（公告/反馈/活动/征稿、游戏详情页置顶/PC 库置顶/不置顶）；未知枚举保留原值并说明暂无法识别，不擅自映射为成功或离线。运营参考：[如何利用「活动与公告」板块获得曝光](https://developer.taptap.cn/docs/store/operation/advanced-guide/exposure/event-notice/)（2026-10-30 核对）。
