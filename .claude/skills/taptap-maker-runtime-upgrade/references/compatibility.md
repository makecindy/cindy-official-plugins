# 兼容验收矩阵

## 使用方式和证据等级

逐条核对，不用“测试全绿”替代逐项结论。来源完整 hash 在 [历史清单](history.md)。位置相对仓库根；函数名/测试名是搜索锚点，不承诺新 bundle 行号不变。

每次输出一行结果：ID｜历史 hash｜新包证据（文件/函数或原始包差异）｜保留/等价替代/废弃/待验证｜本次测试｜缺口。只有行为证明等价才可删补丁；废弃必须有后继来源。下表的检查动作不是已全部实测的声明。

证据分层：S＝静态/契约；F＝提取真实 bundle 函数+模拟依赖；N＝系统 Node 实际进程/MCP；D＝正式或 Beta Cindy 的真实打包安装。F 不覆盖真实网络/扣费，N 不覆盖 Electron Host；历史 D 不传递到新版本。

## Runtime 补丁与调用链

| ID / 来源 | 最终保护与定位 | 每次升级的具体检查与验收 |
| --- | --- | --- |
| V1 / ff54f59、577da80；0.0.37 增量 | vendor/dist/maker.js：normalizeRemoteProxyExecutionState、getRemoteProxyExecutionState、addRemoteProxyErrorExecutionState；三态穿透。 | 分别输入 executed/not_executed/unknown，含 structuredContent、文本 JSON、remote_result 包装；unknown 优先，已执行与未执行冲突返回 unknown。对照最终宿主结果，不能只断言包含 executed 字符串。测试搜索“Runtime 错误包装”“保留远端错误结果”；F + 宿主模拟。 |
| V2 / a5d85df、431213e | BLACKLISTED 调用拦截保留原消息，structuredContent success:false / execution_state:not_executed。 | 确认拦截发生在 dispatch 前，实际 call 次数为零，最终结果仍结构化未执行。不能恢复只在顶层放 state 的中间方案；测试“BLACKLISTED 列表短路和调用拦截”；F + 宿主模拟，真实受限账号另做 D。 |
| V3 / 2a80b28 | startMakerMcpServer 中列表、资源读取、调用按请求 resolveMakerMcpAccessState，不缓存启动期 promise。 | 检查三个入口，而非只 tools/call；同实例换 PAT/限制状态的下一次请求重新判定；鉴权请求失败不擅自当 BLACKLISTED。现有“不缓存黑名单”是 S，“仅在明确 BLACKLISTED”是 F，真实热切换仍需 D。 |
| V4 / d54ef28、c0e3c5b、6c4f223、78e795b、da7f978、a352bde、2259e38 | 受限 tools/list 返回固定工具和 _meta.maker_access；main.js listMakerTools/handleTool 返回账号原因而非“工具不存在”。 | 列表和调用前 list 都短路，reason/message 脱敏，not_executed/automatic_retry:false；普通不存在工具也明确未发送；四语言及 Manual 表述一致。F + 宿主模拟/S；不为显示更多工具解除账号限制。 |
| V5 / a506b40、6c4f223 | assertSafeUserSkillRoots 在 pull 下载前、installUserSkills、installUserSkillsForClients 写前调用。 | .installer/skills、.codex/skills、.cursor/skills、.workbuddy/skills 每级祖先已有 symlink 时拒绝；正常目录仍可用。确认路径/fs/exists 打包别名正确，测试运行新包实际函数。F/本地文件测试不能宣称解决所有 TOCTOU 或任意祖先路径风险。 |
| V6 / e4e5f63、aec91dd、891868e；0.0.37 增量 | 通用不可逆请求不重放，MAC 失效仅明确 not_executed 可重试一次。 | 检查 callRemoteProxyTool、manager/direct transport、proxy pending queue、重连和外层重试，不能只查 confirm_character_voice。初始化前失败与派发后断线分别测；executed/unknown/缺状态/冲突不自动重试；第二次失败不得第三次发出。测试“MAC 失效只重试明确未执行”；F，真实故障/扣费需授权后 D。a3d295d 原 diff 已于 2026-10-27 补核，特定音色保护由通用契约承接。 |
| V7 / c58a81a；0.0.37 增量 | Console 实例身份包含版本、分发来源、入口路径。 | 同版本 standalone、同版本另一插件目录不能被当当前 Cindy 服务复用；正确同入口仍可复用。检查身份生成与 health 验证两端，不只改文件名。测试“不会复用同版本”；F/N，跨会话并发和停服所有权需 D。 |
| V8 / 0.0.37 用户确认的最小策略 | cindy_plugin 下 getConsoleHtml 无模型设置入口、readModelSettings 返回空配置；configured/resolvedUiVisionModels 固定 Server；写 models/ui-vision API 拒绝。 | 页面加载没有残留按钮空引用；GET 不露自定义密钥，非 GET 不写配置，Server 不可用明确 503；不降级 chatgpt-web，standalone 分支原行为不变。测试“识图固定 Server”，加隔离 HOME 真实 HTTP 冒烟。没有旧配置迁移、生成桥接或素材开关跨进程接管。 |

