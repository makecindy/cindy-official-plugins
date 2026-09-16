# TapTap CLI 插件:游戏素材(materials)

本手册合并两个业务域:**本地物料盘点与端到端上传**(materials)与**图片素材库检索/收录、模型生图与本地校验**(asset-library)。上传类命令的命令行示例按 taptap-suite 手册的映射表转成 call_tool 调用(文件路径放 `_positional`)。

## 第一部分:本地物料盘点与上传

本部分是五个端到端 upload shortcut(图片、视频、APK、Windows、H5)的**唯一执行入口**:其他手册需要上传本地物料时一律转交到这里,不自行执行上传命令。它负责让本地物料取得可继续处理的远端句柄;不拥有资料字段写入、资料页包体槽位绑定、提审或发布。

**CRITICAL — 图片、视频、APK、Windows、H5 只调用五个端到端 upload shortcut。Tap 小游戏只识别和引导到开发者中心,不调用 `package-management upload-mini-app-package` 或动态 OpenAPI 的 upload/complete/submit operation。不得处理 OSS、Qiniu、upload_token、轮询或任务恢复。**

**CRITICAL — 上传成功不等于资料字段已写入,也不等于资料页包体已绑定;上传后的交接去向以上方「上传快速决策」表为准,不在正文其他位置重复声明。Tap 小游戏不在 CLI 上传;只原样使用 overview 本次返回的非空 `page_path` 引导到开发者中心,不得自行拼接页面入口。**

### 本地盘点

只读盘点命令是 `materials +inspect <directory|archive>`,安全扫描目录或 zip,输出每个文件的路径、识别类型、未知项和需要后续确认的歧义,不上传、不写资料、不绑定包体。`<directory|archive>` 必须是会话工作目录内的相对路径(不能传绝对路径,也不能用 `../` 访问工作目录外的文件):

```text
call_tool(name:"materials", args:{_positional:["+inspect","相对路径/目录或zip"]})
```

inspect 输出位于成功 envelope 的 `data` 下(`data.materials[]`、`data.summary`、可选 `data.skipped[]`、`data.handoff`)。目录或直接文件中的可上传 `materials[]` 至少包含 `path`、`name`、`kind` 和 `reason`;压缩包内条目使用 `fromArchive`、`needsExtraction=true`,不会伪装成可直接上传的本地路径。包体使用 `kind="package"`,再由 `packageType="apk|pc|h5|tap|unknown"` 区分。

### 上传快速决策

| 物料 | 上传调用(先 dry_run,确认后同参数加 yes) | 上传后交接 |
| --- | --- | --- |
| 本地图片 | `call_tool(name:"upload", args:{_positional:["<image>"], dev_id, app_id, idempotency_key})` | app-edit 手册决定字段用途并写入 |
| 本地视频 | `call_tool(name:"upload-video", args:{_positional:["<video>"], dev_id, app_id, scene:"trailer|gameplay_demo_video"})` | app-edit 手册用返回的 `videoId` 写入 |
| APK | `call_tool(name:"upload-apk", args:{_positional:["<apk>"], dev_id, app_id})` | packages 手册查状态,再转 app-edit 手册 |
| Windows 包 | `call_tool(name:"upload-pc-package", args:{_positional:["<package>"], dev_id, app_id, launch_exe, version, windows_branch})` | packages 手册查状态,再转 app-edit 手册 |
| H5 zip | `call_tool(name:"upload-h5-package", args:{_positional:["<package>"], dev_id, app_id, screen_orientation})` | packages 手册查状态,再转 app-edit 手册 |
| Tap 小游戏 zip | 无 CLI 上传命令 | 转 packages 手册读取小游戏 overview;存在非空 `page_path` 时原样引导到开发者中心 |
| 文案、表格或其他非上传文件 | Agent 直接读取并转 app-edit 手册 | 不走上传 shortcut |

TapTap 制造 / Spark 包不属于这五种上传能力,转 TapTap 制造;官方入口为 `https://maker.taptap.cn/`,面向用户时按共享规范单独一行输出。已有 ready Spark 版本转 app-edit 手册,按实时候选和主槽位 expected 使用 `app +bind-spark-version` 绑定。

