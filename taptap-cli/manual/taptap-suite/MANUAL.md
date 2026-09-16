# TapTap CLI 插件:共享执行规范

本插件是 TapTap 官方 CLI(taptap-cli)的 Cindy 封装:所有业务通过 `list_tools`(查目录)与 `call_tool`(执行操作)两个工具完成,执行体是**用户本机已安装的官方 taptap-cli**,插件不随包分发也不下载任何二进制;登录态、凭证、风险门禁与 JSON 输出契约都以该 CLI 自身为准,插件不读取、不保存凭证。本手册是所有业务手册的共享执行规范与总入口。

> **前置条件**:本机必须已安装并登录 taptap-cli。以下三条**由用户在终端执行,插件不代跑**(安装与升级不属于业务操作):`npm install -g @taptap/cli` 全局安装(包约 37MB);`taptap-cli update --skills-layout suite` 安装 AI Skills 并合并为单个 taptap-suite;`taptap-cli auth login` 补做授权。调用返回 `CLI_NOT_INSTALLED` 时,把其中的安装指引原样告诉用户;若 CLI 装在非标准位置,让用户在插件设置页填写其绝对路径。不要改用 Shell、npx 或其它方式绕过本插件去执行 TapTap 业务命令。

> **手册名对照(必读)**:各手册正文里出现的 `taptap-app-edit`、`taptap-materials` 等名称,沿用自 CLI 自带的同名 Agent Skill。在本插件里它们不是 Skill,而是随包手册,按下表读取:
>
> | 正文中的名称 | 本插件手册(`ghost_manual` 的 path) |
> | --- | --- |
> | `taptap-cli` | `taptap-suite`(即本手册,总入口) |
> | `taptap-identity` | `taptap-suite/references/taptap-identity` |
> | `taptap-app-edit` | `taptap-suite/references/taptap-app-edit` |
> | `taptap-publish-game` | `taptap-suite/references/taptap-app-edit`,详见其 `references/publish-game-creation.md` |
> | `taptap-materials` | `taptap-suite/references/taptap-materials` |
> | `taptap-asset-library` | `taptap-suite/references/taptap-materials`,详见其 `references/asset-library-*.md` |
> | `taptap-qualification` | `taptap-suite/references/taptap-qualification` |
> | `taptap-package-management` | `taptap-suite/references/taptap-package-management` |
> | `taptap-test-plan` | `taptap-suite/references/taptap-test-plan` |
>
> **两层手册**:本插件的手册是**执行纪律层**——它规定怎么经 `call_tool` 调、写门禁怎么走、失败三态怎么读,冲突时一律以它为准。
> 需要 CLI 自带的官方原文(安装 CLI 时内置,随 CLI 版本更新)作为**深入参考**时,用:
> `call_tool(name:"skills", args:{_positional:["list"]})` 看清单,`call_tool(name:"skills", args:{_positional:["read","<手册名>"]})` 读取单个;
> 读到的是 CLI 的命令行写法,执行前仍要按下方映射表转成 `call_tool`。
>
> 读法:`ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-app-edit/MANUAL.md"})`。`path` 必须是**以 `.md` 结尾的完整文件路径**:传目录会返回 MANUAL_PATH_NOT_FOUND,路径里也不允许出现 `..`。**本手册内所有链接的目标已经是 `ghost_manual` 的 path,原样传入即可**(例如 `[shared execution](taptap-suite/references/shared-execution.md)` 就读 `taptap-suite/references/shared-execution.md`),不需要再按当前文件位置换算。
>
> **在 Cindy 里处理 TapTap 业务,一律以本插件的手册为准。**
>
> 本机可能因为安装 CLI 而存在官方 Skill,形态取决于 CLI 的 skills 布局:
> - **separate 布局**(默认):10 个独立 skill,名字是 `taptap-app-edit`、`taptap-test-plan` 等;
> - **suite 布局**:只有 1 个 `taptap-suite`,子能力收在它的 `references/taptap-xxx/SKILL.md`。
>
> 两种布局描述的都是同一套流程,但其中的命令示例必须按上方映射表经 `call_tool` 执行,**不要照着它用 Bash 直接跑 taptap-cli**——那会绕过本插件的写门禁、只读限制和失败三态,也会绕过本插件不提供的数据查询。遇到正文里的 `taptap-xxx` 名称时,一律按本表转成本插件手册,不要去查找或改读这些 Skill。

