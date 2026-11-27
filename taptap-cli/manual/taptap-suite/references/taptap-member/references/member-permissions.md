# 厂商成员与权限操作指南

只读当前任务对应章节。服务命令的输入输出用 `call_tool(name:"schema", args:{_positional:["member","<method>"]})` 核对,快捷命令用 `args._help: true` 查看完整帮助。当前服务未提供所需方法时,说明具体哪项操作暂不可用。

## 信息确认与分步提问

沿用用户已经给出的信息。下表中的问法只用于补齐缺项。

| 用户的说法 | 先做什么 | 还需要确认时可以这样问 |
| --- | --- | --- |
| “添加用户” | 确认目标厂商和对方的 TapTap 账号 ID | “只添加为普通成员,还是也要分配厂商或某款游戏的权限?要加备注名吗?” |
| “添加角色” | 意图不明确时,问“想创建新角色,还是把已有角色分配给成员?” | 确认要新建后,问“角色名称和描述怎么写?描述可以简单说说谁会用、负责什么。要建厂商角色还是游戏角色,需要哪些权限?” |
| “想调整成员权限” | 沿用刚才提到的成员。对象不明确时,按昵称或 TapTap 账号查找并核对 | “想给这位成员增加或收回哪些权限?”如果用户只说“查看数据”,再问“需要查看所有游戏的数据,还是只看某款游戏?” |
| 只给了昵称 | 有整厂名册读取权限时按昵称查成员。游戏管理员可用自己管理的游戏和成员的 TapTap 账号查询已分配的角色 | 有重名时展示候选和必要的账号标识。缺少可核实的身份时,请对方提供 TapTap 账号 ID |
| “他能传包吗?” | 已指定游戏时分别查 Android、Windows。上下文已指明平台时只查对应平台 | 游戏有多个候选且会改变答案时,请用户选择游戏 |
| “把这个人的权限收回来” | 读取已知范围和角色,沿用用户已说明的目标 | 仅缺范围时问“是收回他在这款游戏的角色,还是将他移出整个厂商?” |
| “查上次是谁改的” | 用已知厂商、目标账号和时间范围查操作日志 | 有多次变更且不能定位时,列出时间和动作供选择 |

`user_id` 指 TapTap 账号。`member_id` 标识该账号在这个厂商的一次成员关系。重新加入后可能取得新的成员 ID。已知两个 ID 时一起传入。服务端按厂商和账号直接查询,并核对这次成员关系。只有成员关系 ID 时也可以查询。

## 导出厂商名册

厂商主管理员或具备厂商管理权限的平台管理员可导出。默认 JSON 和 CSV 使用同一份成员和授权明细。JSON 按成员归组,CSV 按每项授权展开一行。

```text
call_tool(name:"member +export", args:{developer_id:"<developerId>", output:"<jsonFile>"})
call_tool(name:"member +export", args:{developer_id:"<developerId>", format:"csv", output:"<csvFile>"})
```

