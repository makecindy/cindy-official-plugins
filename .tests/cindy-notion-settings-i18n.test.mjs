import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pluginRoot = new URL('../cindy-notion/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('ghost.json', pluginRoot), 'utf8'));
const mainSource = readFileSync(new URL('main.js', pluginRoot), 'utf8');
const settingsHtml = readFileSync(new URL('settings.html', pluginRoot), 'utf8');
const settingsSource = readFileSync(new URL('settings.js', pluginRoot), 'utf8');

test('Notion settings follow the host locale with English fallback', () => {
  assert.equal(manifest.version, '1.3.3');
  assert.match(settingsHtml, /<html lang="en">/);
  assert.match(settingsSource, /fetch\('\/app-context'\)/);
  assert.match(settingsSource, /currentLocale = 'en'/);
  assert.match(settingsSource, /document\.documentElement\.lang = currentLocale/);
  assert.doesNotMatch(settingsSource, /\bnavigator\.(?:language|languages)\b/);
  for (const locale of ['en', 'zh-CN', 'ja', 'ko']) {
    const key = locale.includes('-') ? `'${locale}'` : locale;
    assert.match(settingsSource, new RegExp(`${key}: \\{`));
  }
});

test('Notion localizes guided setup, dynamic state, and runtime notifications', () => {
  for (const attribute of ['data-i18n', 'data-i18n-placeholder', 'data-i18n-aria-label']) {
    assert.match(settingsHtml, new RegExp(attribute));
  }
  for (const key of [
    'notConnected',
    'visibleMeta',
    'pageCheckFailed',
    'replaceTokenPlaceholder',
    'savingToken',
    'checkingPages',
    'validVisibilityFailed',
    'connectedSuccess',
    'clearFailed',
  ]) {
    assert.match(settingsSource, new RegExp(`t\\('${key}'`));
  }
  assert.match(settingsSource, /locale: currentLocale/);
  assert.match(mainSource, /SETTINGS_MESSAGES/);
  assert.match(mainSource, /settingsMessage\(message\.locale, 'failed'\)/);
  assert.match(mainSource, /settingsMessage\(message\.locale, 'connected'/);
});
