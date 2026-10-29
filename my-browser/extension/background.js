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
// Pages the agent opens live in one separate window of the user's browser, created without focus, so
// the user's own windows never gain tabs, switch tabs or lose focus. Remembered for the session.
let agentWindowId = null;
// Cindy's window must survive an extension reload or update (session storage does not), but window and
// group ids are reused after the browser restarts, so they are forgotten when the browser starts.
const agentStore = chrome.storage.local;
chrome.runtime.onStartup?.addListener(() => { agentWindowId = null; agentGroupId = null; agentTabs = null; quietlyForget(); });
function quietlyForget() { agentStore.remove?.(['agentWindow','agentGroup','agentTabs'])?.catch?.(() => {}); }
async function agentWindow() {
  if (agentWindowId == null) agentWindowId = (await agentStore.get('agentWindow')).agentWindow ?? null;
  if (agentWindowId != null) {
    try { await chrome.windows.get(agentWindowId); return agentWindowId; } catch { agentWindowId = null; await agentStore.set({agentWindow:null}); }
  }
  return null;
}
async function openInAgentWindow(url) {
  const windowId = await agentWindow();
  let tab;
  // If the user has Cindy's window open (to watch or to sign in), a new page must not jump in front of
  // what they are doing there: it opens behind. In the minimized window it simply becomes the shown tab.
  if (windowId != null) tab = await chrome.tabs.create({windowId,url,active:(await chrome.windows.get(windowId)).state === 'minimized'});
  else {
    // Minimized: the window never appears over what the user is doing; it waits in the Dock / taskbar.
    const lastFocused = () => Promise.resolve().then(() => chrome.windows.getLastFocused({windowTypes:['normal']})).catch(() => null);
    const before = await lastFocused();
    const created = await chrome.windows.create({url,state:'minimized',focused:false,type:'normal'});
    agentWindowId = created.id; await agentStore.set({agentWindow:created.id});
    // Some window managers (and headless Chrome) ignore minimized or focused:false: minimize again and give
    // the focus straight back to the window the user was in.
    await sleep(200);
    const now = await chrome.windows.get(created.id).catch(() => null);
    if (now && now.state !== 'minimized') await chrome.windows.update(created.id,{state:'minimized'}).catch(() => {});
    if (before && before.id !== created.id && (await lastFocused())?.id === created.id) await chrome.windows.update(before.id,{focused:true}).catch(() => {});
    tab = created.tabs?.[0] || (await chrome.tabs.query({windowId:created.id}))[0];
  }
  await groupAgentTab(tab);
  return tab;
}
const PAGE_ACCESS = {allowLocal:true};

// ── Showing the user what the agent works on ─────────────────────────────────────────────────
// Pages the agent opens sit in a "Cindy" tab group in Cindy's window. Any page the agent acts on,
// including the user's own tabs, shows a glow and label for a few seconds (drawn by the content
// script) and a badge on the toolbar icon for that tab.
let agentGroupId = null, uiLocale = null;
const groupTitle = () => uiLocale === 'zh-CN' ? 'Cindy 自动操作' : uiLocale === 'zh-TW' ? 'Cindy 自動操作' : 'Cindy automation';
// Turning tab groups on from the options page groups the pages already in Cindy's window too.
chrome.permissions?.onAdded?.addListener(async added => {
  if (!added.permissions?.includes('tabGroups')) return;
  const windowId = await agentWindow();
  if (windowId != null) for (const tab of await chrome.tabs.query({windowId})) await groupAgentTab(tab);
});
async function groupAgentTab(tab) {
  if (!chrome.tabGroups || !chrome.tabs.group || !tab?.id) return;
  try {
    if (agentGroupId == null) agentGroupId = (await agentStore.get('agentGroup')).agentGroup ?? null;
    let groupId = agentGroupId;
    if (groupId != null) { try { if ((await chrome.tabGroups.get(groupId)).windowId !== tab.windowId) groupId = null; } catch { groupId = null; } }
    groupId = await chrome.tabs.group({tabIds:[tab.id],...(groupId != null ? {groupId} : {createProperties:{windowId:tab.windowId}})});
    if (groupId !== agentGroupId) {
      agentGroupId = groupId; await agentStore.set({agentGroup:groupId});
      await chrome.tabGroups.update(groupId,{title:groupTitle(),color:'red'});
    }
  } catch {}
}
const agentMarkTimers = new Map();
// Pages Browser Use opened carry "Opened by Cindy" (in the page and as a toolbar badge) until the user
// acts on them with real input; then they are the user's tab and no longer reclaimed as idle.
let agentTabs = null;
async function loadAgentTabs() {
  if (!agentTabs) agentTabs = new Set((await agentStore.get('agentTabs')).agentTabs || []);
  return agentTabs;
}
const saveAgentTabs = () => agentStore.set({agentTabs:[...agentTabs]});
async function markAgentOpened(tabId) {
  (await loadAgentTabs()).add(tabId); await saveAgentTabs();
  quietly(() => chrome.action.setBadgeText({tabId,text:'AI'}));
  quietly(() => withDeadline(chrome.tabs.sendMessage(tabId,{type:'cindy-agent-mark',opened:true}),1500,Error('MARK_TIMEOUT')));
}
async function userTookOver(tabId) {
  if (!(await loadAgentTabs()).delete(tabId)) return;
  await saveAgentTabs();
  for (const rec of owned.values()) if (rec.id === tabId) rec.claimed = true;
  await remember();
  quietly(() => chrome.action.setBadgeText({tabId,text:null}));
}
const restingBadge = tabId => agentTabs?.has(tabId) ? 'AI' : null;
// Marks are a courtesy: a page without the content script, or a browser without these APIs, just goes unmarked.
const quietly = fn => Promise.resolve().then(fn).catch(() => {});
// Never wait forever on the browser: a stuck call would hold up every later job (the bridge then sees
// the extension as disconnected). The underlying call may still finish; its result is then dropped.
function withDeadline(promise,ms,error) {
  let timer;
  return Promise.race([promise,new Promise((_,reject) => { timer = setTimeout(() => reject(error),ms); })]).finally(() => clearTimeout(timer));
}
// mode: undefined shows (or extends) the mark, 'hidden' hides it for a capture, 'clear' ends it now.
function markAgentTab(tabId,mode) {
  const sent = quietly(() => withDeadline(chrome.tabs.sendMessage(tabId,{type:'cindy-agent-mark',...(mode === 'hidden' ? {hidden:true} : mode === 'clear' ? {clear:true} : {})}),1500,Error('MARK_TIMEOUT')));
  if (mode === 'clear') {
    clearTimeout(agentMarkTimers.get(tabId)); agentMarkTimers.delete(tabId);
    quietly(() => chrome.action.setBadgeText({tabId,text:restingBadge(tabId)}));
  } else if (!mode) {
    quietly(() => chrome.action.setBadgeText({tabId,text:'AI'}));
    clearTimeout(agentMarkTimers.get(tabId));
    agentMarkTimers.set(tabId,setTimeout(() => { agentMarkTimers.delete(tabId); quietly(() => chrome.action.setBadgeText({tabId,text:restingBadge(tabId)})); },20000));
  }
  return sent;
}

