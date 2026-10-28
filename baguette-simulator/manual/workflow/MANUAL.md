# 设备模拟器：完整工作流

## iOS 启动内存模式

device action=boot memoryMode=saving|standard|minimal。关机设备未指定时默认 saving；运行中未指定时保持当前模式，不重启。需要切换时先正常 shutdown（会退出 App，保留数据），再带模式 boot；不适用于安卓、tvOS 或 visionOS。

- saving：日常 UI/交互测试。关闭 Spotlight、家庭/屏幕时间、健康/HomeKit、部分系统 App/地图、游戏存档/手柄、信息/FaceTime、诊断与 DeviceCheck 服务。
- standard：恢复本插件内存配置管理的服务，不碰其它服务开关。完整验收、性能基准、上述系统集成和游戏手柄/存档测试选此档。
- minimal：只在用户或任务明确限定为核心玩法/UI时选；还关闭账号/iCloud、StoreKit/推送、照片、实时活动、语音、网页后台与设备互联等服务。不是“游戏就无风险”，不用于完整登录、支付、广告、分享或验收流程。

检查启动返回的 memoryMode.mode、verified、limitations 与可能的 warning。verified 仅验证 launchd 服务开关，不证明业务功能正常或内存节省幅度。未验证、模式不匹配或启动超时先检查设备，不盲目重启。覆盖值跨关机/抹除保留；下一次未指定的冷启动仍应用 saving，极简不会成为默认。服务配置来自固定的 SimSlim 0.12.2 目录，不下载或运行外部工具。


本插件在独立设备集合里运行 iPhone/iPad、Apple TV、Vision Pro 和安卓模拟器：设备只属于本插件，不碰 Xcode 默认设备，也不碰 Cindy 内置设备。所有观察与操作都走模拟器自身的通道（截图、无障碍树、系统触摸），不依赖任何窗口，Mac 锁屏时也能用。画面实时显示在当前任务的侧栏页签，用户可以随时看着你操作或亲自接管。

## Apple TV / Vision Pro

各平台共用主屏幕、截图、查看缩放及操作说明入口；单击动作按钮执行一次，模式、
开关和折叠姿态使用同一选中高亮。按钮悬停可看说明和快捷键，触屏可点操作说明。
Vision Pro 临时拖动视角按钮不改变当前模式。画面里的具体手势按设备能力解释。

在 `environment` 里按平台选运行时与机型，设备的 runtime 决定操作方式。Apple TV
使用 `press` 遥控（up/down/left/right/select/back/menu/home/play-pause）；Vision Pro
使用 `tap` 空间点击、长按及键盘，`press digital-crown` 返回主界面。截图与 OCR
坐标遵循同一视图点空间，Vision Pro 点击通过单手捏合发送。
TV/Vision 的 `describe_ui` 所有模式均返回 OCR 文本列表，`mode=full` 不提供无障碍树，
`x,y` 按文字框筛选并优先返回最小包含框；OCR 失败会报错，不视为空画面。

Apple TV 的实时画面支持双指触控板移动，连续发送原生 Siri Remote 触点的开始、
移动和结束事件，长滑可以跨越多个选项。单击确认当前焦点项，右键或 macOS Control
点击返回。macOS 自然滚动下焦点跟随手指移动；点击不按电视画面坐标选取。
桌面滚动事件包含系统加速与惯性，没有真实抬指信号，手感并非与实体遥控器完全相同。

两者均支持 App 安装启动、实时画面、截图和 OCR。构建目标选择 tvOS Simulator 或
visionOS Simulator，不能把 iOS App 装到 Apple TV；Vision Pro 兼容 iPad App 走整包
安装，由运行时判断兼容性。跨平台切换不自动搬运 App。Vision Pro `type_text auto` 默认粘贴；
tvOS `auto/type` 使用至多 300 字符的 US 键盘事件，需要先选择英文输入法。
tvOS 无模拟器剪贴板，不支持粘贴及 Unicode 文本。两者均支持 `keys`。

