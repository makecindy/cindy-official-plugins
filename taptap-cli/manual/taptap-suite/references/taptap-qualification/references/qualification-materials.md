# Qualification material fields

## 内容导航

- [资质类型](#资质类型)
- [构造原则](#构造原则)
- [常见示例](#常见示例)

## 适用场景

本文件只用于构造 `qualification save-qualification-draft` 输入。最终字段和枚举始终以当前命令为准：

```text
call_tool(name:"schema", args:{_positional:["qualification","save-qualification-draft"]})
```

## 资质类型

| 业务名称 | `qualification_type` |
| --- | --- |
| 游戏版号 | `game-license` |
| ICP 备案 | `icp-filing` |
| 隐私合规 | `privacy-compliance` |
| 防沉迷 | `anti-addiction` |
| AI 内容声明 | `ai-declaration` |
| 软件著作权 | `software-copyright` |
| IP 授权书 | `authorization-letters` |
| 安全评估 | `security-assessment` |

## 构造原则

- `qualification.qualification_type` 是联合类型的判别字段，必须传入；顶层**不接受** `qualification_type`，也没有 `kind` 字段。
- 文件字段传对象 `{ "type": "img|pdf|video", "url": "<https-url>" }`；多文件字段传对象数组。
- 只有图片型材料需要先取 HTTPS URL：由 `taptap-materials` 执行图片上传获取；PDF 或其他非图片材料不走图片上传，改用已有 HTTPS 文件 URL 或开发者后台页面。
- 不使用页面表单别名，如 `privacyPolicyUrl`、`policyLink`。
- ICP 的 `icp_entity_type`、`icp_entity_name`、`icp_entity_license_no` 由 schema 声明为 CLI 输入，但属于敏感主体信息：不在命令、日志或对话里回显，用户不愿在 CLI 填写时转开发者后台资质页面。
- 不在命令、日志或对话里暴露身份证号、营业执照号、联系人等敏感信息；工具要求人工填写时转页面。

## 常见示例

游戏版号：

```json
{
  "qualification": {
    "qualification_type": "game-license",
    "isbn": "<版号>",
    "isbn_file": { "type": "pdf", "url": "<https-url>" }
  }
}
```

APK ICP 需要完整主体字段，单独 icp_number + icp_file 不代表可提审。本手册不收集或回显主体证件/联系人；先在同环境开发者后台填妥，再按最新 write_domain 与 submit_blockers 判断能否从 CLI 完成非敏感后续动作。小游戏 ICP 属于独立域，不用应用资质接口代办。

隐私合规：

```json
{
  "qualification": {
    "qualification_type": "privacy-compliance",
    "privacy_qualification": {
      "privacy_policy_link": "https://example.com/privacy"
    }
  }
}
```

AI 内容声明：

```json
{
  "qualification": {
    "qualification_type": "ai-declaration",
    "aigc_qualification": {
      "provide_aigc_service": true,
      "proof_file": { "type": "pdf", "url": "<https-url>" },
      "package_types": ["apk"]
    }
  }
}
```

软件著作权：

```json
{
  "qualification": {
    "qualification_type": "software-copyright",
    "copyright_number": "<登记号>",
    "copyright_file": { "type": "pdf", "url": "<https-url>" }
  }
}
```

IP 授权书：

```json
{
  "qualification": {
    "qualification_type": "authorization-letters",
    "power_of_attorneys_file": [
      { "type": "pdf", "url": "<https-url>" }
    ]
  }
}
```

安全评估：

```json
{
  "qualification": {
    "qualification_type": "security-assessment",
    "safety_report_file": [
      { "type": "pdf", "url": "<https-url>" }
    ]
  }
}
```

防沉迷（`anti-addiction`）：

接入状态 `anti_addiction_status`（必填）：

| 值 | 含义 |
| --- | --- |
| 0 | 未知 |
| 1 | 未接入未成年人防沉迷服务 |
| 2 | 已接入未成年人防沉迷服务（TapTap SDK） |
| 3 | 已接入未成年人防沉迷服务（其他） |
| 4 | 已接入未成年人防沉迷新规 |

材料字段（字段较多且随游戏形态变化，最终以当前 `qualification save-qualification-draft` schema 为准）：

| 字段 | 含义 |
| --- | --- |
| `anti_addiction_read` | 是否已阅读防沉迷须知 |
| `anti_addiction_zxb` + `anti_addiction_zxb_file` | 是否接入中宣部实名 + 证明文件 |
| `anti_addiction_guest_recharge_file` | 游客充值限制文件 |
| `anti_addiction_lt8_recharge_file` | 8 周岁以下充值限制文件 |
| `anti_addiction_ge8_lt16_recharge_file` | 8–16 周岁充值限制文件 |
| `anti_addiction_ge16_lt18_recharge_file` | 16–18 周岁充值限制文件 |
| `anti_addiction_video_file` | 防沉迷说明视频 |

“接入防沉迷”= 接入未成年人防沉迷服务（TapTap SDK / 其他 / 新规）；未接入时走包体侧 `apk_anti_addiction_status=not-integrated` + 授权 TapPlay 免安装上架。

## 材料编辑规则

按 schema 构造材料输入。隐私托管模式 `use_general_privacy_policy:true` 的链接由服务端生成；环境配置不可用时，说明错误并引导用户前往对应环境的开发者后台。小游戏常规隐私配置在开发者后台办理。

AI 的 `proof_files` 会替换完整证明列表，每项格式为 `{ "package_type":"apk", "file":{"type":"pdf","url":"<https-url>"} }`。不同包体可以使用不同文件。删除某个包体的证明时，提交其余包体的完整列表；传 `[]` 表示全部清空，省略该字段表示保留。

`proof_file` 与 `package_types` 用于向指定包体添加同一份证明，不删除其他包体的文件；不能与 `proof_files` 同时传入。用户确认不提供 AI 服务时，设置 `provide_aigc_service=false`；是否删除已保存的证明须另行确认。

数组字段在 schema 允许时用 `[]` 清空；省略或 `null` 不猜删除。其他可选标量或禁止清空字段在没有明确删除契约时转开发者后台，不以空字符串冒充删除。版号/软著文本与扫描件成对补齐，AI 服务证明、防沉迷条件项按服务端完整性校验。
