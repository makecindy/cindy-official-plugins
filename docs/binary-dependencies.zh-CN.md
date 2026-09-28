# 打包时收集二进制依赖

[English](binary-dependencies.md)

作者在插件 `ghost.json` 同目录提交 `binary-dependencies.json`，描述预编译资源。
作者维护声明、适配代码和再分发许可证；仓库公共打包器负责下载、校验和入包。
Cindy 仍安装一个包含全部资源的普通 `.cindy` 包。

这是打包约定，**不是新的 Manifest 字段或运行时权限**。处理器不运行下载内容，
不安装依赖、不编译源码，也不接受插件自定义构建钩子；原有运行时授权机制不变。

该机制按需启用，不是所有二进制都必须使用。小二进制（每个插件所有平台合计不超过 10 MiB）可以继续
直接入仓，按原方式归档，沿用许可证、人工审查和总包大小要求；不需要依赖声明或
Python。未触及的存量大文件也不会被强制迁移。

## 作者流程

1. 选择固定上游版本，核对来源和再分发条款，取得各下载文件的 SHA-256。
2. 提交声明、适配代码和完整许可证，不提交大二进制。
   必须包含 `THIRD-PARTY-LICENSES.txt`；每项依赖的 `license` 指向包内已跟踪、
   非空且包含对应条款的文件。
3. 每个上游下载资源只声明一次。通用资源只填一组 URL/哈希；分平台资源声明各自
   覆盖的目标，合起来须支持 macOS、Linux、Windows 各自的 x64/arm64。
   全部资源进入同一个发行包，需要时由插件适配代码在运行时选用平台版本。
   打包器检查声明的平台覆盖，不证明二进制能运行。
4. 本地开发时按声明准备依赖文件，使用 Cindy Forge 或经审查的显式文件清单打包调试，
   见下方迁移步骤。此路径不要求 Python；Forge 不会替你下载依赖。
5. 提升插件版本，按现有贡献规则提交源码、声明和许可证，创建 Ready PR。
   尚未验收时保持实机验证项未勾选；这时对应 CI 检查失败是预期，不代表不能取得测试包。
6. 从 PR workflow 下载验证包，在满足最低版本的正式稳定版或 Beta Cindy 上验证后，
   记录产物、版本、渠道和验证结果，再勾选实机验证项。修改 URL、哈希或选取文件也属于
   包内容变化；更新后须确认验收仍覆盖最新内容。

不增加客户端安装时或首次使用时下载。用户依然从现有 OSS/CDN 渠道下载最终包，
无需连接依赖的上游下载站点。

## 从已内嵌二进制迁移

以下以 `my-plugin/vendor/example-cli/` 为例，命令仅针对这个示例目录，使用前替换成
实际目标；不要删除整个 vendor 或无关依赖。

1. 盘点旧包的文件、平台、版本、许可证和执行权限。选择与旧文件一致的上游发行版本；
   获取原始下载归档的 SHA-256（不是解包后文件的哈希）。可用系统工具：macOS
   `shasum -a 256 archive.zip`、Linux `sha256sum archive.zip`、PowerShell
   `Get-FileHash archive.zip -Algorithm SHA256`；声明中使用小写哈希。
   哈希须与可信上游发布信息核对，不能仅因下载成功就认为来源可信。
2. 新建声明，将每个归档内的 `source` 映射到旧包对应的 `target`。
   target 必须在 `vendor/<依赖名称>/` 内；旧路径符合时保持原路径，否则同步修改适配代码
   并验证调用路径。可执行文件设置 `executable: true`。保留完整许可证为已跟踪文件。
3. 从 Git 索引移除将由 CI 生成的文件，但保留工作区副本供本地开发。例如：
   ```bash
   git rm -r --cached -- my-plugin/vendor/example-cli/
   ```
   在本机 `.git/info/exclude` 加入 `/my-plugin/vendor/example-cli/`，避免误加回 Git。
   若该目录包含需要提交的适配源码或许可证，应只移除/忽略具体二进制文件，不能整目录处理。
   不改写 Git 历史；此操作不会缩小过去提交的体积。
