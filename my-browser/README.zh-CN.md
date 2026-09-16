# 我的浏览器

[English](README.md)

连接 Cindy 与日常浏览器登录态的本地候选插件。**0.3.x** 增加内容优先读取、浏览器／用户配置隔离、极简 Art 图标及分浏览器安装向导。**尚不是已公开分发的普通用户正式版。**

## 内容读取与网页操作分开

- 公开网页：使用宿主普通网页读取能力，不需要浏览器插件。
- 已登录网页：`browser_read` 直接提取有大小上限的 DOM 内容。默认 `content` 返回正文和链接，`extract` 返回记录。插件内部等待内容就绪，不通过多轮模型调用轮询空壳。
- X 回复／提及：`browser_read({recipe:"x_mentions",limit:5,maxChars:4000})` 一次完成目标页、等待、正文、作者、时间及链接提取，不先读取首页／菜单，不提取私有 API 凭证，不点击 UI。这是当前渲染的一部分，不是全部历史，也不保证仅含未读通知。
- 网页操作：需要时才用限定区域的 `snapshot` 获取新 ref，然后在站点授权下 `browser_act`。读取不需要交互授权。
- 多个配置同时连接：传入 `browser` 连接 id；歧义返回 `BROWSER_REQUIRED`，不猜测账号。标签列表支持 `host` 与 `limit` 筛选。
- `after` 在最新优先的列表中返回已见永久链接之前的记录。`cursorFound:false`、`truncated:true` 都不能解释为已经读全。不自动滚动。

按需编排手册在 `manual/browser/MANUAL.md`。参数名和枚举值不随语言变化。

## 浏览器支持与安装就绪状态

| 浏览器 | 代码／产物 | 验证和分发状态 |
| --- | --- | --- |
| Chrome | 共用 MV3 扩展，Chrome 120+ | 真实 Chromium 集成；0.2.0 日常 Chrome 读取已通过，0.3.0 真实 Cindy／日常 Chrome 的 X 提取也已验证。 |
| Edge | 共用 Chromium 扩展，独立商店产物和配置路由 | 协议与 Windows 启动器测试；尚无真实 Windows／Edge 设备验证。 |
| Safari | WebExtension 适配＋生成的 macOS 宿主应用 | arm64/x86_64 通用 Release 构建及身份配对测试；尚无已签名普通用户安装、真实 Safari 扩展运行验证。 |

设置页将 Chrome／Edge 的 ZIP 安装作为主入口：点击按钮打开扩展管理页和 ZIP 所在位置，开启开发者模式，将 ZIP 拖入页面，无需解压或选择目录。自动检查连接；打开页面不等于安装成功。目录安装保留为备用方式。当前官方 Chrome 的手动 ZIP 拖入仍待实机验证，受管理策略限制时可能不可用。

Safari 继续使用商店或已签名、公证的应用；该发布渠道尚未配置。Chrome／Edge 的 ZIP 路径不依赖商店条目。未知扩展身份仍须真实 Cindy 配对确认。更新后重新拖入新版 ZIP；目录安装则重新加载扩展，只保留一个副本。

安装卡片只展示已连接的浏览器，或本机已安装且有可交付 ZIP／商店入口的浏览器。未发布的 Safari 和本机未安装的浏览器不展示，不放等待上架占位。

## 安全边界与限制

