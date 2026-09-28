# CLI 调用范式（必读）

## 内容导航

- [认证](#认证)
- [通用工具调用](#通用工具调用)
- [命令树调用](#命令树调用优先给外部-agent-使用)
- [Skills 安装](#skills-安装)
- [工具 schema](#查工具-schema不确定参数时先调)
- [资源发现](#资源发现)
- [文件上传](#文件上传)

### 认证

**登录由插件编排,不要直接用 `auth login`**——裸命令会把设备码交给模型:

| 动作 | 调用 |
| --- | --- |
| 发起授权 | `call_tool(name:"auth login-start")`,把返回的 `verification_url` 按两行原样给用户 |
| 轮询完成 | `call_tool(name:"auth login-wait", args:{login_handle})`,发起后立即执行,不要等用户回复 |
| 查看登录态 | `call_tool(name:"auth status")`;人工页面交接需要环境地址且上下文没有 `serverUrl` 时用 `args:{offline:true}` |
| 清除凭证 | `call_tool(name:"auth logout")`(写操作,需用户确认) |

设备码、过期时间与轮询参数由插件保存在内存,不要尝试自行重建这些命令。展示话术、两行 URL 输出规则、轮询时机和"登录成功"回复口径以 `taptap-identity` 的登录规范为准,本文件不重复。access token 只由 CLI 保存到本机凭证存储,不得进入日志、埋点或错误上报。

**下面这些由用户在自己的终端执行,插件不代跑**(安装与升级不属于 TapTap 业务操作):

```bash
npm install -g @taptap/cli                # 安装 CLI
taptap-cli update --skills-layout suite   # 安装/更新 AI Skills
taptap-cli auth login                     # 用户自己补做授权
```

遇到认证错误时先看 `error.type` / `error.subtype`:凭证缺失、过期或被拒绝时,请用户运行 `taptap-cli auth login` 完成登录;CLI 不会自动重新登录。HTTP 502 属于服务端或传输故障,不能当作认证失效处理。

### 通用工具调用

```text
# ✅ 完整 operation input：业务字段按当前 schema 放进 data
call_tool(name:"app get-app-module", args:{app_id:"1", developer_id:"1", data:{module_id:"assets-upload"}})

# ✅ 长 JSON / 多行 JSON：写进会话工作目录里的文件，用 @ 引用
call_tool(name:"app save-changes", args:{app_id:"1", developer_id:"1", data:"@changes.json", idempotency_key:"<intent-key>", dry_run:true})

# ✅ 资源发现：用命令树查当前可用的能力
call_tool(name:"app +list", args:{dev_id:"1", page_size:50})
```

规则：

- 只有当前 action schema 声明的 flag 才会进入 input，未知 flag 会在请求前拒绝（插件原样透传，由 CLI 判定）
- `--dev-id` / `--app-id` 只在 operation 声明对应 scope 时注册；其余字段按 schema 放入 `--data`
- 动态命令的 `--data` 是完整 operation input；资源发现优先使用命令树中的 `developer` / `app` 命令
- `data` 支持内联 JSON 对象,或字符串 `"@relative-file.json"`(相对会话工作目录的文件);经本插件调用时没有可用的 stdin,`-` 不可用
- 短 JSON 用内联对象;复杂或多行 JSON 用 `@file`,文件必须位于会话工作目录(CLI 以会话工作目录为 cwd 解析该相对路径)
- `--dev-id` / `--app-id` 与 `--data` 中同名字段冲突时返回 validation error，不静默覆盖
- 默认输出是 JSON，普通命令、脚本、Skill 示例和生成命令都不追加冗余的 `--format json`
- 只有命令自身默认输出文本或原始内容，而调用方明确需要结构化 JSON 时才显式追加

### 命令树调用（优先给外部 agent 使用）

```text
list_tools()                                                                   # 顶层命令
call_tool(name:"app", args:{_help:true})                                       # 浏览 app 下的 method
call_tool(name:"schema", args:{_positional:["app","prepare-review-snapshot"]})
call_tool(name:"schema", args:{_positional:["app","precheck-app-review"]})
call_tool(name:"app prepare-review-snapshot", args:{app_id:"1", developer_id:"2"})
call_tool(name:"app precheck-app-review", args:{app_id:"1", developer_id:"2", data:"@review-precheck.json"})
call_tool(name:"app submit-app-review", args:{app_id:"1", developer_id:"2", data:"@audit-confirmation.json", idempotency_key:"review-submit-1", yes:true})
```

规则：

- `list_tools(category:"<service>")` 浏览该域的操作；`call_tool(name:"schema", args:{_positional:[service, method]})` 返回完整 input/output schema,它会在 metadata 缓存到期时做一次有界刷新。真实 operation 执行前若发现 catalog 已更新，CLI 会停止并要求重跑。
- metadata 标记为 write / high-risk-write 的 operation 缺 `yes:true` 时返回 `CONFIRM_REQUIRED`；`dry_run:true` 只预览最终 HTTP 请求。命令接受幂等键时，预览和真实写入都要传稳定 `idempotency_key`，并在同一业务意图内复用。当前提审前两步（`prepare-review-snapshot`、`precheck-app-review`）标为 `read`，无需确认；`submit-app-review` 仍为 `write`，需用户确认与稳定幂等键。
- 当前 schema 没有声明的风险确认或协议凭证字段不得由 CLI 补造。`precheck-app-review` 只在 `blockers` / `warnings` 里给出要求；SCE 等协议签署走独立的 `agree-sce-agreement`，`submit-app-review` 只传 `release_schedule`，其它无输入通道的要求仍报告契约缺口。
- 分页 flag 只在 operation 声明分页时注册（OpenAPI 名 `x-pagination`，catalog 里序列化为 `pagination`）；输出字段以 output schema 为准。
- `aliases` 只提供人类友好的转发，例如 `audit:submit`；手写 workflow shortcut 只编排 metadata 已声明的能力，不能扩展 API capability。
- `completion zsh|bash|fish|powershell` 从当前注册命令树生成补全（用户在本机终端执行，插件不提供）。

### Skills 安装（用户在自己终端执行,插件不代跑）

```bash
taptap-cli update --force
```

该命令会从与当前 CLI 版本对应的不可变 tag 或 commit 同步全局官方
Skills，避免默认分支内容与旧版 CLI 的命令或参数漂移。项目级安装必须使用
带版本锚点的 version-pinned 形式，不要省略 `#<tag-or-commit>`，也不要改用
默认分支的内容。

### 查工具 schema（不确定参数时先调）

```text
call_tool(name:"schema", args:{_positional:[service, method]})
# 返回完整 JSON Schema，含参数名、类型、枚举值等
```

### 资源发现

```text
call_tool(name:"developer +list")
call_tool(name:"developer +enter", args:{dev_id:"<developerId>"})
call_tool(name:"developer +suggest", args:{dev_id:"<developerId>"})
call_tool(name:"app +list", args:{kw:"游戏名"})
call_tool(name:"overview", args:{dev_id:"<N>"})
```

`developer +enter` / `developer +suggest` 用于 CLI 场景模拟 Web 侧进入厂商后的 starter prompts：输出官方号、制作人员认证、游戏发布、审核进度等推荐问题。`developer +enter` / `app +select` 会改写本机 CLI 配置(CLI 标为 write,需用户确认后加 `yes:true`)；`developer +suggest` 只读。保存 scope 后后续命令可省略对应 ID,显式参数始终优先。

`overview` 是账号总览入口：一次查看服务器、可见厂商、指定厂商的游戏样例、推荐问题和常用下一条命令；它只接受可选的 `dev_id` 与 `page_size`，不接受 `page_all` / `page_limit` / `page_delay`。需要完整游戏列表时，对明确的 developerId 调用 `call_tool(name:"app +list", args:{dev_id:"<developerId>", page_all:true, page_size:50})`。它不保存 scope，后续命令仍显式携带 `dev_id` / `app_id`。

### 文件上传

本地物料统一进入 `taptap-materials` skill（路由与边界见 [business routing](taptap-suite/references/business-routing.md)）。它负责盘点、确认用途、逐项调用六个端到端 shortcut，并把资料字段和包体绑定交给对应业务 skill。

- `materials +inspect <directory|archive>` 是该 skill 所需的只读盘点契约；它输出 manifest、skipped 和 handoff，供后续逐项上传。
- 当前用户只提供目录或混合 zip 时，先 `call_tool(name:"materials", args:{_positional:["+inspect","<目录或zip>"]})`，再让用户确认 manifest 中的歧义项和每个文件用途；然后按下方六个 shortcut 执行。不要把旧的批量写入命令作为替代。
- 文案文件由 Agent 直接读取，再按 `taptap-app-edit` 的 read-before-write 和用户确认流程处理。
- 上传成功后仍必须按结果句柄交接；不要把“文件已上传”说成“资料已更新”或“包体已绑定”。

用户提供本地图片文件时，先 upload 拿 HTTPS URL；CLI 会立即把图片收录到当前应用素材库，避免只拿到临时 URL 后丢失：

```text
# 预览（dry_run）
call_tool(name:"upload", args:{_positional:["./image.png"], app_id:"<id>", developer_id:"<id>", idempotency_key:"<upload-key>", dry_run:true})
# 用户确认后：完全相同的参数，把 dry_run 换成 yes
call_tool(name:"upload", args:{_positional:["./image.png"], app_id:"<id>", developer_id:"<id>", idempotency_key:"<upload-key>", yes:true})
# 返回 { url, info: { width, height, size, format }, width?, height? }
```

上传返回的业务句柄是 `url` 和 `info`；这些句柄写入字段时的 `value` 格式由字段写入归属方定义（资料字段按 `taptap-app-edit` 的 fields-and-packages，创建字段按 `taptap-publish-game` 的创建流程），本文件不把该口径扩展到“任何图片字段”。

图片素材库是游戏（app）级能力，所以 `upload` 必须带 `app_id` 和 `developer_id`。没有 appId 的创建前流程不能先上传图片；应先创建应用，或在创建后再上传并写入资料字段。

`upload` 仅用于图片。视频和 APK / PC / H5 包体用专用的 **app scope 上传命令**（必须带 `--app-id`，即游戏已创建后才能用；大文件直传云存储，不经过 taptap-cli）：

```text
# 视频（预告片 / 实机录屏）→ 七牛直传，返回 video_id（后台转码）
call_tool(name:"upload-video", args:{_positional:["<path>"], scene:"trailer", app_id:"<id>", developer_id:"<id>", dry_run:true})
# PC 包（exe / zip）→ OSS 分片直传，返回 packageId（后台解析）
call_tool(name:"upload-pc-package", args:{_positional:["./game.zip"], launch_exe:"game.exe", version:"1.0.0", app_id:"<id>", developer_id:"<id>", dry_run:true})
# APK → OSS 表单直传，返回 apkId（后台解析包名 / 版本）
call_tool(name:"upload-apk", args:{_positional:["./game.apk"], app_id:"<id>", developer_id:"<id>", dry_run:true})
# H5 zip → OSS 表单直传 + 解析 + 创建 H5 version，返回 h5PackageId / h5VersionId
call_tool(name:"upload-h5-package", args:{_positional:["<h5_zip>"], app_id:"<id>", developer_id:"<id>", dry_run:true})
# 竖屏 H5 可加 screen_orientation:1（默认 0 横屏）
# Tap 小游戏 zip → 上传 + complete + 轮询解析，返回 miniAppArtifactId / taskId
call_tool(name:"upload-mini-app-package", args:{_positional:["<mini_app_zip>"], app_id:"<id>", developer_id:"<id>", dry_run:true})
call_tool(name:"upload-mini-app-package", args:{_positional:["<mini_app_zip>"], app_id:"<id>", developer_id:"<id>", yes:true})
```

以上每条都先以 `dry_run:true` 预览;用户明确确认后,用完全相同的参数把 `dry_run` 换成 `yes:true` 执行。位置参数里的本地文件必须是**相对会话工作目录**的路径(CLI 以会话工作目录为基准校验并拒绝绝对路径与 `../` 越界)。

- 这些都是**游戏（app）级素材**：必须先有 appId（游戏已创建）。发布游戏 / 创建流程（developer scope，还没 appId）里它们仍是创建后步骤。
- `videoId` 用于写视频字段（`taptap-app-edit` 的 `save-changes`）；PC 包 / APK create 后由后台异步解析，可稍后查状态。
- H5 返回 `h5VersionId` 后，绑定资料页主包体仍走 `taptap-app-edit` 的 `package` 字段流程；不要把上传成功说成已经提交审核。
- Tap 小游戏上传产出 `miniAppArtifactId`（`packageRecordStatus=artifact_only`），不创建包体记录、不绑定资料页；绑定仍走 `taptap-app-edit`。自测二维码只适用于 `list-mini-app-packages` 里 `stage=dev` 的版本。
- 如果用户给的是目录 / zip 而不是单个确定类型文件，转 `taptap-materials`，先执行 `materials +inspect`，再按 manifest 和 handoff 执行单项上传。文案文件仍由 Agent 单独读取，并按 `taptap-app-edit` 的 read-before-write 和用户确认流程处理。

---
