# 本地兑换码导入与恢复

适用每日奖励和集卡码类库存。先从当前配置核对文件 → review → award/card 的映射，复用已有 scope 和 ID；只询问缺失或歧义项，不要求用户复制 ID、URL 或上传凭证。

## 前置条件与交接字段

先读 [shared execution](taptap-suite/references/shared-execution.md)。需要本地 CSV、当前游戏 scope、`review_id`，以及互斥的 `award_id`/`card_id`；目标 ID 来自当前配置，卡片奖品须为 `REDEEM_CODE`。已有配置足以确认目标时不重新列活动。

| 阶段结果 | 后续用途 |
| --- | --- |
| dry-run 的 `confirmation_hash` | 同一文件、目标与 key 的执行确认值，传给 `confirm_hash` |
| 执行返回 `task_id` | 用 `task +get` / `+resume` 查询或恢复原任务，不新建替代任务 |
| `submission_status` 与 `latest_status` | 分别表示提交受理与目标最近状态；结合库存核实，不当成本文件独立回执 |

## 能力与确认

`game-sign +import-codes` 是本地入口。导码包含文件上传、提交导入和结果查询。每日奖励用 `award_id`，集卡用 `card_id`，两者互斥；上传准备、提交导入和结果查询都支持集卡目标，不能把 `card_id` 当 `award_id`。

输入为无标题、无空行的单列 UTF-8 CSV（可含 BOM），每码 1–256 位 ASCII 字母/数字/_/-，最多 20 MiB、100000 行。首行类似 `code`、`redeem_code` 等表头时预览会给 warning，但仍按原文件计数和上传，不静默删除首行；出现提示先核实它是实际兑换码还是表头，若是表头则修正文件后重新预览。文件内重复会停止；不会自动去重、转换 xlsx 或覆盖原库存。服务端返回目标最近记录的 `success_count`/`failed_count`/`import_count`，不提供本文件独立的重复码统计。

先读配置及库存，展示目标、当前库存、追加模式与预计数量；相同意图固定 `idempotency_key`。运行本地 dry-run，不发请求、不创建任务、不打印码内容：

```text
call_tool(name:"game-sign +import-codes", args:{
  _positional:["./day1.csv"], developer_id:"<developerId>", app_id:"<appId>",
  review_id:"<reviewId>", award_id:"<awardId>",
  idempotency_key:"<stable-key>", dry_run:true})
```

卡片用 `card_id` 替代 `award_id`，二者不可同时使用。展示 preview 中数量、摘要和目标差异；已有授权覆盖该具体意图时沿用，否则取得确认。执行同一调用，把 `dry_run` 换成 `yes:true` 并传 `confirm_hash:"<confirmation_hash>"`；hash 必须来自这份文件和目标的本次 preview。文件、目标或 key 变化后重新预览和确认。

## 回读与续跑

CLI 返回 `task_id` 与 `submission_status`；`submitted` 仅表示导入请求已受理。`latest_status` 是该目标最近一条导入记录，不能单独证明本文件完成。即使目标已有 `COMPLETED`，新文件也必须上传和提交。记录导入前后库存，结合本次操作和页面记录核实实际入库；并发导入或计数无法对应时保持待核实，不声称成功。

```text
call_tool(name:"task", args:{_positional:["+list"]})
call_tool(name:"task", args:{_positional:["+get","<taskId>"]})
call_tool(name:"task", args:{_positional:["+resume","<taskId>"], dry_run:true})
```

核对原 scope、目标、文件摘要与恢复阶段；同一已授权意图可继续 `task +resume <taskId>` 并加 `yes:true`。上传准备/上传失败可重试；确认已提交的任务只查询，原文件删除也能回读。请求发出后响应丢失、或进程在记录受理结果前退出时，任务进入结果未知，必须核实原提交和库存，禁止自动再提交或换 key 重导。旧 V2 任务也需要核实，不能自动迁移。停止本地跟踪不会撤销已提交的导入。

不要记录兑换码明文或上传凭证。`PROCESSING`/`NOT_UPLOADED` 表示尚未获得完成状态；`FAILED` 要核实失败范围，不能整份自动重传。成功核实后用 `get-game-sign-config` 回读对应 `award_id`/`card_id`，再 `check-game-sign-readiness`。导码只推进 readiness，不自动提审、公告上线或推送。
