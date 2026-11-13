# AgentCompass（`agentcompass`）

把 Cindy 会话中的独立工作交给最合适的模型，并取回确切结果。English: [README.md](./README.md)。

## 它是什么

一个 [Cindy](https://github.com/makecindy/cindy) 插件，提供 `roll`、`status`、`stop`、`cleanup` 四个工具。`roll` 接收完整任务，判断应拆分、留在当前会话回答，还是委派；
委派时从**这台 Cindy 实际能运行的模型**中选出 harness、模型与档位，把该路由作为普通 Cindy 任务启动，核对 Cindy 运行的确是所选路由，并在完成后交回任务的最终消息。
打分使用 [AgentCompass](https://github.com/akiiwa-games/AgentCompass) v0.6.0 引擎，以纯 JavaScript 内置于插件：无需安装其他任何东西，插件不发起任何网络请求。

## 必须知道的规则

- **需要 Cindy 账号。** Cindy 未登录时，插件的每个工具都会停在 Cindy 的设置卡片；Codex、Claude、Grok 的登录不算数。插件通过 Cindy 的 quick-text 通道让模型为每个任务做画像
  （`cindy.text: ["oneshot"]`），而 Cindy 对声明了它的插件一律要求自己的账号。已在 Cindy 0.1.121 上实测：[证据](https://github.com/akiiwa-games/cindy-agentcompass-plugin/blob/main/docs/sandbox-real-e2e/README.md)；
  登录后分类器在 Cindy 0.1.135 上的实测见[这里](https://github.com/akiiwa-games/cindy-agentcompass-plugin/blob/main/docs/real-cindy-0.1.135-plugin-0.4.0/README.md)。
- **读取什么。** 只读取 Cindy 的实时模型目录（`tasks.models()`），不读取 Cindy 的其他数据，也不读取任何 Codex 目录。在 Cindy 上，路由依据能力匹配（插件不在两次 roll 之间保留连续性），
  在 Cindy 通过插件 API 提供连接类型与额度之前不做额度经济，也没有 fast 模式：目录无法区分用户自己的登录与 Cindy 网关，因此不给任何连接附加额度，也不会选择 fast 模式。
  插件卡片上更换模型后，待缓存答案（10 分钟）或冷却（至多 5 分钟）过期，下一次分类即采用新模型。回执与缓存写在 `~/.agent-compass/cindy-plugin/`。
- **绝不做什么。** 不联网、不碰凭据、没有自己的模型 API。任务由模型分类，从不按任务文本里的关键词判断。Cindy 无法原样复现的模型、连接、档位或权限一律拒绝，不会放宽。
  答复丢失的发送绝不重发。
- **无法路由时**，`roll` 返回 `status: "blocked"` 与 `decision.reason`（如 `no_route`、`classifier_no_candidate`），并说明该改什么，不启动任何任务。`split` 与 `self` 同样不启动任务。
  每次分类都会消耗你的模型额度，包括结果为 `split` 或 `self` 的分类。
- **每个 worker** 都在父会话的项目目录中创建，使用 `bypassPermissions`（Claude）或 `full-access`（Codex、Pi），与父会话自身的模式无关。

## 安装与首次使用

1. 在 Cindy 插件市场安装 `agentcompass`，批准 Node、sessionContext 与 tasks。
2. 在插件页把 **Write access** 设为 **Full access**，把 **Working folder** 设为要委派的项目。
3. 用 `ghost_call` 委派：

   ```json
   {"ghost_id":"agentcompass","tool":"roll","args":{"task":"<完整任务，不要改写>"}}
   ```

4. 按返回的 `next_tool`（`status`）反复调用，直到运行结束**且** `messages_complete` 为 `true`。没有自动回调。
5. 调用 `cleanup`。Cindy 0.1.121 没有归档 API，所以它会返回 `manual_cleanup_required` 与任务 ID：请在 Cindy 任务列表中自行归档该任务。

`stop` 取消运行，并最多等待十秒让 Cindy 确认。工具参数与返回、画像约定、可选的外部 `agentcompass` CLI（`~/.agent-compass/cindy-plugin/config.json` 写 `{"engine":"cli"}`）以及全部拒绝码见
[参考文档](https://github.com/akiiwa-games/cindy-agentcompass-plugin/blob/main/docs/REFERENCE.md)（英文）。

## 测试

本目录是插件 `plugin/` 文件夹的副本；源码、单元测试、沙盒端到端测试与运行记录在
[cindy-agentcompass-plugin](https://github.com/akiiwa-games/cindy-agentcompass-plugin)。市场自己对它的检查用 `node --test .tests/agentcompass.test.mjs` 运行。

## 与其他宿主的关系

同一引擎通过 `agentcompass roll` 为 Claude Code、Codex CLI、Pi、Paseo 等路由，并通过 [magpie-agentcompass-router](https://github.com/akiiwa-games/magpie-agentcompass-router) 为 Magpie 请求路由。
打分与额度规则只在 AgentCompass 的[技术参考](https://github.com/akiiwa-games/AgentCompass/blob/v0.6.0/docs/technical-reference.md)中定义一次。
