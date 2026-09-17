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

0.3.13 清除网址 userinfo。页面提供的链接或提取到的 `href` 可能是 `https://user:password@example.test/`；任务 URL 会被 `check` 拒绝，但页面内容不经过该检查，而 `redactUrl` 只改写查询、片段与路径，于是链接里的 Basic Auth 凭证会进入模型。现由脱敏函数清除 `username`／`password`（已断言结果为 `https://example.test/private`），工具契约也把 userinfo 与其他被遮蔽的形态并列。覆盖：解析结果的单元断言，加夹具中带 userinfo 的链接在 content 读取后必须不出现。两项在修复前的脱敏函数上均失败。

0.3.14 修掉一处百分号编码绕过并给结果加上大小上限。含编码字符的重置／magic-link 令牌（`/reset/Abc%2F1234567890`）其 `%2F` 会保留在 `pathname` 中，段的字符集判定因此把它当成普通路径词，完整凭证被返回；现先解码再做令牌判定（解码后不再要求必须含字母，纯数字令牌同样命中）。另一处，`document.title` 与每个 `links[].url` 都没有上限：夹具页面现返回 60 万字符标题与 12 万字符 href，超过桥接 512000 字节的请求上限，扩展会丢弃结果、调用方等待 45 秒后拿到 `BROWSER_TIMEOUT`。现标题上限 300 字符、单个链接 URL 上限 2048、链接总预算 20000，任一被截断时结果置 `truncated`。覆盖：路径与片段中编码令牌的单元断言，以及真实 Chromium 对超大页面的读取必须返回 `ok`、标题有界且 `truncated:true`。只回退解码即复现编码令牌断言失败；只回退上限即复现 45 秒后的 `BROWSER_TIMEOUT`。

0.3.15 让敏感判定跟随真实可编辑性。命名词表原先以字面量选择器 `[contenteditable=true]` 为门槛，但 `contenteditable=""` 与 `contenteditable="plaintext-only"` 同样可编辑，于是 `<div contenteditable role="textbox" name="otp">` 被判为普通字段：它能通过 `role=textbox` 进入 snapshot，也能被 `type` 分支接受（该分支本就使用 `el.isContentEditable`）。现判定改为 `el.matches('input,textarea,select') || el.isContentEditable`，敏感判定与操作分支口径一致，snapshot 选择器也从字面 `true` 改为 `[contenteditable]`。覆盖：夹具包含空属性 OTP 区域与 `plaintext-only` 卡号区域，二者都必须返回 `SENSITIVE_FIELD` 且不进入 snapshot；把选择器改回字面量即复现 `undefined`（而非 `SENSITIVE_FIELD`）。

0.3.16 修正脱敏与截断的先后顺序，并用一条规范化规则取代逐个编码形态的猜测。链接原先在注入函数中被截到 2048 字符，之后桥接才脱敏，页面可把凭证放在截断处从而泄露前缀；现传输上限施加在脱敏结果上，且由能拿到 policy 模块的 service worker 执行。注入函数完全不再切割网址：超过 8192 字符或超出 20 万字符页面上限的链接整条丢弃，既约束载荷又绝不切断凭证。脱敏侧，编码后的语境词、双重编码的令牌、片段中编码的 `=` 都能绕过原先单次、基于字符集的判定；现所有判断都在有界、可重复解码（最多四轮）的形式上进行，且凭证在语境词之后仅按长度识别——反复编码之所以屡次得手，正是因为依赖了字符集。覆盖：夹具中一条链接的凭证恰好落在 2048 截断处的前 12 个字符，断言其不出现；单元断言覆盖编码令牌、编码语境词、双重编码令牌与编码片段键值。先截断后脱敏即复现 `truncation must not expose a credential prefix`；关闭规范化则编码令牌断言失败。测试占位值一律为假 UUID，符合夹具规则。

0.3.17 阻止正文导出返回已被视为敏感的区域内所保存的值。密码、`autocomplete` 与命名词表已把这类元素排除在 snapshot refs 与 `extract` 之外，但 `text`、`content` 及 snapshot 的 text 字段仍直接序列化未过滤的 `root.innerText`，因此放在 `contenteditable` 区域里的验证码或卡号虽被隐藏为字段，其内容仍会被返回。现改为在克隆副本中先移除敏感后代再取文本；仅当该区域确实包含敏感元素时才构建副本，普通正文不受影响。覆盖：夹具中被命名的 OTP 区域现携带一个值，断言它不出现在 `content`、`text` 与 snapshot 的文本中，同时普通页面正文仍照常返回。恢复未过滤读取即复现 `sensitive contenteditable text must not be returned`。

