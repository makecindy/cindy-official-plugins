/* global cindy */

var SECRET_KEY = 'gmail_account';
var PLUGIN_NAME = 'Gmail';
var BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

function fail(message) {
  return { ok: false, message: message };
}

function clampInt(value, fallback, max) {
  var n = typeof value === 'number' && isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(1, n));
}

async function api(opts) {
  var request = {
    url: opts.url,
    method: opts.method || 'GET',
    headers: { Accept: 'application/json' },
    callId: opts.callId,
  };
  if (opts.account) request.authAccount = opts.account;
  if (opts.body !== undefined) {
    request.headers['Content-Type'] = 'application/json';
    request.body = JSON.stringify(opts.body);
  }
  var response = await cindy.fetch(request);
  if (!response.ok) return { err: response.message };
  var data = null;
  if (response.body) {
    try {
      data = JSON.parse(response.body);
    } catch (_err) {
      return { err: 'Google 返回了无法解析的响应(HTTP ' + response.status + ')' };
    }
  }
  if (response.status < 200 || response.status >= 300) {
    var message = data && data.error && data.error.message
      ? data.error.message
      : (response.body || '').slice(0, 200);
    return { err: 'Gmail API 返回 HTTP ' + response.status + ':' + message };
  }
  return { data: data };
}

async function listAccounts() {
  var response = await fetch('/oauth');
  if (!response.ok) return fail('账号状态查询失败(' + response.status + ')');
  var list = await response.json();
  var entry = list.find(function (item) { return item && item.key === SECRET_KEY; });
  if (!entry || !entry.clientConfigured) {
    return fail('内置应用身份缺失，请升级 Cindy 后重试');
  }
  if (!entry.accounts.length) {
    return fail('尚未连接 Gmail 账号，请到「' + PLUGIN_NAME + '」详情页单独授权');
  }
  return {
    ok: true,
    result: {
      accounts: entry.accounts.map(function (account) {
        return {
          id: account.id,
          email: account.label,
          status: account.status,
          is_default: account.isDefault,
        };
      }),
    },
  };
}

