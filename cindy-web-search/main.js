/**
 * Web Search · 电子脑 —— Cindy 内置网页搜索意识(cindy + network 槽)。
 *
 * 三条 Provider 路径严格分账:
 * - cindy:Cindy Desktop 主机代办 -> LiteLLM /v1/messages -> 模型原生 Web Search，
 *   使用 Cindy AI 额度；
 * - brave:network 槽 -> Brave，使用用户自己的 Brave Key；
 * - tavily:network 槽 -> Tavily，使用用户自己的 Tavily Key。
 *
 * 未指定 Provider 时只读取普通偏好:
 * - cindyAiEnabled 缺省 true -> cindy；
 * - 显式关闭后 -> byoDefaultProvider(缺省 brave)。
 * 任一路失败都原样返回，不跨 Provider fallback，避免静默消耗另一套凭证。
 */

/* global cindy */

var BRAVE_URL = 'https://api.search.brave.com/res/v1/web/search';
var TAVILY_URL = 'https://api.tavily.com/search';

function clampLimit(n) {
  var v = typeof n === 'number' && isFinite(n) ? Math.floor(n) : 5;
  return Math.min(10, Math.max(1, v));
}

function isByoProvider(value) {
  return value === 'brave' || value === 'tavily';
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

async function searchWeb(args, callId, callerTool) {
  var query = args && typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) return { ok: false, message: 'query 不能为空' };
  if (query.length > 2000) return { ok: false, message: 'query 过长(上限 2000 字符)' };
  var limit = clampLimit(args.limit);
  var provider = args && args.provider;

  if (provider !== undefined && provider !== 'cindy' && !isByoProvider(provider)) {
    return { ok: false, message: 'provider 只支持 cindy / brave / tavily' };
  }
  if (provider === 'cindy') return searchCindy(query, limit, callId, callerTool);
  if (provider === 'brave') return searchBrave(query, limit);
  if (provider === 'tavily') return searchTavily(query, limit);

  var prefs;
  try {
    prefs = await readSearchPrefs();
  } catch (e) {
    return { ok: false, message: '搜索偏好读取失败，请稍后重试或显式选择搜索源' };
  }
  return prefs.cindyAiEnabled
    ? searchCindy(query, limit, callId, callerTool)
    : prefs.byoDefaultProvider === 'tavily'
      ? searchTavily(query, limit)
      : searchBrave(query, limit);
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
