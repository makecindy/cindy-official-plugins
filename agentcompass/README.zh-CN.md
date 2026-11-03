<p align="right">
  <a href="README.md">English</a> · <strong>简体中文</strong>
</p>

# AgentCompass

让 Cindy 会话把工作交给 [AgentCompass](https://github.com/akiiwa-games/AgentCompass)，并取回确切结果。AgentCompass
为任务画像，按你各账号的实时额度选出账号、模型和推理强度；插件把这条路由作为普通 Cindy 任务启动，核对 Cindy
实际运行的正是所路由的配置，并收取任务的最终消息。

源码、问题反馈和完整沙盒测试：[akiiwa-games/cindy-agentcompass-plugin](https://github.com/akiiwa-games/cindy-agentcompass-plugin)。

## 前提

- Cindy 0.1.121 或更新版本，并启用实验性的公开 tasks API。插件使用 `sessionContext`、`agent.tasks` 和 Node
  工作进程（`json-rpc-stdio`）。
- 同一台机器上已安装 AgentCompass（`uv tool install agentcompass` 或其 Windows 安装器），并运行过
  `agentcompass setup`。插件本身不带路由器、凭证或模型 API。
- 插件的任务目录设为要委派的项目。

## 零配置

每次 `roll` 时，Node 工作进程按以下顺序查找路由器，并运行 `<它> roll`：

1. `~/.agent-compass/cindy-plugin/router.json`（存在时）：`{"command": [...完整 roll 命令...], "accountMappings": [...]}`；
2. `PATH` 上的 `agentcompass`（Windows 为 `agentcompass.exe`）；
3. `~/.local/bin/agentcompass`（Windows 为 `%USERPROFILE%\.local\bin\agentcompass.exe`），即 `uv tool install` 的安装位置。

都找不到时，调用会带着这条说明失败，不做任何路由。

路由出的账号与 Cindy 连接名称不同时，在 `~/.agent-compass/cindy-plugin/account-map.json` 中映射：

```json
[{"routerProvider": "pi", "routerAccount": "codex", "providerId": "<Cindy 连接 ID>", "agentKind": "pi"}]
```

`agentKind` 取 `cc`、`codex` 或 `pi`。没有这个文件时，路由出的账号须有同名的 Cindy 连接。

## 工具

| 工具 | 作用 |
| --- | --- |
| `roll` | 原样路由完整任务（`agentcompass roll --parent-host native --local-only ...`），用 `bypassPermissions` 启动一条完全匹配的 Cindy 目录路由。不是原生路由的回答（`self`、`split` 等）原样返回，不启动任何任务。 |
| `status` | 收取运行结果：读取宿主持久化的运行记录和分页消息；完整输出保存到磁盘，返回确切最终消息的有界摘要。 |
| `stop` | 通过 Cindy 的作用域取消 API 取消；在 Cindy 确认终态之前如实报告 `stopping`。 |
| `cleanup` | Cindy 提供归档时归档非活动任务，否则返回已确认的任务 ID 供手动归档。 |

没有自动回调：反复调用 `status`（每次回复都在 `next_tool` 中给出），直到运行进入终态。

## 边界

- 只有 Cindy 注入的 `session_context` 能确定父会话；调用方自带的会被替换。远程或只读工作目录在路由之前即被拒绝。
- 只运行 Claude、Codex 和 Pi 路由，且必须命中完全一致的目录项（连接、模型、推理强度、快速模式）；Cindy 无法
  复现的一律拒绝，绝不替换。路由、权限或目录不符的草稿不会收到任何输入，并被归档。
- 工作进程只启动一个本地程序，即 AgentCompass 的 `roll` 命令，参数固定，任务经 stdin 传入；它会从自身环境中移除
  其他 Agent 宿主的会话变量。插件本身不发起网络请求；AgentCompass 自己会读取本机账号用量，并调用你为它配置的分类器。
- 回执和消息分页保存在 `~/.agent-compass/cindy-plugin/` 下。
