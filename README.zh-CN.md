# Cindy Official Plugins

<p align="center">
  <a href="README.md">English</a> · <strong>简体中文</strong>
</p>

Cindy 官方公开插件（Ghost）源码仓库。每个插件进入 `main` 后由 GitHub Actions
使用 OIDC 发布到 Cindy Plugin Server，客户端从插件市场发现并安装，不再通过
submodule 随桌面端打包或在启动时播种。

## 插件列表

| 插件             | 目录                                     | 说明                                                           |
| ---------------- | ---------------------------------------- | -------------------------------------------------------------- |
| Art              | [`cindy-art`](./cindy-art)               | 图片 / 短视频生成，支持基于已生成图片的改图与风格化            |
| GitHub           | [`cindy-github`](./cindy-github)         | GitHub issue / PR / code review / Actions / release 全流程操作 |
| GitLab           | [`cindy-gitlab`](./cindy-gitlab)         | GitLab（gitlab.com 及自建实例）issue / MR / 仓库操作           |
| Mermaid          | [`cindy-mermaid`](./cindy-mermaid)       | Mermaid 图表源码规范化与常见语法修复                           |
| Notion           | [`cindy-notion`](./cindy-notion)         | Notion 页面、数据库与知识库读写                                |
| Web Search       | [`cindy-web-search`](./cindy-web-search) | 公网搜索（Brave / Tavily，用户自备 API key）                   |
| Gmail            | [`google-gmail`](./google-gmail)         | 搜索、阅读、整理 Gmail 邮件，生成草稿或发送邮件；授权由宿主托管 |
| Google Drive     | [`google-drive`](./google-drive)         | 搜索、读取、下载、上传、移动和删除云端文件                     |
| Google Calendar  | [`google-calendar`](./google-calendar)   | 查询日程与空闲时间，创建或修改会议                             |
| Google Sheets    | [`google-sheets`](./google-sheets)       | 列出工作表、读取范围并写入单元格                               |
| 163 邮箱         | [`163-mail`](./163-mail)                 | 通过 IMAP/SMTP 搜索、阅读、整理、撰写和发送 163 邮箱邮件       |
| iCloud Mail      | [`icloud-mail`](./icloud-mail)           | Cindy 安全保存 App 专用密码，按需通过 IMAP/SMTP 管理邮件        |
| QQ 邮箱          | [`qq-mail`](./qq-mail)                   | Cindy 安全保存授权码，按需通过 IMAP/SMTP 搜索、阅读、整理和发送 |
| TapTap Maker     | [`taptap-maker`](./taptap-maker)         | 账号连接、项目同步、构建与官方动态工具                         |

## 仓库结构

每个子目录就是一个完整的插件（"意识包"）源码：

```
cindy-github/
├── ghost.json      # 身份卡:插件 id、描述、工具声明、网络与密钥声明
├── main.js         # 入口:沙箱内运行的插件逻辑
├── settings.html   # (可选) 设置页,如粘贴 API token
├── settings.js
└── assets/         # (可选) 图标等静态资源
cindy-art/
├── ghost.json
├── main.js
└── panel.*         # (可选) 自定义面板 UI
```

根目录的 `provisioning.json` 按插件声明哪些受众会把它作为内置插件装上。每个插件目录
都有对应条目，因此新增插件时也要同步加一行。

`.tests/` 目录存放插件行为测试，用 Node 内置 test runner 运行
（`node --test .tests/<文件>.test.mjs`）。其中 `localization.test.mjs` 不只是本地检查
—— 两个发布 Workflow 都会在打包前把它作为门禁执行。

## 设计原则

官方插件遵循几条硬约束，PR 也会按这些标准审查：

1. **默认纯沙箱、能力显式声明**：普通插件运行在 Cindy 的隔离沙箱中，只能使用 `ghost.json` 声明的网络白名单与主机通道。确需 Node Runtime 的官方插件必须显式声明 `node` slot、固定入口和最小子进程边界。
2. **密钥归属明确**：普通 API token 通过主机的 `/secrets` 只写通道保存；Node 插件需明文凭证时，用 `node.secretBindings` 将其限制到指定 Worker 方法并由宿主临时注入，不经过浏览器 `main.js`、Agent 参数或日志。若官方第三方 Runtime 自己管理账号凭证（如 TapTap Maker），插件只负责把凭证交给 Runtime，不复制到 Cindy KV/Secret，也不在日志或页面状态中保留明文。
3. **工具描述即契约**：`ghost.json` 里每个 tool 的 `description` 是给 Agent 看的使用说明，必须准确描述行为边界（做什么、不做什么、返回什么）。
4. **错误信息说人话**：面向用户的报错要可行动（例如 401 → 提示去哪里填 token），不要裸抛 HTTP 状态码。

