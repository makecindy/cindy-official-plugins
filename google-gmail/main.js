/* Plugin-owned labels. OAuth identities, credentials and status remain Host-owned. */
var googleAccountMetadata = (function () {
  'use strict';
  function object(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }
  async function read() {
    var response = await fetch('/kv');
    if (!response.ok) throw new Error('Account preferences unavailable');
    return object(await response.json());
  }
  function labels(data, key) {
    return object(object(data.accountNicknames)[key]);
  }
  async function update(key, accountId, nickname) {
    // /kv replaces the whole document. Serialize settings-page writers sharing
    // this plugin origin, and read inside the lock to preserve unrelated keys.
    return navigator.locks.request('google-account-metadata', async function () {
      var data = await read();
      if (nickname !== null) {
        var response = await fetch('/oauth');
        if (!response.ok) throw new Error('Account status unavailable');
        var accounts = await response.json();
        var entry = accounts.find(function (item) { return item.key === key; });
        if (!entry || !entry.accounts.some(function (account) { return account.id === accountId; })) {
          throw new Error('Account no longer connected');
        }
      }
      var all = Object.assign({}, object(data.accountNicknames));
      var next = Object.assign({}, labels(data, key));
      if (nickname) next[accountId] = nickname;
      else delete next[accountId];
      all[key] = next;
      data.accountNicknames = all;
      var saved = await fetch('/kv', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      });
      if (!saved.ok) throw new Error('Account preferences not saved');
    });
  }
  return {
    list: async function (key, accounts) {
      var names = {};
      // Labels are optional; an unavailable KV must not hide OAuth identities.
      // Writes still require a successful read to avoid overwriting preferences.
      try { names = labels(await read(), key); } catch (_) { /* show accounts without labels */ }
      return accounts.map(function (account) {
        var nickname = Object.prototype.hasOwnProperty.call(names, account.id) ? names[account.id] : '';
        // Do not accept a Host nickname as a second source of truth.
        return Object.assign({}, account, { nickname: typeof nickname === 'string' ? nickname : '' });
      });
    },
    save: async function (key, accountId, nickname) {
      if (typeof nickname !== 'string' || nickname.length > 80 || /[\u0000-\u001f\u007f]/.test(nickname)) {
        throw new Error('Invalid account nickname');
      }
      return update(key, accountId, nickname.trim());
    },
    remove: function (key, accountId) { return update(key, accountId, null); },
  };
})();


