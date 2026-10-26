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
- 字段映射与具体运行时调用见[插件编写与迁移参考](docs/plugin-authoring.zh-CN.md)。
  执行任务的 Agent 根据现有代码处理适配，作者不需要自行提供迁移步骤。
- 增加 Manifest 字段前先判断谁执行：插件工具是否执行由既有 Agent 授权决定；普通
  HTTPS 与 workdir 操作使用 Host 下发的在途 `callId`，CLI 继续走已有 Node 工作进程。
  具体命令、域名或路径无需预登记；脱离该调用的插件自主 Host 能力须有对应声明。
  随包 Node 入口与 Host 托管凭证即使在工具调用内使用，也仍需显式声明。
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

大型预编译依赖按[依赖接入指南](docs/binary-dependencies.zh-CN.md)迁移：本地保留输出
调试，Git 只提交源码、声明和许可证，CI 下载并打包。Python 不是本地开发前置条件。
可以先开 Ready PR，从 **Verify pull request** 的 Artifacts 取得测试包。包保留
7 天，未审核，不进入 Platform/OSS。测试和打包必须通过；不再用实机勾选项把技术
CI 判红，也不按维护者身份豁免验证。真实运行证据由 reviewer 按受影响场景核对，
可由作者或维护者提供。CI 绿灯不代表已实测。

**提交后会发生什么：**

- **Verify pull request** 在源码推送时以只读权限运行，不接触发布密钥。首次 fork
  运行可能需要维护者批准；这属于维护者待办，作者无需改代码。
- **PR contributor guidance** 保持一条评论，提示 DCO 与 fork 运行待办；按当前
  commit 列表重算，支持 DCO 补签，不要求改写历史。它只读取元数据，不执行 PR 代码。
- PR 编辑会刷新引导与验证（包括目标分支变更）。运行记录可放正文或链接的
  评论里，不要求固定措辞、checkbox 或重复抄写产物哈希。记录真实版本/环境、场景和
  未测项；沿用旧证据时说明此后完整差异的适用范围，受影响场景仍需补测。
- required checks、有效 review 与必要验收齐全后，已授权的合并程序可以执行，
  无需再问一次“合”。普通打包脚本、依赖或图片修改不因路径转人工。符合下方标准的
  准入与受众不另要维护者批准。实际扩大权限、凭证或发布信任，未声明的网络访问，
  以及重命名或删除已发布插件，仍需维护者对具体范围的明确决定；已覆盖的范围不重复索要。
  插件用到或依赖 Cindy 本体授权的，说明还须写明依赖哪项、平台是否已批准、宿主是否
  已发布。本体授权有变化或未就绪先不合。其它符合现有标准的改动仍直接判定。
- 合并前应核对当前目标分支及其组合结果；改 PR 的目标分支后需重新验证，不能沿用
  旧目标的检查。合并与公开上架是不同阶段。

