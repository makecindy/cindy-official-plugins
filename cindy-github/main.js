/**
 * GitHub · 电子脑 —— 内置的 GitHub 服务意识(PAT 模式,仅 github.com)。
 *
 * id/指令保留 cindy- 官方命名空间；显示名直接使用 GitHub。
 *
 * 工作方式:
 * - 域名白名单代发:cindy.fetch 只能到 ghost.json 声明的域名,请求由主机代发,
 *   沙箱零直连;PAT 由主机保险库保管,只注入 api.github.com 的 Authorization,
 *   本文件没有也不可能有任何 token 字节;
 * - 工具面 = 两段式目录(FORGE_GUIDE §3.5):只声明 list_tools / call_tool 两个
 *   元工具,117 个操作按 15 个类目放在本文件的 OPS 表里——与老 lizi_github MCP
 *   的渐进式外形一致,主 agent 零学习成本;改工具只更新意识、不发应用版本;
 * - repo 级操作必须显式传 owner/repo:沙箱无文件系统,不能像老 MCP 那样从会话
 *   workdir 的 git remote 推导,由主 agent 自己推导后传入;
 * - 交卷护栏:默认递归剥掉 GitHub 响应里的 API 链接字段(url / *_url,保留
 *   html_url)压体量;超 50KB(或调用方点名 out_file)时经 fs 槽把完整 JSON 写进
 *   会话工作目录只交路径——老 MCP out_file 泄洪的等价回归(2026-07 fs 槽上线后),
 *   写盘不可用(plan 模式 / SSH 远程工作区)才回落截断;call_tool 传 raw=true
 *   拿原样 JSON(写盘内容与内联同口径,raw 决定剥不剥);
 * - Actions 产物 / 日志 zip:老 MCP 只返回 302 签名地址,这里升级为真下载落盘
 *   (as:'file' + save_dir 票据;GitHub 的下载跳转域已进白名单)。
 */

/* global cindy */

var API = 'https://api.github.com';
/** 交卷体量护栏(与 xd-atlassian 同款)。 */
var RESULT_MAX_CHARS = 50 * 1000;

/* ── 宿主语言(只跟随宿主 app-context / host-context-changed)──────────────
 * 运行时文案与 list_tools 第二段目录按宿主语言输出:zh-CN / en / ja / ko;不读浏览器
 * 或操作系统语言,宿主语言不在表内或取不到时回退英文(docs/localization.md)。
 * 操作名、类目名、参数名、枚举值是稳定协议,不翻译。
 * ──────────────────────────────────────────────────────────────────── */

var LOCALE_FALLBACK = 'en';
/* null = 尚未从宿主拿到语言;此时按英文回退,下次调用再取。 */
var hostLocale = null;
var localeRequest = null;

function normalizeLocale(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MESSAGES, value) ? value : LOCALE_FALLBACK;
}

function currentLocale() {
  return hostLocale || LOCALE_FALLBACK;
}

async function requestHostLocale() {
  if (typeof cindy.request !== 'function') return null;
  var timer = null;
  try {
    // 宿主不回应时不能卡住工具调用:3 秒取不到就按英文,下次调用再试。
    var r = await Promise.race([
      cindy.request({ kind: 'app-context' }),
      new Promise(function (resolve) { timer = setTimeout(function () { resolve(null); }, 3000); }),
    ]);
    var locale = r && r.ok && r.context && r.context.locale;
    return typeof locale === 'string' ? normalizeLocale(locale) : null;
  } catch (e) {
    return null;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/* 并发的 tool-call 共享同一个请求;成功后缓存,之后靠 host-context-changed 更新。 */
function ensureLocale() {
  if (hostLocale) return Promise.resolve(hostLocale);
  if (!localeRequest) {
    localeRequest = requestHostLocale().then(function (locale) {
      localeRequest = null;
      // 请求途中若已收到 host-context-changed,以事件里的新语言为准。
      if (!hostLocale && locale) hostLocale = locale;
      return currentLocale();
    });
  }
  return localeRequest;
}

var MESSAGES = {
  'zh-CN': {
    status401: 'GitHub 授权未配置或已失效，请到「插件」→「GitHub」详情页重新连接账号，或更换备用 Token',
    status403RateLimit: 'GitHub 接口限流(HTTP 403 rate limit),请稍后重试',
    status403: '此操作没有权限(HTTP 403)，请检查仓库访问权及授权范围；账号的其他功能可能仍可使用：{detail}',
    status404: '对象不存在或无访问权(HTTP 404)',
    status422: 'GitHub 拒绝了请求参数(HTTP 422):{detail}',
    status429: 'GitHub 接口限流(HTTP 429),请稍后重试',
    statusOther: 'GitHub API 返回 HTTP {status}:{detail}',
    graphqlError: 'GitHub GraphQL 错误:{detail}',
    graphqlNoData: 'GitHub GraphQL 响应缺少 data',
    spillSaved: '完整结果已写入会话工作目录的该相对路径,用文件工具读取或交给脚本处理',
    spillFailedWithReason: '落盘未成功({reason})',
    spillFailed: '落盘未成功',
    truncated: '响应过大已截断——用 per_page / page 分页,或换更窄的操作(如 get 单条)',
    truncatedAfterNote: '{note};响应过大已截断——用 per_page / page 分页,或换更窄的操作(如 get 单条)',
    repoRequired: 'repo 级操作必须显式传 owner 与 repo(在 git 仓库里工作时,主 agent 可用 `git remote get-url origin` 推导后传入)',
    saveDirRequired: '下载需要落盘目录——请主 agent 调 ghost_call 时把目标目录绝对路径放在顶层 save_dir 参数',
    downloadedTo: '已存到 {path}',
    required: '需要 {fields}',
    requiredTreeEntries: '需要 tree(条目数组)',
    requiredThreadId: '需要 thread_id(list_pull_request_review_threads 可查)',
    requiredRefExample: '需要 ref(如 heads/main)',
    requiredNamesNonEmpty: '需要 names(至少一个)',
    requiredNamesArray: '需要 names(数组,可为空)',
    requiredLine: 'LINE 级评论需要 line',
    noDefaultBranch: '取不到仓库默认分支',
    noStartSha: '取不到起点分支的 sha',
    noHeadSha: '取不到分支 head sha',
    noBaseTree: '取不到 head commit 的 base tree,拒绝继续(避免建出丢失其余文件的孤儿树)',
    filesEntryFields: 'files 每项需要 path / content',
    filesEncoding: 'files[].encoding 只认 utf-8 / base64,收到:{value}',
    overviewHint: '传 category 看该类目下的操作明细;执行用 call_tool({name, args})。repo 级操作必须显式传 owner/repo。',
    categoryHint: '执行用 call_tool({name, args});参数记法:* 必填,pp = per_page/page。',
    unknownCategory: '未知类目:{category}(可用:{available})',
    requiredName: '需要 name(list_tools 可查)',
    unknownOperation: '未知操作:{name}——用 list_tools 查目录(类目:{categories})',
    withOperationParams: '{error}\n该操作参数:{params}',
    unknownTool: '未知工具:{tool}',
    toolFailed: 'GitHub 工具执行失败:{detail}',
    testFailedNotify: 'GitHub 连接测试失败:{detail}',
    testSucceededNotify: '连接成功:@{login}',
    prAskTitle: '要发 PR 吗？',
    prCommitOne: '1 个提交',
    prCommitMany: '{count} 个提交',
    prFileOne: '1 个文件',
    prFileMany: '{count} 个文件',
    prPublish: '发 PR',
    prPublishDraft: '发成草稿',
    prPublishingTitle: '正在发 PR',
    prPublishingDraftTitle: '正在发草稿 PR',
    prPublishingMeta: '已交给 Agent，完成后这里会更新',
    prQueuedMeta: '已排队，当前回复结束后开始',
    prStateOpen: '已发布',
    prStateDraft: '草稿',
    prStateFollowing: '跟进中',
    prStateMerged: '已合并',
    prStateClosed: '已关闭',
    prFollowEnded: '跟进已结束',
    prFollow: '跟进到合并',
    prFollowStarting: '正在开启跟进',
    prStop: '停止',
    prStopping: '正在停止跟进',
    prSettings: 'PR 设置',
    prHideSettings: '收起 PR 设置',
    prAutoRename: '发完自动改名',
    prAutoRenameHint: '任务标题改成 PR 号和标题',
    prAutoFollow: '发完自动跟进',
    prAutoFollowHint: '后台修 CI 和 review 意见，需要你时再通知',
    prTurnOn: '开启「{name}」',
    prTurnOff: '关闭「{name}」',
    prCiPassed: 'CI 通过',
    prCiFailed: 'CI 未通过',
    prCiRunning: 'CI 运行中',
    prThreadsOpen: '{count} 条意见待处理',
    prThreadsNone: '没有待处理意见',
    prMergeReady: '可以合并',
    prMergeConflict: '有冲突',
    prMergeBehind: '需要同步 {base}',
    prMergeApproval: '等待审批',
    prMergeChanges: '需要修改',
    prMergeWaiting: '等待合并',
    prHandoffFailed: '没能交给 Agent，请直接在对话里告诉它',
    prHandoffUnknown: '不确定是否已交给 Agent，请先看对话，不要重复点',
    prSettingFailed: '设置没有保存，请稍后再试',
    prNeedRepo: '需要 repo(owner/repo 形式)',
    prNeedHead: '询问卡片需要 head(改动所在的分支)',
    prBadPr: 'pr 需要是 GitHub PR 链接或编号',
    prBadCardId: 'card_id 无效',
    prCardNotFound: '找不到 card_id 对应的卡片，已新建一张',
    prFetchFailed: '读取 PR 信息失败({detail})，卡片按已知信息显示',
    prNextAsk: '卡片已显示。等用户点击或在对话里答复，不要再用文字重复询问；点击会以本插件代发的消息送达。创建 PR 后用 card_id 和 pr 再调用 pr_card，renamed / following 只填已经完成的动作。',
    prNextApply: '卡片设置要求发完后做 todo 里的事。做完还没做的，再用 card_id 调用 pr_card，带上 renamed / following。',
    prNextUpdated: '卡片已更新。',
    prTodoRename: '用 cindy_helper 的 set_current_session_title 把当前任务改名为「{title}」',
    prTodoFollow: '按 pr 技能开始后台跟进 {url}',
    prClickPublish: '用户在 PR 卡片上点了「发 PR」。按 pr 技能现在提交、推送并创建这个 PR(ready for review)；创建后按事件里的 settings 处理改名和跟进，再用 card_id 调用 pr_card 更新卡片。',
    prClickPublishDraft: '用户在 PR 卡片上点了「发成草稿」。按 pr 技能现在提交、推送并创建 draft PR；创建后按事件里的 settings 处理改名，再用 card_id 调用 pr_card 更新卡片。',
    prClickFollow: '用户在 PR 卡片上点了「跟进到合并」。按 pr 技能开始后台跟进 {url}，再用 card_id 调用 pr_card，following=true。',
    prClickStop: '用户在 PR 卡片上点了「停止」跟进。删除 {url} 的跟进定时任务，再用 card_id 调用 pr_card，following=false。',
  },
  en: {
    status401: 'GitHub authorization is missing or expired. Open Plugins > GitHub details to reconnect your account, or replace the fallback token.',
    status403RateLimit: 'GitHub API rate limit hit (HTTP 403 rate limit). Try again later.',
    status403: 'No permission for this operation (HTTP 403). Check repository access and authorization scopes; other features of the account may still work: {detail}',
    status404: 'Not found or no access (HTTP 404)',
    status422: 'GitHub rejected the request parameters (HTTP 422): {detail}',
    status429: 'GitHub API rate limit hit (HTTP 429). Try again later.',
    statusOther: 'GitHub API returned HTTP {status}: {detail}',
    graphqlError: 'GitHub GraphQL error: {detail}',
    graphqlNoData: 'GitHub GraphQL response has no data',
    spillSaved: 'Full result written to this path relative to the session work directory; read it with a file tool or hand it to a script',
    spillFailedWithReason: 'Writing to disk failed ({reason})',
    spillFailed: 'Writing to disk failed',
    truncated: 'Response too large and truncated. Paginate with per_page / page, or use a narrower operation (such as a single-item get)',
    truncatedAfterNote: '{note}; response too large and truncated. Paginate with per_page / page, or use a narrower operation (such as a single-item get)',
    repoRequired: 'Repo-level operations require explicit owner and repo (when working in a git repository, the main agent can derive them from `git remote get-url origin` and pass them in)',
    saveDirRequired: 'Download needs a destination directory: the main agent must pass the absolute path of the target directory in the top-level save_dir parameter of ghost_call',
    downloadedTo: 'Saved to {path}',
    required: 'Required: {fields}',
    requiredTreeEntries: 'Required: tree (array of entries)',
    requiredThreadId: 'Required: thread_id (see list_pull_request_review_threads)',
    requiredRefExample: 'Required: ref (e.g. heads/main)',
    requiredNamesNonEmpty: 'Required: names (at least one)',
    requiredNamesArray: 'Required: names (array, may be empty)',
    requiredLine: 'Required for LINE-level comments: line',
    noDefaultBranch: 'Could not get the repo default branch',
    noStartSha: 'Could not get the sha of the starting branch',
    noHeadSha: 'Could not get the branch head sha',
    noBaseTree: 'Could not get the base tree of the head commit; refusing to continue (to avoid an orphan tree that drops every other file)',
    filesEntryFields: 'Each files entry requires path / content',
    filesEncoding: 'files[].encoding accepts only utf-8 / base64, got: {value}',
    overviewHint: 'Pass category to see the operations in it; run one with call_tool({name, args}). Repo-level operations require explicit owner/repo.',
    categoryHint: 'Run with call_tool({name, args}); parameter notation: * = required, pp = per_page/page.',
    unknownCategory: 'Unknown category: {category} (available: {available})',
    requiredName: 'Required: name (see list_tools)',
    unknownOperation: 'Unknown operation: {name}. Use list_tools to browse the catalog (categories: {categories})',
    withOperationParams: '{error}\nParameters for this operation: {params}',
    unknownTool: 'Unknown tool: {tool}',
    toolFailed: 'GitHub tool failed: {detail}',
    testFailedNotify: 'GitHub connection test failed: {detail}',
    testSucceededNotify: 'Connected: @{login}',
    prAskTitle: 'Open a pull request?',
    prCommitOne: '1 commit',
    prCommitMany: '{count} commits',
    prFileOne: '1 file',
    prFileMany: '{count} files',
    prPublish: 'Open PR',
    prPublishDraft: 'Open as draft',
    prPublishingTitle: 'Opening the pull request',
    prPublishingDraftTitle: 'Opening a draft pull request',
    prPublishingMeta: 'Handed to the agent. This card updates when it is done.',
    prQueuedMeta: 'Queued. It starts after the current reply.',
    prStateOpen: 'Open',
    prStateDraft: 'Draft',
    prStateFollowing: 'Following',
    prStateMerged: 'Merged',
    prStateClosed: 'Closed',
    prFollowEnded: 'Following ended',
    prFollow: 'Follow until merged',
    prFollowStarting: 'Starting to follow',
    prStop: 'Stop',
    prStopping: 'Stopping',
    prSettings: 'PR settings',
    prHideSettings: 'Hide PR settings',
    prAutoRename: 'Rename after opening',
    prAutoRenameHint: 'Retitle the task with the PR number and title',
    prAutoFollow: 'Follow after opening',
    prAutoFollowHint: 'Fix CI and review feedback in the background and notify you only when needed',
    prTurnOn: 'Turn on "{name}"',
    prTurnOff: 'Turn off "{name}"',
    prCiPassed: 'CI passed',
    prCiFailed: 'CI failed',
    prCiRunning: 'CI running',
    prThreadsOpen: 'Open review threads: {count}',
    prThreadsNone: 'No open review threads',
    prMergeReady: 'Ready to merge',
    prMergeConflict: 'Has conflicts',
    prMergeBehind: 'Behind {base}',
    prMergeApproval: 'Waiting for approval',
    prMergeChanges: 'Changes requested',
    prMergeWaiting: 'Waiting to merge',
    prHandoffFailed: 'Could not hand this to the agent. Tell it in the conversation instead.',
    prHandoffUnknown: 'Not sure the agent received this. Check the conversation before clicking again.',
    prSettingFailed: 'The setting was not saved. Try again later.',
    prNeedRepo: 'repo is required (owner/repo)',
    prNeedHead: 'An ask card needs head (the branch with the changes)',
    prBadPr: 'pr must be a GitHub pull request URL or number',
    prBadCardId: 'Invalid card_id',
    prCardNotFound: 'No card matches card_id, so a new one was created',
    prFetchFailed: 'Could not read the pull request ({detail}); the card shows what is known',
    prNextAsk: 'The card is shown. Wait for the user to click or answer in the conversation, and do not ask again in text; clicks arrive as messages sent by this plugin. After creating the PR, call pr_card again with card_id and pr; set renamed / following only for actions already done.',
    prNextApply: 'The card settings ask for the todo items after opening. Do any not done yet, then call pr_card with card_id, renamed and following.',
    prNextUpdated: 'Card updated.',
    prTodoRename: 'Rename the current task to "{title}" with cindy_helper set_current_session_title',
    prTodoFollow: 'Start following {url} in the background with the pr Skill',
    prClickPublish: 'The user clicked "Open PR" on the PR card. Commit, push and open this pull request now with the pr Skill (ready for review); afterwards handle renaming and following as the event settings say, then call pr_card with card_id to update the card.',
    prClickPublishDraft: 'The user clicked "Open as draft" on the PR card. Commit, push and open a draft pull request now with the pr Skill; afterwards handle renaming as the event settings say, then call pr_card with card_id to update the card.',
    prClickFollow: 'The user clicked "Follow until merged" on the PR card. Start following {url} in the background with the pr Skill, then call pr_card with card_id and following=true.',
    prClickStop: 'The user clicked "Stop" following on the PR card. Delete the follow-up schedule for {url}, then call pr_card with card_id and following=false.',
  },
  ja: {
    status401: 'GitHub の認証が未設定か期限切れです。「プラグイン」→「GitHub」の詳細ページでアカウントを再接続するか、予備トークンを差し替えてください。',
    status403RateLimit: 'GitHub API のレート制限に達しました(HTTP 403 rate limit)。しばらくしてから再試行してください。',
    status403: 'この操作の権限がありません(HTTP 403)。リポジトリへのアクセス権と認可スコープを確認してください。アカウントのほかの機能は引き続き使える場合があります: {detail}',
    status404: '対象が存在しないか、アクセス権がありません(HTTP 404)',
    status422: 'GitHub がリクエストのパラメータを拒否しました(HTTP 422): {detail}',
    status429: 'GitHub API のレート制限に達しました(HTTP 429)。しばらくしてから再試行してください。',
    statusOther: 'GitHub API が HTTP {status} を返しました: {detail}',
    graphqlError: 'GitHub GraphQL エラー: {detail}',
    graphqlNoData: 'GitHub GraphQL のレスポンスに data がありません',
    spillSaved: '完全な結果をセッション作業ディレクトリのこの相対パスに書き込みました。ファイルツールで読むか、スクリプトに渡してください',
    spillFailedWithReason: 'ディスクへの書き込みに失敗しました({reason})',
    spillFailed: 'ディスクへの書き込みに失敗しました',
    truncated: 'レスポンスが大きすぎるため切り詰めました。per_page / page でページングするか、より範囲の狭い操作(1 件だけの get など)を使ってください',
    truncatedAfterNote: '{note}。レスポンスが大きすぎるため切り詰めました。per_page / page でページングするか、より範囲の狭い操作(1 件だけの get など)を使ってください',
    repoRequired: 'リポジトリ単位の操作では owner と repo を明示的に渡す必要があります(git リポジトリ内で作業している場合、メイン agent は `git remote get-url origin` から導出して渡せます)',
    saveDirRequired: 'ダウンロードには保存先ディレクトリが必要です。メイン agent が ghost_call を呼ぶとき、保存先ディレクトリの絶対パスをトップレベルの save_dir パラメータに入れてください',
    downloadedTo: '{path} に保存しました',
    required: '必須パラメータ: {fields}',
    requiredTreeEntries: '必須パラメータ: tree(エントリの配列)',
    requiredThreadId: '必須パラメータ: thread_id(list_pull_request_review_threads で確認できます)',
    requiredRefExample: '必須パラメータ: ref(例: heads/main)',
    requiredNamesNonEmpty: '必須パラメータ: names(1 つ以上)',
    requiredNamesArray: '必須パラメータ: names(配列。空でも可)',
    requiredLine: 'LINE 単位のコメントには line が必要です',
    noDefaultBranch: 'リポジトリの既定ブランチを取得できませんでした',
    noStartSha: '起点ブランチの sha を取得できませんでした',
    noHeadSha: 'ブランチの head sha を取得できませんでした',
    noBaseTree: 'head commit の base tree を取得できないため、処理を中止しました(ほかのファイルがすべて失われる孤立した tree を作らないため)',
    filesEntryFields: 'files の各項目には path / content が必要です',
    filesEncoding: 'files[].encoding は utf-8 / base64 のみ対応しています。受け取った値: {value}',
    overviewHint: 'category を渡すとそのカテゴリの操作の詳細を確認できます。実行は call_tool({name, args}) で行います。リポジトリ単位の操作では owner/repo を明示的に渡してください。',
    categoryHint: '実行は call_tool({name, args}) で行います。パラメータ表記: * は必須、pp = per_page/page。',
    unknownCategory: '不明なカテゴリ: {category}(利用可能: {available})',
    requiredName: '必須パラメータ: name(list_tools で確認できます)',
    unknownOperation: '不明な操作: {name}。list_tools でカタログを確認してください(カテゴリ: {categories})',
    withOperationParams: '{error}\nこの操作のパラメータ: {params}',
    unknownTool: '不明なツール: {tool}',
    toolFailed: 'GitHub ツールの実行に失敗しました: {detail}',
    testFailedNotify: 'GitHub 接続テストに失敗しました: {detail}',
    testSucceededNotify: '接続しました: @{login}',
    prAskTitle: 'PR を作成しますか？',
    prCommitOne: '1 件のコミット',
    prCommitMany: '{count} 件のコミット',
    prFileOne: '1 個のファイル',
    prFileMany: '{count} 個のファイル',
    prPublish: 'PR を作成',
    prPublishDraft: '下書きで作成',
    prPublishingTitle: 'PR を作成しています',
    prPublishingDraftTitle: '下書き PR を作成しています',
    prPublishingMeta: 'エージェントに渡しました。完了するとこのカードが更新されます',
    prQueuedMeta: 'キューに追加しました。現在の返信が終わると始まります',
    prStateOpen: '公開済み',
    prStateDraft: '下書き',
    prStateFollowing: 'フォロー中',
    prStateMerged: 'マージ済み',
    prStateClosed: 'クローズ済み',
    prFollowEnded: 'フォロー終了',
    prFollow: 'マージまでフォロー',
    prFollowStarting: 'フォローを開始しています',
    prStop: 'フォロー停止',
    prStopping: 'フォローを停止しています',
    prSettings: 'PR 設定',
    prHideSettings: 'PR 設定を閉じる',
    prAutoRename: '作成後に自動で改名',
    prAutoRenameHint: 'タスク名を PR 番号とタイトルに変更します',
    prAutoFollow: '作成後に自動でフォロー',
    prAutoFollowHint: 'バックグラウンドで CI とレビュー指摘を直し、必要なときだけ通知します',
    prTurnOn: '「{name}」をオン',
    prTurnOff: '「{name}」をオフ',
    prCiPassed: 'CI 成功',
    prCiFailed: 'CI 失敗',
    prCiRunning: 'CI 実行中',
    prThreadsOpen: '未解決のレビュー {count} 件',
    prThreadsNone: '未解決のレビューなし',
    prMergeReady: 'マージ可能',
    prMergeConflict: 'コンフリクトあり',
    prMergeBehind: '{base} との同期が必要',
    prMergeApproval: '承認待ち',
    prMergeChanges: '修正依頼あり',
    prMergeWaiting: 'マージ待ち',
    prHandoffFailed: 'エージェントに渡せませんでした。会話で直接伝えてください',
    prHandoffUnknown: 'エージェントに届いたか分かりません。もう一度押す前に会話を確認してください',
    prSettingFailed: '設定を保存できませんでした。しばらくしてから再試行してください',
    prNeedRepo: 'repo(owner/repo 形式)が必要です',
    prNeedHead: '確認カードには head(変更のあるブランチ)が必要です',
    prBadPr: 'pr には GitHub の PR URL か番号を指定してください',
    prBadCardId: 'card_id が無効です',
    prCardNotFound: 'card_id に対応するカードがないため、新しく作成しました',
    prFetchFailed: 'PR 情報を取得できませんでした({detail})。分かっている情報でカードを表示します',
    prNextAsk: 'カードを表示しました。ユーザーのクリックか会話での返答を待ち、テキストで重ねて確認しないでください。クリックはこのプラグインが送るメッセージとして届きます。PR を作成したら card_id と pr を付けて pr_card を再度呼び、renamed / following には完了済みの操作だけを指定してください。',
    prNextApply: 'カード設定により、作成後に todo の操作が必要です。未完了のものを済ませてから、card_id・renamed・following を付けて pr_card を呼んでください。',
    prNextUpdated: 'カードを更新しました。',
    prTodoRename: 'cindy_helper の set_current_session_title で現在のタスク名を「{title}」に変更する',
    prTodoFollow: 'pr スキルで {url} のバックグラウンドフォローを開始する',
    prClickPublish: 'ユーザーが PR カードの「PR を作成」を押しました。pr スキルに従って今すぐコミット・プッシュし、この PR をレビュー可能な状態で作成してください。作成後はイベントの settings に従って改名とフォローを処理し、card_id を付けて pr_card でカードを更新してください。',
    prClickPublishDraft: 'ユーザーが PR カードの「下書きで作成」を押しました。pr スキルに従って今すぐコミット・プッシュし、下書き PR を作成してください。作成後はイベントの settings に従って改名を処理し、card_id を付けて pr_card でカードを更新してください。',
    prClickFollow: 'ユーザーが PR カードの「マージまでフォロー」を押しました。pr スキルで {url} のバックグラウンドフォローを開始し、card_id と following=true を付けて pr_card を呼んでください。',
    prClickStop: 'ユーザーが PR カードの「フォロー停止」を押しました。{url} のフォロー用スケジュールを削除し、card_id と following=false を付けて pr_card を呼んでください。',
  },
  ko: {
    status401: 'GitHub 인증이 설정되지 않았거나 만료되었습니다. ‘플러그인’ > ‘GitHub’ 상세 페이지에서 계정을 다시 연결하거나 예비 토큰을 교체하세요.',
    status403RateLimit: 'GitHub API 요청 한도에 도달했습니다(HTTP 403 rate limit). 잠시 후 다시 시도하세요.',
    status403: '이 작업에 대한 권한이 없습니다(HTTP 403). 저장소 접근 권한과 인증 범위를 확인하세요. 계정의 다른 기능은 계속 사용할 수 있을 수 있습니다: {detail}',
    status404: '대상이 없거나 접근 권한이 없습니다(HTTP 404)',
    status422: 'GitHub가 요청 파라미터를 거부했습니다(HTTP 422): {detail}',
    status429: 'GitHub API 요청 한도에 도달했습니다(HTTP 429). 잠시 후 다시 시도하세요.',
    statusOther: 'GitHub API가 HTTP {status}를 반환했습니다: {detail}',
    graphqlError: 'GitHub GraphQL 오류: {detail}',
    graphqlNoData: 'GitHub GraphQL 응답에 data가 없습니다',
    spillSaved: '전체 결과를 세션 작업 디렉터리의 이 상대 경로에 기록했습니다. 파일 도구로 읽거나 스크립트에 넘기세요',
    spillFailedWithReason: '디스크에 기록하지 못했습니다({reason})',
    spillFailed: '디스크에 기록하지 못했습니다',
    truncated: '응답이 너무 커서 잘렸습니다. per_page / page로 페이지를 나누거나 범위가 더 좁은 작업(단건 get 등)을 사용하세요',
    truncatedAfterNote: '{note}. 응답이 너무 커서 잘렸습니다. per_page / page로 페이지를 나누거나 범위가 더 좁은 작업(단건 get 등)을 사용하세요',
    repoRequired: '저장소 단위 작업에는 owner와 repo를 명시적으로 전달해야 합니다(git 저장소에서 작업 중이면 메인 agent가 `git remote get-url origin`으로 알아내 전달할 수 있음)',
    saveDirRequired: '다운로드하려면 저장할 디렉터리가 필요합니다. 메인 agent가 ghost_call을 호출할 때 대상 디렉터리의 절대 경로를 최상위 save_dir 파라미터에 넣어야 합니다',
    downloadedTo: '{path}에 저장했습니다',
    required: '필수 파라미터: {fields}',
    requiredTreeEntries: '필수 파라미터: tree(항목 배열)',
    requiredThreadId: '필수 파라미터: thread_id(list_pull_request_review_threads로 확인 가능)',
    requiredRefExample: '필수 파라미터: ref(예: heads/main)',
    requiredNamesNonEmpty: '필수 파라미터: names(하나 이상)',
    requiredNamesArray: '필수 파라미터: names(배열, 비어 있어도 됨)',
    requiredLine: 'LINE 단위 댓글에는 line이 필요합니다',
    noDefaultBranch: '저장소 기본 브랜치를 가져오지 못했습니다',
    noStartSha: '시작 브랜치의 sha를 가져오지 못했습니다',
    noHeadSha: '브랜치 head sha를 가져오지 못했습니다',
    noBaseTree: 'head commit의 base tree를 가져오지 못해 진행을 중단했습니다(나머지 파일이 모두 사라지는 고아 tree 생성을 막기 위해)',
    filesEntryFields: 'files의 각 항목에는 path / content가 필요합니다',
    filesEncoding: 'files[].encoding은 utf-8 / base64만 허용합니다. 받은 값: {value}',
    overviewHint: 'category를 전달하면 해당 카테고리의 작업 상세를 볼 수 있습니다. 실행은 call_tool({name, args})로 합니다. 저장소 단위 작업에는 owner/repo를 명시적으로 전달해야 합니다.',
    categoryHint: '실행은 call_tool({name, args})로 합니다. 파라미터 표기: * = 필수, pp = per_page/page.',
    unknownCategory: '알 수 없는 카테고리: {category}(사용 가능: {available})',
    requiredName: '필수 파라미터: name(list_tools로 확인 가능)',
    unknownOperation: '알 수 없는 작업: {name}. list_tools로 목록을 확인하세요(카테고리: {categories})',
    withOperationParams: '{error}\n이 작업의 파라미터: {params}',
    unknownTool: '알 수 없는 도구: {tool}',
    toolFailed: 'GitHub 도구 실행에 실패했습니다: {detail}',
    testFailedNotify: 'GitHub 연결 테스트에 실패했습니다: {detail}',
    testSucceededNotify: '연결되었습니다: @{login}',
    prAskTitle: 'PR을 만들까요?',
    prCommitOne: '커밋 1개',
    prCommitMany: '커밋 {count}개',
    prFileOne: '파일 1개',
    prFileMany: '파일 {count}개',
    prPublish: 'PR 만들기',
    prPublishDraft: '초안으로 만들기',
    prPublishingTitle: 'PR을 만드는 중',
    prPublishingDraftTitle: '초안 PR을 만드는 중',
    prPublishingMeta: '에이전트에게 맡겼습니다. 끝나면 이 카드가 업데이트됩니다',
    prQueuedMeta: '대기열에 추가했습니다. 현재 응답이 끝나면 시작합니다',
    prStateOpen: '게시됨',
    prStateDraft: '초안',
    prStateFollowing: '팔로우 중',
    prStateMerged: '병합됨',
    prStateClosed: '닫힘',
    prFollowEnded: '팔로우 종료됨',
    prFollow: '병합까지 팔로우',
    prFollowStarting: '팔로우 시작 중',
    prStop: '중지',
    prStopping: '팔로우 중지 중',
    prSettings: 'PR 설정',
    prHideSettings: 'PR 설정 닫기',
    prAutoRename: '만든 뒤 자동으로 이름 변경',
    prAutoRenameHint: '작업 제목을 PR 번호와 제목으로 바꿉니다',
    prAutoFollow: '만든 뒤 자동으로 팔로우',
    prAutoFollowHint: '백그라운드에서 CI와 리뷰 의견을 고치고 필요할 때만 알립니다',
    prTurnOn: '"{name}" 켜기',
    prTurnOff: '"{name}" 끄기',
    prCiPassed: 'CI 통과',
    prCiFailed: 'CI 실패',
    prCiRunning: 'CI 실행 중',
    prThreadsOpen: '처리할 리뷰 의견 {count}개',
    prThreadsNone: '처리할 리뷰 의견 없음',
    prMergeReady: '병합 가능',
    prMergeConflict: '충돌 있음',
    prMergeBehind: '{base} 동기화 필요',
    prMergeApproval: '승인 대기 중',
    prMergeChanges: '수정 요청됨',
    prMergeWaiting: '병합 대기 중',
    prHandoffFailed: '에이전트에게 전달하지 못했습니다. 대화에서 직접 말해 주세요',
    prHandoffUnknown: '에이전트에게 전달됐는지 확실하지 않습니다. 다시 누르기 전에 대화를 확인하세요',
    prSettingFailed: '설정을 저장하지 못했습니다. 잠시 후 다시 시도하세요',
    prNeedRepo: 'repo(owner/repo 형식)가 필요합니다',
    prNeedHead: '확인 카드에는 head(변경이 있는 브랜치)가 필요합니다',
    prBadPr: 'pr은 GitHub PR URL이나 번호여야 합니다',
    prBadCardId: 'card_id가 올바르지 않습니다',
    prCardNotFound: 'card_id에 해당하는 카드가 없어 새로 만들었습니다',
    prFetchFailed: 'PR 정보를 읽지 못했습니다({detail}). 알고 있는 정보로 카드를 표시합니다',
    prNextAsk: '카드를 표시했습니다. 사용자가 클릭하거나 대화에서 답할 때까지 기다리고, 텍스트로 다시 묻지 마세요. 클릭은 이 플러그인이 보낸 메시지로 도착합니다. PR을 만든 뒤 card_id와 pr로 pr_card를 다시 호출하고, renamed / following에는 이미 완료한 작업만 넣으세요.',
    prNextApply: '카드 설정에 따라 PR을 만든 뒤 todo 항목을 처리해야 합니다. 아직 하지 않은 항목을 마친 뒤 card_id, renamed, following으로 pr_card를 호출하세요.',
    prNextUpdated: '카드를 업데이트했습니다.',
    prTodoRename: 'cindy_helper의 set_current_session_title로 현재 작업 이름을 "{title}"(으)로 변경',
    prTodoFollow: 'pr 스킬로 {url} 백그라운드 팔로우 시작',
    prClickPublish: '사용자가 PR 카드에서 "PR 만들기"를 눌렀습니다. pr 스킬에 따라 지금 커밋·푸시하고 이 PR을 리뷰 가능한 상태로 만드세요. 만든 뒤 이벤트의 settings에 따라 이름 변경과 팔로우를 처리하고, card_id로 pr_card를 호출해 카드를 업데이트하세요.',
    prClickPublishDraft: '사용자가 PR 카드에서 "초안으로 만들기"를 눌렀습니다. pr 스킬에 따라 지금 커밋·푸시하고 초안 PR을 만드세요. 만든 뒤 이벤트의 settings에 따라 이름 변경을 처리하고, card_id로 pr_card를 호출해 카드를 업데이트하세요.',
    prClickFollow: '사용자가 PR 카드에서 "병합까지 팔로우"를 눌렀습니다. pr 스킬로 {url} 백그라운드 팔로우를 시작하고, card_id와 following=true로 pr_card를 호출하세요.',
    prClickStop: '사용자가 PR 카드에서 팔로우 "중지"를 눌렀습니다. {url}의 팔로우 일정을 삭제하고, card_id와 following=false로 pr_card를 호출하세요.',
  },
};

/** 按当前宿主语言取文案,{name} 占位一次性替换(替换值不会再被展开)。 */
function t(key, vars) {
  var table = MESSAGES[currentLocale()];
  var text = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : MESSAGES[LOCALE_FALLBACK][key];
  return String(text).replace(/\{(\w+)\}/g, function (match, name) {
    return vars && Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match;
  });
}

/** 缺参报错:fields 是稳定参数名(不翻译),如 'issue_number / body'。 */
function need(fields) {
  return t('required', { fields: fields });
}

/* ── 基础工具 ───────────────────────────────────────────────────────── */

function fail(message) {
  return { ok: false, message: message };
}

function qs(params) {
  var parts = [];
  for (var k in params) {
    if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
    var v = params[k];
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      for (var i = 0; i < v.length; i++) parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v[i])));
    } else {
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
    }
  }
  return parts.length ? '?' + parts.join('&') : '';
}

