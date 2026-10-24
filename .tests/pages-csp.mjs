/**
 * Host page rules for panel and settings documents.
 *
 * A plugin's panel and settings page are served by the Desktop from the
 * `cindy-ghost://<id>/` origin, with the scheme registered as
 *   { standard: true, secure: true, supportFetchAPI: true,
 *     bypassCSP: false, corsEnabled: false }
 * and every text/html response carrying this header:
 *
 *   default-src 'self'; style-src 'self' 'unsafe-inline';
 *   img-src 'self' data: blob: https:; media-src 'self' data: blob:
 *
 * Consequences this module enforces on the packaged documents:
 *   - script-src falls back to `default-src 'self'`, so an inline <script>,
 *     an on* attribute or a `javascript:` URL is blocked at runtime;
 *   - style-src allows inline CSS, so <style> blocks and style attributes are
 *     fine — this module does not flag them;
 *   - font-src falls back to 'self', so a remote or data: @font-face is blocked;
 *   - connect-src falls back to 'self', so a page may not fetch another
 *     origin: network work belongs to main.js through `cindy.fetch`, where the
 *     Host applies `network.hosts`;
 *   - frame-src / form-action / base-uri fall back to 'self', so no
 *     third-party iframe, remote form target or <base> override;
 *   - the origin is per-plugin and `corsEnabled: false`, so a reference may not
 *     climb out of the plugin directory (the Host answers 403 for that) and a
 *     wildcard `postMessage(..., '*')` target is wrong for a same-origin page.
 *
 * The scheme/CSP strings above are copied from the packaged Desktop build
 * (Cindy 0.1.115: `GHOST_HTML_CSP` and `cindyGhostSchemePrivilege`). The tests
 * read the policy from HOST_PAGE_CSP, so a future Host change is a one-line
 * update here rather than a rewrite of the assertions.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep, isAbsolute } from 'node:path';

export const HOST_PAGE_CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob: https:; media-src 'self' data: blob:";

export const HOST_PAGE_SCHEME_PRIVILEGES = {
  standard: true,
  secure: true,
  supportFetchAPI: true,
  bypassCSP: false,
  corsEnabled: false
};

/** Parse a CSP string into directive -> source list (lower-cased keys). */
export function parseCsp(policy) {
  const map = new Map();
  for (const part of policy.split(';')) {
    const bits = part.trim().split(/\s+/).filter(Boolean);
    if (bits.length === 0) continue;
    map.set(bits[0].toLowerCase(), bits.slice(1));
  }
  return map;
}

/** The sources a fetch type effectively gets, following the default-src fallback. */
export function effectiveSources(map, directive) {
  return map.get(directive) || map.get('default-src') || [];
}

/** True when the effective policy for `directive` contains `token` ('self', 'unsafe-inline', ...). */
export function allows(map, directive, token) {
  return effectiveSources(map, directive).includes(token);
}

const REMOTE_IMAGE = /^https:\/\//i;
const DATA_OR_BLOB = /^(?:data|blob):/i;

function stripComments(source) {
  // Block comments first, then line comments that are not part of a URL scheme.
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
  return withoutBlocks.replace(/(^|[^:\w])\/\/[^\n]*/g, (match, prefix) => prefix);
}

function tagAttributes(html) {
  const tags = [];
  const re = /<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let match;
  while ((match = re.exec(html)) !== null) {
    tags.push({ name: match[1].toLowerCase(), attrs: match[2], raw: match[0], index: match.index });
  }
  return tags;
}

function attrValue(attrs, name) {
  const quoted = new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', 'i').exec(attrs);
  if (quoted) return quoted[1] !== undefined ? quoted[1] : quoted[2];
  const bare = new RegExp('\\b' + name + '\\s*=\\s*([^\\s>]+)', 'i').exec(attrs);
  return bare ? bare[1] : null;
}

