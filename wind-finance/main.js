/**
 * Wind Finance · Cindy 官方只读金融数据插件。
 *
 * 这一版使用 Cindy 的 network.connections 通道连接用户提供的万得官方
 * HTTPS API 或企业 API 网关。主机负责域名放行和凭证注入；token 不经过
 * Agent 参数、日志或本文件。HTTP 适配协议约定为:
 *   GET  /v1/status
 *   POST /v1/quote
 *   POST /v1/company
 *
 * 这些接口只读。插件不会调用网页、不会调用本地 WindPy，也不会执行交易。
 */

/* global cindy, BroadcastChannel */

var CONNECTION_KEY = 'wind_finance_conn';
var API_PREFIX = '/v1';
var MAX_BODY_CHARS = 50 * 1000;

function fail(message) {
  return { ok: false, message: message };
}

function connectionLabel(connection) {
  return connection && (connection.host || connection.label || connection.id) || '万得 API';
}

function resolveRequestedConnection(connections, requested) {
  if (!Array.isArray(connections) || connections.length === 0) {
    return { err: '尚未配置万得 API 连接——请到插件详情页添加官方 HTTPS API 或企业 API 网关域名和 API 凭证' };
  }
  if (requested) {
    var wanted = String(requested).replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
    for (var i = 0; i < connections.length; i++) {
      if (connections[i].id === requested || connections[i].host === wanted) return connections[i];
    }
    return { err: '找不到指定的万得 API 连接:' + requested };
  }
  for (var j = 0; j < connections.length; j++) {
    if (connections[j].isDefault) return connections[j];
  }
  return connections.length === 1
    ? connections[0]
    : { err: '配置了多个万得 API 连接且没有默认连接——请在参数 connection 中指定连接 id 或 host' };
}

