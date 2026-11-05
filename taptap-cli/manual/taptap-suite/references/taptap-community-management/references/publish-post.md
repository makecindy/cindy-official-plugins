# 发帖:草稿与发布

本文件是 `taptap-community-management` 的「发帖」场景细节。场景路由、CRITICAL 规则和输出边界以 [community-management 手册](taptap-suite/references/taptap-community-management/MANUAL.md) 为准。

## 这条路径是什么

发帖分四个 operation,**草稿存在服务端**,本地只传文档内容:

| 步骤 | operation | 风险 | 产物 |
| --- | --- | --- | --- |
| 建草稿 | `create-community-topic-draft` | write | `draft_id`、`preview_url` |
| 改草稿 | `update-community-topic-draft` | write | 更新后的草稿视图 |
| 读草稿 | `get-community-topic-draft` | read | 当前保存的完整草稿 |
| 发布 | `publish-community-topic-draft` | high-risk-write(不可逆) | `moment_id`、`publish_url` |

`preview_url` 在未发布时是编辑页(`/moment-editor?draft_id=…`),发布后变成帖子页(`/moment/…`)。它不是「已发布」的标志,判断是否已发布只看 `moment_id`。

## 发帖通用最佳实践

按这个顺序走,每一步先确定目标再动笔。

**CRITICAL — 发帖的发布是跨轮步骤:同一轮内禁止 create-draft → publish-draft 连跑。** publish 的前提是:本会话中已经向用户交付过 `preview_url`,且用户在看到预览后明确回复「可以发」。只说「发个帖:<内容>」只表达发帖意图,不构成发布确认;`yes: true` 只解除写操作门禁,不等于用户已确认发布。用户事先明确说「不用预览,直接发」时,才可在同一轮内发布,并在回执里说明已按此豁免执行。

### 0. 先分清作用域与投递目标

`app_id` / `developer_id`(映射为 `--app-id` / `--dev-id`)是**作用域**,不是投递目标:

- 鉴权只看作用域 App:内容挂在它对应的作者名下。例如 `app_id` 为 `<appId>` 发的内容,作者就是 `<appId>` 体系下这个账号。
- **投递目标由论坛决定**:`forum_bindings[].app_id` 是目标论坛所属的 App,可以和作用域 App 不同。
- 所以往 app `<targetAppId>` 的论坛发帖,不必把 `app_id` 改成 `<targetAppId>`;改了反而会把内容挂到那个 App 名下。作用域保持 `<appId>`,在绑定里写目标论坛的 `app_id` 即可。
- 官方身份**逐论坛判定**:只有目标论坛真的给了官方选项才用 `official`,否则只有 `personal`。同一账号可能在 `<appId>` 有官方资格、在 `<targetAppId>` 只能以个人身份发。
- 子版块与身份都要按**目标论坛**取(`get-community-forum-publish-options`,scope 传目标论坛的 App ID),不是按作用域 App。

### 1. 先定论坛,再定身份

| 用户情况 | 做法 |
| --- | --- |
| 没指定论坛 | 直接用当前作用域 `app_id` 对应的论坛发,不要再搜 |
| 指定了论坛名 | `search-community-forums`(data 传 `keyword`)列出候选让用户选;选定后再取该论坛的 `app_id` 与 `group_id` |

- `search-community-forums` 的 `keyword` 最多返回 10 个候选,没有目标就收窄关键字重搜;**不要凭论坛名猜 `app_id`**。
- 一个帖子**最多绑定两个论坛**。用户要求绑定更多时,先让用户取舍,不要静默截断。
- 每个绑定各自带 `identity` 与 `group_label_id`;多个论坛时逐个确认,不要复用同一个值。

### 2. 用发帖选项决定身份与子版块

```text
call_tool(name:"community-management get-community-forum-publish-options", args:{
  app_id:"<目标论坛的 App ID>", developer_id:"<developerId>"})
```

- 响应里有官方身份选项(`author_options` 中 `create_params.is_official = true`)→ **默认按官方身份发**;没有才用 `personal`。
- 子版块**默认发「综合」**(`group_label_id: "0"`,与 `null` 等价)。只有用户提出换子版块时,才把 `group_labels` 列给用户选,不要自己编 ID。
- 称号不指定就用 `honor.mode = "inherit"`,改动佩戴状态需要用户明确要求。

### 3. 建完草稿先给 preview,不要直接发

- 建或改完草稿后,把 `preview_url` 交给用户,**此时不要 publish**;发布要等用户看过预览后的下一轮确认。
- 用户要改 → `update-community-topic-draft` 全量替换后,再给一次新的 `preview_url`。
- 用户回复「可以发」→ 才执行 `publish-community-topic-draft`。

