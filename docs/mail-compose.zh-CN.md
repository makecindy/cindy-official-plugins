<p align="right"><strong>简体中文</strong> · <a href="mail-compose.md">English</a></p>

# 公共邮件编写流程

阅读邮件也复用 Cindy 的展示。声明 `mail: true` 和
`mailReader: { "tool": "your_read_message", "hosts": ["mail.example.com"] }`，并正常声明该只读工具。
Cindy 匹配 HTTPS 链接后传入 `{url}`；返回字符串字段 `accountId`、`messageId`、`from`、`to`、`cc`、`bcc`、`subject`、`date`、`bodyText`、`bodyHtml`，以及现有格式的 `attachments`。
插件负责账号定位和 HTTP/IMAP/MIME 读取，默认不能标记已读、编辑、删除、发送或创建草稿卡。
支持自动已读的插件可声明 `mailReader.markRead:true`，同一个工具接受可选 `markRead:true`。
Cindy 仅在用户主动打开时传入此参数，AI 读取和邻近预加载不传。成功读取后只标记当前选中的那封邮件，不标记整个会话或草稿。
尝试标记已读后，返回 `markReadResult: {execution: 'not_executed'|'executed'|'unknown', message?}`。
执行状态以插件收到的写入回执为准：确认成功为 `executed`，明确拒绝为 `not_executed`，未获确认的超时、连接中断或服务端错误为 `unknown`；三种结果都保留可读正文。
仅 `not_executed` 可额外附带兼容字段 `markReadFailed:true`，不能用它表示未知结果。`unknown` 提示先在邮箱核对状态，不提示盲目重试，也不自动重试。
没有尝试写入时省略结果，包括后台读取、已读邮件和草稿；旧主机不传请求参数，旧插件仍按只读工作。
新增 OAuth scope 不能禁用已有的阅读和发送授权；仅缺少新权限的操作提示重新连接。
多账号不默认选第一个；AI 答案提供带账号信息的原邮件链接。电脑侧边预览，手机全屏阅读；不支持的主机沿用浏览器打开。
Gmail 支持十六进制邮件和会话 ID；网页专用的不透明 ID 仍需在 Gmail 打开。非图片附件展示元数据，下载仍可在邮箱中完成。

读取工具可额外返回 `conversation: {threadId, messages: [{messageId, url, from, date, subject, snippet}]}`。
摘要按时间排序，字段均为字符串，最多 1000 封，ID 唯一且包含当前邮件；每条 URL 使用插件声明的 HTTPS 域名并明确绑定同一个邮箱账号。
Cindy 默认定位当前邮件，展开其他邮件时才通过同一个工具读取正文，并核对账号和邮件 ID。长会话默认收起中间摘要，当前邮件始终可见。
会话摘要读取失败时仍返回当前邮件，附加 `conversationUnavailable: true`，不能把不完整的会话当成完整结果。
旧客户端忽略这些可选字段，继续显示当前邮件；旧插件返回的单封邮件仍可正常显示。

邮件卡片、样式、自动保存、发送和任务续接由 Cindy 统一提供。插件只实现账号和邮箱操作，通过主机 `cindyMail` SDK（version 1）注册适配器，不打包公共流程，也不生成卡片 HTML。已接入的插件：Gmail、Outlook（Microsoft Graph），以及 IMAP/SMTP 的 QQ 邮箱、163 邮箱、iCloud Mail、Yahoo Mail。Gmail 已用真实邮箱验证；Outlook 和各 IMAP 插件目前只在模拟邮箱中验证（见下方「各邮箱实现说明」）。

## 各邮箱实现说明

