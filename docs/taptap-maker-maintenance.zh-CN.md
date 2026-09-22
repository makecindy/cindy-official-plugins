# TapTap Maker 升级与兼容避坑清单

[English](./taptap-maker-maintenance.md)

## 先读结论

- 不能为了让 vendor 与官方包完全一致，直接删除 Cindy 的修复。
- 当前 vendor 有 **五项**兼容补丁，不是只有 executed 一项。
- **日志没有整体关闭**：移除的是 Cindy 对远端日志 watcher 的接管和空闲回收；watcher 改用系统 Node，由 Maker 管生命周期。
- PAT 保存和校验已经调用 Maker CLI；Cindy 额外承担状态判断、脱敏、界面和进程兼容，不能把这些全当成重复实现删除。
- 新版本号或相同关键词不能证明旧问题已修复。必须核对实际发布包和回归行为。
- 本文是维护交付物，不是要求立即重构。移动职责时先保留行为，再用等价实现替换。

## 核查范围与证据

核查日期：2026-09-21。基线：Cindy 仓库 3c26b0b，插件 2.1.13，Runtime 0.0.33。
证据来自当前代码、git log HEAD 的 Maker 历史、具体提交 diff 和 .tests/taptap-maker.test.mjs。
另核对 0.0.31 分支修复，单独标识；不能把 --all 找到的提交一律当成已上线。

本次重新下载官方 @taptap/maker@0.0.33 tarball，与当前 dist/maker.js 比较，确认差异对应下列五项补丁。
对先前下载的官方 0.0.34 包也做了静态核对：执行态归一化仍只接受 not_executed / unknown；
仍缓存启动时 accessStatePromise；受限列表没有 _meta.maker_access；受限调用没有相应结构化执行态。
因此，之前“0.0.34 已吸收 executed 补丁、可以原样升级”的判断不成立。
Skill 写入保护是否有其他等价实现需另做行为核查，不能只看函数名。

历史提交中的测试/实机记录只代表当时版本，不代表新包已经验证。
并非每项都是线上事故，有些是审查中补上的安全保护。

## 一、直接改过官方 Runtime 的五项补丁

位置：taptap-maker/vendor/taptap-maker/dist/maker.js。
同步清单在双语 README 与 taptap-maker/THIRD-PARTY-LICENSES.txt。

| ID | 坑点和现有保护 | 提交证据 | 升级验收 |
| --- | --- | --- | --- |
| V1 | 远端明确 executed 被降级为 unknown；白名单补全三态。 | ff54f59、577da80 | 三态穿过 Runtime 和 Cindy 最终结果均不丢失，不据此自动重试。 |
| V2 | BLACKLISTED 在发送前拦截但没有结构化未执行状态；补 structuredContent、原提示和 not_executed。 | a5d85df、431213e | 模型最终收到明确未执行，远端调用次数为零。 |
| V3 | 启动时缓存账号限制，换 PAT 后仍沿用旧结果；列表、资源读取、调用按请求检查。 | 2a80b28 | 同一 Runtime 实例更换凭证/限制状态后重新判定，不绕过账号限制。 |
| V4 | 受限列表仅剩固定工具，Cindy 误报工具不存在；通过 _meta.maker_access 保留账号受限原因。 | c0e3c5b、d54ef28 | 列表和调用前检查保留原因及 not_executed，不放开受限目录。 |
| V5 | 用户 Skill 根含符号链接可能写出项目；拉取前及实际安装前检查根目录。 | a506b40、6c4f223 | .installer/skills、.codex/skills、.cursor/skills、.workbuddy/skills 任一级已有符号链接时停止写入。 |

这些是当前 Cindy 包的保护清单，不是 Maker 必须接收的改动清单。
归属必须按下节逐项判断；不能因为补丁写在 Maker bundle 内就要求上游接收。
替代实现具备等价行为前不能删除保护，但不要求永远保留同一段补丁代码。

### 归属原则：Maker 独立，不为 Cindy 特殊需求增加负担