> **命令行示例映射(所有手册通用)**
> 各业务手册中保留的 `taptap-cli ...` 命令行示例,一律按下面映射转成 `call_tool` 调用,不要在终端运行:
>
> | CLI 命令行示例 | call_tool 等价调用 |
> | --- | --- |
> | `taptap-cli app get-app-module --dev-id 1 --app-id 2 --data '{"module_id":"basic-info"}'` | `call_tool(name:"app get-app-module", args:{developer_id:"1", app_id:"2", data:{module_id:"basic-info"}})` |
> | `--dry-run` | `args.dry_run: true` |
> | `--yes` | `args.yes: true`(仅用户明确同意后) |
> | `--data @file.json` | `args.data: {...}`(内联 JSON 对象),或传字符串 `"@relative-file.json"`——文件由 CLI 相对**会话工作目录**解析,所以文件放在当前工作目录时可直接用。`-` stdin 经本插件调用时不可用 |
> | `taptap-cli upload ./icon.png --app-id 2 --dev-id 1 --yes` | `call_tool(name:"upload", args:{_positional:["./icon.png"], app_id:"2", developer_id:"1", yes:true})` |
> | `taptap-cli schema app save-changes` | `call_tool(name:"schema", args:{_positional:["app","save-changes"]})` |
> | `taptap-cli task +list` | `call_tool(name:"task", args:{_positional:["+list"]})` |
>
> **参数模型(务必按此传参)**:`developer_id` / `app_id` 是 scope 字段,直接传,插件会自动映射成 `--dev-id` / `--app-id`;其余业务字段**必须放进 `args.data`(JSON 对象)**。除 scope 和 `data` 外的键都是控制 flag,透传成对应 `--flag`(如 `dry_run` → `--dry-run`),合法性由 CLI 校验。本地文件路径必须是**相对会话工作目录**的路径:CLI 以会话工作目录为基准校验,拒绝绝对路径与 `../` 越界。输出已默认是结构化 JSON envelope,不要传 `--json` 或 `--format json`。

**CRITICAL — 具体业务必须先按下方路由读取对应业务手册,再调业务工具;不要跳过手册直接裸调。**

**CRITICAL — 不可逆写和高影响写必须先 `dry_run: true` 预览或拿到用户明确确认,再以相同参数加 `yes: true` 执行。插件对 write / high-risk-write 操作内置了门禁:既没有 `dry_run` 也没有 `yes` 的写调用会被拒绝(CONFIRM_REQUIRED),只读会话里的写操作一律拒绝。是否已取得用户同意由你负责,`yes` 是执行开关而不是同意本身。例外:`auth login-start` / `auth login-wait` 是登录流程本身(用户在浏览器里完成授权),不走这道确认门禁;只读会话仍然拒绝它们。**

**CRITICAL — `yes: true` 不代表用户同意协议,也不代表用户已核对提审风险。遇到服务端要求额外确认时只展示响应实际返回的 warning,以及 `required_consents[].agreement.name` / `agreement.url`;任一字段缺失时必须停止并报告契约缺口,不得请求同意或回传 `consent_token`,也不能补造本地参数。**

**CRITICAL — 登录必须使用插件编排:未登录时先 `call_tool(name:"auth login-start")`,把返回的 `verification_url` 按两行原样提供给用户:第一行仅写"请完成授权:",第二行仅写 URL。不要使用 Markdown 链接语法,也不要重复展示 URL。随后立即执行 `call_tool(name:"auth login-wait", args:{login_handle:"..."})` 持续轮询,不要等待用户回复。不要输出/记录/上报 access token。登录成功后向用户只回复"登录成功"。**

## 快速决策

| 用户意图 | 读手册 | 起手动作 |
| --- | --- | --- |
| 查询能力、查看某域有哪些操作 | 本手册 | `list_tools()` 看顶层命令,再用 `list_tools(category:"<命令路径>")` 逐层下钻;不确定名字时传前缀搜索 |
| 登录、当前身份、找 developerId/appId | `identity` | 已有 ID 不重复查;否则查候选 |
| 创建新游戏、选择游戏类型或包体方向 | `app-edit`(新游戏创建一节) | 先收集并确认创建字段 |
| 改资料、素材、主包体、整版提审/撤审/发布 | `app-edit` | 先 read-before-write |
| 上传本地图片、视频或包体(单个文件或目录/zip 盘点) | `materials`(第一部分) | 先盘点和确认用途,再逐项上传和交接 |
| 查资质缺口、补资质材料、资质增量提审/撤回 | `qualification` | 先确认发布意图,再分析 |
| 检索、生成或收录游戏图片素材 | `materials`(第二部分) | 先本地素材后生图;上传执行在第一部分 |
| 查包体库、线上/待处理包、自测入口 | `packages` | 先读 overview |
| 查下载、PV、转化、订单、评分等数据 | 无 | 本插件不提供数据查询,说明后引导用户到开发者后台查看 |
| 管理测试计划、资格批次、用户资格、激活码 | `test-plan` | 先区分状态层级 |

## call_tool 返回解读

- 成功返回 `ok:true`,`result.envelope` 是 CLI 的 JSON envelope:顶层 `ok` / `data` / `error`。顶层成功看 `envelope.ok === true`。
- 业务失败返回 `ok:false`,`errorCode` 取值:`CONFIRM_REQUIRED`(写门禁/exit 10)、`BUSINESS_ERROR`(envelope.ok=false)、`CLI_FAILED`(非零退出)、`TIMEOUT`(超时,大文件可用 `_timeout_seconds` 放宽至 870)、`RESULT_TOO_LARGE`(输出超限,收窄查询)、`LOGIN_HANDLE_INVALID`(重新 login-start)、`WORKDIR_REQUIRED`(调用带本地文件参数但会话没有工作目录)、`UNKNOWN_TOOL` / `UNKNOWN_CATEGORY`。
- 失败时 `message` 已拼入 `error.type` / `error.subtype` / `error.message` / `error.hint`,按 hint 自纠后重试。
- 业务工具 `data.result.ok` 之类的字段只表示业务结果,不是顶层 envelope。

