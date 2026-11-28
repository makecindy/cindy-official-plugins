# TapTap CLI 插件:社区论坛管理(community-management)

community-management 负责读取当前或指定 App 的论坛内容、上传帖子素材、发帖与回帖;置顶、加精、沉底、删除等处置不由 CLI 执行。开始前先读 [shared execution](taptap-suite/references/shared-execution.md)(身份、JSON 输出外壳、错误处理),同一会话已读且内容未变化时直接沿用。命令行示例按 [taptap-suite](taptap-suite/MANUAL.md) 的映射表转成 call_tool 调用。

**CRITICAL — 分页别贪全:只有 `list-community-moments` / `list-community-moment-replies` / `list-community-moment-child-replies` 支持分页(`page_size` 1–100,默认 20),`page × page_size` 必须 ≤ 10000,越界会直接失败;`get-community-moment` / `list-community-group-labels` 不分页。由于数据量和性能原因,不推荐用 `page_all` 取全量——逐页串行请求,页数越多越慢,翻得越深成本越高。需要更多数据时优先用 `group_label_id`、`moment_intent`、`order` 缩小范围或排序。**

**CRITICAL — `moment_id` / `parent_reply_id` / `draft_id` 是位数很长的十进制整数 ID,必须当作字符串原样回传:不要转成数字(会丢精度),也不要补零或重新拼接。**

**CRITICAL — `list-community-moment-replies` 只返回直接回复帖子的那一层;某条回复下的回复要用 `list-community-moment-child-replies` 传 `parent_reply_id`,读接口里的父回复可以是任意层级。写入子回复时 `parent_reply_id` 必须是该帖的一级回复(见 reply moment 手册);要回复「回复下的回复」时用 `reply_to_reply_id` 指向更深的那条。**

**CRITICAL — 发帖发布是跨轮步骤:同一轮内禁止 create-draft → publish-draft 连跑。** publish 的前提是本会话已经交付过 `preview_url`,且用户看过预览后明确回复可以发。只说"发个帖:<内容>"只表达发帖意图,不构成发布确认;`yes: true` 只解除写门禁,不等于用户已确认发布。用户事先明确说"不用预览,直接发"时,才可在同一轮内发布,并在回执里说明已按此豁免执行。

**CRITICAL — `+upload-video` 返回的 `videoId` 才是发帖句柄;`normal` / `transcoding` / `regulating` 都能直接发帖引用,不要因状态不是 `normal` 重传,也不要拿素材库 ID 顶替。**

**CRITICAL — 发帖与回帖的请求形状、正文白名单、身份与不可逆边界见各自 reference;`draft_id` 只在顶层,`contents` 是 JSON 字符串;草稿先给 `preview_url` 确认再发布。**

## 快速决策

| 用户意图 | Reference | 起手调用 |
| --- | --- | --- |
| 看帖子列表、排序,或按子版块 / 求助反馈筛选 | [read moments](taptap-suite/references/taptap-community-management/references/read-moments.md) | `call_tool(name:"community-management list-community-moments", args:{developer_id:"<developerId>", app_id:"<appId>", data:{page:1, page_size:20}})` |
| 看帖子正文和图片 | [read moments](taptap-suite/references/taptap-community-management/references/read-moments.md) | `call_tool(name:"community-management get-community-moment", args:{developer_id:"<developerId>", app_id:"<appId>", data:{moment_id:"<momentId>"}})` |
| 查有哪些子版块 / 取 `group_label_id` | [read moments](taptap-suite/references/taptap-community-management/references/read-moments.md) | `call_tool(name:"community-management list-community-group-labels", args:{developer_id:"<developerId>", app_id:"<appId>"})` |
| 看帖子的一级回复 | [read replies](taptap-suite/references/taptap-community-management/references/read-replies.md) | `call_tool(name:"community-management list-community-moment-replies", args:{developer_id:"<developerId>", app_id:"<appId>", data:{moment_id:"<momentId>", page:1, page_size:20}})` |
| 看某条回复下的子回复 | [read replies](taptap-suite/references/taptap-community-management/references/read-replies.md) | `call_tool(name:"community-management list-community-moment-child-replies", args:{developer_id:"<developerId>", app_id:"<appId>", data:{moment_id:"<momentId>", parent_reply_id:"<replyId>", page:1, page_size:20}})` |
| 统计回复数,或解释置顶回复、`stat` / `total` 口径 | [read replies](taptap-suite/references/taptap-community-management/references/read-replies.md) | — |
| 有本地图片,要传成帖子配图 | [upload image](taptap-suite/references/taptap-community-management/references/upload-image.md) | `call_tool(name:"community-management +upload-image", args:{_positional:["./cover.png"], developer_id:"<developerId>", app_id:"<appId>", dry_run:true})` |
| 有本地视频,要拿发帖用的 `videoId` | [upload video](taptap-suite/references/taptap-community-management/references/upload-video.md) | `call_tool(name:"community-management +upload-video", args:{_positional:["./clip.mp4"], developer_id:"<developerId>", app_id:"<appId>", dry_run:true})` |
| 要发帖、改草稿或发布草稿 | [publish post](taptap-suite/references/taptap-community-management/references/publish-post.md) | `call_tool(name:"community-management create-community-topic-draft", args:{developer_id:"<developerId>", app_id:"<appId>", data:{...}, yes:true})`(草稿真实写入才返回 `preview_url`;发布等用户看过预览再确认) |
| 回帖(一级回复) | [reply moment](taptap-suite/references/taptap-community-management/references/reply-moment.md) | `call_tool(name:"community-management create-community-moment-reply", args:{developer_id:"<developerId>", app_id:"<appId>", data:{moment_id:"<momentId>", contents:"…"}, dry_run:true})` |
| 回帖(某条回复下的子回复) | [reply moment](taptap-suite/references/taptap-community-management/references/reply-moment.md) | `call_tool(name:"community-management create-community-moment-reply-child", args:{developer_id:"<developerId>", app_id:"<appId>", data:{moment_id:"<momentId>", parent_reply_id:"<commentId>", contents:"…"}, dry_run:true})` |
| 要玩家评价或经营数据(评分、下载、曝光等) | 转 `taptap-player-feedback` / `taptap-dashboard-stats` 手册 | — |
| 要置顶、加精、沉底、删除或处理内容 | 本域不承接;说明边界,不要承诺已处置 | — |

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

