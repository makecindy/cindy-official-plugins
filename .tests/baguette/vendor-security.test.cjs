const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const web = path.resolve(__dirname, '../../baguette-simulator/vendor/baguette-v0.1.98-macOS-arm64/Baguette_Baguette.bundle/Web');

test('toolbar roles keep untrusted titles out of HTML and retain their controls', () => {
  const sourceCode = fs.readFileSync(path.join(web, 'sim-native.js'), 'utf8');
  const fn = sourceCode.slice(sourceCode.indexOf('  function menuRow('), sourceCode.indexOf('  function closeFoldMenus('));
  const title = '<img src=x onerror="alert(1)"> & "Google"';
  for (const role of ['readout', 'choice', 'action', 'state']) {
    let clicked = 0, closed = 0;
    const source = { getAttribute: () => title, textContent: '123', classList: { contains: () => true }, querySelector: () => null, click: () => clicked++ };
    const nodes = new Map();
    const row = { children: [], handlers: {}, querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, {}); return nodes.get(selector); }, appendChild(node) { this.children.push(node); }, addEventListener(name, cb) { this.handlers[name] = cb; } };
    const context = { document: { getElementById: () => source, createElement: () => row }, clusterSvg: () => '<svg></svg>', closeFoldMenus: () => closed++ };
    vm.runInNewContext(fn, context);
    assert.equal(context.menuRow({ id: 'control', role }), row);
    assert.equal(row.querySelector('.tb-label').textContent, title);
    assert.ok(!row.innerHTML.includes(title), 'untrusted label must never reach the HTML parser');
    if (role === 'readout') assert.equal(row.querySelector('.tb-val').textContent, '123');
    if (role === 'choice') assert.equal(row.children[0], source);
    if (role === 'action' || role === 'state') { row.handlers.click(); assert.equal(clicked, 1); assert.equal(closed, 1); }
  }
});

test('CSS selector fallback escapes quotes, backslashes, newlines and Unicode', () => {
  const source = fs.readFileSync(path.join(web, 'sim-3d.js'), 'utf8');
  const fn = source.slice(source.indexOf('  function cssEscape('), source.indexOf('  window.Sim3DPanel'));
  const context = { window: {} };
  vm.runInNewContext(fn, context);
  const input = 'Google\\"], * [x="\n😀';
  const encoded = context.cssEscape(input);
  assert.match(encoded, /^(?:\\[0-9a-f]+ )+$/);
  assert.equal(encoded.replace(/\\([0-9a-f]+) /g, (_, hex) => String.fromCodePoint(parseInt(hex, 16))), input);
  context.window.CSS = context.CSS = { escape: () => 'native-result' };
  assert.equal(context.cssEscape(input), 'native-result');
});
