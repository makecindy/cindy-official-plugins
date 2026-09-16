# TapTap CLI 插件:新游戏创建与资料维护(app-edit)

本手册合并两个业务域:**新游戏创建**(创建草稿、收集厂商/名称/类型/包体方向)与**资料维护**(字段修改、素材规格、包体槽位、审核提交/撤审/发布/定时、草稿重置、版本历史)。命令行示例按 taptap-suite 手册的映射表转成 call_tool 调用。

## 第一部分:新游戏创建

只负责"创建新游戏草稿"。创建成功后的资料字段、包体绑定、提审、测试计划走本手册第二部分或对应手册。

**CRITICAL — 创建必须 plan-first。厂商角色(developer / author / publisher)、游戏名、游戏类型、包体方向和 developerId 都要有明确来源;缺字段先补齐,用户未明确确认前只能预览。**

**CRITICAL — 创建流程不得因为缺少图片或视频而自动生成 AI 素材。创建成功并列出缺失物料和动态规格后,先询问用户是否有可用的本地素材或真实游戏截图;用户确认没有本地素材后,再询问是否需要为图标、宣传图或 Windows 素材生成本地候选图。只有用户明确同意 AI 生成时,才能转 materials 手册处理允许生图的场景;不得生成虚构游戏截图或实机录屏。**

**CRITICAL — 创建后的素材 handoff 必须逐项结构化输出。图标、简介、开发者的话、截图、宣传图、视频和首页推荐分别列出状态;本地候选每个文件单独输出实际绝对路径。宿主能返回图片时逐张展示并保留路径,不能返回图片时明确说明并逐行输出路径。**

**CRITICAL — 每轮只确认一个字段。按宿主能力使用选择组件;禁止从名称、题材词、版本词或"极速"等字样猜游戏类型、H5 或其他包体方向。**

**CRITICAL — `publishMode=quick|regular` 只在工具内部使用,不能面向用户展示。创建后必须读取真实 `platform-status` 和包体能力;不得把不可用方式列成选项或附带"不支持"说明。`TOOL_NOT_IN_SCOPE` 表示当前 CLI 服务执行范围未开放创建工具,必须立即停止并报告当前不可用;不得提供、猜测或打开网页入口,不得改用浏览器自动化,也不得声称可以通过其他入口代为创建。**

**首轮素材说明 — 用户首次询问新游戏创建流程或所需资料时,在当前唯一确认问题之外主动说明后续素材类别,并直接提供 TapTap 官方素材规范;官方入口为 `https://developer.taptap.cn/docs/store/release/publish/material/`,面向用户时按共享规范单独一行输出。**

**创建后素材提醒 — 创建成功拿到 `appId` 后,必须在同一轮 handoff 主动提示用户按规范完善游戏图标、简介、开发者的话、游戏截图、宣传图、实机视频及当前页面可见且适用的首页推荐素材选项。系统默认图标仅用于完成游戏创建,不代表已通过素材审核。是否构成提审 blocker 必须按当前字段 `required`、服务端预检结果或适用的官方物料要求判断,不得把整张清单无条件标为必填。**

### 创建快速决策

| 用户意图 / 缺失字段 | 处理 |
| --- | --- |
| 缺 `developerId` | 转 identity 手册查厂商候选 |
| 缺游戏名 | 确认正式名称;若像玩法/版本描述,本轮只澄清该字段 |
| 缺游戏类型 | 先问玩法,再给不超过 3 个候选和依据 |
| 缺包体方向 | 始终在 APK / Tap 小游戏 / PC / H5 四项中确认,不因"休闲小游戏"等描述删减选项,也不从名称推断 |
| "先看看 / 能不能创建" | 只检查字段并输出预览 |
| 用户明确确认创建 | 用预览时相同的 `data` 调 `app create-app`(idempotency_key + yes:true) |
| 已有 appId,想补资料、素材或包体 | 走本手册第二部分 |
| 查包体库、自测二维码或包状态 | 转 packages 手册 |

### 创建执行规则

