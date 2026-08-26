/**
 * Console official plugin.
 *
 * The Console CLI already publishes an allowlisted command manifest. This
 * plugin consumes that manifest directly through Cindy's network proxy, so it
 * does not ship the CLI binary and never receives the API token bytes.
 */

/* global BroadcastChannel, cindy, fetch, URL */

'use strict';

var CONNECTION_KEY = 'console_conn';
var MANIFEST_PATH = '/api/v1/cli/manifest';
var MANIFEST_TTL_MS = 12 * 60 * 60 * 1000;
var MAX_COMMANDS = 512;
var MAX_RESPONSE_CHARS = 50000;
var MUTATING_METHODS = { POST: true, PUT: true, PATCH: true, DELETE: true };
var manifestCache = Object.create(null);
var manifestLoads = Object.create(null);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function has(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function fail(message, execution) {
  var result = { ok: false, message: String(message || 'Console 操作失败') };
  if (execution) result.execution = execution;
  return result;
}

function connectionExecution(message) {
  return fail(message, 'not_executed');
}

function trimBody(body) {
  if (typeof body === 'string') return body.length > MAX_RESPONSE_CHARS ? body.slice(0, MAX_RESPONSE_CHARS) : body;
  if (body === undefined || body === null) return '';
  try {
    var text = JSON.stringify(body);
    return text.length > MAX_RESPONSE_CHARS ? text.slice(0, MAX_RESPONSE_CHARS) : text;
  } catch (_error) {
    return String(body).slice(0, MAX_RESPONSE_CHARS);
  }
}

function responseMessage(response, fallback) {
  var body = trimBody(response && response.body);
  var status = response && response.status ? 'HTTP ' + response.status : '';
  var hint = '';
  if (response && response.status === 401) hint = '；请到插件详情页更新 Console API Token';
  if (response && response.status === 403) hint = '；当前 Token 没有执行该操作所需的 Console 权限';
  return (fallback || 'Console 请求失败') + (status ? ' (' + status + ')' : '') + hint + (body ? ': ' + body : '');
}

async function proxyRequest(request) {
  try {
    var response = await cindy.fetch(request);
    if (!response || (response.ok !== true && response.status !== 304)) {
      return { ok: false, response: response, message: responseMessage(response, '主机未能发出 Console 请求') };
    }
    return { ok: true, response: response };
  } catch (error) {
    return {
      ok: false,
      response: null,
      message: 'Console 请求未完成: ' + (error && error.message ? error.message : String(error)),
    };
  }
}

function parseResponseBody(response) {
  var raw = response && response.body;
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch (_error) {
    throw new Error('Console 返回的不是合法 JSON');
  }
}

function unwrapApiEnvelope(response) {
  var parsed = parseResponseBody(response);
  if (isObject(parsed) && typeof parsed.code === 'number' && parsed.code !== 0) {
    throw new Error('Console API 错误 ' + parsed.code + ': ' + String(parsed.message || parsed.msg || '服务端拒绝请求').slice(0, 500));
  }
  if (isObject(parsed) && has(parsed, 'data')) return parsed.data;
  return parsed;
}

function normalizeConnectionHost(value) {
  var host = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!host || !/^[a-z0-9.-]+$/.test(host)) return '';
  var labels = host.split('.');
  if (labels.some(function (label) {
    return !label || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label);
  })) return '';
  return host;
}

async function listConnections() {
  try {
    var response = await fetch('/connections');
    if (!response.ok) throw new Error('读取 Console 连接失败');
    var value = await response.json();
    if (!Array.isArray(value)) return [];
    for (var i = 0; i < value.length; i += 1) {
      if (value[i] && value[i].key === CONNECTION_KEY) {
        return Array.isArray(value[i].connections) ? value[i].connections : [];
      }
    }
    return [];
  } catch (error) {
    throw new Error(error && error.message ? error.message : '读取 Console 连接失败');
  }
}

