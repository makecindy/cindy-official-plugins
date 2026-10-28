/**
 * Gitea plugin logic page (browser sandbox, not Node).
 *
 * - Instances come from network.connections (key gitea_conn). The user adds an
 *   instance host and access token in settings.html; the host encrypts the
 *   token and injects `Authorization: token <value>` only into requests to that
 *   connection's host. This file never sees, stores or returns the token.
 * - Tool surface is a two-stage catalog: list_tools describes operations,
 *   call_tool runs one. Operations live in the OPS table below.
 * - Writes are confirmed through cindy.confirm before the single request is
 *   sent and are never retried. A failure after the request may have reached
 *   the server is reported as an unknown outcome.
 * - Every path segment taken from arguments is validated and percent-encoded
 *   so values cannot change which API endpoint is called.
 */

/* global cindy */

var CONNECTION_KEY = 'gitea_conn';
var CHANNEL_NAME = 'gitea';
var API_PREFIX = '/api/v1';
var REQUEST_TIMEOUT_MS = 30000;
var RESULT_MAX_CHARS = 50000;
var DEFAULT_LIMIT = 20;
var MAX_LIMIT = 50;
var MAX_PAGE = 100000;
var TEXT_DEFAULT_CHARS = 20000;
var TEXT_MAX_CHARS = 40000;
var FILE_MAX_BYTES = 1024 * 1024;
var DIR_MAX_ENTRIES = 300;
var CONFIRM_BODY_MAX = 300;
var MESSAGE_SNIPPET_MAX = 300;
var LIST_BODY_MAX = 300;
var ITEM_BODY_MAX = 20000;
var COMMENT_BODY_MAX = 4000;
var WRITE_TEXT_MAX = 60000;
var MERGE_STYLES = ['merge', 'rebase', 'rebase-merge', 'squash', 'fast-forward-only'];
var NAME_RE = /^[A-Za-z0-9_.-]{1,100}$/;
var HOST_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

/* ── localized copy ─────────────────────────────────────────────────── */

/*
 * Runtime copy follows the host locale only (cindy.request app-context and
 * host-context-changed), never the browser or OS language. Unknown locales and
 * failed lookups fall back to English. errorCode values, tool and operation
 * names, token scopes and Gitea field names are protocol and stay untranslated.
 * The list_tools catalog (category summaries, operation descriptions and
 * parameter notation) is API documentation and stays in English.
 */