- 按"游戏名称 → 游戏类型 → 包体方向"逐项收集;完整字段判断读 `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-app-edit/references/publish-game-creation.md"})`。
- `developer_id` 用 `dev_id`;其余创建字段统一放入 `data`,使用当前 schema 的 snake_case 字段,且不要再包一层 `{"data": ...}`。创建示例:

  ```text
  call_tool(name:"app create-app", args:{
    dev_id:"<developerId>",
    data:{ title:"<title>", category:"<category>", developer_role:"<developer|author|publisher>", package_type:"<apk|mini_app|windows|h5>" },
    idempotency_key:"<create-key>", dry_run:true
  })
  ```

- 只有游戏名、游戏类型和包体方向均有明确来源且已确认后,才输出创建预览;摘要简述来源或依据,不展示发布模式、icon 缺失或系统默认图标。
- 参数不确定时先 `call_tool(name:"schema", args:{_positional:["app","create-app"]})`;用户明确确认后首个真实创建调用使用预览时完全相同的 `data`,并同时传稳定的 `idempotency_key` 和 `yes:true`。不要先省略 `yes` 触发 `confirmation_required` 再重复同一调用。
- 创建成功后给 appId、资料页入口和首批物料状态;此时才说明系统默认图标仅用于完成游戏创建,不代表已通过素材审核,并建议替换为符合要求的正式图标。
- 创建成功拿到 appId 后,按[游戏物料要求](`ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/material-requirements.md"})`)在同一轮报告当前字段、动态规格和缺失项,并主动提示用户完善素材;不要让用户再次追问尺寸。
- 如果当前缺失项包含图片素材,紧接着询问用户是否有可用的本地素材或真实游戏截图;用户确认没有后,再询问是否需要生成本地候选图,并转 materials 手册。游戏截图只能使用真实游戏画面。
- 不要说"已经可以上线"。统一说明:已创建游戏草稿;版本发布后,分发入口会保持当前设置。仍显示"敬请期待"的入口,如需开放下载或游玩,请单独调整对应的分发状态。

## 第二部分:资料维护与审核发布

本部分修改资料草稿和版本状态,是高风险业务域。

**CRITICAL — 写入前必须 read-before-write:读取真实字段、可见性、必填项、版本状态和最新 `expected`,再构造变更。**

**CRITICAL — 审核、发布、撤审、撤定时、立即上线和重置草稿等高影响动作,必须先 dry-run 或等待用户明确确认。哪些请求不算提审意图,以共享执行规范「提审意图门禁」的唯一词表为准(`ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/shared-execution.md"})`);三步契约流程细节见 `app-edit/references/app-edit-audit-and-history.md`。**

**CRITICAL — 版本发布与分发状态独立。发布前调用 `app platform-status`(或读对应模块),只处理当次实际返回且可见的 `region_flag_*`,不能预设入口、状态或替用户切换。**

**每次资料、包体、审核或发布写操作完成后必须输出 handoff:当前阶段、已完成、未完成、用户现在是否需要操作、下一次检查时间、下一步动作和实际返回的页面或试玩入口。审核中不得表述为已上线;定时上线不得表述为已发布。**

**成功提交审核或发布并完成状态读回后,按共享「运营阶段手册交接」补充一个官方手册;阶段识别与完整历史门禁以 `taptap-suite/references/operation-handbooks.md`「识别顺序」为唯一正本。**

**CRITICAL — 资料提示和提审风险必须区分 `official_rule`、`current_fact`、`historical_review`、`test_evidence` 和 `agent_assessment`。只有两份 v4 官方文档明确写出的内容才能称为官方规范;审核原文不得反向补造成规则。填写或提审前按 review risk checklist(`ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-app-edit/references/review-risk-checklist.md"})`)输出可溯源结论。**

**包体写入事实门禁 — 当前 schema 声明 `list-packages.result.package_slots` 时,它是唯一槽位写入事实,并固定包含 `main`、`windows`、`apk_mini_game_play`。只有目标槽位 `available=true`、同次 `list` 中存在状态为 `ready` 的目标候选,且 `expected` 完整非空时,才能把该 `expected` 原样传给 `select-package` / `clear-package`。当前 schema 未声明 `package_slots` 时必须停止资料页包体绑定并报告契约缺口,不得从 `current_bindings`、候选或历史响应补造 `available` / `expected`。`current_bindings` 只用于展示,不能作为写入前置条件。包体管理页面入口只使用 `get-package-overview` 本次实际返回的 `page_path`。**

