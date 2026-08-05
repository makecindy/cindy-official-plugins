/**
 * Web Search · 电子脑 —— Cindy 内置的网页搜索意识(network 槽)。
 *
 * 工作方式:
 * - 域名白名单代发:cindy.fetch 只能到 ghost.json 声明的 Brave / Tavily /
 *   Search1API 三个 API 域名,
 *   请求由主机代发,沙箱本身零直连;
 * - 凭证保险库:三条 key 由用户在插件设置页填入、主机保管注入——本文件里
 *   没有也不可能有任何 key 字节,连"读一下"都做不到(平台结构保证)。
 *
 * 搜索源选择:调用指定 provider 就用指定的;没指定先试 Brave(便宜快),
 * key 未配置的结构化错误再降级试 Tavily,再降级 Search1API;都没配就把
 * 主机的指引原样交卷。
 */

/* global cindy */

var BRAVE_URL = 'https://api.search.brave.com/res/v1/web/search';
var TAVILY_URL = 'https://api.tavily.com/search';
var SEARCH1API_URL = 'https://api.search1api.com/search';

/** 主机"凭证未配置"错误的识别(message 带填写指引,原样转给用户最有用)。 */
function isKeyMissing(r) {
  return !r.ok && typeof r.message === 'string' && r.message.indexOf('尚未配置') >= 0;
}

function clampLimit(n) {
  var v = typeof n === 'number' && isFinite(n) ? Math.floor(n) : 5;
  return Math.min(10, Math.max(1, v));
}

/** Brave:GET + query 参数,key 由主机注入 X-Subscription-Token。 */
async function searchBrave(query, limit) {
  var url = BRAVE_URL + '?q=' + encodeURIComponent(query) + '&count=' + limit;
  var r = await cindy.fetch({ url: url, headers: { Accept: 'application/json' } });
  if (!r.ok) return r;
  if (r.status !== 200) return { ok: false, message: 'Brave 返回 HTTP ' + r.status + ':' + r.body.slice(0, 200) };
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

/** Search1API:POST JSON,key 由主机注入 Authorization: Bearer,引擎不传走 API 默认。 */
async function searchSearch1api(query, limit) {
  var r = await cindy.fetch({
    url: SEARCH1API_URL,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: query,
      max_results: limit,
      crawl_results: 0,
    }),
  });
  if (!r.ok) return r;
  // Search1API 的公开错误契约明确把 /search 的 404 定义为“搜索完成但无结果”,
  // 对搜索工具来说应返回空列表,不是服务故障:
  // https://www.search1api.com/docs/essentials/error-handling#treat-a-search-404-as-zero-results
  // 其余状态给用户可直接执行的下一步,不裸抛响应正文或 HTTP 状态码。
  if (r.status === 404) return { ok: true, provider: 'search1api', results: [] };
  if (r.status === 401) {
    return { ok: false, message: 'Search1API API Key 无效。请到插件详情页更新 Key 后重试。' };
  }
  // 公开错误契约中 402 同时覆盖按次付款挑战和账号 credits 不足;Cindy 会在
  // 已配置时注入 Bearer Key,但这里仍给出同时适用于两种情况的行动指引。
  if (r.status === 402) {
    return {
      ok: false,
      message: 'Search1API 需要完成付款或补充 credits。请前往 Search1API 控制台检查账号余额后重试。',
    };
  }
  if (r.status === 403) {
    return { ok: false, message: 'Search1API 拒绝了请求。请检查账号权限或套餐后重试。' };
  }
  if (r.status === 429) {
    return { ok: false, message: 'Search1API 请求过于频繁。请稍后再试。' };
  }
  if (r.status === 400 || r.status === 422) {
    return { ok: false, message: 'Search1API 未接受本次搜索参数。请换一个搜索关键词后重试。' };
  }
  if (r.status >= 500) {
    return { ok: false, message: 'Search1API 服务暂时不可用。请稍后再试。' };
  }
  if (r.status >= 400 && r.status < 500) {
    return { ok: false, message: 'Search1API 未接受本次请求。请检查账号状态或联系 Search1API 支持。' };
  }
  if (r.status !== 200) {
    return {
      ok: false,
      message: 'Search1API 返回了无法处理的响应。请稍后再试；若问题持续，请联系 Search1API 支持。',
    };
  }

  var data;
  try {
    data = JSON.parse(r.body);
  } catch (_err) {
    return { ok: false, message: 'Search1API 返回了无法解析的响应。请稍后再试。' };
  }
  if (!data || !Array.isArray(data.results)) {
    return { ok: false, message: 'Search1API 返回的结果格式不符合预期。请稍后再试。' };
  }
  var items = data.results;
  return {
    ok: true,
    provider: 'search1api',
    results: items.slice(0, limit).map(function (it) {
      return { title: it.title, url: it.link || it.url || '', snippet: it.snippet || '' };
    }),
  };
}

/** Tavily:POST JSON,key 由主机注入 Authorization: Bearer。 */
async function searchTavily(query, limit) {
  var r = await cindy.fetch({
    url: TAVILY_URL,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: query, max_results: limit }),
  });
  if (!r.ok) return r;
  if (r.status !== 200) return { ok: false, message: 'Tavily 返回 HTTP ' + r.status + ':' + r.body.slice(0, 200) };
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

async function searchWeb(args) {
  var query = args && typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) return { ok: false, message: 'query 不能为空' };
  var limit = clampLimit(args.limit);

  if (args.provider === 'brave') return searchBrave(query, limit);
  if (args.provider === 'tavily') return searchTavily(query, limit);
  if (args.provider === 'search1api') return searchSearch1api(query, limit);

  // 未指定:先 Brave,key 没配再降级 Tavily,再降级 Search1API;都没配把指引合并交卷。
  var brave = await searchBrave(query, limit);
  if (!isKeyMissing(brave)) return brave;
  var tavily = await searchTavily(query, limit);
  if (!isKeyMissing(tavily)) return tavily;
  var s1api = await searchSearch1api(query, limit);
  if (!isKeyMissing(s1api)) return s1api;
  return {
    ok: false,
    message: '三个搜索源的 key 都还没配置。请到 Web Search 插件详情页配置 Brave、Tavily 或 Search1API Key。',
  };
}

cindy.onHostMessage(async function (msg) {
  if (!msg || msg.type !== 'tool-call') return;
  if (msg.tool !== 'search_web') {
    cindy.send({ type: 'tool-result', callId: msg.callId, ok: false, message: '未知工具:' + msg.tool });
    return;
  }
  try {
    var r = await searchWeb(msg.args || {});
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
      cindy.send({ type: 'tool-result', callId: msg.callId, ok: false, message: r.message });
    }
  } catch (err) {
    cindy.send({
      type: 'tool-result',
      callId: msg.callId,
      ok: false,
      message: '搜索失败:' + (err && err.message ? err.message : String(err)),
    });
  }
});
