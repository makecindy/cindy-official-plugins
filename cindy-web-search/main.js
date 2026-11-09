/**
 * Web Search · 电子脑 —— Cindy 内置网页搜索意识(cindy + network 槽)。
 *
 * 各 Provider 路径严格分账:
 * - cindy:Cindy Desktop 主机代办 -> LiteLLM /v1/messages -> 模型原生 Web Search，
 *   使用 Cindy AI 额度；
 * - brave:network 槽 -> Brave，使用用户自己的 Brave Key；
 * - tavily:network 槽 -> Tavily，使用用户自己的 Tavily Key；
 * - deepseek:network 槽 -> DeepSeek Search API，使用用户自己的 DeepSeek Key。
 *
 * 未指定 Provider 时只读取普通偏好:
 * - cindyAiEnabled 缺省 true -> cindy；
 * - 显式关闭后 -> byoDefaultProvider(缺省 brave)。
 * 任一路失败都原样返回，不跨 Provider fallback，避免静默消耗另一套凭证。
 */

/* global cindy, crypto */

var BRAVE_URL = 'https://api.search.brave.com/res/v1/web/search';
var TAVILY_URL = 'https://api.tavily.com/search';
var DEEPSEEK_URL = 'https://api.deepseek.com/v1/tools/search';
var TAVILY_EXTRACT_URL = 'https://api.tavily.com/extract';
var FETCH_PAGE_MAX_URL_CHARS = 2048;
var FETCH_PAGE_HOST_TIMEOUT_MS = 55000;
// Agent delivery budgets only; provider responses and saved files stay complete.
var TOOL_RESULT_MAX_CHARS = 12000;
var SEARCH_PREVIEW_RESULTS = 5;
var SEARCH_PREVIEW_SNIPPET_CHARS = 500;
var PAGE_PREVIEW_CONTENT_CHARS = 5000;
var RESULT_FILE_MAX_BYTES = 16 * 1024 * 1024;
// At most 12 MiB in UTF-8, below the Host's 16 MiB write limit.
var RESULT_FILE_CHUNK_CHARS = 4 * 1024 * 1024;
var BRAVE_SEARCH_OPTIONS = {
  country: 'string', search_lang: 'string', ui_lang: 'string', offset: 'number',
  freshness: 'string', safesearch: 'string', spellcheck: 'boolean',
  text_decorations: 'boolean', result_filter: 'string|string[]', units: 'string',
  goggles: 'string|string[]', extra_snippets: 'boolean', summary: 'boolean',
  enable_rich_callback: 'boolean', include_fetch_metadata: 'boolean',
  operators: 'boolean', operators_fallback: 'boolean',
  headers: {
    'x-loc-lat': 'number', 'x-loc-long': 'number', 'x-loc-timezone': 'string',
    'x-loc-city': 'string', 'x-loc-state': 'string', 'x-loc-state-name': 'string',
    'x-loc-country': 'string', 'x-loc-postal-code': 'string',
    'api-version': 'string', 'cache-control': 'string', 'user-agent': 'string',
  },
};
var TAVILY_SEARCH_OPTIONS = {
  search_depth: 'string', chunks_per_source: 'number', topic: 'string',
  time_range: 'string|null', start_date: 'string', end_date: 'string',
  include_published_date: 'boolean', filter_by_published_date: 'boolean', max_age_hours: 'number',
  include_answer: 'boolean|string', include_raw_content: 'boolean|string',
  include_images: 'boolean', include_image_descriptions: 'boolean', include_favicon: 'boolean',
  include_domains: 'string[]', exclude_domains: 'string[]', include_domains_mode: 'string',
  country: 'string|null', language: 'string', filter_by_language: 'boolean',
  auto_parameters: 'boolean', exact_match: 'boolean', include_usage: 'boolean', safe_search: 'boolean',
};

/*
 * 运行时文案只跟随宿主语言(cindy.request app-context / host-context-changed),
 * 不读浏览器或操作系统语言;宿主语言不在表内或取不到时回退英文。
 * errorCode 是稳定协议,不翻译;只翻译 message / note。
 */
