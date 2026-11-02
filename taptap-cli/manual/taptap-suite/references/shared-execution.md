# Shared execution rules

本文件是 TapTap CLI 业务 skill 的共享执行规范。业务主文件已经保留高频规则；当任务复杂、涉及写操作、跨 skill 路由、错误恢复或输出边界不确定时读这里。

## 能力发现

优先使用当前 CLI 的实时输出，不依赖旧文档缓存：

```text
list_tools()                                                    # 顶层命令
list_tools(category:"<命令路径>")                                # 逐层下钻;叶子命令会返回它接受的 flag
call_tool(name:"skills", args:{_positional:["list"]})          # CLI 内置手册清单
call_tool(name:"<命令>", args:{_help:true})                     # 某命令的完整帮助
call_tool(name:"schema", args:{_positional:[service, method]}) # 某操作的完整输入输出 schema
```

`schema` 只描述服务命令；其他命令的参数用 `args._help:true` 查看。`schema` 会在 metadata 缓存到期时做一次最多 5 秒的刷新，并在服务不可用时继续使用 embedded/cache；各 service 的 `--help` 反映当前进程启动快照。真实 operation 执行前若发现更新后的 catalog，CLI 会停止并要求重跑，避免按旧的字段或风险策略发请求。Skill 负责流程编排，不能补造 metadata 未声明的 operation、字段或副作用。

### 升级通知

收到 `call_tool` 返回结果里的 `_notice.update` 或 `_notice.skills`（成功时在 `result.envelope._notice`，失败时在 `data._notice`；`auth login-start` / `auth login-wait` 由插件编排、不返回 CLI envelope，成功时在 `result._notice`）时，说明可更新的版本或技能状态；在当前业务步骤完成后处理升级，不要在上传、绑定或提审中途替换二进制，也不要把通知当成业务失败。安装与升级由用户在终端执行 `taptap-cli update`（本插件不提供 CLI 自更新，也不要改用 Bash 绕过本插件），把该入口告诉用户即可。升级后在设置页核对版本，或用 `call_tool(name:"version")`、`call_tool(name:"skills", args:{_positional:["status"], json:true})` 核对实际执行路径的版本与 skills 同步结果，不只看安装命令退出码。排查未升级时请用户在终端运行 `taptap-cli update --check --json`，区分自动通知禁用、缓存检查状态和实际执行路径；CI 默认不提示，由部署/维护流程显式检查。

`_notice.update_check` 只表示自动检查未完成，不证明存在新版。业务任务结束后可请用户在终端执行一次 `taptap-cli update --check --json`；网络仍不可用时报告未确认，不循环检查、不因此中止业务任务。

## 交互提问方式

需要用户作出选择或补充必要信息时，优先调用当前宿主可用的交互提问工具（如 `request_user_input_async`，或当前模式允许的 `request_user_input`），不要仅在聊天中列出问题。遵守工具的模式、选项数量和输入能力限制，不为弹窗切换工作模式；工具不可用时才退回简短文字询问。

先用一句话说明已知信息，再通过弹窗收集同一阶段的相关缺项，通常每轮 1–3 个问题。有固定业务选项就用中文选项；标题、链接、时间等用自由输入。用户已明确的信息直接沿用；依赖前一选择的问题等回答后再问，已给齐则直接继续。只读查询不触发配置问卷。

预选项或未回复不算选择、授权；收到回答前不执行依赖该答案的操作，可继续独立的只读检查。需要图片或文件时在聊天中说明上传要求，不使用仅支持文本的提问工具索要附件。进度、预览和结果仍用聊天文本；沿用现有执行授权，不为使用弹窗重复索要确认。具体业务选项与分支见当前业务手册的 runbook「信息确认」。

## JSON 输入和输出