/** 分页参数透传(GitHub 通用 per_page / page)。 */
function pg(a) {
  return { per_page: a.per_page, page: a.page };
}

/** path 里的多段路径逐段编码(get_contents 等 path 含 / 的场景)。 */
function encPath(p) {
  return String(p)
    .split('/')
    .map(function (seg) { return encodeURIComponent(seg); })
    .join('/');
}

/** HTTP 状态 → 人话(401 到这里 = token 没填或已失效)。 */
function classifyStatus(status, bodySnippet) {
  if (status === 401) return t('status401');
  if (status === 403) {
    if (bodySnippet && bodySnippet.indexOf('rate limit') >= 0) return t('status403RateLimit');
    return t('status403', { detail: bodySnippet });
  }
  if (status === 404) return t('status404');
  if (status === 422) return t('status422', { detail: bodySnippet });
  if (status === 429) return t('status429');
  return t('statusOther', { status: status, detail: bodySnippet });
}

/**
 * 统一的 GitHub REST 调用。凭证由主机注入,这里只管 URL / 方法 / 体。
 * 成功 { data, status, headers },失败 { err }。
 */
async function api(opts) {
  var req = {
    url: opts.url,
    method: opts.method || 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    callId: opts.callId,
  };
  if (opts.body !== undefined) {
    req.headers['Content-Type'] = 'application/json';
    req.body = JSON.stringify(opts.body);
  }
  var r = await cindy.fetch(req);
  if (!r.ok) return { err: r.message };
  var data = null;
  if (r.body) {
    try {
      data = JSON.parse(r.body);
    } catch (e) {
      data = r.body;
    }
  }
  if (r.status < 200 || r.status >= 300) {
    var snippet = typeof r.body === 'string' ? r.body.slice(0, 300) : '';
    return { err: classifyStatus(r.status, snippet) };
  }
  return { data: data, status: r.status, headers: r.headers || {} };
}

/** GraphQL 调用(github.com 固定 /graphql;errors 非空视为失败)。 */
async function gql(query, variables, callId) {
  var r = await api({ url: API + '/graphql', method: 'POST', body: { query: query, variables: variables || {} }, callId: callId });
  if (r.err) return { err: r.err };
  var d = r.data;
  if (d && Array.isArray(d.errors) && d.errors.length) {
    return { err: t('graphqlError', { detail: JSON.stringify(d.errors).slice(0, 500) }) };
  }
  if (!d || d.data === undefined) return { err: t('graphqlNoData') };
  return { data: d.data };
}

/**
 * 瘦身:GitHub 响应约一半体量是 API 链接字段,对 LLM 无用——递归剥掉 url /
 * *_url 与 gravatar_id。保留三个有真实用途的链接:html_url(人看的页面)、
 * download_url / browser_download_url(get_contents 大文件与 release 资产的
 * 下载地址,剥了操作自述就成空话)。raw=true 时跳过。
 */
var SLIM_KEEP_URLS = { html_url: 1, download_url: 1, browser_download_url: 1 };

function slim(value) {
  if (Array.isArray(value)) return value.map(slim);
  if (value && typeof value === 'object') {
    var out = {};
    for (var k in value) {
      if (!Object.prototype.hasOwnProperty.call(value, k)) continue;
      if (k === 'gravatar_id') continue;
      if (k === 'url' || (k.length > 4 && k.slice(-4) === '_url' && !SLIM_KEEP_URLS[k])) continue;
      out[k] = slim(value[k]);
    }
    return out;
  }
  return value;
}

/**
 * 交卷:默认瘦身;超长(或调用方点名 out_file)时经 fs 槽把完整 JSON 写进会话
 * 工作目录,只交回文件路径——老 MCP out_file 泄洪的等价回归(agent 拿相对路径
 * 自己读/交给脚本)。写盘跟随会话权限模式(免批模式静默、逐条模式主机会弹
 * 确认卡),被拒/失败/远程工作区时回落截断 + 分页提示。
 */
async function deliver(data, raw, outFile, callId) {
  var payload = raw ? data : slim(data === undefined ? null : data);
  var text = JSON.stringify(payload === undefined ? null : payload);
  if (!outFile && text.length <= RESULT_MAX_CHARS) return { ok: true, result: { data: payload } };
  var spillNote = null;
  if (callId) {
    var fileName = outFile || 'github-result-' + String(callId).slice(0, 8) + '.json';
    var w = await cindy.send({
      type: 'fs-request', op: 'write', root: 'workdir',
      path: fileName, content: text, callId: callId,
    });
    if (w && w.ok) {
      return {
        ok: true,
        result: {
          saved_to: w.path,
          bytes: w.bytes,
          hint: t('spillSaved'),
        },
      };
    }
    spillNote = w && w.message ? t('spillFailedWithReason', { reason: w.message }) : t('spillFailed');
  }
  if (text.length <= RESULT_MAX_CHARS) {
    // 点名 out_file 但写盘被拒/失败,体量本身不超:内联交卷并如实附注。
    return { ok: true, result: { data: payload, note: spillNote } };
  }
  return {
    ok: true,
    result: {
      truncated: true,
      hint: spillNote ? t('truncatedAfterNote', { note: spillNote }) : t('truncated'),
      preview: text.slice(0, RESULT_MAX_CHARS),
    },
  };
}

