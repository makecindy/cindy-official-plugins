/**
 * 163 邮箱官方插件。
 *
 * 客户端授权密码由设置页直接写入 Cindy 的 /secrets 只写通道。浏览器 main.js 只处理
 * 非敏感邮箱地址；宿主仅在 ghost.json 绑定的 Node 方法上，把客户端授权密码临时注入
 * 对应 Worker 的 request.cindy.secrets，Agent 参数和插件消息都不携带它。
 */

/* global BroadcastChannel, cindy, cindyMail, fetch, navigator, setTimeout */

var SETTINGS_CHANNEL = '163-mail-settings';
// Shared with settings.js and the mail SDK: every whole-KV replacement holds it.
var STORAGE_LOCK = '163-mail-kv';
var SECRET_KEYS = {
  a: 'mail_163_authorization_code',
  b: 'mail_163_authorization_code_b',
};
var settingsRequests = new Map();

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function fail(message) {
  return { ok: false, message: message };
}

function normalizeEmail(value) {
  var email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[^\s@]+@163\.com$/.test(email) || email.length > 254) {
    throw new Error('请输入有效的 163 邮箱地址（例如 example@163.com）');
  }
  return email;
}

function normalizeCredentialSlot(value) {
  if (value === undefined || value === null || value === '') return 'a';
  if (value !== 'a' && value !== 'b') throw new Error('163 邮箱凭证槽位无效，请重新连接');
  return value;
}

function nodeMethod(baseMethod, credentialSlot) {
  return baseMethod + '-' + normalizeCredentialSlot(credentialSlot);
}

async function readJson(path) {
  var response = await fetch(path);
  if (!response.ok) throw new Error('读取 163 邮箱配置失败');
  var value = await response.json();
  return value;
}

async function loadStoredAccount() {
  var values = await Promise.all([readJson('/kv'), readJson('/secrets')]);
  var kv = isObject(values[0]) ? values[0] : {};
  var secretItems = Array.isArray(values[1]) ? values[1] : [];
  var email = typeof kv.email === 'string' ? kv.email.trim().toLowerCase() : '';
  var credentialSlot = normalizeCredentialSlot(kv.credentialSlot);
  var secretSaved = secretItems.some(function hasSavedSecret(item) {
    return isObject(item) && item.key === SECRET_KEYS[credentialSlot] && item.saved === true;
  });
  return {
    connected: Boolean(email && secretSaved),
    email: email || null,
    credentialSlot: credentialSlot,
    persistence: 'cindy-safe-storage',
  };
}

async function loadAccountState() {
  var state = await loadStoredAccount();
  return {
    connected: state.connected,
    email: state.email,
    persistence: state.persistence,
  };
}

async function requireConfiguredAccount() {
  var state = await loadStoredAccount();
  if (!state.connected || !state.email) {
    throw new Error('尚未配置 163 邮箱，请到「163 邮箱」插件详情页完成连接');
  }
  return { email: state.email, credentialSlot: state.credentialSlot };
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
      : '163 邮箱 Worker 调用失败，请稍后重试');
  }
  return response.result;
}

async function handleSettingsRequest(action, payload) {
  if (action !== 'connect') throw new Error('未知设置动作');
  var email = normalizeEmail(payload.email);
  var credentialSlot = normalizeCredentialSlot(payload.credentialSlot);
  return nodeRequest(nodeMethod('account/connect', credentialSlot), {
    email: email,
    credentialSlot: credentialSlot,
  }, 45000);
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
          message: error && error.message ? error.message : '163 邮箱连接失败，请重试',
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

  return output;
}

async function runMail(args, message) {
  var composed = await imapCompose.runTool(args, message);
  if (composed) return composed;
  var action;
  try {
    action = sanitizeMailArgs(args);
  } catch (error) {
    return fail(error && error.message ? error.message : '163 邮箱参数无效');
  }

  try {
    var account = await requireConfiguredAccount();
    var result = await nodeRequest(nodeMethod('mail/action', account.credentialSlot), {
      email: account.email,
      credentialSlot: account.credentialSlot,
      action: action,
    }, 45000);
    return { ok: true, result: result };
  } catch (error) {
    return fail(error && error.message ? error.message : '163 邮箱操作失败，请稍后重试');
  }
}

