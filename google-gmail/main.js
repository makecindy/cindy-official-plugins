/* global cindy, crypto */

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
  var transportError = request.method === 'GET'
    ? 'Gmail 请求未完成，请检查网络连接及 Cindy 插件连接状态后重试；此请求未取得完整内容'
    : 'Gmail 请求未完成，操作结果未知；请先到 Gmail 核实邮件或草稿是否已创建，勿直接重复提交，并检查网络及 Cindy 插件连接状态';
  var response;
  try {
    response = await cindy.fetch(request);
  } catch (_transportError) {
    return { err: transportError };
  }
  if (!response || !response.ok) return { err: transportError };
  var isWrite = request.method !== 'GET';
  var uncertain = '操作结果未知；请先到 Gmail 核实邮件或草稿，勿直接重复提交';
  if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
    return { err: isWrite ? uncertain : 'Gmail 响应状态无效，请检查连接后重试' };
  }
  var data = null;
  try { data = JSON.parse(response.body); } catch (_parseError) { /* Classify HTTP errors before payload errors. */ }
  if (response.status < 200 || response.status >= 300) {
    var message = data && data.error && typeof data.error.message === 'string'
      ? data.error.message.slice(0, 200) : '请求未成功';
    var detail = 'Gmail API 返回 HTTP ' + response.status + ':' + message;
    if (response.status === 401) detail += '；账号授权可能已失效，请到 Gmail 插件详情重新连接该账号后重试';
    else if (response.status === 403) detail += '；请检查该账号的邮件访问权限；若缺少授权，请到 Gmail 插件详情重新连接。若为配额或组织策略限制，请按 Google 错误原因处理';
    else if (response.status === 404) detail += '；请确认账号并重新搜索邮件，邮件或附件可能已删除';
    else if (response.status === 429) detail += '；请求过于频繁，请稍后重试';
    else detail += '；请检查请求参数和连接状态后重试';
    if (isWrite && (response.status >= 500 || response.status === 408)) detail = uncertain + '（HTTP ' + response.status + '）';
    return { err: detail, status: response.status };
  }
  if (response.truncated || !data || typeof data !== 'object' || Array.isArray(data)) {
    return { err: isWrite ? uncertain : 'Gmail 响应不完整或格式无效，请重新读取；若持续超限，请在 Gmail 中查看' };
  }

  return { data: data };
}

async function listAccounts() {
  var response;
  try {
    response = await fetch('/oauth');
  } catch (_transportError) {
    return fail('无法连接 Cindy 本地账号服务，请稍后重试；若持续失败，请重新打开 Gmail 插件详情检查服务状态');
  }
  if (!response) return fail('Cindy 本地账号服务未返回结果，请稍后重试');
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) return fail('账号状态服务拒绝访问，请到 Gmail 插件详情检查连接状态后重试（HTTP ' + response.status + '）');
    return fail('Cindy 本地账号服务暂时不可用，请稍后重试；若持续失败，请重新打开 Gmail 插件详情检查服务状态（HTTP ' + response.status + '）');
  }
  var list;
  try {
    list = await response.json();
  } catch (_parseError) {
    return fail('Cindy 账号状态数据无法解析，请重新打开 Gmail 插件详情后重试');
  }
  if (!Array.isArray(list)) return fail('Cindy 账号状态数据格式异常，请重新打开 Gmail 插件详情后重试');
  var entry = list.find(function (item) { return item && item.key === SECRET_KEY; });
  if (!entry || !entry.clientConfigured) {
    return fail('内置应用身份缺失，请升级 Cindy 后重试');
  }
  if (!Array.isArray(entry.accounts) || entry.accounts.some(function (account) { return !account || typeof account.id !== 'string' || !account.id; })) {
    return fail('Cindy 账号列表数据格式异常，请重新打开 Gmail 插件详情后重试');
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
  var headers = (message && message.payload && message.payload.headers) || [];
  for (var i = 0; i < headers.length; i++) {
    if (headers[i] && typeof headers[i].name === 'string' && headers[i].name.toLowerCase() === name.toLowerCase()) return typeof headers[i].value === 'string' ? headers[i].value : '';
  }
  return '';
}