/** repo 级操作的 owner/repo 校验与 base 拼装。 */
function repoBase(a) {
  if (!a.owner || !a.repo) {
    return { err: t('repoRequired') };
  }
  return { base: API + '/repos/' + encodeURIComponent(a.owner) + '/' + encodeURIComponent(a.repo) };
}

/** 下载 zip(Actions 产物 / 日志)到用户目录:须 save_dir 票据。 */
async function downloadZip(url, a, callId, suggestedName) {
  if (!a.save_deposit || !a.save_deposit.token) {
    return { err: t('saveDirRequired') };
  }
  var r = await cindy.fetch({
    url: url,
    as: 'file',
    saveTo: { token: a.save_deposit.token, filename: a.filename || suggestedName },
    timeoutMs: 300000,
    callId: callId,
  });
  if (!r.ok) return { err: r.message };
  if (!r.file) {
    var snippet = typeof r.body === 'string' ? r.body.slice(0, 300) : '';
    return { err: classifyStatus(r.status, snippet) };
  }
  return {
    result: {
      downloaded: true,
      dir_name: a.save_deposit.dir_name,
      file_name: r.file.file_name,
      bytes: r.file.bytes,
      note: t('downloadedTo', { path: a.save_deposit.dir_name + '/' + r.file.file_name }),
    },
  };
}

/* ── 操作目录 ───────────────────────────────────────────────────────────
 * 每个操作:{ cat, desc, params(参数说明,给 list_tools 与纠错回显), run }。
 * run(a, callId) 返回 { err } | { data } | { result }(result = 已定型交卷体)。
 * 参数记法:* = 必填;[repo] = owner 与 repo 成对必填;pp = per_page?/page?。
 * ──────────────────────────────────────────────────────────────────── */

var REPO_DOC = 'owner*:string, repo*:string({{pairRequired}})';
var PP_DOC = 'per_page?:1-100, page?:int';

var CATEGORIES = {
  issues: 'issue 与评论 / label / assignee / 子 issue',
  pulls: 'PR 全生命周期:创建 / 文件与 commit / review 与行评 / 线程 / 合并',
  repo: '仓库元数据 / 分支 / 文件内容读写 / 协作者 / topics / 建仓',
  meta: '当前用户与 GraphQL 逃生口',
  events: '用户 / org / 仓库事件流',
  commits: 'commit 列表 / 详情 / 比较 / check runs',
  search: '全站搜索:仓库 / issue / commit / 代码 / 用户',
  users: '用户资料 / org / 可访问仓库',
  actions: 'GitHub Actions:workflow / run / job / artifact / 日志下载',
  releases: 'release 与资产',
  notifications: '通知',
  orgs: 'org 成员 / 团队',
  gists: 'gist',
  git_data: '底层 git 对象:ref / tree / commit / 原子多文件提交',
  reactions: 'issue / 评论 / 行评 reaction',
};

var OPS = {};

function op(name, cat, desc, params, run) {
  OPS[name] = { cat: cat, desc: desc, params: params, run: run };
}

/* ── issues(14) ────────────────────────────────────────────────────── */

op('list_issues', 'issues', '列 issue(注意 PR 也会出现在结果里,带 pull_request 字段)',
  REPO_DOC + ', state?:open|closed|all, labels?:string({{commaSeparated}}), sort?:created|updated|comments, direction?:asc|desc, ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/issues' + qs({ state: a.state, labels: a.labels, sort: a.sort, direction: a.direction, per_page: a.per_page, page: a.page }), callId: c });
  });

op('get_issue', 'issues', '读单条 issue', REPO_DOC + ', issue_number*:int',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.issue_number) return { err: need('issue_number') };
    return api({ url: r.base + '/issues/' + a.issue_number, callId: c });
  });

op('create_issue', 'issues', '建 issue(写操作,内容先给用户确认)',
  REPO_DOC + ', title*:string, body?:string, labels?:string[], assignees?:string[]',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.title) return { err: need('title') };
    return api({ url: r.base + '/issues', method: 'POST', body: { title: a.title, body: a.body, labels: a.labels, assignees: a.assignees }, callId: c });
  });

op('list_issue_comments', 'issues', '列 issue/PR 的评论', REPO_DOC + ', issue_number*:int',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.issue_number) return { err: need('issue_number') };
    return api({ url: r.base + '/issues/' + a.issue_number + '/comments?per_page=100', callId: c });
  });

op('add_issue_comment', 'issues', '给 issue/PR 加评论(写操作)', REPO_DOC + ', issue_number*:int, body*:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.issue_number || !a.body) return { err: need('issue_number / body') };
    return api({ url: r.base + '/issues/' + a.issue_number + '/comments', method: 'POST', body: { body: a.body }, callId: c });
  });

op('update_issue_labels', 'issues', '增量增删 label(先读现有再合并写回)',
  REPO_DOC + ', issue_number*:int, add_labels?:string[], remove_labels?:string[]',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.issue_number) return { err: need('issue_number') };
    var cur = await api({ url: r.base + '/issues/' + a.issue_number, callId: c });
    if (cur.err) return cur;
    var names = {};
    var labels = (cur.data && cur.data.labels) || [];
    for (var i = 0; i < labels.length; i++) names[typeof labels[i] === 'string' ? labels[i] : labels[i].name] = 1;
    (a.add_labels || []).forEach(function (n) { names[n] = 1; });
    (a.remove_labels || []).forEach(function (n) { delete names[n]; });
    return api({ url: r.base + '/issues/' + a.issue_number, method: 'PATCH', body: { labels: Object.keys(names) }, callId: c });
  });

op('update_issue', 'issues', '改 issue(标题/正文/开关/label/assignee;写操作)',
  REPO_DOC + ', issue_number*:int, title?, body?, state?:open|closed, state_reason?:completed|not_planned|reopened, labels?:string[], assignees?:string[]',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.issue_number) return { err: need('issue_number') };
    return api({
      url: r.base + '/issues/' + a.issue_number, method: 'PATCH',
      body: { title: a.title, body: a.body, state: a.state, state_reason: a.state_reason, labels: a.labels, assignees: a.assignees },
      callId: c,
    });
  });

op('add_issue_assignees', 'issues', '加 assignee', REPO_DOC + ', issue_number*:int, assignees*:string[]',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.issue_number || !Array.isArray(a.assignees) || !a.assignees.length) return { err: need('issue_number / assignees') };
    return api({ url: r.base + '/issues/' + a.issue_number + '/assignees', method: 'POST', body: { assignees: a.assignees }, callId: c });
  });

op('remove_issue_assignees', 'issues', '移除 assignee', REPO_DOC + ', issue_number*:int, assignees*:string[]',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.issue_number || !Array.isArray(a.assignees) || !a.assignees.length) return { err: need('issue_number / assignees') };
    return api({ url: r.base + '/issues/' + a.issue_number + '/assignees', method: 'DELETE', body: { assignees: a.assignees }, callId: c });
  });

op('add_issue_labels', 'issues', '加 label(不动现有的)', REPO_DOC + ', issue_number*:int, labels*:string[]',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.issue_number || !Array.isArray(a.labels) || !a.labels.length) return { err: need('issue_number / labels') };
    return api({ url: r.base + '/issues/' + a.issue_number + '/labels', method: 'POST', body: { labels: a.labels }, callId: c });
  });

op('remove_issue_label', 'issues', '删单个 label', REPO_DOC + ', issue_number*:int, name*:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.issue_number || !a.name) return { err: need('issue_number / name') };
    return api({ url: r.base + '/issues/' + a.issue_number + '/labels/' + encodeURIComponent(a.name), method: 'DELETE', callId: c });
  });

op('get_label', 'issues', '取仓库里单个 label 定义', REPO_DOC + ', name*:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.name) return { err: need('name') };
    return api({ url: r.base + '/labels/' + encodeURIComponent(a.name), callId: c });
  });

op('list_sub_issues', 'issues', '列子 issue', REPO_DOC + ', issue_number*:int, ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.issue_number) return { err: need('issue_number') };
    return api({ url: r.base + '/issues/' + a.issue_number + '/sub_issues' + qs(pg(a)), callId: c });
  });

op('add_sub_issue', 'issues', '挂子 issue(sub_issue_id 是 issue 的全局 id,不是 number)',
  REPO_DOC + ', issue_number*:int, sub_issue_id*:int, replace_parent?:bool',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.issue_number || !a.sub_issue_id) return { err: need('issue_number / sub_issue_id') };
    return api({ url: r.base + '/issues/' + a.issue_number + '/sub_issues', method: 'POST', body: { sub_issue_id: a.sub_issue_id, replace_parent: a.replace_parent }, callId: c });
  });

/* ── pulls(25) ─────────────────────────────────────────────────────── */

op('list_pull_requests', 'pulls', '列 PR',
  REPO_DOC + ', state?:open|closed|all, base?:string, head?:string, sort?:created|updated|popularity|long-running, direction?, ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/pulls' + qs({ state: a.state, base: a.base, head: a.head, sort: a.sort, direction: a.direction, per_page: a.per_page, page: a.page }), callId: c });
  });

op('get_pull_request', 'pulls', '读单条 PR(含 merged / draft / mergeable 状态)', REPO_DOC + ', pr_number*:int',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number) return { err: need('pr_number') };
    return api({ url: r.base + '/pulls/' + a.pr_number, callId: c });
  });

op('create_pull_request', 'pulls', '建 PR(写操作;跨 fork 的 head 写 "owner:branch")',
  REPO_DOC + ', title*:string, head*:string, base*:string, body?:string, draft?:bool',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.title || !a.head || !a.base) return { err: need('title / head / base') };
    return api({ url: r.base + '/pulls', method: 'POST', body: { title: a.title, head: a.head, base: a.base, body: a.body, draft: a.draft }, callId: c });
  });

op('list_pull_request_files', 'pulls', '列 PR 变更文件(含 patch,大 PR 记得分页)',
  REPO_DOC + ', pr_number*:int, per_page?:1-100({{default100}}), page?',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number) return { err: need('pr_number') };
    return api({ url: r.base + '/pulls/' + a.pr_number + '/files' + qs({ per_page: a.per_page || 100, page: a.page }), callId: c });
  });

op('list_pull_request_commits', 'pulls', '列 PR 的 commit', REPO_DOC + ', pr_number*:int, per_page?({{default100}}), page?',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number) return { err: need('pr_number') };
    return api({ url: r.base + '/pulls/' + a.pr_number + '/commits' + qs({ per_page: a.per_page || 100, page: a.page }), callId: c });
  });

op('list_pull_request_reviews', 'pulls', '列 review(approve / request_changes / comment;node_id 供 pending review 行评用)',
  REPO_DOC + ', pr_number*:int',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number) return { err: need('pr_number') };
    return api({ url: r.base + '/pulls/' + a.pr_number + '/reviews?per_page=100', callId: c });
  });

op('list_pull_request_review_comments', 'pulls', '列 inline 代码评论', REPO_DOC + ', pr_number*:int',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number) return { err: need('pr_number') };
    return api({ url: r.base + '/pulls/' + a.pr_number + '/comments?per_page=100', callId: c });
  });

op('merge_pull_request', 'pulls', '合并 PR(写操作,先给用户确认)',
  REPO_DOC + ', pr_number*:int, merge_method?:merge|squash|rebase, commit_title?, commit_message?, sha?:string({{headCheck}})',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number) return { err: need('pr_number') };
    return api({
      url: r.base + '/pulls/' + a.pr_number + '/merge', method: 'PUT',
      body: { commit_title: a.commit_title, commit_message: a.commit_message, sha: a.sha, merge_method: a.merge_method },
      callId: c,
    });
  });

op('update_pull_request', 'pulls', '改 PR(标题/正文/开关/base;写操作)',
  REPO_DOC + ', pr_number*:int, title?, body?, state?:open|closed, base?:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number) return { err: need('pr_number') };
    return api({ url: r.base + '/pulls/' + a.pr_number, method: 'PATCH', body: { title: a.title, body: a.body, state: a.state, base: a.base }, callId: c });
  });

op('create_pull_request_review', 'pulls', '一次性提交 review(可带 inline comments;写操作)',
  REPO_DOC + ', pr_number*:int, event*:APPROVE|REQUEST_CHANGES|COMMENT, body?, commit_id?, comments?:[{path*, line?, side?:LEFT|RIGHT, position?, body*}]',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number || !a.event) return { err: need('pr_number / event') };
    return api({
      url: r.base + '/pulls/' + a.pr_number + '/reviews', method: 'POST',
      body: { event: a.event, body: a.body, commit_id: a.commit_id, comments: a.comments },
      callId: c,
    });
  });

op('create_pull_request_review_comment', 'pulls', '建单条 inline 评论(写操作)',
  REPO_DOC + ', pr_number*:int, body*, commit_id*, path*, line*:int, side?:LEFT|RIGHT, start_line?:int, start_side?',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number || !a.body || !a.commit_id || !a.path || !a.line) return { err: need('pr_number / body / commit_id / path / line') };
    return api({
      url: r.base + '/pulls/' + a.pr_number + '/comments', method: 'POST',
      body: { body: a.body, commit_id: a.commit_id, path: a.path, line: a.line, side: a.side, start_line: a.start_line, start_side: a.start_side },
      callId: c,
    });
  });

op('reply_pull_request_review_comment', 'pulls', '回复某条 inline 评论(自动定位线程根)',
  REPO_DOC + ', pr_number*:int, comment_id*:int, body*:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number || !a.comment_id || !a.body) return { err: need('pr_number / comment_id / body') };
    var got = await api({ url: r.base + '/pulls/comments/' + a.comment_id, callId: c });
    if (got.err) return got;
    var rootId = (got.data && got.data.in_reply_to_id) || a.comment_id;
    return api({ url: r.base + '/pulls/' + a.pr_number + '/comments/' + rootId + '/replies', method: 'POST', body: { body: a.body }, callId: c });
  });

op('request_pull_request_reviewers', 'pulls', '请求 reviewer', REPO_DOC + ', pr_number*:int, reviewers?:string[], team_reviewers?:string[]',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number) return { err: need('pr_number') };
    return api({ url: r.base + '/pulls/' + a.pr_number + '/requested_reviewers', method: 'POST', body: { reviewers: a.reviewers, team_reviewers: a.team_reviewers }, callId: c });
  });

op('remove_pull_request_reviewers', 'pulls', '移除已请求的 reviewer', REPO_DOC + ', pr_number*:int, reviewers?:string[], team_reviewers?:string[]',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number) return { err: need('pr_number') };
    return api({ url: r.base + '/pulls/' + a.pr_number + '/requested_reviewers', method: 'DELETE', body: { reviewers: a.reviewers, team_reviewers: a.team_reviewers }, callId: c });
  });

op('list_pull_request_requested_reviewers', 'pulls', '列已请求还没 review 的 reviewer', REPO_DOC + ', pr_number*:int',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number) return { err: need('pr_number') };
    return api({ url: r.base + '/pulls/' + a.pr_number + '/requested_reviewers', callId: c });
  });

op('create_pending_pull_request_review', 'pulls', '开一个 pending review(之后用 add_pending_pull_request_review_comment 攒行评,最后 submit)',
  REPO_DOC + ', pr_number*:int, body?, commit_id?',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number) return { err: need('pr_number') };
    return api({ url: r.base + '/pulls/' + a.pr_number + '/reviews', method: 'POST', body: { body: a.body, commit_id: a.commit_id }, callId: c });
  });

op('add_pending_pull_request_review_comment', 'pulls', '往 pending review 加 inline 评论(GraphQL;review_node_id 是 review 的 node_id,PRR_ 开头)',
  REPO_DOC + ', review_node_id*:string, body*, path*, line*:int, side?:LEFT|RIGHT, start_line?, start_side?, subject_type?:LINE|FILE',
  async function (a, c) {
    if (!a.review_node_id || !a.body || !a.path) return { err: need('review_node_id / body / path') };
    if (a.subject_type !== 'FILE' && !a.line) return { err: t('requiredLine') };
    var input = {
      pullRequestReviewId: a.review_node_id,
      body: a.body,
      path: a.path,
    };
    if (a.subject_type) input.subjectType = a.subject_type;
    if (a.line) input.line = a.line;
    if (a.side) input.side = a.side;
    if (a.start_line) input.startLine = a.start_line;
    if (a.start_side) input.startSide = a.start_side;
    return gql(
      'mutation($input: AddPullRequestReviewThreadInput!) { addPullRequestReviewThread(input: $input) { thread { id } } }',
      { input: input }, c,
    );
  });

op('submit_pending_pull_request_review', 'pulls', '提交 pending review(写操作)',
  REPO_DOC + ', pr_number*:int, review_id*:int, event*:APPROVE|REQUEST_CHANGES|COMMENT, body?',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number || !a.review_id || !a.event) return { err: need('pr_number / review_id / event') };
    return api({ url: r.base + '/pulls/' + a.pr_number + '/reviews/' + a.review_id + '/events', method: 'POST', body: { event: a.event, body: a.body }, callId: c });
  });

op('delete_pending_pull_request_review', 'pulls', '删 pending review', REPO_DOC + ', pr_number*:int, review_id*:int',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number || !a.review_id) return { err: need('pr_number / review_id') };
    return api({ url: r.base + '/pulls/' + a.pr_number + '/reviews/' + a.review_id, method: 'DELETE', callId: c });
  });

op('dismiss_pull_request_review', 'pulls', 'dismiss 一条已提交的 review(写操作)',
  REPO_DOC + ', pr_number*:int, review_id*:int, message*:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number || !a.review_id || !a.message) return { err: need('pr_number / review_id / message') };
    return api({ url: r.base + '/pulls/' + a.pr_number + '/reviews/' + a.review_id + '/dismissals', method: 'PUT', body: { message: a.message }, callId: c });
  });

op('list_pull_request_review_threads', 'pulls', '列 review 线程(GraphQL;含 resolved/outdated、path/line、每线程前 50 条评论、分页 cursor)',
  REPO_DOC + ', pr_number*:int, first?:int({{default50Max100}}), after?:string({{previousEndCursor}})',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number) return { err: need('pr_number') };
    var first = Math.min(100, Math.max(1, a.first || 50));
    var out = await gql(
      'query($owner: String!, $repo: String!, $number: Int!, $first: Int!, $after: String) {' +
      ' repository(owner: $owner, name: $repo) { pullRequest(number: $number) {' +
      '  reviewThreads(first: $first, after: $after) {' +
      '   pageInfo { hasNextPage endCursor }' +
      '   nodes { id isResolved isOutdated path line startLine diffSide' +
      '    comments(first: 50) { totalCount nodes { id databaseId author { login } body createdAt url } } } } } } }',
      { owner: a.owner, repo: a.repo, number: a.pr_number, first: first, after: a.after || null }, c,
    );
    if (out.err) return out;
    var repo = out.data && out.data.repository;
    var pr = repo && repo.pullRequest;
    if (!pr) return { err: t('status404') };
    return { data: pr.reviewThreads };
  });

op('resolve_review_thread', 'pulls', 'resolve 一条 review 线程(GraphQL;thread_id 是 PRRT_ 开头的 node id)', 'thread_id*:string',
  async function (a, c) {
    if (!a.thread_id) return { err: t('requiredThreadId') };
    return gql('mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { id isResolved } } }', { id: a.thread_id }, c);
  });

op('unresolve_review_thread', 'pulls', 'unresolve 一条 review 线程(GraphQL)', 'thread_id*:string',
  async function (a, c) {
    if (!a.thread_id) return { err: need('thread_id') };
    return gql('mutation($id: ID!) { unresolveReviewThread(input: { threadId: $id }) { thread { id isResolved } } }', { id: a.thread_id }, c);
  });

op('update_pull_request_branch', 'pulls', '把 base 最新代码合入 PR head 分支(202 受理)',
  REPO_DOC + ', pr_number*:int, expected_head_sha?:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number) return { err: need('pr_number') };
    var out = await api({ url: r.base + '/pulls/' + a.pr_number + '/update-branch', method: 'PUT', body: a.expected_head_sha ? { expected_head_sha: a.expected_head_sha } : {}, callId: c });
    if (out.err) return out;
    return { data: out.data || { updated: true } };
  });

op('request_copilot_review', 'pulls', '把 Copilot bot 加为 reviewer', REPO_DOC + ', pr_number*:int',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.pr_number) return { err: need('pr_number') };
    return api({
      url: r.base + '/pulls/' + a.pr_number + '/requested_reviewers', method: 'POST',
      body: { reviewers: ['copilot-pull-request-reviewer[bot]'] }, callId: c,
    });
  });