- **IMAP/SMTP**（QQ、163、iCloud、Yahoo）共用一套适配：Node Worker 中的 `src/mail-compose.cjs` 与 `main.js` 中的 `cindy-imap-compose` 代码块。各插件副本必须一致，`.tests/imap-mail-compose.test.mjs` 会核对并对每个插件运行同一组端到端测试。草稿的 Message-ID 作为稳定的 `draftId`；locator 为 folder + UID + UIDVALIDITY，失效时按 Message-ID 查找。IMAP 不能原地修改邮件，每次保存先追加新版本、读回核对，确认后才删除旧版本；fingerprint 为所存邮件的 SHA-256。发送时按已核对的草稿重建邮件且不含 Bcc 头（密送只放在 SMTP 信封中），成功后删除草稿；SMTP 在 DATA 之前拒收全部收件人记为 `not_executed`，其余中断一律为 `unknown`。是否在「已发送」保存副本仍由邮箱服务决定，与以前一致。
- **Outlook** 使用 Graph 原生草稿、`createReply`/`createReplyAll`/`createForward` 和 `/send`，并通过 `mailReader` 支持 Outlook 网页链接的侧栏阅读。它没有 Node Worker，暂不支持在卡片中新增本地文件；删除、改名或把已有附件设为内嵌可以使用。
- 以上插件都拒绝直接发送的工具动作，邮件只能经草稿卡流程发出。

## 适配接口

每个插件 origin 创建一个流程实例：

```js
const mail = cindyMail.register({
  providerName: '邮箱名称',
  draftStorage: 'server', // 或 local；本地草稿不能显示成已同步到服务器
  storageLock: 'my-plugin-settings', // 可选：与插件其他替换 KV 的写入共用锁名
  async selectAccount(accountId) { /* 返回 {ok:true, accountId, accountEmail} 或错误 */ },
  async readDraft({record, sourceCallId}) { /* 返回标准草稿快照 */ },
  async writeDraft({record, account, fields, send, sourceCallId}) { /* 保存或发送 */ },
  async deleteDraft({record, account, sourceCallId}) { /* 可选：删除存储中的草稿 */ },
});
```

- 账号 ID 为不透明标识，不得静默换账号。适配器检查连接和授权；凭证仍由 Host 注入，公共记录只保存定位信息和回执。
- `sourceCallId` 仅在当前有 Agent 调用时提供。卡片编辑没有 Agent 调用 ID；`record.callId` 是展示卡片 ID，不能用它授权 HTTP。Node 适配器沿用固定端点和凭证绑定；HTTP 适配器必须声明卡片自动保存/发送所需的 hosts 和凭证注入。
- `readDraft` 返回 `{ok:true,data:{readBack:snapshot}}`。
- 可选的 `deleteDraft` 启用公共“删除草稿”按钮。使用当前 record/locator 删除邮箱或本地存储中的草稿，确认成功后返回 `{ok:true,data:{deleted:true,draftId:record.draftId}}`。SDK 与保存、发送共用锁，取消待处理的自动保存和发送倒计时，读回核对草稿身份并刷新 locator。明确删除的是整份草稿（包括更新后的版本），不套用保存/发送的冲突检查；读回前显示删除进度，准备阶段失败允许重试。卡片点击和模型的 `beforeTool({operation:'delete',...})` 使用同一路径；删除成功后卡片只读，结果未知时阻止后续写入且不自动重试。未实现此方法的适配器保留原工具路径，不显示按钮。
- `writeDraft` 的 `send:false` 保存并校验完整草稿，返回 `{ok:true,data:{readBack:snapshot}}`；`send:true` 校验当前版本后发送既有草稿，返回 `{ok:true,data:{sent:true,receipt:{...}}}`。这里 `sent` 表示服务已接受发送，不代表送达。保留 `delivery_confirmed:false`、SMTP 接受/拒绝的收件人等原始事实。回执应可 JSON 序列化、大小有界，不含凭证和邮件正文。
- 失败返回 `{ok:false,execution:'not_executed'|'executed'|'unknown',message}`。发现外部修改时另设 `stale`，禁止静默覆盖。写请求抛错、无回执或回执不完整都视为结果未知，不自动重放；任务续接失败不改变已经成功的发送。

标准快照示例：

```js
{
  status: 'read_back',
  draftId: 'stable-logical-id',
  fingerprint: 'opaque-version',
  locator: { folder: 'Drafts', uid: 42, uidValidity: '700' }, // 可选，公共层不解析
  headers: { from: 'self@example.test', to: 'person@example.test', cc: '', bcc: '', subject: 'Hello' },
  editor: { editable: true, body: 'Message', quote: '' },
  attachments: [{ filename: 'example.pdf', mimeType: 'application/pdf' }]
}
```