判断顺序：没有 Cindy 时问题是否仍存在？Maker 自身或其他使用方是否受益？
已有 CLI/MCP 接口能否解决？新增接口、配置和维护成本是否值得？
只有具备独立价值且收益合理的改动才考虑 Maker；其余保留在 Cindy。
以下是归属建议，不是已经证明上游必须采用某种实现，也不授权修改 Maker 仓库。

| 改动 | Maker 是否有必要做 | Cindy 继续负责什么 |
| --- | --- | --- |
| V1 执行态、不可逆调用不重放 | 通用正确性，适合 Maker 修复；确认已执行不应被错误降级，断线不应重复扣费/创建资源。具体字段契约由 Maker 定义。 | 保留状态、宿主提示与自己的重试门禁，不要求上游采用 Cindy 文案。 |
| V5 Skill 写入安全 | 项目外写入风险不依赖 Cindy，适合 Maker 修复；先验证威胁和既有保护，再选适合 Maker 的实现。 | 发布包验收及尚未被等价修复覆盖的本地保护。 |
| V2 受限调用的结构化未执行状态 | 对其他调用方也有诊断/安全价值，是通用改进候选；不强制搬入 Cindy 的全部错误结构。 | 适配 Maker 的错误契约，保证 Cindy 最终结果符合自身三态要求。 |
| V3 换 PAT 后缓存失效 | 有条件：先确认独立 Maker 是否支持运行中换凭证/刷新权限，以及何时应生效。若有此契约，应在 Maker 解决失效；否则不能只为 Cindy 热切换强制每次请求重新鉴权。 | 现有热切换兼容；比较可靠的进程重建/失效方案。每请求鉴权只是现有实现，不是强制上游方案。 |
| V4 受限 tools/list 原因 | 有条件：通用可诊断性可能有益，但 _meta.maker_access 是当前适配格式，不等于 Maker 必須提供的接口。先评估已有状态入口能否满足。 | 将受限状态转成 Cindy 提示；不能为避免自身“工具不存在”文案就要求上游改变列表契约。 |
| PAT 与项目管理 | 校验/保存、项目操作本来就由 Maker CLI 提供；目前不能据此认定还需新增 Host API。只有现有状态/错误接口存在通用缺口时才提补充。 | 输入界面、脱敏、项目多选、批量编排、目录选择与宿主权限。 |
| 媒体开关、工具别名、身份恢复、Cindy UI | Cindy 产品策略，没有证据要求 Maker 增加这些功能。身份恢复也不能因为调用 Maker 二维码就默认上移。 | 设置、拦截、命名、授权、提示、重试策略与预览展示。 |
| Electron stdio、childSpawn、日志 watcher 例外、roots 代理 | 当前属于 Cindy 宿主兼容，不要求 Maker 了解 Cindy 内部机制。若独立 Maker 也有进程缺陷，再单独提出通用修复。 | 继续维护兼容层及对应回归，不为代码整齐删掉保护。 |
| Console / 本地预览接入 | 复用 Maker 已有 CLI 和 JSON 能力；不能为了 Cindy 接入先要求新增协议、SDK 或重写生命周期。 | 授权、宿主启动适配、页面打开和结果展示；发现真实且通用的接口缺口后再讨论 Maker 改动。 |

此前提出的整套 Host Integration 协议/SDK 不再作为默认前置方案。
优先复用已有能力，只为经过证实的通用缺口补最小必要接口；两个仓库不应被迫同步迭代。

## 二、宿主与进程兼容

### H1. 日志 watcher 曾反复拉起 Cindy

