/**
 * Host-contract tests for main.js.
 *
 * The plugin runs in Cindy's browser sandbox and only ever talks to the Host
 * through `cindy`. This harness reproduces that boundary with node:vm — no
 * Cindy install needed — and asserts the parts of the contract that a real
 * install would otherwise be the only way to check:
 *
 *   - exactly one tool-result per callId, echoing that same callId
 *   - success shape for a normal scan, including 1-based line numbers
 *   - actionable failures (ok:false + errorCode + message) for bad input
 *   - no reply at all for messages that are not tool calls for this plugin
 *   - never inventing a callId when the Host did not supply one
 *
 * Run: node --test test/contract.test.mjs
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditPage, allows, documentsFromManifest, effectiveSources, parseCsp, HOST_PAGE_CSP } from './pages-csp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, '..', 'todo-scan', 'main.js'), 'utf8');

/** Minimal BroadcastChannel stand-in: records posts, lets a test reply as the panel. */
class MockBroadcastChannel {
  constructor(name) {
    this.name = name;
    this.posted = [];
    this.onmessage = null;
  }

  postMessage(message) {
    this.posted.push(message);
  }

  /** Simulate a message from the panel into the plugin. */
  async fromPanel(message) {
    await this.onmessage?.({ data: message });
  }
}

/** Boot main.js inside a fresh VM context and return the mock Host. */
function bootPlugin() {
  const sent = [];
  const host = {
    handler: null,
    sent,
    channel: null
  };
  const cindy = {
    onHostMessage(fn) {
      host.handler = fn;
    },
    async send(message) {
      sent.push(message);
    },
    // Network and filesystem are intentionally absent: this plugin must not
    // need them, and a call would throw and fail the test.
  };
  class Channel extends MockBroadcastChannel {
    constructor(name) {
      super(name);
      host.channel = this;
    }
  }

  vm.runInNewContext(SOURCE, { cindy, console, Date, BroadcastChannel: Channel }, { filename: 'main.js' });
  assert.equal(typeof host.handler, 'function', 'plugin registered a host message handler');
  assert.ok(host.channel, 'plugin opened its panel channel');
  assert.equal(host.channel.name, 'todo-scan');
  return host;
}

/**
 * Dispatch a message and return the Host-visible messages.
 *
 * Values created inside the VM belong to another realm, so `assert.deepEqual`
 * would reject them on prototype identity alone. Round-tripping through JSON
 * keeps the assertions about the plugin's data, not the harness's realm.
 */
async function call(host, message) {
  await host.handler(message);
  return JSON.parse(JSON.stringify(host.sent));
}

test('returns one successful result with the Host callId', async () => {
  const host = bootPlugin();
  const sent = await call(host, {
    type: 'tool-call',
    callId: 'call-abc',
    tool: 'scan_todos',
    args: {
      text: ['function run() {', '  // TODO: handle the empty case', '  return 1;', '}'].join('\n')
    }
  });

  assert.equal(sent.length, 1, 'exactly one message sent');
  const message = sent[0];
  assert.equal(message.type, 'tool-result');
  assert.equal(message.callId, 'call-abc', 'callId is echoed, never replaced');
  assert.equal(message.ok, true);
  assert.equal(message.result.total, 1);
  assert.equal(message.result.truncated, false);
  assert.equal(message.result.scannedLines, 4);
  assert.deepEqual(message.result.byTag, { TODO: 1, FIXME: 0, HACK: 0, XXX: 0 });
  assert.deepEqual(message.result.items[0], {
    key: '2:6:TODO',
    line: 2,
    column: 6,
    tag: 'TODO',
    text: 'handle the empty case'
  });
});

test('filters by tag and counts only the kept tag', async () => {
  const host = bootPlugin();
  const text = ['// FIXME: racy', '// HACK: temporary', '// FIXME: stale'].join('\n');
  const sent = await call(host, {
    type: 'tool-call',
    callId: 'call-filter',
    tool: 'scan_todos',
    args: { text, tag: 'fixme' }
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].ok, true);
  assert.equal(sent[0].result.total, 2);
  assert.deepEqual(sent[0].result.byTag, { TODO: 0, FIXME: 2, HACK: 0, XXX: 0 });
  assert.deepEqual(
    sent[0].result.items.map((item) => item.line),
    [1, 3]
  );
});