### H5 ZIP 目录结构

H5 包上传前必须满足以下结构,根目录必须且只能有一个游戏文件夹:

```text
game.zip
└── game/
    ├── index.html
    ├── main.js
    └── assets/
```

`index.html` 必须位于这个游戏文件夹的第一层。以下结构必须在上传前修正:`index.html` 或其它游戏文件直接位于 ZIP 根目录;根目录包含多个游戏文件夹;根目录同时包含游戏文件夹和其它文件;入口文件被放在更深层目录。先执行 `--dry-run`,确认 `data.archive_preflight` 通过(`violations` 为空、`top_level_entries` 只有一个游戏文件夹)后,再使用相同文件和参数加 `yes:true` 上传;预检失败不会创建远端上传任务,修正目录后重新打包并重新预览。`__MACOSX`、`.DS_Store` 和 `._*` 属于可忽略的 macOS 元数据;其它隐藏文件会作为 warning 展示,仍需确认是否应随包分发。

### 上传执行规则

1. 对图片、视频、APK、Windows、H5,显式缺 `developerId` / `appId` 且当前 profile 也没有可用 saved scope 时,先转 identity 手册;五个 upload shortcut 都是 app-scope 写操作。小游戏只在需要读取 overview 页面入口时解析 scope。
2. 用 `materials +inspect` 的 manifest 或用户明确提供的单文件路径建立计划。目录或 zip 中的未知项、歧义项、多个视频和 Windows branch 先让用户确认。
3. 对图片、视频、APK、Windows、H5 文件先执行同一 shortcut 的 dry-run。用户确认后,以同一文件、scope 和业务意图执行 `yes:true`。图片命令额外必须提供稳定 `idempotency_key`;其他 shortcut 按当前 help 不接收该 flag。小游戏不执行 dry-run 或上传。
4. 单文件 shortcut 的输入是位置参数(`<file>` 放 `_positional`)、`app_id`、`dev_id` 和各自 flag;**不要传 `data`,不要手写 `file_name`、`file_size`、`sha256`、`upload_token` 或 complete request body。**`file_size` 是字节大小,H5 的 `screen_orientation` 也是协议字段;这些字段由 CLI workflow 按当前 schema 生成和校验。
5. 成功以顶层 `ok=true` 或 exit code 0 判断;缺少 `yes` 的确认门禁是 exit code 10(插件返回 `CONFIRM_REQUIRED`);其它失败按返回的 error 停止和恢复,不把业务内字段当作成功。
6. 单项部分失败时保留已返回的远端句柄,按文件记录结果。只重试没有远端句柄的失败项,不能整批重跑。H5 可用 `task +list|get|resume` 恢复已有任务;历史小游戏任务可先用 `task +list|get` 诊断,用户明确要求恢复时再执行 `task +resume`,其下一步是否可执行完全由当前 Catalog 的 `enabled` / `disabled_reason` 决定。不得重构 upload token。
7. 大文件上传超时返回 `TIMEOUT` 时,加大 `_timeout_seconds`(最大 870)重试,或用 `task` 类命令恢复;不要盲目重发完整上传。
8. 完成上传后,按"上传结果 → 当前远端状态 → 用户确认 → 后续处理"的顺序交接;不得在本部分自动执行 `save-changes`、`select-package`、`clear-package`、审核或发布。APK、Windows、H5 转 app-edit 手册后必须重新读取候选和当前 schema 声明时的 `package_slots`,不能复用上传前快照。

### 上传结果句柄

| Shortcut | 成功后保留的字段 | 不应推断 |
| --- | --- | --- |
| `upload` | `data.url`、`data.info.width/height/size/format`、`data.assetId` | asset ID 只表示素材库收录结果,不表示图片已写入资料字段 |
| `upload-video` | `data.videoId`、`data.validationWarnings` | 上传完成;转码和资料字段写入仍是后续状态 |
| `upload-apk` | `data.apkId` | 资料页主包体已切换 |
| `upload-pc-package` | `data.packageId`,以及存在时的绑定预览字段 | Windows 槽位已绑定 |
| `upload-h5-package` | `data.h5VersionId`、`data.h5PackageId` | H5 主包体已绑定或已审核 |

