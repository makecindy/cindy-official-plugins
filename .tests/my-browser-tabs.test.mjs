import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const P=require('../my-browser/extension/policy.js');
const source=fs.readFileSync(new URL('../my-browser/extension/background.js',import.meta.url),'utf8');
function harness() {
  const tabs=new Map(),data={};let clock=0,next=1,creates=0,activate,removed;
  const state={redirect:false,loading:false,removeFails:false};
  const chrome={runtime:{getURL:()=> 'chrome-extension://fixture/',getManifest:()=>({version:'0.3.1'}),onStartup:{addListener(){}},onInstalled:{addListener(){}},onMessage:{addListener(){}}},
    storage:{local:{get:async()=>({clientId:'fixture'}),set:async()=>{}},session:{get:async key=>({[key]:structuredClone(data[key])}),set:async value=>Object.assign(data,structuredClone(value))}},
    tabs:{get:async id=>{if(!tabs.has(id))throw new Error('No tab');return {...tabs.get(id)};},query:async()=>[...tabs.values()].map(t=>({...t})),
      create:async({url})=>{creates++;const t={id:next++,url:state.redirect?'https://example.test/redirected':url,status:state.loading?'loading':'complete',active:false};tabs.set(t.id,t);return {...t};},
      remove:async id=>{if(state.removeFails)throw new Error('Browser refused');tabs.delete(id);removed(id);},
      onActivated:{addListener(fn){activate=fn;}},onRemoved:{addListener(fn){removed=fn;}}},alarms:{create(){},onAlarm:{addListener(){}}}};
  const context={chrome,MyBrowserPolicy:P,MyBrowserNetwork:{create:()=>({document:async()=>{throw new Error('ADDRESS_UNVERIFIED');}})},fetch:async()=>({ok:true,json:async()=>({policy:P.defaults()})}),navigator:{userAgent:'Chrome/140'},URL,crypto:globalThis.crypto,AbortController,
    Date:class extends Date{static now(){return clock;}},setTimeout(fn,ms){clock+=ms;queueMicrotask(fn);return 0;},clearTimeout(){}};
  // Disable only the network bootstrap; execute the actual production tab manager, not a copied implementation.
  vm.runInNewContext(source.replace(/\nchain\(\);\s*$/,'')+'\nglobalThis.tabTest={ensureTab,owned,cleanup,handle};',context);
  return {handle:url=>context.tabTest.handle({action:'text',payload:{url}},P.defaults(),{base:'http://fixture',session:'fixture'}),state,tabs,data,creates:()=>creates,read:url=>context.tabTest.ensureTab(url,P.normalizePolicy({read:{block:[]},interact:{allow:[],block:[]}}), 'text'),focus:async id=>{activate({tabId:id});await Promise.resolve();await Promise.resolve();}};
}
test('redirected load timeout retains one tab across repeated reads and later readiness',async()=>{
  const h=harness();h.state.redirect=true;h.state.loading=true;
  for(let i=0;i<5;i++)await assert.rejects(h.read('https://example.test/start'),/PAGE_LOAD_TIMEOUT/);
  assert.equal(h.creates(),1);h.tabs.get(1).status='complete';
  assert.equal((await h.read('https://example.test/start')).id,1);assert.equal(h.creates(),1);
});
test('user focus does not discard the requested-URL alias of a redirected tab',async()=>{
  const h=harness();h.state.redirect=true;await h.read('https://example.test/start');await h.focus(1);
  for(let i=0;i<5;i++)assert.equal((await h.read('https://example.test/start')).id,1);
  assert.equal(h.creates(),1);
});
test('a navigated tab produces PAGE_CHANGED rather than a stream of replacements',async()=>{
  const h=harness();await h.read('https://example.test/start');h.tabs.get(1).url='https://example.test/elsewhere';
  for(let i=0;i<5;i++)await assert.rejects(h.read('https://example.test/start'),/PAGE_CHANGED/);
  assert.equal(h.creates(),1);
});
test('unclosable or user-claimed tabs remain counted against the real opening limit',async()=>{
  for(const reason of ['claimed','navigated','remove-failure']){
    const h=harness();for(let i=0;i<3;i++)await h.read('https://example.test/'+i);
    if(reason==='claimed')for(const id of h.tabs.keys())await h.focus(id);
    if(reason==='navigated')for(const t of h.tabs.values())t.url+='?changed=1';
    if(reason==='remove-failure')h.state.removeFails=true;
    for(let i=0;i<5;i++)await assert.rejects(h.read('https://example.test/new'),/TAB_LIMIT/);
    assert.equal(h.tabs.size,3);assert.equal(h.creates(),3);
  }
});
test('canonical URLs and already-open user tabs are reused without creating a replacement',async()=>{
  const h=harness();await h.read('https://example.test');await h.read('https://example.test/');assert.equal(h.creates(),1);
  h.tabs.set(99,{id:99,url:'https://example.test/user',active:true,status:'complete'});
  await h.read('https://example.test/user');h.tabs.get(99).url='https://example.test/moved';
  await assert.rejects(h.read('https://example.test/user'),/PAGE_CHANGED/);assert.equal(h.creates(),1);
});

test('read failure reflects whether this invocation started navigation',async()=>{
  const loading=harness();loading.state.loading=true;
  const timeout=await loading.handle('https://example.test/start');
  assert.equal(timeout.error,'PAGE_LOAD_TIMEOUT');assert.equal(timeout.execution,'unknown');
  assert.equal(loading.creates(),1);
  const guarded=harness();
  const denied=await guarded.handle('https://example.test/start');
  assert.equal(denied.error,'ADDRESS_UNVERIFIED');assert.equal(denied.execution,'unknown');
  const reused=await guarded.handle('https://example.test/start');
  assert.equal(reused.error,'ADDRESS_UNVERIFIED');assert.equal(reused.execution,'not_executed');
  assert.equal(guarded.creates(),1);
});