// ── Chrome's debugger, on demand ───────────────────────────────────────────────────────────
// An optional permission. Chrome lets the user grant it only by a click on the extension's own
// page, so the first action that needs it opens that page in the user's window. While attached,
// Chrome shows a notice bar in every window, so it is attached only for the action that needs
// it (PDF, full-page/element/background screenshots, recipe protocol sessions) and detached
// right after; a recipe session that goes quiet is detached by an idle timer.
const DEBUGGER_ACCESS = {permissions:['debugger']};
const DEBUGGER_IDLE_MS = 120000, DEBUGGER_EVENT_MAX = 5000;
const debugged = new Map();
let debuggerHooked = false;
async function debuggerAllowed() {
  try { return await chrome.permissions.contains(DEBUGGER_ACCESS); } catch { return false; }
}
const DEBUGGER_PROMPT_INTERVAL_MS = 10*60000;
// Opens the grant page at most once per interval, so a retrying agent cannot keep popping tabs.
async function debuggerDenied() {
  const last = (await sessionStore.get('debuggerPrompted')).debuggerPrompted || 0;
  let opened = false;
  if (Date.now()-last >= DEBUGGER_PROMPT_INTERVAL_MS) {
    await sessionStore.set({debuggerPrompted:Date.now()});
    opened = await openDebuggerPage().then(() => true,() => false);
  }
  return {...fail('DEBUGGER_NOT_ALLOWED',opened
    ? "This needs Chrome's debugger, which the user has not allowed yet. A page explaining it has just opened in the user's Chrome. Ask the user to click Turn on there (Chrome asks them to confirm), then retry. If they decline, do not retry."
    : "This needs Chrome's debugger, which the user has not allowed. The page to allow it was opened recently; ask the user to confirm it there before retrying. If they decline, do not retry."),grantPageOpened:opened};
}
async function openDebuggerPage() {
  // One of the user's own shown windows, never Cindy's (minimized) window.
  const agent = await agentWindow();
  const windows = (await chrome.windows.getAll({windowTypes:['normal']})).filter(w => w.id !== agent && w.state !== 'minimized');
  const win = windows.find(w => w.focused) || windows[0];
  await chrome.tabs.create({url:chrome.runtime.getURL('permissions.html?needed=1'),active:true,...(win ? {windowId:win.id} : {})});
}
const COOKIE_HEADER = /^(?:cookie|set-cookie2?)$/i;
const stripCookies = headers => headers && typeof headers === 'object' && !Array.isArray(headers) ? Object.fromEntries(Object.entries(headers).filter(([k]) => !COOKIE_HEADER.test(k))) : headers;
function withoutCookieHeaders(params) {
  if (!params || typeof params !== 'object') return params;
  const out = {...params};
  if (out.request && typeof out.request === 'object') {
    out.request = {...out.request,headers:stripCookies(out.request.headers)};
    if (out.request.postData?.length > 256000) out.request.postData = out.request.postData.slice(0,256000);
  }
  for (const key of ['response','redirectResponse']) if (out[key] && typeof out[key] === 'object') out[key] = {...out[key],headers:stripCookies(out[key].headers),requestHeaders:stripCookies(out[key].requestHeaders)};
  return out;
}
function hookDebugger() {
  if (debuggerHooked || !chrome.debugger) return;
  debuggerHooked = true;
  chrome.debugger.onEvent.addListener((source,method,params) => {
    const state = debugged.get(source.tabId);
    // *ExtraInfo events exist only to carry raw Cookie / Set-Cookie headers, including those of other
    // sites the page talks to; recipes never need them.
    if (!state?.recording || !method.startsWith('Network.') || method.endsWith('ExtraInfo')) return;
    if (state.events.length >= DEBUGGER_EVENT_MAX) { state.dropped++; return; }
    state.events.push([method,withoutCookieHeaders(params)]);
  });
  // The user can end a session from Chrome's notice bar; the next command then reports it.
  chrome.debugger.onDetach.addListener(source => { const state = debugged.get(source.tabId); if (state) { clearTimeout(state.timer); debugged.delete(source.tabId); } });
}
async function debuggerAttach(tabId) {
  if (!chrome.debugger) throw Object.assign(new Error('DEBUGGER_UNAVAILABLE'),{detail:'Reload the Cindy extension once after allowing the debugging feature.'});
  hookDebugger();
  let state = debugged.get(tabId);
  if (!state) {
    try { await chrome.debugger.attach({tabId},'1.3'); }
    catch (e) { if (!/already attached/i.test(e.message)) throw Object.assign(new Error('DEBUGGER_ATTACH_FAILED'),{detail:e.message}); }
    state = {holds:0,events:[],dropped:0,recording:false,timer:null};
    debugged.set(tabId,state);
  }
  state.holds++; clearTimeout(state.timer);
  return state;
}
async function debuggerDetach(tabId,all = false) {
  const state = debugged.get(tabId);
  if (!state) return;
  state.holds = all ? 0 : Math.max(0,state.holds-1);
  if (state.holds) return;
  clearTimeout(state.timer); debugged.delete(tabId);
  try { await chrome.debugger.detach({tabId}); } catch {}
}
async function withDebugger(tabId,fn,effects = false) {
  await debuggerAttach(tabId);
  try { return await fn((method,params = {}) => withDeadline(chrome.debugger.sendCommand({tabId},method,params),20000,Error('The browser did not answer '+method+' within 20 s (the page may not be rendering).'))); }
  catch (e) { throw Object.assign(new Error('DEBUGGER_COMMAND_FAILED'),{detail:e.message,execution:effects ? 'unknown' : 'not_executed'}); }
  finally { await debuggerDetach(tabId); }
}
function debuggerFailure(e) {
  if (e.message === 'DEBUGGER_ATTACH_FAILED') return fail('DEBUGGER_ATTACH_FAILED','Chrome refused to attach the debugger to this tab (DevTools or another debugger may be attached): '+String(e.detail || '').slice(0,300));
  if (e.message === 'DEBUGGER_UNAVAILABLE') return fail('DEBUGGER_UNAVAILABLE',e.detail);
  if (e.message === 'DEBUGGER_COMMAND_FAILED') return e.execution === 'unknown' ? fail('DEBUGGER_COMMAND_FAILED','Chrome could not confirm this through the debugger, so it may have run. Check the page before repeating it: '+String(e.detail || '').slice(0,300),'unknown') : fail('DEBUGGER_COMMAND_FAILED','Chrome could not complete this through the debugger: '+String(e.detail || '').slice(0,300));
  return null;
}
// evaluate on a page whose Content Security Policy blocks Cindy's scripts: the debugger is not subject to it.
async function debuggerEvaluate(tabId,a) {
  const expression = '(async () => { let value = ('+a.fn+'); if (typeof value === "function") value = await value('+JSON.stringify(a.arg ?? null)+'); else if (value && typeof value.then === "function") value = await value; return value; })()';
  const out = await withDebugger(tabId,send => send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true}),true);
  if (out.exceptionDetails) return fail('EVAL_FAILED',String(out.exceptionDetails.exception?.description || out.exceptionDetails.text || 'Script failed').slice(0,2000),'unknown');
  let result = out.result?.value ?? null, json;
  try { json = JSON.stringify(result); } catch { json = null; }
  if (json && json.length > 200000) result = {truncated:true,json:json.slice(0,200000)};
  return {ok:true,execution:'executed',tabId,result,viaDebugger:true};
}
// Recipe protocol sessions: one attachment per tab, events buffered between commands.
// Cookie commands read only the site of the tab being operated on (see policy.js `site`), and never a
// site on the user's read block list: Network.getCookies must name pages of that site, and both
// results are filtered to it. Storage.getCookies would otherwise return every cookie of the profile.
const COOKIE_METHODS = ['Network.getCookies','Storage.getCookies'];
async function cdpAction(tab,a,policy) {
  const tabId = tab.id;
  if (a.op === 'begin') {
    const state = await debuggerAttach(tabId);
    state.recording = true;
    state.timer = setTimeout(() => debuggerDetach(tabId,true),DEBUGGER_IDLE_MS);
    return {ok:true,execution:'executed',tabId};
  }
  const state = debugged.get(tabId);
  if (a.op === 'end') { await debuggerDetach(tabId,true); return {ok:true,execution:'executed',tabId}; }
  if (!state) return fail('DEBUGGER_DETACHED','The debugging session ended (idle, closed tab, or the user stopped it from Chrome\'s notice bar). Start the recipe again.');
  clearTimeout(state.timer);
  state.timer = setTimeout(() => debuggerDetach(tabId,true),DEBUGGER_IDLE_MS);
  let result;
  if (a.op === 'command') {
    if (!P.CDP_METHODS.includes(a.method)) return fail('CDP_METHOD_NOT_ALLOWED','cdp command '+String(a.method).slice(0,100)+' is not available to site recipes.');
    let params = a.params || {};
    if (a.method === 'Network.getCookies') {
      if (!Array.isArray(params.urls) || !params.urls.length || !params.urls.every(url => P.cookieUrlAllowed(policy,tab.url,url))) return fail('COOKIES_NOT_ALLOWED','Network.getCookies reads only cookies of the site of this tab: pass params.urls with pages of that site. Cookies of other sites, or of sites blocked from reading, are not available.');
      params = {urls:params.urls};
    } else if (a.method === 'Storage.getCookies') params = {};
    try { result = await withDeadline(chrome.debugger.sendCommand({tabId},a.method,params),30000,Error('The browser did not answer '+a.method+' within 30 s.')); }
    catch (e) { return {...fail('CDP_COMMAND_FAILED',String(e.message || e).slice(0,500),'unknown'),events:state.events.splice(0)}; }
    if (COOKIE_METHODS.includes(a.method)) result = {cookies:(Array.isArray(result?.cookies) ? result.cookies : []).filter(c => P.cookieHostAllowed(policy,tab.url,c?.domain))};
  }
  const events = state.events.splice(0), dropped = state.dropped; state.dropped = 0;
  return {ok:true,execution:'executed',tabId,...(a.op === 'command' ? {result: result ?? {}} : {}),events,...(dropped ? {droppedEvents:dropped} : {})};
}
async function debuggerAccess(a) {
  if (a.open) await openDebuggerPage();
  return {ok:true,execution:a.open ? 'executed' : 'not_executed',granted:await debuggerAllowed(),attachedTabs:debugged.size};
}
// Element or full-page screenshot, or a tab that is not visible: rendered by the debugger.
async function debuggerScreenshot(tab,a) {
  let clip;
  if (a.ref || a.selector) {
    const documentId = await network.document(tab.id,PAGE_ACCESS);
    const out = await chrome.scripting.executeScript({target:{tabId:tab.id,documentIds:[documentId]},world:'ISOLATED',func:(ref,selector) => {
      const snapshot = globalThis.__myBrowserSnapshot;
      const el = ref ? (snapshot?.url === location.href ? snapshot.refs.get(ref) : null) : document.querySelector(selector);
      if (!el || !el.isConnected) return null;
      const r = el.getBoundingClientRect();
      return {x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height};
    },args:[a.ref || null,a.selector || null]});
    const rect = out?.[0]?.documentId === documentId ? out[0].result : null;
    if (!rect) return fail('STALE_REF','The element is gone. Take a new snapshot.');
    if (rect.width < 1 || rect.height < 1) return fail('ELEMENT_NOT_VISIBLE','The element has no visible size.');
    clip = {x:rect.x,y:rect.y,width:Math.min(rect.width,16384),height:Math.min(rect.height,16384),scale:1};
  }
  const format = a.type === 'jpeg' ? 'jpeg' : 'png';
  await markAgentTab(tab.id,'hidden');
  // A minimized window renders nothing, so even the debugger cannot capture it: show Cindy's window
  // unfocused for the capture only.
  const win = await chrome.windows.get(tab.windowId);
  const reminimize = win.state === 'minimized' && tab.windowId === agentWindowId;
  if (reminimize) { await chrome.windows.update(tab.windowId,{state:'normal',focused:false}); await sleep(300); }
  const shot = await withDebugger(tab.id,async send => {
    if (a.fullPage && !clip) {
      const metrics = await send('Page.getLayoutMetrics');
      const size = metrics.cssContentSize || metrics.contentSize;
      clip = {x:0,y:0,width:Math.min(Math.ceil(size.width),16384),height:Math.min(Math.ceil(size.height),16384),scale:1};
    }
    return send('Page.captureScreenshot',{format,...(format === 'jpeg' ? {quality:85} : {}),...(clip ? {clip,captureBeyondViewport:true} : {}),fromSurface:true});
  }).finally(() => reminimize && chrome.windows.update(tab.windowId,{state:'minimized'}).catch(() => {}));
  markAgentTab(tab.id);
  return {ok:true,execution:'executed',tabId:tab.id,mimeType:'image/'+format,data:shot.data,bytes:Math.floor(shot.data.length*3/4),viaDebugger:true};
}
async function connection(state) {
  await sessionStore.set({connection:{...state,version:VERSION,browser:family,clientId}});
  await chrome.action.setBadgeText({text:state.connected ? '' : '!'});
  await chrome.action.setBadgeBackgroundColor({color:state.connected ? '#287ad7' : '#b87820'});
}
// One id per browser launch: storage.session survives the worker restarting but is cleared when the
// browser restarts. Cindy drops the tab handles it remembered for this browser when the id changes,
// because tab ids start over after a restart and an old handle could reach a restored tab.
let browserBoot;
function bootId() {
  try {
    return browserBoot ??= chrome.storage.session.get('cindyBrowserBoot').then(r => {
      if (typeof r?.cindyBrowserBoot === 'string') return r.cindyBrowserBoot;
      const id = crypto.randomUUID();
      return chrome.storage.session.set({cindyBrowserBoot:id}).then(() => id,() => id);
    }).catch(() => '');
  } catch { return Promise.resolve(''); } // No session storage: connect without a launch id.
}
async function fetchJSON(base,path,session,body,timeout = 5000,version = wireVersion,auth = {}) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(),timeout);
  const boot = await bootId();
  try {
    const response = await fetch(base+path,{method:body === undefined ? 'GET' : 'POST',
      headers:{...(boot ? {'X-My-Browser-Boot':boot} : {}),'X-My-Browser-Extension':chrome.runtime.id,'X-My-Browser-Origin':chrome.runtime.getURL('').replace(/\/$/,''),'X-My-Browser-Client':clientId,'X-My-Browser-Family':family,'X-My-Browser-Version':version,'X-My-Browser-Installed-Version':VERSION,...(auth.publicKey ? {'X-My-Browser-Key':auth.publicKey} : {}),...(auth.learningChallenge ? {'X-My-Browser-Learning-Challenge':auth.learningChallenge} : {}),...(auth.proof ? {'X-My-Browser-Proof':auth.proof} : {}),...(session ? {'X-My-Browser-Session':session} : {}),...(body === undefined ? {} : {'Content-Type':'application/json'})},
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
chrome.tabs.onRemoved.addListener(id => { restore.then(() => release(id)); if (agentTabs?.delete(id)) saveAgentTabs().catch(() => {}); });
chrome.tabs.onActivated.addListener(({tabId,windowId}) => { restore.then(async () => {
  // Switching tabs inside Cindy's own window is the agent's doing, not the user claiming a page.
  if (windowId != null && windowId === agentWindowId) return;
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
      onNavigate(); // Even a rejected browser response cannot prove the request never started.
      tab = await openInAgentWindow(url);
    }
    rec = {id:tab.id,actualUrl:tab.url || url,created:!existing,claimed:existing,loading:!existing || tab.status !== 'complete',used:Date.now()};
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
    if (action === 'upload') {
      // File inputs are often hidden behind a styled button: accept the input, a control containing it,
      // or the page's only file input.
      const only = document.querySelectorAll('input[type=file]');
      const input = el && el.matches('input[type=file]') ? el : el?.querySelector('input[type=file]') || el?.closest('form')?.querySelector('input[type=file]') || (only.length === 1 ? only[0] : null);
      if (!input) return fail('INVALID_ELEMENT','Choose the file input or a control that contains it.');
      if (!input.multiple && a.files.length > 1) return fail('SINGLE_FILE_INPUT','This file input accepts one file.');
      const transfer = new DataTransfer();
      for (const f of a.files) {
        const binary = atob(f.data), bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        transfer.items.add(new File([bytes],f.name,{type:f.mimeType || ''}));
      }
      started = true; input.files = transfer.files;
      input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true}));
      return {ok:true,execution:'executed',url:location.href,kind:'upload',files:[...input.files].map(f => ({name:f.name,size:f.size}))};
    }
    if (action === 'clickCoords' || action === 'drag') {
      const button = a.button === 'right' ? 2 : a.button === 'middle' ? 1 : 0;
      const mods = new Set(a.modifiers || []), mac = /Mac/.test(navigator.platform);
      const keys = {altKey:mods.has('Alt'),shiftKey:mods.has('Shift'),ctrlKey:mods.has('Control') || (!mac && mods.has('ControlOrMeta')),metaKey:mods.has('Meta') || (mac && mods.has('ControlOrMeta'))};
      const fire = (type,p,target,extra = {}) => {
        const Ctor = type.startsWith('pointer') ? PointerEvent : type.startsWith('drag') || type === 'drop' ? DragEvent : MouseEvent;
        target.dispatchEvent(new Ctor(type,{bubbles:true,cancelable:true,composed:true,clientX:p.x,clientY:p.y,button,buttons:type.endsWith('up') ? 0 : 1,view:window,...keys,...extra}));
      };
      const point = (ref,selector,x,y) => {
        const node = ref ? (snapshot?.url === location.href ? snapshot.refs.get(ref) : null) : selector ? document.querySelector(selector) : null;
        if ((ref || selector) && (!node || !node.isConnected)) return null;
        if (!node) return {x,y};
        node.scrollIntoView?.({block:'center',inline:'center'});
        const r = node.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2};
      };
      if (action === 'clickCoords') {
        // A ref or selector clicks the element's centre (double, right and modified clicks on elements).
        const p = el ? point(a.ref,a.selector) : {x:a.x,y:a.y}, target = document.elementFromPoint(p.x,p.y);
        if (!target) return fail('ELEMENT_NOT_FOUND','Nothing is at those coordinates in the visible viewport.');
        started = true;
        for (const type of ['pointerdown','mousedown','pointerup','mouseup']) fire(type,p,target);
        if (button === 2) fire('contextmenu',p,target);
        else { fire('click',p,target); if (a.doubleClick) { fire('click',p,target); fire('dblclick',p,target); } }
        target.focus?.();
        return {ok:true,execution:'executed',url:location.href,kind:'clickCoords',target:(target.tagName || '').toLowerCase(),note:'Synthetic pointer events; sites that require trusted input may ignore them.'};
      }
      const from = point(a.startRef,a.startSelector,a.startX,a.startY), to = point(a.endRef,a.endSelector,a.endX,a.endY);
      if (!from || !to) return fail('STALE_REF','A drag endpoint is stale. Take a new snapshot.');
      const source = document.elementFromPoint(from.x,from.y), dest = document.elementFromPoint(to.x,to.y);
      if (!source || !dest) return fail('ELEMENT_NOT_FOUND','A drag endpoint is outside the visible viewport.');
      started = true;
      const data = new DataTransfer();
      fire('pointerdown',from,source); fire('mousedown',from,source); fire('dragstart',from,source,{dataTransfer:data});
      for (let i = 1; i <= 8; i++) {
        const p = {x:from.x+(to.x-from.x)*i/8,y:from.y+(to.y-from.y)*i/8}, over = document.elementFromPoint(p.x,p.y) || dest;
        fire('pointermove',p,over); fire('mousemove',p,over); fire('dragover',p,over,{dataTransfer:data});
      }
      fire('drop',to,dest,{dataTransfer:data}); fire('dragend',to,source,{dataTransfer:data}); fire('pointerup',to,dest); fire('mouseup',to,dest);
      return {ok:true,execution:'executed',url:location.href,kind:'drag',note:'Synthetic pointer and drag events; sites that require trusted input may ignore them.'};
    }
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
// Tab-level actions: no page script. Returns null for actions that run inside the page.
const TAB_ACTIONS = new Set(['focus','close','resize','pdf','cdp','screenshot','wait']);
const MAIN_WORLD_ACTIONS = new Set(['evaluate','console','requests','responseBody','dialog']);
async function tabAction(job,tab,policy) {
  const a = job.payload;
  if (job.action === 'focus') {
    // Nothing the agent does may change what the user is looking at: no tab switch in the user's
    // windows and no window brought to the front. In Cindy's own window, focus shows the page there and
    // asks for attention (the browser icon flashes) so the user can find it for a sign-in.
    if (tab.windowId !== await agentWindow()) return fail('USER_WINDOW',"This tab is in a window the user is using; switching to it would change what they see. Ask the user to look at it, or open the page with open (it goes to Cindy's own window).");
    await chrome.tabs.update(tab.id,{active:true});
    await chrome.windows.update(tab.windowId,{drawAttention:true}).catch(() => {});
    return {ok:true,execution:'executed',tabId:tab.id,handoff:true};
  }
  if (job.action === 'close') {
    await chrome.tabs.remove(tab.id); await release(tab.id);
    return {ok:true,execution:'executed',tabId:tab.id};
  }
  if (job.action === 'resize') {
    if (tab.windowId !== await agentWindow()) return fail('USER_WINDOW',"Resizing would change a window the user is using. Open the page with open; it goes to Cindy's own window, which can be resized.");
    await chrome.windows.update(tab.windowId,{width:Math.round(a.width),height:Math.round(a.height),state:'normal'});
    return {ok:true,execution:'executed',tabId:tab.id,width:Math.round(a.width),height:Math.round(a.height)};
  }
  if (job.action === 'pdf') {
    if (!await debuggerAllowed()) return await debuggerDenied();
    const printed = await withDebugger(tab.id,send => send('Page.printToPDF',{printBackground:true}));
    return {ok:true,execution:'executed',tabId:tab.id,mimeType:'application/pdf',data:printed.data,bytes:Math.floor(printed.data.length*3/4)};
  }
  if (job.action === 'cdp') {
    if (!await debuggerAllowed()) return await debuggerDenied();
    return cdpAction(tab,a,policy);
  }
  if (job.action === 'screenshot') {
    const inCindyWindow = tab.windowId === await agentWindow();
    const userWindowBackground = !tab.active && !inCindyWindow;
    const hiddenInCindyWindow = inCindyWindow && (!tab.active || (await chrome.windows.get(tab.windowId)).state === 'minimized');
    const allowed = (a.fullPage || a.ref || a.selector || userWindowBackground || hiddenInCindyWindow) && await debuggerAllowed();
    if (allowed) return debuggerScreenshot(tab,a);
    // Chrome captures the visible tab of a window. Tabs in Cindy's own window are brought to the front
    // there; a background tab in one of the user's windows is not, because that would change their view.
    if (!tab.active) {
      if (userWindowBackground) return fail('TAB_NOT_VISIBLE',"This tab is behind another tab in a window the user is using. Capturing it would switch the user's view. Open the page with open (it goes to Cindy's own window). Once the user has allowed Chrome's debugger for Cindy (it is requested when PDF or a recipe first needs it), background tabs are captured without switching.");
      await chrome.tabs.update(tab.id,{active:true}); await sleep(300);
    }
    const win = await chrome.windows.get(tab.windowId);
    // Without the debugger, Chrome can only capture a shown window: Cindy's minimized window is shown
    // unfocused just for the capture and minimized again right after.
    let reminimize = false;
    if (win.state === 'minimized') {
      if (tab.windowId !== agentWindowId) return fail('TAB_NOT_VISIBLE','The window is minimized. Restore it first if the user agrees.');
      await chrome.windows.update(tab.windowId,{state:'normal',focused:false}); await sleep(300); reminimize = true;
    }
    const format = a.type === 'jpeg' ? 'jpeg' : 'png';
    // Chrome allows two captures per second; a quick follow-up waits for the next slot instead of failing.
    // Cindy's own activity mark is hidden for the capture so the agent sees the page as it is.
    await markAgentTab(tab.id,'hidden');
    let dataUrl;
    try {
      for (let attempt = 0; ; attempt++) {
        try { dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId,{format,...(format === 'jpeg' ? {quality:85} : {})}); break; }
        catch (e) { if (attempt >= 3 || !/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/.test(e.message)) throw e; await sleep(550); }
      }
    } finally {
      if (reminimize) await chrome.windows.update(tab.windowId,{state:'minimized'}).catch(() => {});
    }
    markAgentTab(tab.id);
    const data = dataUrl.slice(dataUrl.indexOf(',')+1);
    const partial = a.fullPage || a.ref || a.selector;
    return {ok:true,execution:'executed',tabId:tab.id,mimeType:'image/'+format,data,bytes:Math.floor(data.length*3/4),
      ...(partial ? {note:"Only the visible area was captured. Full-page and element screenshots use Chrome's debugger, which the user has not allowed; scroll and capture again, or use pdf for the whole page (it asks the user to allow the debugger)."} : {})};
  }
  if (job.action === 'wait') {
    const deadline = Date.now()+Math.min(a.timeoutMs ?? 30000,120000);
    if (a.timeMs) await sleep(Math.min(a.timeMs,120000));
    const probe = {selector:a.selector,text:a.text,textGone:a.textGone,loadState:a.loadState};
    const needsPage = probe.selector || probe.text || probe.textGone || probe.loadState;
    for (;;) {
      const current = await chrome.tabs.get(tab.id);
      let met = !a.urlIncludes || (current.url || '').includes(a.urlIncludes);
      if (met && needsPage) {
        try {
          const documentId = await network.document(current.id,PAGE_ACCESS);
          const out = await chrome.scripting.executeScript({target:{tabId:current.id,documentIds:[documentId]},world:'ISOLATED',func:waitProbe,args:[probe]});
          met = out?.[0]?.documentId === documentId && out[0].result === true;
        } catch { met = false; }
      }
      if (met) return {ok:true,execution:'executed',tabId:current.id,url:P.redactUrl(current.url)};
      if (Date.now() >= deadline) return fail('WAIT_TIMEOUT','The condition was not met before the timeout.','executed');
      await sleep(250);
    }
  }
  return null;
}
// Runs in the page (ISOLATED world) for each wait poll; serialized by executeScript.
function waitProbe(c) {
  if (c.loadState === 'domcontentloaded' && document.readyState === 'loading') return false;
  if (c.loadState === 'load' && document.readyState !== 'complete') return false;
  if (c.loadState === 'networkidle') {
    if (document.readyState !== 'complete') return false;
    const ends = performance.getEntriesByType('resource').map(e => e.responseEnd || e.startTime);
    if (ends.length && performance.now()-Math.max(...ends) < 500) return false;
  }
  if (c.selector) {
    const el = document.querySelector(c.selector); if (!el) return false;
    const style = getComputedStyle(el), r = el.getBoundingClientRect();
    if (style.display === 'none' || style.visibility === 'hidden' || !(r.width || r.height)) return false;
  }
  const text = document.body ? document.body.innerText : '';
  if (c.text && !text.includes(c.text)) return false;
  if (c.textGone && text.includes(c.textGone)) return false;
  return true;
}
async function mainWorldAction(job,tabId,documentId) {
  const out = await chrome.scripting.executeScript({target:{tabId,documentIds:[documentId]},world:'MAIN',func:mainWorldOperation,args:[job.action,job.payload]});
  const result = out?.[0]?.documentId === documentId ? out[0].result : null;
  if (!result) return fail('NO_PAGE_RESULT','Chrome returned no result. Check the page before repeating it.','unknown');
  if (Array.isArray(result.requests)) result.requests = result.requests.map(r => ({...r,url:P.redactUrl(String(r.url)).slice(0,LINK_URL_MAX)}));
  if (result.response?.url) result.response.url = P.redactUrl(result.response.url);
  return {...result,tabId};
}
// Runs in the page's own JavaScript context (MAIN world). Page tools are kept on a symbol so a second
// call finds the hooks the first one installed. Everything returned must be JSON-serializable.
async function mainWorldOperation(action,a) {
  const KEY = Symbol.for('cindy.pageTools');
  const tools = window[KEY] || (window[KEY] = {console:[],dialogs:[],dialogMode:null,consoleHooked:false,dialogHooked:false});
  const plain = (value,max) => {
    let json; try { json = JSON.stringify(value === undefined ? null : value); } catch { return {unserializable:true,text:String(value).slice(0,max)}; }
    if (json === undefined) return null;
    return json.length > max ? {truncated:true,json:json.slice(0,max)} : JSON.parse(json);
  };
  if (action === 'evaluate') {
    let value;
    // Only a refusal while the expression is being compiled means nothing ran (the page's Content Security
    // Policy rejects eval before executing anything). Once the function runs, any failure may follow side effects.
    try { value = (0,eval)('('+a.fn+')'); }
    catch (e) {
      const blocked = e instanceof EvalError || /Content Security Policy|unsafe-eval/i.test(String(e && e.message));
      return blocked
        ? {ok:false,error:'EVAL_BLOCKED_BY_PAGE',message:"This page's Content Security Policy blocks scripts from Cindy. Use snapshot, extract and the other actions on this page.",execution:'not_executed'}
        : {ok:false,error:'EVAL_FAILED',message:String(e && e.message || e).slice(0,2000),execution:'unknown'};
    }
    try {
      if (typeof value === 'function') value = await value(a.arg);
      else if (value && typeof value.then === 'function') value = await value;
      return {ok:true,execution:'executed',result:plain(value,200000)};
    } catch (e) {
      return {ok:false,error:'EVAL_FAILED',message:String(e && e.message || e).slice(0,2000),execution:'unknown'};
    }
  }
  if (action === 'console') {
    if (!tools.consoleHooked) {
      tools.consoleHooked = true;
      const push = (type,text) => { tools.console.push({type,text:String(text).slice(0,2000),time:Date.now()}); if (tools.console.length > 500) tools.console.shift(); };
      for (const level of ['log','info','warn','error','debug']) {
        const original = console[level];
        console[level] = function(...args) {
          try { push(level,args.map(x => { try { return typeof x === 'string' ? x : JSON.stringify(x); } catch { return String(x); } }).join(' ')); } catch {}
          return original.apply(this,args);
        };
      }
      addEventListener('error',e => push('pageerror',e.message || e.error));
      addEventListener('unhandledrejection',e => push('pageerror','Unhandled rejection: '+(e.reason && e.reason.message || e.reason)));
      return {ok:true,execution:'executed',messages:[],note:'Console capture started now; messages logged before this call are not available. Call console again to read new messages.'};
    }
    return {ok:true,execution:'executed',messages:tools.console.splice(0)};
  }
  if (action === 'requests') {
    const entries = [...performance.getEntriesByType('navigation'),...performance.getEntriesByType('resource')];
    let rows = entries.map(e => ({url:e.name,type:e.initiatorType || 'navigation',...(e.responseStatus ? {status:e.responseStatus} : {}),durationMs:Math.round(e.duration),...(e.transferSize ? {bytes:e.transferSize} : {}),startMs:Math.round(e.startTime)}));
    if (a.filter) rows = rows.filter(r => r.url.includes(a.filter));
    if (a.clear) performance.clearResourceTimings();
    const limited = rows.slice(-300);
    return {ok:true,execution:'executed',requests:limited,truncated:rows.length > limited.length,note:"From the page's resource timing; methods and headers are not available in the user's browser."};
  }
  if (action === 'responseBody') {
    try {
      const response = await fetch(a.requestUrl,{credentials:'include'});
      const text = await response.text(), max = a.maxChars || 30000;
      return {ok:true,execution:'executed',response:{url:a.requestUrl,status:response.status,mimeType:response.headers.get('content-type') || '',body:text.slice(0,max),truncated:text.length > max,refetched:true}};
    } catch (e) {
      return {ok:false,error:'FETCH_FAILED',message:String(e && e.message || e).slice(0,500),execution:'unknown'};
    }
  }
  if (action === 'dialog') {
    if (!tools.dialogHooked) {
      tools.dialogHooked = true;
      const native = {alert:window.alert,confirm:window.confirm,prompt:window.prompt};
      const answer = (type,message,fallback) => {
        const mode = tools.dialogMode;
        tools.dialogs.push({type,message:String(message ?? '').slice(0,4000),time:Date.now(),answered:!!mode});
        if (tools.dialogs.length > 50) tools.dialogs.shift();
        if (!mode) return native[type].call(window,message,fallback);
        tools.dialogMode = null;
        if (type === 'alert') return undefined;
        if (type === 'confirm') return !!mode.accept;
        return mode.accept ? (mode.promptText ?? fallback ?? '') : null;
      };
      window.alert = message => answer('alert',message);
      window.confirm = message => answer('confirm',message);
      window.prompt = (message,fallback) => answer('prompt',message,fallback);
    }
    if (typeof a.accept === 'boolean') tools.dialogMode = {accept:a.accept,promptText:a.promptText};
    return {ok:true,execution:'executed',armed:typeof a.accept === 'boolean',recent:tools.dialogs.slice(-10),note:'The next alert, confirm or prompt from this page is answered as requested. A dialog that is already open must be answered by the user.'};
  }
  return {ok:false,error:'INVALID_ACTION',message:'Unsupported page action.',execution:'not_executed'};
}
async function handle(job,policy,target) {
  // Validation messages are fixed policy text; say which rule refused the job.
  try { P.validate(job.action,job.payload); } catch (e) { return fail('INVALID_JOB',String(e.message || 'The browser job was invalid.').slice(0,300)+' No action was executed.'); }
  const gate = P.check(policy,job.action,job.payload.url);
  if (!gate.ok) return gate;
  if (job.action === 'debuggerAccess') return debuggerAccess(job.payload);
  // The agent's task stopped: end its mark on this tab now instead of waiting for it to fade.
  if (job.action === 'unmark') { await markAgentTab(job.payload.tabId,'clear'); return {ok:true,execution:'executed',tabId:job.payload.tabId}; }
  if (job.action === 'tabs') {
    const tabs = (await chrome.tabs.query({})).filter(t => /^https?:/.test(t.url || '') && (!job.payload.host || (P.check(policy,'text',t.url).ok && P.matches(new URL(t.url).hostname,P.normalizeHost(job.payload.host)))));
    const records=[];let remaining=30000,truncated=false;
    for (const t of tabs) {
      let metadata,diagnostic;
      if(P.check(policy,'text',t.url).ok)try {
        const documentId=await network.document(t.id,PAGE_ACCESS);
        const out=await chrome.scripting.executeScript({target:{tabId:t.id,documentIds:[documentId]},world:'ISOLATED',func:()=>({url:location.href,title:document.title.slice(0,160)})});
        if(out?.[0]?.documentId===documentId && P.check(policy,'text',out[0].result?.url).ok)metadata=out[0].result;
      }catch(e){diagnostic={error:e.message==='ADDRESS_UNVERIFIED'?'ADDRESS_UNVERIFIED':'TAB_ACCESS_FAILED',...(e.message==='ADDRESS_UNVERIFIED'?{reason:e.reason}: {})};}
      if(job.payload.host && diagnostic?.reason==='LOCAL_ADDRESS')continue;
      if(job.payload.host && metadata && !P.matches(new URL(metadata.url).hostname,P.normalizeHost(job.payload.host)))continue;
      if (records.length>=(job.payload.limit || 20)) {truncated=true;break;}
      // Keep denied/unobserved tabs visible as bounded diagnostics. Never read
      // their title or expose their URL merely to make the list look complete.
      const row=metadata ? {id:t.id,window:t.windowId,...(t.windowId===agentWindowId?{cindyWindow:true}:{}),title:metadata.title,...(metadata.url.length<=8192 ? {url:P.redactUrl(metadata.url)} : {url_omitted:true}),active:t.active,status:t.status} : {id:t.id,redacted:true,status:t.status,...diagnostic};
      const size=JSON.stringify(row).length;if (size>remaining) {truncated=true;break;}
      records.push(row);remaining-=size;
    }
    return {ok:true,tabs:records,truncated};
  }
  let injecting = false, navigating = false;
  const failureState = () => navigating || (injecting && P.INTERACT.includes(job.action)) ? 'unknown' : 'not_executed';
  // The last authorization check before the browser is touched, registered as a dispatch: a permission
  // revoked after the acknowledgement refuses the action here, and a revocation that arrives later waits for it.
  const authorizeDispatch = async url => {
    const authorization = await fetchJSON(target.base,'/authorize',target.session,{id:job.id,url:String(url).slice(0,PAGE_URL_MAX),dispatch:true});
    policy = P.normalizePolicy(authorization.policy);
    return P.check(policy,job.action,url);
  };
  try {
    if (job.action === 'open') {
      // A new page always goes to Cindy's own background window, never into the user's windows.
      const openGate = await authorizeDispatch(job.payload.url);
      if (!openGate.ok) return {...openGate,execution:'not_executed'};
      navigating = true;
      const created = await openInAgentWindow(job.payload.url);
      let loaded = created;
      try { loaded = await waitForLoad(created.id); } catch { loaded = await chrome.tabs.get(created.id).catch(() => null); }
      // The tab can be closed while it loads, by the user or the site; say so instead of a generic failure.
      if (!loaded) return fail('TAB_CLOSED','The new tab was closed before it finished loading, by the user or the site. Ask the user before opening it again.','executed');
      // The ledger is keyed by URL: opening an address again must not drop the record of the earlier tab,
      // or that tab could never be reclaimed when idle.
      const ownedKey = canonical(job.payload.url), earlier = owned.get(ownedKey);
      if (earlier && earlier.id !== created.id) { owned.delete(ownedKey); owned.set(ownedKey+'#cindy-tab-'+earlier.id,earlier); }
      owned.set(canonical(job.payload.url),{id:created.id,actualUrl:loaded.url || job.payload.url,created:true,claimed:false,loading:false,used:Date.now()}); await remember();
      if (loaded.url && !P.check(policy,'open',loaded.url).ok) return fail('REDIRECT_BLOCKED','The page moved to a blocked site.','executed');
      markAgentTab(created.id); await markAgentOpened(created.id);
      return {ok:true,execution:'executed',tabId:created.id,window:created.windowId,url:loaded.url ? P.redactUrl(loaded.url) : undefined,title:(loaded.title || '').slice(0,300),status:loaded.status};
    }
    let tab;
    if (Number.isInteger(job.payload.tabId)) {
      // Addressed by tab id (tabs/open): any tab of the user's browser, including local pages.
      tab = await getTab(job.payload.tabId);
      if (!tab) return fail('TAB_CLOSED','The tab is closed. List tabs again.');
      if (!P.check(policy,job.action,tab.url).ok) return P.check(policy,job.action,tab.url);
      if (job.action === 'navigate') {
        // The final check covers the address about to be loaded; the current page was checked above.
        const navigateGate = await authorizeDispatch(job.payload.url);
        if (!navigateGate.ok) return {...navigateGate,execution:'not_executed'};
        navigating = true;
        await chrome.tabs.update(tab.id,{url:job.payload.url});
        try { tab = await waitForLoad(tab.id); } catch { tab = await chrome.tabs.get(tab.id); }
        if (!P.check(policy,'navigate',tab.url).ok) return fail('REDIRECT_BLOCKED','The page moved to a blocked site.','executed');
        markAgentTab(tab.id);
        return {ok:true,execution:'executed',tabId:tab.id,url:P.redactUrl(tab.url),title:(tab.title || '').slice(0,300)};
      }
    } else {
      network.assertSupported?.(job.payload.url,PAGE_ACCESS);
      tab = await ensureTab(job.payload.url,policy,job.action,() => { navigating = true; });
    }
    const actual = await chrome.tabs.get(tab.id);
    if (!['close','screenshot','pdf'].includes(job.action)) markAgentTab(actual.id);
    // Tab-level actions need no page script: answer them before injecting anything.
    if (TAB_ACTIONS.has(job.action)) {
      const tabGate = await authorizeDispatch(actual.url);
      if (!tabGate.ok) return {...tabGate,execution:'not_executed'};
    }
    const direct = await tabAction(job,actual,policy);
    if (direct) return direct;
    // Prepare everything asynchronous first, so the authorization re-check below is the last await
    // before the page is touched: a revocation during preparation must not be bypassed.
    const documentId=await network.document(tab.id,PAGE_ACCESS);
    // A redirect can stretch the tab URL past the bridge's request limit; the authorize call only needs
    // the scheme and host for its policy check, so a bounded copy is sent instead of the whole string.
    const authorization = await fetchJSON(target.base,'/authorize',target.session,{id:job.id,url:actual.url.slice(0,PAGE_URL_MAX),...(MAIN_WORLD_ACTIONS.has(job.action) ? {dispatch:true} : {})});
    policy = P.normalizePolicy(authorization.policy);
    const currentGate = P.check(policy,job.action,actual.url);
    if (!currentGate.ok) return {...currentGate,execution:failureState()};
    if (job.action === 'navigate') return {ok:true,url:actual.url,tabId:tab.id};
    // Main-world reads and scripts run in the page's own JavaScript context.
    if (MAIN_WORLD_ACTIONS.has(job.action)) {
      injecting = true;
      const done = await mainWorldAction(job,tab.id,documentId);
      // A page that forbids scripts (CSP) cannot stop the debugger: when the user has allowed it, evaluate there.
      if (done.error === 'EVAL_BLOCKED_BY_PAGE') return await debuggerAllowed() ? debuggerEvaluate(tab.id,job.payload) : {...done,message:done.message+" If the user turns on Cindy's on-demand debugging feature (extension Options), such pages run scripts through it."};
      return done;
    }
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
    const debuggerError = debuggerFailure(e);
    if (debuggerError) return debuggerError;
    const messages = {BROWSER_PAGE_RESTRICTED:'Chrome protects this Web Store domain from extension access, including the legacy developer console. Store-installed extensions have the same restriction. Refreshing or granting site access will not help; no page content was read or modified.',ADDRESS_UNVERIFIED:'The browser could not identify an accessible current document. See reason for the document or local-URL restriction. No page content was read. Inspect the retained tab; do not open replacements or retry in a loop.',PAGE_NOT_OPEN:'This action has no open target. Inspect browser_tabs once; do not repeatedly open the URL to repair a stale action.',PAGE_CHANGED:'The existing tab navigated. No new tab was opened. Inspect browser_tabs once and use the actual URL; do not retry the old URL or invent URL variants.',TAB_ACCESS_FAILED:'The existing tab is still present but inaccessible. No replacement was opened. Check browser permissions.',PAGE_LOAD_TIMEOUT:'Loading timed out; the same tab was retained. Inspect its state once. Do not loop retries, change query strings, or open duplicate URLs.',REDIRECT_BLOCKED:'The existing tab redirected to a site that is not allowed. No replacement will be opened. Review its permissions; do not bypass the denial.'};
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
        const deadline = job.action === 'wait' ? Math.min(Number(job.payload?.timeMs) || 0,120000)+Math.min(Number(job.payload?.timeoutMs) || 30000,120000)+10000 : job.action === 'cdp' ? 45000 : 40000;
        try { result = await withDeadline(handle(job,P.normalizePolicy(ack.policy),target),deadline,Object.assign(Error('JOB_DEADLINE'),{deadline:true})); }
        catch (e) { result = e?.deadline ? fail('EXTENSION_TIMEOUT','The browser did not finish this action in time; it may still complete. Check the page before repeating it.','unknown') : fail('INVALID_JOB','The browser job was invalid. No action was executed.'); }
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
// An update or reload leaves the pages already open with the previous copy of the content
// script, which can no longer reach this worker. Inject the new copy into every open page; the
// copy announces itself and the previous one leaves, so nothing runs twice.
chrome.runtime.onInstalled.addListener(details => {
  if (!['install', 'update'].includes(details?.reason)) return;
  const files = chrome.runtime.getManifest().content_scripts?.[0]?.js || [];
  if (!files.length) return;
  chrome.tabs.query({url: ['http://*/*', 'https://*/*']}).then(tabs => {
    for (const tab of tabs) if (tab.id !== undefined) chrome.scripting.executeScript({target: {tabId: tab.id}, files}).catch(() => {});
  }).catch(() => {});
});
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
    // Which tab asked: translation tasks follow the video per tab, not per browser.
    if(Number.isInteger(sender.tab?.id))request.view='tab:'+sender.tab.id;else delete request.view;
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
  if(message?.type==='cindy-agent-tab'&&sender.tab?.id!=null) {
    loadAgentTabs().then(set=>reply({opened:set.has(sender.tab.id)}),()=>reply({opened:false}));return true;
  }
  if(message?.type==='cindy-user-took-over'&&sender.tab?.id!=null) {
    userTookOver(sender.tab.id).then(()=>reply({ok:true}),()=>reply({ok:false}));return true;
  }
  if(message?.type==='cindy-ui-locale'&&typeof message.locale==='string') {
    // Cindy's interface language, reported by a content script: names the agent's tab group.
    uiLocale=message.locale.slice(0,20);
    if(agentGroupId!=null)chrome.tabGroups?.update(agentGroupId,{title:groupTitle()}).catch(()=>{});
    reply({ok:true});return;
  }
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
// Toolbar icon follows the browser's light or dark appearance, reported by open pages.
let actionScheme=null; // unknown after a worker restart: the first report always applies
chrome.runtime.onMessage.addListener((m,sender)=>{
  if(m?.type!=='cindy-color-scheme'||sender.id!==chrome.runtime.id||typeof m.dark!=='boolean')return;
  const scheme=m.dark?'dark':'light';if(scheme===actionScheme)return;actionScheme=scheme;
  chrome.action.setIcon?.({path:{16:`icons/action-${scheme}-16.png`,24:`icons/action-${scheme}-24.png`,32:`icons/action-${scheme}-32.png`}})?.catch?.(()=>{});
});
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
  return parseYoutubeCaptions(new TextDecoder().decode(data));
}
function parseYoutubeCaptions(text) {
  if(!text.trim())throw Error('SUBTITLE_EMPTY');
  let parsed;
  try{parsed=JSON.parse(text);}catch{throw Error('SUBTITLE_RESPONSE_INVALID');}
  if(!parsed||!Array.isArray(parsed.events))throw Error('SUBTITLE_RESPONSE_INVALID');
  const cues=globalThis.CindyLearning.youtubeSubtitles(parsed);
  if(!cues.length)throw Error('SUBTITLE_EMPTY');
  return cues;
}
// YouTube's timedtext endpoint answers an extension's own request with an empty 200: it now
// requires the proof-of-origin token (`pot`) that only the page's player attaches. Runs in the
// verified video document: ask the player for the wanted track, read the URL of the request the
// player itself makes, fetch that same-origin URL with fmt=json3 and no cookies, then restore the
// player's caption state. Fixed function, no page code is evaluated.
function readPlayerTimedtext(languageCode,tlang,kind) {
  return (async()=>{
    const player=document.querySelector('#movie_player');
    if(!player||typeof player.setOption!=='function'||typeof player.getOption!=='function')return {ok:false,error:'PLAYER_API_UNAVAILABLE'};
    let before=null,loaded=true;
    try{before=player.getOption('captions','track');}catch{loaded=false;}
    if(!loaded){try{player.loadModule('captions');}catch{return {ok:false,error:'PLAYER_API_UNAVAILABLE'};}}
    const request=new Promise(resolve=>{
      const observer=new PerformanceObserver(list=>{
        // The player may also be fetching the track it shows on its own (YouTube remembers the last
        // caption language), so only the request for the track asked for counts.
        const wanted=name=>{try{const u=new URL(name);return u.pathname==='/api/timedtext'&&u.searchParams.has('pot')&&u.searchParams.get('lang')===languageCode&&(kind?u.searchParams.get('kind')===kind:!u.searchParams.get('kind'));}catch{return false;}};
        for(const entry of list.getEntries())if(wanted(entry.name)){observer.disconnect();resolve(entry.name);return;}
      });
      observer.observe({type:'resource',buffered:false});
      setTimeout(()=>{observer.disconnect();resolve(null);},6000);
    });
    try{
      // The same track is served from cache without a new request: switch it off first.
      if(before?.languageCode===languageCode)player.setOption('captions','track',{});
      // kind distinguishes the manual track from the auto-generated one in the same language.
      player.setOption('captions','track',{languageCode,...(kind?{kind}:{})});
    }catch{return {ok:false,error:'PLAYER_API_UNAVAILABLE'};}
    const name=await request;
    try{
      if(before?.languageCode)player.setOption('captions','track',{languageCode:before.languageCode,...(before.kind?{kind:before.kind}:{})});
      else player.setOption('captions','track',{});
      if(!loaded)player.unloadModule?.('captions');
    }catch{}
    if(!name)return {ok:false,error:'SUBTITLE_UNAVAILABLE'};
    let url;
    try{url=new URL(name);}catch{return {ok:false,error:'INVALID_SUBTITLE_SOURCE'};}
    if(url.protocol!=='https:'||!/(^|\.)youtube\.com$/.test(url.hostname)||url.pathname!=='/api/timedtext'||url.username||url.password)return {ok:false,error:'INVALID_SUBTITLE_SOURCE'};
    url.searchParams.set('fmt','json3');
    url.searchParams.delete('tlang'); // the user's auto-translate setting must not replace the source language
    let text;
    try{
      const response=await fetch(url.href,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)});
      if(!response.ok)return {ok:false,error:'SUBTITLE_UNAVAILABLE'};
      text=await response.text();
    }catch(e){return {ok:false,error:['TimeoutError','AbortError'].includes(e.name)?'SUBTITLE_TIMEOUT':'SUBTITLE_FETCH_FAILED'};}
    if(text.length>2000000)return {ok:false,error:'SUBTITLE_TOO_LARGE'};
    // YouTube's machine translation of the same track: shown instantly until Cindy's translation lands.
    let machineText=null;
    if(tlang&&/^[A-Za-z-]{2,12}$/.test(tlang)){try{url.searchParams.set('tlang',tlang);const r=await fetch(url.href,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)});if(r.ok){const t=await r.text();if(t.length<=2000000)machineText=t;}}catch{}}
    return {ok:true,text,machineText};
  })();
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
      const renderer=response?.captions?.playerCaptionsTracklistRenderer;
      const audio=(renderer?.audioTracks||[])[renderer?.defaultAudioTrackIndex||0];
      // The original audio is marked audioIsDefault in the streaming formats (e.g. "en-US.4").
      const original=(response?.streamingData?.adaptiveFormats||[]).find(f=>f?.audioTrack?.audioIsDefault)?.audioTrack?.id;
      let current=null;try{const c=p?.getOption?.('captions','track');if(c?.languageCode&&!c.translationLanguage)current={language:c.languageCode,kind:c.kind||null};}catch{}
      return {tracks:(renderer?.captionTracks||[]).slice(0,60).map(t=>({url:t.baseUrl,language:t.languageCode,kind:t.kind})),defaultIndex:audio?.defaultCaptionTrackIndex,
        audioLanguage:typeof original==='string'?original.split('.')[0]:null,current};
    }});
    const read=result?.[0]?.documentId===documentId?result[0].result:null;
    const tracks=Array.isArray(read)?read:read?.tracks||[];
    const track=globalThis.CindyLearning.youtubeCaptionTrack(tracks,m.language,Array.isArray(read)?undefined:read?.defaultIndex,Array.isArray(read)?{}:{audioLanguage:read?.audioLanguage,current:read?.current});
    let cues=[],sourceError,machine=[];
    const tlang=globalThis.CindyLearning.youtubeTranslationLanguage(m.target);
    if(track){
      const url=new URL(track.url);
      if(url.protocol!=='https:'||!/(^|\.)youtube\.com$/.test(url.hostname)||url.pathname!=='/api/timedtext'||url.username||url.password)throw Error('INVALID_SUBTITLE_SOURCE');
      url.searchParams.set('fmt','json3');
      try{cues=await fetchYoutubeCaptions(url.href);if(cues.length&&!globalThis.CindyLearning.captionsMatchLanguage(cues,track.language)){cues=[];throw Error('SUBTITLE_LANGUAGE_MISMATCH');}if(tlang){try{const u=new URL(url.href);u.searchParams.set('tlang',tlang);machine=await fetchYoutubeCaptions(u.href);}catch{}}}catch(e){
        if(!['SUBTITLE_EMPTY','SUBTITLE_RESPONSE_INVALID','SUBTITLE_UNAVAILABLE','SUBTITLE_TIMEOUT','SUBTITLE_FETCH_FAILED','SUBTITLE_LANGUAGE_MISMATCH'].includes(e.message))throw e;
        sourceError=e;
      }
    }
    if(!cues.length&&track){
      const viaPlayer=await chrome.scripting.executeScript({target:{tabId:tab.id,documentIds:[documentId]},world:'MAIN',func:readPlayerTimedtext,args:[track.language,tlang,track.kind||null]});
      if(viaPlayer?.[0]?.documentId!==documentId)throw Error('PAGE_CHANGED');
      const read=viaPlayer[0].result;
      if(read?.ok===true&&typeof read.text==='string'){
        if(typeof read.machineText==='string'){try{machine=parseYoutubeCaptions(read.machineText);}catch{machine=[];}}
        try{cues=parseYoutubeCaptions(read.text);if(cues.length&&!globalThis.CindyLearning.captionsMatchLanguage(cues,track.language)){cues=[];machine=[];sourceError=Error('SUBTITLE_LANGUAGE_MISMATCH');}}catch(e){
          if(!['SUBTITLE_EMPTY','SUBTITLE_RESPONSE_INVALID'].includes(e.message))throw e;
          sourceError=e;
        }
      }else if(read?.error==='SUBTITLE_TOO_LARGE')throw Error('SUBTITLE_TOO_LARGE');
    }
    if(!cues.length){
      const fallback=await chrome.scripting.executeScript({target:{tabId:tab.id,documentIds:[documentId]},world:'MAIN',func:globalThis.CindyYoutubeTranscript.read,args:[tab.url,track?{languageCode:track.language,kind:track.kind||null}:null]});
      if(fallback?.[0]?.documentId!==documentId)throw Error('PAGE_CHANGED');
      const transcript=fallback[0].result;
      if(!transcript?.ok)throw Error(transcript?.error==='SUBTITLE_UNAVAILABLE'?sourceError?.message||'SUBTITLE_UNAVAILABLE':transcript?.error||'SUBTITLE_UNAVAILABLE');
      cues=transcript.cues;
      // Never translate a transcript in another language than the chosen track.
      if(track&&cues.length&&!globalThis.CindyLearning.captionsMatchLanguage(cues,track.language))throw Error('SUBTITLE_LANGUAGE_MISMATCH');
      if(!cues.length&&sourceError)throw sourceError;
    }
    await learningRequest({id:crypto.randomUUID(),request:{op:'config'}},sender);
    if((await chrome.tabs.get(tab.id)).url!==tab.url)throw Error('PAGE_CHANGED');
    return {ok:true,cues,language:track?.language,machine:cues.length?machine:[]};
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
