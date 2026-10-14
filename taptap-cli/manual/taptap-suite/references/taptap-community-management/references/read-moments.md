# 读帖子：列表、详情与子版块

本文件是 `taptap-community-management` 的「读帖子」场景细节。场景路由、CRITICAL 规则和输出边界以 [community-management 手册](taptap-suite/references/taptap-community-management/MANUAL.md) 为准。

## 命令

| 目标 | 命令 |
| --- | --- |
| 帖子列表 | `list-community-moments` |
| 帖子正文与图片 | `get-community-moment` |
| 子版块列表 | `list-community-group-labels` |

`list-community-moments` 支持分页（`page` / `page_size`，也可写进 `data`）；`get-community-moment` 和 `list-community-group-labels` 不分页。

```text
# 最近回复的帖子（默认 order=commented）
call_tool(name:"community-management list-community-moments", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{page:1, page_size:20}})

# 按发布时间
call_tool(name:"community-management list-community-moments", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{order:"published", page:1, page_size:20}})

# 子版块列表（取 group_label_id 再筛帖子）
call_tool(name:"community-management list-community-group-labels", args:{
  developer_id:"<developerId>", app_id:"<appId>"})

# 帖子详情（正文与图片）
call_tool(name:"community-management get-community-moment", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{moment_id:"<momentId>"}})
```

## 列表参数

| 参数 | 行为 |
| --- | --- |
| `order=commented` | 按最后回复时间倒序（默认） |
| `order=published` | 按发布时间倒序 |
| `group_label_id` | 只看该子版块；取值先用 `list-community-group-labels` 取回，不传表示不限 |
| `moment_intent=["1"]` | 问答求助 |
| `moment_intent=["2"]` | 反馈建议 |
| `moment_intent=["1","2"]` | 两类都返回（多值之间是「或」） |
| `page` / `page_size` | 分页，`page_size` 取 1–100，默认 20 |

`order` 与 `moment_intent` 是枚举：非法值会被直接拒绝，不会静默降级。

> **小贴士**：想快速捞「玩家求助」和「反馈建议」时，优先用 `moment_intent`，比在正文里搜关键字更准：`"1"` = 问答求助，`"2"` = 反馈建议。只看求助传 `["1"]`，只看反馈传 `["2"]`，两类一起看传 `["1","2"]`（多个值是「或」）；不传表示不限意图。

## 子版块（group label）

`list-community-group-labels` 返回当前 App 论坛配置的子版块，和论坛管理中心「子版块管理」是同一份数据，按官方顺序返回（先按配置的排序值升序，再按创建时间倒序）。**不分页**，一次返回全部。

| 字段 | 说明 |
| --- | --- |
| `group_label_id` | 子版块 ID（字符串），直接作为 `list-community-moments` 的 `group_label_id` 筛选参数 |
| `name` | 论坛管理中心配置的名称 |
| `display_name` | 展示名称；可能为 `null`，为空时回退 `name` |
| `is_disabled` | 禁止普通用户在该子版块发帖（版块仍可见、可浏览），只有论坛管理员可发；与另外两个标记相互独立 |
| `is_isolated` | 隔离版块：该子版块的帖不进入论坛首页聚合信息流，仅作为独立版块展示 |
| `is_offline` | 下线：该子版块在前台（首页与发帖页）整体隐藏，只有论坛管理中心可见 |

- 停用 / 隔离 / 下线的子版块**照常返回**，靠标记区分，不要当成「不存在」。
- 论坛未开通时无法取得子版块。
- 直接用返回的 `group_label_id` 过滤帖子，不要按版块名猜 ID。

## 帖子字段

列表项（`moment`）：

| 字段 | 说明 |
| --- | --- |
| `moment_id` | 帖子 ID（字符串，原样回传） |
| `title` | 标题；长贴与视频动态有标题，图文动态为 `null` |
| `summary` | 摘要；长贴取摘要、视频动态取视频描述，图文动态为 `null` |
| `url` | 帖子在 TapTap 社区的访问地址 |
| `author` | 发帖人；资料不可见时为 `null`（`user_id` / `url` 仍返回） |
| `publish_time` | 发布时间（Unix 秒）；定时未发布是未来时间 |
| `commented_time` | 最后回复时间（Unix 秒） |
| `group_label` / `group_label_id` | 所属子版块名称 / ID；未绑定子版块时为 `null` |
| `has_video` | 是否带视频信息（不等于帖子就是视频帖） |
| `stat` | 互动统计：`comments`（含子回复）/ `favorites` / `pv_total` / `reposts` / `ups` |
| `status` | 管理状态：`is_top` / `is_elite` / `is_down` / `is_focus` / `is_quiz` / `is_treasure` / `is_official` / `is_group_label_top` / `is_scheduled` |

详情额外返回：`content`（正文原文，保留 BBCode；无正文为空串）、`images`（正文图 + 尾部组图，同地址去重）、`video`（无视频为 `null`；只含 `video_id` / `cover_url` / `duration_seconds` / `aspect_ratio`，**不含播放地址**）。

## 取数与输出

- `list-community-moments` 的 `total` 是官方统计口径；已删除或不可见的帖会被剔除，因此单页条数可能少于 `page_size`。这不是缺页。
- 取数前先用 `group_label_id`、`moment_intent`、`order` 缩小范围，再按需翻少量页；优先不用 `page_all` 全量拉。
- `content` 保留原帖 BBCode 标记（如 `[b]` / `[i]`）；转述时不要静默改写、删除标记或把标记当正文。`images` 给 URL，不做图片内容判断。
- `title` / `summary` 可能为 `null`，`author` 资料不可见时也为 `null`；不要编造标题或昵称，也不要回退展示 `user_id`。
- 子版块名称优先用 `display_name`，为 `null` 时回退 `name`；不要把停用 / 隔离 / 下线说成「不存在」。
- `has_video` 只表示「有视频信息可看」，不等于帖子本身就是视频帖；`video` 只含封面与元信息，**没有播放地址**，不要承诺能播放。
- `moment_id` / `user_id` 只在用户明确要排查时展示；默认用标题、时间和正文摘要指代。

## 组合配方

| 目标 | 命令与 `data` |
| --- | --- |
| 最近回复的帖子 | `list-community-moments` `{"page":1,"page_size":20}` |
| 按发布时间 | `list-community-moments` `{"order":"published","page":1,"page_size":20}` |
| 问答求助 | `list-community-moments` `{"moment_intent":["1"],"page":1,"page_size":20}` |
| 某子版块 | `list-community-moments` `{"group_label_id":"<id>","page":1,"page_size":20}` |
| 论坛子版块 | `list-community-group-labels`（只需 scope 参数 `developer_id` / `app_id`） |
| 帖子详情 | `get-community-moment` `{"moment_id":"<momentId>"}` |
