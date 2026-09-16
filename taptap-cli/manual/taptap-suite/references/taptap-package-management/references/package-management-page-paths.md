# 包体管理页面入口

页面入口不是 CLI 的计算字段。`get-package-overview` 当前声明
`result.page_path`；CLI 和 Skill 只能使用本次响应实际返回的值，不得根据
`developerId`、`appId`、包体类型拼接路由，也不得把内部 API 路径当作用户入口。

返回非空 `page_path` 时，按 [shared execution](taptap-suite/references/shared-execution.md)「人工页面交接和链接输出」交付：URL 单独占一行、只展示一次，不使用 Markdown 链接或括号包装；不得补域名、拼接查询参数、改写路径，或引用历史 Spark 包体路径。

本次响应没有 `page_path` 或值为空时，只说明“当前响应没有可用的包体管理页面入口”，
停止生成链接；不要把 schema 已声明但本次无值误报成固定服务端合同阻塞。
