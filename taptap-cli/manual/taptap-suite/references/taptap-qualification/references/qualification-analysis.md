# Qualification analysis

## 读取与能力判断

先通过 identity 手册确认开发者和游戏，再读取命令 schema，调用 `qualification get-qualification-assessment`。结合 `app analyze-app-status` 查看资料问题，用 `app list-packages` 核对包体绑定。目标版本处于审核中或待发布时仍应分析该版本，不能因为它不可编辑而改查其他版本。

`assessment` 的解释：

| 字段 | 用法 |
| --- | --- |
| read_state | complete / partial；partial 保留成功域，失败域的状态为空并附 read_error，不变成 pending_upload |
| material_summary | 非敏感材料读回：适龄值、版号/软著、AI 分包证明、隐私模式/链接；编辑前复核，不回显主体证件/联系人 |
| requirements | 完整清单；required / optional / unknown / not_applicable，含 age_grade |
| unknown_facts | 需要确认的事实；缺失不等于 false，只读不自动补写 |
| package_types / declared_package_types / package_conflict | 展示分析依据与声明；仅按服务端 conflict 判定是否需要核对，声明内包体尚未全部绑定不算冲突 |
| target_source | unpublished 优先，再 published，再 declaration；可编辑性另判 |
| submission_eligibility | eligible / blocked / unknown，来自现有提交判据，可包含豁免 |
| confirmation_guarantee | preflight_only_no_atomic_cas：仅检查执行前的变更，无法防止检查后其他操作者同时修改 |

逐项读取审核状态、是否已生效、是否已保存材料、办理渠道及提交/撤回阻塞项，向用户解释对应结果。驳回原因取自 `reason` / `field_reject_reasons`；提交后用 `submitted_fields` 核对审核范围，适龄也按此处理。材料已经生效与修改申请被驳回可以同时成立，是否允许继续操作应根据阻塞项和服务端校验判断，不能只允许 `uploaded` 状态。

当前资质是否满足要求，以 required 项的 `effective_approved` 为准：true 表示已有生效材料，false 表示尚未生效，null 或缺失表示无法确认。`status` 描述申请进度，不能覆盖生效结论。

例如，`effective_approved=true` 且 `status=reviewing` 时，说明当前资质有效、修改申请审核中；`status=rejected` 时，说明当前资质仍有效、修改申请被驳回，应展示驳回原因，不把当前资质列为缺口。首次提交且 `effective_approved=false` 时，即使已保存或正在审核，也仍待完成。read_state=partial/unknown、未知事实、冲突、读取失败或资格 unknown 必须单独展示；非必须空槽不列入缺口。资质齐全、可提审、已发布、分发开放分别确认。

## 信息不完整时的处理

查询失败或缺少 assessment 时，说明无法完成资质核验，重新查询或前往开发者后台核实。不得把缺失字段或没有警告解释为资质齐全。

声明 APK+Windows、当前只绑定 APK 或 Windows 时，说明其余包体尚待准备，按包体流程继续；不要求仅为集合不相等而前往网页。无冲突不等于包体全部就绪，仍以包体状态及正式预检判断。

## 发布目标

目标不明确时，询问用户准备开放预约、测试还是正式上线，同时继续查询资料。规划预约时，先确认开发者认证或豁免，把后续需要的材料列为待办；测试和正式上线按完整适用清单检查。上述规划不替代实际预检，目标变化后应重新分析。

## H5 与创意工坊升级

身份以服务端保存的 `is_level` 为准，H5 不等于关卡。普通离线 H5 仍需隐私、AI 声明和适龄；未知事实由服务端标识，不在手册里复制计算矩阵。关卡的普通资质不适用不代表可以升级/发布。

升级独立查询 `entry_enabled`、`can_apply`、目标包匹配及各 blocker。H5 自身 ICP 不是升级前置，隐私审核中不自行增加门槛；Maker 不能继承 H5 豁免。选包、备案、签约转开发者后台；有限“不处理个人信息”声明依 [创意工坊升级](taptap-suite/references/taptap-app-edit/references/app-edit-level-upgrade.md) 的独立确认流程。升级必须单独确认，成功后区分已升级与原独立，重新读身份并分析普通游戏资质，不自动发布。

## 开发者后台交接

明确目标、材料域、阻塞原因、当前版本及回来后查询命令。优先可信 handoff 链接；只能用确认过的当前环境 serverUrl 与支持的路由构造，不能硬编码生产域、把敏感值塞进 URL 或编造入口。无可靠链接时说明入口未确认，指引当前环境开发者后台对应页面。

主体认证/证件/联系人、ICP 主体信息、常规小游戏隐私/ICP/Tap 小游戏防沉迷、不支持分端写的混合材料、升级选包/备案/签约、整单撤回、无本地上传能力的 PDF 保留为后台办理。回到 CLI 后重读资质/升级/版本状态；未完成、无权限、链接失效均保留待办，不把用户返回当成功。