0.3.18 补上该脱敏器的两处缺口。其一，传输上限缩短了链接却未标记录，2049–8192 字符的普通链接会被静默截断，而契约承诺 `truncated:true` 标出所有截断；现在只要上限确实缩短了脱敏后的 URL 就置位。其二，正文清理只看后代，若用 `selector` 直接指向敏感区域本身，其未过滤的 `innerText` 仍会返回；现同时检查根节点，根节点本身敏感时返回空文本。覆盖：`long.test` 页面唯一链接的路径长 2500 字符，必须返回 `truncated:true` 且各链接 URL 在上限内；直接读取 `#otp-region` 必须不返回凭证。移除标志即复现 `a capped link URL must set truncated`；移除根节点检查即复现 `targeting a sensitive region directly must return no credential`。

0.3.19 再修两处输出边界。其一，敏感区域清理原本从脱离文档的克隆节点读取文本，而 detached 元素的 `innerText` 会退化为 textContent，因此只要页面同时存在敏感字段，`display:none` 或脚本内容就会混入正文；现改为在活体 DOM 上做减法：临时移除敏感子树、读取渲染后的文本，再同步按逆序恢复，既保留渲染语义，页面脚本也观察不到中间状态。其二，snapshot 文本在 6000 字符处截断却未置 `truncated`，Agent 会把被裁剪的正文当成完整内容；现在该上限生效时即置位。覆盖：夹具带一个 `display:none` 标记，必须不出现在正文中；`long.test` 的 7000 字符正文在 snapshot 读取时必须返回 `truncated:true`。恢复基于克隆的读法即复现 `hidden content must not be returned when a sensitive region is filtered`；移除标志即复现 `a capped snapshot text must set truncated`。

0.3.20 让读取不再改动页面。临时移除敏感子树虽修好了隐藏内容泄露，但仍然动了活体 DOM：自定义元素会触发 `disconnectedCallback`／`connectedCallback`，页面的 `MutationObserver` 也会记录到变更，于是「读取」在页面看来是一次写操作。现改用 `TreeWalker` 在活体树上提取文本，跳过不渲染的子树（`display:none`、`visibility:hidden`、`hidden`、script／style／template）与敏感元素，且只走到所需长度为止；不插入、不移除、不重排任何节点。覆盖：夹具定义了一个带生命周期计数器的自定义元素与一个 `MutationObserver`，文本读取必须既不返回该敏感值，也把两个计数都留在 0。恢复基于临时移除的实现即复现 `a read must not fire custom element lifecycle callbacks`。

0.3.21 让 `extract` 走同一条渲染文本路径。无属性的 extract 字段原先在 `innerText` 为空时回退到 `textContent`，于是「可见外壳 + 隐藏子元素」会把 `display:none` 或脚本里的 CSRF 值返回；现字段统一经与 `content`／`text` 相同的 TreeWalker 提取，隐藏后代同样被跳过。覆盖：夹具中仅含隐藏 span 的外壳经 extract 不得返回任何隐藏数据，而普通元素仍原样返回其渲染文本。恢复 `textContent` 回退即复现 `extract must not return hidden descendants`。

0.3.22 在过滤路径上恢复渲染文本保真度。首版 TreeWalker 对每个文本节点单独折叠空白、再用空格拼接，于是 `<span>A</span><span>B</span>` 变成 `A B`、`<br>` 与块级换行丢失；它还会对整个 `visibility:hidden` 子树 `FILTER_REJECT`，连带丢弃显式恢复 `visibility:visible` 的后代。现改为：区域内若没有敏感后代就原样返回 `innerText`（精确），只有确实包含敏感元素时才走遍历；遍历时相邻行内文本直接相接、最近的块级祖先改变或遇到 `<br>` 才换行、`white-space: pre` 保留空白，并按文本节点判定 visibility，使被重新显示的后代保留、隐藏文本仍被排除。覆盖：夹具新增 `AB`、块级换行、`<br>`、重新显示 span 四个探针；旧实现即复现 `adjacent inline runs must not gain a space`。

