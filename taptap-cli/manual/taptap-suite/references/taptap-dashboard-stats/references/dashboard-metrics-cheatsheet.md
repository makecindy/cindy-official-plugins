# Dashboard Metrics Cheatsheet

输入 `metric` 必须从下表取值。`platform` / `position` / `review_type` 仅对部分 metric 生效,其余 metric 不要传。

### 商店 Tab

| metric | 中文 | 适用 filter | 含义 / 单位 |
|---|---|---|---|
| `pv` | 浏览量 | — | 商店详情页 PV |
| `download` | 下载请求量 | platform | 安装包下载请求次数 |
| `reserve` | 预约量 | platform | 上架前预约人数 |
| `rank` | 排行数据 | — | Android / iOS 商店排行榜位次(`androidRank` / `iosRank`,**数值越小排名越靠前**) |
| `position` | 转化效果数据 | platform、position | 各展示位的曝光/点击/转化;不传 position 返回整体拆分,查询单个推荐位前先用 `get-dashboard-position-options` 取得合法 value |
| `advertisement` | 投放数据 | — | 投放渠道带来的下载/曝光 |
| `rep_effect` | REP 下载/预约量 | — | TapTap REP 推荐位带来的下载/预约 |
| `rep_revenue` | REP 收益 | — | REP 收益金额(单位以上游为准,未在 proto 中明示;如实展示数值并提示用户核对单位,不要擅自做 ÷100 等换算) |

### 游戏 Tab

| metric | 中文 | 适用 filter | 含义 / 单位 |
|---|---|---|---|
| `launcher_button` | 启动按钮转化 | — | 启动按钮**分形态**完成率(apk / tap_play / cloud_gaming / mini_app 四种 rate);不要把单一字段冒充"整体转化率" |
| `tapplay_download` | 免安装 下载请求量 | — | 免安装包请求次数 |
| `tapplay_install` | 免安装 安装量 | — | 免安装实际安装数 |
| `tapplay_conversion` | 免安装 转化效果 | — | 免安装请求 → 安装 → 启动转化 |
| `cloud_request` | 云玩请求量 | — | 云玩启动请求 |
| `cloud_start` | 云玩启动量 | — | 云玩实际启动 |
| `cloud_conversion` | 云玩转化效果 | — | APK 安装完成率(`apk_install_rate`)+ 云玩启动率(`cloud_gaming_start_rate`)两项 rate |
| `cloud_duration` | 云玩平均时长 | — | 单次会话平均时长(秒) |
| `mini_device` | 小游戏用户量 | — | 小游戏唯一设备数 |
| `mini_ret` | 小游戏留存 | — | 次日 / 三日 / 七日留存率 |
| `mini_conversion` | 小游戏转化效果 | — | 进入 → 留下来玩转化 |
| `mini_duration` | 小游戏平均时长 | — | 单次会话平均时长(秒) |

### 销售 Tab

| metric | 中文 | 适用 filter | 含义 / 单位 |
|---|---|---|---|
| `order` | 销售订单数据 | platform | 订单笔数 |
| `order_fee` | 销售金额数据 | platform | 订单总金额(单位以上游为准,未在 proto 中明示;如实展示数值并提示用户核对单位,不要擅自做 ÷100 等换算) |
| `product_order` | 商品订单明细 | platform | 按商品维度的订单笔数 |
| `product_order_fee` | 商品订单金额明细 | platform | 按商品维度的金额(单位以上游为准,未在 proto 中明示;如实展示数值并提示用户核对单位,不要擅自做 ÷100 等换算) |

### 评价 Tab

| metric | 中文 | 适用 filter | 含义 / 单位 |
|---|---|---|---|
| `review` | 每日评价 | review_type(见下方速查) | 每日新增评价数 / 评分 |

#### `review_type` 速查(仅 `review` metric 生效)

对应前端「评价类型」下拉,6 类评价分类,**不是**时间窗口切换:

| 值 | 名称 | 说明 |
|---|---|---|
| 1 | 计分评价(SCORE_REVIEW) | 查询计分评价时显式传入 |
| 2 | 封闭式测试评价(CLOSE_TEST_REVIEW) | 封测期间收集的评价 |
| 3 | 折叠评价(COLLAPSED_REVIEW) | 被系统折叠的评价 |
| 4 | 游戏临时故障评价(ACCIDENT_REVIEW) | 故障期间产生的评价 |
| 5 | 非正式版评价(NONE_RELEASE_REVIEW) | 非正式版本的评价 |
| 6 | 游戏运营事故评价(OPERATION_ACCIDENT_REVIEW) | 运营事故相关评价 |

**协议补充**:当前 Capability catalog 没有为 `review_type` 声明默认值,动态 CLI
也不会自动补值。查询 `review` 时先确认评价类型,并显式传入 `review_type`;不要
假设省略后等价于 `1`。

### 社区 Tab

| metric | 中文 | 适用 filter | 含义 / 单位 |
|---|---|---|---|
| `topic` | 帖子数据 | — | 论坛新增帖子 |
| `friendship` | 关注数据 | — | 关注 / 取关 / 无效关注 / 无效取关 4 列(`friendship` / `canceled_friendship` / `invalid_friendship` / `invalid_canceled_friendship`) |
| `favorite` | 收藏数据 | — | 收藏 app 的用户数 |

### 返回结构与版本过滤

- 常规指标返回 `list`、`overview`、`total`、`key_map`、`in_error`。`total` 是与单日 item 同形的汇总对象,不是 number;合计优先读 `overview.list[].label/value`,趋势字段先用 `key_map` 翻译。
- schema 中的 `version` 过滤当前未实装,传入会被忽略。用户指定版本时必须说明查询结果仍是 app 全量数据。
- 不要猜 `position` 值;只有用户指定单个展示位或上一步 options 返回明确 key 时才传。只看整体展示位拆分可省略 `position`。