Vision Pro 的实时画面支持点击、长按、拖动，Shift 拖动控制远近；Control 拖动转向。
工具栏可选择转向、平移、环绕、推拉及复位。直接拖动四个视角按钮可临时调整视角，
不会改变当前指针模式；单击才切换画面拖动模式，悬停提示会说明。WASD/方向键移动，Q/E 下降/上升；
触控板双指滚动平移，捏合推拉。Option 拖动或启用双手按钮后，横向缩放、纵向旋转。
键盘按钮开启后向设备输入文字、按键和粘贴；关闭时仅处理视角移动键。鼠标捕获把相对移动和按键交给设备，Escape
退出捕获。录屏按钮开始录制，再按一次保存。鼠标捕获需要桌面查看器焦点及浏览器支持。
标准映射的游戏手柄：左摇杆移动、R2/L2 升降、右摇杆转向，仅在画面获得焦点时生效。
输入失败后先松开摇杆再继续；物理手柄适配仍待真机验收。

AI 空间操作沿用 `gesture`：

- `kind=spatial, action=drag, from=[x,y], to=[x,y], depth=0.2`：空间拖动，depth 单位米。
- `action=pinch, center=[x,y], scale=2`：双手缩放；`action=rotate, angle=45`：双手旋转。
- `action=tilt|orbit, by=[水平角,垂直角]`：相机旋转，单位度。
- `action=pan, by=[右,上]`：二维相机平移，单位米，传第三项会被拒绝。
- `action=move, by=[右,上,后]`：三轴相机移动，单位米；前后移动也可用 dolly。
- `action=dolly, distance=0.3`：向后推拉；负值向前。`action=reset` 复位。
- `action=gaze, center=[x,y]`：仅移动视线，不按压。

以上均带 `kind=spatial`；`duration` 控制动作时长，`hold` 控制移动前停留。
普通 `drag/swipe/pinch/pan` 也可用于 Vision Pro。观察坐标与 `tap` 相同，移动相机后
重新截图再选点；环绕以视点前方一米为中心。双手是模拟输入，不提供真实手部追踪。
不要把 `execution=executed` 当作应用已完成动作：它确认输入已交付，仍需观察结果。

两者不提供无障碍树或 ID。屏幕旋转、折叠、状态栏覆盖、`scroll_to`、`heal` 仅支持 iOS。
新增适配已验证 Xcode 27 与对应 27 运行时，其他版本未验证。
下文 iOS 手势和软键盘恢复说明不适用于 TV/Vision。
## 安卓先读

与 iOS 共用同一组工具、设备管理和任务侧栏；先按 `platform` 选择设备。安卓环境缺失时，让用户在插件设置查看组件大小与 SDK 许可后确认安装，不代替接受许可。支持 Mac、Windows x64、Linux x64；系统需硬件虚拟化，构建仍遵循项目流程。

安卓使用 `environment` 的 Android Phone/Tablet 与 `android:` runtime 创建私有设备。用 Gradle/项目脚本构建单个 `.apk`，`app install` 传绝对路径，轮询 job 到完成，再 `app info appPath` 检查 `matchesLocal`。`bundleId` 为 Android package ID；启动参数/env 只适用于 iOS。相同 APK 跳过，其余整包重装；不支持 AAB/split APK。切换只改变选择，不启停设备、不启动或搬运 App。安卓启动未确认时 appLaunched=false，检查 appTerminated（null 表示停止未确认）、launchError 与 execution；不能把 App 已停止后的失败当作未执行。删除/抹除的部分结果保留 completedSteps、failedStep、shutdown 与 deviceError，不清空任务和近期 App 记录；检查实际状态后再继续。

截图与输入统一为看到的视图点；Android 横屏已在触摸层转换，勿再手动旋转。无障碍树不可用时用本地英文/简体中文 OCR；其他文字用截图判断。Unicode 粘贴，逐键输入只支持 ASCII；touch 方法需要聚焦输入框及可用粘贴菜单。`press back` 是安卓返回，`shake` 模拟摇动；`pull-down-to-notification-center` 展开通知栏。`action`、`pull-down-to-lock-screen` 仅 iOS，安卓在输入前拒绝，不把锁屏下拉映射为通知栏。安卓没有 iOS 的键盘记录清理。

