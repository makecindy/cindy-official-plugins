# TapTap CLI 插件:游戏素材(materials)

本手册合并两个业务域:**本地物料盘点与端到端上传**(materials)与**图片/视频素材库检索收录、模型生图与本地校验**(asset-library)。上传类命令的命令行示例按 taptap-suite 手册的映射表转成 call_tool 调用(文件路径放 `_positional`)。

## 第一部分:本地物料盘点与上传

本部分是六个端到端 upload shortcut(图片、视频、APK、Windows、H5、Tap 小游戏)的**唯一执行入口**:其他手册需要上传本地物料时一律转交到这里,不自行执行上传命令。它负责让本地物料取得可继续处理的远端句柄;不拥有资料字段写入、资料页包体槽位绑定、提审或发布。

**CRITICAL — 不得处理 OSS、Qiniu、upload_token,也不得自行轮询或恢复上传任务;云存储凭证和上传状态机只由 CLI workflow 负责。**

**CRITICAL — 上传成功不等于资料字段已写入,也不等于资料页包体已绑定;不得把上传结果表述为已完成字段写入、槽位绑定或可提审。**

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
| 本地视频 | `call_tool(name:"upload-video", args:{_positional:["<video>"], dev_id, app_id, scene:"trailer 或 gameplay_demo_video"})` | app-edit 手册用返回的 `videoId` 写入 |
| APK | `call_tool(name:"upload-apk", args:{_positional:["<apk>"], dev_id, app_id})` | packages 手册查状态,再转 app-edit 手册 |
| Windows 包 | `call_tool(name:"upload-pc-package", args:{_positional:["<package>"], dev_id, app_id, launch_exe, version, windows_branch})` | packages 手册查状态,再转 app-edit 手册。**包体类别以接口返回为准**:应用没有 PC 包体分支能力时只有本体包(不带 `windows_branch` 或只传 `1`),不存在启动器包,不要主动问用户 |
| H5 zip | `call_tool(name:"upload-h5-package", args:{_positional:["<package>"], dev_id, app_id, screen_orientation})` | packages 手册查状态,再转 app-edit 手册 |
| Tap 小游戏 zip | `call_tool(name:"upload-mini-app-package", args:{_positional:["<package>"], dev_id, app_id})` | packages 手册用 `list-mini-app-packages` 查状态,再转 app-edit 手册 |
| 文案、表格或其他非上传文件 | Agent 直接读取并转 app-edit 手册 | 不走上传 shortcut |

TapTap 制造 / Spark 包不属于这六种上传能力,转 TapTap 制造;官方入口为 `https://maker.taptap.cn/`,面向用户时按共享规范单独一行输出。已有 ready Spark 版本转 app-edit 手册,按实时候选和主槽位 expected 使用 `app +bind-spark-version` 绑定。

引导 Tap 小游戏相关页面时,当前 DC 契约不返回 `page_path`,不要自行补全或拼接页面路径;入口只使用服务端本次实际返回的完整 `page_url`。

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

1. 对图片、视频、APK、Windows、H5、Tap 小游戏,显式缺 `developerId` / `appId` 且当前 profile 也没有可用 saved scope 时,先转 identity 手册;六个 upload shortcut 都是 app-scope 写操作。
2. 用 `materials +inspect` 的 manifest 或用户明确提供的单文件路径建立计划。目录或 zip 中的未知项、歧义项、多个视频和 Windows branch 先让用户确认。
3. 对图片、视频、APK、Windows、H5、Tap 小游戏文件先执行同一 shortcut 的 dry-run。用户确认后,以同一文件、scope 和业务意图执行 `yes:true`,两次调用复用同一个 `idempotency_key`。六个 shortcut 都接受该 flag(省略时由 CLI 自动派生),但图片上传必须显式提供稳定 key。
4. 图片、视频、APK、Windows、H5、Tap 小游戏只调用本部分的六个端到端 upload shortcut,不直接调用动态 OpenAPI 的 upload/complete/submit operation。单文件 shortcut 的输入是位置参数(`<file>` 放 `_positional`)、`app_id`、`dev_id` 和各自 flag;**不要传 `data`,不要手写 `file_name`、`file_size`、`sha256`、`upload_token` 或 complete request body。**`file_size` 是字节大小,H5 的 `screen_orientation` 也是协议字段;这些字段由 CLI workflow 按当前 schema 生成和校验。
5. 成功以顶层 `ok=true` 或 exit code 0 判断;缺少 `yes` 的确认门禁是 exit code 10(插件返回 `CONFIRM_REQUIRED`);其它失败按返回的 error 停止和恢复,不把业务内字段当作成功。
6. 单项部分失败时保留已返回的远端句柄,按文件记录结果。只重试没有远端句柄的失败项,不能整批重跑。H5 和 Tap 小游戏可用 `task +list|get|resume` 恢复已有任务;其下一步是否可执行完全由当前 Catalog 的 `enabled` / `disabled_reason` 决定。不得重构 upload token。
7. 大文件上传超时返回 `TIMEOUT` 时,加大 `_timeout_seconds`(最大 870)重试,或用 `task` 类命令恢复;不要盲目重发完整上传。
8. 完成上传后,按"上传结果 → 当前远端状态 → 用户确认 → 后续处理"的顺序交接;交接去向统一以上方「上传快速决策」表和本部分指出的交接目标为准,不在正文其他位置重复声明。不得在本部分自动执行 `save-changes`、`select-package`、`clear-package`、审核或发布。APK、Windows、H5 转 app-edit 手册后必须重新读取候选和当前 schema 声明时的 `package_slots`,不能复用上传前快照。