完整判定口径见 [审查规则](.greptile/rules.md)。

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
   `minCindyVersion`、移除 `slots`，并用对应顶层字段表达等价能力。按
   [映射表](docs/plugin-authoring.zh-CN.md#manifest-v2-到-v3保留行为转换表达)
   保留 `card`、`sessionContext` 等纯声明能力；仅删除 `slots` 不算完成迁移。`minCindyVersion`
   应填写支持这个具体插件所需 Host 能力与 Manifest 字段的第一个已发布的 Cindy 版本（正式稳定版或 Beta 版）；
   Manifest v3 本身不设置仓库级 Cindy 版本下限。
   未改动的 v2 插件刻意保持原样，禁止批量迁移。
   Plugin Server 按用户当前 Cindy 版本选择最近曾上架的兼容 Release；current 不兼容时
   回退到兼容历史版本，没有兼容历史版本时不展示该插件。
   Desktop 以该 Server 选择为准，不再追加 `minCindyVersion` 二次筛选或安装确认，
   因此必须准确填写这个字段。
   `ghost.json.releaseNotes` 更新摘要**可选，推荐在版本更新时填写**。
   填写时使用描述本版变化的纯文本字符串；缺失或留空不阻止校验与发布。
   详见[更新摘要说明](docs/plugin-authoring.zh-CN.md#更新摘要可选推荐填写)。
4. 改动工具声明时说明对 Agent 行为的影响。按审查规则提供受影响路径的真实验证，
   未受影响路径可沿用有效证据；准确标注环境与兼容限制。降低/删除 `minCindyVersion`
   仍需维护者审查扩大的支持范围及相关旧版本证据。
   除插件自己申请的 scope 外，写明它用到或依赖的 Cindy 本体授权：哪一项、平台是否
   已批准、宿主是否已发布。本体授权有变化或未就绪先不合。需要申请的范围一起规划，
   用不上的不要申请。只有会被平台安全审核卡住的这类授权才这样等。

每个非草稿 PR 的 **Verify pull request** 会运行 Server/Desktop 交付契约、localization、
provisioning、改动插件的定向测试与实际试打包。不解析实机勾选，也不按身份豁免。
国内上传保持移除；合并或从 main 手动触发后，海外向 Platform 提交待审包。

5. Review 完整 diff，确认没有凭证、无关生成文件或误提交的 `node_modules`。
6. 等待 review；不要直接向 `main` 推送。合入后，变更包会提交到海外 Plugin Platform，
   批准后的 release 才会对兼容客户端可见。国内推包逻辑保持移除。
7. 成对的双语文档必须同 PR 同步：改动 `README.md`、`CONTRIBUTING.md` 或任何有
   `.zh-CN` 对应版本的文档时，两份必须在同一个 PR 内一起更新，反之亦然。只改
   一边的 PR 不予合并。

Bug 修复和小改进直接提 PR。新插件、新内置供应商和 audience 变更按下面的标准
直接判定。符合标准不另要维护者批准。提案 issue 或 Draft PR 可以记录设计，不是
批准门禁，也不必重复开提案。

### 准入与受众

按同一标准直接判定。有用但够不上 `all` 时按自选接受，不要搁成个案待决定。

1. `all`（装给所有人）：多数用户受益；开箱即用，无需自备第三方密钥或账号；
   不绑定某一个人或某一个团队的流程；质量稳定。热度或投稿数量本身不能作为
   `all` 的理由。
2. 自选接受（`provisioning.json` 的 audience 为 `{ "emails": [] }`，用户在市场
   自行选择）：有用但小众，或需要用户自己的密钥或账号。
3. 不予接受：非常个人（只服务作者自己的数据、流程或私有服务）；纯演示或示例
   （改放到 `docs/`）；或 Agent 不装插件就能直接完成的事。

`author` 必须是真实作者，不得冒充官方团队。与标准不符是具体审查意见。只有真实
边界扩大才需要维护者的明确决定：实际扩大权限、凭证或发布信任；未声明的网络访问；
重命名或删除已发布插件。

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

### 预编译依赖

使用 [binary-dependencies.json](docs/binary-dependencies.zh-CN.md) 按需收集大依赖，
小二进制仍可直接入仓，不接受自定义构建钩子。每个插件直接入仓的二进制按所有平台
合计，上限 10 MiB。新插件或新增/修改二进制时触发检查；仅改代码/文档或删除二进制
不强制迁移存量文件。两条路径均保留许可证、来源审查和总包大小要求。依赖声明
变化必须提升插件版本，核对来源、哈希和再分发许可证；仅实际权限/信任边界扩大
或证据不足时转维护者，普通维护更新可自动审查。
`node --test .tests/binary-dependencies.test.mjs` 运行离线打包回归；
PR CI 还会对实际改动的插件试打包。下载、打包与 OIDC 发布分属不同 job。

不要在公开 issue、PR 或讨论中披露漏洞、凭证或可利用细节。请按
[SECURITY.zh-CN.md](SECURITY.zh-CN.md) 的流程私下报告。英文版见
[SECURITY.md](SECURITY.md)。
