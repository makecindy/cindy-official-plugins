<p align="right">
  <strong>简体中文</strong> · <a href="localization.md">English</a>
</p>

# 官方插件本地化契约

## 宿主是唯一语言来源

插件语言完全跟随 Cindy 宿主当前语言。插件不得读取 `navigator.language`、操作系统语言，
也不得保存独立的语言偏好。

宿主当前支持：

- `zh-CN`
- `en`
- `ja`
- `ko`

插件没有提供宿主当前语言时固定使用英文；宿主传入未知语言时同样使用英文。英文不是
可配置项，而是协议级兜底。

## Manifest 资源

每个官方插件在 `ghost.json` 中声明四种语言：

```json
{
  "locales": {
    "en": "locales/en.json",
    "zh-CN": "locales/zh-CN.json",
    "ja": "locales/ja.json",
    "ko": "locales/ko.json"
  }
}
```

locale 文件完整覆盖以下字段：

```json
{
  "name": "Plugin name",
  "description": "Description shown to the user.",
  "whenToUse": "Routing description shown to the Agent.",
  "tools": {
    "stable_tool_name": {
      "description": "Localized tool contract."
    }
  }
}
```

插件 id、command、tool name、参数名、枚举值和错误 code 都是稳定协议，不翻译。工具翻译
以稳定 tool name 为键，不依赖数组顺序。

## 宿主行为

Cindy 客户端负责：

1. 校验 `locales` 只包含四种受支持语言，且必须有 `en`。
2. 在 Forge 打包和安装时校验资源文件存在、是合法 JSON、单文件不超过 64KB，并完整
   覆盖清单已有字段与所有工具。
3. 使用宿主当前语言解析插件列表、详情（含声明能力）和 Agent 工具目录；安装与
   绑定来源的更新不再追加独立的能力确认弹窗。
4. 插件缺少目标语言、宿主语言不受支持，或已安装的目标资源损坏时，重新尝试英文资源。
5. 应用内切换语言后重新广播本地化插件清单，并重载已打开的插件设置页和面板。
6. 通过 `cindy.request({ kind: 'app-context' })` 和同源 `GET /app-context` 返回：

```json
{
  "ok": true,
  "context": {
    "region": "cn",
    "locale": "zh-CN"
  }
}
```

运行中的逻辑页还会收到 `host-context-changed` 消息。插件自绘页面或运行时文案需要动态
切换时，只读取这个 `locale`，并在自身不支持时选择英文资源。

## 当前实际覆盖范围

需要如实说明：**上述四语言资源目前只覆盖清单层**，即 `ghost.json` 的 `name` /
`description` / `whenToUse` 以及各 tool 的 `description` —— 也就是插件市场里的展示文案
和 Agent 读到的工具说明。

尚未覆盖的部分：

- **设置页与自绘面板**独立迁移。完成迁移的页面读取 `/app-context`、支持四种宿主
  语言并固定回退英文；现有页面仍在逐步迁移。
- **运行时面向用户的报错文案**（各插件 `main.js` 内）同样硬编码简体中文。

因此非中文宿主用户仍可能遇到中文运行时报错或尚未迁移的设置页。新插件应按上面的
自绘页契约实现，存量插件则逐步迁移。

## 仓库门禁

发布前必须确认：

- 每个官方插件（当前 14 个）都声明 `zh-CN / en / ja / ko`。数量不必写死在文档里，
  `.tests/localization.test.mjs` 会动态遍历所有含 `ghost.json` 的目录。
- 四种资源的字段和工具 key 完全一致，没有空值或占位文案。
- HTML/JS 不使用 `navigator.language`。
- 本地化内容变化同步递增 `ghost.json.version`。
