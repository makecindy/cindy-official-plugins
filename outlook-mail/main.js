/* global cindy */
'use strict';
var OutlookMail = (() => {
  const CLOUDS = Object.freeze({
    global: { key: 'outlook_global', base: 'https://graph.microsoft.com/v1.0' },
    china: { key: 'outlook_china', base: 'https://microsoftgraph.chinacloudapi.cn/v1.0' },
  });
  const DRAFT_ACTIONS = ['draft', 'reply', 'reply_all', 'forward', 'get_draft', 'update_draft', 'send_draft', 'delete_draft'];
  const ACTIONS = ['search', 'read', 'send', 'list_folders', 'mark_read', 'mark_unread', 'move', ...DRAFT_ACTIONS];
  const WRITES = ['mark_read', 'mark_unread', 'move'];
  const SUMMARY = 'id,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead,isDraft,hasAttachments,parentFolderId,webLink,internetMessageId';
  // Runtime copy follows the Cindy host locale (docs/localization.md). Error codes,
  // execution_status, tool and parameter names stay untranslated protocol values.
  const MESSAGES = Object.freeze({
    'zh-CN': {
      invalidText: '{name} 必须是有效文本，请检查参数。',
      invalidId: '{name} 无效，请使用插件返回的原始 ID。',
      tooManyAddresses: '{name} 最多支持 100 个地址。',
      invalidAddress: '{name} 请填写完整邮箱地址，不带姓名或换行。',
      dateFormat: '{name} 请使用 ISO 日期或含时区的时间。',
      invalidDate: '{name} 日期无效。',
      unsupportedAction: '请选择支持的邮件操作。',
      unexpectedArgs: '此操作包含不适用的参数，请按工具说明调整；指定发件账号请使用 account。',
      invalidCloud: 'cloud 仅支持 global 或 china。',
      maxResults: 'max_results 必须是 1–50 的整数。',
      noPagination: '此操作不支持分页。',
      pageOnly: '继续分页时只传 action、account、cloud 和 page_token。',
      queryWithFilters: 'query 与结构化筛选请分开使用，可将条件写入 Microsoft KQL query。',
      unreadBoolean: 'unread 必须是布尔值。',
      sinceBefore: 'since 必须早于 before。',
      noRecipient: '发送邮件至少需要一个收件人。',
      tooManyRecipients: '单封邮件最多支持 100 个收件人。',
      localState: '无法读取插件配置，请重新打开插件详情页后重试。',
      accountState: '账号状态异常，请重新打开插件详情页。',
      accountNotFound: '账号不属于所选服务区域或不存在，请先调用 outlook_accounts。',
      clientNotConfigured: '此区域尚未配置微软应用身份，请在插件详情页配置 Client ID，再连接账号。',
      accountNotConnected: '此区域没有默认账号，请在插件详情页连接并设为默认，或明确指定 account。',
      accountExpired: '账号授权已失效，请在插件详情页重新连接同一账号。',
      profileArgs: '账号查询仅支持可选的 profile_account。',
      profileIncomplete: '微软未返回完整的账号资料，请重新查询。',
      pageUrlInvalid: '分页地址无效，请重新查询。',
      pageUrlScope: '分页地址不属于当前邮箱区域或操作，请重新查询。',
      pageTokenInvalid: '分页凭据无效，请重新查询。',
      pageTokenMismatch: '分页凭据与账号或操作不匹配，请重新查询。',
      bodyTooLarge: '邮件内容过大，请缩短正文后重试（草稿卡上限：纯文本 16,000 字符、HTML 64,000 字符；请求上限约 250 KB）。',
      mailboxNotEnabled: '此账号没有可用的云端邮箱，请确认已分配 Exchange Online 邮箱；本地 Exchange 或其他服务商邮箱不能通过此插件连接。',
      http401: '微软授权已失效，请在插件详情页重新连接账号。',
      http403: '微软拒绝此操作，请重新连接以授权邮件读写／发送权限；若仍失败，请让企业管理员检查应用访问策略。',
      http404: '未找到邮件或文件夹，请重新查询并使用最新 ID。',
      http429: '微软暂时限制请求频率，请稍后重试。',
      http5xx: '微软邮件服务暂时异常，请稍后查询状态。',
      httpOther: '微软拒绝了请求（HTTP {status}），请检查参数、服务区域及邮箱权限。',
      interruptedWrite: '连接中断；结果未知，请先检查邮箱，勿直接重复执行。',
      interruptedRead: '连接中断；请检查网络后重试。',
      hostFailedWrite: '主机未能完成请求；结果未知，请先检查邮箱，勿直接重复执行。',
      hostFailedRead: '主机未能完成请求；请检查账号授权和网络后重试。',
      invalidStatus: '主机未返回有效的 HTTP 状态，请检查邮箱中的实际状态。',
      unknownSuffix: ' 操作结果未知，请先检查邮箱，勿直接重复执行。',
      incompleteWrite: '微软响应不完整；服务已接受操作，请先检查邮箱，勿直接重复执行。',
      incompleteRead: '微软响应不完整；请减小 max_results 后重新查询。',
      incompleteList: '微软返回的列表不完整，请重新查询。',
      missingId: '微软响应缺少邮件 ID，请重新查询邮箱状态。',
      moveNote: '后续操作请使用返回的新 ID。',
      unknownTool: '未知邮件工具，请重新获取插件工具清单。',
      outcomeUnknown: '操作结果不确定；请先检查邮箱中的实际状态，不要直接重复执行。',
      outcomeExecuted: '服务已接受操作，但结果未能完整返回；请先检查邮箱中的实际状态，不要直接重复执行。',
      sendRequiresDraft: '不能直接发送。请先用 draft、reply、reply_all 或 forward 创建草稿并展示卡片，再用 send_draft 发送；发送前有 10 秒撤销时间。',
      mailFlowUnsupported: '当前 Cindy 版本不支持邮件草稿卡片，请更新 Cindy 后再创建、修改或发送草稿。',
      undoWindowUnsupported: '当前 Cindy 版本的发送撤销时间不符合要求，请更新 Cindy 后再发送。',
      readOnlyDraft: '只读任务不能创建、修改或发送草稿。',
      notDraft: '这封邮件不是草稿，不能在草稿卡片中编辑或发送。',
      draftChanged: '草稿已在其他地方修改，请核对最新内容后再保存或发送。',
      draftChanging: '草稿正在被修改，请稍后重新读取。',
      attachUnsupported: 'Outlook 草稿卡片暂不支持新增附件，请在 Outlook 中添加附件；已有附件可以在卡片中删除。',
      attachmentListInvalid: '附件清单无效，请重新读取草稿。',
      attachmentRewriteUnsupported: '此附件不能改名或改为内嵌图片（仅支持 3 MB 以内的普通文件附件）。',
      draftSavedMismatch: '草稿已保存，但读回内容与提交内容不一致，请先在 Outlook 中核对草稿，未发送。',
      draftSavedUnverified: '草稿已保存，但无法读回核对，请先在 Outlook 中核对草稿，不要重复创建。',
      partialSave: '草稿只保存了一部分修改，请先在 Outlook 中核对草稿，未发送。',
      draftFieldsInvalid: '草稿内容不完整，请重新读取草稿。',
      replyCreatedNotUpdated: '已创建回复草稿（draft_id: {id}），但正文或收件人未能写入；请用 get_draft 读取后再修改，不要重复创建。',
      bodyTextOrHtml: 'body_text 和 body_html 只能二选一。',
      updateEmpty: 'update_draft 至少需要修改 to、cc、bcc、subject、body_text 或 body_html 之一。',
      linkUnsupported: '无法识别此 Outlook 邮件链接，请在 Outlook 中打开。',
      linkAccountRequired: '已连接多个账号，无法从链接判断账号，请指定 account。',
      linkAccountMismatch: '链接绑定的账号与指定的 account 不一致。',
      markReadFailed: '未能标记为已读，邮件内容已正常读取。',
      markReadUnknown: '无法确认是否已标记为已读，请先检查邮箱中的状态，不要直接重复执行。',
    },
    en: {
      invalidText: '{name} must be valid text; check the arguments.',
      invalidId: '{name} is invalid; use the original ID returned by the plugin.',
      tooManyAddresses: '{name} supports at most 100 addresses.',
      invalidAddress: '{name} must be complete email addresses, without names or line breaks.',
      dateFormat: '{name} must be an ISO date or a time with a time zone.',
      invalidDate: '{name} is not a valid date.',
      unsupportedAction: 'Choose a supported mail action.',
      unexpectedArgs: 'This action includes arguments that do not apply; adjust them per the tool description. To choose the sender account, use account.',
      invalidCloud: 'cloud only supports global or china.',
      maxResults: 'max_results must be an integer from 1 to 50.',
      noPagination: 'This action does not support pagination.',
      pageOnly: 'When continuing pagination, pass only action, account, cloud and page_token.',
      queryWithFilters: 'Do not combine query with structured filters; put the conditions in the Microsoft KQL query instead.',
      unreadBoolean: 'unread must be a boolean.',
      sinceBefore: 'since must be earlier than before.',
      noRecipient: 'Sending mail requires at least one recipient.',
      tooManyRecipients: 'A single message supports at most 100 recipients.',
      localState: 'Unable to read plugin settings; reopen the plugin details page and retry.',
      accountState: 'Account state is invalid; reopen the plugin details page.',
      accountNotFound: 'The account does not belong to the selected service region or does not exist; call outlook_accounts first.',
      clientNotConfigured: 'No Microsoft application is configured for this region; set a Client ID in the plugin details page, then connect an account.',
      accountNotConnected: 'This region has no default account; connect one in the plugin details page and set it as default, or specify account explicitly.',
      accountExpired: 'The account authorization has expired; reconnect the same account in the plugin details page.',
      profileArgs: 'Account lookup only supports the optional profile_account.',
      profileIncomplete: 'Microsoft did not return a complete account profile; query again.',
      pageUrlInvalid: 'Invalid pagination URL; query again.',
      pageUrlScope: 'The pagination URL does not belong to the current mailbox region or action; query again.',
      pageTokenInvalid: 'Invalid page token; query again.',
      pageTokenMismatch: 'The page token does not match the account or action; query again.',
      bodyTooLarge: 'Message is too large; shorten the body and retry (draft card limits: 16,000 text / 64,000 HTML characters; request limit is about 250 KB).',
      mailboxNotEnabled: 'This account has no usable cloud mailbox; confirm an Exchange Online mailbox is assigned. On-premises Exchange and other providers cannot be connected through this plugin.',
      http401: 'Microsoft authorization has expired; reconnect the account in the plugin details page.',
      http403: 'Microsoft denied this operation; reconnect to grant mail read/write and send permissions. If it still fails, ask your organization administrator to check the application access policy.',
      http404: 'Message or folder not found; query again and use the latest ID.',
      http429: 'Microsoft is temporarily throttling requests; retry later.',
      http5xx: 'Microsoft mail service is temporarily unavailable; check the status later.',
      httpOther: 'Microsoft rejected the request (HTTP {status}); check the arguments, service region and mailbox permissions.',
      interruptedWrite: 'Connection interrupted; the outcome is unknown. Check the mailbox first and do not repeat the operation directly.',
      interruptedRead: 'Connection interrupted; check the network and retry.',
      hostFailedWrite: 'The host could not complete the request; the outcome is unknown. Check the mailbox first and do not repeat the operation directly.',
      hostFailedRead: 'The host could not complete the request; check the account authorization and network, then retry.',
      invalidStatus: 'The host did not return a valid HTTP status; check the actual state in the mailbox.',
      unknownSuffix: ' The outcome is unknown; check the mailbox first and do not repeat the operation directly.',
      incompleteWrite: 'Incomplete Microsoft response; the service accepted the operation. Check the mailbox first and do not repeat the operation directly.',
      incompleteRead: 'Incomplete Microsoft response; reduce max_results and query again.',
      incompleteList: 'Microsoft returned an incomplete list; query again.',
      missingId: 'The Microsoft response is missing the message ID; check the mailbox state again.',
      moveNote: 'Use the returned new ID for further operations.',
      unknownTool: 'Unknown mail tool; reload the plugin tool list.',
      outcomeUnknown: 'The outcome is uncertain; check the mailbox first for its actual state and do not repeat the operation directly.',
      outcomeExecuted: 'The service accepted the operation, but the result was not returned completely; check the mailbox first for its actual state and do not repeat the operation directly.',
      sendRequiresDraft: 'Direct send is not available. Create a draft with draft, reply, reply_all or forward so its card is shown, then send it with send_draft; sending has a 10-second undo window.',
      mailFlowUnsupported: 'This Cindy version does not support mail draft cards. Update Cindy before creating, editing or sending drafts.',
      undoWindowUnsupported: 'This Cindy version does not provide the required send undo window. Update Cindy before sending.',
      readOnlyDraft: 'Read-only tasks cannot create, edit or send drafts.',
      notDraft: 'This message is not a draft and cannot be edited or sent from a draft card.',
      draftChanged: 'The draft was changed elsewhere. Review the latest version before saving or sending.',
      draftChanging: 'The draft is being changed. Read it again shortly.',
      attachUnsupported: 'Outlook draft cards cannot add attachments yet. Add them in Outlook; existing attachments can be removed in the card.',
      attachmentListInvalid: 'The attachment list is invalid. Read the draft again.',
      attachmentRewriteUnsupported: 'This attachment cannot be renamed or made inline (only regular file attachments up to 3 MB).',
      draftSavedMismatch: 'The draft was saved, but its read-back does not match what was submitted. Check the draft in Outlook first; nothing was sent.',
      draftSavedUnverified: 'The draft was saved but could not be read back for verification. Check it in Outlook first and do not create it again.',
      partialSave: 'Only part of the changes was saved. Check the draft in Outlook first; nothing was sent.',
      draftFieldsInvalid: 'The draft content is incomplete. Read the draft again.',
      replyCreatedNotUpdated: 'The reply draft was created (draft_id: {id}), but its body or recipients could not be written. Read it with get_draft before editing; do not create it again.',
      bodyTextOrHtml: 'Pass either body_text or body_html, not both.',
      updateEmpty: 'update_draft needs at least one of to, cc, bcc, subject, body_text or body_html.',
      linkUnsupported: 'This Outlook message link cannot be resolved; open it in Outlook.',
      linkAccountRequired: 'Several accounts are connected and the link does not identify one. Specify account.',
      linkAccountMismatch: 'The account bound to this link does not match the account argument.',
      markReadFailed: 'Could not mark the message as read; it was read normally.',
      markReadUnknown: 'Could not confirm whether the message was marked as read. Check the mailbox first and do not repeat the operation directly.',
    },
    ja: {
      invalidText: '{name} は有効なテキストである必要があります。引数を確認してください。',
      invalidId: '{name} が無効です。プラグインが返した元の ID を使用してください。',
      tooManyAddresses: '{name} に指定できるアドレスは最大 100 件です。',
      invalidAddress: '{name} には名前や改行を含めず、完全なメールアドレスを指定してください。',
      dateFormat: '{name} には ISO 形式の日付、またはタイムゾーン付きの日時を指定してください。',
      invalidDate: '{name} の日付が無効です。',
      unsupportedAction: 'サポートされているメール操作を選択してください。',
      unexpectedArgs: 'この操作に適用されない引数が含まれています。ツールの説明に従って調整してください。送信元アカウントを指定するには account を使用してください。',
      invalidCloud: 'cloud に指定できるのは global または china のみです。',
      maxResults: 'max_results は 1 から 50 までの整数にしてください。',
      noPagination: 'この操作はページングに対応していません。',
      pageOnly: 'ページングを続ける場合は action、account、cloud、page_token のみを渡してください。',
      queryWithFilters: 'query と構造化フィルターは併用できません。条件は Microsoft KQL の query に記述してください。',
      unreadBoolean: 'unread はブール値にしてください。',
      sinceBefore: 'since は before より前にしてください。',
      noRecipient: 'メールを送信するには、少なくとも 1 人の宛先が必要です。',
      tooManyRecipients: '1 通のメールに指定できる宛先は最大 100 人です。',
      localState: 'プラグインの設定を読み取れません。プラグインの詳細ページを開き直してから再試行してください。',
      accountState: 'アカウントの状態が異常です。プラグインの詳細ページを開き直してください。',
      accountNotFound: 'アカウントが選択したサービス地域に属していないか、存在しません。先に outlook_accounts を呼び出してください。',
      clientNotConfigured: 'この地域には Microsoft アプリがまだ設定されていません。プラグインの詳細ページで Client ID を設定してから、アカウントを接続してください。',
      accountNotConnected: 'この地域には既定のアカウントがありません。プラグインの詳細ページでアカウントを接続して既定に設定するか、account を明示的に指定してください。',
      accountExpired: 'アカウントの認証が期限切れです。プラグインの詳細ページで同じアカウントを再接続してください。',
      profileArgs: 'アカウントの照会で指定できるのは、省略可能な profile_account のみです。',
      profileIncomplete: 'Microsoft から完全なアカウント情報が返されませんでした。もう一度照会してください。',
      pageUrlInvalid: 'ページング URL が無効です。もう一度検索してください。',
      pageUrlScope: 'ページング URL が現在のメールボックスの地域または操作に属していません。もう一度検索してください。',
      pageTokenInvalid: 'ページトークンが無効です。もう一度検索してください。',
      pageTokenMismatch: 'ページトークンがアカウントまたは操作と一致しません。もう一度検索してください。',
      bodyTooLarge: 'メールの内容が大きすぎます。本文を短くしてから再試行してください（下書きカードの上限：テキスト16,000文字、HTML 64,000文字。リクエストの上限は約 250 KB）。',
      mailboxNotEnabled: 'このアカウントには利用可能なクラウドメールボックスがありません。Exchange Online メールボックスが割り当てられていることを確認してください。オンプレミスの Exchange や他社のメールは、このプラグインでは接続できません。',
      http401: 'Microsoft の認証が期限切れです。プラグインの詳細ページでアカウントを再接続してください。',
      http403: 'Microsoft がこの操作を拒否しました。再接続してメールの読み書き・送信の権限を許可してください。それでも失敗する場合は、組織の管理者にアプリのアクセスポリシーを確認してもらってください。',
      http404: 'メールまたはフォルダーが見つかりません。もう一度検索して最新の ID を使用してください。',
      http429: 'Microsoft がリクエストの頻度を一時的に制限しています。しばらくしてから再試行してください。',
      http5xx: 'Microsoft のメールサービスで一時的な問題が発生しています。しばらくしてから状態を確認してください。',
      httpOther: 'Microsoft がリクエストを拒否しました（HTTP {status}）。引数、サービス地域、メールボックスの権限を確認してください。',
      interruptedWrite: '接続が中断されました。結果は不明です。まずメールボックスを確認し、そのまま操作を繰り返さないでください。',
      interruptedRead: '接続が中断されました。ネットワークを確認してから再試行してください。',
      hostFailedWrite: 'ホストがリクエストを完了できませんでした。結果は不明です。まずメールボックスを確認し、そのまま操作を繰り返さないでください。',
      hostFailedRead: 'ホストがリクエストを完了できませんでした。アカウントの認証とネットワークを確認してから再試行してください。',
      invalidStatus: 'ホストが有効な HTTP ステータスを返しませんでした。メールボックスで実際の状態を確認してください。',
      unknownSuffix: '操作の結果は不明です。まずメールボックスを確認し、そのまま操作を繰り返さないでください。',
      incompleteWrite: 'Microsoft の応答が不完全です。サービスは操作を受け付けています。まずメールボックスを確認し、そのまま操作を繰り返さないでください。',
      incompleteRead: 'Microsoft の応答が不完全です。max_results を小さくしてもう一度検索してください。',
      incompleteList: 'Microsoft から返された一覧が不完全です。もう一度検索してください。',
      missingId: 'Microsoft の応答にメール ID が含まれていません。メールボックスの状態をもう一度確認してください。',
      moveNote: '以降の操作には、返された新しい ID を使用してください。',
      unknownTool: '不明なメールツールです。プラグインのツール一覧を再取得してください。',
      outcomeUnknown: '操作の結果が確定していません。まずメールボックスで実際の状態を確認し、そのまま操作を繰り返さないでください。',
      outcomeExecuted: 'サービスは操作を受け付けましたが、結果が完全には返されませんでした。まずメールボックスで実際の状態を確認し、そのまま操作を繰り返さないでください。',
      sendRequiresDraft: '直接送信はできません。draft、reply、reply_all、forward で下書きを作成してカードを表示し、send_draft で送信してください。送信前に 10 秒間取り消せます。',
      mailFlowUnsupported: 'この Cindy バージョンはメール下書きカードに対応していません。Cindy を更新してから下書きを作成・編集・送信してください。',
      undoWindowUnsupported: 'この Cindy バージョンには必要な送信取り消し時間がありません。Cindy を更新してから送信してください。',
      readOnlyDraft: '読み取り専用タスクでは下書きを作成・編集・送信できません。',
      notDraft: 'このメールは下書きではないため、下書きカードで編集・送信できません。',
      draftChanged: '下書きが別の場所で変更されました。最新の内容を確認してから保存または送信してください。',
      draftChanging: '下書きが変更中です。しばらくしてから読み直してください。',
      attachUnsupported: 'Outlook の下書きカードではまだ添付ファイルを追加できません。Outlook で追加してください。既存の添付ファイルはカードで削除できます。',
      attachmentListInvalid: '添付ファイルの一覧が無効です。下書きを読み直してください。',
      attachmentRewriteUnsupported: 'この添付ファイルは名前の変更やインライン画像への変更ができません（3 MB 以下の通常ファイル添付のみ対応）。',
      draftSavedMismatch: '下書きは保存されましたが、読み戻した内容が送信した内容と一致しません。まず Outlook で下書きを確認してください。送信はされていません。',
      draftSavedUnverified: '下書きは保存されましたが、確認のために読み戻せませんでした。まず Outlook で確認し、もう一度作成しないでください。',
      partialSave: '変更の一部だけが保存されました。まず Outlook で下書きを確認してください。送信はされていません。',
      draftFieldsInvalid: '下書きの内容が不完全です。下書きを読み直してください。',
      replyCreatedNotUpdated: '返信の下書きは作成されました（draft_id: {id}）が、本文または宛先を書き込めませんでした。get_draft で読み込んでから編集し、もう一度作成しないでください。',
      bodyTextOrHtml: 'body_text と body_html はどちらか一方だけを指定してください。',
      updateEmpty: 'update_draft には to、cc、bcc、subject、body_text、body_html のいずれかが必要です。',
      linkUnsupported: 'この Outlook メールのリンクを解決できません。Outlook で開いてください。',
      linkAccountRequired: '複数のアカウントが接続されていて、リンクからアカウントを判断できません。account を指定してください。',
      linkAccountMismatch: 'リンクに結び付いたアカウントが account 引数と一致しません。',
      markReadFailed: '既読にできませんでしたが、メールは通常どおり読み込まれました。',
      markReadUnknown: '既読になったか確認できませんでした。まずメールボックスで確認し、そのまま操作を繰り返さないでください。',
    },
    ko: {
      invalidText: '{name} 값은 유효한 텍스트여야 합니다. 인수를 확인하세요.',
      invalidId: '{name} 값이 올바르지 않습니다. 플러그인이 반환한 원래 ID를 사용하세요.',
      tooManyAddresses: '{name} 항목에는 주소를 최대 100개까지 지정할 수 있습니다.',
      invalidAddress: '{name} 항목에는 이름이나 줄바꿈 없이 전체 이메일 주소를 입력하세요.',
      dateFormat: '{name} 값은 ISO 날짜 또는 시간대가 포함된 시간이어야 합니다.',
      invalidDate: '{name} 값의 날짜가 올바르지 않습니다.',
      unsupportedAction: '지원되는 메일 작업을 선택하세요.',
      unexpectedArgs: '이 작업에 적용되지 않는 인수가 포함되어 있습니다. 도구 설명에 따라 조정하세요. 발신 계정을 지정하려면 account를 사용하세요.',
      invalidCloud: 'cloud 값은 global 또는 china만 지원합니다.',
      maxResults: 'max_results 값은 1부터 50 사이의 정수여야 합니다.',
      noPagination: '이 작업은 페이지 나누기를 지원하지 않습니다.',
      pageOnly: '페이지를 이어서 조회할 때는 action, account, cloud, page_token만 전달하세요.',
      queryWithFilters: 'query와 구조화된 필터는 함께 사용할 수 없습니다. 조건은 Microsoft KQL query에 작성하세요.',
      unreadBoolean: 'unread 값은 불리언이어야 합니다.',
      sinceBefore: 'since는 before보다 이전이어야 합니다.',
      noRecipient: '메일을 보내려면 받는 사람이 한 명 이상 있어야 합니다.',
      tooManyRecipients: '메일 한 통에는 받는 사람을 최대 100명까지 지정할 수 있습니다.',
      localState: '플러그인 설정을 읽을 수 없습니다. 플러그인 세부 정보 페이지를 다시 연 후 다시 시도하세요.',
      accountState: '계정 상태가 올바르지 않습니다. 플러그인 세부 정보 페이지를 다시 여세요.',
      accountNotFound: '계정이 선택한 서비스 지역에 속하지 않거나 존재하지 않습니다. 먼저 outlook_accounts를 호출하세요.',
      clientNotConfigured: '이 지역에는 아직 Microsoft 앱이 설정되지 않았습니다. 플러그인 세부 정보 페이지에서 Client ID를 설정한 다음 계정을 연결하세요.',
      accountNotConnected: '이 지역에는 기본 계정이 없습니다. 플러그인 세부 정보 페이지에서 계정을 연결하고 기본값으로 설정하거나 account를 명시적으로 지정하세요.',
      accountExpired: '계정 인증이 만료되었습니다. 플러그인 세부 정보 페이지에서 같은 계정을 다시 연결하세요.',
      profileArgs: '계정 조회는 선택 사항인 profile_account만 지원합니다.',
      profileIncomplete: 'Microsoft가 완전한 계정 정보를 반환하지 않았습니다. 다시 조회하세요.',
      pageUrlInvalid: '페이지 URL이 올바르지 않습니다. 다시 조회하세요.',
      pageUrlScope: '페이지 URL이 현재 메일함 지역 또는 작업에 속하지 않습니다. 다시 조회하세요.',
      pageTokenInvalid: '페이지 토큰이 올바르지 않습니다. 다시 조회하세요.',
      pageTokenMismatch: '페이지 토큰이 계정 또는 작업과 일치하지 않습니다. 다시 조회하세요.',
      bodyTooLarge: '메일 내용이 너무 큽니다. 본문을 줄인 후 다시 시도하세요(임시 보관 카드 한도: 텍스트 16,000자, HTML 64,000자, 요청 한도는 약 250KB).',
      mailboxNotEnabled: '이 계정에는 사용할 수 있는 클라우드 메일함이 없습니다. Exchange Online 메일함이 할당되어 있는지 확인하세요. 온프레미스 Exchange나 다른 제공업체의 메일함은 이 플러그인으로 연결할 수 없습니다.',
      http401: 'Microsoft 인증이 만료되었습니다. 플러그인 세부 정보 페이지에서 계정을 다시 연결하세요.',
      http403: 'Microsoft가 이 작업을 거부했습니다. 다시 연결하여 메일 읽기/쓰기 및 보내기 권한을 부여하세요. 그래도 실패하면 조직 관리자에게 앱 액세스 정책을 확인해 달라고 요청하세요.',
      http404: '메일 또는 폴더를 찾을 수 없습니다. 다시 조회하여 최신 ID를 사용하세요.',
      http429: 'Microsoft가 일시적으로 요청 빈도를 제한하고 있습니다. 잠시 후 다시 시도하세요.',
      http5xx: 'Microsoft 메일 서비스에 일시적인 문제가 있습니다. 잠시 후 상태를 확인하세요.',
      httpOther: 'Microsoft가 요청을 거부했습니다(HTTP {status}). 인수, 서비스 지역 및 메일함 권한을 확인하세요.',
      interruptedWrite: '연결이 끊어졌습니다. 결과를 알 수 없습니다. 먼저 메일함을 확인하고 작업을 그대로 반복하지 마세요.',
      interruptedRead: '연결이 끊어졌습니다. 네트워크를 확인한 후 다시 시도하세요.',
      hostFailedWrite: '호스트가 요청을 완료하지 못했습니다. 결과를 알 수 없습니다. 먼저 메일함을 확인하고 작업을 그대로 반복하지 마세요.',
      hostFailedRead: '호스트가 요청을 완료하지 못했습니다. 계정 인증과 네트워크를 확인한 후 다시 시도하세요.',
      invalidStatus: '호스트가 유효한 HTTP 상태를 반환하지 않았습니다. 메일함에서 실제 상태를 확인하세요.',
      unknownSuffix: ' 작업 결과를 알 수 없습니다. 먼저 메일함을 확인하고 작업을 그대로 반복하지 마세요.',
      incompleteWrite: 'Microsoft 응답이 불완전합니다. 서비스가 작업을 수락했습니다. 먼저 메일함을 확인하고 작업을 그대로 반복하지 마세요.',
      incompleteRead: 'Microsoft 응답이 불완전합니다. max_results를 줄인 후 다시 조회하세요.',
      incompleteList: 'Microsoft가 반환한 목록이 불완전합니다. 다시 조회하세요.',
      missingId: 'Microsoft 응답에 메일 ID가 없습니다. 메일함 상태를 다시 확인하세요.',
      moveNote: '이후 작업에는 반환된 새 ID를 사용하세요.',
      unknownTool: '알 수 없는 메일 도구입니다. 플러그인 도구 목록을 다시 불러오세요.',
      outcomeUnknown: '작업 결과가 확실하지 않습니다. 먼저 메일함에서 실제 상태를 확인하고 작업을 그대로 반복하지 마세요.',
      outcomeExecuted: '서비스가 작업을 수락했지만 결과가 완전히 반환되지 않았습니다. 먼저 메일함에서 실제 상태를 확인하고 작업을 그대로 반복하지 마세요.',
      sendRequiresDraft: '바로 보낼 수 없습니다. draft, reply, reply_all 또는 forward로 임시 보관함 카드를 만든 다음 send_draft로 보내세요. 보내기 전에 10초 동안 취소할 수 있습니다.',
      mailFlowUnsupported: '이 Cindy 버전은 메일 임시 보관함 카드를 지원하지 않습니다. Cindy를 업데이트한 후 임시 보관 메일을 만들거나 수정하거나 보내세요.',
      undoWindowUnsupported: '이 Cindy 버전에는 필요한 보내기 취소 시간이 없습니다. Cindy를 업데이트한 후 보내세요.',
      readOnlyDraft: '읽기 전용 작업에서는 임시 보관 메일을 만들거나 수정하거나 보낼 수 없습니다.',
      notDraft: '이 메일은 임시 보관 메일이 아니므로 카드에서 수정하거나 보낼 수 없습니다.',
      draftChanged: '임시 보관 메일이 다른 곳에서 변경되었습니다. 최신 내용을 확인한 후 저장하거나 보내세요.',
      draftChanging: '임시 보관 메일이 변경되는 중입니다. 잠시 후 다시 읽으세요.',
      attachUnsupported: 'Outlook 임시 보관함 카드에서는 아직 첨부 파일을 추가할 수 없습니다. Outlook에서 추가하세요. 기존 첨부 파일은 카드에서 삭제할 수 있습니다.',
      attachmentListInvalid: '첨부 파일 목록이 올바르지 않습니다. 임시 보관 메일을 다시 읽으세요.',
      attachmentRewriteUnsupported: '이 첨부 파일은 이름을 바꾸거나 본문 이미지로 바꿀 수 없습니다(3MB 이하의 일반 파일 첨부만 지원).',
      draftSavedMismatch: '임시 보관 메일은 저장되었지만 다시 읽은 내용이 제출한 내용과 다릅니다. 먼저 Outlook에서 확인하세요. 보내지 않았습니다.',
      draftSavedUnverified: '임시 보관 메일은 저장되었지만 확인을 위해 다시 읽지 못했습니다. 먼저 Outlook에서 확인하고 다시 만들지 마세요.',
      partialSave: '변경 사항 중 일부만 저장되었습니다. 먼저 Outlook에서 임시 보관 메일을 확인하세요. 보내지 않았습니다.',
      draftFieldsInvalid: '임시 보관 메일 내용이 불완전합니다. 다시 읽으세요.',
      replyCreatedNotUpdated: '답장 임시 보관 메일이 만들어졌지만(draft_id: {id}) 본문이나 받는 사람을 쓰지 못했습니다. get_draft로 읽은 후 수정하고 다시 만들지 마세요.',
      bodyTextOrHtml: 'body_text와 body_html 중 하나만 지정하세요.',
      updateEmpty: 'update_draft에는 to, cc, bcc, subject, body_text, body_html 중 하나 이상이 필요합니다.',
      linkUnsupported: '이 Outlook 메일 링크를 확인할 수 없습니다. Outlook에서 여세요.',
      linkAccountRequired: '여러 계정이 연결되어 있어 링크로 계정을 판단할 수 없습니다. account를 지정하세요.',
      linkAccountMismatch: '링크에 연결된 계정이 account 인수와 일치하지 않습니다.',
      markReadFailed: '읽음으로 표시하지 못했지만 메일은 정상적으로 읽었습니다.',
      markReadUnknown: '읽음으로 표시되었는지 확인할 수 없습니다. 먼저 메일함에서 확인하고 작업을 그대로 반복하지 마세요.',
    },
  });
  // Only the host locale is read, never the browser or OS language. null means it is not
  // known yet: copy falls back to English and the next tool call asks the host again.
  let locale = null;
  let localeRequest = null;
  const resolveLocale = value => (typeof value === 'string' && Object.hasOwn(MESSAGES, value) ? value : 'en');
  async function requestLocale(host) {
    if (!host || typeof host.request !== 'function') return null;
    let timer = null;
    try {
      // A host that never answers must not hold the mail result: give up after 3 seconds.
      const r = await Promise.race([host.request({ kind: 'app-context' }),
        new Promise(resolve => { timer = setTimeout(() => resolve(null), 3000); })]);
      const value = r && r.ok && r.context && r.context.locale;
      return typeof value === 'string' ? resolveLocale(value) : null;
    } catch (_) {
      return null;
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }
  // Concurrent tool calls share one request; a success is cached and later updated by
  // host-context-changed.
  function ensureLocale(host) {
    if (locale) return Promise.resolve(locale);
    if (!localeRequest) {
      localeRequest = requestLocale(host).then(value => {
        localeRequest = null;
        // A host-context-changed that arrived while the request was pending wins.
        if (!locale && value) locale = value;
        return locale || 'en';
      });
    }
    return localeRequest;
  }
  function setLocale(value) { locale = resolveLocale(value); }
  function t(key, params = {}) {
    const table = MESSAGES[locale || 'en'];
    const template = Object.hasOwn(table, key) ? table[key] : MESSAGES.en[key];
    return template.replace(/\{(\w+)\}/g, (m, k) => (Object.hasOwn(params, k) ? String(params[k]) : m));
  }
  class MailError extends Error {
    constructor(code, key, execution = 'not_executed', params = {}, suffix) {
      super(t(key, params) + (suffix ? t(suffix) : ''));
      this.code = code; this.execution = execution;
    }
  }
  const invalid = (key, params) => { throw new MailError('INVALID_ARGUMENT', key, 'not_executed', params); };
  function text(value, name, max = 2048, empty = false) {
    if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) invalid('invalidText', {name});
    return value;
  }
  function segment(value, name) {
    const s = text(value, name);
    if (s === '.' || s === '..' || /[\x00-\x1f\x7f]/.test(s)) invalid('invalidId', {name});
    return encodeURIComponent(s);
  }
  function recipients(value, name) {
    if (value === undefined) return [];
    const values = Array.isArray(value) ? value : text(value, name, 20000).split(/[,;]/);
    if (values.length > 100) invalid('tooManyAddresses', {name});
    return values.map(v => {
      const address = text(v, name, 320).trim();
      if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(address)) invalid('invalidAddress', {name});
      return { emailAddress: { address } };
    });
  }
  function date(value, name) {
    text(value, name, 40);
    if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) invalid('dateFormat', {name});
    const calendar = new Date(value.slice(0, 10) + 'T00:00:00Z');
    if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== value.slice(0, 10)) invalid('invalidDate', {name});
    const d = new Date(value);
    if (!Number.isFinite(d.getTime()) || (value.length === 10 && d.toISOString().slice(0, 10) !== value)) invalid('invalidDate', {name});
    return d.toISOString();
  }
  function validate(a) {
    if (!a || !ACTIONS.includes(a.action)) invalid('unsupportedAction');
    const fields = {
      search: ['query','from','subject','unread','since','before','folder','max_results','page_token'],
      list_folders: ['folder','max_results','page_token'],
      read: ['message_id'], send: ['to','cc','bcc','subject','body_text'], draft: ['to','cc','bcc','subject','body_text','body_html'],
      mark_read: ['message_id'], mark_unread: ['message_id'], move: ['message_id','target_folder'],
      reply: ['message_id','body_text','body_html'], reply_all: ['message_id','body_text','body_html'],
      forward: ['message_id','to','cc','bcc','body_text','body_html'],
      get_draft: ['draft_id'], send_draft: ['draft_id'], delete_draft: ['draft_id'],
      update_draft: ['draft_id','to','cc','bcc','subject','body_text','body_html'],
    };
    const allowed = ['action','cloud','account',...fields[a.action]];
    if (Object.keys(a).some(k => !allowed.includes(k))) invalid('unexpectedArgs');
    if (a.cloud !== undefined && !Object.hasOwn(CLOUDS, a.cloud)) invalid('invalidCloud');
    if (a.account !== undefined) text(a.account, 'account');
    if (a.max_results !== undefined && (!Number.isInteger(a.max_results) || a.max_results < 1 || a.max_results > 50)) invalid('maxResults');
    if (a.page_token !== undefined) {
      if (!['search', 'list_folders'].includes(a.action)) invalid('noPagination');
      text(a.page_token, 'page_token', 24000);
      if (['query','from','subject','unread','since','before','folder','max_results'].some(k => a[k] !== undefined)) invalid('pageOnly');
    }
    if (['read','mark_read','mark_unread','move','reply','reply_all','forward'].includes(a.action)) segment(a.message_id, 'message_id');
    if (['get_draft','update_draft','send_draft','delete_draft'].includes(a.action)) segment(a.draft_id, 'draft_id');
    if (a.body_html !== undefined) {
      text(a.body_html,'body_html',64000,true);
      if (a.body_text !== undefined) invalid('bodyTextOrHtml');
      // The card also holds the plain-text form (16,000 characters); estimate it before writing.
      if (plainSize(a.body_html) > 16000) invalid('bodyTooLarge');
    }
    if (['reply','reply_all','forward','update_draft'].includes(a.action) && a.body_text !== undefined) text(a.body_text,'body_text',16000,true);
    // The card edits the HTML form, where every line costs a <div>; it must fit as well.
    if (['draft','reply','reply_all','forward','update_draft'].includes(a.action) && typeof a.body_text === 'string' && textHtml(a.body_text).length > 64000) invalid('bodyTooLarge');
    if (a.action === 'update_draft') {
      if (!['to','cc','bcc','subject','body_text','body_html'].some(k => a[k] !== undefined)) invalid('updateEmpty');
      if (a.subject !== undefined) text(a.subject,'subject',998,true);
      const total = ['to','cc','bcc'].map(k => recipients(a[k],k).length).reduce((x,y) => x+y,0);
      if (total > 100) invalid('tooManyRecipients');
    }
    if (a.action === 'forward') {
      const total = ['to','cc','bcc'].map(k => recipients(a[k],k).length).reduce((x,y) => x+y,0);
      if (recipients(a.to,'to').length === 0) invalid('noRecipient');
      if (total > 100) invalid('tooManyRecipients');
    }
    if (a.folder !== undefined) segment(a.folder, 'folder');
    if (a.action === 'move') segment(a.target_folder, 'target_folder');
    if (a.action === 'search') {
      if (a.query !== undefined) {
        text(a.query, 'query', 1000);
        if (['from','subject','unread','since','before'].some(k => a[k] !== undefined)) invalid('queryWithFilters');
      }
      for (const k of ['from','subject']) if (a[k] !== undefined) text(a[k], k, 500);
      if (a.unread !== undefined && typeof a.unread !== 'boolean') invalid('unreadBoolean');
      for (const k of ['since','before']) if (a[k] !== undefined) date(a[k], k);
      if (a.since && a.before && date(a.since,'since') >= date(a.before,'before')) invalid('sinceBefore');
    }
    if (['send','draft'].includes(a.action)) {
      text(a.subject,'subject',998,true);
      // A draft must fit the draft card (16,000 characters), or it could never be shown or sent.
      if (!(a.action === 'draft' && a.body_html !== undefined)) text(a.body_text,'body_text',a.action === 'draft' ? 16000 : 200000,true);
      const total = ['to','cc','bcc'].map(k => recipients(a[k],k).length).reduce((x,y) => x+y,0);
      if (a.action === 'send' && total === 0) invalid('noRecipient');
      if (total > 100) invalid('tooManyRecipients');
    }
  }
  async function local(path) {
    try {
      const r = await fetch(path);
      if (!r.ok) throw new Error('LOCAL_STATE_FAILED');
      return await r.json();
    } catch (_) {
      throw new MailError('LOCAL_STATE_FAILED','localState');
    }
  }
  async function accounts() {
    const entries = await local('/oauth');
    if (!Array.isArray(entries)) throw new MailError('LOCAL_STATE_FAILED','accountState');
    return Object.entries(CLOUDS).map(([cloud,cfg]) => {
      const e = entries.find(e => e.key === cfg.key);
      return { cloud, configured: !!e?.clientConfigured, accounts: (e?.accounts || []).map(a => ({
        id:a.id, label:a.label, status:a.status, is_default:!!a.isDefault, needs_reauthorization:!!a.scopeStale,
      })) };
    });
  }
  async function choose(a) {
    const groups = await accounts();
    let cloud = a.cloud;
    if (a.account) {
      const found = groups.filter(g => (!cloud || g.cloud === cloud) && g.accounts.some(x => x.id === a.account));
      if (found.length !== 1) throw new MailError('ACCOUNT_NOT_FOUND','accountNotFound');
      cloud = found[0].cloud;
    }
    if (!cloud) {
      const cfg = await local('/kv') || {};
      cloud = Object.hasOwn(CLOUDS,cfg.default_cloud) ? cfg.default_cloud : 'global';
    }
    const g = groups.find(g => g.cloud === cloud);
    if (!g.configured) throw new MailError('CLIENT_NOT_CONFIGURED','clientNotConfigured');
    const account = a.account ? g.accounts.find(x => x.id === a.account) : g.accounts.find(x => x.is_default);
    if (!account) throw new MailError('ACCOUNT_NOT_CONNECTED','accountNotConnected');
    if (account.status !== 'connected') throw new MailError('ACCOUNT_EXPIRED','accountExpired');
    return { ...CLOUDS[cloud], cloud, account:account.id };
  }
  async function accountInfo(a,callId,transport) {
    if (!a || typeof a !== 'object' || Array.isArray(a) || Object.keys(a).some(k => k !== 'profile_account')) invalid('profileArgs');
    if (a.profile_account !== undefined) text(a.profile_account,'profile_account');
    const regions = await accounts();
    if (a.profile_account === undefined) return {regions};
    const ctx = await choose({account:a.profile_account});
    const data = await api({url:ctx.base+'/me?$select=mail,userPrincipalName',method:'GET'},ctx,callId,'profile',transport);
    if (![data.mail,data.userPrincipalName].every(v => v === null || typeof v === 'string')) throw new MailError('INVALID_RESPONSE','profileIncomplete');
    return {regions,profile:{cloud:ctx.cloud,account:ctx.account,mail:data.mail,user_principal_name:data.userPrincipalName}};
  }
  function validPageUrl(raw,ctx,action) {
    let u; try { u = new URL(raw); } catch (_) { invalid('pageUrlInvalid'); }
    // Graph nextLink can use lowercase navigation names and OData key syntax.
    // Accept only the same /me collections; never follow /users or action URLs.
    const valid = action === 'search' ? /^\/v1\.0\/me\/(?:messages|mailFolders(?:\/[^/]+|\('[^'/]+'\))\/messages)$/i.test(u.pathname)
      : /^\/v1\.0\/me\/mailFolders(?:(?:\/[^/]+|\('[^'/]+'\))\/childFolders)?$/i.test(u.pathname);
    if (u.origin !== new URL(ctx.base).origin || u.username || u.password || u.hash || !valid) invalid('pageUrlScope');
    return u.href;
  }
  function encodePage(url,ctx,action) {
    validPageUrl(url,ctx,action);
    const bytes = new TextEncoder().encode(JSON.stringify({url,cloud:ctx.cloud,account:ctx.account,action}));
    return btoa(Array.from(bytes,b => String.fromCharCode(b)).join(''));
  }
  function decodePage(token,ctx,action) {
    let p; try { p = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(token),c => c.charCodeAt(0)))); }
    catch (_) { invalid('pageTokenInvalid'); }
    if (!p || p.cloud !== ctx.cloud || p.account !== ctx.account || p.action !== action) invalid('pageTokenMismatch');
    return validPageUrl(p.url,ctx,action);
  }
  function build(a,ctx) {
    const method = ['mark_read','mark_unread'].includes(a.action) ? 'PATCH' : WRITES.includes(a.action) ? 'POST' : 'GET';
    let path, body;
    const q = new URLSearchParams();
    if (['search','list_folders'].includes(a.action)) {
      if (a.page_token) return {url:decodePage(a.page_token,ctx,a.action),method};
      path = a.action === 'list_folders'
        ? a.folder ? '/me/mailFolders/'+segment(a.folder,'folder')+'/childFolders' : '/me/mailFolders'
        : a.folder ? '/me/mailFolders/'+segment(a.folder,'folder')+'/messages' : '/me/messages';
      q.set('$top',String(a.max_results || 10));
      if (a.action === 'list_folders') q.set('$select','id,displayName,parentFolderId,childFolderCount,unreadItemCount,totalItemCount');
      else {
        q.set('$select',SUMMARY);
        if (a.query !== undefined) q.set('$search',JSON.stringify(a.query));
        else {
          const filters = [];
          if (a.since) filters.push('receivedDateTime ge '+date(a.since,'since'));
          if (a.before) filters.push('receivedDateTime lt '+date(a.before,'before'));
          const quote = s => "'"+s.replace(/'/g,"''")+"'";
          if (a.from) filters.push('from/emailAddress/address eq '+quote(a.from));
          if (a.subject) filters.push('contains(subject,'+quote(a.subject)+')');
          if (a.unread !== undefined) filters.push('isRead eq '+!a.unread);
          if (filters.length) q.set('$filter',filters.join(' and '));
          // Graph requires ordered properties to lead the filter; do not add a hidden date cutoff.
          if (!filters.length || a.since || a.before) q.set('$orderby','receivedDateTime desc');
        }
      }
    } else {
      path = '/me/messages/'+segment(a.message_id,'message_id');
      if (a.action === 'read') q.set('$select',SUMMARY+',body,ccRecipients,bccRecipients,replyTo,conversationId');
      if (a.action === 'move') { path += '/move'; body = {destinationId:a.target_folder}; }
      if (['mark_read','mark_unread'].includes(a.action)) body = {isRead:a.action === 'mark_read'};
    }
    const request = {url:ctx.base+path+(q.size ? '?'+q : ''),method};
    if (body !== undefined) request.body = JSON.stringify(body);
    if (request.body && new TextEncoder().encode(request.body).length > 250000) invalid('bodyTooLarge');
    return request;
  }
  function failureKey(status,code) {
    if (/MailboxNotEnabledForRESTAPI/.test(code)) return 'mailboxNotEnabled';
    if (status === 401) return 'http401';
    if (status === 403) return 'http403';
    if (status === 404) return 'http404';
    if (status === 429) return 'http429';
    if (status >= 500) return 'http5xx';
    return 'httpOther';
  }
  async function api(request,ctx,callId,action,transport) {
    const write = WRITES.includes(action);
    let r;
    try { r = await transport({...request,callId,authAccount:ctx.account,as:'text',timeoutMs:30000,
      headers:{Accept:'application/json',Prefer:'outlook.body-content-type="text"',...(request.body ? {'Content-Type':'application/json'} : {})}}); }
    catch (_) { throw new MailError('REQUEST_FAILED',write ? 'interruptedWrite' : 'interruptedRead',write ? 'unknown' : 'not_executed'); }
    if (!r.ok) throw new MailError('REQUEST_FAILED',write ? 'hostFailedWrite' : 'hostFailedRead',write ? 'unknown' : 'not_executed');
    if (!Number.isInteger(r.status) || r.status < 100 || r.status > 599) throw new MailError('INVALID_RESPONSE','invalidStatus',write ? 'unknown' : 'not_executed');
    const success = r.status >= 200 && r.status < 300;
    const state = success && write ? 'executed' : write && (r.status >= 500 || r.status === 408) ? 'unknown' : 'not_executed';
    let data = null;
    if (!r.truncated && r.body) { try { data = JSON.parse(r.body); } catch (_) { /* checked below */ } }
    if (!success) throw new MailError('GRAPH_REQUEST_FAILED',failureKey(r.status,typeof data?.error?.code === 'string' ? data.error.code : ''),
      state,{status:r.status},state === 'unknown' ? 'unknownSuffix' : undefined);
    if (r.truncated || !data || typeof data !== 'object' || Array.isArray(data)) throw new MailError('INVALID_RESPONSE',
      write ? 'incompleteWrite' : 'incompleteRead',state);
    return data;
  }
  function summary(m, ctx) {
    return {id:m.id,subject:m.subject,from:m.from?.emailAddress,to:m.toRecipients?.map(r => r.emailAddress),
      received_at:m.receivedDateTime,preview:m.bodyPreview,is_read:m.isRead,is_draft:m.isDraft,
      has_attachments:m.hasAttachments,folder_id:m.parentFolderId,web_url:(ctx && webLink(m.webLink,ctx)) || m.webLink,internet_message_id:m.internetMessageId};
  }
  async function run(a,callId,transport,env = {}) {
    validate(a);
    const ctx = await choose(a);
    // Direct sends bypass the visible draft and undo window; use the shared flow.
    if (a.action === 'send') throw new MailError('SEND_REQUIRES_DRAFT','sendRequiresDraft');
    if (DRAFT_ACTIONS.includes(a.action)) return draftTool(a,ctx,transport,{...env,callId});
    const data = await api(build(a,ctx),ctx,callId,a.action,transport);
    const common = {cloud:ctx.cloud,account:ctx.account};
    if (['search','list_folders'].includes(a.action)) {
      if (!Array.isArray(data.value)) throw new MailError('INVALID_RESPONSE','incompleteList');
      const page = data['@odata.nextLink'] ? encodePage(data['@odata.nextLink'],ctx,a.action) : null;
      if (a.action === 'search') return {...common,messages:data.value.map(m => summary(m,ctx)),next_page_token:page,returned_count:data.value.length,search_limit:a.query ? 1000 : undefined};
      return {...common,folders:data.value.map(f => ({id:f.id,name:f.displayName,parent_id:f.parentFolderId,
        child_folder_count:f.childFolderCount,unread_count:f.unreadItemCount,total_count:f.totalItemCount})),next_page_token:page};
    }
    if (!data.id) throw new MailError('INVALID_RESPONSE','missingId',WRITES.includes(a.action) ? 'executed' : 'not_executed');
    if (a.action === 'read') {
      const body = data.body?.content || '';
      return {...common,...summary(data,ctx),cc:data.ccRecipients?.map(r => r.emailAddress),bcc:data.bccRecipients?.map(r => r.emailAddress),
        body:body.slice(0,50000),body_content_type:data.body?.contentType,body_truncated:body.length > 50000,conversation_id:data.conversationId};
    }
    return {...common,execution_status:'executed',message:summary(data,ctx),...(a.action === 'move' ? {previous_id:a.message_id,note:t('moveNote')} : {})};
  }
  // ---- Cindy shared mail flow (cindyMail v1) and native reader -------------
  // Cindy owns cards, autosave, the send countdown and task continuation. This
  // adapter only translates account selection and Graph draft reads/writes.
  // Card edits have no Agent callId; every request uses a declared Graph host
  // and the Host-injected token of the record's account.
  const READER_HOSTS = Object.freeze({ global: ['outlook.office365.com', 'outlook.office.com', 'outlook.live.com', 'outlook.cloud.microsoft'],
    china: ['partner.outlook.cn'] });
  const DRAFT_SELECT = 'id,subject,from,toRecipients,ccRecipients,bccRecipients,replyTo,body,isDraft,changeKey,conversationId,internetMessageId,webLink';
  const MAX_PREVIEW = 16 * 1024 * 1024, MAX_PREVIEW_TOTAL = 25 * 1024 * 1024, MAX_REWRITE = 3 * 1024 * 1024;
  const fail = (key, execution = 'not_executed', params) => ({ ok: false, execution, message: t(key, params) });
  function raw(code, execution, message, detail) {
    const e = new MailError(code, 'outcomeUnknown', execution);
    e.message = message; if (detail) e.detail = detail;
    return e;
  }
  // Graph request with an explicit write/read outcome. A received non-2xx is a
  // definite rejection except 408/5xx; transport errors on a write are unknown.
  async function graph(transport, ctx, req, { write = false, callId, prefer } = {}) {
    let r;
    try {
      r = await transport({ url: req.url || ctx.base + req.path, method: req.method || 'GET', ...(callId ? { callId } : {}),
        authAccount: ctx.account, as: 'text', timeoutMs: req.timeoutMs || 30000, ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
        headers: { Accept: 'application/json', ...(prefer ? { Prefer: 'outlook.body-content-type="' + prefer + '"' } : {}),
          ...(req.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(req.headers || {}) } });
    } catch (_) { throw new MailError('REQUEST_FAILED', write ? 'interruptedWrite' : 'interruptedRead', write ? 'unknown' : 'not_executed'); }
    if (!r || !r.ok) throw new MailError('REQUEST_FAILED', write ? 'hostFailedWrite' : 'hostFailedRead', write ? 'unknown' : 'not_executed');
    if (!Number.isInteger(r.status) || r.status < 100 || r.status > 599) throw new MailError('INVALID_RESPONSE', 'invalidStatus', write ? 'unknown' : 'not_executed');
    let data = null;
    if (!r.truncated && r.body) { try { data = JSON.parse(r.body); } catch (_) { /* checked by callers */ } }
    if (r.status < 200 || r.status >= 300) {
      const state = write && (r.status >= 500 || r.status === 408) ? 'unknown' : 'not_executed';
      const e = new MailError('GRAPH_REQUEST_FAILED', failureKey(r.status, typeof data?.error?.code === 'string' ? data.error.code : ''),
        state, { status: r.status }, state === 'unknown' ? 'unknownSuffix' : undefined);
      e.status = r.status;
      throw e;
    }
    if (r.truncated) throw new MailError('INVALID_RESPONSE', write ? 'incompleteWrite' : 'incompleteRead', write ? 'executed' : 'not_executed');
    return { status: r.status, data };
  }
  const object = (value, write) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MailError('INVALID_RESPONSE', write ? 'incompleteWrite' : 'incompleteRead', write ? 'executed' : 'not_executed');
    return value;
  };
  const escapeHtml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const textHtml = s => s ? s.replace(/\r\n?/g, '\n').split('\n').map(line => '<div>' + (line ? escapeHtml(line) : '<br>') + '</div>').join('') : '';
  function decodeEntities(s) {
    return s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(nbsp|amp|lt|gt|quot|apos));/gi, (all, hex, dec, name) => {
      if (name) return { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[name.toLowerCase()];
      const code = parseInt(hex || dec, hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
    });
  }
  // Exchange may normalize stored HTML markup. Verification therefore compares
  // the readable text and inline image references, never byte-identical markup.
  const visible = html => decodeEntities(html.replace(/<(style|script|title)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  // Size of the plain text Outlook derives from HTML: inline tags vanish without a
  // space (adjacent spans stay joined), each block end or <br> costs a CRLF. It only
  // measures, so tags are walked rather than pattern-stripped.
  const BLOCK_ENDS = new Set(['p', 'div', 'tr', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote']);
  function plainSize(html) {
    const lower = html.toLowerCase();
    let text = '', breaks = 0, index = 0;
    while (index < html.length) {
      const lt = html.indexOf('<', index);
      if (lt < 0) { text += html.slice(index); break; }
      text += html.slice(index, lt);
      if (lower.startsWith('<!--', lt)) {
        const end = html.indexOf('-->', lt + 4);
        if (end < 0) break;
        index = end + 3;
        continue;
      }
      const tag = /^<(\/?)([a-z][a-z0-9]*)/.exec(lower.slice(lt, lt + 24));
      if (!tag) { text += '<'; index = lt + 1; continue; }
      let gt = -1, quote = '';
      for (let at = lt + 1; at < html.length && gt < 0; at++) {
        const char = html[at];
        if (quote) { if (char === quote) quote = ''; } else if (char === '"' || char === "'") quote = char;
        else if (char === '>') gt = at;
      }
      if (gt < 0) break;
      if (!tag[1] && ['style', 'script', 'title'].includes(tag[2])) {
        const close = lower.indexOf('</' + tag[2], gt);
        const end = close < 0 ? -1 : html.indexOf('>', close);
        if (end < 0) break;
        index = end + 1;
        continue;
      }
      if (tag[1] ? BLOCK_ENDS.has(tag[2]) : tag[2] === 'br') breaks++;
      index = gt + 1;
    }
    return decodeEntities(text).length + 2 * breaks;
  }
  const cids = html => [...new Set([...html.matchAll(/\bcid:([^"'\s)>]+)/gi)].map(m => decodeEntities(m[1]).toLowerCase()))].sort().join(',');
  const bareCid = v => String(v || '').replace(/^<|>$/g, '');
  // Graph returns a full HTML document. The editor works on the body content;
  // writes put it back into the stored document so head styles survive.
  function splitDocument(html) {
    const open = /<body\b[^>]*>/i.exec(html), end = html.toLowerCase().lastIndexOf('</body');
    if (!open || end < open.index + open[0].length) return { prefix: '', inner: html, suffix: '' };
    const start = open.index + open[0].length;
    return { prefix: html.slice(0, start), inner: html.slice(start, end), suffix: html.slice(end) };
  }
  // Only split the reply/forward layout Outlook itself produces; unknown layouts
  // remain one editable body instead of guessing away part of the message.
  function quoteAt(inner) {
    const marks = [/<div\b[^>]*\bid=["']?appendonsend\b/i, /<hr\b[^>]*display\s*:\s*inline-block[^>]*>\s*<div\b[^>]*\bid=["']?divRplyFwdMsg\b/i, /<div\b[^>]*\bid=["']?divRplyFwdMsg\b/i];
    const found = marks.map(re => re.exec(inner)).filter(Boolean).map(m => m.index);
    return found.length ? Math.min(...found) : -1;
  }
  function editorFor(stored, plain) {
    if (stored.contentType !== 'html') {
      return { format: 'text', body: stored.content, quote: '', bodyHtml: textHtml(stored.content), quoteHtml: '', editable: true };
    }
    const doc = splitDocument(stored.content), at = quoteAt(doc.inner);
    const textMark = /(?:\r?\n)+_{10,}\r?\n/.exec(plain);
    const split = at >= 0 && textMark;
    return { format: 'html', body: split ? plain.slice(0, textMark.index) : plain, quote: split ? plain.slice(textMark.index) : '',
      bodyHtml: at >= 0 ? doc.inner.slice(0, at) : doc.inner, quoteHtml: at >= 0 ? doc.inner.slice(at) : '', editable: true };
  }
  const address = r => {
    const e = r && r.emailAddress || {}, a = typeof e.address === 'string' ? e.address : '', n = typeof e.name === 'string' ? e.name.replace(/["\\\r\n]/g, '') : '';
    return a && n && n.toLowerCase() !== a.toLowerCase() ? '"' + n + '" <' + a + '>' : a;
  };
  const addressList = list => (Array.isArray(list) ? list : []).map(address).filter(Boolean).join(', ');
  // Card recipients may carry display names: "Name" <a@b>, a@b; quotes protect commas.
  function parseAddresses(value, name) {
    if (typeof value !== 'string' || value.length > 20000) invalid('invalidText', { name });
    const pieces = []; let start = 0, quoted = false;
    for (let i = 0; i <= value.length; i++) {
      const c = value[i];
      if (c === '"') quoted = !quoted;
      if (i === value.length || (!quoted && (c === ',' || c === ';'))) { pieces.push(value.slice(start, i)); start = i + 1; }
    }
    const out = pieces.map(p => p.trim()).filter(Boolean).map(p => {
      const m = /^(.*)<([^<>]+)>$/.exec(p);
      const addr = (m ? m[2] : p).trim(), display = m ? m[1].trim().replace(/^"|"$/g, '').trim() : '';
      if (!/^[^\s<>@,;"]+@[^\s<>@,;"]+\.[^\s<>@,;"]+$/.test(addr) || /[\r\n\0]/.test(display)) invalid('invalidAddress', { name });
      return { emailAddress: { address: addr, ...(display ? { name: display } : {}) } };
    });
    if (out.length > 100) invalid('tooManyAddresses', { name });
    return out;
  }
  const sameRecipients = (a, b) => JSON.stringify((a || []).map(r => [String(r.emailAddress?.address || '').toLowerCase(), r.emailAddress?.name || ''])) ===
    JSON.stringify((b || []).map(r => [String(r.emailAddress?.address || '').toLowerCase(), r.emailAddress?.name || '']));
  // Profile lookups are read-only, account-scoped and cached in memory only.
  const profiles = new Map();
  async function profile(ctx, transport, callId) {
    if (profiles.has(ctx.account)) return profiles.get(ctx.account);
    let value = { email: '', self: [] };
    try {
      const { data } = await graph(transport, ctx, { path: '/me?$select=mail,userPrincipalName,proxyAddresses' }, { callId });
      const self = [data?.mail, data?.userPrincipalName, ...(Array.isArray(data?.proxyAddresses) ? data.proxyAddresses.map(p => String(p).replace(/^smtp:/i, '')) : [])]
        .filter(v => typeof v === 'string' && v.includes('@')).map(v => v.toLowerCase());
      value = { email: typeof data?.mail === 'string' && data.mail ? data.mail : typeof data?.userPrincipalName === 'string' ? data.userPrincipalName : '', self };
      profiles.set(ctx.account, value);
    } catch (_) { /* Optional display/self-exclusion data; never blocks mail. */ }
    return value;
  }
  async function selectAccount(accountId, transport, callId) {
    try {
      const ctx = await choose({ account: accountId });
      return { ok: true, accountId: ctx.account, accountEmail: (await profile(ctx, transport, callId)).email, ctx };
    } catch (e) { return { ok: false, message: e.message }; }
  }
  // Bind every web link to the opaque account it came from; Outlook ignores the
  // extra parameter, Cindy's reader uses it to avoid guessing between accounts.
  function webLink(raw, ctx) {
    try {
      const u = new URL(raw);
      if (u.protocol !== 'https:' || u.username || u.password || u.port || !READER_HOSTS[ctx.cloud].includes(u.hostname)) return null;
      u.searchParams.set('cindy_account', ctx.account);
      return u.href;
    } catch (_) { return null; }
  }
  const previewCache = new Map();
  async function deposit(base64, filename) {
    if (typeof cindy === 'undefined' || typeof cindy.send !== 'function') return null;
    try { const r = await cindy.send({ type: 'cindy-request', kind: 'deposit_media', data: base64, label: filename }); return r && r.ok ? r.url : null; }
    catch (_) { return null; }
  }
  // Attachment metadata, inline Content-IDs and bounded image previews. Bytes
  // stay in this call; only managed preview URLs reach the card or model.
  async function loadAttachments(ctx, messageId, transport, callId, { bytes: wantBytes = [] } = {}) {
    const base = '/me/messages/' + encodeURIComponent(messageId) + '/attachments';
    const { data } = await graph(transport, ctx, { path: base + '?$select=id,name,contentType,size,isInline' }, { callId });
    // A further page would silently drop attachments from edits and sends.
    if (!Array.isArray(object(data).value) || data['@odata.nextLink']) throw new MailError('INVALID_RESPONSE', 'incompleteList');
    const started = Date.now(); let total = 0;
    const files = {}, list = [];
    for (const item of data.value) {
      if (!item || typeof item.id !== 'string' || !item.id) throw new MailError('INVALID_RESPONSE', 'incompleteList');
      const kind = item['@odata.type'] === '#microsoft.graph.itemAttachment' ? 'item' : item['@odata.type'] === '#microsoft.graph.referenceAttachment' ? 'reference' : 'file';
      const mimeType = typeof item.contentType === 'string' && item.contentType ? item.contentType.toLowerCase() : 'application/octet-stream';
      const size = Number.isSafeInteger(item.size) && item.size >= 0 ? item.size : 0;
      const entry = { key: item.id, filename: typeof item.name === 'string' ? item.name : '', mimeType, bytes: size, contentId: '', inline: item.isInline === true, kind };
      const cacheKey = ctx.account + '\n' + messageId + '\n' + item.id;
      const cached = previewCache.get(cacheKey);
      const image = /^image\/(png|jpeg|gif|webp)$/.test(mimeType);
      const needBytes = wantBytes.includes(item.id);
      if (kind === 'file' && (cached === undefined || needBytes) && (entry.inline || image || needBytes) && size <= MAX_PREVIEW
          && (needBytes || (Date.now() - started < 15000 && total + size <= MAX_PREVIEW_TOTAL))) {
        try {
          const one = (await graph(transport, ctx, { path: base + '/' + encodeURIComponent(item.id) }, { callId })).data;
          if (one && typeof one.contentBytes === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(one.contentBytes)) {
            total += size;
            files[item.id] = one.contentBytes;
            const preview = image && cached?.url === undefined ? await deposit(one.contentBytes, entry.filename) : cached?.url || null;
            previewCache.set(cacheKey, { contentId: bareCid(one.contentId), url: preview });
            while (previewCache.size > 256) previewCache.delete(previewCache.keys().next().value);
          } else if (needBytes) throw new MailError('INVALID_RESPONSE', 'incompleteRead');
        } catch (e) { if (needBytes) throw e; /* A preview never invalidates the mail. */ }
      }
      const known = previewCache.get(cacheKey);
      if (known) { entry.contentId = known.contentId; if (known.url) entry.previewUrl = known.url; }
      list.push(entry);
    }
    return { attachments: list, files };
  }
  const publicAttachments = list => list.map(({ inline, kind, ...a }) => a);
  // Full read-back of one draft: stored body, plain alternative and attachments.
  async function readSnapshot(ctx, draftId, transport, callId, wantBytes) {
    const path = '/me/messages/' + segment(draftId, 'draft_id') + '?$select=' + DRAFT_SELECT;
    const message = object((await graph(transport, ctx, { path }, { callId })).data);
    if (message.id !== draftId || !message.body || typeof message.body.content !== 'string' || typeof message.changeKey !== 'string')
      throw new MailError('INVALID_RESPONSE', 'incompleteRead');
    if (message.isDraft !== true) throw new MailError('NOT_A_DRAFT', 'notDraft');
    const stored = { contentType: String(message.body.contentType || '').toLowerCase() === 'html' ? 'html' : 'text', content: message.body.content };
    let plain = stored.content;
    if (stored.contentType === 'html') {
      const text = object((await graph(transport, ctx, { path: '/me/messages/' + segment(draftId, 'draft_id') + '?$select=body,changeKey' }, { callId, prefer: 'text' })).data);
      if (text.changeKey !== message.changeKey) throw new MailError('DRAFT_CHANGING', 'draftChanging');
      plain = typeof text.body?.content === 'string' ? text.body.content : '';
    }
    const { attachments, files } = await loadAttachments(ctx, draftId, transport, callId, { bytes: wantBytes });
    const images = attachments.filter(a => a.contentId && a.previewUrl).map(a => ({ cid: a.contentId, url: a.previewUrl }));
    const snapshot = { status: 'read_back', draftId, messageId: draftId, fingerprint: message.changeKey, locator: { changeKey: message.changeKey },
      conversationId: message.conversationId || null, internetMessageId: message.internetMessageId || null, webLink: webLink(message.webLink, ctx),
      headers: { from: address(message.from), to: addressList(message.toRecipients), cc: addressList(message.ccRecipients), bcc: addressList(message.bccRecipients),
        subject: typeof message.subject === 'string' ? message.subject : '', 'reply-to': addressList(message.replyTo) },
      editor: editorFor(stored, plain), attachments: publicAttachments(attachments), ...(images.length ? { images } : {}) };
    return { snapshot, message, stored, attachments, files };
  }
  function fieldsOf(snapshot) {
    const e = snapshot.editor;
    return { to: snapshot.headers.to, cc: snapshot.headers.cc, bcc: snapshot.headers.bcc, subject: snapshot.headers.subject, body: e.body, quote: e.quote,
      bodyHtml: e.bodyHtml, quoteHtml: e.quoteHtml,
      attachmentItems: JSON.stringify(snapshot.attachments.map(a => ({ key: a.key, filename: a.filename, bytes: a.bytes, contentId: a.contentId || '' }))) };
  }
  const FIELD_NAMES = ['to', 'cc', 'bcc', 'subject', 'body', 'quote', 'bodyHtml', 'quoteHtml', 'attachmentItems'];
  // Save (and optionally send) the complete current draft. Every write first
  // checks the version the card or model last saw; a changed draft is returned
  // as stale for Cindy's three-way merge, never silently overwritten.
  async function writeDraft(ctx, { draftId, fingerprint, fields, send, additions }, transport, callId) {
    let execution = 'not_executed';
    const written = () => { execution = 'executed'; };
    try {
      if (Array.isArray(additions) && additions.length) return fail('attachUnsupported');
      if (!fields || typeof fields !== 'object' || FIELD_NAMES.some(n => typeof fields[n] !== 'string' || fields[n].length > (n.endsWith('Html') ? 64000 : 16000) || fields[n].includes('\0'))
        || typeof fingerprint !== 'string' || !fingerprint) return fail('draftFieldsInvalid');
      const read = await readSnapshot(ctx, draftId, transport, callId);
      const before = read.snapshot;
      if (before.fingerprint !== fingerprint) return { ok: false, execution: 'not_executed', stale: before, message: t('draftChanged') };
      const original = fieldsOf(before);
      const to = parseAddresses(fields.to, 'to'), cc = parseAddresses(fields.cc, 'cc'), bcc = parseAddresses(fields.bcc, 'bcc');
      if (to.length + cc.length + bcc.length > 100) invalid('tooManyRecipients');
      if (/[\r\n]/.test(fields.subject) || fields.subject.length > 998) invalid('invalidText', { name: 'subject' });
      // Attachments are identified by Graph attachment ID. Removing an item deletes
      // it; a changed name or Content-ID re-creates the same bytes under that metadata.
      let wanted;
      try { wanted = JSON.parse(fields.attachmentItems); } catch (_) { return fail('attachmentListInvalid'); }
      if (!Array.isArray(wanted) || wanted.some(a => !a || typeof a.key !== 'string' || !read.attachments.some(b => b.key === a.key))
        || new Set(wanted.map(a => a.key)).size !== wanted.length) return fail('attachmentListInvalid');
      const removed = read.attachments.filter(a => !wanted.some(w => w.key === a.key));
      const changed = wanted.map(w => ({ want: w, have: read.attachments.find(a => a.key === w.key) })).filter(({ want, have }) =>
        (want.filename ?? have.filename) !== have.filename || bareCid(want.contentId ?? have.contentId) !== bareCid(have.contentId));
      for (const { have, want } of changed) {
        if (have.kind !== 'file' || have.bytes > MAX_REWRITE || typeof (want.filename ?? have.filename) !== 'string' || /[\r\n\0/\\]/.test(want.filename ?? have.filename))
          return fail('attachmentRewriteUnsupported');
      }
      const recreate = changed.length ? (await loadAttachments(ctx, draftId, transport, callId, { bytes: changed.map(c => c.have.key) })).files : {};
      // Port of the Gmail adapter's rule: a plain-text card edit regenerates the
      // HTML only when the HTML itself was not edited.
      const html = before.editor.format === 'html' || fields.bodyHtml !== original.bodyHtml || fields.body === original.body ? fields.bodyHtml
        : textHtml(fields.body);
      const quoteHtml = fields.quoteHtml !== original.quoteHtml || fields.quote === original.quote ? fields.quoteHtml
        : fields.quote ? '<div id="appendonsend"></div><hr style="display:inline-block;width:98%" tabindex="-1"><div>' + textHtml(fields.quote) + '</div>' : '';
      const bodyChanged = ['body', 'quote', 'bodyHtml', 'quoteHtml'].some(n => fields[n].replace(/\r\n/g, '\n') !== original[n].replace(/\r\n/g, '\n'));
      const plainOnly = before.editor.format === 'text' && fields.bodyHtml === original.bodyHtml && fields.quoteHtml === original.quoteHtml;
      const patch = {};
      if (!sameRecipients(to, read.message.toRecipients)) patch.toRecipients = to;
      if (!sameRecipients(cc, read.message.ccRecipients)) patch.ccRecipients = cc;
      if (!sameRecipients(bcc, read.message.bccRecipients)) patch.bccRecipients = bcc;
      if (fields.subject !== before.headers.subject) patch.subject = fields.subject;
      let expectedBody = null;
      if (bodyChanged) {
        if (plainOnly) {
          // A plain-text draft is read back whole: the card shows it as one text field and
          // as the HTML derived from it, so both forms must fit before anything is written.
          if ((fields.body + fields.quote).length > 16000 || textHtml(fields.body + fields.quote).length > 64000) invalid('bodyTooLarge');
          patch.body = { contentType: 'Text', content: fields.body + fields.quote };
          expectedBody = { text: fields.body + fields.quote };
        } else {
          const doc = read.stored.contentType === 'html' ? splitDocument(read.stored.content) : { prefix: '', suffix: '' };
          patch.body = { contentType: 'HTML', content: doc.prefix + html + quoteHtml + doc.suffix };
          expectedBody = { html: html + quoteHtml };
        }
        if (new TextEncoder().encode(JSON.stringify(patch)).length > 250000) invalid('bodyTooLarge');
      }
      const mutate = Object.keys(patch).length || removed.length || changed.length;
      let saved = before;
      if (mutate) {
        const path = '/me/messages/' + segment(draftId, 'draft_id');
        const step = async req => {
          try { const r = await graph(transport, ctx, req, { write: true, callId }); written(); return r; }
          catch (e) {
            if (execution === 'executed' && e.execution === 'not_executed') throw new MailError('PARTIAL_SAVE', 'partialSave', 'executed');
            throw e;
          }
        };
        if (Object.keys(patch).length) {
          try {
            // If-Match makes the version check atomic with the update.
            await step({ path, method: 'PATCH', body: patch, headers: { 'If-Match': read.message['@odata.etag'] || 'W/"' + before.fingerprint + '"' } });
          } catch (e) {
            if (e.status === 412) {
              let latest; try { latest = (await readSnapshot(ctx, draftId, transport, callId)).snapshot; } catch (_) { /* SDK re-reads. */ }
              return { ok: false, execution: 'not_executed', stale: latest || true, message: t('draftChanged') };
            }
            throw e;
          }
        }
        // Add the replacement before deleting the original so a failure can
        // only leave a duplicate for review, never lose the attached bytes.
        for (const { have, want } of changed) {
          const cid = bareCid(want.contentId ?? have.contentId);
          await step({ path: path + '/attachments', method: 'POST', timeoutMs: 120000, body: { '@odata.type': '#microsoft.graph.fileAttachment',
            name: want.filename ?? have.filename, contentType: have.mimeType, contentBytes: recreate[have.key], isInline: !!cid, ...(cid ? { contentId: cid } : {}) } });
          await step({ path: path + '/attachments/' + encodeURIComponent(have.key), method: 'DELETE' });
        }
        for (const item of removed) await step({ path: path + '/attachments/' + encodeURIComponent(item.key), method: 'DELETE' });
        let savedRead;
        try { savedRead = await readSnapshot(ctx, draftId, transport, callId); saved = savedRead.snapshot; }
        catch (_) { return fail('draftSavedUnverified', 'executed'); }
        const norm = s => s.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
        const facts = list => JSON.stringify(list.map(a => [a.filename, bareCid(a.contentId).toLowerCase()]).sort());
        const expectedFiles = wanted.map(w => { const have = read.attachments.find(a => a.key === w.key); return { filename: w.filename ?? have.filename, contentId: w.contentId ?? have.contentId }; });
        if (!sameRecipients(to, savedRead.message.toRecipients) || !sameRecipients(cc, savedRead.message.ccRecipients)
            || !sameRecipients(bcc, savedRead.message.bccRecipients) || saved.headers.subject !== fields.subject
            || (expectedBody?.text !== undefined && (savedRead.stored.contentType !== 'text' || norm(savedRead.stored.content) !== norm(expectedBody.text)))
            || (expectedBody?.html !== undefined && (savedRead.stored.contentType !== 'html' || visible(splitDocument(savedRead.stored.content).inner) !== visible(expectedBody.html)
              || cids(splitDocument(savedRead.stored.content).inner) !== cids(expectedBody.html)))
            || facts(saved.attachments) !== facts(expectedFiles))
          return fail('draftSavedMismatch', 'executed');
      }
      if (!send) return { ok: true, execution, data: { draftId, readBack: saved } };
      if (!saved.headers.to && !saved.headers.cc && !saved.headers.bcc) return fail('noRecipient', execution);
      try { await graph(transport, ctx, { path: '/me/messages/' + segment(draftId, 'draft_id') + '/send', method: 'POST' }, { write: true, callId }); }
      catch (e) { if (execution === 'executed' && e.execution === 'not_executed') return fail('partialSave', 'executed'); throw e; }
      return { ok: true, execution: 'executed', data: { sent: true, draftId, readBack: saved,
        receipt: { messageId: draftId, internetMessageId: saved.internetMessageId, accepted: true, delivery_confirmed: false } } };
    } catch (e) {
      const known = e instanceof MailError;
      const state = known && execution === 'executed' && e.execution === 'not_executed' ? 'executed' : known ? e.execution : execution === 'executed' ? 'executed' : 'unknown';
      return { ok: false, execution: state, message: known ? e.message : t('outcomeUnknown') };
    }
  }
  async function deleteDraft(ctx, draftId, transport, callId) {
    try {
      await readSnapshot(ctx, draftId, transport, callId);
      await graph(transport, ctx, { path: '/me/messages/' + segment(draftId, 'draft_id'), method: 'DELETE' }, { write: true, callId });
      return { ok: true, execution: 'executed', data: { deleted: true, draftId } };
    } catch (e) {
      return { ok: false, execution: e instanceof MailError ? e.execution : 'unknown', message: e instanceof MailError ? e.message : t('outcomeUnknown') };
    }
  }
  // cindyMail adapter. Records contain only the opaque account, draft ID and
  // change key; credentials and bodies stay with the Host and Graph.
  function adapter(transport) {
    return {
      providerName: 'Outlook', draftStorage: 'server', storageLock: 'outlook-mail-kv', richText: true,
      async selectAccount(accountId) { await ensureLocale(typeof cindy === 'undefined' ? null : cindy); const s = await selectAccount(accountId, transport); delete s.ctx; return s; },
      async readDraft({ record, sourceCallId }) {
        try {
          const ctx = await choose({ account: record.account });
          return { ok: true, data: { readBack: (await readSnapshot(ctx, record.draftId, transport, sourceCallId)).snapshot } };
        } catch (e) { return { ok: false, execution: 'not_executed', message: e.message }; }
      },
      async writeDraft({ record, fields, send, attachments, sourceCallId }) {
        let ctx;
        try { ctx = await choose({ account: record.account }); } catch (e) { return { ok: false, execution: 'not_executed', message: e.message }; }
        return writeDraft(ctx, { draftId: record.draftId, fingerprint: record.fingerprint, fields, send, additions: attachments }, transport, sourceCallId);
      },
      async deleteDraft({ record, sourceCallId }) {
        let ctx;
        try { ctx = await choose({ account: record.account }); } catch (e) { return { ok: false, execution: 'not_executed', message: e.message }; }
        return deleteDraft(ctx, record.draftId, transport, sourceCallId);
      },
    };
  }
  function sdk(result, common) {
    if (result.ok) return { ...common, ...(result.data || {}) };
    throw raw(result.cancelled ? 'SEND_CANCELLED' : 'MAIL_DRAFT_FAILED', ['executed', 'not_executed', 'unknown'].includes(result.execution) ? result.execution : 'unknown',
      result.message || t('outcomeUnknown'), result.execution === 'not_executed' ? undefined : result.message);
  }
  // Reply-all defaults: exclude this mailbox, duplicate addresses and Bcc.
  function replyRecipients(message, self, all) {
    const seen = new Set(), keep = list => (Array.isArray(list) ? list : []).filter(r => {
      const a = String(r?.emailAddress?.address || '').toLowerCase();
      if (!a || self.includes(a) || seen.has(a)) return false;
      seen.add(a); return true;
    }).map(r => ({ emailAddress: { address: r.emailAddress.address, ...(r.emailAddress.name ? { name: r.emailAddress.name } : {}) } }));
    const to = keep(message.toRecipients), cc = all ? keep(message.ccRecipients) : [];
    // Replying to one's own sent message: keep Outlook's choice rather than none.
    return to.length || cc.length ? { to, cc } : { to: message.toRecipients || [], cc: all ? message.ccRecipients || [] : [] };
  }
  async function createDraft(a, ctx, transport, callId) {
    const html = a.body_html !== undefined;
    let created;
    let execution = 'not_executed';
    try {
      if (a.action === 'draft') {
        created = object((await graph(transport, ctx, { path: '/me/messages', method: 'POST', body: { subject: a.subject,
          body: { contentType: html ? 'HTML' : 'Text', content: html ? a.body_html : a.body_text || '' },
          toRecipients: recipients(a.to, 'to'), ccRecipients: recipients(a.cc, 'cc'), bccRecipients: recipients(a.bcc, 'bcc') } }, { write: true, callId })).data, true);
        execution = 'executed';
      } else {
        const kind = { reply: 'createReply', reply_all: 'createReplyAll', forward: 'createForward' }[a.action];
        created = object((await graph(transport, ctx, { path: '/me/messages/' + segment(a.message_id, 'message_id') + '/' + kind, method: 'POST', body: {} }, { write: true, callId })).data, true);
        execution = 'executed';
        if (typeof created.id !== 'string' || !created.id) throw new MailError('INVALID_RESPONSE', 'missingId', 'executed');
        const patch = {};
        if (a.action === 'forward') {
          patch.toRecipients = recipients(a.to, 'to'); patch.ccRecipients = recipients(a.cc, 'cc'); patch.bccRecipients = recipients(a.bcc, 'bcc');
        } else {
          const r = replyRecipients(created, (await profile(ctx, transport, callId)).self, a.action === 'reply_all');
          if (!sameRecipients(r.to, created.toRecipients)) patch.toRecipients = r.to;
          if (!sameRecipients(r.cc, created.ccRecipients)) patch.ccRecipients = r.cc;
          if ((created.bccRecipients || []).length) patch.bccRecipients = [];
        }
        if (a.body_text !== undefined || html) {
          const stored = created.body && typeof created.body.content === 'string' ? created.body : { contentType: 'html', content: '' };
          const doc = String(stored.contentType).toLowerCase() === 'html' ? splitDocument(stored.content) : { prefix: '', inner: textHtml(stored.content), suffix: '' };
          const at = quoteAt(doc.inner);
          patch.body = { contentType: 'HTML', content: doc.prefix + (html ? a.body_html : textHtml(a.body_text)) + (at >= 0 ? doc.inner.slice(at) : doc.inner) + doc.suffix };
        }
        if (Object.keys(patch).length) {
          try {
            await graph(transport, ctx, { path: '/me/messages/' + segment(created.id, 'draft_id'), method: 'PATCH', body: patch,
              ...(created['@odata.etag'] ? { headers: { 'If-Match': created['@odata.etag'] } } : {}) }, { write: true, callId });
          } catch (e) { throw raw(e.code, e.execution === 'not_executed' ? 'executed' : e.execution, t('replyCreatedNotUpdated', { id: created.id }), t('replyCreatedNotUpdated', { id: created.id })); }
        }
      }
    } catch (e) {
      if (e instanceof MailError && execution === 'executed' && e.execution === 'not_executed') e.execution = 'executed';
      throw e;
    }
    if (typeof created.id !== 'string' || !created.id) throw new MailError('INVALID_RESPONSE', 'missingId', 'executed');
    return created.id;
  }
  // Tool-side draft operations map onto the shared flow. Older hosts keep
  // read-only draft inspection; edits and sends require Cindy's mail flow.
  async function draftTool(a, ctx, transport, env) {
    const { mail, writable, callId, message } = env;
    const common = { cloud: ctx.cloud, account: ctx.account };
    const present = async readBack => {
      if (!mail || !writable) return false;
      try {
        const selected = await selectAccount(ctx.account, transport, callId); delete selected.ctx;
        return selected.ok ? await mail.present(message, selected, readBack) : false;
      } catch (_) { return false; }
    };
    if (a.action !== 'get_draft') {
      if (!mail) throw new MailError('MAIL_FLOW_UNSUPPORTED', 'mailFlowUnsupported');
      if (!writable) throw new MailError('READ_ONLY', 'readOnlyDraft');
      if (a.action === 'send_draft' && env.graceMs !== 10000) throw new MailError('MAIL_FLOW_UNSUPPORTED', 'undoWindowUnsupported');
    }
    if (['draft', 'reply', 'reply_all', 'forward'].includes(a.action)) {
      const draftId = await createDraft(a, ctx, transport, callId);
      let readBack;
      try { readBack = (await readSnapshot(ctx, draftId, transport, callId)).snapshot; }
      catch (_) { return { ...common, execution_status: 'executed', draft_id: draftId, readBack: { status: 'unavailable', message: t('draftSavedUnverified') } }; }
      // Outlook's generated quote can outgrow the draft card's field limits, which
      // would leave a draft no card can show or send. Shorten it to a text quote.
      if (a.action !== 'draft' && (readBack.editor.quote.length > 16000 || readBack.editor.quoteHtml.length > 64000)) {
        let limit = 12000, cut, quoteHtml;
        for (;; limit = Math.floor(limit * 0.6)) {
          cut = readBack.editor.quote.slice(0, limit).replace(/\s+$/, '') + '\n…';
          quoteHtml = '<div id="appendonsend"></div><hr style="display:inline-block;width:98%" tabindex="-1"><div>' + textHtml(cut) + '</div>';
          if (quoteHtml.length <= 64000 || limit < 200) break; // newlines expand the HTML: measure it
        }
        const shrunk = await writeDraft(ctx, { draftId, fingerprint: readBack.fingerprint, send: false, additions: [], fields: { ...fieldsOf(readBack), quote: cut, quoteHtml } }, transport, callId);
        if (!shrunk.ok) return { ...common, execution_status: 'executed', draft_id: draftId, readBack: { status: 'unavailable', message: t('draftSavedUnverified') } };
        readBack = shrunk.data.readBack;
      }
      return { ...common, execution_status: 'executed', draft_id: draftId, message: { id: draftId, subject: readBack.headers.subject, is_draft: true, web_url: readBack.webLink },
        readBack, draftCard: await present(readBack) };
    }
    const operation = { get_draft: 'get', update_draft: 'update', send_draft: 'send', delete_draft: 'delete' }[a.action];
    if (mail && (operation === 'send' || await mail.resolveDraft(ctx.account, a.draft_id))) {
      const result = await mail.beforeTool({ operation, account: ctx.account, draftId: a.draft_id, readOnly: !writable, sourceCallId: callId });
      if (result) return sdk(result, { ...common, draft_id: a.draft_id });
    }
    if (operation === 'get') {
      const readBack = (await readSnapshot(ctx, a.draft_id, transport, callId)).snapshot;
      return { ...common, draft_id: a.draft_id, readBack, draftCard: await present(readBack) };
    }
    if (operation === 'delete') return sdk(await deleteDraft(ctx, a.draft_id, transport, callId), { ...common, draft_id: a.draft_id });
    // Model update: start from the current saved draft and replace only the
    // supplied fields, through the same verified write as card edits.
    const before = (await readSnapshot(ctx, a.draft_id, transport, callId)).snapshot;
    const fields = fieldsOf(before);
    for (const name of ['to', 'cc', 'bcc']) if (a[name] !== undefined) fields[name] = recipients(a[name], name).map(r => r.emailAddress.address).join(', ');
    if (a.subject !== undefined) fields.subject = a.subject;
    if (a.body_html !== undefined) { fields.bodyHtml = a.body_html; fields.body = visible(a.body_html); }
    else if (a.body_text !== undefined) { fields.body = a.body_text; if (before.editor.format === 'html') fields.bodyHtml = textHtml(a.body_text); }
    const saved = sdk(await writeDraft(ctx, { draftId: a.draft_id, fingerprint: before.fingerprint, fields, send: false }, transport, callId), { ...common, draft_id: a.draft_id });
    return { ...saved, execution_status: 'executed', draftCard: await present(saved.readBack) };
  }
  // Native reader: Outlook web link → selected message, conversation summaries
  // and an explicit-open-only read mark with a three-state receipt.
  async function readLink(args, callId, transport) {
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(k => !['url', 'account', 'markRead'].includes(k))) invalid('unexpectedArgs');
    if (args.markRead !== undefined && typeof args.markRead !== 'boolean') invalid('invalidText', { name: 'markRead' });
    let url; try { url = new URL(text(args.url, 'url', 2048)); } catch (e) { if (e instanceof MailError) throw e; throw new MailError('INVALID_ARGUMENT', 'linkUnsupported'); }
    const cloud = Object.keys(READER_HOSTS).find(c => READER_HOSTS[c].includes(url.hostname));
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !cloud) throw new MailError('INVALID_ARGUMENT', 'linkUnsupported');
    let id = url.searchParams.get('ItemID') || url.searchParams.get('itemid');
    if (!id) { const m = /\/(?:id|read)\/([^/?#]+)\/?$/i.exec(url.pathname); if (m) { try { id = decodeURIComponent(m[1]); } catch (_) { id = null; } } }
    if (!id || !/^[A-Za-z0-9+/=_-]{8,1024}$/.test(id)) throw new MailError('INVALID_ARGUMENT', 'linkUnsupported');
    const bound = url.searchParams.get('cindy_account');
    if (args.account !== undefined) text(args.account, 'account');
    if (bound && args.account !== undefined && bound !== args.account) throw new MailError('INVALID_ARGUMENT', 'linkAccountMismatch');
    let account = bound || args.account;
    if (!account) {
      const connected = ((await accounts()).find(g => g.cloud === cloud)?.accounts || []).filter(x => x.status === 'connected');
      if (connected.length !== 1) throw new MailError('ACCOUNT_REQUIRED', 'linkAccountRequired');
      account = connected[0].id;
    }
    const ctx = await choose({ account, cloud });
    const path = '/me/messages/' + segment(id, 'message_id');
    const select = 'id,subject,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,sentDateTime,isRead,isDraft,conversationId,webLink,body';
    const message = object((await graph(transport, ctx, { path: path + '?$select=' + select }, { callId, prefer: 'html' })).data);
    if (message.id !== id || typeof message.body?.content !== 'string') throw new MailError('INVALID_RESPONSE', 'incompleteRead');
    const plain = object((await graph(transport, ctx, { path: path + '?$select=body' }, { callId, prefer: 'text' })).data);
    const { attachments } = await loadAttachments(ctx, id, transport, callId);
    let conversation, conversationUnavailable = false;
    if (typeof message.conversationId === 'string' && message.conversationId) {
      try {
        const q = new URLSearchParams({ $filter: "conversationId eq '" + message.conversationId.replace(/'/g, "''") + "'", $select: 'id,subject,from,receivedDateTime,sentDateTime,bodyPreview,isDraft,webLink', $top: '1000' });
        const list = object((await graph(transport, ctx, { path: '/me/messages?' + q }, { callId })).data);
        // Following further pages is not supported: report the conversation as unavailable
        // instead of presenting the first page as the whole thread.
        if (!Array.isArray(list.value) || list['@odata.nextLink']) throw new Error('incomplete');
        const members = list.value.filter(m => m && typeof m.id === 'string' && (m.isDraft !== true || m.id === id))
          .map(m => ({ m, at: Date.parse(m.receivedDateTime || m.sentDateTime || '') || 0 })).sort((x, y) => x.at - y.at).map(x => x.m);
        const ids = new Set(members.map(m => m.id));
        if (!ids.has(id) || ids.size !== members.length) throw new Error('missing');
        const messages = members.map(m => ({ messageId: m.id, url: webLink(m.webLink, ctx), from: address(m.from), date: String(m.receivedDateTime || m.sentDateTime || ''),
          subject: typeof m.subject === 'string' ? m.subject : '', snippet: String(m.bodyPreview || '').slice(0, 2048) }));
        if (messages.some(m => !m.url)) throw new Error('link');
        conversation = { threadId: message.conversationId, messages };
      } catch (_) { conversationUnavailable = true; }
    }
    let markReadResult;
    if (args.markRead === true && message.isRead === false && message.isDraft !== true) {
      try {
        await graph(transport, ctx, { path, method: 'PATCH', body: { isRead: true } }, { write: true, callId });
        markReadResult = { execution: 'executed' };
      } catch (e) {
        markReadResult = e instanceof MailError && e.execution === 'not_executed' ? { execution: 'not_executed', message: t('markReadFailed') } : { execution: 'unknown', message: t('markReadUnknown') };
      }
    }
    return { accountId: ctx.account, messageId: id, from: address(message.from), to: addressList(message.toRecipients), cc: addressList(message.ccRecipients),
      bcc: addressList(message.bccRecipients), subject: typeof message.subject === 'string' ? message.subject : '', date: String(message.receivedDateTime || message.sentDateTime || ''),
      bodyText: typeof plain.body?.content === 'string' ? plain.body.content : '', bodyHtml: String(message.body.contentType).toLowerCase() === 'html' ? message.body.content : '',
      ...(conversation ? { conversation } : {}), ...(conversationUnavailable ? { conversationUnavailable: true } : {}),
      ...(markReadResult ? { markReadResult } : {}), ...(markReadResult?.execution === 'not_executed' ? { markReadFailed: true } : {}),
      attachments: publicAttachments(attachments) };
  }
  return {CLOUDS,MESSAGES,t,ensureLocale,setLocale,MailError,validate,build,accounts,accountInfo,run,encodePage,decodePage,adapter,readLink,draftTool,webLink};
})();
// OAuth, token refresh and Authorization injection belong to the Host.
// The plugin receives account metadata only; every mail request uses cindy.fetch.
// Cindy serves its mail SDK before this entry; older hosts keep read-only use.
var outlookCompose = typeof cindy !== 'undefined' && typeof cindyMail !== 'undefined' && cindyMail.version === 1
  ? cindyMail.register(OutlookMail.adapter(req => cindy.fetch(req))) : null;
if (typeof cindy !== 'undefined') cindy.onHostMessage(async msg => {
  if (!msg) return;
  if (msg.type === 'host-context-changed') { OutlookMail.setLocale(msg.context && msg.context.locale); return; }
  if (msg.type !== 'tool-call') return;
  await OutlookMail.ensureLocale(cindy);
  try {
    let result;
    // session_context is Host-supplied metadata, never a mail argument.
    const { session_context: context, ...args } = msg.args && typeof msg.args === 'object' && !Array.isArray(msg.args) ? msg.args : {};
    if (msg.tool === 'outlook_accounts') result = await OutlookMail.accountInfo(args,msg.callId,req=>cindy.fetch(req));
    else if (msg.tool === 'outlook_mail') result = await OutlookMail.run(args,msg.callId,req=>cindy.fetch(req),
      {mail:outlookCompose,writable:context?.workdir_is_read_only === false,message:msg,graceMs:typeof cindyMail !== 'undefined' ? cindyMail.sendGraceMs : undefined});
    else if (msg.tool === 'outlook_read_message') result = await OutlookMail.readLink(args,msg.callId,req=>cindy.fetch(req));
    else throw new OutlookMail.MailError('UNKNOWN_MAIL_TOOL','unknownTool');
    await cindy.send({type:'tool-result',callId:msg.callId,ok:true,result});
  } catch (err) {
    const known = err instanceof OutlookMail.MailError;
    const execution = known ? err.execution : 'unknown';
    const message = (execution === 'unknown' ? OutlookMail.t('outcomeUnknown')
      : execution === 'executed' ? OutlookMail.t('outcomeExecuted') : err.message) + (known && err.detail ? ' ' + err.detail : '');
    await cindy.send({type:'tool-result',callId:msg.callId,ok:false,errorCode:known ? err.code : 'MAIL_OPERATION_FAILED',
      message:'[execution_status='+execution+'] '+message});
  }
});