## 执行规则

- 判断请求是否属于 TapTap 开发者后台;不是就不要强行套插件。复杂流程和写操作先读 references 里的 shared execution。
- 缺 `developerId` / `appId` 时转 `identity` 手册;多候选让用户选择,不猜 ID,也不复用可能过期的历史 ID。交接调用显式带 `dev_id` 和 `app_id`。
- 发现命令:`list_tools()` 给顶层命令;`list_tools(category:"<命令路径>")` 逐层下钻(如 `"asset-library"`,再 `"asset-library ai-image"`);传一个没有子命令的命令路径会返回它接受的 flag。不确定命令名时直接传前缀搜索(如 `category:"up"`)。
- 参数不确定时先查目录:`list_tools` 下钻返回 schema 操作的参数 schema 与 use_when/avoid_when;也可以 `call_tool(name:"schema", args:{_positional:["<service>","<method>"]})` 查单个操作的完整输入输出,或对任意命令传 `args._help:true` 查看完整帮助。不猜字段或枚举。
- 优先使用目录已列出的操作;当前能力缺失时说明 CLI 暂不支持,并给可执行替代路径。
- 需要用户转到网页继续时,遵循 shared execution 的人工页面交接规范:已知可靠入口必须首轮提供,URL 单独占一行且只展示一次;不要使用 Markdown 链接包装、追加追踪参数或猜测页面路径。
- 写操作先读取最新状态和 `expected`,再 dry-run 或展示影响;`CONFIRM_REQUIRED` 是确认门禁,不是普通失败。
- `dry_run: true` 只用于 write / create / delete 变更预览;`prepare-*` 类操作如果目录标记为 `risk: read`,它本身就是只读预览,直接调用,不要追加 dry-run。
- 业务字段统一放 `args.data`,只有 `developer_id` / `app_id` 是独立 scope 字段(映射为 `--dev-id` / `--app-id`)。除 scope 和 `data` 外的键都是控制 flag,透传成 `--flag`,合法性由 CLI 按各命令自己的 schema 校验(未知 flag 由 CLI 拒绝);不确定可用 flag 时先对目标命令传 `args._help:true` 看完整帮助。typed 命令的 `data` 是完整 tool input。
- 默认输出就是 JSON,不要追加冗余的 `--format json`。
- 面向用户回复时先给业务结论,再给风险和下一步;把字段 ID、camelCase key、数值状态和内部工具名翻译成可读标签。除非用户明确要求调试信息,不粘贴完整 raw JSON、schema 或底层请求。
- `precheck-app-review` 返回 `required_consents` 时,只展示每项 `agreement.name` 和 `agreement.url`。任一字段缺失时停止并报告契约缺口,不得请求用户同意或回传 `consent_token`;只有详情齐全且用户在当前对话明确同意后,才把全部未过期的 token 原样放入 `submit-app-review` 的 `consent_tokens`,并保持原 `review_fingerprint` 和 `release_schedule` 不变。
- `auth status` 只在用户询问当前身份、登录失败或错误要求重登时调用,不作为每个任务的固定前置。唯一额外场景是人工页面交接需要区分当前构建环境且上下文中没有 `serverUrl`:此时只调用 `call_tool(name:"auth status", args:{offline:true})` 读取环境地址,不检查 Token 或访问网络。
- 长任务(上传大文件)超时返回 `TIMEOUT` 时,可加大 `_timeout_seconds`(最大 870)重试,或用 `task` 类命令查看/恢复已有上传任务,不要盲目重发完整上传。

## References

| Reference | 什么时候读 | 读取方式 |
| --- | --- | --- |
| shared execution | 复杂流程、写操作、确认门禁、错误处理和输出边界 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/shared-execution.md"})` |
| CLI command patterns | 命令树、上传命令与快捷命令的具体形态 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/cli-command-patterns.md"})` |
| business routing | 请求横跨多个业务域或路由不确定 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/business-routing.md"})` |
| 运营阶段识别与官方手册 | 提审、测试、首次上线或版本更新完成后的状态识别与运营手册交接 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/operation-handbooks.md"})` |
| 游戏物料要求 | 回答图片、视频、Windows 素材规格或判断素材是否合规 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/material-requirements.md"})` |
| TapTap 上架规则目录 v4 | 资料填写提示、审核规则溯源,以及区分官方规则与历史审核 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/official-review-rules-v4.md"})` |

## 不在本插件范围

- 命令能力一律以 `list_tools` 的实时目录为准(它直接读本机 CLI 的命令树,含 `+` 子命令);某个命令的完整帮助用 `args._help:true`。
- 未开放的服务端能力不做承诺;存在可靠官方入口时按 shared execution 的页面交接规范提供。
