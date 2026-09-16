import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const P=require('../my-browser/extension/policy.js');
const savedPolicy=require('../my-browser/saved-policy.js');
const root=path.resolve(import.meta.dirname,'..');
const REVOKED='revoked.test';
const INITIAL=P.normalizePolicy({read:{block:[]},interact:{allow:['example.test',REVOKED]}});
const REVOKING=P.normalizePolicy({read:{block:[]},interact:{allow:['example.test']}});

class FakeChannel {
  constructor(name) {this.name=name;this.sent=[];this.listeners=[];this.onmessage=null;globalThis.__myBrowserChannel=this;}
  postMessage(message) {this.sent.push(message);for (const fn of [...this.listeners]) fn(message);}
  nextResponse(id) {
    return new Promise(resolve => {
      const fn=m => {if (m?.type === 'response' && m.id === id) {this.listeners=this.listeners.filter(x => x !== fn);resolve(m.result);}};
      this.listeners.push(fn);
    });
  }
}

// Runs the real sandbox module (main.js) with only its two sandbox-absolute import
// specifiers rewritten to local ESM shims over the same source files. Every host API
// is stubbed, so no bridge, browser or user confirmation is involved; the test observes
// which policy the orchestrator pushes to the worker and in what order.
async function sandbox(t) {
  const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'my-browser-sync-'));
  const policyShim=path.join(dir,'policy.shim.mjs'),savedShim=path.join(dir,'saved-policy.shim.mjs');
  await fs.promises.writeFile(policyShim,`import {createRequire} from 'node:module';globalThis.MyBrowserPolicy=createRequire(import.meta.url)(${JSON.stringify(path.join(root,'my-browser/extension/policy.js'))});\n`);
  await fs.promises.writeFile(savedShim,`import {createRequire} from 'node:module';globalThis.myBrowserSavedPolicy=createRequire(import.meta.url)(${JSON.stringify(path.join(root,'my-browser/saved-policy.js'))});\n`);
  const source=fs.readFileSync(path.join(root,'my-browser/main.js'),'utf8')
    .replace("import('/extension/policy.js')",`import(${JSON.stringify(pathToFileURL(policyShim).href)})`)
    .replace("import('/saved-policy.js')",`import(${JSON.stringify(pathToFileURL(savedShim).href)})`);

  const state={kv:{policy:structuredClone(INITIAL)},applied:[],worker:null,hosts:[],sent:[],confirmCalls:[],acts:[],errors:[]};
  let armHold=false,releaseHold=()=>{},reachHold;
  const holdReached=new Promise(resolve => {reachHold=resolve;});

  globalThis.BroadcastChannel=FakeChannel;
  globalThis.fetch=async (url,options = {}) => {
    if (url !== '/kv') return {ok:false,json:async () => ({})};
    if ((options.method || 'GET') === 'PUT') {
      if (state.failSave) return {ok:false,json:async () => ({})};
      state.kv=JSON.parse(options.body);
      return {ok:true,json:async () => structuredClone(state.kv)};
    }
    return {ok:true,json:async() => structuredClone(state.kv)};
  };
  globalThis.cindy={
    onHostMessage:fn => {state.hosts.push(fn);},
    send:async message => {state.sent.push(message);},
    confirm:async spec => {state.confirmCalls.push(spec);return {ok:true,confirmed:true};},
    node:{request:async ({method,params = {}}) => {
      if (method === 'setTrustedClients') {
        if (armHold) {armHold=false;reachHold();await new Promise(resolve => {releaseHold=resolve;});}
        return {ok:true,result:{ok:true}};
      }
      if (method === 'setPolicy') {state.applied.push(params.policy);state.worker=params.policy;return {ok:true,result:{ok:true}};}
      if (method === 'status') return {ok:true,result:{ok:true,version:'fixture',extension_connected:true,clients:[]}};
      if (method === 'installation') return {ok:true,result:{ok:true,browsers:[]}};
      if (method === 'openInstallation') return {ok:true,result:{ok:true}};
      if (method === 'act') {
        // Simulates the sandbox transport dying after the worker may already have accepted the job.
        if (state.rejectNode) throw new Error('worker transport closed');
        state.acts.push({action:params.action,policy:state.worker});
        return {ok:true,result:{ok:true,url:params.payload?.url}};
      }
      return {ok:true,result:{ok:true}};
    }},
  };
  t.after(async () => {
    await fs.promises.rm(dir,{recursive:true,force:true});
    for (const key of ['BroadcastChannel','fetch','cindy','__myBrowserChannel','myBrowserSavedPolicy','MyBrowserPolicy']) delete globalThis[key];
  });
  const file=path.join(dir,'main-'+crypto.randomUUID()+'.mjs');
  await fs.promises.writeFile(file,source);
  await import(pathToFileURL(file).href);

  const channel=globalThis.__myBrowserChannel;
  const callTool=async (tool,args) => {try {await state.hosts[0]({type:'tool-call',tool,args,callId:crypto.randomUUID()});} catch(e) {state.errors.push(e.message);}};
  return {state,channel,callTool,savedPolicy,
    arm:() => {armHold=true;},
    release:() => releaseHold(),
    held:() => Promise.race([holdReached,new Promise((_,reject) => setTimeout(() => reject(new Error('sync never reached the worker apply step')),2000))]),
    save:(policy,base) => {const id=crypto.randomUUID();const response=channel.nextResponse(id);const done=channel.onmessage({data:{type:'save-request',id,policy,base}});return {response,done};}};
}

