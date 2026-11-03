# 上传帖子配图

本文件是 `taptap-community-management` 的「上传帖子配图」场景细节。场景路由、CRITICAL 规则和输出边界以 [community-management 手册](taptap-suite/references/taptap-community-management/MANUAL.md) 为准。

## 这条路径是什么

`community-management +upload-image <image>` 把一张本地图片上传到社区的图片存储,只返回**图片地址与宽高**。它不创建素材库记录,也不发布帖子——拿到 `url` / `width` / `height` 之后,按 [publish post](taptap-suite/references/taptap-community-management/references/publish-post.md) 填进正文图片节点或组图。

```text
# 先预览(只输出预览,不发写请求)
call_tool(name:"community-management +upload-image", args:{
  _positional:["./cover.png"], developer_id:"<developerId>", app_id:"<appId>",
  dry_run:true})

# 用户确认后,用完全相同的参数执行
call_tool(name:"community-management +upload-image", args:{
  _positional:["./cover.png"], developer_id:"<developerId>", app_id:"<appId>",
  yes:true})
```

`_positional` 里的本地路径必须是**相对会话工作目录**的路径:CLI 以会话工作目录为基准校验,绝对路径与 `../` 越界会被拒绝。写调用缺 `dry_run` / `yes` 会被插件拒绝(`CONFIRM_REQUIRED`),不要用别的方式绕过。

社区图片另有一个原始命令 `upload-community-moment-image`(参数走 `data:{image:"<本地路径>"}`)。两者产出的图片地址同源,但 `+upload-image` 会校验宽高必须存在、并把结果整理成 `url`/`width`/`height`/`info`,优先用它;不要为了"看到所有字段"改调原始命令。

## 权限

需要该 App 的**论坛版主或论坛主管理员**权限,与素材库的「资料更新」权限是两套:

| 命令 | 服务端权限 | 403 时该怎么做 |
| --- | --- | --- |
| `community-management +upload-image` | 论坛管理员(版主 / 主管理员) | 换有论坛管理权限的账号,或先在 DC「权限管理-论坛主管理员设置」里配置 |
| `upload` | App 的「资料更新」权限 | 去要资料更新权限 |

**这两个命令不能互相替代**:图片落不同的桶和前缀,社区图片**没有** `assetId`。不要为了让上传跑通就改调另一个。

## 产物

成功时 `data` 里只有这些字段:

```jsonc
{
  "url": "https://img2-tc.tapimg.com/moment/etag/<md5>.png",
  "width": 1280,
  "height": 720,
  "info": { "width": 1280, "height": 720, "size": 182734, "format": "png" }
}
```

**CRITICAL — 没有 `assetId`。** 不要把它当素材库句柄去调素材库接口。

**CRITICAL — `width` / `height` 必须回传。** 社区侧按宽高过滤图片,0 尺寸的图会被当成无图丢弃;CLI 与服务端都会拦这种情况,缺失时命令直接失败(`ambiguous_outcome` / `task_finalization_unknown`),而不是给你一个缺字段的成功结果。

## 限制

- 单张图片上限 **10 MB**;超过由服务端直接返回 413,CLI 会在上传前先按 10 MB 拒绝。
- 支持的扩展名与文件头必须匹配(假扩展名会被拒)。
- 同内容 + 同 App + 同目标会得到相同幂等键;换目录或改名重传不会产生新的写入意图。同一意图续跑时复用同一个 `idempotency_key`;结果未知时先核对是否已产出 `url`,不要另起一次上传。
- 图片会经过 CDN 重新编码(尺寸不变,字节内容可能变化),因此本地算的哈希不能用于校验远端字节。

## 失败怎么解释

| 现象 | 含义 | 下一步 |
| --- | --- | --- |
| `CONFIRM_REQUIRED`(CLI exit 10) | 缺 `yes:true` | 明确告知用户这是写操作,再带 `yes:true` 重跑 |
| 403 `permission_denied` | 不是该 App 的论坛管理员 | 换账号或补权限,不要改用 `upload` 绕过 |
| 404 `not_found` | 该 App 没有论坛 | 先开通论坛 |
| 400 `invalid_argument` | 扩展名/文件头/参数不合法 | 按提示修文件或参数 |
| 413 | 超过平台 multipart 上限 | 压缩或裁剪图片 |
| 503 `temporarily_unavailable` | 图片服务或社区上游不可用,这次请求可能已经到达服务端 | 结果不确定:先核对这次上传是否已产出 `url`(本次响应或用户侧记录),确认没生效再用同一个 `idempotency_key` 续跑,不要重复上传多份 |
| `failed_precondition`,提示命令不可执行 | 本次运行环境无法执行社区图片上传 | 按实际错误核对命令可用状态;不把它解释为功能尚未实现,不改用素材库 `upload` |
