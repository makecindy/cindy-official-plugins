# Qualification lifecycle

## 保存与跨端接续

先读取命令 schema，再调用 `call_tool(name:"qualification get-qualification-assessment", …)`，核对目标游戏、版本及已保存材料。查询可读取当前成员在开发者后台保存的资质草稿，因此应复用已有材料，只询问缺失或需要修改的内容。不得读取其他成员的私人草稿；材料来源存在冲突时，请用户在开发者后台核实后重新查询。

写请求的 `expected_snapshot` 必须使用本次查询返回的 `snapshot`。保存成功后再次查询，再用返回的确认标识提交审核。幂等键防止重复执行，确认标识用于检查材料是否在执行前发生变化。该检查不能阻止检查完成后的并发修改；多人同时编辑时，先协调编辑操作，再读取并确认材料。

## 提交与撤回

1. 从 assessment 核对材料所属域及 `submit_blockers` / `withdraw_blockers`。已通过或已驳回的材料修改后可以申请重提，是否允许操作以阻塞项及提交结果为准；不能只允许 `uploaded` 状态。遇到材料不完整、没有变更或审核中等问题时，按返回原因处理。
2. 用材料的业务名称说明本次提交或撤回的范围，并明确目标游戏及版本；字段名只用于内部核对。按类型撤回只影响对应材料的审核；需要撤回整单审核时，引导用户在开发者后台确认影响并办理。
3. 构造请求：

   ```json
   {"qualification_type":"game-license","expected_snapshot":"<刚读取的 snapshot>"}
   ```

   分别执行 `qualification submit-qualification` / `qualification withdraw-qualification`（`call_tool(name:"qualification submit-qualification", args:{developer_id, app_id, data:{…}, idempotency_key:"<key>", dry_run:true})`），传稳定幂等键，先预览；用户确认后用相同参数加 `yes:true`。
4. 请求成功或结果未知时，都调用 `qualification get-qualification-assessment` 核实。提交后检查 `reviewing` 和审核字段范围；撤回后检查对应字段是否已退出审核。提交成功不等于审核通过。请求超时时先查询结果，不更换幂等键重复提交。

撤回是否成功，以本次撤回操作的结果为依据；随后读回确认目标材料已退出审核，并核对材料是否保留。操作成功、目标退出审核且材料保留均已核实后，可说明“已撤回审核，材料已保留。再次提交前需重新核对材料和提交条件”。不承诺撤回后查询一定显示已保存，也不把独立查询里的驳回状态解释为撤回成功。请求超时且结果不明确时，说明暂时无法确认；不要根据原因文字猜测，也不要自动再次撤回。部分撤回还需确认其他材料仍在审核。

最后一项撤回后，共享审核单仍可能显示为已结束的驳回状态，这是开发者后台与 CLI 共同使用的审核行为，不代表本次撤回失败。只依据本次明确的操作结果说明撤回成功，不把查询状态改写成已保存。

内部读回时，用对应材料的 `has_saved_material` 和 `material_summary` 核对材料是否存在及内容是否符合本次操作；适龄还需核对实际分级值。仅有存在标记不足以证明所有材料内容均已保留。若操作明确成功但材料未读到、内容不一致或读回失败，说明“已撤回审核，但暂未确认材料是否完整保留，请重新查询核对后再修改或提交”，不要声称材料丢失，也不要自动补写。

## 适龄分级

适龄使用独立的保存、提审和撤回命令。先读取以下 schema；命令不可用时引导用户前往开发者后台办理，不通过普通资料字段写入：

```text
call_tool(name:"schema", args:{_positional:["qualification","save-age-grade-qualification"]})
call_tool(name:"schema", args:{_positional:["qualification","submit-age-grade-qualification"]})
call_tool(name:"schema", args:{_positional:["qualification","withdraw-age-grade-qualification"]})
```

保存输入为 `{"age_grade":12,"expected_snapshot":"<snapshot>"}`，适龄取值以 schema 为准。提审和撤回传入 `{"expected_snapshot":"<本次查询的 snapshot>"}`。这些写操作均须使用幂等键，先预览并取得确认。操作后查询 assessment，核对 `material_summary.age_grade` 及 `requirements` 中 `subject=age_grade` 的状态。

## 与资料发布的关系

材料补齐后，按 app-edit 手册重新检查资料。用户要求提审时，再依次读取版本快照、预检、确认、提交和查询结果。资质审核通过不代表资料已提审或已发布；建议性缺口应明确提示，阻断项或未知资格不能解释为通过。审核后的版本绑定由服务端处理，CLI 不自行回填审核结果或覆盖用户修改。

编辑 AI 证明前，先读取 `assessment.material_summary.proof_files`。只修改用户指定的包体证明，保留其他包体的文件引用，再提交完整列表；保存后逐项核对结果。文件类型等必要信息缺失时，请用户在开发者后台补齐，不自行猜测。
