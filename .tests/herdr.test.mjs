import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import lib from '../herdr/panel-lib.js';

const { WIDE_CHAR, graphemes, isWideGrapheme, specialKey, dirName } = lib;

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function key(overrides) {
  return Object.assign({ key: '', ctrlKey: false, metaKey: false }, overrides);
}

test('wide characters occupy two cells, and combined emoji stay one unit', () => {
  assert.equal(isWideGrapheme('中'), true);
  assert.equal(isWideGrapheme('한'), true);
  assert.equal(isWideGrapheme('！'), true);
  assert.equal(isWideGrapheme('a'), false);
  assert.equal(isWideGrapheme('-'), false);
  assert.equal(isWideGrapheme('│'), false); // 制表符是窄字符

  // ZWJ 组合 emoji 必须作为一个整体，否则一个符号会被拆成多个方块。
  const family = graphemes('👩‍💻');
  assert.equal(family.length, 1, `expected one grapheme, got ${JSON.stringify(family)}`);
  assert.equal(isWideGrapheme(family[0]), true);

  // 组合标点、代理对同样不拆。
  assert.equal(graphemes('é').length, 1);
  assert.equal(graphemes('𝟘').length, 1);
  assert.equal(graphemes('a中b').length, 3);
});

test('special keys are forwarded, editing keys stay in the draft', () => {
  // Ctrl 组合：任何单字符都可以，Ctrl+C 用来中断终端任务。
  assert.equal(specialKey('herdr', key({ key: 'c', ctrlKey: true })), 'ctrl+c');
  assert.equal(specialKey('tmux', key({ key: 'c', ctrlKey: true })), 'C-c');
  assert.equal(specialKey('tmux', key({ key: 'd', metaKey: true })), 'C-d');

  // 终端行为键转发，按键名按后端方言。
  assert.equal(specialKey('herdr', key({ key: 'ArrowUp' })), 'up');
  assert.equal(specialKey('tmux', key({ key: 'ArrowUp' })), 'Up');
  assert.equal(specialKey('tmux', key({ key: 'PageUp' })), 'PageUp');
  assert.equal(specialKey('herdr', key({ key: 'Tab' })), 'tab');
  assert.equal(specialKey('herdr', key({ key: 'Escape' })), 'esc');

  // 文本编辑键不转发，否则用户没法修改还没提交的命令。
  for (const name of ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'a', 'Enter']) {
    assert.equal(specialKey('herdr', key({ key: name })), null, name);
    assert.equal(specialKey('tmux', key({ key: name })), null, name);
  }
});

test('directory names keep only the last segment', () => {
  assert.equal(dirName('/home/michael/codes/cindy'), 'cindy');
  assert.equal(dirName('/home/michael/codes/cindy/'), 'cindy');
  assert.equal(dirName('~/'), '~');
  assert.equal(dirName(''), '');
  assert.equal(dirName(null), '');
});

test('the panel page loads the shared library before the panel script', () => {
  const html = readFileSync(path.join(root, 'herdr', 'panel.html'), 'utf8');
  const lib = html.indexOf('panel-lib.js');
  const panel = html.indexOf('panel.js"');
  assert.ok(lib > 0, 'panel.html must load panel-lib.js');
  assert.ok(panel > lib, 'panel-lib.js must load before panel.js');
  assert.match(html, /href="\/panel\.css"/, 'panel.html must load panel.css');
});

test('no wide-character fast path is needed for plain terminal text', () => {
  const plain = '$ gh pr checks 353 --repo makecindy/cindy-official-plugins\nok\n';
  assert.equal(WIDE_CHAR.test(plain), false);
  assert.equal(WIDE_CHAR.test('Herdr 控制台'), true);
});
