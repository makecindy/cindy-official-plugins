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

APK ICP：

```json
{
  "qualification": {
    "qualification_type": "icp-filing",
    "icp_number": "<备案号>",
    "icp_file": { "type": "pdf", "url": "<https-url>" }
  }
}
```

小游戏 ICP 包含主体敏感信息时，不在 CLI payload 中补齐；让 `qualification save-qualification-draft` 返回人工填写分支，再使用当前开发者后台资质页面入口完成。

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