### 资料维护快速决策

| 用户意图 | 首选调用 / 流程 |
| --- | --- |
| "还差什么 / 能不能提审" | 读取模块、包体、版本、资质和历史审核后生成分层风险清单(读 skill analysis 与 review risk checklist) |
| 查字段、选项、图片/视频规格 | `call_tool(name:"app get-app-module", args:{dev_id, app_id, data:{module_id:"<module_id>"}})` |
| 改文字、图片、视频等普通字段 | 读模块详情,带最新 `expected` 调 `app save-changes` |
| 切换或清空主包体 / Windows 包体 | `app list-packages` → `app select-package` / `app clear-package` |
| 按 Spark version_code 绑定资料页主包体 | `app list-packages` → `app +bind-spark-version` dry-run → 确认后 apply |
| 提交审核并设置上线方式 | skill analysis → platform-status → prepare-review-snapshot → precheck-app-review → 确认 → submit-app-review |
| 撤审、撤定时、改时间、重置草稿 | 先确认 version 状态,再预览和确认 |
| 定时已到但版本仍待上线 | 确认 `status=3` 且 `release_time <= now`,再确认后 `app publish-scheduled-release` |
| 从文案文件提取字段、识别图片用途、规划新版资料 | Agent 生成候选,读当前值并确认后写入 |
| 当前缺少图片素材 | 先询问本地素材;确认没有后询问是否生成候选,转 materials 手册 |
| 上传本地目录、zip 或多种图片/视频/包体 | 转 materials 手册,上传后再回来写字段或绑定槽位 |
| 查上一版拒审原因或发版记录 | `app list-app-versions` / `app get-app-version` |
| 包体库、线上包、自测二维码 | 转 packages 手册 |
| 资质缺口和资质增量审核 | 转 qualification 手册 |

### 资料维护执行规则

- 缺 `developerId` / `appId` 时转 identity 手册。不知道字段所属模块时先读 field map(`ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-app-edit/references/app-edit-field-map.md"})`),再查模块详情。
- 需要引导用户打开资料编辑页时,只使用 `https://<current-server-host>/v3/<developerId>/app/<appId>/store/update`;不要自行拼接 `/store`,也不要把 Maker 或包体管理页当成资料编辑入口。
- 普通字段每批不超过 5 个 change。若字段返回 `expected_digest`,原样传为 `changes[].expected_digest`,不要复述完整旧值;否则传刚读到的严格存储值 `expected`。除显式 `force=true` 外,每条 change 必须二选一携带 `expected` 或 `expected_digest`。stale 时停止并重新读取;旧截图、旧对话、历史 `form_data` 和 iOS 的继承后 `platform_value.resolved_value` 都不能作为并发快照。
- `title_ios`、`description_ios`、`icon_ios` 是可选 iOS 覆盖字段;空值表示继承 Android 主字段。清空 `_ios` 字段会恢复继承,写入时的 `expected` 必须使用该 `_ios` 字段的严格存储值,不能使用页面最终展示的继承值。
- `age_grade`、`apk_package_name`、`mini_game_play_enabled`、`apk_supported_languages` 不能通过普通字段保存:适龄分级转资质人工流程;APK 包名需重建并上传 APK 后重新绑定;小游戏游玩方式用 `apk_mini_game_play` 槽位选择或清空;APK 支持语言当前不可编辑且默认 `zh_CN`。
- `category` 是资料中的游戏类型,可修改;C 端商店标签不是资料字段,当前 CLI 不支持修改,需人工处理。
- 图片和视频能否使用,以字段当次返回的 `image_spec` / `video_spec` 为准;`trailer` 与 `gameplay_demo_video` 最终不能使用同一个 `videoId`,重复时停止并让用户换一个视频;素材库检索与收录转 materials 手册。
- 不同 `videoId` 只证明字段引用不同对象,不证明内容不同或已符合审核规范 2.6.10;需要内容判断时标记人工复核。不得把历史审核中的"高度雷同"表述成官方文档规则。
- 所有包体统一分两条独立执行路径:
  1. **包体管理与自测**:`app get-package-overview` 按 APK、PC、Tap 小游戏、H5 或 Spark 查询包体库、线上/待处理状态和自测入口;返回 `self_test_targets` 时可继续调用 `package-management get-test-qr-code`。该路径只读,不能提供资料页 `expected`,也不执行主包体绑定。
  2. **资料页包体槽位绑定**:调用 `app list-packages`。当前 schema 未声明 `package_slots` 时必须停止并报告契约缺口;字段已声明时,从同次 `list` 选择 `status=ready` 的候选,检查目标 `package_slots.<slot>.available=true`,把 `package_slots.<slot>.expected` 原样写入 payload。先用稳定 key dry-run,用户确认后使用相同 payload 和 key 加 `yes:true`,成功后重新读取并验证目标绑定。收到 stale/409 时停止并重新读取,禁止自动重放。Spark 使用专用 `app +bind-spark-version` 编排相同门禁。

  两条路径返回的候选或可见性冲突时停止写入,并报告 scope / 权限问题。上传成功不等于资料页包体槽位已绑定。
