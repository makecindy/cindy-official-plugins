/* global cindy */

var SECRET_KEY = 'google_calendar_account';
var PLUGIN_NAME = 'Google Calendar';
var BASE = 'https://www.googleapis.com/calendar/v3';
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

function fail(message) {
  return { ok: false, message: message };
}

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

function validCalendarTime(value) {
  var raw = String(value || '').trim();
  var dateParts = raw.slice(0, 10).split('-').map(Number);
  var normalizedDate = dateParts.length === 3
    ? new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2]))
    : null;
  var validDate = normalizedDate &&
    normalizedDate.getUTCFullYear() === dateParts[0] &&
    normalizedDate.getUTCMonth() === dateParts[1] - 1 &&
    normalizedDate.getUTCDate() === dateParts[2];
  var supported = /^\d{4}-\d{2}-\d{2}$/.test(raw) ||
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw);
  return validDate && supported && parseDate(raw) ? raw : '';
}

function validCalendarRange(startValue, endValue) {
  var start = validCalendarTime(startValue);
  if (!start) return null;

  var rawEnd = String(endValue || '').trim();
  if (!rawEnd) return { start: start, end: '' };

  var end = validCalendarTime(rawEnd);
  var startIsDate = /^\d{4}-\d{2}-\d{2}$/.test(start);
  var endIsDate = /^\d{4}-\d{2}-\d{2}$/.test(end);
  if (!end || startIsDate !== endIsDate || parseDate(end).getTime() <= parseDate(start).getTime()) {
    return null;
  }
  return { start: start, end: end };
}

function dayLabel(value) {
  var date = parseDate(value);
  if (!date) return clip(value, 34);
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(date);
}

function compactDayLabel(value) {
  var date = parseDate(value);
  if (!date) return clip(value, 18);
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
  }).format(date);
}