- 文件顶层的 `total_members` 是核对分页后的总人数。直接打印到终端时,同样的名册位于 `data` 中。
- 要查当时谁操作过,用 `member list-changes` 核对目标账号、时间和角色。游戏角色记录中的 `app_id` 标明当时操作的游戏。旧记录缺少编号时,只说明当时设置了哪些角色。
- 脚本需要成员编号、角色编号、原始权限标识或快照时,使用 `+export` 加 `format:"json"` 和 `detailed:true`。成员在 `data.members`,游戏编号和名称在 `data.app_ids` 和 `data.app_titles`,每项授权的游戏编号在 `game_grants[].app_ids`。读取数字编号时保留 64 位整数精度。
- CSV 有八列。成员昵称、备注名和 TapTap 账号分列。备注名由当前厂商填写。“游戏名称”和“游戏 ID”分列,JSON 也使用这两个字段。全厂游戏授权只显示“全部游戏(N 款)”,仅涉及厂商或同时涉及厂商与游戏的角色显示“厂商”。这两类授权在 CSV 的游戏 ID 列留空,在 JSON 中省略游戏 ID。按 TapTap 账号筛选可查看一名成员的全部授权,按账号去重可核对总人数。
- 用 Excel 打开含长账号的 CSV 时,从“数据 → 从文本/CSV”导入,在“转换数据”中将“TapTap 账号”列设为“文本”后再加载。若 Excel 已将超过 15 位的账号末位显示为零,按此方式重新导入原文件。
- 超级管理员只占一行。普通成员按已分配的游戏和角色逐行列出。每个厂商角色占一行,“权限内容”列出该角色的全部权限。如果整个角色适用于全部游戏,“游戏名称”标明游戏总数。若角色同时包含厂商权限和全游戏权限,只在适用于全部游戏的权限名旁标注“全部游戏”。仅有成员身份时保留一行“未配置游戏角色”。
- 具体游戏的授权按游戏及角色列出。“全部游戏”行的权限看“权限内容”,例如全厂只读。要核对超级管理员额外获授的角色或所有可管理的游戏编号,使用 `detailed:true`。角色名旁的“已失效”表示该角色仍有历史分配记录。核对资料、传包和提审能力时用 `member check-access`。
- 需要脚本核对文件时,在 `output` 后指定路径并加 `json:true`,从标准输出的 `data.path`、`data.total_members` 和 `data.snapshot_id` 读取文件路径、人数和快照。省略 `format` 时,.csv 文件会按 CSV 写入,.json 文件按 JSON 写入。
- 详细 JSON 的 `roster_sampled_from/until` 记录厂商成员、角色和游戏归属的读取时间范围,成员的 `platform_sampled_from/until` 记录平台权限读取范围。权限按页读取,导出期间不同成员可能在不同时间取值。分页提示名册已变化时,从首页重新导出。查看一页成员用 `call_tool(name:"member list", args:{developer_id:"<developerId>", page_size:"<size>"})`;需要完整名册用 `member +export`。`page_size` 可指定每页 1 至 100 人,响应过大时自动减小。
- 新建或刚转入厂商的游戏可能暂未出现在名册中。发现成员已有角色的游戏仍属该厂商、但游戏清单尚未收录时,导出提示稍后重试。已知游戏 ID 时,用 `member check-access` 直接核对当前归属与该成员的具体操作权限。
- 厂商角色名旁显示“待核实”时,可用 `detailed:true` 核对角色编号。该角色是否仍然有效尚未确认,核对具体操作可用 `member check-access`。
- 任一页读取失败,整次导出都会失败。例如,历史角色可能导致某位成员的详情无法读取。使用 `output` 时会保留已有文件,只有命令成功写出的完整文件才能作为本次结果。

### 名册的中文说明

| 导出中的信息 | 给用户的说法 |
| --- | --- |
| `membership` | 加入厂商后可以按已知游戏编号查看基础资料。后台游戏列表按账号权限筛选;仅有成员身份时写“未配置游戏角色”。 |
| `admin`、`platform_admin`、`developer_management` | `admin` 是网页上显示的“超级管理员”。`platform_admin` 来源的 `developer_management` 授权写“平台授予的全厂管理权限”。详细 JSON 保留两种授权来源。名称为“厂商管理员”的角色按角色名展示。 |
| `platform_readonly`、`developer_readonly` | 写“平台授予的全厂只读权限”。 |
| 可管理游戏与 `app_role` | 可管理游戏按本次名册中的编号计数。`app_role` 按游戏和角色名说明实际分配,例如“可管理全部游戏,其中 2 款单独授予游戏管理员角色”。同一游戏有多个角色时,游戏只计一次。 |
| `inactive_app_roles` | 写“《示例游戏》里仍有这个角色的记录,目前这个角色没有授予有效权限”。能查到名称时,用实际的游戏名和角色名。 |
| `permission_keys`、全厂授权的 `permission_label` | 分别说明“这个角色允许做什么”和“哪些操作适用于厂商旗下全部游戏”。 |

