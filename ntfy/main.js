/**
 * ntfy plugin: publishes push notifications to user-configured ntfy servers.
 *
 * - Servers come from the host's `network.connections` slot `ntfy_conn`. The user
 *   adds "server host + access token" in settings.html; the host encrypts the token
 *   and injects `Authorization: Bearer <token>` only into requests whose URL matches
 *   that connection. This file never sees, stores or returns a token.
 * - The per-server default topic is a non-secret preference kept in the plugin KV
 *   (`/kv` -> `{ defaultTopics: { <connectionId>: "<topic>" } }`).
 * - Publishing uses ntfy's JSON API (POST to the server root with a JSON body), not
 *   the X-Title/X-Tags headers: HTTP headers must be ASCII, so accented titles would
 *   arrive mangled.
 * - A send is never retried. When the request may have reached the server (timeout,
 *   network failure, any host-reported fetch failure, HTTP 5xx, unexpected status)
 *   the result says the outcome is unknown so the agent asks the user instead of
 *   sending a duplicate.
 */

/* global cindy */

var CONNECTION_KEY = 'ntfy_conn';
var MAX_MESSAGE_BYTES = 4096;
var REQUEST_TIMEOUT_MS = 20000;
var TOPIC_RE = /^[-_A-Za-z0-9]{1,64}$/;
var PRIORITY_NAMES = { min: 1, low: 2, default: 3, high: 4, urgent: 5 };

/*
 * Runtime copy follows the host language only (cindy.request app-context and
 * host-context-changed), never the browser or OS language. An unknown or
 * unavailable host language falls back to English. errorCode values, tool and
 * argument names are stable protocol and stay untranslated; only message and
 * note text is localized.
 */
