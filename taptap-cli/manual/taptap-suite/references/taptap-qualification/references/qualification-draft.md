# Qualification draft

## 适用场景

用户要保存版号、备案、隐私、AI、软著、授权书、安全评估等非敏感材料，或工具返回需要人工填写的资质时使用本 reference。

## 小游戏域材料边界

H5、Spark、Tap 小游戏及包含这些包体的组合，其适用的隐私合规与 ICP 使用小游戏域流程；防沉迷仅在包含 Tap 小游戏时使用该域。纯 H5 / Spark 的防沉迷可属于应用资质审核域，不因包体是轻量类型就转后台。逐项读取 assessment 的 domains、write_domain 与 submit_blockers，分别判断材料所属域、办理渠道和提审条件；可选材料不列为必交，可保存也不等于已满足提审条件。除创意工坊升级中的“不处理个人信息”简单声明外，当前 CLI 不支持这些材料的保存、提审或撤回；前往开发者后台对应材料入口办理，完成后重新读取状态。该例外按 [创意工坊升级](taptap-suite/references/taptap-app-edit/references/app-edit-level-upgrade.md) 核对并取得用户明确确认后提交独立隐私审核；复杂声明仍转开发者后台，不能用 `save-qualification-draft` 代替。不能用应用资料中的资质草稿代替小游戏材料完成，也不能改类型绕过 `failed_precondition`。仅保存 `app_features` 的事实确认仍可使用现有接口；AI、版号、授权等其它材料按当前工具契约处理。

## 创建类型声明与恢复

创建时选定的包体类型遵守[固定包体类型边界](taptap-suite/references/package-type-boundary.md)。正常保存联网、内购、AI 等事实时省略 `app_features.package_types`，保留已有声明；不能用资质保存把 H5 改成 Tap 小游戏或其他类型，也不能用声明覆盖实际包体。

仅当本次创建返回 `created:true`、`package_type_saved:false` 且已保留 appId 与创建类型时，才按以下流程补存同一选择：读取当前 schema，用同一 appId/devId 预览并保存 `{"app_features":{"package_types":["h5"]}}`（示例仅适用于本次确实选择 H5；其它类型必须逐字沿用创建选择 `apk` / `windows` / `mini_app`）。不得添加未经确认的业务事实，不重放创建。补存成功后调用 `package-management get-available-package-types`，读取 `data.result.declared_package_types`；H5 必须精确为 `["h5"]`，Tap 小游戏必须精确为 `["mini_app"]`，并与创建选择一致，不能只看 `available_package_types` 或保存接口返回成功。读回确认后才能继续包体上传；恢复以本次读回为准，原创建响应的 `package_type_saved:false` 不会被改写，不要为了取得新的创建回包而重放创建。缺失来源、既有声明冲突或关联对象不存在时停止，不把这个恢复步骤当成给任意游戏选择首包类型的入口。

APK + Windows 的已确认附加用途单独处理：先读取已有 `declared_package_types`，仅允许保留原 APK/Windows 类型并增量保存 `{"app_features":{"package_types":["apk","windows"]}}`；不能删除原类型、从 H5/Tap 小游戏转入，或把它用于其它类型组合。保存后重新读回两项声明，并确认原有平台、槽位和权限门禁均满足，再处理附加包体。仅有 `["apk"]` 或 `["windows"]` 的声明不能自动扩展为两类。

## 保存非敏感材料

1. 先确定 `qualification_type`，再读取当前 schema：

   ```text
   call_tool(name:"schema", args:{_positional:["qualification","save-qualification-draft"]})
   ```

2. 先读 `qualification get-qualification-assessment`，把本次返回的 `snapshot` 原样放在写请求顶层的 `expected_snapshot`。按 [qualification materials](taptap-suite/references/taptap-qualification/references/qualification-materials.md) 构造输入。`qualification.qualification_type` 是联合类型的判别字段，必须传入；不要传顶层 `qualification_type`，也没有 `kind` 字段。
3. 只有图片型材料需要先取得 HTTPS URL：图片上传由 `taptap-materials` 执行（即 `call_tool(name:"upload", …)`，成功自动收录素材库），拿到返回的 `data.url` 后再构造 draft 输入。版号、授权书、安全评估等 PDF 或其他非图片文件不走图片上传；当前 CLI 没有通用文件上传命令，应使用已有 HTTPS 文件 URL 或开发者后台页面完成上传。

4. 先预览再写入：

   ```text
   call_tool(name:"qualification save-qualification-draft", args:{developer_id:"<developerId>", app_id:"<appId>", data:"@qualification-draft.json", idempotency_key:"<draft-key>", dry_run:true})
   ```

   用户确认后执行真实写入，并追加 `--yes`：

   ```text
   call_tool(name:"qualification save-qualification-draft", args:{developer_id:"<developerId>", app_id:"<appId>", data:"@qualification-draft.json", idempotency_key:"<same-draft-key>", yes:true})
   ```

## 结果分流

- 保存成功后，按返回的 `qualification_type` 说明保存了哪类材料，再调用 `qualification get-qualification-assessment`。
- 用 `assessment.material_summary` 核对材料内容和 `proof_files`，根据 `requirements` 列出剩余必需项。读取不完整时，明确哪些内容尚无法确认。
- 命中敏感资质时停止 CLI 写入，按下方页面规则交接。
- `blocked=true`：展示 `next_action`，不自动重试写操作。
- 顶层 `ok=false`：按 `error.type` / `error.subtype` / `error.hint` 解释修复方向；业务结果按当前 operation 的声明字段（`save-qualification-draft` 为 `qualification_type`）解释。当前资质 output schema 没有通用的 `data.result.ok`。两者都不自动重试写操作。

## 敏感资质页面交接

涉及实名主体、证件、营业执照、联系人等敏感信息时，不把字段放入 CLI payload，也不在日志或回复中回显敏感值。CLI 不承诺返回资质页面 URL；使用当前开发者后台资质页面入口完成人工填写。

优先使用服务端可信 handoff；只有当前环境 origin 与路由已经确认时才构造链接，不能从接口域名猜生产域。路径形态为：

```text
<已确认的当前环境开发者后台 origin>/v3/<developerId>/app/<appId>/store/qualifications
```

目前只有 ICP 支持追加 `?qualification=icp-filing` 自动打开对应模块；其他资质进入总页后，由用户按工具结果指出的资质项填写。用户完成页面操作后，调用 `qualification get-qualification-assessment` 读回；未完成或读取失败保留待办。

不要暴露或调用前端专用的 `present-qualification-input-card`，也不要说 CLI 已打开 modal、已代填或已保存。

保存完成后重新读取 snapshot，不能沿用保存前的确认标识提交审核。发现并发修改或材料冲突时，先确认要保留的内容，再重新查询并核对后续操作；不要自动覆盖。

## 办理域未知与后台保存失败

当前版本包体类型未确认时，先核对绑定或已保存的类型声明并重新查询完整评估，不把未知归为应用资质域，不借线上包或应用审核单推断小游戏隐私已完成。H5 普通应用资质的提交回执，只能说明该审核请求的结果；小游戏隐私是否配置、审核及生效必须读取对应办理域。

后台保存也可能因校验或服务问题失败。用户只使用第三方 SDK、未使用所列个人信息权限时，不能为了绕过保存失败而虚构权限、改选“不处理个人信息”或用应用隐私链接代替当前材料。保留实际错误和请求编号，引导支持人员核查；说明“当前隐私配置尚未保存成功，需核查后台返回的错误”，不承诺转后台一定能完成，也不重复提交已成功的其他审核请求。
