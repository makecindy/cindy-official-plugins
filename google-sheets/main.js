/* global cindy */

var SECRET_KEY = 'google_sheets_account';
var PLUGIN_NAME = 'Google Sheets';
var BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

function fail(message) {
  return { ok: false, message: message };
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
    return { err: 'Sheets API 返回 HTTP ' + response.status + ':' + message };
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
    return fail('尚未连接 Google Sheets 账号，请到「' + PLUGIN_NAME + '」详情页单独授权');
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

function spreadsheetId(input) {
  var match = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(input || '');
  return match ? match[1] : (input || '').trim();
}

async function sheets(args, callId) {
  var selected = await selectGoogleAccount(args.account);
  if (!selected.ok) return selected;
  args = Object.assign({}, args, { account: selected.accountId });
  var id = spreadsheetId(args.spreadsheet_id);
  if (!id) return fail('需要 spreadsheet_id(表格 id 或完整链接)');

  if (args.action === 'list_sheets') {
    var metadata = await api({
      url: BASE + '/' + encodeURIComponent(id) +
        '?fields=' + encodeURIComponent('properties(title),sheets(properties(sheetId,title,gridProperties))'),
      account: args.account,
      callId: callId,
    });
    if (metadata.err) return fail(metadata.err);
    return {
      ok: true,
      result: {
        title: metadata.data.properties ? metadata.data.properties.title : '',
        sheets: (metadata.data.sheets || []).map(function (sheet) {
          var properties = sheet.properties || {};
          return {
            title: properties.title,
            rows: properties.gridProperties ? properties.gridProperties.rowCount : null,
            cols: properties.gridProperties ? properties.gridProperties.columnCount : null,
          };
        }),
      },
    };
  }

  if (args.action === 'read_range') {
    if (!args.range) return fail('read_range 需要 range(A1 记法)');
    var read = await api({
      url: BASE + '/' + encodeURIComponent(id) + '/values/' + encodeURIComponent(args.range),
      account: args.account,
      callId: callId,
    });
    if (read.err) return fail(read.err);
    return {
      ok: true,
      result: { range: read.data.range, values: read.data.values || [] },
    };
  }

  if (args.action === 'write_range') {
    if (!args.range) return fail('write_range 需要 range(A1 记法)');
    if (!Array.isArray(args.values)) return fail('write_range 需要 values(二维数组)');
    var written = await api({
      url: BASE + '/' + encodeURIComponent(id) + '/values/' +
        encodeURIComponent(args.range) + '?valueInputOption=USER_ENTERED',
      method: 'PUT',
      body: {
        range: args.range,
        majorDimension: 'ROWS',
        values: args.values,
      },
      account: args.account,
      callId: callId,
    });
    if (written.err) return fail(written.err);
    return {
      ok: true,
      result: {
        updated_range: written.data.updatedRange,
        updated_cells: written.data.updatedCells,
      },
    };
  }

  return fail('未知 action:' + args.action);
}

cindy.onHostMessage(async function (message) {
  if (message && (message.tool === 'google_sheets_schema' || message.tool === 'google_sheets_run')) return;
  if (!message || message.type !== 'tool-call') return;
  try {
    var result = message.tool === 'google_sheets_accounts'
      ? await listAccounts()
      : message.tool === 'google_sheets'
        ? await sheets(message.args || {}, message.callId)
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
      message: 'Google Sheets 工具执行失败:' +
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
  var PREFIX = 'google_sheets';
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