### V9：0.0.39 云端 Git 修复

repairCloudWorkspace 保留 outcomeUnknown；push/formatBuildResult/main.js 贯通 unknown，删除未知结果的 retry_tool，并兼容新旧云端阻塞消息。升级时验证：超时后复查失败或仍脏只提交一次，最终 unknown/automatic_retry:false，先核对再操作；复查干净保留上游 repaired；成功云端提交但本地合并失败不谎报合并成功。当前为 F + 宿主模拟，不宣称生产云端故障实测。

## Host / 进程层

| ID / 来源 | 最终保护与定位 | 每次升级的具体检查与验收 |
| --- | --- | --- |
| H1 / 41d53ce、2407dd5、891868e | maker-mcp.cjs、maker-child.cjs 固定入口、cindy_plugin 注入；adapter 只改道自身 process.execPath + makerEntry，proxy JSON 配置用既有参数。 | 非固定脚本拒绝；__maker-proxy 仍走 spawnEntry；不开放任意 env/命令能力，不把全局 CLI/npm 更新建议带回托管包。检查新版本新增 spawn/execFile/transport 路径，确认是否绕过 adapter。测试“spawn adapter 只改道”；F + N。 |
| H2 / 41d53ce；0.0.37 增量 | createDeferredChild 保留早到 PAT stdin、流/事件/kill/abort；exitCode/signalCode 与标准 ChildProcess 语义衔接。 | 延迟 Host handle 前写 stdin 仍送达；新 HiddenStdioClientTransport close 真正 kill 活跃子进程，不因 undefined 判断已结束；重复 close 不重杀，exit/close 同步状态，启动失败合理结束。测试“deferred child”“新版 Runtime transport”；F，真实 Host 生命周期 D。 |
| H3 / 14cfc58 | maker-mcp.cjs stdio 按属性能力替换或原地代理。 | 可配置/不可配置 stdin、stdout 和预缓存 initialize 组合；先抽干旧字节再路由，避免递归；真实 Runtime 完成 initialize、roots-aware tools/list、资源读取。已有 N 测试不替代 Windows 正式/Beta Cindy。 |
| H4 / df08857→5305627 | logs watch 用系统 node，Maker 管 PID/生命周期；不再有 Cindy watcher 空闲 controller。 | 系统 Node 可用/不可用各测；缺失只报错一次，不启动 Cindy.exe，不回退 spawnEntry；主 proxy 不受影响。不能称为“关闭日志”。F 后必须真实构建/日志获取/退出 D，日志 watcher 与本地 preview supervisor 分开验收。 |
| H5 / 41d53ce、52f15ee | mcp-root-router.cjs 仅活动 list 的可信绝对 workdir；其它反向 RPC 拒绝；列表串行、超时丢旧响应并重建。 | 两工作区并发不串线；超时中活动/排队请求都结束；陈旧回包不污染新 worker。Windows URI 用 pathToFileURL，不能硬写 POSIX。测试“root router”“roots-aware”；F/N。 |
| H6 / 41d53ce | isMakerCliOutputComplete + account.runMaker：最终 JSON 才回收；进度心跳、14 分钟限时、每输出流 2 MiB 上限。 | 新 CLI login/pat/apps/doctor/init JSON 结构逐命令对照；进度不能误当 done，成功后不能被 ParentPort 挂住，超限/超时 kill。测试“最终 JSON”；模拟不能证明真实登录结束，应 D。 |