var MESSAGES = {
  'zh-CN': {
    cindyUnavailable: 'Cindy AI 搜索服务暂时不可用，请稍后再试',
    httpError: '{provider} 返回 HTTP {status}:{body}',
    nativeOptionsInvalid: '{options} 只能用于对应搜索源，并须使用已声明的原生参数类型；不能覆盖查询、条数、请求地址或凭证。',
    nativeResponseInvalid: '{provider} 返回的搜索结果格式无效或被宿主截断，请检查上游响应后重试。',
    resultPreviewSaved: '当前仅展示预览；完整结果见 saved_to。按需读取已保存文件，无需重复调用本工具。',
    resultSaveFailed: '本次搜索已完成，但完整结果文件未保存。请检查任务文件写入权限及工作目录支持后，再决定是否重新搜索。',
    pageResultSaveFailed: '网页读取已完成，但完整正文文件未保存。请检查任务文件写入权限及工作目录支持后，再决定是否重新读取。',
    deepSeek_NOT_CONFIGURED: '请在「插件」→「Web Search」详情页配置 DeepSeek API Key。',
    deepSeek_AUTH_REJECTED: 'DeepSeek API Key 无效，请在「插件」→「Web Search」详情页更新 Key。',
    deepSeek_PERMISSION_DENIED: 'DeepSeek 搜索请求未获授权，请检查 Cindy 授权及 DeepSeek 账号的接口权限。',
    deepSeek_QUOTA_EXHAUSTED: 'DeepSeek 账户余额不足，请充值后再搜索。',
    deepSeek_RATE_LIMITED: 'DeepSeek 搜索请求过于频繁，请稍后重试（每账户最多 5 次/秒）。',
    deepSeek_INVALID_INPUT: 'DeepSeek 搜索参数无效，请使用 1–128 个 Unicode 字符的查询后重试。',
    deepSeek_INVALID_OPTIONS: 'deepseek_options 仅用于 DeepSeek，支持 need_content（布尔值）、ori_question（1–128 个 Unicode 字符）和 localization（IP 地址字符串）；不能覆盖查询、条数或凭证。',
    deepSeek_UPSTREAM_UNAVAILABLE: 'DeepSeek 搜索服务暂时不可用，请检查网络连接后稍后重试。',
    deepSeek_UPSTREAM_REJECTED: 'DeepSeek 未接受搜索请求，请检查账号权限或更新 Web Search 插件后再试。',
    deepSeek_RESPONSE_INVALID: 'DeepSeek 返回的搜索结果格式无效或被宿主截断，请检查上游响应后重试。',
    deepSeekFallback: 'DeepSeek 搜索请求未完成，请检查网络连接、Cindy 授权，并确认「插件」→「Web Search」详情页已配置有效的 DeepSeek API Key。',
    queryEmpty: 'query 不能为空',
    queryTooLong: 'query 过长(上限 2000 字符)',
    providerUnsupported: 'provider 只支持 cindy / brave / tavily / deepseek',
    prefsUnavailable: '搜索偏好读取失败，请稍后重试或显式选择搜索源',
    unknownTool: '未知工具:{tool}',
    pageUrlInvalid: 'url 必须是最多 2048 字符且不含凭证的公开 HTTP(S) 绝对地址',
    pageConfirmRequired: '发送前必须请用户明确确认：该 URL 是公开页面，完整路径和查询参数不含会话、重置、签名或 webhook 凭证，并允许将完整 URL 发送给 Tavily；确认后传 confirm_public_url:true 重试',
    pageDepthUnsupported: 'extract_depth 只支持 basic / advanced',
    pageTavilyKeyRejected: 'Tavily API Key 无效或未配置，请在主界面侧边栏「插件」→「Web Search」详情页检查 Key',
    pageTavilyPermissionDenied: 'Tavily 拒绝了正文读取请求，请检查 API Key 权限或账户状态',
    pageTavilyRateLimited: 'Tavily 请求过于频繁，请等待限流恢复后再试',
    pageTavilyQuotaExhausted: 'Tavily 额度不足或账户不可用，请在 Tavily 控制台检查额度与账户状态',
    pageTavilyUnavailable: 'Tavily 正文读取服务暂时不可用，请稍后再试',
    pageTavilyRejected: 'Tavily 无法处理这个网页，请确认 URL 可公开访问后再试',
    pageReadTimedOut: '网页正文读取超时，请稍后重试或改用 basic 模式',
    pageTavilyKeyMissing: 'Tavily API Key 未配置，请在主界面侧边栏「插件」→「Web Search」详情页填写 Key',
    pageReadTransportFailed: '无法连接 Tavily 正文读取服务，请检查网络后再试',
    pageResponseTooLarge: 'Tavily 返回的数据过大，无法安全解析，请换一个更具体的网页',
    pageResponseUnparsable: 'Tavily 返回了无法解析的数据，请稍后再试',
    pageResponseMalformed: 'Tavily 返回的数据格式异常，请稍后再试',
    pageUnreadable: 'Tavily 无法读取这个网页，请确认页面可公开访问后再试',
    pageNoContent: '这个网页没有可读取的正文内容',
    pageFetchFailed: '网页正文读取失败，请稍后重试',
    resultNote: '经 {provider} 搜索到 {count} 条结果',
    searchFailed: '搜索失败:{detail}',
  },
  en: {
    cindyUnavailable: 'Cindy AI search is temporarily unavailable. Please try again later.',
    httpError: '{provider} returned HTTP {status}: {body}',
    nativeOptionsInvalid: '{options} is only available for its matching provider and declared native parameter types. Query, count, endpoint and credentials cannot be overridden.',
    nativeResponseInvalid: '{provider} returned invalid search data or the host truncated it. Check the upstream response and try again.',
    resultPreviewSaved: 'This is a preview. Read the complete result at saved_to as needed; do not repeat this tool call.',
    resultSaveFailed: 'The search completed, but the complete result file was not saved. Check task file permissions and workdir support before deciding whether to search again.',
    pageResultSaveFailed: 'The page was read, but the complete content file was not saved. Check task file permissions and workdir support before deciding whether to read it again.',
    deepSeek_NOT_CONFIGURED: 'Configure a DeepSeek API Key in "Plugins" > "Web Search" details.',
    deepSeek_AUTH_REJECTED: 'The DeepSeek API Key is invalid. Update the key in "Plugins" > "Web Search" details.',
    deepSeek_PERMISSION_DENIED: 'The DeepSeek search request was not authorized. Check the Cindy authorization and the API permissions of your DeepSeek account.',
    deepSeek_QUOTA_EXHAUSTED: 'Your DeepSeek account balance is insufficient. Top up before searching again.',
    deepSeek_RATE_LIMITED: 'Too many DeepSeek search requests. Please try again later (at most 5 requests per second per account).',
    deepSeek_INVALID_INPUT: 'Invalid DeepSeek search parameters. Retry with a query of 1 to 128 Unicode characters.',
    deepSeek_INVALID_OPTIONS: 'deepseek_options is only available for DeepSeek: need_content (boolean), ori_question (1–128 Unicode characters), localization (IP address string). Query, count and credentials cannot be overridden.',
    deepSeek_UPSTREAM_UNAVAILABLE: 'DeepSeek search is temporarily unavailable. Check your network connection and try again later.',
    deepSeek_UPSTREAM_REJECTED: 'DeepSeek did not accept the search request. Check your account permissions or update the Web Search plugin, then try again.',
    deepSeek_RESPONSE_INVALID: 'DeepSeek returned invalid search data or the host truncated it. Check the upstream response and try again.',
    deepSeekFallback: 'The DeepSeek search request did not complete. Check your network connection and the Cindy authorization, and make sure a valid DeepSeek API Key is configured in "Plugins" > "Web Search" details.',
    queryEmpty: 'query must not be empty',
    queryTooLong: 'query is too long (max 2000 characters)',
    providerUnsupported: 'provider only supports cindy / brave / tavily / deepseek',
    prefsUnavailable: 'Failed to read search preferences. Try again later or choose a provider explicitly.',
    unknownTool: 'Unknown tool: {tool}',
    pageUrlInvalid: 'url must be a public HTTP(S) absolute address of at most 2048 characters and must not contain credentials',
    pageConfirmRequired: 'Ask the user for explicit confirmation before sending: the URL is a public page, its full path and query contain no session, reset, signature or webhook credential, and the full URL may be sent to Tavily; then retry with confirm_public_url:true',
    pageDepthUnsupported: 'extract_depth only supports basic / advanced',
    pageTavilyKeyRejected: 'The Tavily API Key is invalid or missing. Check the key in "Plugins" > "Web Search" details.',
    pageTavilyPermissionDenied: 'Tavily rejected the page reading request. Check the API Key permissions and account status.',
    pageTavilyRateLimited: 'Tavily requests are too frequent. Wait for the rate limit to reset and try again.',
    pageTavilyQuotaExhausted: 'The Tavily quota is exhausted or the account is unusable. Check your quota and account status in the Tavily console.',
    pageTavilyUnavailable: 'Tavily page reading is temporarily unavailable. Please try again later.',
    pageTavilyRejected: 'Tavily could not handle this page. Confirm the URL is publicly reachable and try again.',
    pageReadTimedOut: 'Reading the page timed out. Retry later or use basic mode.',
    pageTavilyKeyMissing: 'No Tavily API Key is configured. Paste one in "Plugins" > "Web Search" details.',
    pageReadTransportFailed: 'Could not reach the Tavily page reading service. Check your network and try again.',
    pageResponseTooLarge: 'Tavily returned too much data to parse safely. Try a more specific page.',
    pageResponseUnparsable: 'Tavily returned data that could not be parsed. Please try again later.',
    pageResponseMalformed: 'Tavily returned data in an unexpected format. Please try again later.',
    pageUnreadable: 'Tavily could not read this page. Confirm the page is publicly reachable and try again.',
    pageNoContent: 'This page has no readable body content',
    pageFetchFailed: 'Failed to read the page content. Please try again later.',
    resultNote: 'Found {count} results via {provider}',
    searchFailed: 'Search failed: {detail}',
  },
  ja: {
    cindyUnavailable: 'Cindy AI 検索は一時的に利用できません。しばらくしてから再試行してください。',
    httpError: '{provider} が HTTP {status} を返しました: {body}',
    nativeOptionsInvalid: '{options} は対応する検索元と宣言された型のネイティブパラメータにのみ使用できます。クエリ、件数、送信先、認証情報は上書きできません。',
    nativeResponseInvalid: '{provider} の検索結果の形式が無効か、ホストによって切り詰められました。上流の応答を確認して再試行してください。',
    resultPreviewSaved: 'プレビューのみ表示しています。完全な結果はsaved_toのファイルを必要に応じて読み取ってください。このツールの再実行は不要です。',
    resultSaveFailed: '検索は完了しましたが、完全な結果ファイルを保存できませんでした。タスクの書き込み権限と作業ディレクトリの対応状況を確認してから、再検索するか判断してください。',
    pageResultSaveFailed: 'ページの取得は完了しましたが、完全な本文ファイルを保存できませんでした。タスクの書き込み権限と作業ディレクトリの対応状況を確認してから、再取得するか判断してください。',
    deepSeek_NOT_CONFIGURED: '「プラグイン」→「Web Search」の詳細画面で DeepSeek API キーを設定してください。',
    deepSeek_AUTH_REJECTED: 'DeepSeek API キーが無効です。「プラグイン」→「Web Search」の詳細画面でキーを更新してください。',
    deepSeek_PERMISSION_DENIED: 'DeepSeek 検索リクエストが承認されていません。Cindy の認可と DeepSeek アカウントの API 権限を確認してください。',
    deepSeek_QUOTA_EXHAUSTED: 'DeepSeek アカウントの残高が不足しています。チャージしてから再度検索してください。',
    deepSeek_RATE_LIMITED: 'DeepSeek 検索リクエストが多すぎます。しばらくしてから再試行してください（1 アカウントあたり毎秒最大 5 回）。',
    deepSeek_INVALID_INPUT: 'DeepSeek 検索パラメータが無効です。1～128 文字（Unicode 文字単位）のクエリで再試行してください。',
    deepSeek_INVALID_OPTIONS: 'deepseek_options は DeepSeek 専用です。need_content（真偽値）、ori_question（Unicode 1～128 文字）、localization（IP アドレス文字列）を指定できます。クエリ、件数、認証情報は上書きできません。',
    deepSeek_UPSTREAM_UNAVAILABLE: 'DeepSeek 検索サービスは一時的に利用できません。ネットワーク接続を確認し、しばらくしてから再試行してください。',
    deepSeek_UPSTREAM_REJECTED: 'DeepSeek が検索リクエストを受け付けませんでした。アカウントの権限を確認するか、Web Search プラグインを更新してから再試行してください。',
    deepSeek_RESPONSE_INVALID: 'DeepSeek の検索結果の形式が無効か、ホストによって切り詰められました。上流の応答を確認して再試行してください。',
    deepSeekFallback: 'DeepSeek 検索リクエストが完了しませんでした。ネットワーク接続と Cindy の認可を確認し、「プラグイン」→「Web Search」の詳細画面に有効な DeepSeek API キーが設定されていることを確認してください。',
    queryEmpty: 'query は空にできません',
    queryTooLong: 'query が長すぎます（上限 2000 文字）',
    providerUnsupported: 'provider は cindy / brave / tavily / deepseek のみ対応しています',
    prefsUnavailable: '検索設定を読み込めませんでした。しばらくしてから再試行するか、検索元を明示的に指定してください。',
    unknownTool: '不明なツール: {tool}',
    pageUrlInvalid: 'url は 2048 文字以内の公開 HTTP(S) 絶対アドレスで、認証情報を含まない形式で指定してください',
    pageConfirmRequired: '送信前にユーザーへ明示的な確認を求めてください:その URL は公開ページであり、パスとクエリにセッション、リセット、署名、webhook の認証情報を含まず、完全な URL を Tavily へ送信してよいことの確認です。確認後に confirm_public_url:true を指定して再試行してください',
    pageDepthUnsupported: 'extract_depth は basic / advanced のみ対応しています',
    pageTavilyKeyRejected: 'Tavily API キーが無効または未設定です。メイン画面サイドバーの「プラグイン」→「Web Search」詳細画面でキーを確認してください',
    pageTavilyPermissionDenied: 'Tavily が本文の読み取りリクエストを拒否しました。API キーの権限とアカウント状態を確認してください',
    pageTavilyRateLimited: 'Tavily へのリクエストが多すぎます。制限が解除されるまで待ってから再試行してください',
    pageTavilyQuotaExhausted: 'Tavily の残高が不足しているか、アカウントが利用できません。Tavily コンソールで残高とアカウント状態を確認してください',
    pageTavilyUnavailable: 'Tavily の本文読み取りサービスは一時的に利用できません。しばらくしてから再試行してください',
    pageTavilyRejected: 'Tavily はこのページを処理できませんでした。URL が公開アクセス可能か確認して再試行してください',
    pageReadTimedOut: 'ページ本文の読み取りがタイムアウトしました。しばらくしてから再試行するか、basic モードを使用してください',
    pageTavilyKeyMissing: 'Tavily API キーが未設定です。メイン画面サイドバーの「プラグイン」→「Web Search」詳細画面でキーを入力してください',
    pageReadTransportFailed: 'Tavily の本文読み取りサービスに接続できません。ネットワークを確認して再試行してください',
    pageResponseTooLarge: 'Tavily の応答が大きすぎて安全に解析できません。より具体的なページを指定してください',
    pageResponseUnparsable: 'Tavily が解析できないデータを返しました。しばらくしてから再試行してください',
    pageResponseMalformed: 'Tavily の応答データの形式が異常です。しばらくしてから再試行してください',
    pageUnreadable: 'Tavily はこのページを読み取れませんでした。ページが公開アクセス可能か確認して再試行してください',
    pageNoContent: 'このページには読み取れる本文がありません',
    pageFetchFailed: 'ページ本文の読み取りに失敗しました。しばらくしてから再試行してください',
    resultNote: '{provider} で {count} 件の結果が見つかりました',
    searchFailed: '検索に失敗しました: {detail}',
  },
  ko: {
    cindyUnavailable: 'Cindy AI 검색을 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도하세요.',
    httpError: '{provider}이(가) HTTP {status} 응답을 반환했습니다: {body}',
    nativeOptionsInvalid: '{options}는 해당 검색 공급자와 선언된 기본 매개변수 형식에만 사용할 수 있습니다. 검색어, 결과 수, 요청 주소, 자격 증명은 덮어쓸 수 없습니다.',
    nativeResponseInvalid: '{provider} 검색 결과 형식이 잘못되었거나 호스트에서 잘렸습니다. 상위 서비스 응답을 확인하고 다시 시도하세요.',
    resultPreviewSaved: '미리보기만 표시합니다. 필요할 때 saved_to의 전체 결과 파일을 읽으세요. 이 도구를 다시 호출할 필요가 없습니다.',
    resultSaveFailed: '검색은 완료되었지만 전체 결과 파일을 저장하지 못했습니다. 작업 파일 쓰기 권한과 작업 디렉터리 지원 여부를 확인한 후 다시 검색할지 결정하세요.',
    pageResultSaveFailed: '페이지 읽기는 완료되었지만 전체 본문 파일을 저장하지 못했습니다. 작업 파일 쓰기 권한과 작업 디렉터리 지원 여부를 확인한 후 다시 읽을지 결정하세요.',
    deepSeek_NOT_CONFIGURED: '"플러그인" → "Web Search" 상세 화면에서 DeepSeek API 키를 설정하세요.',
    deepSeek_AUTH_REJECTED: 'DeepSeek API 키가 유효하지 않습니다. "플러그인" → "Web Search" 상세 화면에서 키를 업데이트하세요.',
    deepSeek_PERMISSION_DENIED: 'DeepSeek 검색 요청이 승인되지 않았습니다. Cindy 권한과 DeepSeek 계정의 API 권한을 확인하세요.',
    deepSeek_QUOTA_EXHAUSTED: 'DeepSeek 계정 잔액이 부족합니다. 충전한 후 다시 검색하세요.',
    deepSeek_RATE_LIMITED: 'DeepSeek 검색 요청이 너무 많습니다. 잠시 후 다시 시도하세요(계정당 초당 최대 5회).',
    deepSeek_INVALID_INPUT: 'DeepSeek 검색 매개변수가 잘못되었습니다. Unicode 문자 기준 1~128자의 검색어로 다시 시도하세요.',
    deepSeek_INVALID_OPTIONS: 'deepseek_options는 DeepSeek 전용입니다. need_content(불리언), ori_question(Unicode 1~128자), localization(IP 주소 문자열)을 지원하며 검색어, 결과 수, 자격 증명은 덮어쓸 수 없습니다.',
    deepSeek_UPSTREAM_UNAVAILABLE: 'DeepSeek 검색 서비스를 일시적으로 사용할 수 없습니다. 네트워크 연결을 확인한 후 잠시 후 다시 시도하세요.',
    deepSeek_UPSTREAM_REJECTED: 'DeepSeek이 검색 요청을 받아들이지 않았습니다. 계정 권한을 확인하거나 Web Search 플러그인을 업데이트한 후 다시 시도하세요.',
    deepSeek_RESPONSE_INVALID: 'DeepSeek 검색 결과 형식이 잘못되었거나 호스트에서 잘렸습니다. 상위 서비스 응답을 확인하고 다시 시도하세요.',
    deepSeekFallback: 'DeepSeek 검색 요청이 완료되지 않았습니다. 네트워크 연결과 Cindy 권한을 확인하고 "플러그인" → "Web Search" 상세 화면에 유효한 DeepSeek API 키가 설정되어 있는지 확인하세요.',
    queryEmpty: 'query는 비워 둘 수 없습니다',
    queryTooLong: 'query가 너무 깁니다(최대 2000자)',
    providerUnsupported: 'provider는 cindy / brave / tavily / deepseek만 지원합니다',
    prefsUnavailable: '검색 설정을 읽지 못했습니다. 잠시 후 다시 시도하거나 검색 공급자를 직접 지정하세요.',
    unknownTool: '알 수 없는 도구: {tool}',
    pageUrlInvalid: 'url은 2048자 이하의 공개 HTTP(S) 절대 주소여야 하며 자격 증명을 포함할 수 없습니다',
    pageConfirmRequired: '전송 전에 사용자에게 명시적으로 확인을 받으세요: 해당 URL은 공개 페이지이고, 전체 경로와 쿼리에 세션, 재설정, 서명, webhook 자격 증명이 없으며 전체 URL을 Tavily로 보내도 된다는 확인입니다. 확인 후 confirm_public_url:true로 다시 시도하세요',
    pageDepthUnsupported: 'extract_depth는 basic / advanced만 지원합니다',
    pageTavilyKeyRejected: 'Tavily API 키가 유효하지 않거나 설정되지 않았습니다. 기본 화면 사이드바의 "플러그인" → "Web Search" 상세 화면에서 키를 확인하세요',
    pageTavilyPermissionDenied: 'Tavily가 페이지 읽기 요청을 거부했습니다. API 키 권한과 계정 상태를 확인하세요',
    pageTavilyRateLimited: 'Tavily 요청이 너무 많습니다. 요청 제한이 해제될 때까지 기다린 후 다시 시도하세요',
    pageTavilyQuotaExhausted: 'Tavily 크레딧이 부족하거나 계정을 사용할 수 없습니다. Tavily 콘솔에서 크레딧과 계정 상태를 확인하세요',
    pageTavilyUnavailable: 'Tavily 페이지 읽기 서비스를 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도하세요',
    pageTavilyRejected: 'Tavily가 이 페이지를 처리하지 못했습니다. URL이 공개적으로 접근 가능한지 확인하고 다시 시도하세요',
    pageReadTimedOut: '페이지 본문 읽기 시간이 초과되었습니다. 잠시 후 다시 시도하거나 basic 모드를 사용하세요',
    pageTavilyKeyMissing: 'Tavily API 키가 설정되지 않았습니다. 기본 화면 사이드바의 "플러그인" → "Web Search" 상세 화면에 키를 입력하세요',
    pageReadTransportFailed: 'Tavily 페이지 읽기 서비스에 연결할 수 없습니다. 네트워크를 확인하고 다시 시도하세요',
    pageResponseTooLarge: 'Tavily가 반환한 데이터가 너무 커서 안전하게 분석할 수 없습니다. 더 구체적인 페이지를 지정하세요',
    pageResponseUnparsable: 'Tavily가 분석할 수 없는 데이터를 반환했습니다. 잠시 후 다시 시도하세요',
    pageResponseMalformed: 'Tavily 응답 데이터의 형식이 비정상입니다. 잠시 후 다시 시도하세요',
    pageUnreadable: 'Tavily가 이 페이지를 읽지 못했습니다. 페이지가 공개적으로 접근 가능한지 확인하고 다시 시도하세요',
    pageNoContent: '이 페이지에는 읽을 수 있는 본문이 없습니다',
    pageFetchFailed: '페이지 본문을 읽지 못했습니다. 잠시 후 다시 시도하세요',
    resultNote: '{provider}에서 검색 결과 {count}개를 찾았습니다',
    searchFailed: '검색 실패: {detail}',
  },
};