- `--dev-id` / `--app-id` 只在 operation 声明对应 scope 字段时存在；其余业务字段统一放入 `--data`。
- 动态命令的 `--data` 是完整 operation input；CLI 按 OpenAPI `inputs` 拆分 query 和 body。
- 短 JSON 可 inline；复杂或多行 JSON 用 `@file`，文件必须位于会话工作目录（CLI 以会话工作目录为 cwd 解析该相对路径）。经本插件调用时没有可用的 stdin，`-` 不可用。
- CLI 默认输出 JSON，普通命令、脚本、Skill 示例和生成命令都不追加冗余的 `--format json`。只有命令自身默认输出文本或原始内容，而调用方明确需要结构化 JSON 时才显式追加；切换人类可读或流式输出时使用 `pretty` / `table` / `ndjson` / `csv`。
- JSON 是 agent 的执行输入，不是默认用户话术。回复用户时按“结论 -> 当前状态/缺口 -> 风险 -> 下一步”组织，把字段 ID、camelCase key、数值枚举和内部工具名翻译为业务标签；用户未要求调试时，不贴完整 raw JSON、schema 或底层请求。
- 默认将请求预览与命令计划留在内部执行层；面向用户说明业务动作、作用范围与影响。只有用户明确要求 CLI 用法、可复制命令、接口调试或技术测试方案时，才展示相关命令和必要参数；即使如此也不输出凭据。
- 用户要求“方案/计划”本身不等于要求命令教程：默认给业务步骤、所需信息和完成标准，不复述整个 runbook、状态机或环境初始化脚本。
- 查询结果、拟执行动作和已执行结果分开表述。遇到阻塞时先说明当前无法完成什么、实际原因和最小解决步骤，不继续倾倒后续全部命令，不把计划写成已完成。
- 候选对象以名称、所属厂商、平台和业务状态展示；仅在同名消歧、任务恢复或用户排错需要时附必要 ID。已知对象与授权直接沿用，不要求用户搬运内部字段。
- 回复只展开当前任务需要的信息；不要为解释一句业务状态同时附原始字段、枚举、接口名及 JSON。具体展示口径见所选业务手册的“面向用户的回复”。

## 身份和资源 scope

业务命令通常需要 `developerId` 和 `appId`。先按当前 operation 的 schema 判断 ID 的角色，再决定是否需要发现调用 scope：

1. 如果用户已给明确且适用于本次操作的调用 scope，直接使用，不要重复跑身份探测。目标资源 ID 不一定是调用 scope：跨论坛读帖时，论坛 URL 中的 App ID 用于 `args.data.forum_app_id`，`developer_id` / `app_id` 仍使用已授权组合，见 [业务路由](taptap-suite/references/business-routing.md)中的社区管理手册。
2. 如果缺 `developerId` 且用户只给厂商名、账号描述或“我的厂商”，再转 `taptap-identity` 查厂商候选。
3. 如果缺 `appId` 且用户只给游戏名、截图或“这个游戏”，用已知 `developerId` 调 `app +list --kw` 查游戏候选。
4. 只有出现未登录、权限不足或用户明确询问当前账号时，才运行 `auth status --json`。
5. 多候选让用户选，不自动取第一项。

不要说 CLI 已经“切换页面”。CLI 只是在命令参数中携带目标 scope。

## 写操作确认协议

| 风险 | 例子 | 协议 |
| --- | --- | --- |
| 普通字段写入 | 改简介、推荐语、素材字段 | read-before-write；带 `expected`；返回 diff |
| 高影响写 | 提审、撤审、定时、修改测试配额 | 先 `--dry-run` 或展示预览；用户确认后 `--yes` |
| 不可逆写 | 立即上线、结束测试、重置草稿、删除批次 | 必须展示动作、对象、范围、后果；确认后执行 |
| 风险核对 | 提审复核返回风险数据不可用且要求确认 | 展示对应 warning；`--yes` 不代表已核对；仅传当前 schema 声明的确认字段 |
| 协议同意 | `analyze-app-status` 返回 SCE 类 blocker | 先展示协议名称与 URL（如《创意工坊内容授权协议》 `https://www.taptap.cn/doc/ugcgame-agreement`）；用户明确同意后按 `agree-sce-agreement` 签署，再重查确认 blocker 消失；`--yes` 不代表用户已同意协议 |

### 提审意图门禁