function extractBody(payload) {
  if (!payload) return '';
  var queue = [payload];
  var htmlFallback = null;
  var unreadable = false;
  while (queue.length) {
    var part = queue.shift();
    if (isAttachment(part)) continue;
    var mime = (part.mimeType || '').toLowerCase();
    if ((mime === 'text/plain' || mime === 'text/html') && part.body) {
      if (part.body.attachmentId && !part.body.data) unreadable = true;
      else if (typeof part.body.data === 'string') {
        try {
          var decoded = utf8FromB64url(part.body.data);
          if (mime === 'text/plain') return decoded;
          if (htmlFallback === null) htmlFallback = decoded.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        } catch (_candidateError) { unreadable = true; }
      }
    }
    if (part.parts) {
      for (var i = 0; i < part.parts.length; i++) queue.push(part.parts[i]);
    }
  }
  if (htmlFallback !== null) return htmlFallback;
  if (unreadable) throw new Error('没有可解析的正文候选');
  return '';
}

// Gmail MIME part references remain stable across reads, including parts without partId.
function partHeader(part, name) {
  return header({ payload: part }, name);
}

function dispositionType(part) {
  return partHeader(part, 'Content-Disposition').split(';', 1)[0].trim().toLowerCase();
}

function isAttachment(part) {
  var disposition = dispositionType(part);
  return Boolean(part.filename || disposition === 'attachment' ||
    ((disposition === 'inline' || partHeader(part, 'Content-ID')) &&
      !/^text\/(plain|html)$/i.test(part.mimeType || '')) ||
    (part.body && part.body.attachmentId && !/^text\/(plain|html)$/i.test(part.mimeType || '')));
}

function validateMime(payload) {
  var pending = [{ part: payload, depth: 0 }];
  var count = 0;
  while (pending.length) {
    var item = pending.pop();
    var part = item.part;
    if (++count > 4096 || item.depth > 64) return '邮件 MIME 结构过大或过深，请在 Gmail 中查看附件';
    if (!part || typeof part !== 'object' || Array.isArray(part) ||
        (part.parts !== undefined && !Array.isArray(part.parts)) ||
        (part.headers !== undefined && !Array.isArray(part.headers)) ||
        (part.filename !== undefined && typeof part.filename !== 'string') ||
        (part.body !== undefined && (!part.body || typeof part.body !== 'object' || Array.isArray(part.body)))) {
      return '邮件 MIME 数据格式异常，请重新读取或在 Gmail 中查看';
    }
    (part.parts || []).forEach(function (child) { pending.push({ part: child, depth: item.depth + 1 }); });
  }
  return '';
}

function attachmentParts(payload) {
  var found = [];
  function visit(part, id) {
    if (!part) return;
    if (isAttachment(part)) {
      found.push({
        view: {
          id: id, part_id: part.partId || '', filename: part.filename || 'attachment',
          mime_type: part.mimeType || 'application/octet-stream',
          size: part.body && Number.isSafeInteger(part.body.size) ? part.body.size : null,
          inline: dispositionType(part) === 'inline' ||
            Boolean(partHeader(part, 'Content-ID')),
        },
        body: part.body || {},
      });
      return; // An attached message is one file, not additional top-level attachments.
    }
    (part.parts || []).forEach(function (child, index) { visit(child, id + '-' + index); });
  }
  visit(payload, 'part-0');
  return found;
}

