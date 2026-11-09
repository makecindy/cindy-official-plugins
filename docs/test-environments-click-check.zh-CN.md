# 1.1.3 页面点击测试

本轮使用独立 Chromium，对随包原始 manage.html/manage.js/main.js 实际点击、输入、选择和提交，
连接真正的 node/worker.cjs 和共享核心。测试数据及应用都是独立临时样本，不使用真实登录凭证。

## 测到了什么

最终普通仓库检查 **98/98 通过**，浏览器点击测试 **13/13 通过**。

13 项浏览器测试包括：

- 点击创建项目、两个账号、启动方案和验收用例；按项目筛选账号；切换原始/验收配置；查看实际启动计划。
- 桌面方案通过按钮启动真实子进程、准备样本文件、执行验证、停止、再启动，并确认账号引用保留。
- 对错误账号改绑、无效 JSON、陈旧版本保存给出提示；最新记录不被覆盖；连接失败后可刷新恢复。
- 延迟服务回包，经过 BroadcastChannel 自动重发后，保存操作仍只执行一次。
- 中文、英文、日文、韩文 × 明暗模式，320 px 页面和表单不横向溢出；中文截图已检查。
- 对模拟应用经过真实 HTTP/WebSocket/CDP 点击“记住账号／选用账号”；等待实际账号身份确认；
  模拟已核验登录态失效后，运行卡片直接提示重新登录，详情显示 ACCOUNT_REAUTH_REQUIRED；点击停止并确认进程退出。

## 点击发现并修复

1. 桌面项目虽配置 prepare 命令，原页面却只在移动平台显示准备入口。
   现在已配置 prepare 的方案显示“准备样本”（四语言齐全），原移动端准备构建入口仍保留。
   修复前点击套件 12 项中 1 项失败，修复后完整流程通过。
2. 已成功核验的会话失效后，曾选过的账号可能只得到“切换未确认”，或再发起一次切换。
   现在持续提示重新授权，并在运行卡片显示四语言提示，等待正常登录，不自动重试切换；补充共享核心回归和页面点击验证。

## 证据边界

Cindy 当前未安装此插件，已选择的“我的浏览器”控制未就绪。
因此测试运行在新建的独立无头 Chromium 上：仅宿主 /app-context、/wake 和 node 传输使用
受限的本地测试桥；管理页、BroadcastChannel 去重、Worker、目录和进程执行均为原代码。
测试桥只绑定 loopback，限制来源并校验每次测试的随机请求校验值；不连日常 Cindy。
模拟账号应用不是真实 Cindy，浏览器测试不代表宿主安装、正式账号或两台电脑 SSH 已验收。

运行环境沿用自检的 macOS/Node/Python；Playwright Core 1.65.0，Chromium 157.0.8103.38（版本也记录在测试输出）。
最终结果、源码提交、.cindy 哈希记录在 #309。本次截图在当前任务 research/browser-clicks；
未将真实账号、日志、数据档案或测试依赖打入插件。

## 复现

在仓库外准备 playwright-core；使用独立测试浏览器的可执行文件，不接管日常浏览器档案。

```sh
TEST_ENVIRONMENTS_PLAYWRIGHT=/absolute/path/to/playwright-core \
TEST_ENVIRONMENTS_CHROMIUM='/absolute/path/to/Chrome' \
TEST_ENVIRONMENTS_BROWSER_EVIDENCE=/absolute/path/to/task-screenshots \
node --test .tests/test-environments.browser.test.mjs
```

全部普通仓库检查仍需执行。真实 Cindy 安装、正式账号登录/停止重启/过期授权、
第二台电脑独立登录、真实 SSH 与硬件/人工步骤仍按交接方案验收。
