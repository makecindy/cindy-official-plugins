<p align="right">
  <strong>简体中文</strong> · <a href="CONTRIBUTING.md">English</a>
</p>

# 贡献指南

感谢你为 Cindy 官方插件贡献代码、文档和反馈。本仓库是官方插件（Ghost）的源码仓，
每个子目录就是一个完整的插件；Cindy 客户端与 Plugin Server 位于独立仓库，不在本仓库的
贡献范围内。

## 开始之前

- 先读 [README.zh-CN.md](README.zh-CN.md)：仓库结构、插件清单、审查标准和发布流程
  都以它为准，本指南不重复维护副本。
- 插件编写契约就在本仓库中：`README.zh-CN.md`、本指南、`.tests/contracts/` 中固定
  版本的 Manifest 校验器和打包门禁共同组成正本。无论用哪一种 Agent 或 harness
  创建文件都遵循同一契约；Cindy Forge 命令只是可选捷径。
- 增加 Manifest 字段前先判断谁执行：插件工具是否执行由既有 Agent 授权决定；普通
  HTTPS 与 workdir 操作使用 Host 下发的在途 `callId`，CLI 继续走已有 Node 工作进程。
  具体命令、域名或路径无需预登记；只有脱离该调用的插件自主 Host 能力才写入 `ghost.json`。
- 参与社区时请遵守 [`CODE_OF_CONDUCT.zh-CN.md`](CODE_OF_CONDUCT.zh-CN.md)；普通使用问题见
  [`SUPPORT.zh-CN.md`](SUPPORT.zh-CN.md)。
- 不要提交凭证、令牌、邮箱授权码、OAuth refresh token、个人数据或真实用户邮件内容——
  测试夹具一律用 `example.test`、`git.example.com` 这类占位域名和假 UUID。

## 开发与验证

