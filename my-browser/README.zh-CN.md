# 我的浏览器

[English](README.md)

连接 Cindy 与日常浏览器登录态的本地候选插件。**0.3.0** 增加内容优先读取、浏览器／用户配置隔离、极简 Art 图标及分浏览器安装向导。**尚不是已公开分发的普通用户正式版。**

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

设置页检测已安装浏览器，显示对应可用的商店／随包应用入口，自动检查真实握手。**打开浏览器不等于安装成功。** 未知扩展身份必须经过真实 Cindy 配对确认。安装了多个浏览器不等于这些配置都已连接。

**当前外部阻断：** `distribution.json` 尚无 Chrome／Edge 已审核商店条目或 Safari App Store 条目，也未随包附带签名、公证的 Safari 应用。对应按钮明确显示“等待发布方上架”，不能据此宣称普通用户免目录安装已完成。

正式分发时填入实际审核通过的商店 id／URL，或在 `native/My Browser.app` 随包提供已签名、公证的 Safari 应用。Safari 按钮启动前使用 macOS `codesign` 与 `spctl` 验证。浏览器必要确认不绕过；运行时不下载可执行代码。

目录加载藏在**开发者选项**。按钮打开对应浏览器扩展管理、显示打包目录，仅是本地测试后备路径，不是普通用户主流程。更新插件后本地扩展仍需重新加载。不要让普通用户关闭安全策略或启用未签名 Safari 扩展。

## 安全边界与限制

- 默认允许读取、敏感站点黑名单（并不完整）、默认禁止交互。域名包含子域名；`=host.example.test` 仅精确匹配。新增授权／解除拦截必须真实确认，取消不修改。
- 只监听 `127.0.0.1:18810–18819`。HTTP 不能派发任务或修改策略。校验 Host、扩展来源、配置身份与当前桥接会话，不开放 CORS。未知扩展确认前拿不到会话／任务。这是浏览器来源保护，不防御同用户恶意原生程序或已被信任的恶意扩展。
- 任务、ACK、结果均绑定单一配置，派发后的动作不自动重投。`execution:executed` 只证明 DOM 动作已派发，不证明发送／购买成功；`unknown` 必须先核对实际页面。
- 不导出 Cookie，不提供任意 JS、debugger 或凭证提取。排除隐藏／密码／支付验证码字段，但普通页面文字仍可能包含隐私。AI 可能在设备外接收数据。访问／读取会联系目标网站，也可能影响服务端通知已读状态。
- 本地／私网字面地址是 URL 级过滤，不是 DNS 防火墙。重新检查重定向及当前权限；导航本身可能已联系重定向目标。
- 每个配置最多保留三个自建后台标签，十分钟闲置后回收。不回收用户已有、聚焦或自行导航的标签。没有 session storage 的 Safari 在内存中维护归属，绝不跨浏览器重启持久化标签 id。
- ref 是隔离环境中的真实 Element 映射，不使用页面可伪造属性；导航／新快照后失效。合成按键／悬停可能被网站忽略。不支持跨域 iframe／关闭的 Shadow DOM。表单只用一种机制提交一次。
- 正文／记录值默认6000字符预算，JSON／链接另有开销。标签默认20个、最多100个，并有总量预算，过长 URL 不导出。超时／空壳不代表没有结果。

## 构建与验证

只使用第一方 JS 和 Node 内置模块，无运行时依赖安装。`node/worker.cjs` 无条件启动，因为 Cindy 通过 require 加载入口。运行时子进程仅用于固定浏览器／应用启动器和 Safari 签名检查。

```sh
node scripts/validate-plugin-manifest.mjs ./my-browser
node --test .tests/my-browser.test.mjs .tests/my-browser-multibrowser.test.mjs .tests/my-browser-tabs.test.mjs
PLAYWRIGHT_CORE=/absolute/path/to/playwright-core node --test .tests/my-browser.browser.test.mjs
# 有 Xcode 的 macOS 构建机；必须使用新输出目录，不覆盖已有构建
node scripts/build-my-browser.mjs /absolute/output/directory all
```

构建器生成 Chrome／Edge 商店 ZIP、Safari Xcode 项目及通用应用。没有签名配置时明确标记 Safari 产物**不可作为普通用户分发包**。可通过 `MY_BROWSER_SIGN_IDENTITY` 与 `MY_BROWSER_DEVELOPMENT_TEAM` 启用签名；`MY_BROWSER_NOTARY_PROFILE` 指向已配置的 Apple notarytool 钥匙串配置。凭证明文不进入源码、插件设置或产物。仅在公证及系统检查成功后将输出的 `native/` 放入插件打包。本机没有可用签名身份，因此未验证签名／公证执行路径。

2026-09-15 本地验证：
- 清单校验、30 项 Node／HTTP／本地化／预配置／发布流程测试通过。
- 真实 Chromium 集成覆盖读取／提取／交互、水合等待、一次读取 X 结构夹具、增量边界、过期 ref、权限拒绝／撤销、重定向、标签回收、弹出页、配对取消／持久化、设置失败及330px窄屏。
- X 结构**测试夹具**（不是实际 X 延迟）：一次读取返回5条记录，记录的一轮为714ms、792字节结果 JSON。
- Safari 通用 Release 构建成功；未宣称签名、公证、App Store 发布或真实 Safari 运行通过。
- 本机 Cindy 0.1.82；最低版本仍为 Manifest v3 所需的0.1.64。Manual 支持更早（首个包含它的稳定 tag 为 v0.1.48）。
- 原0.2.0 已在真实 Cindy／日常 Chrome 验证 example.com 及用户 X 通知读取，交互保持拒绝。随后已在 Cindy 装入0.3.0，并重新加载日常 Chrome 扩展：真实登录态 X 提及页一次返回5条结构化回复（桥接总计4329ms，其中等待内容1785ms）。第二次增量读取找到锚点、返回其前方零条已渲染记录，耗时22ms；这不代表重新联网刷新或全部通知都已查全。装入后的按需手册读取成功，原有网站权限保留。

0.3.1 修复跳转后加载超时导致重复开页、聚焦后丢失网址关联，以及只删除记录却未关闭实际标签页的回收漏洞。受保护标签仍计入上限；意外导航和容量耗尽返回不可自动重试错误。新增5项回归测试，并在真实 Chromium 中验证重定向后重复读取不会增加标签页。

打包 ZIP 拖入 Chromium 扩展管理页也是开发者安装方式，可以替代手动选择目录。仍受浏览器开发者模式／管理策略限制，不等同于商店签名发布，也不保证自动更新。Chromium 源码支持这一路径；本机官方 Chrome 的 ZIP 拖入流程尚未实测。自行打包的 CRX 可能被直接拦截，并非只弹出可忽略的风险提示。

provisioning 保持空定向受众。不代表市场准入、商店提交、push、PR 或公开发布。基于 HEAD 的4项包契约测试也已在包含新插件及 provisioning 的已提交快照上通过。