var MESSAGES = {
  en: {
    settingsUnavailable: 'Could not read the configured ntfy servers. Ask the user to reopen the ntfy plugin settings and try again.',
    notConfigured: 'No ntfy server is configured. Ask the user to add one (server URL and access token) in the ntfy plugin settings.',
    serverNotString: 'server must be a string: a server id or host from ntfy_servers.',
    serverNotFound: 'No configured ntfy server matches "{server}". Configured servers: {servers}.',
    ambiguousServer: 'Several ntfy servers are configured ({servers}). Ask the user which one to use and pass it as server.',
    messageRequired: 'message is required and must be non-empty text.',
    messageTooLarge: 'message is {size} bytes; ntfy accepts at most {max} UTF-8 bytes. Shorten it (nothing was sent and nothing was truncated).',
    invalidTopic: 'Invalid topic "{topic}". ntfy topics use only letters, digits, - and _, 1 to 64 characters.',
    titleNotText: 'title must be text.',
    invalidPriority: 'Invalid priority "{priority}". Use 1-5 or one of min, low, default, high, urgent.',
    tagsNotArray: 'tags must be an array of strings.',
    tagsNotStrings: 'tags must be an array of non-empty strings.',
    clickNotHttps: 'click must be an absolute https:// URL.',
    markdownNotBoolean: 'markdown must be true or false.',
    unknownOutcome: 'Outcome unknown: {reason}. The request may have reached {host} and the notification may already have been delivered to topic "{topic}". Do not resend automatically; ask the user to check the topic in their ntfy app before sending again.',
    reasonServerError: '{host} returned a server error (HTTP {status})',
    reasonUnexpectedStatus: '{host} answered with unexpected HTTP status {status}',
    reasonRequestFailed: 'the request failed ({detail})',
    reasonNoResponse: 'no response from {host} ({detail})',
    noDetails: 'no details',
    timeoutOrNetwork: 'timeout or network error',
    withServerDetail: '{message} Server said: {detail}',
    unauthorized: 'Not sent: {host} rejected the access token (HTTP 401). The token is missing, invalid or expired; ask the user to replace it in the ntfy plugin settings.',
    forbidden: 'Not sent: the access token has no write permission on topic "{topic}" at {host} (HTTP 403). Ask the user to grant write access to this topic (ntfy access control) or use another topic.',
    notFound: 'Not sent: {host} answered HTTP 404. Check that it is an ntfy server served at the root of the domain.',
    tooLarge: 'Not sent: {host} rejected the notification as too large (HTTP 413). Shorten the message.',
    rateLimited: 'Not sent: {host} is rate limiting requests (HTTP 429). Wait before sending again and do not retry in a loop.',
    rejected: 'Not sent: {host} rejected the notification (HTTP {status}).',
    noTopic: 'No topic given and {host} has no default topic. Pass topic, or ask the user to set a default topic in the ntfy plugin settings.',
    noMessageId: 'ntfy accepted the notification (HTTP {status}) but did not return a message id.',
    unknownTool: 'Unknown tool: {tool}',
    internalAfterDispatch: 'Outcome unknown: an internal error happened after the request was handed to the network. Do not resend automatically; ask the user to check their ntfy app first.',
    internal: 'Internal error in the ntfy plugin; nothing was sent.',
  },
  'zh-CN': {
    settingsUnavailable: '无法读取已配置的 ntfy 服务器。请让用户重新打开 ntfy 插件设置后再试。',
    notConfigured: '尚未配置 ntfy 服务器。请让用户在 ntfy 插件设置中添加一个（服务器地址和访问令牌）。',
    serverNotString: 'server 必须是字符串：取自 ntfy_servers 的服务器 id 或主机名。',
    serverNotFound: '没有与“{server}”匹配的已配置 ntfy 服务器。已配置的服务器：{servers}。',
    ambiguousServer: '已配置多个 ntfy 服务器（{servers}）。请询问用户要使用哪一个，并通过 server 参数传入。',
    messageRequired: 'message 为必填项，且必须是非空文本。',
    messageTooLarge: 'message 为 {size} 字节，ntfy 最多接受 {max} 个 UTF-8 字节。请缩短内容（未发送任何内容，也未做任何截断）。',
    invalidTopic: '无效的 topic“{topic}”。ntfy 主题只能包含字母、数字、- 和 _，长度为 1 到 64 个字符。',
    titleNotText: 'title 必须是文本。',
    invalidPriority: '无效的 priority“{priority}”。请使用 1-5，或 min、low、default、high、urgent 之一。',
    tagsNotArray: 'tags 必须是字符串数组。',
    tagsNotStrings: 'tags 必须是由非空字符串组成的数组。',
    clickNotHttps: 'click 必须是以 https:// 开头的绝对 URL。',
    markdownNotBoolean: 'markdown 必须是 true 或 false。',
    unknownOutcome: '结果未知：{reason}。请求可能已到达 {host}，通知可能已投递到主题“{topic}”。不要自动重新发送；请让用户先在 ntfy 应用中查看该主题，再决定是否重新发送。',
    reasonServerError: '{host} 返回服务器错误（HTTP {status}）',
    reasonUnexpectedStatus: '{host} 返回了意外的 HTTP 状态码 {status}',
    reasonRequestFailed: '请求失败（{detail}）',
    reasonNoResponse: '{host} 没有响应（{detail}）',
    noDetails: '无详细信息',
    timeoutOrNetwork: '超时或网络错误',
    withServerDetail: '{message}服务器返回：{detail}',
    unauthorized: '未发送：{host} 拒绝了访问令牌（HTTP 401）。令牌缺失、无效或已过期；请让用户在 ntfy 插件设置中更换令牌。',
    forbidden: '未发送：访问令牌在 {host} 上没有主题“{topic}”的写权限（HTTP 403）。请让用户为该主题授予写权限（ntfy 访问控制），或改用其他主题。',
    notFound: '未发送：{host} 返回 HTTP 404。请确认它是部署在域名根路径的 ntfy 服务器。',
    tooLarge: '未发送：{host} 以内容过大为由拒绝了该通知（HTTP 413）。请缩短消息。',
    rateLimited: '未发送：{host} 正在限制请求频率（HTTP 429）。请等待一段时间再发送，不要循环重试。',
    rejected: '未发送：{host} 拒绝了该通知（HTTP {status}）。',
    noTopic: '未指定 topic，且 {host} 没有默认主题。请传入 topic，或让用户在 ntfy 插件设置中设置默认主题。',
    noMessageId: 'ntfy 已接受该通知（HTTP {status}），但没有返回消息 id。',
    unknownTool: '未知工具：{tool}',
    internalAfterDispatch: '结果未知：请求交给网络之后发生了内部错误。不要自动重新发送；请让用户先在 ntfy 应用中确认。',
    internal: 'ntfy 插件内部错误；没有发送任何内容。',
  },
  ja: {
    settingsUnavailable: '設定済みの ntfy サーバーを読み込めませんでした。ntfy プラグインの設定を開き直してから再試行するよう、ユーザーに依頼してください。',
    notConfigured: 'ntfy サーバーが設定されていません。ntfy プラグインの設定でサーバー（サーバー URL とアクセストークン）を追加するよう、ユーザーに依頼してください。',
    serverNotString: 'server は文字列で指定してください：ntfy_servers のサーバー id またはホスト名です。',
    serverNotFound: '「{server}」に一致する ntfy サーバーは設定されていません。設定済みのサーバー：{servers}。',
    ambiguousServer: '複数の ntfy サーバーが設定されています（{servers}）。どれを使うかユーザーに確認し、server に指定してください。',
    messageRequired: 'message は必須で、空でないテキストである必要があります。',
    messageTooLarge: 'message は {size} バイトですが、ntfy が受け付けるのは UTF-8 で最大 {max} バイトです。短くしてください（何も送信しておらず、切り詰めもしていません）。',
    invalidTopic: 'topic「{topic}」は無効です。ntfy のトピックに使えるのは英字、数字、- と _ のみで、長さは 1～64 文字です。',
    titleNotText: 'title はテキストで指定してください。',
    invalidPriority: 'priority「{priority}」は無効です。1-5、または min、low、default、high、urgent のいずれかを指定してください。',
    tagsNotArray: 'tags は文字列の配列で指定してください。',
    tagsNotStrings: 'tags は空でない文字列の配列で指定してください。',
    clickNotHttps: 'click は https:// で始まる絶対 URL で指定してください。',
    markdownNotBoolean: 'markdown は true または false で指定してください。',
    unknownOutcome: '結果不明：{reason}。リクエストが {host} に届き、通知がすでにトピック「{topic}」に配信されている可能性があります。自動で再送しないでください。再送する前に、ntfy アプリでトピックを確認するようユーザーに依頼してください。',
    reasonServerError: '{host} がサーバーエラーを返しました（HTTP {status}）',
    reasonUnexpectedStatus: '{host} が想定外の HTTP ステータス {status} を返しました',
    reasonRequestFailed: 'リクエストが失敗しました（{detail}）',
    reasonNoResponse: '{host} から応答がありません（{detail}）',
    noDetails: '詳細なし',
    timeoutOrNetwork: 'タイムアウトまたはネットワークエラー',
    withServerDetail: '{message}サーバーの応答：{detail}',
    unauthorized: '未送信：{host} がアクセストークンを拒否しました（HTTP 401）。トークンがないか、無効か、期限切れです。ntfy プラグインの設定でトークンを差し替えるよう、ユーザーに依頼してください。',
    forbidden: '未送信：アクセストークンには {host} のトピック「{topic}」への書き込み権限がありません（HTTP 403）。このトピックへの書き込み権限を付与する（ntfy のアクセス制御）か、別のトピックを使うよう、ユーザーに依頼してください。',
    notFound: '未送信：{host} が HTTP 404 を返しました。ドメインのルートで公開されている ntfy サーバーか確認してください。',
    tooLarge: '未送信：{host} がサイズ超過のため通知を拒否しました（HTTP 413）。メッセージを短くしてください。',
    rateLimited: '未送信：{host} がリクエストをレート制限しています（HTTP 429）。時間を置いてから送信し、ループで再試行しないでください。',
    rejected: '未送信：{host} が通知を拒否しました（HTTP {status}）。',
    noTopic: 'topic が指定されておらず、{host} には既定のトピックがありません。topic を指定するか、ntfy プラグインの設定で既定のトピックを設定するようユーザーに依頼してください。',
    noMessageId: 'ntfy は通知を受け付けました（HTTP {status}）が、メッセージ id を返しませんでした。',
    unknownTool: '不明なツール：{tool}',
    internalAfterDispatch: '結果不明：リクエストをネットワークに渡した後で内部エラーが発生しました。自動で再送せず、先に ntfy アプリを確認するようユーザーに依頼してください。',
    internal: 'ntfy プラグインの内部エラーです。何も送信していません。',
  },
  ko: {
    settingsUnavailable: '설정된 ntfy 서버 목록을 읽지 못했습니다. 사용자에게 ntfy 플러그인 설정을 다시 연 뒤 다시 시도해 달라고 요청하세요.',
    notConfigured: '설정된 ntfy 서버가 없습니다. 사용자에게 ntfy 플러그인 설정에서 서버(서버 URL과 액세스 토큰)를 추가해 달라고 요청하세요.',
    serverNotString: 'server는 문자열이어야 합니다: ntfy_servers의 서버 id 또는 호스트.',
    serverNotFound: '"{server}"와(과) 일치하는 ntfy 서버가 설정되어 있지 않습니다. 설정된 서버: {servers}.',
    ambiguousServer: 'ntfy 서버가 여러 개 설정되어 있습니다({servers}). 어느 서버를 사용할지 사용자에게 묻고 server로 전달하세요.',
    messageRequired: 'message는 필수이며 비어 있지 않은 텍스트여야 합니다.',
    messageTooLarge: 'message가 {size}바이트입니다. ntfy는 UTF-8 기준 최대 {max}바이트까지 받습니다. 내용을 줄이세요(아무것도 전송하지 않았고 잘라내지도 않았습니다).',
    invalidTopic: '잘못된 topic "{topic}"입니다. ntfy 토픽에는 영문자, 숫자, -, _만 사용할 수 있으며 길이는 1~64자입니다.',
    titleNotText: 'title은 텍스트여야 합니다.',
    invalidPriority: '잘못된 priority "{priority}"입니다. 1-5 또는 min, low, default, high, urgent 중 하나를 사용하세요.',
    tagsNotArray: 'tags는 문자열 배열이어야 합니다.',
    tagsNotStrings: 'tags는 비어 있지 않은 문자열의 배열이어야 합니다.',
    clickNotHttps: 'click은 https://로 시작하는 절대 URL이어야 합니다.',
    markdownNotBoolean: 'markdown은 true 또는 false여야 합니다.',
    unknownOutcome: '결과 알 수 없음: {reason}. 요청이 {host}에 도달했고 알림이 이미 토픽 "{topic}"(으)로 전달되었을 수 있습니다. 자동으로 다시 보내지 마세요. 다시 보내기 전에 사용자에게 ntfy 앱에서 토픽을 확인해 달라고 요청하세요.',
    reasonServerError: '{host}이(가) 서버 오류를 반환했습니다(HTTP {status})',
    reasonUnexpectedStatus: '{host}이(가) 예상하지 못한 HTTP 상태 {status}을(를) 반환했습니다',
    reasonRequestFailed: '요청이 실패했습니다({detail})',
    reasonNoResponse: '{host}에서 응답이 없습니다({detail})',
    noDetails: '세부 정보 없음',
    timeoutOrNetwork: '타임아웃 또는 네트워크 오류',
    withServerDetail: '{message} 서버 응답: {detail}',
    unauthorized: '전송되지 않음: {host}이(가) 액세스 토큰을 거부했습니다(HTTP 401). 토큰이 없거나, 유효하지 않거나, 만료되었습니다. 사용자에게 ntfy 플러그인 설정에서 토큰을 교체해 달라고 요청하세요.',
    forbidden: '전송되지 않음: 액세스 토큰에 {host}의 토픽 "{topic}"에 대한 쓰기 권한이 없습니다(HTTP 403). 사용자에게 이 토픽의 쓰기 권한을 부여하거나(ntfy 접근 제어) 다른 토픽을 사용해 달라고 요청하세요.',
    notFound: '전송되지 않음: {host}이(가) HTTP 404로 응답했습니다. 도메인 루트에서 제공되는 ntfy 서버인지 확인하세요.',
    tooLarge: '전송되지 않음: {host}이(가) 알림이 너무 크다며 거부했습니다(HTTP 413). 메시지를 줄이세요.',
    rateLimited: '전송되지 않음: {host}이(가) 요청 속도를 제한하고 있습니다(HTTP 429). 잠시 기다린 뒤 보내고, 반복해서 재시도하지 마세요.',
    rejected: '전송되지 않음: {host}이(가) 알림을 거부했습니다(HTTP {status}).',
    noTopic: 'topic이 지정되지 않았고 {host}에 기본 토픽이 없습니다. topic을 전달하거나, 사용자에게 ntfy 플러그인 설정에서 기본 토픽을 설정해 달라고 요청하세요.',
    noMessageId: 'ntfy가 알림을 수락했지만(HTTP {status}) 메시지 id를 반환하지 않았습니다.',
    unknownTool: '알 수 없는 도구: {tool}',
    internalAfterDispatch: '결과 알 수 없음: 요청을 네트워크에 넘긴 뒤 내부 오류가 발생했습니다. 자동으로 다시 보내지 말고, 먼저 사용자에게 ntfy 앱을 확인해 달라고 요청하세요.',
    internal: 'ntfy 플러그인 내부 오류입니다. 아무것도 전송하지 않았습니다.',
  },
};

