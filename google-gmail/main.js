/* Plugin-owned labels. OAuth identities, credentials and status remain Host-owned. */
var googleAccountMetadata = (function () {
  'use strict';
  function object(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }
  async function read() {
    var response = await fetch('/kv');
    if (!response.ok) throw new Error('Account preferences unavailable');
    return object(await response.json());
  }
  function labels(data, key) {
    return object(object(data.accountNicknames)[key]);
  }
  async function update(key, accountId, nickname) {
    // /kv replaces the whole document. Serialize settings-page writers sharing
    // this plugin origin, and read inside the lock to preserve unrelated keys.
    return navigator.locks.request('google-account-metadata', async function () {
      var data = await read();
      if (nickname !== null) {
        var response = await fetch('/oauth');
        if (!response.ok) throw new Error('Account status unavailable');
        var accounts = await response.json();
        var entry = accounts.find(function (item) { return item.key === key; });
        if (!entry || !entry.accounts.some(function (account) { return account.id === accountId; })) {
          throw new Error('Account no longer connected');
        }
      }
      var all = Object.assign({}, object(data.accountNicknames));
      var next = Object.assign({}, labels(data, key));
      if (nickname) next[accountId] = nickname;
      else delete next[accountId];
      all[key] = next;
      data.accountNicknames = all;
      var saved = await fetch('/kv', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      });
      if (!saved.ok) throw new Error('Account preferences not saved');
    });
  }
  return {
    list: async function (key, accounts) {
      var names = {};
      // Labels are optional; an unavailable KV must not hide OAuth identities.
      // Writes still require a successful read to avoid overwriting preferences.
      try { names = labels(await read(), key); } catch (_) { /* show accounts without labels */ }
      return accounts.map(function (account) {
        var nickname = Object.prototype.hasOwnProperty.call(names, account.id) ? names[account.id] : '';
        // Do not accept a Host nickname as a second source of truth.
        return Object.assign({}, account, { nickname: typeof nickname === 'string' ? nickname : '' });
      });
    },
    save: async function (key, accountId, nickname) {
      if (typeof nickname !== 'string' || nickname.length > 80 || /[\u0000-\u001f\u007f]/.test(nickname)) {
        throw new Error('Invalid account nickname');
      }
      return update(key, accountId, nickname.trim());
    },
    remove: function (key, accountId) { return update(key, accountId, null); },
  };
})();