var hasOwn = Object.prototype.hasOwnProperty;
/* null = 尚未从宿主拿到语言;此时按英文回退,下次调用再取。 */
var hostLocale = null;
var localeRequest = null;

function resolveLocale(value) {
  return typeof value === 'string' && hasOwn.call(MESSAGES, value) ? value : 'en';
}

async function requestHostLocale() {
  if (typeof cindy.request !== 'function') return null;
  var timer = null;
  try {
    // 宿主不回应时不能卡住搜索:3 秒取不到就按英文,下次调用再试。
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

/* 并发的 tool-call 共享同一个请求;成功后缓存,之后靠 host-context-changed 更新。 */
function ensureLocale() {
  if (hostLocale) return Promise.resolve(hostLocale);
  if (!localeRequest) {
    localeRequest = requestHostLocale().then(function (locale) {
      localeRequest = null;
      // 请求途中若已收到 host-context-changed,以事件里的新语言为准。
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

function clampLimit(n, max, min) {
  var v = typeof n === 'number' && isFinite(n) ? Math.floor(n) : 10;
  return Math.min(max, Math.max(min === undefined ? 1 : min, v));
}

function isByoProvider(value) {
  return value === 'brave' || value === 'tavily' || value === 'deepseek';
}

function validSearchOptions(options, allowed) {
  if (options === undefined) return true;
  if (!options || typeof options !== 'object' || Array.isArray(options)) return false;
  return Object.keys(options).every(function (key) {
    if (!hasOwn.call(allowed, key)) return false;
    var rule = allowed[key];
    var value = options[key];
    if (typeof rule === 'object') return value !== undefined && validSearchOptions(value, rule);
    return rule.split('|').some(function (type) {
      if (type === 'null') return value === null;
      if (type === 'string[]') {
        return Array.isArray(value) && value.every(function (item) { return typeof item === 'string'; });
      }
      return typeof value === type && (type !== 'number' || isFinite(value));
    });
  });
}

function nativeOptionsFailure(name) {
  return { ok: false, errorCode: 'INVALID_PARAMS', message: t('nativeOptionsInvalid', { options: name }) };
}

function parseSearchResponse(response) {
  if (response.truncated || typeof response.body !== 'string') return null;
  try {
    var data = JSON.parse(response.body);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch (e) {
    return null;
  }
}

function nativeResponseFailure(provider) {
  return { ok: false, errorCode: 'RESPONSE_INVALID', message: t('nativeResponseInvalid', { provider: provider }) };
}

async function readSearchPrefs() {
  var prefs = {
    cindyAiEnabled: true,
    byoDefaultProvider: 'brave',
  };
  var response = await fetch('/kv');
  if (!response.ok) throw new Error('search preferences read failed');
  var kv = await response.json();
  if (!kv || typeof kv !== 'object' || Array.isArray(kv)) {
    throw new Error('search preferences invalid');
  }
  if (typeof kv.cindyAiEnabled === 'boolean') prefs.cindyAiEnabled = kv.cindyAiEnabled;
  if (isByoProvider(kv.byoDefaultProvider)) {
    prefs.byoDefaultProvider = kv.byoDefaultProvider;
  }
  return prefs;
}

/** Cindy AI:主机固定搜索模型、工具与托管凭证，插件只递查询意图。 */
async function searchCindy(query, limit, callId, callerTool) {
  try {
    return await cindy.send({
      type: 'cindy-request',
      kind: 'search_web',
      query: query,
      limit: limit,
      provider: 'cindy',
      callId: callId,
      callerTool: callerTool,
    });
  } catch (e) {
    return {
      ok: false,
      errorCode: e && e.errorCode ? e.errorCode : 'INTERNAL',
      message: e && e.errorCode && typeof e.message === 'string'
        ? e.message
        : t('cindyUnavailable'),
    };
  }
}

/** Brave:GET + query 参数，Key 由主机注入 X-Subscription-Token。 */
async function searchBrave(query, limit, options) {
  var url = BRAVE_URL + '?q=' + encodeURIComponent(query) + '&count=' + limit;
  var headers = { Accept: 'application/json' };
  Object.keys(options || {}).forEach(function (key) {
    var value = options[key];
    if (key === 'headers') {
      Object.keys(value).forEach(function (name) { headers[name] = String(value[name]); });
    } else if (key === 'goggles' && Array.isArray(value)) {
      value.forEach(function (goggle) { url += '&goggles=' + encodeURIComponent(goggle); });
    } else {
      url += '&' + key + '=' + encodeURIComponent(Array.isArray(value) ? value.join(',') : String(value));
    }
  });
  var r = await cindy.fetch({ url: url, headers: headers });
  if (!r.ok) return r;
  if (r.status !== 200) {
    return { ok: false, message: t('httpError', { provider: 'Brave', status: r.status, body: r.body.slice(0, 200) }) };
  }
  var data = parseSearchResponse(r);
  if (!data || (data.web != null && (!data.web || !Array.isArray(data.web.results)))) {
    return nativeResponseFailure('Brave');
  }
  var items = data.web ? data.web.results : [];
  if (items.some(function (item) {
    return !item || typeof item.title !== 'string' || typeof item.url !== 'string';
  })) return nativeResponseFailure('Brave');
  // Lift web results once; keep other result types and pagination metadata intact.
  if (data.web) delete data.web.results;
  return {
    ok: true,
    provider: 'brave',
    results: items.map(function (item) {
      item.snippet = item.description || '';
      return item;
    }),
    metadata: data,
  };
}

/** Tavily BYO:POST JSON，Key 由主机注入 Authorization:Bearer。 */
async function searchTavily(query, limit, options) {
  var body = {
    query: query, max_results: limit,
    include_answer: false, include_raw_content: false, include_images: false,
  };
  if (!options || !options.auto_parameters) body.search_depth = 'basic';
  Object.keys(options || {}).forEach(function (key) { body[key] = options[key]; });
  var r = await cindy.fetch({
    url: TAVILY_URL,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) return r;
  if (r.status !== 200) {
    return { ok: false, message: t('httpError', { provider: 'Tavily', status: r.status, body: r.body.slice(0, 200) }) };
  }
  var data = parseSearchResponse(r);
  if (!data || !Array.isArray(data.results) || data.results.some(function (item) {
    return !item || typeof item.title !== 'string' || typeof item.url !== 'string';
  })) return nativeResponseFailure('Tavily');
  var items = data.results;
  delete data.results;
  return {
    ok: true,
    provider: 'tavily',
    results: items.map(function (item) {
      item.snippet = item.content || '';
      return item;
    }),
    metadata: data,
  };
}

function deepSeekFailure(errorCode) {
  var code = typeof errorCode === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(errorCode)
    ? errorCode : 'INTERNAL';
  var key = 'deepSeek_' + code;
  return {
    ok: false,
    errorCode: code,
    message: hasOwn.call(MESSAGES.en, key) ? t(key) : t('deepSeekFallback'),
  };
}

/** Independent Search API; the Host alone injects the Bearer credential. */
async function searchDeepSeek(query, limit, callId, options) {
  // Count Unicode code points, not UTF-16 units (e.g. emoji count as one).
  if (Array.from(query).length > 128) return deepSeekFailure('INVALID_INPUT');
  if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some(function (key) {
      return key !== 'need_content' && key !== 'ori_question' && key !== 'localization';
    })
    || (options.need_content !== undefined && typeof options.need_content !== 'boolean')
    || (options.ori_question != null && (typeof options.ori_question !== 'string'
      || !options.ori_question.trim() || Array.from(options.ori_question).length > 128))
    || (options.localization !== undefined && typeof options.localization !== 'string'))) {
    return { ok: false, errorCode: 'INVALID_PARAMS', message: t('deepSeek_INVALID_OPTIONS') };
  }
  var body = { query: query, count: limit, need_content: false };
  Object.keys(options || {}).forEach(function (key) { body[key] = options[key]; });
  var r;
  try {
    r = await cindy.fetch({
      url: DEEPSEEK_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      callId: callId,
    });
  } catch (e) {
    return deepSeekFailure(e && e.errorCode);
  }
  if (!r || !r.ok) return deepSeekFailure(r && r.errorCode);
  if (r.status !== 200) {
    var codes = {
      400: 'INVALID_INPUT',
      401: 'AUTH_REJECTED',
      402: 'QUOTA_EXHAUSTED',
      403: 'PERMISSION_DENIED',
      408: 'UPSTREAM_UNAVAILABLE',
      413: 'INVALID_INPUT',
      429: 'RATE_LIMITED',
    };
    return deepSeekFailure(codes[r.status] || (r.status >= 500 && r.status <= 599
      ? 'UPSTREAM_UNAVAILABLE' : 'UPSTREAM_REJECTED'));
  }
  // A host-truncated response is incomplete; never return it as a complete result.
  if (r.truncated || typeof r.body !== 'string') {
    return deepSeekFailure('RESPONSE_INVALID');
  }
  var data;
  try {
    data = JSON.parse(r.body);
  } catch (e) {
    return deepSeekFailure('RESPONSE_INVALID');
  }
  if (!data || !Array.isArray(data.results) || data.results.some(function (item) {
    return !item || typeof item.title !== 'string' || typeof item.url !== 'string'
      || typeof item.snippet !== 'string' || typeof item.summary !== 'string';
  })) return deepSeekFailure('RESPONSE_INVALID');
  return {
    ok: true,
    provider: 'deepseek',
    results: data.results,
  };
}

function searchByo(provider, query, limit, callId, args) {
  if (provider === 'deepseek') return searchDeepSeek(query, limit, callId, args.deepseek_options);
  if (provider === 'tavily') return searchTavily(query, limit, args.tavily_options);
  return searchBrave(query, limit, args.brave_options);
}

/** fetch_page: 只读取经用户明确确认的单个公开页面，先做主机侧可达性判断。 */
function isClearlyNonPublicHostname(hostname) {
  var host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || /\.(localhost|local|internal)$/.test(host)) return true;

  var ipv4 = host.split('.');
  if (ipv4.length === 4 && ipv4.every(function (part) { return /^\d{1,3}$/.test(part); })) {
    var octets = ipv4.map(Number);
    if (octets.some(function (part) { return part > 255; })) return true;
    var a = octets[0];
    var b = octets[1];
    var c = octets[2];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && ((b === 0 && (c === 0 || c === 2)) || b === 168)) return true;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return true;
    if (a === 203 && b === 0 && c === 113) return true;
  }

  if (host.indexOf(':') !== -1) {
    if (host === '::' || host === '::1' || host.indexOf('::ffff:') === 0) return true;
    if (/^(fc|fd|fe[89ab]|ff)/.test(host) || host.indexOf('2001:db8:') === 0) return true;
  }
  return false;
}

function parsePublicPageUrl(value) {
  if (typeof value !== 'string' || !value || value.length > FETCH_PAGE_MAX_URL_CHARS) return null;
  if (value !== value.trim() || value.indexOf('\\') !== -1) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    var parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password || !parsed.hostname) return null;
    if (isClearlyNonPublicHostname(parsed.hostname)) return null;
    // Fragments are browser-local and are never part of the HTTP resource.
    parsed.hash = '';
    return parsed.href;
  } catch (e) {
    return null;
  }
}

function tavilyHttpError(status) {
  if (status === 401) return t('pageTavilyKeyRejected');
  if (status === 403) return t('pageTavilyPermissionDenied');
  if (status === 429) return t('pageTavilyRateLimited');
  if (status === 432 || status === 433) return t('pageTavilyQuotaExhausted');
  if (status >= 500) return t('pageTavilyUnavailable');
  return t('pageTavilyRejected');
}

function tavilyTransportError(message) {
  var text = typeof message === 'string' ? message : '';
  if (/\u8d85\u65f6|timeout|abort/i.test(text)) return t('pageReadTimedOut');
  if (/\u51ed\u8bc1|secret|api\s*key|\u672a\u914d\u7f6e|not configured/i.test(text)) return t('pageTavilyKeyMissing');
  return t('pageReadTransportFailed');
}

/** Tavily Extract:单 URL 正文读取，Key 仍由主机注入 Authorization:Bearer。 */
async function fetchPage(args, callId) {
  var requestedUrl = parsePublicPageUrl(args && args.url);
  if (!requestedUrl) {
    return { ok: false, message: t('pageUrlInvalid') };
  }
  if (!args || args.confirm_public_url !== true) {
    return {
      ok: false,
      message: t('pageConfirmRequired'),
    };
  }
  var depth = args && args.extract_depth === 'advanced' ? 'advanced' : 'basic';
  if (args && args.extract_depth !== undefined && args.extract_depth !== 'basic' && args.extract_depth !== 'advanced') {
    return { ok: false, message: t('pageDepthUnsupported') };
  }

  var r;
  try {
    r = await cindy.fetch({
      url: TAVILY_EXTRACT_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        urls: requestedUrl,
        extract_depth: depth,
        include_images: false,
        include_favicon: false,
        format: 'markdown',
        timeout: depth === 'advanced' ? 45 : 20,
      }),
      timeoutMs: FETCH_PAGE_HOST_TIMEOUT_MS,
      callId: callId,
    });
  } catch (e) {
    return { ok: false, message: tavilyTransportError(e && e.message) };
  }
  if (!r.ok) return { ok: false, message: tavilyTransportError(r.message) };
  if (r.status !== 200) return { ok: false, message: tavilyHttpError(r.status) };
  if (r.truncated) return { ok: false, message: t('pageResponseTooLarge') };
  if (typeof r.body !== 'string') {
    return { ok: false, message: t('pageResponseMalformed') };
  }

  var data;
  try {
    data = JSON.parse(r.body);
  } catch (e) {
    return { ok: false, message: t('pageResponseUnparsable') };
  }
  if (!data || !Array.isArray(data.results) || !Array.isArray(data.failed_results)) {
    return { ok: false, message: t('pageResponseMalformed') };
  }
  if (data.results.length !== 1) {
    if (data.results.length === 0 && data.failed_results.length > 0) {
      return { ok: false, message: t('pageUnreadable') };
    }
    return { ok: false, message: t('pageResponseMalformed') };
  }

  var item = data.results[0];
  var resultUrl = parsePublicPageUrl(item && item.url);
  if (!resultUrl || typeof item.raw_content !== 'string') {
    return { ok: false, message: t('pageResponseMalformed') };
  }
  var content = item.raw_content;
  if (!content.trim()) return { ok: false, message: t('pageNoContent') };
  var contentChars = content.length;
  return {
    ok: true,
    provider: 'tavily',
    url: resultUrl,
    content: content,
    format: 'markdown',
    extract_depth: depth,
    content_chars: contentChars,
    truncated: false,
  };
}