- “上传包体”“补资料”“绑定包体”“查询准备度”“处理这个版本”“更新版本”“帮我上架”等泛化请求，不包含提交审核意图；不得调用 `precheck-app-review`、`prepare-review-snapshot` 或 `submit-app-review`。本节词表是唯一口径，各业务 skill 不得另立清单。
- “正式上线”“发新版”或创建后选择“正式上线”只表示目标方向，不等于“提交审核”确认。只能提示准备状态和提审选项；调用 `precheck-app-review` 前仍要取得用户明确说出“提交审核”或“提审”。
- 明确提审后按当前 schema 固定走 `prepare-review-snapshot` → `precheck-app-review` → 单独最终确认 → `submit-app-review --yes`。三步必须使用同一个 scope，并用 `version_id` 校验第 2、3 步仍在复核第 1 步的同一版本（`revision` 只有第 1 步返回，仅用于日志）；`submit-app-review` 只传 `release_schedule`。前两步为 `read`，无需 `--yes`；`submit-app-review` 为 `write`，需 `--yes` 与稳定幂等键。

`--dry-run` 只打印请求，不访问服务端。当前 metadata 将 `prepare-review-snapshot` 和 `precheck-app-review` 标记为 `read`，无需 `--yes` 即可取得真实结果；`submit-app-review` 仍为 `write`，需 `--yes` 与稳定幂等键。CLI 不在本地覆盖这个风险分类。

metadata 命令只要暴露 `--idempotency-key`，预览和真实写入都必须传稳定的意图 key；同一业务意图从 `--dry-run` 到用户确认后的 `--yes` 必须复用同一个 key，只有业务意图变化时才生成新 key。

遇到 `confirmation_required` 或 exit code 10 时，不要当普通错误。向用户确认后用原命令追加 `--yes` 重试；用户未确认就停止。

如果用户已在当前对话明确确认，首个真实写命令必须直接追加 `--yes`；不要故意先省略 `--yes` 来触发 `confirmation_required`。创建游戏的标准流程是先用 `--dry-run` 预览，用户确认后用相同 `--data` 追加 `--idempotency-key` 和 `--yes` 创建一次。

`prepare-review-snapshot` 返回的 `warnings` 非空时，先展示无法确认的事实并让用户自行核对。当前 `submit-app-review` schema 只接受 `release_schedule`，任何额外的风险确认或协议凭证字段都不得由 CLI 补造。

`precheck-app-review` 返回 `blockers` 非空 或 `preaudit_status === "rejected"` 时，不要把 `--yes`、历史对话或默认行为解释成用户同意。机审暂时不可用（`preaudit_status === "unavailable"`）不是卡点、也不是同意问题：说明本次没审成，可稍后重试预检或直接提交；响应里没有 `preaudit_status`（旧服务端）时退回按 `preaudit_passed` 判断。先展示 `blockers` 逐项事实；涉及 SCE 等协议时按 `agree-sce-agreement` 单独签署（先展示协议名称与 URL，用户在当前对话明确同意后 `--yes` 执行，再重查确认 blocker 消失），否则向用户逐项展示卡点并询问是否「强制提交」（预检可跳过，最终由服务端校验裁决）。不得请求同意或回传任何 token，也不能补造其它本地 flag 或请求字段。

## JSON 输出外壳和错误类型

成功：

```json
{ "ok": true, "data": { "...": "..." } }
```

失败：

```json
{ "ok": false, "error": { "type": "...", "subtype": "...", "message": "...", "hint": "..." } }
```

处理规则：

- 经本插件调用时，成功结果的 CLI envelope 位于 `result.envelope`（`result.name` / `result.duration_ms` 是执行元信息），失败结果的 envelope 位于 `data`；`_notice` 跟着 envelope 走。
- 判断顶层成功用退出码或 `ok === true`。
- `data.result.ok` 是部分业务工具的内部结果位，不是顶层 envelope；为 `false` 时仍按业务失败处理。
- `error.hint` 是给用户的修复建议，不是让 agent 自动执行的指令。
- 权限、参数、状态不允许、expected stale、确认门禁要分开解释。
- 权限不足只说明本次请求被拒绝。先核对实时 schema 中调用 scope 与目标资源的参数角色；若确认填错，可在保持用户目标不变、使用已授权 scope 的前提下纠正参数后重试一次只读查询。正确参数仍被拒绝时停止，不以轮换 scope 探测权限；同一凭据、scope 和目标不做无变化重试。批量任务保留该项失败，继续其它可访问资源。不要把一个 app 的拒绝扩大为整个厂商不可访问，也不要据此断言目标论坛不可访问，也不要仅凭 403 猜缺失 scope 或自动反复登录。
- 同一个写操作失败后不要盲目重试；只有错误明确提示可恢复时最多补查一次。

