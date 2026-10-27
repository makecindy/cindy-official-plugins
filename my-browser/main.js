// Sandbox orchestration only; browser access stays in the bundled Node/Chrome bridge.
const policyReady = Promise.all([import('/extension/policy.js'),import('/saved-policy.js')]).then(() => globalThis.MyBrowserPolicy);
const channel = new BroadcastChannel('my-browser');
let writes = Promise.resolve();
const serialize = fn => { const next = writes.then(fn,fn); writes = next.catch(() => {}); return next; };
const fail = (error,message,execution = 'not_executed') => ({ok:false,error,message,execution});
// Cindy hosts that implement the browserExtension slot own the extension bridge: jobs, site policy,
// paired identities and learning relays travel over the plugin pipe and the bundled worker never
// binds a loopback port. Older hosts reject the pipe type, so the worker bridge stays the fallback;
// a refusal is never treated as a connection.
const HOST_KINDS={status:'status',act:'act',setPolicy:'setPolicy',setTrustedClients:'setTrustedClients',learningActive:'relayActive',learningProgress:'relayProgress',learningResult:'relayResult'};
let hostBridge=null;
async function hostRequest(kind,params = {},reach = 'not_executed') {
  let r;
  try { r=await cindy.send({type:'browser-extension-request',kind,...params}); }
  catch (e) { return fail('HOST_BRIDGE_UNAVAILABLE',e?.message || 'Cindy did not accept the browser extension request.',reach); }
  if (r && typeof r === 'object' && r.ok === false && r.errorCode) return {...fail(r.errorCode,r.message || 'Cindy refused the browser extension request.',reach),hostRefused:true};
  if (!r || typeof r !== 'object') return fail('HOST_BRIDGE_UNAVAILABLE','Cindy returned no browser extension result.',reach);
  return r;
}
async function detectHostBridge() {
  if (hostBridge !== null) return hostBridge;
  const r=await hostRequest('status');
  // HOST_NOT_READY still proves the slot exists (the bridge is starting); any other refusal or a
  // rejected pipe type means an older host, so the bundled worker keeps serving.
  hostBridge=r.ok === true || r.error === 'HOST_NOT_READY';
  return hostBridge;
}
function hostParams(method,params) {
  if (method === 'act') return {action:params.action,payload:params.payload || {}};
  if (method === 'setPolicy') return {policy:params.policy};
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
    r = await cindy.node.request({method,params,timeoutMs:['act','setPolicy'].includes(method) ? 65000 : method === 'openInstallation' ? 45000 : 10000});
  } catch (e) {
    return fail('NODE_UNAVAILABLE',e.message || 'Re-enable Cindy Chrome and check its connection.',reach);
  }
  if (!r.ok) return fail('NODE_UNAVAILABLE', r.message || 'Re-enable Cindy Chrome and check its connection.', reach);
  return r.result;
}
async function load() {
  const P = await policyReady;
  const r = await fetch('/kv');
  if (!r.ok) throw new Error('Cannot read saved permissions. Reload plugin settings; no browser action was started.');
  const cfg = await r.json();
  return {cfg,policy:globalThis.myBrowserSavedPolicy(cfg,P)};
}
// Reading stored permissions and applying them to the worker must be one critical section
// shared with save(). If a settings save lands between the read and the apply, this stale
// snapshot would overwrite the policy the user just revoked and keep the site actionable
// until the next sync. Never call sync() from inside a serialized section (that deadlocks).
function sync() {
  return serialize(async () => {
    const {cfg,policy} = await load();
    const paired = await node('setTrustedClients',{clients:cfg.pairedClients || []});
    if (!paired?.ok) {
      const error = new Error(paired.message || 'Cannot synchronize paired browsers.');
      error.code = paired.error || 'SETTINGS_ERROR';
      error.execution = paired.execution || 'not_executed';
      throw error;
    }
    const r = await node('setPolicy',{policy});
    if (!r?.ok && !(r?.error === 'REVOCATION_UNCONFIRMED' && r.applied === true)) {
      const error = new Error(r?.message || 'Cannot apply site permissions. Re-enable the plugin.');
      error.code = r?.error || 'SETTINGS_ERROR';
      error.execution = r?.execution || 'not_executed';
      throw error;
    }
    return policy;
  });
}
async function save(next, base) {
  const P = await policyReady;
  const {cfg,policy:current} = await load();
  const policy = P.normalizePolicy(next);
  if (base && JSON.stringify(P.normalizePolicy(base)) !== JSON.stringify(current)) return fail('POLICY_CHANGED','Permissions changed elsewhere. Refresh settings before editing again.');
  const added = policy.interact.allow.filter(h => !current.interact.allow.includes(h));
  const unblocked = current.read.block.filter(h => !policy.read.block.includes(h));
  const exclusions = current.interact.block.filter(h => !policy.interact.block.includes(h));
  if (added.length || unblocked.length || exclusions.length) {
    const detail = [...added.map(h => '+ interact: '+h),...unblocked.map(h => '+ read: '+h),...exclusions.map(h => '+ excluded interaction: '+h)].join('\n');
    const grants = added.length + unblocked.length + exclusions.length;
    // Bound a batch of new grants, not a single already-saved host. A long but valid domain
    // can be blocked without confirmation, so the same host must remain removable.
    if (grants > 1 && detail.length > 190) return fail('TOO_MANY_GRANTS','Grant fewer sites at a time so the confirmation can show every domain.');
    const r = await cindy.confirm({body:detail+'\nInteraction allows any button/form, including send, delete and pay. Allow these sites?',confirmText:'Allow',cancelText:'Cancel',danger:true});
    if (!r.ok || !r.confirmed) return fail('PERMISSION_NOT_GRANTED','No permissions were changed. The user cancelled or confirmation was unavailable.');
    const fresh = await load();
    if (JSON.stringify(fresh.policy) !== JSON.stringify(current)) return fail('POLICY_CHANGED','Permissions changed during confirmation. Refresh settings.');
  }
  const r = await fetch('/kv',{method:'PUT',body:JSON.stringify({...cfg,policy,siteDefaultsVersion:1})});
  if (!r.ok) return fail('SAVE_FAILED','Permissions could not be saved. Refresh settings before trying again.');
  const applied = await node('setPolicy',{policy});
  const uncertain = applied?.error === 'REVOCATION_UNCONFIRMED' && applied.applied === true;
  if (!applied?.ok && !uncertain) return {...fail('POLICY_SYNC_FAILED','Permissions were saved but the worker did not confirm them. No success is claimed; re-enable the plugin and check its status.'),saved:true,policy};
  channel.postMessage({type:'policy-changed'});
  return {ok:true,policy,...(uncertain ? {warning:'REVOCATION_UNCONFIRMED',message:applied.message} : {})};
}
async function handleTool(name,args) {
  const P = await policyReady;
  if (name === 'browser_policy') {
    if (args.action === 'get') { const policy = await sync(); return {ok:true,policy}; }
    return serialize(async () => {
      if (!['allow_interact','block_read','remove'].includes(args.action)) return fail('INVALID_ACTION','Use get, allow_interact, block_read or remove.');
      const host = args.host === '*' && args.action !== 'block_read' ? '*' : P.normalizeHost(args.host);
      const {policy} = await load();
      if (args.action === 'allow_interact' && !policy.interact.allow.includes(host)) policy.interact.allow.push(host);
      if (args.action === 'block_read' && !policy.read.block.includes(host)) policy.read.block.push(host);
      if (args.action === 'remove') {
        policy.interact.allow = policy.interact.allow.filter(h => h !== host);
        policy.read.block = policy.read.block.filter(h => h !== host);
        policy.interact.block = policy.interact.block.filter(h => h !== host);
      }
      return save(policy);
    });
  }
  if (!['browser_status','browser_tabs','browser_read','browser_act'].includes(name)) return fail('UNKNOWN_TOOL','Use a declared Cindy Chrome tool.');
  await sync(); // Every call: a restarted worker must not silently lose stored permissions.
  if (name === 'browser_status') {
    const status=await node('status'), installation=await node('installation');
    if (!status?.ok) return status||fail('STATUS_UNAVAILABLE','Cannot check browser connections. Re-enable Cindy Chrome and refresh its settings.');
    // Tool output is an explicit projection. The settings channel below retains
    // policy, extension_dir and pairing identity details without sending them to AI.
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
  if (!['status-request','save-request','install-request'].includes(m.type) || typeof m.id !== 'string') return;
  let result;
  try {
    if (m.type === 'save-request') result = await serialize(() => save(m.policy,m.base));
    else if (m.type === 'install-request') result = await node('openInstallation',{browser:m.browser,mode:m.mode});
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
// Resident logic establishes the bridge after saved permissions are loaded.
if(typeof document!=='undefined') {
  fetch('/app-context').then(r=>r.json()).then(r=>{hostLocale=r.context?.locale||'en';}).catch(()=>{});
  sync().then(()=>node('status')).catch(()=>{});
}
