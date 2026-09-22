# TapTap CLI 插件:身份与登录(identity)

identity 是所有业务手册的前置定位能力。它只确认登录态、厂商、游戏和 app scope,不修改任何业务数据。命令行示例按 [taptap-suite](taptap-suite/MANUAL.md) 的映射表转成 call_tool 调用。

**CRITICAL — 不要猜 `developerId` 或 `appId`;只给游戏名或厂商名时必须先查候选。**

**CRITICAL — `app +list --kw` 返回候选后只允许做目标确认,不得把第一个或唯一候选自动当成写入目标。必须展示开发者、游戏名、appId、状态和页面入口,并明确询问"更新已有游戏"还是"创建新游戏";在用户明确选择前不得交给资料、包体、审核或发布写操作。**

**总览范围 — `overview` 是账号范围与游戏样例总览,只允许可选的 `dev_id` 和 `page_size`。不要对它使用 `page_all`、`page_limit` 或 `page_delay`;需要完整游戏列表时,先标准调用一次 `overview`,再对返回的明确 developerId 调用 `app +list`(page_all:true, page_size:50)。**

**CRITICAL — 未登录时按插件登录编排执行:先 `call_tool(name:"auth login-start")`,再用返回的完整恢复参数(`login_handle`)继续轮询,不要从中截取单个标识重建登录状态。不要输出、记录或上报 access token——token 只由 CLI 保存在本机凭证存储,不进入日志、埋点或错误上报。**

**登录链接交接 — 把 `verification_url` 按两行原样提供给用户:第一行仅写"请完成授权:",第二行仅写 URL(不要 Markdown 链接,不重复);随后立即 `call_tool(name:"auth login-wait", args:{login_handle})` 持续轮询,不要等待用户回复;只有运行环境无法保活轮询进程时,才请用户完成授权后通知你。登录成功后向用户只回复"登录成功"。**

身份发现中的页面入口优先使用本次 `app +list` / `overview` 每个游戏返回的 `page_url`;接口缺失时,可用本次已确认的 `developerId`、`appId` 和当前环境 `serverUrl` 推导规范资料页 `https://<current-server-host>/v3/<developerId>/app/<appId>/store/update`。推导入口必须标记为非服务端返回,不得使用 Capability API 域名 `api.tapapis.cn`。

## 快速决策

| 用户意图 | 首选调用 / 回答 |
| --- | --- |
| 一次查看登录态、厂商、游戏样例和下一步 | `call_tool(name:"overview", args:{dev_id})`(可选) |
| 检查是否登录、是谁登录 | `call_tool(name:"auth status")`;未登录按上面的登录编排执行 |
| 查看自己有哪些厂商 | `call_tool(name:"developer +list")` |
| 创建厂商、注册厂商、申请厂商或入驻开发者 | 首轮直接提供当前环境配置的开发者中心 `serverUrl`;环境未知时只用 `call_tool(name:"auth status", args:{offline:true})` 读取,不查厂商列表或网页 |
| 用户指定厂商名但没给 ID | 先列 developer 候选;多候选让用户选 |
| 当前账号没有开发者账号 | 使用 `overview` 返回的 `developers.guidance.create_url` 和 `docs_url`;按共享规范分别以裸 URL 单独一行提供,完成入驻后重新 `developer +list` |
| 按游戏名找 app | `call_tool(name:"app +list", args:{dev_id, kw:"<keyword>"})` |
| 查看某厂商下所有 app | `call_tool(name:"app +list", args:{dev_id, page_all:true, page_size:50})` |
| 用户说"切到某厂商/某游戏" | `developer +enter` / `app +select` 校验并保存 CLI scope;不要声称切换了网页状态 |
| 权限不足、找不到厂商/游戏 | 说明当前账号无权限或无匹配,并给出可操作下一步 |

## 执行规则

