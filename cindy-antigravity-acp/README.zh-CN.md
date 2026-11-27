# Antigravity

在支持的 Cindy 版本上，Google 要求验证账号时，任务内会自动展开扫码卡。扫码或点开链接即可前往 Google 官方页面；插件在本机核对原会话与本次检查的 Google 账号。等待期间切换账号或无法确认身份时，任务继续等待；原账号恢复后，任务在原对话继续。任务结束时清理临时诊断日志。

在 Cindy 0.1.148 或更高版本的「插件」市场安装 Antigravity。打开插件设置检测或安装 `agy`；账号统一在「设置 → 模型供应商 → Antigravity」里添加和管理，可以登录多个 Google 账号、查看各自的用量并在账号之间分配任务。然后从模型选择器选择 Antigravity 运行任务；模型列表会优先展示直选模型，将 Antigravity 内置的 Orchestrator 编排模式（不支持调节思考档位）排在末尾并附带说明。远程调用和分享需要支持插件引擎分享的宿主。这类任务里 Antigravity 可以提问和显示步骤，agy 1.5.18 及以上还能启动子 Agent 和设定时提醒；Antigravity 自带的文件、命令、浏览器和生图工具在这类任务里保持关闭，由任务所在电脑上的 Cindy 工具代替。这类任务还会接收 Cindy 为整个会话传来的指令（ACP `systemPrompt`，例如支持传递的 Cindy 版本中的自定义提示词），追加到 Agent 的指令里；本机任务暂不接收。

[上游源码与 CLI 说明](https://github.com/makecindy/cindy-antigravity-plugin/tree/768ffa8d26f2e5ea9f0e6e3476d0c49dc1b8681d)