test('an empty match list is a success, not an error', async () => {
  const host = bootPlugin();
  const sent = await call(host, {
    type: 'tool-call',
    callId: 'call-none',
    tool: 'scan_todos',
    args: { text: 'const clean = true;\n' }
  });

  assert.equal(sent[0].ok, true);
  assert.equal(sent[0].result.total, 0);
  assert.deepEqual(sent[0].result.items, []);
});

test('missing text fails with an actionable error, not a crash', async () => {
  const host = bootPlugin();
  const sent = await call(host, {
    type: 'tool-call',
    callId: 'call-missing',
    tool: 'scan_todos',
    args: {}
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].ok, false);
  assert.equal(sent[0].errorCode, 'INVALID_ARGUMENT');
  assert.match(sent[0].message, /needs the text to scan/);
  assert.doesNotMatch(sent[0].message, /\bat .*:\d+:\d+/, 'no stack trace leaked');
});

test('an invalid tag is rejected with the allowed values', async () => {
  const host = bootPlugin();
  const sent = await call(host, {
    type: 'tool-call',
    callId: 'call-badtag',
    tool: 'scan_todos',
    args: { text: '// TODO: x', tag: 'BUG' }
  });

  assert.equal(sent[0].ok, false);
  assert.equal(sent[0].errorCode, 'INVALID_ARGUMENT');
  assert.match(sent[0].message, /TODO, FIXME, HACK, XXX/);
});

test('oversized input is refused instead of being truncated silently', async () => {
  const host = bootPlugin();
  const sent = await call(host, {
    type: 'tool-call',
    callId: 'call-big',
    tool: 'scan_todos',
    args: { text: 'x'.repeat(200001) }
  });

  assert.equal(sent[0].ok, false);
  assert.equal(sent[0].errorCode, 'TEXT_TOO_LARGE');
  assert.match(sent[0].message, /200000/);
});

test('more than 200 matches report truncated instead of pretending to be complete', async () => {
  const host = bootPlugin();
  const text = Array.from({ length: 205 }, (_, i) => `// TODO: item ${i + 1}`).join('\n');
  const sent = await call(host, {
    type: 'tool-call',
    callId: 'call-truncated',
    tool: 'scan_todos',
    args: { text }
  });

  assert.equal(sent[0].ok, true);
  assert.equal(sent[0].result.items.length, 200);
  assert.equal(sent[0].result.truncated, true);
  assert.equal(sent[0].result.byTag.TODO, 205, 'counts stay accurate when the list is capped');
});

test('several markers on one line are all reported, each with its own key', async () => {
  const host = bootPlugin();
  const sent = await call(host, {
    type: 'tool-call',
    callId: 'call-multi',
    tool: 'scan_todos',
    args: { text: '// TODO: cleanup; FIXME: crash' }
  });

  const result = sent[0].result;
  assert.equal(result.total, 2, 'the second marker on a line is not skipped');
  assert.deepEqual(result.items.map((item) => item.tag), ['TODO', 'FIXME']);
  assert.deepEqual(result.items.map((item) => item.column), [4, 19]);
  assert.deepEqual(result.items.map((item) => item.text), ['cleanup; FIXME: crash', 'crash']);
  assert.equal(
    new Set(result.items.map((item) => item.key)).size,
    2,
    'keys must stay distinct — the panel ticks items off by key'
  );
});

test('a tag filter finds a marker that is not the first on the line', async () => {
  const host = bootPlugin();
  const sent = await call(host, {
    type: 'tool-call',
    callId: 'call-multi-filter',
    tool: 'scan_todos',
    args: { text: '// TODO: cleanup; FIXME: crash', tag: 'fixme' }
  });

  assert.equal(sent[0].result.total, 1);
  assert.equal(sent[0].result.items[0].tag, 'FIXME');
  assert.deepEqual(sent[0].result.byTag, { TODO: 0, FIXME: 1, HACK: 0, XXX: 0 });
});

