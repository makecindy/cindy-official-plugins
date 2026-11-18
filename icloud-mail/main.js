/**
 * iCloud Mail 官方插件。
 *
 * App 专用密码由设置页直接写入 Cindy 的 /secrets 只写通道。浏览器 main.js 只处理
 * 非敏感邮箱地址；宿主仅在 ghost.json 绑定的 Node 方法上，把密码临时注入
 * 对应 Worker 的 request.cindy.secrets，Agent 参数和插件消息都不携带它。
 */

/* global BroadcastChannel, cindy, cindyMail, clearTimeout, fetch, navigator, setTimeout */

var SETTINGS_CHANNEL = 'icloud-mail-settings';
// Shared with settings.js and the mail SDK: every whole-KV replacement holds it.
var STORAGE_LOCK = 'icloud-mail-kv';
var SECRET_KEYS = {
  a: 'icloud_mail_app_password',
  b: 'icloud_mail_app_password_b',
};
var settingsRequests = new Map();

/*
 * 运行时文案只跟随宿主语言（app-context / host-context-changed），不读浏览器或系统语言。
 * 宿主没有给出语言、给出不支持的语言或查询失败时回退英文。每次工具调用和设置请求开始时
 * 取一次语言快照，并通过 params.locale 交给 Worker，让 Worker 的错误文案与之一致。
 */
