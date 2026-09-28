# TapTap CLI 插件:玩家评价(player-feedback)

player-feedback 是**只读**入口,只回答"玩家在评价里写了什么":评分、正文、配图、作者、设备、游戏时长展示文案,以及该评价下的回复。它不写任何数据,也不回答评分趋势、好评率或统计口径。开始前先读 [shared execution](taptap-suite/references/shared-execution.md)(身份、JSON 输出外壳、错误处理、确认门禁)。命令行示例按 [taptap-suite](taptap-suite/MANUAL.md) 的映射表转成 call_tool 调用。

**CRITICAL — 深分页硬上限:`page × page_size` 必须 ≤ 10000。越界时服务端返回空列表且 `total=0`,无法区分"确实没有评价"与"翻页越界"。禁止发起越界调用;需要更多数据时先按时间或评分缩小范围再查。**

**CRITICAL — `score=positive` 不等同"好评 4-5 星"。接口对 `positive` 按上游实际行为过滤 `score >= 3`,与开发者中心的"好评"标签和统计口径都不一致。用户说"好评"时必须先对齐口径;要 4-5 星就分别传 `"4"` 和 `"5"`。**

**CRITICAL — 不传 `start_date` 时只返回近 1 个月内更新过的评价。用户要"全部评价"时必须显式传 `0`,并说明这是按最后编辑时间全量扫描。**

## 快速决策

| 用户意图 | 首选调用 / 流程 |
| --- | --- |
| 看最近的玩家评价 | `call_tool(name:"player-feedback list-player-reviews", args:{dev_id, app_id, data:{page:1, page_size:20}})`;`order` 默认 `update` |
| 看差评 / 负面评价 | `data:{score:"negative", page:1, page_size:20}` |
| 看 4-5 星评价 | 分别传 `data:{score:"4"}` 和 `data:{score:"5"}`;不要用 `positive`,见 CRITICAL |
| 按关键字找评价正文 | `data` 加 `keyword`;说明只匹配正文,不匹配作者昵称 |
| 看还没互动过的评价 | `data` 加 `examined:false` |
| 看已互动过的评价 | `data` 加 `examined:true` |
| 按热度 / 游戏时长排序 | `data:{order:"hot"}` / `data:{order:"spent"}` |
| 看某条评价的回复 | 响应里的 `comments[]`;总数看 `comment_total` |
| 判断官方有没有回复 | 看 `has_official_comment`,再看 `comments[].is_official` |
| 要"全部评价"或跨月数据 | 显式传 `data:{start_date:0}`,并先读 [queries](taptap-suite/references/taptap-player-feedback/references/player-feedback-queries.md) 确认分页切分 |
| 要评分趋势、好评率、评分分布 | 转 `taptap-dashboard-stats` 手册 |
| 要回复、删除或处理评价 | CLI 不支持写;说明只能查看,并给开发者中心入口 |

## 常用调用

该 operation 声明了分页(OpenAPI 名 `x-pagination`,catalog 里序列化为 `pagination`),可用 `page` / `page_size`,翻全量用 `page_all`(配 `page_limit` / `page_delay`);也可以把 `page` / `page_size` 写进 `data`。

```text
# 查看 operation schema
call_tool(name:"schema", args:{_positional:["player-feedback","list-player-reviews"]})

# 最近 20 条评价(默认 order=update,时间窗为近 1 个月)
call_tool(name:"player-feedback list-player-reviews", args:{
  dev_id:"<developerId>", app_id:"<appId>",
  data:{page:1, page_size:20}})

# 差评
call_tool(name:"player-feedback list-player-reviews", args:{
  dev_id:"<developerId>", app_id:"<appId>",
  data:{score:"negative", page:1, page_size:20}})

# 关键字 + 只看未互动
call_tool(name:"player-feedback list-player-reviews", args:{
  dev_id:"<developerId>", app_id:"<appId>",
  data:{keyword:"卡顿", examined:false, page:1, page_size:20}})

# 跨全部时间(start_date=0 表示不限起始时间)
call_tool(name:"player-feedback list-player-reviews", args:{
  dev_id:"<developerId>", app_id:"<appId>",
  data:{start_date:0, page:1, page_size:100}})
```

