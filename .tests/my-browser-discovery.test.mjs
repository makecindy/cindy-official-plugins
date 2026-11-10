import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const installedVersion=JSON.parse(fs.readFileSync(new URL('../my-browser/extension/manifest.json',import.meta.url),'utf8')).version;
const version='0.4.13'; // Stable signed wire contract, independent of extension releases.
const source=fs.readFileSync(new URL('../my-browser/extension/background.js',import.meta.url),'utf8');
test('discovery continues past mismatched and unpaired bridges without opening tabs',async()=>{
  const ports=[],saved={};
  const noop={addListener(){}};
  const chrome={runtime:{id:'fixture',getManifest:()=>({version:installedVersion}),getURL:()=> 'chrome-extension://fixture/',onStartup:noop,onInstalled:noop,onMessage:noop},
    storage:{local:{get:async()=>({clientId:'fixture'}),set:async()=>{}},session:{get:async()=>({}),set:async v=>Object.assign(saved,v)}},
    tabs:{onRemoved:noop,onActivated:noop},alarms:{create(){},onAlarm:noop},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}}};
  const context={chrome,MyBrowserNetwork:{create:()=>({})},MyBrowserPolicy:{},navigator:{userAgent:'Chrome'},URL,AbortController,setTimeout,clearTimeout,crypto:globalThis.crypto,
    fetch:async url=>{const port=Number(new URL(url).port);ports.push(port);return {ok:true,json:async()=>({plugin:'my-browser',protocol:3,extensionId:'fixture',version:port===18810?'0.2.0':version,pairing_required:port===18811,session:'fixture-session'})};}};
  vm.runInNewContext(source.replace(/\nchain\(\);\s*$/,'')+'\nglobalThis.discoverTest=discover;',context);
  const found=await context.discoverTest();assert.equal(found.base,'http://127.0.0.1:18812');assert.deepEqual(ports,Array.from({length:10},(_,i)=>18810+i));assert.equal(saved.connection.connected,true);
});
for(const previousVersion of ['0.3.48','0.4.0','0.4.1','0.4.2','0.4.3','0.4.4','0.4.5','0.4.6','0.4.7','0.4.8','0.4.9','0.4.10','0.4.11','0.4.12'])test('a new extension negotiates plugin '+previousVersion,async()=>{
 const versions=[],noop={addListener(){}},saved={};
 const chrome={runtime:{id:'fixture',getManifest:()=>({version:installedVersion}),getURL:()=> 'chrome-extension://fixture/',onStartup:noop,onInstalled:noop,onMessage:noop},storage:{local:{get:async()=>({clientId:'fixture'}),set:async()=>{}},session:{get:async()=>({}),set:async v=>Object.assign(saved,v)}},tabs:{onRemoved:noop,onActivated:noop},alarms:{create(){},onAlarm:noop},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}}};
 const context={chrome,MyBrowserNetwork:{create:()=>({})},MyBrowserPolicy:{},navigator:{userAgent:'Chrome'},URL,AbortController,setTimeout,clearTimeout,crypto:globalThis.crypto,fetch:async(_url,options)=>{versions.push(options.headers['X-My-Browser-Version']);return {ok:true,json:async()=>({plugin:'my-browser',protocol:3,extensionId:'fixture',version:previousVersion,session:'old-session',capabilities:[]})};}};
 vm.runInNewContext(source.replace(/\nchain\(\);\s*$/,'')+'\nglobalThis.discoverTest=discover;',context);
 const found=await context.discoverTest();assert.equal(found.session,'old-session');assert.equal(found.learning,false);assert.equal(versions.filter(v=>v===version).length,10);assert.equal(versions.filter(v=>v===previousVersion).length,10);assert.equal(saved.connection.connected,true);
});

