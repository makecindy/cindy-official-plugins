# Identity Behavior Rules

### 关于切换

用户表达"切到 X 厂商 / 切到 Y 游戏 / 帮我打开另一个 app"时：
1. 不要把本地凭证绑定或事件上下文当成 CLI scope 选择器；scope 通过
   `developer`、`app` 命令的参数显式选择。
2. 用 `call_tool(name:"developer +list")` 或 `call_tool(name:"app +list", args:{dev_id:"<developerId>", kw:"<keyword>"})` 找到目标。
3. 用 `call_tool(name:"developer +enter", args:{dev_id:"<developerId>"})` 或
   `call_tool(name:"app +select", args:{dev_id:"<developerId>", app_id:"<appId>"})` 校验并保存 CLI scope。
   这两条会改写本机 CLI 配置，CLI 把它们标为 write：先说明再取得用户同意，然后加 `yes:true` 执行。
   保存后，后续命令可以省略对应 ID；显式传入的 ID 始终优先。
4. 可选地输出本次 `app +list` / `overview` 每个游戏的资料页入口供人工查看：优先使用返回的 `page_url`，缺失时使用 CLI 根据已确认 `developerId` 和 `appId` 推导的规范地址。打开页面不会改变 CLI scope，也不会让下一条消息自动继承页面 scope；
   不要把页面跳转当成 CLI 切换，也不要声称已切换网页状态。
5. 身份发现的页面入口固定为对应游戏的资料编辑页。优先使用 CLI 返回值；返回值缺失时的推导规则按 [shared execution](taptap-suite/references/shared-execution.md)「人工页面交接和链接输出」执行，不得把 host 改为 Capability API 域名 `api.tapapis.cn`，不得改变 `/v3/{developerId}/app/{appId}/store/update` 路径，推导地址必须标记为 CLI 根据 ID 生成。面向用户时先写游戏名称或查看动作；URL 单独占一行且只展示一次，不要使用 `[label](page_url)`、`page_url (page_url)` 等 Markdown 链接或括号包装形式，也不要追加追踪参数。
6. **不要假装自己能切换网页**——CLI 只能保存自己的 profile scope；网页切换仍由用户在页面中主动完成。

### 关于创建或入驻厂商

用户说“帮我创建新的厂商”“注册厂商”“申请厂商”或“入驻开发者”时，这是人工入驻入口请求，不是已有厂商候选查询：

1. 不要先运行 `developer +list`，也不要只回复 CLI 不支持。
2. 已知当前环境 `serverUrl` 时直接使用；未知时用 `call_tool(name:"auth status", args:{offline:true})` 读取 `data.serverUrl`，不检查 Token 或访问网络。
3. 首轮按两行输出，链接后再说明 CLI 不能代为提交主体资料和资质审核：

   ```text
   请前往 TapTap 开发者中心创建厂商：
   <serverUrl>
   ```

4. `serverUrl` 原样输出一次，不拼接深层注册路径，不使用 Markdown 或括号包装，不添加追踪参数，也不调用网页搜索。

### 关于 global scope

global scope 表示当前会话没有选定厂商或应用。不要把它解释成某个业务的“账号维度”或“全部资源”范围；具体业务 pack 是否可用，以 `loadPack` catalog 和该 pack 自己的 scope 规则为准。

需要应用上下文的业务操作仍需引导：
1. 先用 `call_tool(name:"developer +list")` 列出厂商
2. 让用户选一个厂商，再用 `call_tool(name:"app +list", args:{dev_id:"<developerId>", page_all:true, page_size:50})` 列出游戏
3. 用 `call_tool(name:"developer +enter", args:{dev_id:"<developerId>"})` 或
   `call_tool(name:"app +select", args:{dev_id:"<developerId>", app_id:"<appId>"})` 保存 CLI scope（写操作，需用户确认）；
   页面链接只能作为可选的人工查看入口。

### 关于 developer scope

developer scope 下你知道 `developerId`，但没有选定具体应用。需要 `appId` 的业务操作仍需引导用户打开目标 app 页面；具体业务 pack 是否在 developer scope 可用，以 `loadPack` catalog 和该 pack 自己的 scope 规则为准。

需要应用上下文的业务操作仍需先用 `call_tool(name:"app +select", args:{dev_id:"<developerId>", app_id:"<appId>"})`
保存 CLI scope（写操作，需用户确认）；页面链接只能作为可选的人工查看入口。

### 关于用户给的"账号 / 游戏 / 任何业务对象"是名字还是 ID（**所有 scope、所有业务通用**）

用户日常表达里的指代字符串往往含混：纯数字也可能是昵称、复制文本或错误 ID，不能仅按长度推断其业务类型。