/* ── repo(22) ──────────────────────────────────────────────────────── */

op('list_branches', 'repo', '列分支(单页 100)', REPO_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/branches?per_page=100', callId: c });
  });

op('list_labels', 'repo', '列仓库 label(单页 100)', REPO_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/labels?per_page=100', callId: c });
  });

op('ensure_labels', 'repo', '确保 label 存在(缺的按默认色创建,已有的跳过)', REPO_DOC + ', names*:string[]',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!Array.isArray(a.names) || !a.names.length) return { err: t('requiredNamesNonEmpty') };
    var cur = await api({ url: r.base + '/labels?per_page=100', callId: c });
    if (cur.err) return cur;
    var have = {};
    (cur.data || []).forEach(function (l) { have[l.name] = 1; });
    var created = [];
    for (var i = 0; i < a.names.length; i++) {
      var n = a.names[i];
      if (have[n]) continue;
      var made = await api({ url: r.base + '/labels', method: 'POST', body: { name: n, color: '428BCA' }, callId: c });
      // 422 = 并发下已存在,视同成功跳过;其它错误如实反馈。
      if (made.err && made.err.indexOf('422') < 0) return made;
      if (!made.err) created.push(n);
    }
    return { data: { ensured: a.names, created: created } };
  });

op('get_repo', 'repo', '仓库元信息(默认分支/可见性/权限等)', REPO_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base, callId: c });
  });

op('list_tags', 'repo', '列 tag', REPO_DOC + ', ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/tags' + qs(pg(a)), callId: c });
  });

op('get_readme', 'repo', '读 README(content 为 base64)', REPO_DOC + ', ref?:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/readme' + qs({ ref: a.ref }), callId: c });
  });

op('list_deployments', 'repo', '列 deployment', REPO_DOC + ', sha?, ref?, task?, environment?, ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/deployments' + qs({ sha: a.sha, ref: a.ref, task: a.task, environment: a.environment, per_page: a.per_page, page: a.page }), callId: c });
  });

op('get_contents', 'repo', '读文件内容(base64)或目录列表;大文件(>1MB)只回 download_url 元数据',
  REPO_DOC + ', path?:string({{defaultRepoRoot}}), ref?:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/contents/' + (a.path ? encPath(a.path) : '') + qs({ ref: a.ref }), callId: c });
  });

op('list_repo_topics', 'repo', '列 topics', REPO_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/topics', callId: c });
  });

op('replace_repo_topics', 'repo', '整表替换 topics(写操作,传空数组=清空)', REPO_DOC + ', names*:string[]({{emptyArrayAllowed}})',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!Array.isArray(a.names)) return { err: t('requiredNamesArray') };
    return api({ url: r.base + '/topics', method: 'PUT', body: { names: a.names }, callId: c });
  });

op('list_repo_contributors', 'repo', '列贡献者', REPO_DOC + ', anon?:bool, ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/contributors' + qs({ anon: a.anon, per_page: a.per_page, page: a.page }), callId: c });
  });

op('list_repo_languages', 'repo', '语言字节统计', REPO_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/languages', callId: c });
  });

op('list_stargazers', 'repo', '列 star 用户', REPO_DOC + ', ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/stargazers' + qs(pg(a)), callId: c });
  });

op('list_forks', 'repo', '列 fork', REPO_DOC + ', sort?:newest|oldest|stargazers|watchers, ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/forks' + qs({ sort: a.sort, per_page: a.per_page, page: a.page }), callId: c });
  });

op('create_fork', 'repo', 'fork 仓库(写操作)', REPO_DOC + ', organization?, name?, default_branch_only?:bool',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/forks', method: 'POST', body: { organization: a.organization, name: a.name, default_branch_only: a.default_branch_only }, callId: c });
  });

op('list_repo_collaborators', 'repo', '列协作者', REPO_DOC + ', affiliation?:outside|direct|all, permission?:pull|triage|push|maintain|admin, ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/collaborators' + qs({ affiliation: a.affiliation, permission: a.permission, per_page: a.per_page, page: a.page }), callId: c });
  });

op('list_repo_hooks', 'repo', '列 webhook(单页 100)', REPO_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/hooks?per_page=100', callId: c });
  });

op('list_branch_protection', 'repo', '读分支保护设置(未保护返回 404)', REPO_DOC + ', branch*:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.branch) return { err: need('branch') };
    return api({ url: r.base + '/branches/' + encodeURIComponent(a.branch) + '/protection', callId: c });
  });

op('create_or_update_file_contents', 'repo', '建/改单文件(content 必须是 base64;改文件必须带当前 blob sha;写操作)',
  REPO_DOC + ', path*, message*, content*:base64, sha?({{requiredWhenUpdating}}), branch?, committer?:{name*,email*}, author?:{name*,email*}',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.path || !a.message || !a.content) return { err: need('path / message / content(base64)') };
    return api({
      url: r.base + '/contents/' + encPath(a.path), method: 'PUT',
      body: { message: a.message, content: a.content, sha: a.sha, branch: a.branch, committer: a.committer, author: a.author },
      callId: c,
    });
  });

op('delete_file', 'repo', '删单文件(必须带当前 blob sha;写操作)',
  REPO_DOC + ', path*, message*, sha*, branch?, committer?, author?',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.path || !a.message || !a.sha) return { err: need('path / message / sha') };
    return api({
      url: r.base + '/contents/' + encPath(a.path), method: 'DELETE',
      body: { message: a.message, sha: a.sha, branch: a.branch, committer: a.committer, author: a.author },
      callId: c,
    });
  });

op('create_repository', 'repo', '建仓库(写操作;org 参数存在时建在该 org 下)',
  'name*, description?, private?:bool, auto_init?:bool, org?, homepage?, has_issues?, has_projects?, has_wiki?, gitignore_template?, license_template?',
  async function (a, c) {
    if (!a.name) return { err: need('name') };
    var body = {
      name: a.name, description: a.description, private: a.private, auto_init: a.auto_init,
      homepage: a.homepage, has_issues: a.has_issues, has_projects: a.has_projects, has_wiki: a.has_wiki,
      gitignore_template: a.gitignore_template, license_template: a.license_template,
    };
    var url = a.org ? API + '/orgs/' + encodeURIComponent(a.org) + '/repos' : API + '/user/repos';
    return api({ url: url, method: 'POST', body: body, callId: c });
  });

op('get_tag', 'repo', '取 tag 的 ref 对象', REPO_DOC + ', tag*:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.tag) return { err: need('tag') };
    // 与 get_ref/create_branch 同口径用 encPath:tag 名带 / 时逐段编码才打得到。
    return api({ url: r.base + '/git/ref/tags/' + encPath(a.tag), callId: c });
  });

/* ── meta(2) ───────────────────────────────────────────────────────── */

op('get_current_user', 'meta', '当前 token 对应的用户(login / id / 主页)', '{{noParameters}}',
  async function (a, c) {
    return api({ url: API + '/user', callId: c });
  });

op('graphql', 'meta', '通用 GraphQL 逃生口(REST 覆盖不到的查询/变更用它)', 'query*:string, variables?:object',
  async function (a, c) {
    if (!a.query) return { err: need('query') };
    return gql(a.query, a.variables, c);
  });

/* ── events(5) ─────────────────────────────────────────────────────── */

op('list_user_events', 'events', '某用户的事件(认证用户可见范围,含自己的私有事件)', 'username*:string, ' + PP_DOC,
  async function (a, c) {
    if (!a.username) return { err: need('username') };
    return api({ url: API + '/users/' + encodeURIComponent(a.username) + '/events' + qs(pg(a)), callId: c });
  });

op('list_user_public_events', 'events', '某用户的公开事件', 'username*:string, ' + PP_DOC,
  async function (a, c) {
    if (!a.username) return { err: need('username') };
    return api({ url: API + '/users/' + encodeURIComponent(a.username) + '/events/public' + qs(pg(a)), callId: c });
  });

op('list_org_events', 'events', 'org 的公开事件流', 'org*:string, ' + PP_DOC,
  async function (a, c) {
    if (!a.org) return { err: need('org') };
    return api({ url: API + '/orgs/' + encodeURIComponent(a.org) + '/events' + qs(pg(a)), callId: c });
  });

op('list_authenticated_user_org_events', 'events', '认证用户在某 org 内可见的事件(含私有仓库)', 'org*:string, ' + PP_DOC,
  async function (a, c) {
    if (!a.org) return { err: need('org') };
    var me = await api({ url: API + '/user', callId: c });
    if (me.err) return me;
    return api({
      url: API + '/users/' + encodeURIComponent(me.data.login) + '/events/orgs/' + encodeURIComponent(a.org) + qs(pg(a)),
      callId: c,
    });
  });

op('list_repo_events', 'events', '仓库事件', REPO_DOC + ', ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/events' + qs(pg(a)), callId: c });
  });

/* ── commits(4) ────────────────────────────────────────────────────── */

op('list_commits', 'commits', '列 commit(可按作者/路径/时间过滤)',
  REPO_DOC + ', sha?:string({{branchOrStart}}), path?, author?, committer?, since?:ISO, until?:ISO, ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({
      url: r.base + '/commits' + qs({ sha: a.sha, path: a.path, author: a.author, committer: a.committer, since: a.since, until: a.until, per_page: a.per_page, page: a.page }),
      callId: c,
    });
  });

op('get_commit', 'commits', '读单个 commit(含 stats 与 files diff)', REPO_DOC + ', sha*:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.sha) return { err: need('sha') };
    return api({ url: r.base + '/commits/' + encodeURIComponent(a.sha), callId: c });
  });

op('compare_commits', 'commits', '比较两个 ref(base...head)', REPO_DOC + ', base*:string, head*:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.base || !a.head) return { err: need('base / head') };
    return api({ url: r.base + '/compare/' + encodeURIComponent(a.base) + '...' + encodeURIComponent(a.head), callId: c });
  });

op('list_check_runs_for_ref', 'commits', '列某 ref 的 check runs(CI 状态)',
  REPO_DOC + ', ref*:string, check_name?, status?:queued|in_progress|completed, filter?:latest|all, ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.ref) return { err: need('ref') };
    return api({
      url: r.base + '/commits/' + encodeURIComponent(a.ref) + '/check-runs' + qs({ check_name: a.check_name, status: a.status, filter: a.filter, per_page: a.per_page, page: a.page }),
      callId: c,
    });
  });

/* ── search(5) ─────────────────────────────────────────────────────── */

op('search_repos', 'search', '搜仓库(GitHub search 语法)', 'q*:string, sort?:stars|forks|help-wanted-issues|updated, order?:asc|desc, ' + PP_DOC,
  async function (a, c) {
    if (!a.q) return { err: need('q') };
    return api({ url: API + '/search/repositories' + qs({ q: a.q, sort: a.sort, order: a.order, per_page: a.per_page, page: a.page }), callId: c });
  });

op('search_issues_and_prs', 'search', '搜 issue 与 PR(q 里用 is:pr / is:issue / repo:owner/name 收窄)',
  'q*:string, sort?, order?:asc|desc, ' + PP_DOC,
  async function (a, c) {
    if (!a.q) return { err: need('q') };
    return api({ url: API + '/search/issues' + qs({ q: a.q, sort: a.sort, order: a.order, per_page: a.per_page, page: a.page }), callId: c });
  });

op('search_commits', 'search', '搜 commit', 'q*:string, sort?:author-date|committer-date, order?, ' + PP_DOC,
  async function (a, c) {
    if (!a.q) return { err: need('q') };
    return api({ url: API + '/search/commits' + qs({ q: a.q, sort: a.sort, order: a.order, per_page: a.per_page, page: a.page }), callId: c });
  });

op('search_code', 'search', '搜代码(q 里用 repo: / path: / language: 收窄)', 'q*:string, ' + PP_DOC,
  async function (a, c) {
    if (!a.q) return { err: need('q') };
    return api({ url: API + '/search/code' + qs({ q: a.q, per_page: a.per_page, page: a.page }), callId: c });
  });

op('search_users', 'search', '搜用户', 'q*:string, sort?:followers|repositories|joined, order?, ' + PP_DOC,
  async function (a, c) {
    if (!a.q) return { err: need('q') };
    return api({ url: API + '/search/users' + qs({ q: a.q, sort: a.sort, order: a.order, per_page: a.per_page, page: a.page }), callId: c });
  });

/* ── users(4) ──────────────────────────────────────────────────────── */

op('get_user', 'users', '用户公开资料', 'username*:string',
  async function (a, c) {
    if (!a.username) return { err: need('username') };
    return api({ url: API + '/users/' + encodeURIComponent(a.username), callId: c });
  });

op('list_user_orgs', 'users', '用户的公开 org(单页 100)', 'username*:string',
  async function (a, c) {
    if (!a.username) return { err: need('username') };
    return api({ url: API + '/users/' + encodeURIComponent(a.username) + '/orgs?per_page=100', callId: c });
  });

op('list_authenticated_user_repos', 'users', '认证用户可访问的仓库',
  'visibility?:all|public|private, type?:all|owner|public|private|member, sort?:created|updated|pushed|full_name, direction?, ' + PP_DOC,
  async function (a, c) {
    return api({
      url: API + '/user/repos' + qs({ visibility: a.visibility, type: a.type, sort: a.sort, direction: a.direction, per_page: a.per_page, page: a.page }),
      callId: c,
    });
  });

op('list_org_repos', 'users', 'org 的仓库', 'org*:string, type?:all|public|private|forks|sources|member, sort?, direction?, ' + PP_DOC,
  async function (a, c) {
    if (!a.org) return { err: need('org') };
    return api({
      url: API + '/orgs/' + encodeURIComponent(a.org) + '/repos' + qs({ type: a.type, sort: a.sort, direction: a.direction, per_page: a.per_page, page: a.page }),
      callId: c,
    });
  });

/* ── actions(10) ───────────────────────────────────────────────────── */

op('list_workflow_runs', 'actions', '列 workflow run',
  REPO_DOC + ', branch?, event?, status?:completed|success|failure|in_progress|queued|…, actor?, ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({
      url: r.base + '/actions/runs' + qs({ branch: a.branch, event: a.event, status: a.status, actor: a.actor, per_page: a.per_page, page: a.page }),
      callId: c,
    });
  });

op('get_workflow_run', 'actions', '读单个 run', REPO_DOC + ', run_id*:int',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.run_id) return { err: need('run_id') };
    return api({ url: r.base + '/actions/runs/' + a.run_id, callId: c });
  });

op('list_workflow_run_jobs', 'actions', '列 run 里的 job(含 steps 状态)', REPO_DOC + ', run_id*:int, filter?:latest|all, ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.run_id) return { err: need('run_id') };
    return api({ url: r.base + '/actions/runs/' + a.run_id + '/jobs' + qs({ filter: a.filter, per_page: a.per_page, page: a.page }), callId: c });
  });

op('list_workflows', 'actions', '列 workflow 定义', REPO_DOC + ', ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/actions/workflows' + qs(pg(a)), callId: c });
  });

op('dispatch_workflow', 'actions', '触发 workflow_dispatch(写操作;workflow 可传文件名或数字 id)',
  REPO_DOC + ', workflow*:string|int, ref*:string, inputs?:object({{stringValues}})',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.workflow || !a.ref) return { err: need('workflow / ref') };
    var out = await api({
      url: r.base + '/actions/workflows/' + encodeURIComponent(String(a.workflow)) + '/dispatches',
      method: 'POST', body: { ref: a.ref, inputs: a.inputs }, callId: c,
    });
    if (out.err) return out;
    return { data: { dispatched: true } };
  });

op('rerun_workflow_run', 'actions', '重跑 run(写操作)', REPO_DOC + ', run_id*:int',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.run_id) return { err: need('run_id') };
    var out = await api({ url: r.base + '/actions/runs/' + a.run_id + '/rerun', method: 'POST', callId: c });
    if (out.err) return out;
    return { data: { rerun: true } };
  });

op('cancel_workflow_run', 'actions', '取消 run(写操作)', REPO_DOC + ', run_id*:int',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.run_id) return { err: need('run_id') };
    var out = await api({ url: r.base + '/actions/runs/' + a.run_id + '/cancel', method: 'POST', callId: c });
    if (out.err) return out;
    return { data: { cancelled: true } };
  });

op('list_workflow_run_artifacts', 'actions', '列 run 的 artifact', REPO_DOC + ', run_id*:int, ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.run_id) return { err: need('run_id') };
    return api({ url: r.base + '/actions/runs/' + a.run_id + '/artifacts' + qs(pg(a)), callId: c });
  });

op('download_artifact', 'actions', '下载 artifact zip 到用户本地目录(需要主 agent 调 ghost_call 时把目标目录绝对路径放在顶层 save_dir 参数)',
  REPO_DOC + ', artifact_id*:int, filename?:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.artifact_id) return { err: need('artifact_id') };
    var done = await downloadZip(r.base + '/actions/artifacts/' + a.artifact_id + '/zip', a, c, 'artifact-' + a.artifact_id + '.zip');
    if (done.err) return done;
    return { result: done.result };
  });

op('download_run_logs', 'actions', '下载 run 全量日志 zip 到用户本地目录(需要 ghost_call 顶层 save_dir 参数)',
  REPO_DOC + ', run_id*:int, filename?:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.run_id) return { err: need('run_id') };
    var done = await downloadZip(r.base + '/actions/runs/' + a.run_id + '/logs', a, c, 'run-' + a.run_id + '-logs.zip');
    if (done.err) return done;
    return { result: done.result };
  });

/* ── releases(5) ───────────────────────────────────────────────────── */

op('list_releases', 'releases', '列 release', REPO_DOC + ', ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/releases' + qs(pg(a)), callId: c });
  });

op('get_release_by_tag', 'releases', '按 tag 读 release', REPO_DOC + ', tag*:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.tag) return { err: need('tag') };
    return api({ url: r.base + '/releases/tags/' + encodeURIComponent(a.tag), callId: c });
  });

op('create_release', 'releases', '建 release(写操作)',
  REPO_DOC + ', tag_name*, target_commitish?, name?, body?, draft?:bool, prerelease?:bool, generate_release_notes?:bool',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.tag_name) return { err: need('tag_name') };
    return api({
      url: r.base + '/releases', method: 'POST',
      body: { tag_name: a.tag_name, target_commitish: a.target_commitish, name: a.name, body: a.body, draft: a.draft, prerelease: a.prerelease, generate_release_notes: a.generate_release_notes },
      callId: c,
    });
  });

op('get_latest_release', 'releases', '最新已发布 release', REPO_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    return api({ url: r.base + '/releases/latest', callId: c });
  });

op('list_release_assets', 'releases', '列 release 的资产', REPO_DOC + ', release_id*:int, ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.release_id) return { err: need('release_id') };
    return api({ url: r.base + '/releases/' + a.release_id + '/assets' + qs(pg(a)), callId: c });
  });

/* ── notifications(2) ──────────────────────────────────────────────── */

op('list_notifications', 'notifications', '列通知', 'all?:bool, participating?:bool, since?:ISO, before?:ISO, ' + PP_DOC,
  async function (a, c) {
    return api({
      url: API + '/notifications' + qs({ all: a.all, participating: a.participating, since: a.since, before: a.before, per_page: a.per_page, page: a.page }),
      callId: c,
    });
  });

op('mark_notification_read', 'notifications', '标记某条通知线程为已读', 'thread_id*:string',
  async function (a, c) {
    if (!a.thread_id) return { err: need('thread_id') };
    var out = await api({ url: API + '/notifications/threads/' + encodeURIComponent(a.thread_id), method: 'PATCH', callId: c });
    if (out.err) return out;
    return { data: { marked_read: true } };
  });

/* ── orgs(4) ───────────────────────────────────────────────────────── */

op('list_org_members', 'orgs', 'org 成员', 'org*:string, filter?:2fa_disabled|all, role?:all|admin|member, ' + PP_DOC,
  async function (a, c) {
    if (!a.org) return { err: need('org') };
    return api({ url: API + '/orgs/' + encodeURIComponent(a.org) + '/members' + qs({ filter: a.filter, role: a.role, per_page: a.per_page, page: a.page }), callId: c });
  });

op('list_org_teams', 'orgs', 'org 团队', 'org*:string, ' + PP_DOC,
  async function (a, c) {
    if (!a.org) return { err: need('org') };
    return api({ url: API + '/orgs/' + encodeURIComponent(a.org) + '/teams' + qs(pg(a)), callId: c });
  });

op('list_team_members', 'orgs', '团队成员', 'org*:string, team_slug*:string, ' + PP_DOC,
  async function (a, c) {
    if (!a.org || !a.team_slug) return { err: need('org / team_slug') };
    return api({ url: API + '/orgs/' + encodeURIComponent(a.org) + '/teams/' + encodeURIComponent(a.team_slug) + '/members' + qs(pg(a)), callId: c });
  });

