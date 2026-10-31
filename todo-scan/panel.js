/**
 * Todo Scan panel.
 *
 * Rules this file follows (authoring reference §5):
 *  - a panel has no bridge to the Host: it cannot call tools, read credentials
 *    or touch files. It only loads its own same-origin resources.
 *  - it talks to main.js over a same-origin BroadcastChannel, and only after
 *    waking the brain with `fetch('cindy-ghost://todo-scan/wake')` — a freshly
 *    opened panel usually finds the brain asleep, so a bare broadcast is lost.
 *  - state reads carry a reqId and are re-sent until the brain answers; the brain
 *    dedupes by reqId. Filter and tick messages are sent once, drawn locally at
 *    once, and reconciled by the next state read. Every message is idempotent.
 *  - no title bar: the Host draws the standard header above this document.
 */
(function () {
  'use strict';

  var GHOST_ID = 'todo-scan';
  var CHANNEL_NAME = 'todo-scan';
  var RETRY_MS = 300;
  var RETRY_LIMIT = 12;

  var channel = null;
  var pending = Object.create(null);
  var state = { items: [], filter: '', resolved: [], lastScanAt: 0, total: 0, truncated: false, scanGen: 0 };
  var markdownOpen = false;

  var els = {
    summary: document.getElementById('summary'),
    list: document.getElementById('list'),
    empty: document.getElementById('empty'),
    counts: document.getElementById('counts'),
    refresh: document.getElementById('refresh'),
    filters: Array.prototype.slice.call(document.querySelectorAll('.chip')),
    toggleMarkdown: document.getElementById('toggle-markdown'),
    markdown: document.getElementById('markdown')
  };

  function nextReqId() {
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function send(message) {
    if (!channel) return;
    try {
      channel.postMessage(message);
    } catch (error) {
      // Channel closed (plugin disabled or panel torn down): nothing to do.
    }
  }

  /** Ask for state and keep asking until an answer arrives (brain may be asleep). */
  function requestState() {
    var reqId = nextReqId();
    var attempts = 0;
    pending[reqId] = true;

    function tick() {
      if (!pending[reqId]) return;
      attempts += 1;
      send({ type: 'state-request', reqId: reqId });
      if (attempts >= RETRY_LIMIT) {
        delete pending[reqId];
        if (state.lastScanAt === 0) setSummary('Plugin not responding — reopen the panel.');
        return;
      }
      window.setTimeout(tick, RETRY_MS);
    }

    tick();
  }

  function setSummary(text) {
    els.summary.textContent = text;
  }

  function resolvedSet() {
    var set = Object.create(null);
    for (var i = 0; i < state.resolved.length; i += 1) set[state.resolved[i]] = true;
    return set;
  }

  function visible() {
    return state.items.filter(function (item) {
      return !state.filter || item.tag === state.filter;
    });
  }

  function openItems() {
    var resolved = resolvedSet();
    return visible().filter(function (item) { return !resolved[item.key]; });
  }

  function markdown() {
    return openItems().map(function (item) {
      var text = (item.text || '').replace(/\s+/g, ' ').trim();
      return '- [ ] ' + item.tag + (text ? ' (' + text + ')' : '') + ' — line ' + item.line;
    }).join('\n');
  }

  function render() {
    var resolved = resolvedSet();
    var items = visible();

    els.list.textContent = '';
    if (!items.length) {
      var empty = document.createElement('p');
      empty.className = 'empty';
      // A filter that hides everything is a different fact from a scan that
      // found nothing at all; say which one happened.
      if (!state.lastScanAt) empty.textContent = 'Run a scan in chat and its results appear here.';
      else if (state.filter) empty.textContent = 'Nothing matches this filter.';
      else empty.textContent = 'The last scan found no markers.';
      els.list.appendChild(empty);
    }

    items.forEach(function (item) {
      var row = document.createElement('li');
      row.className = 'item' + (resolved[item.key] ? ' is-resolved' : '');

      var box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = Boolean(resolved[item.key]);
      box.setAttribute(
        'aria-label',
        'Mark line ' + item.line + ' ' + item.tag + ' as ' +
          (box.checked ? 'unresolved' : 'resolved')
      );
      box.addEventListener('change', function () {
        send({ type: 'mark', key: item.key, resolved: box.checked, scanGen: state.scanGen });
        // Optimistic local update; the brain's next state is authoritative.
        if (box.checked) {
          if (state.resolved.indexOf(item.key) === -1) state.resolved.push(item.key);
        } else {
          state.resolved = state.resolved.filter(function (key) { return key !== item.key; });
        }
        render();
      });

      var tag = document.createElement('span');
      tag.className = 'tag';
      tag.dataset.tag = item.tag;
      tag.textContent = item.tag;

      var text = document.createElement('span');
      text.className = 'text';
      text.appendChild(document.createTextNode(item.text || '(no description)'));
      var meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = 'line ' + item.line;
      text.appendChild(meta);

      row.appendChild(box);
      row.appendChild(tag);
      row.appendChild(text);
      els.list.appendChild(row);
    });

    var open = openItems().length;
    els.counts.textContent = open + ' open';
    els.summary.textContent = state.lastScanAt
      ? state.total + ' found' + (state.truncated ? ' (capped at 200)' : '') +
        ' · ' + open + ' open' + (state.filter ? ' · ' + state.filter : '')
      : 'No scan yet';

    els.filters.forEach(function (chip) {
      var active = (chip.dataset.filter || '') === (state.filter || '');
      chip.classList.toggle('is-active', active);
      chip.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    if (markdownOpen) updateMarkdown();
  }

  function updateMarkdown() {
    els.markdown.value = markdown();
  }

  function applyState(next) {
    state = {
      items: Array.isArray(next.items) ? next.items : [],
      filter: typeof next.filter === 'string' ? next.filter : '',
      resolved: Array.isArray(next.resolved) ? next.resolved : [],
      lastScanAt: typeof next.lastScanAt === 'number' ? next.lastScanAt : 0,
      total: typeof next.total === 'number' ? next.total : 0,
      truncated: Boolean(next.truncated),
      scanGen: typeof next.scanGen === 'number' ? next.scanGen : 0
    };
    render();
  }

  function clearPending(reqId) {
    if (reqId && pending[reqId]) {
      delete pending[reqId];
      return;
    }
    // Unkeyed push from the brain: any outstanding read is now satisfied.
    Object.keys(pending).forEach(function (key) { delete pending[key]; });
  }

  function wake() {
    // Idempotent; resolves immediately if the brain is already running.
    return fetch('cindy-ghost://' + GHOST_ID + '/wake')
      .catch(function () { /* older Hosts may not expose /wake; the retry loop covers it */ });
  }

  function start() {
    if (typeof BroadcastChannel === 'undefined') {
      setSummary('This Cindy version cannot host plugin panels.');
      return;
    }
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = function (event) {
      var message = event.data;
      if (!message || message.type !== 'state') return;
      clearPending(message.reqId);
      applyState(message);
    };

    els.filters.forEach(function (chip) {
      chip.addEventListener('click', function () {
        state.filter = chip.dataset.filter || '';
        send({ type: 'set-filter', filter: state.filter });
        render();
      });
    });

    els.refresh.addEventListener('click', function () {
      requestState();
    });

    els.toggleMarkdown.addEventListener('click', function () {
      markdownOpen = !markdownOpen;
      els.markdown.hidden = !markdownOpen;
      els.toggleMarkdown.setAttribute('aria-expanded', markdownOpen ? 'true' : 'false');
      els.toggleMarkdown.textContent = markdownOpen ? 'Hide markdown' : 'Show markdown';
      if (markdownOpen) updateMarkdown();
    });

    wake().then(function () {
      requestState();
    });
  }

  start();
})();