test('a stalled sync cannot overwrite the permission the user just revoked',async t=>{
  const {state,channel,callTool,arm,release,held,save}=await sandbox(t);
  // Precondition: the stale snapshot really would allow the site being revoked, so a
  // rolled-back apply is observable rather than an accident of the test policy.
  assert.equal(P.check(INITIAL,'click','https://'+REVOKED).ok,true);
  assert.equal(P.check(REVOKING,'click','https://'+REVOKED).ok,false);
  arm();
  // A browser tool call enters sync(), reads the stored policy, then stalls just
  // before applying it to the worker.
  const toolCall=callTool('browser_read',{url:'https://example.test',mode:'content'});
  await held();
  // While that read result is still pending, the user revokes the site in settings.
  const {response,done}=save(REVOKING,structuredClone(INITIAL));
  // Give the save every chance to overtake the stalled sync.
  await new Promise(resolve => setTimeout(resolve,50));
  release();
  await Promise.all([toolCall,done]);
  const result=await response;
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.deepEqual(state.errors,[],'no tool call or settings request may fail');
  assert.deepEqual(state.kv.policy.interact.allow,['example.test'],'the saved revocation must persist in storage');
  assert.notEqual(state.worker,null,'the worker must have been synchronized');
  assert.equal(P.check(state.worker,'click','https://'+REVOKED).ok,false,'a stale sync must not make a revoked site actionable again');
  // The next call must also see the revocation, not a rolled-back snapshot.
  const before=state.acts.length;
  await callTool('browser_read',{url:'https://example.test',mode:'content'});
  assert.equal(state.acts.length,before+1);
  assert.equal(P.check(state.acts.at(-1).policy,'click','https://'+REVOKED).ok,false,'later tool calls must keep the revocation');
  assert.equal(channel.sent.some(m => m.type === 'policy-changed'),true,'the settings page must be told the policy changed');
});

test('permission saves stay ordered against concurrent tool-call synchronization',async t=>{
  const {state,callTool,save}=await sandbox(t);
  const saves=[save(REVOKING,structuredClone(INITIAL))];
  const calls=Array.from({length:4},() => callTool('browser_read',{url:'https://example.test',mode:'content'}));
  await Promise.all([...calls,...saves.map(s => s.done)]);
  const result=await saves[0].response;
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.deepEqual(state.errors,[],'concurrent sync and save must not fail or deadlock');
  assert.deepEqual(state.kv.policy.interact.allow,['example.test']);
  assert.equal(P.check(state.worker,'click','https://'+REVOKED).ok,false,'the last applied policy must be the saved one');
  assert.equal(state.confirmCalls.length,0,'a pure revocation must not require an interaction grant confirmation');
});

test('a transport failure while reading reports unknown, not not_executed',async t=>{
  const {state,callTool}=await sandbox(t);
  state.rejectNode=true;
  const actsBefore=state.acts.length;
  await callTool('browser_read',{url:'https://example.test',mode:'content'});
  assert.equal(state.acts.length,actsBefore,'the read must have been attempted and rejected, not silently skipped');
  const result=state.sent.at(-1).result;
  assert.equal(result.ok,false,JSON.stringify(result));
  assert.equal(result.error,'NODE_UNAVAILABLE');
  // A read that already reached the browser may have marked notifications as seen, so it
  // cannot be reported as "nothing happened".
  assert.equal(result.execution,'unknown');
  // A status check has no site side effect, so it stays precise rather than unknown.
  state.rejectNode=false;
  await callTool('browser_status',{});
  assert.equal(state.sent.at(-1).result.ok,true);
});
