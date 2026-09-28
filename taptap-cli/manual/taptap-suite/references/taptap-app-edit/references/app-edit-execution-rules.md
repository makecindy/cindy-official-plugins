# app-edit 执行规则（细则）

> 从 MANUAL.md 拆出，MANUAL 只做路由。字段与包体契约见
> [fields and packages](taptap-suite/references/taptap-app-edit/references/app-edit-fields-and-packages.md) / [field map](taptap-suite/references/taptap-app-edit/references/app-edit-field-map.md)，
> 提审三步见 [audit and history](taptap-suite/references/taptap-app-edit/references/app-edit-audit-and-history.md)。

## 1. 前置与路由

- 缺 `developerId` / `appId` 时转 identity 手册。不知道字段所属模块时先读 field map（[field map](taptap-suite/references/taptap-app-edit/references/app-edit-field-map.md)），再查模块详情。
- 需要引导用户打开资料编辑页时，只使用 `https://<current-server-host>/v3/<developerId>/app/<appId>/store/update`；地址推导规则按 [shared execution](taptap-suite/references/shared-execution.md)「人工页面交接和链接输出」执行，不要自行拼接 `/store`，也不要把 Maker 或包体管理页当成资料编辑入口。

## 2. 字段写入

- 普通字段每批不超过 10 个 change。
- 每条 change 先读取最新并发快照：除显式 `force=true` 外必须携带 `expected`，取值是该字段读取时的严格 `current_value` 原样回填；`current_value` 为 `null`（首次写入）时传 `[]`。
- `current_value` 为 `null`（首次写入）时，`expected` 传 `[]`；其余情况（string / 数组 / 数字 / 布尔）原样回填该字段读取时的严格 `current_value`。stale 时停止并重新读取；旧截图、旧对话、历史 `form_data` 和 iOS 的继承后 `platform_value.resolved_value` 都不能作为并发快照。严格取值细节见 [fields and packages](taptap-suite/references/taptap-app-edit/references/app-edit-fields-and-packages.md)「文字字段」。
- `title_ios`、`description_ios`、`icon_ios`、`banner_4_ios`、`square_promo_image_ios`、`screenshots_ios` 是可选 iOS 覆盖字段；空值表示继承 Android 主字段。清空 `_ios` 字段会恢复继承，写入时的 `expected` 必须使用该 `_ios` 字段自己的严格存储值，不能使用页面最终展示的继承值。继承、清空与 `expected` 口径见 [field map](taptap-suite/references/taptap-app-edit/references/app-edit-field-map.md)。
- `age_grade`、`apk_package_name`、`mini_game_play_enabled` 不能通过普通字段保存：适龄分级转资质人工流程；APK 包名需重建并上传 APK 后重新绑定；小游戏游玩方式用 `apk_mini_game_play` 槽位选择或清空。替代路径见 [field map](taptap-suite/references/taptap-app-edit/references/app-edit-field-map.md)。
- `category` 是资料中的游戏类型，可修改；C 端商店标签不是资料字段，当前 CLI 不支持修改，需人工处理。用户说「改标签」时先确认他指的是游戏类型还是商店标签。

## 3. 图片与视频

- 图片和视频能否使用，以字段当次返回的 `image_spec` / `video_spec` 为准；`trailer` 与 `gameplay_demo_video` 最终不能使用同一个 `videoId`，重复时停止并让用户换一个视频；素材库检索与收录转 materials 手册（[taptap-materials](taptap-suite/references/taptap-materials/MANUAL.md)）。
- 不同 `videoId` 只证明字段引用不同对象，不证明内容不同或已符合审核规范 2.6.10；需要内容判断时标记人工复核。不得把历史审核中的"高度雷同"表述成官方文档规则。
- 上传成功后先按 [skill analysis](taptap-suite/references/taptap-app-edit/references/app-edit-analysis.md) 完成字段回填并重新读取；**上传成功 ≠ 已绑定 ≠ 可提交审核**。

## 4. 包体

所有包体统一分两条独立执行路径，返回的候选或可见性冲突时停止写入并报告 scope / 权限问题：

| 路径 | 做什么 | 不做什么 |
| --- | --- | --- |
| **包体管理与自测** | `get-available-package-types` 取可用类型 → 对应 `list-*` 查包体库与线上/待处理状态；返回 `self_test_targets` 时可继续调 `package-management get-test-qr-code`（靶标 `package_id` 或 `version_code`）。流程见 [taptap-package-management](taptap-suite/references/taptap-package-management/MANUAL.md) | 只读；不提供资料页 `expected`，不执行主包体绑定 |
| **资料页槽位绑定** | 调用 `app list-packages` → 按 [fields and packages](taptap-suite/references/taptap-app-edit/references/app-edit-fields-and-packages.md)「包体槽位」五步契约执行（同次 `status=ready` 候选、目标 `available=true`、原样 `expected`、稳定 key dry-run → `yes:true`、写后读回；stale/409 停止重读，禁止自动重放） | — |

