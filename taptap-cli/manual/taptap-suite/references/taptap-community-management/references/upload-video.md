# 上传帖子视频

## 这条路径是什么

`community-management +upload-video <video>` 接收一个本地视频,完成上传与登记,返回发帖可用的 `videoId`。调用方只负责给文件,不需要自己处理上传凭证、分片或二次登记。

它**不创建素材库记录,也不发布帖子**:`videoId` 只是发帖时引用的句柄。

```text
# 先预览:只做本地预检并列出将执行的步骤,不发任何请求
call_tool(name:"community-management +upload-video", args:{
  _positional:["./clip.mp4"], developer_id:"<developerId>", app_id:"<appId>",
  dry_run:true})

# 用户确认后,用完全相同的参数执行
call_tool(name:"community-management +upload-video", args:{
  _positional:["./clip.mp4"], developer_id:"<developerId>", app_id:"<appId>",
  yes:true})
```

`dry_run: true` 在本地预检文件并列出执行计划,不发送上传或登记请求。用户确认后,以相同文件、scope 和幂等意图将 `dry_run` 换成 `yes`;真实上传缺少 `yes` 时返回 `confirmation_required`(exit 10)。`_positional` 里的本地路径必须相对会话工作目录;大文件用 `_timeout_seconds`(最大 870)放宽超时。

CLI 启动时可能联网刷新命令目录。预览中的 `networkRequests` 是确认执行后预计用于上传和登记的请求数。

## 和另外两条视频链路的区别

| 命令 | 归属 | 用途 |
| --- | --- | --- |
| `community-management +upload-video` | 社区帖子素材 | 发帖时引用(`pin_video_id` / `cover_video_id` / 正文视频节点) |
| `asset-library +upload-video` | 素材库 | 素材库视频素材,用于资料与检索 |
| `upload-video`(顶层) | App 资料 | 只返回 `videoId`;对应资料字段仍要由 `app-edit` 用 `save-changes` 回填并读回 |

**三条链路互不通用,视频 ID 不可互换。** 社区发帖缺视频时不要拿素材库的 `videoId` 顶替,也不要为了跑通改用素材库上传。

## 产物

成功时 `data` 里与调用方相关的字段:

```jsonc
{
  "videoId": <videoId>,
  "status": "transcoding",
  "fileName": "clip.mp4",
  "nextStep": "video <videoId> is registered (transcoding); pass it as pin_video_id or cover_video_id (decimal string) …"
}
```

- **`videoId` 是唯一要带走的字段**,其余字段用于解释当前状态。
- 响应里可能还有其它诊断字段,属于实现细节,不要依赖,也不要用它们拼接对外链接。

## 状态与转码

| `status` | 含义 | 该怎么做 |
| --- | --- | --- |
| `normal` | 转码与审核通过 | 直接发帖引用 |
| `transcoding` | 仍在转码 | 正常状态,直接发帖引用 |
| `regulating` | 仍在审核 | 正常状态,直接发帖引用 |
| `transcode_failed` | 转码失败 | 换文件重传,不要反复重试同一个文件 |
| `regulate_rejected` | 审核拒绝 | 按社区规范调整内容后重传 |
| 其它取值 | 未收录的新状态 | 不代表可用;引用前先确认,不要按「已就绪」处理 |

**CRITICAL — `normal` / `transcoding` / `regulating` 都算正常,`videoId` 拿到就能发帖。** 转码与审核在服务端继续推进,不需要等状态变成 `normal`,也不要因为状态不是 `normal` 就重复上传。社区侧没有状态查询接口,重复执行上传既不会加速也不会反馈处理阶段。

## 拿到 `videoId` 之后

仅上传时交付 `videoId` 和已核实的处理状态。任务还包含撰写或发布帖子时,再读 [发帖流程](taptap-suite/references/taptap-community-management/references/publish-post.md) 并按下表引用。

| 用途 | 字段 | 类型 |
| --- | --- | --- |
| 帖子置顶视频 | `pin_video_id` | 十进制**字符串**;与 `footer_image_urls` 互斥 |
| 视频封面 | `cover_video_id` | 十进制**字符串** |
| 正文内嵌视频节点 | `info.video_id` | **整数** |

## 限制与重试

- 本地规则:扩展名 `.mp4` / `.mov`,最大 5 GB,路径必须在当前工作目录内。不满足时在本地就失败,不会发出请求。
- 省略 `idempotency_key` 时,CLI 按文件内容和调用 scope 派生 key。显式传 key 时,同一意图续跑沿用原值。
- 上传成功但登记失败时,命令会给出**已存储的对象句柄、文件名和原幂等键**。只用这三样调用 `complete-community-moment-video-upload` 补登记,不要重跑整条命令——重跑会重新传输整个文件:

  ```text
  call_tool(name:"community-management complete-community-moment-video-upload", args:{
    developer_id:"<developerId>", app_id:"<appId>",
    idempotency_key:"<原幂等键>",
    data:{object:"<对象句柄>", file_name:"<文件名>"}, yes:true})
  ```

  拿不到句柄时(命令被中断、没有错误输出)结果属于**未知**:社区侧没有状态查询接口,不能假设没传上去,也不要直接重跑。先向用户说明这次上传结果不确定,并请其核对是否已经能拿到可引用的 `videoId`(例如此前返回过、或帖子已能引用);确认没有产出后,才用同一个文件、同一个 `idempotency_key` 重放同一次意图(不会产生第二份视频),不要换文件、换 key 或另起一次上传。

## 失败怎么解释

| 现象 | 含义 | 下一步 |
| --- | --- | --- |
| `CONFIRM_REQUIRED`(CLI exit 10) | 缺 `yes:true` | 说明这是写操作,确认后带 `yes:true` 重跑 |
| 401 `token_invalid` | 登录凭据被服务端拒绝;常见原因是环境变量 `TAPTAP_CLI_TOKEN` 覆盖了登录态且已失效 | 清除该环境变量后重试,或让用户重新 `taptap-cli auth login` |
| 403 `permission_denied` | 不是该 App 的论坛管理员 | 换账号或补论坛权限,不要改用素材库上传绕过 |
| 404 `not_found` | 该 App 没有论坛 | 先开通论坛 |
| 400 `invalid_argument` | 扩展名或文件内容不合法 | 按提示修正后重试 |
| `transcode_failed` / `regulate_rejected` | 服务端处理失败 | 换文件重传,不要重复提交同一文件 |
| 登记失败,提示对象已存储 | 文件已上传,登记没完成 | 用错误输出里的对象句柄与原幂等键只重试登记,不要重跑整条命令 |
| 502/503 | 上传或社区上游暂时不可用;请求可能已经到达服务端 | 结果不确定:先核对是否已拿到 `videoId` 或对象句柄,确认这次没有产出后再用同一个 `idempotency_key` 续跑,不要另起一次上传 |
