# 运营阶段识别与官方手册

本文件定义游戏 handoff 的运营阶段识别顺序。手册标题、URL 和官方页面描述不在本文件重复维护；每次需要输出时读取随当前 CLI 版本内置的来源清单：

```text
call_tool(name:"skills", args:{_positional:["read","taptap-cli","references/sources/operation-handbooks/manifest.json"]})
```

从 `sources[]` 中选择 `source.stage` 与阶段 ID 相同的唯一条目，使用其 `title`、`url` 和 `description`；其中 `unknown` 对应 `id=overview` 的快速入门总览。`description` 来自官方页面的 `meta[name=description]`；面向用户压缩成一句话，但不得新增文档没有承诺的固定曝光、推荐位或流量结果。来源清单读取失败或找不到唯一条目时，停止生成描述并报告包内来源缺口，不从记忆、搜索或相邻手册补造。

## 识别顺序

先确定当前 handoff 属于资料提审/发布还是测试计划；业务域明确时只使用该域的证据。证据冲突、列表读取不完整或状态值未知时选择 `unknown`，不要靠优先级掩盖冲突。

| 阶段 ID | 充分证据 | 明确排除 |
| --- | --- | --- |
| `reservation` | 用户当前目标是首曝/开放预约，且写后读回的可见 `region_flag_*` 使用 `value_labels[String(current_value)]` 得到的状态文案明确包含“预约”；纯咨询尚未写入时可使用用户明确目标，但要表述为目标阶段 | 只有“敬请期待”、字段不可见、仅凭游戏尚未上线 |
| `testing` | `list-test-plans.result.list` 非空，且存在 `status` 精确为 `new` 或 `published` 的计划；创建或 `reopen=true` 后必须重新读取计划列表再判断 | `status=ended`、`list` 为空、仅创建结果 `status=created` |
| `first_launch` | 提审前用 `list-app-versions --page-all` 取得完整历史，确认不存在任何 `status=online`、`status=offline` 或 `last_event=published` 的版本；当前目标明确为首次正式上线。发布完成后还要读回当前版本为 `online` | 只看到当前 `status=online/status_value=4`、版本列表未读全、已有任一发布历史 |
| `long_term` | 完整版本历史中已存在任一 `status=online`、`status=offline` 或 `last_event=published` 的版本，且当前是版本更新、再次提审、活动或上线后的日常运营 | 没有完整历史、尚不能证明曾经发布 |
| `unknown` | 当前业务阶段无法由以上证据唯一确认，或不同证据互相冲突 | 不得猜测或同时输出多个阶段手册 |

## 完整历史门禁

首次上线和长线运营的判断必须使用完整版本历史。优先执行：

```text
call_tool(name:"app list-app-versions", args:{app_id:"<appId>", developer_id:"<developerId>", page_all:true})
```

若分页被 `page_limit` 截断、返回条目数无法覆盖 `result.total`、任一 item 的 `status` 为空或超出 `draft/reviewing/scheduled/online/offline/rejected`，且没有可解释的 `last_event`，均视为历史不完整，阶段回退 `unknown`。统计发布历史时按 `version` 去重：同一版本同时出现 `status=online` 和 `last_event=published` 只算一个已发布版本。

## 输出格式

每次 handoff 最多输出一个手册：先用一句话说明“为什么适合当前阶段”和从 `description` 压缩出的用途，再将 `url` 裸链单独一行输出一次。不要使用 Markdown 链接包装、括号重复 URL、追踪参数或二维码。