async function searchWeb(args, callId, callerTool) {
  var query = args && typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) return { ok: false, message: t('queryEmpty') };
  var provider = args && args.provider;

  if (provider !== undefined && provider !== 'cindy' && !isByoProvider(provider)) {
    return { ok: false, message: t('providerUnsupported') };
  }
  if (provider === undefined) {
    var prefs;
    try {
      prefs = await readSearchPrefs();
    } catch (e) {
      return { ok: false, message: t('prefsUnavailable') };
    }
    provider = prefs.cindyAiEnabled ? 'cindy' : prefs.byoDefaultProvider;
  }
  if (provider === 'cindy' && query.length > 2000) return { ok: false, message: t('queryTooLong') };
  if (args.deepseek_options !== undefined && provider !== 'deepseek') {
    return { ok: false, errorCode: 'INVALID_PARAMS', message: t('deepSeek_INVALID_OPTIONS') };
  }
  if (args.brave_options !== undefined && (provider !== 'brave'
    || !validSearchOptions(args.brave_options, BRAVE_SEARCH_OPTIONS))) {
    return nativeOptionsFailure('brave_options');
  }
  if (args.tavily_options !== undefined && (provider !== 'tavily'
    || !validSearchOptions(args.tavily_options, TAVILY_SEARCH_OPTIONS))) {
    return nativeOptionsFailure('tavily_options');
  }
  var limit = clampLimit(args.limit, provider === 'deepseek' ? 50 : provider === 'cindy' ? Infinity : 20,
    provider === 'tavily' ? 0 : 1);
  if (provider === 'cindy') return searchCindy(query, limit, callId, callerTool);
  return searchByo(provider, query, limit, callId, args);
}

