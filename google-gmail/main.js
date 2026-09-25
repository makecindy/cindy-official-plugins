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
// Plugin-local bridge. Google business operations run only through gog.
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
  if (inline && command !== 'send') throw new Error('Draft commands cannot embed new images. Save them as normal attachments, or send only after explicit permission.');
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
  var embedded = files.filter(function (file) { return inlineSet.has(file.hash); });
  if (inline && embedded.length !== inline.length) throw new Error('Every inline image must also be a granted chat attachment.');
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
  if (account.status !== 'connected' || account.scope_stale === true) {
    return fail('尚未执行：账号 ' + (account.email || account.id) + ' 授权已失效或权限不足，请到插件详情页重新连接此账号。');
  }
  return { ok: true, accountId: account.id };
}
(function () {
  var PREFIX = 'gmail';
  cindy.onHostMessage(async function (message) {
    if (!message || message.type !== 'tool-call') return;
    var args = message.args || {};
    var isSchema = message.tool === PREFIX + '_schema';
    var context = args.session_context;
    var workerRequested = false;
    try {
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
      var prepared = isSchema ? { options: args.options || {}, files: [], inline: [] } : await prepareMailAttachments(args, message.callId);
      if (prepared.inline && prepared.inline.length) {
        prepared.options = Object.assign({}, prepared.options, { 'inline-images': prepared.inline });
      }
      workerRequested = true;
      var response = await cindy.node.request({
        method: isSchema ? 'schema' : 'run',
        authAccount: args.account,
        params: {
          command: args.command || [], arguments: args.arguments || [], options: prepared.options,
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
      if (result.ok && prepared.files.length && result.data && typeof result.data === 'object') {
        result.data.importedAttachments = prepared.files;
      }
      await cindy.send({ type: 'tool-result', callId: message.callId, ok: !!result.ok,
        ...(result.ok ? { result: result.data } : { message: '[' + result.execution + '] ' + result.message }) });
    } catch (error) {
      await cindy.send({ type: 'tool-result', callId: message.callId, ok: false,
        message: workerRequested ? '[unknown] Unable to complete Google operation; check its result before retrying a write.'
          : '[not_executed] ' + (error.message || 'Unable to prepare Gmail operation; check account and attachment inputs.') });
    }
  });
})();
