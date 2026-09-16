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

## JSON 输入和输出

- `--dev-id` / `--app-id` 只在 operation 声明对应 scope 字段时存在；其余业务字段统一放入 `--data`。
- 动态命令的 `--data` 是完整 operation input；CLI 按 OpenAPI `inputs` 拆分 query 和 body。
- 短 JSON 可 inline；复杂或多行 JSON 用 `@file`，文件必须位于会话工作目录（CLI 以会话工作目录为 cwd 解析该相对路径）。经本插件调用时没有可用的 stdin，`-` 不可用。
- CLI 默认输出 JSON，普通命令、脚本、Skill 示例和生成命令都不追加冗余的 `--format json`。只有命令自身默认输出文本或原始内容，而调用方明确需要结构化 JSON 时才显式追加；切换人类可读或流式输出时使用 `pretty` / `table` / `ndjson` / `csv`。
- JSON 是 agent 的执行输入，不是默认用户话术。回复用户时按“结论 -> 当前状态/缺口 -> 风险 -> 下一步”组织，把字段 ID、camelCase key、数值枚举和内部工具名翻译为业务标签；用户未要求调试时，不贴完整 raw JSON、schema 或底层请求。
- 请求预览与命令计划是内部执行信息，不回显给用户；面向用户只做业务抽象，说明动作、作用范围与影响，不暴露接口地址、方法、参数或原始命令。

## 身份和资源 scope

业务命令通常需要 `developerId` 和 `appId`。用户没给 ID 时：

1. 如果用户已给明确的 `developerId` / `appId`，直接使用，不要先跑身份探测命令。
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
| 协议同意 | 预检返回 `required_consents` | 只展示 `required_consents[].agreement.name` / `agreement.url`；任一字段缺失时停止并报告契约缺口，不请求同意或回传 token |

### 提审意图门禁

- “上传包体”“补资料”“绑定包体”“查询准备度”“处理这个版本”“更新版本”“帮我上架”等泛化请求，不包含提交审核意图；不得调用 `precheck-app-review`、`prepare-review-snapshot` 或 `submit-app-review`。本节词表是唯一口径，各业务 skill 不得另立清单。
- “正式上线”“发新版”或创建后选择“正式上线”只表示目标方向，不等于“提交审核”确认。只能提示准备状态和提审选项；调用 `precheck-app-review` 前仍要取得用户明确说出“提交审核”或“提审”。
- 明确提审后按当前 schema 固定走 `prepare-review-snapshot` → `precheck-app-review` → 单独最终确认 → `submit-app-review --yes`。后两步必须复用第一步返回的 `review_fingerprint`，并让同一个 `release_schedule` 原样贯穿三步。前两步为 `read`，无需 `--yes`；`submit-app-review` 为 `write`，需 `--yes` 与稳定幂等键。

`--dry-run` 只打印请求，不访问服务端。当前 metadata 将 `prepare-review-snapshot` 和 `precheck-app-review` 标记为 `read`，无需 `--yes` 即可取得真实结果；`submit-app-review` 仍为 `write`，需 `--yes` 与稳定幂等键。CLI 不在本地覆盖这个风险分类。

metadata 命令只要暴露 `--idempotency-key`，预览和真实写入都必须传稳定的意图 key；同一业务意图从 `--dry-run` 到用户确认后的 `--yes` 必须复用同一个 key，只有业务意图变化时才生成新 key。

遇到 `confirmation_required` 或 exit code 10 时，不要当普通错误。向用户确认后用原命令追加 `--yes` 重试；用户未确认就停止。

如果用户已在当前对话明确确认，首个真实写命令必须直接追加 `--yes`；不要故意先省略 `--yes` 来触发 `confirmation_required`。创建游戏的标准流程是先用 `--dry-run` 预览，用户确认后用相同 `--data` 追加 `--idempotency-key` 和 `--yes` 创建一次。