var hasOwn = Object.prototype.hasOwnProperty;
/* null = no locale from the host yet; English is used and the next call asks again. */
var hostLocale = null;
var localeRequest = null;

function resolveLocale(value) {
  return typeof value === 'string' && hasOwn.call(MESSAGES, value) ? value : 'en';
}

async function requestHostLocale() {
  if (typeof cindy.request !== 'function') return null;
  var timer = null;
  try {
    // A host that never answers must not block a send: after 3 s use English and retry next call.
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

/* Concurrent tool calls share one request; success is cached and host-context-changed updates it. */
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

function failure(errorCode, message) {
  return { ok: false, errorCode: errorCode, message: message };
}

function success(result) {
  return { ok: true, result: result };
}

/** UTF-8 byte length without TextEncoder (lone surrogates count as U+FFFD, 3 bytes). */
function utf8Length(text) {
  var bytes = 0;
  for (var i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      var next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Text that came from the server or host goes back to the agent only after this:
 * control characters removed, anything shaped like an ntfy token or a bearer
 * credential redacted, length capped.
 */
function safeText(value) {
  var text = typeof value === 'string' ? value : '';
  text = text
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\btk_[A-Za-z0-9]{4,}/g, '[redacted]')
    .trim();
  return text.length > 200 ? text.slice(0, 200) + '...' : text;
}

function normalizeServerRef(value) {
  return String(value).trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
}

async function readJson(url) {
  var response = await fetch(url);
  if (!response || response.ok === false) throw new Error('HTTP ' + (response && response.status));
  return response.json();
}

/** Configured servers, newest host data on every call (the list is tiny). */
async function loadServers() {
  var list;
  try {
    list = await readJson('/connections');
  } catch (e) {
    return { error: failure('SETTINGS_UNAVAILABLE', t('settingsUnavailable')) };
  }
  var slot = null;
  if (Array.isArray(list)) {
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].key === CONNECTION_KEY) {
        slot = list[i];
        break;
      }
    }
  }
  var connections = slot && Array.isArray(slot.connections) ? slot.connections : [];
  var topics = {};
  try {
    var kv = await readJson('/kv');
    if (kv && typeof kv.defaultTopics === 'object' && kv.defaultTopics !== null) topics = kv.defaultTopics;
  } catch (e) {
    // Default topics are optional; a send without an explicit topic reports it.
    topics = {};
  }
  var servers = [];
  for (var j = 0; j < connections.length; j++) {
    var c = connections[j];
    if (!c || typeof c.id !== 'string' || typeof c.host !== 'string' || !c.host) continue;
    var topic = Object.prototype.hasOwnProperty.call(topics, c.id) ? topics[c.id] : null;
    servers.push({
      id: c.id,
      host: c.host.toLowerCase(),
      defaultTopic: typeof topic === 'string' && TOPIC_RE.test(topic) ? topic : null,
    });
  }
  return { servers: servers };
}