建完草稿的回复用这个固定结构,不要只丢一个链接:

```text
草稿已建好,请先看预览:
<preview_url>

标题:…
论坛/子版块:…／…
身份:个人 / 官方
内容摘要:…

确认无误后回复「可以发」,我再发布。
```

### 4. 发布成功给回执

把 `publish_url`(以及 `moment_id`)发给用户,并说明:审核中可能**仅自己可见**,过审后才对外可见,不代表失败。

## 写什么:按场景的内容建议

用户只说「发个帖」时,按场景给一版结构建议,别让正文空着。下面是各场景通常值得写的部分,具体素材仍以用户提供的为准。

| 场景 | 建议写 | 注意 |
| --- | --- | --- |
| 首次上线 / 新发布 | 上线时间与平台、3–5 条玩法亮点、与预约期的差异、下载入口(`app` 卡片)、常见问题 | 不承诺未上线的功能、推荐位或曝光量;时间以实际发布为准 |
| 版本更新 | 按「新增 / 优化 / 修复」分组的变化、改动原因、采纳了哪些玩家反馈、已知问题与后续计划 | 不要贴 changelog 全文,挑玩家能感知的变化 |
| 测试招募 / 测试期 | 测试时间、参与方式与资格、本轮重点测试内容、反馈渠道 | 名额与资格以实际配置为准,正文不要自行加码 |
| 活动 / 节日运营 | 活动时间、参与方式、奖励、规则说明 | 奖励与规则以活动页为准,正文不另行承诺 |
| 玩家反馈回应 | 高频问题、已修复项、正在处理项、后续节奏 | 不点名未授权的用户;未确认的问题不要写成结论 |

## 前置条件

| 需要什么 | 从哪来 |
| --- | --- |
| `developerId` / `appId` | `taptap-identity` 手册;用 scope 参数传,不要写进 `data` |
| 论坛发帖权限 | 目标论坛的版主 / 主管理员;官方身份还需要在该论坛具备资格,无权限时通常 403 |
| `group_label_id` | `get-community-forum-publish-options` 或 `list-community-group-labels`;「综合」等虚拟板块传 `"0"`,与 `null` 等价 |
| `identity` | `personal`(个人)或 `official`(官方);`official` 需要该 App 的官方发布资格,逐论坛生效 |
| 称号 | `get-community-forum-publish-options` 取候选;不指定时用 `honor.mode = "inherit"` |
| 图片 | `+upload-image` 返回的 `url` / `width` / `height` |
| 视频 | `+upload-video` 返回的 `videoId`(`normal` / `transcoding` / `regulating` 都可直接引用) |

## 请求结构:两种形状

**`create` 是展平的**,文档字段直接放在 `data` 顶层:

```jsonc
{
  "title": "…",
  "contents": "[…]",            // JSON 字符串,不是数组
  "pin_video_id": "<videoId>",
  "forum_bindings": [{ "app_id": "<appId>", "group_label_id": "0", "identity": "official", "honor": { "mode": "inherit" } }]
}
```

**`update` / `publish` 是包起来的**:整份文档放进 `document`,`draft_id` 只在顶层:

```jsonc
{
  "draft_id": "<draftId>",
  "document": {
    "title": "…",
    "contents": "[…]",
    "pin_video_id": "…",
    "forum_bindings": [{ "app_id": "<appId>", "group_label_id": "0", "identity": "official" }]  // 完整绑定,不能传 []
  }
}
```

**CRITICAL — `draft_id` 不要写进 `document`。** `document` 按字段严格校验,多一个 `draft_id` 会被服务端以 400 拒绝,看起来很像「不支持更新」,实际只是层级放错。

**CRITICAL — `update` / `publish` 是整份替换,不是增量。** 漏传的字段会被还原成缺省值(`title` 空串、`forum_bindings` 空数组等)。改一版就重发一份完整文档;可以先 `get` 一次,在返回值上改,再整体回传。

**CRITICAL — 清空 `forum_bindings` 等于把帖子从所有论坛撤掉。** `update` 和 `publish` 必须原样带上完整绑定(论坛、子版块、身份),不要为了省事传空数组;多个论坛时逐个保留,不要只留第一个。

## 文档字段

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `title` | string | 最长 100 字;缺省空串 |
| `contents` | string | 正文 `ContentJsonItem[]` 序列化后的 **JSON 字符串**,最长 50000 字符;缺省空串 |
| `pin_video_id` | string | 置顶视频,十进制字符串;**与 `footer_image_urls` 互斥** |
| `cover_video_id` | string | 用视频作封面,十进制字符串 |
| `cover_image_url` | string | 自定义封面图 URL |
| `footer_image_urls` | string[] | 组图,按展示顺序,最多 18 张,必须 https |
| `images_text` | string | 组图配文,JSON 字符串 |
| `forum_bindings` | array | 论坛绑定,顺序即展示顺序;`app_id` + `identity` 必填 |

