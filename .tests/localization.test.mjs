import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const locales = ['zh-CN', 'en', 'ja', 'ko'];
const pluginDirs = fs.readdirSync(root)
  .filter((name) => fs.existsSync(path.join(root, name, 'ghost.json')))
  .sort();

// Replace comments with same-width whitespace so line numbers survive: the
// policy below guards runtime code, and a comment explaining it (for example
// "never read navigator.language") must not trip it.
//
// Known limitation (accepted): regular-expression literals are not tracked,
// so a `//` inside a regex (e.g. /https?:\/\//) would start a phantom line
// comment for the scanner. The check stays strictly fail-closed about this —
// the regex never makes a real navigator.language read pass; the worst case
// is the regex's own remainder being scanned as code and falsely flagged,
// which a human can resolve by moving the explanation out of the regex line.
// Strings and template literals ARE tracked because they are ubiquitous in
// plugin code (URLs, HTML templates), unlike regexes.
const blankOut = (segment) => segment.replace(/[^\n]/g, ' ');
const stripJsComments = (source) => {
  let result = '';
  let index = 0;
  let state = 'code';
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (state === 'code') {
      if (char === '/' && next === '/') {
        const end = source.indexOf('\n', index);
        const stop = end === -1 ? source.length : end;
        result += blankOut(source.slice(index, stop));
        index = stop;
      } else if (char === '/' && next === '*') {
        const end = source.indexOf('*/', index + 2);
        const stop = end === -1 ? source.length : end + 2;
        result += blankOut(source.slice(index, stop));
        index = stop;
      } else if (char === "'" || char === '"') {
        state = char;
        result += char;
        index += 1;
      } else if (char === '`') {
        state = '`';
        result += char;
        index += 1;
      } else {
        result += char;
        index += 1;
      }
    } else if (state === "'" || state === '"') {
      result += char;
      if (char === '\\') {
        result += next ?? '';
        index += 2;
      } else {
        if (char === state) state = 'code';
        index += 1;
      }
    } else {
      // Template literal: interpolations may contain comments, so recurse
      // into them instead of skipping wholesale.
      if (char === '\\') {
        result += char + (next ?? '');
        index += 2;
      } else if (char === '`') {
        result += char;
        state = 'code';
        index += 1;
      } else if (char === '$' && next === '{') {
        let depth = 1;
        let stop = index + 2;
        while (stop < source.length && depth > 0) {
          if (source[stop] === '{') depth += 1;
          else if (source[stop] === '}') depth -= 1;
          stop += 1;
        }
        result += '${' + stripJsComments(source.slice(index + 2, stop - 1)) + '}';
        index = stop;
      } else {
        result += char;
        index += 1;
      }
    }
  }
  return result;
};
const stripHtmlComments = (source) =>
  source.replace(/<!--[\s\S]*?(?:-->|$)/g, (segment) => blankOut(segment));

test('all official plugins provide complete host-driven locale resources', () => {
  assert.ok(pluginDirs.length > 0, 'no official plugins found');
  for (const pluginDir of pluginDirs) {
    const manifestPath = path.join(root, pluginDir, 'ghost.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.deepEqual(Object.keys(manifest.locales ?? {}).sort(), [...locales].sort(), pluginDir);
    const expectedTools = (manifest.tools ?? []).map((tool) => tool.name).sort();

    for (const locale of locales) {
      const localePath = path.join(root, pluginDir, manifest.locales[locale]);
      assert.ok(fs.statSync(localePath).size <= 64 * 1024, `${pluginDir}/${locale} is too large`);
      const resource = JSON.parse(fs.readFileSync(localePath, 'utf8'));
      for (const key of ['name', 'description', 'whenToUse']) {
        assert.equal(typeof resource[key], 'string', `${pluginDir}/${locale}.${key}`);
        assert.ok(resource[key].trim(), `${pluginDir}/${locale}.${key} is empty`);
      }
      assert.deepEqual(
        Object.keys(resource.tools ?? {}).sort(),
        expectedTools,
        `${pluginDir}/${locale} tool keys`,
      );
      for (const toolName of expectedTools) {
        assert.ok(
          resource.tools[toolName].description.trim(),
          `${pluginDir}/${locale}.tools.${toolName}.description`,
        );
      }
    }
  }
});

test('plugins never infer language from the browser or operating system', () => {
  for (const pluginDir of pluginDirs) {
    const files = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.endsWith('.cindy')) continue;
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(absolute);
        else if (/\.(?:html|js|cjs|mjs)$/.test(entry.name)) files.push(absolute);
      }
    };
    walk(path.join(root, pluginDir));
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      const codeOnly = file.endsWith('.html')
        ? stripHtmlComments(source)
        : stripJsComments(source);
      assert.doesNotMatch(
        codeOnly,
        /\bnavigator\.(?:language|languages)\b/,
        path.relative(root, file),
      );
    }
  }
});

test('comment stripping keeps self-policing comments legal and real reads illegal', () => {
  assert.doesNotMatch(
    stripJsComments('// 绝不读 navigator.language\nconst lang = getLocale();'),
    /\bnavigator\.(?:language|languages)\b/,
  );
  assert.doesNotMatch(
    stripJsComments('/* navigator.languages is off-limits */'),
    /\bnavigator\.(?:language|languages)\b/,
  );
  assert.match(
    stripJsComments('const lang = navigator.language; // no comment saves this'),
    /\bnavigator\.(?:language|languages)\b/,
  );
  assert.match(
    stripJsComments('const langs = [...navigator.languages];'),
    /\bnavigator\.(?:language|languages)\b/,
  );
  assert.match(
    stripJsComments('const s = `prefix ${navigator.language}`;'),
    /\bnavigator\.(?:language|languages)\b/,
  );
  assert.doesNotMatch(
    stripJsComments('const s = `prefix ${/* navigator.language */ other}`;'),
    /\bnavigator\.(?:language|languages)\b/,
  );
  assert.doesNotMatch(
    stripJsComments('const url = "https://example.com/a//x"; // navigator.language'),
    /\bnavigator\.(?:language|languages)\b/,
  );
  assert.doesNotMatch(
    stripHtmlComments('<!-- never read navigator.language --><p>hi</p>'),
    /\bnavigator\.(?:language|languages)\b/,
  );
});