- 候选列出名称、ID、服务端返回的状态和区分信息;超过 5 个时先按关键词收窄。
- 当输出包含 `selection.required=true` 时,把它解释为"必须由用户确认目标",而不是"CLI 已经选中目标"。
- `page_url_source=api_response` 表示入口来自服务端响应;`derived_from_developer_scope` 表示根据已确认 scope 推导的规范资料页,只能作为人工查看入口,不能声称是服务端返回的页面 URL。
- 用户泛问"当前账号能做什么 / 给我一个总览"时优先用 `overview`,不要手工串联 `auth status`、`developer +list`、`app +list` 和 `developer +suggest`。
- `overview` 只返回各厂商的游戏样例和总数,不做自动翻页;不要先尝试通用连续分页参数。用户明确需要完整列表时,再按它返回的 developerId 分别调用 `app +list`(page_all:true, page_size:50)。
- `app +list` 的标量查询条件必须使用 `kw`、`page`、`page_size`、`page_all`;不要把关键词和分页字段包进 `data`。
- `app +list` / `overview` 的游戏条目包含 `review_status_label` 和状态可用性;按服务端返回的标签原样回答状态,不自行改写,也不把多个游戏归为同一状态;缺失时按条目显示"未知"。需要版本、包体或更细的发布信息时转 app-edit 手册。
- 显式传入 `dev_id` 时,CLI 会先确认该厂商属于当前账号可见范围;不可见的 DevID 直接报错,不再把权限 / scope 错误误报成"关键词无匹配"。
- 常规身份发现统一使用 `app +list`,不要退回内部 tool 入口。
- 多候选必须让用户选择,不自动取第一个,也不复用历史对话里的旧 ID。
- `developer +list` / `overview` 明确返回零个开发者账号时,不要继续猜 DevID,也不要只返回空列表。原样使用本次 `developers.guidance.create_url` 和 `docs_url`:先说明页面用途,再将每个 URL 分别单独一行输出且各只展示一次;不要改写为生产域名、Markdown 链接或搜索结果。完成入驻后重新执行 `developer +list`。如果用户确认已有厂商,则改为检查当前登录账号或让管理员添加权限。
- 未执行 `developer +enter` / `app +select` 时,交给其它业务手册的下一条调用显式带 `dev_id` 和 `app_id`;已保存 CLI scope 时可省略,显式参数始终优先。
- "进入/切到某游戏"只保存当前 profile 的 CLI scope,不代表网页状态已切换。
- 身份发现页面链接优先使用每个游戏本次返回的完整 `page_url`;缺失时使用 CLI 根据已确认 ID 推导的规范资料页,并按 `page_url_source` 说明来源。不改写服务端已返回的路径。
- 官方号资格、制作人员认证、成员角色、权限配置等如果当前 CLI 无 tool,给页面入口或说明 CLI 暂不支持。
- 用户要创建厂商、注册厂商、申请厂商或入驻开发者时,CLI 不代为提交主体资料和资质审核。无需检查 Token 或厂商列表,首轮直接使用当前环境配置的开发者中心 `serverUrl` 作为官方入口;若上下文中还不知道环境,只调用 `call_tool(name:"auth status", args:{offline:true})` 读取 `data.serverUrl`,不访问网络。不要自行拼接更深的注册路径。标准输出为:

  ```text
  请前往 TapTap 开发者中心创建厂商:
  <serverUrl>

  当前 CLI 暂不支持代为提交主体资料和资质审核。
  ```

  入口必须遵循共享人工页面交接规范:`serverUrl` 原样单独占一行,只展示一次,不用 Markdown 包装,不添加追踪参数。使用当前环境配置提供的 `serverUrl`,不要在本手册中硬编码环境地址。
- 用户问"怎么获得官方号资格 / 为什么没有官方号页面"时,标准口径是:需要先完成厂商资料并通过平台审核,成为认证开发者;如已满足条件但仍未看到入口,引导提交客户工单。
- 需要人工介入的场景统一说"提交客户工单";不要说"联系运营同学 / 联系对接的运营 / 联系 TapTap 运营团队"。
- 找不到资源时建议换关键词或确认登录账号;权限不足时说明需切换账号或让管理员添加权限。

## References

| Reference | 什么时候读 | 读取方式 |
| --- | --- | --- |
| behavior rules | 处理"切到某厂商/游戏"、候选选择、口语 scope 请求时 | `ghost_manual({ghost_id:"taptap-cli", path:"taptap-suite/references/taptap-identity/references/identity-behavior-rules.md"})` |

## 不在本手册范围

- 不修改资料、不创建游戏、不提交审核;只负责定位和资源发现。
- 厂商注册、成员角色、官方号配置、制作人员认证等不是当前 CLI 的可执行写入范围;存在可靠官方入口时必须在首轮提供,否则说明 CLI 暂不支持且当前没有可确认的页面链接。