0.3.23 另外拒绝不渲染的根节点。`TreeWalker` 不会对它收到的 `root` 调用过滤器，所以当 `selector` 命中 `display:none` 的包装元素（或隐藏祖先下的元素）时会落到 `innerText`，而未渲染节点的 `innerText` 会退化为 `textContent`，隐藏值因而返回。现在取文本前先用 `checkVisibility()` 判定根节点（自身或祖先 `display:none`）；`visibility:hidden` 的根节点仍交给 `innerText` 处理，因为这样保留显式恢复可见的后代。覆盖：`display:none` 包装元素经 `text` 与 `extract` 两条路径都必须不返回内容；移除该检查即复现 `a display:none root must not return its text`。

0.3.24 修掉过滤路径上的两处保真回归。其一，纯空白文本节点被直接跳过，导致 `<span>Signed</span> <span>in</span>` 变成 `Signedin`；现把这类空白作为行内分隔保留，并在块级边界处清理，因此 `Signed in` 得以保留、块级换行也不受干扰。其二，根节点检查用的是 `checkVisibility()`，它对 `display:contents` 包装器返回 false（尽管其子元素仍然渲染）；现改为按「元素自身或祖先 `display:none`」判定，`display:contents` 包装器可正常读取。覆盖：夹具新增 `Signed in` 与 `display:contents` 两个探针，后者经 `text` 模式读取。恢复跳过空白的写法即复现 `a visible inline space must be preserved`；恢复 `checkVisibility()` 即复现 `a display:contents wrapper must still be readable`。

0.3.25 用一个统一的保守判定取代逐项补属性。`content-visibility:hidden` 的计算 `display` 仍是 `block`、`visibility` 仍是 `visible`，但其内容并不渲染，因此放在里面的验证码或私有文本仍会被返回。现改为单一 `notRendered` 规则——元素自身或祖先 `display:none`，或 `content-visibility` 为 `hidden`（或 `auto` 且当前被跳过）——用于根节点判定；遍历中只需判定元素自身状态，因为被抑制的祖先早已 `REJECT`。`display:contents` 仍可读，因为它自身无盒但子元素照常渲染。覆盖：夹具新增 `content-visibility:hidden` 探针，必须不出现在正文中；移除该检查即复现 `content-visibility:hidden content must stay excluded`。

0.3.26 去掉该规则对 Chrome 版本的依赖。`auto` 分支原先用 `checkVisibility({contentVisibilityAuto:true})`，而 Chrome 120 会忽略该选项，扩展却仍声明 `minimum_chrome_version: 120`，因此那里被跳过的屏外内容仍可能被返回。现改为问浏览器自己的渲染文本 `innerText`：`auto` 元素若有文本内容却渲染不出任何文本，即视为被跳过。这样不依赖任何随版本新增的选项，也无需提高最低版本，且只在 `auto`／`hidden` 元素上求值，开销有界。覆盖：新增 `cv.test` 页面（带密码字段以进入过滤路径），其中一个屏内 `content-visibility:auto` 元素必须可读、一个屏外元素必须被排除；移除 `auto` 规则即复现 `engine-skipped content-visibility:auto content must stay excluded`。

0.3.27 把「先脱敏、后裁剪」推到最后两处边界。`extract` 原先按剩余 `maxChars` 裁剪每个值，之后桥接才脱敏，因此当预算只留下重置令牌的很短前缀时，路径脱敏器已不识别它；现 URL 属性值（`href`／`src`）整串传递，仅在超过硬上限时整条丢弃，脱敏始终看到完整字符串，文本值继续按预算裁剪。另外，正文读取在达到请求的链接数量上限时仍返回 `truncated:false`，调用方无法区分「页面只有这些链接」与「列表被裁剪」；现该分支置位。覆盖：一个长标签链接的 extract（其令牌原先会被截短），以及 `links.test` 页面在 `limit:2`（必须报截断）与 `limit:10`（不得报）下的对比。移除 URL 分支即复现 `a credential URL must be redacted before any budget cut`；移除数量标志即复现 `a count-limited link list must set truncated`。

0.3.28 修掉该改动的两个副作用。URL 整串保留后仍会扣减 `remaining` 而无下限，后续文本字段因此拿到负数预算，`slice(0, 负数)` 会从字符串**末尾**取文本——恰与预期相反；现超出预算的 URL 整条丢弃（不消耗预算），文本裁剪上限下限为 0。另外，链接数量检查原在 `http(s)` 资格过滤之前，因此最后一 条 http 链接刚好填满 `limit`、页面仅剩 `mailto:`／`tel:` 链接时会被误报截断；现先判资格。覆盖：extract 依次取「长标签 → 超预算 URL → 文本字段」（后者必须不超过剩余预算），以及 `links.test` 在 `limit:4` 且尾部有非 http 链接时不得报截断。回退任一处即触发对应断言失败。