test('get_selection counts within the active filter, so hidden work is not "resolved"', async () => {
  const host = bootPlugin();
  await call(host, {
    type: 'tool-call',
    callId: 'f-scan',
    tool: 'scan_todos',
    args: { text: '// TODO: open\n// FIXME: also open' }
  });
  await host.channel.fromPanel({ type: 'set-filter', filter: 'todo' });

  const sent = await call(host, { type: 'tool-call', callId: 'f-sel', tool: 'get_selection', args: {} });
  const result = sent[sent.length - 1].result;
  assert.equal(result.filter, 'TODO');
  assert.equal(result.visibleCount, 1);
  assert.equal(result.unresolvedCount, 1);
  assert.equal(
    result.resolvedCount,
    0,
    'the FIXME hidden by the filter was never ticked, so it cannot count as resolved'
  );
});

test('get_selection says the list is capped when the scan was truncated', async () => {
  const host = bootPlugin();
  const text = Array.from({ length: 205 }, (_, i) => `// TODO: item ${i + 1}`).join('\n');
  await call(host, { type: 'tool-call', callId: 't-scan', tool: 'scan_todos', args: { text } });

  const sent = await call(host, { type: 'tool-call', callId: 't-sel', tool: 'get_selection', args: {} });
  const result = sent[sent.length - 1].result;
  assert.equal(result.truncated, true, 'a capped scan stays capped in the selection');
  assert.match(result.note, /200-marker cap/);
  assert.equal(result.unresolvedCount, 200);
});

test('an unknown tool produces one actionable failure for that call', async () => {
  const host = bootPlugin();
  const sent = await call(host, {
    type: 'tool-call',
    callId: 'call-unknown',
    tool: 'rewrite_everything',
    args: {}
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].callId, 'call-unknown');
  assert.equal(sent[0].ok, false);
  assert.equal(sent[0].errorCode, 'UNKNOWN_TOOL');
  assert.match(sent[0].message, /scan_todos/);
});

test('non-tool messages and missing callIds get no reply', async () => {
  const host = bootPlugin();
  await call(host, { type: 'panel-ready' });
  await call(host, { type: 'tool-call', tool: 'scan_todos', args: { text: '// TODO: x' } });
  await call(host, { type: 'tool-call', callId: '', tool: 'scan_todos', args: { text: 'x' } });

  assert.deepEqual(host.sent, [], 'never fabricate a callId or answer an unrelated message');
});

test('a second call is answered independently', async () => {
  const host = bootPlugin();
  await call(host, { type: 'tool-call', callId: 'a', tool: 'scan_todos', args: { text: '// TODO: one' } });
  await call(host, { type: 'tool-call', callId: 'b', tool: 'scan_todos', args: { text: '// FIXME: two' } });

  assert.equal(host.sent.length, 2);
  assert.deepEqual(host.sent.map((m) => m.callId), ['a', 'b']);
  assert.equal(host.sent[1].result.items[0].tag, 'FIXME');
});

/* ------------------------------------------------------- panel integration */

test('a scan pushes its results to the panel', async () => {
  const host = bootPlugin();
  await call(host, {
    type: 'tool-call',
    callId: 'push-1',
    tool: 'scan_todos',
    args: { text: '// TODO: a\n// HACK: b' }
  });

  const pushed = host.channel.posted.filter((m) => m.type === 'state');
  assert.equal(pushed.length, 1, 'one state push for one scan');
  assert.equal(pushed[0].items.length, 2);
  assert.equal(pushed[0].total, 2);
  // Panel payloads are created inside the VM realm; compare their data, not prototypes.
  assert.deepEqual(JSON.parse(JSON.stringify(pushed[0].resolved)), []);
});

