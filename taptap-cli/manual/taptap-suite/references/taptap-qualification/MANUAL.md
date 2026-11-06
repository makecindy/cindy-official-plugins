# TapTap CLI 插件:上架资质(qualification)

本手册用于查询游戏上架资质、补充非敏感材料和办理资质审核。资料版本的提审与发布由 app-edit 手册负责。命令行示例按 taptap-suite 手册的映射表转成 call_tool 调用。

**CRITICAL — 使用 `qualification get-qualification-assessment` 读取资质要求、状态、材料摘要和确认标识。`read_state=partial/unknown` 或材料域返回 `read_error` 时,保留已查明的结果并列出无法确认项;不能凭游戏类型或经验补全结论。**

**CRITICAL — 敏感资质只转开发者后台页面填写。命中敏感资质类型或敏感字段时,不通过 CLI 直写,也不声称已保存。**

**资质审核路径 — H5、Spark、Tap 小游戏的隐私与 ICP,以及 Tap 小游戏的防沉迷走专用材料流程;按服务端返回的办理域交接后台。纯 H5 / Spark 的防沉迷不因此转后台,是否必交与能否保存、提审分别读取需求和动作条件。创意工坊升级中的“不处理个人信息”例外:按 app-edit 手册的 level upgrade 明确确认并提交独立隐私审核,复杂情况仍转开发者后台,不能用 `qualification save-qualification-draft` 代替。其余增量审核用 `qualification submit-qualification` / `withdraw-qualification`,不走整版审核。**

**CRITICAL — 从 `assessment.requirements` 读取完整清单,包含适龄。`required` 项以 `effective_approved` 判断当前资质是否有效:false 列为待完成,null 或缺失列为无法确认;`status` 单独说明本次申请的审核进度。存在未知事实、包体冲突或无法确认的提交资格时,不能总结为齐全。CLI 与插件手册不自行计算业务规则。**

**CRITICAL — 先读取已保存的业务事实,只询问缺失或冲突内容。缺失值不能按 false 处理,只读分析不自动保存。用户确认修改后,通过 `app_features` 保存并重新分析;服务端报告包体冲突时,展示实际类型与声明,指引用户在开发者后台核对。**

## 快速决策

| 用户意图 | 首选调用 / 流程 |
| --- | --- |
| 缺 `developerId` / `appId` | 转 identity 手册查候选,不猜 ID |
| 查询还缺哪些资质、能否满足预约/测试/上线目标 | 先走 app-edit 手册的 `app analyze-app-status`(资料问题),再 `qualification get-qualification-assessment`(完整材料与分域状态) |
| 用户纠正联网、内购、AI、IP 等事实 | 先读取已保存事实,确认变更后用 schema 支持的 `app_features` 保存并重算 |
| 保存版号、备案、隐私、AI、软著等非敏感材料 | `qualification save-qualification-draft`,用本次 assessment 的 snapshot 作 expected_snapshot,先 dry_run |
| 工具要求人工填写或涉及主体/证件/联系人 | 停止 CLI 写入并交接开发者后台资质页 |
| 适龄保存、提审、撤回 | schema 支持时使用独立 age-grade 命令;缺能力转开发者后台 |
| 提交资质增量审核 | `qualification submit-qualification`,先 dry_run |
| 撤回资质审核 | `qualification withdraw-qualification`,先 dry_run |
| 修改简介、图标、截图、主包体或整版发布 | 转 app-edit 手册 |

## 常用调用

```text
# 读取当前已绑定槽位(只读事实)
call_tool(name:"app list-packages", args:{developer_id:"<developerId>", app_id:"<appId>"})

# 读取完整资质评估(只接受 scope,不接受资质事实输入)
call_tool(name:"qualification get-qualification-assessment", args:{developer_id:"<developerId>", app_id:"<appId>"})

# 保存非敏感材料草稿(先预览;expected_snapshot 用本次 assessment 的 snapshot)
call_tool(name:"qualification save-qualification-draft", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{ qualification:{ qualification_type:"<type>", ... }, expected_snapshot:"<snapshot>" },
  idempotency_key:"<draft-key>", dry_run:true })

# 读取当前 schema(按需逐个确认)
call_tool(name:"schema", args:{_positional:["qualification","get-qualification-assessment"]})
call_tool(name:"schema", args:{_positional:["qualification","save-qualification-draft"]})
```