var MESSAGES = {
  en: {
    invalidRequired: '{key} is required and must be a non-empty string.',
    invalidTooLong: '{key} is too long (max {max} characters).',
    invalidString: '{key} must be a string.',
    invalidBool: '{key} must be true or false.',
    invalidRequiredInt: '{key} is required and must be a positive integer.',
    invalidInt: '{key} must be a positive integer.',
    invalidEnum: '{key} must be one of: {values}.',
    invalidIntArray: '{key} must be an array of positive integers.',
    invalidMaxItems: '{key} accepts at most {max} items.',
    invalidIntItems: '{key} must contain only positive integers.',
    invalidStringArray: '{key} must be an array of strings.',
    invalidStringItems: '{key} must contain only strings.',
    invalidName: '{key} must be a Gitea owner or repository name (letters, digits, "-", "_" and "."; not "." or "..").',
    ownerRequired: 'owner is required (or pass repo as "owner/name").',
    repoRequired: 'repo is required.',
    pathControlChars: '{key} contains control characters or backslashes.',
    pathEmptySegment: '{key} must not contain empty segments ("//").',
    pathDotSegment: '{key} must not contain "." or ".." segments.',
    pageRange: 'page must be an integer from 1 to {max}.',
    invalidNonNegative: '{key} must be a non-negative integer.',
    instanceHttpsOnly: 'Only https Gitea instances are supported; "{instance}" uses {scheme}://.',
    instanceSubPath: 'Instance must be a bare host such as git.example.com. Gitea served under a sub-path is not supported.',
    instancePort: 'Only the default https port 443 is supported; "{instance}" uses port {port}.',
    instanceBadHost: 'Instance "{instance}" is not a valid host name.',
    connectionsUnavailable: 'Could not read the configured Gitea instances from Cindy. Reopen the plugin and try again.',
    noInstance: 'No Gitea instance is configured. Ask the user to open the Gitea plugin settings in Cindy and add the instance URL and an access token.',
    instanceType: 'instance must be a connection id or host string.',
    unknownInstance: 'No configured Gitea instance matches "{instance}". Configured: {hosts}.',
    ambiguousWrite: 'Several Gitea instances are configured ({hosts}). Writes require args.instance (connection id or host) and never fall back to the default.',
    ambiguousRead: 'Several Gitea instances are configured ({hosts}) and none is the default. Pass args.instance (connection id or host).',
    notExecutedPrefix: 'Not executed: ',
    giteaSaid: ' Gitea said: {message}',
    noDetails: ' No details were returned.',
    authFailed: 'Gitea at {host} rejected the access token (HTTP 401). The token is missing, expired or revoked; ask the user to replace it in the Gitea plugin settings.',
    forbidden: 'Gitea at {host} denied the request (HTTP 403). This operation needs a token with the "{scope}" scope, and the account must have permission on the target.',
    notFound: 'Not found on {host} (HTTP 404): the owner, repository, number, branch or path does not exist, or this account cannot see it.',
    rateLimitedWait: 'Gitea at {host} is rate limiting requests (HTTP 429). Wait {seconds} seconds before retrying.',
    rateLimited: 'Gitea at {host} is rate limiting requests (HTTP 429). Wait before retrying.',
    writeServerError: 'Gitea at {host} returned HTTP {status} after receiving the write. It may or may not have been applied. Check the current state before retrying; the plugin did not retry.',
    serverError: 'Gitea at {host} returned a server error (HTTP {status}). Try again later.',
    refused: 'Gitea at {host} refused the request (HTTP {status}).',
    noResponse: 'no response',
    writeIncomplete: 'The write to {host} did not complete ({reason}). It may or may not have reached Gitea. Check the current state before retrying; the plugin did not retry.',
    networkError: 'Could not get a response from {host} ({reason}). Check that the instance is reachable, then retry.',
    responseTruncated: 'The response from {host} was too large and was cut off by Cindy. Narrow the request (smaller limit, a specific path or a single item).',
    notJson: 'Gitea at {host} returned a response that is not JSON. Check that the instance URL points at Gitea.',
    limitCapped: 'limit was capped at {max}; use page to continue.',
    pathRequired: 'path is required ("" for the repository root).',
    contentsUnexpected: 'Gitea returned an unexpected contents response.',
    fileTooLarge: 'File {path} is {size} bytes; get_file reads files up to {max} bytes. Open it in the browser instead: {url}',
    fileContentMissing: 'Gitea did not include the content of {path} (usually because it exceeds the server blob limit). Open it in the browser instead: {url}',
    binaryFile: 'Binary file; content not returned.',
    stateRequired: 'state is required: open or closed.',
    actionRequired: 'action is required: add, replace or remove.',
    labelsRequired: 'labels is required for add/replace and must be an array of label ids or names.',
    labelsEmpty: 'labels must not be empty for add.',
    labelsItems: 'labels must contain label ids or non-empty names.',
    noLabels: '(none)',
    styleRequired: 'style is required: {styles}. Ask the user which merge style to use.',
    headCommitInvalid: 'head_commit_id must be a hex commit sha.',
    statusTypesInvalid: 'status_types must contain unread, read or pinned.',
    subjectTypeInvalid: 'subject_type must contain issue, pull, commit or repository.',
    overviewHint: 'Pass category to see its operations, then run one with call_tool({name, args}). Repository operations need owner and repo. With several instances, pass args.instance.',
    categoryHint: 'Notation: * = required, ? = optional.',
    unknownCategory: 'Unknown category "{category}". Available: {categories}.',
    paramsSuffix: ' Parameters: {params}',
    confirmUnsupported: 'Not executed: this Cindy version cannot show a confirmation dialog, so writes are disabled. Update Cindy to use write operations.',
    confirmFailedReason: 'Not executed: the confirmation dialog could not be shown ({reason}).',
    confirmUnavailableReason: 'Not executed: the confirmation dialog could not be shown ({reason}). Try again in a few seconds.',
    confirmUnavailable: 'Not executed: the confirmation dialog could not be shown. Try again in a few seconds.',
    confirmDeclined: 'Not executed: the user declined the confirmation (or it timed out). Do not retry unless the user asks again.',
    nameRequired: 'name is required; use list_tools to see the operations.',
    unknownOperation: 'Unknown operation "{name}". Use list_tools (categories: {categories}).',
    resultTooLarge: 'The result is {size} characters, over the {max} limit. Narrow it: lower limit, use page, a smaller max_chars or a more specific path.',
    writeUnsummarized: 'Gitea accepted the write (HTTP {status}) but the response could not be summarized.',
    connectionTestFailed: 'Connection test failed.',
    unknownTool: 'Unknown tool "{tool}".',
    unexpectedError: 'The Gitea plugin hit an unexpected error: {detail}',
    confirmCreateIssue: 'Create an issue in {repo} on {host}?\nTitle: {title}',
    confirmComment: 'Post a comment on #{index} in {repo} ({host})?\n{body}',
    confirmClose: 'Close #{index} in {repo} ({host})?',
    confirmReopen: 'Reopen #{index} in {repo} ({host})?',
    confirmRemoveLabel: 'Remove label id {id} on #{index} in {repo} ({host})?',
    confirmAddLabels: 'Add labels {labels} on #{index} in {repo} ({host})?',
    confirmReplaceLabels: 'Replace all labels with {labels} on #{index} in {repo} ({host})?',
    confirmCreatePull: 'Open a pull request in {repo} ({host}) from {head} into {base}?\nTitle: {title}',
    confirmMerge: 'Merge pull request #{index} in {repo} ({host}) using "{style}"? This cannot be undone.',
    confirmMergeDelete: 'Merge pull request #{index} in {repo} ({host}) using "{style}" and delete the head branch? This cannot be undone.',
    confirmRelease: 'Create {kind} {tag} in {repo} ({host})?',
    confirmReleaseAt: 'Create {kind} {tag} in {repo} ({host}) at {target}?',
    releaseNameLine: '\nName: {name}',
    moreItems: '{shown} (+{count} more)',
    kindRelease: 'release',
    kindDraftRelease: 'draft release',
    kindPreRelease: 'pre-release',
    buttonCreate: 'Create',
    buttonComment: 'Comment',
    buttonClose: 'Close',
    buttonReopen: 'Reopen',
    buttonRemove: 'Remove',
    buttonAdd: 'Add',
    buttonReplace: 'Replace',
    buttonOpenPr: 'Open PR',
    buttonMerge: 'Merge',
    buttonCancel: 'Cancel',
  },
  'zh-CN': {
    invalidRequired: '{key} 为必填项，且必须是非空字符串。',
    invalidTooLong: '{key} 过长（上限 {max} 个字符）。',
    invalidString: '{key} 必须是字符串。',
    invalidBool: '{key} 必须是 true 或 false。',
    invalidRequiredInt: '{key} 为必填项，且必须是正整数。',
    invalidInt: '{key} 必须是正整数。',
    invalidEnum: '{key} 必须是以下值之一：{values}。',
    invalidIntArray: '{key} 必须是正整数数组。',
    invalidMaxItems: '{key} 最多接受 {max} 项。',
    invalidIntItems: '{key} 只能包含正整数。',
    invalidStringArray: '{key} 必须是字符串数组。',
    invalidStringItems: '{key} 只能包含字符串。',
    invalidName: '{key} 必须是 Gitea 的所有者名或仓库名（只能包含字母、数字、"-"、"_" 和 "."，且不能是 "." 或 ".."）。',
    ownerRequired: 'owner 为必填项（或把 repo 写成 "owner/name"）。',
    repoRequired: 'repo 为必填项。',
    pathControlChars: '{key} 包含控制字符或反斜杠。',
    pathEmptySegment: '{key} 不能包含空路径段（"//"）。',
    pathDotSegment: '{key} 不能包含 "." 或 ".." 路径段。',
    pageRange: 'page 必须是 1 到 {max} 之间的整数。',
    invalidNonNegative: '{key} 必须是非负整数。',
    instanceHttpsOnly: '仅支持 https 的 Gitea 实例；"{instance}" 使用的是 {scheme}://。',
    instanceSubPath: '实例只能填写主机名，例如 git.example.com。不支持部署在子路径下的 Gitea。',
    instancePort: '仅支持 https 默认端口 443；"{instance}" 使用的是端口 {port}。',
    instanceBadHost: '实例 "{instance}" 不是有效的主机名。',
    connectionsUnavailable: '无法从 Cindy 读取已配置的 Gitea 实例。请重新打开插件后再试。',
    noInstance: '尚未配置 Gitea 实例。请让用户在 Cindy 中打开 Gitea 插件设置，添加实例地址和访问令牌。',
    instanceType: 'instance 必须是连接 id 或主机名字符串。',
    unknownInstance: '没有与 "{instance}" 匹配的已配置 Gitea 实例。已配置：{hosts}。',
    ambiguousWrite: '已配置多个 Gitea 实例（{hosts}）。写操作必须指定 args.instance（连接 id 或主机名），且不会回退到默认实例。',
    ambiguousRead: '已配置多个 Gitea 实例（{hosts}），且没有默认实例。请传入 args.instance（连接 id 或主机名）。',
    notExecutedPrefix: '未执行：',
    giteaSaid: 'Gitea 返回：{message}',
    noDetails: '未返回详细信息。',
    authFailed: '{host} 上的 Gitea 拒绝了访问令牌（HTTP 401）。令牌缺失、已过期或已被吊销；请让用户在 Gitea 插件设置中更换令牌。',
    forbidden: '{host} 上的 Gitea 拒绝了请求（HTTP 403）。此操作需要具有 "{scope}" 权限范围的令牌，且该账号必须对目标有相应权限。',
    notFound: '在 {host} 上未找到（HTTP 404）：owner、仓库、编号、分支或路径不存在，或当前账号无权查看。',
    rateLimitedWait: '{host} 上的 Gitea 正在限制请求频率（HTTP 429）。请等待 {seconds} 秒后再重试。',
    rateLimited: '{host} 上的 Gitea 正在限制请求频率（HTTP 429）。请稍候再重试。',
    writeServerError: '{host} 上的 Gitea 在收到写请求后返回了 HTTP {status}。该写操作可能已生效，也可能没有。重试前请先检查当前状态；插件没有重试。',
    serverError: '{host} 上的 Gitea 返回了服务器错误（HTTP {status}）。请稍后再试。',
    refused: '{host} 上的 Gitea 拒绝了请求（HTTP {status}）。',
    noResponse: '无响应',
    writeIncomplete: '对 {host} 的写操作未完成（{reason}）。请求可能已到达 Gitea，也可能没有。重试前请先检查当前状态；插件没有重试。',
    networkError: '无法从 {host} 获得响应（{reason}）。请确认实例可以访问后再重试。',
    responseTruncated: '{host} 的响应过大，已被 Cindy 截断。请缩小请求范围（更小的 limit、具体路径或单个条目）。',
    notJson: '{host} 上的 Gitea 返回的响应不是 JSON。请确认实例地址指向的是 Gitea。',
    limitCapped: 'limit 已被限制为 {max}；请用 page 继续翻页。',
    pathRequired: 'path 为必填项（仓库根目录传 ""）。',
    contentsUnexpected: 'Gitea 返回了无法识别的 contents 响应。',
    fileTooLarge: '文件 {path} 大小为 {size} 字节；get_file 只能读取不超过 {max} 字节的文件。请改在浏览器中打开：{url}',
    fileContentMissing: 'Gitea 没有返回 {path} 的内容（通常是因为超过了服务器的 blob 大小上限）。请改在浏览器中打开：{url}',
    binaryFile: '二进制文件；未返回内容。',
    stateRequired: 'state 为必填项：open 或 closed。',
    actionRequired: 'action 为必填项：add、replace 或 remove。',
    labelsRequired: 'add/replace 需要 labels，且必须是由标签 id 或名称组成的数组。',
    labelsEmpty: 'add 时 labels 不能为空。',
    labelsItems: 'labels 只能包含标签 id 或非空名称。',
    noLabels: '（无）',
    styleRequired: 'style 为必填项：{styles}。请询问用户要使用哪种合并方式。',
    headCommitInvalid: 'head_commit_id 必须是十六进制的提交 sha。',
    statusTypesInvalid: 'status_types 只能包含 unread、read 或 pinned。',
    subjectTypeInvalid: 'subject_type 只能包含 issue、pull、commit 或 repository。',
    overviewHint: '传入 category 查看该类目下的操作，再用 call_tool({name, args}) 执行其中一个。仓库级操作需要 owner 和 repo。配置了多个实例时，请传入 args.instance。',
    categoryHint: '标记说明：* = 必填，? = 可选。',
    unknownCategory: '未知类目 "{category}"。可用类目：{categories}。',
    paramsSuffix: '参数：{params}',
    confirmUnsupported: '未执行：当前 Cindy 版本无法显示确认框，因此写操作已停用。请更新 Cindy 后再使用写操作。',
    confirmFailedReason: '未执行：无法显示确认框（{reason}）。',
    confirmUnavailableReason: '未执行：无法显示确认框（{reason}）。请几秒后再试。',
    confirmUnavailable: '未执行：无法显示确认框。请几秒后再试。',
    confirmDeclined: '未执行：用户拒绝了确认（或确认已超时）。除非用户再次要求，否则不要重试。',
    nameRequired: 'name 为必填项；请用 list_tools 查看可用操作。',
    unknownOperation: '未知操作 "{name}"。请使用 list_tools（类目：{categories}）。',
    resultTooLarge: '结果有 {size} 个字符，超过了 {max} 的上限。请缩小范围：降低 limit、使用 page、减小 max_chars 或指定更具体的路径。',
    writeUnsummarized: 'Gitea 已接受写操作（HTTP {status}），但无法整理响应内容。',
    connectionTestFailed: '连接测试失败。',
    unknownTool: '未知工具 "{tool}"。',
    unexpectedError: 'Gitea 插件遇到意外错误：{detail}',
    confirmCreateIssue: '在 {host} 的 {repo} 中创建 Issue？\n标题：{title}',
    confirmComment: '在 {repo}（{host}）的 #{index} 上发表评论？\n{body}',
    confirmClose: '关闭 {repo}（{host}）中的 #{index}？',
    confirmReopen: '重新打开 {repo}（{host}）中的 #{index}？',
    confirmRemoveLabel: '从 {repo}（{host}）的 #{index} 上移除 id 为 {id} 的标签？',
    confirmAddLabels: '为 {repo}（{host}）的 #{index} 添加标签 {labels}？',
    confirmReplaceLabels: '将 {repo}（{host}）中 #{index} 的全部标签替换为 {labels}？',
    confirmCreatePull: '在 {repo}（{host}）中创建从 {head} 合并到 {base} 的合并请求？\n标题：{title}',
    confirmMerge: '使用 "{style}" 方式合并 {repo}（{host}）中的合并请求 #{index}？此操作无法撤销。',
    confirmMergeDelete: '使用 "{style}" 方式合并 {repo}（{host}）中的合并请求 #{index} 并删除源分支？此操作无法撤销。',
    confirmRelease: '在 {repo}（{host}）中创建{kind} {tag}？',
    confirmReleaseAt: '在 {repo}（{host}）的 {target} 上创建{kind} {tag}？',
    releaseNameLine: '\n名称：{name}',
    moreItems: '{shown}（另有 {count} 个）',
    kindRelease: '发布',
    kindDraftRelease: '发布草稿',
    kindPreRelease: '预发布',
    buttonCreate: '创建',
    buttonComment: '评论',
    buttonClose: '关闭',
    buttonReopen: '重新打开',
    buttonRemove: '移除',
    buttonAdd: '添加',
    buttonReplace: '替换',
    buttonOpenPr: '创建合并请求',
    buttonMerge: '合并',
    buttonCancel: '取消',
  },
  ja: {
    invalidRequired: '{key} は必須で、空でない文字列である必要があります。',
    invalidTooLong: '{key} が長すぎます（最大 {max} 文字）。',
    invalidString: '{key} は文字列である必要があります。',
    invalidBool: '{key} は true または false である必要があります。',
    invalidRequiredInt: '{key} は必須で、正の整数である必要があります。',
    invalidInt: '{key} は正の整数である必要があります。',
    invalidEnum: '{key} は次のいずれかである必要があります：{values}。',
    invalidIntArray: '{key} は正の整数の配列である必要があります。',
    invalidMaxItems: '{key} に指定できるのは最大 {max} 件です。',
    invalidIntItems: '{key} には正の整数だけを含めてください。',
    invalidStringArray: '{key} は文字列の配列である必要があります。',
    invalidStringItems: '{key} には文字列だけを含めてください。',
    invalidName: '{key} は Gitea のオーナー名またはリポジトリ名である必要があります（英字、数字、"-"、"_"、"." のみ使用でき、"." と ".." は使用できません）。',
    ownerRequired: 'owner は必須です（または repo を "owner/name" 形式で渡してください）。',
    repoRequired: 'repo は必須です。',
    pathControlChars: '{key} に制御文字またはバックスラッシュが含まれています。',
    pathEmptySegment: '{key} に空のセグメント（"//"）を含めることはできません。',
    pathDotSegment: '{key} に "." や ".." のセグメントを含めることはできません。',
    pageRange: 'page は 1 から {max} までの整数である必要があります。',
    invalidNonNegative: '{key} は 0 以上の整数である必要があります。',
    instanceHttpsOnly: 'https の Gitea インスタンスのみ対応しています。"{instance}" は {scheme}:// を使用しています。',
    instanceSubPath: 'インスタンスには git.example.com のようなホスト名だけを指定してください。サブパスで公開されている Gitea には対応していません。',
    instancePort: 'https の既定ポート 443 のみ対応しています。"{instance}" はポート {port} を使用しています。',
    instanceBadHost: 'インスタンス "{instance}" は有効なホスト名ではありません。',
    connectionsUnavailable: 'Cindy から設定済みの Gitea インスタンスを読み込めませんでした。プラグインを開き直してから再試行してください。',
    noInstance: 'Gitea インスタンスが設定されていません。Cindy で Gitea プラグインの設定を開き、インスタンスの URL とアクセストークンを追加するようユーザーに依頼してください。',
    instanceType: 'instance には接続 ID またはホスト名の文字列を指定してください。',
    unknownInstance: '"{instance}" に一致する設定済みの Gitea インスタンスはありません。設定済み：{hosts}。',
    ambiguousWrite: '複数の Gitea インスタンスが設定されています（{hosts}）。書き込みには args.instance（接続 ID またはホスト名）の指定が必要で、既定の接続にはフォールバックしません。',
    ambiguousRead: '複数の Gitea インスタンスが設定されています（{hosts}）が、既定の接続がありません。args.instance（接続 ID またはホスト名）を指定してください。',
    notExecutedPrefix: '実行されていません：',
    giteaSaid: 'Gitea からのメッセージ：{message}',
    noDetails: '詳細は返されませんでした。',
    authFailed: '{host} の Gitea がアクセストークンを拒否しました（HTTP 401）。トークンが未設定、期限切れ、または失効しています。Gitea プラグインの設定でトークンを差し替えるようユーザーに依頼してください。',
    forbidden: '{host} の Gitea がリクエストを拒否しました（HTTP 403）。この操作には "{scope}" スコープを持つトークンが必要で、アカウントに対象への権限も必要です。',
    notFound: '{host} で見つかりません（HTTP 404）。オーナー、リポジトリ、番号、ブランチ、パスのいずれかが存在しないか、このアカウントからは参照できません。',
    rateLimitedWait: '{host} の Gitea がリクエストを制限しています（HTTP 429）。{seconds} 秒待ってから再試行してください。',
    rateLimited: '{host} の Gitea がリクエストを制限しています（HTTP 429）。しばらく待ってから再試行してください。',
    writeServerError: '{host} の Gitea が書き込みを受け取った後に HTTP {status} を返しました。適用されたかどうかは不明です。再試行する前に現在の状態を確認してください。プラグインは再試行していません。',
    serverError: '{host} の Gitea がサーバーエラーを返しました（HTTP {status}）。しばらくしてから再試行してください。',
    refused: '{host} の Gitea がリクエストを拒否しました（HTTP {status}）。',
    noResponse: '応答なし',
    writeIncomplete: '{host} への書き込みが完了しませんでした（{reason}）。Gitea に届いたかどうかは不明です。再試行する前に現在の状態を確認してください。プラグインは再試行していません。',
    networkError: '{host} から応答を得られませんでした（{reason}）。インスタンスに接続できることを確認してから再試行してください。',
    responseTruncated: '{host} からの応答が大きすぎるため、Cindy によって切り詰められました。リクエストを絞り込んでください（limit を小さくする、パスを指定する、単一の項目を取得するなど）。',
    notJson: '{host} の Gitea が JSON ではない応答を返しました。インスタンスの URL が Gitea を指しているか確認してください。',
    limitCapped: 'limit は {max} に制限されました。続きは page で取得してください。',
    pathRequired: 'path は必須です（リポジトリのルートは ""）。',
    contentsUnexpected: 'Gitea から想定外の contents 応答が返されました。',
    fileTooLarge: 'ファイル {path} は {size} バイトです。get_file が読み込めるのは {max} バイトまでです。代わりにブラウザで開いてください：{url}',
    fileContentMissing: 'Gitea は {path} の内容を返しませんでした（通常はサーバーの blob サイズ上限を超えているためです）。代わりにブラウザで開いてください：{url}',
    binaryFile: 'バイナリファイルのため、内容は返していません。',
    stateRequired: 'state は必須です：open または closed。',
    actionRequired: 'action は必須です：add、replace、remove のいずれか。',
    labelsRequired: 'add/replace には labels が必要で、ラベル ID または名前の配列である必要があります。',
    labelsEmpty: 'add の場合、labels を空にすることはできません。',
    labelsItems: 'labels にはラベル ID または空でない名前だけを含めてください。',
    noLabels: '（なし）',
    styleRequired: 'style は必須です：{styles}。どのマージ方式を使うかユーザーに確認してください。',
    headCommitInvalid: 'head_commit_id は 16 進数のコミット SHA である必要があります。',
    statusTypesInvalid: 'status_types には unread、read、pinned のみ指定できます。',
    subjectTypeInvalid: 'subject_type には issue、pull、commit、repository のみ指定できます。',
    overviewHint: 'category を指定するとそのカテゴリの操作を確認でき、call_tool({name, args}) でそのうち 1 つを実行できます。リポジトリ操作には owner と repo が必要です。複数のインスタンスがある場合は args.instance を指定してください。',
    categoryHint: '表記：* = 必須、? = 任意。',
    unknownCategory: '不明なカテゴリ "{category}"。利用可能：{categories}。',
    paramsSuffix: 'パラメータ：{params}',
    confirmUnsupported: '実行されていません：この Cindy のバージョンでは確認ダイアログを表示できないため、書き込みは無効です。書き込み操作を使うには Cindy を更新してください。',
    confirmFailedReason: '実行されていません：確認ダイアログを表示できませんでした（{reason}）。',
    confirmUnavailableReason: '実行されていません：確認ダイアログを表示できませんでした（{reason}）。数秒後に再試行してください。',
    confirmUnavailable: '実行されていません：確認ダイアログを表示できませんでした。数秒後に再試行してください。',
    confirmDeclined: '実行されていません：ユーザーが確認を拒否しました（またはタイムアウトしました）。ユーザーが改めて依頼しない限り再試行しないでください。',
    nameRequired: 'name は必須です。list_tools で操作一覧を確認してください。',
    unknownOperation: '不明な操作 "{name}"。list_tools を使用してください（カテゴリ：{categories}）。',
    resultTooLarge: '結果は {size} 文字で、上限の {max} 文字を超えています。limit を下げる、page を使う、max_chars を小さくする、より具体的なパスを指定するなどして絞り込んでください。',
    writeUnsummarized: 'Gitea は書き込みを受け付けました（HTTP {status}）が、応答を要約できませんでした。',
    connectionTestFailed: '接続テストに失敗しました。',
    unknownTool: '不明なツール "{tool}"。',
    unexpectedError: 'Gitea プラグインで予期しないエラーが発生しました：{detail}',
    confirmCreateIssue: '{host} の {repo} に Issue を作成しますか？\nタイトル：{title}',
    confirmComment: '{repo}（{host}）の #{index} にコメントを投稿しますか？\n{body}',
    confirmClose: '{repo}（{host}）の #{index} をクローズしますか？',
    confirmReopen: '{repo}（{host}）の #{index} を再オープンしますか？',
    confirmRemoveLabel: '{repo}（{host}）の #{index} からラベル ID {id} を削除しますか？',
    confirmAddLabels: '{repo}（{host}）の #{index} にラベル {labels} を追加しますか？',
    confirmReplaceLabels: '{repo}（{host}）の #{index} のラベルをすべて {labels} に置き換えますか？',
    confirmCreatePull: '{repo}（{host}）で {head} から {base} へのプルリクエストを作成しますか？\nタイトル：{title}',
    confirmMerge: '{repo}（{host}）のプルリクエスト #{index} を "{style}" でマージしますか？この操作は元に戻せません。',
    confirmMergeDelete: '{repo}（{host}）のプルリクエスト #{index} を "{style}" でマージし、head ブランチを削除しますか？この操作は元に戻せません。',
    confirmRelease: '{repo}（{host}）に{kind} {tag} を作成しますか？',
    confirmReleaseAt: '{repo}（{host}）の {target} に{kind} {tag} を作成しますか？',
    releaseNameLine: '\n名前：{name}',
    moreItems: '{shown}（ほか {count} 件）',
    kindRelease: 'リリース',
    kindDraftRelease: 'ドラフトリリース',
    kindPreRelease: 'プレリリース',
    buttonCreate: '作成',
    buttonComment: 'コメント',
    buttonClose: 'クローズ',
    buttonReopen: '再オープン',
    buttonRemove: '削除',
    buttonAdd: '追加',
    buttonReplace: '置き換え',
    buttonOpenPr: 'PR を作成',
    buttonMerge: 'マージ',
    buttonCancel: 'キャンセル',
  },
  ko: {
    invalidRequired: '{key}은(는) 필수이며 비어 있지 않은 문자열이어야 합니다.',
    invalidTooLong: '{key}이(가) 너무 깁니다(최대 {max}자).',
    invalidString: '{key}은(는) 문자열이어야 합니다.',
    invalidBool: '{key}은(는) true 또는 false여야 합니다.',
    invalidRequiredInt: '{key}은(는) 필수이며 양의 정수여야 합니다.',
    invalidInt: '{key}은(는) 양의 정수여야 합니다.',
    invalidEnum: '{key}은(는) 다음 중 하나여야 합니다: {values}.',
    invalidIntArray: '{key}은(는) 양의 정수 배열이어야 합니다.',
    invalidMaxItems: '{key}에는 최대 {max}개 항목만 지정할 수 있습니다.',
    invalidIntItems: '{key}에는 양의 정수만 포함해야 합니다.',
    invalidStringArray: '{key}은(는) 문자열 배열이어야 합니다.',
    invalidStringItems: '{key}에는 문자열만 포함해야 합니다.',
    invalidName: '{key}은(는) Gitea 소유자 또는 저장소 이름이어야 합니다(영문자, 숫자, "-", "_", "."만 사용할 수 있으며 "."과 ".."은 사용할 수 없음).',
    ownerRequired: 'owner는 필수입니다(또는 repo를 "owner/name" 형식으로 전달하세요).',
    repoRequired: 'repo는 필수입니다.',
    pathControlChars: '{key}에 제어 문자나 백슬래시가 포함되어 있습니다.',
    pathEmptySegment: '{key}에 빈 세그먼트("//")를 포함할 수 없습니다.',
    pathDotSegment: '{key}에 "." 또는 ".." 세그먼트를 포함할 수 없습니다.',
    pageRange: 'page는 1부터 {max}까지의 정수여야 합니다.',
    invalidNonNegative: '{key}은(는) 0 이상의 정수여야 합니다.',
    instanceHttpsOnly: 'https Gitea 인스턴스만 지원합니다. "{instance}"은(는) {scheme}://을 사용합니다.',
    instanceSubPath: '인스턴스에는 git.example.com 같은 호스트 이름만 입력해야 합니다. 하위 경로에서 제공되는 Gitea는 지원하지 않습니다.',
    instancePort: 'https 기본 포트 443만 지원합니다. "{instance}"은(는) 포트 {port}을(를) 사용합니다.',
    instanceBadHost: '인스턴스 "{instance}"은(는) 올바른 호스트 이름이 아닙니다.',
    connectionsUnavailable: 'Cindy에서 설정된 Gitea 인스턴스를 읽지 못했습니다. 플러그인을 다시 연 후 다시 시도하세요.',
    noInstance: '설정된 Gitea 인스턴스가 없습니다. 사용자에게 Cindy에서 Gitea 플러그인 설정을 열어 인스턴스 URL과 액세스 토큰을 추가하도록 요청하세요.',
    instanceType: 'instance는 연결 ID나 호스트 문자열이어야 합니다.',
    unknownInstance: '"{instance}"와(과) 일치하는 Gitea 인스턴스가 설정되어 있지 않습니다. 설정된 인스턴스: {hosts}.',
    ambiguousWrite: 'Gitea 인스턴스가 여러 개 설정되어 있습니다({hosts}). 쓰기 작업에는 args.instance(연결 ID 또는 호스트)가 필요하며 기본 연결로 대체되지 않습니다.',
    ambiguousRead: 'Gitea 인스턴스가 여러 개 설정되어 있지만({hosts}) 기본 연결이 없습니다. args.instance(연결 ID 또는 호스트)를 전달하세요.',
    notExecutedPrefix: '실행되지 않음: ',
    giteaSaid: ' Gitea 메시지: {message}',
    noDetails: ' 세부 정보가 반환되지 않았습니다.',
    authFailed: '{host}의 Gitea가 액세스 토큰을 거부했습니다(HTTP 401). 토큰이 없거나 만료되었거나 폐기되었습니다. 사용자에게 Gitea 플러그인 설정에서 토큰을 교체하도록 요청하세요.',
    forbidden: '{host}의 Gitea가 요청을 거부했습니다(HTTP 403). 이 작업에는 "{scope}" 범위가 있는 토큰이 필요하며, 계정에 대상에 대한 권한도 있어야 합니다.',
    notFound: '{host}에서 찾을 수 없습니다(HTTP 404). 소유자, 저장소, 번호, 브랜치 또는 경로가 존재하지 않거나 이 계정으로 볼 수 없습니다.',
    rateLimitedWait: '{host}의 Gitea가 요청 속도를 제한하고 있습니다(HTTP 429). {seconds}초 기다린 후 다시 시도하세요.',
    rateLimited: '{host}의 Gitea가 요청 속도를 제한하고 있습니다(HTTP 429). 잠시 기다린 후 다시 시도하세요.',
    writeServerError: '{host}의 Gitea가 쓰기 요청을 받은 후 HTTP {status}을(를) 반환했습니다. 적용되었는지 여부는 알 수 없습니다. 다시 시도하기 전에 현재 상태를 확인하세요. 플러그인은 다시 시도하지 않았습니다.',
    serverError: '{host}의 Gitea가 서버 오류를 반환했습니다(HTTP {status}). 나중에 다시 시도하세요.',
    refused: '{host}의 Gitea가 요청을 거부했습니다(HTTP {status}).',
    noResponse: '응답 없음',
    writeIncomplete: '{host}에 대한 쓰기가 완료되지 않았습니다({reason}). Gitea에 도달했는지 여부는 알 수 없습니다. 다시 시도하기 전에 현재 상태를 확인하세요. 플러그인은 다시 시도하지 않았습니다.',
    networkError: '{host}에서 응답을 받지 못했습니다({reason}). 인스턴스에 접속할 수 있는지 확인한 후 다시 시도하세요.',
    responseTruncated: '{host}의 응답이 너무 커서 Cindy가 잘라냈습니다. 요청 범위를 좁히세요(더 작은 limit, 특정 경로 또는 단일 항목).',
    notJson: '{host}의 Gitea가 JSON이 아닌 응답을 반환했습니다. 인스턴스 URL이 Gitea를 가리키는지 확인하세요.',
    limitCapped: 'limit이 {max}(으)로 제한되었습니다. 이어서 보려면 page를 사용하세요.',
    pathRequired: 'path는 필수입니다(저장소 루트는 "").',
    contentsUnexpected: 'Gitea가 예상하지 못한 contents 응답을 반환했습니다.',
    fileTooLarge: '파일 {path}의 크기는 {size}바이트입니다. get_file은 최대 {max}바이트까지 읽을 수 있습니다. 대신 브라우저에서 여세요: {url}',
    fileContentMissing: 'Gitea가 {path}의 내용을 반환하지 않았습니다(보통 서버의 blob 크기 제한을 넘었기 때문입니다). 대신 브라우저에서 여세요: {url}',
    binaryFile: '바이너리 파일이므로 내용을 반환하지 않았습니다.',
    stateRequired: 'state는 필수입니다: open 또는 closed.',
    actionRequired: 'action은 필수입니다: add, replace 또는 remove.',
    labelsRequired: 'add/replace에는 labels가 필요하며 라벨 ID나 이름의 배열이어야 합니다.',
    labelsEmpty: 'add에서는 labels를 비워 둘 수 없습니다.',
    labelsItems: 'labels에는 라벨 ID나 비어 있지 않은 이름만 포함해야 합니다.',
    noLabels: '(없음)',
    styleRequired: 'style은 필수입니다: {styles}. 어떤 병합 방식을 사용할지 사용자에게 물어보세요.',
    headCommitInvalid: 'head_commit_id는 16진수 커밋 SHA여야 합니다.',
    statusTypesInvalid: 'status_types에는 unread, read, pinned만 포함할 수 있습니다.',
    subjectTypeInvalid: 'subject_type에는 issue, pull, commit, repository만 포함할 수 있습니다.',
    overviewHint: 'category를 전달하면 해당 카테고리의 작업을 볼 수 있고, call_tool({name, args})로 그중 하나를 실행합니다. 저장소 작업에는 owner와 repo가 필요합니다. 인스턴스가 여러 개면 args.instance를 전달하세요.',
    categoryHint: '표기: * = 필수, ? = 선택.',
    unknownCategory: '알 수 없는 카테고리 "{category}". 사용 가능: {categories}.',
    paramsSuffix: ' 매개변수: {params}',
    confirmUnsupported: '실행되지 않음: 이 Cindy 버전은 확인 대화상자를 표시할 수 없어 쓰기 작업이 비활성화되어 있습니다. 쓰기 작업을 사용하려면 Cindy를 업데이트하세요.',
    confirmFailedReason: '실행되지 않음: 확인 대화상자를 표시하지 못했습니다({reason}).',
    confirmUnavailableReason: '실행되지 않음: 확인 대화상자를 표시하지 못했습니다({reason}). 몇 초 후 다시 시도하세요.',
    confirmUnavailable: '실행되지 않음: 확인 대화상자를 표시하지 못했습니다. 몇 초 후 다시 시도하세요.',
    confirmDeclined: '실행되지 않음: 사용자가 확인을 거부했습니다(또는 시간이 초과되었습니다). 사용자가 다시 요청하지 않는 한 다시 시도하지 마세요.',
    nameRequired: 'name은 필수입니다. list_tools로 작업 목록을 확인하세요.',
    unknownOperation: '알 수 없는 작업 "{name}". list_tools를 사용하세요(카테고리: {categories}).',
    resultTooLarge: '결과가 {size}자로 상한인 {max}자를 넘습니다. limit을 낮추거나, page를 사용하거나, max_chars를 줄이거나, 더 구체적인 경로를 지정해 범위를 좁히세요.',
    writeUnsummarized: 'Gitea가 쓰기를 수락했지만(HTTP {status}) 응답을 요약할 수 없습니다.',
    connectionTestFailed: '연결 테스트에 실패했습니다.',
    unknownTool: '알 수 없는 도구 "{tool}".',
    unexpectedError: 'Gitea 플러그인에서 예기치 않은 오류가 발생했습니다: {detail}',
    confirmCreateIssue: '{host}의 {repo}에 이슈를 만들까요?\n제목: {title}',
    confirmComment: '{repo}({host})의 #{index}에 댓글을 게시할까요?\n{body}',
    confirmClose: '{repo}({host})의 #{index}을(를) 닫을까요?',
    confirmReopen: '{repo}({host})의 #{index}을(를) 다시 열까요?',
    confirmRemoveLabel: '{repo}({host})의 #{index}에서 라벨 ID {id}을(를) 제거할까요?',
    confirmAddLabels: '{repo}({host})의 #{index}에 라벨 {labels}을(를) 추가할까요?',
    confirmReplaceLabels: '{repo}({host})의 #{index} 라벨을 모두 {labels}(으)로 바꿀까요?',
    confirmCreatePull: '{repo}({host})에서 {head}을(를) {base}(으)로 병합하는 풀 리퀘스트를 열까요?\n제목: {title}',
    confirmMerge: '{repo}({host})의 풀 리퀘스트 #{index}을(를) "{style}" 방식으로 병합할까요? 되돌릴 수 없습니다.',
    confirmMergeDelete: '{repo}({host})의 풀 리퀘스트 #{index}을(를) "{style}" 방식으로 병합하고 head 브랜치를 삭제할까요? 되돌릴 수 없습니다.',
    confirmRelease: '{repo}({host})에 {kind} {tag}을(를) 만들까요?',
    confirmReleaseAt: '{repo}({host})의 {target}에 {kind} {tag}을(를) 만들까요?',
    releaseNameLine: '\n이름: {name}',
    moreItems: '{shown} 외 {count}개',
    kindRelease: '릴리스',
    kindDraftRelease: '초안 릴리스',
    kindPreRelease: '사전 릴리스',
    buttonCreate: '만들기',
    buttonComment: '댓글 달기',
    buttonClose: '닫기',
    buttonReopen: '다시 열기',
    buttonRemove: '제거',
    buttonAdd: '추가',
    buttonReplace: '바꾸기',
    buttonOpenPr: 'PR 열기',
    buttonMerge: '병합',
    buttonCancel: '취소',
  },
};

