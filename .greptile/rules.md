# 官方插件审查规则（review 契约正本）

> 本文件供自动 review（Greptile 等）与人工 reviewer 共同使用。安全红线类规则以
> `.greptile/config.json` 的结构化条目为准（带 severity），本文件补充设计标准、
> 流程纪律与判定口径。合入 `main` 后会自动向 CN / Global 的 Plugin Platform
> 提交真实包，区域审核通过后才对用户可见——审查从严，宁可误报交人工裁决，
> 不可漏报放行。

## 设计契约

### 授权跟随执行者

当前 Agent 工具调用内的普通 HTTPS 与 workdir 文件操作，使用 Host 下发且严格在途的
`callId` 复用 Cindy 既有 Agent 授权；CLI 继续走已有 Node 工作进程，工具是否执行由
当前 `ghost_call` 的既有 Agent 授权决定。不得仅为了预登记具体命令、域名或路径新增
Slot 或 Manifest 字段。只有 Panel、订阅、scheduler、常驻进程等脱离当前 Agent 调用的
自主 Host 能力，才必须在 `ghost.json` 直接声明；自主 Node Runtime 仍须声明顶层
`node`、固定入口和最小子进程边界。Host 托管凭证也仍须按声明守门。

### tool description 即契约

`ghost.json` 里每个 tool 的 `description` 与顶层 `whenToUse` 是 Agent 读到的唯一
使用手册。以下情形必须按 P1 指出：

- 代码行为边界改变（做什么 / 不做什么 / 返回什么 / 有何副作用）而 description
  未同步更新；
- description 夸大能力（声称能探测/校验实际上没有探测的东西，例如声称探测某
  API 门禁但实际只请求了无关端点）；
- 漏报副作用：写操作、外发数据、不可逆动作没有写进 description；
- 返回值语义变更（如从「精确值」改为「下限估算」）未同步到 description。

### skill 文档与 settings 文案纳入契约

插件内 `skills/**/SKILL.md`、settings 页提示文案、`ghost.json` tool description
三者对同一能力的表述必须一致。PR 改了其中任何一处的行为语义（能查什么/查不到
什么/费用口径/限制条件），必须核对另外两处是否同步；发现互相矛盾按 P1 报。

### 多语言资源语义一致

`locales/` 下任一语言的 description/文案发生**语义**修改（不只是措辞润色），
必须比对其余语言（zh-CN/en/ja/ko）是否同步；语义矛盾（如一种语言说「本地估算」
另一种说「真实账单」）按 P1 报。仅措辞差异不报。注意：settings 页自渲染文案的
语言覆盖遵循 `docs/localization.md` 的英文回退契约——缺 ja/ko 翻译本身**不是**
缺陷，不要要求补齐协议允许回退的语言。

### 同源状态逻辑双写一致

`main.js` 与 `settings.js`（或 worker）若各自实现同一状态判定（连接状态、默认
账号、额度、过期），修改一处时必须检查另一处口径是否一致；不一致（如 main.js
判过期账号无效而 settings 页仍显示已连接）按 P1 报。

### 错误信息说人话

面向用户的报错必须可行动：401 要提示去插件详情页填 token，403 要说明权限缺口，
连接失败要区分「配置错」与「网络不通」。禁止裸抛 HTTP 状态码、英文堆栈或
`error: undefined` 这类无信息文案。`main.js`/worker 中新增的错误分支未遵守时指出。

### 边界校验的设计层收敛

当同一处输入校验/计数/配额逻辑在本 PR 或近两轮 review 中已被报过 ≥2 条边界
条件问题时，不要继续逐条补报新边界，改为一次性提出设计层建议：该校验是否应
改为保守估算（下限/上限）并把最终判定权交给上游服务。逐条打地鼠式补丁循环
对作者与 review 都是浪费。

## 版本与发布纪律

### 版本号纪律

插件目录内任何打包内容（`main.js`/`settings.js`/worker/locales/assets/ghost.json
的行为字段）有变更但同目录 `ghost.json` 的 `version` 未 bump 时提醒（仅注释/
格式改动除外）。服务端对同版本不同内容返回 `RELEASE_VERSION_CONFLICT` 拒绝发布。

### 版本必须递增

本仓发布流水线按完整包上传。为避免 Server 对同版本不同 SHA 返回
`RELEASE_VERSION_CONFLICT`，插件目录下任何被打进 `.cindy` 的内容发生变化时都必须
bump version，包括 name/description/author/icon 等展示字段；新版本必须使用
`major.minor.patch` SemVer，且严格大于 `main` 上的当前版本。新插件只校验 SemVer 格式，
不做大小比较。不要尝试在本仓复刻 Server 的元数据特例；CI 对完整包执行统一版本门禁。

### Server 与客户端交付契约

CI 必须在本仓校验全部 `ghost.json`，不得 checkout Cindy 或私有 Server 仓库；同时对
最终 `.cindy` 包执行 Server 与 Desktop 约束的交集：压缩/解压大小、条目数、
manifest/icon/locale/Skill/Manual 单文件上限、安全路径、大小写路径冲突、客户端保留
文件、声明文件存在性、四语言结构和文本长度。尤其是插件与 locale 的 description
不得超过 300 字符。修改或移除这些门禁属于发布链路敏感变更，按 P1 转人工 review。

官方仓提交的是 Server public release：禁止 `oidc-token` secret；携带 Skill bundle
的 public 插件仅允许 Server 现有豁免 id（`ios-simulator` / `taptap-maker` /
`x-manager`）；携带 Manual 的插件必须声明 `minCindyVersion`。不要用 Greptile 对
manifest schema 的猜测替代 CI 的确定性校验结果。

