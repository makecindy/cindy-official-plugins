/* global cindy */

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
