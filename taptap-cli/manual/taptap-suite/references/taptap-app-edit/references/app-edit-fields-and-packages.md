# App Edit Fields And Packages

## 内容导航

- [提交准备度](#提交准备度)
- [文字字段](#文字字段)
- [图片与视频](#图片与视频)
- [包体槽位](#包体槽位)

### 提交准备度

按 [skill analysis](taptap-suite/references/taptap-app-edit/references/app-edit-analysis.md) 读取模块、包体、版本和资质，由 Agent 汇总当前阻断项。只检查当次返回且可见的字段；动态必填、包体限制或资质无法确认时明确标记未知，不能推断为通过。

Skill 分析只用于资料准备建议。用户明确要求提审后，以 `prepare-review-snapshot` 和 `precheck-app-review` 的当前服务端结果作为最终门禁。

当前 schema 声明 `list-packages.result.package_slots` 时，该字段固定返回
`main`、`windows` 和 `apk_mini_game_play`。每个槽位包含 `available` 与可原样
回传的 `expected`；空槽位明确返回 `{"kind":"none"}`。当前 schema 未声明
`package_slots` 时必须停止资料页包体绑定并报告契约缺口，不得从
`current_bindings` 或候选补造槽位快照。`current_bindings` 只有展示摘要，不能
作为 `select-package` / `clear-package` 的写入前置条件。

需要人工打开资料编辑页时，入口按 [shared execution](taptap-suite/references/shared-execution.md)「人工页面交接和链接输出」的推导规则生成；`/v3/<developerId>/app/<appId>/store` 不是资料编辑页，禁止使用。

### 文字字段

| 用户怎么说 | 处理 |
| --- | --- |
| “改成 Y” / “就用这段” | 用户已给最终值，直接 `save-changes` 写入，不再包装候选 |
| “帮我写 / 生成 X” | 直接给 2-3 个可落库候选；用户选定后立即写入 |
| “帮我优化 / 润色 X” | 先读当前值，再给 2-3 个改写候选；当前值为空则按创作型处理 |

- 候选必须是选中即可写入的最终值，不先让用户选风格或方向。
- 没有足够素材时用一个问题索要必要输入，不抛多轮风格问卷。
- 用户选定最终值后直接写入并展示 diff，不再追加“是否保存”确认。
- 每条 change 先读取最新并发快照：`expected` 直接原样回填该字段读取时的 `current_value`。`current_value` 为 `null`（首次写入）时，`expected` 传 `[]`；其余情况（string / 数组 / 数字 / 布尔）原样回传。除显式 `force=true` 外，每条 change 必须携带 `expected`。
- `title_ios`、`description_ios`、`icon_ios`、`banner_4_ios`、`square_promo_image_ios`、`screenshots_ios` 是可选 iOS 覆盖；空值（`current_value` 为 null）表示继承 Android。清空 iOS 覆盖字段恢复继承时，`expected` 使用该 iOS 字段自己的严格 `current_value`。
- `category` 是可编辑的游戏类型；C 端商店标签当前不能通过本 skill 或 CLI 修改。`age_grade`、`apk_package_name`、`mini_game_play_enabled` 也不能作为普通字段保存。

### 图片与视频

消息含 `<image-attachment>用户上传了一张图片，URL 为：https://...</image-attachment>` 时，`save-changes.value` 传完整 HTTPS URL。禁止使用 `attached://`、`file://`。

写图片前读字段 `image_spec`。多张截图按意图使用：

- 追加：`op: 'append'`
- 删除：`op: 'remove'`
- 整组重传：`op: 'replace'`
- 替换一张：`op: 'replace_one'`，并传从最新字段值读取的 `old_value`

```text
call_tool(name:"app save-changes", args:{app_id:"<appId>", developer_id:"<developerId>", data:{changes:[{field_id:"screenshots", op:"replace_one", old_value:"https://example.com/old.png", value:"https://example.com/new.png", expected:["https://example.com/old.png","https://example.com/keep.png"]}]}, idempotency_key:"<stable-save-intent-key>", dry_run:true})
```

资料视频规格必须以 `get-app-module("assets-upload")` 返回的 `video_spec` 为准。用户询问 `trailer` / `gameplay_demo_video` 的格式、大小、时长、分辨率、比例或内容要求时，先读取规格，只做判断，不调用 `save-changes`。

- 不凭记忆复述具体限制；规范来源、动态规格优先级、冲突口径和检查项统一按[游戏物料要求](taptap-suite/references/material-requirements.md)执行。
- 填写或替换素材时按 [review risk checklist](taptap-suite/references/taptap-app-edit/references/review-risk-checklist.md) 展示当前字段相关的官方规则、确定性检查结果和需要人工判断的内容要求；历史拒审必须单列来源。
- 已用 `call_tool(name:"upload-video", …)` 上传时，字段值传返回的数字 `videoId`，不是 URL。
- 未上传时转 materials 手册执行 `upload-video`（`--scene` 指定资料回填目标；其预览会读取目标字段的实时 `video_spec`，展示目标与规范，不会上传文件），拿到返回的数字 `videoId` 后按本节写入。`scene` 只表示本地资料回填目标，不会发送给上传接口（`getVideoUploadToken` / `completeVideoUpload`）。
- **拿到 `videoId` 即视为上传完成，直接写字段，不要等待或轮询转码/审核状态**。转码（transcoding）和素材审核是服务端后台异步流程：转码只影响「商店页能否预览」（转码完成前可能无法预览），不影响「字段已写入 videoId」；素材审核是提审后服务端判断，agent 在写字段这一步没有接口确认、也不需要确认。不要把「转码/审核仍在处理」输出成「素材状态未确认/无法验证」——那是 materials 手册的 `get-video-detail` 轮询场景（仅当用户主动要求确认视频可播/素材库收录时才用），不是资料字段回填的必做步骤。
- `trailer` 与 `gameplay_demo_video` 必须使用不同的 `videoId`。修改任一字段前先读取两者当前值，并校验本批变更后的最终值；若工具返回重复冲突，不要用相同 ID 重试，要求用户选择或上传另一个视频。不同 ID 只表示引用不同对象，不能据此宣称内容不雷同或语义审核通过。

### 包体槽位

选择或清空包体走统一流程：

1. `list-packages(package_types: [...])` 读取本次候选、`current_bindings` 和当前 schema 声明时的 `package_slots`；当前 schema 未声明 `package_slots` 时停止并报告契约缺口。
2. 候选必须来自同次 `list`、类型匹配且 `status=ready`；目标槽位必须 `available=true`。
3. 把 `package_slots.<slot>.expected` 原样写入 `select-package` / `clear-package`，不改变字段名或 ID 类型。
4. 使用稳定 `--idempotency-key` 先 `--dry-run`；用户确认后用相同 payload 和 key 加 `--yes`。
5. 写入成功后重新调用 `list-packages` 验证目标包体和新 `expected`；stale/409 时停止、重读，禁止自动覆盖。

Spark 版本有专用编排命令，避免把包体管理概览误当成资料页绑定接口：

```text
call_tool(name:"app +bind-spark-version", args:{app_id:"<appId>", developer_id:"<developerId>", data:"@spark-binding.json", idempotency_key:"<intent-key>", dry_run:true})
```

先从同次 `call_tool(name:"app list-packages", args:{data:{package_types:["spark"]}})` 选择
`status=ready` 的候选，把其 `package_id` 原样作为 `version_code`，并复制
`package_slots.main.expected`。dry-run 会按 startup Catalog 离线校验精确
`selectPackage` 输入并生成 apply 命令；`args.payload_digest` 同时固定已校验
payload 和 idempotency key，用户确认后必须原样执行该命令。apply 会重新读取候选、槽位
可用性和 expected，写后再读回目标
`spark_version_code`。未知写入结果按返回的 readback 命令先查询，禁止盲目换 key
重试。不要先调用 `clearPackage`，也不要把 Tap 小游戏 package ID
塞进 Spark payload。

| 槽位 | package.type | 说明 |
| --- | --- | --- |
| `main` | `apk` / `mini_app` / `spark` / `h5` | 互斥型主包体 |
| `windows` | `windows` | Windows 包体，可带 branch |
| `apk_mini_game_play` | `mini_app` | APK 下附加的 Tap 小游戏游玩方式 |

- `package_slots.<slot>.available=false`、槽位或 `expected` 缺失时必须停止。
- Tap 小游戏主包体使用 `slot:"main"` + `package.type:"mini_app"`；只有 APK 附加游玩方式使用 `apk_mini_game_play`。
- TapTap 制造 / Spark 主包体使用 `slot:"main"` + `package.type:"spark"`；`+bind-spark-version` 只接受同次 Spark 候选的 `package_id` 作为 `version_code`，并在写前再次验证。Tap 小游戏使用独立 package ID，两者不能互换。
- TapTap 制造 / Spark 包体由 [TapTap 制造](https://maker.taptap.cn/) 传入，CLI 不支持上传或更新；CLI 可把已存在且 ready 的 Spark 版本绑定到资料页主槽位。
- H5 使用 `slot:"main"` + `package.type:"h5"`；ID 取 H5 版本 ID，`select-package` 的 package 严格只传 `type` 和 `id`，不得带入返回项中的 `h5Package`。H5 元数据仅用于本地 pending state / 提审 override。是否已绑定以 `package_slots.main.expected`（`kind:"h5"` + `h5_version_id`）为准，不要靠 form_data 里的判别字段推断。
- Windows 使用 `select-package` / `clear-package`，不写 `save-changes.pc_package_id`。同时设置启动器包和游戏本体包时，每写一个 branch 后重新读取，再用最新 `expected` 写下一个。
- APK 内部配置仍用 `save-changes`：先读 package 模块，再修改防沉迷、TapPlay 授权、更新日志、更新模式和活动关联等当前可见字段；支持语言当前不可编辑，默认 `zh_CN`。
- 用户选择“未接入防沉迷”时写 `apk_anti_addiction_status=not-integrated`；工具会同步 `apk_sandbox_authorized=true`，回复中说明这是提审要求。