- 当前 schema 未声明 `package_slots` 时必须停止资料页包体绑定并报告契约缺口，不得从 `current_bindings`、候选或历史响应补造 `available` / `expected`；`current_bindings` 只用于展示，不能作为写入前置条件。
- Spark 使用专用 `call_tool(name:"app +bind-spark-version", …)` 编排相同门禁：dry-run 离线校验精确 `selectPackage` 输入并生成 apply 参数；`yes:true` 会重新读取实时 Spark 候选和主槽位，只有候选 `status=ready`、`available=true` 且传入 expected 与实时值严格一致时才写入，成功后必须读回目标 `spark_version_code`。契约见 [fields and packages](taptap-suite/references/taptap-app-edit/references/app-edit-fields-and-packages.md)「包体槽位」。
- TapTap 制造 / Spark 包体必须先在 TapTap 制造创建或更新（官方入口为 `https://maker.taptap.cn/`，面向用户时按共享规范单独一行输出）。CLI 不上传、不更新 Spark 包，只能把已存在且 ready 的版本绑到资料页主槽位。
- 包体上传成功后必须重新读取候选和槽位，用户确认后才能绑定，不能把「上传成功」解释成「已绑定」或「可以提交审核」。

## 5. 资质（编辑资料时收集判断事实）

- 不论主包体是 APK / Windows / H5 / 小游戏，编辑资料时都要先确认「资质判断事实」：是否联网（离线单机 → `is_internet_required=false`）、是否有内购（无内购 → `has_in_app_purchase=false`）、是否含 AI 生成内容、是否涉及 IP 授权、是否有文字剧情。
- 未成年人防沉迷**仅 APK / Windows 主包体需要询问**：
  - APK → `apk_anti_addiction_status`；未接入时询问是否授权 TapPlay，确认后再写 `apk_sandbox_authorized=true`，不得默认；
  - Windows → `pc_game_anti_addiction_status`；
  - H5 / 小游戏 → 走 TapPlay 免安装上架、防沉迷平台兜底，无需询问。
- 这些事实通过 `save-qualification-draft` 的 `app_features`（转 qualification 手册，[taptap-qualification](taptap-suite/references/taptap-qualification/MANUAL.md)）填写，决定"哪些资质必须"；不确定时逐项询问，不默认 false、不跳过，也不留到提审前才问。
- 提审前按正式发布口径检查资质：缺口以 `analyze-app-status` 的 `QUALIFICATION_INCOMPLETE` 为准（按游戏事实算出的必须资质，不是把 8 类客观状态全列一遍）；认证与豁免以 qualification 手册的当前分析为准；不得自行放宽或收紧。

## 6. 提审

**意图门禁**：泛化准备请求和"正式上线"目标只能触发准备状态检查或提审选项提示；只有用户明确表达"提交审核 / 提审"后才可调 `app prepare-review-snapshot`，预审结果后仍须再次确认才可调 `app submit-app-review`。

**三步**：`prepare-review-snapshot` → `precheck-app-review` → `submit-app-review --yes`

- `release_schedule` 只在第 2、3 步传递且**必须完全相同**（第 1 步不接受）。上线方式只支持立即上线或精确定时；模糊季度/档期必须追问具体时间或改为立即上线。
- 任一步 `version_id` 与第一步不一致 → 复核对象已漂移，回到第一步重读，禁止沿用旧快照。
- metadata：前两步是 `read`（无需 `--yes`），`submit-app-review` 是 `write`（需 `--yes` + 稳定幂等键）。`--dry-run` 只预览请求，不执行预检。
- 执行 submit 前必须用**本次** precheck 的结果完成正式预审；不能依赖旧截图、旧结果或"上传成功"推断已满足。
- 普通游戏提审前同时检查上架资质和开发者认证；未认证时按服务端 blocker 停止提审并引导办理。关卡游戏是否豁免、以及认证豁免范围，一律以服务端当次返回为准，不自行判断。

**预检口径**：

- 成功 → 面向用户固定展示"阻塞项：无"和"提交状态：可提交审核"；不成功 → 逐项展示卡点并询问是否「强制提交」（预检可跳过）。
- `preaudit_passed` 仅用于内部判断，不得原样输出 `Blocker`、`preaudit_passed=true` 等机器字段。
- 服务端 blocker 未清零时向用户展示（提交会被服务端拒绝）；用户明确「强制提交」时允许 submit，由服务端裁决。
- 资质缺口（`QUALIFICATION_INCOMPLETE`）是 warning、submit 不卡控 → 展示"继续提审可能被驳回"并询问是否继续。
- 复核返回风险数据不可用且要求确认时展示 warning；`--yes` 不代表已核对。schema 未声明风险确认输入时停止并报告契约缺口，不补造本地 flag。

