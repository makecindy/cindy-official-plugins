// Sandbox orchestration only; browser access stays in the bundled Node/Chrome bridge.
const policyReady = import('/extension/policy.js').then(() => globalThis.MyBrowserPolicy);
const channel = new BroadcastChannel('my-browser');
let writes = Promise.resolve();
const serialize = fn => { const next = writes.then(fn,fn); writes = next.catch(() => {}); return next; };
const fail = (error,message,execution = 'not_executed') => ({ok:false,error,message,execution});
// Cindy hosts that implement the browserExtension slot own the extension bridge: jobs,
// paired identities and learning relays travel over the plugin pipe and the bundled worker never
// binds a loopback port. Older hosts reject the pipe type, so the worker bridge stays the fallback;
// a refusal is never treated as a connection. Only that rejection marks a host as older: the host's
// pipe throws INVALID_PARAMS ("未知的管子消息类型") for a message type it does not know (or, older
// still, answers with nothing). Any other failure (HOST_NOT_READY while the bridge starts,
// PERMISSION_DENIED while the plugin is being enabled, a pipe timeout) is not remembered, so the next
// call asks again instead of starting the worker bridge and competing with the host for its ports.
const HOST_KINDS={status:'status',act:'act',setTrustedClients:'setTrustedClients',learningActive:'relayActive',learningProgress:'relayProgress',learningResult:'relayResult'};
let hostBridge=null;
async function hostRequest(kind,params = {},reach = 'not_executed') {
  let r;
  try { r=await cindy.send({type:'browser-extension-request',kind,...params}); }
  catch (e) {
    // Electron keeps only the message of a rejected pipe call: "… Error: [INVALID_PARAMS] …".
    const code=e?.code || /\[([A-Z][A-Z_]+)\]/.exec(e?.message || '')?.[1];
    return {...fail('HOST_BRIDGE_UNAVAILABLE',e?.message || 'Cindy did not accept the browser extension request.',reach),...(code ? {hostCode:code} : {}),...(/未知的管子消息类型|unknown (?:pipe )?message type/i.test(e?.message || '') ? {unknownPipeType:true} : {})};
  }
  if (r && typeof r === 'object' && r.ok === false && r.errorCode) return {...fail(r.errorCode,r.message || 'Cindy refused the browser extension request.',reach),hostRefused:true};
  // A host with the slot always answers with an object; no answer at all is an older host's pipe.
  if (!r || typeof r !== 'object') return {...fail('HOST_BRIDGE_UNAVAILABLE','Cindy returned no browser extension result.',reach),unknownPipeType:true};
  return r;
}
async function detectHostBridge() {
  if (hostBridge !== null) return hostBridge;
  const r=await hostRequest('status');
  // A host that answers (even HOST_NOT_READY while its bridge starts) has the slot.
  if (r.ok === true || r.error === 'HOST_NOT_READY') return hostBridge=true;
  // Only an older host's rejection of the unknown pipe type selects the bundled worker for good.
  if (r.hostCode === 'INVALID_PARAMS' || r.error === 'INVALID_PARAMS' || r.unknownPipeType) return hostBridge=false;
  // Anything else is transient and not remembered: this call goes to the host, which reports its own
  // error, and the next call probes again. The worker never starts a competing bridge on a guess.
  return true;
}
function hostParams(method,params) {
  if (method === 'act') return {action:params.action,payload:params.payload || {}};
  if (method === 'setTrustedClients') return {clients:params.clients || []};
  if (method === 'learningProgress') return {id:params.id,progress:params.progress};
  if (method === 'learningResult') return {id:params.id,result:params.result};
  if (method === 'learningActive') return {id:params.id};
  return {};
}
async function node(method, params = {}) {
  const kind=HOST_KINDS[method];
  if (kind && await detectHostBridge()) {
    const r=await hostRequest(kind,hostParams(method,params),method === 'act' ? 'unknown' : 'not_executed');
    if (method !== 'status' || !r.ok) return r;
    // The settings page shows where the developer-loadable extension lives; only the worker knows.
    const described=await node('describe');
    return {...r,...(described?.ok ? {extension_dir:described.extension_dir} : {})};
  }
  // A transport rejection (timeout, refused/broken stdio) can arrive after the worker already
  // accepted an act job, so it must not be reported as "not executed". This mirrors the
  // structured NODE_UNAVAILABLE path below instead of letting the exception escape to the
  // generic handler, which only knew about browser_act.
  const reach = ['act','openInstallation'].includes(method) ? 'unknown' : 'not_executed';
  let r;
  try {
    r = await cindy.node.request({method,params,timeoutMs:method === 'act' ? 65000 : method === 'openInstallation' ? 45000 : 10000});
  } catch (e) {
    return fail('NODE_UNAVAILABLE',e.message || 'Re-enable Cindy Chrome and check its connection.',reach);
  }
  if (!r.ok) return fail('NODE_UNAVAILABLE', r.message || 'Re-enable Cindy Chrome and check its connection.', reach);
  return r.result;
}
async function load() {
  const r = await fetch('/kv');
  if (!r.ok) throw new Error('Cannot read saved settings. Reload plugin settings; no browser action was started.');
  return {cfg:await r.json()};
}
// Pushes the paired browsers to the bridge (Cindy's, or the bundled worker on older Cindy). There are no
// site lists (2026-10-30): safety is the task's permission mode and review, as in Cindy's own browser;
// lists saved by older versions stay in storage unused.
function sync() {
  return serialize(async () => {
    const {cfg} = await load();
    const paired = await node('setTrustedClients',{clients:cfg.pairedClients || []});
    if (!paired?.ok) {
      const error = new Error(paired.message || 'Cannot synchronize paired browsers.');
      error.code = paired.error || 'SETTINGS_ERROR';
      error.execution = paired.execution || 'not_executed';
      throw error;
    }
  });
}
async function handleTool(name,args) {
  const P = await policyReady;
  if (!['browser_status','browser_tabs','browser_read','browser_act'].includes(name)) return fail('UNKNOWN_TOOL','Use a declared Cindy Chrome tool.');
  await sync(); // Every call: a restarted worker must not silently lose paired browsers.
  if (name === 'browser_status') {
    const status=await node('status'), installation=await node('installation');
    if (!status?.ok) return status||fail('STATUS_UNAVAILABLE','Cannot check browser connections. Re-enable Cindy Chrome and refresh its settings.');
    // Tool output is an explicit projection. The settings channel below retains
    // extension_dir and pairing identity details without sending them to AI.
    return {ok:true,version:status.version,protocol:status.protocol,extension_connected:status.extension_connected,nativeBinding:status.nativeBinding,
      clients:(status.clients || []).map(c=>({id:c.id,browser:c.browser,version:c.version,protocolVersion:c.protocolVersion,connected:c.connected,trusted:c.trusted,identitySupported:c.identitySupported,nativeBindingRequired:c.nativeBindingRequired})),
      installation:{ok:!!installation?.ok,browsers:(installation?.browsers || []).map(b=>({browser:b.browser,supported:b.supported,installed:b.installed,published:b.published,bundled:b.bundled}))},
      how_to_install:'Open Cindy Chrome plugin settings and choose Install extension. Chrome uses the official Chrome Web Store listing; Edge uses the developer directory fallback until an Edge store route is published. Keep Cindy Chrome enabled after installation; updated official extensions connect automatically. If nativeBinding is unavailable, re-enable the plugin; new profiles need Chrome extension 0.4.16 or later. Directory loading is the only developer fallback included in this plugin package.'};
  }
  if (name === 'browser_tabs') return node('act',{action:'tabs',payload:P.validate('tabs',args)});
  if (name === 'browser_read') {
    if (args.recipe) {
      if (args.recipe !== 'x_mentions' || (args.url && !/^https:\/\/(?:x\.com|twitter\.com)\/notifications\/mentions\/?$/.test(args.url))) return fail('INVALID_RECIPE','x_mentions reads only the signed-in X mentions page.');
      args={...args,url:args.url || 'https://x.com/notifications/mentions',mode:'extract',selector:'main',multiple:true,from:'article[data-testid="tweet"]',waitFor:'article[data-testid="tweet"]',emptySelector:'[data-testid="emptyState"]',fields:{author:'[data-testid="User-Name"]',text:'[data-testid="tweetText"]',time:{selector:'time',attr:'datetime'},url:{selector:'a:has(time)',attr:'href'}}};
    }
    const mode = args.mode || 'content';
    if (!['content','snapshot','text','extract'].includes(mode)) return fail('INVALID_MODE','Use content, snapshot, text or extract.');
    P.validate(mode,args);
    return node('act',{action:mode,payload:args});
  }
  P.validate(args.kind,args);
  const result = await node('act',{action:args.kind,payload:args});
  return result;
}
cindy.onHostMessage(async msg => {
  if (msg.type !== 'tool-call') return handleLearningHostMessage(msg);
  let result;
  try { result = await handleTool(msg.tool,msg.args || {}); }
  catch (e) {
    // Throws here are local validation or orchestration failures. Worker transport
    // already maps in-flight act failures to unknown inside node(); do not upgrade a
    // pre-dispatch error into an unknown side effect.
    result = fail('PLUGIN_ERROR',e.message || 'Reload Cindy Chrome settings and check the connection.','not_executed');
  }
  // Business errors stay structured so an unknown side-effect outcome is never lost in prose.
  await cindy.send({type:'tool-result',callId:msg.callId,ok:true,result});
});
channel.onmessage = async ev => {
  const m = ev.data || {};
  if (!['status-request','install-request'].includes(m.type) || typeof m.id !== 'string') return;
  let result;
  try {
    if (m.type === 'install-request') result = await node('openInstallation',{browser:m.browser,mode:m.mode});
    else { await sync(); result = {...await node('status'),installation:await node('installation')}; }
  } catch (e) { result = fail(e?.code || 'SETTINGS_ERROR',e.message || 'Reload plugin settings.',e?.execution || 'not_executed'); }
  channel.postMessage({type:'response',id:m.id,result});
};

