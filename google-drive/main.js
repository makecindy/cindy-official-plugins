/* global cindy */

var SECRET_KEY = 'google_drive_account';
var PLUGIN_NAME = 'Google Drive';
var BASE = 'https://www.googleapis.com/drive/v3';
var FIELDS = 'id,name,mimeType,modifiedTime,size,webViewLink,parents,trashed';
var EXPORT_MIME = {
  'application/vnd.google-apps.document': 'text/markdown',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
};

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
  if (opts.rawBody !== undefined) {
    request.headers['Content-Type'] = opts.contentType || 'text/plain';
    request.body = opts.rawBody;
  }
  var response = await cindy.fetch(request);
  if (!response.ok) return { err: response.message };
  if (response.status === 204) return { data: null };
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
    return { err: 'Drive API 返回 HTTP ' + response.status + ':' + message };
  }
  return { data: data };
}

async function listAccounts() {
  var response = await fetch('/oauth');
  if (!response.ok) return fail('账号状态查询失败(' + response.status + ')');
  var list = await response.json();
  var entry = list.find(function (item) { return item && item.key === SECRET_KEY; });
  if (!entry || !entry.clientConfigured) return fail('内置应用身份缺失，请升级 Cindy 后重试');
  if (!entry.accounts.length) {
    return fail('尚未连接 Google Drive 账号，请到「' + PLUGIN_NAME + '」详情页单独授权');
  }
  return {
    ok: true,
    result: {
      accounts: (await googleAccountMetadata.list(SECRET_KEY, entry.accounts)).map(function (account) {
        return {
          id: account.id,
          email: account.label,
          nickname: account.nickname || '',
          status: account.status,
          scope_stale: account.scopeStale === true,
        };
      }),
    },
  };
}

function fileView(file) {
  return {
    id: file.id,
    name: file.name,
    mime_type: file.mimeType,
    modified_time: file.modifiedTime,
    size: file.size ? Number(file.size) : null,
    link: file.webViewLink || '',
    parents: file.parents || [],
    trashed: Boolean(file.trashed),
  };
}

async function metadata(fileId, account, callId) {
  return api({
    url: BASE + '/files/' + encodeURIComponent(fileId) +
      '?fields=' + encodeURIComponent(FIELDS),
    account: account,
    callId: callId,
  });
}