## 7. SCE 协议

关卡 / TapTap 制造游戏会在 `analyze-app-status` 报 `SCE_AGREEMENT_REQUIRED`（未签《创意工坊内容授权协议》）。**体检阶段就引导签约**，不要等 submit：

1. 展示协议名称与 url（`https://www.taptap.cn/doc/ugcgame-agreement`）；
2. 用户在当前对话**明确同意**后调 `call_tool(name:"app agree-sce-agreement", args:{app_id:"<appId>", developer_id:"<developerId>", yes:true})`；
3. 重查 `analyze-app-status` 确认 blocker 消失。

`--yes` 不代表协议同意；不得自行声称已同意，也不得补造其它字段或 flag。用户不愿用 CLI 签时给 url 引导去后台签，签完回来重查。

## 8. 发布与生命周期

- 发布前读取 `platform-status`，逐项说明可见 `region_flag_*` 的真实状态；统一话术：**"发布版本不会自动改变分发入口状态。当前仍是'敬请期待'的入口，发布后也会保持'敬请期待'；如需开放下载或游玩，请在提审前先调整对应分发状态，随本次版本一起审核生效。"**
- 生命周期动作先用 `list-app-versions` / `get-app-version` 读取当前状态；业务事件以 `get-app-version` 的 `last_event`（或 `logs[].event`）为准：`schedule_cancelled` 不是审核驳回。
- 定时版本通常由平台自动发布；若 `status="scheduled"` 且 `release_time <= 当前时间` 仍未上线，可在展示影响并取得明确确认后调 `app publish-scheduled-release`，成功后重读版本与分发状态。人工确认后状态漂移必须重新读取。
- `submit-app-review` / `publish-scheduled-release` 或其它发布动作成功并读回状态后，按共享"运营阶段手册交接"输出一个阶段匹配的官方手册：预约/首曝要求可见分发状态文案明确包含"预约"；首次上线要求完整历史无 `online` / `offline` / `published` 证据；已有任一发布历史的再次提审、版本更新或上线后运营用长线运营手册；状态冲突或历史不完整时只给快速入门总入口。识别正本见 [operation handbooks](taptap-suite/references/operation-handbooks.md)。
- `status` 表示审核中或等待定时上线时，用户动作默认是等待并按 `release_time` / 审核结果检查，不要让用户重复上传、重复创建或重复提交。

## 9. 输出与后续检查

- **以证据为准**：此前建议的上传/回填/补充动作，若没有成功结果和当前状态证据，仍列为未完成。
- 创建成功后、资料或素材写后读回后、正式提审前，主动提示用户按规范完善素材：游戏图标、简介、开发者的话、游戏截图、宣传图、实机视频及当前页面可见且适用的首页推荐素材选项。系统默认图标仅用于完成游戏创建，不代表已通过素材审核；如未替换为符合要求的正式图标，可能导致素材审核不通过并影响首页或编辑推荐展示。是否构成提审 blocker 必须按当前字段 `required`、服务端预检结果或适用的官方物料要求判断，不得把整张清单无条件标为必填。
- 素材缺口逐项列（图标、简介、开发者的话、游戏截图、宣传图、实机视频、首页推荐），本地候选按场景逐项列实际绝对路径；宿主能返回图片时逐张展示并保留路径，不能返回时明确说明并逐行输出路径。
- 本次读取确实缺图片素材时，先问是否有可用的本地素材或真实游戏截图；确认没有后再问是否为图标、宣传图或 Windows 素材生成本地候选，并转 materials 手册。**不得为缺失的游戏截图生成虚构画面，必须要求用户提供真实游戏截图。**
- 资料/版本审核通过 ≠ 素材审核通过 ≠ 具备首页推荐资格。非必填项只说明官方文档明确的展示/分发条件，或当前状态能直接证明的影响；首页编辑推荐图缺失时只说明官方要求的专属栏目展示限制，**不得**断言会导致只能搜索/分享访问、降流或确定流量处罚。
- 官方规则只引用 [游戏物料要求](taptap-suite/references/material-requirements.md) 列出的 TapTap 官方文档及对应章节；字段必填性、当前缺口和服务端阻断以本次 `get-app-module` / `prepare-review-snapshot` / `precheck-app-review` 的真实返回为准。
- 面向用户报告旧值/新值、保存结果、版本状态、风险和下一步；不默认输出完整 raw JSON 或 schema。