op('list_team_repos', 'orgs', '团队可访问的仓库', 'org*:string, team_slug*:string, ' + PP_DOC,
  async function (a, c) {
    if (!a.org || !a.team_slug) return { err: need('org / team_slug') };
    return api({ url: API + '/orgs/' + encodeURIComponent(a.org) + '/teams/' + encodeURIComponent(a.team_slug) + '/repos' + qs(pg(a)), callId: c });
  });

/* ── gists(2) ──────────────────────────────────────────────────────── */

op('list_gists', 'gists', '列认证用户的 gist', 'since?:ISO, ' + PP_DOC,
  async function (a, c) {
    return api({ url: API + '/gists' + qs({ since: a.since, per_page: a.per_page, page: a.page }), callId: c });
  });

op('get_gist', 'gists', '读单个 gist(含文件内容)', 'id*:string',
  async function (a, c) {
    if (!a.id) return { err: need('id') };
    return api({ url: API + '/gists/' + encodeURIComponent(a.id), callId: c });
  });

/* ── git_data(7) ───────────────────────────────────────────────────── */

op('get_ref', 'git_data', '取单个 ref(如 heads/main、tags/v1.0.0)', REPO_DOC + ', ref*:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.ref) return { err: t('requiredRefExample') };
    return api({ url: r.base + '/git/ref/' + encPath(a.ref), callId: c });
  });

op('create_branch', 'git_data', '建分支(from_sha 或 from_ref 二选一,都省略时从仓库默认分支拉)',
  REPO_DOC + ', branch*:string, from_sha?:string, from_ref?:string({{defaultBranchDefault}})',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.branch) return { err: need('branch') };
    var sha = a.from_sha;
    if (!sha) {
      var fromRef = a.from_ref;
      if (!fromRef) {
        var repo = await api({ url: r.base, callId: c });
        if (repo.err) return repo;
        fromRef = repo.data && repo.data.default_branch;
        if (!fromRef) return { err: t('noDefaultBranch') };
      }
      var got = await api({ url: r.base + '/git/ref/heads/' + encPath(fromRef), callId: c });
      if (got.err) return got;
      sha = got.data && got.data.object && got.data.object.sha;
      if (!sha) return { err: t('noStartSha') };
    }
    return api({ url: r.base + '/git/refs', method: 'POST', body: { ref: 'refs/heads/' + a.branch, sha: sha }, callId: c });
  });

op('create_ref', 'git_data', '建原始 ref(refs/heads/… 或 refs/tags/…)', REPO_DOC + ', ref*:string, sha*:string',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.ref || !a.sha) return { err: need('ref / sha') };
    return api({ url: r.base + '/git/refs', method: 'POST', body: { ref: a.ref, sha: a.sha }, callId: c });
  });

op('get_tree', 'git_data', '取 git tree(recursive=true 拉全树,注意 truncated 标记)', REPO_DOC + ', tree_sha*:string, recursive?:bool',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.tree_sha) return { err: need('tree_sha') };
    return api({ url: r.base + '/git/trees/' + encodeURIComponent(a.tree_sha) + qs({ recursive: a.recursive ? 1 : undefined }), callId: c });
  });

op('create_tree', 'git_data', '建 git tree', REPO_DOC + ', base_tree?, tree*:[{path*, mode*:100644|100755|040000|160000|120000, type*:blob|tree|commit, sha?, content?}]',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!Array.isArray(a.tree) || !a.tree.length) return { err: t('requiredTreeEntries') };
    return api({ url: r.base + '/git/trees', method: 'POST', body: { base_tree: a.base_tree, tree: a.tree }, callId: c });
  });

op('create_commit', 'git_data', '建 commit 对象(不动 ref;要更新分支再用 create_ref / push_files)',
  REPO_DOC + ', message*, tree*:string, parents*:string[], author?:{name*,email*,date?}, committer?',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.message || !a.tree || !Array.isArray(a.parents)) return { err: need('message / tree / parents') };
    return api({
      url: r.base + '/git/commits', method: 'POST',
      body: { message: a.message, tree: a.tree, parents: a.parents, author: a.author, committer: a.committer },
      callId: c,
    });
  });

op('push_files', 'git_data', '原子多文件单 commit 推到分支(读 head → 建 blob/tree/commit → 快进 ref;写操作)',
  REPO_DOC + ', branch*, message*, files*:[{path*, content*, encoding?:utf-8|base64}]',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.branch || !a.message || !Array.isArray(a.files) || !a.files.length) return { err: need('branch / message / files') };
    var head = await api({ url: r.base + '/git/ref/heads/' + encPath(a.branch), callId: c });
    if (head.err) return head;
    var headSha = head.data && head.data.object && head.data.object.sha;
    if (!headSha) return { err: t('noHeadSha') };
    var headCommit = await api({ url: r.base + '/git/commits/' + headSha, callId: c });
    if (headCommit.err) return headCommit;
    var baseTree = headCommit.data && headCommit.data.tree && headCommit.data.tree.sha;
    // base_tree 缺失时不能继续:GitHub 会建出只含本次文件的孤儿树,等效删光分支其余文件。
    if (!baseTree) return { err: t('noBaseTree') };
    var entries = [];
    for (var i = 0; i < a.files.length; i++) {
      var f = a.files[i];
      if (!f || !f.path || typeof f.content !== 'string') return { err: t('filesEntryFields') };
      // 拼错的 encoding(如 'Base64')按 utf-8 提交会静默写坏文件,收严成枚举。
      if (f.encoding !== undefined && f.encoding !== 'utf-8' && f.encoding !== 'base64') {
        return { err: t('filesEncoding', { value: f.encoding }) };
      }
      if (f.encoding === 'base64') {
        var blob = await api({ url: r.base + '/git/blobs', method: 'POST', body: { content: f.content, encoding: 'base64' }, callId: c });
        if (blob.err) return blob;
        entries.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.data.sha });
      } else {
        entries.push({ path: f.path, mode: '100644', type: 'blob', content: f.content });
      }
    }
    var tree = await api({ url: r.base + '/git/trees', method: 'POST', body: { base_tree: baseTree, tree: entries }, callId: c });
    if (tree.err) return tree;
    var commit = await api({
      url: r.base + '/git/commits', method: 'POST',
      body: { message: a.message, tree: tree.data.sha, parents: [headSha] }, callId: c,
    });
    if (commit.err) return commit;
    var moved = await api({
      url: r.base + '/git/refs/heads/' + encPath(a.branch), method: 'PATCH',
      body: { sha: commit.data.sha, force: false }, callId: c,
    });
    if (moved.err) return moved;
    return { data: { pushed: true, commit_sha: commit.data.sha, files: a.files.length } };
  });

/* ── reactions(6) ──────────────────────────────────────────────────── */

var REACTION_DOC = '{{contentEnum}}:+1|-1|laugh|confused|heart|hooray|rocket|eyes';

op('list_issue_reactions', 'reactions', '列 issue 的 reaction(' + REACTION_DOC + ')', REPO_DOC + ', issue_number*:int, content?, ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.issue_number) return { err: need('issue_number') };
    return api({ url: r.base + '/issues/' + a.issue_number + '/reactions' + qs({ content: a.content, per_page: a.per_page, page: a.page }), callId: c });
  });

op('add_issue_reaction', 'reactions', '给 issue 加 reaction', REPO_DOC + ', issue_number*:int, content*(' + REACTION_DOC + ')',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.issue_number || !a.content) return { err: need('issue_number / content') };
    return api({ url: r.base + '/issues/' + a.issue_number + '/reactions', method: 'POST', body: { content: a.content }, callId: c });
  });

op('list_issue_comment_reactions', 'reactions', '列 issue 评论的 reaction', REPO_DOC + ', comment_id*:int, content?, ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.comment_id) return { err: need('comment_id') };
    return api({ url: r.base + '/issues/comments/' + a.comment_id + '/reactions' + qs({ content: a.content, per_page: a.per_page, page: a.page }), callId: c });
  });

op('add_issue_comment_reaction', 'reactions', '给 issue 评论加 reaction', REPO_DOC + ', comment_id*:int, content*',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.comment_id || !a.content) return { err: need('comment_id / content') };
    return api({ url: r.base + '/issues/comments/' + a.comment_id + '/reactions', method: 'POST', body: { content: a.content }, callId: c });
  });

op('list_pull_request_review_comment_reactions', 'reactions', '列 PR 行评的 reaction', REPO_DOC + ', comment_id*:int, content?, ' + PP_DOC,
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.comment_id) return { err: need('comment_id') };
    return api({ url: r.base + '/pulls/comments/' + a.comment_id + '/reactions' + qs({ content: a.content, per_page: a.per_page, page: a.page }), callId: c });
  });

op('add_pull_request_review_comment_reaction', 'reactions', '给 PR 行评加 reaction', REPO_DOC + ', comment_id*:int, content*',
  async function (a, c) {
    var r = repoBase(a); if (r.err) return r;
    if (!a.comment_id || !a.content) return { err: need('comment_id / content') };
    return api({ url: r.base + '/pulls/comments/' + a.comment_id + '/reactions', method: 'POST', body: { content: a.content }, callId: c });
  });

/* ── 目录多语言(list_tools 第二段目录 + 参数说明)──────────────────────
 * zh-CN 原文保留在上面每个 op() / CATEGORIES 旁边,作为目录的源;en / ja / ko 在下面
 * 按稳定的操作名 / 类目名对照。参数说明里的中文注释写成 {{key}} 占位,按语言从
 * PARAM_NOTES 取;参数名、枚举值、操作名都是稳定协议,不翻译。
 * 键集合必须与 OPS / CATEGORIES 完全一致(.tests/cindy-github.test.mjs 校验)。
 * ──────────────────────────────────────────────────────────────────── */

var PARAM_NOTES = {
  'zh-CN': {
    pairRequired: '成对必填',
    commaSeparated: '逗号分隔',
    default100: '默认100',
    headCheck: 'head 校验',
    default50Max100: '默认50,≤100',
    previousEndCursor: '上一页 endCursor',
    defaultRepoRoot: '默认仓库根',
    emptyArrayAllowed: '可空数组',
    requiredWhenUpdating: '改文件必填',
    noParameters: '无参数',
    branchOrStart: '分支或起点',
    stringValues: '值须 string',
    defaultBranchDefault: '默认仓库 default_branch',
    contentEnum: 'content 枚举',
  },
  en: {
    pairRequired: 'required together',
    commaSeparated: 'comma-separated',
    default100: 'default 100',
    headCheck: 'head check',
    default50Max100: 'default 50, <=100',
    previousEndCursor: 'endCursor of the previous page',
    defaultRepoRoot: 'default: repo root',
    emptyArrayAllowed: 'may be an empty array',
    requiredWhenUpdating: 'required when updating a file',
    noParameters: 'no parameters',
    branchOrStart: 'branch or starting point',
    stringValues: 'values must be strings',
    defaultBranchDefault: 'default: the repo default_branch',
    contentEnum: 'content enum',
  },
  ja: {
    pairRequired: 'ペアで必須',
    commaSeparated: 'カンマ区切り',
    default100: '既定値 100',
    headCheck: 'head の照合',
    default50Max100: '既定値 50、100 以下',
    previousEndCursor: '前のページの endCursor',
    defaultRepoRoot: '既定値: リポジトリのルート',
    emptyArrayAllowed: '空配列も可',
    requiredWhenUpdating: '既存ファイルの更新時は必須',
    noParameters: 'パラメータなし',
    branchOrStart: 'ブランチまたは起点',
    stringValues: '値は string であること',
    defaultBranchDefault: '既定値: リポジトリの default_branch',
    contentEnum: 'content の列挙値',
  },
  ko: {
    pairRequired: '쌍으로 필수',
    commaSeparated: '쉼표로 구분',
    default100: '기본값 100',
    headCheck: 'head 확인',
    default50Max100: '기본값 50, 100 이하',
    previousEndCursor: '이전 페이지의 endCursor',
    defaultRepoRoot: '기본값: 저장소 루트',
    emptyArrayAllowed: '빈 배열 가능',
    requiredWhenUpdating: '기존 파일 수정 시 필수',
    noParameters: '파라미터 없음',
    branchOrStart: '브랜치 또는 시작점',
    stringValues: '값은 string이어야 함',
    defaultBranchDefault: '기본값: 저장소의 default_branch',
    contentEnum: 'content 열거값',
  },
};

var CATEGORY_DESC = {
  en: {
    issues: 'issues and comments / labels / assignees / sub-issues',
    pulls: 'full PR lifecycle: create / files and commits / reviews and line comments / threads / merge',
    repo: 'repo metadata / branches / read and write file contents / collaborators / topics / create repo',
    meta: 'current user and the GraphQL escape hatch',
    events: 'user / org / repo event streams',
    commits: 'commit list / details / compare / check runs',
    search: 'site-wide search: repos / issues / commits / code / users',
    users: 'user profiles / orgs / accessible repos',
    actions: 'GitHub Actions: workflows / runs / jobs / artifacts / log download',
    releases: 'releases and assets',
    notifications: 'notifications',
    orgs: 'org members / teams',
    gists: 'gists',
    git_data: 'low-level git objects: refs / trees / commits / atomic multi-file commit',
    reactions: 'reactions on issues / comments / review comments',
  },
  ja: {
    issues: 'issue とコメント / label / assignee / サブ issue',
    pulls: 'PR のライフサイクル全体: 作成 / ファイルと commit / review と行コメント / スレッド / マージ',
    repo: 'リポジトリのメタデータ / ブランチ / ファイル内容の読み書き / コラボレーター / topics / リポジトリ作成',
    meta: '現在のユーザーと GraphQL の逃げ道',
    events: 'ユーザー / org / リポジトリのイベントストリーム',
    commits: 'commit 一覧 / 詳細 / 比較 / check runs',
    search: 'GitHub 全体の検索: リポジトリ / issue / commit / コード / ユーザー',
    users: 'ユーザープロフィール / org / アクセス可能なリポジトリ',
    actions: 'GitHub Actions: workflow / run / job / artifact / ログのダウンロード',
    releases: 'release とアセット',
    notifications: '通知',
    orgs: 'org メンバー / チーム',
    gists: 'gist',
    git_data: '低レベルの git オブジェクト: ref / tree / commit / 複数ファイルのアトミックなコミット',
    reactions: 'issue / コメント / 行コメントの reaction',
  },
  ko: {
    issues: 'issue와 댓글 / label / assignee / 하위 issue',
    pulls: 'PR 전체 수명 주기: 생성 / 파일과 commit / review와 라인 댓글 / 스레드 / 병합',
    repo: '저장소 메타데이터 / 브랜치 / 파일 내용 읽기·쓰기 / 협업자 / topics / 저장소 생성',
    meta: '현재 사용자와 GraphQL 우회 수단',
    events: '사용자 / org / 저장소 이벤트 스트림',
    commits: 'commit 목록 / 상세 / 비교 / check runs',
    search: 'GitHub 전체 검색: 저장소 / issue / commit / 코드 / 사용자',
    users: '사용자 프로필 / org / 접근 가능한 저장소',
    actions: 'GitHub Actions: workflow / run / job / artifact / 로그 다운로드',
    releases: 'release와 자산',
    notifications: '알림',
    orgs: 'org 멤버 / 팀',
    gists: 'gist',
    git_data: '저수준 git 객체: ref / tree / commit / 여러 파일 원자적 커밋',
    reactions: 'issue / 댓글 / 라인 댓글의 reaction',
  },
};