介绍角色时,使用查询结果里的中文权限名称,再说明具体操作。例如,角色包含“更新游戏”时,可以解释这项权限涉及通过 CLI 修改游戏资料、上传安卓包和提交资料审核。缺少中文名称时写“暂无中文名称”。用户明确要求对账时再附权限标识。

常见厂商权限包括创建游戏(`add_app`)、修改厂商资料(`update_profile`)、财务结算(`settlement`)、查询退款(`payments_manage_refund`)、游戏服务账户(`tds_account`)。覆盖全部游戏的四项常见权限为查看统计数据(`global_show_stats`)、TapDB 数据分析(`global_tapdb`)、应用配置(`global_open_platform`)、查看应用密钥(`global_open_view_secret`)。这些标识供执行时对照。日常回复用中文说明权限,只在用户要求对照导出列或调试时附原值。遇到含义未核实的权限,向用户说明仍待确认。

## 核对单游戏权限

已核实厂商、成员和游戏后,按具体动作查询。查询完整名册或某个成员在指定游戏上能做什么,需要厂商主管理员或具备厂商管理权限的平台管理员。

```text
call_tool(name:"member check-access", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{member_id:"<memberId>", user_id:"<userId>", action:"upload_windows"}})
```

| 要确认的能力 | `action` | 如何解读 |
| --- | --- | --- |
| 编辑游戏资料 | `edit_profile` | 通过 CLI 修改资料看 `cli_decision`。用户明确问网页草稿时,才用 `web_draft_decision` 回答能否保存草稿 |
| 上传 Android 包 | `upload_android` | 只回答这款游戏的 Android 包体上传权限 |
| 上传 Windows 包 | `upload_windows` | 单独核对 Windows,不能从 Android 的结果推得 |
| 提交游戏资料审核 | `submit_review` | 核对该成员在这款游戏上的资料提审权限(`apply_update`)。实际提交时还会校验厂商限制、游戏及资料状态 |

成功响应中 `decision` 与 `cli_decision` 一致。`allowed` 表示该成员具备所查操作的权限,`denied` 表示缺少该权限。查询被拒、游戏归属不符或上游失败时,保留“未能核实”的结论。

用户说“只给发包”时,先区分上传安装包和向玩家发布游戏,上传还要区分安卓与 Windows。安卓上传、通过 CLI 修改游戏资料、提交资料审核共用 `apply_update`。Windows 上传使用 `pc_launcher_game`,可以与资料编辑分开,但这项权限也用于管理 Windows 安装包。查到“允许上传”只说明能上传。用户同时要求禁止发布时,再核实对应的发布操作。例如,通过 CLI 让到期的定时版本立即上线也需要 `apply_update`。