- `app +bind-spark-version` 会校验 `listPackages` 和 `selectPackage` 的实际结构;dry-run 离线校验精确 `selectPackage` 输入并生成 apply 参数。`yes:true` 会重新读取实时 Spark 候选和主槽位,只有候选 `status=ready`、`available=true` 且传入 expected 与实时值严格一致时才写入,成功后必须读回目标 `spark_version_code`。
- TapTap 制造 / Spark 包体必须先在 TapTap 制造创建或更新;官方入口为 `https://maker.taptap.cn/`,面向用户时按共享规范单独一行输出。CLI 不上传或更新 Spark 包,只能把已存在且 ready 的版本绑定到资料页主槽位。
- 任意图片或视频上传成功后,先完成目标资料字段回填并重新读取;包体上传成功后必须重新读取候选和槽位,用户确认后才能绑定,不能把"上传成功"解释成"已绑定"或"可以提交审核"。
- 提审意图必须单独确认:泛化准备请求和"正式上线"目标只能触发准备状态检查或提审选项提示;只有用户明确表达"提交审核 / 提审"后才可调用 `app prepare-review-snapshot`,预审结果后仍须再次确认才可调用 `app submit-app-review`。
- 普通游戏提审前同时检查上架资质和开发者认证;未认证时按服务端 blocker 停止提审并引导办理。关卡游戏是否豁免以服务端当次返回为准。
- 提审固定三步:`app prepare-review-snapshot`(read)生成完整复核快照并保存 `review_snapshot.fingerprint` → 把同一个 `review_fingerprint` 和相同 `release_schedule` 原样传给 `app precheck-app-review`(read)→ 用户最终确认后 `app submit-app-review`(write,`yes:true` + 稳定幂等键)。收到 `SUBMIT_REVIEW_STALE` 时回到第一步,禁止复用旧指纹。
- `prepare-review-snapshot` 和 `precheck-app-review` 标记为 `read`,无需确认即可取得真实结果;`submit-app-review` 仍为 `write`。dry-run 只预览请求,不会执行预检。上线方式只支持立即上线或精确定时,并在三步中保持一致;模糊季度/档期必须追问具体时间或改为立即上线。
- 复核返回风险数据不可用且要求确认时,展示 warning;`yes:true` 不代表已核对。当前 schema 未声明风险确认输入时停止并报告契约缺口,不能补造本地参数。
- 用户确认前和发布结果中,逐项说明可见 `region_flag_*` 的真实状态。统一说明:"版本发布后,分发入口会保持当前设置。仍显示'敬请期待'的入口,如需开放下载或游玩,请单独调整对应的分发状态。"
- 实际执行 `submit-app-review` 前必须使用当前 `review_fingerprint` 完成正式预审,并按正式发布口径检查资质;资料、开发者认证或上架资质任一项无法确认或未满足时必须停止,不能依赖旧截图、旧结果或"上传成功"继续提审。
- 后续检查必须以当前读取结果或写后读回证据为准:此前建议的上传、回填或补充动作,如果没有对应的成功结果和当前状态证据,仍必须列为未完成。创建成功后、资料或素材写后读回后、正式提审前,主动提示用户按规范完善素材(口径同第一部分"创建后素材提醒")。如果本次读取结果中确实缺少图片素材,紧接着询问用户是否有可用的本地素材或真实游戏截图;用户确认没有本地素材后,再询问是否需要为图标、宣传图或 Windows 素材生成本地候选图,并转 materials 手册。不得为缺失的游戏截图生成虚构画面。游戏资料或版本审核通过不等于素材审核通过,也不等于已经具备首页推荐资格。非必填项只说明官方文档明确的展示/分发条件,或当前状态能直接证明的影响;官方规则只引用游戏物料要求 reference 中列出的 TapTap 官方文档及对应章节;字段必填性、当前缺口和服务端阻断以本次 `get-app-module`、`prepare-review-snapshot` 或 `precheck-app-review` 的真实返回为准。
- `precheck-app-review` 返回 `required_consents` 时,只展示每项 `agreement.name` 和 `agreement.url`;任一字段缺失时停止并报告契约缺口,不得请求用户同意或回传 `consent_token`。只有详情齐全且用户在当前对话明确同意后,才把全部未过期的 token 原样放入 `submit-app-review` 的 `consent_tokens`。保持原 `review_fingerprint` 和 `release_schedule` 不变。
- 生命周期动作先用 `app list-app-versions` / `app get-app-version` 读取当前状态;`logs[].event='schedule_cancelled'` 不是审核驳回。定时版本通常由平台自动发布;若 `status=3` 且 `release_time <= 当前时间` 仍未上线,可在展示影响并取得明确确认后调用 `app publish-scheduled-release`,成功后重新读取版本与分发状态。人工确认后状态漂移必须重新读取。
- 正式预检成功时,面向用户固定展示"阻塞项:无"和"提交状态:可提交审核";`can_submit` 仅用于内部判断,不得原样输出 `Blocker`、`can_submit=true` 等机器字段。
- 面向用户报告旧值/新值、保存结果、版本状态、风险和下一步;不默认输出完整 raw JSON 或 schema。
- 若当前 `status` 表示审核中或等待定时上线,用户动作默认是等待并按 `release_time`/审核结果检查,不要让用户重复上传、重复创建或重复提交。