function timeLabel(value) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return '全天';
  var date = parseDate(value);
  if (!date) return clip(value, 24);
  return new Intl.DateTimeFormat('zh-CN', {
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
  if (allDay) return { start: '全天', end: '', range: '全天' };
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
    escapeHtml((event && event.summary) || '无标题日程') + '</div>' +
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

function loadingLabel(action) {
  if (action === 'create_event') return '正在创建日程…';
  if (action === 'update_event') return '正在修改日程…';
  if (action === 'delete_event') return '正在删除日程…';
  return '正在查询日程…';
}

function renderLoadingCard(action) {
  return '<div style="' + CARD_INLINE.card + CARD_INLINE.cardWhite + CARD_INLINE.loading +
    '"><style>' + CARD_STYLE + '</style>' +
    '<span style="' + CARD_INLINE.loadingTrack + '"></span><div style="' + CARD_INLINE.loadingTitle + '">' +
    escapeHtml(loadingLabel(action)) + '</div></div>';
}

function renderFailedStatus(action) {
  return '<div style="' + CARD_INLINE.card + CARD_INLINE.cardWhite + CARD_INLINE.loading +
    '"><div style="' +
    CARD_INLINE.loadingTitle + '">操作未完成</div><div style="' + CARD_INLINE.loadingNote + '">' +
    escapeHtml(loadingLabel(action).replace('正在', '').replace('…', '')) + '</div></div>';
}

function resultLabel(action) {
  if (action === 'create_event') return '日程已创建';
  if (action === 'update_event') return '日程已修改';
  if (action === 'delete_event') return '日程已删除';
  if (action === 'get_event') return '日程详情';
  return '日程';
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
        ? '日程已从 Google Calendar 删除。'
        : '这段时间没有日程。') +
      '</div>';
  return '<div style="' + CARD_INLINE.card +
    CARD_INLINE.cardWhite +
    '"><style>' + CARD_STYLE + '</style><div style="' + CARD_INLINE.head +
    '"><div style="' + CARD_INLINE.status + '">' + escapeHtml(resultLabel(action)) +
    '</div><div style="' + CARD_INLINE.count + '">' +
    escapeHtml(events.length > 1 ? events.length + ' 个日程' : '') + '</div></div>' +
    '<div style="' + CARD_INLINE.body + '">' + body + '</div></div>';
}

function shouldRenderCard(action) {
  return action === 'list_events' || action === 'get_event' || action === 'create_event' ||
    action === 'update_event' || action === 'delete_event';
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
    return { err: 'Calendar API 返回 HTTP ' + response.status + ':' + message };
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
    return fail('尚未连接 Google Calendar 账号，请到「' + PLUGIN_NAME + '」详情页单独授权');
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

function calTime(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? { date: value } : { dateTime: value };
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

function eventSnapshotFromArgs(args) {
  // A truthful event receipt needs a start value. Title/location/end alone
  // cannot be placed on the calendar and would otherwise render as an
  // invented all-day event under an empty date heading.
  var range = validCalendarRange(args.start, args.end);
  if (!range) return null;
  return {
    id: args.event_id,
    summary: args.summary || '已删除日程',
    description: args.description || '',
    location: args.location || '',
    start: range.start,
    end: range.end,
    status: 'cancelled',
    link: '',
    attendees: Array.isArray(args.attendees) ? args.attendees : [],
  };
}

async function calendar(args, callId) {
  var selected = await selectGoogleAccount(args.account);
  if (!selected.ok) return selected;
  args = Object.assign({}, args, { account: selected.accountId });
  var account = args.account;
  var calendarId = encodeURIComponent(args.calendar_id || 'primary');
  if (args.action === 'list_calendars') {
    var calendars = await api({
      url: BASE + '/users/me/calendarList',
      account: account,
      callId: callId,
    });
    if (calendars.err) return fail(calendars.err);
    return {
      ok: true,
      result: {
        calendars: (calendars.data.items || []).map(function (item) {
          return { id: item.id, summary: item.summary, primary: Boolean(item.primary) };
        }),
      },
    };
  }

  if (args.action === 'list_events') {
    var query = '?singleEvents=true&orderBy=startTime&maxResults=' +
      clampInt(args.max_results, 10, 25);
    if (args.time_min) query += '&timeMin=' + encodeURIComponent(args.time_min);
    if (args.time_max) query += '&timeMax=' + encodeURIComponent(args.time_max);
    var events = await api({
      url: BASE + '/calendars/' + calendarId + '/events' + query,
      account: account,
      callId: callId,
    });
    if (events.err) return fail(events.err);
    return {
      ok: true,
      result: { events: (events.data.items || []).map(eventView) },
    };
  }

  if (args.action === 'get_event') {
    if (!args.event_id) return fail('get_event 需要 event_id');
    var event = await api({
      url: BASE + '/calendars/' + calendarId + '/events/' + encodeURIComponent(args.event_id),
      account: account,
      callId: callId,
    });
    if (event.err) return fail(event.err);
    return { ok: true, result: { event: eventView(event.data) } };
  }

  if (args.action === 'create_event') {
    if (!args.summary || !args.start || !args.end) {
      return fail('create_event 需要 summary / start / end');
    }
    var body = {
      summary: args.summary,
      start: calTime(args.start),
      end: calTime(args.end),
    };
    if (args.description) body.description = args.description;
    if (args.location) body.location = args.location;
    if (Array.isArray(args.attendees)) {
      body.attendees = args.attendees.map(function (email) { return { email: email }; });
    }
    var created = await api({
      url: BASE + '/calendars/' + calendarId + '/events',
      method: 'POST',
      body: body,
      account: account,
      callId: callId,
    });
    if (created.err) return fail(created.err);
    return { ok: true, result: { created: true, event: eventView(created.data) } };
  }

  if (args.action === 'update_event') {
    if (!args.event_id) return fail('update_event 需要 event_id');
    var patch = {};
    if (args.summary !== undefined) patch.summary = args.summary;
    if (args.description !== undefined) patch.description = args.description;
    if (args.location !== undefined) patch.location = args.location;
    if (args.start !== undefined) patch.start = calTime(args.start);
    if (args.end !== undefined) patch.end = calTime(args.end);
    if (args.attendees !== undefined) {
      patch.attendees = args.attendees.map(function (email) { return { email: email }; });
    }
    var updated = await api({
      url: BASE + '/calendars/' + calendarId + '/events/' + encodeURIComponent(args.event_id),
      method: 'PATCH',
      body: patch,
      account: account,
      callId: callId,
    });
    if (updated.err) return fail(updated.err);
    return { ok: true, result: { updated: true, event: eventView(updated.data) } };
  }

  if (args.action === 'delete_event') {
    if (!args.event_id) return fail('delete_event 需要 event_id');
    var removed = await api({
      url: BASE + '/calendars/' + calendarId + '/events/' + encodeURIComponent(args.event_id),
      method: 'DELETE',
      account: account,
      callId: callId,
    });
    if (removed.err) return fail(removed.err);
    return {
      ok: true,
      result: {
        deleted: true,
        event: eventSnapshotFromArgs(args),
      },
    };
  }

  return fail('未知 action:' + args.action);
}

cindy.onHostMessage(async function (message) {
  if (message && (message.tool === 'google_calendar_schema' || message.tool === 'google_calendar_run')) return;
  if (!message) return;

  if (message.type !== 'tool-call') return;
  var action = message.tool === 'google_calendar_accounts'
    ? 'accounts'
    : message.tool === 'google_calendar'
      ? (message.args || {}).action
      : '';
  if (shouldRenderCard(action)) {
    await sendCard(message.callId, renderLoadingCard(action), 72, 'working');
  }
  try {
    var result = message.tool === 'google_calendar_accounts'
      ? await listAccounts()
      : message.tool === 'google_calendar'
        ? await calendar(message.args || {}, message.callId)
        : fail('未知工具:' + message.tool);
    if (result.ok) {
      if (shouldRenderCard(action)) {
        await sendCard(
          message.callId,
          renderCalendarCard(action, result.result, message.args || {}),
          cardHeight(action, result.result),
          'done',
        );
      }
      await cindy.send({ type: 'tool-result', callId: message.callId, ok: true, result: result.result });
    } else {
      if (shouldRenderCard(action)) {
        await sendCard(message.callId, renderFailedStatus(action), 72, 'done');
      }
      await cindy.send({ type: 'tool-result', callId: message.callId, ok: false, message: result.message });
    }
  } catch (error) {
    if (shouldRenderCard(action)) {
      await sendCard(message.callId, renderFailedStatus(action), 72, 'done');
    }
    await cindy.send({
      type: 'tool-result',
      callId: message.callId,
      ok: false,
      message: 'Google Calendar 工具执行失败:' +
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
  var PREFIX = 'google_calendar';
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