安卓日志默认最近 120 秒、default（警告及以上）、150 行，从最新最多 3000 条 logcat 原始记录中过滤。默认 main/crash buffer，crashes=false 只读 main，不生成 iOS 的 .ips 摘要或 crashes/crashesError。精确进程过滤只查当前 PID；App 退出或重启前的日志/崩溃未检查，processRunning=false 明确进程不存在，空日志不能证明没崩溃。需要历史证据时显式省略进程条件后检查设备原始日志，不自动扩大范围。连接或身份检查故障保留错误。状态支持方向、外观、字号、网络带宽/延迟/离线、定位、状态栏、具体运行时权限。安卓 appliedSteps 的 field/step 记录字段内已成功步骤，applied 仅列完整字段，stateError.step 指明失败步骤；先核对进度，勿整批重试。手机/平板无折叠铰链，不支持任意丢包率。权限仅支持 grant/revoke，reset 仅 iOS；安卓会在任何修改前拒绝 reset，依系统和 App 声明决定支持项。`heal` 会重启安卓并结束 App，先征得用户接受。画面共用控制器，但 iOS Baguette 高级工作台不适用于安卓，改用工具控制。

导入图片/视频用 `device action=import_media`（安卓，绝对 path，每个 ≤128 MiB）。返回目标 path、copied 和 scanRequested；importError 时先检查目标，勿重复复制。用户可滚轮滚动、捏合、双向文本复制粘贴、拖入文件，并在更多里录像；无音频 WebM 最长 5 分钟/128 MiB，旋转留边，离开前保存。Agent 观察转场继续用 capture，不以视频下载开始代替目标验证。

安卓 location={lat,lon} 会开启定位服务；location=clear 仅 iOS，安卓在任何批量修改前拒绝，不关闭定位服务。network=offline/100-loss 关闭 Wi-Fi/移动数据，其余档位开启两者；network=clear 恢复全带宽/无延迟。安卓 screenshot 不额外绘制物理圆角/挖孔遮罩，只支持省略 corners 或 false；true 在读屏前拒绝，不能用矩形截图证明物理遮挡/安全区。下次确认 SDK 安装时，既有一天保留规则清理旧 downloads 临时文件，不涉及 SDK/AVD 数据。

下面 Xcode、SpringBoard、Vision、iPhone Duo、增量 .app 同步等细节专指 iOS；观察→操作→验证、权限、任务隔离与关机规则适用于两端。

## 1. 开始

1. `devices`：`tasks` / `thisTask` 只表示当前选择；`activeTasks` / `thisTaskActive` 表示近 15 分钟使用，同一任务可使用多台。优先复用自己的设备；`usage: unknown` 不代表空闲，先核对画面和 `operation`，不要只凭 `tasks: 0` 接管；需要干净环境、特定机型或与其他任务隔离时才 `device action=create`（每台约 7–12 GB），新建前用 `environment` 查可用的运行时与机型。
2. `device action=boot`（想马上看画面就加 `screenshot: true`，启动后等画面稳定并附上截图，省一步），然后 `viewer action=open`（或 `app action=launch`，它会顺带打开画面，同样可加 `screenshot: true`）。检查 `previewOpened`，为 true 才能说画面已显示。`appLaunched: true` 与 `outcome: partial` 表示 App 已启动但画面未完成；仅重试 `viewer action=open`，不要重启 App。

不要另外下载 AXe、idb、Maestro，也不要用电脑操控工具去点 Xcode / Device Hub / Simulator 窗口：本插件已经提供真实触摸、截图和等待，后者会抢用户鼠标、在锁屏时失效。

## 2. 构建与安装

