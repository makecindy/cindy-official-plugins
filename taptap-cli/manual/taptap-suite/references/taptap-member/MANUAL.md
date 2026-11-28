# TapTap CLI 插件:厂商成员与权限(member)

member 管理厂商成员、成员备注名、厂商与游戏角色，以及权限变更记录。同一个人可以加入多个厂商，在每款游戏上的角色也可以不同。处理“他能做什么”先定位厂商、成员、游戏和动作;处理“收回权限”还要区分收回某个角色和移出整个厂商。开始前先读 [shared execution](taptap-suite/references/shared-execution.md)(身份、JSON 输出外壳、错误处理和写门禁)。命令行示例按 [taptap-suite](taptap-suite/MANUAL.md) 的映射表转成 `call_tool` 调用。

**CRITICAL — 厂商主管理员身份与普通成员权限分开判断。** 添加、移除成员、修改备注名和调整角色都受厂商或游戏管理员权限约束;超级管理员身份变更只能到开发者中心办理,CLI 不代办。

**CRITICAL — 写入前先读现状。** 改角色先读同一成员、同一范围的当前分配和版本;移除成员先读厂商级分配。每次新变更使用独立的 `idempotency_key`,预览、执行和允许的同键重试复用原值。结果不确定时先回读,不要换键重放。

**CRITICAL — 名册里的昵称、厂商备注名和 TapTap 账号分列。** 备注名由当前厂商填写,和 TapTap 昵称不是同一字段;重名时按 TapTap 账号核对。

## 快速决策

| 用户想做什么 | 起手动作 | 执行前读取 |
| --- | --- | --- |
| 导出某厂商的成员和游戏权限 | 用 `member +export` 按用户需要导出 JSON 或 CSV。两种格式包含相同的成员和授权。脚本需要角色编号或权限标识时使用详细 JSON | [导出厂商名册](taptap-suite/references/taptap-member/references/member-permissions.md#导出厂商名册) |
| 确认某人能否改资料、传包或提审 | 用 `member check-access` 查询该成员在指定游戏上的具体动作 | [核对单游戏权限](taptap-suite/references/taptap-member/references/member-permissions.md#核对单游戏权限) |
| 添加厂商成员 | 核对 TapTap 账号,确认是否需要备注名,以及是否还要分配厂商或游戏权限 | [添加成员](taptap-suite/references/taptap-member/references/member-permissions.md#添加成员) |
| 修改成员备注名 | 核对厂商和 TapTap 账号,用 `member set-alias` 设置或清空备注 | [修改备注名](taptap-suite/references/taptap-member/references/member-permissions.md#修改备注名) |
| 添加角色 | 确认是创建新角色还是给成员分配已有角色。新建时一起确认角色名称、角色描述、角色类型和具体权限 | [创建自定义角色](taptap-suite/references/taptap-member/references/member-permissions.md#创建自定义角色) · [调整角色](taptap-suite/references/taptap-member/references/member-permissions.md#调整角色) |
| 编辑成员权限 | 问清要增加或收回什么、适用于哪里。核对已有权限,再预览需要调整的角色 | [调整角色](taptap-suite/references/taptap-member/references/member-permissions.md#调整角色) |
| 将成员移出厂商 | 查看厂商级及逐游戏分配,说明移除后将收回哪些角色 | [移除成员](taptap-suite/references/taptap-member/references/member-permissions.md#移除成员) |
| 查谁在何时改了哪项权限 | 用 `member list-changes` 按目标账号、操作者或日志时间筛选。导出完整记录用 `member +export-changes` | [追溯变更](taptap-suite/references/taptap-member/references/member-permissions.md#追溯变更) |

## 变更的执行顺序

1. **读取现状。** 用户只说“加权限”时,问清谁要做什么,作用于厂商还是哪款游戏。目标权限已覆盖全部游戏时,说明具体权限,无需逐款分配。新增游戏角色要保留原有角色。收回权限前核对实际授权及来源。若角色还会开放其他操作,说明后请用户确认。
2. **预览和执行。** `dry_run: true` 只预览请求。用户只要预览时,到此结束。已获授权且预览一致时,单独用 `yes: true` 提交。`region_filtered` 表示可能收回当前地区未显示的角色。遇到并发变更,重新预览并核对差异。
3. **区分新变更和重试。** 每次新变更使用独立的请求键。结果不确定时先回读。允许同键重试时保留原参数和原键。只有 CLI 明确提示可用新键,且回读已确认原变更未生效时,才发起新请求。移除结果不确定或回读无法判断时停止重发。具体判定见[成员写入的幂等键](taptap-suite/references/taptap-member/references/member-permissions.md#成员写入的幂等键)。
4. **确认变更结果。** 改角色后查同一成员、同一范围的最终分配;用户要解决某项操作权限时,再核对该动作。移除后查成员关系和对应变更。添加后以回执中的账号和成员关系 ID 核对结果。

## 面向用户的回复

用户问具体操作时,只回答所问的成员、游戏和操作。需要列权限时,用查询结果里的中文名称说明能做什么。用户要看名册就给中文表格,要文件就按指定格式交付。成员昵称、厂商填写的备注名和 TapTap 账号分列。超级管理员汇总一行。普通成员列出实际分配的游戏和角色,同一游戏有多个角色时逐项列出,失效角色标明状态。[名册的中文说明](taptap-suite/references/taptap-member/references/member-permissions.md#名册的中文说明)

- **查询成员权限**。用户问“小李能上传《示例游戏》的 Windows 安装包吗?”时,按查询结果回答“小李可以上传”或“小李目前没有上传权限”。如果查询账号无权查看或服务暂时不可用,说明原因,并告诉用户“这次没能确认小李是否可以上传”。
- **只授予一项权限**。如果还会授予其他操作,说清楚哪些操作会一并开放。例如“上传安卓安装包、修改游戏资料和提交资料审核共用一项权限,无法只开放安卓上传”。[核对单游戏权限](taptap-suite/references/taptap-member/references/member-permissions.md#核对单游戏权限)
- **预览或调整角色**。只看角色变化时用 `+preview-roles --summary`,列出新增、收回和保留的角色名。查询有哪些角色时用 `list-roles --summary`。预览可以说“小李在《示例游戏》中将保留测试角色,新增发行角色”。执行并确认后再说“已新增”或“已收回”。用户关心收回角色后能否传包时,查询该成员的上传权限后再回答。
- **添加或移除成员**。说清谁加入了哪个厂商,或从哪个厂商移出。移除后仍有平台直接授予的权限时,说明具体保留了什么。用户要求“只能操作某款游戏”时,还要核对其他游戏上的权限。
- **查询变更记录**。写清谁在什么时候改了谁的什么权限。用户要审计表时,用中文列出时间、操作者、目标成员和变更内容,操作者和目标成员的备注名取自当前厂商名册,默认省略日志编号。清空角色时写“清空厂商角色”或“清空游戏角色”。日志里有游戏 ID 时一并列出。清空厂商角色后,再查该成员的厂商角色是否为空。查完所有页仍无匹配项时,只回复“未查到记录”。[追溯变更](taptap-suite/references/taptap-member/references/member-permissions.md#追溯变更)

用户需要复现或排障时,再给出相应的调用、参数和错误信息。[共享用语规范](taptap-suite/references/shared-execution.md#面向用户的用语)
