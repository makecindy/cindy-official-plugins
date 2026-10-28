/* global cindy */
'use strict';
var OutlookMail = (() => {
  const CLOUDS = Object.freeze({
    global: { key: 'outlook_global', base: 'https://graph.microsoft.com/v1.0' },
    china: { key: 'outlook_china', base: 'https://microsoftgraph.chinacloudapi.cn/v1.0' },
  });
  const ACTIONS = ['search', 'read', 'send', 'draft', 'list_folders', 'mark_read', 'mark_unread', 'move'];
  const WRITES = ['send', 'draft', 'mark_read', 'mark_unread', 'move'];
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
      bodyTooLarge: '邮件内容过大，请缩短正文后重试（请求上限约 250 KB）。',
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
      sendAccepted: '微软已接受发送请求；不代表收件人已收到邮件。',
      incompleteWrite: '微软响应不完整；服务已接受操作，请先检查邮箱，勿直接重复执行。',
      incompleteRead: '微软响应不完整；请减小 max_results 后重新查询。',
      unexpectedSend: '微软返回了非预期发送响应，请先检查已发送邮件，勿直接重发。',
      incompleteList: '微软返回的列表不完整，请重新查询。',
      missingId: '微软响应缺少邮件 ID，请重新查询邮箱状态。',
      moveNote: '后续操作请使用返回的新 ID。',
      unknownTool: '未知邮件工具，请重新获取插件工具清单。',
      outcomeUnknown: '操作结果不确定；请先检查邮箱中的实际状态，不要直接重复执行。',
      outcomeExecuted: '服务已接受操作，但结果未能完整返回；请先检查邮箱中的实际状态，不要直接重复执行。',
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
      bodyTooLarge: 'Message is too large; shorten the body and retry (request limit is about 250 KB).',
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
      sendAccepted: 'Microsoft accepted the send request; this does not mean the recipients have received it.',
      incompleteWrite: 'Incomplete Microsoft response; the service accepted the operation. Check the mailbox first and do not repeat the operation directly.',
      incompleteRead: 'Incomplete Microsoft response; reduce max_results and query again.',
      unexpectedSend: 'Microsoft returned an unexpected send response; check Sent Items first and do not resend directly.',
      incompleteList: 'Microsoft returned an incomplete list; query again.',
      missingId: 'The Microsoft response is missing the message ID; check the mailbox state again.',
      moveNote: 'Use the returned new ID for further operations.',
      unknownTool: 'Unknown mail tool; reload the plugin tool list.',
      outcomeUnknown: 'The outcome is uncertain; check the mailbox first for its actual state and do not repeat the operation directly.',
      outcomeExecuted: 'The service accepted the operation, but the result was not returned completely; check the mailbox first for its actual state and do not repeat the operation directly.',
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
      bodyTooLarge: 'メールの内容が大きすぎます。本文を短くしてから再試行してください（リクエストの上限は約 250 KB）。',
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
      sendAccepted: 'Microsoft が送信リクエストを受け付けました。宛先にメールが届いたことを意味するものではありません。',
      incompleteWrite: 'Microsoft の応答が不完全です。サービスは操作を受け付けています。まずメールボックスを確認し、そのまま操作を繰り返さないでください。',
      incompleteRead: 'Microsoft の応答が不完全です。max_results を小さくしてもう一度検索してください。',
      unexpectedSend: 'Microsoft から予期しない送信応答が返されました。まず送信済みアイテムを確認し、そのまま再送しないでください。',
      incompleteList: 'Microsoft から返された一覧が不完全です。もう一度検索してください。',
      missingId: 'Microsoft の応答にメール ID が含まれていません。メールボックスの状態をもう一度確認してください。',
      moveNote: '以降の操作には、返された新しい ID を使用してください。',
      unknownTool: '不明なメールツールです。プラグインのツール一覧を再取得してください。',
      outcomeUnknown: '操作の結果が確定していません。まずメールボックスで実際の状態を確認し、そのまま操作を繰り返さないでください。',
      outcomeExecuted: 'サービスは操作を受け付けましたが、結果が完全には返されませんでした。まずメールボックスで実際の状態を確認し、そのまま操作を繰り返さないでください。',
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
      bodyTooLarge: '메일 내용이 너무 큽니다. 본문을 줄인 후 다시 시도하세요(요청 한도는 약 250KB).',
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
      sendAccepted: 'Microsoft가 보내기 요청을 수락했습니다. 받는 사람이 메일을 받았다는 의미는 아닙니다.',
      incompleteWrite: 'Microsoft 응답이 불완전합니다. 서비스가 작업을 수락했습니다. 먼저 메일함을 확인하고 작업을 그대로 반복하지 마세요.',
      incompleteRead: 'Microsoft 응답이 불완전합니다. max_results를 줄인 후 다시 조회하세요.',
      unexpectedSend: 'Microsoft가 예상하지 못한 보내기 응답을 반환했습니다. 먼저 보낸 편지함을 확인하고 그대로 다시 보내지 마세요.',
      incompleteList: 'Microsoft가 반환한 목록이 불완전합니다. 다시 조회하세요.',
      missingId: 'Microsoft 응답에 메일 ID가 없습니다. 메일함 상태를 다시 확인하세요.',
      moveNote: '이후 작업에는 반환된 새 ID를 사용하세요.',
      unknownTool: '알 수 없는 메일 도구입니다. 플러그인 도구 목록을 다시 불러오세요.',
      outcomeUnknown: '작업 결과가 확실하지 않습니다. 먼저 메일함에서 실제 상태를 확인하고 작업을 그대로 반복하지 마세요.',
      outcomeExecuted: '서비스가 작업을 수락했지만 결과가 완전히 반환되지 않았습니다. 먼저 메일함에서 실제 상태를 확인하고 작업을 그대로 반복하지 마세요.',
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
      read: ['message_id'], send: ['to','cc','bcc','subject','body_text'], draft: ['to','cc','bcc','subject','body_text'],
      mark_read: ['message_id'], mark_unread: ['message_id'], move: ['message_id','target_folder'],
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
    if (['read','mark_read','mark_unread','move'].includes(a.action)) segment(a.message_id, 'message_id');
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
      text(a.subject,'subject',998,true); text(a.body_text,'body_text',200000,true);
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
    } else if (['send','draft'].includes(a.action)) {
      const message = {subject:a.subject,body:{contentType:'Text',content:a.body_text},
        toRecipients:recipients(a.to,'to'),ccRecipients:recipients(a.cc,'cc'),bccRecipients:recipients(a.bcc,'bcc')};
      path = a.action === 'send' ? '/me/sendMail' : '/me/messages';
      body = a.action === 'send' ? {message,saveToSentItems:true} : message;
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
    if (action === 'send' && r.status === 202) return {accepted:true,delivery_confirmed:false,execution_status:'executed',note:t('sendAccepted')};
    if (r.truncated || !data || typeof data !== 'object' || Array.isArray(data)) throw new MailError('INVALID_RESPONSE',
      write ? 'incompleteWrite' : 'incompleteRead',state);
    if (action === 'send') throw new MailError('UNEXPECTED_SEND_RESPONSE','unexpectedSend','unknown');
    return data;
  }
  function summary(m) {
    return {id:m.id,subject:m.subject,from:m.from?.emailAddress,to:m.toRecipients?.map(r => r.emailAddress),
      received_at:m.receivedDateTime,preview:m.bodyPreview,is_read:m.isRead,is_draft:m.isDraft,
      has_attachments:m.hasAttachments,folder_id:m.parentFolderId,web_url:m.webLink,internet_message_id:m.internetMessageId};
  }
  async function run(a,callId,transport) {
    validate(a);
    const ctx = await choose(a);
    const data = await api(build(a,ctx),ctx,callId,a.action,transport);
    const common = {cloud:ctx.cloud,account:ctx.account};
    if (['search','list_folders'].includes(a.action)) {
      if (!Array.isArray(data.value)) throw new MailError('INVALID_RESPONSE','incompleteList');
      const page = data['@odata.nextLink'] ? encodePage(data['@odata.nextLink'],ctx,a.action) : null;
      if (a.action === 'search') return {...common,messages:data.value.map(summary),next_page_token:page,returned_count:data.value.length,search_limit:a.query ? 1000 : undefined};
      return {...common,folders:data.value.map(f => ({id:f.id,name:f.displayName,parent_id:f.parentFolderId,
        child_folder_count:f.childFolderCount,unread_count:f.unreadItemCount,total_count:f.totalItemCount})),next_page_token:page};
    }
    if (a.action === 'send') return {...common,...data};
    if (!data.id) throw new MailError('INVALID_RESPONSE','missingId',WRITES.includes(a.action) ? 'executed' : 'not_executed');
    if (a.action === 'read') {
      const body = data.body?.content || '';
      return {...common,...summary(data),cc:data.ccRecipients?.map(r => r.emailAddress),bcc:data.bccRecipients?.map(r => r.emailAddress),
        body:body.slice(0,50000),body_content_type:data.body?.contentType,body_truncated:body.length > 50000,conversation_id:data.conversationId};
    }
    return {...common,execution_status:'executed',message:summary(data),...(a.action === 'move' ? {previous_id:a.message_id,note:t('moveNote')} : {})};
  }
  return {CLOUDS,MESSAGES,t,ensureLocale,setLocale,MailError,validate,build,accounts,accountInfo,run,encodePage,decodePage};
})();
// OAuth, token refresh and Authorization injection belong to the Host.
// The plugin receives account metadata only; every mail request uses cindy.fetch.
if (typeof cindy !== 'undefined') cindy.onHostMessage(async msg => {
  if (!msg) return;
  if (msg.type === 'host-context-changed') { OutlookMail.setLocale(msg.context && msg.context.locale); return; }
  if (msg.type !== 'tool-call') return;
  await OutlookMail.ensureLocale(cindy);
  try {
    let result;
    if (msg.tool === 'outlook_accounts') result = await OutlookMail.accountInfo(msg.args || {},msg.callId,req=>cindy.fetch(req));
    else if (msg.tool === 'outlook_mail') result = await OutlookMail.run(msg.args || {},msg.callId,req=>cindy.fetch(req));
    else throw new OutlookMail.MailError('UNKNOWN_MAIL_TOOL','unknownTool');
    await cindy.send({type:'tool-result',callId:msg.callId,ok:true,result});
  } catch (err) {
    const known = err instanceof OutlookMail.MailError;
    const execution = known ? err.execution : 'unknown';
    const message = execution === 'unknown' ? OutlookMail.t('outcomeUnknown')
      : execution === 'executed' ? OutlookMail.t('outcomeExecuted') : err.message;
    await cindy.send({type:'tool-result',callId:msg.callId,ok:false,errorCode:known ? err.code : 'MAIL_OPERATION_FAILED',
      message:'[execution_status='+execution+'] '+message});
  }
});
