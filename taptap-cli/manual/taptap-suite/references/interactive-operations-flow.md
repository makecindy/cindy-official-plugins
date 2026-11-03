# 互动运营跨域串联：一次活动上线

三个域的执行由对应手册承载：`taptap-game-sign`、`taptap-whats-new`、`taptap-official-message-push`；分流见 [business routing](taptap-suite/references/business-routing.md)。只串联用户明确要求的域；发布内容不自动授权提审、下线旧公告或向关注用户推送。

## 前置条件与数据传递

先读 [shared execution](taptap-suite/references/shared-execution.md)，再按需读取三个业务手册。身份与授权遵循共享规范；各域操作读取该手册指定的 reference。

| 已取得的结果 | 后续使用 |
| --- | --- |
| `review_id`、`award_id`/`card_id` | 签到配置、导码和审核，目标不可互换 |
| 已核实可用的 `activity_url` | 定位同步公告条目或预览推送内容 |
| `content_id` | 公告配置及上线回读，不重新创建 |
| `preview_fingerprint` → `task_id` | 确认内容后创建推送，再查询发送状态 |

这些写步骤有数据依赖，按顺序执行；不得为前一步尚未返回的 ID 编造值。额度、容量等独立只读检查可以并行，写前仍按对应域要求复核。部分成功时保留成功步骤，不以失败为由自动回滚公告、取消任务或重导文件。

## 执行与续跑协议

每个写步骤都按：读取完整状态 → 精确定位目标 → 展示拟变更差异与影响 → `dry_run` → 用户确认 → 执行 → 回读 → 记录结果。已有明确授权不重复询问相同动作；发现新目标、新风险或内容变化时重新确认。`dry_run` 不执行请求，也不会返回新资源 ID。

在当前任务记录 `developer_id`/`app_id`、`review_id`/`activity_id`/`activity_url`、`content_id`、`task_id`、每个写意图的幂等键、最近回读状态和待办；不记录兑换码明文、签名或上传凭证。不同写意图使用不同 key；同一 payload 的预览和执行复用同一 key。续跑先回读已知 ID，已完成且符合目标的步骤跳过；不要从创建重新开始。

所有列表定位、查重都要遍历全部页。达到页数/时间限制、分页异常或覆盖不完整时，保持待办并停止依赖全量结论的写操作，不能把未找到解释成不存在。结果未知时停止重建；只读核对仍无法确定则保留未知结果，不能换 key 重试。

## 开始前：一次核对目标与约束

复用当前已确定的游戏、活动、素材与授权，只补缺失项。汇总签到开始/结束、兑换截止、每日奖励、卡片概率与文件用途；用户要求公告或推送时，再纳入公告位置、推送范围与带时区的时间。仅对用户要求的域先读公告容量或推送额度，提前说明缺口；这些读数不预留资源，真正写入前仍要重查。

定时推送只支持业务时区的今天/明天，须晚于当前并避开 01:00–07:00，且须符合目标活动时间。超出窗口时记录“待进入推送窗口”，不创建远期任务、不擅自改为立即发送，也不承诺后台自动执行。恢复后重新查活动状态、额度与预览，再 `dry_run`、确认、执行和回读。

本地图片按已确认用途交给 `taptap-materials` 上传，结果回到原奖励/卡片；不要求用户搬运 URL。兑换码使用签到导码 shortcut；开始时检查当前目录是否具备所需接口，只有缺能力时才保留待办。`dry_run` 仅校验本地请求，不证明库存、审核、公告容量或推送时机已经满足服务端条件。

## 阶段 1：准备签到内容

1. 已有 `review_id` 时直接 `get-game-sign-activity` / `get-game-sign-config`；否则完整读取 `list-game-sign-activities`，按活动标题、时间确认唯一对象。多候选时停止让用户选择，不自动接着改同标题草稿。
2. 仅确需新活动时 `create-game-sign-activity`；保存 `review_id`，配置每日奖励和可选集卡。`add-game-sign-card` 返回的 `card_id` 必须传给后续保存及库存操作。
3. 按 [code import](taptap-suite/references/taptap-game-sign/references/code-import.md) 导码；每日奖励与集卡卡片不能互换 `award_id`/`card_id`。缺能力保留待办；恢复同一本地 task，查询目标最近记录及库存。受理结果不代表本文件完成，不将旧导入记录当成本次成功。
4. `check-game-sign-readiness` 无 error 后，若用户明确要求并确认提审，再 `submit-game-sign-review`。审核中保持待办，按需查询，不无限等待或重复提交。
5. 回读审核状态和时间：`ACCEPT` 仅代表审核通过；`GAME_SIGN_START` 才是进行中。`get-game-sign-activity` 返回的 `activity_url` 还须确认为当前活动可用链接，ID/URL 非空不等于已生效。