- 新安装默认允许所有公网网站的读取和交互。已有设置中的拦截由用户明确移除：旧配置没有来源记录，匹配旧版预置清单也不能证明用户意图。全站开关开放交互，读取拦截和交互排除项仍优先。域名包含子域名；`=host.example.test` 仅精确匹配。新增授权／解除拦截必须真实确认，取消不修改。
- 只监听 `127.0.0.1:18810–18819`。HTTP 不能派发任务或修改策略。校验 Host、扩展来源、配置身份与当前桥接会话，不开放 CORS。未知扩展确认前拿不到会话／任务。这是浏览器来源保护，不防御同用户恶意原生程序或已被信任的恶意扩展。
- 任务、ACK、结果均绑定单一配置，派发后的动作不自动重投。`execution:executed` 只证明 DOM 动作已派发，不证明发送／购买成功；`unknown` 必须先核对实际页面。
- 不导出 Cookie，不提供任意 JS、debugger 或凭证提取。排除隐藏／密码／支付验证码字段，但普通页面文字仍可能包含隐私。AI 可能在设备外接收数据。访问／读取会联系目标网站，也可能影响服务端通知已读状态。
- 不再仅凭公网域名放行：读取或操作前，扩展要求 `webRequest` 报告当前主文档的公网连接 IP，结合导航／请求时间核对，并只向对应 `documentId` 注入。私网／缺失地址、未观察到的旧标签或无法明确关联的导航返回 `ADDRESS_UNVERIFIED`，标签信息打码。不自动刷新或另开页面；用户手动刷新公网页面可以取得新证据。缓存、代理或浏览器无法提供公网连接证据时，该页不能读取。这阻止私网主文档内容被提取，但不是网络防火墙：导航可能已联系目标，任意网页内容也可能来自其他来源。新增 `webRequest`、`webNavigation` 仅观察主文档地址和身份，不读取 Cookie／请求头。
- 每个配置最多保留三个自建后台标签，十分钟闲置后回收。不回收用户已有、聚焦或自行导航的标签。没有 session storage 的 Safari 在内存中维护归属，绝不跨浏览器重启持久化标签 id。
- ref 是隔离环境中的真实 Element 映射，不使用页面可伪造属性；导航／新快照后失效。合成按键／悬停可能被网站忽略。不支持跨域 iframe／关闭的 Shadow DOM。表单只用一种机制提交一次。
- 正文／记录值默认6000字符预算，JSON／链接另有开销。标签默认20个、最多100个，并有总量预算，过长 URL 不导出。超时／空壳不代表没有结果。

## 构建与验证

只使用第一方 JS 和 Node 内置模块，无运行时依赖安装。`node/worker.cjs` 无条件启动，因为 Cindy 通过 require 加载入口。运行时子进程仅用于固定浏览器／应用启动器和 Safari 签名检查。

```sh
python3 scripts/package-my-browser-zip.py
node scripts/validate-plugin-manifest.mjs ./my-browser
node --test .tests/my-browser.test.mjs .tests/my-browser-multibrowser.test.mjs .tests/my-browser-tabs.test.mjs .tests/my-browser-orchestrator.test.mjs
PLAYWRIGHT_CORE=/absolute/path/to/playwright-core node --test .tests/my-browser.browser.test.mjs
# 有 Xcode 的 macOS 构建机；必须使用新输出目录，不覆盖已有构建
node scripts/build-my-browser.mjs /absolute/output/directory all
```

构建器生成 Chrome／Edge 商店 ZIP、Safari Xcode 项目及通用应用。没有签名配置时明确标记 Safari 产物**不可作为普通用户分发包**。可通过 `MY_BROWSER_SIGN_IDENTITY` 与 `MY_BROWSER_DEVELOPMENT_TEAM` 启用签名；`MY_BROWSER_NOTARY_PROFILE` 指向已配置的 Apple notarytool 钥匙串配置。凭证明文不进入源码、插件设置或产物。仅在公证及系统检查成功后将输出的 `native/` 放入插件打包。本机没有可用签名身份，因此未验证签名／公证执行路径。

2026-09-15 本地验证：
- 清单校验、58 项 Node／HTTP／本地化／预配置／发布流程测试，加隔离 Chromium 集成套件全部通过（共59项）。
- 真实 Chromium 集成覆盖读取／提取／交互、水合等待、一次读取 X 结构夹具、增量边界、过期 ref、权限拒绝／撤销、重定向、标签回收、弹出页、配对取消／持久化、设置失败及330px窄屏。
- X 结构**测试夹具**（不是实际 X 延迟）：一次读取返回5条记录，记录的一轮为714ms、792字节结果 JSON。
- Safari 通用 Release 构建成功；未宣称签名、公证、App Store 发布或真实 Safari 运行通过。
- 本机 Cindy 0.1.82；最低版本仍为 Manifest v3 所需的0.1.64。Manual 支持更早（首个包含它的稳定 tag 为 v0.1.48）。
- 原0.2.0 已在真实 Cindy／日常 Chrome 验证 example.com 及用户 X 通知读取，交互保持拒绝。随后已在 Cindy 装入0.3.0，并重新加载日常 Chrome 扩展：真实登录态 X 提及页一次返回5条结构化回复（桥接总计4329ms，其中等待内容1785ms）。第二次增量读取找到锚点、返回其前方零条已渲染记录，耗时22ms；这不代表重新联网刷新或全部通知都已查全。装入后的按需手册读取成功，原有网站权限保留。