async function resolveConnection(requested) {
  var list;
  try {
    list = await (await fetch('/connections')).json();
  } catch (err) {
    return { err: '读取万得 API 连接配置失败:' + (err && err.message ? err.message : String(err)) };
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
  var connection = resolveRequestedConnection(slot && slot.connections, requested);
  if (connection && connection.err) return connection;
  return { connection: connection };
}

function baseUrl(connection) {
  return 'https://' + connection.host + API_PREFIX;
}

function bodySnippet(body) {
  return typeof body === 'string' ? body.slice(0, 300) : '';
}

function classifyStatus(status, body) {
  if (status === 401) return '万得 API 凭证未配置或已失效，请到插件详情页重新填写 API 凭证';
  if (status === 403) return '万得账号没有当前数据权限，或该接口未开通，请联系万得账号管理员';
  if (status === 404) return '万得 API 地址或接口路径不兼容，请确认使用的是官方 HTTP API/企业网关适配协议';
  if (status === 429) return '万得 API 请求过于频繁，已触发限流，请稍后重试';
  if (status >= 400 && status < 500) return '万得 API 拒绝了请求参数(HTTP ' + status + '):' + bodySnippet(body);
  if (status >= 500) return '万得 API 服务暂时不可用(HTTP ' + status + '):' + bodySnippet(body);
  return '万得 API 返回 HTTP ' + status + ':' + bodySnippet(body);
}

async function api(connection, path, options) {
  var opts = options || {};
  var request = {
    url: baseUrl(connection) + path,
    method: opts.method || 'GET',
    headers: {
      Accept: 'application/json',
      'X-Cindy-Wind-Plugin': '0.1',
    },
    callId: opts.callId,
  };
  if (opts.body !== undefined) {
    request.headers['Content-Type'] = 'application/json';
    request.body = JSON.stringify(opts.body);
  }
  var response;
  try {
    response = await cindy.fetch(request);
  } catch (err) {
    return { err: '连接万得 API 失败，请确认网络和插件详情页中的服务域名:' + (err && err.message ? err.message : String(err)) };
  }
  if (!response || !response.ok) {
    return { err: response && response.message || '连接万得 API 失败，请稍后重试' };
  }
  if (response.status < 200 || response.status >= 300) {
    return { err: classifyStatus(response.status, response.body) };
  }
  var data = null;
  if (response.body) {
    try {
      data = JSON.parse(response.body);
    } catch (err) {
      return { err: '万得 API 返回的不是合法 JSON，请确认连接的是 HTTP API 而不是网页或本地客户端' };
    }
  }
  return { data: data, status: response.status, connection: connection };
}

function stringList(value, label, max) {
  var values = Array.isArray(value) ? value : String(value || '').split(',');
  var normalized = values.map(function (item) { return String(item || '').trim(); }).filter(Boolean);
  if (!normalized.length) return { err: label + '不能为空' };
  if (normalized.length > max) return { err: label + '最多支持 ' + max + ' 个' };
  for (var i = 0; i < normalized.length; i++) {
    if (normalized[i].length > 100) return { err: label + '中的单项过长' };
  }
  return { values: normalized };
}

function normalizeFields(value) {
  if (value === undefined || value === null || value === '') return { values: undefined };
  return stringList(value, 'fields', 30);
}

function slimResult(data) {
  var text = JSON.stringify(data === undefined ? null : data);
  if (text.length <= MAX_BODY_CHARS) return { data: data };
  return {
    truncated: true,
    preview: text.slice(0, MAX_BODY_CHARS),
    hint: '响应过大已截断，请减少 symbols 或 fields 后重试',
  };
}

async function getConnections() {
  var r = await resolveConnection(null);
  return r;
}

async function windStatus(args, callId) {
  var r = await resolveConnection(args && args.connection);
  if (r.err) return fail(r.err);
  var response = await api(r.connection, '/status', { callId: callId });
  if (response.err) return fail(response.err);
  return { ok: true, result: { connection: connectionLabel(r.connection), status: response.data } };
}

async function windQuote(args, callId) {
  var symbols = stringList(args && args.symbols, 'symbols', 50);
  if (symbols.err) return fail(symbols.err);
  var fields = normalizeFields(args && args.fields);
  if (fields.err) return fail(fields.err);
  var r = await resolveConnection(args && args.connection);
  if (r.err) return fail(r.err);
  var response = await api(r.connection, '/quote', {
    method: 'POST',
    body: {
      symbols: symbols.values,
      fields: fields.values,
      asOf: args && args.asOf ? String(args.asOf).trim() : undefined,
    },
    callId: callId,
  });
  if (response.err) return fail(response.err);
  return { ok: true, result: { connection: connectionLabel(r.connection), data: slimResult(response.data) } };
}

async function windCompany(args, callId) {
  var symbol = String(args && args.symbol || '').trim();
  if (!symbol) return fail('symbol 不能为空');
  if (symbol.length > 100) return fail('symbol 过长');
  var fields = normalizeFields(args && args.fields);
  if (fields.err) return fail(fields.err);
  var r = await resolveConnection(args && args.connection);
  if (r.err) return fail(r.err);
  var response = await api(r.connection, '/company', {
    method: 'POST',
    body: { symbol: symbol, fields: fields.values },
    callId: callId,
  });
  if (response.err) return fail(response.err);
  return { ok: true, result: { connection: connectionLabel(r.connection), data: slimResult(response.data) } };
}

var handlers = {
  wind_status: windStatus,
  wind_quote: windQuote,
  wind_company: windCompany,
};

async function handleToolCall(message) {
  if (!message || message.type !== 'tool-call') return;
  var handler = handlers[message.tool];
  if (!handler) {
    cindy.send({ type: 'tool-result', callId: message.callId, ok: false, message: '未知工具:' + message.tool });
    return;
  }
  try {
    var result = await handler(message.args || {}, message.callId);
    if (result.ok) {
      cindy.send({ type: 'tool-result', callId: message.callId, ok: true, result: result.result });
    } else {
      cindy.send({ type: 'tool-result', callId: message.callId, ok: false, message: result.message });
    }
  } catch (err) {
    cindy.send({
      type: 'tool-result',
      callId: message.callId,
      ok: false,
      message: '万得数据查询失败:' + (err && err.message ? err.message : String(err)),
    });
  }
}

async function handleConnectionTest(message) {
  if (!message || message.type !== 'test-connection') return;
  var result = await windStatus({ connection: message.connectionId }, message.reqId);
  var payload = {
    type: 'test-connection-result',
    reqId: message.reqId,
    connectionId: message.connectionId,
    ok: Boolean(result.ok),
  };
  if (result.ok) {
    payload.host = result.result.connection;
    payload.message = '连接成功';
    try {
      var kv = await (await fetch('/kv')).json();
      if (!kv || typeof kv !== 'object') kv = {};
      if (!kv.connectedUsers || typeof kv.connectedUsers !== 'object') kv.connectedUsers = {};
      kv.connectedUsers[message.connectionId] = result.result.connection;
      await fetch('/kv', { method: 'PUT', body: JSON.stringify(kv) });
    } catch (err) {
      // 连接已经成功，用户名展示缓存失败不影响测试结果。
    }
  } else {
    payload.message = result.message;
  }
  var bc = new BroadcastChannel('wind-finance');
  bc.postMessage(payload);
  bc.close();
  if (result.ok) {
    await cindy.send({ type: 'notify', text: '万得 API 连接成功:' + payload.host, tone: 'success' });
  }
}

cindy.onHostMessage(function (message) {
  if (message && message.type === 'tool-call') return handleToolCall(message);
  if (message && message.type === 'test-connection') return handleConnectionTest(message);
  return undefined;
});

if (typeof module !== 'undefined') {
  module.exports = {
    classifyStatus,
    normalizeFields,
    resolveRequestedConnection,
    slimResult,
    stringList,
  };
}