var hasOwn = Object.prototype.hasOwnProperty;
/* null = no locale from the host yet; copy falls back to English and the next call asks again. */
var hostLocale = null;
var localeRequest = null;

function resolveLocale(value) {
  return typeof value === 'string' && hasOwn.call(MESSAGES, value) ? value : 'en';
}

async function requestHostLocale() {
  if (typeof cindy.request !== 'function') return null;
  var timer = null;
  try {
    // A silent host must not stall the tool call: after 3 seconds use English and retry next call.
    var r = await Promise.race([
      cindy.request({ kind: 'app-context' }),
      new Promise(function (resolve) { timer = setTimeout(function () { resolve(null); }, 3000); }),
    ]);
    var locale = r && r.ok && r.context && r.context.locale;
    return typeof locale === 'string' ? resolveLocale(locale) : null;
  } catch (e) {
    return null;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/* Concurrent tool calls share one request; success is cached and host-context-changed keeps it current. */
function ensureLocale() {
  if (hostLocale) return Promise.resolve(hostLocale);
  if (!localeRequest) {
    localeRequest = requestHostLocale().then(function (locale) {
      localeRequest = null;
      // A host-context-changed that arrived during the request wins over this reply.
      if (!hostLocale && locale) hostLocale = locale;
      return hostLocale || 'en';
    });
  }
  return localeRequest;
}

function t(key, vars) {
  var table = MESSAGES[hostLocale || 'en'];
  var template = hasOwn.call(table, key) ? table[key] : MESSAGES.en[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, function (match, name) {
    return hasOwn.call(vars, name) ? String(vars[name]) : match;
  });
}

/* ── errors ─────────────────────────────────────────────────────────── */

function opError(code, message) {
  var e = new Error(message);
  e.code = code;
  e.safe = true;
  return e;
}

/**
 * Remove anything that looks like a credential from text that came from the
 * server or the host before it is shown to the agent. Gitea tokens are 40 hex
 * characters, the same shape as a SHA-1, so hex runs of that length are
 * redacted in error text (never in successful data).
 */
function redact(text) {
  return String(text)
    .replace(/(authorization\s*[:=]\s*)\S+(\s+\S+)?/gi, '$1[redacted]')
    .replace(/\b(token|bearer)\s+[A-Za-z0-9._~+\/=-]{8,}/gi, '$1 [redacted]')
    .replace(/\b[0-9a-f]{40}\b/gi, '[redacted]');
}

function cleanText(text, max) {
  var s = String(text === undefined || text === null ? '' : text)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .trim();
  if (s.length > max) s = s.slice(0, max) + '...';
  return s;
}

function clip(text, max) {
  if (typeof text !== 'string') return text;
  return text.length > max ? text.slice(0, max) + '...[truncated]' : text;
}

/* ── argument validation ────────────────────────────────────────────── */

function invalid(message) {
  return opError('INVALID_ARGS', message);
}

function reqString(a, key, max) {
  var v = a[key];
  if (typeof v !== 'string' || !v.trim()) throw invalid(t('invalidRequired', { key: key }));
  if (max && v.length > max) throw invalid(t('invalidTooLong', { key: key, max: max }));
  return v;
}

function optString(a, key, max) {
  var v = a[key];
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string') throw invalid(t('invalidString', { key: key }));
  if (max && v.length > max) throw invalid(t('invalidTooLong', { key: key, max: max }));
  return v;
}

function optBool(a, key) {
  var v = a[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'boolean') throw invalid(t('invalidBool', { key: key }));
  return v;
}

function toPositiveInt(v) {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) return v;
  if (typeof v === 'string' && /^[1-9][0-9]{0,15}$/.test(v)) {
    var n = Number(v);
    if (Number.isSafeInteger(n)) return n;
  }
  return null;
}

function reqInt(a, key) {
  var n = toPositiveInt(a[key]);
  if (n === null) throw invalid(t('invalidRequiredInt', { key: key }));
  return n;
}

function optInt(a, key) {
  if (a[key] === undefined || a[key] === null || a[key] === '') return undefined;
  var n = toPositiveInt(a[key]);
  if (n === null) throw invalid(t('invalidInt', { key: key }));
  return n;
}

function optEnum(a, key, values) {
  var v = a[key];
  if (v === undefined || v === null || v === '') return undefined;
  if (values.indexOf(v) < 0) throw invalid(t('invalidEnum', { key: key, values: values.join(', ') }));
  return v;
}

function intList(a, key, max) {
  var v = a[key];
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) throw invalid(t('invalidIntArray', { key: key }));
  if (v.length > max) throw invalid(t('invalidMaxItems', { key: key, max: max }));
  return v.map(function (x) {
    var n = toPositiveInt(x);
    if (n === null) throw invalid(t('invalidIntItems', { key: key }));
    return n;
  });
}