async function statusResult() {
  try {
    return { ok: true, result: await loadAccountState() };
  } catch (error) {
    return fail(error && error.message ? error.message : '163 邮箱连接状态查询失败');
  }
}

/* BEGIN cindy-imap-compose (identical in qq-mail, 163-mail, icloud-mail and yahoo-mail) */
// Connects this IMAP plugin to Cindy's common mail cards (cindyMail v1). Cindy
// owns cards, autosave, the 10-second send countdown and task continuation; the
// Node worker reads, saves, sends and deletes the mailbox draft. Credentials stay
// in the Host. config: { providerName, storageLock, account(), method(account) }.
function createImapMailCompose(config) {
  var COPY = {
    'zh-CN': {
      sendRequiresDraft: '请先用 draft、reply、reply_all 或 forward 创建草稿并展示草稿卡，再用 send_draft 发送；不支持直接发信。',
      updateCindy: '当前 Cindy 版本不支持邮件草稿卡片，请更新 Cindy 后再编辑或发送草稿。',
      notConfigured: '尚未连接 {provider}，请到插件详情页完成连接。',
      accountChanged: '这份草稿属于另一个 {provider} 账号，请重新连接原账号后再操作。',
      draftIdRequired: '需要 draft_id（创建或读取草稿时返回的 Message-ID）。',
      readOnly: '只读任务不能创建、修改、发送或删除草稿。',
      invalidArgs: '{action} 的参数无效：{detail}',
      outcomeUnknown: '无法确认 {provider} 的操作结果，请先检查邮箱，不要重复操作。',
      workerUnavailable: '{provider} Worker 暂时不可用，未执行操作，请稍后重试。',
    },
    en: {
      sendRequiresDraft: 'Create a draft with draft, reply, reply_all or forward and show its draft card, then send it with send_draft. Direct sending is not supported.',
      updateCindy: 'This Cindy version does not support mail draft cards. Update Cindy before editing or sending drafts.',
      notConfigured: '{provider} is not connected. Connect it on the plugin details page.',
      accountChanged: 'This draft belongs to another {provider} account. Reconnect that account first.',
      draftIdRequired: 'draft_id is required (the Message-ID returned when the draft was created or read).',
      readOnly: 'A read-only task cannot create, change, send or delete drafts.',
      invalidArgs: 'Invalid {action} arguments: {detail}',
      outcomeUnknown: 'Could not confirm the {provider} result. Check your mailbox before trying again.',
      workerUnavailable: 'The {provider} worker is unavailable. Nothing was done; try again later.',
    },
    ja: {
      sendRequiresDraft: 'draft、reply、reply_all、forward で下書きを作成して下書きカードを表示してから、send_draft で送信してください。直接送信はできません。',
      updateCindy: 'この Cindy のバージョンはメールの下書きカードに対応していません。下書きを編集・送信する前に Cindy を更新してください。',
      notConfigured: '{provider} が接続されていません。プラグインの詳細画面で接続してください。',
      accountChanged: 'この下書きは別の {provider} アカウントのものです。先にそのアカウントを再接続してください。',
      draftIdRequired: 'draft_id（下書きの作成時または読み込み時に返された Message-ID）が必要です。',
      readOnly: '読み取り専用のタスクでは下書きを作成、変更、送信、削除できません。',
      invalidArgs: '{action} の引数が無効です：{detail}',
      outcomeUnknown: '{provider} の結果を確認できません。再試行する前にメールボックスを確認してください。',
      workerUnavailable: '{provider} の Worker を利用できません。何も実行していません。しばらくしてから再試行してください。',
    },
    ko: {
      sendRequiresDraft: 'draft, reply, reply_all 또는 forward로 임시 보관 메일을 만들고 카드를 표시한 다음 send_draft로 보내세요. 바로 보내기는 지원하지 않습니다.',
      updateCindy: '이 Cindy 버전은 메일 임시 보관 카드를 지원하지 않습니다. 임시 보관 메일을 편집하거나 보내기 전에 Cindy를 업데이트하세요.',
      notConfigured: '{provider}이(가) 연결되지 않았습니다. 플러그인 상세 화면에서 연결하세요.',
      accountChanged: '이 임시 보관 메일은 다른 {provider} 계정의 것입니다. 먼저 그 계정을 다시 연결하세요.',
      draftIdRequired: 'draft_id(임시 보관 메일을 만들거나 읽을 때 반환된 Message-ID)가 필요합니다.',
      readOnly: '읽기 전용 작업에서는 임시 보관 메일을 만들거나 변경, 전송, 삭제할 수 없습니다.',
      invalidArgs: '{action} 인수가 올바르지 않습니다: {detail}',
      outcomeUnknown: '{provider} 작업 결과를 확인할 수 없습니다. 다시 시도하기 전에 메일함을 확인하세요.',
      workerUnavailable: '{provider} Worker를 사용할 수 없습니다. 아무 작업도 하지 않았습니다. 잠시 후 다시 시도하세요.',
    },
  };
  var CREATE = { draft: 'new', reply: 'reply', reply_all: 'reply_all', forward: 'forward' };
  var DRAFT_OPS = { get_draft: 'get', update_draft: 'update', send_draft: 'send', delete_draft: 'delete' };
  var locale = null;
  var previews = new Map();

  async function currentLocale() {
    if (locale) return locale;
    try {
      var response = await fetch('/app-context');
      var value = (await response.json()).context.locale;
      locale = /^zh/i.test(value) ? 'zh-CN' : COPY[String(value).slice(0, 2)] ? String(value).slice(0, 2) : 'en';
    } catch (_) {
      return 'en';
    }
    return locale;
  }
  async function t(key, values) {
    var catalog = COPY[await currentLocale()] || COPY.en;
    return (catalog[key] || COPY.en[key]).replace(/\{(\w+)\}/g, function (all, name) {
      return name === 'provider' ? config.providerName : values && values[name] !== undefined ? values[name] : all;
    });
  }
  async function failure(key, execution, values) {
    return { ok: false, execution: execution || 'not_executed', message: await t(key, values) };
  }

  async function selectAccount(accountId) {
    var state;
    try { state = await config.account(); } catch (_) { state = null; }
    if (!state || !state.connected || !state.email) return failure('notConfigured');
    if (accountId !== undefined && accountId !== state.email) return failure('accountChanged');
    return { ok: true, accountId: state.email, accountEmail: state.email, state: state };
  }

  // Worker failures without a structured receipt are unknown for writes.
  async function worker(action, params, write) {
    var account = await selectAccount(params.account);
    if (!account.ok) return account;
    var response;
    try {
      response = await cindy.node.request({
        method: config.method(account.state),
        params: { email: account.state.email, credentialSlot: account.state.credentialSlot,
          locale: await currentLocale(), action: Object.assign({}, params.fields, { action: action }) },
        timeoutMs: 120000,
      });
    } catch (_) {
      response = null;
    }
    var result = response && response.ok ? response.result : null;
    if (!result || typeof result.ok !== 'boolean') return failure(write ? 'outcomeUnknown' : 'workerUnavailable', write ? 'unknown' : 'not_executed');
    return result;
  }

  // Inline worker bytes only feed Host media previews; never cards or the model.
  async function withPreviews(readBack) {
    if (!readBack || readBack.status !== 'read_back' || !Array.isArray(readBack.attachments)) return readBack;
    var images = [];
    var attachments = [];
    for (var item of readBack.attachments) {
      var clean = Object.assign({}, item);
      delete clean.inlineData;
      delete clean.sha256;
      var url = previews.get(item.key);
      if (!url && typeof item.inlineData === 'string') {
        try {
          var deposited = await cindy.send({ type: 'cindy-request', kind: 'deposit_media', data: item.inlineData, label: item.filename || 'image' });
          if (deposited && deposited.ok && typeof deposited.url === 'string') {
            url = deposited.url;
            previews.set(item.key, url);
            while (previews.size > 64) previews.delete(previews.keys().next().value);
          }
        } catch (_) { /* A preview never invalidates a verified draft. */ }
      }
      if (url && /^image\//.test(item.mimeType)) {
        clean.previewUrl = url;
        if (item.contentId) images.push({ cid: item.contentId, url: url });
      }
      attachments.push(clean);
    }
    return Object.assign({}, readBack, { attachments: attachments, images: images });
  }
  async function withResultPreviews(result) {
    if (result && result.ok && result.data && result.data.readBack) {
      result.data = Object.assign({}, result.data, { readBack: await withPreviews(result.data.readBack) });
    }
    if (result && !result.ok && result.stale && typeof result.stale === 'object') result.stale = await withPreviews(result.stale);
    return result;
  }

  var supported = typeof cindyMail !== 'undefined' && cindyMail && cindyMail.version === 1 && cindyMail.sendGraceMs === 10000;
  var compose = supported ? cindyMail.register({
    providerName: config.providerName,
    draftStorage: 'server',
    storageLock: config.storageLock,
    richText: true,
    selectAccount: async function (accountId) {
      var account = await selectAccount(accountId);
      return account.ok ? { ok: true, accountId: account.accountId, accountEmail: account.accountEmail } : account;
    },
    readDraft: async function (input) {
      return withResultPreviews(await worker('compose_read', { account: input.record.account,
        fields: { draftId: input.record.draftId, locator: input.record.locator } }, false));
    },
    writeDraft: async function (input) {
      var result = await worker('compose_write', { account: input.record.account, fields: {
        draftId: input.record.draftId, locator: input.record.locator, fingerprint: input.record.fingerprint,
        fields: input.fields, send: input.send, attachments: input.attachments || [] } }, true);
      return withResultPreviews(result);
    },
    deleteDraft: async function (input) {
      return worker('compose_delete', { account: input.record.account,
        fields: { draftId: input.record.draftId, locator: input.record.locator } }, true);
    },
  }) : null;

  function stringOrList(value) {
    return typeof value === 'string' || (Array.isArray(value) && value.length <= 100 && value.every(function (item) { return typeof item === 'string'; }));
  }
  function composeFields(args, names) {
    var fields = {};
    names.forEach(function (name) { if (args[name] !== undefined) fields[name] = args[name]; });
    ['to', 'cc', 'bcc'].forEach(function (name) {
      if (fields[name] !== undefined && !stringOrList(fields[name])) throw new Error(name);
    });
    ['subject', 'body_text', 'body_html'].forEach(function (name) {
      if (fields[name] !== undefined && typeof fields[name] !== 'string') throw new Error(name);
    });
    if (fields.attachment_paths !== undefined && (!Array.isArray(fields.attachment_paths)
      || fields.attachment_paths.some(function (item) { return typeof item !== 'string'; }))) throw new Error('attachment_paths');
    return fields;
  }
  function draftId(args) {
    return typeof args.draft_id === 'string' && /^<[^<>\s]{3,994}>$/.test(args.draft_id.trim()) ? args.draft_id.trim() : null;
  }
  // Present the read-back card only in a writable task, as the common flow requires.
  async function presented(message, args, result) {
    result = await withResultPreviews(result);
    if (!result.ok || !result.data || !result.data.readBack || result.data.readBack.status !== 'read_back') return result;
    if (args.session_context && args.session_context.workdir_is_read_only === false && compose) {
      var account = await selectAccount();
      try {
        result.data.draftCard = account.ok ? await compose.present(message,
          { accountId: account.accountId, accountEmail: account.accountEmail }, result.data.readBack) : false;
      } catch (_) {
        result.data.draftCard = false; // Never change a known mailbox receipt.
      }
    }
    return result;
  }
  function toTool(result) {
    if (result.ok) {
      var data = Object.assign({}, result.data);
      if (data.readBack && data.readBack.status === 'read_back') {
        data.draft_id = data.readBack.draftId;
        data.readBack = Object.assign({}, data.readBack, { attachments: data.readBack.attachments.map(function (item) {
          var clean = Object.assign({}, item);
          delete clean.inlineData;
          delete clean.sha256;
          return clean;
        }) });
      }
      return { ok: true, result: data };
    }
    return { ok: false, message: '[' + (result.execution || 'not_executed') + '] ' + result.message };
  }

  // Returns null for actions this module does not own.
  async function runTool(args, message) {
    var action = args.action;
    if (action === 'send') return toTool(await failure('sendRequiresDraft'));
    if (!CREATE[action] && !DRAFT_OPS[action]) return null;
    var readOnly = !args.session_context || args.session_context.workdir_is_read_only !== false;
    var fields;
    try {
      fields = composeFields(args, ['to', 'cc', 'bcc', 'subject', 'body_text', 'body_html', 'attachment_paths']);
      if (action === 'draft' && (fields.to === undefined || typeof fields.subject !== 'string' || typeof fields.body_text !== 'string')) throw new Error('to, subject, body_text');
      if (CREATE[action] && action !== 'draft') {
        var uid = Number(args.message_uid);
        if (!Number.isInteger(uid) || uid <= 0) throw new Error('message_uid');
        fields.source_folder = typeof args.folder === 'string' && args.folder.trim() ? args.folder.trim() : 'INBOX';
        fields.source_uid = uid;
      }
    } catch (error) {
      return toTool(await failure('invalidArgs', 'not_executed', { action: action, detail: error.message }));
    }
    // Mailbox writes follow the task's permission, like every other mail plugin.
    if (CREATE[action] && readOnly) return toTool(await failure('readOnly'));
    // Without the common mail SDK a draft would have no card to edit or send from.
    if (CREATE[action] && !compose) return toTool(await failure('updateCindy'));
    if (CREATE[action]) {
      fields.mode = CREATE[action];
      return toTool(await presented(message, args, await worker('compose_create', { fields: fields }, true)));
    }
    var id = draftId(args);
    if (!id) return toTool(await failure('draftIdRequired'));
    var operation = DRAFT_OPS[action];
    if (operation !== 'get' && readOnly) return toTool(await failure('readOnly'));
    if (!compose) {
      if (operation !== 'get') return toTool(await failure('updateCindy'));
      return toTool(await withResultPreviews(await worker('compose_read', { fields: { draftId: id } }, false)));
    }
    var account = await selectAccount();
    if (!account.ok) return toTool(account);
    var record = await compose.resolveDraft(account.accountId, id);
    // Send always enters the common flow; it refuses drafts without a card.
    if (record || operation === 'send') {
      var flushed = await compose.beforeTool({ operation: operation, account: account.accountId, draftId: id,
        readOnly: readOnly, sourceCallId: message.callId });
      if (flushed) return toTool(flushed);
      record = await compose.resolveDraft(account.accountId, id);
    }
    var locator = record ? record.locator : undefined;
    if (operation === 'delete') return toTool(await worker('compose_delete', { fields: { draftId: id, locator: locator } }, true));
    if (operation === 'update') {
      fields.draft_id = id;
      fields.locator = locator;
      return toTool(await presented(message, args, await worker('compose_update', { fields: fields }, true)));
    }
    return toTool(await presented(message, args, await worker('compose_read', { fields: { draftId: id, locator: locator } }, false)));
  }

  return { compose: compose, runTool: runTool };
}
/* END cindy-imap-compose */

var imapCompose = createImapMailCompose({
  providerName: '163 邮箱',
  storageLock: STORAGE_LOCK,
  account: async function () {
    var state = await loadStoredAccount();
    return { connected: state.connected, email: state.email, credentialSlot: state.credentialSlot };
  },
  method: function (account) { return 'mail/action-' + account.credentialSlot; },
});

cindy.onHostMessage(function onHostMessage(message) {
  if (!message || message.type !== 'tool-call') return;
  void (async function dispatch() {
    try {
      var result = message.tool === 'mail_163_status'
        ? await statusResult()
        : message.tool === 'mail_163'
          ? await runMail(isObject(message.args) ? message.args : {}, message)
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
        message: error && error.message ? error.message : '163 邮箱工具执行失败',
      });
    }
  })();
});