dry-run 的 JSON 是预览,不包含上述远端句柄。图片、APK、PC、H5 预览不发网络请求;视频预览会读取目标字段的实时 `video_spec`,但不会上传文件。小游戏没有 CLI 上传预览。

## 第二部分:图片素材库检索、收录与模型生图

本部分处理当前 App 的图片素材库检索、模型生成本地图片、真实游戏截图整理、图片规则校验和收录交接。素材库结果不等于图片已经写入图标、宣传图或截图字段。

**CRITICAL — 本地图片走顶层 `upload` shortcut,成功结果已自动收录;不要重复调用 `asset-library ingest-image-to-assets`。**

**CRITICAL — 多个场景一次调用 `asset-library batch-search-assets`,不要按场景循环调用单场景检索。**

**CRITICAL — 不得用模型凭空生成游戏截图。截图必须来自真实运行中的游戏或用户提供的真实游戏画面;模型只允许裁剪、缩放、转格式和压缩。**

**CRITICAL — 本地模型图片校验通过后仍未上传。必须先向用户展示候选和上传影响,得到明确确认后,才能执行 `upload`。**

**CRITICAL — 素材候选必须结构化交接。按场景逐项输出,每个候选文件单独输出实际绝对路径;宿主支持图片返回时逐张展示并同时保留路径,宿主不支持时明确说明并逐行给出路径。不得使用路径 glob、占位路径或把多个候选路径塞在同一段。**

### 素材来源优先级

开始补充素材前,先询问用户是否有可用的本地素材或真实游戏截图;在用户回答前,不要调用生图计划或扫描未指定的本地目录。

- 用户有本地素材时,优先使用用户提供的文件。按目标场景执行本地校验,需要整理时只做该场景允许的裁剪、缩放、格式转换或压缩,不调用 `+plan` 替换原始素材。校验通过后仍须询问用户是否上传。
- 用户没有本地素材时,图标、宣传图和 Windows 素材才进入模型生图流程:先调用 `asset-library ai-image +rules`,再根据规则调用 `+plan`,由模型生成实际本地图片文件并执行 `+validate`。
- 用户没有本地截图时,不得调用模型生成截图;应要求用户提供真实运行中的游戏画面或真实截图。

可向用户询问:

> 请先提供可用的本地素材或真实游戏截图。若没有本地素材,我可以按照当前素材规则为图标、宣传图或 Windows 素材生成本地候选图;截图必须来自真实游戏画面。

### 素材库快速决策

| 用户意图 | 首选调用 / 流程 |
| --- | --- |
| 为一个场景找参考图 | `asset-library search-assets` |
| 为多个场景批量找参考图 | `asset-library batch-search-assets` |
| "换一张参考图" | 单场景检索并传 `exclude_asset_ids` |
| 使用模型生成新图 | `asset-library ai-image +rules/+plan/+validate`(不含截图) |
| 整理真实游戏截图 | 模型处理用户/游戏提供的原图,再用 `+validate --rule screenshot` |
| 收录本地图片 | 顶层 `upload` shortcut |
| 收录已有 HTTPS 图片 | `asset-library ingest-image-to-assets` |
| 把图片写入资料字段 | 先收录,再转 app-edit 手册 |

### 常用调用

```text
call_tool(name:"asset-library search-assets", args:{dev_id, app_id, data:{target_scene:"ICON"}})
call_tool(name:"asset-library ingest-image-to-assets", args:{dev_id, app_id, data:{image_url:"<https-url>"}, idempotency_key, dry_run:true})
call_tool(name:"asset-library ai-image +rules", args:{dev_id, app_id})
call_tool(name:"asset-library ai-image +plan", args:{dev_id, app_id, rule:"<rule>", prompt:"<creative brief>", context:"<game context>", count:3})
call_tool(name:"asset-library ai-image +validate", args:{dev_id, app_id, _positional:["<output-dir>"], rule:"<rule>"})
```

