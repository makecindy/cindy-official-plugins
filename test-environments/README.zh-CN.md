# 测试环境

## 最简单的用法（1.2.1）

点“选择项目…”使用 **Cindy 现有的原生目录选择窗口**，选中源码项目后直接点“启动测试”。
不再填写路径、项目名称或创建方案；默认配置自动保存，重复选择同一真实目录会复用原项目和档案。
选择或取消本身不会启动。运行后只有一个状态面板，显示登录提示及已配置的样本/验收、截图和停止操作。
原来的完整配置、技术详情和历史仍在“高级管理”；SSH 仍先预览精确版本再启动。

插件使用已公开的 cindy.pick，并未复制 Cindy 内部的项目下拉组件或扫描宿主项目数据库。
这次复用的是原生目录选择，不宣称已接入宿主“最近项目”列表；Cindy 目前未向插件开放那个组件。
新增 pick 声明只用于用户亲自选目录，现有 node 的本机权限不变；取消、忙碌或不可用时不自动重弹。
作者显示字段仍省略，不改写历史提交与贡献者。

## 通用 SSH 模板（统一测试包）

统一测试包 1.2.1 同时包含本机验收与通用 SSH 编排，电脑是参数，不是固定目标。
通过 AI/CLI 先 remote_catalog(target) 读目标电脑的档案和实际型号，再 remote_plan(target,profile,pr,requirements)，
检查计划后用返回的 runId 调 remote_start；后续 remote_status、remote_select_account、remote_action、
remote_stop、remote_collect 始终引用同一运行。target.host 是已配置的 SSH 别名/主机名，target.node
可选为 B 的 Node 绝对路径；pr 提供 GitHub owner/repo、number；可选 commit，不填时从目标 Git 读取并预览精确版本。
B 需已有本机验收档案、源码仓库、SSH 主机信任和项目工具链，账户及其加密登录态留在 B。
prepare/verify 只执行项目保存的参数数组；不接受临时任意远端命令。没有项目命令或设备工具时明确交接待办。
requirements 中 human/device-tool 项目保持 pending，不能用合成事件或命令退出码当作真机/人工通过。
证据仅包含本次结果、可选限量日志和私有截图，校验摘要，绝不复制登录文件或自动发往 PR。
日志可能有项目输出，分享前检查脱敏。SSH 断线后查同一 runId，不能盲目重新开始。
跨设备首次授权另行研究，B 未登录时正常等待授权，不阻塞已登录 B 的编排。
当前证据包含模拟 SSH、本机真实 Git/进程及真实 OpenSSH 回环；尚无双物理电脑、真实账号、实体手机或人工手感验收。

AI 实际调用统一 `remote` 工具，以 operation 选择 catalog/plan/start/status/stop/select_account/action/collect。文中的 remote_catalog 等名称也保留为 CLI/内部流程入口；不是八个独立宿主工具。

停止请求后拒绝新动作和账号切换；启动中的动作会补收停止请求。同一 runId 的本机请求串行处理，
忙碌时等待回执；进程退出留下的锁按进程启动身份核对后恢复，不信任复用的 PID。
remote_status.accounts 返回本次运行发现的账号目录 ID，供 remote_select_account 使用；不包含登录凭证。
每次 collect 先验证完整清单，再生成独立证据子目录；旧截图不会混入新结果，失败不交付半套文件。

项目配置 prepare 命令后，桌面方案卡片也显示“准备样本”，可从界面完成启动、准备、验证和停止。
已经联网核验过的本机登录态失效后持续提示重新授权，不自动重试账号切换。