/* global cindy */
// Provider adapter. Draft MIME updates and previews use fixed Gmail endpoints.
var SECRET_KEY = 'gmail_account';
var PLUGIN_NAME = 'Gmail';
function fail(message) { return { ok: false, message: message }; }
// Host grants contain hashes, not filesystem paths. Read only those grants
// through the plugin media protocol, then use the existing workdir file bridge.
async function prepareMailAttachments(args, callId) {
  var options = Object.assign({}, args.options || {});
  var hashes = args.attachments || [];
  var inputs = options.attach === undefined ? [] : Array.isArray(options.attach) ? options.attach.slice() : [options.attach];
  var refs = inputs.filter(function (item) { return typeof item === 'string' && item.startsWith('cindy-media:'); });
  if (!hashes.length && !refs.length) return { options: options, files: [] };
  if (!Array.isArray(hashes) || hashes.some(function (hash) { return typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash); })) {
    throw new Error('Invalid media grant; pass attachments through ghost_call.');
  }
  var command = (args.command || []).join(' ');
  if (!['send', 'reply', 'reply-all', 'drafts create', 'drafts update', 'drafts reply', 'drafts reply-all'].includes(command)) {
    throw new Error('This command cannot add chat attachments. Use drafts create/update/reply, then send the saved draft.');
  }
  var context = args.session_context;
  if (!context || context.workdir_is_local !== true || context.workdir_is_read_only !== false || !context.workdir || typeof cindy.fs !== 'function') {
    throw new Error('Chat attachments need a writable local task directory and Cindy 0.1.92 or newer.');
  }
  var extensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'webm', 'mov', 'mp3', 'wav', 'm4a', 'ogg', 'glb'];
  var preferred = {};
  refs.forEach(function (ref) {
    var match = /^cindy-media:\/\/blobs\/([a-f0-9]{64})\.([a-z0-9]+)$/.exec(ref);
    if (!match || !hashes.includes(match[1]) || !extensions.includes(match[2])) {
      throw new Error('Media URL has no matching Host grant; pass it in ghost_call attachments too.');
    }
    preferred[match[1]] = match[2];
  });
  if (options['clear-attachments']) throw new Error('Chat attachments cannot be combined with clear-attachments.');
  var inline = options['inline-images'];
  if (inline !== undefined && (!Array.isArray(inline) || !inline.length || inline.some(function (item) { return typeof item !== 'string'; }))) {
    throw new Error('inline-images must be a non-empty list of granted image hashes.');
  }
  if (inline && command !== 'drafts create') throw new Error('Create an HTML draft with inline-images first, then use the common draft send workflow.');
  if (inline && options['raw-file']) throw new Error('Do not combine inline-images with a caller-supplied raw-file.');
  var directory = 'gmail-attachments/' + crypto.randomUUID();
  var files = [];
  var total = 0;
  for (var hash of new Set(hashes)) {
    var response;
    var extension = undefined;
    // The grant protocol omits extensions. A supplied media URL avoids probing;
    // otherwise look up this granted hash in the Host's supported media types.
    for (var ext of preferred[hash] ? [preferred[hash]] : extensions) {
      // Same-origin Host protocol, not an external network request.
      // serveGhostMedia checks ghostCanRead (including ghost-tool-grant) before
      // reading bytes. The HTTPS bridge is not used for this local protocol.
      response = await fetch('/media/' + hash + '.' + ext);
      if (response.ok) { extension = ext; break; }
      if (response.status !== 404) throw new Error('Unable to read chat attachment; check the plugin media service.');
    }
    if (!extension) throw new Error('Chat attachment unavailable; attach the file again before retrying.');
    var blob = await response.blob();
    total += blob.size;
    if (!blob.size || blob.size > 16 * 1024 * 1024 || total > 25 * 1024 * 1024) {
      throw new Error('Chat attachment exceeds import limits (16 MiB per file, 25 MiB total); use a smaller file or a cloud link.');
    }
    var bytes = new Uint8Array(await blob.arrayBuffer());
    var digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    if (digest !== hash) throw new Error('Chat attachment integrity check failed; attach the file again.');
    var chunks = [];
    for (var i = 0; i < bytes.length; i += 32768) chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 32768)));
    var relativePath = directory + '/attachment-' + (files.length + 1) + '.' + extension;
    var saved = await cindy.fs({ op: 'write', root: 'workdir', path: relativePath,
      encoding: 'base64', content: btoa(chunks.join('')), callId: callId });
    if (!saved || !saved.ok) throw new Error('Unable to import chat attachment into the task directory; check file permissions.');
    files.push({ path: relativePath, bytes: bytes.length, hash: hash, contentType: blob.type || 'application/octet-stream' });
  }
  var inlineSet = new Set(inline || []);
  var embedded = (inline || []).map(function (hash) { return files.find(function (file) { return file.hash === hash; }); });
  if (embedded.some(function (file) { return !file; })) throw new Error('Every inline image must also be a granted chat attachment.');
  if (embedded.some(function (file) { return !/\.(png|jpe?g|gif|webp)$/i.test(file.path); }))
    throw new Error('inline-images 仅支持 PNG、JPEG、GIF 或 WebP 图片；其他媒体请作为普通附件。');
  var regular = files.filter(function (file) { return !inlineSet.has(file.hash); });
  options.attach = inputs.filter(function (item) { return !refs.includes(item); }).concat(regular.map(function (file) { return file.path; }));
  delete options['inline-images'];
  return { options: options, files: files, inline: embedded };
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
  var entries;
  try {
    entries = await response.json();
  } catch (_parseError) {
    return fail('Cindy 账号状态数据无法解析，请重新打开 Gmail 插件详情后重试');
  }
  if (!Array.isArray(entries)) return fail('Cindy 账号状态数据格式异常，请重新打开 Gmail 插件详情后重试');
  var entry = entries.find(function (item) { return item && item.key === SECRET_KEY; });
  if (!entry || !entry.clientConfigured) return fail('内置应用身份缺失，请升级 Cindy 后重试');
  if (!Array.isArray(entry.accounts) || entry.accounts.some(function (account) { return !account || typeof account.id !== 'string' || !account.id; })) {
    return fail('Cindy 账号列表数据格式异常，请重新打开 Gmail 插件详情后重试');
  }
  if (!entry.accounts.length) return fail('尚未连接账号，请到「' + PLUGIN_NAME + '」详情页单独授权');
  return { ok: true, result: {
    accounts: (await googleAccountMetadata.list(SECRET_KEY, entry.accounts)).map(function (account) {
      return { id: account.id, email: account.label, nickname: account.nickname || '',
        status: account.status, scope_stale: account.scopeStale === true };
    }),
  } };
}
async function selectGoogleAccount(accountId) {
  var listed = await listAccounts();
  if (!listed.ok) return fail('尚未执行：' + listed.message);
  var accounts = listed.result.accounts;
  if (accountId === undefined && accounts.length !== 1) {
    return fail('尚未执行：已连接多个账号，请明确选择账号并传入 account。');
  }
  var account = accountId === undefined ? accounts[0] : accounts.find(function (item) { return item.id === accountId; });
  if (!account) return fail('尚未执行：指定账号不存在，请重新选择账号；不会切换到其他账号。');
  // Newly added scopes are a non-blocking hint: existing read/compose grants
  // remain usable. Let the requested endpoint report its actual missing scope.
  if (account.status !== 'connected') {
    return fail('尚未执行：账号 ' + (account.email || account.id) + ' 授权已失效或权限不足，请到插件详情页重新连接此账号。');
  }
  return { ok: true, accountId: account.id, accountEmail: account.email };
}
// Gmail only translates account/CLI arguments and transport results. The shared
// flow owns card edits, autosave, sending and continuation.
async function mailImagePreviews(readBack, accountId, previous) {
  if (!readBack) return readBack;
  var sources = readBack.attachments || [];
  // Inline bytes are worker-to-preview transport, never card/model metadata.
  var attachments = sources.map(function ({ inlineData, ...metadata }) { return metadata; });
  var images = [];
  var previewStarted = Date.now(), previewBytes = 0, maxImageBytes = 16 * 1024 * 1024;
  for (var i = 0; i < attachments.length; i++) {
    if (Date.now() - previewStarted > 15000) break;
    var attachment = attachments[i];
    if (!/^image\/(png|jpeg|gif|webp)$/.test(attachment.mimeType) || !Number.isSafeInteger(attachment.bytes)
      || attachment.bytes < 0 || attachment.bytes > maxImageBytes || previewBytes + attachment.bytes > 25 * 1024 * 1024) continue;
    var cid = (attachment.contentId || '').replace(/^<|>$/g, '');
    // Gmail changes the message/part IDs on a draft update. Never reuse a CID
    // alone: the AI may have replaced its bytes while keeping its name.
    var existing = previous?.messageId === readBack.messageId && previous?.attachments?.find(function (a) { return a.key === attachment.key; });
    if (existing?.previewUrl) { attachment.previewUrl = existing.previewUrl; if (cid) images.push({ cid, url: existing.previewUrl }); continue; }
    try {
      var data = sources[i].inlineData;
      if (typeof data !== 'string') {
        if (!attachment.attachmentId || typeof cindy.fetch !== 'function') continue;
        var response = await cindy.fetch({ url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/' + encodeURIComponent(readBack.messageId) + '/attachments/' + encodeURIComponent(attachment.attachmentId), authAccount: accountId, timeoutMs: 5000 });
        if (!response.ok || response.status !== 200 || response.truncated) continue;
        data = parseMailReadJson(response.body).data;
      }
      if (typeof data !== 'string' || data.length > 4 * Math.ceil(maxImageBytes / 3)
        || !/^[A-Za-z0-9_-]*={0,2}$/.test(data)) continue;
      data = data.replace(/-/g, '+').replace(/_/g, '/');
      if (atob(data).length !== attachment.bytes) continue;
      previewBytes += attachment.bytes;
      var deposited = await cindy.send({ type: 'cindy-request', kind: 'deposit_media', data: data, label: attachment.filename });
      if (deposited.ok) { attachment.previewUrl = deposited.url; if (cid) images.push({ cid: cid, url: deposited.url }); }
    } catch (_) { /* A preview failure cannot invalidate a verified saved draft. */ }
  }
  return { ...readBack, attachments: attachments, images: images };
}
var gmailCompose = typeof cindyMail !== 'undefined' && cindyMail.version === 1 ? cindyMail.register({
  providerName: 'Gmail', draftStorage: 'server', storageLock: 'google-account-metadata', richText: true,
  selectAccount: selectGoogleAccount,
  async deleteDraft({ record }) {
    var response = await cindy.node.request({ method: 'run', authAccount: record.account,
      params: { command: ['drafts', 'delete'], arguments: [record.draftId], options: {}, readOnly: false }, timeoutMs: 120000 });
    var result = response && response.ok && response.result;
    return result?.ok ? { ...result, data: { deleted: true, draftId: record.draftId } } : result;
  },
  async readDraft({ record }) {
    var response = await cindy.node.request({ method: 'run', authAccount: record.account,
      params: { command: ['drafts', 'get'], arguments: [record.draftId], options: {}, readOnly: true }, timeoutMs: 120000 });
    var result = response && response.ok && response.result;
    if (result?.ok && result.data?.readBack) result.data.readBack = await mailImagePreviews(result.data.readBack, record.account);
    return result;
  },
  async writeDraft({ record, account, fields, send, attachments, readBack }) {
    var response = await cindy.node.request({ method: 'compose', authAccount: record.account,
      params: { draftId: record.draftId, fingerprint: record.fingerprint, accountEmail: account.accountEmail, fields, send, attachments }, timeoutMs: 120000 });
    var result = response && response.ok && response.result;
    if (result?.ok && result.data?.readBack) result.data.readBack = await mailImagePreviews(result.data.readBack, record.account, readBack);
    if (result && result.ok && result.data && result.data.sent) {
      result = { ...result, data: { ...result.data,
        receipt: { messageId: result.data.messageId || null, threadId: result.data.threadId || null } } };
    }
    return result;
  },
}) : null;

// Native reader adapter; only an explicit opening may remove the selected UNREAD label.
function parseMailReadJson(body) {
  try {
    var value = JSON.parse(body);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch (_) {
    throw new Error('无法解析 Gmail 邮件数据，请检查网络连接后重新打开邮件，或在邮箱中查看。');
  }
}
function decodeMailReadBytes(data) {
  try { return atob(data.replace(/-/g, '+').replace(/_/g, '/')); }
  catch (_) { throw new Error('无法解析 Gmail 邮件正文，请重新打开邮件，或在邮箱中查看。'); }
}
function assertMailReadResponse(response, fallback) {
  if (response.status === 401) throw new Error('Gmail 账号授权已失效，请到插件详情页重新连接此账号后再打开邮件。');
  if (response.status === 403) throw new Error('Gmail 拒绝读取，请检查此账号的邮件读取权限，并到插件详情页重新连接或授权。');
  if (!response.ok || response.status !== 200 || response.truncated) throw new Error(fallback);
}
// Optional read-only enrichment. Account-scoped, bounded, in-memory only; a
// missing new OAuth scope or an unavailable People API never prevents reading.
var mailPhotoCache = new Map();
async function lookupMailParticipantPhotos(accountId, headers) {
  var emails = [], pieces = [], start = 0, quoted = false, escaped = false, angle = 0;
  var input = headers.join(', ');
  for (var i = 0; i <= input.length; i++) {
    var char = input[i];
    if (escaped) { escaped = false; continue; }
    if (char === '\\' && quoted) { escaped = true; continue; }
    if (char === '"') quoted = !quoted;
    if (!quoted && char === '<') angle++;
    if (!quoted && char === '>') angle = Math.max(0, angle - 1);
    if (i === input.length || (!quoted && !angle && (char === ',' || char === ';'))) { pieces.push(input.slice(start, i)); start = i + 1; }
  }
  for (var piece of pieces) {
    var email = (/<([^<>]+)>\s*$/.exec(piece.trim())?.[1] || piece).trim().toLowerCase();
    if (email.length <= 320 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(email) && !emails.includes(email)) emails.push(email);
  }
  // Large mailing lists use public/initial fallbacks beyond the first 12 people.
  emails = emails.slice(0, 12);
  var deadline = Date.now() + 2000;
  async function search(query) {
    var remaining = deadline - Date.now();
    if (remaining < 100) return null;
    var response = await cindy.fetch({ url: 'https://people.googleapis.com/v1/people:searchContacts?readMask=emailAddresses%2Cphotos&pageSize=30&query=' + encodeURIComponent(query),
      authAccount: accountId, timeoutMs: Math.min(1000, remaining) });
    if (!response.ok || response.status !== 200 || response.truncated) return null;
    var data = JSON.parse(response.body);
    return Array.isArray(data.results) ? data.results : [];
  }
  var warmup;
  var photos = await Promise.all(emails.map(async function (email) {
    var key = JSON.stringify([accountId, email]);
    var cached = mailPhotoCache.get(key);
    if (cached && cached.until > Date.now()) return cached.value;
    // One warmup per batch; parallel readers share in-flight email lookups.
    if (!warmup) warmup = search('').catch(function () { return null; });
    var value = (async function () {
      try {
        if (await warmup === null) return null;
        var results = await search(email);
        for (var result of results || []) {
          var person = result.person;
          if (!person || !Array.isArray(person.emailAddresses) || !person.emailAddresses.some(function (a) { return typeof a.value === 'string' && a.value.trim().toLowerCase() === email; })) continue;
          for (var photo of Array.isArray(person.photos) ? person.photos : []) {
            if (photo.default === true || typeof photo.url !== 'string' || photo.url.length > 2048) continue;
            var url = new URL(photo.url);
            if (url.protocol === 'https:' && !url.username && !url.password && !url.port &&
                (url.hostname === 'googleusercontent.com' || url.hostname.endsWith('.googleusercontent.com'))) return { email: email, url: url.href };
          }
        }
      } catch (_) { /* Best effort: keep mail and public avatar fallbacks available. */ }
      return null;
    })();
    mailPhotoCache.delete(key);
    mailPhotoCache.set(key, { until: Date.now() + 60000, value: value });
    while (mailPhotoCache.size > 256) mailPhotoCache.delete(mailPhotoCache.keys().next().value);
    return value;
  }));
  return photos.filter(Boolean);
}

async function readMailMessageLink(args, beginOperation) {
  if (args.markRead !== undefined && typeof args.markRead !== 'boolean') throw new Error('Invalid markRead flag');
  var url = new URL(args.url);
  if (url.protocol !== 'https:' || url.hostname !== 'mail.google.com' || url.port || url.username || url.password || !url.pathname.startsWith('/mail/'))
    throw new Error('Unsupported Gmail link');
  var id = url.searchParams.get('permmsgid') || url.hash.split('/').pop();
  if (!/^[a-f0-9]{8,32}$/i.test(id || '')) throw new Error('This Gmail link cannot be resolved; open it in Gmail.');
  var listed = await listAccounts();
  if (!listed.ok) throw new Error(listed.message);
  var email = url.searchParams.get('authuser');
  var accountId = args.account;
  if (email && email.includes('@')) {
    var matches = listed.result.accounts.filter(function (a) { return a.email.toLowerCase() === email.toLowerCase(); });
    if (matches.length !== 1) throw new Error('The Gmail account in this link is not connected.');
    if (accountId !== undefined && accountId !== matches[0].id)
      throw new Error('邮件链接与指定的 Gmail 账号不一致，请选择链接对应的账号后再打开。');
    accountId = matches[0].id;
  }
  var selected = await selectGoogleAccount(accountId);
  if (!selected.ok) throw new Error(selected.message);
  var response = await cindy.fetch({ url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/' + encodeURIComponent(id) + '?format=full', authAccount: selected.accountId, timeoutMs: 20000 });
  // Gmail web links can identify a conversation whose original draft message
  // has been replaced. Resolve that conversation without changing accounts or
  // mistaking an authentication/network failure for a missing message.
  if (response.status === 404 && !url.searchParams.has('permmsgid')) {
    var threadResponse = await cindy.fetch({ url: 'https://gmail.googleapis.com/gmail/v1/users/me/threads/' + encodeURIComponent(id) + '?format=metadata', authAccount: selected.accountId, timeoutMs: 20000 });
    assertMailReadResponse(threadResponse, '无法读取 Gmail 会话，请检查网络连接后重新打开。');
    var thread = parseMailReadJson(threadResponse.body);
    var latest = (Array.isArray(thread.messages) ? thread.messages : []).filter(function (m) {
      return /^[a-f0-9]{8,32}$/i.test(m.id || '') && !(m.labelIds || []).includes('DRAFT');
    }).reduce(function (a, b) { return !a || Number(b.internalDate || 0) >= Number(a.internalDate || 0) ? b : a; }, null);
    if (!latest || latest.id === id) throw new Error('No readable message remains in this Gmail conversation.');
    response = await cindy.fetch({ url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/' + encodeURIComponent(latest.id) + '?format=full', authAccount: selected.accountId, timeoutMs: 20000 });
  }
  assertMailReadResponse(response, '无法读取 Gmail 邮件，请检查网络连接和邮件是否仍在邮箱中后重新打开。');
  var message = parseMailReadJson(response.body);
  if (!/^[a-f0-9]{8,32}$/i.test(message.id || '') || !message.payload) throw new Error('Incomplete Gmail message');
  var photos = lookupMailParticipantPhotos(selected.accountId, ['from', 'to', 'cc', 'bcc'].map(function (name) { return header(message.payload, name); })).catch(function () { return []; });
  var conversation, conversationUnavailable = false;
  // Read only metadata for the surrounding messages. Cindy requests a body
  // through the same reader when the user expands that message.
  if (message.threadId || thread) {
    try {
      if (!thread) {
        var metadata = await cindy.fetch({ url: 'https://gmail.googleapis.com/gmail/v1/users/me/threads/' + encodeURIComponent(message.threadId) + '?format=metadata', authAccount: selected.accountId, timeoutMs: 20000 });
        if (!metadata.ok || metadata.status !== 200 || metadata.truncated) throw new Error('Conversation unavailable');
        thread = parseMailReadJson(metadata.body);
      }
      if (!Array.isArray(thread.messages)) throw new Error('Incomplete conversation');
      var members = thread.messages.filter(function (m) {
        return /^[a-f0-9]{8,32}$/i.test(m.id || '') && (!(m.labelIds || []).includes('DRAFT') || m.id === message.id);
      }).sort(function (a, b) { return Number(a.internalDate || 0) - Number(b.internalDate || 0); });
      if (!members.some(function (m) { return m.id === message.id; })) throw new Error('Message missing from conversation');
      conversation = { threadId: thread.id || message.threadId || id, messages: members.map(function (m) {
        return { messageId: m.id,
          url: 'https://mail.google.com/mail/?authuser=' + encodeURIComponent(selected.accountEmail) + '&permmsgid=' + encodeURIComponent(m.id) + '#all/' + m.id,
          from: header(m.payload || {}, 'from'), date: header(m.payload || {}, 'date'),
          subject: header(m.payload || {}, 'subject'), snippet: String(m.snippet || '').slice(0, 2048) };
      }) };
    } catch (_) { conversationUnavailable = true; }
  }
  function header(part, name) { return (part.headers || []).filter(function (h) { return h.name.toLowerCase() === name; }).map(function (h) { return h.value; }).join(', '); }
  function decode(part) {
    var match = /(?:^|;)\s*charset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;\s]*))/i.exec(header(part, 'content-type'));
    var decoder;
    try { decoder = new TextDecoder(match && (match[1] || match[2] || match[3]) || 'utf-8'); }
    catch (_) { decoder = new TextDecoder('utf-8'); }
    try { return decoder.decode(Uint8Array.from(decodeMailReadBytes(part.body.data), function (c) { return c.charCodeAt(0); })); }
    catch (_) { throw new Error('无法解析 Gmail 邮件正文，请重新打开邮件，或在邮箱中查看。'); }
  }
  var bodies = { 'text/plain': [], 'text/html': [] }, attachments = [];
  var bodyBytes = 0;
  async function walk(part) {
    var body = part.body || {}, cid = header(part, 'content-id').replace(/^<|>$/g, '');
    // Match mailMime.isAttachmentPart in the Node adapter: inline/CID body
    // containers and text alternatives are still body, not attached files.
    var disposition = header(part, 'content-disposition');
    var bodyPart = /^multipart\//i.test(part.mimeType) || /^text\/(plain|html)$/i.test(part.mimeType);
    if (part.filename || /^attachment\b/i.test(disposition) || !bodyPart) {
      attachments.push({ key: part.partId || 'root', filename: part.filename || (/^message\//i.test(part.mimeType) ? 'message.eml' : 'attachment'), mimeType: part.mimeType,
        bytes: body.size, contentId: cid, attachmentId: body.attachmentId, inlineData: body.data });
      return; // Attached .eml messages must never become the outer email body.
    }
    if (bodies[part.mimeType]) {
      if (body.attachmentId && !body.data) {
        if (!Number.isSafeInteger(body.size) || body.size < 0 || bodyBytes + body.size > 25 * 1024 * 1024) throw new Error('无法完整读取邮件正文');
        var loaded = await cindy.fetch({ url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/' + encodeURIComponent(message.id) + '/attachments/' + encodeURIComponent(body.attachmentId),
          authAccount: selected.accountId, timeoutMs: 20000 });
        assertMailReadResponse(loaded, '无法完整读取邮件正文，请检查网络连接后重新打开。');
        var content = parseMailReadJson(loaded.body);
        if (typeof content.data !== 'string' || !/^[A-Za-z0-9_-]*={0,2}$/.test(content.data) || content.size !== body.size
          || decodeMailReadBytes(content.data).length !== body.size) throw new Error('邮件正文大小不一致');
        bodyBytes += body.size;
        body.data = content.data;
      }
      if (body.size > 0 && !body.data) throw new Error('无法完整读取邮件正文');
      if (typeof body.data === 'string') bodies[part.mimeType].push(decode(part));
    }
    for (var child of part.parts || []) await walk(child);
  }
  await walk(message.payload);
  var preview = await mailImagePreviews({ messageId: message.id, attachments: attachments }, selected.accountId);
  var markReadResult;
  if (args.markRead === true && (message.labelIds || []).includes('UNREAD') && !(message.labelIds || []).includes('DRAFT')) {
    var finishMarkRead = beginOperation?.();
    try {
      var marked = await cindy.fetch({ url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/' + encodeURIComponent(message.id) + '/modify',
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
        authAccount: selected.accountId, timeoutMs: 20000 });
      // A received 200 confirms the label change even if its body was cut off.
      // A rejection is definite; a transport/server error may follow a write.
      if (marked.ok && marked.status === 200) markReadResult = { execution: 'executed' };
      else if ([400, 401, 403, 404, 405, 413, 415, 422, 429].includes(marked.status))
        markReadResult = { execution: 'not_executed', message: '未能标记已读，请检查邮箱授权和邮件状态后再操作。' };
      else markReadResult = { execution: 'unknown', message: '无法确认已读状态，请先在邮箱中核对，不要盲目重试。' };
    } catch (_) { markReadResult = { execution: 'unknown', message: '无法确认已读状态，请先在邮箱中核对，不要盲目重试。' }; }
    finishMarkRead?.(markReadResult.execution);
  }
  var participantPhotos = await photos;
  return { accountId: selected.accountId, messageId: message.id, from: header(message.payload, 'from'),
    ...(participantPhotos.length ? { participantPhotos: participantPhotos } : {}),
    to: header(message.payload, 'to'), cc: header(message.payload, 'cc'), bcc: header(message.payload, 'bcc'),
    subject: header(message.payload, 'subject'), date: header(message.payload, 'date'),
    bodyText: bodies['text/plain'].join('\n'), bodyHtml: bodies['text/html'].join('\n'),
    ...(conversation ? { conversation: conversation } : {}),
    ...(conversationUnavailable ? { conversationUnavailable: true } : {}),
    ...(markReadResult ? { markReadResult: markReadResult } : {}),
    ...(markReadResult && markReadResult.execution === 'not_executed' ? { markReadFailed: true } : {}),
    attachments: preview.attachments.map(function (a) { var clean = { ...a }; delete clean.inlineData; delete clean.attachmentId; return clean; }) };
}
async function mailToolDraft(args, sourceCallId, beginOperation) {
  if (Array.isArray(args.command) && args.command.length === 1 && ['send', 'reply', 'reply-all'].includes(args.command[0]))
    return { ok: false, execution: 'not_executed', message: '邮件未发送。请先用 drafts create / drafts reply / drafts reply-all 创建并展示草稿，再用 drafts send 发送；Cindy 公共流程会提供 10 秒撤销窗口。不要绕过草稿流程直接发送。' };
  if (!Array.isArray(args.command) || args.command[0] !== 'drafts' || !['get', 'create', 'reply', 'reply-all', 'forward', 'send', 'update', 'delete'].includes(args.command[1])) return null;
  if (!gmailCompose) return args.command[1] === 'get' ? null : { ok: false, execution: 'not_executed', message: '当前 Cindy 不支持公共邮件流程，请更新 Cindy 后再创建、编辑或发送草稿。' };
  if (!['get', 'send', 'update', 'delete'].includes(args.command[1])) return null;
  if (args.command.length !== 2 || (args.arguments || []).length !== 1) return { ok: false, execution: 'not_executed', message: '请使用完整的草稿命令和单个草稿 ID。' };
  if (args.command[1] === 'send' && (Object.keys(args.options || {}).length || (args.attachments || []).length))
    return { ok: false, execution: 'not_executed', message: '发送现有草稿只接受草稿 ID；修改请先更新该草稿。' };
  if (args.command[1] === 'send' && cindyMail.sendGraceMs !== 10000)
    return { ok: false, execution: 'not_executed', message: '当前 Cindy 尚不支持发送前的 10 秒撤销窗口，请更新 Cindy 后再发送。草稿已保留。' };
  // An unregistered draft has no card edits to flush. Use the existing Host
  // lookup to bypass beforeTool for these reads/updates/deletes; ordinary worker
  // failures must retain their actionable not_executed result. Send still goes
  // through Host policy even when no card exists.
  if (args.command[1] !== 'send' && !await gmailCompose.resolveDraft(args.account, args.arguments[0])) return null;
  // beforeTool may flush edits even for get/update. null only means the caller
  // can continue; it does not prove that no earlier draft write took place.
  var finish = args.session_context.workdir_is_read_only === false ? beginOperation() : function () {};
  var result = await gmailCompose.beforeTool({ operation: args.command[1], account: args.account,
    draftId: args.arguments[0], readOnly: args.session_context.workdir_is_read_only !== false, sourceCallId });
  if (result) finish(result.execution);
  return result;
}

// Google People operations share the selected Gmail account. Credentials stay
// in the Host; no contact data is persisted in plugin KV or sent to other APIs.
async function googleContacts(args, callId, beginOperation) {
  var action = args.action;
  var writes = ['create', 'update', 'delete'];
  var write = writes.includes(action);
  var fields = 'names,emailAddresses,phoneNumbers,organizations,photos,metadata';
  var execution = 'not_executed';
  function error(message) { throw new Error(message); }
  function text(value, name, max = 1000) {
    if (typeof value !== 'string' || !value.trim() || value.length > max) error(name + ' 必须是非空文本，且不能过长。');
    return value;
  }
  try {
    if (!['list', 'search', 'get', 'other_contacts', 'directory', ...writes].includes(action)) error('未知联系人操作，请查看 gmail_contacts 的参数说明。');
    if (write && args.session_context?.workdir_is_read_only !== false) error('当前任务为只读，未修改 Google 通讯录。');
    if (typeof cindy.fetch !== 'function') error('当前 Cindy 不支持联系人网络接口，请更新 Cindy。');
    var selected = await selectGoogleAccount(args.account);
    if (!selected.ok) error(selected.message);
    var resource;
    if (['get', 'update', 'delete'].includes(action)) {
      resource = text(args.resourceName, 'resourceName', 200);
      if (!/^people\/[A-Za-z0-9_-]+$/.test(resource) || resource === 'people/me') error('请使用查询返回的联系人 resourceName，不能使用 people/me 或自行拼接路径。');
    }
    var pageSize = args.pageSize === undefined ? 50 : args.pageSize;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) error('pageSize 必须是 1–100 的整数。');
    var page = { pageSize: String(pageSize) };
    if (args.pageToken !== undefined) page.pageToken = text(args.pageToken, 'pageToken', 4096);
    var person;
    if (['create', 'update'].includes(action)) {
      var allowed = { names: ['givenName', 'familyName', 'middleName', 'unstructuredName'],
        emailAddresses: ['value', 'type'], phoneNumbers: ['value', 'type'], organizations: ['name', 'title', 'department', 'type'] };
      if (!args.person || typeof args.person !== 'object' || Array.isArray(args.person) || !Object.keys(args.person).length) error('person 至少需要一个要写入的联系人字段。');
      person = {};
      for (var key of Object.keys(args.person)) {
        var values = args.person[key];
        if (!Object.hasOwn(allowed, key) || !Array.isArray(values) || values.length > (key === 'names' ? 1 : 20)) error('联系人字段不支持或条目过多：' + key);
        person[key] = values.map(function (item) {
          if (!item || typeof item !== 'object' || Array.isArray(item) || !Object.keys(item).length) error('联系人字段条目必须是非空对象。');
          var result = {};
          for (var name of Object.keys(item)) {
            if (!allowed[key].includes(name)) error('不支持的联系人字段：' + key + '.' + name);
            result[name] = text(item[name], key + '.' + name);
          }
          if (['emailAddresses', 'phoneNumbers'].includes(key) && !result.value) error(key + ' 需要 value。');
          return result;
        });
      }
      if (action === 'create' && !Object.values(person).some(function (items) { return items.length; })) error('不能创建空联系人。');
      if (action === 'update') text(args.etag, 'etag', 1000);
    }
    async function request(path, query = {}, method = 'GET', body) {
      var url = 'https://people.googleapis.com/v1/' + path;
      var params = new URLSearchParams();
      for (var key of Object.keys(query)) {
        for (var value of Array.isArray(query[key]) ? query[key] : [query[key]]) params.append(key, value);
      }
      var qs = params.toString();
      if (qs) url += '?' + qs;
      // Serialize before entering the uncertain write phase.
      var options = { url, method, callId, authAccount: selected.accountId, timeoutMs: 20000,
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) };
      var mutating = method !== 'GET';
      var finish;
      if (mutating) { execution = 'unknown'; finish = beginOperation(); }
      var response;
      try { response = await cindy.fetch(options); }
      catch (_) { error(mutating ? '无法确认联系人操作结果，请先核对 Google 通讯录，不要直接重试。' : '读取联系人失败，请检查网络连接后重试。'); }
      if (mutating) {
        if (response?.ok && response.status >= 200 && response.status < 300) execution = 'executed';
        else if ([400, 401, 403, 404, 405, 409, 412, 413, 415, 422, 429].includes(response?.status)) execution = 'not_executed';
        finish(execution);
      }
      if (!response?.ok || response.status < 200 || response.status >= 300) {
        if (execution === 'unknown') error('无法确认联系人操作结果，请先核对 Google 通讯录，不要直接重试。');
        if ([401, 403].includes(response?.status)) error('联系人权限不足或账号已失效，请到 Gmail 插件详情重新连接此账号并授权；企业目录还需组织允许访问。现有邮件功能可继续使用已获授权。');
        if ([400, 409, 412].includes(response?.status)) error('Google 拒绝了联系人操作，请重新读取联系人并核对字段和 etag；资料可能已经更新。');
        if (response?.status === 404) error('联系人不存在，请重新查询并核对 resourceName。');
        error('Google 联系人服务暂时不可用，请检查网络或稍后重新读取。');
      }
      if (method === 'DELETE') return { resourceName: resource, deleted: true };
      try {
        if (response.truncated) throw new Error('truncated');
        var data = JSON.parse(response.body);
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid');
        // Linking or unlinking a Google Profile can change a contact's name.
        // Return the new server identifier so later operations use it.
        if (mutating && !/^people\/[A-Za-z0-9_-]+$/.test(data.resourceName || '')) throw new Error('invalid receipt');
        return data;
      } catch (_) {
        error(execution === 'executed' ? '联系人操作已执行，但回执不完整。请先到 Google 通讯录核对，不要重复创建或修改。' : '联系人响应不完整，请缩小查询范围后重新读取。');
      }
    }
    var data;
    if (action === 'list') data = await request('people/me/connections', { ...page, personFields: fields });
    else if (action === 'get') data = await request(resource, { personFields: fields });
    else if (action === 'search') {
      var query = text(args.query, 'query');
      if (args.pageToken !== undefined) error('联系人搜索不支持 pageToken；需要分页遍历时使用 list。');
      // People search requires an empty-query warmup before the real query.
      await request('people:searchContacts', { query: '', readMask: fields, pageSize: '1' });
      data = await request('people:searchContacts', { query, readMask: fields, pageSize: String(Math.min(pageSize, 30)) });
    } else if (action === 'other_contacts') data = await request('otherContacts', { ...page, readMask: 'names,emailAddresses,phoneNumbers,photos,metadata' });
    else if (action === 'directory') data = await request('people:searchDirectoryPeople', {
      ...page, query: text(args.query, 'query'), readMask: fields,
      sources: ['DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE', 'DIRECTORY_SOURCE_TYPE_DOMAIN_CONTACT'],
    });
    else if (action === 'create') data = await request('people:createContact', { personFields: fields }, 'POST', person);
    else if (action === 'update') {
      var current = await request(resource, { personFields: fields, sources: 'READ_SOURCE_TYPE_CONTACT' });
      var source = current.metadata?.sources?.find(function (s) { return s.type === 'CONTACT'; });
      if (!source || source.etag !== args.etag) error('联系人已变化或不是可编辑的个人联系人，请重新读取并核对修改内容。未写入任何修改。');
      data = await request(resource + ':updateContact', { updatePersonFields: Object.keys(person).join(','), personFields: fields }, 'PATCH', {
        ...person, resourceName: resource, metadata: { sources: [source] },
      });
    } else if (action === 'delete') data = await request(resource + ':deleteContact', {}, 'DELETE');
    return { ok: true, result: { accountId: selected.accountId, action, execution, data } };
  } catch (err) {
    return { ok: false, message: '[' + execution + '] ' + (err.message || '联系人操作失败，请核对 Google 通讯录中的实际状态。') };
  }
}

(function () {
  var PREFIX = 'gmail';
  cindy.onHostMessage(async function (message) {
    if (!message || message.type !== 'tool-call') return;
    var args = message.args || {};
    var isSchema = message.tool === PREFIX + '_schema';
    var context = args.session_context;
    // One call owns its receipt until final delivery. Presentation/IPC failures
    // must never downgrade a confirmed or uncertain Gmail mutation.
    var execution = 'not_executed';
    function beginOperation() {
      var previous = execution;
      execution = 'unknown';
      return function (value) {
        var current = ['executed', 'not_executed', 'unknown'].includes(value) ? value : 'unknown';
        execution = previous === 'unknown' || current === 'unknown' ? 'unknown'
          : previous === 'executed' || current === 'executed' ? 'executed' : 'not_executed';
      };
    }
    try {
      if (message.tool === 'gmail_contacts') {
        var contacts = await googleContacts(args, message.callId, beginOperation);
        await cindy.send({ type: 'tool-result', callId: message.callId, ...contacts });
        return;
      }
      if (message.tool === 'gmail_read_message') {
        var mail = await readMailMessageLink(args, beginOperation);
        await cindy.send({ type: 'tool-result', callId: message.callId, ok: true, result: mail });
        return;
      }
      if (message.tool === PREFIX + '_accounts') {
        var listed = await listAccounts();
        await cindy.send(Object.assign({ type: 'tool-result', callId: message.callId }, listed));
        return;
      }
      if (message.tool !== PREFIX + '_schema' && message.tool !== PREFIX + '_run') {
        await cindy.send({ type: 'tool-result', callId: message.callId, ok: false,
          message: '尚未执行：未知工具，请重新查看当前插件工具列表。' });
        return;
      }
      if (!cindy.node || typeof cindy.node.request !== 'function' || (!isSchema && !context)) {
        await cindy.send({ type: 'tool-result', callId: message.callId, ok: false,
          message: '尚未执行：当前 Cindy 缺少此功能所需的插件运行接口，请升级至 0.1.92 或更新版本。账号列表仍可使用。' });
        return;
      }
      if (!isSchema) {
        var selected = await selectGoogleAccount(args.account);
        if (!selected.ok) {
          await cindy.send({ type: 'tool-result', callId: message.callId, ok: false, message: selected.message });
          return;
        }
        args = Object.assign({}, args, { account: selected.accountId });
      }
      if (!isSchema) {
        var cardResult = await mailToolDraft(args, message.callId, beginOperation);
        if (cardResult) {
          await cindy.send({ type: 'tool-result', callId: message.callId, ok: !!cardResult.ok,
            ...(cardResult.ok ? { result: cardResult.data } : { message: '[' + cardResult.execution + '] ' + cardResult.message }) });
          return;
        }
      }
      var prepared = isSchema ? { options: args.options || {}, files: [], inline: [] } : await prepareMailAttachments(args, message.callId);
      if (prepared.inline && prepared.inline.length) {
        prepared.options = Object.assign({}, prepared.options, { 'inline-images': prepared.inline });
      }
      var finishWorker = beginOperation();
      var response = await cindy.node.request({
        method: isSchema ? 'schema' : 'run',
        authAccount: args.account,
        params: {
          command: args.command || [], arguments: args.arguments || [], options: prepared.options,
          accountEmail: !isSchema ? selected.accountEmail : undefined,
          workdir: context && context.workdir_is_local === true ? context.workdir : undefined,
          readOnly: !context || context.workdir_is_read_only !== false,
        },
        timeoutMs: 120000,
      });
      if (!response || !response.ok) {
        // Broker timeouts/process exits cannot prove an upstream mutation failed.
        await cindy.send({ type: 'tool-result', callId: message.callId, ok: false,
          message: 'Execution outcome unknown; do not retry a write before checking. ' + (response && response.message || 'Worker unavailable') });
        return;
      }
      var result = response.result;
      finishWorker(result?.execution);
      if (result.ok && prepared.files.length && result.data && typeof result.data === 'object') {
        result.data.importedAttachments = prepared.files;
      }
      if (!isSchema && result.ok && result.data && result.data.readBack && context && context.workdir_is_read_only === false) {
        result.data.readBack = await mailImagePreviews(result.data.readBack, selected.accountId);
        try { result.data.draftCard = await gmailCompose.present(message, selected, result.data.readBack); }
        catch (_) { result.data.draftCard = false; } // Do not change the known Gmail receipt.
      }
      if (result.ok && result.data?.readBack) {
        result.data.readBack.attachments = result.data.readBack.attachments.map(function ({ inlineData, ...metadata }) { return metadata; });
      }
      await cindy.send({ type: 'tool-result', callId: message.callId, ok: !!result.ok,
        ...(result.ok ? { result: result.data } : { message: '[' + execution + '] ' + (execution === result.execution
          ? result.message : '此前的草稿操作结果尚未完全确认，请先核对邮箱中的实际状态，不要重复发送、保存或删除。') }) });
    } catch (error) {
      if (message.tool === 'gmail_contacts') {
        await cindy.send({ type: 'tool-result', callId: message.callId, ok: false,
          message: '[' + execution + '] 联系人结果未能完整返回，请先核对 Google 通讯录中的实际状态，不要重复创建、修改或删除。' });
        return;
      }
      await cindy.send({ type: 'tool-result', callId: message.callId, ok: false,
        message: execution === 'executed' ? '[executed] 邮箱操作已执行，但结果未能完整返回。请先核对邮箱中的实际状态，不要重复发送、保存或删除。'
          : execution === 'unknown' ? '[unknown] 无法确认邮箱操作结果，请先核对邮箱中的实际状态，不要重复发送、保存或删除。'
          : '[not_executed] ' + (error.message || '无法准备 Gmail 操作，请检查账号和附件输入。') });
    }
  });
})();
