/**
 * iCloud Mail 官方插件。
 *
 * App 专用密码由设置页直接写入 Cindy 的 /secrets 只写通道。浏览器 main.js 只处理
 * 非敏感邮箱地址；宿主仅在 ghost.json 绑定的 Node 方法上，把密码临时注入
 * 对应 Worker 的 request.cindy.secrets，Agent 参数和插件消息都不携带它。
 */

/* global BroadcastChannel, cindy, clearTimeout, fetch, setTimeout */

var SETTINGS_CHANNEL = 'icloud-mail-settings';
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
    unknownSettingsAction: '未知设置动作',
    connectFailed: 'iCloud Mail 连接失败，请重试',
    invalidUid: 'message_uid 必须是有效的正整数',
    unknownAction: '未知 action：{action}',
    moveNeedsTarget: 'move 需要 target_folder；请先调用 list_folders',
    composeNeedsFields: '{action} 需要 to、subject 和 body_text',
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
    unknownSettingsAction: 'Unknown settings action',
    connectFailed: 'iCloud Mail connection failed. Try again.',
    invalidUid: 'message_uid must be a valid positive integer',
    unknownAction: 'Unknown action: {action}',
    moveNeedsTarget: 'move requires target_folder; call list_folders first',
    composeNeedsFields: '{action} requires to, subject, and body_text',
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
    unknownSettingsAction: '不明な設定操作です',
    connectFailed: 'iCloudメールへの接続に失敗しました。再試行してください',
    invalidUid: 'message_uid は有効な正の整数である必要があります',
    unknownAction: '不明な action：{action}',
    moveNeedsTarget: 'move には target_folder が必要です。先に list_folders を呼び出してください',
    composeNeedsFields: '{action} には to、subject、body_text が必要です',
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
    unknownSettingsAction: '알 수 없는 설정 작업입니다',
    connectFailed: 'iCloud 메일 연결에 실패했습니다. 다시 시도하세요',
    invalidUid: 'message_uid는 올바른 양의 정수여야 합니다',
    unknownAction: '알 수 없는 action: {action}',
    moveNeedsTarget: 'move에는 target_folder가 필요합니다. 먼저 list_folders를 호출하세요',
    composeNeedsFields: '{action}에는 to, subject, body_text가 필요합니다',
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
    throw new Error(response && response.message
      ? response.message
      : t(locale, 'workerFailed'));
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
    send: true,
    draft: true,
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

  if (action === 'send' || action === 'draft') {
    if (args.to === undefined || typeof args.subject !== 'string' || typeof args.body_text !== 'string') {
      throw new Error(t(locale, 'composeNeedsFields', { action: action }));
    }
    output.to = args.to;
    if (args.cc !== undefined) output.cc = args.cc;
    if (args.bcc !== undefined) output.bcc = args.bcc;
    output.subject = args.subject;
    output.body_text = args.body_text;
  }

  return output;
}

async function runMail(args, locale) {
  var action;
  try {
    action = sanitizeMailArgs(args, locale);
  } catch (error) {
    return fail(error && error.message ? error.message : t(locale, 'invalidArgs'));
  }

  try {
    var account = await requireConfiguredAccount(locale);
    var result = await nodeRequest(nodeMethod('mail/action', account.credentialSlot, locale), {
      email: account.email,
      credentialSlot: account.credentialSlot,
      action: action,
      locale: locale,
    }, action.action === 'send' || action.action === 'draft' ? 60000 : 45000, locale);
    return { ok: true, result: result };
  } catch (error) {
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
          ? await runMail(isObject(message.args) ? message.args : {}, locale)
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
