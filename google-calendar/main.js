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

/*
 * Runtime copy follows only the Cindy host locale (cindy.request app-context and
 * host-context-changed), never the browser or OS language. An unsupported or
 * unavailable host locale falls back to English. Tool names, account ids,
 * execution codes and gog output are protocol and are not translated.
 */
var MESSAGES = {
  'zh-CN': {
    allDay: '全天',
    untitled: '无标题日程',
    statusCreated: '日程已创建',
    statusUpdated: '日程已修改',
    statusDeleted: '日程已删除',
    statusDetails: '日程详情',
    statusEvents: '日程',
    deletedNotice: '日程已从 Google Calendar 删除。',
    empty: '这段时间没有日程。',
    eventCount: '{count} 个日程',
    serviceUnreachable: '无法连接 Cindy 本地账号服务，请稍后重试；若持续失败，请重新打开 {plugin} 插件详情检查服务状态',
    serviceNoResult: 'Cindy 本地账号服务未返回结果，请稍后重试',
    serviceDenied: '账号状态服务拒绝访问，请到 {plugin} 插件详情检查连接状态后重试（HTTP {status}）',
    serviceUnavailable: 'Cindy 本地账号服务暂时不可用，请稍后重试；若持续失败，请重新打开 {plugin} 插件详情检查服务状态（HTTP {status}）',
    statusUnparsable: 'Cindy 账号状态数据无法解析，请重新打开 {plugin} 插件详情后重试',
    statusInvalid: 'Cindy 账号状态数据格式异常，请重新打开 {plugin} 插件详情后重试',
    clientMissing: '内置应用身份缺失，请升级 Cindy 后重试',
    accountListInvalid: 'Cindy 账号列表数据格式异常，请重新打开 {plugin} 插件详情后重试',
    noAccount: '尚未连接账号，请到「{plugin}」详情页单独授权',
    notExecuted: '尚未执行：{reason}',
    multipleAccounts: '尚未执行：已连接多个账号，请明确选择账号并传入 account。',
    accountNotFound: '尚未执行：指定账号不存在，请重新选择账号；不会切换到其他账号。',
    accountStale: '尚未执行：账号 {account} 授权已失效或权限不足，请到插件详情页重新连接此账号。',
    unknownTool: '尚未执行：未知工具，请重新查看当前插件工具列表。',
    runtimeMissing: '尚未执行：当前 Cindy 缺少此功能所需的插件运行接口，请升级至 0.1.92 或更新版本。账号列表仍可使用。',
  },
  en: {
    allDay: 'All day',
    untitled: 'Untitled event',
    statusCreated: 'Event created',
    statusUpdated: 'Event updated',
    statusDeleted: 'Event deleted',
    statusDetails: 'Event details',
    statusEvents: 'Events',
    deletedNotice: 'Event deleted from Google Calendar.',
    empty: 'No events in this period.',
    eventCount: '{count} events',
    serviceUnreachable: 'Could not reach the Cindy local account service. Try again later; if it keeps failing, reopen the {plugin} plugin details to check the service status.',
    serviceNoResult: 'The Cindy local account service returned no result. Try again later.',
    serviceDenied: 'The account status service denied access. Check the connection status in the {plugin} plugin details, then try again (HTTP {status}).',
    serviceUnavailable: 'The Cindy local account service is temporarily unavailable. Try again later; if it keeps failing, reopen the {plugin} plugin details to check the service status (HTTP {status}).',
    statusUnparsable: 'Could not parse the Cindy account status data. Reopen the {plugin} plugin details, then try again.',
    statusInvalid: 'The Cindy account status data has an unexpected format. Reopen the {plugin} plugin details, then try again.',
    clientMissing: 'The built-in app identity is missing. Update Cindy, then try again.',
    accountListInvalid: 'The Cindy account list has an unexpected format. Reopen the {plugin} plugin details, then try again.',
    noAccount: 'No account connected yet. Authorize one separately on the "{plugin}" details page.',
    notExecuted: 'Not executed: {reason}',
    multipleAccounts: 'Not executed: multiple accounts are connected. Choose one explicitly and pass it as account.',
    accountNotFound: 'Not executed: the specified account does not exist. Choose an account again; it will not switch to another account.',
    accountStale: 'Not executed: the authorization for account {account} has expired or lacks permissions. Reconnect this account on the plugin details page.',
    unknownTool: 'Not executed: unknown tool. Check the current plugin tool list again.',
    runtimeMissing: 'Not executed: this Cindy version lacks the plugin runtime interface this feature needs. Update to 0.1.92 or later. The account list still works.',
  },
  ja: {
    allDay: '終日',
    untitled: '無題の予定',
    statusCreated: '予定を作成しました',
    statusUpdated: '予定を変更しました',
    statusDeleted: '予定を削除しました',
    statusDetails: '予定の詳細',
    statusEvents: '予定',
    deletedNotice: '予定を Google Calendar から削除しました。',
    empty: 'この期間に予定はありません。',
    eventCount: '{count} 件の予定',
    serviceUnreachable: 'Cindy のローカルアカウントサービスに接続できません。しばらくしてから再試行してください。失敗が続く場合は、{plugin} プラグインの詳細を開き直してサービスの状態を確認してください。',
    serviceNoResult: 'Cindy のローカルアカウントサービスから結果が返されませんでした。しばらくしてから再試行してください。',
    serviceDenied: 'アカウント状態サービスがアクセスを拒否しました。{plugin} プラグインの詳細で接続状態を確認してから再試行してください（HTTP {status}）。',
    serviceUnavailable: 'Cindy のローカルアカウントサービスは一時的に利用できません。しばらくしてから再試行してください。失敗が続く場合は、{plugin} プラグインの詳細を開き直してサービスの状態を確認してください（HTTP {status}）。',
    statusUnparsable: 'Cindy のアカウント状態データを解析できません。{plugin} プラグインの詳細を開き直してから再試行してください。',
    statusInvalid: 'Cindy のアカウント状態データの形式が正しくありません。{plugin} プラグインの詳細を開き直してから再試行してください。',
    clientMissing: '組み込みアプリの識別情報がありません。Cindy をアップデートしてから再試行してください。',
    accountListInvalid: 'Cindy のアカウント一覧データの形式が正しくありません。{plugin} プラグインの詳細を開き直してから再試行してください。',
    noAccount: 'アカウントがまだ接続されていません。「{plugin}」の詳細ページで個別に認証してください。',
    notExecuted: '未実行：{reason}',
    multipleAccounts: '未実行：複数のアカウントが接続されています。アカウントを明示的に選択し、account に指定してください。',
    accountNotFound: '未実行：指定されたアカウントが存在しません。アカウントを選び直してください。別のアカウントに切り替えることはありません。',
    accountStale: '未実行：アカウント {account} の認証が期限切れか、権限が不足しています。プラグインの詳細ページでこのアカウントを再接続してください。',
    unknownTool: '未実行：不明なツールです。現在のプラグインのツール一覧を確認し直してください。',
    runtimeMissing: '未実行：現在の Cindy には、この機能に必要なプラグイン実行インターフェースがありません。0.1.92 以降にアップデートしてください。アカウント一覧は引き続き利用できます。',
  },
  ko: {
    allDay: '종일',
    untitled: '제목 없는 일정',
    statusCreated: '일정 생성됨',
    statusUpdated: '일정 수정됨',
    statusDeleted: '일정 삭제됨',
    statusDetails: '일정 세부정보',
    statusEvents: '일정',
    deletedNotice: 'Google Calendar에서 일정을 삭제했습니다.',
    empty: '이 기간에는 일정이 없습니다.',
    eventCount: '일정 {count}개',
    serviceUnreachable: 'Cindy 로컬 계정 서비스에 연결할 수 없습니다. 잠시 후 다시 시도하세요. 계속 실패하면 {plugin} 플러그인 상세 페이지를 다시 열어 서비스 상태를 확인하세요.',
    serviceNoResult: 'Cindy 로컬 계정 서비스가 결과를 반환하지 않았습니다. 잠시 후 다시 시도하세요.',
    serviceDenied: '계정 상태 서비스가 접근을 거부했습니다. {plugin} 플러그인 상세 페이지에서 연결 상태를 확인한 후 다시 시도하세요(HTTP {status}).',
    serviceUnavailable: 'Cindy 로컬 계정 서비스를 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도하세요. 계속 실패하면 {plugin} 플러그인 상세 페이지를 다시 열어 서비스 상태를 확인하세요(HTTP {status}).',
    statusUnparsable: 'Cindy 계정 상태 데이터를 해석할 수 없습니다. {plugin} 플러그인 상세 페이지를 다시 연 후 다시 시도하세요.',
    statusInvalid: 'Cindy 계정 상태 데이터 형식이 올바르지 않습니다. {plugin} 플러그인 상세 페이지를 다시 연 후 다시 시도하세요.',
    clientMissing: '내장 앱 식별 정보가 없습니다. Cindy를 업데이트한 후 다시 시도하세요.',
    accountListInvalid: 'Cindy 계정 목록 데이터 형식이 올바르지 않습니다. {plugin} 플러그인 상세 페이지를 다시 연 후 다시 시도하세요.',
    noAccount: '아직 연결된 계정이 없습니다. "{plugin}" 상세 페이지에서 별도로 인증하세요.',
    notExecuted: '실행되지 않음: {reason}',
    multipleAccounts: '실행되지 않음: 여러 계정이 연결되어 있습니다. 계정을 명시적으로 선택해 account로 전달하세요.',
    accountNotFound: '실행되지 않음: 지정한 계정이 없습니다. 계정을 다시 선택하세요. 다른 계정으로 전환하지 않습니다.',
    accountStale: '실행되지 않음: 계정 {account}의 인증이 만료되었거나 권한이 부족합니다. 플러그인 상세 페이지에서 이 계정을 다시 연결하세요.',
    unknownTool: '실행되지 않음: 알 수 없는 도구입니다. 현재 플러그인 도구 목록을 다시 확인하세요.',
    runtimeMissing: '실행되지 않음: 현재 Cindy에 이 기능에 필요한 플러그인 실행 인터페이스가 없습니다. 0.1.92 이상으로 업데이트하세요. 계정 목록은 계속 사용할 수 있습니다.',
  },
};
// Date headings and times are formatted by Intl in the host locale.
var INTL_LOCALES = { 'zh-CN': 'zh-CN', en: 'en-US', ja: 'ja-JP', ko: 'ko-KR' };

