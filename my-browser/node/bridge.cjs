'use strict';
// Only Cindy stdio can enqueue browser actions or restore legacy paired identities.
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const P = require('../extension/policy.js');
const L = require('../extension/learning-core.js');
const manifest = require('../extension/manifest.json');
const distribution = require('../distribution.json');
const EXT_ID = crypto.createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32).replace(/[0-9a-f]/g,c => String.fromCharCode(97+parseInt(c,16)));
const PROTOCOL = 3;
// Keep in sync with background.js; package releases do not change authentication.
const WIRE_VERSION = '0.4.13';
const failure = (error,message,execution = 'not_executed') => ({ok:false,error,message,execution});
function createBridge(options = {}) {
  // No site lists (2026-10-30): jobs only get the address check; policy is sent for older extensions.
  const policy = P.defaults();
  let pins = [];
  const nativeBindings=new Map();
  let server, starting, port = 0;
  const jobs = new Map(), clients = new Map(), waiting = new Map();
  const learning = new Map(), learningChallenges = new Map();
  const compatible = version => version === WIRE_VERSION || ['0.4.0','0.4.1','0.4.2','0.4.3','0.4.4','0.4.5','0.4.6','0.4.7','0.4.8','0.4.9','0.4.10','0.4.11','0.4.12'].includes(version) || /^0\.3\.\d+$/.test(version);
  const live = c => Date.now()-c.seen < 35000;
  // An isolated embedding/test can pin its own extension identity; the stdio runtime exposes no such override.
  const primaryId = options.extensionId || EXT_ID;
  const knownIds = new Set([primaryId,...[distribution.chrome.extensionId,distribution.edge.extensionId].filter(Boolean)]);
  const sameIdentity = (p,c) => p && p.id === c.id && p.origin === c.origin && p.extensionId === c.extensionId;
  const pairedCredential = c => pins.some(p => sameIdentity(p,c) && !!c.publicKey && p.publicKey === c.publicKey);
  const official = c => c.origin === 'chrome-extension://'+c.extensionId && knownIds.has(c.extensionId);
  const approved = c => official(c) || pins.some(p => sameIdentity(p,c));
  // New official identities need native-bootstrap registration as well as proof.
  // Existing saved bindings remain valid without a native host or reapproval.
  const boundCredential = c => pairedCredential(c) || (official(c) && nativeBindings.get(c.id)===c.publicKey);
  const authenticatedCredential = c => !!c.publicKey && c.authenticated && boundCredential(c);
  const sessionReady = c => c.trusted && (c.version !== WIRE_VERSION ? pins.some(p=>sameIdentity(p,c)) : authenticatedCredential(c));
  const connected = () => [...clients.values()].filter(c => sessionReady(c) && live(c) && compatible(c.version));
  const publicClient = c => ({id:c.id,browser:c.browser,version:c.installedVersion,protocolVersion:c.version,connected:sessionReady(c) && live(c) && compatible(c.version),trusted:sessionReady(c),identitySupported:approved(c),nativeBindingRequired:official(c)&&!boundCredential(c),origin:c.origin,extensionId:c.extensionId,...(c.publicKey ? {publicKey:c.publicKey} : {})});
  const normalizePublicKey = value => {
    if (typeof value !== 'string' || value.length > 2048) return null;
    try {
      const decoded = JSON.parse(Buffer.from(value,'base64url').toString('utf8'));
      if (decoded?.kty !== 'EC' || decoded?.crv !== 'P-256' || typeof decoded.x !== 'string' || typeof decoded.y !== 'string' || Object.keys(decoded).some(k => !['kty','crv','x','y','ext'].includes(k))) return null;
      return JSON.stringify({kty:'EC',crv:'P-256',x:decoded.x,y:decoded.y,ext:decoded.ext !== false});
    } catch { return null; }
  };
  const verifyProof = (publicKey,challenge,proof) => {
    if (!publicKey || typeof challenge !== 'string' || typeof proof !== 'string' || proof.length > 256) return false;
    try {
      const key = crypto.createPublicKey({key:JSON.parse(publicKey),format:'jwk'});
      return crypto.verify('sha256',Buffer.from(challenge),{key,dsaEncoding:'ieee-p1363'},Buffer.from(proof,'base64url'));
    } catch { return false; }
  };
  const isHttp = value => typeof value === 'string' && /^https?:\/\//i.test(value);
  // The declared per-field limit; an over-long URL value is dropped whole rather than cut.
  const FIELD_VALUE_MAX = 4000;
  // Addresses and links come back whole (2026-10-30: as in Cindy's own browser, so magic and signed
  // links work); only the budget below applies.
  function boundResult(result, maxChars = 6000) {
    if (!result || typeof result !== 'object') return result;
    const out = {...result};
    // One budget for the entire extraction.
    let remaining = maxChars;
    const boundRecord = entry => {
      if (!entry || typeof entry !== 'object') return entry;
      const record = entry; let truncated = false;
      const bounded = {};
      for (const [key, value] of Object.entries(record)) {
        let finalValue = value;
        if (typeof value === 'string') {
          const limit = Math.min(remaining, FIELD_VALUE_MAX);
          if (value.length > limit) {
            finalValue = isHttp(value) ? null : value.slice(0, limit);
            truncated = true;
          }
          remaining -= finalValue?.length || 0;
        }
        // Field names are caller-controlled, including "__proto__".
        Object.defineProperty(bounded, key, {value:finalValue, enumerable:true});
      }
      if (truncated) out.truncated = true;
      return bounded;
    };
    if (Array.isArray(out.records)) out.records = out.records.map(boundRecord);
    if (out.record) out.record = boundRecord(out.record);
    return out;
  }
  function finish(job,result) {
    if (!jobs.has(job.id)) return;
    clearTimeout(job.timer); jobs.delete(job.id);
    const safe = boundResult(result, job.payload.maxChars || 6000);
    job.resolve({...safe,browser:job.clientId,timing:{...(safe.timing || {}),totalMs:Date.now()-job.created},...(P.READ.includes(job.action) && job.action !== 'tabs' ? {untrusted_content:true} : {})});
  }
  const jobFailure = (job,error,message) => failure(error,message,job.state === 'acknowledged' && job.action !== 'tabs' ? 'unknown' : 'not_executed');
  function take(clientId) {
    for (const job of jobs.values()) {
      if (job.state !== 'queued' || job.clientId !== clientId) continue;
      const gate = P.check(policy,job.action,job.payload.url);
      if (!gate.ok) { finish(job,gate); continue; }
      job.state = 'delivered'; // Never redeliver a lost operation.
      return {id:job.id,action:job.action,payload:job.payload};
    }
    return null;
  }
  function send(res,value,status = 200) {
    if (res.destroyed || res.writableEnded) return;
    const data = JSON.stringify(value);
    res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Length':Buffer.byteLength(data)}); res.end(data);
  }
  async function readBody(req,max = 512000) {
    const chunks = []; let bytes = 0;
    for await (const c of req) { bytes += c.length; if (bytes > max) throw new Error('Too large'); chunks.push(c); }
    const raw=Buffer.concat(chunks).toString('utf8');
    return {raw,value:JSON.parse(raw || '{}')};
  }
  async function body(req,max) {
    return (await readBody(req,max)).value;
  }
  async function route(req,res) {
    // Custom headers require preflight on websites. Never enable CORS, including on /health.
    const h = req.headers;
    if(req.url==='/native/bind') {
      // This authority exists only in the private native-host connection file.
      // It is never a browser header, public manifest value or /health result.
      const expected=options.nativeToken;
      const supplied=h.authorization;
      if(req.method!=='POST'||h.host!=='127.0.0.1:'+port||h.origin||typeof expected!=='string'||expected.length!==64||
         typeof supplied!=='string'||Buffer.byteLength(supplied)!==71||!crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from('Bearer '+expected)))return send(res,failure('FORBIDDEN','Native binding required.'),403);
      const b=await body(req),c=clients.get(b.clientId);
      if(!c||!official(c)||!c.authenticated||c.origin!==b.origin||normalizePublicKey(b.publicKey)!==c.publicKey)return send(res,failure('FORBIDDEN','Binding does not match the authenticated profile.'),403);
      nativeBindings.set(c.id,c.publicKey);
      return send(res,{ok:true});
    }
    const extensionId = h['x-my-browser-extension'];
    const origin = h['x-my-browser-origin'] || 'chrome-extension://'+extensionId;
    const id = h['x-my-browser-client'];
    if ((options.extensionId && extensionId !== primaryId) || h.host !== '127.0.0.1:'+port || req.method === 'OPTIONS' ||
        !/^[a-zA-Z0-9._-]{1,200}$/.test(extensionId || '') ||
        !/^[a-f0-9-]{36}$/.test(id || '') ||
        !(origin === 'chrome-extension://'+extensionId || /^safari-web-extension:\/\/[a-zA-Z0-9.-]+$/.test(origin)) ||
        (h.origin && h.origin !== origin)) return send(res,failure('FORBIDDEN','Only an extension origin can connect.'),403);
    let client = clients.get(id);
    if (client && (client.origin !== origin || client.extensionId !== extensionId)) return send(res,failure('IDENTITY_CHANGED','Reconnect with the correct browser profile.'),403);
    if (req.method === 'GET' && req.url === '/health') {
      for (const [key,c] of clients) if (Date.now()-c.seen > 180000 && ![...jobs.values()].some(j => j.clientId === key)) {clients.delete(key);nativeBindings.delete(key);}
      if (!client && clients.size >= 16) return send(res,failure('TOO_MANY_BROWSERS','Close unused browser connections.'),429);
      const keyHeader=h['x-my-browser-key'];
      const publicKey=keyHeader===undefined ? client?.publicKey || null : normalizePublicKey(keyHeader);
      const proof=typeof h['x-my-browser-proof']==='string'?h['x-my-browser-proof']:null;
      if(!client)client={id,origin,extensionId,browser:['chrome','edge','safari'].includes(h['x-my-browser-family']) ? h['x-my-browser-family'] : 'chrome',version:String(h['x-my-browser-version'] || '').slice(0,30),installedVersion:/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(h['x-my-browser-installed-version']||'')?h['x-my-browser-installed-version']:null,seen:Date.now(),publicKey:null,authenticated:false,challenge:null,session:null};
      client.browser=['chrome','edge','safari'].includes(h['x-my-browser-family']) ? h['x-my-browser-family'] : client.browser;
      client.version=String(h['x-my-browser-version'] || '').slice(0,30);
      client.installedVersion=/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(h['x-my-browser-installed-version']||'')?h['x-my-browser-installed-version']:null;
      client.seen=Date.now();
      if(keyHeader!==undefined&&publicKey!==client.publicKey){client.publicKey=publicKey;client.authenticated=false;client.challenge=null;client.session=null;}
      if(publicKey&&client.challenge&&client.challenge.expires>Date.now()&&client.challenge.publicKey===publicKey&&verifyProof(publicKey,client.challenge.value,proof))client.authenticated=true;
      const challenge=publicKey?{value:crypto.randomBytes(32).toString('base64url'),expires:Date.now()+10000,publicKey}:null;
      client.challenge=challenge;
      client.trusted = approved(client); clients.set(id,client);
      const authRequired=client.version===WIRE_VERSION;
      const sessionAllowed=sessionReady(client);
      const nativeRequired=official(client)&&authRequired&&!boundCredential(client);
      if(sessionAllowed&&!client.session)client.session=crypto.randomUUID();
      return send(res,{ok:true,plugin:'my-browser',protocol:PROTOCOL,version:compatible(client.version)?client.version:WIRE_VERSION,installedVersion:manifest.version,extensionId,clientId:id,pairing_required:!sessionAllowed,native_binding_required:nativeRequired,auth_required:authRequired,capabilities:sessionAllowed&&authRequired?['learning-v1','learning-auth-v2']:[],...(challenge ? {challenge:challenge.value} : {}),...(sessionAllowed ? {session:client.session} : {})});
    }
    if (!client || !sessionReady(client) || !client.session || !live(client) || !compatible(client.version) || h['x-my-browser-session'] !== client.session) return send(res,failure('SESSION_CHANGED','Reconnect the Cindy browser extension.'),409);
    client.seen = Date.now();
    if(req.url === '/learning/challenge' && req.method === 'GET') {
      if(!authenticatedCredential(client))return send(res,failure('PAIRING_REQUIRED','Reconnect the Cindy browser extension before starting learning.'),403);
      for(const [key,item] of learningChallenges)if(Date.now()>item.expiresAt)learningChallenges.delete(key);
      const value=crypto.randomBytes(32).toString('base64url');
      learningChallenges.set(value,{clientId:id,expiresAt:Date.now()+10000});
      return send(res,{ok:true,challenge:value});
    }
    let learningBody, learningRaw='';
    if(req.method==='POST' && req.url.startsWith('/learning/')) {
      const parsed=await readBody(req); learningBody=parsed.value; learningRaw=parsed.raw;
    }
    if(req.url.startsWith('/learning/')) {
      const challenge=typeof h['x-my-browser-learning-challenge']==='string'?h['x-my-browser-learning-challenge']:'';
      const proof=typeof h['x-my-browser-proof']==='string'?h['x-my-browser-proof']:'';
      const pending=learningChallenges.get(challenge);
      const bodyDigest=crypto.createHash('sha256').update(learningRaw).digest('base64url');
      const payload=challenge+'\\n'+req.method+'\\n'+req.url+'\\n'+bodyDigest;
      const valid=pending?.clientId===id&&pending.expiresAt>Date.now()&&authenticatedCredential(client)&&normalizePublicKey(h['x-my-browser-key'])===client.publicKey&&verifyProof(client.publicKey,payload,proof);
      if(!valid)return send(res,failure('PAIRING_REQUIRED','Reconnect the Cindy browser extension before starting learning.'),403);
      learningChallenges.delete(challenge);
    }
    if (req.method === 'POST' && req.url === '/learning/start') {
      const b=learningBody;
      if(typeof b.id!=='string'||!/^[a-f0-9-]{36}$/.test(b.id))return send(res,failure('INVALID_ID','Invalid request.'),400);
      for(const [key,item] of learning)if(Date.now()>item.expiresAt)learning.delete(key);
      const previous=learning.get(b.id);
      if(previous?.clientId===id&&previous.retired)return send(res,failure('REQUEST_EXPIRED','The completed result is no longer retained.'),404);
      if(previous)return send(res,previous.clientId===id?{ok:true,id:b.id}:failure('INVALID_ID','Request belongs to another profile.'),previous.clientId===id?200:403);
      if(learning.size>=4096 || [...learning.values()].filter(x=>!x.result).length>=64 || [...learning.values()].filter(x=>!x.result&&x.clientId===id).length>=4)return send(res,failure('BUSY','Wait for the current requests.'),429);
      let payload;
      try{payload=L.validate(b.request);}catch{return send(res,failure('INVALID_INPUT','Check the selected text or file.'),400);}
      if(payload.source.url){const gate=P.check(policy,'text',payload.source.url);if(!gate.ok)return send(res,gate,403);payload.source.url=P.redactUrl(payload.source.url);}
      // Bound retained result bodies separately from running work. Keep a small
      // receipt after eviction so replaying an old id never resubmits the model.
      const completed=[...learning.values()].filter(x=>x.result&&!x.retired);
      while(completed.length>=64){const old=completed.shift();old.retired=true;old.payload={source:old.payload.source};old.result={ok:false,error:'REQUEST_EXPIRED'};}
      const item={id:b.id,clientId:id,payload,created:Date.now(),expiresAt:Date.now()+L.learningRequestTimeout(payload)+L.learningTiming.transport,result:null,progress:{stage:'accepted',startedAt:Date.now(),updatedAt:Date.now(),attempt:1}};
      learning.set(b.id,item);
      options.notify?.('learning-request',{id:b.id,clientId:id,request:payload});
      return send(res,{ok:true,id:b.id});
    }
    if(req.method==='POST' && ['/learning/result','/learning/cancel'].includes(req.url)) {
      const b=learningBody,item=learning.get(b.id);
      if(!item || item.clientId!==id)return send(res,failure('REQUEST_EXPIRED','Request expired. Check the page before trying again.'),404);
      if(req.url==='/learning/cancel'){learning.delete(b.id);return send(res,{ok:true});}
      const gate=item.payload.source.url?P.check(policy,'text',item.payload.source.url):{ok:true};
      if(!gate.ok){learning.delete(b.id);return send(res,gate,403);}
      return send(res,item.result?{ok:true,done:true,result:item.result}:{ok:true,done:false,progress:item.progress});
    }
    if (req.method === 'GET' && req.url === '/poll') {
      const job = take(id); if (job) return send(res,{job});
      if (waiting.has(id)) return send(res,failure('BUSY','This profile is already polling.'),429);
      const cleanup = () => { clearTimeout(timer); if (waiting.get(id) === waiter) waiting.delete(id); };
      const waiter = () => { cleanup(); send(res,{job:take(id)}); };
      const timer = setTimeout(waiter,options.pollTimeout || 20000);
      waiting.set(id,waiter); res.on('close',cleanup); return;
    }
    if (req.method !== 'POST' || !['/ack','/authorize','/result'].includes(req.url)) return send(res,failure('NOT_FOUND','Unknown endpoint.'),404);
    // Screenshots and uploads come back as base64; a result may be far larger than a request.
    const b = await body(req,req.url === '/result' ? 32000000 : 512000), job = jobs.get(b.id);
    if (!job || job.clientId !== id || job.state !== (req.url === '/ack' ? 'delivered' : 'acknowledged')) return send(res,failure('JOB_EXPIRED','Do not execute this job.'),409);
    if (req.url === '/ack' || req.url === '/authorize') {
      const gate = P.check(policy,job.action,req.url === '/authorize' ? b.url : job.payload.url);
      if (!gate.ok) { const result = jobFailure(job,gate.error,gate.message); finish(job,result); return send(res,result,403); }
      if (req.url === '/ack') job.state = 'acknowledged';
      return send(res,{ok:true,policy});
    }
    let result = b.result;
    if (!result || typeof result !== 'object' || Array.isArray(result)) result = jobFailure(job,'INVALID_RESULT','Invalid browser result. Verify before retrying.');
    if (job.action === 'tabs' && !result.error) result = {...result,ok:true,tabs:(Array.isArray(result.tabs) ? result.tabs : []).slice(0,100).map(t => {
      if(P.check(policy,'text',t.url).ok)return t;
      const row={id:t.id,redacted:true};
      if(['loading','complete','unloaded'].includes(t.status))row.status=t.status;
      if(['ADDRESS_UNVERIFIED','TAB_ACCESS_FAILED'].includes(t.error))row.error=t.error;
      if(t.error==='ADDRESS_UNVERIFIED' && ['LOCAL_ADDRESS','NAVIGATION_UNOBSERVED','RESPONSE_UNOBSERVED','PEER_ADDRESS_MISSING','PEER_NOT_PUBLIC','DOCUMENT_CHANGED','DOCUMENT_UNAVAILABLE'].includes(t.reason))row.reason=t.reason;
      return row;
    })};
    else if (!result.error && result.url && !P.check(policy,job.action,result.url).ok) result = jobFailure(job,'REDIRECT_BLOCKED','No content returned from a blocked destination.');
    if (result.error && !['not_executed','executed','unknown'].includes(result.execution)) result = {...result,execution:jobFailure(job,'','').execution};
    finish(job,result); return send(res,{ok:true});
  }
  async function start() {
    if (server) return; if (starting) return starting;
    starting = (async () => {
      // Keep the listener inside the ten ports scanned by compatible 0.3.x/0.4.x
      // extensions. Binding outside that range would leave those clients permanently
      // disconnected during a staggered plugin/extension update.
      for (const candidate of options.ports || Array.from({length:10},(_,i)=>18810+i)) {
        const srv = http.createServer((req,res) => route(req,res).catch(() => send(res,failure('INVALID_REQUEST','Invalid bridge request.'),400)));
        srv.requestTimeout = 30000; srv.headersTimeout = 10000;
        try { await new Promise((resolve,reject) => { srv.once('error',reject); srv.listen(candidate,'127.0.0.1',resolve); }); server = srv; port = srv.address().port; return; }
        catch (e) { srv.close(); if (e.code !== 'EADDRINUSE') throw e; }
      }
      throw Object.assign(new Error('All Cindy Chrome loopback ports are occupied.'),{code:'BRIDGE_PORTS_BUSY'});
    })();
    try { await starting; } finally { starting = null; }
  }
  async function request(method,params = {}) {
    // Plugins of the site-list era still push their lists; acknowledged, nothing changes.
    if (method === 'setPolicy') return {ok:true,policy};
    if(method==='learningActive'||method==='learningResult'||method==='learningProgress') {
      const item=learning.get(params.id),client=item&&clients.get(item.clientId);
      const valid=!!item && !!client?.trusted && Date.now()<=item.expiresAt && (!item.payload.source.url||P.check(policy,'text',item.payload.source.url).ok);
      if(method==='learningActive')return {ok:true,active:valid&&!item?.result};
      if(!valid)return failure('REQUEST_CANCELLED','Request no longer active.');
      if(method==='learningProgress'){
        if(!item.result&&['accepted','opening-task','submitting-task','stopping','cache','queued','waiting-previous','model','generating','validating','saving'].includes(params.progress?.stage)){
          const previous=item.progress||{},attempt=Number.isInteger(params.progress.attempt)?Math.min(3,Math.max(1,params.progress.attempt)):previous.attempt||1;
          item.progress={stage:params.progress.stage,attempt,...(Number.isSafeInteger(params.progress.receivedChars)&&params.progress.receivedChars>=0?{receivedChars:params.progress.receivedChars}:{}),startedAt:previous.startedAt||item.created,updatedAt:previous.stage===params.progress.stage&&previous.attempt===attempt?previous.updatedAt:Date.now()};
        }
        return {ok:true};
      }
      if(!item.result){item.result=params.result;item.expiresAt=Date.now()+L.learningTiming.resultRetention;}
      return {ok:true};
    }
    if (method === 'setTrustedClients') {
      if (!Array.isArray(params.clients) || params.clients.length > 16) throw new Error('Invalid paired browsers.');
      pins = params.clients;
      for (const c of clients.values()) c.trusted = approved(c);
      return {ok:true};
    }
    try{await start();}catch(e){return failure(e.code==='BRIDGE_PORTS_BUSY'?'BRIDGE_PORTS_BUSY':e.code==='EACCES'||e.code==='EPERM'?'BRIDGE_LISTEN_DENIED':'BRIDGE_START_FAILED',e.message);}
    if (method === 'status') return {ok:true,version:manifest.version,protocol:PROTOCOL,port,extension_connected:connected().length>0,extension_id:primaryId,extension_dir:path.resolve(__dirname,'../extension'),policy,pending:jobs.size,clients:[...clients.values()].filter(live).map(publicClient)};
    if (method !== 'act') return failure('UNKNOWN_METHOD','Choose a supported bridge method.');
    const payload = P.validate(params.action,params.payload || {}), gate = P.check(policy,params.action,payload.url);
    if (!gate.ok) return gate;
    const until = Date.now()+(options.connectWait ?? 6000);
    while (!connected().length && Date.now()<until) await new Promise(r => setTimeout(r,100));
    const candidates = connected();
    const client = payload.browser ? candidates.find(c => c.id === payload.browser) : candidates.length === 1 ? candidates[0] : null;
    if (!client) return {...failure(candidates.length>1 && !payload.browser ? 'BROWSER_REQUIRED' : 'EXTENSION_DISCONNECTED',candidates.length>1 ? 'Choose a browser connection id; never guess the account/profile.' : 'Open Cindy Chrome settings to install, enable or reconnect the extension.'),clients:candidates.map(publicClient)};
    if (jobs.size >= 16) return failure('BRIDGE_BUSY','Wait for browser tasks to finish.');
    return new Promise(resolve => {
      const job = {id:crypto.randomUUID(),action:params.action,payload,clientId:client.id,state:'queued',resolve,created:Date.now()};
      job.timer = setTimeout(() => finish(job,jobFailure(job,'BROWSER_TIMEOUT','Verify an unknown operation; it will not be replayed.')),Math.max(options.jobTimeout || 45000,params.action === 'wait' ? (payload.timeMs || 0)+(payload.timeoutMs ?? 30000)+15000 : 0));
      jobs.set(job.id,job); waiting.get(client.id)?.();
    });
  }
  async function close() {
    learning.clear();
    for (const job of [...jobs.values()]) finish(job,jobFailure(job,'BRIDGE_STOPPED','Check the page before repeating an interrupted action.'));
    for (const waiter of [...waiting.values()]) waiter();
    if (server) { const s = server; server = null; s.closeAllConnections(); await new Promise(r => s.close(r)); }
  }
  return {request,close};
}
module.exports = {createBridge,EXT_ID,PROTOCOL};
