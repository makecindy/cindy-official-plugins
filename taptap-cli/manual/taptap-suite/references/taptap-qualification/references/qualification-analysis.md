# Qualification analysis

## 读取与能力判断

先通过 identity 手册确认开发者和游戏，再读取命令 schema，调用 `qualification get-assessment`。结合 `app analyze-app-status` 查看资料问题，用 `app list-packages` 核对包体绑定。目标版本处于审核中或待发布时仍应分析该版本，不能因为它不可编辑而改查其他版本。

`assessment` 的解释：

| 字段 | 用法 |
| --- | --- |
| read_state | complete / partial；partial 保留成功域，失败域的状态为空并附 read_error，不变成 pending_upload |
| material_summary | 非敏感材料读回：适龄值、版号/软著、AI 分包证明、隐私模式/链接；编辑前复核，不回显主体证件/联系人 |
| requirements | 完整清单；required / optional / unknown / not_applicable，含 age_grade |
| declared_app_features | 已保存的发布目标、运行形式和游戏情况。只使用实际返回的值，保留明确的 `false`，字段缺失时说明尚未确认。 |
| unknown_facts | 服务端列出的待确认事实。即使某项已从列表移除，也无法从列表推断它的布尔值。各项的含义见[资质判断依据](taptap-suite/references/taptap-app-edit/references/app-edit-execution-rules.md#5-资质编辑资料时收集判断事实)。 |
| package_types / declared_package_types / package_conflict | 展示分析依据与声明；仅按服务端 conflict 判定是否需要核对，声明内包体尚未全部绑定不算冲突 |
| target_source | unpublished 优先，再 published，再 declaration；可编辑性另判 |
| submission_eligibility | eligible / blocked / unknown，来自服务端提交判据，可包含豁免 |
| confirmation_guarantee | preflight_only_no_atomic_cas：仅检查执行前的变更，无法防止检查后其他操作者同时修改 |

逐项读取审核状态、是否已生效、是否已保存材料、办理渠道及提交/撤回阻塞项，向用户解释对应结果。驳回原因取自 `reason` / `field_reject_reasons`；提交后用 `submitted_fields` 核对审核范围，适龄也按此处理。材料已经生效与修改申请被驳回可以同时成立，是否允许继续操作应根据阻塞项和服务端校验判断，不能只允许 `uploaded` 状态。

当前资质是否满足要求，以 required 项的 `effective_approved` 为准：true 表示已有生效材料，false 表示尚未生效，null 或缺失表示无法确认。`status` 描述申请进度，不能覆盖生效结论。

例如，`effective_approved=true` 且 `status=reviewing` 时，说明当前资质有效、修改申请审核中；`status=rejected` 时，说明当前资质仍有效、修改申请被驳回，应展示驳回原因，不把当前资质列为缺口。首次提交且 `effective_approved=false` 时，即使已保存或正在审核，也仍待完成。read_state=partial/unknown、未知事实、冲突、读取失败或资格 unknown 必须单独展示；非必须空槽不列入缺口。资质齐全、可提审、已发布、分发开放分别确认。

## 缺口输出格式（给用户看）

`requirements[].subject` 是英文 key，输出时按下面映射成中文，并把「已保存待审核」与「需补材料」分开，不要笼统说“待完成”：

| subject | 中文名 | 需要的材料 / 下一步 |
| --- | --- | --- |
| `privacy-compliance` | 隐私合规 | 隐私政策链接或托管模式；小游戏域走专用命令 |
| `anti-addiction` | 防沉迷合规 | 防沉迷接入方式与对应材料 |
| `ai-declaration` | AI 接入声明 | 是否提供 AIGC、适用包体；不提供时也要声明 `package_types` |
| `age-grade` | 适龄分级 | 适龄等级及审核 |
| `game-license` | 游戏版号 | 版号批文与扫描件 |
| `icp-filing` | ICP 备案 | 备案号、主体信息与文件 |
| `software-copyright` | 软件著作权 | 登记号与证书 |
| `authorization-letters` | IP 授权书 | 授权书文件 |
| `security-assessment` | 安全评估 | 安全评估报告 |

输出建议（示例）：

- 已保存但未通过审核（`effective_approved=false`，`status` 为 uploaded / reviewing / rejected）：<中文名>，需要提交资质审核（或处理驳回原因）。
- 尚未保存材料（`status=pending_upload` 或 `has_saved_material=false`）：<中文名>，需要先准备 <材料>。
- 只列 required 或用户确认适用的项；optional 空槽单独说明，不混进“必须缺项”。

字段口径：`status` 是草稿/申请状态（已保存的草稿也是 uploaded），`effective_status` 是当前生效（已审核通过）状态；不要把 `status=uploaded` 说成“已生效”，也不要把 `effective_status=pending_upload` 说成“材料一定缺失”。

保存 AI 声明或资质材料后，重新查询 assessment，按该项的 `material_summary`、`has_saved_material` 和 `status` 说明已保存内容及审核进度。快照变化只表示两次查询的状态有差异。

## 包体联网检测

每次分析资质或编辑判断依据时，使用同次 `qualification get-assessment` 核对包体联网检测。先读当前环境的 schema 和实际返回的 `data.result.assessment.package_network_status`，再核对适用的包体和已保存的联网声明。有适用的联网检测而声明为否或尚未填写时，分别说明当前资质清单和包体检测结果，询问开发者是否要更新联网声明。

- `is_networked` 是汇总结果，`h5_networked` 和 `maker_networked` 分别是 H5 和 TapTap 制造的检测结果。任一项为 `true` 就有联网检测依据。按实际返回的来源向用户说明，例如“H5 包体检测到联网功能”。只有汇总项为 `true` 时报告“包体检测到联网功能”。检测结果不能定位具体文件、域名或登录功能。没有任何一项为 `true` 时，区分以下两种结果。无论哪种，填“否”都需要开发者确认游戏运行可完全离线。

  | 汇总 | H5 | TapTap 制造 | 告知开发者 |
  | --- | --- | --- | --- |
  | `false` | 例如 `false` | 例如 `null` | 包体未检测到联网功能。某类包体没有结果时，保留已有的明确汇总结论。 |
  | 缺失或 `null` | `false` 或未知 | `false` 或未知 | 联网检测的汇总结果尚未确认。只说明已返回的分项结果。 |

- 扫描命中后先看 `icp_gate_enabled`。值为 `true` 或开关值缺失时，核对联网声明。值为 `false` 时，仅在运行形式含 APK 或原生 TapTap 小游戏时提醒。例如，TapTap 制造与 Windows 混合且开关关闭时，跳过提醒。运行形式优先取非空的 `declared_package_types`，否则看 `package_types`。包体冲突或类型待确认时，先请开发者核对运行形式。TapTap 小游戏始终需要 ICP，各项材料是否必需以本次资质清单为准。
- 按 `get-assessment` 的输出 schema 选取联网声明。schema 声明 `declared_app_features` 时，读取 `data.result.assessment.declared_app_features.is_internet_required`。保留明确的 `false`。字段缺失或为 `null` 时仍为未确认。仅当旧 schema 没有 `declared_app_features` 时，才读取 `data.result.assessment.declared_internet_required`。
- 有适用的联网检测时，声明为 `true` 表示声明与检测一致。声明为 `false` 或尚未确认时，说明检测来源，请开发者核对游戏内的联网功能（含弱联网），确认是否要更新声明。开发者选择维持原声明时结束办理。只读咨询不修改草稿。
- 旧版接口没有 `package_network_status` 或本次读取失败时，说明扫描结果尚未确认。如果用户需要核实，给出该游戏[当前环境的资质认证页](taptap-suite/references/taptap-qualification/references/qualification-draft.md#敏感资质页面交接)。

开发者确认要追加联网声明时，取本次 `data.result.snapshot`，将以下两项写入 `qualification-correction.json`，按下节的 `save-draft --dry-run` 预览。同一游戏只更新联网一项。用户确认预览后用相同幂等键保存，快照过期则重读并重新预览。保存后回读同一游戏的 `get-assessment`，按上述 schema 选取联网声明。仅在读到 `true` 时确认已保存为联网，同时说明 `icp-filing` 要求与待确认项。未回显声明时，只报告保存回执和实际可查的资质结果。

```json
{
  "expected_snapshot": "<刚读取的 snapshot>",
  "app_features": {"is_internet_required": true}
}
```

## 纠正已填事实

用户只问“如果取消文字剧情模拟，还需要版号吗”时，先通过 `qualification --help` 核对是否提供 `preview-assessment`。支持时调用 `qualification preview-assessment`，传入同一游戏的 `--app-id`、`--dev-id` 和 `--data @qualification-scenario.json`。例如，以下输入试算测试阶段取消文字剧情模拟的结果，其余条件沿用当前资料。

```json
{
  "app_features": {"release_intent": "testing", "has_text_story_simulation": false}
}
```

用 `data.result.assumed_app_features` 说明本次假定的条件，用 `data.result.assessment.requirements` 解释试算的要求和原因。`declared_app_features` 仍表示真实保存的判断依据。试算只读，完成后草稿保持原值。旧版接口未提供试算时，只能报告当前评估；`save-draft --dry-run` 仅预览保存请求。

例如开发者先前将“文字剧情模拟”填为“是”，现在说明游戏里有种田、战斗和主线对白，并询问是否填错。请向开发者核实游戏是否含文字剧情模拟。开发者不确定时，保留原草稿。以下示例适用于开发者已明确确认游戏不含文字剧情模拟，并要求把该项改为“否”的情况。

1. 对同一游戏调用 `get-assessment`，记录当前版号要求和 `data.result.snapshot`。
2. 将当次快照和要纠正的字段写入 `qualification-correction.json`，预览同一游戏的草稿变更。

   ```json
   {
     "expected_snapshot": "<刚读取的 snapshot>",
     "app_features": {"has_text_story_simulation": false}
   }
   ```

   ```text
   call_tool(name:"qualification save-draft", args:{
     developer_id:"<developerId>", app_id:"<appId>",
     data:"@qualification-correction.json", idempotency_key:"<draft-key>", dry_run:true})
   ```

3. 用户确认预览后，用同一输入和幂等键将 `dry_run` 换为 `yes` 保存。若快照冲突，重读后重新确认。
4. 重新调用同一游戏的 `get-assessment`，核对 `data.result.assessment.declared_app_features.has_text_story_simulation` 与用户确认的值。读到 `false` 才能确认已保存为“否”。值不符或缺失时说明实际读到什么，保留写入回执，不重复写。比较 `game-license` 的 `requirement` 和 `requirement_reasons`，向用户说明版号现在是否必需以及原因。

逐条读取该项 `requirement_reasons[].because`。`source=rule` 是规则命中的原因，例如内购或文字剧情模拟；`source=upstream` 表示上游审核要求。多项同时命中时逐项说明。审核驳回说明仍从 `reason` 和 `field_reject_reasons` 获取。

旧版接口没有回显剧情值或必需原因时，分别说明尚未确认的项目。可报告实际返回的版号要求、`unknown_facts` 和办理条件。快照变化或未知列表减少不能证明剧情已保存为“否”。

## 信息不完整时的处理

查询失败或缺少 assessment 时，说明无法完成资质核验，重新查询或前往开发者后台核实。不得把缺失字段或没有警告解释为资质齐全。

声明 APK+Windows、当前只绑定 APK 或 Windows 时，说明其余包体尚待准备，按包体流程继续；不要求仅为集合不相等而前往网页。无冲突不等于包体全部就绪，仍以包体状态及正式预检判断。

## 发布目标

读取 `assessment.declared_app_features.release_intent`。目标不明确时，询问用户准备开放预约、测试还是正式上线。咨询某个阶段时只说明该阶段的办理条件，不改草稿。实际目标为预约时，核对开发者认证或豁免；测试和正式上线时按完整适用清单检查。发布和提审仍按实际预检办理。

用户明确要求把发布目标保存为测试时，先检查 `schema qualification save-draft` 的 `app_features.release_intent`。支持时用同一游戏的最新快照预览以下变更，确认后按[纠正已填事实](#纠正已填事实)保存，再读 `declared_app_features.release_intent` 核对是否为 `testing`，说明本阶段的资质要求。预约和正式上线分别使用 `pre_registration` 和 `launch`。旧版接口缺少此字段时，说明当前只能按目标规划，跳过写入。

```json
{
  "expected_snapshot": "<刚读取的 snapshot>",
  "app_features": {"release_intent": "testing"}
}
```

普通 Windows 游戏免费、离线且没有版号时，可先规划预约或心愿单（PC 页面显示“敬请期待”），再按实际准入开展免费限量测试。游戏仍是草稿时先读该版本、包体和可选分发状态。尚无可用测试包或准入未确认时，把开测列作后续计划。

- 读 `platform-status` 的 `region_flag_pc` 可用选项。普通 Windows 游戏无已过审版号时，分发状态可选**开放试玩**，正式上线需要版号通过审核。只想展示游戏时，核对开发者认证或豁免、当前可选的“预约”或“敬请期待”，以及资料审核状态。个人开发者也按当前游戏的实际条件判断。[分发字段与门槛](taptap-suite/references/taptap-app-edit/references/app-edit-field-map.md#字段可见性与按平台--类型的条件渲染)
- **免费封闭式或开放式测试**使用独立的测试计划。PC 免费测试不要求版号，仍要核对防沉迷、测试环境、版本和已有计划。限量封测先查 `get-test-plan-policy` 的准入、名额和时长，在发放资格时选择 Windows。不限量开放测试在创建计划时选择 Windows。付费测试另有版号和防沉迷要求。[测试计划流程](taptap-suite/references/taptap-test-plan/MANUAL.md) · [官方 PC 游戏上架指南](https://developer.taptap.cn/docs/pc-store/guide/document-guide/)

## H5 与创意工坊升级

身份以服务端保存的 `is_level` 为准，H5 不等于关卡。普通离线 H5 仍需隐私、AI 声明和适龄；未知事实由服务端标识，不在手册里复制计算矩阵。关卡的普通资质不适用不代表可以升级/发布。

升级独立查询 `entry_enabled`、`can_apply`、目标包匹配及各 blocker。H5 自身 ICP 不是升级前置，隐私审核中不自行增加门槛；Maker 不能继承 H5 豁免。选包、备案、签约转开发者后台；有限“不处理个人信息”声明依 [创意工坊升级](taptap-suite/references/taptap-app-edit/references/app-edit-level-upgrade.md) 的独立确认流程。升级必须单独确认。成功后按 [升级后的资料与资质检查](taptap-suite/references/taptap-app-edit/references/app-edit-level-upgrade.md#升级后的资料与资质检查) 重新核对身份、资料及完整资质；已生效且仍适用的材料复用，审核中不重复提审。只处理实际缺项或需修改材料，升级成功不代表资料已提审或游戏已上线，不自动发布。

## 开发者后台交接

告诉用户要在哪个游戏、哪个资料版本中填写或核对哪项材料，为什么需要到开发者后台办理，以及完成后 CLI 将查询什么。优先使用服务端返回的可信页面链接；自行构造链接时，必须确认当前环境的开发者后台地址和页面路径，不能固定使用生产环境地址、把敏感值塞进 URL 或编造入口。无可靠链接时说明入口未确认，指引当前环境开发者后台对应页面。

主体认证、证件、联系人、ICP 主体信息和复杂隐私正文由用户在开发者后台填写；CLI 不支持的材料保存、文件上传、升级选包/备案/签约或整单撤回，也由用户在对应页面办理。小游戏隐私、防沉迷和备案的具体分工见 [全类型资料交接与接续](taptap-suite/references/taptap-qualification/references/material-handoff-resume.md)。完成页面操作后，CLI 查询对应资质、升级或版本状态，确认结果后再继续；尚未完成、没有权限、链接失效或查询失败时，明确保留待办，不能仅凭用户返回就认定成功。
