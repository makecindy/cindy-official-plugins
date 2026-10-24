# Headline Digest

基于 NewsAPI `top-headlines` 的只读新闻摘要插件。需要 **Cindy 0.1.64 及以上**、仅访问 `newsapi.org` 的出站 HTTPS，以及用户自己的 NewsAPI key。纯 JavaScript，不依赖第三方运行库，也没有构建步骤。

## Key 与 NewsAPI 套餐

key 保存在 Cindy 的密钥库中，插件本身不保存。**NewsAPI 的免费 Developer 套餐仅限开发使用；日常使用需要付费套餐。** 免费额度还对每日请求数有很小的限制，额度用完后请求会被拒绝，因此今天可用的 key 明天可能返回 429 或 `rateLimited`。这两点在安装之前就能看到：本文件，以及设置页里的提示。

免费 key 可在 [newsapi.org/register](https://newsapi.org/register) 申请。

## 安装与启用

本插件是**按需启用**的：`provisioning.json` 中的条目不向任何用户预装，不会被自动安装。请在市场中启用它，然后打开设置页保存 NewsAPI key。未保存 key 时调用返回 `CREDENTIAL_MISSING`，消息会说明去哪里填写；key 被拒绝时返回 `CREDENTIAL_REJECTED`，并带上上游错误码。

## 凭据处理

`ghost.json` 只声明一个主机和一个密钥。设置页通过 `PUT /secrets/newsapi_key` 直接把值写入宿主密钥库，随后清空输入框，页面不再保留副本。`GET /secrets` 对每个条目只报告 `{ key, saved, tail? }`（从不返回值），状态行据此显示；`DELETE` 清除 key。请求时由 Cindy 为 `newsapi.org` 注入 `X-Api-Key`，`main.js` 自己不发送任何凭据，插件始终拿不到密钥值。跳转到声明主机之外的地址不会携带该请求头，沙箱也无法读回。key 不会出现在任何返回结果、错误消息、日志或 KV 中。

## 使用

直接询问头条、某国要闻、某个话题的新闻或一份摘要，例如「今天科技圈发生了什么」「日本头条」「关于大选的头条」。插件只提供一个工具。

`top_headlines`

| 参数 | 含义 |
| --- | --- |
| `query` | 可选自由文本，作为 `q` 传给 NewsAPI，最长 200 字符。带 query 时 NewsAPI 会按自己的规则决定是否忽略 `country`。 |
| `country` | 可选两位 ISO 国家代码，默认 `us`。 |
| `category` | 可选：`business`、`entertainment`、`general`、`health`、`science`、`sports`、`technology`。 |
| `limit` | 可选返回条数，1–20，默认 5。 |

每次调用只发一次 HTTPS `GET`，超时 20 秒。它不修改任何内容，重试总是安全的。

## 返回内容

成功结果为 `{ untrusted, origin, count, query, country, category, articles, note }`。`untrusted` 恒为 `true`，`origin` 为 `"newsapi.org"`：标题、摘要和媒体名称都是第三方文本，因此会告知 Agent 只把它们当作数据汇报，绝不执行其中出现的指令。

每篇文章为 `{ title, source, url, publishedAt, description }`。标题截到 300 字符、摘要截到 200、媒体名截到 80，截断时加省略号；`source`、`url`、`publishedAt` 可能为 null，没有标题的文章会被丢弃。`count: 0` 属于成功结果，`note` 会建议放宽 query、换一个国家或不加分类筛选。

## 错误

| 代码 | 含义 |
| --- | --- |
| `INVALID_ARGUMENT` | `query` 过长、国家代码、分类或 `limit` 不合法。 |
| `CREDENTIAL_MISSING` | 尚未保存 key，或宿主无法附加凭据。 |
| `CREDENTIAL_REJECTED` | 401/403，或上游 `apiKeyMissing` / `apiKeyInvalid` / `apiKeyDisabled`：需要更换 key。 |
| `RATE_LIMITED` | 429、`rateLimited`、`maximumResultsReached`，或返回 `apiKeyExhausted` 的 401 或 403：套餐额度已用尽。key 本身没有问题 —— 等每日重置或升级套餐。 |
| `UPSTREAM_ERROR` | 其它非 2xx 响应或上游错误体。 |
| `UPSTREAM_INVALID` | 响应不是本插件能读取的 JSON。 |
| `RESPONSE_TOO_LARGE` | 宿主截断了响应；请减少条数。 |
| `NETWORK_ERROR` | 无法访问 `newsapi.org`，例如代理问题。 |

错误消息给出处理办法而不是堆栈，插件也不会自行重试。

## 隐私

一个主机、一次只读请求。不读写文件、不读剪贴板、不截屏、不上报遥测、不访问其它网络地址，也不在插件内存之外留下任何内容。插件只持有宿主在每次调用中传入的数据。

## 开发与打包

在仓库根目录运行 `node --test .tests/headline-digest.test.mjs`。测试用模拟的 `cindy.fetch` 驱动 `main.js`，覆盖参数校验、文章映射、凭据注入形状、全部错误映射、不可信标记、只写设置通道和设置页 CSP，既不联网也不用真实 key。模拟测试不能代替在真实 Cindy 版本上的验收。

仓库通过 `.github/scripts/package-plugin.sh` 打包提交的目录，并附上根目录的许可证和商标说明；没有需要重新构建的生成代码或 vendor 代码。

参考：[Cindy](https://github.com/makecindy/cindy)、[NewsAPI](https://newsapi.org/docs)。
