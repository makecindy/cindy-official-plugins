import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';
import test from 'node:test';

const settingsHtml = readFileSync(
  new URL('../google-gmail/settings.html', import.meta.url),
  'utf8',
);
const settingsSource = readFileSync(
  new URL('../google-gmail/settings.js', import.meta.url),
  'utf8',
);
const manifest = JSON.parse(readFileSync(
  new URL('../google-gmail/ghost.json', import.meta.url),
  'utf8',
));

function readMessages() {
  const match = settingsSource.match(
    /var MESSAGES = (\{[\s\S]*?\n  \});\n  var currentLocale/,
  );
  assert.ok(match, 'settings.js must declare MESSAGES');
  const context = createContext({ messages: null });
  new Script(`messages = ${match[1]}`).runInContext(context);
  return context.messages;
}

function formatConnectError(locale, error, detail) {
  const match = settingsSource.match(
    /function connectError\(result\) \{([\s\S]*?)\n  \}\n  function render/,
  );
  assert.ok(match, 'settings.js must declare connectError');
  const context = createContext({
    currentLocale: locale,
    input: { error, detail },
    output: '',
    String,
  });
  new Script(
    `function connectError(result) {${match[1]}\n  }\noutput = connectError(input);`,
  ).runInContext(context);
  return context.output;
}

test('Gmail settings include complete host-driven translations', () => {
  const messages = readMessages();
  assert.deepEqual(Object.keys(messages).sort(), ['en', 'ja', 'ko', 'zh-CN']);
  const keys = Object.keys(messages.en).sort();
  for (const locale of ['zh-CN', 'ja', 'ko']) {
    assert.deepEqual(Object.keys(messages[locale]).sort(), keys, locale);
  }
  assert.match(settingsHtml, /<html lang="en">/);
  assert.match(settingsHtml, /data-i18n="accountTitle"/);
  assert.match(settingsSource, /fetch\('\/app-context'\)/);
  assert.match(settingsSource, /context && result\.context\.locale/);
  assert.match(settingsSource, /hasOwnProperty\.call\(MESSAGES, locale\) \? locale : 'en'/);
  assert.doesNotMatch(settingsSource, /\bnavigator\.(?:language|languages)\b/);
});

test('Gmail settings localize OAuth errors and preserve safe details', () => {
  assert.match(
    formatConnectError('ja', 'EXCHANGE_FAILED', 'invalid_client'),
    /Google トークンの交換に失敗しました/,
  );
  assert.match(
    formatConnectError('ko', 'UNKNOWN', 'callback rejected'),
    /연결하지 못했습니다/,
  );
  assert.match(formatConnectError('ko', 'UNKNOWN', 'callback rejected'), /callback rejected/);
});

test('Gmail settings localization bumps the plugin version', () => {
  assert.equal(manifest.version, '1.1.2');
});
