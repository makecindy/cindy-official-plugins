# Player Feedback 查询细节

本文件只讲查询构造和结果解释。操作步骤、边界和输出规范以 [player feedback 手册](taptap-suite/references/taptap-player-feedback/MANUAL.md) 为准。

## 1. 时间范围语义

| 参数 | 行为 |
| --- | --- |
| 不传 `start_date` | 只返回**近 1 个月内更新过的**评价 |
| `start_date` 传 `0` | 不限起始时间(全量,按最后编辑时间扫描) |
| `start_date` 传 Unix 秒 | 从该时间起 |
| 不传 `end_date` 或传 `0` | 取当前时间 |
| `end_date` 传 Unix 秒 | 到该时间为止 |

时间比对的是**最后编辑时间**(`updated_time`),不是发布时间(`created_time`)。被编辑过的老评价会落在较新的时间窗里。

**切分时间窗的正确做法**:按时长递减试探。先取一个宽窗(例如近 1 年,或 `start_date=0`),若命中条数接近或超过 10000,就对半拆成两个窗分别查询,直到每个窗的条数都低于上限。不要用「多加一页」的方式越界。

## 2. 深分页上限与越界识别

`page × page_size ≤ 10000` 是硬约束。越界时接口返回:

```json
{ "list": [], "page": <请求的 page>, "page_size": <请求的 page_size>, "total": 0 }
```

即**空列表 + `total=0`**。这与「该条件下确实没有评价」的返回**一模一样**,无法靠单次响应区分。

**识别越界的三步法**:

1. 先跑一次 `page=1` 的基线查询,记下基线 `total` 和首条 `review_id`。
2. 若后续某页返回空且 `total=0`,而基线查询非空,则该次是**越界**,不是「没有评价」。
3. 报告时明确说明是翻页越界,并给出缩小时间或评分范围的建议;**不要**直接说「没有评价」。

**取全量的替代策略**(不要连续翻页越界):

- 按时长递减切分时间窗,逐窗取回;
- 或按 `score` 逐档(`"1"`…`"5"`)分别取,再合并去重;
- 两种切分都要保证每个查询的 `page × page_size ≤ 10000`。

## 3. 评分口径(务必对齐用户预期)

| 调用方写法 | 服务端实际行为 |
| --- | --- |
| `data:{score:"1"}`–`data:{score:"5"}` | 精确匹配该星级 |
| `data:{score:"positive"}` | `score >= 3`(**含 3 星**) |
| `data:{score:"negative"}` | 负向评价 |

开发者中心页面上的「好评」标签口径是 **4-5 星**,而统计聚合用的是 `score > 3`(3 星单列 neutral)。三者并不一致:

- 列表 `positive`:`>= 3`
- 控制台「好评」标签:4-5 星
- 统计聚合「好评」:`> 3`

**用户说「好评」时**:先说明这三处口径差异,再确认用户要哪一个;要 4-5 星就分别传 `data:{score:"4"}` 和 `data:{score:"5"}` 两次查询后合并。

## 4. 枚举与非法值

`score` 与 `order` 都是枚举。非法值在参数绑定阶段就失败并返回 **400 invalid_argument**,不会静默返回空列表,也不会悄悄换成默认排序。

- `order`:`update`(默认) / `hot` / `spent`
- `score`:`positive` / `negative` / `"1"` / `"2"` / `"3"` / `"4"` / `"5"`

枚举值**大小写不敏感**(`order:HOT` 也会被接受)。文档和示例统一写小写,便于和其它调用对齐。

## 5. 排序语义

| `order` | 含义 |
| --- | --- |
| `update` | 按最后编辑时间(默认) |
| `hot` | 按热度 |
| `spent` | 按游戏时长 |

排序只影响返回顺序,不影响 `total` 和筛选条件。分页时**必须固定 `order` 和全部筛选条件**,否则跨页会重复或漏条。

## 6. 响应字段

单条评价(`PlayerReviewItem`):

| 字段 | 说明 |
| --- | --- |
| `review_id` | 评价 ID |
| `score` | 星级 1-5 |
| `contents` | 评价正文 |
| `images` | 配图 URL,无配图时为空数组 |
| `device` | 设备名(展示用) |
| `played_tips` | 游戏时长展示文案,如 `2小时0分钟`;无则空字符串 |
| `created_time` | 发布时间(Unix 秒) |
| `updated_time` | 最后编辑时间;未编辑时等于 `created_time` |
| `edited` | 是否被编辑过 |
| `examined` | 开发者是否已互动处理 |
| `is_bought` | 评价者是否已购买 |
| `url` | 该评价在 TapTap 上的页面地址 |
| `author` | 作者对象,**资料不可见时为 `null`** |
| `comments` | 该评价下的前若干条回复 |
| `comment_total` | 回复总数,**可能大于 `comments` 的长度** |
| `has_official_comment` | 是否存在开发者官方回复 |

作者(`PlayerReviewAuthor`):`user_id` / `name` / `url` / `avatar`

回复(`PlayerReviewComment`):`comment_id` / `contents` / `created_time` / `is_official` / `author`(可为 `null`) / `reply_to_author`

**易错点**:

- `comments` 不是全部回复;判断「官方回复了没」用 `has_official_comment` 或 `comments[].is_official`,判断「回复了几条」用 `comment_total`。
- `author` 为 `null` 时不要回退展示 `user_id`,也不要编造昵称。
- `played_tips` / `device` 是展示文案,不要用于统计或分群结论。
- 单页条数可能少于 `page_size`:服务端已剔除被删除的评价,不是缺页。

## 7. 常见组合配方

| 目标 | `args.data` |
| --- | --- |
| 最近 20 条 | `{page:1, page_size:20}` |
| 差评 | `{score:"negative", page:1, page_size:20}` |
| 4 星与 5 星(分别查) | `{score:"4", ...}` 与 `{score:"5", ...}` |
| 未互动 | `{examined:false, page:1, page_size:20}` |
| 关键字 | `{keyword:"<词>", page:1, page_size:20}` |
| 全量第一窗 | `{start_date:0, end_date:0, page:1, page_size:100}` |
| 按热度看讨论最集中的 | `{order:"hot", page:1, page_size:50}` |

`app_id` / `dev_id` 用 scope 参数,不要重复写进 `data`。两份都写且不一致时,CLI 返回结构化 validation error,不会静默覆盖。
