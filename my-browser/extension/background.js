'use strict';
if (typeof importScripts === 'function') importScripts('policy.js','network-guard.js');
// A lexical `const chrome` masks Chromium's lazy API initialization; use a var alias.
var chrome = globalThis.browser || globalThis.chrome;
const P = globalThis.MyBrowserPolicy;
const network = globalThis.MyBrowserNetwork.create(chrome);
const VERSION = chrome.runtime.getManifest().version;
let bridge = null;
let running = false;
// Requested-URL aliases survive redirects, failed loads and user focus. Only created tabs consume the opening budget.
const owned = new Map();
const canonical = url => new URL(url).href;
// Safari versions without session storage keep the ledger in memory; never persist tab ids across restarts.
const memory = {};
const sessionStore = chrome.storage.session || {async get(key) {return {[key]:memory[key]};},async set(values) {Object.assign(memory,values);}};
let clientId;
const family = /Edg\//.test(navigator.userAgent) ? 'edge' : /Safari\//.test(navigator.userAgent) && !/Chrom(?:e|ium)\//.test(navigator.userAgent) ? 'safari' : 'chrome';
const restore = Promise.all([
  sessionStore.get('ownedTabs').then(({ownedTabs}) => {for (const [url,rec] of ownedTabs || []) owned.set(canonical(url),{created:true,...rec});}),
  chrome.storage.local.get('clientId').then(async value => {clientId=value.clientId || crypto.randomUUID(); if (!value.clientId) await chrome.storage.local.set({clientId});})
]);
const sleep = ms => new Promise(r => setTimeout(r,ms));
const fail = (error,message,execution = 'not_executed') => ({ok:false,error,message,execution});
async function remember() { await sessionStore.set({ownedTabs:[...owned]}); }
async function connection(state) {
  await sessionStore.set({connection:{...state,version:VERSION,browser:family,clientId}});
  await chrome.action.setBadgeText({text:state.connected ? '' : '!'});
  await chrome.action.setBadgeBackgroundColor({color:state.connected ? '#287ad7' : '#b87820'});
}
async function fetchJSON(base,path,session,body,timeout = 5000) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(),timeout);
  try {
    const response = await fetch(base+path,{method:body === undefined ? 'GET' : 'POST',
      headers:{'X-My-Browser-Extension':chrome.runtime.id,'X-My-Browser-Origin':chrome.runtime.getURL('').replace(/\/$/,''),'X-My-Browser-Client':clientId,'X-My-Browser-Family':family,'X-My-Browser-Version':VERSION,...(session ? {'X-My-Browser-Session':session} : {}),...(body === undefined ? {} : {'Content-Type':'application/json'})},
      ...(body === undefined ? {} : {body:JSON.stringify(body)}),signal:controller.signal});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'BRIDGE_REQUEST_FAILED');
    return data;
  } finally { clearTimeout(timer); }
}
async function discover() {
  await restore;
  if (bridge) return bridge;
  let diagnostic;
  for (let port = 18810; port <= 18819; port++) {
    const base = 'http://127.0.0.1:'+port;
    try {
      const r = await fetchJSON(base,'/health',null,undefined,450);
      if (r.plugin !== 'my-browser' || r.protocol !== 3 || r.extensionId !== chrome.runtime.id) continue;
      if (r.version !== VERSION) {diagnostic='Update this browser extension to match Cindy v'+r.version+'.'; continue;}
      if (r.pairing_required) {diagnostic='Confirm this browser connection in My Browser settings in Cindy.'; continue;}
      bridge = {base,session:r.session};
      await connection({connected:true,port});
      return bridge;
    } catch { /* Other/closed ports are not our bridge. Never accept a generic 200. */ }
  }
  await connection({connected:false,message:diagnostic || 'Open My Browser settings in Cindy, or call browser_status. Reload this extension after updating Cindy’s plugin.'});
  return null;
}
async function release(tabId) {
  for (const [url,rec] of owned) if (rec.id === tabId) owned.delete(url);
  await remember();
}
async function getTab(id) {
  try {return await chrome.tabs.get(id);} catch {
    // API failure is not proof of closure. Never discard a live tab's alias on an access error.
    if ((await chrome.tabs.query({})).some(tab => tab.id === id)) throw new Error('TAB_ACCESS_FAILED');
    return null;
  }
}
async function closeOwned(url) {
  const rec = owned.get(url); if (!rec) return true;
  const tab = await getTab(rec.id);
  if (tab) {
    // Keep protected tabs counted. Deleting only the ledger entry made the old three-tab limit illusory.
    if (!rec.created || rec.claimed || tab.active || tab.url !== rec.actualUrl) return false;
    try {await chrome.tabs.remove(rec.id);} catch {return false;}
  }
  owned.delete(url); await remember(); return true;
}
async function cleanup() {
  await restore;
  for (const [url,rec] of [...owned]) if (Date.now()-rec.used > 600000) {
    if (!rec.created) {owned.delete(url); await remember();}
    else await closeOwned(url);
  }
}
chrome.tabs.onRemoved.addListener(id => { restore.then(() => release(id)); });
chrome.tabs.onActivated.addListener(({tabId}) => { restore.then(async () => {
  for (const rec of owned.values()) if (rec.id === tabId) rec.claimed = true;
  await remember();
}); });
async function waitForLoad(id) {
  const end = Date.now()+15000;
  while (Date.now()<end) {
    const tab = await chrome.tabs.get(id);
    if (tab.status === 'complete') { await sleep(250); return chrome.tabs.get(id); }
    await sleep(150);
  }
  throw new Error('PAGE_LOAD_TIMEOUT');
}
async function ensureTab(url,policy,action,onNavigate = () => {}) {
  await restore;
  url = canonical(url);
  let rec = owned.get(url), tab;
  if (rec) {
    tab = await getTab(rec.id);
    if (!tab) {owned.delete(url); await remember(); rec = null;}
    else if ((!rec.loading || rec.claimed) && tab.url !== rec.actualUrl) throw new Error('PAGE_CHANGED');
  }
  if (!rec) {
    const tabs = await chrome.tabs.query({});
    tab = tabs.filter(t => t.url === url || t.pendingUrl === url).sort((a,b) => Number(b.active)-Number(a.active))[0];
    const existing = !!tab;
    if (!existing) {
      if (P.INTERACT.includes(action)) throw new Error('PAGE_NOT_OPEN');
      const createdCount = () => [...owned.values()].filter(r => r.created).length;
      for (const [key,r] of [...owned].sort((a,b) => a[1].used-b[1].used)) {
        if (createdCount() < 3) break;
        if (r.created) await closeOwned(key);
      }
      if (createdCount() >= 3) throw new Error('TAB_LIMIT');
      onNavigate(); // Even a rejected browser response cannot prove the request never started.
      tab = await chrome.tabs.create({url,active:false});
    }
    rec = {id:tab.id,actualUrl:tab.url || url,created:!existing,claimed:existing || !!tab.active,loading:!existing || tab.status !== 'complete',used:Date.now()};
    owned.set(url,rec); await remember();
  }
  rec.used = Date.now(); await remember();
  // A timeout retains this same tab and pending request alias; the next read cannot create another.
  const loaded = rec.loading || tab.status !== 'complete' ? await waitForLoad(tab.id) : tab;
  rec.actualUrl = loaded.url; rec.loading = false; await remember();
  const gate = P.check(policy,action,loaded.url);
  if (!gate.ok) throw new Error('REDIRECT_BLOCKED');
  return loaded;
}