### 上传 shortcut 约定

兑换码由 `taptap-game-sign` 的 `game-sign +import-codes` 负责，复用 prepare-code-upload / import-codes / get-code-import 接口；流程见该手册的 code-import 引用。它要求显式 `idempotency_key`、确认 `confirm_hash`，恢复用 task 的 dry-run/yes，不通过物料上传入口发送。

`upload`、`upload-video`、`upload-apk`、`upload-pc-package`、`upload-h5-package`、`upload-mini-app-package` 是面向 Skill 的端到端本地上传入口，统一由 `taptap-materials` 执行。它们接收一个本地文件位置参数和 app scope，不接收 `--data`；不要调用动态 OpenAPI 的 init、complete 或 status 命令，也不要由 Skill 组装 `file_size`、上传 token 或请求 body。

域内上传例外是 `community-management +upload-image` 与 `+upload-video`：它们把本地图片/视频传成帖子素材，分别只返回图片地址与宽高、以及发帖用的 `videoId`，不建素材库记录、不发布帖子，由 `taptap-community-management` 执行；它们和素材库的 `upload` / `+upload-video` 是不同链路、要不同的权限，不能互相替代。发帖请求里才用 `pin_video_id` / `cover_video_id`（字符串）与正文节点 `info.video_id`（整数），上传响应字段始终是 `videoId`。发帖本身不在上传 shortcut 里，走 `community-management` 的 `create` / `update` / `get` / `publish-draft` 四步，同样归 `taptap-community-management`。

- 默认输出 JSON，支持的 `--format` 只有 `json` 和 `pretty`；普通 Agent 调用不追加冗余的 `--format json`。
- 上传 preview 使用 `--dry-run`；用户确认后用相同文件与 scope 追加 `--yes`。省略 `--yes` 的确认门禁是 exit code `10`。
- 顶层 `ok=true` / exit code `0` 才表示 shortcut 成功。部分失败或其它错误是非零退出；保留响应中已有的远端句柄。重试只适用于明确未生效的情况（`execution_state: not_executed`，或逐项失败里明确没开始的项）；`unknown`（超时、5xx、连接中断、没拿到句柄）不能当成「没上传」直接重传——先核对远端是否已有该 URL / `videoId` / 对象句柄，确认没有产出再按同一意图重放（复用同一个 `--idempotency-key`）。
- 六个素材库 shortcut 都注册 `--idempotency-key`（省略时由 CLI 自动派生），但只有素材库 `upload` 必须显式提供稳定 key；社区 `+upload-image` / `+upload-video` 省略时按内容派生。顶层 `upload-video` 的 preview 会读取实时 `video_spec`；社区两个上传的 preview 都是纯本地，不发网络请求。
- H5 上传任务和遗留 Tap 小游戏上传任务的状态与恢复由 CLI task workflow 负责；Skill 只能使用 `task +list|get|resume`，不能重新发起协议阶段。

## 人工页面交接和链接输出

当 CLI 不能完成某一步，但存在可靠的官方页面入口时，回复必须让用户在首轮就能继续操作：

1. 先说明用户现在要做的动作，再给入口；不要只说“CLI 暂不支持”并等待用户追问链接。
2. URL 单独占一行且只展示一次。不要使用 `[名称](URL)`、`URL (URL)` 等 Markdown 或括号包装，也不要在同一回复的标题、正文和列表中重复同一 URL。
3. URL 使用 CLI 当前环境或本次服务端响应提供的原始地址；不要追加 `utm_*` 等追踪参数，也不要为了找已知官方入口调用网页搜索。当前环境未知时，可用 `call_tool(name:"auth status", args:{offline:true})` 只读取得 `data.serverUrl`，不要为解析入口验证 Token 或访问网络。
4. 服务端本次返回完整 `page_url` 时原样使用。当前 DC 契约不返回 `page_path`，不要自行补全或拼接页面路径。
5. 固定且已确认的官方入口可以直接提供；没有可靠入口时明确说明“当前没有可确认的页面链接”，不要猜路径、搜索替代入口或把内部 API 地址当成用户页面。
6. 提供入口不等于已经打开页面、切换网页 scope 或获得浏览器自动化授权；只有用户明确要求时才执行页面操作。