function hostList(servers) {
  return servers.map(function (s) { return s.host; }).join(', ');
}

function resolveServer(servers, requested) {
  if (!servers.length) {
    return { error: failure('NOT_CONFIGURED', t('notConfigured')) };
  }
  if (requested !== undefined && requested !== null && requested !== '') {
    if (typeof requested !== 'string') {
      return { error: failure('INVALID_ARGUMENT', t('serverNotString')) };
    }
    var wanted = normalizeServerRef(requested);
    for (var i = 0; i < servers.length; i++) {
      if (servers[i].id === requested || servers[i].host === wanted) return { server: servers[i] };
    }
    return { error: failure('SERVER_NOT_FOUND', t('serverNotFound', { server: safeText(requested), servers: hostList(servers) })) };
  }
  if (servers.length === 1) return { server: servers[0] };
  return { error: failure('AMBIGUOUS_SERVER', t('ambiguousServer', { servers: hostList(servers) })) };
}

function parsePriority(value) {
  if (typeof value === 'number' && value % 1 === 0 && value >= 1 && value <= 5) return value;
  if (typeof value === 'string') {
    var text = value.trim().toLowerCase();
    if (/^[1-5]$/.test(text)) return Number(text);
    if (Object.prototype.hasOwnProperty.call(PRIORITY_NAMES, text)) return PRIORITY_NAMES[text];
  }
  return null;
}