async function drive(args, callId) {
  var selected = await selectGoogleAccount(args.account);
  if (!selected.ok) return selected;
  args = Object.assign({}, args, { account: selected.accountId });
  if (args.action === 'search') {
    if (!args.query) return fail('search 需要 query');
    var queryMode = args.query_mode || 'name';
    if (queryMode !== 'name' && queryMode !== 'raw') {
      return fail('query_mode 只能是 name 或 raw');
    }
    var query = queryMode === 'raw'
      ? String(args.query)
      : "name contains '" + String(args.query).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
    var listed = await api({
      url: BASE + '/files?q=' + encodeURIComponent(query + ' and trashed=false') +
        '&pageSize=' + clampInt(args.max_results, 10, 25) +
        '&fields=' + encodeURIComponent('files(' + FIELDS + ')'),
      account: args.account,
      callId: callId,
    });
    if (listed.err) return fail(listed.err);
    return {
      ok: true,
      result: { files: (listed.data.files || []).map(fileView) },
    };
  }

  if (args.action === 'list_folder') {
    var folderId = args.folder_id || 'root';
    var folder = await api({
      url: BASE + '/files?q=' +
        encodeURIComponent("'" + folderId.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "' in parents and trashed=false") +
        '&pageSize=' + clampInt(args.max_results, 25, 100) +
        '&fields=' + encodeURIComponent('files(' + FIELDS + ')'),
      account: args.account,
      callId: callId,
    });
    if (folder.err) return fail(folder.err);
    return {
      ok: true,
      result: { files: (folder.data.files || []).map(fileView) },
    };
  }

  if (args.action === 'get_meta') {
    if (!args.file_id) return fail('get_meta 需要 file_id');
    var file = await metadata(args.file_id, args.account, callId);
    if (file.err) return fail(file.err);
    return { ok: true, result: { file: fileView(file.data) } };
  }

  if (args.action === 'read') {
    if (!args.file_id) return fail('read 需要 file_id');
    var meta = await metadata(args.file_id, args.account, callId);
    if (meta.err) return fail(meta.err);
    var mime = meta.data.mimeType || '';
    var contentUrl;
    if (mime.indexOf('application/vnd.google-apps') === 0) {
      var exportMime = args.export_mime || EXPORT_MIME[mime];
      if (!exportMime) {
        return {
          ok: true,
          result: {
            file: fileView(meta.data),
            note: '该 Google 原生类型不支持文本导出，请打开文件链接',
          },
        };
      }
      contentUrl = BASE + '/files/' + encodeURIComponent(args.file_id) +
        '/export?mimeType=' + encodeURIComponent(exportMime);
    } else {
      contentUrl = BASE + '/files/' + encodeURIComponent(args.file_id) + '?alt=media';
    }
    var content = await cindy.fetch({
      url: contentUrl,
      headers: { Accept: '*/*' },
      callId: callId,
      authAccount: args.account || undefined,
    });
    if (!content.ok) {
      return fail(content.message || 'Drive 内容读取失败');
    }
    if (content.status < 200 || content.status >= 300) {
      return fail('Drive API 返回 HTTP ' + content.status + ':' + (content.body || '').slice(0, 200));
    }
    return {
      ok: true,
      result: {
        file: fileView(meta.data),
        content: content.body,
        truncated: Boolean(content.truncated),
      },
    };
  }

  if (args.action === 'download') {
    if (!args.file_id) return fail('download 需要 file_id');
    if (!args.save_deposit || !args.save_deposit.token) {
      return fail('download 需要落盘目录，请通过 ghost_call 顶层 save_dir 交付');
    }
    var downloadMeta = await metadata(args.file_id, args.account, callId);
    if (downloadMeta.err) return fail(downloadMeta.err);
    var downloadMime = downloadMeta.data.mimeType || '';
    var downloadUrl = downloadMime.indexOf('application/vnd.google-apps') === 0
      ? BASE + '/files/' + encodeURIComponent(args.file_id) +
        '/export?mimeType=' +
        encodeURIComponent(args.export_mime || EXPORT_MIME[downloadMime] || 'application/pdf')
      : BASE + '/files/' + encodeURIComponent(args.file_id) + '?alt=media';
    var saved = await cindy.fetch({
      url: downloadUrl,
      as: 'file',
      saveTo: {
        token: args.save_deposit.token,
        filename: args.filename || downloadMeta.data.name || undefined,
      },
      callId: callId,
      authAccount: args.account || undefined,
    });
    if (!saved.ok) return fail(saved.message);
    if (!saved.file) return fail('下载失败(HTTP ' + saved.status + ')');
    return {
      ok: true,
      result: {
        downloaded: true,
        dir_name: args.save_deposit.dir_name,
        file_name: saved.file.file_name,
        bytes: saved.file.bytes,
      },
    };
  }

  if (args.action === 'upload') {
    if (!args.name || args.content === undefined) return fail('upload 需要 name / content');
    if (String(args.content).length > 200 * 1024) return fail('upload 内容超过 200KB 上限');
    var boundary = 'cindy-drive-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    var fileMeta = { name: args.name, mimeType: args.mime_type || 'text/plain' };
    if (args.parent_folder_id) fileMeta.parents = [args.parent_folder_id];
    var body =
      '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(fileMeta) + '\r\n' +
      '--' + boundary + '\r\nContent-Type: ' +
      (args.mime_type || 'text/plain') + '; charset=UTF-8\r\n\r\n' +
      args.content + '\r\n--' + boundary + '--';
    var uploaded = await api({
      url: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=' +
        encodeURIComponent(FIELDS),
      method: 'POST',
      rawBody: body,
      contentType: 'multipart/related; boundary=' + boundary,
      account: args.account,
      callId: callId,
    });
    if (uploaded.err) return fail(uploaded.err);
    return { ok: true, result: { uploaded: true, file: fileView(uploaded.data) } };
  }

  if (args.action === 'move') {
    if (!args.file_id) return fail('move 需要 file_id');
    if (!args.new_parent_id && !args.new_name) {
      return fail('move 需要 new_parent_id 或 new_name');
    }
    var suffix = '';
    if (args.new_parent_id) {
      var current = await metadata(args.file_id, args.account, callId);
      if (current.err) return fail(current.err);
      suffix = '?addParents=' + encodeURIComponent(args.new_parent_id) +
        '&removeParents=' + encodeURIComponent((current.data.parents || []).join(','));
    }
    var moved = await api({
      url: BASE + '/files/' + encodeURIComponent(args.file_id) + suffix,
      method: 'PATCH',
      body: args.new_name ? { name: args.new_name } : {},
      account: args.account,
      callId: callId,
    });
    if (moved.err) return fail(moved.err);
    return { ok: true, result: { moved: true } };
  }

  if (args.action === 'delete') {
    if (!args.file_id) return fail('delete 需要 file_id');
    if (args.permanent === true) {
      var removed = await api({
        url: BASE + '/files/' + encodeURIComponent(args.file_id),
        method: 'DELETE',
        account: args.account,
        callId: callId,
      });
      if (removed.err) return fail(removed.err);
      return { ok: true, result: { deleted: true, permanent: true } };
    }
    var trashed = await api({
      url: BASE + '/files/' + encodeURIComponent(args.file_id),
      method: 'PATCH',
      body: { trashed: true },
      account: args.account,
      callId: callId,
    });
    if (trashed.err) return fail(trashed.err);
    return { ok: true, result: { deleted: true, permanent: false } };
  }

  return fail('未知 action:' + args.action);
}