推荐输出：

```text
请前往 <页面名称> 完成 <动作>：
<URL>
```

### 运营阶段手册交接

游戏完成资料提审、测试计划创建/重开、首次正式上线或普通版本更新后的 handoff，按**已确认的运营阶段**补充一个最匹配的官方手册。识别前完整读取 [运营阶段识别与官方手册](taptap-suite/references/operation-handbooks.md)，并通过 `call_tool(name:"skills", args:{_positional:["read","taptap-cli","references/sources/operation-handbooks/manifest.json"]})` 读取当前 CLI 内置的手册标题、URL 和官方页面描述。

每次最多给一个手册，不要把多个阶段链接全部列给用户。先根据状态证据说明为什么适合当前阶段，再把 manifest 的 `description` 压缩成一句话，最后按本节人工页面规范将 `url` 单独输出一行且只展示一次。不能只凭版本数值状态映射运营阶段；审核中不代表测试期，已上线也不必然是首次上线。各阶段的充分证据、明确排除与完整历史门禁以 [运营阶段识别与官方手册](taptap-suite/references/operation-handbooks.md)「识别顺序」为唯一正本；来源清单缺失、历史不完整或证据冲突时选择 `unknown`，不要猜阶段或补造描述。

这些固定文档入口来自 TapTap 官方开发者文档，不需要调用网页搜索，也不要替换成其他环境域名。官方描述只用于概括文档覆盖范围；不得承诺固定曝光量、推荐位或流量结果。

游戏资料编辑页可在 `developerId` / `appId` 已明确时使用 CLI 的规范地址推导：
`https://<current-server-host>/v3/{developerId}/app/{appId}/store/update`。公开商店页
`https://www.taptap.cn/app/{appId}` 只有在审核通过且已确认上线后才输出；未确认上线前不要展示、预测或描述该入口。推导地址必须标记为 `derived_from_ids`。其它业务页面不由 CLI 承诺入口地址；不要拼旧路径。

## 素材候选和本地文件输出

涉及图标、宣传图、游戏截图、Windows 素材、视频或混合物料时，不能把
缺失项、候选文件、校验结果、上传状态和下一步合并成一段长文字。必须按下面的
顺序分区输出：

```text
## 当前状态
...

## 候选文件
场景：游戏图标
文件：/absolute/path/to/icon.png
校验：通过 / 未通过 / 需人工复核
状态：待确认上传 / 已上传 / 不适用

场景：横版宣传图
文件：/absolute/path/to/banner.png
校验：通过
状态：待确认上传

## 用户需要确认
...

## 下一步
...
```

执行规则：

1. 每个素材场景单独一个条目；每个文件路径单独占一行，必须输出实际绝对路径。
   不使用 `icon-{1,2,3}.png`、`candidates/*.png`、省略号或只给目录代替文件路径。
2. 有多个候选时，每个候选分别输出“文件”行；不要把多个路径塞在同一行或同一段。
3. 逐行输出每张候选图的绝对路径，路径行是唯一可靠的文件位置来源。
   本插件不提供图片预览接口：不要调用 `nodeRepl.emitImage` 这类其它宿主专用的 API，
   也不要为了预览去写临时文件或使用插件未声明的主机能力。
4. 不要声称已展示、已打开或已预览图片；即使宿主以其它方式呈现了图片，
   图片预览也不等于本地文件位置，绝对路径行仍必须保留。
5. 只有文件已经实际生成或工具实际返回时才能输出路径；不得猜测路径。压缩包内条目、
   远端 URL 和素材库 asset ID 不能伪装成本地文件路径。
6. 缺失项也按一项一行输出，并区分“缺失”“待上传”“已上传未回填”“已回填”和
   “无法确认”；不能用“素材都已处理”等总括语句替代逐项状态。
7. 用户确认上传前，候选必须明确标记为“待确认上传”；图片预览、机器校验通过和素材库
   收录都不能表述成已写入资料字段或已通过审核。
