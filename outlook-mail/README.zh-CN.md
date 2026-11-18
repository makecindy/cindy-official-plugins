# Outlook 邮箱插件 2.3.0

搜索、阅读、起草、回复、转发、发送和整理 Outlook、Hotmail、Live 与 Microsoft 365 云端邮件。全球版和世纪互联中国区分别管理多账号及默认账号。不支持其他邮箱服务商或仅使用 Outlook 客户端打开的本地 Exchange 邮箱。

邮件请求统一经过：

`插件邮件逻辑 → cindy.fetch → Host 注入 OAuth Token → Microsoft Graph`

插件运行于 Cindy 浏览器沙箱，不包含 Node worker、PowerShell、微软 SDK、本机可执行文件或运行时下载。Host 负责打开微软登录、校验回调、交换与刷新令牌、保存凭证，并仅向声明的 Graph 主机注入 Authorization。插件经 `/oauth` 获取账号元数据，无法读取或保存令牌。每次邮件请求都带明确解析的 `authAccount`。工具调用的请求另带当前 `callId`；草稿卡的自动保存、发送和删除没有 Agent 调用，只使用已声明的 Graph 主机和卡片记录中的账号。

## 连接

安装到 Cindy 0.1.112 或更新版本，在插件详情页选择邮箱所属区域并连接账号。设置页和工具返回的提示跟随 Cindy 语言（中文、英文、日文或韩文），其他语言使用英文。发布者或企业 IT 需要为各服务区域配置已注册的公共微软应用 Client ID，无需客户端密钥。全球版已内置管理员提供的公共 Client ID，用户无需填写应用 ID 即可发起登录；中国区仍需单独注册并配置应用，未配置时直接显示 Client ID 必填表单，保存后才出现“添加邮箱”。详见[应用配置](APPLICATION-SETUP.md)。普通用户通过已配置的应用授权自己的账号，无需自行申请应用；自定义应用修改收在“更多设置 → 连接应用”，授权说明也默认折叠。服务下拉位于“连接邮箱”右侧：勾选代表当前查看的服务，“默认”标签代表已保存的默认服务。切换仅更新表单，点击“将当前服务设为默认”才保存默认值。

全球版申请 User.Read、Mail.ReadWrite、Mail.Send、openid 和 offline_access；中国区使用对应中国区 Graph 资源权限。这些均为用户委托权限，不是全租户 Application 权限；租户策略可能要求管理员批准。连接、断开和默认账号管理全部交给 Host，插件 KV 保存默认服务区域和 Cindy 草稿卡的定位记录（账号、草稿 ID、版本标记和回执，不含正文或令牌）；两处写入共用同一把锁并保留彼此的键。

设置页在同一张卡片中展示全部已连接邮箱，底部提供连接另一个账户的入口；服务、状态、默认账号和断开操作收在该行“⋯”中，授权异常和重连入口直接显示。可以持续添加多个账号，不必退出已有账号；同一身份重新授权由 Host 作为重连处理。每行的重连、默认和断开操作绑定该账号自身的区域，不受上方新增账号服务选择影响。邮件调用传 `account` 时使用指定账号；只传 `cloud` 时使用该区域默认账号；都不传时使用保存的默认区域及其默认账号。断开一个账号不会退出其他账号或另一区域。中国区仍需配置独立应用。

不带参数调用 `outlook_accounts` 只查看连接元数据，不请求 Graph。核对账号地址时，将返回的账号 ID 作为 `profile_account`：只读 Graph 资料返回 `mail`（SMTP 地址，可能为空）和 `user_principal_name`（登录名）。`mail` 为空时不得用登录名代替；地址查询不证明可发送或已送达。使用现有 User.Read 委托权限，不返回令牌。

## 邮件操作

提供账号列表、KQL／结构化搜索、阅读、草稿、回复与转发、分页文件夹、已读／未读及移动。读取不标记已读；搜索和阅读结果中的 `web_url` 绑定了账号（`cindy_account`），可在回答中引用。写操作必须来自明确用户意图，并核对发件账号、收件人和内容。发送成功只表示微软接受，不代表送达。