function stringList(a, key, max) {
  var v = a[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string') v = v.split(',');
  if (!Array.isArray(v)) throw invalid(t('invalidStringArray', { key: key }));
  var out = [];
  for (var i = 0; i < v.length; i++) {
    if (typeof v[i] !== 'string') throw invalid(t('invalidStringItems', { key: key }));
    var s = v[i].trim();
    if (s) out.push(s);
  }
  if (out.length > max) throw invalid(t('invalidMaxItems', { key: key, max: max }));
  return out;
}

function checkName(value, key) {
  if (typeof value !== 'string' || !NAME_RE.test(value) || value === '.' || value === '..') {
    throw invalid(t('invalidName', { key: key }));
  }
  return value;
}

/** '/repos/{owner}/{repo}' with both names validated and encoded. */
function repoPath(a) {
  var owner = a.owner;
  var repo = a.repo;
  if ((owner === undefined || owner === null || owner === '') && typeof repo === 'string' && repo.split('/').length === 2) {
    var parts = repo.split('/');
    owner = parts[0];
    repo = parts[1];
  }
  if (owner === undefined || owner === null || owner === '') throw invalid(t('ownerRequired'));
  if (repo === undefined || repo === null || repo === '') throw invalid(t('repoRequired'));
  checkName(owner, 'owner');
  checkName(repo, 'repo');
  return { path: '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo), full: owner + '/' + repo };
}

/**
 * Repository file path to an encoded multi-segment path. "." and ".." are
 * rejected outright: URL parsers collapse them (even percent-encoded), which
 * would let a value walk out of the contents endpoint.
 */
function filePath(value, key) {
  if (typeof value !== 'string') throw invalid(t('invalidString', { key: key }));
  var trimmed = value.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/[\u0000-\u001f\u007f\\]/.test(trimmed)) throw invalid(t('pathControlChars', { key: key }));
  var segments = trimmed.split('/');
  for (var i = 0; i < segments.length; i++) {
    var seg = segments[i];
    if (!seg) throw invalid(t('pathEmptySegment', { key: key }));
    if (seg === '.' || seg === '..' || /^(%2e|\.){1,2}$/i.test(seg)) throw invalid(t('pathDotSegment', { key: key }));
  }
  return segments.map(encodeURIComponent).join('/');
}

function readPaging(a) {
  var page = 1;
  if (a.page !== undefined && a.page !== null && a.page !== '') {
    page = toPositiveInt(a.page);
    if (page === null || page > MAX_PAGE) throw invalid(t('pageRange', { max: MAX_PAGE }));
  }
  var limit = DEFAULT_LIMIT;
  var capped = false;
  if (a.limit !== undefined && a.limit !== null && a.limit !== '') {
    limit = toPositiveInt(a.limit);
    if (limit === null) throw invalid(t('invalidInt', { key: 'limit' }));
    if (limit > MAX_LIMIT) {
      limit = MAX_LIMIT;
      capped = true;
    }
  }
  return { page: page, limit: limit, capped: capped };
}

function textWindow(a) {
  var max = TEXT_DEFAULT_CHARS;
  if (a.max_chars !== undefined && a.max_chars !== null && a.max_chars !== '') {
    max = toPositiveInt(a.max_chars);
    if (max === null) throw invalid(t('invalidInt', { key: 'max_chars' }));
    if (max > TEXT_MAX_CHARS) max = TEXT_MAX_CHARS;
  }
  // null = not given (logs then read from the end); 0 is an explicit start.
  var offset = null;
  if (a.offset === 0 || a.offset === '0') {
    offset = 0;
  } else if (a.offset !== undefined && a.offset !== null && a.offset !== '') {
    offset = toPositiveInt(a.offset);
    if (offset === null) throw invalid(t('invalidNonNegative', { key: 'offset' }));
  }
  return { max: max, offset: offset };
}

/* ── instances ──────────────────────────────────────────────────────── */

/**
 * Normalize a user-supplied instance (host, or https URL without a path) to a
 * bare lowercase host. The host network channel only reaches https on 443.
 */
function parseInstanceHost(raw) {
  var s = String(raw).trim();
  var scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(s);
  if (scheme) {
    if (scheme[1].toLowerCase() !== 'https') {
      throw opError('INVALID_INSTANCE_URL', t('instanceHttpsOnly', { instance: cleanText(raw, 100), scheme: scheme[1].toLowerCase() }));
    }
    s = s.slice(scheme[0].length);
  }
  s = s.replace(/\/+$/, '');
  if (/[\/?#@\s]/.test(s)) {
    throw opError('INVALID_INSTANCE_URL', t('instanceSubPath'));
  }
  var port = /:([^:]*)$/.exec(s);
  if (port) {
    if (port[1] !== '443') {
      throw opError('INVALID_INSTANCE_URL', t('instancePort', { instance: cleanText(raw, 100), port: cleanText(port[1], 10) }));
    }
    s = s.slice(0, s.length - port[0].length);
  }
  s = s.toLowerCase();
  if (!HOST_RE.test(s)) throw opError('INVALID_INSTANCE_URL', t('instanceBadHost', { instance: cleanText(raw, 100) }));
  return s;
}

async function listConnections() {
  var list;
  try {
    list = await (await fetch('/connections')).json();
  } catch (e) {
    throw opError('CONNECTIONS_UNAVAILABLE', t('connectionsUnavailable'));
  }
  if (!Array.isArray(list)) return [];
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].key === CONNECTION_KEY) {
      return Array.isArray(list[i].connections) ? list[i].connections.filter(function (c) { return c && typeof c.host === 'string'; }) : [];
    }
  }
  return [];
}