/** Where a reference points, relative to the page's cindy-ghost://<id>/ origin. */
export function classifyReference(value, ghostId) {
  const raw = String(value || '').trim();
  if (raw === '') return 'empty';
  if (/^javascript:/i.test(raw)) return 'javascript';
  if (DATA_OR_BLOB.test(raw)) return 'data-or-blob';
  if (/^https:\/\//i.test(raw)) return 'remote-https';
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^cindy-ghost:\/\//i.test(raw)) return 'other-scheme';
  if (/^cindy-ghost:\/\//i.test(raw)) {
    const host = raw.slice('cindy-ghost://'.length).split('/')[0];
    return host === ghostId ? 'same-origin' : 'other-origin';
  }
  if (raw.startsWith('//')) return 'other-origin';
  return 'same-origin';
}

/** True when a same-origin reference stays inside the plugin directory. */
export function staysInsideDirectory(dir, reference) {
  const clean = String(reference).split('#')[0].split('?')[0];
  if (isAbsolute(clean) && !/^cindy-ghost:/i.test(clean)) return false;
  const withoutScheme = clean.replace(/^cindy-ghost:\/\/[^/]+\/?/i, '');
  const target = resolve(dir, withoutScheme.replace(/^\//, ''));
  return target === resolve(dir) || target.startsWith(resolve(dir) + sep);
}

function collectUrls(css) {
  const urls = [];
  const re = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]+))\s*\)/gi;
  let match;
  while ((match = re.exec(css)) !== null) {
    urls.push(match[1] !== undefined ? match[1] : match[2] !== undefined ? match[2] : match[3]);
  }
  return urls;
}

/**
 * Audit one packaged document.
 *
 * @param {object} options
 * @param {string} options.dir       absolute path of the plugin directory
 * @param {string} options.ghostId   plugin id, i.e. the Host of cindy-ghost://<id>/
 * @param {string} options.htmlPath  document path relative to `dir`
 * @param {string} [options.htmlOverride] audit this source instead of reading the file
 * @returns {{violations: string[], scripts: string[], policy: string}}
 */