**CRITICAL — `contents` 是字符串不是数组。** 直接把数组塞进去会 400;要 `JSON.stringify` 之后作为字符串传。

## 正文节点

`contents` 解析后是节点数组,支持的 `type`:

| `type` | 用途 | 关键 `info` |
| --- | --- | --- |
| `paragraph` | 段落;`style` 可为 `block-quote` / `collapse` | `style`、`collapse_title` |
| `heading` | 标题 | `level`(正整数) |
| `list` / `list-item` | `list-item` 只放在 `list.children`,不能作为顶层节点 | 每项 `info.li-level` 是正整数,首项为 1,后续最多比上一项增加 1;不能用 0 |
| `image` | 正文图片 | `img_url`、`width`、`height`、`description`(alt) |
| `video` | 正文视频 | `video_id`(**整数**) |
| `code-block` | 代码块 | `language` |
| `table` / `table-row` / `table-cell` | 表格;单元格 `header: true` 为表头 | `header`、`align` |
| `app` | App 卡片 | `app_id`(十进制字符串) |
| `linkcard` | 链接卡片 | `url`、`title`、`description`、`icon_url` |

合法列表正文示例(外层请求的 `contents` 仍需序列化为 JSON 字符串):

```json
[
  {"type":"list","children":[
    {"type":"list-item","info":{"li-level":1},"children":[{"text":"第一项"}]},
    {"type":"list-item","info":{"li-level":2},"children":[{"text":"子项"}]},
    {"type":"list-item","info":{"li-level":1},"children":[{"text":"第二项"}]}
  ]}
]
```

行内片段放在 `children` 里,`type` 缺省即纯文本:`mention`(`info.id` + `info.name`)、`link`(`info.url`),以及 `bold` / `italic` / `underline` / `strikethrough` / `code` / `color` / `highlight` 这类样式布尔或颜色值。

正文提到游戏时,尽量用 `app` 卡片渲染:知道 `app_id` 时用 `{"type":"app","info":{"app_id":"<appId>"}}`,读者可以直接点进详情页,不要只写游戏名纯文本。需要先查 `app_id` 时,用 `search-community-forums`(data 传 `keyword`)取候选,或让用户直接给;非游戏的链接仍用 `linkcard`。

图片节点的 `width` / `height` 必须来自 `+upload-image` 的真实返回值:0 或缺失会被社区侧当成无图丢弃。

## 视频与图片怎么组合

同一个帖子里出现视频有两种方式,含义不同:

| 想要的效果 | 写法 |
| --- | --- |
| 视频置顶在正文前(附件) | `pin_video_id: "<videoId>"` |
| 视频嵌在正文某个位置 | `contents` 里放 `{"type":"video","info":{"video_id": <videoId>}}`(整数) |

两者可以同时出现(置顶一份 + 正文再嵌一份),但 `pin_video_id` 不能再和 `footer_image_urls` 组图混用;正文图片节点不受这个限制,所以「视频 + 图片」的帖子用正文 `image` 节点配图即可。

## 最小可跑示例

发帖的「预览」不是 `dry_run`:草稿必须真实创建或更新,`preview_url` 才会出现;`dry_run:true` 只打印请求、不建草稿,拿不到预览链接。所以建/改草稿用 `yes:true` 真正写入,再把 `preview_url` 交给用户;发布必须等用户看过预览并明确同意后再执行。

```text
# 1) 建草稿(展平字段):真实创建才会返回 preview_url
call_tool(name:"community-management create-community-topic-draft", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{title:"…", contents:"[{\"type\":\"paragraph\",\"children\":[{\"text\":\"…\"}]}]",
        forum_bindings:[{app_id:"<appId>", group_label_id:"0", identity:"official",
                        honor:{mode:"inherit"}}]},
  yes:true})

# 2) 改草稿(整份替换;forum_bindings 原样保留):同样真实写入,拿到新的 preview_url
call_tool(name:"community-management update-community-topic-draft", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{draft_id:"<draftId>", document:{
    title:"…", contents:"[…]", pin_video_id:"<videoId>",
    forum_bindings:[{app_id:"<appId>", group_label_id:"0", identity:"official",
                    honor:{mode:"inherit"}}]}},
  yes:true})

# 3) 读草稿(draft_id 直接写在 data 里)
call_tool(name:"community-management get-community-topic-draft", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{draft_id:"<draftId>"}})

# 4) 发布(不可逆;用户看过 preview 并明确同意后;绑定同样不能省)
call_tool(name:"community-management publish-community-topic-draft", args:{
  developer_id:"<developerId>", app_id:"<appId>",
  data:{draft_id:"<draftId>", document:{
    title:"…", contents:"[…]", pin_video_id:"<videoId>",
    forum_bindings:[{app_id:"<appId>", group_label_id:"0", identity:"official",
                    honor:{mode:"inherit"}}]}},
  yes:true})
```

