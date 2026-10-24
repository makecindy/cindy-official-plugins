/**
 * Todo Scan — Cindy plugin (Manifest v3) with a docked panel.
 *
 * Runs in Cindy's browser sandbox: no Node, no DOM, no network, no credentials.
 * Two surfaces share this file:
 *
 *   Host   → tool calls (`scan_todos`, `get_selection`)
 *   Panel  → BroadcastChannel 'todo-scan' (state reads, filters, tick-offs),
 *            woken by `fetch('cindy-ghost://todo-scan/wake')` from panel.js
 *
 * The panel has no bridge to the Host, so user intent reaches the Agent the one
 * documented way: the Agent asks for it with `get_selection`. This plugin does
 * not invent a push-to-Agent channel.
 *
 * Tool contract (authoring reference):
 *   Host   → { type: 'tool-call', tool, args, callId }
 *   Plugin → { type: 'tool-result', callId, ok: true, result }
 *          | { type: 'tool-result', callId, ok: false, errorCode, message }
 * Exactly one tool-result per callId.
 */

/* global cindy, BroadcastChannel */

var MAX_TEXT_LENGTH = 200000;
var MAX_ITEMS = 200;
var TAG_NAMES = ['TODO', 'FIXME', 'HACK', 'XXX'];
var TAG_LOOKUP = { TODO: true, FIXME: true, HACK: true, XXX: true };
// Source only: each line is scanned with a fresh global copy so several markers
// on one line are all found.
var MARKER_PATTERN = '\\b(TODO|FIXME|HACK|XXX)\\b';
var LEADING_SEPARATOR_RE = /^[\s:：\-–—(\[]+/;
var CHANNEL_NAME = 'todo-scan';
var MAX_SEEN_REQ_IDS = 50;

/** Scan result + triage state. In memory only; nothing is persisted. */
var state = {
  items: [],
  byTag: { TODO: 0, FIXME: 0, HACK: 0, XXX: 0 },
  total: 0,
  truncated: false,
  scannedLines: 0,
  filter: '',
  resolved: Object.create(null),
  lastScanAt: 0
};

var channel = null;
var seenReqIds = [];

function succeed(callId, result) {
  return cindy.send({ type: 'tool-result', callId: callId, ok: true, result: result });
}

function fail(callId, errorCode, message) {
  return cindy.send({
    type: 'tool-result',
    callId: callId,
    ok: false,
    errorCode: errorCode,
    message: message
  });
}

function markerText(line, matchIndex, matchLength) {
  var rest = line.slice(matchIndex + matchLength);
  rest = rest.replace(LEADING_SEPARATOR_RE, '');
  return rest.replace(/\s+$/, '');
}

/**
 * Collect markers from text. Pure: no I/O, deterministic order (document
 * order), stable shape. `key` is what the panel uses to tick an item off.
 */
function scan(text, tagFilter) {
  var lines = text.split(/\r\n|\r|\n/);
  var items = [];
  var byTag = { TODO: 0, FIXME: 0, HACK: 0, XXX: 0 };
  var truncated = false;

  for (var i = 0; i < lines.length; i += 1) {
    var line = lines[i];
    var markerRe = new RegExp(MARKER_PATTERN, 'gi');
    var match;
    while ((match = markerRe.exec(line)) !== null) {
      var tag = match[1].toUpperCase();
      if (tagFilter && tag !== tagFilter) continue;

      byTag[tag] += 1;
      if (items.length >= MAX_ITEMS) {
        truncated = true;
        continue;
      }
      items.push({
        // Line and column keep the key unique when one line holds two markers.
        key: (i + 1) + ':' + (match.index + 1) + ':' + tag,
        line: i + 1,
        column: match.index + 1,
        tag: tag,
        text: markerText(line, match.index, match[0].length)
      });
    }
  }

  return {
    total: items.length,
    truncated: truncated,
    scannedLines: lines.length,
    byTag: byTag,
    items: items
  };
}

/* ---------------------------------------------------------------- panel side */

function resolvedKeys() {
  return Object.keys(state.resolved);
}

function visibleItems(filter) {
  var wanted = filter === undefined ? state.filter : filter;
  return state.items.filter(function (item) {
    return !wanted || item.tag === wanted;
  });
}

function unresolvedItems(filter) {
  return visibleItems(filter).filter(function (item) {
    return !state.resolved[item.key];
  });
}

function markdownFor(items) {
  return items.map(function (item) {
    var text = item.text.replace(/\s+/g, ' ').trim();
    return '- [ ] ' + item.tag + (text ? ' (' + text + ')' : '') + ' — line ' + item.line;
  }).join('\n');
}

function panelPayload(reqId) {
  return {
    type: 'state',
    reqId: reqId,
    items: visibleItems(),
    filter: state.filter,
    total: state.total,
    truncated: state.truncated,
    resolved: resolvedKeys(),
    lastScanAt: state.lastScanAt
  };
}

function broadcastState() {
  if (!channel) return;
  try {
    channel.postMessage(panelPayload(undefined));
  } catch (error) {
    // No listener or a closing channel: panel state is advisory, never fatal.
  }
}

function rememberReqId(reqId) {
  if (!reqId || typeof reqId !== 'string') return false;
  if (seenReqIds.indexOf(reqId) !== -1) return true;
  seenReqIds.push(reqId);
  if (seenReqIds.length > MAX_SEEN_REQ_IDS) seenReqIds.shift();
  return false;
}

function handlePanelMessage(message) {
  if (!message || typeof message !== 'object') return;

  if (message.type === 'state-request') {
    if (rememberReqId(message.reqId)) return; // retry of a request we already answered
    if (channel) {
      try {
        channel.postMessage(panelPayload(message.reqId));
      } catch (error) {
        // ignored: the panel will retry
      }
    }
    return;
  }

  if (message.type === 'mark') {
    if (typeof message.key !== 'string' || !message.key) return;
    if (message.resolved) state.resolved[message.key] = true;
    else delete state.resolved[message.key];
    return;
  }

  if (message.type === 'set-filter') {
    var filter = message.filter;
    state.filter = TAG_LOOKUP[String(filter || '').toUpperCase()] ? String(filter).toUpperCase() : '';
    broadcastState();
  }
}

function ensureChannel() {
  if (channel) return channel;
  if (typeof BroadcastChannel === 'undefined') return null;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = function (event) { handlePanelMessage(event.data); };
  } catch (error) {
    channel = null;
  }
  return channel;
}

/* --------------------------------------------------------------------- tools */

function handleScanTodos(callId, args) {
  var text = args.text;
  if (typeof text !== 'string' || text.trim() === '') {
    return fail(
      callId,
      'INVALID_ARGUMENT',
      'scan_todos needs the text to scan in `text`. Pass the file contents, diff or notes as a string — an empty or missing value cannot produce a task list.'
    );
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return fail(
      callId,
      'TEXT_TOO_LARGE',
      'scan_todos accepts up to ' + MAX_TEXT_LENGTH + ' characters and received ' + text.length +
        '. Scan one file or one hunk at a time, or narrow the range before calling again.'
    );
  }

  var tagFilter = null;
  if (args.tag !== undefined && args.tag !== null) {
    if (typeof args.tag !== 'string' || !TAG_LOOKUP[args.tag.toUpperCase()]) {
      return fail(
        callId,
        'INVALID_ARGUMENT',
        'The `tag` filter must be one of ' + TAG_NAMES.join(', ') + '. Omit it to scan all four.'
      );
    }
    tagFilter = args.tag.toUpperCase();
  }

  var result = scan(text, tagFilter);
  state.items = result.items;
  state.byTag = result.byTag;
  state.total = result.total;
  state.truncated = result.truncated;
  state.scannedLines = result.scannedLines;
  state.resolved = Object.create(null); // a new scan invalidates old tick-offs
  state.filter = tagFilter || '';
  state.lastScanAt = Date.now();

  ensureChannel();
  broadcastState();

  return succeed(callId, result);
}

function handleGetSelection(callId) {
  // Both counts come from the same visible set: subtracting a filtered open list
  // from the unfiltered total would report hidden work as done.
  var visible = visibleItems();
  var open = visible.filter(function (item) {
    return !state.resolved[item.key];
  });
  return succeed(callId, {
    hasScan: state.lastScanAt > 0,
    lastScanAt: state.lastScanAt,
    filter: state.filter,
    total: state.total,
    truncated: state.truncated,
    visibleCount: visible.length,
    unresolvedCount: open.length,
    resolvedCount: visible.length - open.length,
    byTag: state.byTag,
    items: open,
    markdown: markdownFor(open),
    note: state.truncated
      ? 'The scan stopped at the 200-marker cap, so this selection is incomplete. Rescan a narrower slice of the text to see the rest.'
      : null
  });
}

ensureChannel();

cindy.onHostMessage(async function (message) {
  if (!message || message.type !== 'tool-call') return;

  var callId = message.callId;
  if (typeof callId !== 'string' || callId === '') return;

  try {
    if (message.tool === 'scan_todos') {
      return await handleScanTodos(callId, message.args || {});
    }
    if (message.tool === 'get_selection') {
      return await handleGetSelection(callId);
    }
    return fail(
      callId,
      'UNKNOWN_TOOL',
      'This plugin version exposes scan_todos and get_selection. Update the plugin, or call one of those tools.'
    );
  } catch (error) {
    return fail(
      callId,
      'INTERNAL_ERROR',
      'Todo Scan stopped before finishing. Nothing was modified. Retry once; if it fails again, report the plugin version (1.1.0) and the size of the scanned text.'
    );
  }
});