4. 本地工作区保留全部六平台输出，路径、字节、权限与声明相符。检查上游归档后仅复制
   选中的普通文件，不把归档、下载临时文件或额外内容放入插件目录。保留选中文件的
   原始字节，只使用最终 `.cindy` 安装包自身的 ZIP 压缩。
5. 用 `ghost_forge_pack` 对准备好的目录打包调试，或使用明确且经审查的文件清单；
   打包目录须包含 `ghost.json`、代码、资源、依赖声明、许可证和全部依赖输出，补齐仓库
   `LICENSE`、`NOTICE`、`TRADEMARKS.md`、`TRADEMARKS.zh-CN.md`。不要递归压缩带凭证的工作区。
   Git 忽略只控制提交，不保证 Forge 排除文件；检查最终归档。现有 Host 限额仍适用，
   本地调试包不替代下方 CI 最终包验收。
6. 检查 staged diff：应只有源码、声明、许可证、版本等必要修改及旧二进制删除，
   不含新下载二进制。**已跟踪文件不会因被忽略而自动停止入包**；若仍跟踪同一 target，
   CI 会因覆盖冲突失败。提交后由 CI 按声明重新生成文件。

后续升级依赖时一起修改版本、URL、原始归档哈希、文件映射（如需）、许可证和插件版本，
本地副本同步替换，重验最新 CI 包。源码/声明由作者维护，下载收集由仓库构建器负责；
不让用户设备在安装或运行时补依赖。

## 下载 PR 验证包（无需本地 Python）

1. 在 Ready PR 的 Checks 中打开 **Verify pull request** 的具体运行页面（Details）。
   Fork PR 可能先需要维护者批准 workflow；不要靠提前勾选实机验证来触发。
2. 等 **Test and dry-run packaging for changed plugins** 中的
   **Upload PR verification packages** 成功，在运行页面的 Artifacts 下载
   `pr-plugins-<PR号>-<head SHA>-<run id>-<attempt>`。需要登录且有仓库读取权限。
   测试或打包前序失败不会上传；仅最后的实机验证勾选失败时，已经上传的包仍可下载。
3. 解开 GitHub 外层 artifact ZIP；每个改动插件目录包含 `plugin.cindy`、
   `plugin.cindy.sha256` 和 `source.json`。安装内部 `.cindy`，不要把外层 artifact 当插件安装。
   `source.json` 记录插件目录、PR head、base 和实际构建的临时 merge commit。
   核对它属于要验收的最新提交，并核对 `.cindy` 的 SHA-256；这是来源定位与完整性检查，
   **不是签名或安全认证**。PR 包含尚未审核代码，只在明确接受风险时安装，不自动执行。
4. 实机验证后，在 PR 验证栏记录 artifact/run 链接、`buildCommit`、包 SHA-256、Cindy
   版本/渠道和验证项，再勾选原有实机验证项。编辑 PR body 会重新运行检查；若只是重跑且
   源码和依赖输出不变，可以引用之前的记录，不因 ZIP 时间戳导致哈希变化机械重验。
   若 head/base 更新影响了包内容，应下载对应新包重新验证；CI 不自动证明两次产物等价。
5. 产物保留 7 天；过期后由有权限者重新运行 workflow。文档-only PR 不生成插件包。
   验证包不会上传 Platform/OSS；合并后 CN/Global 发布工作流独立重建并走既有审核。

## 可选：本地复现仓库构建

只有选择在本地复现 CI 才需要 Git、Bash、jq、unzip 与 Python 3.11+。
现有 Node 校验/测试命令仍有各自的 Node 环境要求，Python 不是
所有插件作者的开发前置条件。Cindy 内置插件运行时不等于系统已安装 Node/npm 或 Python。

提交源码后在仓库根目录执行（只读已提交的 HEAD，不包含未提交的插件修改）：

```bash
.github/scripts/package-plugin.sh my-plugin /tmp/my-plugin.cindy
unzip -l /tmp/my-plugin.cindy
```

本地 packager 使用本地 HEAD；PR CI 使用 head 与当时 base 的临时 merge commit，
发布使用 main 的合并结果。判断一致性要核对实际来源、文件内容和权限，不能只看文件名。

## 声明格式

