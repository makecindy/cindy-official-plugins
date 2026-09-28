# iOS Simulator Manual 迁移

插件 `1.1.4` 使用 Manifest v3，以 `iosSimulator: true` 声明能力，并将完整工作流说明
从用户级 Skill 贡献迁移为随包 Manual。不声明插件 tools、network、Node worker 或
额外权限。原来省略的 `kind` 仍归一化为 `chip`；身份、入口、图标、启动模式和四语言
目录文案保持原样。

## 最低 Cindy 版本

`minCindyVersion: 0.1.88` 是包 `1.2.0` 支持的最低 Cindy 版本。本包在
`manual/ios-simulator/build-and-run.md` 中说明 `build_app.projectDir`，而 0.1.88 是首个
提供该能力的已发布版本：它于 2026-09-20 作为正式稳定版发布，而 `v0.1.86`（2026-09-18
发布，晚于客户端改动合入 `main`）不含该能力。

此前的 `0.1.83` 下限来自下面描述的 `1.1.4` Manual 迁移。该要求仍然成立；`0.1.88`
现在同时覆盖两者，是当前生效的下限。

### `0.1.83` 为何是 `1.1.4` 的下限

仅含 Manual 的 release 依赖无 tools Manual 的发现和读取能力，因此旧客户端不能收到它：

- [Cindy v0.1.64](https://github.com/makecindy/cindy/releases/tag/v0.1.64) 是首个支持
  Manifest v3 的稳定版；其 manifest 契约支持 `iosSimulator` 与 `manual`，但这本身
  不能让无 tools 的 Manual 插件被发现。
- Cindy [PR #4440](https://github.com/makecindy/cindy/pull/4440) 已修复无 tools Manual
  的发现和读取，并于 2026-09-15 以
  `b201f1f663a1199c1e296ee0b6ddca7d465d4e9d` 合入 `main`。它允许花名册、
  `ghost_info` 和 `ghost_manual` 访问，同时仍拒绝对无 tools 插件执行 `ghost_call`。

低于声明最低版本的客户端会继续从市场获得最新兼容的历史 release：低于 `0.1.88` 的客户端
保留 `1.1.4`（已含 Manual），低于 `0.1.83` 的客户端保留仍包含 Skill 的历史 release，
因此新包仍不需要保留过渡副本。本包删除 `skill` 声明和 `skills/` 目录，在兼容 Host 上
只通过 Manual 提供说明。

## Manual 结构

`manual.items` 是轻量一级索引。通过
`ghost_manual({ ghost_id: "ios-simulator", path: "ios-simulator" })` 读取主流程。
`manual/ios-simulator/MANUAL.md` 以完整逻辑路径直达 `build-and-run.md` 和
`external-fallback.md`。各页均为无 Skill frontmatter 的普通 Markdown。实时工具契约
仍由 `cindy_ios_simulator` 目录提供；不得为插件伪造 `ghost_call` 工具。目录本地化
契约没有 Manual 翻译字段；zh-CN/en/ja/ko 原有目录文案保持不变，操作 Manual 使用英文。

## 生产验证

本次迁移已于 2026-09-16 在实际 Mac 上完成生产验收：将真实打包的 `.cindy` 安装到
官方签名的 Cindy CN 0.1.83 客户端，使用隔离数据目录。测试客户端的正式稳定版身份
由作者确认。产物身份和详细结果记录在
[PR #111](https://github.com/makecindy/cindy-official-plugins/pull/111)。

- 已验证安装并启用的插件出现在花名册和 `ghost_info`。
- `ghost_manual` 成功读取根索引、入口和两个子页面。
- 插件没有 tools，`ghost_call` 按预期返回 `TOOL_NOT_FOUND`。
- 未注入或读取旧 Skill 时，Host 托管的内置 viewer、构建、安装、启动、界面读取、
  点击、输入和提交工作流均通过。实际覆盖 WDA/JPEG 与 WDA 输入兼容模式；未覆盖
  Native H.264/HID、外部回退或广泛回归。

后续修改插件包时，仍须在运行不低于 `minCindyVersion` 的稳定版 Cindy 的实际设备上
安装精确 `.cindy` 包并验证核心功能，再在 PR 中确认生产验收。

在仓库根目录运行四个仓库门禁、`.tests/ios-simulator.test.mjs`，以及
`node scripts/validate-plugin-manifest.mjs ./ios-simulator`。仓库打包器从已提交的
`HEAD` 生成产物；安装前应检查归档内容。静态检查和打包验证的是契约，不能替代独立的
实机运行证据。
