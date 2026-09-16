# Qualification lifecycle

## 适用场景

用户要提交某项资质增量审核、撤回审核，或需要判断撤回影响范围时使用本 reference。

## 提交资质增量审核

1. 先准备并检查指定资质：

   ```text
   call_tool(name:"qualification precheck-qualification", args:{app_id:"<appId>", developer_id:"<developerId>", data:{qualification_type:"<type>"}})
   ```

2. 只有返回 `can_submit=true` 才进入确认。向用户展示资质类型、审核范围、阻塞项和影响，只给业务结论，不原样输出 `can_submit`、`source` 等机器字段。
3. 用户明确确认后执行：

   ```text
   call_tool(name:"qualification submit-qualification", args:{app_id:"<appId>", developer_id:"<developerId>", data:{qualification_type:"<type>"}, idempotency_key:"<submit-key>", yes:true})
   ```

4. 完成后重新调用 `analyze-qualification-status` 验证状态。

## 撤回资质审核

1. 先检查指定资质：

   ```text
   call_tool(name:"qualification preview-qualification-withdrawal", args:{app_id:"<appId>", developer_id:"<developerId>", data:{qualification_type:"<type>"}})
   ```

2. 展示工具返回的撤回范围。若结果指出是旧版整单审核，必须明确说明撤回的是整单而非单项。
3. 用户确认范围后执行：

   ```text
   call_tool(name:"qualification withdraw-qualification", args:{app_id:"<appId>", developer_id:"<developerId>", data:{qualification_type:"<type>"}, idempotency_key:"<withdraw-key>", yes:true})
   ```

4. 完成后重新调用 `analyze-qualification-status` 验证状态。

## 门禁与输出

- prepare 是只读预览，不能替代用户确认。
- confirm 只在对应 prepare 已完成、目标和影响已展示、用户明确确认后执行。
- 资质增量审核不等同于资料版本的整版提审、撤审或发布；后者转 `taptap-app-edit`。