var OP_DESC = {
  en: {
    list_issues: 'List issues (note: PRs also show up in the results, with a pull_request field)',
    get_issue: 'Get a single issue',
    create_issue: 'Create an issue (write; confirm the content with the user first)',
    list_issue_comments: 'List comments on an issue/PR',
    add_issue_comment: 'Add a comment to an issue/PR (write)',
    update_issue_labels: 'Add/remove labels incrementally (reads the current labels, merges, writes back)',
    update_issue: 'Update an issue (title/body/open-close/labels/assignees; write)',
    add_issue_assignees: 'Add assignees',
    remove_issue_assignees: 'Remove assignees',
    add_issue_labels: 'Add labels (keeps the existing ones)',
    remove_issue_label: 'Remove a single label',
    get_label: 'Get a single label definition from the repo',
    list_sub_issues: 'List sub-issues',
    add_sub_issue: 'Add a sub-issue (sub_issue_id is the global issue id, not the number)',
    list_pull_requests: 'List PRs',
    get_pull_request: 'Get a single PR (with merged / draft / mergeable state)',
    create_pull_request: 'Create a PR (write; for a cross-fork head use "owner:branch")',
    list_pull_request_files: 'List files changed in a PR (with patch; paginate for large PRs)',
    list_pull_request_commits: 'List commits in a PR',
    list_pull_request_reviews: 'List reviews (approve / request_changes / comment; node_id is what line comments on a pending review need)',
    list_pull_request_review_comments: 'List inline code comments',
    merge_pull_request: 'Merge a PR (write; confirm with the user first)',
    update_pull_request: 'Update a PR (title/body/open-close/base; write)',
    create_pull_request_review: 'Submit a review in one call (may include inline comments; write)',
    create_pull_request_review_comment: 'Create a single inline comment (write)',
    reply_pull_request_review_comment: 'Reply to an inline comment (finds the thread root automatically)',
    request_pull_request_reviewers: 'Request reviewers',
    remove_pull_request_reviewers: 'Remove requested reviewers',
    list_pull_request_requested_reviewers: 'List requested reviewers who have not reviewed yet',
    create_pending_pull_request_review: 'Start a pending review (then collect line comments with add_pending_pull_request_review_comment and submit at the end)',
    add_pending_pull_request_review_comment: 'Add an inline comment to a pending review (GraphQL; review_node_id is the node_id of the review, starting with PRR_)',
    submit_pending_pull_request_review: 'Submit a pending review (write)',
    delete_pending_pull_request_review: 'Delete a pending review',
    dismiss_pull_request_review: 'Dismiss a submitted review (write)',
    list_pull_request_review_threads: 'List review threads (GraphQL; with resolved/outdated, path/line, the first 50 comments of each thread, pagination cursor)',
    resolve_review_thread: 'Resolve a review thread (GraphQL; thread_id is the node id starting with PRRT_)',
    unresolve_review_thread: 'Unresolve a review thread (GraphQL)',
    update_pull_request_branch: 'Merge the latest base code into the PR head branch (202 accepted)',
    request_copilot_review: 'Add the Copilot bot as a reviewer',
    list_branches: 'List branches (single page of 100)',
    list_labels: 'List repo labels (single page of 100)',
    ensure_labels: 'Ensure labels exist (missing ones are created with the default color, existing ones are skipped)',
    get_repo: 'Repo metadata (default branch/visibility/permissions, etc.)',
    list_tags: 'List tags',
    get_readme: 'Get the README (content is base64)',
    list_deployments: 'List deployments',
    get_contents: 'Get file contents (base64) or a directory listing; large files (>1MB) return only download_url metadata',
    list_repo_topics: 'List topics',
    replace_repo_topics: 'Replace all topics (write; an empty array clears them)',
    list_repo_contributors: 'List contributors',
    list_repo_languages: 'Language byte counts',
    list_stargazers: 'List stargazers',
    list_forks: 'List forks',
    create_fork: 'Fork the repo (write)',
    list_repo_collaborators: 'List collaborators',
    list_repo_hooks: 'List webhooks (single page of 100)',
    list_branch_protection: 'Get branch protection settings (404 when unprotected)',
    create_or_update_file_contents: 'Create/update a single file (content must be base64; updating an existing file requires its current blob sha; write)',
    delete_file: 'Delete a single file (requires the current blob sha; write)',
    create_repository: 'Create a repository (write; created under that org when org is given)',
    get_tag: 'Get the ref object of a tag',
    get_current_user: 'User behind the current token (login / id / profile page)',
    graphql: 'Generic GraphQL escape hatch (for queries/mutations that REST does not cover)',
    list_user_events: 'Events of a user (as visible to the authenticated user, including your own private events)',
    list_user_public_events: 'Public events of a user',
    list_org_events: 'Public event stream of an org',
    list_authenticated_user_org_events: 'Events in an org visible to the authenticated user (including private repos)',
    list_repo_events: 'Repo events',
    list_commits: 'List commits (filter by author/path/time)',
    get_commit: 'Get a single commit (with stats and file diffs)',
    compare_commits: 'Compare two refs (base...head)',
    list_check_runs_for_ref: 'List check runs for a ref (CI status)',
    search_repos: 'Search repositories (GitHub search syntax)',
    search_issues_and_prs: 'Search issues and PRs (narrow with is:pr / is:issue / repo:owner/name in q)',
    search_commits: 'Search commits',
    search_code: 'Search code (narrow with repo: / path: / language: in q)',
    search_users: 'Search users',
    get_user: 'Public user profile',
    list_user_orgs: 'Public orgs of a user (single page of 100)',
    list_authenticated_user_repos: 'Repos the authenticated user can access',
    list_org_repos: 'Repos of an org',
    list_workflow_runs: 'List workflow runs',
    get_workflow_run: 'Get a single run',
    list_workflow_run_jobs: 'List jobs in a run (with step status)',
    list_workflows: 'List workflow definitions',
    dispatch_workflow: 'Trigger workflow_dispatch (write; workflow can be a file name or a numeric id)',
    rerun_workflow_run: 'Re-run a run (write)',
    cancel_workflow_run: 'Cancel a run (write)',
    list_workflow_run_artifacts: 'List artifacts of a run',
    download_artifact: 'Download an artifact zip to a local user directory (the main agent must pass the absolute path of the target directory in the top-level save_dir parameter of ghost_call)',
    download_run_logs: 'Download the full log zip of a run to a local user directory (requires the top-level save_dir parameter of ghost_call)',
    list_releases: 'List releases',
    get_release_by_tag: 'Get a release by tag',
    create_release: 'Create a release (write)',
    get_latest_release: 'Latest published release',
    list_release_assets: 'List release assets',
    list_notifications: 'List notifications',
    mark_notification_read: 'Mark a notification thread as read',
    list_org_members: 'Org members',
    list_org_teams: 'Org teams',
    list_team_members: 'Team members',
    list_team_repos: 'Repos a team can access',
    list_gists: 'List gists of the authenticated user',
    get_gist: 'Get a single gist (with file contents)',
    get_ref: 'Get a single ref (e.g. heads/main, tags/v1.0.0)',
    create_branch: 'Create a branch (from_sha or from_ref, pick one; when both are omitted, branch from the repo default branch)',
    create_ref: 'Create a raw ref (refs/heads/... or refs/tags/...)',
    get_tree: 'Get a git tree (recursive=true fetches the whole tree; watch the truncated flag)',
    create_tree: 'Create a git tree',
    create_commit: 'Create a commit object (does not move any ref; to update a branch use create_ref / push_files)',
    push_files: 'Push several files atomically as one commit to a branch (read head -> create blob/tree/commit -> fast-forward ref; write)',
    list_issue_reactions: 'List reactions on an issue (' + REACTION_DOC + ')',
    add_issue_reaction: 'Add a reaction to an issue',
    list_issue_comment_reactions: 'List reactions on an issue comment',
    add_issue_comment_reaction: 'Add a reaction to an issue comment',
    list_pull_request_review_comment_reactions: 'List reactions on a PR review comment',
    add_pull_request_review_comment_reaction: 'Add a reaction to a PR review comment',
  },
  ja: {
    list_issues: 'issue を一覧表示(PR も pull_request フィールド付きで結果に含まれる点に注意)',
    get_issue: 'issue を 1 件取得',
    create_issue: 'issue を作成(書き込み操作。内容は先にユーザーに確認する)',
    list_issue_comments: 'issue/PR のコメントを一覧表示',
    add_issue_comment: 'issue/PR にコメントを追加(書き込み操作)',
    update_issue_labels: 'label を差分で追加・削除(現在の label を読み、マージして書き戻す)',
    update_issue: 'issue を更新(タイトル/本文/オープン・クローズ/label/assignee。書き込み操作)',
    add_issue_assignees: 'assignee を追加',
    remove_issue_assignees: 'assignee を削除',
    add_issue_labels: 'label を追加(既存の label はそのまま)',
    remove_issue_label: 'label を 1 つ削除',
    get_label: 'リポジトリの label 定義を 1 件取得',
    list_sub_issues: 'サブ issue を一覧表示',
    add_sub_issue: 'サブ issue を追加(sub_issue_id は issue のグローバル id で、number ではない)',
    list_pull_requests: 'PR を一覧表示',
    get_pull_request: 'PR を 1 件取得(merged / draft / mergeable の状態を含む)',
    create_pull_request: 'PR を作成(書き込み操作。fork をまたぐ head は "owner:branch" と書く)',
    list_pull_request_files: 'PR の変更ファイルを一覧表示(patch を含む。大きな PR はページングすること)',
    list_pull_request_commits: 'PR の commit を一覧表示',
    list_pull_request_reviews: 'review を一覧表示(approve / request_changes / comment。node_id は pending review への行コメントで使う)',
    list_pull_request_review_comments: 'インラインのコードコメントを一覧表示',
    merge_pull_request: 'PR をマージ(書き込み操作。先にユーザーに確認する)',
    update_pull_request: 'PR を更新(タイトル/本文/オープン・クローズ/base。書き込み操作)',
    create_pull_request_review: 'review を一度に提出(インラインコメントも付けられる。書き込み操作)',
    create_pull_request_review_comment: 'インラインコメントを 1 件作成(書き込み操作)',
    reply_pull_request_review_comment: 'インラインコメントに返信(スレッドの起点は自動で特定)',
    request_pull_request_reviewers: 'reviewer をリクエスト',
    remove_pull_request_reviewers: 'リクエスト済みの reviewer を取り消す',
    list_pull_request_requested_reviewers: 'リクエスト済みでまだ review していない reviewer を一覧表示',
    create_pending_pull_request_review: 'pending review を開始(その後 add_pending_pull_request_review_comment で行コメントをためて、最後に submit)',
    add_pending_pull_request_review_comment: 'pending review にインラインコメントを追加(GraphQL。review_node_id は review の node_id で PRR_ から始まる)',
    submit_pending_pull_request_review: 'pending review を提出(書き込み操作)',
    delete_pending_pull_request_review: 'pending review を削除',
    dismiss_pull_request_review: '提出済みの review を dismiss(書き込み操作)',
    list_pull_request_review_threads: 'review スレッドを一覧表示(GraphQL。resolved/outdated、path/line、各スレッドの先頭 50 件のコメント、ページング用 cursor を含む)',
    resolve_review_thread: 'review スレッドを resolve(GraphQL。thread_id は PRRT_ から始まる node id)',
    unresolve_review_thread: 'review スレッドを unresolve(GraphQL)',
    update_pull_request_branch: 'base の最新コードを PR の head ブランチに取り込む(202 で受理)',
    request_copilot_review: 'Copilot bot を reviewer に追加',
    list_branches: 'ブランチを一覧表示(1 ページ 100 件)',
    list_labels: 'リポジトリの label を一覧表示(1 ページ 100 件)',
    ensure_labels: 'label の存在を保証(ないものは既定色で作成、既存のものはスキップ)',
    get_repo: 'リポジトリのメタ情報(既定ブランチ/公開範囲/権限など)',
    list_tags: 'tag を一覧表示',
    get_readme: 'README を取得(content は base64)',
    list_deployments: 'deployment を一覧表示',
    get_contents: 'ファイル内容(base64)またはディレクトリ一覧を取得。大きなファイル(>1MB)は download_url のメタデータのみ返す',
    list_repo_topics: 'topics を一覧表示',
    replace_repo_topics: 'topics をまとめて置き換え(書き込み操作。空配列を渡すとすべて消去)',
    list_repo_contributors: 'コントリビューターを一覧表示',
    list_repo_languages: '言語ごとのバイト数',
    list_stargazers: 'star したユーザーを一覧表示',
    list_forks: 'fork を一覧表示',
    create_fork: 'リポジトリを fork(書き込み操作)',
    list_repo_collaborators: 'コラボレーターを一覧表示',
    list_repo_hooks: 'webhook を一覧表示(1 ページ 100 件)',
    list_branch_protection: 'ブランチ保護設定を取得(保護されていなければ 404)',
    create_or_update_file_contents: 'ファイルを 1 つ作成/更新(content は base64 必須。既存ファイルの更新には現在の blob sha が必要。書き込み操作)',
    delete_file: 'ファイルを 1 つ削除(現在の blob sha が必要。書き込み操作)',
    create_repository: 'リポジトリを作成(書き込み操作。org を指定するとその org の下に作成)',
    get_tag: 'tag の ref オブジェクトを取得',
    get_current_user: '現在の token に対応するユーザー(login / id / プロフィールページ)',
    graphql: '汎用の GraphQL 逃げ道(REST でカバーできないクエリ/ミューテーションに使う)',
    list_user_events: 'ユーザーのイベント(認証ユーザーから見える範囲。自分の非公開イベントを含む)',
    list_user_public_events: 'ユーザーの公開イベント',
    list_org_events: 'org の公開イベントストリーム',
    list_authenticated_user_org_events: 'org 内で認証ユーザーから見えるイベント(非公開リポジトリを含む)',
    list_repo_events: 'リポジトリのイベント',
    list_commits: 'commit を一覧表示(作成者/パス/期間で絞り込み可)',
    get_commit: 'commit を 1 件取得(stats とファイルの diff を含む)',
    compare_commits: '2 つの ref を比較(base...head)',
    list_check_runs_for_ref: 'ref の check runs を一覧表示(CI の状態)',
    search_repos: 'リポジトリを検索(GitHub の検索構文)',
    search_issues_and_prs: 'issue と PR を検索(q で is:pr / is:issue / repo:owner/name を使って絞り込む)',
    search_commits: 'commit を検索',
    search_code: 'コードを検索(q で repo: / path: / language: を使って絞り込む)',
    search_users: 'ユーザーを検索',
    get_user: 'ユーザーの公開プロフィール',
    list_user_orgs: 'ユーザーの公開 org(1 ページ 100 件)',
    list_authenticated_user_repos: '認証ユーザーがアクセスできるリポジトリ',
    list_org_repos: 'org のリポジトリ',
    list_workflow_runs: 'workflow run を一覧表示',
    get_workflow_run: 'run を 1 件取得',
    list_workflow_run_jobs: 'run 内の job を一覧表示(steps の状態を含む)',
    list_workflows: 'workflow 定義を一覧表示',
    dispatch_workflow: 'workflow_dispatch を実行(書き込み操作。workflow にはファイル名か数値 id を渡せる)',
    rerun_workflow_run: 'run を再実行(書き込み操作)',
    cancel_workflow_run: 'run をキャンセル(書き込み操作)',
    list_workflow_run_artifacts: 'run の artifact を一覧表示',
    download_artifact: 'artifact の zip をユーザーのローカルディレクトリにダウンロード(メイン agent が ghost_call を呼ぶとき、保存先ディレクトリの絶対パスをトップレベルの save_dir パラメータに入れる必要がある)',
    download_run_logs: 'run の全ログ zip をユーザーのローカルディレクトリにダウンロード(ghost_call のトップレベル save_dir パラメータが必要)',
    list_releases: 'release を一覧表示',
    get_release_by_tag: 'tag から release を取得',
    create_release: 'release を作成(書き込み操作)',
    get_latest_release: '最新の公開済み release',
    list_release_assets: 'release のアセットを一覧表示',
    list_notifications: '通知を一覧表示',
    mark_notification_read: '通知スレッドを既読にする',
    list_org_members: 'org のメンバー',
    list_org_teams: 'org のチーム',
    list_team_members: 'チームのメンバー',
    list_team_repos: 'チームがアクセスできるリポジトリ',
    list_gists: '認証ユーザーの gist を一覧表示',
    get_gist: 'gist を 1 件取得(ファイル内容を含む)',
    get_ref: 'ref を 1 件取得(例: heads/main、tags/v1.0.0)',
    create_branch: 'ブランチを作成(from_sha と from_ref はどちらか一方。両方省略するとリポジトリの既定ブランチから作成)',
    create_ref: '生の ref を作成(refs/heads/… または refs/tags/…)',
    get_tree: 'git tree を取得(recursive=true でツリー全体を取得。truncated フラグに注意)',
    create_tree: 'git tree を作成',
    create_commit: 'commit オブジェクトを作成(ref は動かさない。ブランチを更新するには create_ref / push_files を使う)',
    push_files: '複数ファイルを 1 つの commit としてアトミックにブランチへ push(head を読む → blob/tree/commit を作成 → ref を fast-forward。書き込み操作)',
    list_issue_reactions: 'issue の reaction を一覧表示(' + REACTION_DOC + ')',
    add_issue_reaction: 'issue に reaction を追加',
    list_issue_comment_reactions: 'issue コメントの reaction を一覧表示',
    add_issue_comment_reaction: 'issue コメントに reaction を追加',
    list_pull_request_review_comment_reactions: 'PR の行コメントの reaction を一覧表示',
    add_pull_request_review_comment_reaction: 'PR の行コメントに reaction を追加',
  },
  ko: {
    list_issues: 'issue 목록 조회(PR도 pull_request 필드와 함께 결과에 포함되니 주의)',
    get_issue: 'issue 1건 조회',
    create_issue: 'issue 생성(쓰기 작업. 내용은 먼저 사용자에게 확인)',
    list_issue_comments: 'issue/PR 댓글 목록 조회',
    add_issue_comment: 'issue/PR에 댓글 추가(쓰기 작업)',
    update_issue_labels: 'label을 증분으로 추가·삭제(현재 label을 읽고 병합해 다시 기록)',
    update_issue: 'issue 수정(제목/본문/열기·닫기/label/assignee. 쓰기 작업)',
    add_issue_assignees: 'assignee 추가',
    remove_issue_assignees: 'assignee 제거',
    add_issue_labels: 'label 추가(기존 label은 유지)',
    remove_issue_label: 'label 1개 삭제',
    get_label: '저장소의 label 정의 1건 조회',
    list_sub_issues: '하위 issue 목록 조회',
    add_sub_issue: '하위 issue 추가(sub_issue_id는 issue의 전역 id이며 number가 아님)',
    list_pull_requests: 'PR 목록 조회',
    get_pull_request: 'PR 1건 조회(merged / draft / mergeable 상태 포함)',
    create_pull_request: 'PR 생성(쓰기 작업. fork 간 head는 "owner:branch" 형식)',
    list_pull_request_files: 'PR 변경 파일 목록 조회(patch 포함. 큰 PR은 페이지를 나눠 조회)',
    list_pull_request_commits: 'PR의 commit 목록 조회',
    list_pull_request_reviews: 'review 목록 조회(approve / request_changes / comment. node_id는 pending review 라인 댓글에 사용)',
    list_pull_request_review_comments: '인라인 코드 댓글 목록 조회',
    merge_pull_request: 'PR 병합(쓰기 작업. 먼저 사용자에게 확인)',
    update_pull_request: 'PR 수정(제목/본문/열기·닫기/base. 쓰기 작업)',
    create_pull_request_review: 'review를 한 번에 제출(인라인 댓글 포함 가능. 쓰기 작업)',
    create_pull_request_review_comment: '인라인 댓글 1건 작성(쓰기 작업)',
    reply_pull_request_review_comment: '인라인 댓글에 답글(스레드 루트를 자동으로 찾음)',
    request_pull_request_reviewers: 'reviewer 요청',
    remove_pull_request_reviewers: '요청한 reviewer 제거',
    list_pull_request_requested_reviewers: '요청했지만 아직 review하지 않은 reviewer 목록',
    create_pending_pull_request_review: 'pending review 시작(이후 add_pending_pull_request_review_comment로 라인 댓글을 모은 뒤 마지막에 submit)',
    add_pending_pull_request_review_comment: 'pending review에 인라인 댓글 추가(GraphQL. review_node_id는 review의 node_id로 PRR_로 시작)',
    submit_pending_pull_request_review: 'pending review 제출(쓰기 작업)',
    delete_pending_pull_request_review: 'pending review 삭제',
    dismiss_pull_request_review: '제출된 review를 dismiss(쓰기 작업)',
    list_pull_request_review_threads: 'review 스레드 목록 조회(GraphQL. resolved/outdated, path/line, 스레드별 처음 50개 댓글, 페이지 cursor 포함)',
    resolve_review_thread: 'review 스레드 resolve(GraphQL. thread_id는 PRRT_로 시작하는 node id)',
    unresolve_review_thread: 'review 스레드 unresolve(GraphQL)',
    update_pull_request_branch: 'base의 최신 코드를 PR head 브랜치에 병합(202로 접수)',
    request_copilot_review: 'Copilot bot을 reviewer로 추가',
    list_branches: '브랜치 목록 조회(한 페이지 100개)',
    list_labels: '저장소 label 목록 조회(한 페이지 100개)',
    ensure_labels: 'label이 존재하도록 보장(없는 것은 기본 색으로 생성, 있는 것은 건너뜀)',
    get_repo: '저장소 메타 정보(기본 브랜치/공개 범위/권한 등)',
    list_tags: 'tag 목록 조회',
    get_readme: 'README 조회(content는 base64)',
    list_deployments: 'deployment 목록 조회',
    get_contents: '파일 내용(base64) 또는 디렉터리 목록 조회. 큰 파일(>1MB)은 download_url 메타데이터만 반환',
    list_repo_topics: 'topics 목록 조회',
    replace_repo_topics: 'topics 전체 교체(쓰기 작업. 빈 배열을 넘기면 모두 삭제)',
    list_repo_contributors: '기여자 목록 조회',
    list_repo_languages: '언어별 바이트 통계',
    list_stargazers: 'star한 사용자 목록 조회',
    list_forks: 'fork 목록 조회',
    create_fork: '저장소 fork(쓰기 작업)',
    list_repo_collaborators: '협업자 목록 조회',
    list_repo_hooks: 'webhook 목록 조회(한 페이지 100개)',
    list_branch_protection: '브랜치 보호 설정 조회(보호되지 않았으면 404)',
    create_or_update_file_contents: '파일 1개 생성/수정(content는 반드시 base64. 기존 파일 수정 시 현재 blob sha 필요. 쓰기 작업)',
    delete_file: '파일 1개 삭제(현재 blob sha 필요. 쓰기 작업)',
    create_repository: '저장소 생성(쓰기 작업. org를 지정하면 해당 org 아래에 생성)',
    get_tag: 'tag의 ref 객체 조회',
    get_current_user: '현재 token에 해당하는 사용자(login / id / 프로필 페이지)',
    graphql: '범용 GraphQL 우회 수단(REST로 처리할 수 없는 쿼리/뮤테이션에 사용)',
    list_user_events: '사용자 이벤트(인증된 사용자에게 보이는 범위. 자신의 비공개 이벤트 포함)',
    list_user_public_events: '사용자의 공개 이벤트',
    list_org_events: 'org의 공개 이벤트 스트림',
    list_authenticated_user_org_events: 'org 안에서 인증된 사용자에게 보이는 이벤트(비공개 저장소 포함)',
    list_repo_events: '저장소 이벤트',
    list_commits: 'commit 목록 조회(작성자/경로/기간으로 필터 가능)',
    get_commit: 'commit 1건 조회(stats와 파일 diff 포함)',
    compare_commits: '두 ref 비교(base...head)',
    list_check_runs_for_ref: 'ref의 check runs 목록 조회(CI 상태)',
    search_repos: '저장소 검색(GitHub 검색 문법)',
    search_issues_and_prs: 'issue와 PR 검색(q에 is:pr / is:issue / repo:owner/name으로 범위 축소)',
    search_commits: 'commit 검색',
    search_code: '코드 검색(q에 repo: / path: / language:로 범위 축소)',
    search_users: '사용자 검색',
    get_user: '사용자 공개 프로필',
    list_user_orgs: '사용자의 공개 org(한 페이지 100개)',
    list_authenticated_user_repos: '인증된 사용자가 접근할 수 있는 저장소',
    list_org_repos: 'org의 저장소',
    list_workflow_runs: 'workflow run 목록 조회',
    get_workflow_run: 'run 1건 조회',
    list_workflow_run_jobs: 'run의 job 목록 조회(steps 상태 포함)',
    list_workflows: 'workflow 정의 목록 조회',
    dispatch_workflow: 'workflow_dispatch 실행(쓰기 작업. workflow에는 파일 이름 또는 숫자 id 전달 가능)',
    rerun_workflow_run: 'run 재실행(쓰기 작업)',
    cancel_workflow_run: 'run 취소(쓰기 작업)',
    list_workflow_run_artifacts: 'run의 artifact 목록 조회',
    download_artifact: 'artifact zip을 사용자 로컬 디렉터리로 다운로드(메인 agent가 ghost_call을 호출할 때 저장할 디렉터리의 절대 경로를 최상위 save_dir 파라미터에 넣어야 함)',
    download_run_logs: 'run 전체 로그 zip을 사용자 로컬 디렉터리로 다운로드(ghost_call 최상위 save_dir 파라미터 필요)',
    list_releases: 'release 목록 조회',
    get_release_by_tag: 'tag로 release 조회',
    create_release: 'release 생성(쓰기 작업)',
    get_latest_release: '최신 게시 release',
    list_release_assets: 'release 자산 목록 조회',
    list_notifications: '알림 목록 조회',
    mark_notification_read: '알림 스레드를 읽음으로 표시',
    list_org_members: 'org 멤버',
    list_org_teams: 'org 팀',
    list_team_members: '팀 멤버',
    list_team_repos: '팀이 접근할 수 있는 저장소',
    list_gists: '인증된 사용자의 gist 목록 조회',
    get_gist: 'gist 1건 조회(파일 내용 포함)',
    get_ref: 'ref 1건 조회(예: heads/main, tags/v1.0.0)',
    create_branch: '브랜치 생성(from_sha와 from_ref 중 하나만. 둘 다 생략하면 저장소 기본 브랜치에서 생성)',
    create_ref: '원시 ref 생성(refs/heads/… 또는 refs/tags/…)',
    get_tree: 'git tree 조회(recursive=true면 전체 트리. truncated 플래그 주의)',
    create_tree: 'git tree 생성',
    create_commit: 'commit 객체 생성(ref는 움직이지 않음. 브랜치를 갱신하려면 create_ref / push_files 사용)',
    push_files: '여러 파일을 하나의 commit으로 브랜치에 원자적으로 push(head 읽기 → blob/tree/commit 생성 → ref fast-forward. 쓰기 작업)',
    list_issue_reactions: 'issue의 reaction 목록 조회(' + REACTION_DOC + ')',
    add_issue_reaction: 'issue에 reaction 추가',
    list_issue_comment_reactions: 'issue 댓글의 reaction 목록 조회',
    add_issue_comment_reaction: 'issue 댓글에 reaction 추가',
    list_pull_request_review_comment_reactions: 'PR 라인 댓글의 reaction 목록 조회',
    add_pull_request_review_comment_reaction: 'PR 라인 댓글에 reaction 추가',
  },
};