成员命令按整组角色分配。先用 `member list-roles` 看该厂商在这款游戏可分配的角色,再核对成员已有的其他授权。缺少合适角色时,厂商主管理员或具备厂商管理权限的平台管理员可以[创建自定义角色](#创建自定义角色)。若最小可选权限项仍包含用户明确排除的操作,说明这些操作共用哪一项权限,并保留现有分配。

## 成员写入的幂等键

每次添加成员、移除成员、修改备注名或调整角色,都为这次变更生成独立的 `idempotency_key`。预览和正式提交同一次变更时,使用相同的请求键。账号被移出后重新添加,即使参数相同,也是新变更。显式指定新键可避免 CLI 按相同参数派生出相同的键。成功回执中 `data.result.replayed=true` 表示取回首次执行的结果。报告当前状态前,再查一次成员关系或角色分配。

遇到 `ambiguous_outcome`,先核实厂商、目标账号和成员关系。添加或移除按账号查成员关系,角色变更用 `member get-role-assignment` 查同一成员和范围。已达到目标就报告回读结果并结束。移除结果仍不确定时停止重发。其他情况按错误回执的 `replay_policy` 和 `hint` 决定是否可以再次提交。

| CLI 回执与回读结果 | 下一步 |
| --- | --- |
| `same_key_after_readback`,回读已确认原变更未生效且仍需执行 | 保留原参数和原键重试同一请求。若原参数已过期,重新读取并预览。 |
| `forbidden`,提示原键会持续返回未知结果并明确允许用新键,且回读已确认原变更未生效 | 结束原请求。原授权仍适用时,用新键发起新变更。改角色先重新预览当前分配和版本。 |
| 回执禁止重放且未给出新键指引,或回读失败、成员身份变化、无法确认原变更是否生效 | 停止重发。说明已经查到的状态和仍待确认的部分,保留原回执供核对。 |

收到 429 时按服务端提示等待。此前提交过写入的,先回读前一次的结果。仅凭 429、超时或审计空页均无法判定上一笔写入失败。

## 添加成员

用户说“邀请成员”或“添加成员”时,都用 `member add`。厂商主管理员或本厂商的游戏管理员可以把现有 TapTap 账号直接添加为普通成员。先核对目标厂商和对方的 TapTap 账号 ID。

用户选择普通成员、备注留空时,只需添加。用户给了备注或授权要求时,确认账号已在册后,再分别[设置备注名](#修改备注名)和[调整角色](#调整角色)。如果提示“该 TapTap 账号已是此厂商的成员”,告知用户并只处理明确要求的后续变更。备注留空时保留已有备注。用户要求设为超级管理员时,说明这项身份变更需在开发者中心的成员管理中办理。

**预览添加请求**。`dry_run: true` 显示准备把哪个账号添加到哪个厂商,不会把账号加入名册。用户只要预览时到此结束。

```text
call_tool(name:"member add", args:{
  developer_id:"<developerId>", data:{user_id:"<userId>"},
  idempotency_key:"<addKey>", dry_run:true})
```

**执行添加**。用户已同意将该账号加入厂商时,单独运行下面的调用。`yes: true` 表示确认添加,CLI 会向服务端提交这笔请求。

```text
call_tool(name:"member add", args:{
  developer_id:"<developerId>", data:{user_id:"<userId>"},
  idempotency_key:"<addKey>", yes:true})
```

首次成功回执中的 `developer_id`、`user_id`、`member_id` 标识这次建立的成员关系。有名册读取权限时,用返回的成员关系 ID 和账号核对名册。用户还要求给某款游戏授权时,使用这条关系继续[调整角色](#调整角色)。如果“权限内容”有“全厂管理”,用详细 JSON 的 `game_grants` 核对这项权限是否由平台授予。成员接口只能调整厂商授予的角色;确认“只能操作某款游戏”时,也要核对其他游戏的实际权限。

添加后回执中断,先按目标账号查是否已在册。已经加入时沿用查到的成员关系。仍需处理时按[成员写入的幂等键](#成员写入的幂等键)判断。

## 修改备注名

核对厂商、目标成员的 TapTap 账号和新备注。备注最多 20 个字符。用户明确要清空时,在 `alias` 中传空字符串。

```text
call_tool(name:"member set-alias", args:{
  developer_id:"<developerId>", data:{user_id:"<userId>", alias:"<alias>"},
  idempotency_key:"<changeKey>", dry_run:true})
```

`dry_run: true` 预览目标账号与新备注。用户已授权且内容核对一致后,使用相同的参数和请求键,以 `yes: true` 执行。首次成功回执给出写入后读到的备注名,清空后为 `""`。如返回历史回执或结果不确定,有名册读取权限时,用 `member +export` 导出名册,按目标账号核对当前备注。

## 创建自定义角色

角色名称最多 50 个字符,角色描述最多 200 个字符。创建时把用户给出的描述原样填入 `description`。用户明确要留空时可省略该字段。

创建前用 `member list-role-permissions` 查当前厂商可选的权限,将用户想做的事对应到中文权限名称。厂商角色看 `developer_permissions`,游戏角色看 `app_permissions`。例如,用户只想创建游戏时,可单选厂商权限“创建游戏”(`add_app`)。

用户问“有哪些角色和权限”时,同时用 `member list-roles` 查可分配的角色。列厂商角色时只指定厂商,列游戏角色时再指定游戏,并写出游戏名称。将已有角色和新建时可选的权限分别展示。权限按用途列出中文名称,标明哪些对全部游戏生效。例如,只看一款游戏的数据可以选游戏权限“查看数据”,看旗下所有游戏的数据可以选厂商权限“所有游戏均可「查看数据」”。

```text
call_tool(name:"member list-role-permissions", args:{developer_id:"<developerId>"})
```

**预演创建**。下例是游戏角色。创建厂商角色时将 `role_type` 填为 `developer`。用户只要预览时,说明角色名称及其权限后结束。

```text
call_tool(name:"member create-role", args:{
  developer_id:"<developerId>",
  data:{role_name:"<roleName>", description:"<roleDescription>", role_type:"app", permission_keys:["<permissionKey>"]},
  idempotency_key:"<createKey>", dry_run:true})
```

**执行创建**。用户已授权创建该角色且权限组合一致时,用同一请求和请求键提交。

```text
call_tool(name:"member create-role", args:{
  developer_id:"<developerId>",
  data:{role_name:"<roleName>", description:"<roleDescription>", role_type:"app", permission_keys:["<permissionKey>"]},
  idempotency_key:"<createKey>", yes:true})
```

CLI 支持创建自定义角色和调整成员的角色分配。更改已有角色的名称或权限项需到开发者中心的“角色配置”。预设角色只能查看;有角色管理权限时可编辑自定义角色,已创建角色的类型固定。

成功回执中的 `data.result.role.role_id` 是新角色编号。用户还要求把它授予成员时,按[调整角色](#调整角色)预览和分配。结果不确定时,厂商角色在该厂商用 `member list-roles` 回查,游戏角色在计划分配的游戏用带 `app_id` 的 `member list-roles` 回查,核对名称、类型和完整权限项。如果当前账号只能看到部分角色,说明这次未能确认是否创建成功,停止重发。需要核实时,请该厂商有角色管理权限的管理员确认角色名称及权限。

## 调整角色

先按用户想增加或收回的操作核对现有权限。已指定游戏时直接查询该游戏。若成员的厂商角色已覆盖要增加的权限,可以说“她的‘全局数据分析’角色已允许查看所有游戏的数据,无需再给这款游戏单独授权”。其他权限逐项核对。若要收回单款游戏的权限而该权限来自厂商角色,说明移除游戏角色后仍会保留这项权限。变更厂商角色会影响其他游戏,需另行确认。

游戏管理员已知成员的 TapTap 账号时,用自己管理的游戏查询,核对回执的账号和 `member_id`。已有成员关系 ID 时可单独用 `member_id` 查询。两个 ID 都已核实时,后续查询、预览和写入沿用同一对 ID。成员退出后重新加入时,请核实新的成员关系。

```text
call_tool(name:"member get-role-assignment", args:{
  developer_id:"<developerId>", app_id:"<appId>", data:{user_id:"<userId>"}})
```

`member list-roles` 返回当前操作者可分配的角色,`member get-role-assignment` 返回目标成员已有的分配和版本。加减单个角色时,从现有分配计算最终集合,保留用户没要求移除的角色以及操作者无权调整的既有角色。只有定义完整且在该成员的 `assignable_roles` 中列出的角色可以新增。

分配和预览按现有成员接口返回的角色生成。`assignment_visibility=region_filtered` 表示该地区隐藏了部分角色。完整替换或清空可能移除未展示的分配。如果用户只授权增减一个角色,先说明无法确认其余隐藏角色会保留;只有用户明确授权整个范围的最终角色集合时才写入。最终列表里的每个角色都须可分配。如果历史角色无法保留,告诉用户哪项角色会受影响,取得针对该角色的明确授权后再调整。

国内官方账号的厂商角色分配返回 `clear_only=true` 时,只允许清空全部既有厂商角色。用户已授权清空时用 `clear:true` 预览,其他调整说明限制并保留现状。

授予内置“厂商管理员”时,账号可能已达到可管理厂商数量上限。遇到这个提示,向用户说明本次角色未授予。自定义角色中的“创建游戏”是单项权限,授予角色的回执只确认权限分配,创建游戏时还要满足该操作的条件。

```text
call_tool(name:"member list-roles", args:{developer_id:"<developerId>", app_id:"<appId>"})
call_tool(name:"member get-role-assignment", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{member_id:"<memberId>", user_id:"<userId>"}})
call_tool(name:"member +preview-roles", args:{
  developer_id:"<developerId>", member_id:"<memberId>", user_id:"<userId>",
  app_id:"<appId>", role_ids:"<roleIds>"})
```

只需浏览可分配的角色时,给 `member list-roles` 加 `summary:true`,查看角色名和所含权限数。给 `member +preview-roles` 加 `summary:true` 可简要列出新增、移除和保留的角色,回执仍包含写入版本和最终角色列表。要解释某项操作是否开放时,读取完整权限或使用 `member check-access`。

核对 `data.added`、`data.removed`、`data.kept`,结合角色展示名和各角色的 `permission_keys` 说明增加、收回和仍由其他角色授予的能力。例如 `apply_update` 涉及 CLI 改资料、上传 Android 包和提交资料审核,`pc_launcher_game` 涉及 Windows 包。同一角色还包含其他权限点时一起说明。用户只想看哪些角色会变,到这里就可以回答。

**预演写入请求**。需要检查提交参数时,将下例中的 `<roleRequestJson>` 替换为刚才预览结果中 `data.data` 对象的完整 JSON。原样保留账号、成员和角色编号、角色列表以及版本。清空时角色列表为 `[]`。

```text
call_tool(name:"member set-app-roles", args:{
  developer_id:"<developerId>", app_id:"<appId>", data:<roleRequestJson>,
  idempotency_key:"<roleUpdateKey>", dry_run:true})
```

**执行角色变更**。用户已授权这次调整且预览的角色与授权一致时,提交同一份 JSON 和请求键。

```text
call_tool(name:"member set-app-roles", args:{
  developer_id:"<developerId>", app_id:"<appId>", data:<roleRequestJson>,
  idempotency_key:"<roleUpdateKey>", yes:true})
```

提交成功后,回读同一成员在这款游戏上的角色。

```text
call_tool(name:"member get-role-assignment", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{member_id:"<memberId>", user_id:"<userId>"}})
```

主管理员身份单独保存在 `is_admin`。只有用户要更改主管理员身份时,才说明这项操作需在开发者中心的成员管理中办理。厂商角色的读取和预览省略 `app_id`,写入使用 `member set-developer-roles`。用户明确要求清空指定范围的角色时,预览传 `clear:true`。最终分配与预览一致才报告已改好。用户目标是能上传或不能再提审时,还要查询该成员在这款游戏上能否执行该操作,计入平台等其他来源授予的权限。

需要留存这次调整的是哪款游戏时,保存 `member set-app-roles` 成功回执中的 `data.result.app_id`。清空厂商角色后,按厂商范围回读同一成员,确认 `data.result.roles` 是空数组(`roles=[]`)。

```text
call_tool(name:"member get-role-assignment", args:{
  developer_id:"<developerId>", data:{member_id:"<memberId>", user_id:"<userId>"}})
```

如果其他管理员在预览后改过角色,重新查询并预览最新分配。提交后没有收到结果时,先查询同一成员在同一范围的角色。清空后若仍能查到原来的角色,告诉用户这次清空尚未确认。

## 移除成员

仅厂商主管理员可移除其他成员。核对厂商及目标账号,读取厂商级分配,其中包含逐游戏的分配。说明本厂商的成员关系和游戏授权将被收回。平台授予的权限由平台管理。

```text
call_tool(name:"member get-role-assignment", args:{
  developer_id:"<developerId>", data:{member_id:"<memberId>", user_id:"<userId>"}})
```

**预演移除**。将刚读到的厂商级 `version` 原样填入 `expected_version`。用户只要查看移除影响时,在预演后结束。只要求收回一款游戏的角色时,走[调整角色](#调整角色)。

```text
call_tool(name:"member remove", args:{
  developer_id:"<developerId>",
  data:{member_id:"<memberId>", user_id:"<userId>", expected_version:"<version>"},
  idempotency_key:"<removeKey>", dry_run:true})
```

**执行移除**。用户已授权移出厂商时,用同一请求和请求键提交。

```text
call_tool(name:"member remove", args:{
  developer_id:"<developerId>",
  data:{member_id:"<memberId>", user_id:"<userId>", expected_version:"<version>"},
  idempotency_key:"<removeKey>", yes:true})
```

用移除前的两个 ID 回读同一厂商分配,核实目标成员关系已不存在,并按目标账号查询此次变更。移除提示结果不确定时停止重发。重复移除遇到 429 时先回读此前的请求。若回读失败,说明当前状态仍待核实。

## 追溯变更

将名册的“TapTap 账号”(详细 JSON 中的 `user_id`)填入 `target_user_id`。只有成员关系 ID 时,先用 `member get-role-assignment` 查回目标账号。成员已经退出时,用当时的名册或写入回执核对账号。直接传 `member_id` 字段会报参数错误。把成员关系 ID 的数值误填进 `target_user_id` 会按该数值代表的账号查询,可能得到空页或查到其他账号。时间范围按日志入库时间筛选,使用带时区的起止值,含起点、排除终点。

| 审计信息 | JSON 字段 | 怎么读 |
| --- | --- | --- |
| 操作时间 | `event_time`、`logged_at` | 前者是操作发生的时间,后者是日志入库的时间。按时间筛选或排序用入库时间。 |
| 谁做的 | `operator_id`、`operator_nickname`、`operator_alias` | 依次是操作者的 TapTap 账号、昵称和本厂商为其填写的备注名。 |
| 改了谁 | `target_user_ids`、`target_nicknames`、`target_aliases` | 一次操作可涉及多人。三个列表按相同顺序排列,同一位置对应同一账号。 |
| 做了什么 | `action`、`action_label`、`is_admin` | `action` 是操作类型。清空角色时,`action_label` 会写明“清空厂商角色”或“清空游戏角色”。添加成员时,`is_admin` 表示是否以主管理员身份加入。 |
| 涉及哪些角色和游戏 | `role_type`、`role_names`、`app_id` | `developer` 表示厂商角色,`app` 表示游戏角色。设置角色时列出变更后的角色名称。游戏角色变更有游戏 ID 时一并展示。 |

昵称和厂商备注名取查询时的值,重名时按 TapTap 账号核对。一个事件有多个目标成员时,JSON 用 `null` 保留缺少昵称或备注名的位置。如果所有目标都查不到昵称,就省略昵称列表。备注名同理。

```text
call_tool(name:"member list-changes", args:{
  developer_id:"<developerId>", format:"pretty",
  data:{target_user_id:"<userId>", from:"<from>", until:"<until>"}})
```

导出全部匹配记录时用 `call_tool(name:"member +export-changes", args:{developer_id:"<developerId>", output:"./changes.csv"})`。文件也支持 `.json`,可用 `from`、`until`、`operator_id` 和 `target_user_id` 筛选。命令自动翻页,同一次导出复用当前昵称。

用 `member list-changes` 手动翻页时,保持原筛选条件,并将 `next_cursor` 作为 `cursor` 继续查询。即使当前页为空,只要有下一页游标就继续。查完所有页仍无匹配项时,只回复“未查到记录”。有记录时,按日志记载的时间、操作者、目标账号及角色名称回答。写入返回 503 或超时时,先回读成员关系或角色分配确认是否生效。创建自定义角色只建立可供分配的角色,此次创建不会出现在成员变更记录里。给成员授予该角色后,可按目标账号查询这次分配。批量移除可能关联多个账号。

历史日志缺少清空记录时,可按[调整角色](#调整角色)查成员当前的角色。仅凭当前角色或写入回执无法还原缺失的审计记录。

审计 CSV 按北京时间显示操作时间,操作者和目标成员的账号、昵称、备注名分列。缺失值留空,批量操作保留所有目标成员。用户需要对账或排障时,可从 JSON 中核对日志编号(`log_id`)、厂商编号(`developer_id`)和入库时间。