## 账号、目录和设置任务

| ID / 来源 | 最终保护与定位 | 每次升级的具体检查与验收 |
| --- | --- | --- |
| A1 / 41d53ce、9029599 | account.cjs pat set --pat-stdin --json；Maker 校验/保存；环境变量、新旧文件仅用于存在/掩码兼容；main.js publicAccountResult 脱敏。 | PAT 不进 argv/日志/模型结果/新增 Cindy KV 或 Secret；页面输入用后清空；网络失败状态 unknown，不冒充已退出。测试“账号工具不向模型返回 PAT”；实际 PAT 保存/切换 D，不能无证据删旧路径兼容。 |
| A2 / 3b8f23d、9029599、6e4affe、8475e33 | isMissingLogin/projectSyncFailure/settingsErrorCode 与 settings.js syncFailureText。 | 原 missing/expired/401/403 格式；目录、Git（两个 code）、Python、网络逐类；错误可行动且脱敏。若新包错误结构改变，补样例，不扩大自动重试。F/S 与实际联网失败边界分开。 |
| A3 / ddcc0b7→675d2c3→e58a241→d5132e4→9cbebaa | 稳定目录名及 ensureTargetAvailable；空目录或 config project_id + Git origin 同项目，环境匹配，元数据无 symlink。 | 同名不同 ID、跨批次、Windows 名称；错项目、缺 origin、缺 .git/config、生产/RND 不匹配、symlink/非目录都拒绝；URL auth 不泄露。测试“目录名跨批次”“目标只允许”；不能恢复早期任意非空目录重试。 |
| A4 / 41d53ce、675d2c3、9029599 | main.js settingsRequests 按 reqId 去重；account.withMutation、最多五个去重项目、逐项结果、--skip-mcp-install。 | 同 reqId 重发不重复登录/克隆；并行账号变更互斥；单项目失败保留其它项目结果；已有 app 与新建参数互斥；不改外部 Agent MCP 注册。测试“重发同一 reqId”，批量真实 init/克隆需用户目标与 D。 |

## 工具行为、素材策略与 UI

