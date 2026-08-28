/**
 * Console official plugin.
 *
 * Console owns authentication, API discovery, schemas, and request execution
 * in its local CLI. This browser-side entry only bridges Cindy tool calls to
 * the package Node worker; it never talks to Console or handles credentials.
 */

/* global BroadcastChannel, cindy, setTimeout */

'use strict';

var SETTINGS_CHANNEL = 'console-cli-settings';
var settingsRequests = Object.create(null);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function fail(message, execution) {
  var result = { ok: false, message: String(message || 'Console CLI 操作失败') };
  if (execution) result.execution = execution;
  return result;
}

function errorFromNode(response, fallback) {
  var error = new Error(response && response.message ? response.message : fallback);
  if (response && response.execution) error.execution = response.execution;
  return error;
}

async function nodeRequest(method, params, options) {
  var request = {
    method: method,
    params: params || {},
    timeoutMs: options && options.timeoutMs ? options.timeoutMs : 30000,
  };
  if (options && options.maxTotalMs) request.maxTotalMs = options.maxTotalMs;
  var response;
  try {
    response = await cindy.node.request(request);
  } catch (error) {
    throw new Error(error && error.message ? error.message : 'Console CLI Worker 调用失败');
  }
  if (!response || response.ok !== true) {
    throw errorFromNode(response, 'Console CLI Worker 调用失败');
  }
  if (!response.result || response.result.ok !== true) {
    throw errorFromNode(response.result, 'Console CLI 操作失败');
  }
  return response.result.result;
}

async function statusResult() {
  try {
    return { ok: true, result: await nodeRequest('console/status', {}, { timeoutMs: 8000 }) };
  } catch (error) {
    return fail(error && error.message ? error.message : 'Console CLI 状态查询失败');
  }
}

async function loginResult(args) {
  try {
    var input = isObject(args) ? args : {};
    var result = await nodeRequest('console/login', {
      ...(input.permission_level !== undefined ? { permission_level: input.permission_level } : {}),
      ...(input.permission_profile !== undefined ? { permission_profile: input.permission_profile } : {}),
    }, { timeoutMs: 60000, maxTotalMs: 660000 });
    await cindy.send({ type: 'notify', text: 'Console CLI 登录成功', tone: 'success' });
    return { ok: true, result: result };
  } catch (error) {
    return fail(error && error.message ? error.message : 'Console CLI 登录失败', error && error.execution);
  }
}

async function discoverResult(args) {
  try {
    var mode = isObject(args) && args.mode !== undefined ? args.mode : 'overview';
    return { ok: true, result: await nodeRequest('console/discover', { mode: mode }, { timeoutMs: 45000 }) };
  } catch (error) {
    return fail(error && error.message ? error.message : 'Console CLI discovery 失败');
  }
}

async function helpResult(args) {
  try {
    var command = isObject(args) && args.command !== undefined ? args.command : undefined;
    return { ok: true, result: await nodeRequest('console/help', command === undefined ? {} : { command: command }, { timeoutMs: 45000 }) };
  } catch (error) {
    return fail(error && error.message ? error.message : 'Console CLI 帮助查询失败');
  }
}

async function schemaResult(args) {
  try {
    var input = isObject(args) ? args : {};
    return { ok: true, result: await nodeRequest('console/schema', {
      command: input.command,
      ...(input.resolve_refs !== undefined ? { resolve_refs: input.resolve_refs } : {}),
    }, { timeoutMs: 60000 }) };
  } catch (error) {
    return fail(error && error.message ? error.message : 'Console CLI schema 查询失败');
  }
}

async function runResult(args) {
  try {
    var input = isObject(args) ? args : {};
    return { ok: true, result: await nodeRequest('console/run', {
      argv: input.argv,
    }, { timeoutMs: 60000, maxTotalMs: 900000 }) };
  } catch (error) {
    return fail(error && error.message ? error.message : 'Console CLI 操作失败', error && error.execution);
  }
}

async function dispatch(message) {
  var args = isObject(message.args) ? message.args : {};
  if (message.tool === 'console_cli_status') return statusResult();
  if (message.tool === 'console_cli_login') return loginResult(args);
  if (message.tool === 'console_cli_discover') return discoverResult(args);
  if (message.tool === 'console_cli_help') return helpResult(args);
  if (message.tool === 'console_cli_schema') return schemaResult(args);
  if (message.tool === 'console_cli_run') return runResult(args);
  return fail('未知工具: ' + String(message.tool || ''));
}

var settingsChannel = typeof BroadcastChannel === 'function'
  ? new BroadcastChannel(SETTINGS_CHANNEL)
  : null;

if (settingsChannel) {
  settingsChannel.onmessage = function onSettingsMessage(event) {
    var message = event && event.data;
    if (!isObject(message) || message.type !== 'settings-request' || typeof message.reqId !== 'string') return;
    if (settingsRequests[message.reqId]) {
      if (settingsRequests[message.reqId].response) settingsChannel.postMessage(settingsRequests[message.reqId].response);
      return;
    }
    var entry = { response: null };
    settingsRequests[message.reqId] = entry;
    var tool = message.action === 'login' ? 'console_cli_login' : 'console_cli_status';
    void dispatch({ tool: tool, args: message.payload || {} })
      .then(function (result) {
        return {
          type: 'settings-result',
          reqId: message.reqId,
          ok: result.ok,
          ...(result.ok ? { result: result.result } : { message: result.message }),
        };
      })
      .catch(function (error) {
        return { type: 'settings-result', reqId: message.reqId, ok: false, message: error.message };
      })
      .then(function (response) {
        entry.response = response;
        settingsChannel.postMessage(response);
        setTimeout(function () {
          if (settingsRequests[message.reqId] === entry) delete settingsRequests[message.reqId];
        }, 5000);
      });
  };
}

cindy.onHostMessage(function onHostMessage(message) {
  if (!message || message.type !== 'tool-call') return;
  void (async function () {
    var result;
    try {
      result = await dispatch(message);
    } catch (error) {
      result = fail(error && error.message ? error.message : 'Console CLI 工具执行失败');
    }
    if (result.ok) {
      await cindy.send({ type: 'tool-result', callId: message.callId, ok: true, result: result.result });
    } else {
      await cindy.send({
        type: 'tool-result',
        callId: message.callId,
        ok: false,
        message: result.message,
        ...(result.execution ? { execution: result.execution } : {}),
      });
    }
  }());
});