0.3.29 让 extract 的 URL 值落在声明的单值上限内。URL 整串传递后，只剩 8192 硬上限与总预算两道约束，因此 4001–6000 字符的 `href` 会被返回，而 `ghost.json` 声明每个字段值最多 4000 字符。现超过 4000（或超过剩余预算）的 URL 值整条丢弃并置 `truncated:true`，既满足声明的上限，又不在脱敏前切割 URL。覆盖：夹具中一条 4100 字符的 URL 必须返回 `null` 且 `truncated:true`；恢复只查 8192 即可复现 `a URL over the declared 4000-character value limit is dropped`。

0.3.30 让该上限作用在脱敏之后的结果上。扩展在脱敏前检查长度，但把短凭证遮蔽为 `REDACTED` 会**加长**字符串（`code=x` → `code=REDACTED`），因此略低于 4000 的 URL 仍可能超出声明上限返回。现结果出口在脱敏后重新判定，超限值整条丢弃并置 `truncated`。覆盖：夹具中一条填充到略低于上限、且带 `code=x` 的 URL 必须返回 `null` 且 `truncated:true`；移除该后置检查即复现 `a URL that grows past the limit during redaction is dropped`。

0.3.31 把凭证识别从枚举键名改为按词判定，并给页面 URL 加上边界。查询键现在按词拆分判定，因此 `reset_token`、`magic_link_token` 这类组合键即使值很短也会被遮蔽；值本身是 URL 或路径时递归分析（`?next=%2Freset%2F<token>`）。另外，重定向或 `history.replaceState` 可把页面 URL 拉长到远超桥接请求上限，导致结果根本发不出去：现对三个出口分别限长——发给 `/authorize` 的 URL、传给注入函数的 URL、以及结果里的 URL；注入函数内的导航校验改为比较有界前缀而非整串。覆盖：组合键、嵌套 URL 与 `?page=2&sort=name` 保持不变的单元断言；`pageurl.test` 把自身改写为 60 万字符路径后必须读取成功且 URL 在 8192 以内。回退这些限长即复现该次读取的 `BROWSER_TIMEOUT`。

0.3.32 恢复完整的页面身份校验。先前为了限制传入注入函数的 URL 长度而改用前缀比较，这同时放松了身份判定：同文档导航到共享该前缀的地址也会通过。现由注入代码经消息向 worker 取回精确的目标 URL，并要求 `location.href` 与之完全相等。该 URL 刻意既不作为 `executeScript` 参数传递（超长时会一直不返回），也不使用限长副本。覆盖：整个 Chromium 套件都经过这条路径，包括 URL 长达 60 万字符的 `pageurl.test` 读取，以及依赖身份校验的重定向拒绝用例。

0.3.33 让敏感判定跟随 editing host。原先只从元素自身属性读取命名，因此 `<div contenteditable name="otp">` 的子 span 被判为普通元素，而宿主却是受保护的：`extract` 能返回其中的验证码，`type` 也会接受该子节点。现解析最近的 `[contenteditable]` 祖先或自身，并对该宿主套用命名规则，使读取、snapshot 与交互共用同一边界。覆盖：夹具的验证码现位于嵌套 span 中，它既不能被 `extract` 读出，也不能被 `type` 接受；恢复仅看自身属性即触发对应断言失败。

0.3.34 让该边界跨越嵌套成立。只解析最近的 `[contenteditable]` 时，内层未命名区域或 `contenteditable="false"` 节点会遮蔽外层带凭证命名的宿主，其后代因此又可被读取与输入。现敏感判定沿整条祖先链检查：任一祖先或自身是可编辑宿主且命名命中凭证语义即视为敏感（同时删掉已无用的 `isField`）。覆盖：夹具的 OTP 宿主内新增一个 `contenteditable="false"` span 与一个未命名的内层可编辑区域并各带一个值，二者都不得被 `extract` 读出或接受 `type`；恢复最近宿主判定即触发对应断言失败。

0.3.35 把同一条继承规则用于正文导出，并修正安装文案。根节点守卫仍要求根自身匹配 `TEXT_SCOPE`，因此 `mode:"text"` 配合指向敏感宿主内普通 span 的 `selector` 会经「精确 innerText」快路径把验证码返回；现守卫直接使用共享的敏感判定，使所有导出共用同一边界。安装方面：原文案承诺「无需解压，也不用选择目录」，但拖入 ZIP 是否被接受取决于构建与策略、且并非每个构建都验证过，因此 `zipNote`、`browser_status` 的说明与 Manual 均改为：被拒绝属正常情况，并指向下方目录的「加载已解压的扩展程序」——同样不需要手动解压。覆盖：对嵌套 span 的 text 模式读取不得返回值；回退守卫即触发该断言失败。