`data` 也可以传 `"@relative-file.json"`,文件由 CLI 相对**会话工作目录**解析,路径不能越界。写入前先 `dry_run:true` 预览:它会打印将要发送的请求内容(敏感值已打码),是确认「文档有没有多套一层、字段有没有放错位置」最省事的办法。

## 发布语义

- 发布成功返回 `moment_id` 与 `publish_url`;**草稿随后被删除**,再 `update` 同一个 `draft_id` 会 404,`get` 则返回已发布视图(只有 `moment_id` 与帖子页 `preview_url`,其余字段为空)。
- 同一个 `draft_id` 重复发布不会重复发帖,已发布时直接返回首次结果;不要靠「再发一次」来刷新状态。
- **发布成功 ≠ 审核通过、≠ 已公开可见。** 审核中的帖子读详情会返回 422(提示帖子审核中),属正常状态,不要当成失败重发。

## 发布后怎么验证

| 手段 | 能看到什么 |
| --- | --- |
| `list-community-moments` | 审核通过后才拿得到这条帖子(带标题与 `moment_id`);刚发布时可能拉不到 |
| `get-community-topic-draft` | 已发布视图:`moment_id` + 帖子页 URL |
| `get-community-moment` | 正文、图片、视频明细;审核中会 422,过审后再读 |

**CRITICAL — 发布成功不等于立即可查,也不等于失败。** 刚发布时列表里可能还没有这条帖子,详情也会因为审核中返回 422;两者都不能反推「发布失败」。判断发布结果只看 `publish` 返回的 `moment_id`。超时或结果未知时,先用 `get-community-topic-draft` 核对草稿是否已变成已发布视图(返回 `moment_id`);确认没有 `moment_id` 后,才可以对同一个 `draft_id` 重试发布,不要把「列表里查不到」当成没发出去。

## 失败怎么解释

| 现象 | 含义 | 下一步 |
| --- | --- | --- |
| `CONFIRM_REQUIRED`(CLI exit 10) | 缺 `yes:true` | 说明这是写操作,取得同意后带 `yes:true` 重跑 |
| 400 提示存在未知字段 | `draft_id` 放进了 `document`,或混入了文档结构外的字段 | 把 `draft_id` 移到顶层,`document` 只留文档字段 |
| 400 提示 `contents` 非法 | 传了数组或非法节点 | 序列化成字符串,按上表校验节点 `type` |
| 403 `permission_denied` | scope、资源权限或官方身份资格被拒绝,单凭状态码无法区分 | 核对已授权 scope、目标论坛及发布选项;不要轮换 scope、账号或自动降为 `personal` 来试权限。仅当实际选项允许个人身份且符合用户发布意图时,才重新决定身份 |
| 503 `result_unknown` / `ambiguous_outcome` | 写入可能已生效,但服务端无法确认或保存幂等结果 | 有 `draft_id` 时先 `get-community-topic-draft` 回读;没有句柄时报告未知并停止。不能改 key 再建草稿,不能发布结果未知的草稿 |
| 404 `not_found` | `draft_id` 不存在,或草稿已发布被删除 | 已发布就不要再改;需要新内容就重新建草稿 |
| 422 帖子审核中 | 帖子正在审核,详情不可读 | 等待过审,不要重发 |
| 超时 / 结果未知(`unknown`) | 发布请求可能已经生效 | 先 `get-community-topic-draft` 核对 `moment_id`:已发布就用首次结果;确认没有 `moment_id` 后,才对同一 `draft_id` 重试 |
| 400 `invalid_argument` | 参数不合法(标题超长、`contents` 超 50000 字、组图超 18 张、`group_label_id` 格式错等) | 按提示裁剪后重发整份文档 |

**CRITICAL — 发布不可逆。** `publish-community-topic-draft` 是 high-risk-write:没有撤回接口,删除与编辑要走社区侧的人工处置。发布前把完整文档和预期的帖子内容交给用户确认(`preview_url` 是发布前唯一可交付的预览;`publish_url` 只在发布成功后才返回),不要替用户「先发出去再说」。
