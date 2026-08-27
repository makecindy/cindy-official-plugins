<p align="right">
  <strong>简体中文</strong> · <a href="plugin-authoring.md">English</a>
</p>

# 插件编写与迁移参考

本文供任何 coding Agent、编辑器或人工开发者使用，不依赖 Cindy Forge 或特定 harness。
最小目录、完整入门 Manifest 与 ZIP 打包见 [README](../README.zh-CN.md#本地开发)；
官方仓发布要求见 [贡献指南](../CONTRIBUTING.zh-CN.md)。本文补充迁移映射与常用运行时调用。

## 从任务事实推导改动

作者描述要实现的功能即可。执行任务的 Agent 应读取现有 `ghost.json`、入口代码和相关
资源，自己完成格式转换、声明维护、版本调整、文案同步与校验，不把字段映射清单交给
作者手工执行，也不要求作者在每次任务里重复粘贴本指南。

- 新建插件：从 README 的 v3 示例开始，只增加功能实际需要的声明与资源。
- 修改已有插件：保留 ID、入口、工具接口和已有能力；若包内容变化且仍是 v2，按下表
  迁移。不要用最小示例覆盖已有 Manifest，不要顺手迁移其它插件。
- 普通 HTTPS、工作目录写入、CLI：先选用下文已有接口，不为具体域名、路径、命令
  新增 Slot、客户端白名单或新的执行 API。
- 能从现有实现判断的事项自行处理；只有功能取舍、无法确认的目标客户端版本或尚未
  获得的实机验证证据需要向作者说明。不能猜一个最低版本，也不能把未验证写成已验证。

## Manifest v2 到 v3：保留行为，转换表达

`schemaVersion` 描述清单格式；`minCindyVersion` 描述这个包实际需要的客户端版本，
两者不是同一个概念。迁移时设 `schemaVersion: 3`，确认包的最低版本，完成下表转换
之后才删除 `slots`。下面只描述已有能力的等价写法，不要求插件增加原来没有的能力。

| v2 的 slot / 字段 | v3 表达 | 迁移时保留什么 |
|---|---|---|
| `tool` | `tools` | 完整工具清单、参数、描述；已有字段保留 |
| `card` | `card: {}` 或原 `card` 对象 | 仅渲染也要保留空对象；已有 `externalLinks` 不丢失 |
| `agent` | `agent: {}` 或原 `agent` 对象 | 基础点击触发用空对象；已有可选字段保留，不自动加后台能力 |
| `panel` | `panel` | HTML 路径、标题、位置及尺寸配置 |
| `main-view` | `mainView` | 应用级主视图声明，与 `panel` 不互相替代 |
| `cindy`，旧别名 `model` | `cindy` | 原动作详单；只有旧 `model` 字段时改名，两个都有时以原 `cindy` 为准 |
| `subscribe` | `subscribe` | topics/hooks 及相关 `launch` 配置 |
| `node` | `node` | entry/entries、协议、生命周期、`childSpawn`、凭证绑定 |
| `network` | `network` | hosts、secrets、connections 和各自注入范围 |
| `preview` | `preview` | 原 hosts，不自动扩大可打开的网址范围 |
| `skill` | `skill` | items 与随包 SKILL.md，不改名或换成 Manual |
| `notify` | `notify: true` | 提示能力 |
| `badge` | `badge: true` | 未读点能力，仍需要 `panel` |
| `confirm` | `confirm: true` | 插件业务确认能力，不是安装授权弹窗 |
| `fs` | `fs: true` | 插件私有数据目录能力 |
| `library` | `library: true` | 持久作品库能力，不用 `fs` 代替 |
| `session-context` | `sessionContext: true` | Host 注入的可信会话上下文 |
| `pick` | `pick: true` | 用户选择目录的入口 |
| `workspace` | `workspace: true` | 工作区会话入口 |
| `ios-simulator` | `iosSimulator: true` | Host 内嵌模拟器入口；已有 Skill 等声明同时保留 |

布尔能力出现时必须为 `true`，不用时省略，不能写 `false` 或 `null`。
`manual`、`setup`、`locales`、`settingsHtml`、`command`、`keywords` 等独立字段继续保留；
不能因为它们不在 `slots` 中就删除。只做格式迁移时，不应改动工具行为或源码执行路径。
旧清单中只有名字、没有详单的历史空声明不应被补成新增权限；结合实际代码判断。
不认识的声明不能凭名称猜测映射或静默删除，应依据目标 Host 的真实契约确认。

例如，旧 `slots: ["tool", "card", "node", "session-context", "pick", "preview"]`
迁移后保留原 `tools`、`node`、`preview`，保留原 `card`（没有对象则补 `{}`），
补 `sessionContext: true`、`pick: true`。只删除 `slots` 会漏掉后三类纯声明能力。

未知 v3 顶层字段会由校验器保留；这既不等于自动授权，也不证明 Host 已实现该能力。
新业务若能由现有网络、文件或 Node 接口完成，无需客户端增加具体业务能力注册。
真正没有 Host 实现的接口，不能通过自造字段或方法名获得。

## 版本与安装事实

- Agent 应根据这个插件依赖的清单格式、Host 接口及正式发布证据确定
  `minCindyVersion`。仅沿用 v2 包的旧值不一定正确；代码已合入也不等于已发布。
  README 的 `1.2.3` 是占位示例，仓库不规定统一客户端版本下限。
- 当前官方仓 CI 要求新插件和包内容变化的插件使用 v3；描述、图标、包内文档也算
  包内容。公共随包的 LICENSE/NOTICE/TRADEMARKS 文件变化会影响全部插件；根目录
  README、本文或 CI 文件本身不进入插件包，不触发插件迁移。
- 包变化需要提升插件自身 `version`。迁移 v3 后，不能再声称支持只认识 v2 的客户端。
  Server 根据包的最低版本向旧客户端选择兼容历史 release；没有则不展示。若任务
  明确要求给仅支持 v2 的客户端继续发修复包，当前仓库门禁不支持，应说明冲突，
  不可降低版本元数据来绕过，也不可自行修改 CI。
- 安装和更新不以能力变化为由逐项请求确认，来源不构成另一套能力授权策略。原有
  自动安装入口仍存在；开发工具的“打包”只生成产物，安装需有相应用户请求。
  使用时仍可能需要 Agent 授权、登录、配置凭证或用户选择目录，不能把这些取消。
- 包内 Manifest 应准确描述插件贡献项和自主 Host 使用；不要另造“市场摘要是实际包
  能力上限”的安装门禁。实际使用按 Host 支持、凭证边界和既有运行时授权处理。

## 运行时接口：先选择执行边界

`main.js` 是浏览器沙箱，不是 Node，不能直接 `require('node:fs')`、启动 CLI 或绕开
Host 直连外网。以下代码在插件运行时执行；编写插件的 Agent 不需要自身拥有 Cindy 工具。

### 工具调用与完成

Host 下发 `{ type: 'tool-call', tool, args, callId }`。按 `tool` 分派，使用这一次
`callId`，完成所有依赖该调用的操作后只返回一次 `tool-result`。不能持久保存、伪造
或在交卷后复用 `callId`，也不能把权限拒绝改成另一条绕过路径。

```js
cindy.onHostMessage(async function (msg) {
  if (msg.type !== 'tool-call' || msg.tool !== 'hello') return;
  await cindy.send({
    type: 'tool-result', callId: msg.callId, ok: true,
    result: { message: '插件已经正常工作。' }
  });
});
```

失败用 `{ type: 'tool-result', callId, ok: false, errorCode, message }` 返回可行动的
说明，避免裸堆栈、凭证和敏感请求内容。发送、删除等外部副作用在超时后可能已经完成，
应说明“结果未知，请先核对”，不能照搬只读示例自动重试。

### 普通 HTTPS

下列函数在对应 `tool-call` 的处理函数内调用，返回值放进最终 `tool-result.result`；
在处理函数中捕获失败，按上面的格式发送失败回包。
`example.test` 是占位域名，使用前替换为业务实际端点。

```js
async function readRemoteText(msg) {
  const response = await cindy.fetch({
    url: 'https://example.test/info', method: 'GET',
    headers: { Accept: 'text/plain' },
    as: 'text', timeoutMs: 30000, callId: msg.callId
  });
  if (!response.ok) throw new Error(response.message || '请求未完成，请检查网络或授权。');
  // ok 表示 Host 代发成功，不表示远端 HTTP 成功。
  if (response.status < 200 || response.status >= 300) {
    throw new Error('远端服务拒绝了请求，请检查服务状态与账号权限。');
  }
  if (response.truncated) throw new Error('响应过大，请缩小查询范围。');
  return { text: response.body };
}
```

当前在途 Agent 调用的普通 HTTPS 不需预登记域名。Host 仍执行 URL、SSRF、超时和
重定向检查。脱离该调用的自主联网需要 `network` 声明。Host 托管凭证、OAuth、动态
连接也需要对应声明并命中目标 host；`callId` 不授予读取或向任意域名注入凭证的权利。
不要把 token 写入 `headers` 或聊天参数。文本请求的 `body` 是字符串，仅用于支持
请求体的方法；4xx/5xx 也可能返回 `ok: true`，必须检查 `status`。

### 文件操作

| 目标 | 可用操作 | 授权与生命周期 |
|---|---|---|
| `root: 'workdir'` | 仅 `write` | 当前 `callId`，遵循会话权限模式；不需 `fs: true` |
| `root: 'save'` | 仅 `write` | Host 注入的 `args.save_deposit.token`；不需 `fs: true` |
| `root: 'data'` | `write/read/list/delete` | 需 `fs: true`；插件私有目录，卸载回收 |

```js
// 在 tool-call 内、发送 tool-result 前完成。
const written = await cindy.fs({
  op: 'write', root: 'workdir', path: 'output/summary.md',
  content: '# Summary\n', callId: msg.callId
});
if (!written.ok) throw new Error(written.message || '写入未完成，请检查工作目录和授权。');
// 成功字段包含 op、path、bytes；将实际结果交给 Agent。
```

`cindy.fs(options)` 等价于 `cindy.send({ type: 'fs-request', ...options })`。
`path` 是相对路径，不接受绝对路径、`..` 或穿透符号链接；内容默认 UTF-8，二进制可用
`encoding: 'base64'`。会话 workdir 的计划/只读模式会拒绝写入，远程工作区不能当本机
目录写入。保存票据必须真实存在且未过期，不能伪造 token。
读取/删除工作区文件不是把 `workdir` 的 `op` 换掉就能做到，应由既有 Agent 文件工具
或确实需要的 Node worker 完成，并遵守该执行路径的授权和范围。用户持久作品需要
`library` 时保留该能力，不能改存卸载即删的 `data`。

### 随包 Node / CLI

在现有 Manifest 中加入下面的字段片段，并声明实际工具（例如 `git_version`）。
`entry: 'main.js'` 仍是沙箱入口，`node.entry` 是另一个真实的随包文件。

```json
{
  "node": {
    "entry": "node/worker.cjs",
    "protocol": "json-rpc-stdio",
    "lifecycle": "on-demand"
  }
}
```

下例要求 Git 已安装且在 worker 的 PATH 中可用，仅固定执行 `git --version`，
不拼接用户输入到 shell，不需要额外 Node 依赖。缺少 Git 是环境配置失败，不能回报成功：

```js
// node/worker.cjs：stdout 只写一行一个 JSON-RPC 消息，日志写 stderr。
const readline = require('node:readline');
const { execFile } = require('node:child_process');
const reply = (value) => process.stdout.write(JSON.stringify(value) + '\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let request;
  try { request = JSON.parse(line); }
  catch { reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
  if (!request || request.id === undefined) return;
  if (request.method !== 'cli/git-version') {
    reply({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } });
    return;
  }
  execFile('git', ['--version'], { timeout: 5000 }, (error, stdout) => {
    reply(error
      ? { jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'Git 检查失败，请确认已安装 Git 且 PATH 中可用' } }
      : { jsonrpc: '2.0', id: request.id, result: { version: stdout.trim() } });
  });
});
```

```js
// main.js：完整工具回包示例，Manifest 的 tools 中须有 git_version。
cindy.onHostMessage(async function (msg) {
  if (msg.type !== 'tool-call' || msg.tool !== 'git_version') return;
  let result;
  try {
    result = await cindy.node.request({ method: 'cli/git-version', params: {}, timeoutMs: 10000 });
  } catch {
    result = { ok: false, message: '本地工作进程未返回结果，请检查插件运行状态。' };
  }
  await cindy.send(result.ok
    ? { type: 'tool-result', callId: msg.callId, ok: true, result: result.result }
    : { type: 'tool-result', callId: msg.callId, ok: false,
        errorCode: 'NODE_REQUEST_FAILED', message: result.message });
});
```

Node worker 没有全局 `cindy` 或 Electron IPC；需要 Host 能力时先把结果交回 `main.js`。
`cindy.node.request` 的 `timeoutMs` 为 1000–120000，缺省 30000；可选 `entry` 只能
指向 `node.entries` 声明的额外入口。`mcp-stdio` 沿用同一入口，MCP 初始化由 Host
处理，插件不要自行调用 `initialize`。运行具体 CLI 不需要改客户端注册表，也不存在
本指南要求新增的 `cindy.process.run`。真实外部 CLI 的安装、平台支持和参数安全仍须验证。

`node.childSpawn: true` 开启的是 Host 的 `globalThis.__CINDY_NODE__.spawnEntry`
桥接，只能代启 `node.entry` / `node.entries` 中的 JS 文件。它不是普通
`child_process.execFile` 的开关，上面的 Git 示例不需要它。不能把 `process.execPath`
当作 Node 可执行文件：正式 Cindy 包关闭了 Electron RunAsNode；随包 JS 子进程应走
上述宿主桥接。Node worker 拥有当前系统用户权限，不受浏览器沙箱限制，命令、文件和
网络操作仍应限定在任务要求的范围内。

托管 HTTP 凭证用 `network.secrets[].inject` / `network.connections[].inject`；确需
Worker 使用明文时用 `node.secretBindings` 限定方法和入口，Host 在请求的
`cindy.secrets` 注入，不能通过普通 `params` 传入、缓存、回传或写日志。凭证配置与
业务调用分开，不把“安装成功”等同于“账号已连接”。

## 校验与交付：Agent 自行完成，不增加作者手工步骤

1. 对照旧声明与源码检查迁移后仍有所有原能力，保留引用的资源、工具参数和四语言
   文案；语义变更是本次需求才调整，不自动删权限来让校验通过。
2. `node scripts/validate-plugin-manifest.mjs ./<目录>` 只校验 JSON/Manifest 形状，
   不检查文件存在、包内容、目标客户端实际支持情况或官方仓全部发布规则。
3. 按贡献指南运行仓库门禁及相关插件测试。官方打包脚本
   `.github/scripts/package-plugin.sh <目录> <输出.cindy>` 从已提交的 **HEAD** 归档，
   不会包含未提交修改；验证工作区产物可先用 README 的 ZIP 命令，正式验收必须对应
   最终提交内容。查看包根目录及声明文件，不能把外层插件目录一起套进去。
4. 在满足真实最低版本的生产稳定版 Cindy 上安装最终包，实际调用核心工具、确认失败
   分支和原有能力仍可用。有可用且获授权的操作工具时由 Agent 完成；否则明确交接
   尚未验证的步骤，不能替作者虚假勾选。CI 读取的是 PR 实机验证声明，不是实机证据
   采集器，也不会替作者判定最低版本正确或自动比较迁移能力。

## 文档与注释的解释边界

运行时示例依据 Cindy [Host 编写参考](https://github.com/makecindy/cindy/blob/d1171fc58cc3368005a92c63afe8b4b7bc0ccda3/apps/desktop/src/main/cindy-brain/forge.ts)，
列在这里供任意 harness 直接使用，不要求调用 Forge 或 checkout 客户端。
固定校验器的来源在 `.tests/contracts/plugin-manifest.*.mjs` 文件头；它是生成产物，
不手改，也不是完整 SDK 手册。里面保留的 v2“槽”“安装确认框”等历史注释不能用来
恢复安装授权门禁；当前行为以本文、贡献指南和目标 Host 的实际接口为准。修改文档时
同步中英文，不因纠正文案去更改插件包、Host 行为或新增 CI 限制。
