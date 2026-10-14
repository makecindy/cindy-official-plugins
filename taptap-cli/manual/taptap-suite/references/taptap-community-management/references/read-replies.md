# 读回复：一级回复、子回复与口径

本文件是 `taptap-community-management` 的「读回复」场景细节。场景路由、CRITICAL 规则和输出边界以 [community-management 手册](taptap-suite/references/taptap-community-management/MANUAL.md) 为准。

## 命令

| 目标 | 命令 |
| --- | --- |
| 帖子的一级回复 | `list-community-moment-replies` |
| 某条回复下的子回复 | `list-community-moment-child-replies` |

两者都支持分页（`page` / `page_size`，也可写进 `data`）。

```text
# 一级回复
call_tool(name:"community-management list-community-moment-replies", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{moment_id:"<momentId>", page:1, page_size:20}})

# 某条回复下的子回复（parent_reply_id 取一级回复的 comment_id）
call_tool(name:"community-management list-community-moment-child-replies", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{moment_id:"<momentId>", parent_reply_id:"<replyId>", page:1, page_size:20}})
```

## 层级语义

- `list-community-moment-replies` 只返回父节点是帖子的那一层（一级回复），按回复时间倒序。
- `list-community-moment-child-replies` 返回挂在指定 `parent_reply_id` 下的直接子回复；父回复可以是任意层级，不假设层数，也不会继续下钻。
- 完整读取一条长讨论串：先取一级回复，再对需要展开的回复逐条取子回复。

## 置顶回复

`list-community-moment-replies` 有置顶回复时：

- 置顶回复排在首页第一条，`pinned=true`。
- 它不在后续页重复出现。
- 首页可能比 `page_size` **多返回这一条**（其余页不含它）。

这是正常的接口行为，不是重复数据或分页错误；汇总回复数时不要把它数成两条。

## 回复字段

| 字段 | 说明 |
| --- | --- |
| `comment_id` | 回复 ID（字符串，原样回传即可作为 `parent_reply_id`） |
| `content` | 回复正文原文，保留 BBCode |
| `created_time` | 回复时间（Unix 秒） |
| `ups` | 点赞数 |
| `pinned` | 是否被置顶 |
| `images` | 回复图片；无图为空数组 |
| `author` | 回复者；资料不可见时为 `null` |
| `reply_to` | 被回复对象；仅子回复常见，可能为 `null` |

## 回复口径

- `list-community-moment-replies` / `list-community-moment-child-replies` 的 `total` 只统计该层的直接回复。
- 帖子里的 `moment.stat.comments` **包含子回复**，与回复列表 `total` 口径不同；解释「有多少条回复」时要说明用的是哪个数。

## 取数与输出

- 取数前先按帖子 `moment_id` 定位、再按需翻少量页；由于数据量和性能原因，不推荐用 `page_all` 全量拉回复。
- `content` 是原文（含 BBCode），转述时不要静默改写标记。
- `author` 为 `null` 时不要回退展示 `user_id`，也不要编造昵称。
- `comment_id` / `user_id` 只在用户明确要排查时展示；默认用回复时间和正文摘要指代。