var DEFAULT_LOCALE = 'en';
var LOCALE_TIMEOUT_MS = 3000;
var MESSAGES = {
  'zh-CN': {
    invalidEmail: '请输入有效的 iCloud Mail 邮箱地址',
    readConfigFailed: '读取 iCloud Mail 配置失败',
    invalidCredentialSlot: 'iCloud Mail 凭证槽位无效，请重新连接',
    notConfigured: '尚未配置 iCloud Mail，请到「iCloud Mail」插件详情页完成连接',
    workerFailed: 'iCloud Mail Worker 调用失败，请稍后重试',
    moveUnconfirmed: '无法确认邮件是否已移动，请重新搜索邮箱后再操作',
    flagsUnconfirmed: '无法确认已读状态是否已更改，请重新读取这封邮件确认后再操作',
    unknownSettingsAction: '未知设置动作',
    connectFailed: 'iCloud Mail 连接失败，请重试',
    invalidUid: 'message_uid 必须是有效的正整数',
    unknownAction: '未知 action：{action}',
    moveNeedsTarget: 'move 需要 target_folder；请先调用 list_folders',
    invalidArgs: 'iCloud Mail 参数无效',
    operationFailed: 'iCloud Mail 操作失败，请稍后重试',
    statusFailed: 'iCloud Mail 连接状态查询失败',
    unknownTool: '未知工具：{tool}',
    toolFailed: 'iCloud Mail 工具执行失败',
  },
  en: {
    invalidEmail: 'Enter a valid iCloud Mail email address',
    readConfigFailed: 'Failed to read the iCloud Mail configuration',
    invalidCredentialSlot: 'Invalid iCloud Mail credential slot. Reconnect the account.',
    notConfigured: 'iCloud Mail is not configured yet. Open the "iCloud Mail" plugin details and connect the account.',
    workerFailed: 'The iCloud Mail Worker call failed. Try again later.',
    moveUnconfirmed: 'Could not confirm whether the message was moved. Search the mailbox again before doing anything else.',
    flagsUnconfirmed: 'Could not confirm whether the read status changed. Read the message again to check before changing it.',
    unknownSettingsAction: 'Unknown settings action',
    connectFailed: 'iCloud Mail connection failed. Try again.',
    invalidUid: 'message_uid must be a valid positive integer',
    unknownAction: 'Unknown action: {action}',
    moveNeedsTarget: 'move requires target_folder; call list_folders first',
    invalidArgs: 'Invalid iCloud Mail arguments',
    operationFailed: 'iCloud Mail operation failed. Try again later.',
    statusFailed: 'Failed to check the iCloud Mail connection status',
    unknownTool: 'Unknown tool: {tool}',
    toolFailed: 'iCloud Mail tool execution failed',
  },
  ja: {
    invalidEmail: '有効なiCloudメールアドレスを入力してください',
    readConfigFailed: 'iCloudメールの設定を読み込めませんでした',
    invalidCredentialSlot: 'iCloudメールの認証情報スロットが無効です。再接続してください',
    notConfigured: 'iCloudメールはまだ設定されていません。「iCloudメール」プラグインの詳細画面で接続を完了してください',
    workerFailed: 'iCloudメールWorkerの呼び出しに失敗しました。しばらくしてから再試行してください',
    moveUnconfirmed: 'メールが移動されたかどうかを確認できません。ほかの操作をする前にメールボックスをもう一度検索してください',
    flagsUnconfirmed: '既読状態が変更されたかどうかを確認できません。もう一度メールを読み込んで確認してから操作してください',
    unknownSettingsAction: '不明な設定操作です',
    connectFailed: 'iCloudメールへの接続に失敗しました。再試行してください',
    invalidUid: 'message_uid は有効な正の整数である必要があります',
    unknownAction: '不明な action：{action}',
    moveNeedsTarget: 'move には target_folder が必要です。先に list_folders を呼び出してください',
    invalidArgs: 'iCloudメールの引数が無効です',
    operationFailed: 'iCloudメールの操作に失敗しました。しばらくしてから再試行してください',
    statusFailed: 'iCloudメールの接続状態を確認できませんでした',
    unknownTool: '不明なツール：{tool}',
    toolFailed: 'iCloudメールのツール実行に失敗しました',
  },
  ko: {
    invalidEmail: '올바른 iCloud 메일 주소를 입력하세요',
    readConfigFailed: 'iCloud 메일 설정을 읽지 못했습니다',
    invalidCredentialSlot: 'iCloud 메일 인증 정보 슬롯이 올바르지 않습니다. 다시 연결하세요',
    notConfigured: 'iCloud 메일이 아직 설정되지 않았습니다. "iCloud 메일" 플러그인 상세 화면에서 연결을 완료하세요',
    workerFailed: 'iCloud 메일 Worker 호출에 실패했습니다. 잠시 후 다시 시도하세요',
    moveUnconfirmed: '메일이 이동되었는지 확인할 수 없습니다. 다른 작업을 하기 전에 메일함을 다시 검색하세요',
    flagsUnconfirmed: '읽음 상태가 바뀌었는지 확인할 수 없습니다. 메일을 다시 읽어 확인한 후 작업하세요',
    unknownSettingsAction: '알 수 없는 설정 작업입니다',
    connectFailed: 'iCloud 메일 연결에 실패했습니다. 다시 시도하세요',
    invalidUid: 'message_uid는 올바른 양의 정수여야 합니다',
    unknownAction: '알 수 없는 action: {action}',
    moveNeedsTarget: 'move에는 target_folder가 필요합니다. 먼저 list_folders를 호출하세요',
    invalidArgs: 'iCloud 메일 인수가 올바르지 않습니다',
    operationFailed: 'iCloud 메일 작업에 실패했습니다. 잠시 후 다시 시도하세요',
    statusFailed: 'iCloud 메일 연결 상태를 확인하지 못했습니다',
    unknownTool: '알 수 없는 도구: {tool}',
    toolFailed: 'iCloud 메일 도구 실행에 실패했습니다',
  },
};
var hostLocale = DEFAULT_LOCALE;
var localeGeneration = 0;
var localePromise = null;

function resolveLocale(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MESSAGES, value)
    ? value
    : DEFAULT_LOCALE;
}

function t(locale, key, values) {
  var text = MESSAGES[resolveLocale(locale)][key];
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, function fill(match, name) {
    return Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match;
  });
}

function setHostLocale(value) {
  localeGeneration += 1;
  hostLocale = resolveLocale(value);
  localePromise = Promise.resolve(hostLocale);
}

/**
 * 首次需要文案时向宿主查询一次语言。查询失败或超时不缓存，下一次调用重试；
 * 查询期间若已收到 host-context-changed，以后到的那个为准。
 */