| ID / 来源 | 最终保护与定位 | 每次升级的具体检查与验收 |
| --- | --- | --- |
| T1 / 41d53ce、df08857、7280910 | requireLocalContext/requireWritableContext；宿主 session_context workdir 覆盖工具 target_dir，远程工作区拒绝。 | status/指南只读可用，init/build/动态工具/console 写能力只读拒绝；query/get 也可能下载写文件，不能按名字放行。设置页用户选目录流程是独立授权入口，不强行套 Agent workdir。F/S。 |
| T2 / 9029599、891868e、7465ceb | 按工作区合并 initializeMakerIdentity；只对明确缺身份且状态缺省/not_executed 做一次二维码和一次原调用。 | executed/unknown 不恢复；初次调用、二维码、重试后的缺身份/unknown 分别测；没有构建信息、屏幕方向或游戏类型选择就停止，不能自动构建。缺省兼容仅是既有身份恢复契约，不可扩展到通用网络/MAC 重放。F。 |
| T3 / 9029599、891868e、d0b428c、7465ceb、431213e、d54ef28 | makerExecutionDetails/sanitizeMakerFailure/sendToolResult 贯通状态与脱敏，unknown 先核对远端；精确积分不足。 | structuredContent/remote_structured_content、JSON text、remote_result/error_details、固定文本三态；catch/初始化/重试/列表拦截都查最终结果。凭证/本地路径/stack 去掉不应丢执行态。普通错误不可冒充 INSUFFICIENT_BALANCE；Art 替代需用户确认。F + 宿主模拟，未覆盖分支明确列出。 |
| T4 / 2407dd5、0a05682、891868e、bdc6bdd | status detail/skip_remote_sync 与 normalizeMakerPluginGuidance；固定工具别名和目录快照。 | PAT+auth 同时缺失先匹配；Python/LSP 未就绪、已就绪、建议升级三态；不要提示用独立 CLI/npm 覆盖随包 Runtime。状态摘要仍有 /tracking，目录快照不是实时可用性保证；实际工具名/schema 对照新包，固定内部名不能绕开 maker_build。F/S/N。 |
| T5 / 9aa6527、a887ccc | maker_ads_guide 固定 resources/read；Maker 专属广告召回。 | 真实新包资源存在且含当前广告 API 指引；只读会话可调用，不改项目；不要因为泛平台广告问题就召回 Maker。F/N/S。 |
| T6 / 577da80 | Runtime build 前安全快进：仅本地 main 落后；异常在 commit/push 前停止。 | behind 可 ff-only；分叉、非 main、状态未知、覆盖未提交修改不提交/推送；push 失败不 build，push 后 build 失败不能说代码未提交。测试“仅在落后远端时快进”；F，真实仓库副作用测试需隔离目标和授权。 |
| M1 / 3e0dffb、a12cdc5 | main.js callMakerTool 三类默认开，开关只拦截后续对应请求、不隐藏目录。 | 生图 generate_image/batch_generate_images/edit_image；视频 create_video_task；音频 text_to_music/text_to_sound_effect/batch_sound_effects/text_to_dialogue/audition_voices_for_character/confirm_character_voice；query_video_task 不拦。新版本新增工具逐个分类，不默认所有素材工具都覆盖。F。 |
| M2 / 6602807、431213e、a301b67、a12cdc5 | 设置读取失败/损坏/关闭均 fail-closed，最终结构化 not_executed；身份恢复重试再次读开关。 | 三类各测不发送、零 call；在二维码与重试之间关闭开关，不再发送原工具；不自动转其它插件、不取消已提交任务。测试“身份恢复期间关闭”“设置异常”；F。 |
| M3 / 3e0dffb | settings.js 加载期间禁用；读改写仅更新目标键并保留其他偏好；保存失败恢复显示且禁用要求核对。 | 旧 image 偏好保留，新类别默认开，损坏/HTTP 错误不能放行；互斥保存，不假报已保存。模拟页面测试 + 设置页 D；不要重构为跨进程共享策略。 |
| U1 / 41d53ce、df08857 | previewUrlFromResult 校验官方 https maker_url、/app/、localDev=1；加 hide_chat，sessionId 随宿主预览传递，返回可点击 markdown。 | 不打开伪造 host/任意 URL，不调系统浏览器；预览打开失败保留构建成功，不能重新构建。远端网页预览不等于 UrhoX 本地原生窗口；F/D。 |
| U2 / e351b96、4235938、e5e1396、6e4affe、8475e33、a887ccc、20b0b06 | Host 四语言与英文回退；Manual 不再全局 Skill；manifest/locales/settings/manual 行为一致。 | /app-context 超时不阻塞设置，映射错误码；明确 Maker 才召回，插件源码维护不走游戏工具。依 docs/localization.md 回退契约，不增加额外翻译要求。S/页面模拟/D。 |
| U3 / 7f00a60 | Manual UrhoX 沙箱库限制与 TimeStep 计时指引。 | 升级文档/Manual 不丢禁用库提示；本地原生预览需验证画面、交互、联网、日志、刷新、退出；窗口出现不是通过。真实游戏 D，未运行则列待验证。 |
| U4 / c58a81a、8e9defb | node/console.cjs 固定系统 node + execFile，shell:false/windowsHide，loopback URL 严格白名单；页面关闭不停止服务。 | ENOENT/EACCES 未启动→not_executed，其余无法确认→unknown；预览打不开不重复启动。拒绝 userinfo/其他 host/非根路径/hash/额外 query；settings 与 Agent 两入口都测。不自动构建、提交、装游戏环境；控制台手动操作不宣称受 Agent 开关限制。F/N/D。 |