- 历史：df08857 加过 Cindy 侧 watcher 空闲回收；5305627 随后移除该接管。
- 原因：Electron/Cindy 的 process.execPath 不能当普通 Node 使用；watcher 还会管理 PID 并启动自己的 proxy。
- 当前：node/child-process-adapter.cjs 的 logs watch 分支走系统 node，不走 spawnEntry；Node 缺失时单次报错，由 Maker 降级，禁止回退启动 Cindy.exe。构建的 __maker-proxy 仍走宿主 spawnEntry。
- 验证：测试“logs watch 在 Cindy 中使用系统 Node…”及“系统 Node 启动失败…”；5305627 提交说明记录 Windows 正式版日志正常、无重复进程，本次未重新实机复验。
- 后续：新 console server / preview supervisor 也要检查执行文件和进程所有权，不能机械复制 MCP 启动方式。远端日志 watcher 与本地预览日志不是同一条链路。

### H2. Windows 钉死 stdio，全部工具启动失败

- 14cfc58；位置：node/maker-mcp.cjs。
- Electron 的 process.stdin 可为不可配置 getter，直接 defineProperty 会抛 Cannot redefine property: stdin。
- 当前按属性描述符选择替换或就地代理，不按系统名称猜测；处理入口加载前已缓存的 initialize 字节，并避免代理递归。
- 验证：真实 Runtime、钉死 stdin/stdout、预先缓存 initialize 的组合。普通 node 启动成功不能替代。

### H3. childSpawn 与普通 spawn 不等价

- 起点：41d53ce；位置：node/child-process-adapter.cjs、node/maker-child.cjs、node/account.cjs。
- 宿主异步返回句柄，CLI 需要同步风格的流对象：保留句柄返回前写入 stdin 的 PAT 字节。
- 只改道 Maker 固定入口；未声明的 process.execPath 脚本拒绝启动。proxy 配置走已有 JSON 参数入口，不能扩成任意 env/命令执行能力。
- 一次性 CLI 输出完成后 Electron ParentPort 可能仍保活；按命令最终 JSON 判定完成并回收，不能把中间进度当成功。
- 验证：固定入口、最终输出、延迟句柄 PAT 测试；保留长任务进度续命、总超时和输出上限。

### H4. MCP 项目 roots 路由和超时

- 起点：41d53ce；位置：node/mcp-root-router.cjs。
- 宿主没有通用反向 RPC，Maker 列表需要 roots/list；仅为活动列表请求提供一个可信工作区 root，拒绝其他反向方法。
- 列表排队；超时后拒绝旧响应和排队请求，触发 worker 重建，避免项目上下文串线。
- 验证：root 隔离、超时、真实 Runtime；52f15ee 修正 Windows 测试 URI 假设，期望路径也用 pathToFileURL。

## 三、账号、项目与工具链保护

表中代码位置均相对 taptap-maker/；测试集中在 .tests/taptap-maker.test.mjs。