function ensureLocale() {
  if (localePromise) return localePromise;
  if (typeof cindy === 'undefined' || !cindy || typeof cindy.request !== 'function') {
    return Promise.resolve(hostLocale);
  }
  var generation = localeGeneration;
  var timer = null;
  var pending = Promise.race([
    Promise.resolve().then(function askHost() {
      return cindy.request({ kind: 'app-context' });
    }),
    new Promise(function giveUp(resolve) {
      timer = setTimeout(function timedOut() { resolve(null); }, LOCALE_TIMEOUT_MS);
    }),
  ]).then(function applyContext(response) {
    clearTimeout(timer);
    var locale = response && response.ok && response.context && response.context.locale;
    if (typeof locale !== 'string') throw new Error('APP_CONTEXT_UNAVAILABLE');
    if (generation === localeGeneration) hostLocale = resolveLocale(locale);
    return hostLocale;
  }).catch(function keepFallback() {
    clearTimeout(timer);
    if (localePromise === pending) localePromise = null;
    return hostLocale;
  });
  localePromise = pending;
  return pending;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function fail(message) {
  return { ok: false, message: message };
}

function normalizeEmail(value, locale) {
  var email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error(t(locale, 'invalidEmail'));
  }
  return email;
}

async function readJson(path, locale) {
  var response = await fetch(path);
  if (!response.ok) throw new Error(t(locale, 'readConfigFailed'));
  var value = await response.json();
  return value;
}

function normalizeCredentialSlot(value, locale) {
  if (value === undefined || value === null || value === '') return 'a';
  if (value !== 'a' && value !== 'b') {
    throw new Error(t(locale, 'invalidCredentialSlot'));
  }
  return value;
}

function nodeMethod(baseMethod, credentialSlot, locale) {
  return baseMethod + '-' + normalizeCredentialSlot(credentialSlot, locale);
}

async function loadStoredAccount(locale) {
  var values = await Promise.all([readJson('/kv', locale), readJson('/secrets', locale)]);
  var kv = isObject(values[0]) ? values[0] : {};
  var secretItems = Array.isArray(values[1]) ? values[1] : [];
  var email = typeof kv.email === 'string' ? kv.email.trim().toLowerCase() : '';
  var credentialSlot = normalizeCredentialSlot(kv.credentialSlot, locale);
  var secretSaved = secretItems.some(function hasSavedSecret(item) {
    return isObject(item)
      && item.key === SECRET_KEYS[credentialSlot]
      && item.saved === true;
  });
  return {
    connected: Boolean(email && secretSaved),
    email: email || null,
    credentialSlot: credentialSlot,
    persistence: 'cindy-safe-storage',
  };
}

async function loadAccountState(locale) {
  var state = await loadStoredAccount(locale);
  return {
    connected: state.connected,
    email: state.email,
    persistence: state.persistence,
  };
}

async function requireConfiguredAccount(locale) {
  var state = await loadStoredAccount(locale);
  if (!state.connected || !state.email) {
    throw new Error(t(locale, 'notConfigured'));
  }
  return { email: state.email, credentialSlot: state.credentialSlot };
}

async function nodeRequest(method, params, timeoutMs, locale) {
  var response = await cindy.node.request({
    method: method,
    params: params,
    timeoutMs: timeoutMs || 30000,
  });
  if (!response || response.ok !== true) {
    var failure = new Error(response && response.message
      ? response.message
      : t(locale, 'workerFailed'));
    // 只有 Worker 自己回了错误(PROTOCOL_ERROR)才带得出它对执行结果的判断;
    // 超时、进程退出、取消或旧宿主不给 errorCode 时,Worker 可能还在发。
    failure.workerExecution = response && response.errorCode === 'PROTOCOL_ERROR'
      && isObject(response.data)
      && (response.data.execution === 'not_executed' || response.data.execution === 'unknown')
      ? response.data.execution
      : null;
    throw failure;
  }
  return response.result;
}