`environment.baguette` 来自实际二进制版本，兼容提示不重复固定版号。查看器截图导出到 Mac 剪贴板或桌面，确认写入返回 `executed`，写入命令发出后失败为 `unknown`；先检查目标再决定是否重试。剪贴板临时图片清理失败不覆盖已确认的导出结果。

本插件不构建项目。构建用项目自己的流程；独立设备不在 Xcode 的设备列表里，所以不要用 `-destination id=<UDID>`，而是构建通用模拟器产物：

```
xcodebuild -scheme <Scheme> -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath build build
# 产物：build/Build/Products/Debug-iphonesimulator/<App>.app
```

CMake、Unity、游戏引擎等用项目已有的脚本，找到输出的模拟器 `.app`。

- `app action=install appPath=<绝对路径>`：与已装内容完全相同时直接跳过（`mode: unchanged`）；只改了少量文件时增量同步（`mode: sync`，保留 App 数据）；否则整包安装（`mode: full`）。哈希、构建比较和写入属于同一个 job；`mode: checking` 表示还在比较。`modeReason` 说明安装选择原因；比较完成时可带 `changedFiles`。整个流程默认等待约 80 秒，未完成会返回 `state: running` 与 `job`，用 `app action=install_status job=<job>` 继续等，不要重复发起安装。
- Apple `app action=info bundleId=…` 只读轻量元数据；加 `appPath` 时，默认 `verify=auto` 复核既有全包验证，未有有效结果则返回校验 `job`。默认最多等 5 秒，继续用 `install_status` 等同一个 job。`verify=full` 强制重新校验全部内容，`verify=none` 只查元数据。只有 `matchesLocal: true` 才确认构建；版本号或可执行文件指纹都不能代替资源一致性，`null`/`unconfirmed` 不能作为重装依据。
- Apple 安装 job 包含安装后全包校验，成功结果可直接作为本次构建证据。重复 `info` 仍检查源包和已装包的完整文件清单（路径、设备/inode、类型/权限、大小、纳秒 mtime/ctime 和符号链接目标）；任一变化、容器或源路径变化、超过一小时、worker 重启均不复用。恢复原大小与 mtime 的资源修改仍由 ctime 检出。完整校验另行比较符号链接目标，避免系统 rsync 漏报；`symlinkTargetsChanged` 独立于 rsync 报告的 `changedFiles`。复用仅适用于本机文件系统的正常变更语义；不证明 App 数据、运行进程或外部下载内容一致。`verifiedAt` 是全包校验时间，`checkedAt` 是复核时间；没有持续监控后续变化。校验前后清单变化会报告未确认，不保存有效证明。
- 安装和校验均用 `install_status job=…`；通常省略 `wait`（默认85秒，完成立即返回）。`wait=1` 适合明确需要立即返回的脚本，不必让模型每秒查询。可用并行工具调用同时等待不同设备。`phase`/`phaseElapsedSeconds`/`phaseMs` 是真实阶段及耗时；未提供百分比时不能估算进度。校验 job 不会安装、结束或启动 App。
- 容器查询只有明确的 App 缺失才视为未安装；超时、设备服务故障或空响应会报错，自动安装在写入前停止。日志与日志等待也保留查询错误，不扩大到全设备。
- `app action=launch`：默认先结束旧进程再启动；需要启动参数或环境变量时传 `arguments`、`env`。

## 3. 坐标：一律用视图点

