'use strict';
if (typeof importScripts === 'function') importScripts('policy.js','network-guard.js','learning-core.js','youtube-transcript.js');
// A lexical `const chrome` masks Chromium's lazy API initialization; use a var alias.
var chrome = globalThis.browser || globalThis.chrome;
const P = globalThis.MyBrowserPolicy;
const network = globalThis.MyBrowserNetwork.create(chrome);
const VERSION = chrome.runtime.getManifest().version;
// Content/UI releases retain the signed 0.4.13 wire contract.
const WIRE_VERSION = '0.4.13';
let bridge = null;
let discovery;
let wireVersion=WIRE_VERSION;
let running = false;
const b64url = bytes => {
  let binary=''; for(const byte of new Uint8Array(bytes)) binary+=String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
};
// Resume markers must never retain a page URL: OAuth, signed playback and reset
// credentials may be carried in its query or fragment. A one-way marker still
// lets the same document resume after a service-worker restart without exposing
// the raw URL to extension storage or other extension code.
const videoIdentity = async url => {
  if(typeof url!=='string'||!globalThis.crypto?.subtle||typeof TextEncoder!=='function')return null;
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(url));
  return 'sha256:'+b64url(digest);
};
const openAuthDb = () => new Promise((resolve,reject) => {
  const request=indexedDB.open('cindy-browser-auth',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('keys');
  request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error || Error('AUTH_STORAGE_FAILED'));
});
let authPromise;
const authReady = () => authPromise ||= (async () => {
  if(!globalThis.crypto?.subtle||!globalThis.indexedDB)throw Error('AUTH_UNAVAILABLE');
  const db=await openAuthDb();
  const read=await new Promise((resolve,reject)=>{const r=db.transaction('keys','readonly').objectStore('keys').get('browser');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  let pair=read;
  if(!pair){
    pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
    await new Promise((resolve,reject)=>{const tx=db.transaction('keys','readwrite');tx.objectStore('keys').put(pair,'browser');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error || Error('AUTH_STORAGE_FAILED'));});
  }
  const publicJwk=await crypto.subtle.exportKey('jwk',pair.publicKey);
  const publicKey=btoa(JSON.stringify({kty:publicJwk.kty,crv:publicJwk.crv,x:publicJwk.x,y:publicJwk.y,ext:false})).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  return {pair,publicKey,sign:async challenge=>b64url(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,new TextEncoder().encode(challenge)))};
})();
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
async function fetchJSON(base,path,session,body,timeout = 5000,version = wireVersion,auth = {}) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(),timeout);
  try {
    const response = await fetch(base+path,{method:body === undefined ? 'GET' : 'POST',
      headers:{'X-My-Browser-Extension':chrome.runtime.id,'X-My-Browser-Origin':chrome.runtime.getURL('').replace(/\/$/,''),'X-My-Browser-Client':clientId,'X-My-Browser-Family':family,'X-My-Browser-Version':version,'X-My-Browser-Installed-Version':VERSION,...(auth.publicKey ? {'X-My-Browser-Key':auth.publicKey} : {}),...(auth.learningChallenge ? {'X-My-Browser-Learning-Challenge':auth.learningChallenge} : {}),...(auth.proof ? {'X-My-Browser-Proof':auth.proof} : {}),...(session ? {'X-My-Browser-Session':session} : {}),...(body === undefined ? {} : {'Content-Type':'application/json'})},
      ...(body === undefined ? {} : {body:JSON.stringify(body)}),signal:controller.signal}).catch(()=>{throw Error('BRIDGE_REQUEST_FAILED');});
    const data = await response.json().catch(()=>{throw Error('BRIDGE_REQUEST_FAILED');});
    if (!response.ok) throw new Error(data.error || 'BRIDGE_REQUEST_FAILED');
    return data;
  } finally { clearTimeout(timer); }
}
function discover() {
  if(discovery)return discovery;
  discovery=discoverBridge().finally(()=>{discovery=null;});
  return discovery;
}
async function discoverBridge() {
  await restore;
  if (bridge) return bridge;
  let auth=null;
  let diagnostic;
  // Preserve the original ports first. Probe bounded batches so a silent firewall
  // does not turn a larger fallback range into a minute-long serial scan.
  for (let first = 18810; first <= 18909; first+=10) {
    const candidates=await Promise.all(Array.from({length:10},async(_,offset)=>{
      const port=first+offset,base='http://127.0.0.1:'+port;
      try{
        let r=await fetchJSON(base,'/health',null,undefined,450,WIRE_VERSION);
        if(r.auth_required){auth=auth||await authReady().catch(()=>null);if(!auth)return null;r=await fetchJSON(base,'/health',null,undefined,450,WIRE_VERSION,{publicKey:auth.publicKey});}
        if(r.challenge){auth=auth||await authReady().catch(()=>null);if(!auth)return null;const proof=await auth.sign(r.challenge);r=await fetchJSON(base,'/health',null,undefined,450,WIRE_VERSION,{publicKey:auth.publicKey,proof});}
        if(r.plugin!=='my-browser'||r.protocol!==3||r.extensionId!==chrome.runtime.id)return null;
        if(r.version!==WIRE_VERSION&&!['0.4.0','0.4.1','0.4.2','0.4.3','0.4.4','0.4.5','0.4.6','0.4.7','0.4.8','0.4.9','0.4.10','0.4.11','0.4.12'].includes(r.version)&&!/^0\.3\.\d+$/.test(r.version)){diagnostic='UPDATE_CINDY_CHROME';return null;}
        const version=r.version;
        if(version!==WIRE_VERSION){r=await fetchJSON(base,'/health',null,undefined,450,version);if(r.auth_required){auth=auth||await authReady().catch(()=>null);if(!auth)return null;r=await fetchJSON(base,'/health',null,undefined,450,version,{publicKey:auth.publicKey});}if(r.challenge){auth=auth||await authReady().catch(()=>null);if(!auth)return null;const proof=await auth.sign(r.challenge);if(!proof)return null;r=await fetchJSON(base,'/health',null,undefined,450,version,{publicKey:auth.publicKey,proof});}if(r.plugin!=='my-browser'||r.protocol!==3||r.extensionId!==chrome.runtime.id||r.version!==version)return null;}
        if(r.native_binding_required){
          try {
            const registered=await Promise.race([chrome.runtime.sendNativeMessage('com.makecindy.browser',{port,clientId,publicKey:auth.publicKey}),sleep(10000).then(()=>{throw Error('NATIVE_BINDING_UNAVAILABLE');})]);
            if(!registered?.ok)throw Error('NATIVE_BINDING_UNAVAILABLE');
            const proof=await auth.sign(r.challenge);
            r=await fetchJSON(base,'/health',null,undefined,1500,version,{publicKey:auth.publicKey,proof});
          }catch{diagnostic='NATIVE_BINDING_UNAVAILABLE';return null;}
        }
        if(r.pairing_required){diagnostic='PAIRING_REQUIRED';return null;}
        if(typeof r.session!=='string'||!r.session)return null;
        const learning=r.capabilities?.includes('learning-v1')===true&&r.capabilities?.includes('learning-auth-v2')===true;
        return {base,port,version,session:r.session,learning,auth};
      }catch{return null;}
    }));
    const found=candidates.find(Boolean);
    if(found){wireVersion=found.version;bridge={base:found.base,session:found.session,learning:found.learning};await connection({connected:true,port:found.port});return bridge;}
  }
  await connection({connected:false,error:diagnostic||'CINDY_DISCONNECTED'});
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
  const end = Date.now()+25000;
  while (Date.now()<end) {
    const tab = await chrome.tabs.get(id);
    // Images, ads and media can keep the tab loading after its main document is
    // usable. Only accept DOM readiness bound to the current browser document.
    if (tab.status === 'complete' || await network.isReady?.(id)) { await sleep(250); return chrome.tabs.get(id); }
    await sleep(150);
  }
  const latest=await chrome.tabs.get(id);
  if(latest.status==='complete' || await network.isReady?.(id))return latest;
  throw Object.assign(new Error('PAGE_LOAD_TIMEOUT'),{tabId:id,tabStatus:latest.status});
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
  // are excluded from refs, extract and text. Field selectors are not a proxy for that check: a named
  // span inside an unnamed editing host is sensitive even though it does not match a field selector.
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
    // Without a sensitive descendant, innerText is exact, so never approximate it. Every descendant
    // is judged with sensitive(): a named credential child of an unnamed host would be missed by a
    // field-selector fast path and leak through innerText.
    if (![...root.querySelectorAll('*')].some(sensitive)) return root.innerText || '';
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
      // A derived `from` readiness check must look inside the selected region. A global match
      // elsewhere would report ready, then extract zero rows from an empty target.
      const waitScope = () => {
        if (action === 'extract' && a.multiple && a.from && !a.waitFor && a.selector) return document.querySelector(a.selector);
        return document;
      };
      const ready = () => {
        if (!waitSelector) return false;
        const scope = waitScope();
        if (!scope) return false;
        const nodes = scope === document ? document.querySelectorAll(waitSelector) : [...(scope.matches?.(waitSelector) ? [scope] : []), ...scope.querySelectorAll(waitSelector)];
        return [...nodes].some(visible);
      };
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
            if (sensitive(el)) continue;
            if (links.length >= (a.limit || 10)) { linksTruncated = true; break; }
            if (url.length > LINK_URL_HARD_MAX || url.length > budget) { linksTruncated = true; continue; }
            budget -= url.length;
            // Link text is a text projection: innerText would copy a named credential child.
            links.push({text:(readableText(el,100) || el.getAttribute('aria-label') || '').trim().slice(0,100),url});
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
        const name = String(el.getAttribute('aria-label') || el.getAttribute('placeholder') || readableText(el,120) || el.getAttribute('title') || '').replace(/\s+/g,' ').slice(0,120);
        const line = '['+ref+'] '+(el.getAttribute('role') || el.tagName.toLowerCase())+' '+name;
        if (length+line.length > 14000 || elements.length >= 80) { truncated = true; refs.delete(ref); break; }
        elements.push(line); length += line.length;
      }
      // The snapshot text has its own cap; a cut there must be reported like any other.
      const max = a.maxChars || 6000;
      const fullText = readableText(root,max + 1);
      return {ok:true,url:location.href,title:document.title.slice(0,TITLE_MAX),elements:elements.join('\n'),text:fullText.slice(0,max),truncated:truncated || fullText.length > max || document.title.length > TITLE_MAX,untrusted_content:true};
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
    const records=[];let remaining=30000,truncated=false;
    for (const t of tabs) {
      let metadata,diagnostic;
      if(P.check(policy,'text',t.url).ok)try {
        const documentId=await network.document(t.id);
        const out=await chrome.scripting.executeScript({target:{tabId:t.id,documentIds:[documentId]},world:'ISOLATED',func:()=>({url:location.href,title:document.title.slice(0,160)})});
        if(out?.[0]?.documentId===documentId && P.check(policy,'text',out[0].result?.url).ok)metadata=out[0].result;
      }catch(e){diagnostic={error:e.message==='ADDRESS_UNVERIFIED'?'ADDRESS_UNVERIFIED':'TAB_ACCESS_FAILED',...(e.message==='ADDRESS_UNVERIFIED'?{reason:e.reason}: {})};}
      if(job.payload.host && diagnostic?.reason==='LOCAL_ADDRESS')continue;
      if(job.payload.host && metadata && !P.matches(new URL(metadata.url).hostname,P.normalizeHost(job.payload.host)))continue;
      if (records.length>=(job.payload.limit || 20)) {truncated=true;break;}
      // Keep denied/unobserved tabs visible as bounded diagnostics. Never read
      // their title or expose their URL merely to make the list look complete.
      const row=metadata ? {id:t.id,title:metadata.title,...(metadata.url.length<=8192 ? {url:P.redactUrl(metadata.url)} : {url_omitted:true}),active:t.active,status:t.status} : {id:t.id,redacted:true,status:t.status,...diagnostic};
      const size=JSON.stringify(row).length;if (size>remaining) {truncated=true;break;}
      records.push(row);remaining-=size;
    }
    return {ok:true,tabs:records,truncated};
  }
  let injecting = false, navigating = false;
  const failureState = () => navigating || (injecting && P.INTERACT.includes(job.action)) ? 'unknown' : 'not_executed';
  try {
    network.assertSupported?.(job.payload.url);
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
    const messages = {BROWSER_PAGE_RESTRICTED:'Chrome protects this Web Store domain from extension access, including the legacy developer console. Store-installed extensions have the same restriction. Refreshing or granting site access will not help; no page content was read or modified.',ADDRESS_UNVERIFIED:'The browser could not identify an accessible current document. See reason for the document or local-URL restriction. No page content was read. Inspect the retained tab; do not open replacements or retry in a loop.',PAGE_NOT_OPEN:'This action has no open target. Inspect browser_tabs once; do not repeatedly open the URL to repair a stale action.',PAGE_CHANGED:'The existing tab navigated. No new tab was opened. Inspect browser_tabs once and use the actual URL; do not retry the old URL or invent URL variants.',TAB_LIMIT:'Three plugin-created tabs are still open and cannot safely be closed. No new tab was opened. Use an existing tab or ask the user to close unneeded tabs; do not retry in a loop.',TAB_ACCESS_FAILED:'The existing tab is still present but inaccessible. No replacement was opened. Check browser permissions.',PAGE_LOAD_TIMEOUT:'Loading timed out; the same tab was retained. Inspect its state once. Do not loop retries, change query strings, or open duplicate URLs.',REDIRECT_BLOCKED:'The existing tab redirected to a site that is not allowed. No replacement will be opened. Review its permissions; do not bypass the denial.'};
    return {...fail(e.message in messages ? e.message : 'CHROME_OPERATION_FAILED',messages[e.message] || 'Browser access failed. Inspect the existing page and extension permissions; do not automatically open a replacement.',failureState()),...(e.message==='ADDRESS_UNVERIFIED' ? {reason:e.reason || 'UNKNOWN'} : {}),...(e.message==='PAGE_LOAD_TIMEOUT'?{tabId:e.tabId,status:e.tabStatus}:{}),retryable:false};
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

// Only our extension pages and isolated top-frame content scripts can enter here.
const learningCalls=new Map();
// Only learning endpoints are retried, with the same id and authenticated session.
// Never replay browser actions or move an uncertain request to a new session.
async function learningFetch(target,path,body,active,deadline){
  for(let attempt=0;;attempt++){
    await active();if(Date.now()>=deadline)throw Error('TIMEOUT');
    try {
      const challenge=await fetchJSON(target.base,'/learning/challenge',target.session);
      await active();if(Date.now()>=deadline)throw Error('TIMEOUT');
      const auth=target.auth||await authReady();
      const method=body===undefined?'GET':'POST';
      const serialized=body===undefined?'':JSON.stringify(body);
      const digest=b64url(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(serialized)));
      const proof=await auth.sign(challenge.challenge+'\\n'+method+'\\n'+path+'\\n'+digest);
      await active();if(Date.now()>=deadline)throw Error('TIMEOUT');
      return await fetchJSON(target.base,path,target.session,body,5000,wireVersion,{publicKey:auth.publicKey,learningChallenge:challenge.challenge,proof});
    }
    catch(error){
      if(error.message!=='BRIDGE_REQUEST_FAILED'||attempt>=2)throw error;
      await sleep(250*(attempt+1));
    }
  }
}
async function learningRequest(message,sender) {
  // Register ownership before the first await: cancellation during discovery
  // must not acknowledge a request that will subsequently still be submitted.
  const id=message.id,owner=sender.documentId||sender.url;
  if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw Error('INVALID_ID');
  if(!owner)throw Error('INVALID_SOURCE');
  if(learningCalls.has(id))throw Error('BUSY');
  const call={target:null,owner,cancelled:false};learningCalls.set(id,call);
  let target,page;
  async function checkCurrent(){
    if(learningCalls.get(id)!==call||call.cancelled)throw Error('REQUEST_CANCELLED');
    if(page && ((await chrome.tabs.get(page.id)).url!==page.url || await network.document(page.id)!==sender.documentId))throw Error('PAGE_CHANGED');
  }
  try {
    await restore;await checkCurrent();
    target=await discover();await checkCurrent();call.target=target;
    if(!target)throw Error((await sessionStore.get('connection')).connection?.error||'CINDY_DISCONNECTED');
    if(!target.learning)throw Error('UPDATE_CINDY_CHROME');
    const internal=sender.url?.startsWith(chrome.runtime.getURL(''));
    const request=globalThis.CindyLearning.validate(message.request);
    if(!internal) {
      if(!sender.tab?.id || sender.frameId!==0)throw Error('INVALID_SOURCE');
      page=await chrome.tabs.get(sender.tab.id);
      const documentId=await network.document(page.id);
      // pushState keeps the initial sender URL; bind to document and live origin.
      if(sender.documentId!==documentId || new URL(page.url).origin!==new URL(sender.url).origin || (request.source.url&&request.source.url!==page.url))throw Error('PAGE_CHANGED');
      request.source={...request.source,url:page.url,title:(page.title||'').slice(0,500)};
    }
    await checkCurrent();
    const deadline=Date.now()+globalThis.CindyLearning.learningRequestTimeout(request);let lastProgress;
    await learningFetch(target,'/learning/start',{id,request},()=>checkCurrent(),deadline);
    while(Date.now()<deadline) {
      await checkCurrent();
      const result=await learningFetch(target,'/learning/result',{id},()=>checkCurrent(),deadline);
      if(result.done)return result.result;
      if(page&&result.progress){const serialized=JSON.stringify(result.progress);if(serialized!==lastProgress){lastProgress=serialized;await chrome.tabs.sendMessage(page.id,{type:'cindy-learning-progress',id,progress:result.progress},{documentId:sender.documentId}).catch(()=>{});}}
      await sleep(450);
    }
    throw Error('TIMEOUT');
  } catch(error) {
    if(['SESSION_CHANGED','BRIDGE_REQUEST_FAILED'].includes(error.message)&&bridge===target){bridge=null;await connection({connected:false});}
    if(target)await learningFetch(target,'/learning/cancel',{id},()=>Promise.resolve(),Date.now()+5000).catch(()=>{});
    throw error;
  } finally {learningCalls.delete(id);}
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==chrome.runtime.id)return;
  if(message?.type==='cindy-learning') {
    learningRequest(message,sender).then(reply).catch(e=>reply({ok:false,error:e.message,...(e.message==='ADDRESS_UNVERIFIED'?{reason:e.reason}: {})}));return true;
  }
  if(message?.type==='cindy-cancel') {
    const call=learningCalls.get(message.id);
    if(call && call.owner===(sender.documentId||sender.url)) {call.cancelled=true;if(call.target)learningFetch(call.target,'/learning/cancel',{id:message.id},()=>Promise.resolve(),Date.now()+5000).catch(()=>{});}
    reply({ok:true});return;
  }
});
async function openOnTab(tabId,action='open') {
  let failed=false,current=true;
  const navigated=(id,change)=>{
    if(id===tabId&&(change.status==='loading'||change.url))current=false;
  };
  chrome.tabs.onUpdated?.addListener(navigated);
  try {
    try {await chrome.tabs.sendMessage(tabId,{type:'cindy-ui',action});}
    catch {failed=true;}
    // Neither late success nor late failure may overwrite the new page's badge.
    if(!current)return;
    // Page failures belong to this tab, not the shared Cindy connection.
    // null removes the override so a real disconnection warning remains visible.
    await chrome.action.setBadgeText({tabId,text:failed?'!':null}).catch(()=>{});
  } finally {chrome.tabs.onUpdated?.removeListener(navigated);}
}
chrome.tabs.onUpdated?.addListener((tabId,change)=>{
  if(change.status==='loading'||change.url) {
    // Navigation/refresh replaces the document that could not receive the click.
    chrome.action.setBadgeText({tabId,text:null}).catch(()=>{});
  }
});
if(chrome.contextMenus) {
  chrome.runtime.onInstalled.addListener(()=>{
    chrome.contextMenus.removeAll(()=>{
      chrome.contextMenus.create({id:'cindy-selection',title:'Cindy',contexts:['selection']});
      chrome.contextMenus.create({id:'cindy-page',title:'Cindy · Translate page',contexts:['page']});
    });
  });
  chrome.contextMenus.onClicked.addListener((info,tab)=>{if(tab?.id)openOnTab(tab.id,info.menuItemId==='cindy-selection'?'selection':'translate-page');});
}
chrome.action.onClicked?.addListener(tab=>{if(tab?.id)openOnTab(tab.id);});
chrome.commands?.onCommand.addListener(async command=>{
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(tab?.id)openOnTab(tab.id,command==='translate-page'?'translate-page':'open');
});

chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  if(sender.id===chrome.runtime.id&&['cindy-open-library','cindy-open-reader'].includes(m?.type)) {
    chrome.tabs.create({url:chrome.runtime.getURL('library.html')}).then(()=>reply({ok:true}));return true;
  }
});
// YouTube exposes timed caption metadata through its own player. Read only this
// fixed field; no arbitrary page JavaScript and no cookies leave the browser.
async function fetchYoutubeCaptions(url) {
  let response,data;
  try {
    response=await fetch(url,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('SUBTITLE_UNAVAILABLE');
    if(!response.body)throw Error('SUBTITLE_EMPTY');
    const reader=response.body.getReader(),parts=[];let bytes=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2000000)throw Error('SUBTITLE_TOO_LARGE');parts.push(value);}}finally{await reader.cancel().catch(()=>{});}
    data=new Uint8Array(bytes);let at=0;for(const part of parts){data.set(part,at);at+=part.length;}
  } catch(e) {
    if(['SUBTITLE_UNAVAILABLE','SUBTITLE_EMPTY','SUBTITLE_TOO_LARGE'].includes(e.message))throw e;
    throw Error(['TimeoutError','AbortError'].includes(e.name)?'SUBTITLE_TIMEOUT':'SUBTITLE_FETCH_FAILED');
  }
  const text=new TextDecoder().decode(data);
  if(!text.trim())throw Error('SUBTITLE_EMPTY');
  let parsed;
  try{parsed=JSON.parse(text);}catch{throw Error('SUBTITLE_RESPONSE_INVALID');}
  if(!parsed||!Array.isArray(parsed.events))throw Error('SUBTITLE_RESPONSE_INVALID');
  const cues=globalThis.CindyLearning.youtubeSubtitles(parsed);
  if(!cues.length)throw Error('SUBTITLE_EMPTY');
  return cues;
}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  if(m?.type!=='cindy-captions'||sender.id!==chrome.runtime.id)return;
  (async()=>{
    await learningRequest({id:crypto.randomUUID(),request:{op:'config'}},sender);
    const tab=await chrome.tabs.get(sender.tab.id),documentId=await network.document(tab.id);
    if(!/(^|\.)youtube\.com$/.test(new URL(tab.url).hostname))return {ok:true,cues:[]};
    const result=await chrome.scripting.executeScript({target:{tabId:tab.id,documentIds:[documentId]},world:'MAIN',func:()=>{
      const p=document.querySelector('#movie_player');
      const response=p?.getPlayerResponse?.()||globalThis.ytInitialPlayerResponse;
      return (response?.captions?.playerCaptionsTracklistRenderer?.captionTracks||[]).slice(0,20).map(t=>({url:t.baseUrl,language:t.languageCode,kind:t.kind}));
    }});
    const tracks=result?.[0]?.documentId===documentId?result[0].result:[];
    const track=tracks.find(t=>t.language===m.language)||tracks.find(t=>t.kind!=='asr')||tracks[0];
    let cues=[],sourceError;
    if(track){
      const url=new URL(track.url);
      if(url.protocol!=='https:'||!/(^|\.)youtube\.com$/.test(url.hostname)||url.pathname!=='/api/timedtext'||url.username||url.password)throw Error('INVALID_SUBTITLE_SOURCE');
      url.searchParams.set('fmt','json3');
      try{cues=await fetchYoutubeCaptions(url.href);}catch(e){
        if(!['SUBTITLE_EMPTY','SUBTITLE_RESPONSE_INVALID','SUBTITLE_UNAVAILABLE','SUBTITLE_TIMEOUT','SUBTITLE_FETCH_FAILED'].includes(e.message))throw e;
        sourceError=e;
      }
    }
    if(!cues.length){
      const fallback=await chrome.scripting.executeScript({target:{tabId:tab.id,documentIds:[documentId]},world:'MAIN',func:globalThis.CindyYoutubeTranscript.read,args:[tab.url]});
      if(fallback?.[0]?.documentId!==documentId)throw Error('PAGE_CHANGED');
      const transcript=fallback[0].result;
      if(!transcript?.ok)throw Error(transcript?.error==='SUBTITLE_UNAVAILABLE'?sourceError?.message||'SUBTITLE_UNAVAILABLE':transcript?.error||'SUBTITLE_UNAVAILABLE');
      cues=transcript.cues;
      if(!cues.length&&sourceError)throw sourceError;
    }
    await learningRequest({id:crypto.randomUUID(),request:{op:'config'}},sender);
    if((await chrome.tabs.get(tab.id)).url!==tab.url)throw Error('PAGE_CHANGED');
    return {ok:true,cues,language:track?.language};
  })().then(reply).catch(e=>reply({ok:false,error:e.message,...(e.message==='ADDRESS_UNVERIFIED'?{reason:e.reason}: {})}));return true;
});