以下仅为**结构示例**，不可直接下载。必须将所有示例 URL 和全零哈希替换成经过
审查的固定版本地址与真实归档哈希。示例是一份供所有平台共用的资源。
不支持模板、Shell 展开或通配符；仍不接受仅支持单个平台的插件。

```json
{
  "schemaVersion": 1,
  "dependencies": [
    {
      "name": "example-wasm",
      "version": "1.2.3",
      "license": "THIRD-PARTY-LICENSES.txt",
      "assets": [
        {
          "url": "https://downloads.example.com/example-wasm/v1.2.3/module.wasm",
          "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
          "format": "file",
          "files": [
            {
              "target": "vendor/example-wasm/module.wasm"
            }
          ]
        }
      ]
    }
  ]
}
```

- `schemaVersion` 固定为 `1`；未知字段会被拒绝。
- `dependencies` 包含 1–16 项，名称不可重复。`version` 是固定版本标识，不能为
  `latest`、`main`、`master`、`HEAD`，也不会用于展开 URL。即使上游修改地址
  对应内容，SHA-256 仍锁定实际字节。
- 每项依赖的 `assets` 包含 1–32 个实际的上游下载资源。每项下载一次，归档可
  选取多个文件。因此一个包含全平台文件的归档只填一组 URL/哈希，不必重复六份。
- 每个资源可选填 `platforms`，是非空的平台列表，取值为 `darwin-x64`、
  `darwin-arm64`、`linux-x64`、`linux-arm64`、`windows-x64`、`windows-arm64`。
  省略表示所有平台共用该资源，或归档包含全部平台版本。例如包含两种 macOS 架构的
  归档填写 `"platforms": ["darwin-x64", "darwin-arm64"]`，其余资源补齐 Linux
  和 Windows。每项依赖整体须覆盖六个目标。这是作者的支持声明，不是可执行格式检测。
  无论构建机器是什么平台，全部资源都会入包，不生成分平台发行包。
- `url` 仅允许公开 HTTPS 443，不含凭证或 fragment。禁止私网、回环、链路本地
  目标，重定向也逐次检查。不使用本机代理、netrc、Cookie 或授权凭证。
- `sha256` 是 64 位小写十六进制，校验**下载原始归档/文件**，不是解压后的文件。
- `format` 支持 `file`、`zip`、`tar.gz`。归档的 `source` 必须是确切的普通
  文件成员；接受 tar 常见的 `./` 前缀。`file` 只能有一个映射，且不填写 `source`。
- 每个资源的 `files` 包含 1–32 项。`target` 必须位于
  `vendor/<依赖名称>/` 下；建议使用平台子目录，但不强制。不能覆盖源码文件或其他生成文件。
  `executable: true` 将 ZIP 权限设为 0755，否则为 0644；适配代码仍须处理客户端
  既有的解包和执行行为。
- 选中文件在 `.cindy` ZIP 内保留原始字节，不额外编码，不接受 `encoding` 字段。
  压缩由安装包承担，不属于插件适配代码职责。公共依赖收集器按声明的 `sha256` 校验上游下载；
  安装包完整性校验由公共分发与客户端安装流程负责。插件不应在运行时对随包二进制
  重复增加哈希校验。插件适配代码负责选择平台、处理客户端既有执行行为并调用程序。
  公共下载校验与安装包校验保持不变；解包限额统计选中文件的原始大小。
- 路径必须相对且跨平台安全。拒绝路径穿越、链接、特殊文件、重复/大小写冲突条目
  和加密 ZIP；不会按归档提供的路径解压到工作区。
- 声明保留在最终包中作为构建来源记录，客户端安装时不处理。
  Forge 尚不执行依赖收集；本地须先准备好输出文件。仓库发布由 CI 打包器收集。
- Manifest 入口/资源引用可以对应确切的依赖输出，先不要求该文件存在于 Git；
  最终包必须包含它，不能仅凭声明绕过缺文件检查。Locale、Skill、Manual 的内容
  仍沿用原有已跟踪源码校验。

## ZIP / tar.gz 与多平台示例

下面是完整的全平台 ZIP 声明结构（同样是占位示例，不可原样下载）。一个上游归档已包含
六平台时只填一个 URL，使用六条文件映射；许可证内容仍需另外提交。

