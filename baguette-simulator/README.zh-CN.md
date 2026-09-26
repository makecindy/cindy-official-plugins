# Baguette 模拟器

需要 macOS 15.0 或更新版本；旧系统会在启动随包二进制之前明确返回 UNSUPPORTED_OS。

[English](README.md)

显式选用的 Apple Silicon iOS 模拟器插件，随包带 Baguette 0.2.0。需要 Cindy 0.1.83+、完整 Xcode 和已安装的 iOS runtime，首次运行不下载依赖。

仅在用户明确选择 Baguette 时使用。先 environment、devices，复用适合的已登录设备，必要时 boot。App 仍由项目正常 Xcode 流程构建，再用 install_app、launch_app 安装和启动模拟器 .app。launch_app 默认打开当前 session 侧边栏；检查 viewer.previewOpened，不能把服务启动成功说成页面已显示。切换 session 后通过 open_viewer 打开已有设备。

控制页提供“恢复画面”（只重启画面服务）和“解除卡键”（只发送抬键）按钮，均不重启模拟器或 App。Agent 使用 press(button=release-input) 解除卡键。Unicode 粘贴会替换模拟器剪贴板；网页复制会替换 Mac 剪贴板。输入前观察焦点，之后核对结果；按键投递回调不代表 App 处理完成。

设备保存于 ~/Library/Application Support/BaguetteCindy/devices，截图在同级 screenshots。不会操作默认或 Cindy 内置设备，不自动抹除数据。同 bundle ID 覆盖安装通常保留 App 数据，但登录态仍由 App 数据迁移、退出登录和服务端有效期决定。并发 Agent 不要交错操作同一设备。

heal 会重启 SpringBoard 并关闭 App，必须先让用户接受影响；卡键先尝试按键释放。shutdown 关闭设备但保留数据，close_viewer 只停止画面服务。

## 安全与限制

Node Worker 有当前用户级本机权限。只调用固定可执行文件和命令形状，不提供任意 Shell 工具。控制页仅监听 127.0.0.1；剪贴板与控制请求校验来源、随机能力令牌和已打开的独立设备。不会提取账户令牌或转存到 Cindy。截图分析可能把画面送给模型；App 内操作可能造成外部业务副作用，仍须遵守任务授权。

画面的可选 OpenStreetMap 地图请求通过固定端点的 Node 代理发送；farm 页面使用本机字体回退，不请求远程字体。详见 VENDOR-REVIEW.md；这些功能不涉及同步模拟器账户。不会后台安装依赖。

已知限制：iOS 27 上断开视频连接可能触发上游 SIGABRT。服务每分钟最多自动重启五次，独立控制页可手动恢复；这是缓解，不是原生崩溃根治。Worker 停用、退出或工具闲置一小时后控制页也会停止，需要 Cindy 再次启动。设备数据跨 session 保留，但浏览器标签属于当前 session。

## 构建与验证

在装有 Xcode 的 Apple Silicon Mac 上运行 sh native/build.sh，编译随包 Objective-C 源码并临时签名，不下载依赖；Baguette 和 HingeControl 基于 v0.2.0 加上 vendor-native.patch 重新编译；运行 sh native/build-baguette.sh <已验证的源码压缩包> 可重建。补丁让屏幕枚举与折叠控制使用独立设备目录、读取设备内真实折叠角度，并让改名后的设备仍匹配原型号。

运行仓库契约和 .tests/baguette-simulator.test.mjs。审核 VENDOR-REVIEW.md、THIRD-PARTY-LICENSES.txt 和提案 #119：https://github.com/makecindy/cindy-official-plugins/issues/119。首发为空定向受众，不推送全体用户。最终包在合格 Cindy 客户端内的安装验证，必须与直接 Node/原生测试分开记录。

可选位置面板通过 Node Worker 向 OpenStreetMap 发送搜索词和地图瓦片请求，仅使用固定 HTTPS 端点 nominatim.openstreetmap.org 与 tile.openstreetmap.org。浏览器请求保持同源；拒绝重定向和任意上游 URL，不转发账号凭证。

画面代理的 HTTP 和 WebSocket 均要求令牌会话；控制页用片段中的令牌换取 HttpOnly 会话 Cookie。这不构成对同一 macOS 用户权限进程或直接访问上游 Baguette 监听端口的沙箱隔离。

## iPhone Duo 与 Xcode 兼容

普通设备保留 Xcode 26/27 路径。iPhone Duo 需要当前选用 Xcode 27.1，并已安装 iOS 27.1 runtime。上游预览页提供 Duo 3D 模型、内外屏、姿态按钮和折叠角度滑杆；切换姿态会改变模拟设备状态及前台 App 布局。模型直接读取 Xcode，不由插件下载。插件使用当前选定的 Xcode，不自动安装、切换或降级 Xcode。剪贴板写入优先使用 CoreDevice，旧环境或不支持时回退到独立设备集合的 simctl。

已在 Cindy 0.1.93 Beta / iOS 27.1 实测 Duo 预览、合拢/展开、触控和中文输入。Xcode 26 集成尚未复测，具体边界见 VERIFICATION.json。
