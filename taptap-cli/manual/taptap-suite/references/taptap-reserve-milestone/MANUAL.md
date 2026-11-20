# TapTap CLI 插件:预约里程碑(reserve-milestone)

reserve-milestone 围绕游戏预约人数配置阶梯奖励:查看当前奖励与审核进度、整理或追加档位、上传奖励图、提交审核和撤回待审方案。介绍、提问、预览与结果回复见 [用户指引](taptap-suite/references/taptap-reserve-milestone/references/reserve-milestone-guide.md);执行细节见 [runbook](taptap-suite/references/taptap-reserve-milestone/references/reserve-milestone-runbook.md)。开始前先读 [shared execution](taptap-suite/references/shared-execution.md)(身份、JSON 输出外壳、错误处理和写门禁)。命令行示例按 [taptap-suite](taptap-suite/MANUAL.md) 的映射表转成 `call_tool` 调用。

**CRITICAL — 先区分当前生效方案与提交记录。** `get` 同时返回 `current`(当前生效)和 `submit`(指定或最近提交);两者可能同时存在、内容不同。不把最近提交当作当前生效配置,也不用一侧的记录填补另一侧。

**CRITICAL — 此业务没有单独保存服务端草稿的操作。** 整理方案不会写入后台;上传成功只表示素材齐备,不等于档位已绑定、已提交或已生效。只要求方案时明确说明「尚未提交审核」,不能写成「后台已保存」。

**CRITICAL — 已生效档位不可修改或删除,最多 3 档。** 追加时以已生效档位为不可改动的前缀,提交完整档位数组,不提交只含新增档位的局部数组。已满三档或历史值超限时停止配置写入,交平台核实,不重建或删档绕过。

**CRITICAL — 提审前必须实际执行 `check-readiness`。** `dry_run` 只预览请求,不能证明业务规则已通过;`ready=true` 也只表示当前快照可提审,不代表审核通过、已生效或玩家可见。

**CRITICAL — 撤回与重提是两项授权。** 撤回待审方案、调整后重新提审都要分别取得明确同意;用户说「等我确认再撤回」时必须停在等待。撤回不是撤下已生效奖励,记录仍显示驳回状态。

**CRITICAL — 提审或撤回结果未知先回读。** 有申请编号就按 `submit_id` 回读;没有编号就查历史并逐档核对。不要自动重提或换幂等键重试,短时查不到也先报告结果待核实。

## 快速决策