`draftId` 是编写期间稳定的逻辑 ID。底层位置可变化：保存后返回新 `locator`，后续读取和发送会获得新位置。IMAP 可以携带 folder、UID、UIDVALIDITY；API 可以携带原生消息 ID。`fingerprint` 是不透明版本，不要求指定哈希算法。适配器写入前比较版本，保留回复头、附件和未修改的富文本。无法完整保留草稿时设 `editable:false`，不把 HTML 邮件的截断正文重新组装发送。文字字段限每项 16,000 字符，HTML 字段 64,000 字符，Host 邮件卡片总计 1 MiB；普通插件 HTML 仍为 32 KiB。正文保存在适配器草稿存储及 Host 常规卡片历史中，不写入公共 KV 记录。

## 图文、HTML 与附件

能够完整保留 MIME 的适配器声明 `richText: true`，返回 `editor.bodyHtml`、`editor.quoteHtml` 和附件 `key`、`filename`、`bytes`、`contentId`。`key` 标识当前快照中的附件，未知 key 必须拒绝，不能作为路径使用。公共表单增加 `bodyHtml`、`quoteHtml`、`attachmentItems`（JSON 元数据清单）；移除清单项就是删除对应附件。HTML 由 AI 通过邮箱工具编写和更新，卡片支持在图文正文中直接打字删改及放大查看，没有编辑模式按钮、源码或格式工具栏；文字修改只修补原始 HTML 并同步纯文本版本。`editor.format: "text"` 沿用原有紧凑纯文本输入；其他图文草稿直接显示可编辑的 HTML 正文。纯文本输入改变时，适配器重新生成对应 HTML。

`writeDraft` 同时收到 `attachments`，来自电脑原生选择器，或手机选择后通过既有附件上传通道传到 Host 的文件：`{path,filename,bytes,sha256,contentId?}`。手机不能指定电脑路径，Host 校验上传引用并物化为本机文件；适配器读取前复核大小、哈希并拒绝符号链接。内嵌图片具有 Host 生成的 CID。文件描述符只存在于本次编辑内存中，不写入卡片和 KV，保存并读回成功后消费一次。发送先同步全部附件，再进入倒计时；上传结果未知时不自动重放。新增附件限单件 16 MiB、合计 25 MiB。手机原生卡片支持选择文件、普通附件移除、HTML 正文直接编辑及 CID 图片预览和放大查看；发送、撤销、删除和自动同步共用电脑上的公共流程。

可选快照 `images: [{cid,url}]` 提供 `cindy-media://` 预览地址，只供显示；保存和发送始终保留原 `cid:` 引用。Gmail 使用现有 Host 媒体寄存能力提供预览，并通过固定 Gmail API 的草稿 PUT 更新完整 MIME，保留图片字节、引用、回复头和线程；发送仍为既有草稿发送操作。预览失败不改变已成功保存的回执。其他邮箱适配器实现并验证同样的保留契约后，才能开启图文能力。

## 接入顺序

Cindy 在展示、自动同步和发送前统一整理图文内容：回复中的完整 HTML 文档转为片段，body 属性保留到容器；缺失纯文本版本时补齐；按已知 MIME 类型补上缺失的文件扩展名；受管图片预览地址还原为对应附件的 CID。图片引用缺失或重复时明确提示并阻止发送。整理稿先保存、读回核验，再进入倒计时；适配器若重新引入错误结构，不能继续发送。已有纯文本及普通 HTML 片段保持原样。这是结构兜底，不保证各邮件客户端像素一致，也不承诺任意 CSS 支持或图片压缩。
适配器必须落实传入的附件 filename、key、Content-ID，核对保存后的 MIME 和图片字节，保留回复头，传输整理后的 HTML/纯文本，不重新拼接旧引用。不要在各插件复制格式策略；公开适配器参数不变。