/** 把目录文本里的 {{key}} 注释按当前语言展开;缺的注释回退英文。 */
function renderCatalogText(text) {
  var notes = PARAM_NOTES[currentLocale()];
  return String(text).replace(/\{\{(\w+)\}\}/g, function (match, key) {
    if (Object.prototype.hasOwnProperty.call(notes, key)) return notes[key];
    return Object.prototype.hasOwnProperty.call(PARAM_NOTES[LOCALE_FALLBACK], key) ? PARAM_NOTES[LOCALE_FALLBACK][key] : match;
  });
}

/** zh-CN 用 op() 旁的原文,其余语言查对照表,缺项回退英文。 */
function localizedCatalog(table, zhText, key) {
  if (currentLocale() === 'zh-CN') return renderCatalogText(zhText);
  var own = table[currentLocale()];
  if (own && Object.prototype.hasOwnProperty.call(own, key)) return renderCatalogText(own[key]);
  return renderCatalogText(table[LOCALE_FALLBACK][key]);
}

function categoryDesc(cat) {
  return localizedCatalog(CATEGORY_DESC, CATEGORIES[cat], cat);
}

function opDesc(name) {
  return localizedCatalog(OP_DESC, OPS[name].desc, name);
}

function opParams(name) {
  return renderCatalogText(OPS[name].params);
}

/* ── list_tools / call_tool 元工具 ─────────────────────────────────── */

function listTools(args) {
  var category = args && args.category ? String(args.category) : '';
  if (!category) {
    var overview = {};
    for (var cat in CATEGORIES) {
      if (!Object.prototype.hasOwnProperty.call(CATEGORIES, cat)) continue;
      overview[cat] = { count: 0, description: categoryDesc(cat) };
    }
    for (var name in OPS) {
      if (!Object.prototype.hasOwnProperty.call(OPS, name)) continue;
      overview[OPS[name].cat].count++;
    }
    return {
      ok: true,
      result: {
        categories: overview,
        hint: t('overviewHint'),
      },
    };
  }
  if (!CATEGORIES[category]) {
    return { ok: false, message: t('unknownCategory', { category: category, available: Object.keys(CATEGORIES).join(' / ') }) };
  }
  var tools = [];
  for (var n in OPS) {
    if (!Object.prototype.hasOwnProperty.call(OPS, n)) continue;
    if (OPS[n].cat !== category) continue;
    tools.push({ name: n, description: opDesc(n), params: opParams(n) });
  }
  return {
    ok: true,
    result: { category: category, tools: tools, hint: t('categoryHint') },
  };
}

async function callTool(args, callId) {
  var name = args && args.name ? String(args.name) : '';
  if (!name) return fail(t('requiredName'));
  var entry = OPS[name];
  if (!entry) {
    return fail(t('unknownOperation', { name: name, categories: Object.keys(CATEGORIES).join(' / ') }));
  }
  var inner = args.args && typeof args.args === 'object' ? args.args : {};
  // save_dir / dir 票据由主机注入在 call_tool 这一层,下传给具体操作。
  if (args.save_deposit) inner.save_deposit = args.save_deposit;
  if (args.dir_deposit) inner.dir_deposit = args.dir_deposit;
  var out = await entry.run(inner, callId);
  if (out.err) {
    // 失败带上参数说明,供 AI 自纠重试(两段式约定)。
    return fail(t('withOperationParams', { error: out.err, params: opParams(name) }));
  }
  if (out.result) return { ok: true, result: out.result };
  var outFile = typeof args.out_file === 'string' && args.out_file ? args.out_file : null;
  return deliver(out.data, Boolean(args.raw), outFile, callId);
}

/* ── PR 卡片(pr_card)─────────────────────────────────────────────────
 * Agent 想问用户要不要发 PR 时调用;发出后同一张卡片接着显示 PR 状态和后续操作。
 * - 宿主卡片沙箱没有脚本、SVG 和 class:图标用 CSS 画,按钮文字由 aria-label 经
 *   ::before 生成——手机端只投影纯文本 + 原生按钮,正文里不会混进按钮字;
 * - 发 PR / 跟进 / 停止:凭点击票据让本任务的 Agent 接着做(agent.run
 *   continue;[UI_ACTION_TRIGGER] 前缀让这条代发消息不在对话里显示,卡片本身
 *   显示进度);查看改动与设置开关只在本地重画卡片;
 * - 卡片状态按 card_id(首次调用的 callId)存在私有数据目录,两项设置存 /kv;
 *   之后的 pr_card 调用带 sourceCallId 原地更新原卡片。
 * ──────────────────────────────────────────────────────────────────── */

var PR_CARD_DIR = 'pr-cards';
/** 私有目录最多保留多少张卡片的状态;超出删最旧的(被删的旧卡片点击后不再响应)。 */
var PR_CARD_KEEP = 200;
var PR_CARD_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
var PR_REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
var PR_FILES_KEPT = 50;
var PR_TITLE_MAX = 120;
var PR_TRIGGER = '[UI_ACTION_TRIGGER]';

/* 同一张卡片可能同时收到工具调用和按钮点击;全部串行,状态不互相覆盖。 */
var prQueue = Promise.resolve();

function enqueuePr(fn) {
  var run = prQueue.then(fn);
  prQueue = run.catch(function () {});
  return run;
}

function prEsc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* ── 卡片状态(私有数据目录)与设置(/kv) ── */

function prCardPath(id) {
  return PR_CARD_DIR + '/' + id + '.json';
}

async function readPrCard(id) {
  var r = await cindy.send({ type: 'fs-request', root: 'data', op: 'read', path: prCardPath(id) });
  if (!r || !r.ok) return null;
  try {
    var card = JSON.parse(r.content);
    return card && card.id === id ? card : null;
  } catch (e) {
    return null;
  }
}

async function savePrCard(card) {
  var r = await cindy.send({
    type: 'fs-request', root: 'data', op: 'write',
    path: prCardPath(card.id), content: JSON.stringify(card),
  });
  return Boolean(r && r.ok);
}

async function prunePrCards() {
  var r = await cindy.send({ type: 'fs-request', root: 'data', op: 'list', path: PR_CARD_DIR });
  if (!r || !r.ok || !Array.isArray(r.entries) || r.entries.length <= PR_CARD_KEEP) return;
  var stale = r.entries
    .slice()
    .sort(function (a, b) { return a.mtime - b.mtime; })
    .slice(0, r.entries.length - PR_CARD_KEEP);
  for (var i = 0; i < stale.length; i++) {
    await cindy.send({ type: 'fs-request', root: 'data', op: 'delete', path: stale[i].path });
  }
}

/* 读失败时不写:/kv 是整体替换,读不到就写会抹掉别的键。 */
async function readKv() {
  var r = await fetch('/kv');
  if (!r || r.ok === false) throw new Error('kv unavailable');
  var kv = await r.json();
  return kv && typeof kv === 'object' && !Array.isArray(kv) ? kv : {};
}

function prSettingsFrom(kv) {
  var s = kv && kv.prCard && typeof kv.prCard === 'object' ? kv.prCard : {};
  return { autoRename: s.autoRename === true, autoFollow: s.autoFollow === true };
}

async function readPrSettings() {
  try {
    return prSettingsFrom(await readKv());
  } catch (e) {
    return prSettingsFrom(null);
  }
}

async function togglePrSetting(key) {
  var kv = await readKv();
  var next = prSettingsFrom(kv);
  next[key] = !next[key];
  kv.prCard = next;
  var r = await fetch('/kv', { method: 'PUT', body: JSON.stringify(kv) });
  if (!r || r.ok === false) throw new Error('kv write failed');
  return next;
}

/* ── PR 状态(GitHub GraphQL,一次取齐卡片要显示的字段) ── */

var PR_STATUS_QUERY =
  'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){' +
  'number title url state isDraft merged mergeStateStatus reviewDecision baseRefName headRefName ' +
  'commits(last:1){nodes{commit{statusCheckRollup{state}}}} reviewThreads(first:100){nodes{isResolved}}}}}';

async function fetchPrStatus(repo, number, callId) {
  var slash = repo.indexOf('/');
  var r = await gql(PR_STATUS_QUERY, { owner: repo.slice(0, slash), name: repo.slice(slash + 1), number: number }, callId);
  if (r.err) return { err: r.err };
  var pr = r.data.repository && r.data.repository.pullRequest;
  if (!pr) return { err: t('status404') };
  var last = pr.commits && pr.commits.nodes && pr.commits.nodes[0];
  var rollup = last && last.commit && last.commit.statusCheckRollup;
  var threads = (pr.reviewThreads && pr.reviewThreads.nodes) || [];
  return {
    pr: {
      number: pr.number,
      title: pr.title || '',
      url: pr.url || '',
      state: pr.merged ? 'merged' : pr.state === 'CLOSED' ? 'closed' : 'open',
      draft: pr.isDraft === true,
      base: pr.baseRefName || '',
      head: pr.headRefName || '',
      ci: rollup ? rollup.state : null,
      openThreads: threads.filter(function (n) { return n && n.isResolved === false; }).length,
      mergeState: pr.mergeStateStatus || null,
      review: pr.reviewDecision || null,
    },
  };
}

/* ── 参数整理 ── */

function parsePrRef(value, repo) {
  var s = String(value).trim();
  var m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)(?:[/?#].*)?$/.exec(s);
  if (m) return { repo: m[1] + '/' + m[2], number: Number(m[3]) };
  m = /^#?(\d+)$/.exec(s);
  return m && repo ? { repo: repo, number: Number(m[1]) } : null;
}

function prCount(value) {
  var n = Number(value);
  return value !== null && value !== '' && Number.isInteger(n) && n >= 0 && n < 1e7 ? n : null;
}

function prFiles(list) {
  if (!Array.isArray(list)) return null;
  var out = [];
  for (var i = 0; i < list.length && out.length < PR_FILES_KEPT; i++) {
    var f = list[i];
    var p = f && typeof f === 'object' ? f.path : f;
    if (typeof p !== 'string' || !p.trim()) continue;
    out.push({
      path: p.trim().slice(0, 300),
      additions: f && typeof f === 'object' ? prCount(f.additions) : null,
      deletions: f && typeof f === 'object' ? prCount(f.deletions) : null,
    });
  }
  return out;
}

function prText(value) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 255) : '';
}

/** 改名用的任务标题:#号 + PR 标题(set_current_session_title 上限 120 字)。 */
function prTaskTitle(card) {
  return ('#' + card.pr.number + ' ' + (card.pr.title || card.repo)).slice(0, PR_TITLE_MAX);
}

function newPrCard(id, repo) {
  return {
    id: id, repo: repo, head: '', base: '', commits: null, files: null, filesTotal: null,
    stage: 'ask', publishingDraft: false, queued: false, pr: null,
    renamed: false, following: false, followedEver: false, pending: null,
    settingsOpen: false, note: null, settingsApplied: false,
  };
}

/* ── 渲染 ───────────────────────────────────────────────────────────────
 * 颜色全部取宿主注入的主题变量;PR 状态色不在宿主变量里,用 light-dark() 按
 * 宿主声明的 color-scheme 取浅/深两套值(与客户端 PR 状态色一致)。
 * ──────────────────────────────────────────────────────────────────── */

var PR_GREEN = 'light-dark(#2ea043,#3fb950)';
var PR_BLUE = '#417cdd';
var PR_HOVER = 'color-mix(in srgb,transparent,var(--text-primary) 7%)';
var PR_CSS =
  '<style>' +
  '*{box-sizing:border-box}' +
  'button{font:inherit;color:inherit;margin:0;padding:0;border:0;background:var(--bg,transparent);cursor:pointer;' +
  '-webkit-user-select:none;user-select:none;transition:background-color var(--motion-fast,120ms) var(--motion-ease-out,ease-out)}' +
  'button:hover:not(:disabled){background:var(--hover,var(--bg,transparent))}' +
  'button:disabled{cursor:default;opacity:.5}' +
  'button:focus-visible{outline:2px solid var(--focus-ring,#417cdd);outline-offset:2px}' +
  'button[data-ghost-action^="pr:"]::before{content:attr(aria-label)}' +
  'a{color:inherit;text-decoration:none}a:hover{text-decoration:underline;text-underline-offset:2px}' +
  'button[data-ghost-action="pr:stop"]{opacity:0;visibility:hidden;transition:opacity var(--motion-fast,120ms) var(--motion-ease-out,ease-out),visibility 0s linear var(--motion-fast,120ms)}' +
  'div:hover>div>button[data-ghost-action="pr:stop"],div:focus-within>div>button[data-ghost-action="pr:stop"]{opacity:1;visibility:visible;transition-delay:0s}' +
  '@keyframes prspin{to{transform:rotate(360deg)}}' +
  '</style>';

function prSpan(style) {
  return '<span style="position:absolute;' + style + '"></span>';
}

function prRing(cx, cy) {
  return prSpan('left:' + (cx - 2.4) + 'px;top:' + (cy - 2.4) + 'px;width:4.8px;height:4.8px;border:1.6px solid currentColor;border-radius:50%');
}

function prVLine(x, y1, y2) {
  return prSpan('left:' + (x - 0.8) + 'px;top:' + y1 + 'px;width:1.6px;height:' + (y2 - y1) + 'px;border-radius:1px;background:currentColor');
}

function prHLine(y, x1, x2) {
  return prSpan('left:' + x1 + 'px;top:' + (y - 0.8) + 'px;width:' + (x2 - x1) + 'px;height:1.6px;border-radius:1px;background:currentColor');
}

/** 16px 的 git 图形(分支 / PR / 草稿 / 已合并 / 已关闭 / 进行中),按 Lucide 的几何画。 */
function prGlyph(kind) {
  var stroke = '1.6px solid currentColor';
  var parts;
  if (kind === 'branch') {
    parts = prVLine(4, 2, 9.6) + prRing(12, 4) + prRing(4, 12) +
      prSpan('left:6.4px;top:6.4px;width:6.4px;height:6.4px;border-right:' + stroke + ';border-bottom:' + stroke + ';border-bottom-right-radius:6px');
  } else if (kind === 'spinner') {
    parts = prSpan('left:1px;top:1px;width:14px;height:14px;border:' + stroke + ';border-top-color:transparent;border-radius:50%;animation:prspin var(--motion-spinner-cycle,900ms) linear infinite');
  } else if (kind === 'merged') {
    parts = prRing(4, 4) + prVLine(4, 6.4, 14.4) + prRing(12, 12) +
      prSpan('left:3.2px;top:6px;width:6.4px;height:6.8px;border-left:' + stroke + ';border-bottom:' + stroke + ';border-bottom-left-radius:6px');
  } else {
    parts = prRing(4, 4) + prVLine(4, 6.4, 14.4) + prRing(12, 12);
    if (kind === 'draft') {
      parts += prVLine(12, 2.2, 4) + prVLine(12, 5.8, 7.6);
    } else if (kind === 'closed') {
      parts += prVLine(12, 6.8, 9.6) +
        prSpan('left:11.2px;top:0.8px;width:1.6px;height:4.6px;border-radius:1px;background:currentColor;transform:rotate(45deg)') +
        prSpan('left:11.2px;top:0.8px;width:1.6px;height:4.6px;border-radius:1px;background:currentColor;transform:rotate(-45deg)');
    } else {
      parts += prSpan('left:7.6px;top:3.2px;width:5.2px;height:6.4px;border-top:' + stroke + ';border-right:' + stroke + ';border-top-right-radius:2.4px');
    }
  }
  return '<span style="position:relative;display:block;width:16px;height:16px">' + parts + '</span>';
}

/** 设置按钮的图形:两条滑杆(不用齿轮——齿轮没法只靠 CSS 画清楚)。 */
function prSlidersGlyph() {
  return '<span style="position:relative;display:block;width:16px;height:16px">' +
    prHLine(5, 1.5, 7.6) + prRing(10, 5) + prHLine(5, 12.4, 14.5) +
    prHLine(11, 1.5, 3.6) + prRing(6, 11) + prHLine(11, 8.4, 14.5) + '</span>';
}

function prCheckGlyph() {
  return '<span style="display:inline-block;width:5px;height:9px;margin:-3px 3px 0 2px;' +
    'border-right:1.6px solid currentColor;border-bottom:1.6px solid currentColor;transform:rotate(45deg)"></span>';
}

function prMiniSpinner() {
  return '<span style="display:inline-block;width:11px;height:11px;margin-right:2px;border:1.5px solid currentColor;' +
    'border-top-color:transparent;border-radius:50%;animation:prspin var(--motion-spinner-cycle,900ms) linear infinite"></span>';
}

function prTile(glyph, tone) {
  var color = 'var(--text-secondary)';
  var bg = 'var(--surface-chip)';
  if (tone === 'open') {
    color = PR_GREEN;
    bg = 'color-mix(in srgb,' + PR_GREEN + ' 14%,transparent)';
  } else if (tone === 'merged') {
    color = PR_BLUE;
    bg = 'color-mix(in srgb,' + PR_BLUE + ' 16%,transparent)';
  } else if (tone === 'muted') {
    color = 'var(--text-tertiary)';
  }
  return '<div style="display:grid;flex:none;place-items:center;width:36px;height:36px;border-radius:8px;color:' + color + ';background:' + bg + '">' +
    prGlyph(glyph) + '</div>';
}

var PR_SEP = '<span style="color:var(--text-tertiary)"> · </span>';

/** 上层:图标、标题、仓库或进度说明,设置按钮靠右。 */
function prHeader(tile, titleHtml, metaParts, gear) {
  return '<div style="display:flex;align-items:center;gap:12px;padding:14px 12px 14px 16px">' +
    tile +
    '<div style="flex:1;min-width:0">' +
    '<div style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:14px;line-height:20px;font-weight:500">' + titleHtml + '</div>' +
    '<div style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis;margin-top:2px;font-size:12px;line-height:16px;color:var(--text-secondary)">' +
    metaParts.join(PR_SEP) + '</div>' +
    '</div>' + (gear || '') + '</div>';
}

/** 下层:左边分支或状态,右边按钮;窄的时候按钮换到下一行。 */
function prFooter(leftHtml, actionsHtml) {
  return '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;min-height:52px;padding:10px 16px;border-top:1px solid var(--border-default)">' +
    '<div style="flex:1 1 220px;min-width:0;font-size:12px;line-height:16px;color:var(--text-secondary)">' + leftHtml + '</div>' +
    (actionsHtml ? '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-left:auto">' + actionsHtml + '</div>' : '') +
    '</div>';
}

var PR_PILL = 'display:inline-flex;align-items:center;height:32px;padding:0 12px;border-radius:9999px;font-size:13px;font-weight:500;white-space:nowrap;';

function prButton(action, label, style, inner) {
  return '<button data-ghost-action="' + action + '" aria-label="' + prEsc(label) + '" style="' + style + '">' + (inner || '') + '</button>';
}

function prCtaButton(action, label) {
  return prButton(action, label, PR_PILL + 'border:1px solid transparent;color:var(--accent-pure-cta-fg,#fff);' +
    '--bg:var(--accent-cta-bg,#000);--hover:color-mix(in srgb,var(--accent-cta-bg,#000),var(--surface-elevated) 18%)');
}

function prPillButton(action, label) {
  return prButton(action, label, PR_PILL + 'border:1px solid var(--border-default);' +
    '--bg:var(--surface-elevated);--hover:color-mix(in srgb,var(--surface-elevated),var(--text-primary) 8%)');
}

function prQuietButton(action, label, extra, inner) {
  return prButton(action, label, 'display:inline-flex;align-items:center;height:32px;padding:0 10px;border-radius:9999px;' +
    'font-size:12px;font-weight:500;color:var(--text-secondary);--hover:' + PR_HOVER + (extra || ''), inner);
}

