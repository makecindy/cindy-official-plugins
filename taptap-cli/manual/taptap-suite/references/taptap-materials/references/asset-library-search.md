# Asset library search

## 适用场景

用户要为图标、宣传图、截图或 Windows 素材寻找参考图，一次检查多个场景，或排除已使用图片后重新找一张时使用本 reference。

## 命令

`search-assets` 一次接收多个目标场景（`target_scenes` 数组），不再区分单场景 / 批量。

```text
call_tool(name:"asset-library search-assets", args:{app_id:"<appId>", developer_id:"<developerId>", data:{target_scenes:["icon"]}})

call_tool(name:"asset-library search-assets", args:{app_id:"<appId>", developer_id:"<developerId>", data:{target_scenes:["header_banner","icon","windows_logo"]}})

call_tool(name:"asset-library search-assets", args:{app_id:"<appId>", developer_id:"<developerId>", data:{target_scenes:["icon"], exclude_asset_ids:[123]}})
```

- `target_scenes`：必填数组，≤10 个场景，不重复。
- `exclude_asset_ids`：可选整数数组，排除已使用的素材。
- `tag_filters`：可选，`field:operator:value` 格式，operator 仅支持 `eq` / `neq` / `gte` / `lte`。

场景枚举以 `call_tool(name:"schema", args:{_positional:["asset-library","search-assets"]})` 返回的 schema 为准。常见值包括：

- `icon`
- `header_banner`
- `screenshot`
- `square_banner`
- `windows_logo`
- `windows_cover`
- `windows_library_bg`
- `windows_logo_free`
- `windows_cover_vertical`
- `windows_logo_free_vertical`

## 流程

1. 确认目标 scene 列表；不确定时先读 schema，不猜枚举。
2. 一次调用 `search-assets`，`target_scenes` 传完整场景数组，不要拆成多个单场景请求。
3. 逐场景读取 `results[]`：每个场景有 `recommended_asset_id`（推荐参考图）和 `list`（按场景打分排序的候选列表），以及 `recommended_reason` / `pending_asset_id` / `pending_reason` / `total`。不同场景可能命中同一批素材，展示时按 `asset_id` 去重，并保留每个场景各自的推荐。
4. 某场景无可用候选时出现在 `missing[]`（带 `reason`），建议用户上传适合该场景的图片。
5. 推荐为空但候选全部处于处理中时，说明稍后重试，不把它解释成素材库为空。

## 候选条目字段

`list[]` 的每个候选都携带完整图片元数据，可直接拼成资料字段的值 `{"url": ..., "info": ...}`：

| 字段 | 说明 |
| --- | --- |
| `asset_id` | 素材 ID |
| `url` | 图片 HTTPS 地址 |
| `width` / `height` / `size` / `format` | 回填 `info` 用 |
| `color_model` | 通常为空（proto 已废弃） |
| `image_ave.rgb` | 图片平均色，回填 `info` 用 |
| `tagging_status` / `tags` | 打标状态与标签 |

挑选候选后写入字段时，带上 `url` 与完整 `info`（含 `image_ave.rgb`）。`image_ave` 缺失说明该素材记录本身没有平均色（2026-10 之前的老素材），这类老素材**不能直接写入资料字段**（服务端要求五项齐全，缺平均色会被 400）：要么重新用 materials 手册的 `upload` 上传一遍拿到完整 info，要么换一张带平均色的候选。不要伪造颜色。

## 场景推荐不等于尺寸合规（重要）

- `target_scenes` 是服务端按场景打标的推荐口径，**不代表候选满足目标场景的硬性规格**；写入或交给用户前必须按候选自身的 `width` / `height` 再校验一次。
- 图标（`icon`）的硬性要求：宽高比 1:1、宽和高均 ≥512 像素、JPG/PNG、不要预加圆角（见 [游戏物料要求](taptap-suite/references/material-requirements.md)）。
- `icon` 场景里没有 1:1 候选时，明确说明「素材库暂无合适的方形图标参考」，转入上传或生图流程；**不得把 `header_banner` 或 1920×1080 之类的横版素材推荐为图标参考**。
- 其他场景同理：推荐项只表示「素材库认为接近该场景」，最终以目标字段规格或官方物料要求为准。

## `tagging_status`

| 值 | 面向用户的含义 | 处理 |
| --- | --- | --- |
| `1` | 处理中 | 暂不作为系统推荐项，稍后重试 |
| `2` | 可用 | 可作为推荐参考 |
| `3` | 处理失败 | 不作为推荐项，按失败结果处理 |

状态数字只用于内部判断，面向用户使用上面的文字含义；不要从状态数字推断图片仍可直接使用。

## 异常处理

- 业务结果按 `results[]` / `missing[]` 解释；某场景无候选不是工具失败，而是出现在 `missing[]` 里。
- 顶层 `ok=false` 时按 `error.type` / `error.subtype` 处理；`searchAssets` 没有通用的 `data.result.ok`。
- `recoverable=true` 时使用 `reason` 说明失败原因，并按 `guidance` 给出重试、调整参数或刷新登录等下一步。
- 响应缺少预期结果字段时不能当成空素材库，必要时报告 `upstream.message`。