// Runs in the extension's ISOLATED world. All data is passed explicitly; refs are a Map
// of real Elements, not attributes a hostile page could overwrite or forge.
async function pageOperation(job) {
  const fail = (error,message,execution = 'not_executed') => ({ok:false,error,message,execution});
  // The exact target URL comes from the worker rather than an executeScript argument: a very long URL
  // passed that way never settles, while comparing a capped prefix would accept a same-document
  // navigation to a neighbouring route. Full identity is required here.
  const expectedUrl = await new Promise(resolve => {
    try { chrome.runtime.sendMessage({type:'my-browser-target',id:job.id}, value => resolve(typeof value === 'string' ? value : null)); }
    catch { resolve(null); }
  });
  if (typeof expectedUrl !== 'string' || location.href !== expectedUrl) return fail('PAGE_CHANGED','The page navigated. Read it again before acting.');
  const a = job.payload;
  const action = job.action;
  const TITLE_MAX = 300, LINK_URL_HARD_MAX = 8192, PAGE_LINKS_BUDGET = 200000;
  const visible = el => {
    const style = getComputedStyle(el); const r = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && !!(r.width || r.height);
  };
  const SENSITIVE_AUTOCOMPLETE = new Set(['one-time-code','cc-number','cc-csc','cc-exp','cc-exp-month','cc-exp-year','current-password','new-password']);
  // Checkout and OTP markup often omits standard autocomplete and names the field instead, so the
  // boundary is enforced conservatively from the element's own naming as well.
  const SENSITIVE_NAMES = new Set(['password','passwd','pwd','pass','card','cardnumber','ccnumber','ccnum','creditcard','debitcard','cvv','cvv2','cvc','cvc2','csc','cid','securitycode','otp','totp','hotp','mfa','2fa','passcode','pin','verificationcode','verifycode','activationcode','onetimecode']);
  const named = el => [el.getAttribute('name'),el.id,el.getAttribute('placeholder'),el.getAttribute('aria-label'),el.getAttribute('data-testid')]
    .filter(Boolean).join(' ').replace(/([a-z0-9])([A-Z])/g,'$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  // autocomplete is a space-separated token list (e.g. "section-checkout billing cc-number"), so
  // exact attribute matching would let standard checkout and OTP fields through into refs and acts.
  // Only form-like elements are judged by naming: a link or button labelled "apply gift card" is
  // not a credential field, and hiding it would break legitimate interaction. Editability is taken
  // from the platform (contenteditable="", "plaintext-only" and inherited editing all count), not
  // from a literal attribute value, so the sensitivity check and the type branch agree.
  // A nested editable region carries its meaning from the editing host that names it. The whole
  // ancestor chain is walked: stopping at the nearest [contenteditable] would let an inner unnamed
  // region or a contenteditable="false" node mask an outer host named like a credential.
  const sensitive = el => {
    if (el.matches('input[type=password],input[type=hidden]')) return true;
    if ((el.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/).some(token => SENSITIVE_AUTOCOMPLETE.has(token))) return true;
    for (let node = el; node && node.nodeType === Node.ELEMENT_NODE; node = node.parentElement) {
      const editable = !!node.isContentEditable || node.matches('input,textarea,select');
      if (editable && named(node).some(token => SENSITIVE_NAMES.has(token))) return true;
    }
    return false;
  };
  // A page can hold an OTP, card number or password inside a contenteditable region. Those elements
  // are excluded from refs, extract and text.
  const TEXT_SCOPE = 'input,textarea,select,[contenteditable],[role=textbox]';
  // Rendered-text extraction that never touches the live DOM: removing and re-inserting nodes fires
  // custom element lifecycle callbacks and MutationObserver, which would make a plain read mutate the
  // page. Rendering is approximated by skipping non-rendered and sensitive subtrees.
  const NON_RENDERED = new Set(['SCRIPT','STYLE','TEMPLATE','NOSCRIPT','HEAD','TITLE','META','LINK']);
  const BLOCK_TAGS = new Set(['ADDRESS','ARTICLE','ASIDE','BLOCKQUOTE','DD','DIV','DL','DT','FIELDSET','FIGCAPTION','FIGURE','FOOTER','FORM','H1','H2','H3','H4','H5','H6','HEADER','HR','LI','MAIN','NAV','OL','P','PRE','SECTION','TABLE','TBODY','TFOOT','THEAD','TR','UL']);
  // One conservative notion of "not rendered", instead of chasing properties one at a time: a subtree
  // is not rendered when the element or an ancestor has display:none, or content-visibility hides or
  // skips its contents. display:contents is deliberately not treated as hidden, because such a
  // wrapper has no box of its own while its children still render.
  const ownSuppressed = node => {
    const style = getComputedStyle(node);
    if (style.display === 'none') return true;
    if (style.contentVisibility === 'hidden') return true;
    // content-visibility:auto skips layout for off-screen content. innerText is the browser's own
    // rendering-aware oracle: content that has text but renders none of it is skipped. Reading it
    // only for auto/hidden elements keeps the cost bounded, and no newer API is involved.
    if (style.contentVisibility === 'auto' && !node.innerText && node.textContent) return true;
    return false;
  };
  const notRendered = el => {
    for (let node = el; node && node.nodeType === Node.ELEMENT_NODE; node = node.parentElement) if (ownSuppressed(node)) return true;
    return false;
  };
  function readableText(root,limit) {
    if (!root.querySelector) return root.innerText || '';
    // Sensitivity is inherited through the ancestor chain, so the guard must not also require the root
    // itself to look like a field: a plain span inside a sensitive editing host is sensitive too.
    if (sensitive(root)) return '';
    // The walker never runs its filter on the root itself, and innerText on a non-rendered node
    // degrades to textContent, so a hidden root is rejected here instead of leaking hidden data.
    if (root.nodeType === Node.ELEMENT_NODE && notRendered(root)) return '';
    // Without a sensitive descendant, innerText is exact, so never approximate it.
    if (![...root.querySelectorAll(TEXT_SCOPE)].some(sensitive)) return root.innerText || '';
    const parts = []; let length = 0, lastBlock = null, lastBreak = false, pendingSpace = false;
    const walker = document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,{acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        // Only the element's own state is needed here: a suppressed ancestor was already rejected, so
        // its descendants are never visited.
        if (NON_RENDERED.has(node.tagName) || node.hidden || sensitive(node) || ownSuppressed(node)) return NodeFilter.FILTER_REJECT;
        // visibility is judged per text node instead of rejecting the subtree, because a hidden
        // ancestor may contain a descendant that explicitly restores visibility:visible.
        return NodeFilter.FILTER_ACCEPT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }});
    for (let node = walker.nextNode(); node && length < limit; node = walker.nextNode()) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName === 'BR') { parts.push('\n'); lastBreak = true; lastBlock = null; pendingSpace = false; }
        continue;
      }
      const parent = node.parentElement || root;
      const style = getComputedStyle(parent);
      if (style.visibility === 'hidden') continue;
      const pre = (style.whiteSpace || '').startsWith('pre');
      const raw = node.nodeValue;
      // A whitespace-only run is a real separator between inline content; at a block boundary it is
      // dropped by the cleanup below instead of inventing a space or gluing words together.
      if (!pre && !raw.trim()) { if (!lastBreak && parts.length) pendingSpace = true; continue; }
      const value = pre ? raw : raw.replace(/\s+/g,' ');
      let block = parent;
      while (block && block !== root && !BLOCK_TAGS.has(block.tagName)) block = block.parentElement;
      if (parts.length && !lastBreak && block !== lastBlock) parts.push('\n');
      else if (pendingSpace) parts.push(' ');
      pendingSpace = false; lastBreak = false; lastBlock = block;
      parts.push(value); length += value.length;
    }
    return parts.join('').replace(/[ \t]+/g,' ').replace(/ ?\n ?/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  }
  let started = false;
  try {
    if (['snapshot','text','extract','content'].includes(action)) {
      const begin = performance.now();
      const waitSelector = a.waitFor || (action === 'extract' && a.multiple ? a.from : a.selector);
      const ready = () => waitSelector && [...document.querySelectorAll(waitSelector)].some(visible);
      if (waitSelector && !ready()) {
        const empty = () => a.emptySelector && [...document.querySelectorAll(a.emptySelector)].some(visible);
        if (!empty()) await new Promise(resolve => {
          let timer;
          const done = () => {observer.disconnect(); clearTimeout(timer); resolve();};
          const observer = new MutationObserver(() => {if (ready() || empty()) done();});
          observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true});
          timer = setTimeout(done,a.waitMs ?? 10000);
          if (ready() || empty()) done();
        });
        if (location.href !== expectedUrl) return fail('PAGE_CHANGED','The page navigated while waiting. No content returned.');
        if (!ready()) {
          if (empty()) return {ok:true,url:location.href,records:[],count:0,empty:true,truncated:false};
          return fail('CONTENT_NOT_READY','Expected content did not appear before the deadline. Check sign-in, site access or the page; do not interpret this as no results.');
        }
      }
      const timing = {waitMs:Math.round(performance.now()-begin)};
      const root = a.selector ? document.querySelector(a.selector) : action === 'content' ? document.querySelector('main,[role=main],article') || document.body : document.body;
      if (!root) return fail('ELEMENT_NOT_FOUND','The CSS selector matched no page region.');
      if (action === 'text' || action === 'content') {
        const max = a.maxChars || 6000;
        const text = readableText(root,max + 1);
        // Untrusted pages control the title and every href. This stage never cuts a URL: the result
        // exit redacts the whole string first and applies the transfer cap afterwards, so a credential
        // can never straddle a cut. Over-long links are dropped whole, which also bounds the payload.
        let linksTruncated = false;
        let links;
        if (action === 'content') {
          links = [];
          let budget = PAGE_LINKS_BUDGET;
          // Consecutive checks, cheapest first: an untrusted page can hold a huge number of links, and
          // measuring visibility for all of them before applying the limit is a full layout scan.
          for (const el of root.querySelectorAll('a[href]')) {
            const url = String(el.href);
            // Eligibility comes first: a trailing mailto:/tel: link is not something the caller could
            // have received, so it must not be reported as a cut.
            if (!/^https?:/.test(url)) continue;
            if (!visible(el)) continue;
            if (links.length >= (a.limit || 10)) { linksTruncated = true; break; }
            if (url.length > LINK_URL_HARD_MAX || url.length > budget) { linksTruncated = true; continue; }
            budget -= url.length;
            links.push({text:(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0,100),url});
          }
        }
        // Title truncation is reported too, so a caller can tell that page metadata was cut.
        const titleTruncated = document.title.length > TITLE_MAX;
        return {ok:true,url:location.href,title:document.title.slice(0,TITLE_MAX),text:text.slice(0,max),...(links ? {links} : {}),truncated:text.length>max || linksTruncated || titleTruncated,timing};
      }
      if (action === 'extract') {
        let remaining = a.maxChars || 6000;
        let truncated = false;
        const read = scope => {
          const rec = {};
          for (const [name,spec] of Object.entries(a.fields)) {
            const selector = typeof spec === 'string' ? spec : spec.selector;
            const attr = typeof spec === 'object' ? spec.attr : null;
            const el = selector === ':self' ? scope : scope.querySelector(selector);
            let value = null;
            const isUrlAttr = !!attr && ['href','src'].includes(attr);
            if (el && !sensitive(el) && visible(el)) {
              // Same rendered-text rule as content/text: innerText falling back to textContent would
              // return display:none or script content for a visible wrapper with hidden children.
              value = attr ? el.getAttribute(attr) : readableText(el,4000).trim();
              if (value && isUrlAttr) { try { value = new URL(value,document.baseURI).href; } catch { value = null; } }
            }
            if (value != null) {
              if (isUrlAttr) {
                // A URL is never cut: it either fits whole or is dropped whole, so redaction always sees
                // the complete string and the declared per-value limit (4000) still holds.
                if (value.length > 4000 || value.length > remaining) { value = null; truncated = true; }
              } else {
                // Clamp: a URL may have consumed the whole budget, and slice(0, negative) would return
                // text from the end of the string instead of nothing.
                const max = Math.max(0, Math.min(remaining, 4000));
                if (value.length > max) truncated = true;
                value = value.slice(0, max);
              }
              if (value != null) remaining -= value.length;
            }
            Object.defineProperty(rec,name,{value,enumerable:true});
          }
          return rec;
        };
        if (!a.multiple) return {ok:true,url:location.href,record:read(root),truncated,timing};
        const records = []; const rows = a.from ? [...(root.matches(a.from) ? [root] : []),...root.querySelectorAll(a.from)] : [root];
        let cursorFound = !a.after;
        for (const row of rows) {
          if (!visible(row)) continue;
          if (a.after && [...row.querySelectorAll('a[href]')].some(el => el.href === a.after)) {cursorFound=true; break;}
          if (records.length >= (a.limit || 10) || remaining<=0) {truncated=true; break;}
          records.push(read(row));
        }
        return {ok:true,url:location.href,count:records.length,records,truncated,timing,...(a.after ? {cursorFound} : {})};
      }
      const refs = new Map();
      globalThis.__myBrowserSnapshot = {url:location.href,refs};
      const sel = 'a,button,input,textarea,select,[role=button],[role=link],[role=textbox],[role=tab],[contenteditable]';
      const nodes = [...(root.matches(sel) ? [root] : []),...root.querySelectorAll(sel)];
      const elements = []; let length = 0; let truncated = false;
      for (const el of nodes) {
        if (!visible(el) || sensitive(el)) continue;
        const ref = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2,'0')).join(''); refs.set(ref,el);
        const name = String(el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.innerText || el.getAttribute('title') || '').replace(/\s+/g,' ').slice(0,120);
        const line = '['+ref+'] '+(el.getAttribute('role') || el.tagName.toLowerCase())+' '+name;
        if (length+line.length > 14000 || elements.length >= 80) { truncated = true; refs.delete(ref); break; }
        elements.push(line); length += line.length;
      }
      // The snapshot text has its own cap; a cut there must be reported like any other.
      const fullText = readableText(root,6001);
      return {ok:true,url:location.href,title:document.title.slice(0,TITLE_MAX),elements:elements.join('\n'),text:fullText.slice(0,6000),truncated:truncated || fullText.length > 6000 || document.title.length > TITLE_MAX,untrusted_content:true};
    }
    const snapshot = globalThis.__myBrowserSnapshot;
    let el = a.ref ? (snapshot?.url === location.href ? snapshot.refs.get(a.ref) : null) : a.selector ? document.querySelector(a.selector) : null;
    if (a.ref && (!el || !el.isConnected)) return fail('STALE_REF','This ref is stale. Take a new snapshot; do not reuse old refs.');
    if (action === 'scroll') {
      started = true; (el || window).scrollBy(0,600);
    } else {
      if (action === 'press' && !el) el = document.activeElement;
      if (!el || !el.isConnected || !visible(el)) return fail('ELEMENT_NOT_FOUND','Read the page again and choose a visible element.');
      if (sensitive(el)) return fail('SENSITIVE_FIELD','Password, hidden, payment and one-time-code fields are not supported.');
      if (el.disabled) return fail('ELEMENT_DISABLED','This element is disabled.');
      if (action === 'click') { started = true; el.click(); }
      else if (action === 'hover') { started = true; el.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})); }
      else if (action === 'select') {
        if (!(el instanceof HTMLSelectElement)) return fail('INVALID_ELEMENT','Select requires a native select element.');
        if (a.values.some(v => ![...el.options].some(o => o.value === v))) return fail('OPTION_NOT_FOUND','One of the requested option values does not exist.');
        started = true;
        for (const opt of el.options) opt.selected = a.values.includes(opt.value);
        el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));
      } else if (action === 'type') {
        if (el.readOnly || (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement) && !el.isContentEditable)) return fail('INVALID_ELEMENT','Choose an editable text field.');
        started = true; el.focus();
        if (el.isContentEditable) el.textContent = a.text;
        else Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,'value').set.call(el,a.text);
        el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));
        if (a.submit) {
          // One submission mechanism, never both synthetic Enter and requestSubmit (double-send).
          if (el.form) el.form.requestSubmit();
          else for (const type of ['keydown','keyup']) el.dispatchEvent(new KeyboardEvent(type,{key:'Enter',code:'Enter',bubbles:true,cancelable:true}));
        }
      } else if (action === 'press') {
        started = true;
        if (a.key === 'Enter' && el.form) el.form.requestSubmit();
        else for (const type of ['keydown','keyup']) el.dispatchEvent(new KeyboardEvent(type,{key:a.key,code:a.key,bubbles:true,cancelable:true}));
      } else return fail('INVALID_ACTION','Unsupported page action.');
    }
    return {ok:true,execution:'executed',url:location.href,kind:action,note:'DOM action dispatched, not proof of business success. Read the page to verify. Synthetic keyboard/hover events may be ignored by sites requiring trusted input.'};
  } catch {
    return fail('PAGE_OPERATION_FAILED',started ? 'The page operation was interrupted. Check the actual page before repeating it.' : 'Check the CSS selector and page state, then read again.',started ? 'unknown' : 'not_executed');
  }
}
const LINK_URL_MAX = 2048, LINKS_BUDGET = 20000, PAGE_URL_MAX = 8192;
// Page-supplied URLs arrive whole from the injected function. Redaction runs on the entire string and
// the transfer cap only on the redacted result, so a credential can never be cut in half and slip past
// the sanitizer. A redirect can also stretch the page URL itself far past the request limit, which
// would make the bridge reject the whole result and time the caller out.
function sanitizeResult(result) {
  if (!result || typeof result !== 'object') return result;
  let truncated = !!result.truncated;
  const out = {...result};
  if (typeof out.url === 'string') {
    const redacted = P.redactUrl(out.url);
    out.url = redacted.length > PAGE_URL_MAX ? redacted.slice(0,PAGE_URL_MAX) : redacted;
    if (redacted.length > PAGE_URL_MAX) truncated = true;
  }
  if (!Array.isArray(out.links)) { out.truncated = truncated; return out; }
  let budget = LINKS_BUDGET;
  const links = [];
  for (const link of out.links) {
    // Redaction runs on the whole URL, the transfer cap on the redacted string, and a cap that
    // actually shortens a URL is reported: an unmarked cut would look like a complete URL.
    const redacted = P.redactUrl(String(link?.url));
    const url = redacted.slice(0,LINK_URL_MAX);
    if (url.length < redacted.length) truncated = true;
    if (url.length > budget) { truncated = true; continue; }
    budget -= url.length;
    links.push({...link,url});
  }
  return {...out,links,truncated};
}
async function handle(job,policy,target) {
  P.validate(job.action,job.payload);
  const gate = P.check(policy,job.action,job.payload.url);
  if (!gate.ok) return gate;
  if (job.action === 'tabs') {
    const tabs = (await chrome.tabs.query({})).filter(t => /^https?:/.test(t.url || '') && (!job.payload.host || (P.check(policy,'text',t.url).ok && P.matches(new URL(t.url).hostname,P.normalizeHost(job.payload.host)))));
    const records=[];let remaining=30000;
    for (const t of tabs) {
      if (records.length>=(job.payload.limit || 20)) break;
      let metadata;
      if(P.check(policy,'text',t.url).ok)try {
        const documentId=await network.document(t.id);
        const out=await chrome.scripting.executeScript({target:{tabId:t.id,documentIds:[documentId]},world:'ISOLATED',func:()=>({url:location.href,title:document.title.slice(0,160)})});
        if(out?.[0]?.documentId===documentId && P.check(policy,'text',out[0].result?.url).ok)metadata=out[0].result;
      }catch {}
      if(job.payload.host && (!metadata || !P.matches(new URL(metadata.url).hostname,P.normalizeHost(job.payload.host))))continue;
      const row=metadata ? {id:t.id,title:metadata.title,...(metadata.url.length<=8192 ? {url:P.redactUrl(metadata.url)} : {url_omitted:true}),active:t.active} : {id:t.id,redacted:true};
      const size=JSON.stringify(row).length;if (size>remaining) break;
      records.push(row);remaining-=size;
    }
    return {ok:true,tabs:records,truncated:records.length<tabs.length};
  }
  let injecting = false, navigating = false;
  const failureState = () => navigating || (injecting && P.INTERACT.includes(job.action)) ? 'unknown' : 'not_executed';
  try {
    const tab = await ensureTab(job.payload.url,policy,job.action,() => { navigating = true; });
    const actual = await chrome.tabs.get(tab.id);
    // Prepare everything asynchronous first, so the authorization re-check below is the last await
    // before the page is touched: a revocation during preparation must not be bypassed.
    const documentId=await network.document(tab.id);
    // A redirect can stretch the tab URL past the bridge's request limit; the authorize call only needs
    // the scheme and host for its policy check, so a bounded copy is sent instead of the whole string.
    const authorization = await fetchJSON(target.base,'/authorize',target.session,{id:job.id,url:actual.url.slice(0,PAGE_URL_MAX)});
    policy = P.normalizePolicy(authorization.policy);
    const currentGate = P.check(policy,job.action,actual.url);
    if (!currentGate.ok) return {...currentGate,execution:failureState()};
    if (job.action === 'navigate') return {ok:true,url:actual.url};
    injecting = true;
    targets.set(job.id,{url:actual.url,target,tabId:tab.id,documentId});
    let out;
    try {
      out = await chrome.scripting.executeScript({target:{tabId:tab.id,documentIds:[documentId]},world:'ISOLATED',func:pageOperation,args:[job]});
    } finally { targets.delete(job.id); }
    const raw = out?.[0]?.documentId === documentId ? out[0].result : null;
    const result = sanitizeResult(raw);
    if (!result) return fail('NO_PAGE_RESULT','Chrome returned no result. Check the page before repeating an interaction.',failureState());
    if (result.url && !P.check(policy,job.action,result.url).ok) return fail('REDIRECT_BLOCKED','The page moved to a blocked site. No content is returned; verify the action manually.',failureState());
    return result?.error && navigating ? {...result,execution:'unknown'} : result;
  } catch (e) {
    const messages = {ADDRESS_UNVERIFIED:'The browser did not verify a public address for this document. No page content was read. If it is a public page opened before the extension started, refresh that same tab manually once; do not create replacement tabs or retry in a loop.',PAGE_NOT_OPEN:'This action has no open target. Inspect browser_tabs once; do not repeatedly open the URL to repair a stale action.',PAGE_CHANGED:'The existing tab navigated. No new tab was opened. Inspect browser_tabs once and use the actual URL; do not retry the old URL or invent URL variants.',TAB_LIMIT:'Three plugin-created tabs are still open and cannot safely be closed. No new tab was opened. Use an existing tab or ask the user to close unneeded tabs; do not retry in a loop.',TAB_ACCESS_FAILED:'The existing tab is still present but inaccessible. No replacement was opened. Check browser permissions.',PAGE_LOAD_TIMEOUT:'Loading timed out; the same tab was retained. Inspect its state once. Do not loop retries, change query strings, or open duplicate URLs.',REDIRECT_BLOCKED:'The existing tab redirected to a site that is not allowed. No replacement will be opened. Review its permissions; do not bypass the denial.'};
    return {...fail(e.message in messages ? e.message : 'CHROME_OPERATION_FAILED',messages[e.message] || 'Browser access failed. Inspect the existing page and extension permissions; do not automatically open a replacement.',failureState()),retryable:false};
  }
}
async function chain() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      let target;
      try {
        target = await discover();
        if (!target) { await cleanup(); await sleep(3000); continue; }
        const {job} = await fetchJSON(target.base,'/poll',target.session,undefined,25000);
        if (!job) { await cleanup(); continue; }
        // A failed/expired ack means DO NOT execute. Only use the exact bridge session that issued the job.
        const ack = await fetchJSON(target.base,'/ack',target.session,{id:job.id});
        if (!ack.ok) continue;
        let result;
        try { result = await handle(job,P.normalizePolicy(ack.policy),target); }
        catch { result = fail('INVALID_JOB','The browser job was invalid. No action was executed.'); }
        await fetchJSON(target.base,'/result',target.session,{id:job.id,result});
      } catch {
        // Never retry the browser operation after losing its response.
        bridge = null; await connection({connected:false,message:'Connection interrupted. Check any in-progress action before retrying.'});
        await sleep(1500);
      }
    }
  } finally { running = false; }
}
chrome.alarms.create('my-browser-watchdog',{periodInMinutes:0.5});
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'my-browser-watchdog') chain(); });
chrome.runtime.onStartup.addListener(chain);
chrome.runtime.onInstalled.addListener(chain);
// In-flight page targets, keyed by job id. Only the worker can read them, and only while injecting.
const targets = new Map();
chrome.runtime.onMessage.addListener((msg,_sender,sendResponse) => {
  if (msg?.type === 'my-browser-target') {
    const entry = targets.get(msg.id);
    if (!entry || _sender.tab?.id !== entry.tabId || _sender.documentId !== entry.documentId) { sendResponse(null); return; }
    // Recheck after injection has reached the document, not only before executeScript.
    fetchJSON(entry.target.base,'/authorize',entry.target.session,{id:msg.id,url:entry.url.slice(0,PAGE_URL_MAX),dispatch:true})
      .then(r => sendResponse(r.ok && targets.get(msg.id) === entry ? entry.url : null))
      .catch(() => sendResponse(null));
    return true;
  }
  if (msg.type !== 'connection-status') return;
  discover().then(() => sessionStore.get('connection')).then(sendResponse).catch(() => sendResponse({connection:{connected:false}}));
  return true;
});
chain();
