# TapTap CLI 插件:活动与公告位(whats-new)

whats-new 管理游戏详情页与 PC 库的展示条目：引用已有内容，配置排期、上下线、置顶和排序。内容本身在帖子、视频、签到等来源模块，本域不创建源内容。开始前先读 [shared execution](taptap-suite/references/shared-execution.md)(身份、JSON 输出外壳、错误处理)。命令行示例按 [taptap-suite](taptap-suite/MANUAL.md) 的映射表转成 call_tool 调用。

**CRITICAL — 创建即启用：`create-whats-new` 成功就是 online，不是离线草稿。** 用户只要求准备方案时停在预览；执行前确认授权覆盖上线。已有离线条目重新上线用 `update-whats-new-status`，不要为了“先存着”重复创建。

**CRITICAL — `type` 与 `label_type` 创建后不可修改。** 公告类/活动类、公告/反馈/活动/征稿必须在创建前确认；用户要换标签时说明只能新建条目，不能删除重建来绕开限制。

**CRITICAL — 系统同步内容不能手动创建。** 签到、礼包、新版本、抽奖（`label_type=check_in|gift|new_version|lottery`）先在来源模块配置并等待系统收录，本域只做服务端允许的排期、置顶和上下线调整；未收录时交回来源模块，不伪装成普通活动新建。

**CRITICAL — 置顶集合是整份替换，不是增量。** 编辑时先回读现有 `top_types`，用户只改排期就原样保留；空数组只用于用户明确要求取消全部置顶。置顶位：游戏详情页最多 2 个、PC 库最多 3 个，以 `get-whats-new-overview` 回读为准。

**CRITICAL — 配置在线 ≠ 客户端已展示。** 回读 `status=online`、`invalid=false` 只说明配置生效；需要展示证据时说明“配置已生效，展示待验证”，不编造预览或曝光结论。

## 快速决策

| 用户意图 | Reference | 起手调用 |
| --- | --- | --- |
| 查在线内容、曝光点击或详情 | [runbook](taptap-suite/references/taptap-whats-new/references/whats-new-runbook.md) 场景 A2、A4 | `call_tool(name:"whats-new list-whats-new", args:{developer_id:"<developerId>", app_id:"<appId>", data:{type:"announcement", status:"online", page:1, page_size:20}})` |
| 查容量与置顶位 | [runbook](taptap-suite/references/taptap-whats-new/references/whats-new-runbook.md) 场景 A1 | `call_tool(name:"whats-new get-whats-new-overview", args:{developer_id:"<developerId>", app_id:"<appId>"})` |
| 创建公告/活动展示条目 | [runbook](taptap-suite/references/taptap-whats-new/references/whats-new-runbook.md) 场景 A3 | `call_tool(name:"whats-new create-whats-new", args:{developer_id:"<developerId>", app_id:"<appId>", data:{url:"<站内链接>", type:"announcement", label_type:"announcement", start_time:1800000000, end_time:1800100000, top_types:[]}, dry_run:true})` |
| 上线已有条目 | [runbook](taptap-suite/references/taptap-whats-new/references/whats-new-runbook.md) 场景 A5 | `call_tool(name:"whats-new update-whats-new-status", args:{developer_id:"<developerId>", app_id:"<appId>", data:{content_id:"<contentId>", status:"online"}, dry_run:true})` |
| 改排期/置顶 | [runbook](taptap-suite/references/taptap-whats-new/references/whats-new-runbook.md) 场景 B | `call_tool(name:"whats-new update-whats-new", args:{developer_id:"<developerId>", app_id:"<appId>", data:{content_id:"<contentId>", type:"announcement", label_type:"announcement", start_time:1800000000, end_time:1800100000, top_types:["app_detail"]}, dry_run:true})` |
| 下线/失效巡检 | [runbook](taptap-suite/references/taptap-whats-new/references/whats-new-runbook.md) 场景 C | `call_tool(name:"whats-new check-whats-new-readiness", args:{developer_id:"<developerId>", app_id:"<appId>"})` |
| 按源链接查重 | [runbook](taptap-suite/references/taptap-whats-new/references/whats-new-runbook.md) 场景 A2 | `call_tool(name:"whats-new find-whats-new-by-url", args:{developer_id:"<developerId>", app_id:"<appId>", data:{url:"<站内链接>"}})` |

## 常用调用

