# Agent Board / Agent 看板

A sidebar board for Cindy that shows every local agent and task in four columns — **in progress / blocked / queued / idle** — and lets you act on them.

把本机所有 agent 与任务收进侧栏看板：**在途 / 卡点 / 排队 / 空闲** 四列，并能直接操作。

## What it does / 功能

- **Two views / 双视图**: `Cindy` (companions + project tasks) and `Herdr` (panes grouped by agent). `Agent` view draws the agent → task layer; `Policy` view holds schedules, standing rules, insight analysis, patrol log and automation.
  - `Cindy` 视图：伙伴 + 各项目任务；`Herdr` 视图：按引擎聚合的 pane；`Agent` 视图：agent → task 层级；`策略` 视图：巡检计划、常驻策略、启发分析、巡检记录、自动机制。
- **Click a card / 点卡片**: companion → opens its conversation; task → opens the task; Herdr pane → opens a **color terminal** with a prompt line (Enter sends, Tab completes, Ctrl+C interrupts), 2 s live refresh, and click-to-copy selection.
  - 点卡片跳转；Herdr pane 弹彩色终端，带 `❯` 输入行、2 秒刷新、选中即复制。
- **Command chat / 指挥聊天框**: a chat box at the bottom of the board backed by the plugin's own task. Ask for status, dispatch work, or change policy in plain language; the commander reads `board_state` first and replies.
  - 看板底部聊天框，背后是插件自建任务；自然语言即可查状态、派活、改策略。
- **Patrol automation / 巡检自动化**: Outlook-style schedule (every N minutes/hours, daily, or weekly with weekday chips + time), a standing policy, patrol rules, a patrol log, and insight analysis with a model you pick.
  - Outlook 式巡检计划、常驻策略、巡检方式、巡检记录、启发分析。
- **i18n**: the page follows the Cindy host locale (10 languages); the manifest ships `zh-CN / en / ja / ko`.
  - 页面跟随宿主语言（10 种），清单四语。

## Degradation / 降级

Herdr is optional. Without it the plugin shows the Cindy view only, and every Herdr tool returns a structured error — nothing else breaks.

未安装 Herdr 时只剩 Cindy 视图，其余功能不受影响。

## Permissions / 权限

| capability | why |
| --- | --- |
| `agent.observe` | read project task status (`cindy.observe`) |
| `agent.companions` | read companion status and open conversations |
| `agent.tasks` + `agent.targets` | create the commander task and dispatch to companions |
| `agent.schedule` | open the pre-filled automation panel |
| `agent.hostTools: scheduler` | read/apply the patrol schedule (Cindy automation) |
| `node` worker | read the local Herdr unix socket (`~/.config/herdr/herdr.sock`); read-only methods plus `pane.send_text` / `pane.send_keys` / `pane.focus` |

No network permission is declared. The plugin never performs privilege escalation, sandbox bypass or outbound publication on the owner's behalf; those are surfaced for the owner to decide.

不声明网络权限；提权、绕沙箱、对外发布一律交还主人决定。

## Local build / 本地打包

```bash
zip -X -r agent-board-1.0.0.cindy ghost.json main.js ui node assets locales
```

## License / 许可

MIT
