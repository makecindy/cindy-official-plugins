# TapTap CLI 插件:上架资质(qualification)

本手册面向当前 App 的上架资质:先按真实发布意图和游戏事实分析缺口,再保存非敏感材料或处理资质增量审核。它不替代资料页版本发布流程。命令行示例按 taptap-suite 手册的映射表转成 call_tool 调用。

**CRITICAL — 资质结论必须来自当前 `qualification analyze-qualification-status` 结果;不能凭游戏类型、旧对话或经验补全要求。**

**CRITICAL — 敏感资质只转开发者后台页面填写。出现 `requires_manual_input=true` 或敏感字段时,不通过 CLI 直写,也不声称已保存。**

**CRITICAL — 资质增量提审/撤回使用本手册的 prepare → confirm 命令,不改走 app-edit 手册的整版审核流程。**

## 快速决策

| 用户意图 | 首选调用 / 流程 |
| --- | --- |
| 缺 `developerId` / `appId` | 转 identity 手册查候选,不猜 ID |
| 查询还缺哪些资质、能否满足预约/测试/上线目标 | 先 `app list-packages`,再 `qualification analyze-qualification-status` |
| 用户纠正联网、内购、AI、IP 等事实 | 更新真实资料来源后重新分析;无写入口时报告契约缺口 |
| 保存版号、备案、隐私、AI、软著等非敏感材料 | `qualification save-qualification-draft`,先 dry-run |
| 工具要求人工填写或涉及主体/证件/联系人 | 停止 CLI 写入并交接开发者后台资质页 |
| 提交资质增量审核 | `qualification precheck-qualification` → 用户确认 → `qualification submit-qualification`(yes:true) |
| 撤回资质审核 | `qualification preview-qualification-withdrawal` → 用户确认范围 → `qualification withdraw-qualification`(yes:true) |
| 修改简介、图标、截图、主包体或整版发布 | 转 app-edit 手册 |

## 常用调用

```text
# 分析资质缺口(data 为用户已确认的事实,未确认字段省略,不要默认 false)
call_tool(name:"app list-packages", args:{dev_id:"<developerId>", app_id:"<appId>"})
call_tool(name:"qualification analyze-qualification-status", args:{
  dev_id:"<developerId>", app_id:"<appId>",
  data:{ release_intent:"launch", is_online:false, has_iap:false,
         has_text_story_simulation:false, has_ai_content:true, involves_ip:false }
})

# 保存非敏感材料草稿(先预览)
call_tool(name:"qualification save-qualification-draft", args:{
  dev_id:"<developerId>", app_id:"<appId>",
  data:{ ... }, idempotency_key:"<draft-key>", dry_run:true })
```

## 执行规则

- 缺 `developerId` 或 `appId` 时转 identity 手册;不要猜 ID。
- 不确定输入字段、资质类型、枚举或副作用时,先 `call_tool(name:"schema", args:{_positional:["qualification","<method>"]})`;reference 中的字段示例不是服务端实时 schema。
- 分析前先调用 `app list-packages`,使用 `data.result.current_bindings` 确认当前已绑定槽位;`slot=windows` 表示已绑定 Windows 包体。该字段只用于资质分析的只读事实核对,不能作为包体写入快照。
- 先读取 `qualification analyze-qualification-status` 的 schema。当前 catalog 暴露 `release_intent`、`is_online`、`has_iap`、`has_text_story_simulation`、`has_ai_content`、`involves_ip` 等可选输入;只把用户明确确认的事实作为同名 JSON 字段放入 `data`,未确认字段直接省略,不能默认填成 `false`。只有命令 help 实际列出的参数才作为 flags 使用。旧 schema 只有 App 和厂商 scope 时,不能声称已把这些事实传给服务端,需报告当前 catalog 的契约缺口。
- 是否已确认以本次结果中的 `judgement_basis_items[].source` 为准;显式参数应返回 `source=user_override`。`source=default_assumption` 不是已确认事实,必须标记为"无法确认"。`requires_release_intent_confirmation=true` 时不能给出依赖发布意图的最终结论。
- `current_bindings` 已确认 Windows 包体,但 `judgement_facts.package_types` 不包含 `windows` 时,必须指出服务端分析遗漏且不能给出覆盖 Windows 场景的最终资质结论。不得自行追加 ICP、隐私合规或其它 Windows 资质要求。
- `judgement_facts` 中尚未确认的联网、内购、文字剧情、AI 或 IP 事实会返回 `null`。读取 `requires_judgement_facts_confirmation` 和 `unconfirmed_fact_keys`,不得把 `null` 表述为 `false`。
- `qualification_progress_status=待确认`、`requires_judgement_facts_confirmation=true`、`submit_eligibility.can_submit=false`,或 `blockers[].code` 为 `judgement_facts_unconfirmed` / `qualification_rule_unconfirmed` 时,都必须明确表述为当前不能确认满足上架条件。
- 返回 `warnings[].code=windows_online_rule_confirmation_required` 时,说明当前规则未覆盖 Windows 联网场景;保留服务端已返回的资质项,并以 `qualification_rule_unconfirmed` blocker 为准阻断结论。不得自行追加 ICP、隐私合规或其它 Windows 资质要求。
- 写入前执行 read-before-write;材料写入先 dry-run,增量审核先 prepare,确认后才执行 confirm。
- 读取 JSON envelope 的顶层 `ok` 和 `error.type` / `error.subtype`;资质业务结论联合读取 `data.result.qualification_progress_status`、`meets_listing_requirements`、`requires_judgement_facts_confirmation`、`unconfirmed_fact_keys`、`pending_qualification_titles`、`submit_eligibility` 和 `blockers`,不能只依据单个布尔字段。不把不存在的 `data.result.ok` 当作业务成功位。面向用户输出业务结论、状态、风险和下一步,不默认倾倒 raw JSON 或内部 ID。

## References

| Reference | 什么时候读 | 读取方式 |
| --- | --- | --- |
| qualification analysis | 分析资质缺口、解释判断依据、处理用户修正事实或状态输出 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-qualification/references/qualification-analysis.md"})` |
| qualification draft | 保存材料、处理 `remaining_missing_fields`、`requires_manual_input` 或页面填写交接 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-qualification/references/qualification-draft.md"})` |
| qualification materials | 构造具体 `qualification_type` 和 `qualification` | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-qualification/references/qualification-materials.md"})` |
| qualification lifecycle | 提交或撤回资质增量审核、判断审核范围和确认门禁 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-qualification/references/qualification-lifecycle.md"})` |

## 不在本手册范围

- 普通资料字段、主包体、整版提审和发布:转 app-edit 手册。
- 厂商实名流程本身:敏感主体信息到开发者后台页面填写。
- CBT/OBT 玩家资格、资格批次和激活码:转 test-plan 手册。