### 模型生图与本地校验

确认用户没有可用本地素材后,模型生成真实图片文件,CLI 负责读取规则并校验产物。截图不属于模型生图场景。对可生图场景开始前先读取当前内置规则(`asset-library ai-image +rules`)。

根据用户的素材用途生成计划。仅对图标、宣传图和 Windows 素材调用 `+plan`;默认输出根目录是 `.taptap/ai-image/<run-id>`,其中 `candidates/` 只是 CLI 约定的本地候选文件子目录,不是 TapTap 官方目录,也不是上传接口要求。模型必须按计划把实际 PNG/JPEG 文件写入 `<output-dir>/candidates/`。

可以通过 `output_dir` 定制输出根目录。该目录必须通过 CLI 的本地安全路径校验,文件仍放在其下的 `candidates/` 子目录;校验时把同一个输出根目录传给 `+validate`。这只是本地文件组织约定,不影响素材库收录协议。

生成图片后执行本地校验。校验成功会在生成目录写出 `manifest.json`,并明确标记等待用户确认上传;校验失败不会写 manifest,也不能上传。校验结果中的候选路径、尺寸、格式、文件大小和 `upload_command` 是后续交接依据。CLI 只提示上传命令,不自动上传、不写入资料字段、不绑定字段、不提审。必须先询问用户是否上传;用户未确认时保持"待确认上传",不得执行上传。

规则校验按每个场景的最小宽高、宽高比、允许格式和单文件大小执行,不要求固定像素值。截图只能校验真实来源文件,且要求至少 3 张、所有截图宽高比一致。透明背景、必须包含 Logo、禁止文字、是否真实游戏画面等内容要求会列为人工复核项,不由图片元数据自动判定。

### 素材库执行规则

- 缺 `developerId` 或 `appId` 时转 identity 手册;不要猜 ID。
- 不确定目标 scene 或返回字段时先查 `asset-library` 类目 schema;文档中的枚举只是常见值,不是实时 schema。
- 执行图片上传前必须确认 `asset-library upload-image` 的 schema:请求使用 `app_id`、`developer_id`、`image`,返回使用 `status` 和 `result.asset`;schema 不一致时停止,不要猜字段。
- 单场景检索优先使用 `recommended_asset_id`,不要无条件取 `items[0]`。
- `data.result.found=false` 是正常空结果;顶层 `ok=false` 时按 `error.type` / `error.subtype` 处理,业务结果按 `found`、`recommended_asset_id`、`items` 和 `total` 等当前 schema 字段解释。`searchAssets` 没有通用的 `data.result.ok`;缺少预期结果字段按异常处理。
- 上游返回 `recoverable=true` 时,使用 `reason` 解释原因,并按 `guidance` 给出重试、调整参数或刷新登录等下一步。
- 面向用户说明可用性、匹配结果和下一步,不默认输出 raw JSON、候选评分、内部 ID 或状态数字。
- `+validate` 成功只代表本地文件通过机器校验,不代表已上传、已写入资料字段或已通过审核。用户未明确确认上传时,必须保留"待确认上传"提示。
- 上传出现未知结果、响应结构错误或请求已发出但客户端未确认时,先用相同幂等键回读素材库状态,再决定是否重试;不得直接换新幂等键重放。
- 素材收录完成后,若用户意图是更新资料字段,转 app-edit 手册,按目标字段规格 read-before-write。

## References

| Reference | 什么时候读 | 读取方式 |
| --- | --- | --- |
| asset library search | 单场景、批量检索、替换参考图、scene 枚举和候选状态 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-materials/references/asset-library-search.md"})` |
| asset library ingest | 本地上传、HTTPS 收录、模型生图、本地校验结果或资料字段交接 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-materials/references/asset-library-ingest.md"})` |

## 不在本手册范围

- 图片/视频规格判断和资料字段写入:转 app-edit 手册。
- 包体管理页诊断、自测二维码和小游戏能力开通:转 packages 手册。
- 资料字段写入、包体槽位绑定、提审、上线:转 app-edit 手册。