签到链接尚未可用时不创建面向它的推送。签到是系统同步展示条目，不在公告域手动创建替代条目；可以准备文字方案，不能以换 `label_type` 绕过同步规则。

## 阶段 2：定位并配置公告位

优先用记录的 `content_id` 调 `get-whats-new`，核对当前 scope、`label_type` 和 URL 是否属于阶段 1 的活动。没有 ID 时完整查询两种状态：

```text
call_tool(name:"whats-new list-whats-new", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{type:"activity", status:"online", page:1, page_size:20},
  page_all:true, page_limit:1000})

call_tool(name:"whats-new list-whats-new", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{type:"activity", status:"offline", page:1, page_size:20},
  page_all:true, page_limit:1000})
```

在结果中同时匹配 `label_type=check_in` 和已核实的 `activity_url`；如响应提供权威活动关联 ID，也核对 `activity_id`。不能仅按“签到类型”或标题选择内容；不要擅自删除 URL 参数来强行匹配。

| 查询结果 | 下一步 |
| --- | --- |
| 唯一匹配且已在线 | 记录 `content_id`，跳过上线；配置符合目标时只回读 |
| 唯一匹配且下线 | 记录 `content_id`，读容量和完整置顶占用，确认差异后配置并上线 |
| 多候选 | 停止写入，展示标题、链接、时间与状态，让用户选择 |
| 未同步/无匹配 | 保留同步待办，稍后查询或网页核实；不手动创建 `check_in` 或伪装为 `activity` |
| 覆盖不完整/链接无法唯一对应 | 停止定位，保留待办；不要选择第一条 |

修改排期仅在当前 schema/业务规则允许该类型修改时执行；只需置顶就用 `save-whats-new-top`，避免无意覆盖排期。容量满或置顶满时先让用户选择并确认替换对象；普通容量处理上下线，置顶容量优先取消所选对象的对应置顶，不自动把旧公告下线。获得授权后逐步执行，每次回读再继续。

回读目标 `content_id`、状态、URL、`invalid` 与置顶位置。已在线且 `invalid=false` 仅表示配置事实；没有 C 端证据就说“配置已生效，展示待验证”。

## 阶段 3：创建并核对推送

1. 重新查当前额度与关注人数；完整分页检查同链接待发任务及相近时间重叠任务，已有任务符合用户意图则复用查询，不重复创建。
2. 对同一可用 `activity_url` 重新预览；向用户确认标题、链接、范围和发送时间，处理零关注和近邻触达风险。范围不能默认全部。
3. `now`/`scheduled` 都必须回传刚确认的 `preview_fingerprint`；内容变化时重新预览并确认，不能去掉指纹绕过。用稳定幂等键预览并执行。
4. 记录 `task_id` 并回读真实状态；立即推送可能已是 `sending`/`sent`，不必等到 `created`，更不能重建。已发送不可撤回。

公告配置不应成为所有推送请求的硬依赖：用户只要推送已可用链接时直接走推送域。只有用户要求完整组合时才汇总三个域的完成情况。

## 部分成功与下一步

| 情况 | 处理 |
| --- | --- |
| 签到 `REJECT` | 读取原因，修改授权范围内配置，重新 readiness，再单独确认重新提审 |
| 签到 `UNDER_REVIEW` | 保持审核待办；不提前推送或创建替代签到公告 |
| 公告成功、推送失败 | 保留公告，记录失败步骤；按推送 runbook 核对真实任务，不擅自下线补偿 |
| 推送结果未知 | 完整分页核对目标与时间；无法唯一确认则停止，不用新 key 重建 |
| 导码上传完成但导入中/失败 | 保留未就绪状态，查对应奖励/卡片；核实本次提交与库存变化，不能重复整份导入 |
| 等待超时或用户稍后继续 | 输出已完成、未知/处理中、待办和查询入口，保存已取得的 ID，不重新开始创建 |

口径：创建 ≠ 上线 ≠ C 端可见；审核通过 ≠ 活动进行中；任务创建 ≠ 已发送；统计时间戳为 0 时说明数据缺失，不填成零曝光/零转化。公告到期存在清理窗口，PC 无同等预览能力，不承诺即时消失或已发送消息撤回。
