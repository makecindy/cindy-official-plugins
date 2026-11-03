# 本地 Lua 验证与截图

本流程通过 `ghost_call({ ghost_id: "taptap-maker", tool: "maker_validate", args: { ... } })`
调用插件随包 Maker Runtime 的本地验证。只操作 Cindy 当前可信工作区；不安装独立 MCP、不提交或远端构建。

## 开始

1. 调用 `maker_status` 确认当前项目，然后按目标选择要验证的入口、断言与截图状态。
   本插件入口仅支持单机；Runtime 0.0.40 的 --network 尚未映射到插件参数。联网项目不可擅自改为单机，也不绕过插件执行 CLI。只读会话拒绝执行。
2. 默认 `mode=validate` 取得报告；需要看画面用 `mode=both` 或 `screenshot`，并按当前游戏
   加载流程选择 `screenshot_frame`，没有固定帧数保证就绪。可选 `entry`、`test` 都是项目脚本目录下的相对路径。
   frames、test 仅适用于 validate/both；screenshot_frame 仅适用于 screenshot/both。
3. 验证要求项目 .maker/validation-evidence/ 已被 Git 忽略且没有已跟踪文件；检查失败时拒绝派发。
   按提示核对忽略规则和索引，不自动改写 .gitignore 或移除已跟踪文件。
   工具随后检查真实预览状态；有活动窗口或归属不明时拒绝，不自动停止或接管。Runtime 未安装时
   如实报告，验证不自动下载安装；活动预览需按用户明确意图处理，不能为运行检查擅自停止。
4. `timeout_seconds` 是单轮验证预算；包括自动截图重试在内，整个 CLI 调用最多 14 分钟。
   该总时限优先于单轮预算，超过后停止并返回状态未知，不保证耗尽所有重试次数，也不自动重试。

## Skill 提示

Cindy 使用本插件 Manual 提供验证流程，不要求项目中先装 `run-lua-validate` Skill。
若项目已有该 Skill，应读取并保留它的项目特定验证约定；不要因本工具可执行而跳过这些约定。
返回的 `skill.sources` 是原始源文件位置，`skill.installed` 是可读的 Agent 安装副本，
`skill.conflicts` 记录普通文件占用或项目外链接。三者与 Runtime 是否能验证分开判断。

官方 CLI 的 warnings 可能仍提示原始 Skill 文件缺失；它检查的源目录和 Agent 已安装副本不同。
该提示是项目开发工具维护信息，不代表本地验证功能缺失，也不要求为了验证自动升级整个开发工具包。
保留原始告警和真正的执行错误，不把“修好了过滤名单”说成“已安装 Skill”。
本插件不覆盖原有 Skill、链接或过滤配置；官方 CLI 可能按其既有行为修复当前平台的旧排除项并返回告警。

## 判读与复测

- `validation.result=COMPLETED` 只表示采集完成，必须另外检查 `validation.report.result`、
  `test_result`、断言计数、错误和日志。没有请求断言时 `NOT_RUN` 不能说成断言通过。
- 每张 PNG 都要实际打开，对照本次明确期望检查 UI、内容和交互状态。加载画面、缺少截图或
  仅显示窗口都不能作为视觉验收通过。自动检查仅覆盖接近全黑/透明像素和已知引擎加载顺序。
- 原始 FAIL、TIMEOUT 和部分报告必须保留；不要提高阈值或过滤错误来获得 PASS。纯 UI 无 Scene
  时，不仅凭 scene_stalled/update_defined 判为游戏故障。截图帧耗时包含采集开销时另做无截图对照。
- 截图尚未就绪时，先检查原报告。只有没有实际运行错误且有足够时间预算，才按当前加载进度
  选择更晚截图帧复测；同一早期帧反复重启无助于就绪。已有自动尝试应先查看全部证据，避免重复运行。
- 明确授权后才修改项目；相关修复最多两轮自动尝试。修改后复测同一目标，不能把测试包装遗漏
  当作游戏缺陷，也不能重复调用原入口已经订阅的 Start/Update。
- 报告和 PNG 归档到项目 `.maker/validation-evidence/<run-id>/`，返回 `evidence` 为可读取的
  项目相对路径；返回值移除 Runtime 的结构化绝对路径字段，磁盘原始报告不变。缺少归档或采集失败如实报告。保留每轮证据，不反复启动 Runtime 轮询进度。
- 大结果返回 `validation.summary_only=true`，保留采集结果、报告结论、错误计数及断言状态；
  这不是完整报告。必须读取 `full_result_file` 指向的原始 `result.json` 和相关证据，不能只看摘要。
  原文件不截断、不改写；`full_result_file=null` 表示没有确认可读的归档，不能宣称完整报告已交付。

交付：原始报告结果、实际看图结论、失败位置及证据路径。普通本地窗口、联网功能和远端 Web
构建不属于本次 validate 验收，不宣称一并通过。
