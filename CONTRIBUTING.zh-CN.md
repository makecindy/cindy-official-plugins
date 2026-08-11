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
- 完整的插件编写契约（`ghost.json` 全字段、卡槽、`cindy.send` 管子 API、打包流程）由
  Cindy 客户端内置的 `ghost_forge_guide` 工具返回——在 Cindy 对话里说「帮我做一个插件」
  即可拿到当时版本的手册。
- 参与社区时请遵守 [`CODE_OF_CONDUCT.zh-CN.md`](CODE_OF_CONDUCT.zh-CN.md)；普通使用问题见
  [`SUPPORT.zh-CN.md`](SUPPORT.zh-CN.md)。
- 不要提交凭证、令牌、邮箱授权码、OAuth refresh token、个人数据或真实用户邮件内容——
  测试夹具一律用 `example.test`、`git.example.com` 这类占位域名和假 UUID。

## 开发与验证

典型流程：

1. 用客户端的 `ghost_forge_scaffold` 生成骨架，或直接照抄本仓任一插件的目录结构。
2. 在开发环境里导入插件目录或 `.cindy` 包验证。
3. 完成后用 `ghost_forge_pack` 打成 `.cindy` 安装验证。

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
4. 改动 `ghost.json` 的工具声明（`tools[].description` / 参数）时，在 PR 描述里说明对
   Agent 行为的影响——这段描述就是 Agent 读到的使用手册。新增或提高
   `minCindyVersion` 时，还要记录真实 `.cindy` 包在该精确 Cindy 版本的安装结果；降低
   或删除该字段会扩大声称支持的范围，必须交维护者人工 review。

每个非草稿 PR 都会由 `Verify pull request` workflow 验证：跑 Server / Desktop 交付
契约、localization 与 provisioning 门禁、跑每个被改动插件的 `*.test.mjs` 测试（先装
该插件的依赖），并用与发布流水线完全相同的打包步骤做 dry-run。真正上传仍只在合入
`main` 后发生。

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
