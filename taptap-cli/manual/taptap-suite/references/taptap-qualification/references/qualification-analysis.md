# Qualification analysis

## 适用场景

用户问“还缺哪些资质”“资质齐不齐”“能不能上架”，或纠正游戏的联网、内购、AI、IP、文字剧情等事实时使用本 reference。

## 核心原则

`qualification get-qualification-status` 只返回 8 类资质的**客观状态登记表**（`qualifications[]`），**不做必须性判断**。

- 8 项 `pending_upload` 只表示“8 个资质槽位当前都没有材料”，**不等于 8 项都必须交**。
- “哪些资质是必须的”由 app-edit 手册的 `app analyze-app-status` 按游戏事实（联网 / 内购 / 文字剧情 / AI / IP + 包体类型）计算，本 reference 不做这个判断。
- 离线、无内购、无 AI、无 IP 的游戏，必须资质集合可能为空——此时 8 项 `pending_upload` 也不阻断上架。
- 不要把 `pending_upload` 直接读成“必须补齐”。那是把客观登记表误读成了必须性判断。

## 输入判断

1. 缺 `developerId` / `appId` 时先转 `taptap-identity`。
2. 先读取 `app list-packages`；`data.result.current_bindings` 中存在 `slot=windows` 时，确认当前草稿已绑定 Windows 包体。它是只读事实，不能作为 `select-package` / `clear-package` 的写入快照。
3. 读取当前 `qualification get-qualification-status` 结果。该 operation 只接受 `app_id` / `developer_id`，资质事实一律来自它的返回，不要臆造或补造输入字段。

## 命令

```text
call_tool(name:"schema", args:{_positional:["qualification","get-qualification-status"]})
call_tool(name:"app list-packages", args:{developer_id:"<developerId>", app_id:"<appId>"})
call_tool(name:"qualification get-qualification-status", args:{developer_id:"<developerId>", app_id:"<appId>"})
```

## 资质类型与状态

8 类资质（`qualification_type`）：

| 业务名称 | `qualification_type` |
| --- | --- |
| 游戏版号 | `game-license` |
| ICP 备案 | `icp-filing` |
| 隐私合规 | `privacy-compliance` |
| 防沉迷 | `anti-addiction` |
| AI 内容声明 | `ai-declaration` |
| 软件著作权 | `software-copyright` |
| IP 授权书 | `authorization-letters` |
| 安全评估 | `security-assessment` |

5 种状态（`status`）：

| 值 | 面向用户的含义 | 处理 |
| --- | --- | --- |
| `pending_upload` | 该槽位暂无材料（不一定必须） | 是否为缺口取决于必须性判断；非必须项不要称为“缺口”，改为询问是否需要补充 |
| `uploaded` | 已保存草稿、未提交 | 待提交审核 |
| `reviewing` | 审核中 | 等待结果 |
| `rejected` | 已驳回 | 读取 `reason` 与 `field_reject_reasons` 后重新处理 |
| `approved` | 已通过 | 完成 |

## 判断“必须资质”（哪些真的缺）

如果要回答“还缺哪些资质”“能否上架”，必须资质由 app-edit 手册的 `app analyze-app-status` 计算，不在这里判断：

1. 先转 app-edit 手册走 `app analyze-app-status`，看 `warnings[]` 里的 `QUALIFICATION_INCOMPLETE`。
2. `QUALIFICATION_INCOMPLETE` 的 message 里列出的才是“按游戏事实算出的必须资质缺口”。
3. 没有 `QUALIFICATION_INCOMPLETE` → 必须资质集合为空（或已满足），资质维度不阻断。
4. 拿到必须资质清单后，再回到本手册用 `qualification get-qualification-status` 看这些资质的客观状态和下一步。

## 执行步骤

0. **先确认「资质判断事实」**：用 `save-qualification-draft` 的 `app_features`（`is_internet_required` / `has_in_app_purchase` / `has_ai_content` / `has_ip_authorization` / `has_text_story_simulation` 及包体类型）逐项向用户确认（是否联网 / 内购 / AI / IP / 文字剧情），不确定时必须询问，不默认、不跳过；确认后写入 `app_features`。这些事实决定“哪些资质必须”，是后续判断的输入，不能跳过直接列 8 项。
1. 走 app-edit 手册的 `app analyze-app-status`，取 `warnings[]` 里的 `QUALIFICATION_INCOMPLETE`；它 message 里列出的才是“按游戏事实算出的必须资质缺口”。没有它 = 资质维度不阻断。
2. 调用 `qualification get-qualification-status`，记录 `version` 与 `qualifications[]`；该接口只是客观槽位登记表，不做必须性判断。
3. 报告客观状态：逐项列出 8 类资质的 `status`，但必须按“必须性”分层：
   - **必须资质**（来自 `QUALIFICATION_INCOMPLETE`）：`pending_upload` / `rejected` 才是“缺口 / 待补 / 待重提”，要说明对提交的影响。
   - **非必须资质**（其余 `pending_upload`）：只说明“该槽位暂无材料、按当前游戏事实非必须”，**不要称为缺口，不要并入待补清单**；主动询问用户是否需要补充其中某项，并说明补充价值（例如版号决定能否从“开放试玩”升级为“正式上线”）。
   - `rejected` 项单独列出 `reason` 与 `field_reject_reasons`；`submitted_fields` 用于说明“审核中已提交了哪些字段”。
4. 结论：
   - 必须资质里存在 `pending_upload` 或 `rejected` 时，明确表述“当前不能确认满足上架条件”，并列出这些必须项的待补 / 待重提。
   - 必须资质为空（或已满足）时，表述“按当前游戏事实无必须资质缺口”，不要用 8 项客观状态否定它。
   - 全部 `approved` 时表述“资质状态均为已通过”。
5. 输出不要平铺“资质 8 项全部未提交”这类全量缺口清单：先给必须缺口，再把非必须空槽作为可选项 + 一个询问。
6. 如果用户目标是完整发布，说明资质通过不等于资料、包体和版本发布条件全部通过，并转 app-edit 手册。

## 输出边界

- 结论必须以本次 `qualification get-qualification-status` 结果为准，不引用旧结果。
- agent 只报告服务端返回的客观状态，不自行追加或删除资质项，也不臆断“某场景必须某资质”。Windows 联网场景是否要求 ICP、隐私合规或其它材料，以服务端当前返回为准；需要规则确认时标注“需产品/服务端确认”。
- 不把测试玩家资格、激活码资格或普通资料缺口混入上架资质结论。
- 不默认输出 raw schema、接口路径、审核单 ID 或完整内部字段。
- 顶层 `ok=false` 时按 `error.type` / `error.subtype` 处理；缺少预期结果字段按异常处理，不能当成“没有资质要求”。