cindy.onHostMessage(async function (message) {
  if (message && (message.tool === 'google_drive_schema' || message.tool === 'google_drive_run')) return;
  if (!message || message.type !== 'tool-call') return;
  try {
    var result = message.tool === 'google_drive_accounts'
      ? await listAccounts()
      : message.tool === 'google_drive'
        ? await drive(message.args || {}, message.callId)
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
      message: 'Google Drive 工具执行失败:' +
        (error && error.message ? error.message : String(error)),
    });
  }
});

// BEGIN GENERATED GOG BRIDGE
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
      var names = labels(await read(), key);
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
// Generated plugin-local bridge. Existing named tools remain compatibility-only.
async function selectGoogleAccount(accountId) {
  var listed = await listAccounts();
  if (!listed.ok) return listed;
  var accounts = listed.result.accounts;
  if (accountId === undefined && accounts.length !== 1) {
    return fail('尚未执行：已连接多个账号，请明确选择账号并传入 account。');
  }
  var account = accountId === undefined ? accounts[0] : accounts.find(function (item) { return item.id === accountId; });
  if (!account) return fail('尚未执行：指定账号不存在，请重新选择账号；不会切换到其他账号。');
  if (account.status !== 'connected') {
    return fail('尚未执行：账号 ' + (account.email || account.id) + ' 授权已失效或权限不足，请到插件详情页重新连接此账号。');
  }
  return { ok: true, accountId: account.id };
}
(function () {
  var PREFIX = 'google_drive';
  cindy.onHostMessage(async function (message) {
    if (!message || message.type !== 'tool-call') return;
    if (message.tool !== PREFIX + '_schema' && message.tool !== PREFIX + '_run') return;
    var args = message.args || {};
    var isSchema = message.tool === PREFIX + '_schema';
    var context = args.session_context;
    try {
      if (!isSchema) {
        var selected = await selectGoogleAccount(args.account);
        if (!selected.ok) {
          await cindy.send({ type: 'tool-result', callId: message.callId, ok: false, message: selected.message });
          return;
        }
        args = Object.assign({}, args, { account: selected.accountId });
      }
      if (!isSchema && !context) throw new Error('This operation requires a Cindy version with plugin session context.');
      var response = await cindy.node.request({
        method: isSchema ? 'schema' : 'run',
        authAccount: args.account,
        params: {
          command: args.command || [], arguments: args.arguments || [], options: args.options || {},
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
      await cindy.send({ type: 'tool-result', callId: message.callId, ok: !!result.ok,
        ...(result.ok ? { result: result.data } : { message: '[' + result.execution + '] ' + result.message }) });
    } catch (_error) {
      await cindy.send({ type: 'tool-result', callId: message.callId, ok: false,
        message: 'Unable to complete Google operation. If execution started, check the result before retrying.' });
    }
  });
})();