```text
# 先看该域操作与参数
list_tools(category:"whats-new")

# 按分类和状态分页查看（省略 type/status 可跨分类；分页需要实际读取）
call_tool(name:"whats-new list-whats-new", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{type:"announcement", status:"offline", page:1, page_size:20}})

# 按源链接查重（签到/礼包/新版本会带 label_type）
call_tool(name:"whats-new find-whats-new-by-url", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{url:"https://www.taptap.cn/moment/123"}})

# 读条目详情
call_tool(name:"whats-new get-whats-new", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{content_id:"<contentId>"}})

# 创建（先预览，确认后用相同参数加 yes:true；创建即上线）
call_tool(name:"whats-new create-whats-new", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{url:"<站内链接>", type:"announcement", label_type:"announcement",
        start_time:0, end_time:1800100000, top_types:["app_detail"]},
  idempotency_key:"<stable-key>", dry_run:true})

# 改排期/置顶（整份替换 top_types；只改用户要求的字段）
call_tool(name:"whats-new update-whats-new", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{content_id:"<contentId>", type:"announcement", label_type:"announcement",
        start_time:0, end_time:1800100000, top_types:["app_detail", "pc_inventory"]},
  idempotency_key:"<stable-key>", dry_run:true})

# 上下线
call_tool(name:"whats-new update-whats-new-status", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{content_id:"<contentId>", status:"offline"},
  idempotency_key:"<stable-key>", dry_run:true})
```

## 执行规则

- 先定位源内容，再查重：有 `content_id` 直接回读；否则用 `find-whats-new-by-url` 按源链接查重。完整查询无匹配才新建；多候选让用户选择；分页不完整时停止创建，不能以“没找到”作为不存在。
- 创建前确认用途、标签、起止时间和置顶选择。置顶未明确时给出“不置顶／游戏详情页置顶／PC 库置顶／两处都置顶”四个中文选项，不把未提及当作不置顶。
- 创建/重新上线/新增置顶前读 `get-whats-new-overview` 检查容量；已在线条目只改排期不新增占用，不因满额要求下线其他内容。容量或置顶位满时展示实际占用，由用户选择替换对象，不自动下线或取消置顶。
- 定时用秒级时间戳，由 Agent 把用户给的自然语言时间转换；0/0 重新上线可能被平台改成当前时间起 30 天，需要确定排期时显式传时间并回读，不承诺永久展示。
- 写操作先 `dry_run: true` 预览，用户确认后用相同参数加 `yes: true`；同一意图复用 `idempotency_key`。写入失败或结果未知时停在当前步骤，先回读核实，不自动重建、换 key 或重复上线。
- 回读 `title`、`url`、`source`、`status`、`start_time`/`end_time`、`invalid`/`invalid_reason`、`top_types`、`sort`。改变在线占用或置顶后重新读总览；纯排期编辑不重复核对未变化的容量。
- `stat_updated_at=0` 或统计时间戳为 0 表示本次没取到统计，不当作零曝光；`invalid=true` 先解决内容本身问题（帖子被删、活动缺图等）再上线。
- 用户明确要求串联签到、公告和推送时，先读 [跨域流程](taptap-suite/references/interactive-operations-flow.md)；单域操作不自动加载或执行其他域。

## 面向用户的回复

- 每轮只说当前步骤、已确认内容、缺项或冲突及下一步；日期用具体日期/时间和必要时区，容量写成“已用 2 个，上限 2 个”，不粘贴 JSON。
- 游戏或公告有多个候选时，用业务名称与必要的厂商/平台信息让用户选择，不混排内部 ID。
- 容量不足时展示实际占用与替换影响；内容无效时先说明要修复的内容，不先铺开上线调用。
- 配置在线与客户端已展示分开说；示例（仅在已回读时）：“公告已配置上线，展示时间为……；还需确认玩家是否已能看到。”不把“已创建、尚未上线”说成发布完成。

## References

| Reference | 什么时候读 | 读取方式 |
| --- | --- | --- |
| whats-new runbook | 查重与创建、容量与置顶、编辑、下线与失效巡检、字段与枚举 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-whats-new/references/whats-new-runbook.md"})` |
| 跨域运营流程 | 用户明确要求串联签到、公告和推送 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/interactive-operations-flow.md"})` |

## 不在本手册范围

- 签到奖励、集卡、兑换码和提审：转 `taptap-game-sign`。
- 面向关注用户的站内推送：转 `taptap-official-message-push`。
- 论坛发帖、回帖：转 `taptap-community-management`。
- 创建源内容（帖子、视频、签到活动）：先在来源模块完成，再回到本域配置展示。
