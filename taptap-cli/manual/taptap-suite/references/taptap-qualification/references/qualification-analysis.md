# Qualification analysis

## 适用场景

用户问“还缺哪些资质”“资质齐不齐”“能不能上架”，或纠正游戏的联网、内购、AI、IP、文字剧情等事实时使用本 reference。

## 输入判断

1. 缺 `developerId` / `appId` 时先转 `taptap-identity`。
2. 先读取 `app list-packages`；`data.result.current_bindings` 中存在
   `slot=windows` 时，确认当前草稿已绑定 Windows 包体。它是只读展示事实，
   不能作为 `select-package` / `clear-package` 的写入快照。
3. 先读取当前 `analyze-qualification-status` schema。Catalog `1.0.29+` 可接收
   `release_intent`、`is_online`、`has_iap`、`has_text_story_simulation`、
   `has_ai_content`、`involves_ip`；只传用户明确确认的事实。旧 schema 只有
   `app_id` 和 `developer_id` 时，用户补充的信息不能包装成已提交给服务端的
   `user_override`，应报告当前 catalog 的契约缺口。
4. 发布意图取值为预约=`pre_registration`、测试=`testing`、正式上线或发布=
   `launch`。只有本次输出明确表明服务端已确认时才能据此给最终结论；
   `requires_release_intent_confirmation=true` 或对应
   `judgement_basis_items[].source=default_assumption` 时标记“无法确认”。
5. 其它判断事实也读取 `judgement_facts` 与 `judgement_basis_items[].source`。
   `source=default_assumption` 只能作为服务端本次计算所用假设，不能表述为用户或
   App 已确认事实。
6. Catalog `1.0.33+` 会把尚未确认的联网、内购、文字剧情、AI 和 IP 事实返回为
   `null`，并通过 `requires_judgement_facts_confirmation` 与
   `unconfirmed_fact_keys` 列出缺口。`null` 不能解释成 `false`。

## 命令

```text
call_tool(name:"schema", args:{_positional:["qualification","analyze-qualification-status"]})
call_tool(name:"app list-packages", args:{app_id:"<appId>", developer_id:"<developerId>"})
call_tool(name:"qualification analyze-qualification-status", args:{app_id:"<appId>", developer_id:"<developerId>", data:<confirmed-analysis-input-json>})
```

当前 schema 确认支持下列字段时，`<confirmed-analysis-input-json>` 的类型示例：

```json
{"release_intent":"launch","is_online":false,"has_iap":false,"has_text_story_simulation":false,"has_ai_content":true,"involves_ip":false}
```

Catalog `1.0.29+` 下，按当前 schema 将用户已确认的
`release_intent`、`is_online`、`has_iap`、`has_text_story_simulation`、
`has_ai_content`、`involves_ip` 作为同名 JSON 字段放入 `--data`；字段较多时可改用
`data:"@qualification-analysis.json"`(相对会话工作目录的文件)。未确认字段直接省略，不能默认填成 `false`。
`app_id` 和 `developer_id` 继续作为 scope 字段直接传;只有命令 `--help`(经 `args._help:true`)
实际列出的参数才作为控制 flag 使用。不要在旧 schema 下提前传入这些字段。

## 执行步骤

1. 调用 `app list-packages`，记录 `current_bindings` 中的已绑定槽位。读取失败时，
   包体类型标记“无法确认”，不能把候选包体或上传记录当作已绑定。
2. 调用 `analyze-qualification-status` 获取当前判断依据、资质要求和状态。
3. 对照包体事实与 `judgement_facts.package_types`。已绑定 Windows 包体但结果
   不含 `windows` 时，报告“服务端资质分析未识别已绑定 Windows 包体”，并把
   Windows 场景结论标记为不完整；不要用本地规则修补 `required_qualifications`。
4. 把工具实际使用的判断依据及来源复述给用户。当前 schema 支持显式事实时，
   使用参数重新分析并确认对应 `source=user_override`；不支持时先更新对应的真实
   资料来源后重新分析，没有可写入口时报告契约缺口。
5. 先判断结论是否仍待确认。出现以下任一条件时，输出“当前不能确认满足上架条件”，
   并列出待确认事实或规则：
   - `qualification_progress_status=待确认`
   - `requires_judgement_facts_confirmation=true`
   - `submit_eligibility.can_submit=false`
   - `blockers[].code=judgement_facts_unconfirmed`
   - `blockers[].code=qualification_rule_unconfirmed`
6. 按“资质材料”和“合规检测”分组列出全部非 `approved` 项，并说明这些项目只
   覆盖服务端本次实际识别的包体和判断事实。
7. 对每项说明当前状态和下一步：待上传、已上传、审核中、已通过或需要人工填写。
8. 如果用户的目标是完整发布，说明资质通过不等于资料、包体和版本发布条件全部
   通过，并转 `taptap-app-edit`。

## 输出边界

- 结论必须以本次工具结果为准，不引用旧分析替代当前结果。
- Windows 联网场景是否要求 ICP、隐私合规或其它材料，当前没有已确认规则。
  只能展示服务端本次明确返回的要求；包体识别不一致时需产品或服务端确认，
  不能由 Skill 推断、补齐或删除资质项。
- 返回 `warnings[].code=windows_online_rule_confirmation_required` 时，当前结果
  必须同时按 `blockers[].code=qualification_rule_unconfirmed` 处理，结论保持
  `待确认`，且 `submit_eligibility.can_submit=false`。不能声称 Windows 联网场景
  已最终满足全部资质。
- `blockers[].code=judgement_facts_unconfirmed` 表示联网、内购、文字剧情、AI、IP
  或包体等判断事实尚未确认；列出 `unconfirmed_fact_keys`，但不要自行猜测值。
- 业务结论必须联合读取状态、确认标记、提交资格和 blockers。即使异常旧响应中的
  `meets_listing_requirements=true` 与这些阻塞字段冲突，也必须按阻塞处理并报告
  服务端契约不一致。
- 不默认输出 raw schema、接口路径、审核单 ID 或完整内部字段。
- 不把测试玩家资格、激活码资格或普通资料缺口混入上架资质结论。
- 顶层 `ok=false` 时按 `error.type` / `error.subtype` 处理；当前
  `analyzeQualificationStatus` schema 没有 `data.result.ok`。缺少预期结果字段时
  按异常处理，不能当成“没有资质要求”。
