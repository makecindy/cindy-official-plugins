# Qualification material fields

## 内容导航

- [资质类型](#资质类型)
- [构造原则](#构造原则)
- [常见示例](#常见示例)

## 适用场景

本文件只用于构造 `save-qualification-draft` 输入。最终字段和枚举始终以当前命令为准：

```text
call_tool(name:"schema", args:{_positional:["qualification","save-qualification-draft"]})
```

## 资质类型

| 业务名称 | `qualification_type` |
| --- | --- |
| 开发者认证 | `developer-certification` |
| 游戏版号 | `game-license` |
| ICP 备案 | `icp-filing` |
| 隐私合规 | `privacy-compliance` |
| 防沉迷 | `anti-addiction` |
| AI 内容声明 | `ai-declaration` |
| 软件著作权 | `software-copyright` |
| IP 授权书 | `authorization-letters` |
| 安全评估 | `security-assessment` |

## 构造原则

- `qualification.kind` 与 `qualification_type` 保持一致。
- 文件字段传对象 `{ "url": "<https-url>" }`；多文件字段传对象数组。
- 只有图片型材料需要先取 HTTPS URL：由 `taptap-materials` 执行图片上传获取；PDF 或其他非图片材料不走图片上传，改用已有 HTTPS 文件 URL 或开发者后台页面。
- 不使用页面表单别名，如 `privacyPolicyUrl`、`policyLink`。
- ICP 主体类型、主体名称、证件号和联系人字段不通过 CLI 传入；CLI 会拒绝这些字段并给出开发者后台资质页面链接。
- 不在命令、日志或对话里暴露身份证号、营业执照号、联系人等敏感信息；工具要求人工填写时转页面。

## 常见示例

游戏版号：

```json
{
  "qualification_type": "game-license",
  "qualification": {
    "kind": "game-license",
    "isbn": "<版号>",
    "isbn_file": { "url": "<https-url>" }
  }
}
```

APK ICP：

```json
{
  "qualification_type": "icp-filing",
  "qualification": {
    "kind": "icp-filing",
    "apk": {
      "icp_number": "<备案号>",
      "icp_file": { "url": "<https-url>" }
    }
  }
}
```

小游戏 ICP 包含主体敏感信息时，不在 CLI payload 中补齐；让 `save-qualification-draft` 返回人工填写分支，再使用当前开发者后台资质页面入口完成。

隐私合规：

```json
{
  "qualification_type": "privacy-compliance",
  "qualification": {
    "kind": "privacy-compliance",
    "privacy_qualification": {
      "privacy_policy_link": "https://example.com/privacy"
    }
  }
}
```

AI 内容声明：

```json
{
  "qualification_type": "ai-declaration",
  "qualification": {
    "kind": "ai-declaration",
    "aigc_qualification": {
      "provide_aigc_service": true,
      "proof_file": { "url": "<https-url>" },
      "package_types": ["apk"]
    }
  }
}
```

软件著作权：

```json
{
  "qualification_type": "software-copyright",
  "qualification": {
    "kind": "software-copyright",
    "copyright_number": "<登记号>",
    "copyright_file": { "url": "<https-url>" }
  }
}
```

IP 授权书：

```json
{
  "qualification_type": "authorization-letters",
  "qualification": {
    "kind": "authorization-letters",
    "power_of_attorneys_file": [
      { "url": "<https-url>" }
    ]
  }
}
```

安全评估：

```json
{
  "qualification_type": "security-assessment",
  "qualification": {
    "kind": "security-assessment",
    "safety_report_file": [
      { "url": "<https-url>" }
    ]
  }
}
```

防沉迷材料字段较多且会随游戏形态变化，不维护固定模板。每次先读 `schema <service> <method>`，按当前 schema 构造。