## 包、发布与来源

| ID / 来源 | 最终保护与定位 | 每次升级的具体检查与验收 |
| --- | --- | --- |
| P1 / b662445、a887ccc、3e0dffb、98c362b；各版本提交 | ghost.json、provisioning、包契约；schema v3、minCindyVersion 0.1.64 起的现有边界、手动安装 audience。 | 插件版本高于 main；不恢复 slots/全局 Skill/自动分发；实际需求决定新最低宿主版本，降低需维护者审查。四门禁在本仓运行，不 checkout 私有仓绕过。打包安装需稳定/Beta Cindy，不能用 Dev 替代。 |
| P2 / 36cac63、52f15ee、8e9defb | 完整第三方许可证与最终 .cindy 法律文件。 | 比新旧包新增/替换依赖及嵌入 wasm/编码 UI 资源，对照官方来源；法律文本不是只列包名。保留 vendor/LICENSE 与根 LICENSE/NOTICE 等发布约定；核对实际包大小/路径/内容。0.0.37 的新依赖不能沿用 0.0.34 notices 宣称已齐。 |
| P3 / c58a81a、8e9defb | .github/scripts/sync-maker-runtime.mjs + 逐版本 recipe。 | npm 身份/integrity、原 bundle hash、每补丁 anchor count、patched hash、完整 vendorHashes、语法检查；tar 路径/链接/特殊文件检查先于解包。锚点错误/额外或缺文件拒绝；staging 成功才替换，失败保留/回滚原 vendor。现有升级测试含离线反推原包验证，不替代本次实际官方下载完整性。 |

## 0.0.37 前序验证记录（2026-10-19，插件 2.1.16 历史快照）

当前 PR 包版本为 2.1.22，包含本地验证、大报告摘要、证据 Git 忽略检查和结构化路径清理。
以下测试与实机缺口属于前序记录，不代表当前包已完成实机验收。

- 当时工作树插件 2.1.16 / Runtime 0.0.37；八项 recipe 补丁加 H2 facade 修改。官方 npm tarball 与 recipe integrity 对应，源 tag maker-v0.0.37/b3570c1 仅辅助核对；本地源码 package.json 的 dev 版本不是发布证据。
- 本轮前序已运行 Maker + upgrade 66 项通过；六套门禁共 93 项，86 通过、7 失败。失败涉及 Windows localization 路径及 publish-workflows 的 WSL/bash/jq 环境，不据此宣布完整门禁已通过，也不修改无关测试。
- 系统 Node 隔离 HOME console 启动/health/HTML/关闭已做；无模型设置入口、server-only 配置、写设置 API 403、托管更新禁用已核对。未使用真实 PAT，也未调用付费生成。
- 新增编码 UI 资源已与上游 tag 对照；没有为审查而执行编码内容。许可证已更新；实际打包不等于已安装。
- **仍需 D**：正式/Beta Cindy 安装当前包；真实 PAT 切换与受限账号；真实克隆/构建/付费调用故障恢复；生产日志 watcher；Console 跨会话停服所有权；UrhoX 原生画面与交互。静态或模拟通过不消除这些缺口。
- **历史证据补核**：2026-10-27 已取得 a3d295da1729939b77ca0827b2d94b40aa51ae9f 原 diff，其音色 isError 未知态与不重放要求由 V1/V6/T2/T3 承接，见 history.md。

## 0.0.39 增量验收（2026-10-27）