test('the panel\'s state-request is answered with its own reqId', async () => {
  const host = bootPlugin();
  await call(host, { type: 'tool-call', callId: 's1', tool: 'scan_todos', args: { text: '// TODO: a' } });
  host.channel.posted.length = 0;

  await host.channel.fromPanel({ type: 'state-request', reqId: 'req-abc' });

  assert.equal(host.channel.posted.length, 1);
  assert.equal(host.channel.posted[0].type, 'state');
  assert.equal(host.channel.posted[0].reqId, 'req-abc');
});

test('the retry loop is idempotent: one answer per reqId', async () => {
  const host = bootPlugin();
  host.channel.posted.length = 0;

  await host.channel.fromPanel({ type: 'state-request', reqId: 'req-1' });
  await host.channel.fromPanel({ type: 'state-request', reqId: 'req-1' });
  await host.channel.fromPanel({ type: 'state-request', reqId: 'req-1' });

  assert.equal(host.channel.posted.length, 1, 'panel retries are deduped');
});

test('ticking an item in the panel removes it from get_selection', async () => {
  const host = bootPlugin();
  await call(host, {
    type: 'tool-call',
    callId: 'tick-scan',
    tool: 'scan_todos',
    args: { text: '// TODO: keep me\n// FIXME: tick me' }
  });
  const fixme = host.channel.posted.find((m) => m.type === 'state').items
    .find((item) => item.tag === 'FIXME');

  await host.channel.fromPanel({ type: 'mark', key: fixme.key, resolved: true });

  const sent = await call(host, { type: 'tool-call', callId: 'sel-1', tool: 'get_selection', args: {} });
  const result = sent[sent.length - 1].result;
  assert.equal(result.hasScan, true);
  assert.equal(result.total, 2);
  assert.equal(result.unresolvedCount, 1);
  assert.equal(result.resolvedCount, 1);
  assert.deepEqual(result.items.map((item) => item.tag), ['TODO']);
  assert.match(result.markdown, /^- \[ \] TODO/m);
});

test('a panel filter narrows the pushed state', async () => {
  const host = bootPlugin();
  await call(host, {
    type: 'tool-call',
    callId: 'f1',
    tool: 'scan_todos',
    args: { text: '// TODO: a\n// HACK: b\n// HACK: c' }
  });
  host.channel.posted.length = 0;

  await host.channel.fromPanel({ type: 'set-filter', filter: 'hack' });

  const pushed = host.channel.posted.find((m) => m.type === 'state');
  assert.equal(pushed.filter, 'HACK');
  assert.equal(pushed.items.length, 2);
  assert.ok(pushed.items.every((item) => item.tag === 'HACK'));
});

test('get_selection before any scan says so instead of pretending', async () => {
  const host = bootPlugin();
  const sent = await call(host, { type: 'tool-call', callId: 'sel-none', tool: 'get_selection', args: {} });

  assert.equal(sent[0].ok, true);
  assert.equal(sent[0].result.hasScan, false);
  assert.equal(sent[0].result.unresolvedCount, 0);
  assert.equal(sent[0].result.markdown, '');
});

test('a new scan clears earlier tick-offs', async () => {
  const host = bootPlugin();
  await call(host, { type: 'tool-call', callId: 'r1', tool: 'scan_todos', args: { text: '// TODO: a' } });
  const only = host.channel.posted.find((m) => m.type === 'state').items[0];
  await host.channel.fromPanel({ type: 'mark', key: only.key, resolved: true });
  const first = await call(host, { type: 'tool-call', callId: 'r2', tool: 'get_selection', args: {} });
  assert.equal(first[first.length - 1].result.unresolvedCount, 0);

  await call(host, { type: 'tool-call', callId: 'r3', tool: 'scan_todos', args: { text: '// TODO: a' } });
  const second = await call(host, { type: 'tool-call', callId: 'r4', tool: 'get_selection', args: {} });
  assert.equal(
    second[second.length - 1].result.unresolvedCount,
    1,
    'stale tick-offs must not survive a rescan'
  );
});

/* --------------------------------------------------- panel asset invariants */