async function writeResultFile(path, text, callId) {
  var saved = await cindy.send({
    type: 'fs-request', op: 'write', root: 'workdir',
    path: path, content: text, callId: callId,
  });
  return saved && saved.ok ? saved : null;
}

async function saveToolResult(text, callId) {
  try {
    var random = new Uint8Array(16);
    crypto.getRandomValues(random);
    var name = Array.from(random).map(function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
    var base = 'web-search/result-' + name;
    var bytes = new TextEncoder().encode(text).length;
    if (bytes <= RESULT_FILE_MAX_BYTES) {
      var single = await writeResultFile(base + '.json', text, callId);
      return single ? { path: single.path, format: 'json', bytes: bytes } : null;
    }
    var parts = [];
    for (var start = 0; start < text.length;) {
      var end = Math.min(start + RESULT_FILE_CHUNK_CHARS, text.length);
      // Splitting a surrogate pair would corrupt the UTF-8 written by the Host.
      if (end < text.length && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff
        && text.charCodeAt(end) >= 0xdc00 && text.charCodeAt(end) <= 0xdfff) end--;
      var part = await writeResultFile(base + '-part-' + String(parts.length + 1).padStart(4, '0') + '.txt',
        text.slice(start, end), callId);
      if (!part) return null;
      parts.push({ path: part.path, bytes: part.bytes });
      start = end;
    }
    // Publish the ordered index only after every part is successfully saved.
    var index = await writeResultFile(base + '.json', JSON.stringify({
      format: 'json-chunks', encoding: 'utf-8', bytes: bytes, parts: parts,
    }), callId);
    return index ? { path: index.path, format: 'json-chunks', bytes: bytes } : null;
  } catch (e) {
    return null;
  }
}

async function agentToolResult(result, callId, tool) {
  var isPage = tool === 'fetch_page';
  var full = isPage ? {
    provider: result.provider, url: result.url, content: result.content, format: result.format,
    extract_depth: result.extract_depth, content_chars: result.content_chars,
    truncated: false, content_is_untrusted: true, preview: false,
  } : {
    provider: result.provider, results: result.results, metadata: result.metadata,
    note: t('resultNote', { provider: result.provider, count: result.results.length }),
    preview: false, content_is_untrusted: true,
  };
  var message = { type: 'tool-result', callId: callId, ok: true, result: full };
  if ((isPage || full.results.length <= SEARCH_PREVIEW_RESULTS) && JSON.stringify(message).length <= TOOL_RESULT_MAX_CHARS) {
    return message;
  }
  var saved = await saveToolResult(JSON.stringify(full), callId);
  if (!saved) {
    return { type: 'tool-result', callId: callId, ok: false, errorCode: 'RESULT_SAVE_FAILED',
      message: t(isPage ? 'pageResultSaveFailed' : 'resultSaveFailed') };
  }
  message.result = isPage ? Object.assign({}, full, {
    content: full.content.slice(0, PAGE_PREVIEW_CONTENT_CHARS), truncated: true,
  }) : {
    provider: full.provider, total_results: full.results.length,
    results: full.results.slice(0, SEARCH_PREVIEW_RESULTS).map(function (item, index) {
      var preview = { index: index, title: item.title, url: item.url,
        snippet: typeof item.snippet === 'string' ? item.snippet.slice(0, SEARCH_PREVIEW_SNIPPET_CHARS) : '' };
      ['date', 'published_date', 'site_name', 'rerank_score', 'authority', 'score'].forEach(function (key) {
        if (hasOwn.call(item, key)) preview[key] = item[key];
      });
      return preview;
    }),
    content_is_untrusted: true,
  };
  message.result.preview = true;
  message.result.complete_saved = true;
  message.result.saved_to = saved.path;
  message.result.saved_format = saved.format;
  message.result.saved_bytes = saved.bytes;
  message.result.note = (full.note ? full.note + '\n' : '') + t('resultPreviewSaved');
  // Count the whole wire reply, including metadata, file references and notes.
  if (isPage) {
    while (message.result.content.length && JSON.stringify(message).length > TOOL_RESULT_MAX_CHARS) {
      message.result.content = message.result.content.slice(0, Math.floor(message.result.content.length / 2));
    }
  } else {
    while (message.result.results.length && JSON.stringify(message).length > TOOL_RESULT_MAX_CHARS) {
      message.result.results.pop();
    }
  }
  return message;
}

cindy.onHostMessage(async function (msg) {
  if (!msg) return;
  if (msg.type === 'host-context-changed') {
    hostLocale = resolveLocale(msg.context && msg.context.locale);
    return;
  }
  if (msg.type !== 'tool-call') return;
  await ensureLocale();
  if (msg.tool !== 'search_web' && msg.tool !== 'fetch_page') {
    cindy.send({ type: 'tool-result', callId: msg.callId, ok: false, message: t('unknownTool', { tool: msg.tool }) });
    return;
  }
  try {
    var r =
      msg.tool === 'fetch_page'
        ? await fetchPage(msg.args || {}, msg.callId)
        : await searchWeb(msg.args || {}, msg.callId, msg.tool);
    if (r.ok) {
      await cindy.send(await agentToolResult(r, msg.callId, msg.tool));
    } else {
      cindy.send({
        type: 'tool-result',
        callId: msg.callId,
        ok: false,
        errorCode: r.errorCode,
        message: r.message,
      });
    }
  } catch (err) {
    cindy.send({
      type: 'tool-result',
      callId: msg.callId,
      ok: false,
      errorCode: err && err.errorCode ? err.errorCode : 'INTERNAL',
      message:
        msg.tool === 'fetch_page'
          ? t('pageFetchFailed')
          : t('searchFailed', { detail: err && err.message ? err.message : String(err) }),
    });
  }
});
