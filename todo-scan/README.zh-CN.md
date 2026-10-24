# Todo Scan

从 Agent 已持有的文本中收集 TODO、FIXME、HACK、XXX 标记，在可停靠面板里供用户分诊，并把仍未完成的条目以列表或 markdown 清单返回。需要 **Cindy 0.1.64 及以上**。纯 JavaScript，不依赖第三方运行库，没有构建步骤，不联网，也不需要任何凭据。

## 它不做什么

它不打开文件、不遍历仓库、不修改任何内容，也不监听变化。它只读取 Agent 传入的字符串 —— 文件内容、diff、文档或笔记 —— 并按该字符串报告位置。需要文件系统的工作由 Agent 在调用前完成；标记清单才是本插件的职责。

## 安装与启用

本插件是**按需启用**的：`provisioning.json` 中的条目不向任何用户预装，不会被自动安装。请在市场中启用它。面板停靠在左侧，在第一次扫描之前显示「在对话里运行一次扫描，结果会出现在这里」。

## 使用

直接提出具体的标记查找即可 ——「把这个 PR 里的 FIXME 收集起来」「上线前把 HACK 都列出来」「找出这个 diff 里的 TODO」—— Agent 会把文本交给 `scan_todos`。普通的待办问题（「这里还剩什么要做」）不会路由到这里，因为插件只匹配这四种字面标记。插件提供两个工具。

`scan_todos`

| 参数 | 含义 |
| --- | --- |
| `text` | 必填。要扫描的原始文本，含换行，最长 200,000 字符。行号相对这个字符串计算，因此必须原样传入，不要先做摘要。 |
| `tag` | 可选。`TODO`、`FIXME`、`HACK` 或 `XXX`；省略则四类都扫。 |

返回 `{ total, truncated, scannedLines, byTag, items }`。每个条目为 `{ key, line, column, tag, text }`，`line`、`column` 是在所传文本内从 1 开始的行列位置，`text` 是标记之后该行的剩余内容（去掉开头的分隔符和结尾空白）。一行可能有多个标记，各自单独上报，因此 key 形如 `line:column:tag`。`byTag` 只统计扫描保留下来的标记：传入 `tag` 时另外三类记为 `0`，因为筛选是在扫描过程中生效的，而不是事后过滤结果。无匹配是成功结果，不是错误。

最多返回 200 个标记。超过时 `truncated` 为 `true`，`total` 等于返回条数而非真实总数。`scan_todos` 不返回 `note` 字段 —— 说明结果不完整的 `note` 来自 `get_selection`。请缩小范围重新扫描剩余部分。

`get_selection`

无参数。返回面板当前状态：`{ hasScan, lastScanAt, filter, total, truncated, visibleCount, unresolvedCount, resolvedCount, byTag, items, markdown, note }`。`items` 只包含面板当前显示的未完成标记，`markdown` 是同一份清单的 `- [ ]` 形式，可直接粘贴。

`items`、`markdown` 与 `visibleCount`、`unresolvedCount`、`resolvedCount` 都跟随当前 `filter` —— `resolvedCount` 只统计用户真正勾掉的条目，被筛选隐藏的标记绝不会被算作已完成 —— 而 `total` 与 `byTag` 描述整次扫描。若 `hasScan` 为 false，说明本次会话还没有扫描过。

## 面板

筛选按钮（全部、TODO、FIXME、HACK、XXX）、每条一个勾选框、「N open」计数，以及未完成条目的 markdown 视图。扫描会立刻把结果推送到面板；「Refresh」只是重新获取当前状态，不会重新扫描。

勾掉一条只会改变 `get_selection` 的返回内容：已完成的条目仍留在面板中（划掉显示），直到下一次扫描。新的扫描从零个勾选开始，因为旧的 key 已无法对应该文本。

面板与 `main.js` 通过同源的 `BroadcastChannel` 通信，且面板会先用 `fetch('cindy-ghost://todo-scan/wake')` 唤醒插件 —— 刚打开的面板通常遇到插件处于休眠状态。读状态的请求带 `reqId`，在收到回应前会被重发（刚打开的面板通常遇到仍在启动的插件）。设筛选和勾选只发送一次，并立即按面板自己的副本重绘；下一次读状态时才与插件对齐。所有面板消息都是幂等的，重复的读状态不会把勾选重复应用。面板没有连接宿主（Host）的通道：它不能调用工具、读取凭据或访问文件，也从不主动向 Agent 推送内容 —— 由 Agent 通过 `get_selection` 来问。

## 错误

| 代码 | 含义 |
| --- | --- |
| `INVALID_ARGUMENT` | `text` 缺失或为空，或 `tag` 不属于四类标记。 |
| `TEXT_TOO_LARGE` | 超过 200,000 字符；请一次扫描一个文件或一个 hunk。 |
| `UNKNOWN_TOOL` | 调用了本版本未提供的工具。 |
| `INTERNAL_ERROR` | 插件未完成即停止；没有修改任何内容。 |

错误消息给出下一步该怎么做，插件不会自行重试。

## 隐私

全部在本地内存中完成。不读写文件、不读剪贴板、不截屏、不联网、不上报遥测、`ghost.json` 未声明任何凭据，也不持久化任何内容 —— 扫描结果、筛选和勾选状态都只存在于插件进程中，插件停止即消失。插件唯一能看到的文本，就是 Agent 传给 `scan_todos` 的内容。

## 开发与打包

在仓库根目录运行 `node --test .tests/todo-scan.test.mjs`。测试在 `node:vm` 中用模拟的 Host 和模拟的 `BroadcastChannel` 运行 `main.js`，覆盖扫描器（一行多个标记、tag 筛选、200 条上限、行列编号）、参数校验、两个工具、面板协议（wake、重试、`reqId` 去重、筛选与勾选）、筛选计数与整次扫描计数的区分，以及页面 CSP。模拟测试不能代替在真实 Cindy 版本上的验收。

仓库通过 `.github/scripts/package-plugin.sh` 打包提交的目录，并附上根目录的许可证和商标说明；没有需要重新构建的生成代码或 vendor 代码。

参考：[Cindy](https://github.com/makecindy/cindy)。
