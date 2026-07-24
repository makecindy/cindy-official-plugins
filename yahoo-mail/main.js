/**
 * Yahoo Mail 官方插件。
 *
 * 应用密码由设置页直接写入 Cindy 的 /secrets 只写通道。浏览器 main.js 只处理
 * 非敏感邮箱地址；宿主仅在 ghost.json 绑定的 Node 方法上，把应用密码临时注入
 * 对应 Worker 的 request.cindy.secrets，Agent 参数和插件消息都不携带它。
 */

/* global BroadcastChannel, cindy, fetch, setTimeout */

var SETTINGS_CHANNEL = 'yahoo-mail-settings';
var SECRET_KEY = 'yahoo_mail_app_password';
var settingsRequests = new Map();

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function fail(message) {
  return { ok: false, message: message };
}

function normalizeEmail(value) {
  var email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error('请输入有效的 Yahoo 邮箱地址');
  }
  return email;
}

async function readJson(path) {
  var response = await fetch(path);
  if (!response.ok) throw new Error('读取 Yahoo Mail 配置失败');
  var value = await response.json();
  return value;
}

async function loadAccountState() {
  var values = await Promise.all([readJson('/kv'), readJson('/secrets')]);
  var kv = isObject(values[0]) ? values[0] : {};
  var secretItems = Array.isArray(values[1]) ? values[1] : [];
  var email = typeof kv.email === 'string' ? kv.email.trim().toLowerCase() : '';
  var secretSaved = secretItems.some(function hasSavedSecret(item) {
    return isObject(item) && item.key === SECRET_KEY && item.saved === true;
  });
  return {
    connected: Boolean(email && secretSaved),
    email: email || null,
    persistence: 'cindy-safe-storage',
  };
}

async function requireConfiguredEmail() {
  var state = await loadAccountState();
  if (!state.connected || !state.email) {
    throw new Error('尚未配置 Yahoo Mail，请到「Yahoo Mail」插件详情页完成连接');
  }
  return state.email;
}

async function nodeRequest(method, params, timeoutMs) {
  var response = await cindy.node.request({
    method: method,
    params: params,
    timeoutMs: timeoutMs || 30000,
  });
  if (!response || response.ok !== true) {
    throw new Error(response && response.message
      ? response.message
      : 'Yahoo Mail Worker 调用失败，请稍后重试');
  }
  return response.result;
}

async function handleSettingsRequest(action, payload) {
  if (action !== 'connect') throw new Error('未知设置动作');
  var email = normalizeEmail(payload.email);
  return nodeRequest('account/connect', { email: email }, 45000);
}

var settingsChannel = typeof BroadcastChannel === 'function'
  ? new BroadcastChannel(SETTINGS_CHANNEL)
  : null;

if (settingsChannel) {
  settingsChannel.onmessage = function onSettingsMessage(event) {
    var message = event && event.data;
    if (
      !isObject(message)
      || message.type !== 'settings-request'
      || typeof message.reqId !== 'string'
      || typeof message.action !== 'string'
    ) {
      return;
    }

    var existing = settingsRequests.get(message.reqId);
    if (existing) {
      if (existing.response) settingsChannel.postMessage(existing.response);
      return;
    }

    var entry = { response: null };
    settingsRequests.set(message.reqId, entry);
    var payload = isObject(message.payload) ? message.payload : {};
    void handleSettingsRequest(message.action, payload)
      .then(function success(result) {
        return { type: 'settings-result', reqId: message.reqId, ok: true, result: result };
      })
      .catch(function failure(error) {
        return {
          type: 'settings-result',
          reqId: message.reqId,
          ok: false,
          message: error && error.message ? error.message : 'Yahoo Mail 连接失败，请重试',
        };
      })
      .then(function reply(response) {
        entry.response = response;
        settingsChannel.postMessage(response);
        setTimeout(function releaseRequest() {
          if (settingsRequests.get(message.reqId) === entry) settingsRequests.delete(message.reqId);
        }, 5000);
      });
  };
}

