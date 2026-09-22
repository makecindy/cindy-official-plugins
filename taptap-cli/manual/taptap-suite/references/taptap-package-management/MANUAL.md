# TapTap CLI 插件:包体管理(packages)

本手册主要读取包体管理状态和自测入口。本地包体上传由 materials 手册执行,本手册不调用任何 upload shortcut。资料"选择/切换主包体"、提审、发布都归 app-edit 手册。命令行示例按 taptap-suite 手册的映射表转成 call_tool 调用。

**包体查询路径 — 没有单一总览接口。先调 `package-management get-available-package-types` 拿到该应用支持的包体类型,再按类型调对应的 `list-*`;不得臆造类型,也不得假设某个类型一定可见。**

**CRITICAL — 自测二维码交付 — `package-management get-test-qr-code` 成功后必须调用顶层 shortcut `test-qr-code`(`args.output` 指定 .png 路径)生成 PNG 二维码,并把返回的 `data.file_path` 作为图片附件交付给用户扫码。只输出 `qr_code_url`、只给文件路径或声称"已展示"都不算交付;工具输出里的图片预览只对 Agent 可见,不算用户收到二维码。协议细节与宿主差异见 [diagnostics](taptap-suite/references/taptap-package-management/references/package-management-diagnostics.md)「处理自测意图」。**

## 快速决策

| 用户意图 | 首选调用 / 流程 |
| --- | --- |
| 看当前支持哪些包体类型 | `call_tool(name:"package-management get-available-package-types", args:{developer_id, app_id})` |
| 看某类型的包体列表 | 按类型调 `package-management list-apk-packages` / `list-pc-packages` / `list-h5-packages` / `list-mini-app-packages` / `list-spark-versions` |
| 获取可玩入口 / 自测二维码 | 先从对应 `list-*` 取该版本的 `package_id`(TapTap 制造取 `version_code`),再传给 `package-management get-test-qr-code` |
| 用户说"当前包体版本号 / 当前包体 / 包体版本" | Windows 直接看 `list-pc-packages` 的 `current_package_id`;其它类型列全部候选后让用户确认 |
| 明确说 APK / Windows / H5 / 小游戏 / TapTap 制造 | 直接查该类型的 `list-*` 并解释状态 |
| 上传单个 APK / PC / H5 / 小游戏包 | 转 materials 手册执行对应 upload shortcut |
| 上传目录、混合 zip 或多种本地物料 | 转 materials 手册盘点并逐项上传 |
| 创建或更新 TapTap 制造包 | CLI 不上传;提供 TapTap 制造官方入口 `https://maker.taptap.cn/`(单独一行输出);完成后回 CLI 查询并编辑资料 |
| 把某个包设为资料页主包体 | 转 app-edit 手册;Spark 使用 `app +bind-spark-version`,其它类型按槽位契约使用 `app select-package` |

## 常用调用

```text
# 先拿该应用支持的包体类型
call_tool(name:"package-management get-available-package-types", args:{developer_id:"<developerId>", app_id:"<appId>"})

# 再按返回的类型调对应列表(示例:APK、Windows)
call_tool(name:"package-management list-apk-packages", args:{developer_id:"<developerId>", app_id:"<appId>", data:{page:1, page_size:20}})
call_tool(name:"package-management list-pc-packages", args:{developer_id:"<developerId>", app_id:"<appId>", data:{page:1, page_size:100}})

# 自测二维码 URL(动态命令,package_id 与 version_code 互斥,只能传一个)
call_tool(name:"package-management get-test-qr-code", args:{developer_id:"<developerId>", app_id:"<appId>", data:{package_id:"<packageId>"}})

# 渲染自测二维码 PNG(顶层 shortcut,data 同样是扁平目标)
call_tool(name:"test-qr-code", args:{developer_id:"<developerId>", app_id:"<appId>", data:{package_id:"<packageId>"}, output:"test-qr.png"})

# 读取当前 schema
call_tool(name:"schema", args:{_positional:["package-management","get-available-package-types"]})
call_tool(name:"schema", args:{_positional:["package-management","get-test-qr-code"]})
```

本地包体上传(APK、Windows、H5)不在本手册执行:统一转 materials 手册,由它完成 dry-run 预览、用户确认与上传,以及 H5 目录结构预检。本手册只负责上传后的状态查询与诊断。

## 包体类型矩阵

| 类型 | 列表命令 | 本手册能做 | 不能做 / 转交 |
| --- | --- | --- | --- |
| APK | `package-management list-apk-packages` | 查包体库、版本、包名、大小、配置状态 | 资料页主包体、提审、上线 |
| Windows | `package-management list-pc-packages` | 查 PC 包状态、当前默认包体、游戏本体包/启动器包分支 | Windows 包体绑定、资料字段、发布动作 |
| H5 | `package-management list-h5-packages` | 查 H5 版本、屏幕方向、是否发布中 | H5 主包体绑定、审核发布 |
| 小游戏 | `package-management list-mini-app-packages` | 查开发/审核/线上版本、包体大小与时间 | 上传、分包测试 → 开发者中心 |
| TapTap 制造 | `package-management list-spark-versions` | 查地图版本、大小、是否为当前线上 | 创建/更新包体 → TapTap 制造(官方入口 `https://maker.taptap.cn/`) |

