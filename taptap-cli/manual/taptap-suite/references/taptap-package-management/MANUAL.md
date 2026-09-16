# TapTap CLI 插件:包体管理(packages)

本手册主要读取包体管理状态和自测入口。本地包体上传由 materials 手册执行,本手册不调用任何 upload shortcut。Tap 小游戏上传转开发者中心。开通 Tap 小游戏能力也必须单独确认。资料"选择/切换主包体"、提审、发布都归 app-edit 手册。命令行示例按 taptap-suite 手册的映射表转成 call_tool 调用。

**CRITICAL — 动态 `package-management` API 命令除确认式 `enable-mini-app` 外只做包体管理诊断和自测入口;本地包体上传由 materials 手册执行。Tap 小游戏不在 CLI 上传,必须引导到开发者中心。资料"选择/切换主包体"必须转 app-edit 手册。**

**CRITICAL — `package-management get-test-qr-code` 成功后拿到 `qrcode_uri` / `qr_code_url` 时,必须调用顶层 shortcut `test-qr-code`(`args.output` 指定 .png 路径)生成 PNG 二维码,并把返回的 `data.file_path` 作为图片附件交付给用户扫码。只输出 `qrcode_uri` / `qr_code_url`、只给文件路径或声称"已展示"都不算交付;工具输出里的图片预览只对 Agent 可见,不算用户收到二维码。协议细节与宿主差异见 [diagnostics](taptap-suite/references/taptap-package-management/references/package-management-diagnostics.md)「处理自测意图」。**

## 快速决策

| 用户意图 | 首选调用 / 流程 |
| --- | --- |
| 看当前有哪些包、线上包/待处理包状态 | `call_tool(name:"package-management get-package-overview", args:{dev_id, app_id})` |
| 获取可玩入口 / 自测二维码 | 先 overview 确认类型和 `self_test_targets`,再向 `package-management get-test-qr-code` 传选中的完整 `self_test_target` |
| 用户说"当前包体版本号 / 当前包体 / 包体版本" | 不传 package type,先让 overview 按真实可见 tab 解析 |
| 明确说 APK / Windows / H5 / 小游戏 / TapTap 制造 | 按对应分段解释状态 |
| 上传单个 APK / PC / H5 包 | 转 materials 手册执行对应 upload shortcut |
| 上传单个 Tap 小游戏包 | 不执行 CLI 上传;读取小游戏 overview,存在非空 `page_path` 时原样引导到开发者中心,否则只说明需前往开发者中心 |
| 上传目录、混合 zip 或多种本地物料 | 转 materials 手册盘点并逐项上传 |
| 创建或更新 TapTap 制造包 | CLI 不上传;提供 TapTap 制造官方入口 `https://maker.taptap.cn/`(单独一行输出);完成后回 CLI 查询并编辑资料 |
| 把某个包设为资料页主包体 | 转 app-edit 手册;Spark 使用 `app +bind-spark-version`,其它类型按槽位契约使用 `app select-package` |

## 常用调用

```text
# 包体总览(带过滤)
call_tool(name:"package-management get-package-overview", args:{dev_id, app_id, data:{package_type:"apk", include_scenes:true}, page:1})

# 自测二维码 URI(动态命令,data 是完整 self_test_target)
call_tool(name:"package-management get-test-qr-code", args:{dev_id, app_id,
  data:{ self_test_target:{ kind:"h5_version", package_type:"h5", package_id:"<h5VersionId>" } }})

# 渲染自测二维码 PNG(顶层 shortcut,data 是扁平 self_test_target)
call_tool(name:"test-qr-code", args:{dev_id, app_id,
  data:{ kind:"h5_version", package_type:"h5", package_id:"<h5VersionId>" },
  output:"test-qr.png"})
```

本地包体上传(APK、Windows、H5)不在本手册执行:统一转 materials 手册,由它完成 dry-run 预览、用户确认与上传,以及 H5 目录结构预检。本手册只负责上传后的状态查询与诊断。

## 包体类型矩阵

| 类型 | 本手册能做 | 不能做 / 转交 |
| --- | --- | --- |
| APK | 查包体库、线上包、待处理包、`self_test_mode` / 场景状态、上传后诊断 | 资料页主包体、提审、上线 |
| Windows | 查 PC 包状态、待处理包、游戏本体包/启动器包分支、测试入口、上传后诊断 | Windows 包体绑定、资料字段、发布动作 |
| H5 | 查 H5 tab 可见性、H5 包状态、上传后可测性 | H5 主包体绑定、审核发布 |
| 小游戏 | 查是否开通、开发/审核/线上版本、自测入口;读取页面入口 | 上传、分包测试 → 开发者中心 |
| TapTap 制造 | 查项目绑定、已有制造包、自测入口说明;发布状态暂不展示 | 创建/更新包体 → TapTap 制造(官方入口 `https://maker.taptap.cn/`) |

上表除小游戏上传(开发者中心)和 TapTap 制造(Maker)两处外,其余"不能做"事项——各类型的资料页主包体绑定、资料字段、提审、发布——一律转 app-edit 手册。上传本身一律转 materials 手册。

## 执行规则