**通用规则（任何 skill 在调写工具 / 取详情前都应该先按这条解析）**：

1. **先确认字段类型**：
   - 用户明确说“developerId / appId / userId 是 …”时，才把该字符串作为对应 ID 候选。
   - 用户只给出数字或名称但未说明类型时，一律视为含混候选，先通过当前 scope 的列表/选择命令验证，不直接传给写工具。
   - 任何 ID 候选都要验证它属于当前账号和目标 scope；写操作前仍需展示解析结果并取得确认。
2. **按名字解析**：调当前业务对应的列表工具 + 名字过滤参数，**在当前 scope 的可见范围内查**：
   | 业务 | 解析工具（按昵称 / 名字过滤） |
   |---|---|
   | 找厂商制作人员 | 使用厂商资料相关工具按昵称检索 |
   | 找厂商官方号 | 使用厂商资料相关工具按昵称检索 |
   | 找游戏 | `call_tool(name:"app +list", args:{dev_id:"<developerId>", kw:"<字符串>"})`（本 skill，任何 scope）|
   | 找详情页展示的官方号 / 制作人员 | 使用厂商资料相关工具查询，再用对应展示配置工具修改 |
3. **按结果分流**：
   - **0 命中** → 告知用户"在当前 [厂商/游戏] 里没找到叫《X》的 [制作人员/官方号/游戏]，是不是漏字 / 拼错了？也可以明确告诉我这是哪一类 ID"，**不要瞎试**
   - **按游戏名检索 0 命中，且确认该厂商下确实没有这款游戏** → 新建游戏转 `taptap-publish-game`，不要停留在澄清循环
   - **1 命中** → 用那条记录的 ID 继续后续工具调用
   - **多命中**（重名常见） → 列给用户挑："找到 N 个叫《X》的：(1) ID xxx ...; (2) ID yyy ...。要操作哪个？"
4. **若明确类型的 ID 候选验证失败** → 回退到按名字解析或请用户重新确认，不对其他 ID 类型做猜测。

**反模式 ❌**：用户说"帮我把这串数字对应对象的 X 改一下" → 未确认对象类型、未验证当前 scope 就把数字传给写工具。

### 关于跨 scope 引用历史事实

scope 切换后，历史 turn 里的事实仍然可被引用（这是合法且常见的）。例如：
- 用户在 app A 时让你给标题写了 3 版方案
- 用户切到 app B
- 用户说："把第 2 版套到这里"

此时你应当：
1. 从历史 turn 提取标题事实（"第 2 版"对应的具体文字）
2. 调当前 scope（app B）的业务工具（如 `save-changes`）写入
3. 工具闭包注入的 appId/developerId **始终是当前活跃 scope（B）**，不会因为引用了 A 的历史事实就回退到 A

不要把跨 scope 引用当成错误，也不要主动否认这种用法。

### 不要把 identity 发现命令当业务工具用

`developer +list`、`app +list` 只用于回答"有哪些可达资源/在哪切换"。统计某厂商下游戏数时执行 `call_tool(name:"app +list", args:{dev_id:"<developerId>"})` 并读取 `total`；不要用 `app +list` 替代 `taptap-app-edit` 对当前资料模块、包体和版本的字段层分析。

`app +list` / `overview` 的游戏条目包含服务端返回的 `review_status_label`。直接展示该标签，不要自行改写；例如“已上线（素材待优化）”应保持完整。单个条目没有状态时显示“未知”，不要把缺失状态当成“未发布”或其他业务状态。

用户需要版本、包体或更细的发布信息时，转 `taptap-app-edit` 对指定 App 读取对应资料。

### app +list 参数规范

- 关键词：`--kw "<keyword>"`
- 指定起始页：`--page <N>`
- 指定每页条数：`--page-size <N>`，最大 50
- 获取全部页面：`--page-all`；可配 `--page-limit <N>` 和 `--page-delay <ms>`
- 身份发现不要退回内部 tool 入口，也不要用 `--data` 包装 `keyword/page/pagesize`
- 只有嵌套对象或必须整体提交完整 typed tool input 时才使用 `--data`；关键词、页码、页大小属于标量 flag

### overview 参数边界

- `overview` 用于一次读取登录态、可见厂商、各厂商游戏总数和样例；可选参数只有 `--dev-id` 与 `--page-size`
- 不要对 `overview` 使用 `--page-all`、`--page-limit` 或 `--page-delay`，也不要先错误调用再解释为“总览命令不接受分页参数”
- 用户需要完整游戏列表时，先标准调用 `overview` 确认可见 developerId，再对目标厂商执行 `call_tool(name:"app +list", args:{dev_id:"<developerId>", page_all:true, page_size:50})`
