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
var TAVILY_EXTRACT_URL = 'https://api.tavily.com/extract';
var FETCH_PAGE_MAX_URL_CHARS = 2048;
var FETCH_PAGE_MAX_CONTENT_CHARS = 50000;
var FETCH_PAGE_MAX_RESPONSE_CHARS = 1000000;
var FETCH_PAGE_HOST_TIMEOUT_MS = 55000;

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
    return { ok: false, message: 'Cindy AI 搜索服务暂时不可用，请稍后再试' };
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
    // Fragments are browser-local and may contain OAuth tokens; never disclose them to Tavily.
    parsed.hash = '';
    return parsed.href;
  } catch (e) {
    return null;
  }
}

function tavilyHttpError(status) {
  if (status === 401) {
    return 'Tavily API Key 无效或未配置，请在主界面侧边栏「插件」→「Web Search」详情页检查 Key';
  }
  if (status === 403) return 'Tavily 拒绝了正文读取请求，请检查 API Key 权限或账户状态';
  if (status === 429) return 'Tavily 请求过于频繁，请等待限流恢复后再试';
  if (status === 432 || status === 433) {
    return 'Tavily 额度不足或账户不可用，请在 Tavily 控制台检查额度与账户状态';
  }
  if (status >= 500) return 'Tavily 正文读取服务暂时不可用，请稍后再试';
  return 'Tavily 无法处理这个网页，请确认 URL 可公开访问后再试';
}

function tavilyTransportError(message) {
  var text = typeof message === 'string' ? message : '';
  if (/超时|timeout|abort/i.test(text)) return '网页正文读取超时，请稍后重试或改用 basic 模式';
  if (/凭证|secret|api\s*key|未配置|not configured/i.test(text)) {
    return 'Tavily API Key 未配置，请在主界面侧边栏「插件」→「Web Search」详情页填写 Key';
  }
  return '无法连接 Tavily 正文读取服务，请检查网络后再试';
}

/** Tavily Extract:单 URL 正文读取，Key 仍由主机注入 Authorization:Bearer。 */
async function fetchPage(args, callId) {
  var requestedUrl = parsePublicPageUrl(args && args.url);
  if (!requestedUrl) {
    return { ok: false, message: 'url 必须是最多 2048 字符且不含凭证的公开 HTTP(S) 绝对地址' };
  }
  var depth = args && args.extract_depth === 'advanced' ? 'advanced' : 'basic';
  if (args && args.extract_depth !== undefined && args.extract_depth !== 'basic' && args.extract_depth !== 'advanced') {
    return { ok: false, message: 'extract_depth 只支持 basic / advanced' };
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
  if (r.truncated) return { ok: false, message: 'Tavily 返回的数据过大，无法安全解析，请换一个更具体的网页' };
  if (typeof r.body !== 'string' || r.body.length > FETCH_PAGE_MAX_RESPONSE_CHARS) {
    return { ok: false, message: 'Tavily 返回的数据过大，无法安全解析，请换一个更具体的网页' };
  }

  var data;
  try {
    data = JSON.parse(r.body);
  } catch (e) {
    return { ok: false, message: 'Tavily 返回了无法解析的数据，请稍后再试' };
  }
  if (!data || !Array.isArray(data.results) || !Array.isArray(data.failed_results)) {
    return { ok: false, message: 'Tavily 返回的数据格式异常，请稍后再试' };
  }
  if (data.results.length !== 1) {
    if (data.results.length === 0 && data.failed_results.length > 0) {
      return { ok: false, message: 'Tavily 无法读取这个网页，请确认页面可公开访问后再试' };
    }
    return { ok: false, message: 'Tavily 返回的数据格式异常，请稍后再试' };
  }

  var item = data.results[0];
  var resultUrl = parsePublicPageUrl(item && item.url);
  if (!resultUrl || typeof item.raw_content !== 'string') {
    return { ok: false, message: 'Tavily 返回的数据格式异常，请稍后再试' };
  }
  var content = item.raw_content.trim();
  if (!content) return { ok: false, message: '这个网页没有可读取的正文内容' };
  var contentChars = content.length;
  var truncated = contentChars > FETCH_PAGE_MAX_CONTENT_CHARS;
  if (truncated) content = content.slice(0, FETCH_PAGE_MAX_CONTENT_CHARS);
  return {
    ok: true,
    provider: 'tavily',
    url: resultUrl,
    content: content,
    format: 'markdown',
    extract_depth: depth,
    content_chars: contentChars,
    truncated: truncated,
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
  if (msg.tool !== 'search_web' && msg.tool !== 'fetch_page') {
    cindy.send({ type: 'tool-result', callId: msg.callId, ok: false, message: '未知工具:' + msg.tool });
    return;
  }
  try {
    var r =
      msg.tool === 'fetch_page'
        ? await fetchPage(msg.args || {}, msg.callId)
        : await searchWeb(msg.args || {}, msg.callId, msg.tool);
    if (r.ok) {
      if (msg.tool === 'fetch_page') {
        cindy.send({
          type: 'tool-result',
          callId: msg.callId,
          ok: true,
          result: {
            provider: r.provider,
            url: r.url,
            content: r.content,
            format: r.format,
            extract_depth: r.extract_depth,
            content_chars: r.content_chars,
            truncated: r.truncated,
            content_is_untrusted: true,
          },
        });
        return;
      }
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
      message:
        msg.tool === 'fetch_page'
          ? '网页正文读取失败，请稍后重试'
          : '搜索失败:' + (err && err.message ? err.message : String(err)),
    });
  }
});
