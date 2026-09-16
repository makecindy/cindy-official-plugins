# Google Workspace gog 分发与审查证据

## 来源与范围

- 上游：[`openclaw/gogcli` v0.39.1](https://github.com/openclaw/gogcli/releases/tag/v0.39.1)。
- 标签对应源码提交：`6895139ab1b46c2f0548d0244c345ef5f68663b1`。
- Go Google API 依赖：`google.golang.org/api v0.297.0`，见上游 `go.mod`。
- `scripts/build-google-workspace.mjs` 下载六个平台的原版发布归档，核对 `gog-lock.json` 的归档 SHA-256，再压缩原版执行文件；未修改或重新编译 gog。
- 各插件 `vendor/gog/binaries.json` 保存压缩文件、原始执行文件与上游归档的校验值。2026-09-16 对四插件全部 24 个 br 文件及解压后文件复核通过。hash 证明内容一致性，不等同于对上游二进制的安全认证或可复现构建证明。
- 每个插件独立携带文件；无客户端内置 gog、跨插件运行时依赖、按需外部下载或系统 gog 兜底。

## 网络目标与可达性

以下是四个服务命令树可达的 Google 客户端初始 API 目标；源码证据来自上述固定提交的 `internal/cmd/runtime_services.go`、`internal/googleapi/factory.go` 和对应 service 文件，目标常量来自 Google API v0.297.0 的 `<service>/<version>/*-gen.go`。

| 目标 | 归属及用途 | 证据 |
|---|---|---|
| `gmail.googleapis.com` | Google Gmail API | `internal/googleapi/gmail.go`、`gmail/v1/gmail-gen.go` |
| `www.googleapis.com` | Google Drive v2/v3、Calendar v3 | `internal/googleapi/drive.go`、`calendar.go` |
| `sheets.googleapis.com` | Google Sheets API，包括 Connected Sheets 请求 | `internal/googleapi/sheets.go` |
| `driveactivity.googleapis.com` | Google Drive 活动查询 | `internal/cmd/drive_activity.go`、`internal/googleapi/driveactivity.go` |
| `drivelabels.googleapis.com` | Google Drive 标签 | `internal/cmd/drive_labels.go`、`internal/googleapi/drivelabels.go` |
| `people.googleapis.com` | Gmail 联系人解析、Calendar 目录查询 | `internal/cmd/gmail_compose.go`、`gmail_search.go`、`calendar_users.go` |
| `cloudidentity.googleapis.com` | Calendar team 的 Google 群组查询 | `internal/cmd/calendar_team.go`、`internal/googleapi/cloudidentity.go` |

这些均是上游既有 Google API，不是插件新增的第三方接收端。部分命令需要当前账号未取得的 scope：插件不会为此扩大 scope 或自动重新授权，Google 仍可能拒绝。声明中的 OAuth scope 与主分支保持一致。

SDK 还包含对应的 mTLS endpoint 常量及 universe 模板；Worker 不继承这些端点选择环境变量，不接受全局 endpoint/config/auth 参数。初始 API 目标不等于任意时刻的完整网络抓包：SDK 的 HTTPS 重定向/DNS、Google 服务端执行的链接或 Connected Sheets 数据访问，不应伪称已做全路径动态审计。

排除的路径：
- `gmail settings watch`、`track`，Drive 的 `changes poll/serve/watch`、`sync`、`alias`，Calendar `propose-time` 不向模型暴露，执行查找也不能命中。
- `track`、`track-split`、Zoom 及 Places 选项被剔除；不继承 gog/Google 配置、hook、代理或其它服务凭据环境。
- 本体之外的 Google 服务根命令、auth/config/serve 等不在各插件固定的服务命令树中。
- 构建下载使用 `github.com/openclaw/gogcli/releases/download/...`，重定向到 GitHub 发布资产设施；这是开发构建路径，不携带 Google token，也不会发生在用户运行时。
- Google OAuth 登录/刷新仍由 Cindy Host 管理，不通过 gog 登录。上游 `internal/cmd/root.go` 接收 `GOG_ACCESS_TOKEN`；`internal/googleapi/client_auth.go` 的 direct-token 分支使用 `oauth2.StaticTokenSource`，先于本地凭据读取与刷新分支。

## 执行边界

- 仅 `schema` / `run` 两种 Node 方法；Host OAuth secret binding 只允许 `run`，账号由 Host 按插件及不透明账号 ID 解析。
- `spawn` 的执行文件固定为校验后的私有临时 gog；不使用 shell、`exec`、命令字符串拼接或模型指定执行文件。
- 服务前缀在打包时固定，命令路径和选项名称必须在同一随包 gog 返回并过滤后的 schema 中存在；位置参数不允许以 `-` 开头，选项采用单独的 `--name=value` argv 元素，不能作为额外全局开关注入。
- 模型可以提供业务参数，这是 CLI schema/run 的实际契约，不是任意 shell 执行。它使用普通 Node `child_process.spawn`，未声明或调用 Host 的 `node.childSpawn` / `spawnEntry` 桥。按 `.greptile/rules.md` 的“授权跟随执行者”审查，不将自主 `childSpawn` 的固定参数示例扩成所有业务参数必须硬编码。
- 文件路径保留当前工作区及符号链接边界。JSON `@file` 与 `-file` 路径一样校验，包含前后空白的输入也不能绕过。
- 每次命令独立 HOME/配置目录，只给当前调用短期 token。无 refresh token、令牌文件或共享账号配置；输出精确脱敏当前 token。
- Node 是当前 OS 用户级可信代码，不是系统沙箱；schema/argv 校验和私有目录不构成对恶意同权限进程的隔离。

## 扫描结果与人工边界

- 扫描 `scripts/google-workspace` 可读适配代码：未发现 `eval(`、`Function(`、`exec(` 或大段 base64 执行载荷。所有命令通过固定二进制和 argv 数组运行。
- 上游四服务命令的 `http.NewRequest`、`http.Get`、`exec.Command` 路径专项检查：追踪/网页跳转/回调服务在上述排除路径；Google API 经固定版本 SDK 工厂构造。
- br 文件是完整编译程序，不是可逐行审阅的 JS。静态源码检查及 hash 对照不能代替维护者对供应链、所有平台真实内容及网络行为的人工 review。本 PR 属于高风险敏感变更，不应自动批准。

## 原审查问题处理

- KV 读取失败：仅失去昵称展示，不再隐藏有效账号；保存仍要求先读成功，避免覆盖历史偏好。
- `scope_stale`：与设置页保持一致，执行前提示重新连接指定账号，不替换其他账号。
- JSON `@file`：增加路径校验与越界/符号链接/空白回归；保留合法工作区文件用法。
- 动态 argv：保留已确认的 CLI 接入方式，以上述调用路径、固定可执行文件、schema 与 Session 边界给出核查依据，不改成无限扩张的逐命令业务封装。

原迁移包四插件已在 Cindy Beta 0.1.82 实测。2026-09-16，基于提交 `3ce0a05` 打包的四个 gog-only 插件完成补充实机验收；包版本分别为 Gmail 1.3.0、Drive 1.2.0、Calendar 1.4.0、Sheets 1.2.0，最低 Cindy 版本保持 0.1.82。最终验收沿用 Beta 渠道，未另行记录客户端具体补丁版本。

最终包不再包含旧 Google REST 工具入口。仓库发布、本地化、provisioning、workflow 门禁及账号/路径/日历卡片回归通过；四个随包 gog 的实际 schema 已启动查询，确认附件、上传下载、日历读写与表格读写导出命令可发现。命令发现检查不替代真实账号实机验收。