- `screenshot`、`tap`/`gesture` 的 `observe=screenshot`、`screenshot: true` 以及没等到的 `wait_for` 会在支持内联图片的 Cindy 中附图。旧版 Cindy，或压缩后图片仍超过 130 KB 时，只给 `path`：必须用读图工具打开后再选坐标，不要把文件路径当成已经看过画面。
- `capturedAt` 标注画面时刻，`screenshotAttached` 明确是否附图。已返回的画面足以验证目标就复用；动画未完成、画面过期或附图失败才继续观察。游戏可以直接截图选点，不强制读无障碍树。
- 截图已按用户看到的方向摆正（横屏、折叠屏内屏都一样），默认 1 像素 = 1 视图点。图上读到的坐标就是 `tap`、`gesture` 要的坐标，不要自己旋转图片、不要换算像素。
- `scale=2` 或 `3` 的截图更清晰，坐标要除以 scale；`region` 截取的局部图，坐标要加上 region 的起点。
- `describe_ui` 的 `frame` 与 `center` 也是视图点，`center` 可直接点击。
- 改方向或折叠姿态后，屏幕尺寸会变；以 `set_state` 返回的 `screen` 或新截图为准。
- 按坐标点击时，如果屏幕在你上次看图之后转了向（用户在画面页旋转、App 自己转屏），会返回 `SCREEN_CHANGED` 而不会点到别处：重新截图后再选点。

## 4. 观察与操作循环

`describe_ui` 自动 OCR 失败会报错；只有识别成功才能把空文字列表作为没有读到文字的证据。任务绑定保存后如状态或画面读取失败，会保留 `boundUdid`、`execution: executed` 并附 `taskStateError`；启动或新建后的后续步骤失败同样保留已完成结果。刷新任务状态，不要重复已完成操作。任务页会卸载状态不可读的新绑定之前的旧设备画面。

1. 有无障碍树的界面（原生 App、多数 SwiftUI/UIKit/RN 页面）：先 `describe_ui`（可加 `query`），再 `tap text=…` 或 `tap id=…`。同名元素多时加 `role`（如 `field`、`button`）或 `nth`。按文字点击会自动避开屏幕外的同名元素。
2. 没有无障碍树的界面（游戏、引擎自绘、部分 WebGL）：`describe_ui` 自动改为识别画面上的文字（`source: "ocr"`），每行文字带 `frame` 与 `center`；`tap text=…`、`wait_for text=…` 同样按识别出的文字工作，一行里的某个词也能单独定位。没有文字的图标、角色和道具用 `screenshot grid=true` 读坐标后 `tap x=… y=…`；小按钮先用 `region` 放大核对；按坐标点到识别出的文字上时，结果里的 `hint` 会提醒（图标可能被旁边的文字盖住，点中的是文字所属的控件）。识别在本机完成，不上传画面。
3. 操作会带来新页面或弹窗时，用 `until=<新页面上的文字>`（`tap`、`gesture`、`type_text` 都支持）：文字一出现就返回，最长 15 秒，没出现会尝试附上当时截图。比猜 `settle` 更快更准，也省一次截图。
   每次操作后核对结果：`tap` 与 `gesture` 默认在约 0.6 秒后返回新的界面元素（`observe=ui`；游戏里是识别出的文字）；要看画面就用 `observe=screenshot`，截图直接附在结果里，不必再单独截图。`settle` 接受 0–5 秒，默认 0.6；更长等待使用 `until` 或 `wait_for`。
4. 输入文字：先点输入框确认焦点，再 `type_text text=…`。默认 `method=auto`：普通 App 里粘贴（精确，支持中文与任意 Unicode）；游戏等没有无障碍元素的界面往往不接受粘贴，改为逐键输入英文、数字与符号，设备键盘是拼音、日文等输入法时会自动切到英文（结果里会说明，Ctrl+空格切回）。粘贴后输入框仍为空就用 `method=type` 重试；游戏里要输入中文只能粘贴，不接受时如实告诉用户。提交用 `keys: ["Enter"]`，清空用 `clear=true`。按键可写 `Enter`、`esc`、`up`、`a`、`A`、`cmd+A`、`shift+Tab`。
   - 粘贴（Cmd+V）、逐键输入、`keys`、`clear` 都是硬件按键：输入期间 iOS 会隐藏屏幕键盘。最后一次输入结束约 3 秒后，插件尝试清除硬件键盘记录；点空白处再重新聚焦输入框，观察键盘是否恢复，不保证自动弹出。要检查“键盘弹出时按钮是否被挡住”，先确认屏幕键盘已显示，再用 `method=touch`（点编辑菜单里的「粘贴」，纯触摸，保持键盘状态）填字并截图。`method=touch` 用在已聚焦的空输入框上，不需要为此重启设备。
   - `method=touch` 不能与 `clear=true` 或 `keys` 同用；这种组合会在输入前被拒绝，避免硬件按键隐藏屏幕键盘。
   - 逐键输入时屏幕键盘不会出现，所以不能靠“键盘有没有收起”判断编辑状态；输入框可能自动大写或纠错，和真机接键盘一样。只想结束编辑就点输入框以外的空白处；游戏里 `Enter` 常常等于确认，会直接提交或翻页。
