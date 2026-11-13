<p align="right"><strong>简体中文</strong> · <a href="github-ci-retry-2026-11-13.md">English</a></p>

# GitHub CI 恢复运行证据 — 2026-11-13

环境：Cindy 0.1.136 Beta、Windows 10.0.26100、Node v22.22.3。
仅安装/更新隔离的 `local` GitHub 开发实例，市场版及其偏好保持原样。

## 真实桌面观察：1.5.14 / 209ef92

在 PR 卡片开启后，实时工具返回 `true`；设置页显示勾选，关闭后工具返回 `false`。
旧卡片仍显示开启时点击“关闭”，全局值保持 false、卡片更新为关闭；刷新
`pr_card` 也返回 false。Light/Dark 均在真实 Cindy 中观察，结束后恢复原 light
主题并关闭开发版开关。后续 Windows 拒绝激活窗口，该次未发送输入；锁屏后没有
再尝试桌面输入。

以下是 **1.5.14 的真实裁图**，其中保留当时较长文案及旧的每 PR 次数限制，
不代表当前版本界面。只保留控件及说明，已去掉账号、任务列表和聊天内容，不保留图片元数据。

| 真实设置页 | 真实 PR 卡片 |
| --- | --- |
| ![1.5.14 设置页浅色](github-ci-retry/desktop-settings-light-1.5.14.png) | ![1.5.14 卡片浅色](github-ci-retry/desktop-card-light-1.5.14.png) |
| ![1.5.14 设置页深色](github-ci-retry/desktop-settings-dark-1.5.14.png) | ![1.5.14 卡片深色](github-ci-retry/desktop-card-dark-1.5.14.png) |

1.5.17 已移除账号设置页的 PR 控件、KV 读取及专用就绪/写入通信。上述设置页观察
是历史记录，不代表当前入口，也不再是待验收的冷启动路径。卡片持久化及明确目标的
action 处理未改，可复用卡片证据；改变的恢复规则仍需各自对应证据。

## 当前文案：1.5.16 生成预览

以下图片为生成的文案/布局预览，**不是真实 Cindy 或手机截图**。
说明仍为一句，标题旁单列“本机所有仓库 / PR 共用”，卡片无障碍名称也包含范围。
卡片有四语言文案，1.5.17 卡片布局保持不变；插件账号设置页已无该控件。

![生成的桌面浅色预览](github-ci-retry/preview-card-light-1.5.16.png)
![生成的桌面深色预览](github-ci-retry/preview-card-dark-1.5.16.png)

| 生成的窄屏浅色预览 | 生成的窄屏深色预览 |
| --- | --- |
| ![生成的窄屏浅色](github-ci-retry/preview-card-narrow-light-1.5.16.png) | ![生成的窄屏深色](github-ci-retry/preview-card-narrow-dark-1.5.16.png) |

## 真实 GitHub 正常重跑

隔离[测试 PR #1](https://github.com/yan-xdt/cindy-official-plugins/pull/1) 只增加受控
workflow，首次故意失败。插件正常 rerun 后，[run 43421933262 的 attempt 2 为
success](https://github.com/yan-xdt/cindy-official-plugins/actions/runs/43421933262)，
head 仍为 `1296be40`。测试 PR 已关闭、未合并；分支和运行保留供核验。
这是假定条件明确的测试夹具，不冒充基础设施故障诊断。当前账号有 rerun 权限，
未出现真实权限拒绝，未执行 CI-only 改写。

## 审查不变量与签名检查

范围披露不变量：每张 PR 卡片在用户选择前都展示共用范围。偏好写入仍由现有主逻辑页
PR 队列单独负责。签名不变量：原 head 已签名时，不能推送未签名的替代提交。
Agent 只读已有 Git 配置，不通过更换签名身份、密钥或放宽验签策略取得资格。

| 观察到的状态或事件 | 要求的行为 |
| --- | --- |
| 原提交已签名，但原签名无效/未知或自动签名关闭 | 占用额度和 amend 前停止 |
| 原提交已签名，但签名准备状态未知、密钥不可用或需交互 | 停止，不降级为无签名 |
| 原提交已签名，已有配置可无交互完成重签 | 推送前验证新签名 |
| 替代提交签名缺失/无效/未知 | 保留本地不推送，如实报告 |
| 原提交未签名 | 仍适用全部既有恢复条件 |
| amend/push 前偏好关闭或不可读 | 不执行 CI-only 改写/推送 |

隔离的真实 Git fixture 使用即时生成的测试 SSH 密钥，检查单次 `-S` 签名与自动
签名关闭、按已有配置 amend 后验签通过及 tree 不变、密钥不可用时失败且 head
不变。不把它当作 GitHub Verified 状态证明，也不证明 Agent 已在真实恢复中执行。

1.5.17 把次数回执迁到用户持久数据目录，观察/trace 缓存仍可清理。gate 是唯一
回执写者，排他迁移匹配的旧缓存证据，不覆盖已有持久记录。真实 CLI fixture 验证
清空或更换缓存不能恢复同一故障的次数，旧缓存也不能替换已有持久记录。升级前
已经删除的证据无法通过迁移恢复。

## 剩余验收与决定

- 实际手机显示。设置页的偏好握手已删除，不再要求验收该冷启动路径；这是路径移除，
  不声称它已实测通过。
- 实际调度后台轮次读取关闭偏好。
- 真实合格的 rerun 权限拒绝，经签名/未签名恢复、精确 lease、原 PR head 回读及
  CI 实际触发的完整链路。
- 维护者对分支改写范围的明确决定：当前为同一诊断故障一次，无每 PR 总次数上限。
  [维护者原始评论](https://github.com/makecindy/cindy-official-plugins/pull/332#issuecomment-6850756870)
  表示之后另行决定，不视为批准。

本地 fixture 和生成预览不能替代这些前提。fork CI 批准仍由维护者处理；未执行
合并、发布、改权限，也未修改 makecindy/cindy#10355。