| ID / 来源 | 保留行为与本轮证据 | 结论与缺口 |
| --- | --- | --- |
| L1 / 435abb3、c2d4e11、00aa15e、9481d24、757f486 | local-validation.cjs 保留参数、证据忽略、路径隔离、所有轮次归档和大报告；13 项专项测试通过。Runtime preview validate 主实现未变化。 | 保留，F/本地 Git；未做新包真实游戏截图 D。 |
| U1/M3 / 0f88218 | 预览开关、设置超时、失败保留构建链接和不重复构建；现有专项回归保留。 | 保留，宿主模拟；未做新包右侧预览 D。 |
| V1–V8/H1–H6/A1–A4/M1–M3 | 新配方完整性检查通过；系统 Node 控制台由插件适配器启动，health/页面/Server-only/拒绝配置写入/关闭通过。 | 原兼容保护保留；N 不替代 D。 |
| T6 / 577da80、64dbb6c | 新官方包允许分叉自动合并及云端自动提交，与旧分叉停止测试及云端恢复指引冲突。 | 用户已确认以 0.0.39 功能为准；已同步原分叉停止断言及旧指引；G1 已由 V9 修复，见最终验证。 |
| H6/工具超时 / 本次 main.js | 所有动态工具窗口 120 秒、独立进度 token、maxTotalMs 900000；短请求仍 30 秒。 | 参数回归不等于真实长生图验收；无进度仍可能 120 秒超时。 |

### 0.0.39 修复前复核（2026-10-27，HEAD f501a1c）

以下保留修复前事实；当前结论见文末“最终适配与安装验证”，不再作为未解决事项。

| ID / 来源 | 本轮证据 | 结论与必要适配 |
| --- | --- | --- |
| T6/T4 / 577da80、64dbb6c；f4ccda7 | pushMakerProject 在 diverged 时允许本地 commit 后 merge；云端阻塞时调用 repairCloudWorkspace 自动提交 all:true。ghost.json、Manual 仍承诺分叉停止；main.js 的旧云端恢复步骤仍要求额外云端构建。重跑原 T6 测试仍失败。 | 确认行为不一致。用户已确认接入新版自动合并/云端提交；同步宿主恢复指引、四语言声明和测试，保留原生 Git 行为；不能只删失败断言。 |
| G1（V1/V6/T3 新路径）/ 0.0.39 git/cloud.ts、git/push.ts | 提取当前 bundle 的 repairCloudWorkspace，模拟提交请求 outcomeUnknown=true、复查也失败；实际只 POST 一次、GET 两次，结果却为 failed 且丢失未知态。再经真实 formatBuildResult 和 main.js makerBuildFailureResult，最终无 execution_state，仍含 retry_tool。 | 确认缺口源于 Runtime 新 Git 自动修复流程，现有插件执行态适配未覆盖；如保留该流程，需保留 unknown 并先核对云端结果。本探针为 F，无真实云端提交，也没有证据表明当前代码已自动重复 POST。 |
| M1/M2/T4 / 3e0dffb、a12cdc5、bdc6bdd | 新旧官方 remoteProxyToolSnapshot 整体深比较相等，包括工具顺序、名称、描述和 schema；宿主分类未变。 | 当前快照无需新增生图/音频/视频开关映射；线上账号动态目录仍以实际返回为准。 |
| H1 / 41d53ce；新版 git/exec.ts | 新 runner 使用 Git 可执行文件及参数数组，无 shell；从实际 bundle 提取 runGit，真实执行只读 git --version 成功。 | 未见需要改 Cindy Node adapter 的证据；该检查不替代 Windows Git 或真实提交。 |
| 新画布素材路径 / 0.0.39 localMediaValidation.ts | 从真实 bundle 提取路径检查函数，旧 assets/image/canvas-UUID.png、新 .maker/canvases/images/canvas-UUID.png 均接受，../outside.png 拒绝。 | 旧画布图片路径兼容仍在，无需为目录变化新增 Cindy 迁移层；模板导入、识图及页面交互尚未完成 D。 |
| P3 / f4ccda7 | 新配方完整性和既有回归结果复用：139 项中 138 通过、T6 一项失败；本轮对 T6 再次定向复现，另完成上述函数探针。 | 不能宣布全部兼容通过。新包未完成 Cindy 安装实测；现有 Node 控制台冒烟不能替代 D。 |