test('an updated extension keeps a paired older bridge connected while negotiating learning',async()=>{
 const noop={addListener(){}},saved={},auth={publicKey:'test-key',sign:async()=>new Uint8Array()};
 const chrome={runtime:{id:'fixture',getManifest:()=>({version:installedVersion}),getURL:()=> 'chrome-extension://fixture/',onStartup:noop,onInstalled:noop,onMessage:noop},storage:{local:{get:async()=>({clientId:'fixture'}),set:async()=>{}},session:{get:async()=>({}),set:async v=>Object.assign(saved,v)}},tabs:{onRemoved:noop,onActivated:noop},alarms:{create(){},onAlarm:noop},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}}};
 const calls=[];const context={chrome,MyBrowserNetwork:{create:()=>({})},MyBrowserPolicy:{},navigator:{userAgent:'Chrome'},URL,AbortController,setTimeout,clearTimeout,crypto:globalThis.crypto,TextEncoder,Buffer,btoa:value=>Buffer.from(value,'binary').toString('base64'),__testAuth:auth,
   fetch:async(url,options)=>{const headers=options.headers;calls.push({url,key:headers['X-My-Browser-Key'],proof:headers['X-My-Browser-Proof']});return {ok:true,json:async()=>headers['X-My-Browser-Key']?{plugin:'my-browser',protocol:3,extensionId:'fixture',version:'0.4.12',session:'old-session',capabilities:[]}:{plugin:'my-browser',protocol:3,extensionId:'fixture',version:'0.4.12',session:'old-session',challenge:'old-challenge',auth_required:false}};}};
 context.globalThis=context;
 vm.runInNewContext(source.replace(/\nchain\(\);\s*$/,'').replaceAll("auth=auth||await withDeadline(authReady(),3000,Error('AUTH_TIMEOUT')).catch(()=>null)","auth=auth||globalThis.__testAuth||await withDeadline(authReady(),3000,Error('AUTH_TIMEOUT')).catch(()=>null)")+'\nglobalThis.discoverTest=discover;',context);
 const found=await context.discoverTest();assert.equal(found.session,'old-session');assert.equal(found.learning,false);assert.equal(saved.connection.connected,true);
});

function workerContext(fetch){
  const noop={addListener(){}};
  const chrome={runtime:{id:'fixture',getManifest:()=>({version:installedVersion}),getURL:()=> 'chrome-extension://fixture/',onStartup:noop,onInstalled:noop,onMessage:noop},storage:{local:{get:async()=>({clientId:'fixture'}),set:async()=>{}},session:{get:async()=>({}),set:async()=>{}}},tabs:{onRemoved:noop,onActivated:noop},alarms:{create(){},onAlarm:noop},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}}};
 const testAuth={publicKey:'test-key',sign:async()=>new Uint8Array()};
 const context={chrome,MyBrowserNetwork:{create:()=>({})},MyBrowserPolicy:{},navigator:{userAgent:'Chrome'},URL,AbortController,setTimeout,clearTimeout,crypto:globalThis.crypto,TextEncoder,Buffer,btoa:value=>Buffer.from(value,'binary').toString('base64'),__testAuth:testAuth,fetch};
 vm.runInNewContext(source.replace(/\nchain\(\);\s*$/,'').replace('return {base,port,version,session:r.session,learning,auth};','return {base,port,version,session:r.session,learning,auth:globalThis.__testAuth};')+'\nglobalThis.testAPI={discover,learningFetch};',context);return context.testAPI;
}
test('simultaneous callers share one discovery scan',async()=>{
 let scans=0,release;const gate=new Promise(r=>release=r);
 const api=workerContext(async()=>{scans++;await gate;return {ok:true,json:async()=>({plugin:'my-browser',protocol:3,extensionId:'fixture',version,session:'session'})};});
 const a=api.discover(),b=api.discover();await new Promise(r=>setImmediate(r));assert.equal(scans,10);release();
 assert.equal(await a,await b);assert.equal(scans,10);
});
test('lost learning responses retry the original id/session, never cross a changed session',async()=>{
 const calls=[];let changed=false;
 const api=workerContext(async(url,options)=>{calls.push({url,options});if(changed)return {ok:false,json:async()=>({error:'SESSION_CHANGED'})};if(url.endsWith('/learning/challenge'))return {ok:true,json:async()=>({ok:true,challenge:'challenge-'+calls.length})};if(calls.length===2)throw new TypeError('Failed to fetch');return {ok:true,json:async()=>({done:true})};});
 const target={base:'http://127.0.0.1:18810',session:'original',auth:{publicKey:'test-key',sign:async()=>new Uint8Array()}},body={id:crypto.randomUUID()};
 assert.equal((await api.learningFetch(target,'/learning/result',body,async()=>{},Date.now()+10000)).done,true);
 assert.equal(calls.length,4);assert.equal(calls[1].options.body,calls[3].options.body);
 assert.equal(calls[1].options.headers['X-My-Browser-Session'],'original');assert.equal(calls[3].options.headers['X-My-Browser-Session'],'original');
 changed=true;await assert.rejects(api.learningFetch(target,'/learning/start',body,async()=>{},Date.now()+10000),/SESSION_CHANGED/);assert.equal(calls.length,5);
});
test('cancellation stops a safe transport retry before another request is sent',async()=>{
 let calls=0,active=true;
 const api=workerContext(async()=>{calls++;active=false;throw new TypeError('network down');});
 await assert.rejects(api.learningFetch({base:'http://127.0.0.1:18810',session:'session'},'/learning/start',{id:crypto.randomUUID()},async()=>{if(!active)throw Error('REQUEST_CANCELLED');},Date.now()+10000),/REQUEST_CANCELLED/);
 assert.equal(calls,1);
});