/**
 * Pick the connection for this call. Precedence: args.instance (id or host),
 * the only configured connection, then the default connection for reads.
 * Writes with several instances must name one explicitly.
 */
async function resolveInstance(a, isWrite) {
  var conns = await listConnections();
  if (!conns.length) {
    throw opError('NO_INSTANCE', t('noInstance'));
  }
  var hosts = conns.map(function (c) { return c.host; }).join(', ');
  var chosen = null;
  if (a.instance !== undefined && a.instance !== null && a.instance !== '') {
    if (typeof a.instance !== 'string') throw invalid(t('instanceType'));
    for (var i = 0; i < conns.length; i++) {
      if (conns[i].id === a.instance) chosen = conns[i];
    }
    if (!chosen) {
      var want = parseInstanceHost(a.instance);
      for (var j = 0; j < conns.length; j++) {
        if (String(conns[j].host).toLowerCase() === want) chosen = conns[j];
      }
    }
    if (!chosen) throw opError('UNKNOWN_INSTANCE', t('unknownInstance', { instance: cleanText(a.instance, 100), hosts: hosts }));
  } else if (conns.length === 1) {
    chosen = conns[0];
  } else if (isWrite) {
    throw opError('AMBIGUOUS_INSTANCE', t('ambiguousWrite', { hosts: hosts }));
  } else {
    for (var d = 0; d < conns.length; d++) {
      if (conns[d].isDefault) chosen = conns[d];
    }
    if (!chosen) throw opError('AMBIGUOUS_INSTANCE', t('ambiguousRead', { hosts: hosts }));
  }
  return { id: chosen.id, host: parseInstanceHost(chosen.host) };
}

/* ── HTTP ───────────────────────────────────────────────────────────── */

function buildQuery(params) {
  var parts = [];
  for (var k in params) {
    if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
    var v = params[k];
    if (v === undefined || v === null || v === '') continue;
    var values = Array.isArray(v) ? v : [v];
    for (var i = 0; i < values.length; i++) {
      if (values[i] === undefined || values[i] === null || values[i] === '') continue;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(values[i])));
    }
  }
  return parts.length ? '?' + parts.join('&') : '';
}

function header(headers, name) {
  if (!headers || typeof headers !== 'object') return undefined;
  var lower = name.toLowerCase();
  for (var k in headers) {
    if (Object.prototype.hasOwnProperty.call(headers, k) && k.toLowerCase() === lower) return headers[k];
  }
  return undefined;
}

function giteaMessage(body) {
  if (typeof body !== 'string' || !body) return '';
  var msg = '';
  try {
    var data = JSON.parse(body);
    if (data && typeof data === 'object') {
      if (typeof data.message === 'string') msg = data.message;
      if (Array.isArray(data.errors) && data.errors.length) {
        msg += (msg ? ' ' : '') + data.errors.map(function (e) { return typeof e === 'string' ? e : JSON.stringify(e); }).join('; ');
      }
    }
  } catch (e) {
    msg = body;
  }
  return cleanText(redact(msg), MESSAGE_SNIPPET_MAX);
}

/**
 * Map a non-2xx response to an error. For writes, 4xx means Gitea rejected the
 * request (nothing changed) while 5xx may hide a partially applied change.
 */
function statusError(status, r, ctx) {
  var msg = giteaMessage(r.body);
  var said = msg ? t('giteaSaid', { message: msg }) : '';
  var notRun = ctx.write ? t('notExecutedPrefix') : '';
  if (status === 401) {
    return opError('AUTH_FAILED', notRun + t('authFailed', { host: ctx.host }));
  }
  if (status === 403) {
    return opError('FORBIDDEN', notRun + t('forbidden', { host: ctx.host, scope: ctx.scope }) + said);
  }
  if (status === 404) {
    return opError('NOT_FOUND', notRun + t('notFound', { host: ctx.host }) + said);
  }
  if (status === 429) {
    var retry = header(r.headers, 'retry-after');
    return opError('RATE_LIMITED', notRun + (retry
      ? t('rateLimitedWait', { host: ctx.host, seconds: cleanText(retry, 20) })
      : t('rateLimited', { host: ctx.host })));
  }
  if (status >= 500) {
    if (ctx.write) {
      return opError('OUTCOME_UNKNOWN', t('writeServerError', { host: ctx.host, status: status }) + said);
    }
    return opError('SERVER_ERROR', t('serverError', { host: ctx.host, status: status }) + said);
  }
  var codes = { 400: 'BAD_REQUEST', 405: 'NOT_ALLOWED', 409: 'CONFLICT', 412: 'PRECONDITION_FAILED', 422: 'VALIDATION_FAILED', 423: 'LOCKED' };
  return opError(codes[status] || 'HTTP_ERROR', notRun + t('refused', { host: ctx.host, status: status }) + (said || t('noDetails')));
}

/**
 * One request, never retried. ctx = { host, callId, write, scope }.
 * Returns { data, text, status, headers }.
 */
async function request(ctx, spec) {
  var req = {
    url: 'https://' + ctx.host + API_PREFIX + spec.path + buildQuery(spec.query || {}),
    method: spec.method || 'GET',
    headers: { Accept: spec.accept || 'application/json' },
    as: 'text',
    timeoutMs: REQUEST_TIMEOUT_MS,
    callId: ctx.callId,
  };
  if (spec.body !== undefined) {
    req.headers['Content-Type'] = 'application/json';
    req.body = JSON.stringify(spec.body);
  }
  var r;
  try {
    r = await cindy.fetch(req);
  } catch (e) {
    r = { ok: false, message: e && e.message ? e.message : String(e) };
  }
  if (!r || r.ok !== true) {
    var why = cleanText(redact((r && r.message) || t('noResponse')), 200);
    if (ctx.write) {
      throw opError('OUTCOME_UNKNOWN', t('writeIncomplete', { host: ctx.host, reason: why }));
    }
    throw opError('NETWORK_ERROR', t('networkError', { host: ctx.host, reason: why }));
  }
  var status = r.status;
  if (typeof status !== 'number' || status < 200 || status >= 300) throw statusError(status, r, ctx);
  var body = typeof r.body === 'string' ? r.body : '';
  if (r.truncated && !ctx.write) {
    throw opError('OUTPUT_TOO_LARGE', t('responseTruncated', { host: ctx.host }));
  }
  if (spec.text) return { text: body, status: status, headers: r.headers || {} };
  var data = null;
  if (body) {
    try {
      data = JSON.parse(body);
    } catch (e) {
      if (!ctx.write) throw opError('BAD_RESPONSE', t('notJson', { host: ctx.host }));
      data = null;
    }
  }
  return { data: data, status: status, headers: r.headers || {} };
}

/* ── trimming ───────────────────────────────────────────────────────── */

function login(u) {
  return u && typeof u === 'object' ? u.login || u.username || null : null;
}

function firstLine(s) {
  return typeof s === 'string' ? s.split('\n')[0] : s;
}

function names(list) {
  return Array.isArray(list) ? list.map(function (x) { return x && x.name; }) : [];
}

function logins(list) {
  return Array.isArray(list) ? list.map(login) : [];
}

function trimUser(u) {
  if (!u) return null;
  return {
    id: u.id, login: u.login, full_name: u.full_name || '', email: u.email || '',
    html_url: u.html_url, is_admin: u.is_admin === true, created: u.created,
  };
}

function trimRepo(r, full) {
  if (!r) return null;
  var out = {
    full_name: r.full_name, description: clip(r.description || '', LIST_BODY_MAX), private: r.private,
    fork: r.fork, archived: r.archived, mirror: r.mirror, default_branch: r.default_branch,
    html_url: r.html_url, updated_at: r.updated_at, stars_count: r.stars_count,
    open_issues_count: r.open_issues_count, open_pr_counter: r.open_pr_counter,
  };
  if (full) {
    out.clone_url = r.clone_url;
    out.ssh_url = r.ssh_url;
    out.language = r.language;
    out.size_kb = r.size;
    out.forks_count = r.forks_count;
    out.topics = r.topics || [];
    out.has_issues = r.has_issues;
    out.has_pull_requests = r.has_pull_requests;
    out.has_actions = r.has_actions;
    out.has_releases = r.has_releases;
    out.default_merge_style = r.default_merge_style;
    out.merge_styles_allowed = [
      r.allow_merge_commits && 'merge', r.allow_rebase && 'rebase', r.allow_rebase_explicit && 'rebase-merge',
      r.allow_squash_merge && 'squash', r.allow_fast_forward_only_merge && 'fast-forward-only',
    ].filter(Boolean);
    out.permissions = r.permissions || null;
    out.parent = r.parent ? r.parent.full_name : null;
  }
  return out;
}

function trimBranch(b) {
  return {
    name: b.name, protected: b.protected === true,
    commit_sha: b.commit && b.commit.id, commit_message: clip(firstLine(b.commit && b.commit.message), 200),
    commit_date: b.commit && b.commit.timestamp,
  };
}

function trimCommit(c) {
  var commit = c.commit || {};
  var author = commit.author || {};
  return {
    sha: c.sha, message: clip(commit.message || '', 1000), author: author.name, author_login: login(c.author),
    date: author.date, html_url: c.html_url,
  };
}

function trimIssue(i, full) {
  var out = {
    number: i.number, title: i.title, state: i.state, user: login(i.user),
    labels: names(i.labels), assignees: logins(i.assignees), milestone: i.milestone ? i.milestone.title : null,
    comments: i.comments, created_at: i.created_at, updated_at: i.updated_at, html_url: i.html_url,
  };
  if (i.pull_request) out.is_pull_request = true;
  if (full) {
    out.body = clip(i.body || '', ITEM_BODY_MAX);
    out.closed_at = i.closed_at;
    out.due_date = i.due_date;
    out.is_locked = i.is_locked;
  } else {
    out.body_preview = clip(i.body || '', LIST_BODY_MAX);
  }
  return out;
}

function trimComment(c) {
  return {
    id: c.id, user: login(c.user), created_at: c.created_at, updated_at: c.updated_at,
    body: clip(c.body || '', COMMENT_BODY_MAX), html_url: c.html_url,
  };
}

function trimPull(p, full) {
  var out = {
    number: p.number, title: p.title, state: p.state, draft: p.draft === true, merged: p.merged === true,
    mergeable: p.mergeable, user: login(p.user), head: p.head && p.head.ref, base: p.base && p.base.ref,
    labels: names(p.labels), created_at: p.created_at, updated_at: p.updated_at, html_url: p.html_url,
  };
  if (full) {
    out.body = clip(p.body || '', ITEM_BODY_MAX);
    out.head_sha = p.head && p.head.sha;
    out.head_repo = p.head && p.head.repo ? p.head.repo.full_name : null;
    out.merge_base = p.merge_base;
    out.merged_at = p.merged_at;
    out.merged_by = login(p.merged_by);
    out.merge_commit_sha = p.merge_commit_sha;
    out.assignees = logins(p.assignees);
    out.requested_reviewers = logins(p.requested_reviewers);
    out.milestone = p.milestone ? p.milestone.title : null;
    out.comments = p.comments;
    out.additions = p.additions;
    out.deletions = p.deletions;
    out.changed_files = p.changed_files;
    out.closed_at = p.closed_at;
  }
  return out;
}

function trimChangedFile(f) {
  return {
    filename: f.filename, previous_filename: f.previous_filename || undefined, status: f.status,
    additions: f.additions, deletions: f.deletions, changes: f.changes,
  };
}

function trimLabel(l) {
  return { id: l.id, name: l.name, color: l.color, description: clip(l.description || '', LIST_BODY_MAX), exclusive: l.exclusive === true, is_archived: l.is_archived === true };
}

function trimMilestone(m) {
  return {
    id: m.id, title: m.title, state: m.state, open_issues: m.open_issues, closed_issues: m.closed_issues,
    due_on: m.due_on, description: clip(m.description || '', LIST_BODY_MAX),
  };
}

function trimRun(r) {
  return {
    id: r.id, run_number: r.run_number, title: r.display_title, status: r.status, conclusion: r.conclusion,
    event: r.event, head_branch: r.head_branch, head_sha: r.head_sha, workflow: r.path,
    actor: login(r.actor), started_at: r.started_at, completed_at: r.completed_at, html_url: r.html_url,
  };
}

function trimJob(j) {
  return {
    id: j.id, run_id: j.run_id, name: j.name, status: j.status, conclusion: j.conclusion,
    started_at: j.started_at, completed_at: j.completed_at, runner_name: j.runner_name, html_url: j.html_url,
    steps: Array.isArray(j.steps) ? j.steps.map(function (s) { return { number: s.number, name: s.name, status: s.status, conclusion: s.conclusion }; }) : [],
  };
}