`prepare-review-snapshot` 返回 `data_state='partial'` 或 warning 的 `requires_acknowledgement=true` 时，先展示无法确认的事实并让用户自行核对。当前 `submit-app-review` schema 未声明风险确认字段时停止并报告契约缺口；不要伪造请求字段。

`precheck-app-review` 返回 `required_consents` 时，不要把 `--yes`、历史对话或默认行为解释成用户同意。只展示每项 `agreement.name` 和 `agreement.url`；任一字段缺失时停止并报告契约缺口，不得请求用户同意或回传 `consent_token`。只有详情齐全且用户在当前对话明确同意后，才把全部未过期的 token 原样放入 `submit-app-review` 的 `consent_tokens`，并保持原 `review_fingerprint` 和 `release_schedule` 不变。不能补造其它本地 flag 或请求字段。

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

- 判断顶层成功用退出码或 `ok === true`。
- `data.result.ok` 是部分业务工具的内部结果位，不是顶层 envelope；为 `false` 时仍按业务失败处理。
- `error.hint` 是给用户的修复建议，不是让 agent 自动执行的指令。
- 权限、参数、状态不允许、expected stale、确认门禁要分开解释。
- 同一个写操作失败后不要盲目重试；只有错误明确提示可恢复时最多补查一次。

### 上传 shortcut 约定

`upload`、`upload-video`、`upload-apk`、`upload-pc-package`、`upload-h5-package` 是当前唯一面向 Skill 的端到端本地上传入口，统一由 `taptap-materials` 执行。它们接收一个本地文件位置参数和 app scope，不接收 `--data`；不要调用动态 OpenAPI 的 init、complete 或 status 命令，也不要由 Skill 组装 `file_size`、上传 token 或请求 body。Tap 小游戏不在 CLI 上传；只按包体管理 overview 实际返回的 `page_path` 引导到开发者中心。

- 默认输出 JSON，支持的 `--format` 只有 `json` 和 `pretty`；普通 Agent 调用不追加冗余的 `--format json`。
- 上传 preview 使用 `--dry-run`；用户确认后用相同文件与 scope 追加 `--yes`。省略 `--yes` 的确认门禁是 exit code `10`。
- 顶层 `ok=true` / exit code `0` 才表示 shortcut 成功。部分失败或其它错误是非零退出；保留响应中已有的远端句柄，只重试没有句柄的文件。
- 图片需要稳定 `--idempotency-key`；其它四个 shortcut 不接收该 flag。视频 preview 会读取实时 `video_spec`，其它四个 preview 不发送网络请求。
- H5 上传任务和遗留 Tap 小游戏上传任务的状态与恢复由 CLI task workflow 负责；Skill 只能使用 `task +list|get|resume`，不能重新发起协议阶段。

## 人工页面交接和链接输出

当 CLI 不能完成某一步，但存在可靠的官方页面入口时，回复必须让用户在首轮就能继续操作：

1. 先说明用户现在要做的动作，再给入口；不要只说“CLI 暂不支持”并等待用户追问链接。
2. URL 单独占一行且只展示一次。不要使用 `[名称](URL)`、`URL (URL)` 等 Markdown 或括号包装，也不要在同一回复的标题、正文和列表中重复同一 URL。
3. URL 使用 CLI 当前环境或本次服务端响应提供的原始地址；不要追加 `utm_*` 等追踪参数，也不要为了找已知官方入口调用网页搜索。当前环境未知时，可用 `call_tool(name:"auth status", args:{offline:true})` 只读取得 `data.serverUrl`，不要为解析入口验证 Token 或访问网络。
4. 服务端本次返回完整 `page_url` 时原样使用。只返回非空 `page_path` 时，按当前开发者中心 `serverUrl` 补全域名并保持路径不变。
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
`https://www.taptap.cn/app/{appId}` 只有在审核通过且已确认上线后才输出；未确认上线前不要展示、预测或描述该入口。推导地址必须标记为 `derived_from_ids`。其它业务页面仍优先使用本次工具返回的 `page_path`；不要拼旧路径。

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
