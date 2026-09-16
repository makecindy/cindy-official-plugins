# Qualification draft

## 适用场景

用户要保存版号、备案、隐私、AI、软著、授权书、安全评估等非敏感材料，或工具返回需要人工填写的资质时使用本 reference。

## 保存非敏感材料

1. 先确定 `qualification_type`，再读取当前 schema：

   ```text
   call_tool(name:"schema", args:{_positional:["qualification","save-qualification-draft"]})
   ```

2. 按 [qualification materials](taptap-suite/references/taptap-qualification/references/qualification-materials.md) 构造输入。`qualification.kind` 必须和 `qualification_type` 一致，只传当前 schema 中的稳定字段。
3. 只有图片型材料需要先取得 HTTPS URL：图片上传由 `taptap-materials` 执行（即 `call_tool(name:"upload", …)`，成功自动收录素材库），拿到返回的 `data.url` 后再构造 draft 输入。版号、授权书、安全评估等 PDF 或其他非图片文件不走图片上传；当前 CLI 没有通用文件上传命令，应使用已有 HTTPS 文件 URL 或开发者后台页面完成上传。

4. 先预览再写入：

   ```text
   call_tool(name:"qualification save-qualification-draft", args:{app_id:"<appId>", developer_id:"<developerId>", data:"@qualification-draft.json", idempotency_key:"<draft-key>", dry_run:true})
   ```

   用户确认后执行真实写入，并追加 `--yes`：

   ```text
   call_tool(name:"qualification save-qualification-draft", args:{app_id:"<appId>", developer_id:"<developerId>", data:"@qualification-draft.json", idempotency_key:"<same-draft-key>", yes:true})
   ```

## 结果分流

- `status_after_save=uploaded`：告知材料已保存，并重新调用 `analyze-qualification-status` 验证状态。
- `remaining_missing_fields` 非空：列出仍缺少的材料，不声称资质已经完整。
- `requires_manual_input=true`：停止 CLI 写入，按下方页面规则交接。
- `blocked=true`：展示 `next_action`，不自动重试写操作。
- 顶层 `ok=false`：按 `error.type` / `error.subtype` / `error.hint` 解释修复方向；业务结果按当前 operation 的声明字段（如 `status_after_save`、`remaining_missing_fields`、`requires_manual_input`、`blocked`）解释。当前资质 output schema 没有通用的 `data.result.ok`。两者都不自动重试写操作。

## 敏感资质页面交接

涉及实名主体、证件、营业执照、联系人等敏感信息时，不把字段放入 CLI payload，也不在日志或回复中回显敏感值。CLI 不承诺返回资质页面 URL；使用当前开发者后台资质页面入口完成人工填写。

页面链接形态为：

```text
https://developer.taptap.cn/v3/<developerId>/app/<appId>/store/qualifications
```

目前只有 ICP 支持追加 `?qualification=icp-filing` 自动打开对应模块；其他资质进入总页后，由用户按工具结果指出的资质项填写。用户完成页面操作后，再调用 `analyze-qualification-status` 验证。

不要暴露或调用前端专用的 `present-qualification-input-card`，也不要说 CLI 已打开 modal、已代填或已保存。
