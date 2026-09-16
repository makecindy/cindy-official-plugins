'use strict';
// One policy implementation shared by the sandbox, Node bridge and extension.
(function (root) {
  const READ = ['tabs', 'navigate', 'snapshot', 'extract', 'text', 'content'];
  const EXTRACT_ATTRIBUTES = ['href','src','datetime','title','alt','aria-label','role'];
  const INTERACT = ['click', 'type', 'press', 'select', 'hover', 'scroll'];
  const defaults = () => ({ read: { block: [] }, interact: { allow: ['*'], block: [] } });
  function normalizeHost(value) {
    if (typeof value !== 'string') throw new Error('Enter a domain, for example example.test.');
    const text = value.trim().toLowerCase();
    const exact = text.startsWith('=');
    const raw = exact ? text.slice(1) : text.replace(/^\*\./, '');
    if (!raw || /[\s/@:?#\\]/.test(raw)) throw new Error('Enter a domain only, without a URL, port or path.');
    const host = new URL('https://' + raw).hostname;
    if (host !== raw && !/[^\x00-\x7f]/.test(raw)) throw new Error('Invalid domain.');
    if (host.length > 253 || !host.includes('.') || host.endsWith('.') ||
        host.split('.').some(p => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p))) throw new Error('Invalid domain.');
    if (isLocal(host)) throw new Error('Local and private addresses are not supported.');
    return (exact ? '=' : '') + host;
  }
  function isLocal(host) {
    // IPv6 literals are deliberately unsupported, including mapped loopback/private addresses.
    if (host.includes(':') || host.startsWith('[') || host === 'localhost' || host.endsWith('.localhost') ||
        host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')) return true;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const [a,b] = host.split('.').map(Number);
      return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
    }
    return false;
  }
  function matches(host, pattern) {
    return pattern === '*' || (pattern.startsWith('=') ? host === pattern.slice(1) : host === pattern || host.endsWith('.' + pattern));
  }
  function normalizePolicy(p) {
    if (!p || !p.read || !p.interact) throw new Error('Invalid policy. Reload settings before saving.');
    const list = (items, wildcard = false) => {
      if (!Array.isArray(items) || items.length > 200) throw new Error('Each policy list must contain at most 200 domains.');
      return [...new Set(items.map(h => wildcard && h === '*' ? '*' : normalizeHost(h)))];
    };
    return { read: { block: list(p.read.block) }, interact: { allow: list(p.interact.allow, true), block: list(p.interact.block || []) } };
  }
  function check(policy, action, url) {
    const deny = (error, message, host) => ({ ok: false, error, message, host, execution: 'not_executed' });
    if (!READ.includes(action) && !INTERACT.includes(action)) return deny('INVALID_ACTION', 'Choose a supported browser action.');
    if (action === 'tabs') return { ok: true };
    let u;
    try { u = new URL(url); } catch { return deny('INVALID_URL', 'Provide a full HTTP or HTTPS URL.'); }
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || isLocal(u.hostname.replace(/\.$/, ''))) {
      return deny('URL_NOT_ALLOWED', 'Only public HTTP/HTTPS URLs without embedded credentials are supported.');
    }
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    if (policy.read.block.some(p => matches(host, p))) return deny('READ_BLOCKED', 'This site is on the read block list. Review the site policy in plugin settings.', host);
    if (INTERACT.includes(action) && (!policy.interact.allow.some(p => matches(host, p)) || policy.interact.block.some(p => matches(host, p)))) {
      return deny('INTERACT_NOT_ALLOWED', 'Ask the user to allow this exact site before clicking, typing or searching.', host);
    }
    return { ok: true, host };
  }
  function validate(action, payload = {}) {
    if (!READ.includes(action) && !INTERACT.includes(action)) throw new Error('Unsupported browser action.');
    if (action !== 'tabs' && (typeof payload.url !== 'string' || payload.url.length > 8192)) throw new Error('Provide a full URL of at most 8192 characters.');
    if (payload.browser != null && (typeof payload.browser !== 'string' || payload.browser.length > 128)) throw new Error('Invalid browser connection id.');
    if (payload.limit != null && (!Number.isInteger(payload.limit) || payload.limit < 1 || payload.limit > 100)) throw new Error('Limit must be 1–100.');
    if (payload.maxChars != null && (!Number.isInteger(payload.maxChars) || payload.maxChars < 256 || payload.maxChars > 30000)) throw new Error('maxChars must be 256–30000.');
    if (payload.waitMs != null && (!Number.isInteger(payload.waitMs) || payload.waitMs < 0 || payload.waitMs > 15000)) throw new Error('waitMs must be 0–15000.');
    if (payload.host != null) normalizeHost(payload.host);
    for (const key of ['selector', 'from', 'ref', 'text', 'key', 'waitFor', 'emptySelector', 'after']) if (payload[key] != null && (typeof payload[key] !== 'string' || payload[key].length > (key === 'text' ? 16000 : 2000))) throw new Error('Invalid ' + key + '.');
    if (['click','type','select','hover'].includes(action) && !payload.ref && !payload.selector) throw new Error('Provide a fresh snapshot ref or CSS selector.');
    if (action === 'type' && typeof payload.text !== 'string') throw new Error('Typing requires text (an empty string clears the field).');
    if (action === 'press' && !payload.key) throw new Error('Provide the key to press.');
    if (action === 'select' && (!Array.isArray(payload.values) || payload.values.length > 100 || payload.values.some(v => typeof v !== 'string' || v.length > 2000))) throw new Error('Provide an array of option values.');
    if (action === 'extract') {
      if (!payload.fields || typeof payload.fields !== 'object' || Array.isArray(payload.fields) || !Object.keys(payload.fields).length || Object.keys(payload.fields).length > 30) throw new Error('Extract requires 1–30 fields.');
      if (Object.keys(payload.fields).some(k => !k || k.length > 32 || /[\x00-\x1f]/.test(k))) throw new Error('Field names must contain 1–32 printable characters.');
      for (const spec of Object.values(payload.fields)) {
        if (typeof spec === 'string' ? !spec || spec.length > 2000 : !spec || typeof spec.selector !== 'string' || !spec.selector || spec.selector.length > 2000 || (spec.attr != null && !EXTRACT_ATTRIBUTES.includes(spec.attr))) throw new Error('Each field needs a CSS selector; attr may only be href, src, datetime, title, alt, aria-label or role.');
      }
      if (payload.after != null && !payload.multiple) throw new Error('after requires multiple records.');
    }
    return payload;
  }
  // Tab and result URLs can carry OAuth codes, reset/magic-link tokens or bearer tokens in the
  // query or the fragment. Anything handed to the model goes through here first.
  const SENSITIVE_KEYS = /^(?:code|access_token|id_token|refresh_token|token|auth|authorization|session|sessionid|sid|state|nonce|password|passwd|pwd|secret|client_secret|api_key|apikey|key|signature|sig|otp|pin|ticket|assertion|saml|sso|reset|invite|verifier|challenge)$/i;
  // Long, whitespace-free, token-shaped values (JWTs, opaque ids) are masked even under an
  // innocuous parameter name. Masking a rare long id is an acceptable loss; leaking a token is not.
  const opaque = value => value.length >= 32 && /^[A-Za-z0-9._~+/=-]+$/.test(value);
  // Password-reset and magic links commonly embed the credential in a path segment
  // (/reset/<token>, #/verify/<token>) rather than a query parameter.
  const CONTEXT_WORDS = new Set(['reset','verify','verification','confirm','confirmation','activate','activation','invite','magic','auth','authenticate','authorize','unlock','recover','recovery','password','passcode','signin','signup','login','callback','redirect','token']);
  // Pages can percent-encode once or repeatedly to shift a credential past an analysis pass, so every
  // judgement below runs on a bounded, repeatedly decoded form instead of the raw string.
  const MAX_DECODE_PASSES = 4;
  function normalizeEncoding(text) {
    let current = text;
    for (let i = 0; i < MAX_DECODE_PASSES; i++) {
      let next;
      try { next = decodeURIComponent(current); } catch { break; }
      if (next === current) break;
      current = next;
    }
    return current;
  }
  const words = text => text.replace(/([a-z0-9])([A-Z])/g,'$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  // Only segments following a credential-context word are masked, so ordinary deep paths
  // (/commit/<sha>, /user/12345, /wiki/long-article-title) keep working.
  const isContext = segment => words(normalizeEncoding(segment)).some(word => CONTEXT_WORDS.has(word));
  // A credential is judged by length alone, on the decoded segment. Charset heuristics are exactly
  // what repeated percent-encoding kept defeating, so a long segment after reset/verify is treated
  // as the credential rather than being pattern-matched.
  const CREDENTIAL_MIN_LENGTH = 16;
  function redactSegments(path) {
    const segments = path.split('/');
    let context = false, changed = false;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (isContext(segment)) { context = true; continue; }
      if (context && normalizeEncoding(segment).length >= CREDENTIAL_MIN_LENGTH) { segments[i] = 'REDACTED'; changed = true; }
    }
    return changed ? segments.join('/') : path;
  }
  function redactUrl(raw) {
    if (typeof raw !== 'string') return raw;
    let u;
    try { u = new URL(raw); } catch { return raw; }
    let changed = false;
    // Page-controlled links can carry Basic Auth credentials as URL userinfo, which no policy
    // check inspects for page-supplied hrefs.
    if (u.username || u.password) { u.username = ''; u.password = ''; changed = true; }
    for (const [key,value] of [...u.searchParams]) {
      if (SENSITIVE_KEYS.test(key) || opaque(normalizeEncoding(value))) { u.searchParams.set(key,'REDACTED'); changed = true; }
    }
    // A fragment carrying key=value data is the classic implicit-flow token carrier, so it is masked
    // whole; the test uses the decoded form so #code%3D... cannot evade it. A route fragment is
    // treated like a path: plain routes (#/home) survive, credential segments after a reset/verify
    // word do not.
    const fragment = u.hash ? u.hash.slice(1) : '';
    if (fragment && normalizeEncoding(fragment).includes('=')) { u.hash = '#REDACTED'; changed = true; }
    else if (fragment) {
      const redacted = redactSegments(fragment);
      if (redacted !== fragment) { u.hash = '#'+redacted; changed = true; }
    }
    const redactedPath = redactSegments(u.pathname);
    if (redactedPath !== u.pathname) { u.pathname = redactedPath; changed = true; }
    return changed ? u.href : raw;
  }
  const api = { READ, INTERACT, defaults, normalizeHost, normalizePolicy, matches, check, validate, redactUrl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MyBrowserPolicy = api;
})(globalThis);