1. 通过邮箱服务新建草稿或回复，默认回复所有，排除自己、重复地址和 Bcc；用户明确要求时仅回复发件人。完整读回后调用 `mail.present(message, account, snapshot)`。
2. SDK 自动接收卡片事件，插件不要再转发。它先捕获编辑，再通过适配器保存和发送同一份最新草稿，并使用 Host 票据续接任务。
3. 工具读取、发送、更新、删除已展示的草稿前调用 `mail.beforeTool({operation:'get'|'send'|'update'|'delete', account, draftId, readOnly, sourceCallId})`。只使用 Host 注入的只读状态，只有 `readOnly:false` 允许写入。非 null 结果必须直接返回，不能失败后改发旧稿或直接发送。返回 null 时才执行原生操作，表示没有托管卡片，或更新/删除前已完成同步。
4. 同步可能改变底层 ID，原生操作前用 `await mail.resolveDraft(account, draftId)` 取得最新 locator。工具更新或读取后展示新快照。插件重启后，下一次卡片编辑或工具操作会自动读回原草稿，恢复同一卡片关联并保留未同步修改。Host 现有卡片保存上次同步的内容，和卡片编辑、邮箱最新内容做三方比较；相同变化、单边变化和不重叠的文字修改自动合并，只有无法合并的修改才提示具体字段。版本标记或预览地址变化本身不算冲突。适配器明确返回 `not_executed` 的过期写入可合并后重试一次；未知写入不重试。发送倒计时结束时若发现内容变化，展示合并稿并重新倒计时。待确认/未知结果仍然阻止重发，旧倒计时不会恢复。

无需重命名原有工具，也不额外增加一套 AI 工具目录，只将既有 command/action 映射到上述操作。卡片发送成功续接原任务；AI 发送直接返回当前回合，不额外启动任务。新邮件隐藏空引用，回复使用相同表单和发送路径。客户端先等编辑交付，再把用户的聊天指令交给模型。

## 打包与验证

清单声明 `mail: true` 和 `agent: {}`，纯邮件插件无需 `card`。Cindy 在插件入口之前加载 SDK，插件只传入适配器。先检查 `typeof cindyMail !== 'undefined' && cindyMail.version === 1`；旧客户端保留只读查询，编辑或发送草稿时提示更新 Cindy，不绕开公共流程。

编辑和自动同步原位更新当前卡片；后续重新读取展示时，同一插件实例、账号、草稿 ID 在当前任务内只显示最新卡片，旧卡片及其插件标签不再重复展示，历史快照仍保留。主题不作为身份依据。旧发送入口由主机拒绝，发送成功后不能再次发送。

运行 `.tests/mail-compose.test.mjs` 和 Gmail 测试；`.tests/contracts/cindy-mail-runtime.js` 是 Cindy SDK 的测试快照，不进入插件安装包。Cindy 仓库直接测试 SDK 源码、卡片生命周期、归属和客户端呈现。IMAP 插件还要运行 `.tests/<插件>.test.mjs`，其中包含共用的端到端测试。模拟 IMAP/Graph 测试不代表真实邮箱已验证或邮件实际送达。

默认先展示草稿卡，等用户确认收件人和内容后发送。只有用户已明确确认该邮件，或有效的用户/任务指令明确授权该范围内直接发送时，才不再询问；写信/回复请求、编辑和自动审批本身不代表确认。点击卡片发送即为确认。即使已授权直接发送，也必须展示同一草稿卡、使用最新编辑内容，不得通过底层直发、CLI 或其他旁路跳过。卡片和 AI 发送均先等待 10 秒，卡片提供“撤销”和“立即发送”，倒计时结束后才调用适配器 send:true。beforeTool(send) 等待最终回执；撤销保留草稿，不自动重试；重启不恢复等待中的发送。直发工具命令必须进入同一流程。

附件元数据可带 `mimeType` 和 `previewUrl`（仅接受受管图片 URL）；两端显示文件类型和大小，图片使用现有查看器打开。删除内嵌图片时，同时移除 MIME 附件与对应的 CID 图片节点，保留 HTML 的 head 样式。“插入正文”为已有图片 key 分配未占用的 image-N@cindy.local Content-ID 并插入 HTML 图片；适配器核验实际图片字节，复用同一 MIME 附件，不重复上传。适配器按附件 key 和规范化 Content-ID 判断变更，忽略预览 URL 等显示元数据。