export function auditPage(options) {
  const dir = resolve(options.dir);
  const ghostId = options.ghostId;
  const htmlPath = options.htmlPath;
  const policy = options.policy || HOST_PAGE_CSP;
  const csp = parseCsp(policy);
  const violations = [];
  const scripts = [];
  const stylesheets = [];

  let html = options.htmlOverride;
  if (html === undefined) {
    const file = join(dir, htmlPath);
    if (!existsSync(file)) {
      return { violations: ['document is missing from the package: ' + htmlPath], scripts, policy };
    }
    html = readFileSync(file, 'utf8');
  }

  const pageOrigin = 'cindy-ghost://' + ghostId + '/';

  // 1. Inline <script> is blocked: script-src falls back to 'self', which has no
  //    'unsafe-inline'. Same for on* attributes and javascript: URLs.
  if (!allows(csp, 'script-src', "'unsafe-inline'")) {
    const re = /<script\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = re.exec(html)) !== null) {
      const attrs = match[1];
      const body = match[2].trim();
      if (attrValue(attrs, 'src') === null && body !== '') {
        violations.push(
          'inline <script> is blocked by script-src ' + JSON.stringify(effectiveSources(csp, 'script-src')) +
            '; move the code to a same-origin file and reference it with src'
        );
      }
    }

    for (const tag of tagAttributes(html)) {
      if (/\son[a-z]+\s*=/i.test(tag.raw)) {
        violations.push('inline event handler on <' + tag.name + '> is blocked by script-src without \'unsafe-inline\'');
      }
    }

    if (/javascript:/i.test(html)) {
      violations.push('javascript: URL is blocked by script-src without \'unsafe-inline\'');
    }
  }

  // 2. External scripts and stylesheets must be same-origin, inside the package,
  //    and present on disk — the Host 403s a path that escapes the plugin dir.
  for (const tag of tagAttributes(html)) {
    const refAttr = tag.name === 'script' ? 'src' : tag.name === 'link' ? 'href' : null;
    if (refAttr === null) continue;
    if (tag.name === 'link') {
      const rel = (attrValue(tag.attrs, 'rel') || '').toLowerCase();
      if (!rel.includes('stylesheet')) continue;
    }
    const value = attrValue(tag.attrs, refAttr);
    if (value === null) continue;
    const kind = classifyReference(value, ghostId);
    if (kind === 'other-origin' || kind === 'remote-https' || kind === 'other-scheme') {
      violations.push('<' + tag.name + '> loads a cross-origin URL (' + value + '); the page origin is ' + pageOrigin);
    } else if (kind === 'data-or-blob') {
      violations.push('<' + tag.name + '> loads ' + kind + ' content (' + value + '); inline script sources are blocked by script-src');
    } else if (kind === 'same-origin') {
      if (!staysInsideDirectory(dir, value)) {
        violations.push('<' + tag.name + '> reference escapes the plugin directory: ' + value);
        continue;
      }
      const target = join(dir, value.replace(/^cindy-ghost:\/\/[^/]+\/?/i, '').replace(/^\//, '').split(/[?#]/)[0]);
      if (!existsSync(target) || !statSync(target).isFile()) {
        violations.push('<' + tag.name + '> reference is not in the package: ' + value);
        continue;
      }
      if (tag.name === 'script') scripts.push(target);
      if (tag.name === 'link') stylesheets.push(target);
    }
  }

  // 3. CSS is allowed (style-src 'unsafe-inline'), but a remote or data: @import
  //    or @font-face is not: style-src and font-src fall back to 'self'. Linked
  //    stylesheets are audited as well — a <link href="panel.css"> is a second
  //    document the policy applies to, and skipping it would leave a hole.
  const auditCss = (css, label) => {
    const imports = /@import\s+(?:url\()?\s*(?:"([^"]+)"|'([^']+)'|([^)\s;]+))/gi;
    let importMatch;
    while ((importMatch = imports.exec(css)) !== null) {
      const url = importMatch[1] || importMatch[2] || importMatch[3] || '';
      const kind = classifyReference(url, ghostId);
      if (kind !== 'same-origin') {
        violations.push(label + ' @import pulls a stylesheet from ' + kind + ' (' + url + '); style-src is ' + JSON.stringify(effectiveSources(csp, 'style-src')));
      }
    }
    const fontFaces = /@font-face\s*\{([^}]*)\}/gi;
    let fontMatch;
    while ((fontMatch = fontFaces.exec(css)) !== null) {
      for (const url of collectUrls(fontMatch[1])) {
        if (classifyReference(url, ghostId) !== 'same-origin') {
          violations.push(label + ' @font-face loads a font from a non-same-origin URL (' + url + '); font-src falls back to ' + JSON.stringify(effectiveSources(csp, 'font-src')));
        }
      }
    }
  };

  const styleBlocks = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let styleMatch;
  let styleIndex = 0;
  while ((styleMatch = styleBlocks.exec(html)) !== null) {
    styleIndex += 1;
    auditCss(styleMatch[1], 'inline <style> #' + styleIndex + ':');
  }
  for (const stylesheet of stylesheets) {
    auditCss(readFileSync(stylesheet, 'utf8'), stylesheet.slice(dir.length + 1) + ':');
  }

  // 4. Images: img-src allows 'self', data:, blob: and https:. Anything else is blocked.
  for (const tag of tagAttributes(html)) {
    if (tag.name !== 'img' && tag.name !== 'source') continue;
    const value = attrValue(tag.attrs, 'src');
    if (value === null) continue;
    const kind = classifyReference(value, ghostId);
    const allowedByPolicy =
      kind === 'same-origin' || kind === 'data-or-blob' || (kind === 'remote-https' && REMOTE_IMAGE.test(value));
    if (!allowedByPolicy) {
      violations.push('<' + tag.name + '> image is not covered by img-src ' + JSON.stringify(effectiveSources(csp, 'img-src')) + ': ' + value);
    } else if (kind === 'same-origin') {
      const target = join(dir, value.replace(/^cindy-ghost:\/\/[^/]+\/?/i, '').split(/[?#]/)[0]);
      if (!existsSync(target)) violations.push('<' + tag.name + '> image is not in the package: ' + value);
    }
  }

  // 5. frame-src / form-action / base-uri fall back to 'self'.
  for (const tag of tagAttributes(html)) {
    if (tag.name === 'iframe' || tag.name === 'frame' || tag.name === 'object' || tag.name === 'embed') {
      const value = attrValue(tag.attrs, 'src') || attrValue(tag.attrs, 'data') || '';
      if (classifyReference(value, ghostId) !== 'same-origin') {
        violations.push('<' + tag.name + '> embeds a non-same-origin document (' + value + '); frame-src falls back to \'self\'');
      }
    }
    if (tag.name === 'form') {
      const action = attrValue(tag.attrs, 'action');
      if (action !== null && classifyReference(action, ghostId) !== 'same-origin') {
        violations.push('<form> targets a non-same-origin action (' + action + '); form-action falls back to \'self\'');
      }
    }
    if (tag.name === 'base') {
      violations.push('<base> would override the page origin; base-uri falls back to \'self\'');
    }
  }

  // 6. Page code: no eval-family APIs, no cross-origin network call, no Host
  //    bridge, no wildcard postMessage target.
  for (const script of scripts) {
    const code = stripComments(readFileSync(script, 'utf8'));
    const name = script.slice(dir.length + 1);
    if (/\beval\s*\(/.test(code) || /\bnew\s+Function\s*\(/.test(code)) {
      violations.push(name + ' uses eval/new Function, which script-src without \'unsafe-eval\' blocks');
    }
    if (/\bdocument\s*\.\s*write\s*\(/.test(code)) {
      violations.push(name + ' uses document.write');
    }
    const calls = [
      { re: /\bfetch\s*\(\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`)/g, what: 'fetch' },
      { re: /\bEventSource\s*\(\s*(?:"([^"]+)"|'([^']+)')/g, what: 'EventSource' },
      { re: /\bnew\s+WebSocket\s*\(\s*(?:"([^"]+)"|'([^']+)')/g, what: 'WebSocket' },
      { re: /\bimportScripts\s*\(\s*(?:"([^"]+)"|'([^']+)')/g, what: 'importScripts' }
    ];
    for (const { re, what } of calls) {
      let match;
      while ((match = re.exec(code)) !== null) {
        const url = match[1] || match[2] || match[3] || '';
        // A literal that is concatenated (`'cindy-ghost://' + GHOST_ID`) cannot be
        // resolved statically; it is not a cross-origin URL, so skip it rather
        // than report a false violation.
        const afterLiteral = code.slice(re.lastIndex, re.lastIndex + 16);
        const dynamic = /\$\{/.test(url) || /^\s*\+/.test(afterLiteral) || /^[a-z][a-z0-9+.-]*:\/\/*$/i.test(url);
        if (dynamic) continue;
        const kind = classifyReference(url, ghostId);
        if (kind !== 'same-origin' && kind !== 'empty') {
          violations.push(name + ' calls ' + what + ' on ' + kind + ' (' + url + '); connect-src falls back to \'self\' — use cindy.fetch in main.js');
        }
      }
    }
    if (/\bcindy\s*\.\s*(?:send|fetch|node|mcp|fs|kv|onHostMessage)\b/.test(code)) {
      violations.push(name + ' uses the Host runtime bridge; a panel or settings page has no bridge to the Host');
    }
    if (/postMessage\s*\([^)]*,\s*['"]\*['"]\s*\)/.test(code)) {
      violations.push(name + ' posts a message to a wildcard target; the page is same-origin only');
    }
  }

  return { violations, scripts, policy };
}

/** Convenience for tests: the packaged documents of a plugin from its manifest. */
export function documentsFromManifest(dir) {
  const manifest = JSON.parse(readFileSync(join(dir, 'ghost.json'), 'utf8'));
  const pages = [];
  if (manifest.panel && manifest.panel.html) pages.push(manifest.panel.html);
  if (manifest.settingsHtml) pages.push(manifest.settingsHtml);
  return { manifest, pages };
}