## 分页硬上限

`page × page_size` 必须 ≤ 10000。超过时接口返回**空列表且 `total=0`**,这个空结果**不能**当作"没有评价"。

| `page_size` | 允许的最大 `page` | 单次最多可取 |
| --- | --- | --- |
| 20(默认) | 500 | 10000 |
| 50 | 200 | 10000 |
| 100 | 100 | 10000 |

- 需要 >10000 条时**不要继续翻页**:先按 `start_date` / `end_date` 切成多个时间窗,或按评分逐档查,再分别汇总。
- 时间窗切分、越界识别、`total` 不可信的处理和响应字段解释见 [queries](taptap-suite/references/taptap-player-feedback/references/player-feedback-queries.md)。

## 执行规则

- 缺 `developerId` / `appId` 时转 `taptap-identity` 手册。
- 泛问"评价"时先确认三件事:**时间范围**、**是否只看差评**、**是否需要正文关键字**。不要默认近 1 个月就是全部。
- 该接口是 APP scope 只读接口,权限为 observer 或评价管理权限;缺权限时按共享错误契约解释,不要改用其它接口绕过。
- `data` 只写本文档列出的字段:`score` / `examined` / `keyword` / `start_date` / `end_date` / `order` / `page` / `page_size`。`app_id` / `dev_id` 用 scope 参数,不要重复写进 `data`。
- `score` 与 `order` 是枚举:非法值返回 400(不再静默降级)。`order` 只接受 `update` / `hot` / `spent`;`score` 只接受 `positive` / `negative` / `"1"`–`"5"`。
- 单页返回条数可能少于 `page_size`:服务端已剔除被删除的评价,这不是缺页,不要因此自动补翻。
- `total` 在翻页越界时为 `0`,**不要把 `total=0` 当作"没有评价"**;先用一次 `page=1` 的查询确认基线。
- `author` 可能为 `null`(评价者资料不可见)。此时不要编造昵称,也不要回退到 `user_id` 展示给用户。
- `comments` 只是该评价下的前若干条回复,总数以 `comment_total` 为准。
- 本手册**不做任何写操作**,也不要调用其它业务域的写接口代表用户回复评价。

## 输出规则

- 面向用户优先讲:评分、正文要点、评价时间、是否已互动、官方是否回复、回复条数。
- `review_id` / `user_id` / `comment_id` 只在用户明确要排查时展示;默认用评分、时间和正文摘要指代。
- `played_tips` 与 `device` 是展示文案,不是精确统计;不要拿来算平均值或做分群结论。
- 必须区分"本次返回的条数"和"`total`"。当查询越界(返回空且 `total=0` 而基线查询非空)时,明确说明是翻页越界,并给出缩小范围的建议。
- 配图给 URL;不做图片内容判断,也不描述未读取到的图片。
- 不承诺已回复、已处理、已删除或已提交任何评价相关状态。

## References

| Reference | 什么时候读 | 读取方式 |
| --- | --- | --- |
| player feedback queries | 需要切分时间窗、处理分页越界、解释 `total` 与评分口径,或核对响应字段含义时 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-player-feedback/references/player-feedback-queries.md"})` |

## 不在本手册范围

- 评分/评价统计、好评率、评分分布与趋势:转 `taptap-dashboard-stats` 手册。
- 回复、处理或删除玩家评价:CLI 不支持写,给开发者中心入口。
- 资料提审、撤审、发布:转 `taptap-app-edit` 手册。
- 测试计划资格、激活码:转 `taptap-test-plan` 手册。
- 社区内容(帖子、动态、评论区的非评价内容):CLI 不支持。