test('discovery finds a bridge past the original ten ports and rejects generic HTTP listeners',async()=>{
 const ports=[];const api=workerContext(async url=>{const port=Number(new URL(url).port);ports.push(port);return {ok:true,json:async()=>port===18825?{plugin:'my-browser',protocol:3,extensionId:'fixture',version,session:'fallback-session'}:{ok:true}};});
 const bridge=await api.discover();assert.equal(bridge.base,'http://127.0.0.1:18825');assert.equal(ports.length,20);
});


test('cancel during discovery prevents submission and cannot be forged by another document',async()=>{
 const core=(await import('./../my-browser/extension/learning-core.js')).default||globalThis.CindyLearning;
 const listeners=[],starts=[],noop={addListener(){}};let release;const gate=new Promise(r=>release=r);
 const chrome={runtime:{id:'fixture',getManifest:()=>({version:installedVersion}),getURL:p=>'chrome-extension://fixture/'+p,onStartup:noop,onInstalled:noop,onMessage:{addListener:f=>listeners.push(f)}},storage:{local:{get:async()=>({clientId:crypto.randomUUID()}),set:async()=>{}},session:{get:async()=>({}),set:async()=>{}}},tabs:{onRemoved:noop,onActivated:noop,get:async()=>({id:1,url:'https://example.test/watch',title:'Test'}),sendMessage:async()=>{}},alarms:{create(){},onAlarm:noop},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}}};
 const context={chrome,MyBrowserNetwork:{create:()=>({document:async()=> 'doc'})},MyBrowserPolicy:{},CindyLearning:core,navigator:{userAgent:'Chrome'},URL,AbortController,setTimeout,clearTimeout,crypto,TextEncoder,Buffer,btoa:value=>Buffer.from(value,'binary').toString('base64'),
 fetch:async(url,opt)=>{if(url.endsWith('/health')){await gate;return {ok:true,json:async()=>({plugin:'my-browser',protocol:3,extensionId:'fixture',version,session:'session',capabilities:['learning-v1','learning-auth-v2']})};}if(url.endsWith('/learning/challenge'))return {ok:true,json:async()=>({ok:true,challenge:'challenge'})};if(url.endsWith('/learning/start'))starts.push(JSON.parse(opt.body).id);return {ok:true,json:async()=>url.endsWith('/learning/result')?{done:true,result:{ok:true}}:{ok:true}};}};
 context.__testAuth={publicKey:'test-key',sign:async()=>new Uint8Array()};
 vm.runInNewContext(source.replace(/\nchain\(\);\s*$/,'').replace('return {base,port,version,session:r.session,learning,auth};','return {base,port,version,session:r.session,learning,auth:globalThis.__testAuth};').replace('const auth=target.auth||await authReady();','const auth=target.auth||globalThis.__testAuth||await authReady();')+'\nglobalThis.reviewAPI={learningRequest};',context);
 const sender={id:'fixture',documentId:'doc',frameId:0,tab:{id:1},url:'https://example.test/watch'};
 const first=crypto.randomUUID(),second=crypto.randomUUID();
 const request=id=>context.reviewAPI.learningRequest({id,request:{op:'translate',text:'hello',source:{url:sender.url}}},sender).catch(e=>e.message);
 const a=request(first),b=request(second);await new Promise(r=>setImmediate(r));
 for(const fn of listeners){fn({type:'cindy-cancel',id:first},sender,()=>{});fn({type:'cindy-cancel',id:second},{...sender,documentId:'other'},()=>{});}
 release();assert.equal(await a,'REQUEST_CANCELLED');assert.equal((await b).ok,true);assert.deepEqual(starts,[second]);
});