5. 按元素点击后有按下效果却没反应：有些 App（常见于 React Native 键盘避让动画之后）报给无障碍的坐标已经过期，和画面差几十到上百点。截图核对后改按截图上的坐标点，并把坐标对不上记为 App 的无障碍问题。
6. 长列表找目标：`gesture kind=scroll_to text=…`，到底仍没有会报告并列出当时可见的文字，可据此修正文字（例如 iOS 27 的“隐私与安全”没有“性”字）。

## 5. 等待，而不是 sleep

输入执行和观察分别计时：普通附带观察最多12秒；`until` 先等目标文字最多15秒，再在剩余调用预算内观察。失败保留 `execution`、`timing` 和可用结果；`execution=executed` 只确认输入已投递。若附图失败，只调 `screenshot` / `wait_for`，不重发点击或文字。状态未知先观察；转向/折叠后重新确认几何与坐标。

App 已启动但 viewer 失败时，沿用已有服务恢复后尝试独立截图，最多12秒；宿主任务页打开失败也只补观察。保留 `appLaunched`、`outcome=partial`、错误及 `nextAction`。不能因无画面自动 terminate/relaunch；明确请求再次 launch 仍按 relaunch 参数执行。

- 等某个元素出现：`wait_for text=… timeout=…`；等它消失：加 `gone=true`。
- 等加载或动画结束：`wait_for stable=1`（画面变化低于 `tolerance`，默认 0.5% 像素，持续 1 秒）。游戏启动、场景切换用 `stable=2` 和较长的 `timeout`。
- 游戏背景常有持续动画（水面、粒子、待机动作），画面永远不会完全静止：没等到时会返回 `met: false`、每帧典型变化比例、建议的 `tolerance` 和当时截图（受剩余时间预算限制）；按建议加大 `tolerance`，或用 `region` 只看 UI 所在的区域。
- 等 App 打出某条日志：`wait_for log=<正则> bundleId=…`。
- 没等到时返回 `met: false` 与 `goalMet: false`（调用完成不等于目标达成），附原因、当时屏幕上的文字，并在剩余时间预算内尝试截图；截图失败或预算用尽会返回 `screenshot.error`，需要画面时另调 `screenshot`，等待结果仍保留。据此判断是没加载完、走错页面还是出错了，不要盲目加长时间重试。
- `device action=boot`、`app action=launch` 的 `screenshot: true` 会先等过黑屏启动帧和加载动画再截图；画面仍是黑屏时截图说明里会提示。启动、操作后的观察和附图共用本次调用截止时间，截图失败或时间不足时保留已完成的操作结果并返回 `screenshot.error`，需要画面可另调截图。

## 6. 抓一闪而过的画面

转场、按钮高亮、Toast、骨架屏、首帧闪烁这类内容，用 `capture`：

```
capture action={"tool":"tap","args":{"text":"登录"}} seconds=2 fps=12
```

返回一张按时间排列、标注毫秒的联系表（负数是动作之前），以及各帧文件。支持内联图片的 Cindy 会附上联系表；旧版 Cindy 或联系表超过 130 KB 时只返回 `sheet` 路径，须用读图工具打开。动作可以是 `tap`、`gesture`、`press`、`type_text`、`open_url`、`app_launch`。录制只在画面变化时出帧，静止画面只有一两帧是正常的。 capture 仅支持固定方向、尺寸与面板的画面；动作后和录制结束会核验，检测到变化或无法确认时不生成联系表，并保留动作 execution。它不跟踪逐帧方向，不能用来证明中途转向再转回的画面；先完成转向，再抓固定方向下的转场。