写信使用 Cindy 公共邮件流程：`draft`、`reply_all`（默认回复方式，排除本邮箱、重复地址和密送）、`reply`（用户要求时仅回复发件人）和 `forward` 创建草稿，读回后展示 Cindy 可编辑的草稿卡。卡片编辑通过 `If-Match` 版本校验自动保存到 Outlook 草稿；若草稿已在 Outlook 中修改，会与卡片编辑合并，不会被覆盖。`get_draft`、`update_draft`、`delete_draft` 走同一流程；`send_draft` 在 10 秒撤销倒计时后发送卡片的最新内容；拒绝直接 `send`。HTML 草稿保留原文档头部和 Outlook 的回复引用，只替换正文内容。Exchange 可能规范化 HTML 标记，因此保存后按可读文字、内嵌图片引用、收件人、主题和附件名核对。卡片可以删除附件、改名或改为内嵌（3 MB 以内的普通文件附件会重新创建）；本插件没有读取本地文件的 Node worker，所以不支持在卡片中新增文件。没有邮件 SDK 的旧版 Cindy 仍可读取草稿，但不能创建、修改或发送。

`outlook_read_message` 为 Outlook 网页邮件链接（`outlook.office365.com`、`outlook.office.com`、`outlook.live.com`、`outlook.cloud.microsoft`、`partner.outlook.cn`）提供 Cindy 原生阅读，返回当前邮件、附件和会话摘要；只在用户主动打开时把这一封标记为已读，并返回 `executed`、`not_executed` 或 `unknown`。没有绑定账号的链接，仅在该区域只连接了一个账号时才会解析。执行状态为 executed 或 unknown 的失败，必须先检查邮箱再决定是否重复。插件不重试邮件请求；OAuth 刷新及相关重试由 Host 决定。

请求上限约 250 KB、100 个收件人、每页 50 条。分页绑定账号、区域与操作。Microsoft KQL 搜索最多返回 1000 封；正文超过 50000 字符明确标记截断；移动后使用返回的新 ID。不包含新增附件、共享邮箱、分类或删除非草稿邮件。

## 升级和验证

2.0.0 替换 SDK 授权路径，旧 SDK 会话与保存的账号元数据不再使用，需要通过 Host OAuth 重新连接。不会读取或清理其他微软工具的凭据缓存，也不会从旧 KV 自动恢复登录。

运行 `node --test .tests/outlook-mail.test.mjs` 和仓库规定的契约、本地化、provisioning、发布流程检查。提交后使用 `.github/scripts/package-plugin.sh outlook-mail /tmp/outlook-mail.cindy` 打包。浏览器测试使用模拟 Host 接口与虚构账号，不作为真实 OAuth 证据；见 `.tests/outlook-mail/settings-browser.mjs`。

管理员于 2026-09-09 提供了全球版公共应用 ID。已在 Cindy Beta 验证真实 Host OAuth 登录及单账号只读操作；确切包、客户端版本和当前覆盖范围记录于 PR。发送、草稿、草稿卡、回复、原生阅读、标记和移动仍需获授权的真实邮箱验收（2.3.0 的邮件流程测试使用模拟 Graph 邮箱）；多账号与中国区保持未验证。早期 SDK 开发包结果不能替代本实现的验收。新插件准入和最终实机验收仍需维护者审查。provisioning 是空定向名单，不自动分发；测试及打包限制不作放宽。

## 配置页开发

配置页将 React 与 shadcn/ui 的 Radix DropdownMenu 组合随包编译；Button、Input、Collapsible 统一封装，遵循 Cindy 语义主题变量、胶囊控件和 12px 菜单容器。服务菜单与触发器等宽，并为宿主自动高度测量预留真实展开高度；窄卡片自然换行，不缩字号。外链按 Forge §4.8 使用普通同页 HTTPS 链接。不引入 CDN、宿主组件引用、运行时依赖下载或新的凭证路径。

修改 `src/` 后运行 `cd outlook-mail && npm ci && npm run build`，同时提交 `settings.js`、锁文件和生成的 `THIRD-PARTY-LICENSES.txt`，不要直接修改构建产物。react-remove-scroll-bar 2.3.8 的 npm 包缺少许可文件，已从上游提交 `8ca9ba5ea52de03308fe8ced94f7b159a44d28ff` 留存到 `src/licenses/`。
