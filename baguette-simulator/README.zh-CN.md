# Baguette 模拟器

[English](README.md)

显式选用的 Apple Silicon iOS 模拟器插件，随包带 Baguette 0.1.98。需要 Cindy 0.1.83+、完整 Xcode 和已安装的 iOS runtime，首次运行不下载依赖。

仅在用户明确选择 Baguette 时使用。先 environment、devices，复用适合的已登录设备，必要时 boot。App 仍由项目正常 Xcode 流程构建，再用 install_app、launch_app 安装和启动模拟器 .app。launch_app 默认打开当前 session 侧边栏；检查 viewer.previewOpened，不能把服务启动成功说成页面已显示。切换 session 后通过 open_viewer 打开已有设备。

控制页提供“恢复画面”（只重启画面服务）和“解除卡键”（只发送抬键）按钮，均不重启模拟器或 App。Agent 使用 press(button=release-input) 解除卡键。Unicode 粘贴会替换模拟器剪贴板；网页复制会替换 Mac 剪贴板。输入前观察焦点，之后核对结果；按键投递回调不代表 App 处理完成。

设备保存于 ~/Library/Application Support/BaguetteCindy/devices，截图在同级 screenshots。不会操作默认或 Cindy 内置设备，不自动抹除数据。同 bundle ID 覆盖安装通常保留 App 数据，但登录态仍由 App 数据迁移、退出登录和服务端有效期决定。并发 Agent 不要交错操作同一设备。

heal 会重启 SpringBoard 并关闭 App，必须先让用户接受影响；卡键先尝试按键释放。shutdown 关闭设备但保留数据，close_viewer 只停止画面服务。

## 安全与限制

Node Worker 有当前用户级本机权限。只调用固定可执行文件和命令形状，不提供任意 Shell 工具。控制页仅监听 127.0.0.1；剪贴板与控制请求校验来源、随机能力令牌和已打开的独立设备。不会提取账户令牌或转存到 Cindy。截图分析可能把画面送给模型；App 内操作可能造成外部业务副作用，仍须遵守任务授权。

上游画面包含可选 OpenStreetMap 地图请求、farm 页面字体请求，详见 VENDOR-REVIEW.md；这不涉及同步模拟器账户。不会后台安装依赖。

已知限制：iOS 27 上断开视频连接可能触发上游 SIGABRT。服务每分钟最多自动重启五次，独立控制页可手动恢复；这是缓解，不是原生崩溃根治。Worker 停用、退出或工具闲置一小时后控制页也会停止，需要 Cindy 再次启动。设备数据跨 session 保留，但浏览器标签属于当前 session。

## 构建与验证

在装有 Xcode 的 Apple Silicon Mac 上运行 sh native/build.sh，编译随包 Objective-C 源码并临时签名，不下载依赖；上游 Baguette 可执行文件保持原样。

运行仓库契约和 .tests/baguette-simulator.test.mjs。审核 VENDOR-REVIEW.md、THIRD-PARTY-LICENSES.txt 和提案 #119：https://github.com/makecindy/cindy-official-plugins/issues/119。首发为空定向受众，不推送全体用户。最终包在合格 Cindy 客户端内的安装验证，必须与直接 Node/原生测试分开记录。

可选位置面板通过 Node Worker 向 OpenStreetMap 发送搜索词和地图瓦片请求，仅使用固定 HTTPS 端点 nominatim.openstreetmap.org 与 tile.openstreetmap.org。浏览器请求保持同源；拒绝重定向和任意上游 URL，不转发账号凭证。