// Browser-initiated learning requests are delivered by the paired local bridge.
let learningService,hostLocale='en';
async function getLearningService() {
  if(!learningService)learningService=Promise.all([import('/extension/learning-core.js'),import('/learning-service.js'),import('/translation-task.js')]).then(([,module,adapter])=>module.createLearningService({
    core:globalThis.CindyLearning,locale:()=>hostLocale,tasks:cindy.tasks,
    model:adapter.createTranslationTask({tasks:cindy.tasks,locale:()=>hostLocale,
      load:async()=>(await load()).cfg.translationTask,
      save:binding=>serialize(async()=>{const {cfg}=await load();const r=await fetch('/kv',{method:'PUT',body:JSON.stringify({...cfg,translationTask:binding})});if(!r.ok)throw Error('SAVE_FAILED');})
    }),
    library:args=>cindy.send({type:'library-request',...args})
  }));
  return learningService;
}
async function handleLearningHostMessage(msg){
  if(msg.type==='host-context-changed'){hostLocale=msg.context?.locale||hostLocale;return;}
  // The host has no saved copy of the paired browsers and asks for them (the event keeps its published name).
  if(msg.type==='event'&&msg.name==='browser-extension-policy-request'){sync().catch(()=>{});return;}
  // Host-owned bridge delivers relays as its own event; the bundled worker uses a node notification.
  const relay=msg.type==='event'&&msg.name==='browser-extension-relay'?msg:msg.type==='event'&&msg.name==='node-notification'&&msg.method==='learning-request'?msg.params:null;
  if(!relay)return;
  const {id,clientId,request}=relay||{};
  let result,stage='accepted';
  try {
    await sync();
    const service=await getLearningService();
    result=await service.handle(clientId,request,async()=> (await node('learningActive',{id})).active===true,progress=>{stage=progress.stage;return node('learningProgress',{id,progress});});
  }catch(e){result={ok:false,error:e.message||'LEARNING_UNAVAILABLE',stage};}
  await node('learningResult',{id,result});
}
// Resident logic establishes the bridge after paired browsers are loaded.
if(typeof document!=='undefined') {
  fetch('/app-context').then(r=>r.json()).then(r=>{hostLocale=r.context?.locale||'en';}).catch(()=>{});
  sync().then(()=>node('status')).catch(()=>{});
}
