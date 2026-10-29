import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const P=require('../my-browser/extension/policy.js');
const root=path.resolve(import.meta.dirname,'..');

class FakeChannel {
  constructor() {this.sent=[];this.onmessage=null;globalThis.__myBrowserChannel=this;}
  postMessage(message) {this.sent.push(message);}
}

// Runs the real sandbox module against a host that either implements the browserExtension slot
// (replies to `browser-extension-request` on the pipe) or predates it (rejects the pipe type).
// Only the sandbox-absolute import specifiers are rewritten to local shims; no bridge, browser or
// model is involved. The test observes which transport each tool call and learning relay takes.
async function sandbox(t,{hostSlot,statusFailures=[]}) {
  const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'my-browser-host-bridge-'));
  const shim=async(name,file,global)=>{const target=path.join(dir,name+'.shim.mjs');await fs.promises.writeFile(target,`import {createRequire} from 'node:module';globalThis.${global}=createRequire(import.meta.url)(${JSON.stringify(path.join(root,file))});\n`);return pathToFileURL(target).href;};
  const policyShim=await shim('policy','my-browser/extension/policy.js','MyBrowserPolicy');
  const coreShim=await shim('learning-core','my-browser/extension/learning-core.js','CindyLearning');
  const source=fs.readFileSync(path.join(root,'my-browser/main.js'),'utf8')
    .replace("import('/extension/policy.js')",`import(${JSON.stringify(policyShim)})`)
    .replace("import('/extension/learning-core.js')",`import(${JSON.stringify(coreShim)})`)
    .replace("import('/learning-service.js')",`import(${JSON.stringify(pathToFileURL(path.join(root,'my-browser/learning-service.js')).href)})`)
    .replace("import('/translation-task.js')",`import(${JSON.stringify(pathToFileURL(path.join(root,'my-browser/translation-task.js')).href)})`);
  const state={kv:{policy:P.defaults()},hosts:[],pipe:[],node:[],errors:[]};
  globalThis.BroadcastChannel=FakeChannel;
  globalThis.fetch=async (url,options = {}) => {
    if (url !== '/kv') return {ok:false,json:async () => ({})};
    if ((options.method || 'GET') === 'PUT') {state.kv=JSON.parse(options.body);return {ok:true,json:async () => structuredClone(state.kv)};}
    return {ok:true,json:async () => structuredClone(state.kv)};
  };
  globalThis.cindy={
    onHostMessage:fn => {state.hosts.push(fn);},
    tasks:{},
    confirm:async () => ({ok:true,confirmed:true}),
    send:async message => {
      if (message.type !== 'browser-extension-request') return {ok:true};
      state.pipe.push(message);
      // What an older host's pipe actually rejects with once it crosses Electron IPC.
      if (!hostSlot) throw new Error("Error invoking remote method 'ghost-pipe:send': Error: [INVALID_PARAMS] 未知的管子消息类型");
      // A host with the slot that is not ready yet: the first probes fail transiently.
      if (message.kind === 'status' && statusFailures.length) {
        const failure=statusFailures.shift();
        if (failure.throws) throw new Error(failure.throws);
        return {ok:false,errorCode:failure.errorCode,message:'fixture'};
      }
      if (message.kind === 'status') return {ok:true,version:'0.4.37',protocol:3,port:18810,extension_connected:true,clients:[{id:'c1',connected:true}],policy:state.kv.policy,pending:0,host:true,nativeBinding:'ready'};
      if (message.kind === 'act') return {ok:true,url:message.payload.url,text:'from host',browser:'c1',untrusted_content:true};
      if (message.kind === 'setPolicy') return {ok:true,policy:message.policy};
      if (message.kind === 'relayActive') return {ok:true,active:true};
      return {ok:true};
    },
    node:{request:async ({method,params = {}}) => {
      state.node.push({method,params});
      if (method === 'describe') return {ok:true,result:{ok:true,extension_dir:'/fixture/extension',version:'0.4.37'}};
      if (method === 'status') return {ok:true,result:{ok:true,version:'0.4.37',extension_connected:false,clients:[],nativeBinding:'ready'}};
      if (method === 'installation') return {ok:true,result:{ok:true,browsers:[]}};
      if (method === 'act') return {ok:true,result:{ok:true,url:params.payload?.url,text:'from worker'}};
      if (method === 'learningActive') return {ok:true,result:{ok:true,active:true}};
      return {ok:true,result:{ok:true}};
    }},
  };
  t.after(async () => {
    await fs.promises.rm(dir,{recursive:true,force:true});
    for (const key of ['BroadcastChannel','fetch','cindy','__myBrowserChannel','myBrowserSavedPolicy','MyBrowserPolicy','CindyLearning']) delete globalThis[key];
  });
  const file=path.join(dir,'main-'+crypto.randomUUID()+'.mjs');
  await fs.promises.writeFile(file,source);
  await import(pathToFileURL(file).href);
  const callTool=async (tool,args) => {
    const callId=crypto.randomUUID();
    const sentBefore=state.pipe.length;
    try {await state.hosts[0]({type:'tool-call',tool,args,callId});} catch(e) {state.errors.push(e.message);}
    void sentBefore;
    return state.results?.get(callId);
  };
  const results=new Map();
  const originalSend=globalThis.cindy.send;
  globalThis.cindy.send=async message => {
    if (message.type === 'tool-result') {results.set(message.callId,message.result);return {ok:true};}
    return originalSend(message);
  };
  state.results=results;
  return {state,callTool,hosts:state.hosts};
}

