# Asset library search

## 适用场景

用户要为图标、宣传图、截图或 Windows 素材寻找参考图，批量检查多个场景，或排除已使用图片后重新找一张时使用本 reference。

## 命令

单场景：

```text
call_tool(name:"asset-library search-assets", args:{app_id:"<appId>", developer_id:"<developerId>", data:{target_scene:"ICON"}})

call_tool(name:"asset-library search-assets", args:{app_id:"<appId>", developer_id:"<developerId>", data:{target_scene:"ICON", exclude_asset_ids:["123"]}})
```

批量：

```text
call_tool(name:"asset-library batch-search-assets", args:{app_id:"<appId>", developer_id:"<developerId>", data:{target_scenes:["HEADER_BANNER","ICON","WINDOWS_LOGO"]}})
```

场景枚举以 `call_tool(name:"schema", args:{_positional:["asset-library","search-assets"]})` 返回的 schema 为准。常见值包括：

- `ICON`
- `HEADER_BANNER`
- `SCREENSHOT`
- `SQUARE_BANNER`
- `WINDOWS_LOGO`
- `WINDOWS_COVER`
- `WINDOWS_LIBRARY_BG`
- `WINDOWS_LOGO_FREE`
- `WINDOWS_COVER_VERTICAL`
- `WINDOWS_LOGO_FREE_VERTICAL`

## 单场景流程

1. 确认目标 scene；不确定时先读 schema，不猜枚举。
2. 调用 `search-assets`。
3. 有 `recommended_asset_id` 时使用推荐项；候选列表只作为补充参考。
4. `found=false` 时建议用户上传适合该场景的图片。
5. 推荐为空但候选全部处于处理中时，说明稍后重试，不把它解释成素材库为空。

## 批量流程

1. 收集完整的目标 scene 列表。
2. 一次调用 `batch-search-assets`，不要拆成多个单场景请求。
3. 按场景汇总为：有推荐、仅有处理中候选、无候选。
4. 用户需要预览时，从对应场景的 `candidate_references` 读取图片；不要默认展示内部 ID。

## `tagging_status`

| 值 | 面向用户的含义 | 处理 |
| --- | --- | --- |
| `1` | 处理中 | 暂不作为系统推荐项，稍后重试 |
| `2` | 可用 | 可作为推荐参考 |
| `3` | 处理失败 | 不作为推荐项，按失败结果处理 |

状态数字只用于内部判断，面向用户使用上面的文字含义；不要从状态数字推断图片仍可直接使用。

## 异常处理

- `data.result.found=false` 是正常空结果，不是工具失败。
- 顶层 `ok=false` 时按 `error.type` / `error.subtype` 处理；业务结果按 `found`、`recommended_asset_id`、`items` 和 `total` 等当前 schema 字段解释。`searchAssets` 没有通用的 `data.result.ok`。
- `recoverable=true` 时使用 `reason` 说明失败原因，并按 `guidance` 给出重试、调整参数或刷新登录等下一步。
- 响应缺少预期结果字段时不能当成空素材库，必要时报告 `upstream.message`。
