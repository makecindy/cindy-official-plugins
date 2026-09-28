# App Edit Skill Analysis

资料体检由当前宿主 Agent 按本流程完成，不依赖单独的服务端 AI 分析工具。CLI 只负责返回最新、可验证的模块、包体、版本和资质状态。

## 读取证据

已知 `developerId` 和 `appId` 后，按问题所需读取以下证据；用户问“还差什么 / 能不能提审 / 帮我检查资料”时读取完整集合：

0. 先调用 `analyze-app-status` 做总体体检：一次拿到 `blockers`（必填缺失 / 包体缺失 / 字段约束 / 防沉迷联动 / SCE 协议 / READ_ONLY）、`warnings`（资质缺口 `QUALIFICATION_INCOMPLETE`、审核结论、默认图标）和 `suggestions`（建议补充字段）。这比逐个读模块更全局，优先用于回答「还差什么 / 能不能提交」；具体字段为什么缺、怎么补，再用下面第 1 步的 `get-app-module` 读字段级详情。资质维度**只看 `QUALIFICATION_INCOMPLETE`**：它是按游戏事实算出的必须资质缺口，message 里列出的才是必须补的资质；没有它 = 资质不阻断，不要再去列 8 类资质客观状态。
1. 对 9 个模块分别调用 `get-app-module`：
   - `basic-info`
   - `assets-upload`
   - `profile-promotion`
   - `windows-exclusive`
   - `platform-status`
   - `release-settings`
   - `package`
   - `developer-info`
   - `other-settings`
2. 调用 `list-packages`，读取候选摘要、`current_bindings`、总数，以及当前 schema 声明时的 `package_slots`；包体写入只使用同次 `package_slots.<slot>.available` 与 `expected`，schema 未声明时停止绑定（契约见 [fields and packages](taptap-suite/references/taptap-app-edit/references/app-edit-fields-and-packages.md)）。
3. 调用 `list-app-versions`，读取当前声明的 `version_id`、`version`、`status`、`release_time`、`last_event` 和 `logs`；需要查看某一历史版本字段时，将目标 item 的 `version` 传给 `get-app-version`，读取只读的 `detail.form_data`。列表项的 `version_id` 当前只是 `version` 的兼容别名。
4. 资质只报告 `QUALIFICATION_INCOMPLETE` message 里列出的必须资质，转 qualification 手册看这几个的具体状态和补材料；不要因为 `get-qualification-status` 有 8 类资质（客观登记表）就把 8 个都列给用户。开发者认证转 identity 手册。
5. 资料填写提示或提审准备度检查按 [review risk checklist](taptap-suite/references/taptap-app-edit/references/review-risk-checklist.md) 将官方规则、当前事实、历史审核、测试证据和 Agent 判断分层。官方规则只从 [`official-review-rules-v4.md`](taptap-suite/references/official-review-rules-v4.md) 选择与当前字段直接相关的章节。

读取失败的维度必须标记为“无法确认”，不能把未知当作通过。只回答单个字段或素材规格时，读取目标模块即可，不为形式完整而调用全部模块。

## 确定性检查

按真实返回值执行以下检查：