0.3.1 修复跳转后加载超时导致重复开页、聚焦后丢失网址关联，以及只删除记录却未关闭实际标签页的回收漏洞。受保护标签仍计入上限；意外导航和容量耗尽返回不可自动重试错误。新增5项回归测试，并在真实 Chromium 中验证重定向后重复读取不会增加标签页。

0.3.8 修复 review 发现的权限时序竞争：`sync()` 读取已存策略与下发到 worker 是两步，设置页保存若落在中间，旧快照会覆盖用户刚撤销的策略，令该网站在下次同步前仍可操作。现读取与下发与 `save()` 共用同一临界区。两项回归测试以打桩宿主 API 运行真实 `main.js`：一项把 sync 阻在读取与下发之间、让保存超车，断言撤销既保留在存储中，也对后续工具调用保持拒绝；另一项检查并发保存与工具调用既不失败也不死锁。两项在修复前的 `sync()` 上均失败。

0.3.9 处理使用契约上剩余的两条 review 意见。其一，读取时的传输失败（超时或 stdio 断开）原先会绕过 `node()` 落到通用处理分支，而该分支只认得交互类工具，于是 `browser_read` 被报成 `not_executed`，但 worker 可能已经接受任务并访问了页面。现在 `node()` 把被拒的宿主请求转成与 worker 返回错误相同的结构化 `NODE_UNAVAILABLE`，读取因此报 `unknown`。第三项 orchestrator 测试从打桩的宿主请求抛错并断言 `unknown`，在修复前的 `node()` 上失败。其二，面向 Agent 的 `description`／`whenToUse` 与四语言文案不再把 Safari 写成可连接的浏览器：本包不随附已签名的 Safari 应用、也没有商店条目，设置页本就隐藏 Safari 卡片，按旧文案执行的 Agent 会让用户走进无法完成的安装流程。Safari 的实现、配对、构建脚本及 README／Manual 说明均保留，只删除夸大表述；Manual 现明确写出本包无法安装 Safari。

0.3.10 修掉两条凭证泄露问题。其一，标签网址原先原样返回，因此停在 OAuth 回调、密码重置或 magic link 上的标签会把 `?code=…`、`#access_token=…` 直接交给模型；公网地址校验与 host 筛选都不会移除它们。现由一个共享的 `redactUrl` 遮蔽凭证类查询参数与长的不透明 token 值，仅在片段携带 `key=value` 数据时整段遮蔽（`#/home` 这类纯路由片段保留，以免标签不可辨识），并在扩展构造标签行和桥接层最终出口两处应用——读取与导航结果同样处理，不只是标签列表。其二，敏感字段检测原先精确匹配 `autocomplete`，真实结账／验证码标记（`autocomplete="section-checkout billing cc-number"`）因此漏过，仍可作为 ref 被看到与输入；现改为按标准关键字列表做 token 匹配（`cc-number`、`cc-csc`、`cc-exp*`、`one-time-code`、`current-password`、`new-password`、`type=password`、`type=hidden`）。两处工具契约与四语言文案已同步新行为。回归覆盖：`redactUrl` 的 policy 单元测试（遮蔽 code／state／token／片段，保留 `q=cats` 与 `#/home`，不可解析输入原样返回），加两项真实 Chromium 检查——夹具新增多 token 卡号／验证码字段，必须被拒且不出现在 snapshot；带 `code`／`state`／片段 token 的回调标签必须仍被列出但凭证已被移除。两项新 Chromium 检查在修复前均失败（`an OAuth code must never reach the model`）。

0.3.11 补全该脱敏出口。首版出口只覆盖页面 URL 与标签行，但 content 读取还会返回页面链接，含重置令牌或 magic link 的链接仍会进入模型。现覆盖所有携带网址的形态——页面 URL、标签行、`links[].url`，以及提取字段中本身是 http(s) 网址的值（字段名由调用方决定，无法按 key 匹配）。同时把夹具与测试里的占位值统一换成明显的假 UUID，仓库内不再留凭证形态字面量。回归覆盖：夹具带一条 `/reset?token=…` 链接，content 读取必须仍列出它、但令牌不出现且普通链接保持可用；只移除 links 分支即可复现失败（`a magic-link token in a page link must never reach the model`）。