上表除小游戏上传(开发者中心)和 TapTap 制造(Maker)两处外,其余"不能做"事项——各类型的资料页主包体绑定、资料字段、提审、发布——一律转 app-edit 手册。上传本身一律转 materials 手册。

## 执行规则

- 先调 `package-management get-available-package-types` 拿 `available_package_types`;只用其中实际返回的类型,不要补充不可见类型。
- 用户泛说"我要自测"时,先列出实际可用类型让用户选,不要把"自测"直接等同为"自测二维码"。
- **自测二维码**:从对应 `list-*` 里确定目标版本后,把它的 `package_id` 传给 `package-management get-test-qr-code`(TapTap 制造传 `version_code`)。`package_id` 和 `version_code` 互斥,只能传其中一个。TapTap 制造只有当前线上之外的候选也能取二维码;接口返回目标不可用时按工具结果提示用户重新选择版本。
- 二维码成功后必须调用顶层 shortcut `test-qr-code`(`args.output` 指定 .png)生成 PNG,并把 `data.file_path` 作为图片附件展示给用户。`package-management get-test-qr-code`(动态命令,JSON)负责拿 `qr_code_url` 和确认目标;`test-qr-code`(顶层 shortcut)负责渲染 PNG。动态命令不在本地补造二维码图片字段。
- **APK / Windows 没有二维码接口**:`get-test-qr-code` 只服务小游戏、H5 和 TapTap 制造。APK / Windows 想自测时,只说明包体列表状态,并引导用户在开发者中心对应包体页面发起自测;不要调用二维码 operation。
- **APK 的场景状态不在 CLI 契约内**:云玩 / TapPlay / 云微端 / 模拟器各场景的可用性、授权状态、当前包体、审核状态和不可用原因都不由任何 `package-management` 接口返回。用户问到时,只说明 CLI 只能列出包体本体(`package-management list-apk-packages`),场景维度请到开发者中心包体管理页面查看;不要从包体列表推断场景可用性。
- **Windows 分支**:`branch=1` 是游戏本体包、`branch=2` 是启动器包。判据是 `pc_package_branch` 权限:**没权限**时上传/绑定的就是本体包(页面没有类别可选),**有权限**时两个角色同时必填。`branch=0` 没有任何入口、也不再作为候选返回(只是历史存储位)。`current_package_id` 是当前默认包体,为 0 表示没有默认包体。
- 小游戏能力未开通时,`package-management list-mini-app-packages` 会返回失败或不包含 `mini_app` 类型。用户明确要求开通时,展示影响并等待用户确认后才调用 `package-management get-or-create-mini-app`,成功后重调 `package-management get-available-package-types` 验证。
- H5 查询失败时不要调用小游戏开通工具;H5 和小游戏是不同能力。
- TapTap 制造包体全部由 Maker 传入;CLI 不提供 Spark 包体上传或更新能力。用户要创建、构建或更新 Maker 包体时,必须引导到 `https://maker.taptap.cn/`(单独一行输出),完成后再用 CLI 查询已有版本或继续资料编辑。
- 用户要上传 Tap 小游戏包时,不执行 CLI 上传;引导到开发者中心完成上传和分包测试。不要调用 `package-management upload-mini-app-package`,也不要为了上传自动开通能力。当前 DC 契约不返回页面路径,不要自行补全或拼接页面路径。
- 历史 `mini-app-upload` 任务先用 `task +list|get` 诊断;用户明确要求恢复时可执行 `task +resume`,其下一步是否可执行完全由当前 Catalog 的 `enabled` / `disabled_reason` 决定。

## 输出规则

- 可以说明版本、文件名/包名、大小、更新时间、屏幕方向、阶段(`stage`)和各类型状态字段,以及二维码。
- 这些 `list-*` 都声明了分页(OpenAPI 名 `x-pagination`,catalog 里序列化为 `pagination`),且 catalog 声明的 `page_size` 默认值统一是 **20**。可用 `page` / `page_size` 写进 `args.data`,翻全量传分页控制 flag(`page_all:true`,可配 `page_limit` / `page_delay`);开发者中心各页面自己的分页条数(APK 20、Windows/小游戏 100、H5/TapTap 制造 10)是页面行为,**不是** API 默认值,不要当成默认值转述。
- 某类型的列表返回失败时,只说明该类型当前不可用;不要把失败说成"应用不支持该类型",也不要据此去开通别的能力。
- TapTap 制造的发布状态字段不准确,暂不向用户展示;只说明版本、更新时间、大小和下一步。
- raw ID 只在用户明确要排查 ID 或接口数据时展示。
- 向用户解释列表时优先说版本名、包名/文件名、更新时间和状态标签,不要堆砌字段。
- 不承诺已经提交审核、发布或切换主包体。

## References

| Reference | 什么时候读 | 读取方式 |
| --- | --- | --- |
| package management diagnostics | 解释复杂包体状态、自测二维码、小游戏/H5/TapTap 制造分支 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-package-management/references/package-management-diagnostics.md"})` |

## 不在本手册范围

- 绑定/切换资料页主包体、提审、发布:转 app-edit 手册。
- 创建游戏:app-edit 手册第一部分。
- 测试计划资格/激活码:转 test-plan 手册。
- 本地包体上传(含单个确定包体):转 materials 手册。
