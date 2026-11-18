---
name: taptap-maker-runtime-upgrade
description: 升级或审查 Cindy 官方 tap制造插件随包 Maker MCP Runtime 时，逐提交复查历史兼容保护、适配官方发布包并验证回归。适用于 cindy-official-plugins 源码维护，不用于安装独立 Maker MCP 或制作游戏。
---

# Tap 制造 Runtime 升级兼容检查

目标是保留历史行为，不只是让新包启动。此 Skill 的历史清单是检查起点，不是永久完整清单，也不是新版本已通过的证明。

## 首要原则：稳定优先，简单处理

- 不过度思考、不节外生枝：围绕实际提交、新旧包差异和已知故障做兼容性分析，不为假想场景扩展需求。已有证据足以判断并通过对应验收后就停止扩展分析。
- 选择最简单、最合理、影响范围最小的方案，优先复用现有接口和保护；不顺手重构，不增加无必要的抽象、迁移、兜底或跨进程机制。
- 稳定性高于功能数量：宁可不接入、暂缓或关闭有风险的新功能，也不为追求功能完整而破坏已有功能。无法可靠兼容时明确报错或保持原稳定版本，不带着已知故障交付。
- 涉及已有功能的停用、移除，或高成本、高风险的兼容方案，说明影响并交用户决定，不静默删功能。新功能的取舍遵循已确认范围。
- 简单处理不等于省略历史保护核对和必要回归；以最小改动验证稳定性，未验证的部分如实标明，不承诺绝对无故障。
- 真实测试优先用本机已有、已发布且正常运行的游戏。只处理 Maker MCP/插件问题；确认属于游戏资源或原生引擎的 DLL/shader/截图编码问题单独记录，不扩成引擎修复，不作为插件升级阻塞。未改输入或重载链路，不要求额外游戏玩法验收。
- 失败先定位归属并继续独立检查；旧 Console 占用在已有关闭授权内正常停止、由新插件重开，不因一个环境问题只列待办就结束。

## 先确定证据和范围

1. 在仓库根读取 AGENTS.md、README、docs/plugin-authoring.zh-CN.md、docs/taptap-maker-maintenance.zh-CN.md 和 .greptile 审查契约。检查工作树，保留用户现有改动。
   每轮升级在修改插件前先 fetch 并核对最新官方 main，从该提交新建本轮分支，记录分支名和基线 SHA；恢复同一轮任务时沿用该分支。不得直接在 main 修改、提交或推送，不复用已合并 PR 的分支；脏树不能安全切换时使用独立工作树。只读审查不要求建分支。
2. 读取 [逐提交清单](references/history.md)，运行 `node .agents/skills/taptap-maker-runtime-upgrade/scripts/check-history.mjs`。脚本只读本地 Git，不联网、不改文件；它检查普通提交和合并独有差异，并另列共享文件候选。
3. 确认是否浅克隆、refs 是否新鲜。经正常只读 Git/API 获取缺失历史；网络或权限失败就记录缺口，不把本地 `--all` 称为全平台全部历史。路径重命名、测试、配方、文档、provisioning 和共享发布脚本都要纳入。
4. 对新增候选逐个读实际 diff：`git show --format=fuller <hash> -- <paths>`。合并用 `git show --cc` 并与各父提交比较；超大 vendor diff 分函数/资产审查，不把截断输出、标题或版本号当证据。更新清单的来源、替代关系和对应验收项。

## 升级和逐项兼容

1. 从官方 npm 发布包确认包名、版本、tarball、integrity；源码 tag 仅辅助解释。先比较旧 vendor 与旧官方包，再比较新官方包，避免旧补丁被整包覆盖。
2. 逐条完成 [兼容验收矩阵](references/compatibility.md)。每条给出：历史 hash、旧保护、新包对应实现、保留/等价替代/已废弃/待验证、测试证据与残余风险。不能只检查配方中的 V1–V8。
3. 审查新增或变更的网络、下载、动态执行、凭证、后台进程、编码资产和依赖许可证；解码资产应对照来源而非执行。新入口必须检查是否绕过宿主策略。
4. 为目标版本建立独立 `.github/maker-runtime/<version>.json`，使用现有 `sync-maker-runtime.mjs` 的精确补丁、完整清单及失败回滚。保留旧配方。锚点或哈希不符必须重新审查，不能放宽校验。
5. 最小化适配：通用问题可建议上游修复，Cindy 专属行为保留在宿主。高成本、大风险、产品冲突或不能证明等价的替代方案，先列影响、证据和选择交用户决定，不擅自重构。

## 当前已确认的产品边界

- 仅在 `cindy_plugin` 下隐藏 Maker 控制台模型设置入口、拒绝自定义模型 API 配置、识图固定 Server API；Server 不可用明确报错，无 ChatGPT 回退。
- 这是 0.0.37 新功能的最小收敛，不增加旧配置迁移、Cindy 生图桥接、跨进程素材策略或独立 Maker 行为修改。已有媒体开关限制 Agent 工具，不声称控制台手动操作也受其限制。用户另行改变需求时再讨论。
- 不因源码升级而全局安装 npm、清 npx 缓存、改 Agent MCP 配置，或启动付费生成、构建提交、push、fork、PR、合并。实机操作按实际授权进行。
- 不新增独立审计文档；维护本 Skill 的参考清单和已有必要的双语交付说明即可。

## 验证与交付

在仓库根运行（版本替换为本次目标）：

```text
node .github/scripts/sync-maker-runtime.mjs 0.0.37 --check
node --test .tests/taptap-maker.test.mjs .tests/taptap-maker-upgrade.test.mjs
node --test .tests/plugin-contract.test.mjs .tests/localization.test.mjs .tests/provisioning.test.mjs .tests/publish-workflows.test.mjs
git diff --check
```

测试失败区分本次回归与已有/环境问题，给出具体原因和下一步；不能削弱门禁来获得通过。纯字符串断言、提取函数测试、普通 Node 冒烟和正式/Beta Cindy 实机验收分别报告，不能互相替代。新包必须在满足 minCindyVersion 的正式或 Beta Cindy 上安装并验证后才能勾选实机项。

最终直接回答：历史保护逐项结论、实际改动、未解决高风险/未知项、测试和设备缺口。不要只给文件链接。若用户问分支权限，区分本地建分支与远端 push，核实认证账号和仓库权限；不要根据 Git author 或 fork 的存在猜测权限。

提交前核对当前为本轮升级分支而非 main，且未对应已合并 PR；push 显式指定已核实的 remote 和本轮 head 分支。遵守仓库版本、许可证、双语、四语言、DCO 门禁；用户没有要求就不提交。未提交改动只能用配方 ID/文件定位，不能编造 hash；有真实提交后再补清单。新会话可通过 `$taptap-maker-runtime-upgrade` 或同名 Skill 调用。