/** 跟进中:按钮原地变成绿色状态胶囊,圆点由宿主播呼吸光环(data-ghost-live)。 */
function prFollowingPill() {
  return '<div style="' + PR_PILL + 'gap:7px;padding:0 12px;color:var(--text-primary);' +
    'border:1px solid color-mix(in srgb,' + PR_GREEN + ' 35%,transparent);background:color-mix(in srgb,' + PR_GREEN + ' 10%,transparent)">' +
    '<span style="position:relative;flex:none;width:7px;height:7px">' +
    // 宿主按 data-ghost-live 给这层播呼吸光环;旧版宿主不认这个属性时它只是叠在圆点下的同色圆。
    '<span data-ghost-live style="position:absolute;inset:0;border-radius:50%;background:' + PR_GREEN + '"></span>' +
    '<span style="position:absolute;inset:0;border-radius:50%;background:' + PR_GREEN + ';' +
    'box-shadow:0 0 0 3px color-mix(in srgb,' + PR_GREEN + ' 22%,transparent)"></span></span>' + prEsc(t('prStateFollowing')) + '</div>';
}

function prChip(label, pending) {
  return '<div style="display:inline-flex;align-items:center;height:32px;padding:0 2px;font-size:13px;color:var(--text-secondary);white-space:nowrap">' +
    '<span style="display:inline-flex;align-items:center;color:var(--text-tertiary)">' + (pending ? prMiniSpinner() : prCheckGlyph()) + '</span>' +
    '<span style="margin-left:4px">' + prEsc(label) + '</span></div>';
}

function prStatusItem(tone, label) {
  var dot = tone === 'good'
    ? 'background:' + PR_GREEN
    : tone === 'bad'
      ? 'background:var(--error-fg,#d93025)'
      : 'border:1.5px solid var(--text-tertiary)';
  return '<div style="display:inline-flex;align-items:center;gap:6px;' + (tone === 'good' ? 'color:var(--text-primary)' : '') + '">' +
    '<span style="flex:none;width:7px;height:7px;border-radius:50%;' + dot + '"></span>' + prEsc(label) + '</div>';
}

function prStatusStrip(pr) {
  var items = '';
  if (pr.ci === 'SUCCESS') items += prStatusItem('good', t('prCiPassed'));
  else if (pr.ci === 'FAILURE' || pr.ci === 'ERROR') items += prStatusItem('bad', t('prCiFailed'));
  else if (pr.ci) items += prStatusItem('wait', t('prCiRunning'));
  items += pr.openThreads > 0
    ? prStatusItem('wait', t('prThreadsOpen', { count: pr.openThreads }))
    : prStatusItem('good', t('prThreadsNone'));
  if (pr.mergeState === 'DIRTY') items += prStatusItem('bad', t('prMergeConflict'));
  else if (pr.mergeState === 'BEHIND') items += prStatusItem('wait', t('prMergeBehind', { base: pr.base || 'base' }));
  else if (pr.mergeState === 'CLEAN') items += prStatusItem('good', t('prMergeReady'));
  else if (pr.review === 'CHANGES_REQUESTED') items += prStatusItem('wait', t('prMergeChanges'));
  else if (pr.review === 'REVIEW_REQUIRED') items += prStatusItem('wait', t('prMergeApproval'));
  else items += prStatusItem('wait', t('prMergeWaiting'));
  return '<div style="display:flex;flex-wrap:wrap;gap:6px 16px">' + items + '</div>';
}

/** 分支与改动概况(下层左边)。 */
function prContextLine(card) {
  var head = card.head || (card.pr && card.pr.head) || '';
  var base = card.base || (card.pr && card.pr.base) || '';
  var parts = head ? [prEsc(head) + (base ? ' → ' + prEsc(base) : '')] : [];
  parts = parts.concat(prStatsParts(card));
  return '<div style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis">' + parts.join(PR_SEP) + '</div>';
}

function prSettingRow(action, label, hint, on) {
  return '<button data-ghost-action="' + action + '" aria-label="' + prEsc(on ? t('prTurnOff', { name: label }) : t('prTurnOn', { name: label })) + '" ' +
    'style="display:flex;width:100%;align-items:center;justify-content:space-between;gap:12px;padding:8px;border-radius:8px;text-align:left;--hover:' + PR_HOVER + '">' +
    '<div style="min-width:0"><div style="font-size:13px;line-height:18px;font-weight:500">' + prEsc(label) + '</div>' +
    '<div style="font-size:12px;line-height:16px;color:var(--text-secondary)">' + prEsc(hint) + '</div></div>' +
    '<span style="position:relative;flex:none;width:36px;height:20px;border-radius:9999px;background:' + (on ? PR_BLUE : 'light-dark(#808080,#787878)') + '">' +
    '<span style="position:absolute;top:2px;left:' + (on ? 18 : 2) + 'px;width:16px;height:16px;border-radius:50%;background:#fcfcfc"></span></span></button>';
}

function prSettingsPanel(settings) {
  return '<div style="padding:8px 8px 10px;border-top:1px solid var(--border-default)">' +
    '<div style="padding:4px 8px;font-size:12px;line-height:16px;font-weight:600;color:var(--text-tertiary)">' + prEsc(t('prSettings')) + '</div>' +
    prSettingRow('prset:rename', t('prAutoRename'), t('prAutoRenameHint'), settings.autoRename) +
    prSettingRow('prset:follow', t('prAutoFollow'), t('prAutoFollowHint'), settings.autoFollow) +
    '</div>';
}

function prGearButton(open) {
  return prButton('prui:settings', open ? t('prHideSettings') : t('prSettings'),
    'display:grid;flex:none;align-self:flex-start;place-items:center;width:32px;height:32px;border-radius:9999px;' +
    'color:' + (open ? 'var(--text-primary);--bg:' + PR_HOVER : 'var(--text-tertiary)') + ';--hover:' + PR_HOVER,
    prSlidersGlyph());
}

function prStatsParts(card) {
  var parts = [];
  // 改动还没提交时只报文件数,不显示「0 个提交」。
  if (card.commits) parts.push(prEsc(card.commits === 1 ? t('prCommitOne') : t('prCommitMany', { count: card.commits })));
  var files = card.filesTotal != null ? card.filesTotal : card.files ? card.files.length : null;
  if (files != null && files > 0) parts.push(prEsc(files === 1 ? t('prFileOne') : t('prFileMany', { count: files })));
  return parts;
}

function renderPrCard(card, settings) {
  var tile, title, meta, left, actions = '';
  var gear = false;
  if (card.stage === 'ask') {
    gear = true;
    tile = prTile('branch');
    title = prEsc(t('prAskTitle'));
    meta = [prEsc(card.repo)];
    left = prContextLine(card);
    // 看改动交给宿主的审查面板(真实 diff、可撤销),卡片只管发不发。
    actions = prPillButton('pr:draft', t('prPublishDraft')) + prCtaButton('pr:publish', t('prPublish'));
  } else if (card.stage === 'publishing') {
    tile = prTile('spinner');
    title = prEsc(card.publishingDraft ? t('prPublishingDraftTitle') : t('prPublishingTitle'));
    meta = [prEsc(card.queued ? t('prQueuedMeta') : t('prPublishingMeta'))];
    left = prContextLine(card);
  } else {
    var pr = card.pr;
    title = '<span style="margin-right:2px;color:var(--text-secondary);font-weight:500">#' + pr.number + '</span> ' + prEsc(pr.title || card.repo);
    // 标题即 PR 链接:宿主确认后用系统浏览器打开(需 card.externalLinks)。
    if (/^https:\/\/github\.com\//.test(pr.url)) {
      title = '<a href="' + prEsc(pr.url) + '">' + title + '</a>';
    }
    if (card.stage === 'open') {
      gear = true;
      var state = pr.draft ? t('prStateDraft') : card.following ? t('prStateFollowing') : t('prStateOpen');
      tile = pr.draft ? prTile('draft', 'muted') : prTile('pr', 'open');
      meta = [prEsc(card.repo), prEsc(state)];
      left = card.following ? prStatusStrip(pr) : prContextLine(card);
      // 停止排在胶囊左边:悬停这一行才出现,出现时不推动「跟进中」。
      actions = card.pending === 'follow'
        ? prChip(t('prFollowStarting'), true)
        : card.pending === 'stop'
          ? prChip(t('prStopping'), true)
          : card.following
            ? prQuietButton('pr:stop', t('prStop')) + prFollowingPill()
            : prPillButton('pr:follow', t('prFollow'));
    } else {
      tile = card.stage === 'merged' ? prTile('merged', 'merged') : prTile('closed', 'muted');
      meta = [prEsc(card.repo), prEsc(card.stage === 'merged' ? t('prStateMerged') : t('prStateClosed'))];
      if (card.followedEver) meta.push(prEsc(t('prFollowEnded')));
      left = prContextLine(card);
    }
  }
  if (card.note) {
    left += '<div style="margin-top:4px;color:var(--error-fg,#d93025)">' + prEsc(card.note) + '</div>';
  }
  var body = prHeader(tile, title, meta, gear ? prGearButton(card.settingsOpen) : '') + prFooter(left, actions);
  if (gear && card.settingsOpen) body += prSettingsPanel(settings);
  // 排到本轮末尾、铺满消息列:宿主把卡放在「已更改 N 个文件」卡之后,与它同宽。
  return PR_CSS +
    '<div data-ghost-placement="turn-end" data-ghost-width="full" style="display:flex;flex-direction:column;justify-content:space-between;' +
    'min-height:120px;overflow:hidden;border:1px solid var(--border-default);border-radius:12px;background:var(--surface-elevated);' +
    'color:var(--text-primary);font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.5">' +
    body + '</div>';
}

/** 声明高度宁低勿高:宿主按实际内容量高只会往上调,声明偏高会在卡片下方留白。 */
function prCardHeight(card) {
  var h = 120;
  if (card.note) h += 22;
  if (card.settingsOpen && (card.stage === 'ask' || card.stage === 'open')) h += 160;
  return Math.min(900, h);
}

function sendPrCard(card, settings, sourceCallId) {
  var msg = {
    type: 'card-update', callId: card.id, v: 2, state: 'done',
    html: renderPrCard(card, settings), height: prCardHeight(card),
  };
  // 后续工具调用改的是之前那张卡片:带上当前调用作凭证,宿主才会重开旧卡片。
  if (sourceCallId) msg.sourceCallId = sourceCallId;
  return Promise.resolve(cindy.send(msg)).catch(function () {});
}

/* ── pr_card 工具 ── */

async function prCardTool(args, callId) {
  var a = args && typeof args === 'object' ? args : {};
  var repo = prText(a.repo);
  if (repo && !PR_REPO_RE.test(repo)) return fail(t('prNeedRepo'));
  var cardId = a.card_id !== undefined && a.card_id !== null && a.card_id !== '' ? String(a.card_id) : '';
  if (cardId && !PR_CARD_ID_RE.test(cardId)) return fail(t('prBadCardId'));

  var notes = [];
  var card = cardId ? await readPrCard(cardId) : null;
  if (cardId && !card) notes.push(t('prCardNotFound'));
  var updating = Boolean(card);
  var ref = null;
  if (a.pr !== undefined && a.pr !== null && a.pr !== '') {
    // 只给编号时,仓库取参数或卡片上记的那个。
    ref = parsePrRef(a.pr, repo || (card ? card.repo : ''));
    if (!ref) return fail(t('prBadPr'));
  }
  if (!card) {
    if (!repo && !ref) return fail(t('prNeedRepo'));
    if (!ref && !prText(a.head)) return fail(t('prNeedHead'));
    card = newPrCard(callId, repo);
  }
  if (ref) card.repo = ref.repo;
  else if (repo) card.repo = repo;
  if (prText(a.head)) card.head = prText(a.head);
  if (prText(a.base)) card.base = prText(a.base);
  if (a.commits !== undefined) card.commits = prCount(a.commits);
  if (a.files !== undefined) card.files = prFiles(a.files);
  if (a.files_total !== undefined) card.filesTotal = prCount(a.files_total);
  if (typeof a.renamed === 'boolean') {
    card.renamed = a.renamed;
  }
  if (typeof a.following === 'boolean') {
    card.following = a.following;
    if (a.following) card.followedEver = true;
    if (card.pending === 'follow' || card.pending === 'stop') card.pending = null;
  }
  card.note = null;

  var number = ref ? ref.number : card.pr ? card.pr.number : null;
  if (number) {
    var status = await fetchPrStatus(card.repo, number, callId);
    if (status.err) {
      notes.push(t('prFetchFailed', { detail: status.err }));
      if (!card.pr || card.pr.number !== number) {
        card.pr = {
          number: number, title: '', url: 'https://github.com/' + card.repo + '/pull/' + number,
          state: 'open', draft: false, base: card.base, ci: null, openThreads: 0, mergeState: null, review: null,
        };
      }
    } else {
      card.pr = status.pr;
    }
    card.stage = card.pr.state === 'merged' ? 'merged' : card.pr.state === 'closed' ? 'closed' : 'open';
    card.queued = false;
    if (card.stage !== 'open') {
      card.settingsOpen = false;
      card.pending = null;
    }
  } else if (card.stage === 'publishing') {
    // 发布没成功,Agent 不带 pr 再调一次:卡片回到询问。
    card.stage = 'ask';
  }

  var settings = await readPrSettings();
  var todo = [];
  if (card.stage === 'open' && !card.settingsApplied) {
    card.settingsApplied = true;
    if (settings.autoRename && !card.renamed) todo.push(t('prTodoRename', { title: prTaskTitle(card) }));
    if (settings.autoFollow && !card.following && !card.pr.draft) todo.push(t('prTodoFollow', { url: card.pr.url }));
  }

  await savePrCard(card);
  await sendPrCard(card, settings, updating ? callId : null);
  if (!updating) await prunePrCards();

  var result = {
    card_id: card.id,
    stage: card.stage === 'open' && card.pr.draft ? 'draft' : card.stage,
    settings: { auto_rename: settings.autoRename, auto_follow: settings.autoFollow },
  };
  if (card.pr) {
    result.pr = { number: card.pr.number, title: card.pr.title, url: card.pr.url, state: card.pr.state, draft: card.pr.draft };
  }
  if (todo.length) {
    result.todo = todo;
    result.next = t('prNextApply');
  } else {
    result.next = card.stage === 'ask' ? t('prNextAsk') : t('prNextUpdated');
  }
  if (notes.length) result.note = notes.join(' ');
  return { ok: true, result: result };
}

/* ── 卡片按钮 ── */

var PR_AGENT_ACTIONS = {
  'pr:publish': function (card) { return card.stage === 'ask'; },
  'pr:draft': function (card) { return card.stage === 'ask'; },
  'pr:follow': function (card) { return card.stage === 'open' && !card.following && !card.pending; },
  'pr:stop': function (card) { return card.stage === 'open' && card.following && !card.pending; },
};

/**
 * 把点击交给本任务的 Agent。返回 ok=true 已交出;ok=false 未交出;
 * unknown=true 宿主没给明确结果(可能已交出),卡片据此提示用户先看对话、别重复点。
 */
async function handOffPr(card, action, settings, msg) {
  if (!msg.userActionToken || !cindy.agent || typeof cindy.agent.run !== 'function') return { ok: false };
  var url = card.pr ? card.pr.url : '';
  var text;
  if (action === 'pr:publish') text = t('prClickPublish');
  else if (action === 'pr:draft') text = t('prClickPublishDraft');
  else if (action === 'pr:follow') text = t('prClickFollow', { url: url });
  else text = t('prClickStop', { url: url });
  var event = { card_id: card.id, action: action.slice(3), repo: card.repo };
  if (card.pr) {
    event.pr_number = card.pr.number;
    event.pr_url = url;
  } else {
    event.head = card.head;
    if (card.base) event.base = card.base;
    event.settings = { auto_rename: settings.autoRename, auto_follow: settings.autoFollow && action === 'pr:publish' };
  }
  var r;
  try {
    r = await cindy.agent.run({
      mode: 'continue',
      userActionToken: msg.userActionToken,
      promptTemplate: PR_TRIGGER + '{{user_message}}\n{{event_json}}',
      userMessage: text,
      event: event,
    });
  } catch (e) {
    return { ok: false, unknown: true };
  }
  if (r && r.ok === true) return { ok: true, queued: r.disposition === 'queued' };
  return r && r.ok === false ? { ok: false } : { ok: false, unknown: true };
}

async function prCardAction(msg) {
  var id = String(msg.callId || '');
  if (!PR_CARD_ID_RE.test(id)) return;
  var card = await readPrCard(id);
  if (!card) return;
  var action = String(msg.actionId || '');
  var settings = await readPrSettings();
  card.note = null;
  if (action === 'prui:settings' && (card.stage === 'ask' || card.stage === 'open')) {
    card.settingsOpen = !card.settingsOpen;
  } else if (action === 'prset:rename' || action === 'prset:follow') {
    try {
      settings = await togglePrSetting(action === 'prset:rename' ? 'autoRename' : 'autoFollow');
    } catch (e) {
      card.note = t('prSettingFailed');
    }
  } else if (PR_AGENT_ACTIONS[action] && PR_AGENT_ACTIONS[action](card)) {
    var handoff = await handOffPr(card, action, settings, msg);
    if (handoff.ok && (action === 'pr:publish' || action === 'pr:draft')) {
      card.stage = 'publishing';
      card.publishingDraft = action === 'pr:draft';
      card.queued = handoff.queued;
      card.settingsOpen = false;
    } else if (handoff.ok) {
      card.pending = action === 'pr:follow' ? 'follow' : 'stop';
    } else {
      card.note = handoff.unknown ? t('prHandoffUnknown') : t('prHandoffFailed');
    }
  }
  await savePrCard(card);
  // 原地更新被点的卡片并标 done:这次点击在宿主侧的「运行中」随之结束。
  await sendPrCard(card, settings, null);
}

/* ── 设置页测试连接(BroadcastChannel;settings.js 先 /wake 再广播) ── */

var bc = new BroadcastChannel('cindy-github');
var seenTestReqs = {};

bc.onmessage = function (ev) {
  var m = ev && ev.data;
  if (!m || m.type !== 'test-connection' || !m.reqId) return;
  if (seenTestReqs[m.reqId]) return;
  // 去重表只为吸收 settings 页的重发风暴,超量直接清零重来(常驻期不泄漏)。
  if (Object.keys(seenTestReqs).length > 200) seenTestReqs = {};
  seenTestReqs[m.reqId] = 1;
  void (async function () {
    // 失败原因会回显到设置页并走系统提示,先对齐宿主当前语言。
    await ensureLocale();
    var r = await api({ url: API + '/user' });
    if (r.err) {
      bc.postMessage({ type: 'test-connection-result', reqId: m.reqId, ok: false, message: r.err });
      // 结果同时走系统提示(notify 槽,主机画壳带身份头):失败也报,tone 区分。
      // 限速 5 秒内的重复点击会被主机拒(ok:false),页面内 status 仍在,不补救。
      void cindy.send({ type: 'notify', text: t('testFailedNotify', { detail: String(r.err).slice(0, 150) }), tone: 'error' });
      return;
    }
    // 注:scope 信息在 X-OAuth-Scopes 响应头里,但主机响应头白名单不透传
    // 自定义头,沙箱拿不到——只报用户名,不做 scope 展示。
    var login = (r.data && r.data.login) || '';
    bc.postMessage({
      type: 'test-connection-result', reqId: m.reqId, ok: true,
      login: login, name: (r.data && r.data.name) || '',
    });
    void cindy.send({ type: 'notify', text: t('testSucceededNotify', { login: login }), tone: 'success' });
  })();
};

/* ── 派单 ──────────────────────────────────────────────────────────── */

cindy.onHostMessage(async function (msg) {
  if (msg && msg.type === 'host-context-changed') {
    hostLocale = normalizeLocale(msg.context && msg.context.locale);
    return;
  }
  if (msg && msg.type === 'event' && msg.name === 'card-action') {
    try {
      await ensureLocale();
      await enqueuePr(function () { return prCardAction(msg); });
    } catch (e) {
      // 点击没有回执通道;卡片保持上一版,宿主的「运行中」由超时兜底收口。
    }
    return;
  }
  if (!msg || msg.type !== 'tool-call') return;
  try {
    await ensureLocale();
    var r;
    if (msg.tool === 'list_tools') {
      r = listTools(msg.args || {});
    } else if (msg.tool === 'call_tool') {
      r = await callTool(msg.args || {}, msg.callId);
    } else if (msg.tool === 'pr_card') {
      r = await enqueuePr(function () { return prCardTool(msg.args || {}, msg.callId); });
    } else {
      r = fail(t('unknownTool', { tool: msg.tool }));
    }
    if (r.ok) {
      cindy.send({ type: 'tool-result', callId: msg.callId, ok: true, result: r.result });
    } else {
      cindy.send({ type: 'tool-result', callId: msg.callId, ok: false, message: r.message });
    }
  } catch (err) {
    cindy.send({
      type: 'tool-result',
      callId: msg.callId,
      ok: false,
      message: t('toolFailed', { detail: err && err.message ? err.message : String(err) }),
    });
  }
});