官方插件已接入宿主驱动的 `zh-CN / en / ja / ko` locale 资源；语言选择与英文兜底契约见
[`docs/localization.zh-CN.md`](./docs/localization.zh-CN.md)。注意目前只覆盖清单层（插件名／描述与
工具描述）—— 设置页和运行时报错文案仍是中文单语，欢迎贡献补齐。

## 本地开发

插件编写的完整契约（`ghost.json` 全字段、卡槽、`cindy.send` 管子 API、打包流程）以 Cindy 客户端内置的 `ghost_forge_guide` 工具返回的手册为准 —— 在 Cindy 对话里说"帮我做一个插件"即可现拿现读。

常用流程：

1. 用客户端的 `ghost_forge_scaffold` 生成骨架，或直接参考本仓任一插件的写法。
2. dev 环境下直接导入插件目录或 `.cindy` 包验证。
3. 完成后用 `ghost_forge_pack` 打包成 `.cindy` 装入验证。

`taptap-maker/vendor/taptap-maker/` 固定随插件分发官方
`@taptap/maker@0.0.26`。升级时应整体替换 npm 包发布内容并同步更新插件版本，
不要单独修改生成后的 `dist/maker.js`。

## 自动发布

共有两个发布 Workflow，都只允许从 `main` 发布：

- [`publish-cindy-plugins.yml`](./.github/workflows/publish-cindy-plugins.yml) ——
  `Publish Cindy Plugins (CN)`
- [`publish-cindy-plugins-global.yml`](./.github/workflows/publish-cindy-plugins-global.yml) ——
  `Publish Cindy Plugins (Global)`

两者均已启用，行为完全一致：

- `main` 的普通 push 只发布本次发生变化的插件目录；没有触及任何插件目录的 push 不会
  发布任何东西。
- Actions 页面手动运行会全量发布当前全部插件，供仓库迁移后首次建档或显式重发使用。
- 各自通过 GitHub Actions OIDC（audience `cindy-plugin`）发布到由仓库 Secret 提供的
  端点。两次运行独立打包、独立执行、独立汇报，一边失败不影响另一边的 Workflow 状态。
  仓库不提供 Dev 发布 Workflow。

由于两者由同一次 push 触发，一次改动插件的合并会产生两个 Release —— 每个区域一个。

修改插件内容时必须同步更新 `ghost.json.version`。同一版本内容不同会被服务端以
`RELEASE_VERSION_CONFLICT` 拒绝，不会覆盖既有 Release。

## 参与贡献

**欢迎提交 PR！** 无论是修 bug、改进现有插件，还是提议新的官方插件。

- **修 bug / 小改进**：直接提 PR，描述清楚改了什么、为什么。
- **新增官方插件**：建议先开 issue 讨论定位与边界（避免与现有插件职责重叠），达成一致后再提 PR。
- 合入 `main` 后由发布 Workflow 自动同步到 Cindy 插件市场。

提 PR 前请读 [`CONTRIBUTING.zh-CN.md`](./CONTRIBUTING.zh-CN.md)：其中包含 PR 标题规范、必须同步
bump `ghost.json.version` 的要求、本地化检查、内嵌 Node Worker 的重新构建方式，以及
每个 commit 都需要的 [DCO](./DCO) 签名（`git commit -s`）。

参与社区请遵守 [`CODE_OF_CONDUCT.zh-CN.md`](./CODE_OF_CONDUCT.zh-CN.md)。使用问题以及提 issue
需要附上的信息见 [`SUPPORT.zh-CN.md`](./SUPPORT.zh-CN.md)。

安全漏洞请勿通过公开 issue 披露，报告渠道见 [SECURITY.zh-CN.md](./SECURITY.zh-CN.md)。

## License

本仓库代码以 [Apache License 2.0](./LICENSE) 开源。

Copyright 2026 心动网络股份有限公司 (X.D. Network Inc.)，见 [`NOTICE`](./NOTICE)。

打包产物中包含的第三方开源组件，其许可证归属见对应插件目录：

- `qq-mail/THIRD-PARTY-LICENSES.txt` — `node/worker.cjs` 内嵌依赖的完整许可证文本
- `163-mail/THIRD-PARTY-LICENSES.txt` — 同上，163 邮箱插件的内嵌依赖
- `icloud-mail/THIRD-PARTY-LICENSES.txt` — 同上，iCloud Mail 插件的内嵌依赖
- `taptap-maker/vendor/taptap-maker/LICENSE` — vendored `@taptap/maker`（MIT）

Apache-2.0 不授予商标权。本仓库插件是对所连接服务的非官方集成，第三方名称与标志归其
各自所有者所有 —— 见 [`TRADEMARKS.zh-CN.md`](./TRADEMARKS.zh-CN.md)。