`execution` 表示动作是 `not_executed`、`executed` 还是 `unknown`；动作失败时 `actionError` 含 `code`、`message`、`execution`。即使没有录到帧，动作也可能已经发生；先核对设备实际状态，不要盲目重发。

录制等到完整首帧并确认画面后才执行动作；此前无帧、流故障或预算耗尽时返回 `captureError` 与 `execution: not_executed`。内部动作（含附图）、录制、几何核验与联系表渲染共用本次调用截止时间。录屏流提前退出、发生错误或停止后未能在剩余时间内排空输出，都视为录制失败，即使已经收到部分帧也不生成联系表。预算不足或录制失败时返回 `captureError`（`code`、`message`），保留完整的 `action` 或 `actionError` 与 `execution`；不会为录制结果重新执行动作。需要核对当前画面时另调 `screenshot`。

## 7. 设备状态

一次 `set_state` 可改多项：

- `orientation`：`portrait`、`landscape-left`、`landscape-right`、`portrait-upside-down`。App 不支持某方向时界面不会转，以截图为准。
- `posture`（iPhone Duo 等折叠屏）：`closed` 用外屏，`open`（130°）与 `flat`（180°）用内屏；也可传 0–180 的角度。
- `appearance`、`contrast`、`text_size`：深色模式、增强对比度、动态字体。设备立即生效，但只在启动时读取外观或字号的 App 要 `app action=launch` 重启后才变，以截图为准。不传任何项的 `set_state` 返回当前外观、对比度、字号和方向。
- `network`：`lte`、`3g`、`edge`、`very-bad-network`、`100-loss`、`offline` 或 `{latency, bandwidth, loss}`；只对之后启动的 App 生效，改完用 `app action=launch` 重启 App；结束时 `network: "clear"`。
- `location`：`{lat, lon}` 或 `clear`。
- `status_bar: "clean"`：9:41、满格满电，适合出商店图与对比截图；`clear` 还原。
- `privacy`：`{action: "grant", service: "photos", bundleId: …}` 等，提前授权以免权限弹窗挡住流程。改权限会结束该 App，请在启动前设置。

全部写入与读回共用本次调用截止时间。`applied` 列出已完成字段；失败或预算耗尽时停止后续步骤，并返回 `stateError`（`field`、`code`、`message`、`execution`）。先核对失败字段，不整批重试。方向/姿态变化后的 `screen` 仅在剩余时间内确认成功时返回；未返回时另取截图，`current` 中的 `null` 表示未确认。

## 8. 日志与崩溃

iOS 的 `level=default` 包含普通 Default 消息，不表示警告及以上；安卓的 default 才是 W/警告及以上，原始 logcat 与进程范围限制见「安卓先读」。

- `logs bundleId=… level=error`：最近的错误与故障；`match` 是不区分大小写的 JavaScript 正则（不支持 `(?i)` 写法），匹配整行（时间、类型、subsystem/category 与正文）；`last_seconds` 控制时间窗。`logs` 查已记录的历史，`wait_for log=` 等之后新出现的行。
- React Native、Expo 开发版的 `console.warn`/`console.error` 显示在 Metro 终端和 App 内的提示条里，不一定进系统日志。
- 默认附带本设备上该进程最近的崩溃摘要：异常类型、原因、崩溃线程调用栈。读取失败或预算不足时保留日志，返回 `crashesError`（`code`、`message`），不返回 `crashes: []`；后者只表示检查完成但未找到匹配报告。`crashes=false` 跳过诊断。App 闪退、白屏、卡在启动页时先看这里。

## 9. 系统弹窗

“是否打开某 App”、权限请求、通知授权这类系统弹窗不一定在 `describe_ui` 里出现：先截图，按图上坐标点击按钮。能提前避免的（权限）用 `set_state privacy` 预先授权。