const panelHtml = readFileSync(join(HERE, '..', 'todo-scan', 'panel.html'), 'utf8');
const panelJs = readFileSync(join(HERE, '..', 'todo-scan', 'panel.js'), 'utf8');
const panelCss = readFileSync(join(HERE, '..', 'todo-scan', 'panel.css'), 'utf8');

test('the panel loads only its own files', () => {
  assert.doesNotMatch(panelHtml, /(?:src|href)="(?:https?:)?\/\//, 'no external script/style URLs');
  assert.doesNotMatch(panelHtml, /<script(?![^>]*\bsrc=)/i, 'no inline script (CSP)');
  assert.match(panelHtml, /src="panel\.js"/);
  assert.match(panelHtml, /href="panel\.css"/);
});

test('the panel wakes the brain before asking, and retries by reqId', () => {
  assert.match(panelJs, /cindy-ghost:\/\/todo-scan\/wake/, 'must call the documented /wake route');
  assert.match(panelJs, /new BroadcastChannel\(CHANNEL_NAME\)/);
  assert.match(panelJs, /CHANNEL_NAME = 'todo-scan'/);
  assert.match(panelJs, /state-request/);
  assert.match(panelJs, /reqId/);
});

test('the panel leaves theme and title chrome to the Host', () => {
  assert.doesNotMatch(panelCss, /color-scheme\s*:/, 'Host injects color-scheme');
  assert.match(panelCss, /var\(--panel-bg/, 'uses Host variables with fallbacks');
  assert.doesNotMatch(panelHtml, /<header[^>]*class="title|panel-title/, 'Host draws the title bar');
});

/* ------------------------------------------------------------------ *
 * Host page rules: CSP and same-origin.
 *
 * The Desktop serves panel.html from cindy-ghost://todo-scan/ with the
 * GHOST_HTML_CSP header (see pages-csp.mjs for the shipped policy). Anything
 * those directives refuse would fail only in a real install, at the moment a
 * user opens the panel — which is exactly what this test moves earlier.
 * ------------------------------------------------------------------ */

const PLUGIN_DIR = join(HERE, '..', 'todo-scan');

function auditPanel(overrides = {}) {
  const { manifest } = documentsFromManifest(PLUGIN_DIR);
  return auditPage({
    dir: PLUGIN_DIR,
    ghostId: manifest.id,
    htmlPath: manifest.panel.html,
    ...overrides
  });
}

test('the panel document is covered by the Host page CSP', () => {
  const { manifest, pages } = documentsFromManifest(PLUGIN_DIR);
  assert.deepEqual(pages, ['panel.html'], 'the manifest declares exactly one served document');
  assert.equal(manifest.id, 'todo-scan', 'the page origin is cindy-ghost://todo-scan/');

  const audit = auditPanel();
  assert.deepEqual(
    audit.violations,
    [],
    'panel.html must run under GHOST_HTML_CSP without console CSP errors:\n  ' + audit.violations.join('\n  ')
  );

  // Pin the policy the audit reads, so a silently relaxed Host policy or a
  // weakened local copy shows up as a failure instead of a false pass.
  const csp = parseCsp(HOST_PAGE_CSP);
  assert.equal(allows(csp, 'script-src', "'self'"), true, 'own scripts are allowed');
  assert.equal(allows(csp, 'script-src', "'unsafe-inline'"), false, 'no inline script');
  assert.equal(allows(csp, 'script-src', "'unsafe-eval'"), false, 'no eval');
  assert.equal(allows(csp, 'style-src', "'unsafe-inline'"), true, 'inline style is permitted');
  assert.deepEqual(effectiveSources(csp, 'connect-src'), ["'self'"], 'page network is same-origin only');
  assert.deepEqual(effectiveSources(csp, 'font-src'), ["'self'"], 'no remote fonts');
});

test('the CSP audit rejects what the Host would block', () => {
  // Negative control: without it, a bug that disables a rule would leave this
  // suite green while the real panel logs CSP errors.
  const hostile = [
    '<!DOCTYPE html><html><head>',
    '<title>hostile</title>',
    '<base href="https://example.com/">',
    '<link rel="stylesheet" href="https://cdn.example.com/theme.css">',
    '<style>@font-face{src:url(https://fonts.example.com/x.woff2)}</style>',
    '<script>alert(1)</script>',
    '</head><body>',
    '<button onclick="go()">run</button>',
    '<a href="javascript:go()">run</a>',
    '<img src="file:///etc/passwd">',
    '<iframe src="https://example.com/"></iframe>',
    '<form action="https://example.com/post"></form>',
    '</body></html>'
  ].join('\n');

  const audit = auditPanel({ htmlOverride: hostile });
  const found = audit.violations.join('\n');
  for (const expected of [
    '<base>',
    'cross-origin URL',
    '@font-face loads a font from a non-same-origin URL',
    'inline <script>',
    'inline event handler',
    'javascript: URL',
    'image is not covered by img-src',
    'embeds a non-same-origin document',
    'targets a non-same-origin action'
  ]) {
    assert.ok(found.includes(expected), 'audit should flag ' + expected + ', got:\n' + found);
  }
});

test('linked stylesheets are audited, not only inline <style> blocks', () => {
  // A <link rel="stylesheet"> is a second document under the same policy;
  // auditing only inline blocks would let a remote font or @import through the
  // very file this plugin ships as panel.css.
  const dir = mkdtempSync(join(tmpdir(), 'todo-scan-css-'));
  try {
    writeFileSync(
      join(dir, 'panel.css'),
      [
        '@import url(https://cdn.example.com/theme.css);',
        '@font-face{font-family:x;src:url("https://fonts.example.com/x.woff2")}'
      ].join('\n')
    );
    writeFileSync(
      join(dir, 'panel.html'),
      '<!DOCTYPE html><html><head><link rel="stylesheet" href="panel.css"></head><body></body></html>'
    );

    const audit = auditPage({ dir, ghostId: 'todo-scan', htmlPath: 'panel.html' });
    const found = audit.violations.join('\n');
    assert.ok(found.includes('panel.css: @import pulls a stylesheet from remote-https'), 'linked @import must be flagged:\n' + found);
    assert.ok(found.includes('panel.css: @font-face loads a font from a non-same-origin URL'), 'linked @font-face must be flagged:\n' + found);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // The shipped panel.css is one of the audited stylesheets, and it is clean.
  assert.deepEqual(auditPanel().violations, []);
});

test('page code cannot reach the Host or another origin', () => {
  // Same negative control for the script-file half of the audit: connect-src is
  // 'self' and a panel has no Host bridge, so both patterns must be caught.
  const dir = mkdtempSync(join(tmpdir(), 'todo-scan-csp-'));
  try {
    writeFileSync(
      join(dir, 'panel.js'),
      [
        "fetch('https://api.example.com/todos')",
        "cindy.send({ type: 'tool-call' })",
        "window.parent.postMessage({ ready: true }, '*')",
        'eval("2 + 2")'
      ].join('\n')
    );
    writeFileSync(join(dir, 'panel.html'), '<!DOCTYPE html><html><body><script src="panel.js"></script></body></html>');

    const audit = auditPage({ dir, ghostId: 'todo-scan', htmlPath: 'panel.html' });
    const found = audit.violations.join('\n');
    assert.ok(found.includes('calls fetch on remote-https'), 'cross-origin fetch must be flagged:\n' + found);
    assert.ok(found.includes('Host runtime bridge'), 'Host bridge in a page must be flagged:\n' + found);
    assert.ok(found.includes('wildcard target'), 'wildcard postMessage must be flagged:\n' + found);
    assert.ok(found.includes('eval/new Function'), 'eval must be flagged:\n' + found);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // And the shipped panel does none of it.
  assert.deepEqual(auditPanel().violations, []);
  assert.doesNotMatch(panelJs, /\bcindy\.\w+/, 'a panel has no Host bridge');
  assert.match(panelJs, /fetch\('cindy-ghost:\/\/todo-scan\/wake'\)/, 'the only page fetch is the same-origin wake route');
});
