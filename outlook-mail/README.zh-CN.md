# Outlook 邮箱插件 2.2.0

搜索、阅读、起草、发送和整理 Outlook、Hotmail、Live 与 Microsoft 365 云端邮件。全球版和世纪互联中国区分别管理多账号及默认账号。不支持其他邮箱服务商或仅使用 Outlook 客户端打开的本地 Exchange 邮箱。

邮件请求统一经过：

`插件邮件逻辑 → cindy.fetch → Host 注入 OAuth Token → Microsoft Graph`

插件运行于 Cindy 浏览器沙箱，不包含 Node worker、PowerShell、微软 SDK、本机可执行文件或运行时下载。Host 负责打开微软登录、校验回调、交换与刷新令牌、保存凭证，并仅向声明的 Graph 主机注入 Authorization。插件经 `/oauth` 获取账号元数据，无法读取或保存令牌。每次邮件请求带当前 `callId` 和明确解析的 `authAccount`。

## 连接

安装到 Cindy 0.1.75 或更新版本，在插件详情页选择邮箱所属区域并连接账号。设置页支持中文、英文、日文和韩文。发布者或企业 IT 需要为各服务区域配置已注册的公共微软应用 Client ID，无需客户端密钥。全球版已内置管理员提供的公共 Client ID，用户无需填写应用 ID 即可发起登录；中国区仍需单独注册并配置应用，未配置前连接按钮保持禁用。详见[应用配置](APPLICATION-SETUP.md)。普通用户通过已配置的应用授权自己的账号，无需自行申请应用；“管理员设置（可选）”仅供插件维护者或企业 IT 使用。

全球版申请 User.Read、Mail.ReadWrite、Mail.Send、openid 和 offline_access；中国区使用对应中国区 Graph 资源权限。这些均为用户委托权限，不是全租户 Application 权限；租户策略可能要求管理员批准。连接、断开和默认账号管理全部交给 Host，插件 KV 仅保存默认服务区域。

设置页同时按区域展示全部已连接账号，可以持续添加多个账号，不必退出已有账号；同一身份重新授权由 Host 作为重连处理。每行的重连、默认和断开操作绑定该账号自身的区域，不受上方新增账号服务选择影响。邮件调用传 `account` 时使用指定账号；只传 `cloud` 时使用该区域默认账号；都不传时使用保存的默认区域及其默认账号。断开一个账号不会退出其他账号或另一区域。中国区仍需配置独立应用。

不带参数调用 `outlook_accounts` 只查看连接元数据，不请求 Graph。核对账号地址时，将返回的账号 ID 作为 `profile_account`：只读 Graph 资料返回 `mail`（SMTP 地址，可能为空）和 `user_principal_name`（登录名）。`mail` 为空时不得用登录名代替；地址查询不证明可发送或已送达。使用现有 User.Read 委托权限，不返回令牌。

## 邮件操作

提供账号列表、KQL／结构化搜索、阅读、带 CC/BCC 的纯文本发送、草稿、分页文件夹、已读／未读及移动。读取不标记已读。写操作必须来自明确用户意图，并核对发件账号、收件人和内容。发送成功只表示微软接受，不代表送达。执行状态为 executed 或 unknown 的失败，必须先检查邮箱再决定是否重复。插件不重试邮件请求；OAuth 刷新及相关重试由 Host 决定。

请求上限约 250 KB、100 个收件人、每页 50 条。分页绑定账号、区域与操作。Microsoft KQL 搜索最多返回 1000 封；正文超过 50000 字符明确标记截断；移动后使用返回的新 ID。不包含回复／转发、共享邮箱、分类或删除；约 250 KB 限制用于文字/模板。

## 升级和验证

2.0.0 替换 SDK 授权路径，旧 SDK 会话与保存的账号元数据不再使用，需要通过 Host OAuth 重新连接。不会读取或清理其他微软工具的凭据缓存，也不会从旧 KV 自动恢复登录。

