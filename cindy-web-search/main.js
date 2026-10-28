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

/* global cindy */

var BRAVE_URL = 'https://api.search.brave.com/res/v1/web/search';
var TAVILY_URL = 'https://api.tavily.com/search';
var DEEPSEEK_URL = 'https://api.deepseek.com/v1/tools/search';

/*
 * 运行时文案只跟随宿主语言(cindy.request app-context / host-context-changed),
 * 不读浏览器或操作系统语言;宿主语言不在表内或取不到时回退英文。
 * errorCode 是稳定协议,不翻译;只翻译 message / note。
 */
var MESSAGES = {
  'zh-CN': {
    cindyUnavailable: 'Cindy AI 搜索服务暂时不可用，请稍后再试',
    httpError: '{provider} 返回 HTTP {status}:{body}',
    deepSeek_NOT_CONFIGURED: '请在「插件」→「Web Search」详情页配置 DeepSeek API Key。',
    deepSeek_AUTH_REJECTED: 'DeepSeek API Key 无效，请在「插件」→「Web Search」详情页更新 Key。',
    deepSeek_PERMISSION_DENIED: 'DeepSeek 搜索请求未获授权，请检查 Cindy 授权及 DeepSeek 账号的接口权限。',
    deepSeek_QUOTA_EXHAUSTED: 'DeepSeek 账户余额不足，请充值后再搜索。',
    deepSeek_RATE_LIMITED: 'DeepSeek 搜索请求过于频繁，请稍后重试（每账户最多 5 次/秒）。',
    deepSeek_INVALID_INPUT: 'DeepSeek 搜索参数无效，请使用 1–128 个 Unicode 字符的查询后重试。',
    deepSeek_UPSTREAM_UNAVAILABLE: 'DeepSeek 搜索服务暂时不可用，请检查网络连接后稍后重试。',
    deepSeek_UPSTREAM_REJECTED: 'DeepSeek 未接受搜索请求，请检查账号权限或更新 Web Search 插件后再试。',
    deepSeek_RESPONSE_INVALID: 'DeepSeek 返回的搜索结果格式无效或过大，请缩小结果条数后重试。',
    deepSeekFallback: 'DeepSeek 搜索请求未完成，请检查网络连接、Cindy 授权，并确认「插件」→「Web Search」详情页已配置有效的 DeepSeek API Key。',
    queryEmpty: 'query 不能为空',
    queryTooLong: 'query 过长(上限 2000 字符)',
    providerUnsupported: 'provider 只支持 cindy / brave / tavily / deepseek',
    prefsUnavailable: '搜索偏好读取失败，请稍后重试或显式选择搜索源',
    unknownTool: '未知工具:{tool}',
    resultNote: '经 {provider} 搜索到 {count} 条结果',
    searchFailed: '搜索失败:{detail}',
  },
  en: {
    cindyUnavailable: 'Cindy AI search is temporarily unavailable. Please try again later.',
    httpError: '{provider} returned HTTP {status}: {body}',
    deepSeek_NOT_CONFIGURED: 'Configure a DeepSeek API Key in "Plugins" > "Web Search" details.',
    deepSeek_AUTH_REJECTED: 'The DeepSeek API Key is invalid. Update the key in "Plugins" > "Web Search" details.',
    deepSeek_PERMISSION_DENIED: 'The DeepSeek search request was not authorized. Check the Cindy authorization and the API permissions of your DeepSeek account.',
    deepSeek_QUOTA_EXHAUSTED: 'Your DeepSeek account balance is insufficient. Top up before searching again.',
    deepSeek_RATE_LIMITED: 'Too many DeepSeek search requests. Please try again later (at most 5 requests per second per account).',
    deepSeek_INVALID_INPUT: 'Invalid DeepSeek search parameters. Retry with a query of 1 to 128 Unicode characters.',
    deepSeek_UPSTREAM_UNAVAILABLE: 'DeepSeek search is temporarily unavailable. Check your network connection and try again later.',
    deepSeek_UPSTREAM_REJECTED: 'DeepSeek did not accept the search request. Check your account permissions or update the Web Search plugin, then try again.',
    deepSeek_RESPONSE_INVALID: 'DeepSeek returned search results with an invalid format or that are too large. Lower the number of results and try again.',
    deepSeekFallback: 'The DeepSeek search request did not complete. Check your network connection and the Cindy authorization, and make sure a valid DeepSeek API Key is configured in "Plugins" > "Web Search" details.',
    queryEmpty: 'query must not be empty',
    queryTooLong: 'query is too long (max 2000 characters)',
    providerUnsupported: 'provider only supports cindy / brave / tavily / deepseek',
    prefsUnavailable: 'Failed to read search preferences. Try again later or choose a provider explicitly.',
    unknownTool: 'Unknown tool: {tool}',
    resultNote: 'Found {count} results via {provider}',
    searchFailed: 'Search failed: {detail}',
  },
  ja: {
    cindyUnavailable: 'Cindy AI 検索は一時的に利用できません。しばらくしてから再試行してください。',
    httpError: '{provider} が HTTP {status} を返しました: {body}',
    deepSeek_NOT_CONFIGURED: '「プラグイン」→「Web Search」の詳細画面で DeepSeek API キーを設定してください。',
    deepSeek_AUTH_REJECTED: 'DeepSeek API キーが無効です。「プラグイン」→「Web Search」の詳細画面でキーを更新してください。',
    deepSeek_PERMISSION_DENIED: 'DeepSeek 検索リクエストが承認されていません。Cindy の認可と DeepSeek アカウントの API 権限を確認してください。',
    deepSeek_QUOTA_EXHAUSTED: 'DeepSeek アカウントの残高が不足しています。チャージしてから再度検索してください。',
    deepSeek_RATE_LIMITED: 'DeepSeek 検索リクエストが多すぎます。しばらくしてから再試行してください（1 アカウントあたり毎秒最大 5 回）。',
    deepSeek_INVALID_INPUT: 'DeepSeek 検索パラメータが無効です。1～128 文字（Unicode 文字単位）のクエリで再試行してください。',
    deepSeek_UPSTREAM_UNAVAILABLE: 'DeepSeek 検索サービスは一時的に利用できません。ネットワーク接続を確認し、しばらくしてから再試行してください。',
    deepSeek_UPSTREAM_REJECTED: 'DeepSeek が検索リクエストを受け付けませんでした。アカウントの権限を確認するか、Web Search プラグインを更新してから再試行してください。',
    deepSeek_RESPONSE_INVALID: 'DeepSeek から返された検索結果の形式が無効か、サイズが大きすぎます。結果の件数を減らして再試行してください。',
    deepSeekFallback: 'DeepSeek 検索リクエストが完了しませんでした。ネットワーク接続と Cindy の認可を確認し、「プラグイン」→「Web Search」の詳細画面に有効な DeepSeek API キーが設定されていることを確認してください。',
    queryEmpty: 'query は空にできません',
    queryTooLong: 'query が長すぎます（上限 2000 文字）',
    providerUnsupported: 'provider は cindy / brave / tavily / deepseek のみ対応しています',
    prefsUnavailable: '検索設定を読み込めませんでした。しばらくしてから再試行するか、検索元を明示的に指定してください。',
    unknownTool: '不明なツール: {tool}',
    resultNote: '{provider} で {count} 件の結果が見つかりました',
    searchFailed: '検索に失敗しました: {detail}',
  },
  ko: {
    cindyUnavailable: 'Cindy AI 검색을 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도하세요.',
    httpError: '{provider}이(가) HTTP {status} 응답을 반환했습니다: {body}',
    deepSeek_NOT_CONFIGURED: '"플러그인" → "Web Search" 상세 화면에서 DeepSeek API 키를 설정하세요.',
    deepSeek_AUTH_REJECTED: 'DeepSeek API 키가 유효하지 않습니다. "플러그인" → "Web Search" 상세 화면에서 키를 업데이트하세요.',
    deepSeek_PERMISSION_DENIED: 'DeepSeek 검색 요청이 승인되지 않았습니다. Cindy 권한과 DeepSeek 계정의 API 권한을 확인하세요.',
    deepSeek_QUOTA_EXHAUSTED: 'DeepSeek 계정 잔액이 부족합니다. 충전한 후 다시 검색하세요.',
    deepSeek_RATE_LIMITED: 'DeepSeek 검색 요청이 너무 많습니다. 잠시 후 다시 시도하세요(계정당 초당 최대 5회).',
    deepSeek_INVALID_INPUT: 'DeepSeek 검색 매개변수가 잘못되었습니다. Unicode 문자 기준 1~128자의 검색어로 다시 시도하세요.',
    deepSeek_UPSTREAM_UNAVAILABLE: 'DeepSeek 검색 서비스를 일시적으로 사용할 수 없습니다. 네트워크 연결을 확인한 후 잠시 후 다시 시도하세요.',
    deepSeek_UPSTREAM_REJECTED: 'DeepSeek이 검색 요청을 받아들이지 않았습니다. 계정 권한을 확인하거나 Web Search 플러그인을 업데이트한 후 다시 시도하세요.',
    deepSeek_RESPONSE_INVALID: 'DeepSeek이 반환한 검색 결과의 형식이 잘못되었거나 너무 큽니다. 결과 수를 줄여서 다시 시도하세요.',
    deepSeekFallback: 'DeepSeek 검색 요청이 완료되지 않았습니다. 네트워크 연결과 Cindy 권한을 확인하고 "플러그인" → "Web Search" 상세 화면에 유효한 DeepSeek API 키가 설정되어 있는지 확인하세요.',
    queryEmpty: 'query는 비워 둘 수 없습니다',
    queryTooLong: 'query가 너무 깁니다(최대 2000자)',
    providerUnsupported: 'provider는 cindy / brave / tavily / deepseek만 지원합니다',
    prefsUnavailable: '검색 설정을 읽지 못했습니다. 잠시 후 다시 시도하거나 검색 공급자를 직접 지정하세요.',
    unknownTool: '알 수 없는 도구: {tool}',
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

function clampLimit(n) {
  var v = typeof n === 'number' && isFinite(n) ? Math.floor(n) : 5;
  return Math.min(10, Math.max(1, v));
}

function isByoProvider(value) {
  return value === 'brave' || value === 'tavily' || value === 'deepseek';
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
async function searchBrave(query, limit) {
  var url = BRAVE_URL + '?q=' + encodeURIComponent(query) + '&count=' + limit;
  var r = await cindy.fetch({ url: url, headers: { Accept: 'application/json' } });
  if (!r.ok) return r;
  if (r.status !== 200) {
    return { ok: false, message: t('httpError', { provider: 'Brave', status: r.status, body: r.body.slice(0, 200) }) };
  }
  var data = JSON.parse(r.body);
  var items = (data.web && data.web.results) || [];
  return {
    ok: true,
    provider: 'brave',
    results: items.slice(0, limit).map(function (it) {
      return { title: it.title, url: it.url, snippet: it.description || '' };
    }),
  };
}

/** Tavily BYO:POST JSON，Key 由主机注入 Authorization:Bearer。 */
async function searchTavily(query, limit) {
  var r = await cindy.fetch({
    url: TAVILY_URL,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: query,
      max_results: limit,
      search_depth: 'basic',
      include_answer: false,
      include_raw_content: false,
      include_images: false,
    }),
  });
  if (!r.ok) return r;
  if (r.status !== 200) {
    return { ok: false, message: t('httpError', { provider: 'Tavily', status: r.status, body: r.body.slice(0, 200) }) };
  }
  var data = JSON.parse(r.body);
  var items = data.results || [];
  return {
    ok: true,
    provider: 'tavily',
    results: items.slice(0, limit).map(function (it) {
      return { title: it.title, url: it.url, snippet: it.content || '' };
    }),
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
async function searchDeepSeek(query, limit, callId) {
  // Count Unicode code points, not UTF-16 units (e.g. emoji count as one).
  if (Array.from(query).length > 128) return deepSeekFailure('INVALID_INPUT');
  var r;
  try {
    r = await cindy.fetch({
      url: DEEPSEEK_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query, count: limit, need_content: false }),
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
  // Do not parse truncated/oversized responses or pass upstream error bodies on.
  if (r.truncated || typeof r.body !== 'string' || r.body.length > 1000000) {
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
    results: data.results.slice(0, limit).map(function (item) {
      return { title: item.title, url: item.url, snippet: item.summary || item.snippet };
    }),
  };
}

function searchByo(provider, query, limit, callId) {
  if (provider === 'deepseek') return searchDeepSeek(query, limit, callId);
  if (provider === 'tavily') return searchTavily(query, limit);
  return searchBrave(query, limit);
}

async function searchWeb(args, callId, callerTool) {
  var query = args && typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) return { ok: false, message: t('queryEmpty') };
  if (query.length > 2000) return { ok: false, message: t('queryTooLong') };
  var limit = clampLimit(args.limit);
  var provider = args && args.provider;

  if (provider !== undefined && provider !== 'cindy' && !isByoProvider(provider)) {
    return { ok: false, message: t('providerUnsupported') };
  }
  if (provider === 'cindy') return searchCindy(query, limit, callId, callerTool);
  if (isByoProvider(provider)) return searchByo(provider, query, limit, callId);

  var prefs;
  try {
    prefs = await readSearchPrefs();
  } catch (e) {
    return { ok: false, message: t('prefsUnavailable') };
  }
  return prefs.cindyAiEnabled
    ? searchCindy(query, limit, callId, callerTool)
    : searchByo(prefs.byoDefaultProvider, query, limit, callId);
}

cindy.onHostMessage(async function (msg) {
  if (!msg) return;
  if (msg.type === 'host-context-changed') {
    hostLocale = resolveLocale(msg.context && msg.context.locale);
    return;
  }
  if (msg.type !== 'tool-call') return;
  await ensureLocale();
  if (msg.tool !== 'search_web') {
    cindy.send({ type: 'tool-result', callId: msg.callId, ok: false, message: t('unknownTool', { tool: msg.tool }) });
    return;
  }
  try {
    var r = await searchWeb(msg.args || {}, msg.callId, msg.tool);
    if (r.ok) {
      cindy.send({
        type: 'tool-result',
        callId: msg.callId,
        ok: true,
        result: {
          provider: r.provider,
          results: r.results,
          note: t('resultNote', { provider: r.provider, count: r.results.length }),
        },
      });
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
      message: t('searchFailed', { detail: err && err.message ? err.message : String(err) }),
    });
  }
});
