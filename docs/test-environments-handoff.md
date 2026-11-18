# Test Environments：草稿交接

这是未完成的可选测试工具，供后续开发接手；不是可发布或可合并结论。
2026-11-05 停止继续开发和运行验收，保留源代码、隔离登录与证据。
不要将未完成版本启用到日常宿主，不安装到目标 dev 后再启动下一层 dev。

## 目标与现有实现

- 原启动/登录继续存在，新增验收参数由用户选择。
- 本地按项目保存多份账号引用、启动方案和验收用例，AI 与管理页共用目录。
- 桌面优先，默认验收配置关闭远程被控和后台自动触发。
- 插件是选装工具，不自动给普通用户安装；`provisioning.json` 使用空 emails 受众。
- 通用项目通过 argv 适配器接入；Cindy 使用专门适配器。iOS/Android 只准备构建或 Metro，再交给 Baguette 验收。
- 已有生成图标、四语言资源、管理页面、CLI、Node Worker 和手册。

账号条目只是引用，认证仍由目标应用保管。插件不搬运正式凭证、不直接读钥匙串，也不把账号名称当作登录成功。

## 代码导航

| 文件 | 职责 |
| --- | --- |
| `test-environments/node/core.cjs` | 目录、版本冲突、参数解析、运行登记、生命周期入口 |
| `node/cindy-launch.cjs` | 复用项目导出的 restart 协调器，只把最终就绪等待交给插件 |
| `node/runner.cjs`、`node/terminal.py` | 独立监管、macOS 后台 PTY、实例归属、等待与停止 |
| `node/observation.cjs` | 核对 PID/启动身份/监听端口后，读取有限登录状态及截图 |
| `node/cli.cjs`、`node/worker.cjs` | 共用核心的 CLI 与插件 JSON-RPC 入口 |
| `main.js`、`manage.*`、`ghost.json` | 宿主工具路由、管理页面与声明 |
| `.tests/test-environments.test.mjs` | 目录、参数、真实子进程、PTY、回执与错误、端口归属、协调器回归 |

表中 `node/*`、`main.js`、`manage.*` 和 `ghost.json` 均相对于 `test-environments/`。

## 必须接续的外部依赖

本 PR 只提交插件仓的源代码。以下配套修改仍是独立仓库的本地 WIP，**不包含在此 PR，未声称已发布**。接手前取得原工作树或私有交接材料，不从本 PR 推断目标主干已支持验收参数。

### Cindy 客户端：本地分支 `dev-acceptance-profiles`

- `scripts/lib/dev-acceptance.mjs`、`scripts/desktop-dev-accounts.mjs`：解析 preset/account/login-source 等参数，维护公开账号别名。
- `packages/maker-shared/src/devAcceptance.*`：三端配置合同。
- Desktop 的 `devAcceptance.ts`、`devAcceptanceAuth.ts`、`devAcceptanceBroker.ts`、`devAcceptanceFixture.ts`、`devStartupStatus.ts` 与 `authManager.ts`：应用内选账号、联网验证、等待/就绪回执、样本和可选授权源。
- 原启动脚本、设备开关、后台服务及移动端 Metro/模拟器参数的配套接线。
- 本轮目标 checkout HEAD 为 `ae8a72e00900e59eda33f306f3777f3bf7533072` 加上述未提交修改。该 SHA 单独不能复现实测。

`mode:acceptance` 需要上述客户端合同；缺失时应报告 `PROJECT_UPDATE_REQUIRED`。
`mode:legacy` 不传新增验收参数，但仍需要项目导出的 `scripts/desktop-restart-runner.mjs`。

### Cindy 服务端：本地分支 `feat/dev-device-authorization`

新的空设备授权源/目标方案有独立服务端 WIP，未部署生产。`loginSource` 字段和客户端代码存在不代表线上授权可用。
已有沙盒自己的有效登录可复用；全新沙盒不能凭账号引用得到身份。

## 已有实测证据及适用范围

版本为插件源代码 1.0.4，共用 CLI 核心，macOS、PATH Node 22、已有客户端 WIP：

- 锁屏下已有登录档案启动，应用联网身份校验后 ready，remoteControl=false，样本就绪；可读取登录步骤并截取真实应用页面。
- 未登录档案保持 `waiting-for-owner / DEV_SIGN_IN_REQUIRED`，登录等待超过原 120 秒预算后仍存活，可正常停止并保留数据。
- 在已有 A 的档案指定刻意不存在的账号，实际 `failed / DEV_ACCOUNT_MISMATCH`，未返回验收成功；随后正常启动 A，联网验证恢复成功，原样本任务与伙伴可读取，远程被控仍关闭。
- 当前测试档案经应用账号列表与联网同步，仅有一个已保存的真实账号。因此**尚未完成两个真实账号的 A → B → A**。
- 最初只从外层 argv 移除 `--wait-ready` 无效：项目协调器会重新添加。已改为调用原协调器，仅在最终 launching 步骤接管等待，并重新实测通过。
- 临时账号检查脚本曾误选语音浮层，被 IPC 正常拒绝；准确选择主页面后通过。未修改权限规则，生产 inspect 已排除带 query 的浮层。

这些是独立 CLI / 目标应用证据，不冒充 1.0.4 已在日常宿主安装实测。旧版管理页证据不能替代最新版宿主集成验收。

## 未完成项与下一步验收

1. 两个真实账号分别保存并选择，A → B → A 联网核对身份、配置与样本；同时明确不同账号使用独立档案，或同档案切换时样本标记如何隔离。
2. 首次登录/过期授权的远程交接：使用目标应用支持的安全授权流程，不能靠屏幕解锁要求、凭证复制或任意 JS 代替。
3. 空沙盒通过授权源获得独立设备登录：客户端与服务端合同联调、部署边界及线上真实性均待完成。
4. iOS/Android 使用 Baguette 的真实安装、账号与样本验证；Filo 和其它项目需要各自实现并验证参数适配，不宣称已通用登录。
5. Windows/Linux 生命周期与调试端口归属验证；当前 macOS 后台 PTY 证据不能外推。
6. 立即停止再启动时，退出附属进程短暂残留可能触发 `CHECKOUT_IN_USE`；保留归属检查，不用广泛杀进程解决。
7. 完整验收后才重新评估安装、启用或发布，保留普通登录与原始启动路径的回归。

## 接手续跑方式

独立指定仓外 `TEST_ENVIRONMENTS_HOME`，使用 `node test-environments/node/cli.cjs <method> --stdin`，先 `catalog` / `plan`，再按授权 `start`。
目标应用不安装本插件。先核对当前进程与端口，保留有效登录；`stop` 后核实该次进程及退出附属进程已结束。

源码回归：`node --test .tests/test-environments.test.mjs`。
仓库提交检查：`node --test .tests/plugin-contract.test.mjs .tests/localization.test.mjs .tests/provisioning.test.mjs .tests/publish-workflows.test.mjs`。

截图、账号标识、配置备份、运行日志与本机路径保留在私有材料，不上传本 PR。打包产物通过 Forge 生成，不提交 `.cindy` 文件。