function b64urlUtf8(text) {
  var bytes = new TextEncoder().encode(text);
  var binary = '';
  for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function utf8FromB64url(value) {
  var binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  var bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

function encodeHeaderWord(text) {
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  return '=?UTF-8?B?' + b64urlUtf8(text).replace(/-/g, '+').replace(/_/g, '/') + '?=';
}

function header(message, name) {
  var headers = (message.payload && message.payload.headers) || [];
  for (var i = 0; i < headers.length; i++) {
    if (headers[i].name.toLowerCase() === name.toLowerCase()) return headers[i].value;
  }
  return '';
}

function extractBody(payload) {
  if (!payload) return '';
  var queue = [payload];
  var htmlFallback = '';
  while (queue.length) {
    var part = queue.shift();
    if (part.mimeType === 'text/plain' && part.body && part.body.data) {
      return utf8FromB64url(part.body.data);
    }
    if (part.mimeType === 'text/html' && part.body && part.body.data && !htmlFallback) {
      htmlFallback = utf8FromB64url(part.body.data)
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
    if (part.parts) {
      for (var i = 0; i < part.parts.length; i++) queue.push(part.parts[i]);
    }
  }
  return htmlFallback;
}

async function gmail(args, callId) {
  var account = args.account;
  if (args.action === 'search') {
    if (!args.query) return fail('search 需要 query(Gmail 搜索语法)');
    var listed = await api({
      url: BASE + '/messages?q=' + encodeURIComponent(args.query) +
        '&maxResults=' + clampInt(args.max_results, 5, 10),
      account: account,
      callId: callId,
    });
    if (listed.err) return fail(listed.err);
    var ids = (listed.data && listed.data.messages) || [];
    var messages = [];
    for (var i = 0; i < ids.length; i++) {
      var metadata = await api({
        url: BASE + '/messages/' + ids[i].id +
          '?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date',
        account: account,
        callId: callId,
      });
      if (metadata.err) return fail(metadata.err);
      messages.push({
        id: ids[i].id,
        from: header(metadata.data, 'From'),
        subject: header(metadata.data, 'Subject'),
        date: header(metadata.data, 'Date'),
        snippet: metadata.data.snippet || '',
      });
    }
    return {
      ok: true,
      result: {
        total_estimate: (listed.data && listed.data.resultSizeEstimate) || messages.length,
        messages: messages,
      },
    };
  }

  if (args.action === 'read') {
    if (!args.message_id) return fail('read 需要 message_id');
    var full = await api({
      url: BASE + '/messages/' + encodeURIComponent(args.message_id) + '?format=full',
      account: account,
      callId: callId,
    });
    if (full.err) return fail(full.err);
    var body = extractBody(full.data.payload);
    return {
      ok: true,
      result: {
        id: full.data.id,
        from: header(full.data, 'From'),
        to: header(full.data, 'To'),
        subject: header(full.data, 'Subject'),
        date: header(full.data, 'Date'),
        body: body.length > 20000 ? body.slice(0, 20000) + '\n…(正文过长已截断)' : body,
      },
    };
  }

  if (args.action === 'list_labels') {
    var labels = await api({ url: BASE + '/labels', account: account, callId: callId });
    if (labels.err) return fail(labels.err);
    return {
      ok: true,
      result: {
        labels: ((labels.data && labels.data.labels) || []).map(function (label) {
          return { id: label.id, name: label.name, type: label.type };
        }),
      },
    };
  }

  if (args.action === 'modify_labels') {
    return fail('Insufficient permissions. Please wait for a future plugin update.');
  }

  if (args.action === 'send' || args.action === 'draft') {
    if (!args.to || !args.subject || args.body_text === undefined) {
      return fail(args.action + ' 需要 to / subject / body_text');
    }
    if (/[\r\n]/.test(String(args.to))) {
      return fail('to 不得包含换行符');
    }
    if (/[\r\n]/.test(String(args.subject))) {
      return fail('subject 不得包含换行符');
    }
    var recipient = String(args.to).trim();
    if (!recipient) return fail('to 不能为空');
    var mime =
      'To: ' + recipient + '\r\n' +
      'Subject: ' + encodeHeaderWord(args.subject) + '\r\n' +
      'Content-Type: text/plain; charset=UTF-8\r\n' +
      'Content-Transfer-Encoding: base64\r\n\r\n' +
      b64urlUtf8(args.body_text).replace(/-/g, '+').replace(/_/g, '/');
    var raw = b64urlUtf8(mime);
    if (args.action === 'send') {
      var sent = await api({
        url: BASE + '/messages/send',
        method: 'POST',
        body: { raw: raw },
        account: account,
        callId: callId,
      });
      if (sent.err) return fail(sent.err);
      return { ok: true, result: { sent: true, id: sent.data.id } };
    }
    var draft = await api({
      url: BASE + '/drafts',
      method: 'POST',
      body: { message: { raw: raw } },
      account: account,
      callId: callId,
    });
    if (draft.err) return fail(draft.err);
    return { ok: true, result: { draft: true, id: draft.data.id } };
  }

  return fail('未知 action:' + args.action);
}

cindy.onHostMessage(async function (message) {
  if (!message || message.type !== 'tool-call') return;
  try {
    var result = message.tool === 'gmail_accounts'
      ? await listAccounts()
      : message.tool === 'gmail'
        ? await gmail(message.args || {}, message.callId)
        : fail('未知工具:' + message.tool);
    if (result.ok) {
      cindy.send({ type: 'tool-result', callId: message.callId, ok: true, result: result.result });
    } else {
      cindy.send({ type: 'tool-result', callId: message.callId, ok: false, message: result.message });
    }
  } catch (error) {
    cindy.send({
      type: 'tool-result',
      callId: message.callId,
      ok: false,
      message: 'Gmail 工具执行失败:' + (error && error.message ? error.message : String(error)),
    });
  }
});