0.3.12 继续收紧两处边界。密码重置与 magic link 的凭证通常放在路径段里（`/reset/<token>`、`#/verify/<token>`），而查询／片段脱敏从不检查路径，这类网址仍会进入模型，与契约里「magic link 会被遮蔽」的说法不符。现按段处理：仅当某个形似 token 的段（长度≥16、无标点、含数字）紧跟 reset／verify／invite／auth 这类凭证语境词时才遮蔽，普通深层路径不受影响——单元测试中 `/commit/<sha>`、`/user/12345`、`/reset-password/success`、`/notifications/mentions` 均保持不变。另一处，敏感字段检测原先依赖标准 `autocomplete`，因此 `<input name="card-number">`、`<input name="otp">` 这类未设置该属性的字段仍会出现在 refs 并可被输入。现改为保守判定：`type`、多 token `autocomplete` 与元素自身命名（name／id／placeholder／aria-label／data-testid，识别 camelCase 与分隔符）共同构成同一个判定，snapshot、extract、act 三处共用。命名规则限定在表单类元素上，因此只是提到 card 的按钮或链接仍可见可点（有断言覆盖）。夹具与断言同时覆盖：`/reset/<假 UUID>` 链接必须仍被列出但令牌不出现；未用 autocomplete 标注的 `otp`／`card-number` 字段必须返回 `SENSITIVE_FIELD` 且不进入 snapshot。只回退命名词表即可复现 `undefined`（而非 `SENSITIVE_FIELD`）；只回退路径规则即可复现路径段断言失败。

打包 ZIP 拖入 Chromium 扩展管理页也是开发者安装方式，可以替代手动选择目录。仍受浏览器开发者模式／管理策略限制，不等同于商店签名发布，也不保证自动更新。Chromium 源码支持这一路径；本机官方 Chrome 的 ZIP 拖入流程尚未实测。自行打包的 CRX 可能被直接拦截，并非只弹出可忽略的风险提示。

provisioning 保持空定向受众。不代表市场准入、商店提交、push、PR 或公开发布。基于 HEAD 的4项包契约测试也已在包含新插件及 provisioning 的已提交快照上通过。

审查回归：公网域名指向真实 loopback 测试页面时不返回 DOM／标题；隔离 Chromium 套件的正向页面在浏览器 API 边界模拟公网 IP。单元测试覆盖导航／刷新身份、迟到响应和未知地址。

## 运行入口来源证据

`node/worker.cjs` 本身就是受审的第一方源码入口，逐字节打包，不经过转译，也没有另存的生成版／vendor 副本。依赖关系为 `node:readline` → `node/bridge.cjs`、`node/installation.cjs`、`extension/policy.js`；后者只依赖 Node 内置模块及随包 manifest/distribution JSON。没有需要重建的外部上游包或二进制版本。`.github/scripts/package-plugin.sh my-browser <output.cindy>` 打包已提交源码，可将包内入口与 `git show HEAD:my-browser/node/worker.cjs` 逐字节比较验证来源。

联网／启动清单：worker 仅创建18810–18819的loopback HTTP监听，扩展只轮询这些固定端口。网站导航为用户请求的浏览器任务所需HTTP(S)。安装仅打开固定扩展管理地址、随包文件，或经校验的 `chromewebstore.google.com`、`microsoftedge.microsoft.com`、`apps.apple.com` 商店URL；当前商店地址均未配置。安装／签名检查采用固定程序和argv，不拼接shell。源码排查未发现eval/Function/字符串代码执行或Math.random；唯一运行时base64解码用于公开的扩展身份公钥。loopback契约确认和桥接认证仍是未解决审查项，这些来源证据不构成豁免。

状态工具只选取连接／安装字段，本地路径、策略及配对来源信息保留在设置页响应。提取属性在派发前限定为href/src/datetime/title/alt/aria-label/role，拒绝任意令牌属性；网站正文和链接仍可能包含私人信息。

读取任务开始导航后失败会报告 `execution: unknown`，因为网站可能已经收到访问。已确认接收的读取任务丢失结果也报告 unknown；确认接收前过期的任务仍为未执行。