| ID | 必须保留的行为 | 提交 / 位置 | 验收重点 |
| --- | --- | --- | --- |
| A1 PAT | 保存走 pat set --pat-stdin --json，由 Maker 校验/落盘；Cindy 兼容环境变量、pat.json、旧路径做存在判断和掩码。Agent 结果去掉 PAT 提示/保存路径，输入用后清空，不复制到 Cindy KV/Secret。 | 41d53ce、9029599；node/account.cjs、settings.js、main.js | PAT 不进命令参数、日志或模型结果；网络失败不冒充明确未登录。直接读凭证文件的兼容逻辑须等 Maker 有等价安全接口后再替换。 |
| A2 诊断 | 识别既有 missing/expired/401/403 登录失败格式；同步失败区分 Git、Python、目录、网络。 | 3b8f23d、8475e33、6e4affe；node/account.cjs | 可行动且脱敏；未来改错误码时保留分类测试，不扩大重试。 |
| A3 同步目录 | 目录名跨批次稳定、项目 ID 区分同名；仅接受空目录或配置/项目 ID/Git origin 均验证过的同项目目录；拒绝相关符号链接和不可验证 Git 元数据。 | ddcc0b7、675d2c3、e58a241、d5132e4、9cbebaa；node/account.cjs | 重复同步不覆盖其他项目；生产/RND origin 按所选环境匹配。 |
| A4 设置长任务 | 同一 reqId 重发只执行一次；账号变更互斥；批量最多五项目、逐项反馈，初始化带 --skip-mcp-install。 | 41d53ce、9029599；main.js、node/account.cjs | 不重复登录/克隆，部分失败可识别，不额外改 Agent MCP 注册。 |
| T1 工作区/只读 | 工具使用宿主当前本地 workdir 并覆盖 target_dir；只读会话拦截可能写入的操作。设置页批量同步另走用户选目录流程。 | 41d53ce、df08857、7280910；main.js | query_video_task 会落盘、反馈查询可下载附件，不能按 query/get 名字放行。 |
| T2 媒体开关 | 三类默认开启；关闭只拦截对应请求并返回短提示，不隐藏目录、不自动转其他插件、不取消已提交任务。 | 3e0dffb、6602807、431213e；main.js、settings.js | 设置损坏/读取失败不发送；恢复重试重新检查；视频查询不受创建开关影响；保存失败不假报成功或覆盖其他设置。 |
| T3 身份恢复 | 明确缺身份且状态缺省或 not_executed 时，合并同工作区初始化，生成一次二维码并重试一次。项目未构建则停止并征求授权。 | 9029599、891868e；main.js | executed/unknown 不恢复；二维码/第二次调用失败、缺方向不能无限重试或自动构建。 |
| T4 错误三态 | 兼容 structuredContent、remote_result、error_details 和固定错误文本；初始化与重试后 unknown 同样保留并要求先核对远端。 | 891868e、d0b428c、7465ceb；main.js | 脱敏不丢状态、不泄露凭证/路径/堆栈；保留精确积分不足信号，不把普通错误当余额不足。 |
| T5 状态/目录 | 固定工具映射为 maker_status/maker_build 并从动态入口排除；列表是随包快照。状态摘要有 /tracking 遥测。 | 891868e、bdc6bdd；main.js、manifest、locales | 保留 detail/skip_remote_sync；不宣称零网络，不因列表有工具就跳过账号/项目检查。 |
| T6 引导 | 独立 CLI/npm/环境变量建议转为 Cindy 入口；区分 Python/LSP 未就绪、已就绪、建议升级；主/子入口设置 cindy_plugin。 | 891868e；main.js、node/maker-mcp.cjs、node/maker-child.cjs | 不误导用户用独立 npm 覆盖随包版本；文字解析是兼容债务，不可直接删除行为。 |
| U1 构建 UI | 校验官方 maker_url，保留 localDev=1，加 hide_chat=1/sessionId，右侧打开并返回可点击链接。 | 41d53ce、df08857；main.js | 打开预览失败不覆盖构建成功、不重新提交；这是远端预览，不是 UrhoX 本地窗口。 |
| U2 文档/UI | 四语言、错误码映射、Skill 转 Manual、限定 Maker 召回、固定广告指南、UrhoX 标准库限制指引。 | e5e1396、7f00a60、a887ccc、20b0b06 | 不因升级引导 Agent 绕过插件；不是 Runtime 补丁但仍属于交付行为。 |

## 四、历史分支和已替换方案

- 0.0.31 分支：e4e5f63 防止 confirm_character_voice 断线重放；aec91dd 区分 proxy 初始化前未执行与发出后未知；a3d295d 补远端 isError 三态。这些是 --all 找到的分支证据，不是当前 HEAD 的逐提交合入清单。891868e 后续整包换为 0.0.32。升级仍须验证不可逆操作不重放，不能按旧行号机械贴补丁。
- df08857 的 Cindy watcher 空闲回收已被 5305627 替换，**不要恢复已删的 controller**。
- 577da80 当时只有一项补丁，之后又加入四项。只看一次升级提交说明会漏修复。
- 52f15ee 补齐 bundle 依赖归属和打包许可证：升级还须核对新增依赖、最终 .cindy 的许可证文件。

## 五、每次升级的最小验收

### 已实现的重复升级流程

在仓库根运行：

    node .github/scripts/sync-maker-runtime.mjs 0.0.34
    node .github/scripts/sync-maker-runtime.mjs 0.0.34 --check