async function handleSettingsRequest(action, payload, locale) {
  if (action !== 'connect') throw new Error(t(locale, 'unknownSettingsAction'));
  var email = normalizeEmail(payload.email, locale);
  var credentialSlot = normalizeCredentialSlot(payload.credentialSlot, locale);
  return nodeRequest(nodeMethod('account/connect', credentialSlot, locale), {
    email: email,
    credentialSlot: credentialSlot,
    locale: locale,
  }, 45000, locale);
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
    var locale = DEFAULT_LOCALE;
    void ensureLocale()
      .then(function withLocale(resolved) {
        locale = resolved;
        return handleSettingsRequest(message.action, payload, locale);
      })
      .then(function success(result) {
        return { type: 'settings-result', reqId: message.reqId, ok: true, result: result };
      })
      .catch(function failure(error) {
        return {
          type: 'settings-result',
          reqId: message.reqId,
          ok: false,
          message: error && error.message ? error.message : t(locale, 'connectFailed'),
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

function validateUid(value, locale) {
  var uid = Number(value);
  if (!Number.isInteger(uid) || uid <= 0) throw new Error(t(locale, 'invalidUid'));
  return uid;
}

function sanitizeMailArgs(args, locale) {
  var action = typeof args.action === 'string' ? args.action : '';
  var allowed = {
    list_folders: true,
    search: true,
    read: true,
    mark_read: true,
    mark_unread: true,
    move: true,
  };
  if (!allowed[action]) throw new Error(t(locale, 'unknownAction', { action: action }));

  var output = { action: action };
  var folder = typeof args.folder === 'string' && args.folder.trim()
    ? args.folder.trim()
    : 'INBOX';
  output.folder = folder;

  if (action === 'read' || action === 'mark_read' || action === 'mark_unread' || action === 'move') {
    output.message_uid = validateUid(args.message_uid, locale);
  }
  if (action === 'move') {
    if (typeof args.target_folder !== 'string' || !args.target_folder.trim()) {
      throw new Error(t(locale, 'moveNeedsTarget'));
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

async function runMail(args, locale, message) {
  var composed = await imapCompose.runTool(args, message);
  if (composed) return composed;
  var action;
  try {
    action = sanitizeMailArgs(args, locale);
  } catch (error) {
    return fail(error && error.message ? error.message : t(locale, 'invalidArgs'));
  }

  // 这些动作会改邮箱:移动、改已读状态(写信与草稿由公共邮件流程处理)。
  var writesRemote = ['move', 'mark_read', 'mark_unread'].indexOf(action.action) !== -1;
  var requested = false;
  try {
    var account = await requireConfiguredAccount(locale);
    requested = true;
    var result = await nodeRequest(nodeMethod('mail/action', account.credentialSlot, locale), {
      email: account.email,
      credentialSlot: account.credentialSlot,
      action: action,
      locale: locale,
    }, 45000, locale);
    return { ok: true, result: result };
  } catch (error) {
    // 写邮箱的动作一旦交给 Worker,没有 Worker 的明确判断就不能建议重试:提示先核对。
    if (writesRemote && requested && !(error && error.workerExecution)) {
      if (action.action === 'move') return fail(t(locale, 'moveUnconfirmed'));
      return fail(t(locale, 'flagsUnconfirmed'));
    }
    return fail(error && error.message ? error.message : t(locale, 'operationFailed'));
  }
}

async function statusResult(locale) {
  try {
    return { ok: true, result: await loadAccountState(locale) };
  } catch (error) {
    return fail(error && error.message ? error.message : t(locale, 'statusFailed'));
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
  providerName: 'iCloud Mail',
  storageLock: STORAGE_LOCK,
  account: async function () {
    var state = await loadStoredAccount(await ensureLocale());
    return { connected: state.connected, email: state.email, credentialSlot: state.credentialSlot };
  },
  method: function (account) { return 'mail/action-' + account.credentialSlot; },
});

cindy.onHostMessage(function onHostMessage(message) {
  if (message && message.type === 'host-context-changed') {
    if (isObject(message.context) && typeof message.context.locale === 'string') {
      setHostLocale(message.context.locale);
    }
    return;
  }
  if (!message || message.type !== 'tool-call') return;
  void (async function dispatch() {
    var locale = DEFAULT_LOCALE;
    try {
      locale = await ensureLocale();
      var result = message.tool === 'icloud_mail_status'
        ? await statusResult(locale)
        : message.tool === 'icloud_mail'
          ? await runMail(isObject(message.args) ? message.args : {}, locale, message)
          : fail(t(locale, 'unknownTool', { tool: message.tool }));
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
        message: error && error.message ? error.message : t(locale, 'toolFailed'),
      });
    }
  })();
});