## 10. 验证原则

- 验证交互必须用 `tap` / `gesture` 的真实触摸。不要往 App 进程注入事件（lldb 调函数、注入 dylib 发消息、改 SDL/Unity 输入队列），这会绕过系统触摸链路，出现模拟器里“测过”、真机上点不动的假通过。
- 汇报前确认装的是这次构建（`app action=info` 的 `matchesLocal`）。
- 只说实际看到的结果：截图或 `describe_ui` 里看到了才算；工具回执“已发送”不等于界面有反应。
- 用户说自己来测时，不必把每个细节都自动化验证一遍。

## 11. 异常恢复

- `taskBindingError` / `appContextError`：设备操作的原结果仍保留，但任务绑定或近期 App 记录未能保存。先检查记录文件和存储，不要为保存记录重发设备操作。切换任务的 `deviceJob` 保留 `taskBindingError` 与所选设备（可以是关闭状态）；切换只选择设备，点击「打开」才启动，不自动安装或打开 App。删除时分别尝试清理两类记录，一类失败不跳过另一类。
- `BUSY`：结果说明占用操作、设备和已用时间；安装占用给出 `install_status` 查询方式。设备操作执行前最多短等 1 秒，不重放已执行或结果未知的操作。不同设备的输入与 App 启动可并行，共享 App 记录仅在写入时串行；全局设置、关闭全部设备及共享查看器仍互斥。
- 工具与查看器的键盘/剪贴板输入按同一规范化 UDID 互斥，不同设备互不阻塞。设置页的全部关闭与关闭运行开关共用一次截止时间，耗尽后停止后续关机；`completed` 是已完成的关机命令，`outcomes` 保留逐设备执行归属，`unprocessed` 是未执行的设备。若返回 `devicesError`，列表是上次状态，仍须刷新确认，不能把命令完成当作全部设备已核实关闭。单台设置关机的复核失败同样保留 `completed`。
- 键盘连发或卡键：`press button=release-input`。
- iOS 27 上所有触摸都“成功”却没反应：多半是 Xcode Device Hub 抢占了输入，先告知用户，经同意后 `heal`（会重启 SpringBoard、结束运行中的 App）。
- `SCREEN_UNAVAILABLE`：App 正在启动或切换，稍等后 `wait_for stable=1` 再试。
- `SCREEN_CHANGED`：屏幕方向或折叠面板在你看图之后变了，什么都没发送；重新截图再操作。
- `RUNTIME_DISABLED`：用户在插件设置里暂停了模拟器，不要替用户打开，告诉用户去哪里开。

## 12. 画面页与收尾

`viewer` 打开的画面页由用户操作，可以输入、安装文件和 App（可能覆盖已有 App）、复制粘贴（替换 Mac 或模拟器剪贴板）、旋转、摇一摇、截图（存桌面或剪贴板）、切换与启停设备，以及使用 Baguette 高级工具（位置与运动模拟、状态栏与网络条件、摄像头输入、远程通知注入（可能触发 App 行为）、无障碍树、日志、录屏导出，可能包含 App 隐私数据；地图搜索与瓦片经插件代理发往 OpenStreetMap）。打开前把这些告诉用户；打开页面不会自动执行它们。

长脚本操作前可 `device action=activity udid=…`，每五分钟续一次，结束时在 finally 中 `device action=release udid=…`。记录 15 分钟到期，重启 worker 后清空；它不是排他预约，也不切换当前设备。普通操作自动更新记录，列表与安装状态轮询不更新。release 仅解除本任务记录，保留设备和 App 运行。

用完：不再需要的设备 `device action=shutdown`；`network`、`status_bar`、`location` 改过的记得还原。删除或抹掉设备只在用户要求时做。

App 内容校验失败会返回 `comparisonError` 与 `verification: unconfirmed`。此时 `matchesLocal: false` 不证明构建不同，检查比较失败原因，不要直接重装。