### References(第二部分)

| Reference | 什么时候读 | 读取方式 |
| --- | --- | --- |
| publish-game creation | 完整创建字段收集、类型推荐、包体方向、素材和创建后推进 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-app-edit/references/publish-game-creation.md"})` |
| app-edit analysis | 资料体检、文案候选、图片分类和新版资料规划 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-app-edit/references/app-edit-analysis.md"})` |
| app-edit field map | 模块字段、可见性、联动、平台差异和详细包体模型 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-app-edit/references/app-edit-field-map.md"})` |
| app-edit fields and packages | 资料完整度、文案、图片视频和包体槽位写入 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-app-edit/references/app-edit-fields-and-packages.md"})` |
| app-edit version lifecycle | 审核、发布、撤审、定时、重置草稿前 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-app-edit/references/app-edit-version-lifecycle.md"})` |
| app-edit audit and history | 提审、SCE 协议、生命周期细节、版本历史和整套推进 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-app-edit/references/app-edit-audit-and-history.md"})` |
| review risk checklist | 字段提示、官方规则、历史拒审、测试证据和提审前风险清单 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-app-edit/references/review-risk-checklist.md"})` |
| 游戏物料要求 | 素材规格与合规判断 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/material-requirements.md"})` |

## 不在本手册范围

- 包体库和自测转 packages 手册;测试计划转 test-plan 手册;上架资质转 qualification 手册;图片素材库和本地模型生图转 materials 手册。厂商成员权限仍不在当前 CLI 范围。
