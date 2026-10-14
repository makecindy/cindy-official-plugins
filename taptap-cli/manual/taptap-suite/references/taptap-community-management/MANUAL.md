# TapTap CLI 插件:社区论坛管理(community-management)

community-management 是**只读**入口,回答"这个 App 的论坛里有哪些帖子、帖子写了什么、大家怎么回复",不做发帖、回帖或内容处置。开始前先读 [shared execution](taptap-suite/references/shared-execution.md)(身份、JSON 输出外壳、错误处理)。命令行示例按 [taptap-suite](taptap-suite/MANUAL.md) 的映射表转成 call_tool 调用。

**CRITICAL — 分页别贪全:只有 `list-community-moments` / `list-community-moment-replies` / `list-community-moment-child-replies` 支持分页(`page_size` 1–100,默认 20),`page × page_size` 必须 ≤ 10000,越界会直接失败;`get-community-moment` / `list-community-group-labels` 不分页。由于数据量和性能原因,不推荐用 `page_all` 取全量——逐页串行请求,页数越多越慢,翻得越深成本越高。需要更多数据时优先用 `group_label_id`、`moment_intent`、`order` 缩小范围或排序。**

**CRITICAL — `moment_id` / `parent_reply_id` 是位数很长的十进制整数 ID,必须当作字符串原样回传:不要转成数字(会丢精度),也不要补零或重新拼接。**

**CRITICAL — `list-community-moment-replies` 只返回直接回复帖子的那一层;某条回复下的回复要用 `list-community-moment-child-replies` 传 `parent_reply_id`,父回复可以是任意层级。**

## 快速决策

| 用户意图 | Reference | 起手调用 |
| --- | --- | --- |
| 看帖子列表、排序,或按子版块 / 求助反馈筛选 | [read moments](taptap-suite/references/taptap-community-management/references/read-moments.md) | `call_tool(name:"community-management list-community-moments", args:{developer_id:"<developerId>", app_id:"<appId>", data:{page:1, page_size:20}})` |
| 看帖子正文和图片 | [read moments](taptap-suite/references/taptap-community-management/references/read-moments.md) | `call_tool(name:"community-management get-community-moment", args:{developer_id:"<developerId>", app_id:"<appId>", data:{moment_id:"<momentId>"}})` |
| 查有哪些子版块 / 取 `group_label_id` | [read moments](taptap-suite/references/taptap-community-management/references/read-moments.md) | `call_tool(name:"community-management list-community-group-labels", args:{developer_id:"<developerId>", app_id:"<appId>"})` |
| 看帖子的一级回复 | [read replies](taptap-suite/references/taptap-community-management/references/read-replies.md) | `call_tool(name:"community-management list-community-moment-replies", args:{developer_id:"<developerId>", app_id:"<appId>", data:{moment_id:"<momentId>", page:1, page_size:20}})` |
| 看某条回复下的子回复 | [read replies](taptap-suite/references/taptap-community-management/references/read-replies.md) | `call_tool(name:"community-management list-community-moment-child-replies", args:{developer_id:"<developerId>", app_id:"<appId>", data:{moment_id:"<momentId>", parent_reply_id:"<replyId>", page:1, page_size:20}})` |
| 统计回复数,或解释置顶回复、`stat` / `total` 口径 | [read replies](taptap-suite/references/taptap-community-management/references/read-replies.md) | — |
| 要玩家评价或经营数据(评分、下载、曝光等) | 转 `taptap-player-feedback` / `taptap-dashboard-stats` 手册 | — |
| 要发帖、回帖、置顶、加精、删除或处理内容 | CLI 不支持写;说明只能查看,不要承诺已处置 | — |

## 常用调用

```text
# 先看该域操作与参数(enum=可选值、pattern=格式、required=true=必填)
list_tools(category:"community-management")

# 最近回复的帖子(默认 order=commented)
call_tool(name:"community-management list-community-moments", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{page:1, page_size:20}})

# 按发布时间
call_tool(name:"community-management list-community-moments", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{order:"published", page:1, page_size:20}})

# 子版块列表(取 group_label_id 再筛帖子)
call_tool(name:"community-management list-community-group-labels", args:{
  developer_id:"<developerId>", app_id:"<appId>"})

# 帖子详情(正文与图片)
call_tool(name:"community-management get-community-moment", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{moment_id:"<momentId>"}})
```

## 执行规则

- 缺 `developerId` / `appId` 时转 `taptap-identity` 手册。
- 本域只有只读能力,权限与论坛管理相关;缺权限时按共享错误约定解释,不要改用其它接口绕过。
- `data` 只写 reference 列出的字段;`developer_id` / `app_id` 用 scope 参数,不要重复写进 `data`。
- `order` 与 `moment_intent` 是枚举:非法值会被直接拒绝,不会静默降级。
- 泛问"社区"时先确认三件事:只看某类帖(求助 / 反馈)、要不要某个子版块、要列表还是要正文和回复。
- 本手册不做任何写操作,也不要调用其它业务域的写接口代表用户处置社区内容。

## References

| Reference | 什么时候读 | 读取方式 |
| --- | --- | --- |
| read moments | 读帖子:列表与排序、子版块、意图筛选、正文与图片字段 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-community-management/references/read-moments.md"})` |
| read replies | 读回复:一级回复、子回复、置顶回复,以及 `stat` / `total` 口径 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-community-management/references/read-replies.md"})` |

## 不在本手册范围

- 玩家评价(评分、评价正文、评价回复):转 `taptap-player-feedback` 手册。
- 评分、下载、曝光、转化等经营数据:转 `taptap-dashboard-stats` 手册。
- 发帖、回帖、置顶、加精、沉底、删除或其它内容处置:CLI 不支持写。
- 创建游戏、修改资料、包体、资质、测试计划:转对应业务手册。
