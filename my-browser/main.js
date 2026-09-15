// Sandbox orchestration only; browser access stays in the bundled Node/Chrome bridge.
const policyReady = import('/extension/policy.js').then(() => globalThis.MyBrowserPolicy);
const channel = new BroadcastChannel('my-browser');
let writes = Promise.resolve();
const serialize = fn => { const next = writes.then(fn,fn); writes = next.catch(() => {}); return next; };
const fail = (error,message,execution = 'not_executed') => ({ok:false,error,message,execution});
async function node(method, params = {}) {
  const r = await cindy.node.request({method,params,timeoutMs:method === 'act' ? 65000 : method === 'openInstallation' ? 45000 : 10000});
  if (!r.ok) return fail('NODE_UNAVAILABLE', r.message || 'Re-enable My Browser and check its connection.', ['act','openInstallation'].includes(method) ? 'unknown' : 'not_executed');
  return r.result;
}
async function load() {
  const P = await policyReady;
  const r = await fetch('/kv');
  if (!r.ok) throw new Error('Cannot read saved permissions. Reload plugin settings; no browser action was started.');
  const cfg = await r.json();
  return {cfg,policy:cfg.policy ? P.normalizePolicy(cfg.policy) : P.defaults()};
}
async function sync() {
  await writes;
  const {cfg,policy} = await load();
  const paired = await node('setTrustedClients',{clients:cfg.pairedClients || []});
  if (!paired?.ok) throw new Error('Cannot synchronize paired browsers.');
  const r = await node('setPolicy',{policy});
  if (!r?.ok) throw new Error(r?.message || 'Cannot apply site permissions. Re-enable the plugin.');
  return policy;
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
    // Never truncate a grant list: the confirmation must show every affected site.
    if (detail.length > 190) return fail('TOO_MANY_GRANTS','Grant fewer sites at a time so the confirmation can show every domain.');
    const r = await cindy.confirm({body:detail+'\nInteraction allows any button/form, including send, delete and pay. Allow these sites?',confirmText:'Allow',cancelText:'Cancel',danger:true});
    if (!r.ok || !r.confirmed) return fail('PERMISSION_NOT_GRANTED','No permissions were changed. The user cancelled or confirmation was unavailable.');
    const fresh = await load();
    if (JSON.stringify(fresh.policy) !== JSON.stringify(current)) return fail('POLICY_CHANGED','Permissions changed during confirmation. Refresh settings.');
  }
  const r = await fetch('/kv',{method:'PUT',body:JSON.stringify({...cfg,policy})});
  if (!r.ok) return fail('SAVE_FAILED','Permissions could not be saved. Refresh settings before trying again.');
  const applied = await node('setPolicy',{policy});
  if (!applied?.ok) return {...fail('POLICY_SYNC_FAILED','Permissions were saved but the worker did not confirm them. No success is claimed; re-enable the plugin and check its status.'),saved:true};
  channel.postMessage({type:'policy-changed'});
  return {ok:true,policy};
}
async function handleTool(name,args) {
  const P = await policyReady;
  if (name === 'browser_policy') {
    if (args.action === 'get') { const policy = await sync(); return {ok:true,policy}; }
    return serialize(async () => {
      if (!['allow_interact','block_read','remove'].includes(args.action)) return fail('INVALID_ACTION','Use get, allow_interact, block_read or remove.');
      const host = P.normalizeHost(args.host);
      const {policy} = await load();
      if (args.action === 'allow_interact' && !policy.interact.allow.includes(host)) policy.interact.allow.push(host);
      if (args.action === 'block_read' && !policy.read.block.includes(host)) policy.read.block.push(host);
      if (args.action === 'remove') {
        policy.interact.allow = policy.interact.allow.filter(h => h !== host);
        policy.read.block = policy.read.block.filter(h => h !== host);
      }
      return save(policy);
    });
  }
  if (!['browser_status','browser_tabs','browser_read','browser_act'].includes(name)) return fail('UNKNOWN_TOOL','Use a declared My Browser tool.');
  await sync(); // Every call: a restarted on-demand worker must not silently lose stored permissions.
  if (name === 'browser_status') return {...await node('status'),installation:await node('installation'),how_to_install:'Open My Browser plugin settings and choose your browser. A store page opening does not mean the extension is installed; wait for a live connection.'};
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
  if (msg.type !== 'tool-call') return;
  let result;
  try { result = await handleTool(msg.tool,msg.args || {}); }
  catch (e) { result = fail('PLUGIN_ERROR',e.message || 'Reload My Browser settings and check the connection.',msg.tool === 'browser_act' ? 'unknown' : 'not_executed'); }
  // Business errors stay structured so an unknown side-effect outcome is never lost in prose.
  await cindy.send({type:'tool-result',callId:msg.callId,ok:true,result});
});
channel.onmessage = async ev => {
  const m = ev.data || {};
  if (!['status-request','save-request','install-request','pair-request'].includes(m.type) || typeof m.id !== 'string') return;
  let result;
  try {
    if (m.type === 'save-request') result = await serialize(() => save(m.policy,m.base));
    else if (m.type === 'install-request') result = await node('openInstallation',{browser:m.browser,mode:m.mode});
    else if (m.type === 'pair-request') result = await serialize(async () => {
      const status=await node('status');
      const client=status.clients?.find(c => c.id === m.clientId);
      if (!client) return fail('BROWSER_DISCONNECTED','Reconnect the browser before pairing.');
      const consent=await cindy.confirm({body:'Connect '+client.browser+' to Cindy?\n'+client.origin+'\nProfile: '+client.id,confirmText:'Connect',cancelText:'Cancel',danger:true});
      if (!consent.ok || !consent.confirmed) return fail('PAIRING_CANCELLED','No browser was authorized.');
      const current=(await node('status')).clients?.find(c => c.id === client.id && c.origin === client.origin && c.extensionId === client.extensionId);
      if (!current) return fail('BROWSER_DISCONNECTED','The browser identity changed during confirmation.');
      const {cfg}=await load();
      const pairedClients=[...(cfg.pairedClients || []).filter(c => c.id !== client.id),{id:client.id,origin:client.origin,extensionId:client.extensionId}];
      if (pairedClients.length>16) return fail('TOO_MANY_BROWSERS','At most 16 paired browser profiles are supported.');
      const saved=await fetch('/kv',{method:'PUT',body:JSON.stringify({...cfg,pairedClients})});
      if (!saved.ok) return fail('SAVE_FAILED','Browser authorization was not saved.');
      return node('setTrustedClients',{clients:pairedClients});
    });
    else { await sync(); result = {...await node('status'),installation:await node('installation')}; }
  } catch (e) { result = fail('SETTINGS_ERROR',e.message || 'Reload plugin settings.'); }
  channel.postMessage({type:'response',id:m.id,result});
};