- 用户泛说"我要自测"时,先查 `available_tabs`,让用户在真实可见类型里选。
- APK / Windows 自测读取 overview 的 `self_test_mode` 和场景状态,不调用二维码工具。只使用本次 overview 实际返回的 `page_path`,缺失时不生成页面链接。
- Windows 页面可能提供包体行内"自测"、包体自测区域"管理自测"、白名单维护和立即自测;CLI 只读取状态,不代创建、结束或维护自测。只原样返回本次 overview 的 `page_path`,不存在时不生成或拼接页面链接。
- 小游戏 / H5 / TapTap 制造先用 overview 的 `self_test_targets` 判断是否存在可测目标。只有一个目标时可直接使用;多个目标时先让用户按业务标签选择,再把选中的完整对象作为 `self_test_target` 传给 `package-management get-test-qr-code`。`package_type` 和 `version_code` 仅用于兼容旧调用,不用于替代可用的目标选择器。
- 二维码成功后必须调用顶层 shortcut `test-qr-code`(`args.output` 指定 .png)生成 PNG,并把 `data.file_path` 作为图片附件展示给用户。`package-management get-test-qr-code`(动态命令,JSON)负责拿 `qrcode_uri` / `qr_code_url` 和确认目标;`test-qr-code`(顶层 shortcut)负责渲染 PNG。两个命令参数格式不同(见上方常用调用)。动态命令不在本地补造二维码图片字段。
- H5 查询失败或 tab 不可见时,不要调用小游戏开通工具;H5 和小游戏是不同能力。
- 用户要上传 Tap 小游戏包时,先读取 `package-management get-package-overview` 并传 `data:{package_type:"mini_app"}`,只使用本次返回的非空 `page_path` 引导到开发者中心;没有值时不拼接 URL。不要调用 `package-management upload-mini-app-package`,也不要为了上传自动开通能力。
- 用户明确要求开通 Tap 小游戏能力,且 overview 明确提示可开通时,展示影响并等待用户确认后才调用 `package-management enable-mini-app`(yes:true),成功后重新读取 overview 验证。
- TapTap 制造包体全部由 Maker 传入;CLI 不提供 Spark 包体上传或更新能力。用户要创建、构建或更新 Maker 包体时,必须引导到 `https://maker.taptap.cn/`(单独一行输出),完成后再用 CLI 查询已有版本或继续资料编辑。
- TapTap 制造概览中的第一个版本是本次包体管理实时查询的最新可见版本;CLI 无法读取 Maker 编辑器当前预览构建标识,因此不能自动声称"与 Maker 预览一致"。需要可玩路径时把该版本的 `version_code` 传给二维码 operation。

## 输出规则

- 可以说明线上/待处理/审核/开发分段状态、二维码、空态和下一步。
- 只使用本次 overview 实际返回的非空 `page_path`;不得引用、补全或拼接旧包体页面路径。
- TapTap 制造的发布状态接口不准确,暂不向用户展示 `status` / `release_status` 等发布状态字段;不要据此判断包体是否已发布。
- Windows 分支:`branch=0` 是默认 Windows 包,`branch=1` 是游戏本体包,`branch=2` 是启动器包;服务端返回其它非负 branch 时原样保留。单文件上传使用 `upload-pc-package`,目录或混合 zip 先转 materials 手册;上传完成后的绑定再转 app-edit 手册,并在写入前重新读取最新 `expected`。
- 上传成功只代表包进入对应包体流程,不代表资料页主包体已切换。
- `package-management get-package-overview` 不是资料页绑定接口;所有资料页包体绑定都转 app-edit 手册,由其重新读取当前 schema 声明时的 `list-packages.package_slots` 后确认式写入。当前 schema 未声明 `package_slots` 时停止并报告契约缺口;Spark 由 `app +bind-spark-version` 验证同次 ready 候选并完成写后读回。
- 上传并绑定后必须转 app-edit 手册,重新读取资料模块、包体、版本和资质;用户明确要求提审后再以正式预审结果作为门禁,不能直接把下一步写成提交审核。
- Tap 小游戏上传不在 CLI 发起。用户提供本地小游戏包或要求上传时,只读取最新小游戏 overview 并引导到开发者中心;本次没有返回 `page_path` 时不能交付页面入口。历史小游戏任务先用 `task +list|get` 诊断;用户明确要求恢复时可执行 `task +resume`,其下一步是否可执行完全由当前 Catalog 的 `enabled` / `disabled_reason` 决定。
- 不要承诺已经提交审核、发布或切换主包体。

## References

| Reference | 什么时候读 | 读取方式 |
| --- | --- | --- |
| package management diagnostics | 解释复杂包体状态、自测二维码、小游戏/H5/TapTap 制造分支 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-package-management/references/package-management-diagnostics.md"})` |
| package management page paths | 需要把工具返回的 `page_path` 转成用户可打开的包体管理页面入口 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-package-management/references/package-management-page-paths.md"})` |

## 不在本手册范围

- 绑定/切换资料页主包体、提审、发布:转 app-edit 手册。
- 创建游戏:app-edit 手册第一部分。
- 测试计划资格/激活码:转 test-plan 手册。