// Regression: the host's 35s lease expired during a long page job; a stalled
// cleanup also stopped all future polls while the watchdog only saw running=true.
function connectionWorker(t, { stuckCleanup = false, job = false, failResult = false, stuckBody = false } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const noop = { addListener() {} }, requests = [], alarms = [];
  const chrome = {
    runtime: { id: 'fixture', getManifest: () => ({ version: installedVersion }), getURL: () => 'chrome-extension://fixture/', onStartup: noop, onInstalled: noop, onMessage: noop },
    storage: { local: { get: async () => ({ clientId: 'fixture' }), set: async () => {} }, session: { get: async () => ({}), set: async () => {} } },
    tabs: { onRemoved: noop, onActivated: noop }, alarms: { create() {}, onAlarm: { addListener: f => alarms.push(f) } },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  };
  let issued = false, release;
  const pageJob = new Promise(r => { release = r; });
  const context = { chrome, MyBrowserNetwork: { create: () => ({}) }, MyBrowserPolicy: { normalizePolicy: x => x }, navigator: { userAgent: 'Chrome' }, URL, AbortController, setTimeout, clearTimeout, Date, crypto: globalThis.crypto,
    fetch: async (url, opts) => {
      const path = new URL(url).pathname;
      requests.push({ path, time: Date.now() });
      let data = { ok: true };
      if (path === '/health') data = { plugin: 'my-browser', protocol: 3, extensionId: 'fixture', version, session: 'session' };
      if (path === '/poll') {
        if (job && !issued) { issued = true; data = { job: { id: 'one', action: 'wait', payload: { timeMs: 60000 } } }; }
        else { await new Promise(r => setTimeout(r, 20000)); data = { job: null }; }
      }
      if (path === '/result' && failResult) throw Error('lost response');
      return { ok: true, json: async () => stuckBody ? new Promise(() => {}) : data };
    },
    pageJob, stuckCleanup,
  };
  vm.runInNewContext(source.replace(/\nchain\(\);\s*$/, '') + `
    handle = () => pageJob;
    if (stuckCleanup) cleanup = () => new Promise(() => {});
    globalThis.api = {chain, heartbeat, fetchJSON};`, context);
  const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
  return { ...context.api, requests, release, flush, alarm: () => alarms.forEach(f => f({ name: 'my-browser-watchdog' })),
    advance: async ms => { for (let i = 0; i < ms; i += 1000) { t.mock.timers.tick(1000); await flush(); } } };
}

test('long page jobs keep the bridge alive without taking or replaying another job', async t => {
  const h = connectionWorker(t, { job: true, failResult: true });
  void h.chain(); await h.flush();
  await h.advance(50000);
  const health = h.requests.filter(r => r.path === '/health');
  assert.ok(health.some(r => r.time >= 40000), 'heartbeat continues during the page job');
  assert.equal(h.requests.filter(r => r.path === '/ack').length, 1);
  assert.equal(h.requests.filter(r => r.path === '/poll').length, 1);
  h.release({ ok: true }); await h.flush(); await h.advance(5000);
  assert.equal(h.requests.filter(r => r.path === '/result').length, 1, 'lost result is not resubmitted');
  assert.equal(h.requests.filter(r => r.path === '/ack').length, 1, 'operation is never replayed');
});

test('a hanging idle cleanup cannot block polling or multiply loops on alarms', async t => {
  const h = connectionWorker(t, { stuckCleanup: true });
  void h.chain(); await h.flush();
  await h.advance(65000); h.alarm(); h.alarm(); await h.flush();
  assert.equal(h.requests.filter(r => r.path === '/poll').length, 4);
  assert.ok(h.requests.some(r => r.path === '/health' && r.time >= 60000));
});


test('a stalled response body times out and releases the connection request', async t => {
  const h = connectionWorker(t, { stuckBody: true });
  const rejected = assert.rejects(h.fetchJSON('http://127.0.0.1:18810','/health','session',undefined,5000), /BRIDGE_REQUEST_FAILED/);
  await h.flush(); await h.advance(5000); await rejected;
});