`.tests/plugin-contract.test.mjs` 同时接受未改动的 legacy v2 与合法 v3；但新插件，
以及实际打包内容发生变化的现有插件，必须在同一 PR 迁移到 `schemaVersion: 3`、
填写不低于 `0.1.61` 的 `minCindyVersion`、移除 `slots` 并保持直接能力声明等价。
只改仓库级文档、CI 或其它插件时，不得要求顺手迁移无关的 v2 清单。

### 最低客户端版本

每个改动插件包的 PR Body 都必须勾选生产版 Cindy 验证项，确认真实打包 `.cindy` 已在
运行正式稳定版 Cindy 的实际设备上安装并验证核心功能；CI 会确定性检查该勾选项。
`minCindyVersion` 表示这个 release 能被安装和运行的最低 Cindy 版本，插件声明该字段
时，验证所用 Cindy 版本必须不低于它。降低或删除该字段会扩大支持范围，静态 CI 无法
证明旧客户端可用，必须转维护者人工 review。未声明字段的旧插件继续按现有兼容语义
处理，不要求为了补字段而批量修改。

### 发布与审核链路

合入后 Workflow 只能通过 CN / Global 各自的受保护 Plugin Platform endpoint 提交，
不得绕过 Platform 直接调用 Plugin Server。Platform 负责创建 pending release、通知
reviewer 并记录批准/拒绝；只有批准的 release 才能被兼容客户端发现。两个区域独立，
一边失败或拒绝不得阻塞或替换另一边已有的批准版本。

## 新插件准入

### 功能查重（必查）

PR 新增插件目录（出现新的 `ghost.json`）时，必须通读仓内现有全部插件的
`ghost.json`（description/whenToUse/tools 清单）与本 PR 新插件逐一比对：

- 功能场景明显重叠（如又一个通用网页搜索、又一个同一邮箱服务商的客户端、
  又一个 Mermaid 修复）：列出具体重叠点（哪个现有插件、哪些能力重合），并要求
  PR 描述中说明差异化定位与共存理由；
- whenToUse 的场景枚举与现有插件大面积重合、或 network.hosts 白名单高度重合且
  面向同一服务时，同样列出供人工判断；
- 合理共存不提示：同一服务商的不同产品（gmail/drive/calendar/sheets）、同一
  协议的不同服务商（163/icloud/qq/yahoo 邮箱）不算重复。

此项为 review 提示，不直接判 fail——重叠是否合理由人工 reviewer 拍板，但重叠
证据必须完整摆出。新增插件本身属于产品准入决策，即使代码无问题也不得自动 approve，
必须由维护者确认提案、定位与 audience。

### 新插件必备项

新插件 PR 缺以下任何一项时逐条指出：

- `ghost.json` 使用 `schemaVersion: 3`、填写 `minCindyVersion`（不得低于 `0.1.61`）、
  不含 `slots`，并以直接顶层字段声明能力；
- `provisioning.json` 有对应条目，且 audience 取值有 PR 描述里的决策依据
  （尤其 `"all"`）；
- 四语言 locale 资源齐全（zh-CN/en/ja/ko，`.tests/localization.test.mjs` 口径）；
- `ghost.json` 的 icon 引用有效、assets 体积合理；
- bundle 了第三方依赖的插件（如带 Node worker 的邮件类）必须随包提供
  `THIRD-PARTY-LICENSES.txt`（完整许可证文本）。注意：ignorePatterns 只是不逐行
  review 该文件的内容，**文件缺失本身必须报**；
- PR 描述包含实机验证说明（在 Cindy 客户端安装 `.cindy` 包实测过哪些工具）；
  没有实测的必须如实标注，reviewer 应在 summary 里显式提示「未经实机验证」。

现有 v2 插件不做专项批量迁移；但 PR 一旦改变该插件目录内会进入 `.cindy` 的实际
打包内容，就必须在同一 PR 把清单迁移到 v3，并保持能力等价。只改仓库级文档、CI 或
其它插件时，不得要求顺手迁移未触及的 v2 清单。

## 其他判定口径

### 图片资源

PR 中新增/替换的图片（icon/截图等）：自动 review 无法读取像素内容，只核对文本
可见信息——文件位于正确 assets 目录、体积合理（icon 不应为数 MB）、文件名无
不雅词汇、`ghost.json` 的 icon 路径引用有效。图片内容合规性（血腥/暴力/色情）
由人工 reviewer 在 GitHub 预览中目检，自动 review 不对图片内容本身下结论。
因此新增或替换图片、二进制文件、预编译资源时不得自动 approve，必须显式转人工
检查真实内容；仅修改 `ghost.json.icon` 文本路径不等同于替换资源。

### summary 与置信度表述

只要存在任何未解决的 P1 评论（本轮或历史轮未被代码修复、未被作者以证据驳回），
summary 首行必须显式写「存在未处理的 P1：<列表>」；禁止在 P1 挂起时输出
「可安全合并」类措辞。置信度分数必须与未解决问题清单一致。

### 已接受限制（勿再报）

`.tests/localization.test.mjs` 的 stripJsComments 不识别正则字面量：正则内的
`//` 会被误判为行注释开头。此为维护者确认的已接受限制（代码头注释已声明）：
该盲区只吞标识符 token、吞不掉探测行为本身——探测结果必须有消费者（赋值/比较/
传参），消费者在他行则标识符照拦，消费者在同行则整行为死代码、语义上等于无
探测；扫描方向 fail-closed（最坏是误报，不放行）。现有插件源码中该模式零出现，
不要针对此点重复报 P1。
