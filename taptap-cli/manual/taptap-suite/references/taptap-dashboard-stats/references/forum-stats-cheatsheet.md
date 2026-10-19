# 论坛数据指标速查（get-forum-stats）

`get-forum-stats` 是 `dashboard-stats` 服务下与 `get-dashboard-stats` 相互独立的只读接口，查的是**论坛数据**：论坛访问量、活跃用户、内容发布/删除/移动、回复数，以及论坛关注总数和内容总数。它不是商店/游戏/销售/评价看板指标，也不返回帖子或回复的正文（正文转 `taptap-community-management` 手册）。场景路由和输出边界以 [dashboard-stats 手册](taptap-suite/references/taptap-dashboard-stats/MANUAL.md) 为准。

单帖的当前回复总数（`moment.stat.comments`，含子回复）和分层回复列表不属于本接口：那是 `taptap-community-management` 手册的读取范围；这里的 `comment_create` 只表示所选区间内全论坛的回复新增量，不能用来回答「这个帖子现在有多少回复」。

## 调用

```text
call_tool(name:"dashboard-stats get-forum-stats", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{type:["forum_pv","forum_uv"], start_date:"YYYY-MM-DD", end_date:"YYYY-MM-DD"}})
```

`developer_id` / `app_id` 是 scope 字段；`type` 与日期属于业务字段，放进 `args.data`。

- `type` 必填，是**指标维度**而不是时间粒度；可一次传多个，最多 8 个，每个 `type` 独立返回一个结果块，顺序与传入一致，重复的 `type` 只返回一次。
- `start_date` / `end_date` 可省略；同时省略时默认近 30 天（结束日期为今天，起始为今天前 29 天）。区间最长 366 天，`start_date` 不能晚于 `end_date`。
- 只读，走论坛管理权限：无权限 403，该 App 未开通论坛 404。

## type 取值

| type | 中文 | 拆分维度 |
| --- | --- | --- |
| `forum_pv` | 论坛访问量 | 固定两列：内容访问量、论坛页访问量 |
| `forum_uv` | 论坛活跃用户 | 按平台 |
| `content_pv` | 内容浏览量 | 按入口来源 |
| `forum_search` | 论坛内搜索 | 按入口来源 |
| `content_create` | 内容发布数 | 按平台 |
| `content_delete` | 删除内容数 | 按平台 |
| `content_move_label` | 移动内容数 | 按平台 |
| `comment_create` | 回复数 | 按平台 |

维度列的具体取值以每次返回的 `columns[].key` 为准（平台维度常见为「全部 / Android / iOS / Web / TapTap HD」，来源维度为中文来源名，可能随产品迭代变化），不要硬编码或猜测枚举。

## 返回结构

成功返回的 `result` 字段包含：

- `follow_total`：论坛关注总数，**当前全量**，不受查询区间和 `type` 影响。
- `content_total`：论坛内容总数，**当前全量**（未删除内容数），不受查询区间和 `type` 影响；与 `type=content_create` 的区间新增发布数不是同一口径，不可相加。
- `start_date` / `end_date`：实际查询区间（`YYYY-MM-DD`）。
- `results[]`：每个 `type` 一个块，依次含：
  - `type`：与请求的 `type` 一致。
  - `columns[]`：列定义。`key` 与 `series[].values` / `summary` 的字段名一致，`label` 为展示名（当前与 `key` 相同）；顺序为「全部」在前、其余维度随后。
  - `series[]`：按天序列，覆盖区间的每一天（区间至少一天，因此不会是空数组）。`date` 为 `YYYY-MM-DD`；`values` 只含非 0 列，缺省即 0；当天无数据时 `values` 为空对象。
  - `summary`：区间汇总，key 见 `columns[].key`，只含非 0 列。

## 口径

- `summary` 是区间内**每日值之和**，不是去重值、也不是均值。
- `forum_uv` 的 `summary` 是各天去重设备数逐日相加，即**活跃人次**，不是区间去重用户数；回答「活跃用户」时要说明用这个口径。
- 无数据只对所选区间成立，不能据此推断该论坛历史上是否有统计：
  - `columns` 为空数组（此时 `summary` 也为空）：所选区间内没有该论坛的统计记录。
  - `columns` 含「全部」但 `summary` 为空对象：所选区间内有统计记录，但该指标全为 0。
- 数据每小时更新，可取数据不早于 2026-01-01；更早日期会没有数据。

## 取数与输出

- 先确认业务问题再选 `type`；只传需要的 `type`，`type` 越多、区间越长单次查询越重。
- 回复先给口径、时间范围、汇总值，再给趋势和异常解释。
- 关注总数、内容总数是「当前全量」快照，与区间新增指标分开表述，不要相加或混用。
- 不默认输出原始 JSON、内部字段名或枚举；用户明确要求 debug/JSON/schema 时例外。
