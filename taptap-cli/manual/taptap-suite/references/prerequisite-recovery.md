# 前置条件与账号状态恢复（汇总入口）

本页汇总「服务端以业务状态拒绝，但 CLI 本地无法修复」的高频场景，作为恢复口径的汇总入口；
各业务手册保留自己的场景化说明，遇到状态类失败时以本页的下一步/禁止动作为准。判定优先看错误信封的
`error.subtype`、`error.params`/`errors[].reason_code` 与服务端文案，再按本表给出下一步；
不要在表未覆盖的状态上猜测命令或入口。

通用规则：

- 状态类失败（`api/failed_precondition`、`api/conflict`、`authorization/permission_denied`、`compatibility/upgrade_required`）不是参数错误，不要反复改参数重试。
- `compatibility/upgrade_required`（HTTP 426，exit code 11）是 CLI 版本门：只能先 `taptap-cli update` 再重试原命令，重试登录或原样重发都不会改变结果。
- 服务端文案是事实来源；本表只补充「下一步做什么」。
- 需要用户在网页办理时，按 [shared execution](taptap-suite/references/shared-execution.md) 的人工页面交接规范提供入口：URL 单独一行、只展示一次、不加 Markdown 链接。
- 这些状态的失败不应原样重发；先按表格处理，再重新读取最新状态。

## 矩阵

| 状态 | 判定键 | 含义 | 下一步 | 禁止 |
| --- | --- | --- | --- | --- |
| 无开发者账号 | `validation/failed_precondition`，文案含 `no TapTap developer accounts are visible`；`overview` 的 `developers.guidance.required=true` | 当前登录账号尚未入驻或没有可见厂商 | 用 `overview` 返回的 `developers.guidance.create_url` 与 `docs_url` 引导完成入驻，完成后重新 `call_tool(name:"developer", args:{_positional:["+list"]})` | 继续猜 `--dev-id`；只回空列表 |
| 多开发者未指定 scope | `validation/failed_precondition`，`error.param=--dev-id`，文案含 `multiple developer accounts are available` | 账号下有多个厂商，命令无法自动选择 | 先 `call_tool(name:"developer", args:{_positional:["+list"]})`，让用户选择后显式传 `developer_id`；可用 `developer +enter` 保存上下文 | 猜 ID、按名称模糊匹配 |
| 包体类型未声明 | `api/failed_precondition`（422），文案含 `尚未保存包体类型声明` 或包体库 `empty_reason=package_type_undeclared` | 应用创建时没有保存包体方向，任何包体上传都会被拒 | 先与用户确认方向，再 `call_tool(name:"qualification save-qualification-draft", args:{developer_id:"<developerId>", app_id:"<appId>", data:{app_features:{package_types:["<类型>"]}}, idempotency_key:"<package-type-key>", dry_run:true})` 预览；用户确认后复用同一参数与 key 加 `yes:true` 补声明，读回 `declared_package_types` 后重试上传 | 猜类型；改用其它类型试探；新建游戏绕过 |
| 发布额度不足 | `api/failed_precondition`（422），文案含 `发布额度不足` | 账号滚动窗口内的首次发布额度已用完（服务端口径：滚动 168 小时最多 3 款、滚动 24 小时最多 1 款） | 调整发布计划到窗口释放之后；向用户说明当前不发、不要排队重复提交；需要即时提额时转人工处理 | 原样重提；换 scope/身份重试 |
| 小游戏隐私配置未开通 | `authorization/permission_denied`（403），文案含 `国内隐私维护资格` | 该游戏未开通「小游戏独立隐私配置」（国内隐私维护）。常见于：App 不是小游戏/未绑定 TapTap 小游戏、类目不支持、H5 游戏未过备案或不在白名单、当前环境不是国内站 | 说明这是平台侧的开通/资格问题，不是登录或 scope 问题；按开发者后台提示处理或转人工，确认是小游戏且已完成备案/开通后再重试 | 轮换 scope/token 试探；把 403 误报成「未登录」；对普通 APK/PC 游戏调用小游戏隐私接口 |
| 资质材料域不支持 | `api/failed_precondition`（422），`errors[].reason_code=QUALIFICATION_DOMAIN_UNSUPPORTED`，文案含 `材料域` | 该材料属于小游戏等专用材料域，通用资质入口不处理 | 改用对应专用命令：隐私走 `qualification prepare-mini-app-privacy` / `qualification submit-mini-app-privacy`；备案走 `qualification save-h5-game-filing`；详见 [资质手册](taptap-suite/references/taptap-qualification/MANUAL.md) 的材料交接章节 | 让用户重新填写已提交的材料；把「通用入口不支持」当成 CLI 不支持 |
| CLI 版本过低 | `compatibility/upgrade_required`（HTTP 426，`msg=upgrade_required`），`error.code=426`、`error.current_version`、`error.min_client_version`，文案含 `older than the minimum version` | 当前 CLI 构建低于服务端最低支持版本，能力接口被版本门拒绝；请求本身合法，本地无法绕过 | 在原任务边界执行 `taptap-cli update`（或按安装方式升级）后，用原命令重试；把服务端给出的最低版本一并告知用户 | 重跑 `auth login` 或换 token；重发未升级的原命令；猜最低版本；把 426 当参数错误改 `data` 重试 |

## 关联

- 身份与入驻细节：[taptap-identity](taptap-suite/references/taptap-identity/MANUAL.md)
- 包体类型与包体库诊断：[taptap-package-management](taptap-suite/references/taptap-package-management/MANUAL.md)；类型声明诊断见 [package-management diagnostics](taptap-suite/references/taptap-package-management/references/package-management-diagnostics.md)
- 资质材料域与交接：[taptap-qualification](taptap-suite/references/taptap-qualification/MANUAL.md)
- 写操作通用规范（`expected`、幂等键、确认门禁）：[shared execution](taptap-suite/references/shared-execution.md)
