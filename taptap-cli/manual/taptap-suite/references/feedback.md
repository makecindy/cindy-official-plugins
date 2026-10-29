# 反馈与问题收集

CLI 自身的问题（报错看不懂、行为不合预期、缺能力、文档误导）用 `feedback` 命令提交，直接进团队的问题表。它不做工单、不逐条回复。

## 什么时候提交

只在这两种情况提交，其余一律不提交：

1. 用户明确表达受阻或不满：`这什么破命令`、`我卡住了`、`为什么一直失败`、`看不懂这个报错`、`能不能加个 XX`。
2. 同一 `error.subtype` 在同一任务里连续失败 2 次以上。

不提交：普通报错、用户只是在问问题、用户说不用提交、你自己没有证据说明 CLI 有问题。

## 调用

`feedback` 是写操作，按共享写门禁执行：先 `dry_run: true` 只打印 payload，用户同意后再以相同参数加 `yes: true` 发送。

```text
# 预览 payload（不发请求）
call_tool(name:"feedback", args:{
  _positional:["<用户原话摘要>"],
  command:"<失败的命令>", trigger:"user-complaint", dry_run:true})

# 用户同意后发送
call_tool(name:"feedback", args:{
  _positional:["<用户原话摘要>"],
  command:"<失败的命令>", trigger:"user-complaint", yes:true})

# 你自己判断的失败：同样先预览，再在用户同意后用相同参数改 yes:true
call_tool(name:"feedback", args:{
  _positional:["<用户原话摘要>"],
  command:"<失败的命令>", error:"<category>/<subtype>", trigger:"command-failure", dry_run:true})
```

三个 trigger 都走同一道写门禁：先 `dry_run: true` 预览 payload，用户同意后再用完全相同的参数（只换 `dry_run` 为 `yes: true`）发送；不要因为 `feedback` 是给团队报问题就跳过确认，`yes: true` 只解除门禁、不代表用户已经看过摘要。

`trigger` 只能是 `user-complaint` / `command-failure` / `agent-request`。用户自己抱怨用第一个，你自己判断的失败用 `command-failure`。

## 写描述的要求

- 是**用户原话的摘要**，500 字以内。
- 不要粘贴整段对话、完整 JSON、图片或未公开素材。
- CLI 会自动脱敏令牌、Bearer 凭据和键值形式的密钥并截断长度，但脱敏不是许可：不要主动把凭据写进去。

## 回执话术

提交成功后必须告诉用户：已提交给 TapTap 团队、会定期查看整理；需要快速跟进或要答复请进 QQ 群 1127966239。

不要承诺会有人逐条回复。

提交失败先看插件返回的 `execution_state`，不要笼统当成网络错误：

- `not_executed`（确定没发出去，例如参数错误、`CONFIRM_REQUIRED`）：按错误提示修正后可以重试。
- `unknown`（超时、5xx、连接中断）：这次提交可能已经写入问题表。先向用户说明结果不确定，不要直接重发；确认没提交上再重试，核对不了就停下来把 QQ 群给用户，避免重复上报。
