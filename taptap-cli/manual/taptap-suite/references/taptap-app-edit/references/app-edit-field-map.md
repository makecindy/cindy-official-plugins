# App Edit Field Map

## 内容导航

- [核心对象](#app--developer--draft)
- [模块与字段](#module--field)
- [字段可见性](#字段可见性与按平台--类型的条件渲染)
- [按平台发行时间](#按平台发行时间与-release_schedule-不是一回事)
- [字段联动](#字段联动写入前必知违反会被拒绝)
- [TapLink 边界](#taplink-下架与替代能力)
- [包体模型](#package包体)

### App / Developer / Draft
- **App**：开发者发布的一款游戏，由 `appId` 唯一标识。一个开发者（`developerId`）可以有多个 app。
- **Draft（草稿）**：本 skill 内 "draft" 是 taptap-cli 对 tds-dc 后端 **`unpublished` 版本**的简称（`/api/app/v2/upload-app/latest-two` 返回的未发布版本，含 `form_data`）。app 的资料字段在编辑期都存放在 unpublished 版本上。提交审核后，该版本进入审核流；审核通过后才会变成正式上线版本。
- **本 skill 字段编辑只操作 unpublished 版本（draft）**，不直接改线上数据；但版本生命周期 / 历史段会涉及"对所有 Version 的查询"与"对当前 unpublished 的状态机迁移"。
- 开发者后台网页端也是改的同一份数据；本 skill 与网页版互为可替代入口。

### Version / VersionHistory
- **Version** = 由 `version` 字符串（如 `1.2.0`）标识的提审 / 发布快照。
- **VersionHistory** = 一个 app 的全量历史 Version 列表，对应开发者后台版本记录页，由本 skill 的 `list-app-versions` / `get-app-version` 工具暴露。
- `AppEditSnapshot.latestTwo`（只含最新 published + unpublished 两条用于编辑现场）正交：历史查询是**回溯**视角，lifecycle 写动作面向**当前 unpublished**，字段编辑工具读写的是当前 unpublished 上的字段。

### Module / Field
资料按 9 个 module 分组（中文标题与 taptap-cli `MODULE_TITLES` 真值对齐，也是 save-changes 确认摘要标题）。每个 module 有若干 field：

| module_id | 中文 | 主要 field |
|---|---|---|
| `basic-info` | 基础信息 | `title`(游戏名)、`description`(简介)、`icon`、`title_ios`/`description_ios`/`icon_ios`(iOS 可选覆盖)、`category`(游戏类型)、`level_game_launch_link`(关卡启动链接) |
| `assets-upload` | 素材展示 | `screenshots`、`banner_4`(横版宣传图)、`square_promo_image`(1:1 宣传图)、`trailer`、`gameplay_demo_video`、`banner_4_ios`/`square_promo_image_ios`/`screenshots_ios`(iOS 覆盖素材，留空跟随安卓) |
| `profile-promotion` | 首页推荐配置 | `promotion_material_type`(首页推荐素材)、`promotion_text`(首页推荐语) |
| `windows-exclusive` | Windows 素材 | `logo`、`cover`、`cover_vertical`、`library_hero`(游戏库背景壁纸)、`logoless_banner`、`logoless_vertical_banner` 以及 `min_*`/`rec_*` 系列硬件配置 |
| `platform-status` | 游戏类型与分发 | `app_platforms`、`itunes_id`(iOS)、`steam_id`(PC)、`region_flag_android/ios/pc`；状态 label 和可选值受游戏类型、平台与当前资料条件影响，必须使用字段返回的 `current_value` / `options`，不能硬编码 |
| `release-settings` | 发布设置 | `release_schedule`（立即 / 精确定时；优先使用）、兼容字段 `release_method` / `release_time`、按平台发行时间组（`expected_launch_time_exact_*`/`expected_launch_time_vague_*`/`platform_open_time_*`/`can_pre_download_play_pc`，见下文「按平台发行时间」） |
| `package` | 游戏包体 | `package`（选择/切换主包体，结构化字段，详见"包体切换"流程）、APK 包体配置：`apk_anti_addiction_status`、`apk_sandbox_authorized`、`apk_whatsnew`、`apk_update_mode`、`apk_force_update_in_app`、`apk_related_in_app_event` |
| `developer-info` | 开发者信息 | `developer_type`(厂商类型)、`author_name`、`publisher_name`、`developer_message` |
| `other-settings` | 其他设置 | `download_site`(官网)、`chatting_*`(社群信息)、`is_proxy_required`(需网络工具)、`is_google_play_required`、`supported_vr`、`android_version`(Android 系统版本)、`pc_game_anti_addiction_status`(PC 防沉迷)、`pc_whatsnew`(旧默认 Windows 包体更新日志)、`pc_game_package_whatsnew`(Windows 游戏本体包更新日志)、`pc_launcher_package_whatsnew`(Windows 启动器包更新日志) |

**重点**：游戏名 field_id 是 `title`，不是 `name`。简介 field_id 是 `description`。

### 字段可见性与按平台 / 类型的条件渲染
很多字段只在特定平台 / 游戏类型 / 包体状态下可见，受 `visibleWhen` 控制。`get-app-module` 返回的 fields 已按当前可见性投影——**永远以工具返回为准**，但你要能用下列规则向用户解释「为什么这一项不用填」：

- **平台维度**：平台和游戏类型只用于解释工具已经返回的字段，不能用于自行推导字段集合。每次读取 `platform-status`、`release-settings` 和目标模块，以字段实际 `visible`、`current_value`、`options`、`value_labels` 为准；`steam_id`、`itunes_id`、Windows 素材、Android 兼容性和 iOS 覆盖素材是否出现都以本次返回为准。
- **发布与分发状态**：版本发布后，工具当前返回的 `region_flag_*` 会保持现有设置。不要根据游戏类型、包体方向或发布方式预设入口集合和状态枚举；在 `platform-status` 中只筛选实际可见的 `region_flag_*`，按各字段的 `current_value` / `options` / `value_labels` 逐项确认。`app_platforms`、`itunes_id`、`steam_id` 不是分发状态入口。任一可见分发状态入口当前为“敬请期待”时，如需开放下载或游玩，要单独调整对应的分发状态。
- **游戏类型维度**：关卡游戏（TapTap 制造）的简介 / 素材降级为建议；`level_game_launch_link` 仅应用拉起型关卡可见且必填。TapMaker / urhox 引擎游戏豁免 Windows 包体与 PC 系统配置，但选择 PC 平台后仍展示 Windows 图片素材，其中竖版游戏封面图 `cover_vertical` 必填，其余 Windows 图片素材非必填；且不渲染首发时间——遇到这类游戏不要追问用户为什么不填这些豁免项。
  - 「关卡游戏」与「TapMaker / urhox」可能同时成立并驱动不同豁免——不要自己给游戏归类，以各模块当次返回的字段 `visible` / `required` 为准。
- **包体状态维度**：PC 防沉迷状态 / PC 更新日志仅在已选 PC（EXE）包体时可见；白名单分支包体模型下使用 `pc_game_package_whatsnew` / `pc_launcher_package_whatsnew` 分别填写游戏本体包 / 启动器包更新日志，不要用旧默认包字段 `pc_whatsnew` 代替；根级上线方式优先读写 `release_schedule`，旧 `release_time` 仅 `release_method=1`（定时上线）时可见。

Windows 素材中，当前资料模块主流程的游戏库背景壁纸字段是 `library_hero`。`library_banner` 是旧版兼容字段，不要主动写入；如果在后端审核、历史版本或 legacy 说明里看到它，按旧版游戏库背景壁纸理解，并优先引导使用 `library_hero`。

### 按平台发行时间（与 release_schedule 不是一回事）
`release_schedule` 控制**整个版本的上线时机**，只支持立即或精确定时；而「按平台发行时间」组是**各平台在商店展示的市场档期信息**，安卓和 PC 各一套，落在 `info.*`，其中 `expected_launch_time_vague_*` 仍可表达平台展示用的模糊档期：

- 工具可能返回安卓 / PC 独立 field_id（`_android` / `_pc` 后缀）；是否可见始终以最新 `release-settings` 字段结果为准。对已返回字段可按各自平台的**发售状态**解释：
  - 发售状态=预约 → `expected_launch_time_exact_*`（精确时间，unix 秒）/ `expected_launch_time_vague_*`（模糊档期，如「2025年Q1」）。同平台二者**互斥，只能存在一个**：不要同批两条都传（会被拒绝）；要从精确切到模糊，须在同一次调用里把精确传 `value: null` 清空、同时设模糊（反之亦然）。
  - 发售状态=下载 / 试玩 → `platform_open_time_*`（首发上线时间，unix 秒）；PC 额外有 `can_pre_download_play_pc`（预下载开关，值 `true`/`false`）。
  - TapMaker（urhox 引擎）游戏在下载 / 试玩态不展示首发时间与预下载。
- `can_pre_download_play_pc=true` 前必须先有 `platform_open_time_pc`，否则工具拒绝（「PC 预下载需先设置 PC 首发上线时间」）。
- 时间字段传 unix 秒；用户给相对时间（如「下周五」）时使用本地系统时间（Asia/Shanghai）换算，无法可靠取得当前时分秒时要求用户给绝对时间；向用户复述时转成可读日期，不要回报裸时间戳。

### 字段联动（写入前必知，违反会被拒绝）
除上文「按平台发行时间」的联动外，写入前还要知道这几组跨字段约束（违反时工具返回业务化中文 error，按文案引导用户取舍即可）：

- **社群三件套** `chatting_label` / `chatting_number` / `chatting_link`：即商店页「玩家交流群 / 社群信息」（群名 / 群号 / 群链接），**由本 skill 直接编辑写入**——用户在资料编辑语境说「玩家交流群 / 社群 / 交流群」就是改这三项，直接走字段写入、不要引导到别处手动配置。约束为 **allOrNone**——要么三个全填、要么全空。只填其中一两个会被拒绝（「玩家交流群信息需完整填写（群名、群号、群链接），或全部留空」）。用户只给群名时，要追问群号和链接，或提示三者需一起填。
- **同平台预约时间** `expected_launch_time_exact_*` 与 `expected_launch_time_vague_*`：互斥（见上）。
- **PC 预下载** `can_pre_download_play_pc` 依赖 `platform_open_time_pc`（见上）。
- **包体**：主包体 apk / mini_app / spark / h5 四选一互斥（见 Package 段）；Windows 包体是独立 `windows` 槽位，可能带分支。spark 专属约束见 Package 段。APK 包体配置中，未接入防沉迷时必须授权 TapPlay；`apk_force_update_in_app` 仅在 `apk_update_mode=force` 时可见；`apk_related_in_app_event` 仅在当前 APK 存在可关联新版本或已有活动关联值时可见。
- **关卡启动链接** `level_game_launch_link`：需全局唯一，重复会在写入时被拒（「该链接已存在对应游戏」），可提前提醒用户换一个。

### 不可直接写入的历史字段

- `age_grade`：转游戏资质页面人工处理。
- `apk_package_name`：来自 APK 固有元数据；需要变更时重新构建并上传 APK，再绑定新包体。
- `mini_game_play_enabled`：由 `apk_mini_game_play` 槽位派生，只能通过 `select-package` / `clear-package` 改变。
- `apk_supported_languages`：当前不可编辑，默认支持简体中文 `zh_CN`，不作为缺失项。

`category` 是资料页可编辑的游戏类型；C 端商店标签不是 App Edit 字段，当前 CLI 不支持修改，需人工处理。用户说“改标签”时先确认其指的是游戏类型还是商店标签。

### Android 主资料与 iOS 覆盖值

`title_ios`、`description_ios`、`icon_ios` 是 Android 主资料的可选 iOS 覆盖。iOS 严格存储值为空时表示继承 Android；清空 `_ios` 字段会恢复继承。

- 写 `_ios` 字段时，`expected` 使用该字段的严格 `current_value`，不能使用继承后页面展示的 `platform_value.resolved_value`。
- 字段返回 `expected_digest` 时，改传 `changes[].expected_digest`，不要同时复述完整旧值。
- 除显式 `force=true` 外，每条 change 必须携带 `expected` 或 `expected_digest`。

### TapLink 下架与替代能力
用户在资料编辑 / 基础信息语境里问 TapLink、Taplink、tap link、启动链接、跳转链接、现在还有没有 TapLink、是不是去掉了时，不能按 `basic-info`、`level_game_launch_link` 或当前字段可见性来解释，也不要说“这个游戏当前没有可用的链接类配置项”。TapLink 不是当前资料编辑字段。

正确口径：
- 用户问“现在还有吗 / 还能用吗 / 是不是没了”时，不要以“有”开头，也不要说“有，但已下架”。推荐开头是：“当前不能新开或配置 TapLink；只有历史存量活动可能还保留 TapLink 字段。”
- TapLink 已在新版开发者后台下架，当前开发者后台不再提供新增、编辑、开通或 Schema 配置入口。
- 历史签到活动里的 TapLink 字段只做存量兼容；当前应用资料里看不到 TapLink 字段是正常的。
- 如果用户目标是礼包领取 / 游戏内发奖 / 从 TapTap 领取后进游戏完成发放，推荐改用「直达礼包」作为替代能力。
- 有当前 app scope 时，告诉用户入口是「游戏服务 / 直达礼包」（路由：`/:developerId/app/:appId/service/code-direct-delivery`）。不要硬编码域名；前端会基于运行时配置生成页面地址。
- 直达礼包是否可用受 TapTap 登录、游戏角色查询、权限、白名单和开放状态影响；若入口不可见，只说明可能未开放或无权限，不要编造其它配置路径。

> **动态必填提示**：部分字段的必填会随状态变化，例如上传竖版实机录屏后 `square_promo_image`（1:1 宣传图）可能变必填、非关卡移动端在下载/试玩态可能要求 `gameplay_demo_video`（实机录屏）、urhox 引擎上 PC 时可能只有 `cover_vertical`（竖版游戏封面图）保留必填。判定一律以各模块当次返回的 `visible` / `required` 为准；这些规律只用于解释，不用于补造 blocker。

### 素材池
应用粒度的素材池，存放历史上传 / AI 生成的图片。本 skill 内只关心：素材池里挑出的图，最终通过 `save-changes` 写入字段才算落地到 draft。

### Package（包体）
包体不是普通字段。资料页绑定统一调用 `select-package`，完整 input 必须包含 `slot`、同次读取的 `expected`，以及从 `list-packages` 候选原样取得的 `package.type` / `package.id`：

- Android APK：`{"slot":"main","package":{"type":"apk","id":"<apk-id>"},"expected":<current-main>}`
- Tap 小游戏主包体：`{"slot":"main","package":{"type":"mini_app","id":"<mini-app-package-id>"},"expected":<current-main>}`
- TapTap 制造 / Spark：`{"slot":"main","package":{"type":"spark","id":"<spark-version-code>"},"expected":<current-main>}`。`<spark-version-code>` 取同次 `list-packages(["spark"])` 中 `status=ready` 候选的 `package_id`，并由 `+bind-spark-version` 在写前重查。
- H5：`{"slot":"main","package":{"type":"h5","id":"<h5-version-id>"},"expected":<current-main>}`
- Windows：`{"slot":"windows","package":{"type":"windows","id":"<package-id>","branch":<optional-branch>},"expected":<current-windows>}`

主包体的 APK、Tap 小游戏、Spark 和 H5 四选一；写入任一主包体会清空其它主包体判别字段。当前 schema 声明 `package_slots` 时，APK、Tap 小游戏、Spark、H5 和 Windows 可按该契约执行；未声明时停止绑定（契约见 [fields and packages](taptap-suite/references/taptap-app-edit/references/app-edit-fields-and-packages.md)）。Spark 额外要求同次 ready 候选、稳定 idempotency key 和写后读回。`package` 中不要使用旧的 `kind`、`apkId`、`miniAppPackageId`、`spark_version_code`、`h5VersionId` 或 `h5Package` 字段。APK 的「提供 Tap 小游戏游玩方式」使用独立 `slot:"apk_mini_game_play"`，不能混入 `slot:"main"` 的 package。

Windows 包体候选可通过 `list-packages` 的 `list` 读取，类型值为 `windows`，候选项可包含 `branch`。当前 schema 声明 `package_slots.windows` 时，写入前原样回传其中的 `expected`；字段未声明时按包体槽位契约停止。不要把候选 `package_id` 当作槽位当前值，也不要自行补 branch。

Windows 分支包体语义：`branch=1` 是游戏本体包，`branch=2` 是启动器包，`branch=0` 是默认 Windows 包。用户同时要求设置“启动器包”和“游戏本体包”时，按各自分支分别挑选最新可用包并分别写入；不要因为当前值暂时为 `{ kind: "none" }`，就判断只能设置一个 Windows 包体槽位。

**包体槽位写入用 metadata operation `select-package` / `clear-package`，不能用 `save-changes`。APK 包体内部配置仍用 `save-changes`。**

APK 包体内部配置是普通字段，使用 `save-changes`，不是 `select-package`：
- `apk_anti_addiction_status`：`integrated`（已接入防沉迷）/ `not-integrated`（未接入防沉迷，使用 TapPlay）。写 `not-integrated` 时工具会同步设置 `apk_sandbox_authorized=true`。
- `apk_sandbox_authorized`：`true` / `false`，表示授权并同时提供 TapPlay 模式供玩家选择；未接入防沉迷时必须为 `true`。
- `apk_whatsnew`：APK 更新日志，最多 5000 字。
- `apk_update_mode`：`normal`（普通更新）/ `force`（强制更新）。TapTap 内强更由 `force` 表达。
- `apk_force_update_in_app`：`true` / `false`，仅 `apk_update_mode=force` 时可见，表示游戏内强制更新；这是布尔开关，APK 包体下缺省按 `false` 处理，不要把隐藏态理解成 `null`。
- `apk_related_in_app_event`：APK 活动关联。值必须使用 `get-app-module("package")` 返回的 options；`0` 表示“不关联”，不要用 `null` / `undefined` 表达不关联。

⚠️ **spark 专属约束**：当 `list-packages` 或 package 模块返回 `sparkOnlyPackageSelection=true`（urhox 引擎 / spark 分发关卡）时，该应用主包体只能从包体库挑 TapTap 制造（spark）包——不要引导用户传 / 切换 apk / h5 包，写非 spark 主包体会被工具拒绝。以本次读取结果为准。

查包体管理页、APK 当前线上主包、云玩/TapPlay/模拟器使用主包还是分支包，走 `taptap-package-management`；不要用本 skill 的包体选择工具代替包体管理诊断。