// Resume only the user's subtitle panel on the same tab and exact URL after reload.
// No page storage, cross-tab inheritance or bypass of learningRequest authorization.
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  if(!['cindy-video-state','cindy-video-resume'].includes(m?.type)||sender.id!==chrome.runtime.id||!sender.tab?.id||sender.frameId!==0)return;
  (async()=>{
    const tab=await chrome.tabs.get(sender.tab.id);
    if(new URL(tab.url).origin!==new URL(sender.url).origin||await network.document(tab.id)!==sender.documentId)return {enabled:false};
    const key='cindy-video-'+tab.id;
    if(m.type==='cindy-video-state'){
      if(typeof m.enabled!=='boolean')return {enabled:false};
      if(await network.document(tab.id)!==sender.documentId)return {enabled:false};
      const marker=m.enabled?await videoIdentity(tab.url):null;
      if(m.enabled&&!marker)return {enabled:false};
      await sessionStore.set({[key]:marker});return {enabled:m.enabled};
    }
    const saved=(await sessionStore.get(key))[key];
    const marker=await videoIdentity(tab.url);
    if(!marker||saved!==marker){if(saved)await sessionStore.set({[key]:null});return {enabled:false};}
    return {enabled:true};
  })().then(reply).catch(()=>reply({enabled:false}));return true;
});
chrome.tabs.onRemoved.addListener(id=>{const key='cindy-video-'+id;if(sessionStore.remove)sessionStore.remove(key).catch(()=>{});else delete memory[key];});

chain();