从 [`README.zh-CN.md` 的「工具无关的快速路径」](README.zh-CN.md#工具无关的快速路径)
开始：

1. 对齐设计与最小能力后，使用普通文件操作在仓库根目录创建新的插件目录。
2. 从文档中的 Manifest v3 与 `main.js` 示例开始。**不要复制本仓现有插件的
   `ghost.json`**：未改动的官方插件可能刻意保留旧 v2 清单。现有源码只能用于参考
   实现方式。
3. 运行 `node scripts/validate-plugin-manifest.mjs ./<插件目录>` 校验 Manifest。
4. 把插件目录的**内容**（不是目录本身）压成 `.cindy` ZIP 包，并从 Cindy 本地插件
   入口导入这一个确切的包。
5. 如果当前 harness 提供 Cindy Forge 命令，可以用它替代手工脚手架/打包步骤；它不会
   改变源码格式和审查契约。安装仍然必须来自用户的明确要求。
6. 提交官方插件 PR 前，补充 `provisioning.json` 条目，并完成恰好 `zh-CN`、`en`、
   `ja`、`ko` 四份 locale 资源。

`.tests/` 下的 `*.test.mjs` 用 Node 内置 test runner 运行，例如：

```bash
node --test .tests/localization.test.mjs
```

`.tests/` 下的 `*.test.ts` 按 vitest 编写，但本仓目前没有接入 vitest（没有根
`package.json`），处于存档状态，接入 runner 之前无法直接运行。

改动任何插件的 `ghost.json` 或 `locales/` 后，**必须**跑一遍
`node --test .tests/localization.test.mjs`——发布流水线会在打包前执行同一份检查，
四语言（`zh-CN` / `en` / `ja` / `ko`）资源不完整会直接拦下整次发布。

CI 还会在本仓检查每份 `ghost.json`，并按 Server / Desktop 交付限制的交集验证最终
`.cindy` 包，包括文本长度、声明文件、安全路径、包大小和条目数。贡献者无需 checkout
其他仓库。

带 Node Worker 的插件（`163-mail`、`icloud-mail`、`qq-mail`）的 `node/worker.cjs` 是
esbuild 产物，不要手改。改 `src/` 后在插件目录里重新构建并把产物一起提交：

```bash
cd 163-mail && npm ci && npm run build
```

如果这次改动引入或升级了内嵌依赖，同步更新该插件目录下的 `THIRD-PARTY-LICENSES.txt`
（列出全部内嵌包、版本和完整许可证文本，双许可要写明选用哪一个）。

`taptap-maker/vendor/taptap-maker/` 是随包分发的官方 `@taptap/maker` npm 包，升级时
整体替换发布内容，不要手改生成的 `dist/maker.js`。

## 提交 Pull Request

1. 从最新的 `main` 创建短生命周期分支，保持一个 PR 只解决一个清晰的问题。
2. PR 标题使用 `<type>(<scope>): <简短描述>`，scope 一般写插件目录名，例如
   `fix(qq-mail): 校验移动结果`。type 取
   `feat` / `fix` / `refactor` / `perf` / `chore` / `docs` / `test` / `revert` /
   `build` / `ci`。
3. **改动插件内容必须在同一个 PR 里 bump `ghost.json` 的 `version`。** 新的
   `major.minor.patch` SemVer 必须大于 `main` 上的当前版本，否则 CI 会阻止合并。
   同一个改动还必须把现有 v2 清单迁移为 `schemaVersion: 3`：增加
   `minCindyVersion`、移除 `slots`，并用对应顶层字段表达等价能力。`minCindyVersion`
   应填写支持这个具体插件所需 Host 能力与 Manifest 字段的第一个 Cindy 正式稳定版本；
   Manifest v3 本身不设置仓库级 Cindy 版本下限。
   未改动的 v2 插件刻意保持原样，禁止批量迁移。
   Plugin Server 按用户当前 Cindy 版本选择最近曾上架的兼容 Release；current 不兼容时
   回退到兼容历史版本，没有兼容历史版本时不展示该插件。
   Desktop 以该 Server 选择为准，不再追加 `minCindyVersion` 二次筛选或安装确认，
   因此必须准确填写这个字段。
4. 改动 `ghost.json` 的工具声明（`tools[].description` / 参数）时，在 PR 描述里说明对
   Agent 行为的影响——这段描述就是 Agent 读到的使用手册。每个改动插件都必须先在
   运行正式稳定版 Cindy 的实际设备上安装真实 `.cindy` 包并验证核心功能，再勾选 PR
   的生产版 Cindy 验证项；插件声明 `minCindyVersion` 时，验证所用 Cindy 版本必须
   不低于该最低版本。降低或删除该字段会扩大声称支持的范围，必须交维护者人工 review。

每个非草稿 PR 都会由 `Verify pull request` workflow 验证：跑 Server / Desktop 交付
契约、localization 与 provisioning 门禁、跑每个被改动插件的 `*.test.mjs` 测试（先装
该插件的依赖），并用与发布流水线完全相同的打包步骤做 dry-run。只要 PR 改动了插件
包，CI 还会要求 PR Body 勾选生产版 Cindy 验证项。真正上传仍只在合入 `main` 后发生。

5. Review 完整 diff，确认没有凭证、无关生成文件或误提交的 `node_modules`。
6. 等待 review；不要直接向 `main` 推送。合并到 `main` 后区域 Workflow 会把改动包提交
   到 Plugin Platform；CN / Global 独立审核，只有对应区域批准后才会在该区客户端可见。
7. 成对的双语文档必须同 PR 同步：改动 `README.md`、`CONTRIBUTING.md` 或任何有
   `.zh-CN` 对应版本的文档时，两份必须在同一个 PR 内一起更新，反之亦然。只改
   一边的 PR 不予合并。

Bug 修复和小改进可以直接提 PR。新官方插件请先开 issue 讨论定位与边界（避免与现有插件
重叠），对齐后再提 PR。

## 贡献的许可与署名（DCO）

本仓库使用 [Apache-2.0](LICENSE) 许可证。按照其第 5 条，你有意提交到本仓库的任何
贡献，默认按 Apache-2.0 的条款并入并对外分发，无需额外签署 CLA。

我们要求每个 commit 通过 [Developer Certificate of Origin](https://developercertificate.org/)
声明来源合法（DCO 1.1 全文见仓库根的 [`DCO`](DCO) 文件）：提交时使用 `git commit -s`，
在 commit message 末尾生成 `Signed-off-by: 你的名字 <你的邮箱>` 行，表示你有权按上述
条款提交这份贡献。签名里的**名字和邮箱都**必须与该 commit 的 author（或 committer）
一致——这一行是本人声明，不能替别人签。请不要提交你无权授权的代码（例如未经许可
复制的专有代码）。

PR 上的 **DCO check**（[DCO GitHub App](https://github.com/apps/dco)）会校验这个 PR
的每个 commit，merge commit 与 bot 提交豁免，不追溯 DCO 生效前的历史提交。本地可以
提前自查每个 commit 的 author 与签名是否对得上：

```bash
git log origin/main..HEAD --format='%h %an <%ae>%n  %(trailers:key=Signed-off-by,valueonly)'
```

漏签时补签：

```bash
# 只有最新一个 commit 漏签
git commit --amend -s --no-edit

# 多个 commit 漏签（<base> 用 PR 的 base commit）
git rebase --signoff <base>

# 改完后更新 PR
git push --force-with-lease
```

如果不想改写历史（例如 PR 上已经有想保留的 review 讨论），可以改推一个
**remediation commit**：正文里包含下面这行原样格式，其中 sha 是被补签 commit 的完整
40 位 sha，并且这个 commit 自己也要带签名。

```text
I, 你的名字 <你的邮箱>, hereby add my Signed-off-by to this commit: <40 位完整 sha>

Signed-off-by: 你的名字 <你的邮箱>
```

两个 commit 的 author 以及这行里的名字、邮箱必须完全一致。替别人的 commit 补签用：

```text
On behalf of 原作者 <原作者邮箱>, I, 你的名字 <你的邮箱>, hereby add my Signed-off-by to this commit: <40 位完整 sha>

Signed-off-by: 你的名字 <你的邮箱>
```

`git commit` 本身没有「自动签名」的配置项（`format.signOff` 只作用于
`git format-patch` / `git am`），所以要么每次带 `-s`，要么自己装一个
`prepare-commit-msg` hook。

## 安全问题

不要在公开 issue、PR 或讨论中披露漏洞、凭证或可利用细节。请按
[SECURITY.zh-CN.md](SECURITY.zh-CN.md) 的流程私下报告。英文版见
[SECURITY.md](SECURITY.md)。