### 上传结果句柄

| Shortcut | 成功后保留的字段 | 不应推断 |
| --- | --- | --- |
| `upload` | `data.url`、`data.info.width/height/size/format`、`data.assetId` | asset ID 只表示素材库收录结果,不表示图片已写入资料字段 |
| `upload-video` | `data.videoId`、`data.validationWarnings` | 上传完成;转码和资料字段写入仍是后续状态 |
| `upload-apk` | `data.apkId` | 资料页主包体已切换 |
| `upload-pc-package` | `data.packageId`,以及存在时的绑定预览字段 | Windows 槽位已绑定 |
| `upload-h5-package` | `data.h5VersionId`、`data.h5PackageId` | H5 主包体已绑定或已审核 |
| `upload-mini-app-package` | `data.miniAppArtifactId`、`data.taskId` | 上传任务已创建;包体记录与提交状态以 packages 手册的查询结果为准 |

dry-run 的 JSON 是预览,不包含上述远端句柄。图片、APK、PC、H5、小游戏预览不发网络请求;视频预览会读取目标字段的实时 `video_spec`,但不会上传文件。

## 第二部分:图片/视频素材库检索、收录与模型生图

本部分处理当前 App 的图片/视频素材库检索、模型生成本地图片、真实游戏截图整理、图片规则校验和收录交接。素材库结果不等于图片已经写入图标、宣传图或截图字段。

**图片收录路径 — 本地图片走第一部分顶层 `upload` shortcut,成功即自动收录;服务端不再提供 URL 下载收录,已有 HTTPS 图片先由客户端下载到本地,再走 `upload`。**

**视频收录路径 — `call_tool(name:"asset-library upload-video", …)` 一次完成「取上传 token → 直传 → 登记视频资源 → 登记应用素材」;上传后视频仍在转码/审核,用 `call_tool(name:"asset-library get-video-detail", …)` 轮询状态。**

**CRITICAL — 只有当前 `get-video-detail` 返回非空 `play_url` 才能证明视频可播;上传成功、转码中或审核中都不能表述为可播放。**

**CRITICAL — 多个场景一次调用 `asset-library search-assets` 并传 `target_scenes` 数组,不要按场景循环调用。**

**CRITICAL — 不得用模型凭空生成游戏截图。截图必须来自真实运行中的游戏或用户提供的真实游戏画面;模型只允许裁剪、缩放、转格式和压缩。**

**CRITICAL — 本地模型图片校验通过后仍未上传。必须先向用户展示候选和上传影响,得到明确确认后,才能执行 `upload`。**

**素材候选交接 — 按场景逐项输出,每个候选文件单独输出实际绝对路径;宿主支持图片返回时逐张展示并同时保留路径,宿主不支持时明确说明并逐行给出路径。不得使用路径 glob、占位路径或把多个候选路径塞在同一段。**

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
| 为一个或多个场景找参考图 | `asset-library search-assets`(`target_scenes` 数组) |
| "换一张参考图" | `asset-library search-assets` 并传 `exclude_asset_ids` |
| 使用模型生成新图 | `asset-library ai-image +rules/+plan/+validate`(不含截图) |
| 整理真实游戏截图 | 模型处理用户/游戏提供的原图,再用 `+validate --rule screenshot` |
| 收录本地图片 | 第一部分顶层 `upload` shortcut |
| 收录已有 HTTPS 图片 | 先由客户端下载到本地,再走第一部分 `upload` |
| 收录本地视频 | `asset-library upload-video`(上传+登记一步完成) |
| 查视频转码/审核状态 | `asset-library get-video-detail` |
| 把图片写入资料字段 | 先收录,再转 app-edit 手册 |

### 常用调用