版本配方位于 .github/maker-runtime/0.0.34.json，记录 npm tarball 的 SHA-512、
原始/补丁后 bundle SHA-256、五项精确补丁和完整 vendor 文件哈希。
脚本只接受已审查配方：下载到临时目录，检查包身份/完整性/补丁锚点/语法及全部文件，
成功后才替换 vendor。失败不覆盖旧目录；替换失败尝试恢复旧目录，恢复失败时保留备份。
原样保留官方文档/Skills，加回仓库维护的 LICENSE。--check 离线检查完整 vendor。
脚本不自动猜测新版本补丁，也不自动改插件版本、公开契约或许可证；这些仍需审查。
新增版本先建立独立配方并核对通用/宿主行为，不要修改旧配方来隐藏差异。

本轮实现：插件 2.1.15 / Runtime 0.0.34，五项补丁仍保留。
新增许可证包括 long、marked、protobufjs、ws 和 Lucide/Feather 图标。
升级回归另见 .tests/taptap-maker-upgrade.test.mjs；支持补丁可复现、锚点不符拒绝及文件清单校验。
历史基线和现场验证记录应分开，不把此前版本的通过记录算作新包验收。

### 2026-09-21 本轮现场验证与边界

- Cindy 0.1.89（macOS）：通过宿主 Forge 打包、原位更新至 2.1.15，保留启用状态、设置和数据。
- 经真实 ghost_call 调用 maker_status，返回 version: 0.0.34、managed_by_plugin；PAT/TapTap auth 均被识别。当前插件源码工作区为 unbound，符合预期，未初始化或构建它。
- maker_apps、maker_list_tools、maker_ads_guide 调用成功；使用不存在的工具名验证分派门禁，返回 not_executed / automatic_retry: false，没有调用付费生成工具。
- 84 项自动测试通过（包括新增升级流程和控制台入口测试）；Windows 正式版、换 PAT/真实受限账号、远端构建、日志实际拉取和游戏画面未在本轮实机复验，不以模拟测试替代。
- 已新增 `maker_console` 工具和设置页按钮：通过系统 Node 启动官方本地控制台，严格校验 loopback URL，并在 Cindy 右侧打开；不自动构建、提交或安装运行环境。
- console 后台启动通过 `execFile('node', ...)` 使用系统 Node，不使用 Cindy 的 Electron 可执行文件，也不在 `maker-child` 内启动；服务所有权、结束策略及跨会话行为仍需实机验证。
- 本地控制台页面与 UrhoX 原生游戏窗口要区分；现有远端 maker_build 不应改成原生预览。插件已明确声明 loopback 预览权限，并在打开前校验返回的 loopback URL；这不等于 Agent 已支持原生游戏窗口预览。

本轮已接入并验证控制台页面入口；服务跨会话停止和 UrhoX 原生游戏窗口仍未在本轮实机验证。

1. 固定源版本、记录 tarball/integrity；比较当前 vendor 与对应官方包，再读其后修复提交。
2. V1-V5 逐项标记“上游等价修复 / 仍需保留 / 待验证”。未验证不得标为已吸收。
3. 运行 Maker 测试和仓库四项提交门禁；覆盖真实 Runtime、钉死 stdio、无系统 Node、PAT stdin、roots、不可逆错误、媒体开关和目录保护。
4. 新包在 Windows/macOS 实机验证进程/UI；受限账号、换 PAT、故障恢复单独验证。字符串/提取函数测试不能证明全部端到端行为。
5. 新 console/preview 特别核对：执行文件、后台所有权、工作区/开关策略是否被新入口绕过、停服务是否误伤其他会话；本轮已验证入口与页面打开，跨会话停止和 UrhoX 原生窗口仍待实机验证。
6. 同步双语说明、四语言契约、许可证、插件版本和实际设备验证记录，明确剩余缺口。

不是所有底层逻辑都应搬回 Maker；先按归属原则证明独立价值，再决定是否修改上游。
只有替代接口通过对应验收后，才移除旧兼容代码。
