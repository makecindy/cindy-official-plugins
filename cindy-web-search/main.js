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
  if (!response.ok) throw new Error('搜索偏好读取失败');
  var kv = await response.json();
  if (!kv || typeof kv !== 'object' || Array.isArray(kv)) {
    throw new Error('搜索偏好格式无效');
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
        : 'Cindy AI 搜索服务暂时不可用，请稍后再试',
    };
  }
}

/** Brave:GET + query 参数，Key 由主机注入 X-Subscription-Token。 */
async function searchBrave(query, limit) {
  var url = BRAVE_URL + '?q=' + encodeURIComponent(query) + '&count=' + limit;
  var r = await cindy.fetch({ url: url, headers: { Accept: 'application/json' } });
  if (!r.ok) return r;
  if (r.status !== 200) {
    return { ok: false, message: 'Brave 返回 HTTP ' + r.status + ':' + r.body.slice(0, 200) };
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
    return { ok: false, message: 'Tavily 返回 HTTP ' + r.status + ':' + r.body.slice(0, 200) };
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
  var messages = {
    NOT_CONFIGURED: '请在「插件」→「Web Search」详情页配置 DeepSeek API Key。',
    AUTH_REJECTED: 'DeepSeek API Key 无效，请在「插件」→「Web Search」详情页更新 Key。',
    PERMISSION_DENIED: 'DeepSeek 搜索请求未获授权，请检查 Cindy 授权及 DeepSeek 账号的接口权限。',
    QUOTA_EXHAUSTED: 'DeepSeek 账户余额不足，请充值后再搜索。',
    RATE_LIMITED: 'DeepSeek 搜索请求过于频繁，请稍后重试（每账户最多 5 次/秒）。',
    INVALID_INPUT: 'DeepSeek 搜索参数无效，请使用 1–128 个 Unicode 字符的查询后重试。',
    UPSTREAM_UNAVAILABLE: 'DeepSeek 搜索服务暂时不可用，请检查网络连接后稍后重试。',
    UPSTREAM_REJECTED: 'DeepSeek 未接受搜索请求，请检查账号权限或更新 Web Search 插件后再试。',
    RESPONSE_INVALID: 'DeepSeek 返回的搜索结果格式无效或过大，请缩小结果条数后重试。',
  };
  var code = typeof errorCode === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(errorCode)
    ? errorCode : 'INTERNAL';
  return {
    ok: false,
    errorCode: code,
    message: messages[code] || 'DeepSeek 搜索请求未完成，请检查网络连接、Cindy 授权，并确认「插件」→「Web Search」详情页已配置有效的 DeepSeek API Key。',
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
  if (!query) return { ok: false, message: 'query 不能为空' };
  if (query.length > 2000) return { ok: false, message: 'query 过长(上限 2000 字符)' };
  var limit = clampLimit(args.limit);
  var provider = args && args.provider;

  if (provider !== undefined && provider !== 'cindy' && !isByoProvider(provider)) {
    return { ok: false, message: 'provider 只支持 cindy / brave / tavily / deepseek' };
  }
  if (provider === 'cindy') return searchCindy(query, limit, callId, callerTool);
  if (isByoProvider(provider)) return searchByo(provider, query, limit, callId);

  var prefs;
  try {
    prefs = await readSearchPrefs();
  } catch (e) {
    return { ok: false, message: '搜索偏好读取失败，请稍后重试或显式选择搜索源' };
  }
  return prefs.cindyAiEnabled
    ? searchCindy(query, limit, callId, callerTool)
    : searchByo(prefs.byoDefaultProvider, query, limit, callId);
}

cindy.onHostMessage(async function (msg) {
  if (!msg || msg.type !== 'tool-call') return;
  if (msg.tool !== 'search_web') {
    cindy.send({ type: 'tool-result', callId: msg.callId, ok: false, message: '未知工具:' + msg.tool });
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
          note: '经 ' + r.provider + ' 搜索到 ' + r.results.length + ' 条结果',
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
      message: '搜索失败:' + (err && err.message ? err.message : String(err)),
    });
  }
});