以上为当时仅更新清单的复核记录，后续产品修复见文末。

### 修复前真实游戏 Git 验证与功能基线确认（2026-10-27）

- 用户确认以 0.0.39 功能为准，优先复用通用 Git，不增加 Cindy 专用 Git 实现。
- 使用本机已绑定生产 Maker 的真实游戏，克隆其完整 Git 历史与内容到隔离目录；复制被忽略的绑定配置及其 .gitignore。原项目 HEAD、工作区状态及 Git 配置前后相同。
- 7 项实际 Git 集成通过：快进；分叉合并并向本地 bare 仓库推送；冲突自动取消且保留本地提交/内容；快进拒绝覆盖未提交文件；Cindy 保存点与 Maker 推送共存；非 main 停止；已有 index.lock 停止且不移除锁。
- 保存点测试直接运行本机 Cindy 源码 createShadowSavepoint 及其 Git 执行实现，仅替换日志输出。确认 HEAD 和用户索引不变，refs/cindy/savepoints/* 保留，Maker 推送不携带保存点。该结果是源码/Node 集成证据，不代表当前已安装 Cindy 的 Electron 生命周期或所有并发时序。
- Maker 测试加载随包完整 0.0.39 bundle 的实际 Git 函数；只在测试副本移除 CLI 自动启动、导出函数，并把 origin 鉴权设置替换为仅允许本地测试 remote 的检查。Git 提交/合并/取消/推送均实际执行；不把这项替换说成生产鉴权或云端写入验证。
- 原插件 node/maker-mcp.cjs 真实 Node 入口完成 initialize、游戏目录 tools/list、maker_status_lite；版本 0.0.39、项目 bound、Git ready。该游戏同时有 missing_taptap_identity/project_health warning，不据此声称游戏构建通过。
- 原插件 node/maker-child.cjs git cloud-status 对真实 Maker 项目只读调用成功，云端工作区 clean。没有为构造测试故障写入生产云端。
- 新云端错误文本识别为 cloud_workspace_blocked；历史文本 cloud workspace has uncommitted changes that this push would overwrite 单独输入识别为 unknown。保留这项服务端版本兼容差异，不无证据宣称生产当前仍返回旧文本。
- G1 的云端提交未知态丢失仍可通过故障注入复现，属于 Runtime 通用错误处理问题，不是 Cindy 保存点冲突；本轮未增加 Git 特例修复。
- 实时插件目录中 TapTap Maker 未安装，安装态 D 未执行；云端自动提交、生产推送/构建仍无本轮实测证据。之前全套 138/139 是旧契约测试结果，不能用本轮 7 项通过替代整套回归。

### 最终适配与安装验证（2026-10-27，插件 2.1.25 / Runtime 0.0.39）

- T6/T4 已完成：保留上游自动合并和云端自动提交，更新四语言声明、Manual 和测试；删除旧的额外云端构建恢复步骤，插件仅归一化工具名及登录入口。
- G1 已由配方 V9-cloud-git-outcome 修复：未知提交结果经 Runtime 格式化和插件最终 structuredContent 保留 execution_state=unknown / automatic_retry=false；不再提供 retry_tool。故障注入覆盖复查失败、仍脏、已干净、明确拒绝等路径；每次最多一次提交。历史云端阻塞文本也已纳入同一分类。
- 七套完整测试 142/142 通过；配方反向还原、35 个 vendor 文件完整性及 diff 空白检查通过。最终 bundle 重新运行真实游戏副本 Git 集成，7/7 通过，测试隔离边界同上。
- Forge 返回 installed，root 实例 _root__taptap-maker，插件 2.1.25；实际运行宿主为 macOS Cindy 0.1.118（com.xd.cindycn，未独立确认正式/Beta 渠道）。本次安装成功取代前次安装取消记录，不能倒推前次已安装。
- 已安装插件 maker_status、maker_list_tools、maker_console 成功，版本 0.0.39；当前 Agent 工作区为插件仓库，status 的未绑定是预期。控制台 health 200，Server-only 配置返回正常，模型设置入口隐藏。
- Cindy 右侧 WebView 实际选择本机真实游戏并打开 Git 页面：显示 main、实际 HEAD 及提交历史，标注浅克隆历史不完整。只读浏览，未点击拉取、提交或构建。
- 安装包 SHA-256：5a2be4d9eb0ad4140b8ba3ae181b2f18dc2c2586799d188cfd49a756c130bfbf；包内 maker.js SHA-256：a2e78bc698e140ba744b00fa651076850d384a2ed40d7bde6a0bcdd92e733a8e，全部 vendor 文件与配方一致。
- 本轮仍未做生产云端提交/构建、付费媒体生成、游戏预览截图或 Windows 新包安装；保存点共存为真实 Cindy 源码/Node 集成，不扩大为已安装 Electron 保存点生命周期验证。上述未覆盖场景不以测试全绿替代。

### V10：自动审核后的画布恢复与停止修正（2026-10-27）

- Greptile 指出 015 自动恢复会放弃 unknown/仍在执行的付费请求并重发，以及准备/恢复等待阶段缺少停止入口；已核对实际 bundle，确认成立。
- V10-canvas-safe-recovery 保留未知图片记录与识图 pendingId；等待超限暂停，只有明确 not_executed 的图片请求才解除重发保护。已有结果仍可恢复，普通成功和安全重试不变。
- 015 准备和队列恢复等待可停止后续；准备步骤之间、识图提交前及恢复异步返回后检查停止状态。停止不取消已提交远端任务；迟到回包不能重启队列。
- 实际 bundle 的 7 项新增回归覆盖请求状态组合、超限、查询失败、停止后的迟到结果、卡片内后续识图和安全重试。完整七套 149/149 通过，配方反向还原及完整性通过。此前 Git 7/7 证据复用，V10 未改 Git。
- 旧测试 Console 已正常关闭，Forge 原位更新同一 root 实例成功；已安装插件重开服务并在 Cindy WebView 加载真实游戏画布，页面正常且实际下发脚本含 V10 两项保护。未运行付费生成；故障/停止路径证据仍为真实函数加模拟依赖，不冒称实机付费断网测试。
- 本次最终包 SHA-256：61019b964c84f7a94c770b5f3bbd0fc9be8726555e1279ce60725047cba33ff4；maker.js：4e2d122d13db62a70893a450007b7af3d31e8bfc39854d589745af2959498735。全部 35 个 vendor 文件核验一致；前节哈希为 V9 安装时的历史记录。

### Codex 补充复核闭环（2026-10-27）

- V9 补齐云端提交成功之后 merge/HEAD 读取抛异常的路径，失败结果继续携带 cloudRepair，并最终输出 executed/automatic_retry:false，避免丢失已经发生的云端提交。
- H5 内部 tools/list 默认预算由 55 秒改为 115 秒，保留早于外层 120 秒的回收余量；既有超时清队列、拒绝陈旧响应及重建逻辑保留。
- T4 的新版 Git 指引在文本及结构化状态结果中统一转换：明确授权的普通 fetch/merge 使用 Cindy 通用 Git，提交/构建使用 maker_build；云端状态通过 Maker 项目页面核对，未知结果不自动重试。Manual 同步边界。
- 新增三项回归，完整七套 152/152 通过；实际游戏副本重新验证最终 bundle，Git 7/7 通过。最终包再次原位更新成功，实际 maker_status 返回 0.0.39；关闭旧测试服务并确认端口退出后，新 Console health 返回新实例且非 draining。
- 最终包 SHA-256：c27b4e74c6dc6c4292c55487fc2bf58ea2096e27cd5863a7457ee08fdaab5d72；maker.js：8ab28e3509b330acf4c476cfb9d2e9dfd4dc1d173a567a23775f2f6650f3a2e3。全部 35 个 vendor 文件与配方一致。上述历史哈希分别对应此前安装，最新交付以本节为准。
