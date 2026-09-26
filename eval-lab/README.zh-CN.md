<p align="right">简体中文 · <a href="README.md">English</a></p>

# 评测工坊

用真实项目题目比较自己的模型，从选定任务片段建立私人题库，导出单文件成绩网页。

## 发布状态

首次发布候选版本保持 **1.0.0**。依赖配套 Cindy 的模型目录、下载、任务/团队及委派 Auto 上下文接口；尚未在正式/Beta 发布版完成验证。现有 manifest 最低版本 `0.1.93` 只是待确认声明，**不代表该版本已支持这些接口**；合入前必须确定实际最低版本并完成真实安装包验收。初始 provisioning 为定向空受众，不自动安装给任何用户。接口缺失时显示升级/错误提示，不退回付费模型探测。

## 使用

1. 打开主页面。自动分配保存位置，无需先选择目录。
2. 选择题库、模型和思考强度，开始测试。默认模型可见性跟随 Cindy 模型选择器。
3. 一个主任务协调多个 Orca Worker 并行作答，高级设置可限制并发。所有动作仍走宿主 Auto 审批；插件不能授予 Full access 或冒充用户原话。
4. 进度自动更新，准备与运行阶段均可停止。执行状态不确定时核对回执，不盲目重派、不算零分。
5. 历史成绩默认按每题最近一次有效成绩汇总模型配置；平均模式先按题平均再合计。版本与内容哈希不同的成绩不混算。可以导出当前榜单或指定结果。

主任务和 Worker 都可能产生所选账号的模型费用。只展示已知美元金额，未知不记零。耗时是观测到的执行窗口，不代表纯计算时间。Worker 报告自身不构成交卷证据，插件先核对宿主任务/团队状态再评分；回执不是密码学认证。

## 题库与本地执行

默认来源为 [makecindy/eval-bank](https://github.com/makecindy/eval-bank) 的[固定 Release](https://github.com/makecindy/eval-bank/releases/tag/eval-bank-20260925)。七类题包括音频、灵动岛、自动恢复、输入框发送、手机历史顺序、远程文件和消息投影缓存。每题1分，按冻结考核权重计算；未测齐与环境无效单列。

按需下载选定题目及运行环境，校验字节数、哈希和解包路径后才启用。旧版本可以离线继续使用，更新不覆盖进行中的作答。默认运行环境目前要求 **macOS Apple Silicon 和 Python 3**。大型题库放在 GitHub Release，不塞进插件。

评分和校准会以本机用户权限**执行题包提供的本地代码**，也可能执行候选程序。仅使用可信题库。哈希只证明完整性，不证明安全；评分器/参考答案与作答目录分离不等于系统沙箱。

## 私人题库与隐私

只处理用户粘贴或明确选择的任务片段，不扫描全部历史。交给出题模型前请移除凭证和私人信息。草稿包含产品合同、候选项目、参考答案、独立评分器和不完整对照；通过校准后由用户冻结为新版本。校准只是机械门槛，不能替代产品语义审阅和变异检查。

作答、快照、诊断和草稿留在本地，Library 保存设置与导出网页。公开报告不包含原始诊断、聊天、源码或本机路径。分享只导出文件，不自动托管上线。卸载不删除 Library 或外部评测目录。

## 开发验证

- `node --test test/core.test.cjs test/bridge.test.cjs test/online.test.cjs test/defaults.test.cjs test/standings.test.cjs test/execution-quality.test.cjs test/task-scope.test.cjs test/engine.test.cjs`
- `EVAL_BROWSER_RUNTIME=<composer candidate/runtime> node --test test/view.test.cjs`
- 可选真实题库验证：`EVAL_TEST_BANK=<已还原题库> node --test test/engine.test.cjs`
- `python3 dev/build_online_bank.py <离线题库> <资产输出目录> <固定GitHub Release地址>`，资产输出放在本目录外。

浏览器测试使用宿主桥替身，不证明正式/Beta 实机兼容、真实供应商执行或全部重启/切账号行为。仓库 CI 生成 `.cindy` 验证包，发布前须记录安装与实机证据。不新增第三方 Node 内嵌依赖；题目与运行环境许可证随题库分发。