function trimTask(t) {
  return {
    id: t.id, name: t.name, title: t.display_title, status: t.status, event: t.event, workflow_id: t.workflow_id,
    head_branch: t.head_branch, head_sha: t.head_sha, run_number: t.run_number,
    created_at: t.created_at, run_started_at: t.run_started_at, updated_at: t.updated_at, url: t.url,
  };
}

function trimRelease(r) {
  return {
    id: r.id, tag_name: r.tag_name, name: r.name, draft: r.draft, prerelease: r.prerelease,
    target_commitish: r.target_commitish, author: login(r.author), created_at: r.created_at,
    published_at: r.published_at, html_url: r.html_url, body: clip(r.body || '', 2000),
    assets: Array.isArray(r.assets) ? r.assets.map(function (x) { return { name: x.name, size: x.size, download_count: x.download_count, browser_download_url: x.browser_download_url }; }) : [],
  };
}

function trimNotification(n) {
  var s = n.subject || {};
  return {
    id: n.id, unread: n.unread, pinned: n.pinned, updated_at: n.updated_at,
    repository: n.repository ? n.repository.full_name : null,
    subject: { type: s.type, title: s.title, state: s.state, html_url: s.html_url },
  };
}

function listResult(items, paging, headers, trim) {
  var arr = Array.isArray(items) ? items : [];
  var totalRaw = header(headers, 'x-total-count');
  var total = totalRaw !== undefined && /^[0-9]+$/.test(String(totalRaw)) ? Number(totalRaw) : null;
  var out = {
    items: arr.map(trim),
    page: paging.page,
    limit: paging.limit,
    count: arr.length,
    has_more: total !== null ? paging.page * paging.limit < total : arr.length >= paging.limit,
  };
  if (total !== null) out.total = total;
  if (paging.capped) out.note = t('limitCapped', { max: MAX_LIMIT });
  return out;
}

/* ── base64 and text windows ────────────────────────────────────────── */

