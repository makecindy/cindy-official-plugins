# Package Management Diagnostics

### A. 查包体库状态

1. 先调 `get-package-overview`。
2. 按用户明确指向选择 `package_type`：`apk`、`windows`、`mini_app`、`h5`、`spark`。只有用户明确提到某个包体类型时，才在 `--data` 中传 `package_type`；用户泛问“当前游戏包体版本号 / 当前包体 / 包体版本”时不传。多个可见类型时按接口返回的 `available_tabs` 用文字候选让用户选择。
3. 分页默认对齐页面：APK 20、Windows/小游戏 100、H5/TapTap 制造 10；用户明确问某页时按用户页码传 `page`。
4. APK 问题默认带 `include_scenes: true`，因为云玩/TapPlay/云微端/模拟器状态属于包体库核心信息；用户只问主包列表时可设为 `false`。
5. `supported=false` / `TAB_NOT_VISIBLE` 表示当前应用不会展示该类型。只说业务结论和可见包体类型，例如“当前应用不支持 H5 包体库，当前可见的是 APK、Windows”，不要继续强查列表接口。
6. 当 H5/小游戏返回 `supported=false` / `TAB_NOT_VISIBLE` 时，必须停止在“当前应用不可用”结论上；不要询问用户是否开通 Tap 小游戏能力，也不要调用 `enable-mini-app`。
7. 向用户解释包体列表时优先说版本名、包名/文件名、更新时间和使用标签；APK/Windows/H5/小游戏可按接口返回解释审核或发布状态，但 TapTap 制造的 `status` / `release_status` 等发布状态接口不准确，必须隐藏，不要据此判断是否已发布。Windows 返回“游戏本体包 / 启动器包”分支标签时必须区分说明。raw ID 只在用户明确要排查 ID 或接口数据时展示。
8. Windows 包体查询先确认 `available_tabs` 包含 `windows`，再按 `result.list` 解释当前候选和状态。当前概览 schema 不提供槽位可用性，不能据此推进绑定；包体上传转 `taptap-materials`，绑定转 `taptap-app-edit`。`branch` 仅在 `list-packages.result.list[]` 实际返回时使用，未读取到时省略，不自行猜测 `0`。

### B. 小游戏能力未开通

1. 只有 `get-package-overview --data '{"package_type":"mini_app"}'` 返回 `supported=true` 且明确提示需要开通 Tap 小游戏能力时，才先问用户是否确认开通。
2. 展示开通影响；只有用户明确确认后，才调用 `enable-mini-app`。
3. 调用成功后重新读取 `get-package-overview --data '{"package_type":"mini_app"}'` 验证能力状态和可见目标。
4. 用户取消或未确认时，不继续查小游戏列表或二维码。
5. H5 不走能力开通分支；H5 可见时直接查 H5 列表/二维码，H5 不可见时只说明当前应用不会展示 H5 包体库。
6. 如果概览或二维码工具提示 Tap 小游戏能力状态暂时无法确认，只提示稍后重试；本次 overview 没有返回 `page_path` 时不能拼接页面入口，也不要调用 `enable-mini-app`。
7. 用户要上传小游戏包时，不调用 `upload-mini-app-package`。读取最新小游戏 overview，只使用本次实际返回的非空 `page_path` 引导到开发者中心；本次无值时只说明需在开发者中心完成上传和分包测试，不生成 URL。目录或混合 zip 转 `taptap-materials` 盘点，它也只能输出相同开发者中心交接。

### C. 处理自测意图

1. 用户只说“我要自测 / 自测一下”时，先调 `get-package-overview` 拿 `available_tabs`；不要把“自测”直接等同为“自测二维码”。
2. 如果用户已明确指定包体类型，就按该类型查概览；如果用户说“当前这个包体”但 CLI 对话里没有明确类型，仍要让用户在 `available_tabs` 里选择，不要假设页面上下文。
3. 如果用户没有指定类型且 `available_tabs` 有多个可见类型，必须用文字候选问用户想自测哪个包体类型。选项只能来自 `available_tabs`，例如当前只可见 APK、Windows 时，只展示 APK、Windows；不要补充不可见的小游戏 / H5 / TapTap 制造。
4. 如果 `available_tabs` 只有一个可见类型，可以直接进入该类型流程；如果没有可见类型，只说明当前应用没有可用包体库入口。
5. Windows 自测：传 `{"package_type":"windows"}` 查 overview；若返回 `self_test_mode=guide`，只围绕 Windows 包体自测作答。只使用本次 overview 实际返回的 `page_path`，缺失时不生成页面链接。
6. APK 自测：传 `{"package_type":"apk","include_scenes":true}` 查 overview；若返回 `self_test_mode=guide`，围绕返回场景做状态说明和页面入口。
7. 小游戏 / H5 / TapTap 制造自测二维码：只有用户选择这些类型，或明确说“自测二维码 / 测试二维码”时，才进入二维码流程。已确定类型后，使用 `get-package-overview` 返回的 `self_test_targets` 作为候选：小游戏只会包含“开发版本”；审核版本和线上版本没有小游戏自测二维码入口。H5 选择目标 H5 版本；TapTap 制造选择目标版本号。若二维码接口返回目标不可用，按工具结果提示用户重新选择版本。
8. 调用 `get-test-qr-code` 时优先把 overview 中选定的完整目标作为 `self_test_target` 传入。只有一个目标时可直接使用；多个目标时先让用户按标签选择。`package_type` 和 `version_code` 只用于兼容旧调用。
9. `get-test-qr-code`（动态命令，JSON）负责拿 `qrcode_uri` / `qr_code_url` 和确认目标；拿到后必须调用 `call_tool(name:"test-qr-code", args:{data:{kind:"...", package_type:"...", package_id:"..."}, output:"<file>.png"})` 生成 PNG 二维码（`output` 是相对会话工作目录的文件路径），并把返回的 `data.file_path` 作为图片附件展示给用户扫码。Codex 会折叠命令行输出，不能把命令输出本身当作二维码交付。`view_image`、`Viewed Image`、工具输出里的图片预览都只对 Agent 可见，不算用户收到二维码。不要只输出 `qrcode_uri` / `qr_code_url`、只给文件路径或说“二维码已展示”。动态命令不在本地补造二维码图片字段。
10. 调 `get-test-qr-code` 失败时，只说明失败原因或下一步要求，不要要求用户提供内部参数名。

### D. TapTap 制造包体边界

1. TapTap 制造包体全部由 Maker 传入；CLI 不支持上传、创建或更新 Spark 包体。
2. 用户要创建、构建或更新 TapTap 制造包体时，直接引导到 [TapTap 制造](https://maker.taptap.cn/)；不要把任何 upload shortcut 或 `taptap-materials` 当作 Maker 包体上传入口。
3. Maker 已有版本可通过 `list-packages(["spark"])` 查询；设置资料页主包时转 `taptap-app-edit`。`+bind-spark-version` 接受同次 `status=ready` 候选的 `package_id` 作为 version code，并重查主槽位 expected 后写入和读回。普通资料字段仍可用 `taptap-app-edit` 编辑。
4. `get-package-overview(package_type="spark")` 和 Spark 候选列表中的发布状态暂不展示；只说明版本、更新时间、包体候选、自测入口和资料编辑下一步。

物料上传不是本 skill 的只读诊断入口；所有本地上传（含单个确定包体）都转 `taptap-materials` 执行。不要为了查询包体状态调用任何上传命令。