运行 `node --test .tests/outlook-mail.test.mjs` 和仓库规定的契约、本地化、provisioning、发布流程检查。提交后使用 `.github/scripts/package-plugin.sh outlook-mail /tmp/outlook-mail-2.2.0.cindy` 打包。浏览器测试使用模拟 Host 接口与虚构账号，不作为真实 OAuth 证据；见 `.tests/outlook-mail/settings-browser.mjs`。

管理员于 2026-09-09 提供了全球版公共应用 ID。已在 Cindy Beta 验证真实 Host OAuth 登录及单账号只读操作；确切包、客户端版本和当前覆盖范围记录于 PR。发送、草稿、标记和移动仍需获授权的真实邮箱验收；多账号与中国区保持未验证。早期 SDK 开发包结果不能替代本实现的验收。新插件准入和最终实机验收仍需维护者审查。provisioning 是空定向名单，不自动分发；测试及打包限制不作放宽。

## 文件附件（2.2.0）

下载和授权文件交接要求 Cindy 0.1.109 或更高。**附件发送和草稿还需要包含
uploadJson v1 的后续正式宿主版本**，目前该宿主接口尚未上线。在 0.1.109
安装此插件不会开启附件发送；普通邮件行为保留。能力探测不通过会在发信前
明确拒绝，不会悄悄丢掉附件后发送。

- `outlook_mail(action: "list_attachments", message_id, account)` 列出附件 ID、
  类型、大小和内嵌标记，不返回 contentBytes。分页绑定账号、区域和原邮件；
  page_token 必须同时保留原 message_id。
- `download_attachment` 指定 message_id 和 attachment_id，并在 **ghost_call
  顶层 save_dir** 指定已存在的授权目录。仅下载不超过 25 MiB 的常规
  fileAttachment（含内嵌图片）。文件名消毒，宿主保存时不覆盖同名文件。
  HTTP 200 且保存回执字节数与 Graph 元数据一致才报成功；不一致会报错，
  目标目录可能已留下文件，不应将它当作验证成功的文件。
- `prepare_attachments` 通过 **ghost_call 顶层 dir** 交付单文件或只含目标附件
  的目录，返回文件名、合计大小及宿主能力，不访问邮箱、不发送。此检查不能
  保证后续文件内容不变；发送或起草时必须重新交付 dir。
- `send` / `draft` 带附件需 `with_attachments: true` 和新交付的顶层 dir。
  最多 10 个文件，原始字节合计不超过 2 MiB。宿主凭一次性票据读取文件，
  在 JSON 的 null 占位填入 base64 并直接发出；本地路径和字节不能放入 args
  或模型上下文。失败或过期票据需要重新交付；结果未知先核对邮箱，不能直接
  重发。uploadJson 模式不跟随跳转，也不因 HTTP 401 自动重放请求。

约 250 KB 限制仍用于文字/JSON模板，不包括附件原始字节。2 MiB 合计上限为
base64 和文字预留空间，使宿主最终请求低于 4 MiB，也低于 Graph 常规附件
小于 3 MB 的路径限制。不支持嵌套邮件/事件、云引用或大附件上传会话。
发送使用 application/octet-stream 和原文件名。Graph 202 仅表示接受发送，
不是收件人收到邮件的证明。

官方依据：[sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0)、
[添加附件](https://learn.microsoft.com/en-us/graph/api/message-post-attachments?view=graph-rest-1.0)、
[下载附件](https://learn.microsoft.com/en-us/graph/api/attachment-get?view=graph-rest-1.0)、
[大附件](https://learn.microsoft.com/en-us/graph/outlook-large-attachments)。

自动测试使用虚构账号和文件。真实发信、附件草稿及邮件附件下载仍需用户指定
目标后验证；本地文件交接不能替代生产邮箱验收。未新增账号权限、设置、凭据
存储或 Node 能力。本机回退可使用保留的 2.1.2 包，无需断开账号。
