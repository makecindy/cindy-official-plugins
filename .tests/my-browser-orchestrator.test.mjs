import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const root=path.resolve(import.meta.dirname,'..');

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
// what the orchestrator sends to the worker and how failures are reported.
async function sandbox(t) {
  const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'my-browser-sync-'));
  const policyShim=path.join(dir,'policy.shim.mjs');
  await fs.promises.writeFile(policyShim,`import {createRequire} from 'node:module';globalThis.MyBrowserPolicy=createRequire(import.meta.url)(${JSON.stringify(path.join(root,'my-browser/extension/policy.js'))});\n`);
  const source=fs.readFileSync(path.join(root,'my-browser/main.js'),'utf8')
    .replace("import('/extension/policy.js')",`import(${JSON.stringify(pathToFileURL(policyShim).href)})`);

  const state={kv:{},hosts:[],sent:[],acts:[],errors:[]};

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
    node:{request:async ({method,params = {}}) => {
      if (state.rejectSync && method === 'setTrustedClients') throw new Error('worker transport closed');
      if (method === 'setTrustedClients') return {ok:true,result:{ok:true}};
      if (method === 'status') return {ok:true,result:{ok:true,version:'fixture',extension_connected:true,clients:[]}};
      if (method === 'installation') return {ok:true,result:{ok:true,browsers:[]}};
      if (method === 'openInstallation') return {ok:true,result:{ok:true}};
      if (method === 'act') {
        // Simulates the sandbox transport dying after the worker may already have accepted the job.
        if (state.rejectNode) throw new Error('worker transport closed');
        state.acts.push({action:params.action});
        return {ok:true,result:{ok:true,url:params.payload?.url}};
      }
      return {ok:true,result:{ok:true}};
    }},
  };
  t.after(async () => {
    await fs.promises.rm(dir,{recursive:true,force:true});
    for (const key of ['BroadcastChannel','fetch','cindy','__myBrowserChannel','MyBrowserPolicy']) delete globalThis[key];
  });
  const file=path.join(dir,'main-'+crypto.randomUUID()+'.mjs');
  await fs.promises.writeFile(file,source);
  await import(pathToFileURL(file).href);

  const channel=globalThis.__myBrowserChannel;
  const callTool=async (tool,args) => {try {await state.hosts[0]({type:'tool-call',tool,args,callId:crypto.randomUUID()});} catch(e) {state.errors.push(e.message);}};
  return {state,channel,callTool};
}

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
  const guidance=state.sent.at(-1).result.how_to_install;
  assert.match(guidance,/Directory loading is the only developer fallback included/);
  assert.doesNotMatch(guidance,/ZIP.*fallback/i);
});

test('settings sync preserves node unavailability for client guidance',async t=>{
  const {state,channel}=await sandbox(t);
  state.rejectSync=true;
  const id=crypto.randomUUID();
  const response=channel.nextResponse(id);
  await channel.onmessage({data:{type:'status-request',id}});
  const result=await response;
  assert.equal(result.ok,false,JSON.stringify(result));
  assert.equal(result.error,'NODE_UNAVAILABLE');
  assert.equal(result.execution,'not_executed');
});

test('browser_act validation failures before dispatch are not_executed',async t=>{
  const {state,callTool}=await sandbox(t);
  await callTool('browser_act',{url:'https://example.test',kind:'type',selector:'#query'});
  const missingText=state.sent.at(-1).result;
  assert.equal(missingText.ok,false,JSON.stringify(missingText));
  assert.equal(missingText.execution,'not_executed');
  assert.equal(state.acts.length,0,'the worker must not receive an invalid type call');
  await callTool('browser_act',{url:'https://example.test',kind:'click'});
  assert.equal(state.sent.at(-1).result.execution,'not_executed');
  assert.equal(state.acts.length,0);
});