function attachmentBase64(body, expectedSize) {
  if (!body || typeof body.data !== 'string' || !/^[A-Za-z0-9_-]*={0,2}$/.test(body.data)) {
    throw new Error('附件内容缺失或编码无效，未保存文件');
  }
  var encoded = body.data.replace(/=+$/, '');
  var size = Math.floor(encoded.length * 3 / 4);
  if (encoded.length % 4 === 1 || size > 16 * 1024 * 1024) {
    throw new Error('附件编码无效或超过当前单文件 16 MiB 下载上限，未保存文件');
  }
  if ((expectedSize !== null && expectedSize !== size) ||
      (body.size !== undefined && body.size !== size)) {
    throw new Error('附件长度与邮件记录不一致，未保存不完整文件');
  }
  var base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  base64 += '='.repeat((4 - base64.length % 4) % 4);
  // Decode before writing, preserving binary bytes and rejecting noncanonical padding bits.
  if (btoa(atob(base64)) !== base64) throw new Error('附件编码无效，未保存文件');
  return { content: base64, size: size };
}

async function downloadAttachments(parts, args, account, callId) {
  if (args.save_deposit !== undefined && (!args.save_deposit || typeof args.save_deposit.token !== 'string' || !args.save_deposit.token.trim())) return fail('保存目录票据无效，请重新选择保存目录后重试；未改存到其他目录');
  if (args.attachment_ids !== undefined && (!Array.isArray(args.attachment_ids) ||
      !args.attachment_ids.length || args.attachment_ids.some(function (id) {
        return typeof id !== 'string' || !parts.some(function (part) { return part.view.id === id; });
      }))) return fail('attachment_ids 必须使用 read 返回的非空附件 id 列表');
  var selected = parts.filter(function (part) {
    return !args.attachment_ids || args.attachment_ids.indexOf(part.view.id) !== -1;
  });
  var files = [];
  var nonce = new Uint8Array(16);
  crypto.getRandomValues(nonce);
  var downloadId = Array.from(nonce, function (byte) {
    return byte.toString(16).padStart(2, '0');
  }).join('');
  var directory = 'gmail-attachments/' + downloadId;
  // Bound each batch; callers get the remaining IDs rather than losing them silently.
  for (var i = 0; i < Math.min(selected.length, 16); i++) {
    var part = selected[i];
    var file = Object.assign({}, part.view, { status: 'failed' });
    try {
      if (part.view.size !== null && part.view.size > 16 * 1024 * 1024) {
        throw new Error('附件超过当前单文件 16 MiB 下载上限，未保存文件');
      }
      var body = part.body;
      if (body.attachmentId) {
        var response = await api({
          url: BASE + '/messages/' + encodeURIComponent(args.message_id) +
            '/attachments/' + encodeURIComponent(body.attachmentId),
          account: account, callId: callId,
        });
        if (response.err) throw new Error(response.err);
        body = response.data;
      }
      var bytes = attachmentBase64(body, part.view.size);
      // Remote filenames are labels, never paths. Prefix defeats dotfiles and Windows devices.
      var saveToDirectory = args.save_deposit && args.save_deposit.token;
      var prefix = 'file-' + (saveToDirectory ? downloadId + '-' : '') + i + '-';
      var label = part.view.filename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.+$/, '_');
      // Host paths allow at most 64 characters per segment. Keep a short extension.
      var maxLabel = 64 - prefix.length;
      var extension = label.match(/\.[a-zA-Z0-9]{1,10}$/);
      if (label.length > maxLabel) {
        var suffix = extension ? extension[0] : '';
        label = label.slice(0, maxLabel - suffix.length) + suffix;
      }
      var name = prefix + label.replace(/\.+$/, '_');
      var request = {
        type: 'fs-request', op: 'write', root: 'workdir', callId: callId,
        path: directory + '/' + name, encoding: 'base64', content: bytes.content,
      };
      if (saveToDirectory) {
        request.root = 'save';
        request.token = args.save_deposit.token;
        request.path = name;
      }
      var written = null;
      try {
        written = await cindy.send(request);
      } catch (_writeTransportError) {
        // The Host may have written the file before losing its reply.
      }
      if (written && written.ok === false) {
        file.root = request.root;
        file.attempted_path = request.path;
        throw new Error('Host 报告文件保存失败，请检查目标目录、可用空间和当前任务写入权限；先核实是否有残留文件再重试');
      }
      if (!written || written.ok !== true || written.bytes !== bytes.size || typeof written.path !== 'string' || !written.path || written.path.startsWith('/') || written.path.includes('\\') || written.path.split('/').some(function (segment) { return !segment || segment === '.' || segment === '..'; })) {
        file.status = 'unknown';
        file.root = request.root;
        file.attempted_path = request.path;
        throw new Error('文件写入结果未知，可能已保存但未收到完整回执；请先检查目标目录中的文件，再决定是否重试，避免重复保存');
      }
      file.status = 'downloaded';
      file.path = written.path;
      file.root = request.root;
      file.bytes = written.bytes;
    } catch (error) {
      file.error = error && error.message || '附件下载失败，请检查账号及网络状态';
    }
    files.push(file);
  }
  var remaining = selected.slice(16).map(function (part) { return part.view.id; });
  return { ok: true, result: {
    files: files, remaining_attachment_ids: remaining,
    complete: !remaining.length && files.every(function (file) { return file.status === 'downloaded'; }),
  } };
}