/* global cindy */
// Provider adapter. Draft MIME updates and previews use fixed Gmail endpoints.
var SECRET_KEY = 'gmail_account';
var PLUGIN_NAME = 'Gmail';
function fail(message) { return { ok: false, message: message }; }
// Runtime copy follows only the Host locale (docs/localization.md): never
// navigator.language. Unsupported or unavailable locales fall back to English.
var MESSAGES = {
  'zh-CN': {
    contactText: "{name} 必须是非空文本，且不能过长。",
    contactAction: "未知联系人操作，请查看 gmail_contacts 的参数说明。",
    contactReadonly: "当前任务为只读，未修改 Google 通讯录。",
    contactRuntime: "当前 Cindy 不支持联系人网络接口，请更新 Cindy。",
    contactResource: "请使用查询返回的联系人 resourceName，不能使用 people/me 或自行拼接路径。",
    contactPageSize: "pageSize 必须是 1–100 的整数。",
    contactPerson: "person 至少需要一个要写入的联系人字段。",
    contactFieldLimit: "联系人字段不支持或条目过多：{field}",
    contactItem: "联系人字段条目必须是非空对象。",
    contactField: "不支持的联系人字段：{field}",
    contactValue: "{field} 需要 value。",
    contactEmpty: "不能创建空联系人。",
    contactUnknown: "无法确认联系人操作结果，请先核对 Google 通讯录，不要直接重试。",
    contactReadFailed: "读取联系人失败，请检查网络连接后重试。",
    contactPermission: "联系人权限不足或账号已失效，请到 Gmail 插件详情重新连接此账号并授权；企业目录还需组织允许访问。现有邮件功能可继续使用已获授权。",
    contactRejected: "Google 拒绝了联系人操作，请重新读取联系人并核对字段和 etag；资料可能已经更新。",
    contactNotFound: "联系人不存在，请重新查询并核对 resourceName。",
    contactUnavailable: "Google 联系人服务暂时不可用，请检查网络或稍后重新读取。",
    contactReceipt: "联系人操作已执行，但回执不完整。请先到 Google 通讯录核对，不要重复创建或修改。",
    contactResponse: "联系人响应不完整，请缩小查询范围后重新读取。",
    contactSearchPage: "联系人搜索不支持 pageToken；需要分页遍历时使用 list。",
    contactChanged: "联系人已变化或不是可编辑的个人联系人，请重新读取并核对修改内容。未写入任何修改。",
    contactFailed: "联系人操作失败，请核对 Google 通讯录中的实际状态。",
    contactDelivery: "联系人结果未能完整返回，请先核对 Google 通讯录中的实际状态，不要重复创建、修改或删除。",
    inlineImagesType: 'inline-images 仅支持 PNG、JPEG、GIF 或 WebP 图片；其他媒体请作为普通附件。',
    accountServiceUnreachable: '无法连接 Cindy 本地账号服务，请稍后重试；若持续失败，请重新打开 Gmail 插件详情检查服务状态',
    accountServiceNoResult: 'Cindy 本地账号服务未返回结果，请稍后重试',
    accountServiceDenied: '账号状态服务拒绝访问，请到 Gmail 插件详情检查连接状态后重试（HTTP {status}）',
    accountServiceUnavailable: 'Cindy 本地账号服务暂时不可用，请稍后重试；若持续失败，请重新打开 Gmail 插件详情检查服务状态（HTTP {status}）',
    accountDataUnparsable: 'Cindy 账号状态数据无法解析，请重新打开 Gmail 插件详情后重试',
    accountDataMalformed: 'Cindy 账号状态数据格式异常，请重新打开 Gmail 插件详情后重试',
    clientIdentityMissing: '内置应用身份缺失，请升级 Cindy 后重试',
    accountListMalformed: 'Cindy 账号列表数据格式异常，请重新打开 Gmail 插件详情后重试',
    noAccount: '尚未连接账号，请到「{plugin}」详情页单独授权',
    notExecuted: '尚未执行：{reason}',
    multipleAccounts: '尚未执行：已连接多个账号，请明确选择账号并传入 account。',
    accountNotFound: '尚未执行：指定账号不存在，请重新选择账号；不会切换到其他账号。',
    accountReauth: '尚未执行：账号 {account} 授权已失效或权限不足，请到插件详情页重新连接此账号。',
    readParseData: '无法解析 Gmail 邮件数据，请检查网络连接后重新打开邮件，或在邮箱中查看。',
    readParseBody: '无法解析 Gmail 邮件正文，请重新打开邮件，或在邮箱中查看。',
    readUnauthorized: 'Gmail 账号授权已失效，请到插件详情页重新连接此账号后再打开邮件。',
    readForbidden: 'Gmail 拒绝读取，请检查此账号的邮件读取权限，并到插件详情页重新连接或授权。',
    linkAccountMismatch: '邮件链接与指定的 Gmail 账号不一致，请选择链接对应的账号后再打开。',
    readThreadFailed: '无法读取 Gmail 会话，请检查网络连接后重新打开。',
    readMessageFailed: '无法读取 Gmail 邮件，请检查网络连接和邮件是否仍在邮箱中后重新打开。',
    readBodyIncomplete: '无法完整读取邮件正文',
    readBodyFailed: '无法完整读取邮件正文，请检查网络连接后重新打开。',
    readBodySizeMismatch: '邮件正文大小不一致',
    markReadFailed: '未能标记已读，请检查邮箱授权和邮件状态后再操作。',
    markReadUnknown: '无法确认已读状态，请先在邮箱中核对，不要盲目重试。',
    sendRequiresDraft: '邮件未发送。请先用 drafts create / drafts reply / drafts reply-all 创建并展示草稿，再用 drafts send 发送；Cindy 公共流程会提供 10 秒撤销窗口。不要绕过草稿流程直接发送。',
    mailFlowUnsupported: '当前 Cindy 不支持公共邮件流程，请更新 Cindy 后再创建、编辑或发送草稿。',
    draftCommandShape: '请使用完整的草稿命令和单个草稿 ID。',
    sendDraftIdOnly: '发送现有草稿只接受草稿 ID；修改请先更新该草稿。',
    undoWindowUnsupported: '当前 Cindy 尚不支持发送前的 10 秒撤销窗口，请更新 Cindy 后再发送。草稿已保留。',
    unknownTool: '尚未执行：未知工具，请重新查看当前插件工具列表。',
    runtimeMissing: '尚未执行：当前 Cindy 缺少此功能所需的插件运行接口，请升级至 0.1.92 或更新版本。账号列表仍可使用。',
    earlierDraftUnconfirmed: '此前的草稿操作结果尚未完全确认，请先核对邮箱中的实际状态，不要重复发送、保存或删除。',
    executedUnreturned: '邮箱操作已执行，但结果未能完整返回。请先核对邮箱中的实际状态，不要重复发送、保存或删除。',
    outcomeUnknown: '无法确认邮箱操作结果，请先核对邮箱中的实际状态，不要重复发送、保存或删除。',
    prepareFailed: '无法准备 Gmail 操作，请检查账号和附件输入。',
  },
  en: {
    contactText: "{name} must be nonempty text within the length limit.",
    contactAction: "Unknown contact action. Check the gmail_contacts parameters.",
    contactReadonly: "This task is read-only. Google Contacts was not modified.",
    contactRuntime: "This Cindy version does not support contact requests. Update Cindy.",
    contactResource: "Use the contact resourceName returned by a lookup, not people/me or a constructed path.",
    contactPageSize: "pageSize must be an integer from 1 to 100.",
    contactPerson: "person requires at least one contact field to write.",
    contactFieldLimit: "Unsupported contact field or too many entries: {field}",
    contactItem: "Contact field entries must be nonempty objects.",
    contactField: "Unsupported contact field: {field}",
    contactValue: "{field} requires value.",
    contactEmpty: "Cannot create an empty contact.",
    contactUnknown: "Could not confirm the contact operation outcome. Check Google Contacts first; do not retry blindly.",
    contactReadFailed: "Could not read contacts. Check the network connection and try again.",
    contactPermission: "Contact access is missing or expired. Reconnect and authorize this account in Gmail plugin details; directory access also requires organization permission. Existing mail access remains usable.",
    contactRejected: "Google rejected the contact operation. Read the contact again and check its fields and etag; it may have changed.",
    contactNotFound: "Contact not found. Look it up again and check resourceName.",
    contactUnavailable: "Google Contacts is temporarily unavailable. Check the network or read again later.",
    contactReceipt: "The contact operation was executed, but its receipt is incomplete. Check Google Contacts first; do not create or update it again.",
    contactResponse: "The contact response is incomplete. Narrow the query and read again.",
    contactSearchPage: "Contact search does not support pageToken; use list for pagination.",
    contactChanged: "The contact changed or is not an editable personal contact. Read it again and review the changes. No changes were written.",
    contactFailed: "The contact operation failed. Check the actual state in Google Contacts.",
    contactDelivery: "The contact result was not fully returned. Check the actual state in Google Contacts first; do not create, update or delete again.",
    inlineImagesType: 'inline-images only supports PNG, JPEG, GIF or WebP images; attach other media as regular attachments.',
    accountServiceUnreachable: 'Could not reach the Cindy local account service. Try again later; if it keeps failing, reopen the Gmail plugin details to check the service status',
    accountServiceNoResult: 'The Cindy local account service returned no result. Try again later',
    accountServiceDenied: 'The account status service denied access. Check the connection status in the Gmail plugin details, then try again (HTTP {status})',
    accountServiceUnavailable: 'The Cindy local account service is temporarily unavailable. Try again later; if it keeps failing, reopen the Gmail plugin details to check the service status (HTTP {status})',
    accountDataUnparsable: 'Could not parse the Cindy account status data. Reopen the Gmail plugin details and try again',
    accountDataMalformed: 'The Cindy account status data is malformed. Reopen the Gmail plugin details and try again',
    clientIdentityMissing: 'The built-in app identity is missing. Upgrade Cindy and try again',
    accountListMalformed: 'The Cindy account list data is malformed. Reopen the Gmail plugin details and try again',
    noAccount: 'No account connected yet. Authorize one separately in the "{plugin}" plugin details',
    notExecuted: 'Not executed: {reason}',
    multipleAccounts: 'Not executed: multiple accounts are connected. Choose one explicitly and pass it as account.',
    accountNotFound: 'Not executed: the specified account does not exist. Choose an account again; no other account will be used instead.',
    accountReauth: 'Not executed: authorization for account {account} has expired or lacks permissions. Reconnect this account in the plugin details.',
    readParseData: 'Could not parse the Gmail message data. Please check your network connection and reopen the message, or view it in your mailbox.',
    readParseBody: 'Could not parse the Gmail message body. Please reopen the message, or view it in your mailbox.',
    readUnauthorized: 'Gmail account authorization has expired. In the plugin details, reconnect this account, then open the message again.',
    readForbidden: 'Gmail refused the read. Check the mail read permission for this account, then in the plugin details reconnect or reauthorize it.',
    linkAccountMismatch: 'The message link does not match the specified Gmail account. Select the account the link belongs to, then open it again.',
    readThreadFailed: 'Could not read the Gmail conversation. Check your network connection and reopen it.',
    readMessageFailed: 'Could not read the Gmail message. Check your network connection and that the message is still in the mailbox, then reopen it.',
    readBodyIncomplete: 'Could not read the full message body',
    readBodyFailed: 'Could not read the full message body. Check your network connection and reopen it.',
    readBodySizeMismatch: 'Message body size mismatch',
    markReadFailed: 'Could not mark as read. Check the mailbox authorization and message status before trying again.',
    markReadUnknown: 'Could not confirm the read status. Check the mailbox first; do not retry blindly.',
    sendRequiresDraft: 'Message not sent. First create and show a draft with drafts create / drafts reply / drafts reply-all, then send it with drafts send; the Cindy common mail flow provides a 10-second undo window. Do not bypass the draft flow to send directly.',
    mailFlowUnsupported: 'This Cindy version does not support the common mail flow. Update Cindy before creating, editing or sending drafts.',
    draftCommandShape: 'Use the full draft command with a single draft ID.',
    sendDraftIdOnly: 'Sending an existing draft accepts only the draft ID; to change it, update the draft first.',
    undoWindowUnsupported: 'This Cindy version does not yet support the 10-second undo window before sending. Update Cindy before sending. The draft was kept.',
    unknownTool: 'Not executed: unknown tool. Check the current plugin tool list again.',
    runtimeMissing: 'Not executed: this Cindy version lacks the plugin runtime interface this feature needs. Upgrade to 0.1.92 or later. The account list still works.',
    earlierDraftUnconfirmed: 'The outcome of an earlier draft operation is not fully confirmed. Check the actual state in the mailbox first; do not send, save or delete again.',
    executedUnreturned: 'The mailbox operation was executed, but its result was not fully returned. Check the actual state in the mailbox first; do not send, save or delete again.',
    outcomeUnknown: 'Could not confirm the outcome of the mailbox operation. Check the actual state in the mailbox first; do not send, save or delete again.',
    prepareFailed: 'Could not prepare the Gmail operation. Check the account and attachment inputs.',
  },
  ja: {
    contactText: "{name} は長さ制限内の空でないテキストで指定してください。",
    contactAction: "不明な連絡先操作です。gmail_contacts のパラメータを確認してください。",
    contactReadonly: "このタスクは読み取り専用です。Google コンタクトは変更していません。",
    contactRuntime: "この Cindy は連絡先の通信インターフェースに対応していません。Cindy を更新してください。",
    contactResource: "検索結果の連絡先 resourceName を使用してください。people/me や独自に組み立てたパスは使用できません。",
    contactPageSize: "pageSize は 1–100 の整数で指定してください。",
    contactPerson: "person には書き込む連絡先フィールドを 1 つ以上指定してください。",
    contactFieldLimit: "未対応の連絡先フィールド、または項目数が多すぎます：{field}",
    contactItem: "連絡先フィールドの各項目は空でないオブジェクトで指定してください。",
    contactField: "未対応の連絡先フィールド：{field}",
    contactValue: "{field} には value が必要です。",
    contactEmpty: "空の連絡先は作成できません。",
    contactUnknown: "連絡先操作の結果を確認できません。まず Google コンタクトで確認し、むやみに再試行しないでください。",
    contactReadFailed: "連絡先を読み取れません。ネットワーク接続を確認してから再試行してください。",
    contactPermission: "連絡先の権限が不足しているか認証が期限切れです。Gmail プラグインの詳細でこのアカウントを再接続し認証してください。組織ディレクトリには組織の許可も必要です。既存のメール権限は引き続き使用できます。",
    contactRejected: "Google が連絡先操作を拒否しました。連絡先を再取得し、フィールドと etag を確認してください。情報が更新された可能性があります。",
    contactNotFound: "連絡先が見つかりません。再検索して resourceName を確認してください。",
    contactUnavailable: "Google コンタクトは一時的に利用できません。ネットワークを確認するか、後で再取得してください。",
    contactReceipt: "連絡先操作は実行されましたが、結果が不完全です。まず Google コンタクトで確認し、作成や更新を繰り返さないでください。",
    contactResponse: "連絡先の応答が不完全です。検索範囲を絞って再取得してください。",
    contactSearchPage: "連絡先検索は pageToken に対応していません。ページ取得には list を使用してください。",
    contactChanged: "連絡先が変更されたか、編集可能な個人の連絡先ではありません。再取得して変更内容を確認してください。変更は書き込んでいません。",
    contactFailed: "連絡先操作に失敗しました。Google コンタクトで実際の状態を確認してください。",
    contactDelivery: "連絡先の結果をすべて返せませんでした。まず Google コンタクトで実際の状態を確認し、作成、更新、削除を繰り返さないでください。",
    inlineImagesType: 'inline-images は PNG、JPEG、GIF、WebP 画像のみ対応しています。その他のメディアは通常の添付ファイルとして追加してください。',
    accountServiceUnreachable: 'Cindy のローカルアカウントサービスに接続できません。しばらくしてから再試行してください。失敗が続く場合は、Gmail プラグインの詳細を開き直してサービスの状態を確認してください',
    accountServiceNoResult: 'Cindy のローカルアカウントサービスから結果が返されませんでした。しばらくしてから再試行してください',
    accountServiceDenied: 'アカウント状態サービスがアクセスを拒否しました。Gmail プラグインの詳細で接続状態を確認してから再試行してください（HTTP {status}）',
    accountServiceUnavailable: 'Cindy のローカルアカウントサービスは一時的に利用できません。しばらくしてから再試行してください。失敗が続く場合は、Gmail プラグインの詳細を開き直してサービスの状態を確認してください（HTTP {status}）',
    accountDataUnparsable: 'Cindy のアカウント状態データを解析できません。Gmail プラグインの詳細を開き直してから再試行してください',
    accountDataMalformed: 'Cindy のアカウント状態データの形式が正しくありません。Gmail プラグインの詳細を開き直してから再試行してください',
    clientIdentityMissing: '組み込みアプリの識別情報がありません。Cindy をアップグレードしてから再試行してください',
    accountListMalformed: 'Cindy のアカウント一覧データの形式が正しくありません。Gmail プラグインの詳細を開き直してから再試行してください',
    noAccount: 'アカウントがまだ接続されていません。「{plugin}」の詳細ページで個別に認証してください',
    notExecuted: '未実行：{reason}',
    multipleAccounts: '未実行：複数のアカウントが接続されています。アカウントを明示的に選び、account に指定してください。',
    accountNotFound: '未実行：指定したアカウントは存在しません。アカウントを選び直してください。別のアカウントに切り替えることはありません。',
    accountReauth: '未実行：アカウント {account} の認証が期限切れか、権限が不足しています。プラグインの詳細ページでこのアカウントを再接続してください。',
    readParseData: 'Gmail のメールデータを解析できません。ネットワーク接続を確認してからメールを開き直すか、メールボックスで確認してください。',
    readParseBody: 'Gmail のメール本文を解析できません。メールを開き直すか、メールボックスで確認してください。',
    readUnauthorized: 'Gmail アカウントの認証が期限切れです。プラグインの詳細ページでこのアカウントを再接続してから、メールを開き直してください。',
    readForbidden: 'Gmail が読み取りを拒否しました。このアカウントのメール読み取り権限を確認し、プラグインの詳細ページで再接続または再認証してください。',
    linkAccountMismatch: 'メールのリンクが指定した Gmail アカウントと一致しません。リンクに対応するアカウントを選んでから開いてください。',
    readThreadFailed: 'Gmail のスレッドを読み込めません。ネットワーク接続を確認してから開き直してください。',
    readMessageFailed: 'Gmail のメールを読み込めません。ネットワーク接続と、メールがまだメールボックスにあるかを確認してから開き直してください。',
    readBodyIncomplete: 'メール本文をすべて読み込めませんでした',
    readBodyFailed: 'メール本文をすべて読み込めませんでした。ネットワーク接続を確認してから開き直してください。',
    readBodySizeMismatch: 'メール本文のサイズが一致しません',
    markReadFailed: '既読にできませんでした。メールボックスの認証とメールの状態を確認してから操作してください。',
    markReadUnknown: '既読になったか確認できません。まずメールボックスで確認し、むやみに再試行しないでください。',
    sendRequiresDraft: 'メールは送信されていません。まず drafts create / drafts reply / drafts reply-all で下書きを作成して表示し、drafts send で送信してください。Cindy の共通メールフローでは 10 秒間の取り消し猶予があります。下書きフローを省いて直接送信しないでください。',
    mailFlowUnsupported: 'この Cindy は共通メールフローに対応していません。Cindy を更新してから下書きを作成、編集、送信してください。',
    draftCommandShape: '完全な下書きコマンドと、下書き ID を 1 つだけ指定してください。',
    sendDraftIdOnly: '既存の下書きの送信では下書き ID のみ指定できます。変更する場合は先にその下書きを更新してください。',
    undoWindowUnsupported: 'この Cindy は送信前の 10 秒間の取り消し猶予にまだ対応していません。Cindy を更新してから送信してください。下書きは保持されています。',
    unknownTool: '未実行：不明なツールです。現在のプラグインのツール一覧を確認し直してください。',
    runtimeMissing: '未実行：この Cindy には、この機能に必要なプラグイン実行インターフェースがありません。0.1.92 以降にアップグレードしてください。アカウント一覧は引き続き使用できます。',
    earlierDraftUnconfirmed: '先に行った下書き操作の結果がまだ確定していません。まずメールボックスの実際の状態を確認し、送信、保存、削除を繰り返さないでください。',
    executedUnreturned: 'メールボックスの操作は実行されましたが、結果をすべて返せませんでした。まずメールボックスの実際の状態を確認し、送信、保存、削除を繰り返さないでください。',
    outcomeUnknown: 'メールボックス操作の結果を確認できません。まずメールボックスの実際の状態を確認し、送信、保存、削除を繰り返さないでください。',
    prepareFailed: 'Gmail の操作を準備できません。アカウントと添付ファイルの入力を確認してください。',
  },
  ko: {
    contactText: "{name}은(는) 길이 제한 내의 비어 있지 않은 텍스트여야 합니다.",
    contactAction: "알 수 없는 연락처 작업입니다. gmail_contacts 매개변수를 확인하세요.",
    contactReadonly: "이 작업은 읽기 전용입니다. Google 연락처를 수정하지 않았습니다.",
    contactRuntime: "이 Cindy 버전은 연락처 요청을 지원하지 않습니다. Cindy를 업데이트하세요.",
    contactResource: "조회 결과의 연락처 resourceName을 사용하세요. people/me 또는 직접 만든 경로는 사용할 수 없습니다.",
    contactPageSize: "pageSize는 1–100 사이의 정수여야 합니다.",
    contactPerson: "person에는 쓸 연락처 필드가 하나 이상 필요합니다.",
    contactFieldLimit: "지원하지 않는 연락처 필드이거나 항목이 너무 많습니다: {field}",
    contactItem: "연락처 필드 항목은 비어 있지 않은 객체여야 합니다.",
    contactField: "지원하지 않는 연락처 필드: {field}",
    contactValue: "{field}에는 value가 필요합니다.",
    contactEmpty: "빈 연락처를 만들 수 없습니다.",
    contactUnknown: "연락처 작업 결과를 확인할 수 없습니다. 먼저 Google 연락처에서 확인하고 무작정 다시 시도하지 마세요.",
    contactReadFailed: "연락처를 읽지 못했습니다. 네트워크 연결을 확인한 후 다시 시도하세요.",
    contactPermission: "연락처 권한이 없거나 인증이 만료되었습니다. Gmail 플러그인 상세 페이지에서 이 계정을 다시 연결하고 승인하세요. 조직 디렉터리는 조직의 허용도 필요합니다. 기존 메일 권한은 계속 사용할 수 있습니다.",
    contactRejected: "Google이 연락처 작업을 거부했습니다. 연락처를 다시 읽고 필드와 etag를 확인하세요. 정보가 변경되었을 수 있습니다.",
    contactNotFound: "연락처를 찾을 수 없습니다. 다시 조회하고 resourceName을 확인하세요.",
    contactUnavailable: "Google 연락처를 일시적으로 사용할 수 없습니다. 네트워크를 확인하거나 나중에 다시 읽으세요.",
    contactReceipt: "연락처 작업은 실행되었지만 결과가 불완전합니다. 먼저 Google 연락처에서 확인하고 만들기나 수정을 반복하지 마세요.",
    contactResponse: "연락처 응답이 불완전합니다. 조회 범위를 좁혀 다시 읽으세요.",
    contactSearchPage: "연락처 검색은 pageToken을 지원하지 않습니다. 페이지 조회에는 list를 사용하세요.",
    contactChanged: "연락처가 변경되었거나 수정할 수 있는 개인 연락처가 아닙니다. 다시 읽고 변경 내용을 확인하세요. 변경 사항을 쓰지 않았습니다.",
    contactFailed: "연락처 작업에 실패했습니다. Google 연락처에서 실제 상태를 확인하세요.",
    contactDelivery: "연락처 결과가 완전히 반환되지 않았습니다. 먼저 Google 연락처에서 실제 상태를 확인하고 만들기, 수정 또는 삭제를 반복하지 마세요.",
    inlineImagesType: 'inline-images는 PNG, JPEG, GIF, WebP 이미지만 지원합니다. 다른 미디어는 일반 첨부 파일로 추가하세요.',
    accountServiceUnreachable: 'Cindy 로컬 계정 서비스에 연결할 수 없습니다. 잠시 후 다시 시도하세요. 계속 실패하면 Gmail 플러그인 상세 페이지를 다시 열어 서비스 상태를 확인하세요',
    accountServiceNoResult: 'Cindy 로컬 계정 서비스가 결과를 반환하지 않았습니다. 잠시 후 다시 시도하세요',
    accountServiceDenied: '계정 상태 서비스가 접근을 거부했습니다. Gmail 플러그인 상세 페이지에서 연결 상태를 확인한 후 다시 시도하세요 (HTTP {status})',
    accountServiceUnavailable: 'Cindy 로컬 계정 서비스를 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도하세요. 계속 실패하면 Gmail 플러그인 상세 페이지를 다시 열어 서비스 상태를 확인하세요 (HTTP {status})',
    accountDataUnparsable: 'Cindy 계정 상태 데이터를 해석할 수 없습니다. Gmail 플러그인 상세 페이지를 다시 연 후 다시 시도하세요',
    accountDataMalformed: 'Cindy 계정 상태 데이터 형식이 올바르지 않습니다. Gmail 플러그인 상세 페이지를 다시 연 후 다시 시도하세요',
    clientIdentityMissing: '내장 앱 식별 정보가 없습니다. Cindy를 업그레이드한 후 다시 시도하세요',
    accountListMalformed: 'Cindy 계정 목록 데이터 형식이 올바르지 않습니다. Gmail 플러그인 상세 페이지를 다시 연 후 다시 시도하세요',
    noAccount: '아직 연결된 계정이 없습니다. "{plugin}" 상세 페이지에서 별도로 승인하세요',
    notExecuted: '실행되지 않음: {reason}',
    multipleAccounts: '실행되지 않음: 여러 계정이 연결되어 있습니다. 계정을 명시적으로 선택해 account로 전달하세요.',
    accountNotFound: '실행되지 않음: 지정한 계정이 없습니다. 계정을 다시 선택하세요. 다른 계정으로 전환하지 않습니다.',
    accountReauth: '실행되지 않음: 계정 {account}의 인증이 만료되었거나 권한이 부족합니다. 플러그인 상세 페이지에서 이 계정을 다시 연결하세요.',
    readParseData: 'Gmail 메일 데이터를 해석할 수 없습니다. 네트워크 연결을 확인한 후 메일을 다시 열거나 메일함에서 확인하세요.',
    readParseBody: 'Gmail 메일 본문을 해석할 수 없습니다. 메일을 다시 열거나 메일함에서 확인하세요.',
    readUnauthorized: 'Gmail 계정 인증이 만료되었습니다. 플러그인 상세 페이지에서 이 계정을 다시 연결한 후 메일을 다시 여세요.',
    readForbidden: 'Gmail이 읽기를 거부했습니다. 이 계정의 메일 읽기 권한을 확인하고 플러그인 상세 페이지에서 다시 연결하거나 다시 승인하세요.',
    linkAccountMismatch: '메일 링크가 지정한 Gmail 계정과 일치하지 않습니다. 링크에 해당하는 계정을 선택한 후 다시 여세요.',
    readThreadFailed: 'Gmail 대화를 읽을 수 없습니다. 네트워크 연결을 확인한 후 다시 여세요.',
    readMessageFailed: 'Gmail 메일을 읽을 수 없습니다. 네트워크 연결과 메일이 아직 메일함에 있는지 확인한 후 다시 여세요.',
    readBodyIncomplete: '메일 본문 전체를 읽을 수 없습니다',
    readBodyFailed: '메일 본문 전체를 읽을 수 없습니다. 네트워크 연결을 확인한 후 다시 여세요.',
    readBodySizeMismatch: '메일 본문 크기가 일치하지 않습니다',
    markReadFailed: '읽음으로 표시하지 못했습니다. 메일함 인증과 메일 상태를 확인한 후 다시 시도하세요.',
    markReadUnknown: '읽음 상태를 확인할 수 없습니다. 먼저 메일함에서 확인하고, 무작정 다시 시도하지 마세요.',
    sendRequiresDraft: '메일이 전송되지 않았습니다. 먼저 drafts create / drafts reply / drafts reply-all로 초안을 만들어 표시한 후 drafts send로 전송하세요. Cindy 공통 메일 흐름은 10초 실행 취소 시간을 제공합니다. 초안 흐름을 건너뛰고 바로 전송하지 마세요.',
    mailFlowUnsupported: '현재 Cindy는 공통 메일 흐름을 지원하지 않습니다. Cindy를 업데이트한 후 초안을 만들거나 편집하거나 전송하세요.',
    draftCommandShape: '완전한 초안 명령과 초안 ID 하나를 사용하세요.',
    sendDraftIdOnly: '기존 초안 전송에는 초안 ID만 사용할 수 있습니다. 수정하려면 먼저 해당 초안을 업데이트하세요.',
    undoWindowUnsupported: '현재 Cindy는 전송 전 10초 실행 취소 시간을 아직 지원하지 않습니다. Cindy를 업데이트한 후 전송하세요. 초안은 그대로 유지됩니다.',
    unknownTool: '실행되지 않음: 알 수 없는 도구입니다. 현재 플러그인 도구 목록을 다시 확인하세요.',
    runtimeMissing: '실행되지 않음: 현재 Cindy에는 이 기능에 필요한 플러그인 실행 인터페이스가 없습니다. 0.1.92 이상으로 업그레이드하세요. 계정 목록은 계속 사용할 수 있습니다.',
    earlierDraftUnconfirmed: '이전 초안 작업 결과가 아직 완전히 확인되지 않았습니다. 먼저 메일함의 실제 상태를 확인하고, 전송, 저장 또는 삭제를 반복하지 마세요.',
    executedUnreturned: '메일함 작업은 실행되었지만 결과가 완전히 반환되지 않았습니다. 먼저 메일함의 실제 상태를 확인하고, 전송, 저장 또는 삭제를 반복하지 마세요.',
    outcomeUnknown: '메일함 작업 결과를 확인할 수 없습니다. 먼저 메일함의 실제 상태를 확인하고, 전송, 저장 또는 삭제를 반복하지 마세요.',
    prepareFailed: 'Gmail 작업을 준비할 수 없습니다. 계정과 첨부 파일 입력을 확인하세요.',
  },
};
var hasOwn = Object.prototype.hasOwnProperty;
// null until the Host answers; English is used meanwhile and the next call asks again.
var hostLocale = null;
var localeRequest = null;
function supportedLocale(value) {
  return typeof value === 'string' && hasOwn.call(MESSAGES, value) ? value : 'en';
}
function currentLocale() { return hostLocale || 'en'; }
function t(key, values) {
  var table = MESSAGES[currentLocale()];
  var template = hasOwn.call(table, key) ? table[key] : MESSAGES.en[key];
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, function (all, name) { return hasOwn.call(values, name) ? String(values[name]) : all; });
}
async function requestHostLocale() {
  if (typeof cindy === 'undefined' || typeof cindy.request !== 'function') return null;
  var timer = null;
  try {
    // An unanswered Host must not hold up mail work: after 3 s use English and
    // ask again on the next call.
    var reply = await Promise.race([
      cindy.request({ kind: 'app-context' }),
      new Promise(function (resolve) { timer = setTimeout(function () { resolve(null); }, 3000); }),
    ]);
    var locale = reply && reply.ok && reply.context && reply.context.locale;
    return typeof locale === 'string' ? supportedLocale(locale) : null;
  } catch (_) {
    return null;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
// Concurrent lookups share one request. A success is cached;
// host-context-changed keeps it current afterwards.
function lookupLocale() {
  if (hostLocale) return Promise.resolve(hostLocale);
  if (!localeRequest) {
    localeRequest = requestHostLocale().then(function (locale) {
      localeRequest = null;
      // A host-context-changed that arrived meanwhile is newer; keep it.
      if (!hostLocale && locale) hostLocale = locale;
      return currentLocale();
    });
  }
  return localeRequest;
}
// One operation (a tool call, or a mail card callback that writes, reads or
// deletes a draft) waits for the Host locale at most once. Later helpers of the
// same operation reuse that outcome (English after a timeout); other operations
// keep their own budget, and join a lookup that is still pending instead of
// sending a second request.
function localeOperation() { return { waited: false }; }
function ensureLocale(operation) {
  if (hostLocale) return Promise.resolve(hostLocale);
  if (operation.waited) return Promise.resolve(currentLocale());
  operation.waited = true;
  return lookupLocale();
}
// Tool calls in flight, by callId. The mail SDK passes the originating callId
// as sourceCallId to draft callbacks made on behalf of a tool call.
var toolOperations = new Map();
function draftOperation(sourceCallId) {
  return (sourceCallId && toolOperations.get(sourceCallId)) || localeOperation();
}
// Host grants contain hashes, not filesystem paths. Read only those grants
// through the plugin media protocol, then use the existing workdir file bridge.
async function prepareMailAttachments(args, callId) {
  var options = Object.assign({}, args.options || {});
  var hashes = args.attachments || [];
  var inputs = options.attach === undefined ? [] : Array.isArray(options.attach) ? options.attach.slice() : [options.attach];
  var refs = inputs.filter(function (item) { return typeof item === 'string' && item.startsWith('cindy-media:'); });
  if (!hashes.length && !refs.length) return { options: options, files: [] };
  if (!Array.isArray(hashes) || hashes.some(function (hash) { return typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash); })) {
    throw new Error('Invalid media grant; pass attachments through ghost_call.');
  }
  var command = (args.command || []).join(' ');
  if (!['send', 'reply', 'reply-all', 'drafts create', 'drafts update', 'drafts reply', 'drafts reply-all'].includes(command)) {
    throw new Error('This command cannot add chat attachments. Use drafts create/update/reply, then send the saved draft.');
  }
  var context = args.session_context;
  if (!context || context.workdir_is_local !== true || context.workdir_is_read_only !== false || !context.workdir || typeof cindy.fs !== 'function') {
    throw new Error('Chat attachments need a writable local task directory and Cindy 0.1.92 or newer.');
  }
  var extensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'webm', 'mov', 'mp3', 'wav', 'm4a', 'ogg', 'glb'];
  var preferred = {};
  refs.forEach(function (ref) {
    var match = /^cindy-media:\/\/blobs\/([a-f0-9]{64})\.([a-z0-9]+)$/.exec(ref);
    if (!match || !hashes.includes(match[1]) || !extensions.includes(match[2])) {
      throw new Error('Media URL has no matching Host grant; pass it in ghost_call attachments too.');
    }
    preferred[match[1]] = match[2];
  });
  if (options['clear-attachments']) throw new Error('Chat attachments cannot be combined with clear-attachments.');
  var inline = options['inline-images'];
  if (inline !== undefined && (!Array.isArray(inline) || !inline.length || inline.some(function (item) { return typeof item !== 'string'; }))) {
    throw new Error('inline-images must be a non-empty list of granted image hashes.');
  }
  if (inline && command !== 'drafts create') throw new Error('Create an HTML draft with inline-images first, then use the common draft send workflow.');
  if (inline && options['raw-file']) throw new Error('Do not combine inline-images with a caller-supplied raw-file.');
  var directory = 'gmail-attachments/' + crypto.randomUUID();
  var files = [];
  var total = 0;
  for (var hash of new Set(hashes)) {
    var response;
    var extension = undefined;
    // The grant protocol omits extensions. A supplied media URL avoids probing;
    // otherwise look up this granted hash in the Host's supported media types.
    for (var ext of preferred[hash] ? [preferred[hash]] : extensions) {
      // Same-origin Host protocol, not an external network request.
      // serveGhostMedia checks ghostCanRead (including ghost-tool-grant) before
      // reading bytes. The HTTPS bridge is not used for this local protocol.
      response = await fetch('/media/' + hash + '.' + ext);
      if (response.ok) { extension = ext; break; }
      if (response.status !== 404) throw new Error('Unable to read chat attachment; check the plugin media service.');
    }
    if (!extension) throw new Error('Chat attachment unavailable; attach the file again before retrying.');
    var blob = await response.blob();
    total += blob.size;
    if (!blob.size || blob.size > 16 * 1024 * 1024 || total > 25 * 1024 * 1024) {
      throw new Error('Chat attachment exceeds import limits (16 MiB per file, 25 MiB total); use a smaller file or a cloud link.');
    }
    var bytes = new Uint8Array(await blob.arrayBuffer());
    var digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    if (digest !== hash) throw new Error('Chat attachment integrity check failed; attach the file again.');
    var chunks = [];
    for (var i = 0; i < bytes.length; i += 32768) chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 32768)));
    var relativePath = directory + '/attachment-' + (files.length + 1) + '.' + extension;
    var saved = await cindy.fs({ op: 'write', root: 'workdir', path: relativePath,
      encoding: 'base64', content: btoa(chunks.join('')), callId: callId });
    if (!saved || !saved.ok) throw new Error('Unable to import chat attachment into the task directory; check file permissions.');
    files.push({ path: relativePath, bytes: bytes.length, hash: hash, contentType: blob.type || 'application/octet-stream' });
  }
  var inlineSet = new Set(inline || []);
  var embedded = (inline || []).map(function (hash) { return files.find(function (file) { return file.hash === hash; }); });
  if (embedded.some(function (file) { return !file; })) throw new Error('Every inline image must also be a granted chat attachment.');
  if (embedded.some(function (file) { return !/\.(png|jpe?g|gif|webp)$/i.test(file.path); }))
    throw new Error(t('inlineImagesType'));
  var regular = files.filter(function (file) { return !inlineSet.has(file.hash); });
  options.attach = inputs.filter(function (item) { return !refs.includes(item); }).concat(regular.map(function (file) { return file.path; }));
  delete options['inline-images'];
  return { options: options, files: files, inline: embedded };
}
async function listAccounts(operation) {
  await ensureLocale(operation || localeOperation());
  var response;
  try {
    response = await fetch('/oauth');
  } catch (_transportError) {
    return fail(t('accountServiceUnreachable'));
  }
  if (!response) return fail(t('accountServiceNoResult'));
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) return fail(t('accountServiceDenied', { status: response.status }));
    return fail(t('accountServiceUnavailable', { status: response.status }));
  }
  var entries;
  try {
    entries = await response.json();
  } catch (_parseError) {
    return fail(t('accountDataUnparsable'));
  }
  if (!Array.isArray(entries)) return fail(t('accountDataMalformed'));
  var entry = entries.find(function (item) { return item && item.key === SECRET_KEY; });
  if (!entry || !entry.clientConfigured) return fail(t('clientIdentityMissing'));
  if (!Array.isArray(entry.accounts) || entry.accounts.some(function (account) { return !account || typeof account.id !== 'string' || !account.id; })) {
    return fail(t('accountListMalformed'));
  }
  if (!entry.accounts.length) return fail(t('noAccount', { plugin: PLUGIN_NAME }));
  return { ok: true, result: {
    accounts: (await googleAccountMetadata.list(SECRET_KEY, entry.accounts)).map(function (account) {
      return { id: account.id, email: account.label, nickname: account.nickname || '',
        status: account.status, scope_stale: account.scopeStale === true };
    }),
  } };
}
async function selectGoogleAccount(accountId, operation) {
  var listed = await listAccounts(operation);
  if (!listed.ok) return fail(t('notExecuted', { reason: listed.message }));
  var accounts = listed.result.accounts;
  if (accountId === undefined && accounts.length !== 1) {
    return fail(t('multipleAccounts'));
  }
  var account = accountId === undefined ? accounts[0] : accounts.find(function (item) { return item.id === accountId; });
  if (!account) return fail(t('accountNotFound'));
  // Newly added scopes are a non-blocking hint: existing read/compose grants
  // remain usable. Let the requested endpoint report its actual missing scope.
  if (account.status !== 'connected') {
    return fail(t('accountReauth', { account: account.email || account.id }));
  }
  return { ok: true, accountId: account.id, accountEmail: account.email };
}
// Gmail only translates account/CLI arguments and transport results. The shared
// flow owns card edits, autosave, sending and continuation.
async function mailImagePreviews(readBack, accountId, previous) {
  if (!readBack) return readBack;
  var sources = readBack.attachments || [];
  // Inline bytes are worker-to-preview transport, never card/model metadata.
  var attachments = sources.map(function ({ inlineData, ...metadata }) { return metadata; });
  var images = [];
  var previewStarted = Date.now(), previewBytes = 0, maxImageBytes = 16 * 1024 * 1024;
  for (var i = 0; i < attachments.length; i++) {
    if (Date.now() - previewStarted > 15000) break;
    var attachment = attachments[i];
    if (!/^image\/(png|jpeg|gif|webp)$/.test(attachment.mimeType) || !Number.isSafeInteger(attachment.bytes)
      || attachment.bytes < 0 || attachment.bytes > maxImageBytes || previewBytes + attachment.bytes > 25 * 1024 * 1024) continue;
    var cid = (attachment.contentId || '').replace(/^<|>$/g, '');
    // Gmail changes the message/part IDs on a draft update. Never reuse a CID
    // alone: the AI may have replaced its bytes while keeping its name.
    var existing = previous?.messageId === readBack.messageId && previous?.attachments?.find(function (a) { return a.key === attachment.key; });
    if (existing?.previewUrl) { attachment.previewUrl = existing.previewUrl; if (cid) images.push({ cid, url: existing.previewUrl }); continue; }
    try {
      var data = sources[i].inlineData;
      if (typeof data !== 'string') {
        if (!attachment.attachmentId || typeof cindy.fetch !== 'function') continue;
        var response = await cindy.fetch({ url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/' + encodeURIComponent(readBack.messageId) + '/attachments/' + encodeURIComponent(attachment.attachmentId), authAccount: accountId, timeoutMs: 5000 });
        if (!response.ok || response.status !== 200 || response.truncated) continue;
        data = parseMailReadJson(response.body).data;
      }
      if (typeof data !== 'string' || data.length > 4 * Math.ceil(maxImageBytes / 3)
        || !/^[A-Za-z0-9_-]*={0,2}$/.test(data)) continue;
      data = data.replace(/-/g, '+').replace(/_/g, '/');
      if (atob(data).length !== attachment.bytes) continue;
      previewBytes += attachment.bytes;
      var deposited = await cindy.send({ type: 'cindy-request', kind: 'deposit_media', data: data, label: attachment.filename });
      if (deposited.ok) { attachment.previewUrl = deposited.url; if (cid) images.push({ cid: cid, url: deposited.url }); }
    } catch (_) { /* A preview failure cannot invalidate a verified saved draft. */ }
  }
  return { ...readBack, attachments: attachments, images: images };
}
var gmailCompose = typeof cindyMail !== 'undefined' && cindyMail.version === 1 ? cindyMail.register({
  providerName: 'Gmail', draftStorage: 'server', storageLock: 'google-account-metadata', richText: true,
  // The SDK calls this without a callId, ahead of the draft callback that does
  // the operation's lookup, so it never waits: it uses the locale known so far.
  selectAccount: function (accountId) { return selectGoogleAccount(accountId, { waited: true }); },
  async deleteDraft({ record, sourceCallId }) {
    await ensureLocale(draftOperation(sourceCallId));
    var response = await cindy.node.request({ method: 'run', authAccount: record.account,
      params: { command: ['drafts', 'delete'], arguments: [record.draftId], options: {}, readOnly: false, locale: currentLocale() }, timeoutMs: 120000 });
    var result = response && response.ok && response.result;
    return result?.ok ? { ...result, data: { deleted: true, draftId: record.draftId } } : result;
  },
  async readDraft({ record, sourceCallId }) {
    await ensureLocale(draftOperation(sourceCallId));
    var response = await cindy.node.request({ method: 'run', authAccount: record.account,
      params: { command: ['drafts', 'get'], arguments: [record.draftId], options: {}, readOnly: true, locale: currentLocale() }, timeoutMs: 120000 });
    var result = response && response.ok && response.result;
    if (result?.ok && result.data?.readBack) result.data.readBack = await mailImagePreviews(result.data.readBack, record.account);
    return result;
  },
  async writeDraft({ record, account, fields, send, attachments, readBack, sourceCallId }) {
    await ensureLocale(draftOperation(sourceCallId));
    var response = await cindy.node.request({ method: 'compose', authAccount: record.account,
      params: { draftId: record.draftId, fingerprint: record.fingerprint, accountEmail: account.accountEmail, fields, send, attachments, locale: currentLocale() }, timeoutMs: 120000 });
    var result = response && response.ok && response.result;
    if (result?.ok && result.data?.readBack) result.data.readBack = await mailImagePreviews(result.data.readBack, record.account, readBack);
    if (result && result.ok && result.data && result.data.sent) {
      result = { ...result, data: { ...result.data,
        receipt: { messageId: result.data.messageId || null, threadId: result.data.threadId || null } } };
    }
    return result;
  },
}) : null;

// Native reader adapter; only an explicit opening may remove the selected UNREAD label.
function parseMailReadJson(body) {
  try {
    var value = JSON.parse(body);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch (_) {
    throw new Error(t('readParseData'));
  }
}
function decodeMailReadBytes(data) {
  try { return atob(data.replace(/-/g, '+').replace(/_/g, '/')); }
  catch (_) { throw new Error(t('readParseBody')); }
}
function assertMailReadResponse(response, fallback) {
  if (response.status === 401) throw new Error(t('readUnauthorized'));
  if (response.status === 403) throw new Error(t('readForbidden'));
  if (!response.ok || response.status !== 200 || response.truncated) throw new Error(fallback);
}
// Optional read-only enrichment. Account-scoped, bounded, in-memory only; a
// missing new OAuth scope or an unavailable People API never prevents reading.
var mailPhotoCache = new Map();
async function lookupMailParticipantPhotos(accountId, headers) {
  var emails = [], pieces = [], start = 0, quoted = false, escaped = false, angle = 0;
  var input = headers.join(', ');
  for (var i = 0; i <= input.length; i++) {
    var char = input[i];
    if (escaped) { escaped = false; continue; }
    if (char === '\\' && quoted) { escaped = true; continue; }
    if (char === '"') quoted = !quoted;
    if (!quoted && char === '<') angle++;
    if (!quoted && char === '>') angle = Math.max(0, angle - 1);
    if (i === input.length || (!quoted && !angle && (char === ',' || char === ';'))) { pieces.push(input.slice(start, i)); start = i + 1; }
  }
  for (var piece of pieces) {
    var email = (/<([^<>]+)>\s*$/.exec(piece.trim())?.[1] || piece).trim().toLowerCase();
    if (email.length <= 320 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(email) && !emails.includes(email)) emails.push(email);
  }
  // Large mailing lists use public/initial fallbacks beyond the first 12 people.
  emails = emails.slice(0, 12);
  var deadline = Date.now() + 2000;
  async function search(query) {
    var remaining = deadline - Date.now();
    if (remaining < 100) return null;
    var response = await cindy.fetch({ url: 'https://people.googleapis.com/v1/people:searchContacts?readMask=emailAddresses%2Cphotos&pageSize=30&query=' + encodeURIComponent(query),
      authAccount: accountId, timeoutMs: Math.min(1000, remaining) });
    if (!response.ok || response.status !== 200 || response.truncated) return null;
    var data = JSON.parse(response.body);
    return Array.isArray(data.results) ? data.results : [];
  }
  var warmup;
  var photos = await Promise.all(emails.map(async function (email) {
    var key = JSON.stringify([accountId, email]);
    var cached = mailPhotoCache.get(key);
    if (cached && cached.until > Date.now()) return cached.value;
    // One warmup per batch; parallel readers share in-flight email lookups.
    if (!warmup) warmup = search('').catch(function () { return null; });
    var value = (async function () {
      try {
        if (await warmup === null) return null;
        var results = await search(email);
        for (var result of results || []) {
          var person = result.person;
          if (!person || !Array.isArray(person.emailAddresses) || !person.emailAddresses.some(function (a) { return typeof a.value === 'string' && a.value.trim().toLowerCase() === email; })) continue;
          for (var photo of Array.isArray(person.photos) ? person.photos : []) {
            if (photo.default === true || typeof photo.url !== 'string' || photo.url.length > 2048) continue;
            var url = new URL(photo.url);
            if (url.protocol === 'https:' && !url.username && !url.password && !url.port &&
                (url.hostname === 'googleusercontent.com' || url.hostname.endsWith('.googleusercontent.com'))) return { email: email, url: url.href };
          }
        }
      } catch (_) { /* Best effort: keep mail and public avatar fallbacks available. */ }
      return null;
    })();
    mailPhotoCache.delete(key);
    mailPhotoCache.set(key, { until: Date.now() + 60000, value: value });
    while (mailPhotoCache.size > 256) mailPhotoCache.delete(mailPhotoCache.keys().next().value);
    return value;
  }));
  return photos.filter(Boolean);
}

async function readMailMessageLink(args, beginOperation, operation) {
  if (args.markRead !== undefined && typeof args.markRead !== 'boolean') throw new Error('Invalid markRead flag');
  var url = new URL(args.url);
  if (url.protocol !== 'https:' || url.hostname !== 'mail.google.com' || url.port || url.username || url.password || !url.pathname.startsWith('/mail/'))
    throw new Error('Unsupported Gmail link');
  var id = url.searchParams.get('permmsgid') || url.hash.split('/').pop();
  if (!/^[a-f0-9]{8,32}$/i.test(id || '')) throw new Error('This Gmail link cannot be resolved; open it in Gmail.');
  var listed = await listAccounts(operation);
  if (!listed.ok) throw new Error(listed.message);
  var email = url.searchParams.get('authuser');
  var accountId = args.account;
  if (email && email.includes('@')) {
    var matches = listed.result.accounts.filter(function (a) { return a.email.toLowerCase() === email.toLowerCase(); });
    if (matches.length !== 1) throw new Error('The Gmail account in this link is not connected.');
    if (accountId !== undefined && accountId !== matches[0].id)
      throw new Error(t('linkAccountMismatch'));
    accountId = matches[0].id;
  }
  var selected = await selectGoogleAccount(accountId, operation);
  if (!selected.ok) throw new Error(selected.message);
  var response = await cindy.fetch({ url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/' + encodeURIComponent(id) + '?format=full', authAccount: selected.accountId, timeoutMs: 20000 });
  // Gmail web links can identify a conversation whose original draft message
  // has been replaced. Resolve that conversation without changing accounts or
  // mistaking an authentication/network failure for a missing message.
  if (response.status === 404 && !url.searchParams.has('permmsgid')) {
    var threadResponse = await cindy.fetch({ url: 'https://gmail.googleapis.com/gmail/v1/users/me/threads/' + encodeURIComponent(id) + '?format=metadata', authAccount: selected.accountId, timeoutMs: 20000 });
    assertMailReadResponse(threadResponse, t('readThreadFailed'));
    var thread = parseMailReadJson(threadResponse.body);
    var latest = (Array.isArray(thread.messages) ? thread.messages : []).filter(function (m) {
      return /^[a-f0-9]{8,32}$/i.test(m.id || '') && !(m.labelIds || []).includes('DRAFT');
    }).reduce(function (a, b) { return !a || Number(b.internalDate || 0) >= Number(a.internalDate || 0) ? b : a; }, null);
    if (!latest || latest.id === id) throw new Error('No readable message remains in this Gmail conversation.');
    response = await cindy.fetch({ url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/' + encodeURIComponent(latest.id) + '?format=full', authAccount: selected.accountId, timeoutMs: 20000 });
  }
  assertMailReadResponse(response, t('readMessageFailed'));
  var message = parseMailReadJson(response.body);
  if (!/^[a-f0-9]{8,32}$/i.test(message.id || '') || !message.payload) throw new Error('Incomplete Gmail message');
  var photos = lookupMailParticipantPhotos(selected.accountId, ['from', 'to', 'cc', 'bcc'].map(function (name) { return header(message.payload, name); })).catch(function () { return []; });
  var conversation, conversationUnavailable = false;
  // Read only metadata for the surrounding messages. Cindy requests a body
  // through the same reader when the user expands that message.
  if (message.threadId || thread) {
    try {
      if (!thread) {
        var metadata = await cindy.fetch({ url: 'https://gmail.googleapis.com/gmail/v1/users/me/threads/' + encodeURIComponent(message.threadId) + '?format=metadata', authAccount: selected.accountId, timeoutMs: 20000 });
        if (!metadata.ok || metadata.status !== 200 || metadata.truncated) throw new Error('Conversation unavailable');
        thread = parseMailReadJson(metadata.body);
      }
      if (!Array.isArray(thread.messages)) throw new Error('Incomplete conversation');
      var members = thread.messages.filter(function (m) {
        return /^[a-f0-9]{8,32}$/i.test(m.id || '') && (!(m.labelIds || []).includes('DRAFT') || m.id === message.id);
      }).sort(function (a, b) { return Number(a.internalDate || 0) - Number(b.internalDate || 0); });
      if (!members.some(function (m) { return m.id === message.id; })) throw new Error('Message missing from conversation');
      conversation = { threadId: thread.id || message.threadId || id, messages: members.map(function (m) {
        return { messageId: m.id,
          url: 'https://mail.google.com/mail/?authuser=' + encodeURIComponent(selected.accountEmail) + '&permmsgid=' + encodeURIComponent(m.id) + '#all/' + m.id,
          from: header(m.payload || {}, 'from'), date: header(m.payload || {}, 'date'),
          subject: header(m.payload || {}, 'subject'), snippet: String(m.snippet || '').slice(0, 2048) };
      }) };
    } catch (_) { conversationUnavailable = true; }
  }
  function header(part, name) { return (part.headers || []).filter(function (h) { return h.name.toLowerCase() === name; }).map(function (h) { return h.value; }).join(', '); }
  function decode(part) {
    var match = /(?:^|;)\s*charset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;\s]*))/i.exec(header(part, 'content-type'));
    var decoder;
    try { decoder = new TextDecoder(match && (match[1] || match[2] || match[3]) || 'utf-8'); }
    catch (_) { decoder = new TextDecoder('utf-8'); }
    try { return decoder.decode(Uint8Array.from(decodeMailReadBytes(part.body.data), function (c) { return c.charCodeAt(0); })); }
    catch (_) { throw new Error(t('readParseBody')); }
  }
  var bodies = { 'text/plain': [], 'text/html': [] }, attachments = [];
  var bodyBytes = 0;
  async function walk(part) {
    var body = part.body || {}, cid = header(part, 'content-id').replace(/^<|>$/g, '');
    // Match mailMime.isAttachmentPart in the Node adapter: inline/CID body
    // containers and text alternatives are still body, not attached files.
    var disposition = header(part, 'content-disposition');
    var bodyPart = /^multipart\//i.test(part.mimeType) || /^text\/(plain|html)$/i.test(part.mimeType);
    if (part.filename || /^attachment\b/i.test(disposition) || !bodyPart) {
      attachments.push({ key: part.partId || 'root', filename: part.filename || (/^message\//i.test(part.mimeType) ? 'message.eml' : 'attachment'), mimeType: part.mimeType,
        bytes: body.size, contentId: cid, attachmentId: body.attachmentId, inlineData: body.data });
      return; // Attached .eml messages must never become the outer email body.
    }
    if (bodies[part.mimeType]) {
      if (body.attachmentId && !body.data) {
        if (!Number.isSafeInteger(body.size) || body.size < 0 || bodyBytes + body.size > 25 * 1024 * 1024) throw new Error(t('readBodyIncomplete'));
        var loaded = await cindy.fetch({ url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/' + encodeURIComponent(message.id) + '/attachments/' + encodeURIComponent(body.attachmentId),
          authAccount: selected.accountId, timeoutMs: 20000 });
        assertMailReadResponse(loaded, t('readBodyFailed'));
        var content = parseMailReadJson(loaded.body);
        if (typeof content.data !== 'string' || !/^[A-Za-z0-9_-]*={0,2}$/.test(content.data) || content.size !== body.size
          || decodeMailReadBytes(content.data).length !== body.size) throw new Error(t('readBodySizeMismatch'));
        bodyBytes += body.size;
        body.data = content.data;
      }
      if (body.size > 0 && !body.data) throw new Error(t('readBodyIncomplete'));
      if (typeof body.data === 'string') bodies[part.mimeType].push(decode(part));
    }
    for (var child of part.parts || []) await walk(child);
  }
  await walk(message.payload);
  var preview = await mailImagePreviews({ messageId: message.id, attachments: attachments }, selected.accountId);
  var markReadResult;
  if (args.markRead === true && (message.labelIds || []).includes('UNREAD') && !(message.labelIds || []).includes('DRAFT')) {
    var finishMarkRead = beginOperation?.();
    try {
      var marked = await cindy.fetch({ url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/' + encodeURIComponent(message.id) + '/modify',
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
        authAccount: selected.accountId, timeoutMs: 20000 });
      // A received 200 confirms the label change even if its body was cut off.
      // A rejection is definite; a transport/server error may follow a write.
      if (marked.ok && marked.status === 200) markReadResult = { execution: 'executed' };
      else if ([400, 401, 403, 404, 405, 413, 415, 422, 429].includes(marked.status))
        markReadResult = { execution: 'not_executed', message: t('markReadFailed') };
      else markReadResult = { execution: 'unknown', message: t('markReadUnknown') };
    } catch (_) { markReadResult = { execution: 'unknown', message: t('markReadUnknown') }; }
    finishMarkRead?.(markReadResult.execution);
  }
  var participantPhotos = await photos;
  return { accountId: selected.accountId, messageId: message.id, from: header(message.payload, 'from'),
    ...(participantPhotos.length ? { participantPhotos: participantPhotos } : {}),
    to: header(message.payload, 'to'), cc: header(message.payload, 'cc'), bcc: header(message.payload, 'bcc'),
    subject: header(message.payload, 'subject'), date: header(message.payload, 'date'),
    bodyText: bodies['text/plain'].join('\n'), bodyHtml: bodies['text/html'].join('\n'),
    ...(conversation ? { conversation: conversation } : {}),
    ...(conversationUnavailable ? { conversationUnavailable: true } : {}),
    ...(markReadResult ? { markReadResult: markReadResult } : {}),
    ...(markReadResult && markReadResult.execution === 'not_executed' ? { markReadFailed: true } : {}),
    attachments: preview.attachments.map(function (a) { var clean = { ...a }; delete clean.inlineData; delete clean.attachmentId; return clean; }) };
}
async function mailToolDraft(args, sourceCallId, beginOperation) {
  if (Array.isArray(args.command) && args.command.length === 1 && ['send', 'reply', 'reply-all'].includes(args.command[0]))
    return { ok: false, execution: 'not_executed', message: t('sendRequiresDraft') };
  if (!Array.isArray(args.command) || args.command[0] !== 'drafts' || !['get', 'create', 'reply', 'reply-all', 'forward', 'send', 'update', 'delete'].includes(args.command[1])) return null;
  if (!gmailCompose) return args.command[1] === 'get' ? null : { ok: false, execution: 'not_executed', message: t('mailFlowUnsupported') };
  if (!['get', 'send', 'update', 'delete'].includes(args.command[1])) return null;
  if (args.command.length !== 2 || (args.arguments || []).length !== 1) return { ok: false, execution: 'not_executed', message: t('draftCommandShape') };
  if (args.command[1] === 'send' && (Object.keys(args.options || {}).length || (args.attachments || []).length))
    return { ok: false, execution: 'not_executed', message: t('sendDraftIdOnly') };
  if (args.command[1] === 'send' && cindyMail.sendGraceMs !== 10000)
    return { ok: false, execution: 'not_executed', message: t('undoWindowUnsupported') };
  // An unregistered draft has no card edits to flush. Use the existing Host
  // lookup to bypass beforeTool for these reads/updates/deletes; ordinary worker
  // failures must retain their actionable not_executed result. Send still goes
  // through Host policy even when no card exists.
  if (args.command[1] !== 'send' && !await gmailCompose.resolveDraft(args.account, args.arguments[0])) return null;
  // beforeTool may flush edits even for get/update. null only means the caller
  // can continue; it does not prove that no earlier draft write took place.
  var finish = args.session_context.workdir_is_read_only === false ? beginOperation() : function () {};
  var result = await gmailCompose.beforeTool({ operation: args.command[1], account: args.account,
    draftId: args.arguments[0], readOnly: args.session_context.workdir_is_read_only !== false, sourceCallId });
  if (result) finish(result.execution);
  return result;
}

// Google People operations share the selected Gmail account. Credentials stay
// in the Host; no contact data is persisted in plugin KV or sent to other APIs.
async function googleContacts(args, callId, beginOperation, operation) {
  var action = args.action;
  var writes = ['create', 'update', 'delete'];
  var write = writes.includes(action);
  var fields = 'names,emailAddresses,phoneNumbers,organizations,photos,metadata';
  var execution = 'not_executed';
  function error(message) { throw new Error(message); }
  function text(value, name, max = 1000) {
    if (typeof value !== 'string' || !value.trim() || value.length > max) error(t('contactText', { name: name }));
    return value;
  }
  try {
    if (!['list', 'search', 'get', 'other_contacts', 'directory', ...writes].includes(action)) error(t('contactAction'));
    if (write && args.session_context?.workdir_is_read_only !== false) error(t('contactReadonly'));
    if (typeof cindy.fetch !== 'function') error(t('contactRuntime'));
    var selected = await selectGoogleAccount(args.account, operation);
    if (!selected.ok) error(selected.message);
    var resource;
    if (['get', 'update', 'delete'].includes(action)) {
      resource = text(args.resourceName, 'resourceName', 200);
      if (!/^people\/[A-Za-z0-9_-]+$/.test(resource) || resource === 'people/me') error(t('contactResource'));
    }
    var pageSize = args.pageSize === undefined ? 50 : args.pageSize;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) error(t('contactPageSize'));
    var page = { pageSize: String(pageSize) };
    if (args.pageToken !== undefined) page.pageToken = text(args.pageToken, 'pageToken', 4096);
    var person;
    if (['create', 'update'].includes(action)) {
      var allowed = { names: ['givenName', 'familyName', 'middleName', 'unstructuredName'],
        emailAddresses: ['value', 'type'], phoneNumbers: ['value', 'type'], organizations: ['name', 'title', 'department', 'type'] };
      if (!args.person || typeof args.person !== 'object' || Array.isArray(args.person) || !Object.keys(args.person).length) error(t('contactPerson'));
      person = {};
      for (var key of Object.keys(args.person)) {
        var values = args.person[key];
        if (!Object.hasOwn(allowed, key) || !Array.isArray(values) || values.length > (key === 'names' ? 1 : 20)) error(t('contactFieldLimit', { field: key }));
        person[key] = values.map(function (item) {
          if (!item || typeof item !== 'object' || Array.isArray(item) || !Object.keys(item).length) error(t('contactItem'));
          var result = {};
          for (var name of Object.keys(item)) {
            if (!allowed[key].includes(name)) error(t('contactField', { field: key + '.' + name }));
            result[name] = text(item[name], key + '.' + name);
          }
          if (['emailAddresses', 'phoneNumbers'].includes(key) && !result.value) error(t('contactValue', { field: key }));
          return result;
        });
      }
      if (action === 'create' && !Object.values(person).some(function (items) { return items.length; })) error(t('contactEmpty'));
      if (action === 'update') text(args.etag, 'etag', 1000);
    }
    async function request(path, query = {}, method = 'GET', body) {
      var url = 'https://people.googleapis.com/v1/' + path;
      var params = new URLSearchParams();
      for (var key of Object.keys(query)) {
        for (var value of Array.isArray(query[key]) ? query[key] : [query[key]]) params.append(key, value);
      }
      var qs = params.toString();
      if (qs) url += '?' + qs;
      // Serialize before entering the uncertain write phase.
      var options = { url, method, callId, authAccount: selected.accountId, timeoutMs: 20000,
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) };
      var mutating = method !== 'GET';
      var finish;
      if (mutating) { execution = 'unknown'; finish = beginOperation(); }
      var response;
      try { response = await cindy.fetch(options); }
      catch (_) { error(mutating ? t('contactUnknown') : t('contactReadFailed')); }
      if (mutating) {
        if (response?.ok && response.status >= 200 && response.status < 300) execution = 'executed';
        else if ([400, 401, 403, 404, 405, 409, 412, 413, 415, 422, 429].includes(response?.status)) execution = 'not_executed';
        finish(execution);
      }
      if (!response?.ok || response.status < 200 || response.status >= 300) {
        if (execution === 'unknown') error(t('contactUnknown'));
        if ([401, 403].includes(response?.status)) error(t('contactPermission'));
        if ([400, 409, 412].includes(response?.status)) error(t('contactRejected'));
        if (response?.status === 404) error(t('contactNotFound'));
        error(t('contactUnavailable'));
      }
      if (method === 'DELETE') return { resourceName: resource, deleted: true };
      try {
        if (response.truncated) throw new Error('truncated');
        var data = JSON.parse(response.body);
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid');
        // Linking or unlinking a Google Profile can change a contact's name.
        // Return the new server identifier so later operations use it.
        if (mutating && !/^people\/[A-Za-z0-9_-]+$/.test(data.resourceName || '')) throw new Error('invalid receipt');
        return data;
      } catch (_) {
        error(execution === 'executed' ? t('contactReceipt') : t('contactResponse'));
      }
    }
    var data;
    if (action === 'list') data = await request('people/me/connections', { ...page, personFields: fields });
    else if (action === 'get') data = await request(resource, { personFields: fields });
    else if (action === 'search') {
      var query = text(args.query, 'query');
      if (args.pageToken !== undefined) error(t('contactSearchPage'));
      // People search requires an empty-query warmup before the real query.
      await request('people:searchContacts', { query: '', readMask: fields, pageSize: '1' });
      data = await request('people:searchContacts', { query, readMask: fields, pageSize: String(Math.min(pageSize, 30)) });
    } else if (action === 'other_contacts') data = await request('otherContacts', { ...page, readMask: 'names,emailAddresses,phoneNumbers,photos,metadata' });
    else if (action === 'directory') data = await request('people:searchDirectoryPeople', {
      ...page, query: text(args.query, 'query'), readMask: fields,
      sources: ['DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE', 'DIRECTORY_SOURCE_TYPE_DOMAIN_CONTACT'],
    });
    else if (action === 'create') data = await request('people:createContact', { personFields: fields }, 'POST', person);
    else if (action === 'update') {
      var current = await request(resource, { personFields: fields, sources: 'READ_SOURCE_TYPE_CONTACT' });
      var source = current.metadata?.sources?.find(function (s) { return s.type === 'CONTACT'; });
      if (!source || source.etag !== args.etag) error(t('contactChanged'));
      data = await request(resource + ':updateContact', { updatePersonFields: Object.keys(person).join(','), personFields: fields }, 'PATCH', {
        ...person, resourceName: resource, metadata: { sources: [source] },
      });
    } else if (action === 'delete') data = await request(resource + ':deleteContact', {}, 'DELETE');
    return { ok: true, result: { accountId: selected.accountId, action, execution, data } };
  } catch (err) {
    return { ok: false, message: '[' + execution + '] ' + (err.message || t('contactFailed')) };
  }
}

(function () {
  var PREFIX = 'gmail';
  cindy.onHostMessage(async function (message) {
    if (message && message.type === 'host-context-changed') {
      hostLocale = supportedLocale(message.context && message.context.locale);
      return;
    }
    if (!message || message.type !== 'tool-call') return;
    var operation = localeOperation();
    toolOperations.set(message.callId, operation);
    try {
      await ensureLocale(operation);
      await handleToolCall(message, operation);
    } finally {
      if (toolOperations.get(message.callId) === operation) toolOperations.delete(message.callId);
    }
  });
  async function handleToolCall(message, operation) {
    var args = message.args || {};
    var isSchema = message.tool === PREFIX + '_schema';
    var context = args.session_context;
    // One call owns its receipt until final delivery. Presentation/IPC failures
    // must never downgrade a confirmed or uncertain Gmail mutation.
    var execution = 'not_executed';
    function beginOperation() {
      var previous = execution;
      execution = 'unknown';
      return function (value) {
        var current = ['executed', 'not_executed', 'unknown'].includes(value) ? value : 'unknown';
        execution = previous === 'unknown' || current === 'unknown' ? 'unknown'
          : previous === 'executed' || current === 'executed' ? 'executed' : 'not_executed';
      };
    }
    try {
      if (message.tool === 'gmail_contacts') {
        var contacts = await googleContacts(args, message.callId, beginOperation, operation);
        await cindy.send({ type: 'tool-result', callId: message.callId, ...contacts });
        return;
      }
      if (message.tool === 'gmail_read_message') {
        var mail = await readMailMessageLink(args, beginOperation, operation);
        await cindy.send({ type: 'tool-result', callId: message.callId, ok: true, result: mail });
        return;
      }
      if (message.tool === PREFIX + '_accounts') {
        var listed = await listAccounts(operation);
        await cindy.send(Object.assign({ type: 'tool-result', callId: message.callId }, listed));
        return;
      }
      if (message.tool !== PREFIX + '_schema' && message.tool !== PREFIX + '_run') {
        await cindy.send({ type: 'tool-result', callId: message.callId, ok: false,
          message: t('unknownTool') });
        return;
      }
      if (!cindy.node || typeof cindy.node.request !== 'function' || (!isSchema && !context)) {
        await cindy.send({ type: 'tool-result', callId: message.callId, ok: false,
          message: t('runtimeMissing') });
        return;
      }
      if (!isSchema) {
        var selected = await selectGoogleAccount(args.account, operation);
        if (!selected.ok) {
          await cindy.send({ type: 'tool-result', callId: message.callId, ok: false, message: selected.message });
          return;
        }
        args = Object.assign({}, args, { account: selected.accountId });
      }
      if (!isSchema) {
        var cardResult = await mailToolDraft(args, message.callId, beginOperation);
        if (cardResult) {
          await cindy.send({ type: 'tool-result', callId: message.callId, ok: !!cardResult.ok,
            ...(cardResult.ok ? { result: cardResult.data } : { message: '[' + cardResult.execution + '] ' + cardResult.message }) });
          return;
        }
      }
      var prepared = isSchema ? { options: args.options || {}, files: [], inline: [] } : await prepareMailAttachments(args, message.callId);
      if (prepared.inline && prepared.inline.length) {
        prepared.options = Object.assign({}, prepared.options, { 'inline-images': prepared.inline });
      }
      var finishWorker = beginOperation();
      var response = await cindy.node.request({
        method: isSchema ? 'schema' : 'run',
        authAccount: args.account,
        params: {
          command: args.command || [], arguments: args.arguments || [], options: prepared.options,
          accountEmail: !isSchema ? selected.accountEmail : undefined,
          workdir: context && context.workdir_is_local === true ? context.workdir : undefined,
          readOnly: !context || context.workdir_is_read_only !== false,
          locale: currentLocale(),
        },
        timeoutMs: 120000,
      });
      if (!response || !response.ok) {
        // Broker timeouts/process exits cannot prove an upstream mutation failed.
        await cindy.send({ type: 'tool-result', callId: message.callId, ok: false,
          message: 'Execution outcome unknown; do not retry a write before checking. ' + (response && response.message || 'Worker unavailable') });
        return;
      }
      var result = response.result;
      finishWorker(result?.execution);
      if (result.ok && prepared.files.length && result.data && typeof result.data === 'object') {
        result.data.importedAttachments = prepared.files;
      }
      if (!isSchema && result.ok && result.data && result.data.readBack && context && context.workdir_is_read_only === false) {
        result.data.readBack = await mailImagePreviews(result.data.readBack, selected.accountId);
        try { result.data.draftCard = await gmailCompose.present(message, selected, result.data.readBack); }
        catch (_) { result.data.draftCard = false; } // Do not change the known Gmail receipt.
      }
      if (result.ok && result.data?.readBack) {
        result.data.readBack.attachments = result.data.readBack.attachments.map(function ({ inlineData, ...metadata }) { return metadata; });
      }
      await cindy.send({ type: 'tool-result', callId: message.callId, ok: !!result.ok,
        ...(result.ok ? { result: result.data } : { message: '[' + execution + '] ' + (execution === result.execution
          ? result.message : t('earlierDraftUnconfirmed')) }) });
    } catch (error) {
      if (message.tool === 'gmail_contacts') {
        await cindy.send({ type: 'tool-result', callId: message.callId, ok: false,
          message: '[' + execution + '] ' + t('contactDelivery') });
        return;
      }
      await cindy.send({ type: 'tool-result', callId: message.callId, ok: false,
        message: execution === 'executed' ? '[executed] ' + t('executedUnreturned')
          : execution === 'unknown' ? '[unknown] ' + t('outcomeUnknown')
          : '[not_executed] ' + (error.message || t('prepareFailed')) });
    }
  }
})();