- **版本状态**：以最新版本读取结果判断是否可编辑。审核中、定时上线、已上线或已下架时，不建议普通字段写入。
- **字段完整度**：只检查本次返回且可见的字段；字段明确返回 `required=true` 时，空值是阻断项。隐藏字段和未返回字段不能按静态表补成必填。
- **素材规格**：使用字段当次返回的 `image_spec` / `video_spec`。规格不可用时标记未知，不凭记忆给尺寸结论。
- **字段**：`get-app-module` 当前使用 `data.result.fields.<field_id>`；只检查字段对象当次实际返回的 `current_value`、`visible`、`state` 和规格字段。
- **包体**：候选必须来自同次 `list` 且 `status=ready`；槽位契约（`package_slots` 声明检查、`available`、`expected`）按 [fields and packages](taptap-suite/references/taptap-app-edit/references/app-edit-fields-and-packages.md)「包体槽位」执行，schema 未声明时停止绑定。字段缺失、空值、不可用或 stale 时标记“无法确认”并停止。
- **分发状态**：只报告 `platform-status` 中实际可见的 `region_flag_*`，并使用当次 `options` / `value_labels`。
- **发布设置**：以 `release-settings` 当前值为准；版本通常由平台按定时自动发布。若到点后仍为 `status="scheduled"`，仅在 `release_time <= 当前时间` 时可按生命周期流程确认后调用 `publish-scheduled-release`。
- **资质与认证**：以 `taptap-qualification` 的当前结果为准。任何未完成或无法确认项都不能被 AI 文案判断覆盖。
- **审核历史**：从 `list-app-versions.result.list[].logs` 按时间顺序读取事件、原因和备注；历史字段快照读取 `get-app-version.result.detail.form_data`。历史快照只用于解释和比较，不能直接作为当前 draft 写入的 `expected`，也不能把审核原文改写成官方规范。

语义质量由宿主 AI 判断，包括简介是否清晰、宣传语是否可落库、截图是否真实表达玩法，以及字段之间是否存在明显内容冲突。AI 判断只能形成 warning 或建议，不能覆盖服务端字段约束。

## 输出结构

面向用户按以下结构报告，不输出完整 raw JSON：

1. `结论`：`可以继续准备提审`、`存在明确阻断项` 或 `关键信息无法确认`。
2. `当前版本`：版本状态、是否可编辑、是否存在 unpublished / published。
3. `确定性阻断项`：包体、字段、资质或认证问题，并说明证据来自哪个当前读取结果。
4. `官方规则人工复核项`：附规则 ID、文档、章节和链接；CLI 无法判断时明确写“无法验证”。
5. `历史审核风险`：保留版本和审核原文；说明相关对象是否变化，但不自动宣称问题已修复。
6. `已通过项`：只列有当前确定性证据的检查，空数据和未检查项不能列为通过。
7. `下一步`：优先补包体（按当前包体类型与 `package_slots` 能力给可执行动作），再逐项引导补充其余缺口；用户未明确要求提审时，不进入提审链路。

Skill 分析是资料准备建议，不生成服务端 `submitReadiness`，也不能替代正式提审门禁。用户明确要求提审后，仍必须执行 `prepare-review-snapshot` → `precheck-app-review` → 最终确认 → `submit-app-review`；任一步返回 blocker、warning 或 stale 都以服务端结果为准。

## 文案文件候选

用户提供文案文件时，Agent 直接读取；公共物料上传流程不识别、解析或交接文案。Agent 应：

1. 读取用户指定的文案文件。
2. 只从明确内容生成 `title`、`description`、`category`、`developer_message`、`developer_type`、`promotion_text` 候选。`age_grade` 不属于资料字段直写能力，转资质人工流程。
3. 为每个候选说明来源、置信度和理由；不明确内容保持未填写。
4. 调目标模块读取 `current_value` / `expected`，展示 `actualBefore → proposedAfter`。
5. 获得用户确认后才调用 `save-changes`；不得覆盖已有非空值或把建议当作用户确认。

## 图片分类与字段映射

图片内容由宿主视觉能力判断，CLI 不提供单独分类工具：

- 游戏图标 → `basic-info.icon`
- 横版宣传图 → `assets-upload.banner_4`
- 1:1 宣传图 → `assets-upload.square_promo_image`
- 游戏截图 → `assets-upload.screenshots`
- Windows 素材 → 读取 `windows-exclusive` 后，按透明背景、是否含 Logo、横竖比例映射到当次可见字段

视觉判断后必须读取目标字段的动态规格。低置信度、多个字段都可能匹配、包含文字但用途不清或 Windows 素材语义不明确时，让用户确认；不得自动落库。

## 新版本资料候选

用户要求“帮我规划新版资料”时，Agent 读取当前 draft 和最近 published 版本，基于用户明确的更新目标生成字段候选。候选仍按 read-before-write 流程写入；不要假装存在独立的新版本草稿提案工具，也不要把页面预填行为包装成 CLI 能力。