| 用户意图 | Reference | 起手调用 |
| --- | --- | --- |
| 看当前奖励、待审方案或历史 | [看现状与定位记录](taptap-suite/references/taptap-reserve-milestone/references/reserve-milestone-runbook.md#场景-a看现状与定位记录) | `call_tool(name:"reserve-milestone get", args:{developer_id:"<developerId>", app_id:"<appId>"})` |
| 首次规划或追加奖励档位 | [准备与调整方案](taptap-suite/references/taptap-reserve-milestone/references/reserve-milestone-runbook.md#场景-b准备与调整方案) | 整理完整候选方案;齐备后 `call_tool(name:"reserve-milestone check-readiness", ...)` |
| 上传奖励原图并生成灰图 | [准备奖励图片](taptap-suite/references/taptap-reserve-milestone/references/reserve-milestone-runbook.md#场景-c准备奖励图片) | `call_tool(name:"reserve-milestone upload-reward-image", args:{..., data:{image:"<相对路径>.png"}, idempotency_key:"<imageIntentKey>", dry_run:true})` |
| 提交完整方案审核 | [检查与提审](taptap-suite/references/taptap-reserve-milestone/references/reserve-milestone-runbook.md#场景-d检查与提审) | `check-readiness` → `call_tool(name:"reserve-milestone submit-review", ...)`,先 `dry_run` 再 `yes` |
| 撤回待审方案、处理驳回 | [撤回与驳回恢复](taptap-suite/references/taptap-reserve-milestone/references/reserve-milestone-runbook.md#场景-e撤回与驳回恢复) | `call_tool(name:"reserve-milestone withdraw-review", ...)`,仅在记录待审且已获撤回授权时 |

## 常用调用

```text
# 先看该域操作与参数
list_tools(category:"reserve-milestone")

# 读当前生效方案与最近提交(比较两者差异)
call_tool(name:"reserve-milestone get", args:{
  developer_id:"<developerId>", app_id:"<appId>"})

# 按申请编号回读同一记录
call_tool(name:"reserve-milestone get", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{submit_id:"<submitId>"}})

# 查历史(分页需要实际读取;不带 dry_run)
call_tool(name:"reserve-milestone list-history", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{page_size:20}, page_all:true, page_limit:1000})

# 上传一档奖励原图(本地文件相对会话工作目录)
call_tool(name:"reserve-milestone upload-reward-image", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{image:"rewards/tier-1.png"},
  idempotency_key:"<imageIntentKey>", dry_run:true})

# 检查完整候选方案(只读,必须实际执行)
call_tool(name:"reserve-milestone check-readiness", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:"@milestone.json"})

# 提审(写操作:先 dry_run,确认后同参数加 yes:true)
call_tool(name:"reserve-milestone submit-review", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:"@milestone.json",
  idempotency_key:"<reviewIntentKey>", dry_run:true})

# 撤回待审方案(写操作:仅在记录待审且已获撤回授权时)
call_tool(name:"reserve-milestone withdraw-review", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{submit_id:"<submitId>"},
  idempotency_key:"<withdrawIntentKey>", dry_run:true})
```

## 执行规则

- 先读现状并分流:看现状、首次配置、追加档位、调整未生效方案、只准备方案、仅上传图片、提交已有方案、单独撤回。已有答案和授权直接沿用,不重复问整套问题。
- 已生效档位的目标人数、奖励文案、原图和灰图都保留。首次配置允许连续 1–3 档;追加时只补问新档目标、奖励和缺失原图。
- 奖励必须是用户认可、可兑现的游戏内奖励,不编造,不把「豪华礼包」擅自展开为道具清单,不包含实物或金钱。奖励文案非空且最多 25 个 UTF-16 字符,人数为正整数、严格递增、最多 99999999。
- 奖励原图为 200×200、100 KB 以内、透明背景彩色 PNG;本域上传会生成灰图。已确认的完整图片对可复用;缺图时保留缺口,不编 URL 使检查通过,也不为了检查擅自上传。
- 每次写操作先展示用户可读的业务预览,再 `dry_run: true`;用户确认后用相同参数加 `yes: true`。上传和提审使用各自意图的幂等键,不拿提审 key 执行不同配置。
- 同一厂商、游戏和操作下,原 key 与相同请求内容可回放成功保存后 24 小时内的回执;回执是当时快照,查当前状态仍用 `get`。幂等记录仍在时,同键换内容会冲突。
- 待审方案与目标完全一致时报告审核中,不重复提交;需要变更时先备齐完整新方案和图片,展示差异与影响,再按授权撤回、回读、重新检查。
- `warnings` 不表示平台审批完成或图片文件真实性已验证;`ready`、审核通过、已生效、玩家页可见和奖励发放是不同事实,分别核实。

## 面向用户的回复

- 按回读结果说明目标申请的审核进度和当前已生效的档位,两者分栏或分句表达。例如「新增的第三档正在审核,前两档奖励已生效」。申请编号只用于内部回读;需要辨认申请时用提交时间和奖励档位区分。
- 只准备方案时说明「方案已整理,尚未提交审核」;缺图片只说明哪一档还缺,不让用户自己查接口或搬运存储地址。
- 提审后立即按申请编号回读,在同一回复里逐档列出目标预约人数和完整奖励文案(含数量),包括沿用的档位。
- 图片结果说明实际核实到哪一步;未验证玩家页展示时直接说明「尚未验证游戏页面上的实际展示」。
- 主动撤回确认后说「本次审核申请已撤回」,不说平台拒绝,也不声称生效奖励被撤下。写入结果无法确认时说明哪一步待核实,保留已确认完成的内容。
- 不主动附官方手册链接,不展示内部枚举、字段名或调用清单;业务预览与结果措辞按 [用户指引](taptap-suite/references/taptap-reserve-milestone/references/reserve-milestone-guide.md)。

## References

| Reference | 什么时候读 | 读取方式 |
| --- | --- | --- |
| reserve-milestone runbook | 现状与记录定位、方案整理、图片上传、检查与提审、撤回与驳回恢复、过审后核对 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-reserve-milestone/references/reserve-milestone-runbook.md"})` |
| 用户指引 | 介绍玩法与名词、分步提问、写前预览、结果措辞 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-reserve-milestone/references/reserve-milestone-guide.md"})` |

## 不在本手册范围

- 签到、集卡和兑换码导入转 `taptap-game-sign`;本域不发放奖励、不代平台审批。
- 特殊平台素材或已生效档位调整需平台处理,不自行替换奖品或重建方案绕过限制。