function isHttpsUrl(value) {
  if (typeof value !== 'string' || /\s/.test(value)) return false;
  if (typeof URL === 'function') {
    try {
      var parsed = new URL(value);
      return parsed.protocol === 'https:' && parsed.hostname.length > 0;
    } catch (e) {
      return false;
    }
  }
  return /^https:\/\/[^\/?#\s]+/i.test(value);
}

/** Validates everything that does not need the server list. */
function validateSendArgs(args) {
  var fields = {};
  if (typeof args.message !== 'string' || !args.message.trim()) {
    return { error: failure('INVALID_ARGUMENT', t('messageRequired')) };
  }
  var size = utf8Length(args.message);
  if (size > MAX_MESSAGE_BYTES) {
    return { error: failure('MESSAGE_TOO_LARGE', t('messageTooLarge', { size: size, max: MAX_MESSAGE_BYTES })) };
  }
  fields.message = args.message;

  if (args.topic !== undefined && args.topic !== null && args.topic !== '') {
    if (typeof args.topic !== 'string' || !TOPIC_RE.test(args.topic)) {
      return { error: failure('INVALID_TOPIC', t('invalidTopic', { topic: safeText(String(args.topic)) })) };
    }
    fields.topic = args.topic;
  }

  if (args.title !== undefined && args.title !== null) {
    if (typeof args.title !== 'string') return { error: failure('INVALID_ARGUMENT', t('titleNotText')) };
    if (args.title.trim()) fields.title = args.title;
  }

  if (args.priority !== undefined && args.priority !== null && args.priority !== '') {
    var priority = parsePriority(args.priority);
    if (priority === null) {
      return { error: failure('INVALID_PRIORITY', t('invalidPriority', { priority: safeText(String(args.priority)) })) };
    }
    fields.priority = priority;
  }

  if (args.tags !== undefined && args.tags !== null) {
    if (!Array.isArray(args.tags)) return { error: failure('INVALID_ARGUMENT', t('tagsNotArray')) };
    var tags = [];
    for (var i = 0; i < args.tags.length; i++) {
      var tag = args.tags[i];
      if (typeof tag !== 'string' || !tag.trim()) {
        return { error: failure('INVALID_ARGUMENT', t('tagsNotStrings')) };
      }
      tags.push(tag.trim());
    }
    if (tags.length) fields.tags = tags;
  }

  if (args.click !== undefined && args.click !== null && args.click !== '') {
    if (!isHttpsUrl(args.click)) {
      return { error: failure('INVALID_CLICK_URL', t('clickNotHttps')) };
    }
    fields.click = args.click;
  }

  if (args.markdown !== undefined && args.markdown !== null) {
    if (typeof args.markdown !== 'boolean') return { error: failure('INVALID_ARGUMENT', t('markdownNotBoolean')) };
    if (args.markdown) fields.markdown = true;
  }
  return { fields: fields };
}

function unknownOutcome(server, topic, reason) {
  return failure('SEND_OUTCOME_UNKNOWN', t('unknownOutcome', { reason: reason, host: server.host, topic: topic }));
}

function ntfyErrorText(body) {
  if (typeof body !== 'string' || !body) return '';
  try {
    var parsed = JSON.parse(body);
    if (parsed && typeof parsed.error === 'string') return safeText(parsed.error);
  } catch (e) {
    /* not JSON */
  }
  return safeText(body);
}

function classifyHttpFailure(status, body, server, topic) {
  var detail = ntfyErrorText(body);
  var vars = { host: server.host, topic: topic, status: status };
  function rejected(errorCode, key) {
    var message = t(key, vars);
    return failure(errorCode, detail ? t('withServerDetail', { message: message, detail: detail }) : message);
  }
  if (status === 401) {
    return rejected('NTFY_UNAUTHORIZED', 'unauthorized');
  }
  if (status === 403) {
    return rejected('NTFY_FORBIDDEN', 'forbidden');
  }
  if (status === 404) {
    return rejected('NTFY_NOT_FOUND', 'notFound');
  }
  if (status === 413) {
    return rejected('MESSAGE_TOO_LARGE', 'tooLarge');
  }
  if (status === 429) {
    return rejected('NTFY_RATE_LIMITED', 'rateLimited');
  }
  if (status >= 400 && status < 500) {
    return rejected('NTFY_REJECTED', 'rejected');
  }
  if (status >= 500) {
    return unknownOutcome(server, topic, t('reasonServerError', vars));
  }
  return unknownOutcome(server, topic, t('reasonUnexpectedStatus', vars));
}

async function sendNotification(args, callId, state) {
  var checked = validateSendArgs(args);
  if (checked.error) return checked.error;
  var fields = checked.fields;

  var loaded = await loadServers();
  if (loaded.error) return loaded.error;
  var resolved = resolveServer(loaded.servers, args.server);
  if (resolved.error) return resolved.error;
  var server = resolved.server;

  var topic = fields.topic || server.defaultTopic;
  if (!topic) {
    return failure('NO_TOPIC', t('noTopic', { host: server.host }));
  }

  var body = { topic: topic, message: fields.message };
  if (fields.title !== undefined) body.title = fields.title;
  if (fields.priority !== undefined) body.priority = fields.priority;
  if (fields.tags !== undefined) body.tags = fields.tags;
  if (fields.click !== undefined) body.click = fields.click;
  if (fields.markdown) body.markdown = true;

  var response;
  state.dispatched = true;
  try {
    // No Authorization header here: the host injects the connection token.
    response = await cindy.fetch({
      url: 'https://' + server.host + '/',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      as: 'text',
      timeoutMs: REQUEST_TIMEOUT_MS,
      callId: callId,
    });
  } catch (e) {
    return unknownOutcome(server, topic, t('reasonRequestFailed', { detail: safeText(e && e.message) || t('noDetails') }));
  }

  if (!response || response.ok !== true) {
    // cindy.fetch failures carry only free-form text (no errorCode), and that text
    // cannot prove the POST never left: a blocked redirect, for one, fails after
    // the server already got the request. So every host failure is outcome-unknown.
    var reason = safeText(response && response.message);
    return unknownOutcome(server, topic, t('reasonNoResponse', { host: server.host, detail: reason || t('timeoutOrNetwork') }));
  }

  var status = response.status;
  if (typeof status !== 'number' || status < 200 || status >= 300) {
    return classifyHttpFailure(status, response.body, server, topic);
  }

  var published = null;
  try {
    published = typeof response.body === 'string' && response.body ? JSON.parse(response.body) : null;
  } catch (e) {
    published = null;
  }
  var result = { sent: true, server: server.host, topic: topic };
  if (published && typeof published.id === 'string') {
    result.id = published.id;
    if (typeof published.time === 'number') result.time = published.time;
    if (typeof published.expires === 'number') result.expires = published.expires;
  } else {
    result.id = null;
    result.note = t('noMessageId', { status: status });
  }
  return success(result);
}

async function listServers() {
  var loaded = await loadServers();
  if (loaded.error) return loaded.error;
  var result = {
    count: loaded.servers.length,
    servers: loaded.servers.map(function (s) {
      return { id: s.id, host: s.host, url: 'https://' + s.host, default_topic: s.defaultTopic };
    }),
  };
  if (!loaded.servers.length) {
    result.note = t('notConfigured');
  }
  return success(result);
}

cindy.onHostMessage(async function (msg) {
  if (!msg) return;
  if (msg.type === 'host-context-changed') {
    hostLocale = resolveLocale(msg.context && msg.context.locale);
    return;
  }
  if (msg.type !== 'tool-call') return;
  await ensureLocale();
  var args = msg.args && typeof msg.args === 'object' && !Array.isArray(msg.args) ? msg.args : {};
  var state = { dispatched: false };
  var outcome;
  try {
    if (msg.tool === 'ntfy_send') outcome = await sendNotification(args, msg.callId, state);
    else if (msg.tool === 'ntfy_servers') outcome = await listServers();
    else outcome = failure('UNKNOWN_TOOL', t('unknownTool', { tool: safeText(String(msg.tool)) }));
  } catch (e) {
    outcome = state.dispatched
      ? failure('SEND_OUTCOME_UNKNOWN', t('internalAfterDispatch'))
      : failure('INTERNAL', t('internal'));
  }
  if (outcome.ok) {
    await cindy.send({ type: 'tool-result', callId: msg.callId, ok: true, result: outcome.result });
  } else {
    await cindy.send({ type: 'tool-result', callId: msg.callId, ok: false, errorCode: outcome.errorCode, message: outcome.message });
  }
});