```text
call_tool(name:"asset-library search-assets", args:{dev_id, app_id, data:{target_scenes:["icon"]}})
call_tool(name:"asset-library upload-video", args:{_positional:["./trailer.mp4"], dev_id, app_id, idempotency_key, yes:true})
call_tool(name:"asset-library get-video-detail", args:{dev_id, app_id, data:{video_id:<videoId>}})
call_tool(name:"asset-library ai-image +rules", args:{dev_id, app_id})
call_tool(name:"asset-library ai-image +plan", args:{dev_id, app_id, rule:"<rule>", prompt:"<creative brief>", context:"<game context>", count:3})
call_tool(name:"asset-library ai-image +validate", args:{dev_id, app_id, _positional:["<output-dir>"], rule:"<rule>"})
```

### 视频收录

视频进素材库分两步(建「视频资源」+ 建「应用素材」),`upload-video` 一次跑完:

```text
call_tool(name:"asset-library upload-video", args:{_positional:["./trailer.mp4"], dev_id, app_id, idempotency_key, yes:true})
```

返回 `data.videoId` 与 `data.assetId`。同一 `videoId` 重复执行返回既有 `assetId`,不会重复登记;不传 `idempotency_key` 时 CLI 按文件 SHA256 派生,重跑不会重复上传。

上传后视频仍在转码/审核,轮询状态(`status` 取值:`transcoding` → `regulating` → `normal`;`transcode_failed` / `regulate_rejected` 为失败):

```text
call_tool(name:"asset-library get-video-detail", args:{dev_id, app_id, data:{video_id:<videoId>}})
```

`play_url` 有值即已可播。刚上传后状态查询可能短暂返回 404(服务端读延迟不重试),间隔数秒重试即可。轮询为只读,不需要幂等键。

### 模型生图与本地校验

确认用户没有可用本地素材后,模型生成真实图片文件,CLI 负责读取规则并校验产物。

只对图标、宣传图和 Windows 素材生图;截图不得由模型生成。规则读取、`+plan` 输出目录约定、`+validate` 和 `manifest.json` 语义见 [asset library ingest](taptap-suite/references/taptap-materials/references/asset-library-ingest.md),本手册不重复。开始生成前第一步是读取当前内置规则:

```text
call_tool(name:"asset-library ai-image +rules", args:{dev_id, app_id})
```

校验通过只代表本地文件合格,仍须用户确认后才转第一部分 `upload` 上传。

### 素材库执行规则

- 缺 `developerId` 或 `appId` 时转 identity 手册;不要猜 ID。
- 不确定目标 scene 或返回字段时先查 `asset-library` 类目 schema;文档中的枚举只是常见值,不是实时 schema。
- 执行图片上传前必须确认 `asset-library upload-image` 的 schema:请求使用 `app_id`、`developer_id`、`image`,返回使用 `status` 和 `result.asset`;schema 不一致时停止,不要猜字段。
- 检索优先使用每个场景的 `recommended_asset_id`,不要无条件取 `list[0]`。
- 业务结果按 `results[]` / `missing[]` 解释;某场景无候选出现在 `missing[]` 不是工具失败。顶层 `ok=false` 时按 `error.type` / `error.subtype` 处理。`searchAssets` 没有通用的 `data.result.ok`;缺少预期结果字段按异常处理。
- 上游返回 `recoverable=true` 时,使用 `reason` 解释原因,并按 `guidance` 给出重试、调整参数或刷新登录等下一步。
- 面向用户说明可用性、匹配结果和下一步,不默认输出 raw JSON、候选评分、内部 ID 或状态数字。
- `+validate` 成功只代表本地文件通过机器校验,不代表已上传、已写入资料字段或已通过审核。用户未明确确认上传时,必须保留"待确认上传"提示。
- 上传出现未知结果、响应结构错误或请求已发出但客户端未确认时,先用相同幂等键回读素材库状态,再决定是否重试;不得直接换新幂等键重放。
- 素材收录完成后,若用户意图是更新资料字段,转 app-edit 手册,按目标字段规格 read-before-write。

## References

| Reference | 什么时候读 | 读取方式 |
| --- | --- | --- |
| asset library search | 多场景检索、替换参考图、scene 枚举、`results[]` / `missing[]` 和候选状态 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-materials/references/asset-library-search.md"})` |
| asset library ingest | 本地上传、HTTPS 图片下载后上传、模型生图、本地校验结果或资料字段交接 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-materials/references/asset-library-ingest.md"})` |

## 不在本手册范围

- 图片/视频规格判断(时长、分辨率、编码、宽高比)和资料字段写入:转 app-edit 手册。
- 包体管理页诊断、自测二维码和小游戏能力开通:转 packages 手册。
- 资料字段写入、包体槽位绑定、提审、上线:转 app-edit 手册。
