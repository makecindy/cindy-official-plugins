'use strict';
// One policy implementation shared by the sandbox, Node bridge and extension.
(function (root) {
  const READ = ['tabs', 'navigate', 'snapshot', 'extract', 'text', 'content'];
  const INTERACT = ['click', 'type', 'press', 'select', 'hover', 'scroll'];
  const DEFAULT_BLOCK = ['mail.google.com', 'outlook.com', 'outlook.live.com', 'mail.qq.com', 'mail.163.com',
    '1password.com', 'lastpass.com', 'bitwarden.com', 'accounts.google.com', 'login.microsoftonline.com',
    'appleid.apple.com', 'paypal.com', 'stripe.com', 'alipay.com', 'cmbchina.com', 'icbc.com.cn',
    'bankofamerica.com', 'chase.com', 'coinbase.com', 'binance.com', 'console.aws.amazon.com',
    'console.cloud.google.com', 'portal.azure.com'];
  const defaults = () => ({ read: { block: [...DEFAULT_BLOCK] }, interact: { allow: [], block: [] } });
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
    return pattern.startsWith('=') ? host === pattern.slice(1) : host === pattern || host.endsWith('.' + pattern);
  }
  function normalizePolicy(p) {
    if (!p || !p.read || !p.interact) throw new Error('Invalid policy. Reload settings before saving.');
    const list = (items) => {
      if (!Array.isArray(items) || items.length > 200) throw new Error('Each policy list must contain at most 200 domains.');
      return [...new Set(items.map(normalizeHost))];
    };
    return { read: { block: list(p.read.block) }, interact: { allow: list(p.interact.allow), block: list(p.interact.block || []) } };
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
        if (typeof spec === 'string' ? !spec || spec.length > 2000 : !spec || typeof spec.selector !== 'string' || !spec.selector || spec.selector.length > 2000 || (spec.attr != null && (typeof spec.attr !== 'string' || spec.attr.length > 100))) throw new Error('Each field needs a CSS selector and an optional attribute.');
      }
      if (payload.after != null && !payload.multiple) throw new Error('after requires multiple records.');
    }
    return payload;
  }
  const api = { READ, INTERACT, defaults, normalizeHost, normalizePolicy, matches, check, validate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MyBrowserPolicy = api;
})(globalThis);