# 指定论坛：scope 使用已确认可用的厂商与游戏，目标放在 data 中
call_tool(name:"community-management list-community-moments", args:{
  developer_id:"<authorizedDeveloperId>", app_id:"<authorizedAppId>",
  data:{forum_app_id:"<targetAppId>", order:"published", page:1, page_size:20}})

# 目标论坛子版块（与查帖使用相同的 forum_app_id）
call_tool(name:"community-management list-community-group-labels", args:{
  developer_id:"<authorizedDeveloperId>", app_id:"<authorizedAppId>",
  data:{forum_app_id:"<targetAppId>"}})

# 当前 App 子版块列表（省略 forum_app_id）
call_tool(name:"community-management list-community-group-labels", args:{
  developer_id:"<developerId>", app_id:"<appId>"})

# 帖子详情(正文与图片/视频元信息)
call_tool(name:"community-management get-community-moment", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{moment_id:"<momentId>"}})
```

## 执行规则

- 读帖子先区分调用 scope 与目标论坛：`developer_id` / `app_id` 使用已授权厂商与游戏；帖子列表与子版块列表均用 `args.data.forum_app_id` 指定跨论坛目标，不要把论坛 URL 中的 App ID 直接填入调用 scope。缺调用 scope 时转 `taptap-identity` 手册，详见 [read-moments](taptap-suite/references/taptap-community-management/references/read-moments.md)。
- 子版块列表仅返回当前用户可查看的子版块，字段含义与用法详见 [read-moments](taptap-suite/references/taptap-community-management/references/read-moments.md)。
- 查帖被拒绝时先按 [read-moments](taptap-suite/references/taptap-community-management/references/read-moments.md) 核对参数角色；一次通用权限错误不证明目标论坛不可读。读权限不代表有目标论坛的写权限。
- `data` 只写 reference 列出的字段;`developer_id` / `app_id` 用 scope 参数,不要重复写进 `data`。
- `order` 与 `moment_intent` 是枚举:非法值会被直接拒绝,不会静默降级。
- 写能力:`+upload-image`、`+upload-video`、发帖与回帖都需要论坛版主/主管理员权限;缺权限按共享错误约定解释,不要改用素材库上传或其它接口绕过。
- 写门禁:每个写调用先 `dry_run: true` 预览,用户确认后用完全相同参数加 `yes: true`;例外是发帖草稿的建/改——草稿本身就是给用户看的预览载体,`dry_run` 不建草稿、拿不到 `preview_url`,所以直接用 `yes: true` 写入,再把 `preview_url` 交给用户,发布仍要等用户看过预览并确认。既没有 `dry_run` 也没有 `yes` 的写调用会被插件拒绝(CONFIRM_REQUIRED),只读会话里一律拒绝。
- 泛问"社区"时先确认三件事:只看某类帖(求助 / 反馈)、要不要某个子版块、要列表还是要正文和回复。
- 写只覆盖帖子素材、草稿、发布与回复;置顶、加精、沉底、删除、内容处置不在本域,不要用其它业务域的写接口代表用户处置社区内容。

## References

| Reference | 什么时候读 | 读取方式 |
| --- | --- | --- |
| read moments | 读帖子:调用 scope 与跨论坛查询、权限排查、子版块、正文与图片字段 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-community-management/references/read-moments.md"})` |
| read replies | 读回复:一级回复、子回复、置顶回复,以及 `stat` / `total` 口径 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-community-management/references/read-replies.md"})` |
| upload image | 帖子配图:权限、产物、与素材库的区别 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-community-management/references/upload-image.md"})` |
| upload video | 帖子视频:登记、`videoId`、状态与重试 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-community-management/references/upload-video.md"})` |
| publish post | 发帖:论坛与身份、四步链路、文档字段、正文节点与发布边界 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-community-management/references/publish-post.md"})` |
| reply moment | 回帖:一级回复与子回复、正文白名单与重试 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-community-management/references/reply-moment.md"})` |

## 不在本手册范围

- 玩家评价(评分、评价正文、评价回复):转 `taptap-player-feedback` 手册。
- 评分、下载、曝光、转化等经营数据:转 `taptap-dashboard-stats` 手册。
- 置顶、加精、沉底、删除或其它处置:本域不承接;CLI 的写能力只覆盖帖子素材、草稿、发布与回复。
- 创建游戏、修改资料、包体、资质、测试计划:转对应业务手册。