适龄使用独立命令,先读 schema 再调用;命令不可用时转开发者后台,不通过普通资料字段写入:

```text
call_tool(name:"schema", args:{_positional:["qualification","save-age-grade-qualification"]})
call_tool(name:"schema", args:{_positional:["qualification","submit-age-grade-qualification"]})
call_tool(name:"schema", args:{_positional:["qualification","withdraw-age-grade-qualification"]})
```

## 执行规则

- **提审前资质确认**:读取 assessment、资料分析与预检,分别报告完整资质、本次发布目标待办和硬 blocker。预约规划当前确认认证/豁免,后续材料留在完整清单;测试/上线检查完整适用项。规划不豁免实际服务端门禁。资格 blocked/unknown 不承诺可提交,建议性材料缺口不自行升级为硬阻断;用户确认后仍执行正式预检/提交。
- 缺 `developerId` 或 `appId` 时转 identity 手册;不要猜 ID。
- 不确定输入字段、资质类型、枚举或副作用时,先 `call_tool(name:"schema", args:{_positional:["qualification","<method>"]})`;reference 中的字段示例不是服务端实时 schema。
- 分析前先调用 `app list-packages`,使用 `data.result.current_bindings` 确认当前已绑定槽位;`slot=windows` 表示已绑定 Windows 包体。该字段只用于资质分析的只读事实核对,不能作为包体写入快照。
- 遍历 `assessment.requirements`。状态 `pending_upload`=材料待补、`uploaded`=已保存、`reviewing`=审核中、`rejected`=驳回、`approved`=通过;`read_state=unknown` 时状态省略,不猜状态。驳回读 `reason` / `field_reject_reasons`,提交范围读 `submitted_fields`,适龄同样按这些字段处理。
- 按 `requirements[].requirement` 分层,解释审核状态、`effective_approved`、已保存材料和动作阻塞;不要仅凭单一状态阻止 approved/rejected 后的合法修改重提。
- `assessment.submission_eligibility` 复用服务端资格判据,eligible 可含白名单/关卡豁免,不等于所有材料通过。开发者主体办理转开发者后台;不得自行否定已生效认证。
- 无未知/冲突、全部 required 项 `effective_approved=true` 且资格 eligible 才能说当前资质已确认齐全;这仍不等于已发布或分发已开放。
- 写入前读取最新 snapshot,通过 `expected_snapshot` 原样回传。先 dry_run,确认材料及影响后执行;每次保存后重新读取快照再提交。写前冲突重新确认,超时先读回,同一意图保留幂等键,不盲目换键。这项检查无法防止检查后其它操作者同时修改,操作完成后仍需核对结果。
- 读取 JSON envelope 的顶层 `ok` 和 `error.type` / `error.subtype`;资质业务结论优先读取 `data.result.assessment` 与 `version`,不能只依据单个状态字段。不把不存在的 `data.result.ok` 当作业务成功位。面向用户用中文说明哪些资质有效、哪些申请在审核或被驳回、哪些事项无法确认,以及下一步;不要展示 assessment 字段名或状态码,也不附英文枚举作为解释。

## References

| Reference | 什么时候读 | 读取方式 |
| --- | --- | --- |
| qualification analysis | 解释 assessment、资格、未知事实、包体冲突与发布目标待办 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-qualification/references/qualification-analysis.md"})` |
| qualification draft | 保存材料、核对仍缺材料或页面填写交接 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-qualification/references/qualification-draft.md"})` |
| qualification materials | 构造具体 `qualification_type` 和 `qualification` | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-qualification/references/qualification-materials.md"})` |
| qualification lifecycle | 提交、撤回、适龄办理、判断审核范围和材料保留 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-qualification/references/qualification-lifecycle.md"})` |

## 不在本手册范围

- 普通资料字段、主包体、整版提审和发布:转 app-edit 手册。
- 厂商实名流程本身:敏感主体信息到开发者后台页面填写。
- CBT/OBT 玩家资格、资格批次和激活码:转 test-plan 手册。

非关卡 H5 游戏不沿用关卡豁免;材料、签约、备案和升级资格分别判断,见 [analysis](taptap-suite/references/taptap-qualification/references/qualification-analysis.md)。
