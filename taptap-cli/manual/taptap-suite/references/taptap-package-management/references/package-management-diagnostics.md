# Package Management Diagnostics

### A. 查包体库状态

1. 先调 `package-management get-available-package-types`，拿本次实际返回的 `available_package_types`。
2. 只用该数组里实际出现的类型（`apk`、`windows`、`mini_app`、`h5`、`spark`），再按类型调对应列表：
   - `apk` → `package-management list-apk-packages`
   - `windows` → `package-management list-pc-packages`
   - `h5` → `package-management list-h5-packages`
   - `mini_app` → `package-management list-mini-app-packages`
   - `spark` → `package-management list-spark-versions`
3. 用户泛问“当前游戏包体版本号 / 当前包体 / 包体版本”时，先列候选让用户确认；Windows 例外，直接看 `list-pc-packages.result.current_package_id`（为 0 表示没有当前默认包体）。
4. 这些 `list-*` 都声明了分页（OpenAPI 名 `x-pagination`，catalog 里序列化为 `pagination`），且 catalog 声明的 `page_size` 默认值统一是 **20**。可用 `page` / `page_size` 写进 `args.data`，翻全量传分页控制 flag（`page_all:true`，可配 `page_limit` / `page_delay`）；开发者中心各页面自己的分页条数（APK 20、Windows/小游戏 100、H5/TapTap 制造 10）是页面行为，**不是** API 默认值，不要当成默认值转述。
5. 某类型的列表返回失败时，只说明该类型当前不可用；不要把失败说成“应用不支持该类型”，也不要据此去开通别的能力。
6. 向用户解释列表时优先说版本名、包名/文件名、更新时间和状态字段；raw ID 只在用户明确要排查 ID 或接口数据时展示。
7. Windows 分页结果额外返回 `current_package_id`；条目里的 `branch` 必须区分说明：`1` 游戏本体包、`2` 启动器包（判据是 `pc_package_branch` 权限：没权限时上传的就是本体包；有权限时两个角色同时必填）、`0` 无入口、不再作为候选/列表返回（历史存储位，这类老包需重新上传才能绑定）。`status` 为 0 新建 / 1 处理中 / 2 已处理未提审 / 3 处理失败 / 4 审核中 / 5 已过审 / 6 未过审 / 7 解析中断。
8. APK 条目带 `config_status`：`empty` 所有必填字段为空、`warning` 部分必填字段未填、`configured` 已配置完整；`null` 表示未知。不要把它说成审核状态。
9. TapTap 制造条目的 `status` 为 0 未上线 / 1 当前线上；发布相关的其它状态字段不准确，必须隐藏，不要据此判断是否已发布。
10. 小游戏条目按 `stage` 分段：`dev` 开发版本、`audit` 审核版本、`published` 线上版本。
11. 本手册只读包体状态。包体上传（含单个确定包体）转 materials 手册；资料页主包体绑定转 app-edit 手册。

### B. 小游戏能力未开通

1. `package-management get-available-package-types` 的 `available_package_types` 不含 `mini_app` 时，只说明当前应用没有开通 Tap 小游戏包体。
2. 用户明确要求开通时，展示开通影响并等待确认，之后才调用 `package-management get-or-create-mini-app`。
3. 调用成功后重调 `package-management get-available-package-types` 验证 `mini_app` 是否出现，再查 `package-management list-mini-app-packages`。
4. 用户取消或未确认时，不继续查小游戏列表或二维码。
5. H5 不走能力开通分支；H5 可用时直接查 `package-management list-h5-packages`，不可用时只说明当前应用不会展示 H5 包体库，不要调用小游戏开通命令。
6. 小游戏分包测试不在 CLI 进行；CLI 只能查看已提交包体的状态。当前 DC 契约不返回页面路径，不要自行补全或拼接页面路径。
7. 用户要上传小游戏包时，不调用 `package-management upload-mini-app-package`。读取最新小游戏列表，引导到开发者中心完成上传和分包测试。目录或混合 zip 转 materials 手册盘点，它也只能输出相同开发者中心交接。

### C. 处理自测意图

1. 用户只说“我要自测 / 自测一下”时，先调 `package-management get-available-package-types`，不要把“自测”直接等同为“自测二维码”。
2. 如果用户已明确指定包体类型，就按该类型查列表；如果用户说“当前这个包体”但对话里没有明确类型，仍要让用户在可用类型里选择，不要假设页面上下文。
3. 如果用户没有指定类型且可用类型多于一个，必须用文字候选问用户想自测哪个包体类型。选项只能来自本次返回的 `available_package_types`，例如当前只可用 APK、Windows 时，只展示 APK、Windows；不要补充不可见的小游戏 / H5 / TapTap 制造。
4. 如果只有一个可用类型，可以直接进入该类型流程；如果没有任何可用类型，只说明当前应用没有可用包体库入口。
5. **APK / Windows 没有二维码 operation**。用户要自测 APK 或 Windows 时，只解释 `package-management list-apk-packages` / `list-pc-packages` 返回的候选与状态，并引导用户在开发者中心对应包体页面发起自测；不要调用 `get-test-qr-code`。
6. **小游戏 / H5 / TapTap 制造自测二维码**：
   - 小游戏：从 `package-management list-mini-app-packages` 里选 `stage=dev` 的候选（审核/线上版本没有自测二维码入口），取它的 `package_id`。
   - H5：从 `package-management list-h5-packages` 里选目标版本，取它的 `package_id`。
   - TapTap 制造：从 `package-management list-spark-versions` 里选目标版本，取它的 `version_code`。
7. 调 `package-management get-test-qr-code` 时，`package_id` 和 `version_code` **互斥，只能传其中一个**。多个候选时先让用户按版本/时间选择，再传选中的 ID。
8. `package-management get-test-qr-code`（动态命令，JSON）负责拿 `qr_code_url`；拿到后必须调用 `call_tool(name:"test-qr-code", args:{data:{package_id:"<packageId>"}, output:"<file>.png"})`（TapTap 制造传 `data:{version_code:"<sparkVersionCode>"}`）生成 PNG 二维码（`output` 是相对会话工作目录的文件路径），并把返回的 `data.file_path` 作为图片附件展示给用户扫码。
9. Codex 会折叠命令行输出，不能把命令输出本身当作二维码交付。`view_image`、`Viewed Image`、工具输出里的图片预览都只对 Agent 可见，不算用户收到二维码。不要只输出 `qr_code_url`、只给文件路径或说“二维码已展示”。动态命令不在本地补造二维码图片字段。
10. 调 `package-management get-test-qr-code` 失败时，只说明失败原因或下一步要求，不要要求用户提供内部参数名。

### D. TapTap 制造包体边界

1. TapTap 制造包体全部由 Maker 传入；CLI 不支持上传、创建或更新 Spark 包体。
2. 用户要创建、构建或更新 TapTap 制造包体时，直接引导到 [TapTap 制造](https://maker.taptap.cn/)；不要把任何 upload shortcut 或 materials 手册当作 Maker 包体上传入口。
3. Maker 已有版本通过 `package-management list-spark-versions` 查询；设置资料页主包时转 app-edit 手册，`app +bind-spark-version` 接受候选的 `version_code`，并重查主槽位 expected 后写入和读回。
4. `package-management list-spark-versions` 的发布状态暂不展示；只说明版本、更新时间、大小、自测入口和资料编辑下一步。

物料上传不是本手册的只读诊断入口；所有本地上传（含单个确定包体）都转 materials 手册执行。不要为了查询包体状态调用任何上传命令。