0.3.36 让链接扫描在达到请求数量时立即停止。原先先把全部 `a[href]` 展开并按可见性过滤，因此即使只要 `limit:1`，含数万链接的页面也要付出一次全量布局扫描；现按「资格 → 可见性 → 数量」逐个判断，达到上限即退出。覆盖：含 2 万链接的夹具页面用 `limit:1` 读取必须只返回 1 条并标记截断。这是一处结构性改动——在该规模下旧实现并不够慢，时间阈值没有区分度，因此不设时间断言。

打包 ZIP 拖入 Chromium 扩展管理页也是开发者安装方式，可以替代手动选择目录。仍受浏览器开发者模式／管理策略限制，不等同于商店签名发布，也不保证自动更新。Chromium 源码支持这一路径；本机官方 Chrome 的 ZIP 拖入流程尚未实测。自行打包的 CRX 可能被直接拦截，并非只弹出可忽略的风险提示。

provisioning 保持空定向受众。不代表市场准入、商店提交、push、PR 或公开发布。基于 HEAD 的4项包契约测试也已在包含新插件及 provisioning 的已提交快照上通过。

审查回归：公网域名指向真实 loopback 测试页面时不返回 DOM／标题；隔离 Chromium 套件的正向页面在浏览器 API 边界模拟公网 IP。单元测试覆盖导航／刷新身份、迟到响应和未知地址。

## 运行入口来源证据

`node/worker.cjs` 本身就是受审的第一方源码入口，逐字节打包，不经过转译，也没有另存的生成版／vendor 副本。依赖关系为 `node:readline` → `node/bridge.cjs`、`node/installation.cjs`、`extension/policy.js`；后者只依赖 Node 内置模块及随包 manifest/distribution JSON。没有需要重建的外部上游包或二进制版本。`.github/scripts/package-plugin.sh my-browser <output.cindy>` 打包已提交源码，可将包内入口与 `git show HEAD:my-browser/node/worker.cjs` 逐字节比较验证来源。

联网／启动清单：worker 仅创建18810–18819的loopback HTTP监听，扩展只轮询这些固定端口。网站导航为用户请求的浏览器任务所需HTTP(S)。安装仅打开固定扩展管理地址、随包文件，或经校验的 `chromewebstore.google.com`、`microsoftedge.microsoft.com`、`apps.apple.com` 商店URL；当前商店地址均未配置。安装／签名检查采用固定程序和argv，不拼接shell。源码排查未发现eval/Function/字符串代码执行或Math.random；唯一运行时base64解码用于公开的扩展身份公钥。loopback契约确认和桥接认证仍是未解决审查项，这些来源证据不构成豁免。

状态工具只选取连接／安装字段，本地路径、策略及配对来源信息保留在设置页响应。提取属性在派发前限定为href/src/datetime/title/alt/aria-label/role，拒绝任意令牌属性；网站正文和链接仍可能包含私人信息。

读取任务开始导航后失败会报告 `execution: unknown`，因为网站可能已经收到访问。已确认接收的读取任务丢失结果也报告 unknown；确认接收前过期的任务仍为未执行。

0.3.37 在 Node 结果出口按 URL 脱敏后的最终长度执行提取总预算，所有字段和记录共用预算。超限 URL 整条省略，普通文本使用剩余额度，并标记截断。HTTP 回归覆盖单条／多条记录、默认／自定义预算和调用方自定义字段名。

0.3.38 撤权时立即使受影响的已确认任务失效（结果标为 unknown），同时检查已授权的重定向目标；注入抵达页面后再次授权才返回操作目标。已经通过最后检查的 DOM 操作仍可能完成，撤权不能回滚已执行动作。

0.3.39 撤权同时检查原始地址和重定向目标。注入页面已取得最终执行许可时，保存撤权等待动作完成并丢弃结果；失联或超时明确报告未确认，重复保存不能把未确认变成成功。已执行的副作用无法回滚。

0.3.40 将未确认派发历史与 16 个执行任务槽分离；最多保存 128 条精简授权记录，不保留交互载荷。超出上限保留保守的未确认标记。权限已应用时可继续新的获准任务，历史动作未确认仍会在保存权限时明确报告。
