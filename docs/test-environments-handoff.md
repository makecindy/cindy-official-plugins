# Test Environments：统一 PR 方案与交接

[English](test-environments-handoff.en.md)

2026-11-09 按接手者决定统一交付：**[#309](https://github.com/makecindy/cindy-official-plugins/pull/309)
是本机与 SSH 流程唯一的开发、测试和合并入口**。#308 已由 #309 替代；
[#279](https://github.com/makecindy/cindy-official-plugins/pull/279) 保留为原始需求和交接来源。
不再要求 #308 或 #279 先合入。统一 PR 仍为 Draft；生成测试包不等于安装、发布或真实验收通过。

## 目标与交付范围

保留 **启动 → 选账号 → 准备样本 → 执行验收 → 停止**。
使用应用原有的真实正式账号，同一账号可在不同电脑分别登录。隔离档案只隔离本地测试数据，
不制造只能在一台电脑使用的特殊测试账号。

| 能力 | 当前统一 PR 的实现 | 验证边界 |
| --- | --- | --- |
| 本机验收 | 目录、账号发现/选择、启动监管、样本/验收命令、停止 | 当前代码的自动回归；真实 Cindy/正式账号待验证 |
| 通用 SSH 模板 | 每次指定电脑和 B 档案，按精确 PR SHA 检出、构建启动、复用 B 登录、运行命令并取回证据 | 模拟传输和真实 OpenSSH 回环、解包入口；真实跨电脑/硬件待验证 |
| 实体设备与人工步骤 | 返回明确的设备工具/人工待办，保留 pending | 手机需对应设备工具，触控板手感等需真实人工输入 |
| 跨设备首次授权 | 仅研究和接口设计，未实现或部署 | 不作为已有 B 登录的 SSH 编排前提，不计入本轮已实现能力 |

本机与 SSH 一起打包测试，证据分别记录，不能相互冒充。跨设备首次授权仍是后续独立工作。

## 登录与数据归属

Cindy 通过既有凭证库安全保存每台电脑自己的加密登录态；插件只记录公开账号引用、
本机档案位置和启动配置。应用保存的全部账号可被自动记住，账号展示名编辑、停止/重启、
插件更新不执行登出或清空应用档案。

新电脑需完成一次自己的正常登录；过期、撤销、明确登出或删除应用数据后需重新授权。
插件不提取、复制或保存明文 token、Cookie、钥匙串或凭证文件，也不承诺登录永久有效。
发现范围仅限本插件启动并核实归属的目标应用，不扫描任意日常宿主或其他电脑的历史登录。
SSH 只传控制、公开配置和指定证据，不通过复制凭证代替设备授权。

## 代码导航

以下路径相对于 `test-environments/`。

| 模块 | 职责 |
| --- | --- |
| `node/core.cjs` | 共享目录、启动计划、账号选择、样本/验收命令与工作流 |
| `node/account-catalog.cjs` | 合并应用保存的公开账号及本机档案历史，不保管凭证 |
| `node/session-monitor.cjs` | 实际身份、单次切换、重新授权等待、联网认证和数据库状态 |
| `node/observation.cjs` | 核对 PID/启动身份/端口/主页面，仅执行固定应用操作并筛选结果 |
| `node/cindy-launch.cjs` | 复用原 restart 协调器和检查，仅接管最终就绪等待 |
| `node/runner.cjs`、`node/terminal.py` | 自有进程监管、macOS PTY、精确停止 |
| `node/remote.cjs` | 参数化 OpenSSH、本机运行记录、证据大小/哈希校验与落盘 |
| `node/remote-agent.cjs`、`node/remote-runner.cjs` | B 的预览、精确 PR 工作树、共享核心、运行/停止/证据回执 |
| `main.js`、`manage.*`、`workflow.js`、`node/worker.cjs`、`node/cli.cjs` | 引导页、高级管理、AI 和 CLI 共用实现；本机/SSH 均有页面入口 |

本轮不改客户端/服务端，不新增第三方 OAuth scope。远端执行与证据传输边界仍需维护者审核，
不能因统一 PR 或自动测试通过就跳过。选装受众保持 opt-in。

## 本机与 SSH 测试方式

本机先 `catalog`，保存源码项目和持久隔离档案，设置未占用的 debugPort，查看 plan 后 start。
通过应用正常登录并添加账号，插件自动记住引用；选账号后检查 status，缺少/过期登录时等待正常授权。
`ready / application-account-online` 只证明账号联网核验和数据库可用，不代表样本或验收通过。
通过实际工具准备样本、执行用例并记录结果，最后 stop 并查询至停止。

SSH 先通过 GitHub 工具取得当前 PR head SHA，再调用统一 `remote` 工具：

1. `operation:catalog`，传 `target:{host,node?}`，读取 B 的实际型号和公开目录。
2. `operation:plan`，传 target、B 档案 ID、`pr:{repo,number,commit}` 和 requirements。
   B 的项目路径来自选定档案，可从 catalog 确认。返回持久 runId，尚未检出或启动 PR。
3. 确认计划后 `operation:start`；之后 status、select_account、action、stop、collect 均用同一 runId。
4. action 只执行已保存的 prepare/verify argv；未配置命令时明确交接待办。人机/设备项不因退出 0 而通过。
5. collect 可把结果、可选限量日志/私有截图带回指定 outputDir 或本机私有目录，分享前检查脱敏。

B 需已有 SSH 主机信任、Node、Git、项目工具链及本机档案；无须按电脑重写业务模板。
不自动接受 SSH 主机密钥、不转发 A 的 Agent、不覆盖 B 工作区、不广泛杀进程。
断连后查询同一运行，不盲目重试启动或命令。详细约束见 [SSH 与授权设计](test-environments-remote.zh-CN.md)。

## 可直接执行的实机验收单

[中文操作单](test-environments-acceptance.zh-CN.md) / [English](test-environments-acceptance.md)
列出每项前置、操作、预期及证据：L1–L6 本机，R0–R4 双机，按需追加真实设备和人工输入。
截图在停止前收集；停止后只取日志和最终结果。

## 1.2.0 引导首页

[使用说明](test-environments-guided.zh-CN.md)：默认按本机/SSH、项目、账号和五步流程操作，
原目录管理收进高级入口；首次配置自动生成持久档案，PR 可省略 SHA、由目标 Git 精确预览。
1.2.0 最终组合检查 **129/129 通过、0 跳过**（普通检查 100、浏览器 27、解包 1、真实 SSH 回环 1）。
按用户要求省略作者显示字段，不改写贡献历史。旧版本证据仍标明原版本，不能冒充新界面实测。

## 当前实现证据与缺口

统一测试包版本 **1.2.0**。本轮修复停止/动作竞态、过期账号与进程状态、SSH 中文回包、执行不确定态、共享 FETCH_HEAD 和证据混用等问题；
1.1.3 另补齐桌面“准备样本”按钮和已核验登录态失效提示；页面点击验证见[点击测试](test-environments-click-check.zh-CN.md)。
自检发现、回归与实机缺口见[自检记录](test-environments-self-check.zh-CN.md)。当前实现自动回归覆盖：

- 本机账号保存、A→B→A 状态机、不同电脑独立登录模型、失效提示、未知切换不重试、排队切换使旧 ready 失效。
- 真实子进程、macOS PTY、实例归属、原协调器检查，以及模拟应用通过真实 HTTP/WebSocket/CDP 的运行链路。
- 模拟 SSH 传输调用真实 Node/Git/工作树/共享 runner，执行样本/验证命令、精确停止、证据取回。
- SSH 参数、错误仓库/SHA、未知与确认未执行的区别、证据文件名/大小/摘要检查。
- 解包后的 AI 桥/真实 Worker/CLI、真实 OpenSSH 回环及回执丢失恢复；截图合法/无效/超大及停止后拒绝的协议测试。
- 1.1.3 历史组合检查 114/114 通过（含浏览器与可选解包/回环测试），没有跳过项；不等于真实宿主/账号/双机验收。

这些不代表真实 Cindy、两个正式账号、两台真实电脑、指定型号硬件、实体手机或人工手感已验收。
缺失 WIP 的旧 1.0.4 结论只作历史背景，不作为当前实现证据。

待补证据：真实 Cindy 本机登录/重启与 A→B→A；第二台电脑独立登录；真实 SSH 的构建、
本机登录复用、断线恢复及证据回传；管理页/AI/CLI 宿主集成与实际版本渠道；相应设备工具与人工步骤。
Windows 账号监管仍明确不可用，Linux/移动端等需分别验证，不能外推 macOS 结果。

测试包不安装、不启用到日常宿主，不带真实账号、运行日志或数据档案。
使用仓库外独立 `TEST_ENVIRONMENTS_HOME` 和共享 CLI 进行独立验收；目标 dev 不安装本插件以启动下一层。

```sh
node --test .tests/plugin-contract.test.mjs .tests/localization.test.mjs .tests/provisioning.test.mjs .tests/publish-workflows.test.mjs .tests/test-environments.test.mjs .tests/test-environments-ssh.test.mjs
```

测试包、提交与 SHA-256 对应关系记录在 #309 的验证说明及当前 Cindy 任务中。
