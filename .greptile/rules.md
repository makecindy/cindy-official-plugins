# 官方插件审查规则（review 契约正本）

> 本文件供自动 review（Greptile 等）与人工 reviewer 共同使用。安全红线类规则以
> `.greptile/config.json` 的结构化条目为准（带 severity），本文件补充设计标准、
> 流程纪律与判定口径。合入 `main` 的插件会自动发布给全体用户——审查从严，
> 宁可误报交人工裁决，不可漏报放行。

## 设计契约

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

### 同版本元信息更新契约

version 不变时，`ghost.json` 仅允许修改 name/description/author/icon 四个纯展示
字段，其余字段（whenToUse/entry/launch/slots/tools/agent/node/network/subscribe/
panel/settingsHtml/command/cindy/preview）或任何包内运行文件变化都必须 bump
version——这是防止同版本静默改变模型行为或权限的硬门禁。注意：该同版本豁免
依赖服务端尚未上线的能力；在服务端支持放行之前，任何插件内容变更（含这四个
展示字段）仍必须 bump version。

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
证据必须完整摆出。

### 新插件必备项

新插件 PR 缺以下任何一项时逐条指出：

- `provisioning.json` 有对应条目，且 audience 取值有 PR 描述里的决策依据
  （尤其 `"all"`）；
- 四语言 locale 资源齐全（zh-CN/en/ja/ko，`.tests/localization.test.mjs` 口径）；
- `ghost.json` 的 icon 引用有效、assets 体积合理；
- PR 描述包含实机验证说明（在 Cindy 客户端安装 `.cindy` 包实测过哪些工具）；
  没有实测的必须如实标注，reviewer 应在 summary 里显式提示「未经实机验证」。

## 其他判定口径

### 图片资源

PR 中新增/替换的图片（icon/截图等）：自动 review 无法读取像素内容，只核对文本
可见信息——文件位于正确 assets 目录、体积合理（icon 不应为数 MB）、文件名无
不雅词汇、`ghost.json` 的 icon 路径引用有效。图片内容合规性（血腥/暴力/色情）
由人工 reviewer 在 GitHub 预览中目检，自动 review 不对图片内容本身下结论。

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