function validateUid(value) {
  var uid = Number(value);
  if (!Number.isInteger(uid) || uid <= 0) throw new Error('message_uid 必须是有效的正整数');
  return uid;
}

function sanitizeMailArgs(args) {
  var action = typeof args.action === 'string' ? args.action : '';
  var allowed = {
    list_folders: true,
    search: true,
    read: true,
    send: true,
    draft: true,
    mark_read: true,
    mark_unread: true,
    move: true,
  };
  if (!allowed[action]) throw new Error('未知 action：' + action);

  var output = { action: action };
  var folder = typeof args.folder === 'string' && args.folder.trim()
    ? args.folder.trim()
    : 'INBOX';
  output.folder = folder;

  if (action === 'read' || action === 'mark_read' || action === 'mark_unread' || action === 'move') {
    output.message_uid = validateUid(args.message_uid);
  }
  if (action === 'move') {
    if (typeof args.target_folder !== 'string' || !args.target_folder.trim()) {
      throw new Error('move 需要 target_folder；请先调用 list_folders');
    }
    output.target_folder = args.target_folder.trim();
  }

  if (action === 'search') {
    ['text', 'from', 'to', 'subject', 'since', 'before'].forEach(function copyString(key) {
      if (typeof args[key] === 'string' && args[key].trim()) output[key] = args[key].trim();
    });
    if (typeof args.unread === 'boolean') output.unread = args.unread;
    var max = Number(args.max_results);
    output.max_results = Number.isFinite(max) ? Math.min(20, Math.max(1, Math.floor(max))) : 10;
  }

  if (action === 'send' || action === 'draft') {
    if (args.to === undefined || typeof args.subject !== 'string' || typeof args.body_text !== 'string') {
      throw new Error(action + ' 需要 to、subject 和 body_text');
    }
    output.to = args.to;
    if (args.cc !== undefined) output.cc = args.cc;
    if (args.bcc !== undefined) output.bcc = args.bcc;
    output.subject = args.subject;
    output.body_text = args.body_text;
  }

  return output;
}

async function runMail(args) {
  var action;
  try {
    action = sanitizeMailArgs(args);
  } catch (error) {
    return fail(error && error.message ? error.message : 'Yahoo Mail 参数无效');
  }

  try {
    var email = await requireConfiguredEmail();
    var result = await nodeRequest('mail/action', {
      email: email,
      action: action,
    }, action.action === 'send' || action.action === 'draft' ? 60000 : 45000);
    return { ok: true, result: result };
  } catch (error) {
    return fail(error && error.message ? error.message : 'Yahoo Mail 操作失败，请稍后重试');
  }
}

async function statusResult() {
  try {
    return { ok: true, result: await loadAccountState() };
  } catch (error) {
    return fail(error && error.message ? error.message : 'Yahoo Mail 连接状态查询失败');
  }
}

cindy.onHostMessage(function onHostMessage(message) {
  if (!message || message.type !== 'tool-call') return;
  void (async function dispatch() {
    try {
      var result = message.tool === 'yahoo_mail_status'
        ? await statusResult()
        : message.tool === 'yahoo_mail'
          ? await runMail(isObject(message.args) ? message.args : {})
          : fail('未知工具：' + message.tool);
      if (result.ok) {
        await cindy.send({
          type: 'tool-result',
          callId: message.callId,
          ok: true,
          result: result.result,
        });
      } else {
        await cindy.send({
          type: 'tool-result',
          callId: message.callId,
          ok: false,
          message: result.message,
        });
      }
    } catch (error) {
      await cindy.send({
        type: 'tool-result',
        callId: message.callId,
        ok: false,
        message: error && error.message ? error.message : 'Yahoo Mail 工具执行失败',
      });
    }
  })();
});