```json
{
  "schemaVersion": 1,
  "dependencies": [
    {
      "name": "example-cli",
      "version": "1.2.3",
      "license": "THIRD-PARTY-LICENSES.txt",
      "assets": [
        {
          "url": "https://downloads.example.com/example-cli/v1.2.3/all-platforms.zip",
          "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
          "format": "zip",
          "files": [
            {
              "source": "release/darwin-x64/example-cli",
              "target": "vendor/example-cli/darwin-x64/example-cli",
              "executable": true
            },
            {
              "source": "release/darwin-arm64/example-cli",
              "target": "vendor/example-cli/darwin-arm64/example-cli",
              "executable": true
            },
            {
              "source": "release/linux-x64/example-cli",
              "target": "vendor/example-cli/linux-x64/example-cli",
              "executable": true
            },
            {
              "source": "release/linux-arm64/example-cli",
              "target": "vendor/example-cli/linux-arm64/example-cli",
              "executable": true
            },
            {
              "source": "release/windows-x64/example-cli.exe",
              "target": "vendor/example-cli/windows-x64/example-cli.exe",
              "executable": true
            },
            {
              "source": "release/windows-arm64/example-cli.exe",
              "target": "vendor/example-cli/windows-arm64/example-cli.exe",
              "executable": true
            }
          ]
        }
      ]
    }
  ]
}
```

若上游提供同内容的 `.tar.gz`，将 URL 改为真实 tar.gz 地址、`format` 改成
`tar.gz`、SHA 改成该归档的真实哈希，`source` 按实际成员路径填写。
若上游按平台分发，则将一个 asset 拆成多个，每个填写自己的 URL、SHA、format、files
和 `platforms`（如 `["darwin-x64", "darwin-arm64"]`），合起来覆盖六平台。
不需要重复声明同一个下载；不能用省略 platforms 来假装单平台二进制支持所有平台。
插件代码根据操作系统/架构选择上述包内路径，不需要修改 Cindy 注册表。

常见失败：

- target 已存在：检查 Git 是否仍跟踪旧二进制；不会由收集器覆盖源码。
- 缺少平台：核对每项依赖覆盖全集，不能只填写开发机平台。
- SHA 不符：核对是不是原始下载文件的哈希；不要不核实来源就接受新的字节。
- 找不到 source：查看实际归档成员，不能猜测文件名或使用通配符。
- 本地可用而 CI 失败：检查未提交源码/许可证、仅存本地的依赖、路径大小写与执行权限。

## 限额与失败行为

收集器输出 `[timing]` JSON 日志，分别记录 `source_archive`、`download_verify`
（网络传输及 SHA-256 校验）、`extract`、`zip_source`、`zip_dependency`、
`validate_package`、`assemble_total` 和 `package_total`。
每条包含单调时钟计算的 `elapsed_s`、`status`（`ok` / `failed`），以及适用的依赖、
资源序号或文件标识；不记录 URL 或响应正文。总耗时包含子阶段，不能与各阶段耗时重复
相加。计时只写日志，不进入安装包。

交付限额：ZIP 最多 256 个条目；Node 包压缩后最多 128 MiB、解压最多 256 MiB，
其他包压缩后最多 8 MiB、解压最多 32 MiB。限额包含所有平台和插件原有文件。
依赖超限时需要另行决策交付方式，不能绕过限制或发布单平台包。

以上是打包限额，不代表服务端和所有客户端下载路径均接受该大小。
发布超过服务端原有 64 MiB 限额的包之前，须先部署对应的服务端限额调整。当前客户端市场下载仍有
8 MiB 上限；统一该限制属于独立客户端任务，本次不修改。

每次下载最多 128 MiB；每个依赖归档最多 4,096 个条目、解压最多 256 MiB
（包含完整 tar 数据流）；声明最多 256 KiB。下载有 socket 超时、120 秒传输期限、
最多五次重定向，CI 另有打包 job 时限。首版不引入持久化二进制缓存。
缺文件、缺平台、哈希不符、下载不可用或超限，均导致整个包失败；临时数据清理，
只有完整构建成功才替换已有输出。

