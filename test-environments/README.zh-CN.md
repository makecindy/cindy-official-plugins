# 测试环境

[English](README.md)

可选的 Cindy 插件及独立本机 CLI，保留完整流程：
**启动 → 选正式账号 → 准备样本 → 执行验收 → 停止**。

正式账号就是应用原有的真实账号，可在不同电脑使用；每台电脑分别登录。
持久的应用档案保留应用保存过的全部账号及其加密登录态。插件自动记录公开账号引用和
本机档案位置，不复制 token、Cookie、钥匙串条目或加密凭证文件。
授权过期、撤销或明确登出后仍需正常登录，不能承诺永久有效。

AI 工具、管理页和 CLI 共用目录。Cindy 桌面复用现有启动、隔离、账号切换及认证接口；
本轮不修改客户端或服务端，也不依赖旧交接中未提交的 WIP。
账号监管需要一个未占用的 `debugPort` 和持久的隔离档案名称。
隔离的是本机数据，不是账号身份。停止、删除目录条目和插件更新不执行登出或删除应用数据。

`ready` 只证明当前账号已联网核验且应用数据库可用；样本准备和用例执行仍需实际工具及证据。
保存用例本身不执行验收。iOS/Android 的安装与操作复用 Baguette。

请阅读[手册](manual/start/MANUAL.zh-CN.md)与更新后的[方案和交接](../docs/test-environments-handoff.md)。
开发时在 Git 之外指定独立 `TEST_ENVIRONMENTS_HOME` 并使用 CLI，不把未完成版本启用到日常宿主。
命令以当前电脑用户执行；账号发现只作用于本插件启动且核实归属的应用，不扫描日常宿主任意实例。

在仓库根运行 `node --test .tests/test-environments.test.mjs .tests/test-environments-ssh.test.mjs`。
当前仍为草稿，需补真实 Cindy 宿主及账号集成证据；模拟协议测试不代表真实账号或跨电脑登录已验收。

本机验收与通用 SSH 编排统一在 PR #309 和同一个测试包交付、分别记录证据。#308 已被替代，#279 保留交接来源，不再要求前置 PR 先合入。跨设备首次授权仍是后续独立研究，未实现或部署。

## 通用 SSH 模板（统一测试包）

统一测试包 1.1.3 同时包含本机验收与通用 SSH 编排，电脑是参数，不是固定目标。
通过 AI/CLI 先 remote_catalog(target) 读目标电脑的档案和实际型号，再 remote_plan(target,profile,pr,requirements)，
检查计划后用返回的 runId 调 remote_start；后续 remote_status、remote_select_account、remote_action、
remote_stop、remote_collect 始终引用同一运行。target.host 是已配置的 SSH 别名/主机名，target.node
可选为 B 的 Node 绝对路径；pr 必须提供 GitHub owner/repo、number 和精确 commit。
B 需已有本机验收档案、源码仓库、SSH 主机信任和项目工具链，账户及其加密登录态留在 B。
prepare/verify 只执行项目保存的参数数组；不接受临时任意远端命令。没有项目命令或设备工具时明确交接待办。
requirements 中 human/device-tool 项目保持 pending，不能用合成事件或命令退出码当作真机/人工通过。
证据仅包含本次结果、可选限量日志和私有截图，校验摘要，绝不复制登录文件或自动发往 PR。
日志可能有项目输出，分享前检查脱敏。SSH 断线后查同一 runId，不能盲目重新开始。
跨设备首次授权另行研究，B 未登录时正常等待授权，不阻塞已登录 B 的编排。
当前只有模拟 SSH + 本机真实 Git/进程测试，没有跨电脑、真实账号、实体手机或人工手感验收。

AI 实际调用统一 `remote` 工具，以 operation 选择 catalog/plan/start/status/stop/select_account/action/collect。文中的 remote_catalog 等名称也保留为 CLI/内部流程入口；不是八个独立宿主工具。

停止请求后拒绝新动作和账号切换；启动中的动作会补收停止请求。同一 runId 的本机请求串行处理，
忙碌时等待回执；进程退出留下的锁按进程启动身份核对后恢复，不信任复用的 PID。
remote_status.accounts 返回本次运行发现的账号目录 ID，供 remote_select_account 使用；不包含登录凭证。
每次 collect 先验证完整清单，再生成独立证据子目录；旧截图不会混入新结果，失败不交付半套文件。

项目配置 prepare 命令后，桌面方案卡片也显示“准备样本”，可从界面完成启动、准备、验证和停止。
已经联网核验过的本机登录态失效后持续提示重新授权，不自动重试账号切换。
