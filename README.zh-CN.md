# Cindy Official Plugins

<p align="center">
  <a href="README.md">English</a> · <strong>简体中文</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License" /></a>
  <a href="https://github.com/makecindy/cindy-official-plugins/actions/workflows/pr-verify.yml"><img src="https://github.com/makecindy/cindy-official-plugins/actions/workflows/pr-verify.yml/badge.svg" alt="Verify pull request" /></a>
  <a href="https://github.com/makecindy/cindy-official-plugins/actions/workflows/publish-cindy-plugins.yml"><img src="https://github.com/makecindy/cindy-official-plugins/actions/workflows/publish-cindy-plugins.yml/badge.svg" alt="Publish (CN)" /></a>
  <a href="https://github.com/makecindy/cindy-official-plugins/actions/workflows/publish-cindy-plugins-global.yml"><img src="https://github.com/makecindy/cindy-official-plugins/actions/workflows/publish-cindy-plugins-global.yml/badge.svg" alt="Publish (Global)" /></a>
  <a href="CONTRIBUTING.zh-CN.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs welcome" /></a>
</p>

<p align="center">
  🌐 <a href="https://cindy.cn">中国大陆</a> | <a href="https://cindy.app">国际版</a>
  &nbsp;·&nbsp;
  ⬇️ <a href="https://cindy.cn/#download">下载</a> | <a href="https://cindy.app/#download">Download</a>
</p>

