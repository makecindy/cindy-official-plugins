# Asset library ingest

## 适用场景

用户要把本地图片或已有 HTTPS 图片收录进当前 App 素材库，或使用模型生成/整理本地图片并完成校验、收录交接时使用本 reference。

## 本地图片

本地图片的上传执行归 `taptap-materials`（即 `call_tool(name:"upload", …)`，支持 `dry_run:true` 预览与 `yes:true` 确认，图片需稳定 `idempotency_key`）。上传成功后使用返回的 `data.url`、`data.assetId` 和完整 `data.info`（含 `width`、`height`、`size`、`format`）继续素材库语境的解读。asset ID 只表示素材库收录结果，不表示图片已写入资料字段；不要重复调用 `ingest-image-to-assets`。

## HTTPS 图片

已有可访问的 HTTPS 图片使用素材库收录命令。写入前可先预览：

```text
call_tool(name:"asset-library ingest-image-to-assets", args:{app_id:"<appId>", developer_id:"<developerId>", data:{image_url:"https://example.com/image.png"}, idempotency_key:"<intent-key>", dry_run:true})
```

确认目标 App 和 URL 后执行真实命令：

```text
call_tool(name:"asset-library ingest-image-to-assets", args:{app_id:"<appId>", developer_id:"<developerId>", data:{image_url:"https://example.com/image.png"}, idempotency_key:"<stable-key>", yes:true})
```

收录后处于处理中是正常状态；如果用户要立即检索，说明该图片可能暂时不会作为推荐项。

## 模型生图

模型负责生成宣传类图片文件，或处理用户/游戏提供的真实截图；CLI 负责读取规则并校验产物。

### 素材来源优先级

询问顺序、生图边界和询问话术以 [skill 主文件](taptap-suite/references/taptap-materials/MANUAL.md)「素材来源优先级」为唯一正本，本节不另立清单；本 reference 只承接生图计划与校验的执行细节。

截图有独立边界：

- 不得根据文字描述生成新的游戏截图。
- 截图源必须是实际运行中的游戏画面或用户提供的真实游戏截图。
- 模型只能进行裁剪、缩放、格式转换和压缩等整理操作。
- 截图整理使用 `+validate --rule screenshot`，不得使用 `+plan --rule screenshot`。

先读取规则并生成计划：

```text
call_tool(name:"asset-library ai-image +rules")
call_tool(name:"asset-library ai-image +plan", args:{rule:"<rule>", prompt:"<creative brief>", context:"<game context>", count:3})
```

默认输出根目录为 `.taptap/ai-image/<run-id>`，`candidates/` 是 CLI 约定的本地候选文件子目录，不是 TapTap 官方目录，也不是素材库接口要求。模型必须把实际 PNG/JPEG 文件写入计划指定的 `<output-dir>/candidates/` 目录。可用 `+plan --output-dir <directory>` 定制输出根目录；该目录须通过 CLI 的本地安全路径校验，不能借此写入工作目录之外的路径。生成后对同一个输出根目录执行：

```text
call_tool(name:"asset-library ai-image +validate", args:{_positional:[".taptap/ai-image/<run-id>"], rule:"<rule>"})
```

校验成功会写出本地 `manifest.json`，其中包含候选文件、规则结果、`upload_pending=true` 和完整的 `upload` 调用参数。校验失败返回验证失败退出码，不写 manifest，不上传；必须先让用户确认候选图和上传意图，确认后转 `taptap-materials` 执行上传。

`candidates/` 仅用于隔离待审核的本地候选文件；用户也可以使用其他合法的输出根目录，但不能把该目录解释成平台素材库目录或已上传状态。

本地规则使用最小宽高和宽高比，不要求生成固定像素值；同时校验场景允许的格式和单文件大小。截图场景至少需要 3 张，且所有截图宽高比必须一致。真实游戏画面、透明背景、Logo、文字等内容约束属于人工复核项，校验结果会列出提醒，不会伪装成自动通过。

## 边界与结果

- 收录图片不等于已经写入图标、宣传图或截图字段；字段修改转 `taptap-app-edit`，并按目标字段规格 read-before-write。
- 本地模型生图不等于素材库收录；必须先完成本地规则校验，再由用户确认后转 `taptap-materials` 上传。
- 上游返回 `recoverable=true` 时，使用 `reason` 解释原因并按 `guidance` 给出重试、调整参数或刷新登录等下一步。
- 上游响应缺少预期结果字段时按异常处理，不把异常当成“收录成功”或“素材库为空”。