function decodeBase64(b64) {
  var bin = atob(String(b64).replace(/\s+/g, ''));
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function looksBinary(bytes) {
  var n = Math.min(bytes.length, 8000);
  for (var i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

function windowText(text, win, fromEnd) {
  var total = text.length;
  var start;
  if (fromEnd && win.offset === null) {
    start = Math.max(0, total - win.max);
  } else {
    start = Math.min(win.offset || 0, total);
  }
  var end = Math.min(total, start + win.max);
  var out = { content: text.slice(start, end), offset: start, returned_chars: end - start, total_chars: total, truncated: start > 0 || end < total };
  if (end < total) out.next_offset = end;
  return out;
}

/* ── operation catalog ──────────────────────────────────────────────── */

var CATEGORIES = {
  user: 'The account behind the token',
  repos: 'List, search and inspect repositories',
  code: 'Branches, file contents and commits',
  issues: 'Issues and comments (comments also work on pull requests); writes: create, comment, state, labels',
  pulls: 'Pull requests, changed files and diffs; writes: create and merge',
  labels: 'Repository labels and milestones',
  actions: 'Gitea Actions workflow runs, jobs, tasks and job logs',
  releases: 'Releases; write: create',
  notifications: 'Notification inbox of the token account',
};

var OPS = {};

var REPO_DOC = 'owner*:string, repo*:string (or repo:"owner/name")';
var PAGE_DOC = 'page?:int>=1, limit?:1-' + MAX_LIMIT + ' (default ' + DEFAULT_LIMIT + ')';
var INSTANCE_DOC = 'instance?:connection id or host';

function readOp(name, cat, scope, desc, params, run) {
  OPS[name] = { cat: cat, scope: scope, desc: desc, params: params + ', ' + INSTANCE_DOC, run: run, write: false };
}

/**
 * Confirmation text that fits the host's limit (CONFIRM_BODY_MAX) while the
 * destination (number, owner/repo, host) stays whole. render(v) builds the
 * text from v; when it is too long, the variable parts in `shrink` are cut in
 * order: { name, items } lists become "a, b (+N more)", plain names are text
 * clipped with "...". Only if the destination alone is over the limit does
 * confirmWrite's final cut apply.
 */
function fitConfirm(render, vars, shrink) {
  var limit = CONFIRM_BODY_MAX - 3;
  var v = {};
  for (var k in vars) if (hasOwn.call(vars, k)) v[k] = vars[k];
  var overflow = function () { return render(v).length - limit; };
  var clipVar = function (name, keep) {
    var value = String(v[name] === undefined ? '' : v[name]);
    var room = value.length - overflow() - 3;
    if (overflow() > 0 && value.length > keep) v[name] = value.slice(0, Math.max(keep, room)) + '...';
  };
  for (var i = 0; i < shrink.length && overflow() > 0; i++) {
    var part = shrink[i];
    if (typeof part === 'string') {
      clipVar(part, 1);
      continue;
    }
    var items = part.items;
    for (var shown = items.length - 1; shown >= 1 && overflow() > 0; shown--) {
      v[part.name] = t('moreItems', { shown: items.slice(0, shown).join(', '), count: items.length - shown });
    }
    if (overflow() > 0 && items.length) {
      var first = String(items[0]);
      var cut = Math.max(1, first.length - overflow() - 3);
      v[part.name] = items.length === 1
        ? first.slice(0, cut) + '...'
        : t('moreItems', { shown: first.slice(0, cut) + '...', count: items.length - 1 });
    }
  }
  return render(v);
}

/** prepare(a, inst) -> { request, confirm: { body, button, danger }, shape(data) } */
function writeOp(name, cat, scope, desc, params, prepare) {
  OPS[name] = {
    cat: cat, scope: scope, desc: 'WRITE (asks the user to confirm in Cindy first): ' + desc,
    params: params + ', instance?:required when several instances are configured', prepare: prepare, write: true,
  };
}

/* user */

readOp('get_current_user', 'user', 'read:user', 'The user that owns the token (login, name, email, admin flag).', 'no parameters',
  async function (a, http) {
    var r = await http({ path: '/user' });
    return trimUser(r.data);
  });

/* repos */

readOp('list_my_repos', 'repos', 'read:user + read:repository', 'Repositories the token user owns or can access.', PAGE_DOC,
  async function (a, http) {
    var p = readPaging(a);
    var r = await http({ path: '/user/repos', query: { page: p.page, limit: p.limit } });
    return listResult(r.data, p, r.headers, function (x) { return trimRepo(x, false); });
  });

readOp('search_repos', 'repos', 'read:repository', 'Search repositories visible to the token user.',
  'q?:string, sort?:alpha|created|updated|size|stars|forks|id, order?:asc|desc, mode?:fork|source|mirror|collaborative, archived?:bool, ' + PAGE_DOC,
  async function (a, http) {
    var p = readPaging(a);
    var r = await http({
      path: '/repos/search',
      query: {
        q: optString(a, 'q', 200),
        sort: optEnum(a, 'sort', ['alpha', 'created', 'updated', 'size', 'stars', 'forks', 'id']),
        order: optEnum(a, 'order', ['asc', 'desc']),
        mode: optEnum(a, 'mode', ['fork', 'source', 'mirror', 'collaborative']),
        archived: optBool(a, 'archived'),
        page: p.page, limit: p.limit,
      },
    });
    var items = r.data && Array.isArray(r.data.data) ? r.data.data : [];
    return listResult(items, p, r.headers, function (x) { return trimRepo(x, false); });
  });

readOp('get_repo', 'repos', 'read:repository', 'Repository details: default branch, clone URLs, allowed merge styles, permissions.', REPO_DOC,
  async function (a, http) {
    var rp = repoPath(a);
    var r = await http({ path: rp.path });
    return trimRepo(r.data, true);
  });

/* code */

readOp('list_branches', 'code', 'read:repository', 'Branches with their head commit.', REPO_DOC + ', ' + PAGE_DOC,
  async function (a, http) {
    var rp = repoPath(a);
    var p = readPaging(a);
    var r = await http({ path: rp.path + '/branches', query: { page: p.page, limit: p.limit } });
    return listResult(r.data, p, r.headers, trimBranch);
  });

readOp('get_file', 'code', 'read:repository',
  'Read a text file (decoded from base64, files up to 1 MiB, text window via offset/max_chars) or list a directory. Binary files return metadata only.',
  REPO_DOC + ', path*:string (file or directory; "" for the root), ref?:branch, tag or commit, offset?:int, max_chars?:1-' + TEXT_MAX_CHARS + ' (default ' + TEXT_DEFAULT_CHARS + ')',
  async function (a, http) {
    var rp = repoPath(a);
    if (a.path === undefined || a.path === null) throw invalid(t('pathRequired'));
    var encoded = filePath(a.path, 'path');
    var ref = optString(a, 'ref', 250);
    var win = textWindow(a);
    var r = await http({ path: rp.path + '/contents' + (encoded ? '/' + encoded : ''), query: { ref: ref } });
    var d = r.data;
    if (Array.isArray(d)) {
      var entries = d.slice(0, DIR_MAX_ENTRIES).map(function (e) { return { name: e.name, path: e.path, type: e.type, size: e.size }; });
      var dir = { type: 'dir', path: typeof a.path === 'string' ? a.path : '', ref: ref || null, entries: entries, count: d.length };
      if (d.length > DIR_MAX_ENTRIES) dir.truncated = true;
      return dir;
    }
    if (!d || typeof d !== 'object') throw opError('BAD_RESPONSE', t('contentsUnexpected'));
    var meta = { type: d.type, path: d.path, name: d.name, ref: ref || null, sha: d.sha, size: d.size, html_url: d.html_url };
    if (d.type === 'symlink') { meta.target = d.target; return meta; }
    if (d.type === 'submodule') { meta.submodule_git_url = d.submodule_git_url; return meta; }
    if (d.type !== 'file') return meta;
    if (typeof d.size === 'number' && d.size > FILE_MAX_BYTES) {
      throw opError('OUTPUT_TOO_LARGE', t('fileTooLarge', { path: d.path, size: d.size, max: FILE_MAX_BYTES, url: d.html_url }));
    }
    if (typeof d.content !== 'string' || d.encoding !== 'base64') {
      throw opError('OUTPUT_TOO_LARGE', t('fileContentMissing', { path: d.path, url: d.html_url }));
    }
    var bytes = decodeBase64(d.content);
    if (looksBinary(bytes)) {
      meta.binary = true;
      meta.note = t('binaryFile');
      return meta;
    }
    var text = new TextDecoder('utf-8').decode(bytes);
    var w = windowText(text, win, false);
    for (var k in w) if (Object.prototype.hasOwnProperty.call(w, k)) meta[k] = w[k];
    return meta;
  });

readOp('list_commits', 'code', 'read:repository', 'Commit history, optionally for a branch/sha, a path or a date range.',
  REPO_DOC + ', sha?:branch, tag or commit, path?:string, since?:RFC3339, until?:RFC3339, ' + PAGE_DOC,
  async function (a, http) {
    var rp = repoPath(a);
    var p = readPaging(a);
    var r = await http({
      path: rp.path + '/commits',
      query: {
        sha: optString(a, 'sha', 250), path: optString(a, 'path', 1000),
        since: optString(a, 'since', 64), until: optString(a, 'until', 64),
        stat: false, verification: false, files: false, page: p.page, limit: p.limit,
      },
    });
    return listResult(r.data, p, r.headers, trimCommit);
  });

/* issues */

readOp('list_issues', 'issues', 'read:issue', 'Issues of a repository (pull requests excluded), filterable by state, labels, assignee, author, milestone and text.',
  REPO_DOC + ', state?:open|closed|all (default open), labels?:string[] or comma list of names, assignee?:username, created_by?:username, mentioned_by?:username, milestones?:string (comma list), q?:search text, since?:RFC3339, before?:RFC3339, ' + PAGE_DOC,
  async function (a, http) {
    var rp = repoPath(a);
    var p = readPaging(a);
    var labels = stringList(a, 'labels', 20);
    var r = await http({
      path: rp.path + '/issues',
      query: {
        type: 'issues',
        state: optEnum(a, 'state', ['open', 'closed', 'all']),
        labels: labels && labels.length ? labels.join(',') : undefined,
        assigned_by: optString(a, 'assignee', 100),
        created_by: optString(a, 'created_by', 100),
        mentioned_by: optString(a, 'mentioned_by', 100),
        milestones: optString(a, 'milestones', 500),
        q: optString(a, 'q', 200),
        since: optString(a, 'since', 64), before: optString(a, 'before', 64),
        page: p.page, limit: p.limit,
      },
    });
    return listResult(r.data, p, r.headers, function (x) { return trimIssue(x, false); });
  });

readOp('get_issue', 'issues', 'read:issue', 'One issue (or pull request seen as an issue) with its body.', REPO_DOC + ', index*:int',
  async function (a, http) {
    var rp = repoPath(a);
    var index = reqInt(a, 'index');
    var r = await http({ path: rp.path + '/issues/' + index });
    return trimIssue(r.data, true);
  });

readOp('list_issue_comments', 'issues', 'read:issue',
  'Comments on an issue or pull request, oldest first. Gitea returns all comments; page/limit slice them here.',
  REPO_DOC + ', index*:int, since?:RFC3339, before?:RFC3339, ' + PAGE_DOC,
  async function (a, http) {
    var rp = repoPath(a);
    var index = reqInt(a, 'index');
    var p = readPaging(a);
    var r = await http({
      path: rp.path + '/issues/' + index + '/comments',
      query: { since: optString(a, 'since', 64), before: optString(a, 'before', 64) },
    });
    var all = Array.isArray(r.data) ? r.data : [];
    var start = (p.page - 1) * p.limit;
    var slice = all.slice(start, start + p.limit);
    var out = listResult(slice, p, {}, trimComment);
    out.total = all.length;
    out.has_more = start + slice.length < all.length;
    return out;
  });

writeOp('create_issue', 'issues', 'write:issue', 'Create an issue.',
  REPO_DOC + ', title*:string, body?:string, labels?:int[] (label ids from list_labels), assignees?:string[] (usernames), milestone?:int (milestone id)',
  function (a, inst) {
    var rp = repoPath(a);
    var title = reqString(a, 'title', 255);
    var body = optString(a, 'body', WRITE_TEXT_MAX);
    var payload = { title: title };
    if (body !== undefined) payload.body = body;
    var labels = intList(a, 'labels', 20);
    if (labels) payload.labels = labels;
    var assignees = stringList(a, 'assignees', 10);
    if (assignees) payload.assignees = assignees;
    var milestone = optInt(a, 'milestone');
    if (milestone) payload.milestone = milestone;
    return {
      request: { method: 'POST', path: rp.path + '/issues', body: payload },
      confirm: {
        body: fitConfirm(function (v) { return t('confirmCreateIssue', v); }, { repo: rp.full, host: inst.host, title: title }, ['title']),
        button: t('buttonCreate'), danger: false,
      },
      shape: function (d) { return { created: true, issue: trimIssue(d || {}, false) }; },
    };
  });

writeOp('comment_issue', 'issues', 'write:issue', 'Add a comment to an issue or pull request.',
  REPO_DOC + ', index*:int (issue or PR number), body*:string',
  function (a, inst) {
    var rp = repoPath(a);
    var index = reqInt(a, 'index');
    var body = reqString(a, 'body', WRITE_TEXT_MAX);
    return {
      request: { method: 'POST', path: rp.path + '/issues/' + index + '/comments', body: { body: body } },
      confirm: {
        body: fitConfirm(function (v) { return t('confirmComment', v); }, { index: index, repo: rp.full, host: inst.host, body: body }, ['body']),
        button: t('buttonComment'), danger: false,
      },
      shape: function (d) { return { created: true, comment: trimComment(d || {}) }; },
    };
  });

writeOp('set_issue_state', 'issues', 'write:issue', 'Close or reopen an issue or pull request.',
  REPO_DOC + ', index*:int, state*:open|closed',
  function (a, inst) {
    var rp = repoPath(a);
    var index = reqInt(a, 'index');
    var state = optEnum(a, 'state', ['open', 'closed']);
    if (!state) throw invalid(t('stateRequired'));
    var closing = state === 'closed';
    return {
      request: { method: 'PATCH', path: rp.path + '/issues/' + index, body: { state: state } },
      confirm: {
        body: t(closing ? 'confirmClose' : 'confirmReopen', { index: index, repo: rp.full, host: inst.host }),
        button: t(closing ? 'buttonClose' : 'buttonReopen'), danger: false,
      },
      shape: function (d) { return { updated: true, issue: trimIssue(d || {}, false) }; },
    };
  });

writeOp('edit_issue_labels', 'issues', 'write:issue',
  'Change labels of an issue or pull request. action add or replace takes labels (ids or names); action remove takes one label_id.',
  REPO_DOC + ', index*:int, action*:add|replace|remove, labels?:(int|string)[] (add/replace; replace with [] clears all), label_id?:int (remove)',
  function (a, inst) {
    var rp = repoPath(a);
    var index = reqInt(a, 'index');
    var action = optEnum(a, 'action', ['add', 'replace', 'remove']);
    if (!action) throw invalid(t('actionRequired'));
    var base = rp.path + '/issues/' + index + '/labels';
    var where = { index: index, repo: rp.full, host: inst.host };
    var shapeLabels = function (d) { return { updated: true, labels: Array.isArray(d) ? d.map(function (l) { return l.name; }) : null }; };
    if (action === 'remove') {
      var id = reqInt(a, 'label_id');
      return {
        request: { method: 'DELETE', path: base + '/' + id },
        confirm: { body: t('confirmRemoveLabel', { id: id, index: where.index, repo: where.repo, host: where.host }), button: t('buttonRemove'), danger: false },
        shape: function () { return { updated: true, removed_label_id: id }; },
      };
    }
    if (!Array.isArray(a.labels)) throw invalid(t('labelsRequired'));
    if (a.labels.length > 20) throw invalid(t('invalidMaxItems', { key: 'labels', max: 20 }));
    if (action === 'add' && !a.labels.length) throw invalid(t('labelsEmpty'));
    var labels = a.labels.map(function (x) {
      var n = toPositiveInt(x);
      if (typeof x === 'number' && n !== null) return n;
      if (typeof x === 'string' && x.trim() && x.length <= 100) return x.trim();
      throw invalid(t('labelsItems'));
    });
    var shown = labels.length ? labels.join(', ') : t('noLabels');
    var labelsKey = action === 'add' ? 'confirmAddLabels' : 'confirmReplaceLabels';
    return {
      request: { method: action === 'add' ? 'POST' : 'PUT', path: base, body: { labels: labels } },
      confirm: {
        body: fitConfirm(function (v) { return t(labelsKey, v); },
          { labels: shown, index: where.index, repo: where.repo, host: where.host },
          [{ name: 'labels', items: labels.map(String) }]),
        button: t(action === 'add' ? 'buttonAdd' : 'buttonReplace'), danger: false,
      },
      shape: shapeLabels,
    };
  });

/* pulls */

readOp('list_pull_requests', 'pulls', 'read:repository', 'Pull requests of a repository.',
  REPO_DOC + ', state?:open|closed|all (default open), sort?:oldest|recentupdate|recentclose|leastupdate|mostcomment|leastcomment|priority, labels?:int[] (label ids), poster?:username, base_branch?:string, milestone?:int, ' + PAGE_DOC,
  async function (a, http) {
    var rp = repoPath(a);
    var p = readPaging(a);
    var r = await http({
      path: rp.path + '/pulls',
      query: {
        state: optEnum(a, 'state', ['open', 'closed', 'all']),
        sort: optEnum(a, 'sort', ['oldest', 'recentupdate', 'recentclose', 'leastupdate', 'mostcomment', 'leastcomment', 'priority']),
        labels: intList(a, 'labels', 20),
        poster: optString(a, 'poster', 100),
        base_branch: optString(a, 'base_branch', 250),
        milestone: optInt(a, 'milestone'),
        page: p.page, limit: p.limit,
      },
    });
    return listResult(r.data, p, r.headers, function (x) { return trimPull(x, false); });
  });

readOp('get_pull_request', 'pulls', 'read:repository', 'One pull request with body, head/base, mergeability and stats.', REPO_DOC + ', index*:int',
  async function (a, http) {
    var rp = repoPath(a);
    var index = reqInt(a, 'index');
    var r = await http({ path: rp.path + '/pulls/' + index });
    return trimPull(r.data, true);
  });

readOp('list_pull_request_files', 'pulls', 'read:repository', 'Files changed by a pull request with line counts.',
  REPO_DOC + ', index*:int, whitespace?:ignore-all|ignore-change|ignore-eol|show-all, ' + PAGE_DOC,
  async function (a, http) {
    var rp = repoPath(a);
    var index = reqInt(a, 'index');
    var p = readPaging(a);
    var r = await http({
      path: rp.path + '/pulls/' + index + '/files',
      query: { whitespace: optEnum(a, 'whitespace', ['ignore-all', 'ignore-change', 'ignore-eol', 'show-all']), page: p.page, limit: p.limit },
    });
    return listResult(r.data, p, r.headers, trimChangedFile);
  });

readOp('get_pull_request_diff', 'pulls', 'read:repository',
  'Unified diff (or patch) of a pull request as text, windowed by offset/max_chars.',
  REPO_DOC + ', index*:int, format?:diff|patch (default diff), offset?:int, max_chars?:1-' + TEXT_MAX_CHARS + ' (default ' + TEXT_DEFAULT_CHARS + ')',
  async function (a, http) {
    var rp = repoPath(a);
    var index = reqInt(a, 'index');
    var format = optEnum(a, 'format', ['diff', 'patch']) || 'diff';
    var win = textWindow(a);
    var r = await http({ path: rp.path + '/pulls/' + index + '.' + format, accept: 'text/plain', text: true });
    var out = windowText(r.text, win, false);
    out.format = format;
    return out;
  });

writeOp('create_pull_request', 'pulls', 'write:repository', 'Open a pull request from head into base.',
  REPO_DOC + ', head*:branch (or "owner:branch" from a fork), base*:branch, title*:string, body?:string, assignees?:string[], labels?:int[], milestone?:int',
  function (a, inst) {
    var rp = repoPath(a);
    var head = reqString(a, 'head', 250);
    var base = reqString(a, 'base', 250);
    var title = reqString(a, 'title', 255);
    var payload = { head: head, base: base, title: title };
    var body = optString(a, 'body', WRITE_TEXT_MAX);
    if (body !== undefined) payload.body = body;
    var assignees = stringList(a, 'assignees', 10);
    if (assignees) payload.assignees = assignees;
    var labels = intList(a, 'labels', 20);
    if (labels) payload.labels = labels;
    var milestone = optInt(a, 'milestone');
    if (milestone) payload.milestone = milestone;
    return {
      request: { method: 'POST', path: rp.path + '/pulls', body: payload },
      confirm: {
        body: fitConfirm(function (v) { return t('confirmCreatePull', v); },
          { repo: rp.full, host: inst.host, head: head, base: base, title: title }, ['title', 'head', 'base']),
        button: t('buttonOpenPr'), danger: false,
      },
      shape: function (d) { return { created: true, pull_request: trimPull(d || {}, false) }; },
    };
  });

writeOp('merge_pull_request', 'pulls', 'write:repository',
  'Merge a pull request. style is required (no default). Pass head_commit_id to refuse merging if the PR changed since you reviewed it.',
  REPO_DOC + ', index*:int, style*:' + MERGE_STYLES.join('|') + ', title?:string, message?:string, delete_branch_after_merge?:bool, head_commit_id?:string (expected head sha)',
  function (a, inst) {
    var rp = repoPath(a);
    var index = reqInt(a, 'index');
    if (a.style === undefined || a.style === null || a.style === '') throw invalid(t('styleRequired', { styles: MERGE_STYLES.join(', ') }));
    var style = optEnum(a, 'style', MERGE_STYLES);
    var payload = { Do: style };
    var title = optString(a, 'title', 255);
    if (title !== undefined) payload.MergeTitleField = title;
    var message = optString(a, 'message', WRITE_TEXT_MAX);
    if (message !== undefined) payload.MergeMessageField = message;
    var del = optBool(a, 'delete_branch_after_merge');
    if (del !== undefined) payload.delete_branch_after_merge = del;
    var head = optString(a, 'head_commit_id', 64);
    if (head !== undefined) {
      if (!/^[0-9a-f]{7,64}$/i.test(head)) throw invalid(t('headCommitInvalid'));
      payload.head_commit_id = head;
    }
    return {
      request: { method: 'POST', path: rp.path + '/pulls/' + index + '/merge', body: payload },
      confirm: {
        body: t(del ? 'confirmMergeDelete' : 'confirmMerge', { index: index, repo: rp.full, host: inst.host, style: style }),
        button: t('buttonMerge'), danger: true,
      },
      shape: function () { return { merged: true, index: index, style: style }; },
    };
  });

/* labels and milestones */

readOp('list_labels', 'labels', 'read:issue', 'Labels of a repository (ids are needed by create_issue and create_pull_request).', REPO_DOC + ', ' + PAGE_DOC,
  async function (a, http) {
    var rp = repoPath(a);
    var p = readPaging(a);
    var r = await http({ path: rp.path + '/labels', query: { page: p.page, limit: p.limit } });
    return listResult(r.data, p, r.headers, trimLabel);
  });

readOp('list_milestones', 'labels', 'read:issue', 'Milestones of a repository.', REPO_DOC + ', state?:open|closed|all, name?:string, ' + PAGE_DOC,
  async function (a, http) {
    var rp = repoPath(a);
    var p = readPaging(a);
    var r = await http({
      path: rp.path + '/milestones',
      query: { state: optEnum(a, 'state', ['open', 'closed', 'all']), name: optString(a, 'name', 200), page: p.page, limit: p.limit },
    });
    return listResult(r.data, p, r.headers, trimMilestone);
  });

/* actions */

readOp('list_workflow_runs', 'actions', 'read:repository', 'Gitea Actions workflow runs of a repository, newest first.',
  REPO_DOC + ', status?:pending|queued|in_progress|failure|success|skipped, branch?:string, event?:string, actor?:username, head_sha?:string, ' + PAGE_DOC,
  async function (a, http) {
    var rp = repoPath(a);
    var p = readPaging(a);
    var r = await http({
      path: rp.path + '/actions/runs',
      query: {
        status: optEnum(a, 'status', ['pending', 'queued', 'in_progress', 'failure', 'success', 'skipped']),
        branch: optString(a, 'branch', 250), event: optString(a, 'event', 100),
        actor: optString(a, 'actor', 100), head_sha: optString(a, 'head_sha', 64),
        page: p.page, limit: p.limit,
      },
    });
    var d = r.data || {};
    var out = listResult(d.workflow_runs, p, {}, trimRun);
    if (typeof d.total_count === 'number') {
      out.total = d.total_count;
      out.has_more = p.page * p.limit < d.total_count;
    }
    return out;
  });

readOp('list_run_jobs', 'actions', 'read:repository', 'Jobs of one workflow run with their steps.',
  REPO_DOC + ', run_id*:int, status?:string, ' + PAGE_DOC,
  async function (a, http) {
    var rp = repoPath(a);
    var run = reqInt(a, 'run_id');
    var p = readPaging(a);
    var r = await http({
      path: rp.path + '/actions/runs/' + run + '/jobs',
      query: { status: optString(a, 'status', 50), page: p.page, limit: p.limit },
    });
    var d = r.data || {};
    var out = listResult(d.jobs, p, {}, trimJob);
    if (typeof d.total_count === 'number') {
      out.total = d.total_count;
      out.has_more = p.page * p.limit < d.total_count;
    }
    return out;
  });

readOp('list_action_tasks', 'actions', 'read:repository', 'Recent Actions tasks (one per job attempt) across all workflows of a repository.',
  REPO_DOC + ', ' + PAGE_DOC,
  async function (a, http) {
    var rp = repoPath(a);
    var p = readPaging(a);
    var r = await http({ path: rp.path + '/actions/tasks', query: { page: p.page, limit: p.limit } });
    var d = r.data || {};
    var out = listResult(d.workflow_runs, p, {}, trimTask);
    if (typeof d.total_count === 'number') {
      out.total = d.total_count;
      out.has_more = p.page * p.limit < d.total_count;
    }
    return out;
  });

readOp('get_job_log', 'actions', 'read:repository',
  'Log text of one Actions job. By default returns the last max_chars characters (where failures usually are); pass offset to read from a position instead.',
  REPO_DOC + ', job_id*:int, offset?:int, max_chars?:1-' + TEXT_MAX_CHARS + ' (default ' + TEXT_DEFAULT_CHARS + ')',
  async function (a, http) {
    var rp = repoPath(a);
    var job = reqInt(a, 'job_id');
    var win = textWindow(a);
    var r = await http({ path: rp.path + '/actions/jobs/' + job + '/logs', accept: 'text/plain', text: true });
    var out = windowText(r.text, win, true);
    out.job_id = job;
    return out;
  });

/* releases */

readOp('list_releases', 'releases', 'read:repository', 'Releases of a repository, newest first.',
  REPO_DOC + ', draft?:bool, pre_release?:bool, ' + PAGE_DOC,
  async function (a, http) {
    var rp = repoPath(a);
    var p = readPaging(a);
    var r = await http({
      path: rp.path + '/releases',
      query: { draft: optBool(a, 'draft'), 'pre-release': optBool(a, 'pre_release'), page: p.page, limit: p.limit },
    });
    return listResult(r.data, p, r.headers, trimRelease);
  });

writeOp('create_release', 'releases', 'write:repository',
  'Create a release. If tag_name does not exist yet, Gitea creates the tag at target_commitish (default branch when omitted).',
  REPO_DOC + ', tag_name*:string, target_commitish?:branch or sha, name?:string, body?:string, draft?:bool, prerelease?:bool',
  function (a, inst) {
    var rp = repoPath(a);
    var tag = reqString(a, 'tag_name', 250);
    var payload = { tag_name: tag };
    var target = optString(a, 'target_commitish', 250);
    if (target !== undefined) payload.target_commitish = target;
    var name = optString(a, 'name', 255);
    if (name !== undefined) payload.name = name;
    var body = optString(a, 'body', WRITE_TEXT_MAX);
    if (body !== undefined) payload.body = body;
    var draft = optBool(a, 'draft');
    if (draft !== undefined) payload.draft = draft;
    var pre = optBool(a, 'prerelease');
    if (pre !== undefined) payload.prerelease = pre;
    var kind = t(draft ? 'kindDraftRelease' : pre ? 'kindPreRelease' : 'kindRelease');
    return {
      request: { method: 'POST', path: rp.path + '/releases', body: payload },
      confirm: {
        body: fitConfirm(function (v) {
          return t(target ? 'confirmReleaseAt' : 'confirmRelease', v) + (v.name ? t('releaseNameLine', v) : '');
        }, { kind: kind, tag: tag, repo: rp.full, host: inst.host, target: target, name: name }, ['name', 'target', 'tag']),
        button: t('buttonCreate'), danger: false,
      },
      shape: function (d) { return { created: true, release: trimRelease(d || {}) }; },
    };
  });

/* notifications */

readOp('list_notifications', 'notifications', 'read:notification', 'Notifications of the token user (unread and pinned by default).',
  'all?:bool (include read), status_types?:("unread"|"read"|"pinned")[], subject_type?:("issue"|"pull"|"commit"|"repository")[], since?:RFC3339, before?:RFC3339, ' + PAGE_DOC,
  async function (a, http) {
    var p = readPaging(a);
    var statusTypes = stringList(a, 'status_types', 3);
    var subjectTypes = stringList(a, 'subject_type', 4);
    (statusTypes || []).forEach(function (s) { if (['unread', 'read', 'pinned'].indexOf(s) < 0) throw invalid(t('statusTypesInvalid')); });
    (subjectTypes || []).forEach(function (s) { if (['issue', 'pull', 'commit', 'repository'].indexOf(s) < 0) throw invalid(t('subjectTypeInvalid')); });
    var r = await http({
      path: '/notifications',
      query: {
        all: optBool(a, 'all'), 'status-types': statusTypes, 'subject-type': subjectTypes,
        since: optString(a, 'since', 64), before: optString(a, 'before', 64),
        page: p.page, limit: p.limit,
      },
    });
    return listResult(r.data, p, r.headers, trimNotification);
  });

/* ── list_tools / call_tool ─────────────────────────────────────────── */

function listTools(args) {
  var category = args && typeof args.category === 'string' ? args.category : '';
  if (!category) {
    var overview = {};
    for (var cat in CATEGORIES) {
      if (Object.prototype.hasOwnProperty.call(CATEGORIES, cat)) overview[cat] = { count: 0, writes: 0, description: CATEGORIES[cat] };
    }
    for (var name in OPS) {
      if (!Object.prototype.hasOwnProperty.call(OPS, name)) continue;
      overview[OPS[name].cat].count++;
      if (OPS[name].write) overview[OPS[name].cat].writes++;
    }
    return {
      categories: overview,
      hint: t('overviewHint'),
    };
  }
  if (!Object.prototype.hasOwnProperty.call(CATEGORIES, category)) {
    throw opError('UNKNOWN_CATEGORY', t('unknownCategory', { category: cleanText(category, 50), categories: Object.keys(CATEGORIES).join(', ') }));
  }
  var tools = [];
  for (var n in OPS) {
    if (!Object.prototype.hasOwnProperty.call(OPS, n) || OPS[n].cat !== category) continue;
    tools.push({ name: n, description: OPS[n].desc, params: OPS[n].params, token_scope: OPS[n].scope, write: OPS[n].write });
  }
  return { category: category, tools: tools, hint: t('categoryHint') };
}

function withParams(err, entry) {
  if (err && err.code === 'INVALID_ARGS') err.message += t('paramsSuffix', { params: entry.params });
  return err;
}

async function confirmWrite(msg, confirm) {
  if (typeof cindy.confirm !== 'function') {
    throw opError('CONFIRM_UNAVAILABLE', t('confirmUnsupported'));
  }
  var spec = {
    body: cleanText(confirm.body, CONFIRM_BODY_MAX - 3),
    confirmText: confirm.button,
    cancelText: t('buttonCancel'),
    danger: confirm.danger === true,
  };
  if (msg && typeof msg.mobilePageId === 'string') spec.mobilePageId = msg.mobilePageId;
  var answer;
  try {
    answer = await cindy.confirm(spec);
  } catch (e) {
    throw opError('CONFIRM_UNAVAILABLE', t('confirmFailedReason', { reason: cleanText(e && e.message ? e.message : String(e), 120) }));
  }
  if (!answer || answer.ok !== true) {
    var reason = answer && (answer.message || answer.errorCode || answer.code);
    throw opError('CONFIRM_UNAVAILABLE', reason
      ? t('confirmUnavailableReason', { reason: cleanText(reason, 120) })
      : t('confirmUnavailable'));
  }
  if (answer.confirmed !== true) {
    throw opError('CONFIRM_DECLINED', t('confirmDeclined'));
  }
}

async function callTool(args, msg) {
  var name = typeof args.name === 'string' ? args.name : '';
  if (!name) throw opError('INVALID_ARGS', t('nameRequired'));
  if (!Object.prototype.hasOwnProperty.call(OPS, name)) {
    throw opError('UNKNOWN_OPERATION', t('unknownOperation', { name: cleanText(name, 64), categories: Object.keys(CATEGORIES).join(', ') }));
  }
  var entry = OPS[name];
  var a = args.args && typeof args.args === 'object' && !Array.isArray(args.args) ? args.args : {};
  var inst = await resolveInstance(a, entry.write);
  var ctx = { host: inst.host, callId: msg.callId, write: entry.write, scope: entry.scope };

  if (!entry.write) {
    var result;
    try {
      result = await entry.run(a, function (spec) { return request(ctx, spec); });
    } catch (e) {
      throw withParams(e, entry);
    }
    var size = JSON.stringify(result === undefined ? null : result).length;
    if (size > RESULT_MAX_CHARS) {
      throw opError('OUTPUT_TOO_LARGE', t('resultTooLarge', { size: size, max: RESULT_MAX_CHARS }));
    }
    return { instance: inst.host, data: result };
  }

  var plan;
  try {
    plan = entry.prepare(a, inst);
  } catch (e) {
    throw withParams(e, entry);
  }
  await confirmWrite(msg, plan.confirm);
  var r = await request(ctx, plan.request);
  var shaped;
  try {
    shaped = plan.shape(r.data);
  } catch (e) {
    shaped = { executed: true, note: t('writeUnsummarized', { status: r.status }) };
  }
  return { instance: inst.host, data: shaped };
}

/* ── settings page connection test (BroadcastChannel) ───────────────── */

if (typeof BroadcastChannel === 'function') {
  var channel = new BroadcastChannel(CHANNEL_NAME);
  var seenTests = {};
  channel.onmessage = function (ev) {
    var m = ev && ev.data;
    if (!m || m.type !== 'test-connection' || !m.reqId) return;
    if (seenTests[m.reqId]) return;
    if (Object.keys(seenTests).length > 200) seenTests = {};
    seenTests[m.reqId] = 1;
    void (async function () {
      var reply = { type: 'test-connection-result', reqId: m.reqId, ok: false };
      await ensureLocale();
      try {
        var inst = await resolveInstance(m.connectionId ? { instance: m.connectionId } : {}, false);
        var r = await request({ host: inst.host, write: false, scope: 'read:user' }, { path: '/user' });
        var user = (r.data && r.data.login) || '';
        try {
          var kv = await (await fetch('/kv')).json();
          kv = kv && typeof kv === 'object' ? kv : {};
          var users = kv.connectedUsers && typeof kv.connectedUsers === 'object' ? kv.connectedUsers : {};
          users[inst.id] = user;
          kv.connectedUsers = users;
          await fetch('/kv', { method: 'PUT', body: JSON.stringify(kv) });
        } catch (e) {
          /* The cached login only decorates the settings list. */
        }
        reply = { type: 'test-connection-result', reqId: m.reqId, ok: true, username: user, host: inst.host };
      } catch (e) {
        reply.message = e && e.safe ? e.message : t('connectionTestFailed');
      }
      channel.postMessage(reply);
    })();
  };
}

/* ── dispatch ───────────────────────────────────────────────────────── */

cindy.onHostMessage(async function (msg) {
  if (!msg) return;
  if (msg.type === 'host-context-changed') {
    hostLocale = resolveLocale(msg.context && msg.context.locale);
    return;
  }
  if (msg.type !== 'tool-call') return;
  await ensureLocale();
  var reply;
  try {
    var result;
    if (msg.tool === 'list_tools') {
      result = listTools(msg.args || {});
    } else if (msg.tool === 'call_tool') {
      result = await callTool(msg.args || {}, msg);
    } else {
      throw opError('UNKNOWN_TOOL', t('unknownTool', { tool: cleanText(msg.tool, 64) }));
    }
    reply = { type: 'tool-result', callId: msg.callId, ok: true, result: result };
  } catch (e) {
    var safe = e && e.safe;
    reply = {
      type: 'tool-result',
      callId: msg.callId,
      ok: false,
      errorCode: safe ? e.code : 'INTERNAL_ERROR',
      message: safe ? e.message : t('unexpectedError', { detail: cleanText(redact(e && e.message ? e.message : String(e)), 200) }),
    };
  }
  await cindy.send(reply);
});