这里是 [Cindy](https://github.com/makecindy/cindy) 插件市场中**全部官方插件
（Ghost）的源码仓库**。

- **正在用 Cindy？** 不需要本仓库——在 Cindy 客户端打开「插件」页，下方已
  全量开放的插件都可以一键安装（标注「定向灰度」的仍在分批放量，暂未对所有
  人开放）。
- **想给 Cindy 写插件？** 本仓库接受外部贡献：PR 合入 `main` 后自动发布上架，
  通常几分钟内出现在插件市场。从[提交你的插件](#提交你的插件)开始。

## 插件列表

|  | 插件 | 目录 | 说明 |
| --- | --- | --- | --- |
| <img src="./cindy-art/assets/icon.png" width="22" alt=""> | Art | [`cindy-art`](./cindy-art) | 图片 / 短视频生成，支持基于已生成图片的改图与风格化 |
| <img src="./cindy-github/assets/icon.png" width="22" alt=""> | GitHub | [`cindy-github`](./cindy-github) | GitHub issue / PR / code review / Actions / release 全流程操作 |
| <img src="./cindy-gitlab/assets/icon.png" width="22" alt=""> | GitLab | [`cindy-gitlab`](./cindy-gitlab) | GitLab（gitlab.com 及自建实例）issue / MR / 仓库操作 |
| <img src="./cindy-mermaid/assets/icon.jpg" width="22" alt=""> | Mermaid | [`cindy-mermaid`](./cindy-mermaid) | Mermaid 图表源码规范化与常见语法修复 |
| <img src="./cindy-notion/assets/icon.png" width="22" alt=""> | Notion | [`cindy-notion`](./cindy-notion) | Notion 页面、数据库与知识库读写 |
| <img src="./cindy-web-search/assets/icon.png" width="22" alt=""> | Web Search | [`cindy-web-search`](./cindy-web-search) | 公网搜索（Brave / Tavily / Search1API，用户自备 API key） |
| <img src="./world-bank-open-data/assets/icon.png" width="22" alt=""> | 世界银行公开数据 | [`world-bank-open-data`](./world-bank-open-data) | 无需 API Key，查询全球国家、经济、社会与发展指标；定向灰度 |
| <img src="./google-gmail/assets/icon.png" width="22" alt=""> | Gmail | [`google-gmail`](./google-gmail) | 搜索、阅读、整理 Gmail 邮件，生成草稿或发送邮件；授权由宿主托管 |
| <img src="./google-drive/assets/icon.png" width="22" alt=""> | Google Drive | [`google-drive`](./google-drive) | 搜索、读取、下载、上传、移动和删除云端文件 |
| <img src="./google-calendar/assets/icon.png" width="22" alt=""> | Google Calendar | [`google-calendar`](./google-calendar) | 查询日程与空闲时间，创建或修改会议 |
| <img src="./google-sheets/assets/icon.png" width="22" alt=""> | Google Sheets | [`google-sheets`](./google-sheets) | 列出工作表、读取范围并写入单元格 |
| <img src="./163-mail/assets/icon.png" width="22" alt=""> | 163 邮箱 | [`163-mail`](./163-mail) | 通过 IMAP/SMTP 搜索、阅读、整理、撰写和发送 163 邮箱邮件 |
| <img src="./icloud-mail/assets/icon.png" width="22" alt=""> | iCloud Mail | [`icloud-mail`](./icloud-mail) | Cindy 安全保存 App 专用密码，按需通过 IMAP/SMTP 管理邮件 |
| <img src="./qq-mail/assets/icon.png" width="22" alt=""> | QQ 邮箱 | [`qq-mail`](./qq-mail) | Cindy 安全保存授权码，按需通过 IMAP/SMTP 搜索、阅读、整理和发送 |
| <img src="./taptap-maker/assets/icon.png" width="22" alt=""> | TapTap Maker | [`taptap-maker`](./taptap-maker) | 账号连接、项目同步、构建与官方动态工具 |
| <img src="./x-manager/assets/icon.png" width="22" alt=""> | X Manager | [`x-manager`](./x-manager) | 在 X（Twitter）上搜舆情、发帖——xAI x_search，Grok 订阅 / API key 双通道降级，发帖走 X 官方 API v2；目前定向灰度中 |

想要的插件不在这里？[提议一个](#提交你的插件)——或者自己写一个提交上来。

## 提交你的插件

从想法到上架的完整路径：

1. **想法**——先对照上表确认不重叠。官方插件避免场景重复；同一服务商的产品
   家族（Gmail / Drive / Calendar）、同一协议的不同服务商（163 / iCloud / QQ
   邮箱）属合理共存，但「又一个通用网页搜索」不是。
2. **对齐**——开一个
   [新插件提案 issue](https://github.com/makecindy/cindy-official-plugins/issues/new?template=new_plugin_proposal.yml)，
   说明场景、边界和所需能力（网络域名、凭证类型、是否需要 Node Runtime）。
   **拿到维护者确认后再动手写代码**——避免做出重叠或不会被接受的东西。
3. **开发**——在 Cindy 对话里说「帮我做一个插件」即可拿到完整编写手册
   （`ghost_forge_guide`：`ghost.json` 全字段、卡槽、`cindy.send` 管子 API、
   打包流程）。用 `ghost_forge_scaffold` 生成骨架或参考本仓任一插件；dev
   环境下导入插件目录或 `.cindy` 包验证。
4. **提交 PR**——标题 `feat(<目录名>): …`；bump `ghost.json.version`；补
   `provisioning.json` 条目；四语言 locale（`zh-CN` / `en` / `ja` / `ko`）
   齐全；每个 commit 带签名（`git commit -s`，[DCO](./DCO)）。细节见
   [`CONTRIBUTING.zh-CN.md`](./CONTRIBUTING.zh-CN.md)。
5. **审查**——CI 自动跑本地化 / provisioning 门禁与打包 dry-run；自动 review
   按 [`.greptile/rules.md`](./.greptile/rules.md) 的完整规则执行；维护者按
   同一套[审查标准](#审查标准)人工审查。请求 review 前先过一遍下方自查清单。
6. **上架**——合入 `main` 后 CN / Global 双区发布 Workflow 自动发布，无任何
   人工上架环节，通常几分钟内出现在插件市场。

## 审查标准

每个官方插件都会被真实用户安装，安全与体验风险由用户承担，因此审查从严。
四条硬原则：

1. **默认纯沙箱、能力显式声明**：普通插件运行在 Cindy 的隔离沙箱中，只能使用
   `ghost.json` 声明的网络白名单与主机通道。确需 Node Runtime 的官方插件必须
   显式声明 `node` slot、固定入口和最小子进程边界。
2. **密钥归属明确**：普通 API token 通过主机的 `/secrets` 只写通道保存；Node
   插件需明文凭证时，用 `node.secretBindings` 将其限制到指定 Worker 方法并由
   宿主临时注入，不经过浏览器 `main.js`、Agent 参数或日志。若官方第三方
   Runtime 自己管理账号凭证（如 TapTap Maker），插件只负责把凭证交给
   Runtime，不复制到 Cindy KV/Secret，也不在日志或页面状态中保留明文。
3. **工具描述即契约**：`ghost.json` 里每个 tool 的 `description` 是给 Agent
   看的使用说明，必须准确描述行为边界（做什么、不做什么、返回什么、有何
   副作用）。
4. **错误信息说人话**：面向用户的报错要可行动（例如 401 → 提示去哪里填
   token），不要裸抛 HTTP 状态码。

### 请求 review 前的自查清单

- [ ] `ghost.json` 只声明实际用到的网络域名与主机通道；非必要不声明 `node` slot
- [ ] Node 插件：显式 `node` slot、固定入口、最小子进程边界；`node/worker.cjs`
      是随 `src/` 重建的 esbuild 产物
- [ ] 任何地方无明文凭证：token 走 `/secrets` 只写通道或 `node.secretBindings`；
      不经过 `main.js`、Agent 参数、日志、KV、页面状态
- [ ] 有不可逆外发副作用的工具（发送 / 发帖 / 删除）在每条失败路径上区分
      「确定未执行 / 确定已执行 / 不确定」三态，不确定态不提示盲目重试
- [ ] 每个 tool 的 `description` 与实际行为一致——能力、限制、返回值、副作用
- [ ] 面向用户的报错可行动；无裸状态码、无英文堆栈
- [ ] 四语言 locale 齐全；`node --test .tests/localization.test.mjs` 通过
- [ ] `ghost.json.version` 已 bump；`provisioning.json` 有对应条目且 PR 描述里
      写明 audience 决策
- [ ] diff 中无凭证、真实用户数据、`node_modules` 或无关生成文件；fixture 用
      `example.test` 类占位域名
- [ ] 内嵌依赖有增减或升级的已同步 `THIRD-PARTY-LICENSES.txt`
- [ ] 每个 commit 带 DCO 签名（`git commit -s`）

机器与人工共用的完整审查契约见 [`.greptile/rules.md`](./.greptile/rules.md)
——自动 review 会在每个 PR 上执行，维护者按同一标准把关。

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

`.tests/` 目录存放插件行为测试；`*.test.mjs` 用 Node 内置 test runner 运行
（`node --test .tests/<文件>.test.mjs`），同时支撑 PR 校验 Workflow 与发布门禁。
验证流程见 [`CONTRIBUTING.zh-CN.md`](./CONTRIBUTING.zh-CN.md)。

官方插件已接入宿主驱动的 `zh-CN / en / ja / ko` locale 资源；语言选择与英文兜底契约见
[`docs/localization.zh-CN.md`](./docs/localization.zh-CN.md)。共享资源覆盖清单层；
自绘设置页正独立迁移到同一套宿主语言契约，运行时报错文案目前仍以中文单语为主。

## 自动发布

一句话：**合入 `main` 即自动双区发布，没有任何人工上架环节。**

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

## 本地开发

插件编写的完整契约（`ghost.json` 全字段、卡槽、`cindy.send` 管子 API、打包流程）以 Cindy 客户端内置的 `ghost_forge_guide` 工具返回的手册为准 —— 在 Cindy 对话里说"帮我做一个插件"即可现拿现读。

常用流程：

1. 用客户端的 `ghost_forge_scaffold` 生成骨架，或直接参考本仓任一插件的写法。
2. dev 环境下直接导入插件目录或 `.cindy` 包验证。
3. 完成后用 `ghost_forge_pack` 打包成 `.cindy` 装入验证。

`taptap-maker/vendor/taptap-maker/` 固定随插件分发官方
`@taptap/maker@0.0.28`。升级时应整体替换 npm 包发布内容并同步更新插件版本，
不要单独修改生成后的 `dist/maker.js`。

## 社区

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