var hasOwn = Object.prototype.hasOwnProperty;
// null = the host locale is not known yet; render English and ask again next call.
var hostLocale = null;
var localeRequest = null;

function resolveLocale(value) {
  return typeof value === 'string' && hasOwn.call(MESSAGES, value) ? value : 'en';
}

async function requestHostLocale() {
  if (typeof cindy.request !== 'function') return null;
  var timer = null;
  try {
    // A Host that never answers must not stall the tool call: fall back after 3s.
    var r = await Promise.race([
      cindy.request({ kind: 'app-context' }),
      new Promise(function (resolve) { timer = setTimeout(function () { resolve(null); }, 3000); }),
    ]);
    var locale = r && r.ok && r.context && r.context.locale;
    return typeof locale === 'string' ? resolveLocale(locale) : null;
  } catch (_) {
    return null;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

// Concurrent tool calls share one request. A success is cached and then kept
// current by host-context-changed; a failure is retried on the next call.
function ensureLocale() {
  if (hostLocale) return Promise.resolve(hostLocale);
  if (!localeRequest) {
    localeRequest = requestHostLocale().then(function (locale) {
      localeRequest = null;
      // A host-context-changed that arrived during the request wins.
      if (!hostLocale && locale) hostLocale = locale;
      return hostLocale || 'en';
    });
  }
  return localeRequest;
}

function currentLocale() {
  return hostLocale || 'en';
}

function intlLocale() {
  return INTL_LOCALES[currentLocale()];
}

function t(key, vars) {
  var table = MESSAGES[currentLocale()];
  var template = hasOwn.call(table, key) ? table[key] : MESSAGES.en[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, function (match, name) {
    return hasOwn.call(vars, name) ? String(vars[name]) : match;
  });
}

var CARD_MAX_EVENTS = 6;
var EVENT_COLORS = ['#4f9d3a', '#e58b73', '#4f8fc9', '#9a78c6', '#d2a03d', '#3f9a8d'];

var CARD_STYLE = [
  '@keyframes gcSweep{0%{transform:translateX(-48px);opacity:0}15%{opacity:1}85%{opacity:1}100%{transform:translateX(458px);opacity:0}}',
  '.gc-event-link{cursor:pointer;transition:opacity .16s ease}.gc-event-link:hover{opacity:.72}',
].join('');

var CARD_INLINE = {
  card: 'box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,Roboto,Arial,sans-serif;color:#202124;',
  cardWhite: 'background:rgba(255,255,255,.6);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);',
  loading: 'position:relative;display:flex;align-items:center;min-height:48px;padding:0 16px;',
  loadingTrack: 'position:absolute;top:0;left:0;width:48px;height:2px;border-radius:2px;background:#34a853;animation:gcSweep 1.7s ease-in-out infinite;',
  loadingTitle: 'font-size:13px;line-height:1.35;font-weight:600;letter-spacing:-.01em;color:#202124;',
  loadingNote: 'margin-left:8px;font-size:11px;line-height:1.35;color:#74777a;',
  head: 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px 6px;',
  status: 'font-size:12px;line-height:1.35;font-weight:600;color:#202124;',
  count: 'font-size:11px;line-height:1.35;color:#85888b;white-space:nowrap;',
  body: 'padding:6px 16px 12px;',
  group: 'margin-top:10px;',
  groupFirst: '',
  date: 'margin-bottom:8px;font-size:12px;line-height:1.3;font-weight:650;letter-spacing:.04em;color:#7a7d80;',
  eventGap: 'margin-top:8px;',
  eventRow: 'display:grid;grid-template-columns:4px minmax(0,1fr);align-items:stretch;gap:12px;min-height:44px;',
  accent: 'display:block;width:4px;min-height:44px;border-radius:4px;',
  accentDeleted: 'display:block;width:4px;min-height:44px;border-radius:4px;background:#c6c9cc;',
  eventContent: 'display:flex;flex-direction:column;justify-content:center;min-width:0;',
  eventTime: 'font-variant-numeric:tabular-nums;font-size:11px;line-height:1.25;font-weight:550;color:#85898c;',
  eventTimeDeleted: 'font-variant-numeric:tabular-nums;font-size:11px;line-height:1.25;font-weight:550;color:#b0b3b6;text-decoration-line:line-through;text-decoration-color:#b0b3b6;text-decoration-thickness:1px;',
  eventTitle: 'margin-top:3px;font-size:14px;line-height:1.3;font-weight:600;color:#202124;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
  eventTitleDeleted: 'margin-top:3px;font-size:14px;line-height:1.3;font-weight:600;color:#a4a7aa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-decoration-line:line-through;text-decoration-color:#a4a7aa;text-decoration-thickness:1px;',
  eventLocation: 'margin-top:3px;font-size:11px;line-height:1.25;color:#7a7d80;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
  eventLocationDeleted: 'margin-top:3px;font-size:11px;line-height:1.25;color:#b0b3b6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-decoration-line:line-through;text-decoration-color:#b0b3b6;text-decoration-thickness:1px;',
  empty: 'padding:8px 0 4px;font-size:12px;line-height:1.4;color:#7a7d80;',
};


function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clip(value, max) {
  var text = String(value === undefined || value === null ? '' : value).trim();
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function parseDate(value) {
  var raw = String(value || '');
  if (!raw) return null;
  var date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(raw + 'T00:00:00')
    : new Date(raw);
  return isNaN(date.getTime()) ? null : date;
}

function dayLabel(value) {
  var date = parseDate(value);
  if (!date) return clip(value, 34);
  return new Intl.DateTimeFormat(intlLocale(), {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(date);
}

function compactDayLabel(value) {
  var date = parseDate(value);
  if (!date) return clip(value, 18);
  return new Intl.DateTimeFormat(intlLocale(), {
    month: 'long',
    day: 'numeric',
  }).format(date);
}

function timeLabel(value) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return t('allDay');
  var date = parseDate(value);
  if (!date) return clip(value, 24);
  return new Intl.DateTimeFormat(intlLocale(), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function dateKey(value) {
  value = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  var date = parseDate(value);
  if (!date) return value;
  var parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).reduce(function (acc, part) {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return parts.year + '-' + parts.month + '-' + parts.day;
}

function eventDateKey(event) {
  return dateKey(event && event.start);
}

function eventTimeParts(event) {
  var allDay = !event || !event.start || /^\d{4}-\d{2}-\d{2}$/.test(String(event.start));
  if (allDay) return { start: t('allDay'), end: '', range: t('allDay') };
  var start = timeLabel(event.start);
  var end = event.end && !/^\d{4}-\d{2}-\d{2}$/.test(String(event.end)) ? timeLabel(event.end) : '';
  var crossesDate = end && dateKey(event.start) !== dateKey(event.end);
  var range = crossesDate
    ? start + ' → ' + compactDayLabel(event.end) + ' ' + end
    : end
      ? start + '–' + end
      : start;
  return { start: start, end: end, range: range };
}

function eventAccentColor(event) {
  var seed = String((event && (event.id || event.summary || event.start)) || 'calendar');
  var hash = 0;
  for (var i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return EVENT_COLORS[Math.abs(hash) % EVENT_COLORS.length];
}

function eventLink(event, deleted) {
  if (deleted) return '';
  var link = String((event && event.link) || '').trim();
  return /^https?:\/\/\S+$/i.test(link) && link.length <= 2048 ? link : '';
}

function renderEventRow(event, deleted) {
  var times = eventTimeParts(event);
  var location = clip(event && event.location, 80);
  var link = eventLink(event, deleted);
  var locationHtml = location
    ? '<div style="' + (deleted ? CARD_INLINE.eventLocationDeleted : CARD_INLINE.eventLocation) +
      '">' + escapeHtml(location) + '</div>'
    : '';
  var accentStyle = deleted
    ? CARD_INLINE.accentDeleted
    : CARD_INLINE.accent + 'background:' + eventAccentColor(event) + ';';
  return '<div' + (link
    ? ' class="gc-event-link" data-ghost-link="' + escapeHtml(link) + '"'
    : '') + ' style="' + CARD_INLINE.eventRow + '"><span style="' + accentStyle +
    '"></span><div style="' + CARD_INLINE.eventContent + '"><div style="' +
    (deleted ? CARD_INLINE.eventTimeDeleted : CARD_INLINE.eventTime) + '">' +
    escapeHtml(times.range) + '</div><div style="' +
    (deleted ? CARD_INLINE.eventTitleDeleted : CARD_INLINE.eventTitle) + '">' +
    escapeHtml((event && event.summary) || t('untitled')) + '</div>' +
    locationHtml + '</div></div>';
}

function renderGroups(events, deleted) {
  var groups = {};
  (events || []).forEach(function (event) {
    var key = eventDateKey(event);
    if (!groups[key]) groups[key] = [];
    groups[key].push(event);
  });
  return Object.keys(groups).sort().map(function (key, index) {
    var label = dayLabel(groups[key][0] && groups[key][0].start);
    return '<div style="' + (index === 0 ? CARD_INLINE.groupFirst : CARD_INLINE.group) +
      '"><div style="' + CARD_INLINE.date + '">' + escapeHtml(label) + '</div>' +
      groups[key].map(function (event, eventIndex) {
        return '<div style="' + (eventIndex ? CARD_INLINE.eventGap : '') + '">' +
          renderEventRow(event, deleted) + '</div>';
      }).join('') + '</div>';
  }).join('');
}

function resultLabel(action) {
  if (action === 'create_event') return t('statusCreated');
  if (action === 'update_event') return t('statusUpdated');
  if (action === 'delete_event') return t('statusDeleted');
  if (action === 'get_event') return t('statusDetails');
  return t('statusEvents');
}

function renderCalendarCard(action, result, args) {
  var events = action === 'list_events'
    ? ((result && result.events) || [])
    : (result && result.event ? [result.event] : []);
  var visible = events.slice(0, CARD_MAX_EVENTS);
  var body = visible.length
    ? renderGroups(visible, action === 'delete_event')
    : '<div style="' + CARD_INLINE.empty + '">' +
      (action === 'delete_event'
        ? t('deletedNotice')
        : t('empty')) +
      '</div>';
  return '<div style="' + CARD_INLINE.card +
    CARD_INLINE.cardWhite +
    '"><style>' + CARD_STYLE + '</style><div style="' + CARD_INLINE.head +
    '"><div style="' + CARD_INLINE.status + '">' + escapeHtml(resultLabel(action)) +
    '</div><div style="' + CARD_INLINE.count + '">' +
    escapeHtml(events.length > 1 ? t('eventCount', { count: events.length }) : '') + '</div></div>' +
    '<div style="' + CARD_INLINE.body + '">' + body + '</div></div>';
}

async function sendCard(callId, html, height, state) {
  if (!callId) return;
  try {
    await cindy.send({
      type: 'card-update',
      callId: callId,
      v: 2,
      state: state || 'done',
      html: html,
      height: height,
    });
  } catch (_err) {
    // 卡片只是增强展示，供片失败时仍保留原始工具结果。
  }
}

function cardHeight(action, result) {
  var events = action === 'list_events'
    ? ((result && result.events) || []).slice(0, CARD_MAX_EVENTS)
    : (result && result.event ? [result.event] : []);
  if (!events.length) return 104;
  var grouped = {};
  events.forEach(function (event) {
    var key = eventDateKey(event);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(event);
  });
  var height = 55;
  Object.keys(grouped).forEach(function (key, groupIndex) {
    if (groupIndex) height += 10;
    height += 23;
    grouped[key].forEach(function (event, eventIndex) {
      if (eventIndex) height += 8;
      height += event && event.location ? 56 : 44;
    });
  });
  return Math.min(720, Math.max(104, height));
}

function eventView(event) {
  return {
    id: event.id,
    summary: event.summary || '',
    description: event.description || '',
    location: event.location || '',
    start: (event.start && (event.start.dateTime || event.start.date)) || '',
    end: (event.end && (event.end.dateTime || event.end.date)) || '',
    status: event.status,
    link: event.htmlLink || '',
    attendees: (event.attendees || []).map(function (attendee) { return attendee.email; }),
  };
}


// Render gog's native event payloads, without an additional API request.
async function renderGoogleCalendarResult(callId, command, data) {
  if (!Array.isArray(command) || command.length !== 1 || !data || typeof data !== 'object') return;
  var actions = { events: 'list_events', search: 'list_events', event: 'get_event',
    create: 'create_event', update: 'update_event', delete: 'delete_event' };
  var action = actions[command[0]];
  if (!action) return;
  var result;
  if (action === 'list_events' && Array.isArray(data.events)) {
    result = { events: data.events.map(eventView) };
  } else if (data.event && data.event.start) {
    result = { event: eventView(data.event) };
  } else if (action === 'delete_event' && data.deleted === true) {
    result = {};
  } else return; // Never invent an empty calendar or success receipt for an unknown shape.
  await sendCard(callId, renderCalendarCard(action, result, {}), cardHeight(action, result), 'done');
}

/* global cindy */
// Generated plugin-local bridge. Google business operations run only through gog.
var SECRET_KEY = 'google_calendar_account';
var PLUGIN_NAME = 'Google Calendar';
function fail(message) { return { ok: false, message: message }; }
async function listAccounts() {
  var response;
  try {
    response = await fetch('/oauth');
  } catch (_transportError) {
    return fail(t('serviceUnreachable', { plugin: PLUGIN_NAME }));
  }
  if (!response) return fail(t('serviceNoResult'));
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) return fail(t('serviceDenied', { plugin: PLUGIN_NAME, status: response.status }));
    return fail(t('serviceUnavailable', { plugin: PLUGIN_NAME, status: response.status }));
  }
  var entries;
  try {
    entries = await response.json();
  } catch (_parseError) {
    return fail(t('statusUnparsable', { plugin: PLUGIN_NAME }));
  }
  if (!Array.isArray(entries)) return fail(t('statusInvalid', { plugin: PLUGIN_NAME }));
  var entry = entries.find(function (item) { return item && item.key === SECRET_KEY; });
  if (!entry || !entry.clientConfigured) return fail(t('clientMissing'));
  if (!Array.isArray(entry.accounts) || entry.accounts.some(function (account) { return !account || typeof account.id !== 'string' || !account.id; })) {
    return fail(t('accountListInvalid', { plugin: PLUGIN_NAME }));
  }
  if (!entry.accounts.length) return fail(t('noAccount', { plugin: PLUGIN_NAME }));
  return { ok: true, result: {
    accounts: (await googleAccountMetadata.list(SECRET_KEY, entry.accounts)).map(function (account) {
      return { id: account.id, email: account.label, nickname: account.nickname || '',
        status: account.status, scope_stale: account.scopeStale === true };
    }),
  } };
}
async function selectGoogleAccount(accountId) {
  var listed = await listAccounts();
  if (!listed.ok) return fail(t('notExecuted', { reason: listed.message }));
  var accounts = listed.result.accounts;
  if (accountId === undefined && accounts.length !== 1) {
    return fail(t('multipleAccounts'));
  }
  var account = accountId === undefined ? accounts[0] : accounts.find(function (item) { return item.id === accountId; });
  if (!account) return fail(t('accountNotFound'));
  if (account.status !== 'connected' || account.scope_stale === true) {
    return fail(t('accountStale', { account: account.email || account.id }));
  }
  return { ok: true, accountId: account.id };
}
(function () {
  var PREFIX = 'google_calendar';
  cindy.onHostMessage(async function (message) {
    if (!message) return;
    if (message.type === 'host-context-changed') {
      hostLocale = resolveLocale(message.context && message.context.locale);
      return;
    }
    if (message.type !== 'tool-call') return;
    await ensureLocale();
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
          message: t('unknownTool') });
        return;
      }
      if (!cindy.node || typeof cindy.node.request !== 'function' || (!isSchema && !context)) {
        await cindy.send({ type: 'tool-result', callId: message.callId, ok: false,
          message: t('runtimeMissing') });
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
      workerRequested = true;
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
      if (!isSchema && result.ok && typeof renderGoogleCalendarResult === 'function') {
        // Presentation is optional and must never change a completed operation's outcome.
        try { await renderGoogleCalendarResult(message.callId, args.command, result.data); } catch (_) { /* preserve result */ }
      }
      await cindy.send({ type: 'tool-result', callId: message.callId, ok: !!result.ok,
        ...(result.ok ? { result: result.data } : { message: '[' + result.execution + '] ' + result.message }) });
    } catch (error) {
      await cindy.send({ type: 'tool-result', callId: message.callId, ok: false,
        message: workerRequested ? '[unknown] Unable to complete Google operation; check its result before retrying a write.'
          : '[not_executed] ' + (error.message || 'Unable to prepare Google operation; check account and inputs.') });
    }
  });
})();