test('a host with the browserExtension slot carries jobs, pairings and status; the worker never serves the bridge',async t=>{
  const {state,callTool}=await sandbox(t,{hostSlot:true});
  const read=await callTool('browser_read',{url:'https://example.test',mode:'content'});
  assert.equal(read.text,'from host');
  assert.equal(read.untrusted_content,true);
  const act=state.pipe.find(m => m.kind === 'act');
  assert.deepEqual({action:act.action,url:act.payload.url},{action:'content',url:'https://example.test'});
  assert.equal(state.pipe.some(m => m.kind === 'setPolicy'),false,'there are no site lists to push (2026-10-30)');
  assert.ok(state.pipe.some(m => m.kind === 'setTrustedClients'),'paired identities must be pushed to the host bridge');
  assert.equal(state.node.filter(c => c.method === 'act' || c.method === 'status' || c.method === 'setPolicy').length,0,'the bundled worker must not receive bridge traffic');
  const status=await callTool('browser_status',{});
  assert.equal(status.extension_connected,true);
  assert.equal(status.nativeBinding,'ready');
  assert.equal(status.installation.ok,true);
  assert.ok(state.node.some(c => c.method === 'describe'),'the extension directory still comes from the worker');
});

test('an older host rejects the pipe type and the bundled worker bridge keeps serving',async t=>{
  const {state,callTool}=await sandbox(t,{hostSlot:false});
  const read=await callTool('browser_read',{url:'https://example.test',mode:'content'});
  assert.equal(read.text,'from worker');
  assert.equal(state.pipe.filter(m => m.kind === 'status').length,1,'capability is probed once, then remembered');
  assert.ok(state.node.some(c => c.method === 'act'));
  assert.ok(state.node.some(c => c.method === 'setTrustedClients'));
});

test('learning relays from the host bridge are handled by the plugin and answered on the pipe',async t=>{
  const {state,hosts}=await sandbox(t,{hostSlot:true});
  await hosts[0]({type:'event',name:'browser-extension-relay',id:crypto.randomUUID(),clientId:crypto.randomUUID(),request:{op:'config',source:{url:'',title:''}},ts:Date.now()});
  const result=state.pipe.find(m => m.kind === 'relayResult');
  assert.ok(result,'the relay must be answered through the host pipe');
  assert.equal(result.result.ok,true,JSON.stringify(result.result));
  assert.equal(state.node.some(c => c.method === 'learningResult'),false,'the worker must not receive relay answers on a host with the slot');
});

// Bug regression (review 2026-10-29): any failed probe marked the host as older for the plugin's
// lifetime, so a transient refusal made the bundled worker start its own bridge and compete with
// the host for the bridge ports.
test('a transient host refusal is not remembered as an older host; the next call probes again',async t=>{
  const {state,callTool}=await sandbox(t,{hostSlot:true,statusFailures:[{errorCode:'PERMISSION_DENIED'},{throws:"Error invoking remote method 'ghost-pipe:send': Error: [HOST_NOT_READY] timeout"}]});
  await callTool('browser_read',{url:'https://example.test',mode:'content'});
  const read=await callTool('browser_read',{url:'https://example.test',mode:'content'});
  assert.equal(read.text,'from host');
  assert.ok(state.pipe.filter(m => m.kind === 'status').length>=3,'each transient failure is probed again');
  assert.equal(state.node.filter(c => ['act','status','setPolicy','setTrustedClients'].includes(c.method)).length,0,'the bundled worker never serves the bridge on a guess');
});

// A host without saved pairings asks for them with the published event name; the plugin pushes them at once.
test('a host pairing request makes the plugin push its paired browsers',async t=>{
  const {state,hosts}=await sandbox(t,{hostSlot:true});
  await new Promise(resolve => setTimeout(resolve,20));
  state.pipe.length=0;
  await hosts[0]({type:'event',name:'browser-extension-policy-request'});
  for (let i=0;i<50 && !state.pipe.some(m => m.kind === 'setTrustedClients');i++) await new Promise(resolve => setTimeout(resolve,5));
  assert.ok(state.pipe.some(m => m.kind === 'setTrustedClients'),'paired identities must be pushed');
});