未声明依赖的插件不下载任何内容，保留原 `git archive` 字节。
源码和依赖声明取自已提交的 `HEAD`，固定仓库法律文件仍按原流程补入。

已发布的安装包是自包含的，移除收集器的 Brotli 支持不会改写 OSS 或用户设备上的包，
也不影响这些包继续使用。历史源码若声明了 `encoding`，不能再用当前收集器重建。
今后若要更新并重新打包这类源码，须在同一插件版本中移除该字段、调整输出路径和
适配代码以使用原始文件。不得把原始字节静默写到仍要求 Brotli 的路径，也不要批量
重打包尚未迁移的历史源码。

PR CI 限制**每个插件直接入仓的二进制合计不超过 10 MiB**：
- 统计该插件所有已跟踪的二进制路径，包括未修改的文件、图标、归档和所有平台版本；
  拆成多个小文件也不能绕过总量限制。
- 按提交内容识别：包含 NUL 字节或不是有效 UTF-8 的内容计为二进制。
  文本源码/文档不计入；文件名和 `.gitattributes` 不改变识别结果。
- 打包时下载的依赖及未跟踪文件不计入 Git 限额；最终包大小仍单独校验。
- 新插件或新增/修改二进制时检查。存量插件仅修改代码/文档或删除二进制时不强制迁移；
  一旦新增/修改二进制，就按该插件剩余的全部二进制总量检查。

## 复现打包验证

`node --test .tests/binary-dependencies.test.mjs` 覆盖原始文件、ZIP/tar.gz、
不安全成员、缺少输出、错误哈希、全平台入包、失败保留原产物、小二进制直接入仓，
以及不调用 Python 的旧打包路径。

实际 HTTPS 下载验收使用：

```bash
CINDY_BINARY_LIVE_SMOKE=1 node --test .tests/binary-dependencies.test.mjs
```

它在隔离的临时 Git 样例中，使用固定 commit 和哈希的 MDN WebAssembly 资源及其
CC0 许可证，将通用资源下载并入包一次，检查最终归档，结束后清理。不安装插件、不执行
依赖、不修改真实插件，也不发布。这验证的是打包链路，不是六种系统/架构上的
原生程序运行能力。

## 实现选型与边界

保留 Python 是当前仓库构建步骤的维护成本选择，不是语言优劣结论：

- Python 标准库已支持下载、SHA、ZIP/tar；现有实现及回归验证可复用，仓库此前也有
  Python 打包脚本。不需要额外编码器，也不开放作者脚本。
- Node 更统一 JS 技术栈，但按当前版本和需求要补解包依赖或系统工具；npm/pnpm
  是依赖/脚本管理器，不直接替代收集逻辑，也不能假定每位作者已安装。
- Rust 适合独立分发 CLI，但本次会增加编译、缓存或预编译制品维护。
- 仅 CI 使用时，开发者不必配置该解释器；本地复现才需要。最终用户无新增工具要求。

保留 HTTPS、公网地址检查（含重定向）、超时/体积限制和 SHA 校验；暂不建立独立域名
白名单体系。公共托管域名不代表其中每个项目可信，具体来源、版本、哈希与许可证仍由
维护者审核。这些构建检查不增加插件运行期权限机制，也不证明二进制行为安全。

## CI 与信任边界

PR CI 运行离线处理器回归用例，并用同一打包器对改动插件试打包。
CN/Global 保持独立发布。每条流程先在只有仓库只读权限、无持久化 checkout 凭证、
无发布 secrets、无 OIDC 权限的 job 中打包，上传不可变 artifact，内含完整包、
SHA-256、源码 commit 和插件目录。

独立发布 job 只取同一次运行的产物，核对身份和哈希，再走原有 Platform/OIDC
上传链路；不 checkout 仓库、不下载依赖、不执行插件或构建代码。
构建失败的插件没有完整产物，无法发布；其他构建成功的插件仍可继续发布。

这减少了发布凭据暴露面，**不代表二进制已被证明安全**。哈希只证明字节一致，
不能证明行为安全。依赖、URL、哈希和许可证改动需要维护者人工 review，
区域 Platform 审核仍保留。既有 PR 插件测试仍可能执行源码；本机制不新增作者
可自定义的生命周期脚本。