async function resolveConnection(args) {
  var connections = await listConnections();
  if (connections.length === 0) {
    return { error: '尚未配置 Console 实例，请到插件详情页添加 HTTPS 域名和 API Token' };
  }
  var requested = args && args.instance !== undefined ? String(args.instance).trim() : '';
  if (requested) {
    var wantedHost = normalizeConnectionHost(requested.replace(/^https?:\/\//i, '').replace(/\/+$/, ''));
    for (var i = 0; i < connections.length; i += 1) {
      if (connections[i] && (connections[i].id === requested || connections[i].host === wantedHost)) {
        return { connection: connections[i] };
      }
    }
    return { error: '找不到指定 Console 实例: ' + requested };
  }
  for (var j = 0; j < connections.length; j += 1) {
    if (connections[j] && connections[j].isDefault) return { connection: connections[j] };
  }
  if (connections.length === 1) return { connection: connections[0] };
  return { error: '配置了多个 Console 实例，请在参数中传 instance 指定连接' };
}

function commandId(command) {
  if (!command || !Array.isArray(command.command_path)) return '';
  return command.command_path.join('.');
}

function validCommandPath(commandPath) {
  return Array.isArray(commandPath) && commandPath.length > 0 && commandPath.length <= 8
    && commandPath.every(function (part) { return typeof part === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(part); });
}

function validateCommand(entry) {
  if (!isObject(entry) || !validCommandPath(entry.command_path)) return 'Console manifest 含非法 command path';
  if (typeof entry.path !== 'string' || !entry.path.startsWith('/api/v1/') || entry.path.includes('://') || entry.path.includes('?') || entry.path.includes('#') || entry.path.includes('..')) {
    return 'Console manifest 含不安全 API path';
  }
  var method = String(entry.http_method || 'GET').toUpperCase();
  if (!/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(method)) return 'Console manifest 含不支持的 HTTP method';
  if (entry.params !== undefined && !Array.isArray(entry.params)) return 'Console manifest 参数定义无效';
  var seen = Object.create(null);
  for (var i = 0; i < (entry.params || []).length; i += 1) {
    var param = entry.params[i];
    if (!isObject(param) || typeof param.name !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(param.name) || !/^(path|query)$/.test(param.in)) {
      return 'Console manifest 含非法参数定义';
    }
    if (seen[param.name]) return 'Console manifest 含重复参数';
    seen[param.name] = true;
  }
  if (entry.request_body !== undefined && !isObject(entry.request_body)) return 'Console manifest request body 定义无效';
  return null;
}

function normalizeManifest(raw) {
  if (!isObject(raw) || raw.manifest_version !== 'v2' || !Array.isArray(raw.commands) || raw.commands.length > MAX_COMMANDS) {
    return { error: 'Console CLI manifest 版本或命令数量不受支持' };
  }
  var commands = [];
  var seen = Object.create(null);
  for (var i = 0; i < raw.commands.length; i += 1) {
    var entry = raw.commands[i];
    var error = validateCommand(entry);
    if (error) return { error: error };
    var id = commandId(entry);
    if (seen[id] || id !== entry.id) return { error: 'Console manifest command id 不一致或重复' };
    seen[id] = true;
    commands.push(entry);
  }
  return { manifest: { manifest_version: 'v2', server_version: raw.server_version || '', etag: raw.etag || '', commands: commands } };
}

async function loadManifest(connection) {
  var host = normalizeConnectionHost(connection && connection.host);
  if (!host) return { error: 'Console 实例地址无效' };
  var key = String(connection.id || host);
  var cached = manifestCache[key];
  if (cached && Date.now() - cached.loadedAt < MANIFEST_TTL_MS) return { manifest: cached.manifest, connection: connection };
  if (manifestLoads[key]) return manifestLoads[key];

  manifestLoads[key] = (async function () {
    var headers = { Accept: 'application/json' };
    if (cached && cached.etag) headers['If-None-Match'] = cached.etag;
    var request = await proxyRequest({
      url: 'https://' + host + MANIFEST_PATH,
      method: 'GET',
      headers: headers,
    });
    if (!request.ok) return { error: request.message };
    var response = request.response;
    if (response.status === 304 && cached) {
      cached.loadedAt = Date.now();
      return { manifest: cached.manifest, connection: connection };
    }
    if (response.status < 200 || response.status >= 300) return { error: responseMessage(response, '读取 Console CLI manifest 失败') };
    var raw;
    try {
      raw = unwrapApiEnvelope(response);
    } catch (error) {
      return { error: error.message };
    }
    var normalized = normalizeManifest(raw);
    if (normalized.error) return normalized;
    manifestCache[key] = {
      loadedAt: Date.now(),
      etag: response.headers && (response.headers.etag || response.headers.ETag) || normalized.manifest.etag,
      manifest: normalized.manifest,
    };
    return { manifest: normalized.manifest, connection: connection };
  })();
  try {
    return await manifestLoads[key];
  } finally {
    delete manifestLoads[key];
  }
}

function describeCommand(entry, includeSchema) {
  var params = (entry.params || []).map(function (param) {
    return {
      name: param.name,
      in: param.in,
      required: param.required === true,
      type: param.type || 'string',
      description: param.description || '',
    };
  });
  return {
    id: commandId(entry),
    category: entry.command_path[0],
    summary: entry.summary || entry.description || '',
    description: entry.description || entry.summary || '',
    method: String(entry.http_method || 'GET').toUpperCase(),
    path: entry.path,
    params: params,
    request_body: entry.request_body ? {
      required: entry.request_body.required === true,
      content_type: entry.request_body.content_type || 'application/json',
      description: entry.request_body.description || '',
      ...(includeSchema && entry.request_body.schema !== undefined ? { schema: entry.request_body.schema } : {}),
    } : null,
    constraints: entry.cli_constraints || null,
  };
}

async function listTools(args) {
  var resolved = await resolveConnection(args);
  if (resolved.error) return connectionExecution(resolved.error);
  var loaded = await loadManifest(resolved.connection);
  if (loaded.error) return connectionExecution(loaded.error);
  var category = args && typeof args.category === 'string' ? args.category.trim() : '';
  var commands = loaded.manifest.commands.filter(function (entry) {
    return !category || entry.command_path[0] === category;
  });
  if (category && commands.length === 0) return connectionExecution('Console manifest 中不存在类目: ' + category);
  var categories = Object.create(null);
  loaded.manifest.commands.forEach(function (entry) {
    var name = entry.command_path[0];
    if (!categories[name]) categories[name] = { count: 0, commands: [] };
    categories[name].count += 1;
    categories[name].commands.push(commandId(entry));
  });
  return {
    ok: true,
    result: {
      instance: resolved.connection.host,
      manifest_version: loaded.manifest.manifest_version,
      server_version: loaded.manifest.server_version,
      categories: category ? undefined : categories,
      commands: commands.map(function (entry) { return describeCommand(entry, Boolean(category)); }),
      hint: category ? '使用 call_tool({ name, params, body }) 执行其中一个命令；写操作失败时请先查看 execution。' : '传 category 查看命令详情；执行用 call_tool，命令面来自当前 Console manifest。',
    },
  };
}

function findCommand(manifest, name) {
  var target = String(name || '').trim();
  for (var i = 0; i < manifest.commands.length; i += 1) {
    if (manifest.commands[i].id === target || commandId(manifest.commands[i]) === target) return manifest.commands[i];
  }
  return null;
}

function stringifyParam(value, param) {
  if (value === null || value === undefined || value === '') {
    if (param.required) throw new Error('缺少必填参数 ' + param.name);
    return { present: false, value: '' };
  }
  if (param.type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error('参数 ' + param.name + ' 必须是 boolean');
    return { present: true, value: value ? 'true' : 'false' };
  }
  if (typeof value === 'object') throw new Error('参数 ' + param.name + ' 必须是字符串、数字或 boolean');
  return { present: true, value: String(value) };
}

function buildCommandRequest(connection, entry, args, callId) {
  var params = args.params === undefined ? {} : args.params;
  if (!isObject(params)) throw new Error('params 必须是对象');
  var declared = Object.create(null);
  var path = entry.path;
  var query = [];
  for (var i = 0; i < (entry.params || []).length; i += 1) {
    var param = entry.params[i];
    declared[param.name] = true;
    var value = stringifyParam(params[param.name], param);
    if (!value.present) continue;
    if (param.in === 'path') {
      var marker = '{' + param.name + '}';
      if (path.indexOf(marker) < 0) throw new Error('manifest path 缺少参数 ' + param.name);
      path = path.split(marker).join(encodeURIComponent(value.value));
    } else {
      query.push(encodeURIComponent(param.name) + '=' + encodeURIComponent(value.value));
    }
  }
  Object.keys(params).forEach(function (name) {
    if (!declared[name]) throw new Error('未知参数 ' + name + '，请先调用 list_tools');
  });
  if (entry.cli_constraints && isObject(entry.cli_constraints.params)) {
    Object.keys(entry.cli_constraints.params).forEach(function (name) {
      var constraint = entry.cli_constraints.params[name];
      if (!isObject(constraint) || !constraint.disallow_true || params[name] !== true) return;
      throw new Error((constraint.note || ('参数 ' + name + ' 不允许为 true')));
    });
  }
  if (/\{[a-zA-Z][a-zA-Z0-9_-]*\}/.test(path)) throw new Error('缺少 path 参数');
  var body = undefined;
  if (args.body !== undefined) {
    if (!entry.request_body) throw new Error('该命令没有声明 request body，不能传 body');
    try { body = JSON.stringify(args.body); } catch (_error) { throw new Error('body 不是合法 JSON'); }
    if (body === undefined) throw new Error('body 不是合法 JSON');
  } else if (entry.request_body && entry.request_body.required === true) {
    throw new Error('该命令要求提供 body');
  }
  var method = String(entry.http_method || 'GET').toUpperCase();
  var url = 'https://' + normalizeConnectionHost(connection.host) + path;
  if (query.length) url += '?' + query.join('&');
  var request = { url: url, method: method, headers: { Accept: 'application/json' }, callId: callId };
  if (body !== undefined) {
    request.body = body;
    request.headers['Content-Type'] = entry.request_body.content_type || 'application/json';
  }
  return request;
}

async function callTool(args, callId) {
  var name = args && typeof args.name === 'string' ? args.name.trim() : '';
  if (!name) return connectionExecution('需要 name；请先调用 list_tools 查询当前 Console 操作');
  var resolved;
  try {
    resolved = await resolveConnection(args);
  } catch (error) {
    return connectionExecution(error.message);
  }
  if (resolved.error) return connectionExecution(resolved.error);
  var loaded = await loadManifest(resolved.connection);
  if (loaded.error) return connectionExecution(loaded.error);
  var entry = findCommand(loaded.manifest, name);
  if (!entry) return connectionExecution('未知 Console 操作: ' + name + '；请先调用 list_tools');
  var mutating = MUTATING_METHODS[String(entry.http_method || 'GET').toUpperCase()] === true;
  var request;
  try {
    request = buildCommandRequest(resolved.connection, entry, args || {}, callId);
  } catch (error) {
    return fail(error.message, mutating ? 'not_executed' : undefined);
  }
  var sent = await proxyRequest(request);
  if (!sent.ok) return fail(sent.message, mutating ? 'unknown' : undefined);
  if (sent.response.status < 200 || sent.response.status >= 300) {
    return fail(responseMessage(sent.response, 'Console 操作失败'), mutating ? 'unknown' : undefined);
  }
  var data;
  try {
    data = unwrapApiEnvelope(sent.response);
  } catch (error) {
    return fail(error.message, mutating ? 'unknown' : undefined);
  }
  return {
    ok: true,
    result: {
      execution: mutating ? 'executed' : 'not_applicable',
      command: commandId(entry),
      instance: resolved.connection.host,
      data: data,
    },
  };
}

var channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('console-cli') : null;
var seenTestRequests = Object.create(null);

if (channel) {
  channel.onmessage = function onMessage(event) {
    var message = event && event.data;
    if (!isObject(message) || message.type !== 'test-connection' || typeof message.reqId !== 'string') return;
    if (seenTestRequests[message.reqId]) return;
    seenTestRequests[message.reqId] = true;
    void (async function () {
      var result = await listTools(message.instance ? { instance: message.instance } : {});
      if (result.ok) {
        channel.postMessage({ type: 'test-connection-result', reqId: message.reqId, ok: true, host: result.result.instance, count: result.result.commands.length });
        void cindy.send({ type: 'notify', text: 'Console 连接成功: ' + result.result.instance, tone: 'success' });
      } else {
        channel.postMessage({ type: 'test-connection-result', reqId: message.reqId, ok: false, message: result.message });
        void cindy.send({ type: 'notify', text: 'Console 连接测试失败: ' + result.message.slice(0, 160), tone: 'error' });
      }
    }());
  };
}

cindy.onHostMessage(async function onHostMessage(message) {
  if (!message || message.type !== 'tool-call') return;
  var executionState = 'not_executed';
  try {
    var result;
    if (message.tool === 'list_tools') result = await listTools(message.args || {});
    else if (message.tool === 'call_tool') result = await callTool(message.args || {}, message.callId);
    else result = fail('未知工具: ' + String(message.tool || ''));
    if (result.ok) {
      if (result.result && result.result.execution) executionState = result.result.execution;
      await cindy.send({ type: 'tool-result', callId: message.callId, ok: true, result: result.result });
    } else {
      executionState = result.execution || executionState;
      await cindy.send({ type: 'tool-result', callId: message.callId, ok: false, message: result.message, ...(result.execution ? { execution: result.execution } : {}) });
    }
  } catch (error) {
    await cindy.send({ type: 'tool-result', callId: message.callId, ok: false, message: 'Console 工具执行失败: ' + (error && error.message ? error.message : String(error)), execution: executionState });
  }
});