async function gmail(args, callId) {
  if (Object.prototype.hasOwnProperty.call(args, 'save_dir')) return fail('save_dir 必须放在 ghost_call 顶层，不能放入 Gmail args；请修正调用后重试，未写入任何目录');
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

  if (args.action === 'read' || args.action === 'download_attachments') {
    if (!args.message_id) return fail(args.action + ' 需要 message_id');
    var shouldDownload = args.action === 'download_attachments' || args.download_attachments === true;
    // Plain reads retain Host default-account resolution. Downloads pin the account
    // once so a settings change cannot switch accounts between Gmail requests.
    if (shouldDownload && !account) {
      var connected = await listAccounts();
      if (!connected.ok) return connected;
      var defaultAccount = connected.result.accounts.find(function (item) { return item.is_default; });
      if (!defaultAccount) return fail('未设置默认 Gmail 账号，请在插件详情设为默认，或通过 account 指定 gmail_accounts 返回的账号 ID 后重试');
      account = defaultAccount.id;
    }
    var full = await api({
      url: BASE + '/messages/' + encodeURIComponent(args.message_id) + '?format=full',
      account: account,
      callId: callId,
    });
    if (full.err) return fail(full.err);
    if (!full.data || !full.data.payload) return fail('邮件内容缺失，无法判断附件，请重新读取');
    var mimeError = validateMime(full.data.payload);
    if (mimeError) return fail(mimeError);
    var parts = attachmentParts(full.data.payload);
    var body = '';
    var bodyError;
    if (args.action === 'read') {
      try { body = extractBody(full.data.payload); }
      catch (_bodyError) { bodyError = '邮件正文未能完整解析，请在 Gmail 中查看正文；附件结果请单独检查'; }
    }
    var downloads;
    if (shouldDownload) {
      downloads = await downloadAttachments(parts, args, account, callId);
      if (!downloads.ok) return downloads;
    }
    if (args.action === 'download_attachments') {
      return { ok: true, result: Object.assign({ message_id: args.message_id, account: account }, downloads.result) };
    }
    return {
      ok: true,
      result: {
        id: full.data.id,
        account: account,
        body_error: bodyError,
        attachments: parts.map(function (part) { return part.view; }),
        downloads: downloads ? downloads.result : undefined,
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
      if (typeof sent.data.id !== 'string' || !sent.data.id) return fail('发送结果未知，回执缺少邮件 ID；请先检查 Gmail 已发送邮件，勿直接重复提交');
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
    if (typeof draft.data.id !== 'string' || !draft.data.id) return fail('草稿结果未知，回执缺少草稿 ID；请先检查 Gmail 草稿，勿直接重复提交');
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
      message: message.args && (message.args.action === 'send' || message.args.action === 'draft')
        ? 'Gmail 操作未正常完成，结果未知；请先核实邮件或草稿，勿直接重复提交'
        : 'Gmail 数据处理未完成，请检查插件连接并重新读取；若涉及下载，请先检查目标目录和已返回的文件结果',
    });
  }
});
