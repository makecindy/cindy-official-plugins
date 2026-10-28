import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const P=require('../my-browser/extension/policy.js');
const {assertSupported}=require('../my-browser/extension/network-guard.js');
const source=fs.readFileSync(new URL('../my-browser/extension/background.js',import.meta.url),'utf8');
function harness(documentReason=()=>'NAVIGATION_UNOBSERVED') {
  const tabs=new Map(),data={};let clock=0,next=1,creates=0,activate,removed;
  const state={redirect:false,loading:false,removeFails:false,domReady:false,completeAt:Infinity};
  const chrome={action:{onClicked:{addListener(){}}},runtime:{getURL:()=> 'chrome-extension://fixture/',getManifest:()=>({version:'0.3.1'}),onStartup:{addListener(){}},onInstalled:{addListener(){}},onMessage:{addListener(){}}},
    storage:{local:{get:async()=>({clientId:'fixture'}),set:async()=>{}},session:{get:async key=>({[key]:structuredClone(data[key])}),set:async value=>Object.assign(data,structuredClone(value))}},
    tabs:{get:async id=>{if(!tabs.has(id))throw new Error('No tab');if(clock>=state.completeAt)tabs.get(id).status='complete';return {...tabs.get(id)};},query:async()=>[...tabs.values()].map(t=>({...t})),
      create:async({url})=>{creates++;const t={id:next++,url:state.redirect?'https://example.test/redirected':url,status:state.loading?'loading':'complete',active:false};tabs.set(t.id,t);return {...t};},
      remove:async id=>{if(state.removeFails)throw new Error('Browser refused');tabs.delete(id);removed(id);},
      onActivated:{addListener(fn){activate=fn;}},onRemoved:{addListener(fn){removed=fn;}}},alarms:{create(){},onAlarm:{addListener(){}}},
    // Agent pages open in Cindy's own background window (one window, created on first need).
    windows:{create:async({url})=>{const t=await chrome.tabs.create({url});return {id:500,tabs:[t]};},get:async id=>{if(id!==500)throw new Error('No window');return {id,state:'normal'};},update:async()=>({})}};
  const context={chrome,MyBrowserPolicy:P,MyBrowserNetwork:{create:()=>({assertSupported,isReady:async()=>state.domReady,document:async id=>{throw Object.assign(new Error('ADDRESS_UNVERIFIED'),{reason:documentReason(id)});}})},fetch:async()=>({ok:true,json:async()=>({policy:P.defaults()})}),navigator:{userAgent:'Chrome/140'},URL,crypto:globalThis.crypto,TextEncoder,btoa,AbortController,
    Date:class extends Date{static now(){return clock;}},setTimeout(fn,ms){clock+=ms;queueMicrotask(fn);return 0;},clearTimeout(){}};
  // Disable only the network bootstrap; execute the actual production tab manager, not a copied implementation.
  vm.runInNewContext(source.replace(/\nchain\(\);\s*$/,'')+'\nglobalThis.tabTest={ensureTab,owned,cleanup,handle,videoIdentity};',context);
  return {list:args=>context.tabTest.handle({action:'tabs',payload:args},P.defaults(),{}),handle:url=>context.tabTest.handle({action:'text',payload:{url}},P.defaults(),{base:'http://fixture',session:'fixture'}),state,tabs,data,creates:()=>creates,videoIdentity:context.tabTest.videoIdentity,read:url=>context.tabTest.ensureTab(url,P.normalizePolicy({read:{block:[]},interact:{allow:[],block:[]}}), 'text'),focus:async id=>{activate({tabId:id});await Promise.resolve();await Promise.resolve();}};
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
    const h=harness();for(let i=0;i<12;i++)await h.read('https://example.test/'+i);
    if(reason==='claimed')for(const id of h.tabs.keys())await h.focus(id);
    if(reason==='navigated')for(const t of h.tabs.values())t.url+='?changed=1';
    if(reason==='remove-failure')h.state.removeFails=true;
    for(let i=0;i<5;i++)await assert.rejects(h.read('https://example.test/new'),/TAB_LIMIT/);
    assert.equal(h.tabs.size,12);assert.equal(h.creates(),12);
  }
});
test('canonical URLs and already-open user tabs are reused without creating a replacement',async()=>{
  const h=harness();await h.read('https://example.test');await h.read('https://example.test/');assert.equal(h.creates(),1);
  h.tabs.set(99,{id:99,url:'https://example.test/user',active:true,status:'complete'});
  await h.read('https://example.test/user');h.tabs.get(99).url='https://example.test/moved';
  await assert.rejects(h.read('https://example.test/user'),/PAGE_CHANGED/);assert.equal(h.creates(),1);
});
test('video resume stores a one-way URL marker instead of credentials',async()=>{
  const h=harness(),url='https://video.example/watch?v=abc&access_token=secret-token-value#sig=fragment-secret';
  const marker=await h.videoIdentity(url),same=await h.videoIdentity(url),changed=await h.videoIdentity(url.replace('secret-token-value','rotated-token-value'));
  assert.match(marker,/^sha256:[A-Za-z0-9_-]+$/);
  assert.equal(marker,same);
  assert.notEqual(marker,changed);
  assert.equal(marker.includes('secret-token-value'),false);
  assert.equal(marker.includes('access_token'),false);
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

test('restricted store pages fail without opening a replacement tab',async()=>{
  const h=harness();const result=await h.handle('https://chrome.google.com/webstore/devconsole/example/edit');
  assert.equal(result.error,'BROWSER_PAGE_RESTRICTED');assert.equal(result.execution,'not_executed');assert.equal(h.creates(),0);
  const other=await h.handle('https://example.test/');assert.equal(other.reason,'NAVIGATION_UNOBSERVED');
});

test('host tab search retains document failures and does not call filtered rows truncation',async()=>{
  const h=harness();h.tabs.set(7,{id:7,url:'https://example.test/path?token=secret',status:'complete',title:'Private title'});
  const result=await h.list({host:'example.test'});
  assert.equal(result.tabs.length,1);assert.equal(result.truncated,false);
  assert.equal(result.tabs[0].reason,'NAVIGATION_UNOBSERVED');assert.equal(result.tabs[0].status,'complete');
  assert.equal(result.tabs[0].url,undefined);assert.equal(result.tabs[0].title,undefined);
  h.tabs.set(8,{id:8,url:'https://example.test/other',status:'loading'});
  assert.equal((await h.list({host:'example.test',limit:1})).truncated,true);
});
test('slow page and DOM-ready subresource load recover within the same tab',async()=>{
  const slow=harness();slow.state.loading=true;slow.state.completeAt=18000;
  assert.equal((await slow.read('https://example.test/')).id,1);assert.equal(slow.creates(),1);
  const dom=harness();dom.state.loading=true;dom.state.domReady=true;
  assert.equal((await dom.read('https://example.test/')).id,1);assert.equal(dom.creates(),1);
});


test('host searches exclude DNS-local tabs but retain allowed-site diagnostics',async()=>{
  const h=harness(id=>id===8?'LOCAL_ADDRESS':'DOCUMENT_UNAVAILABLE');
  h.tabs.set(7,{id:7,url:'https://example.test/public',status:'complete'});
  h.tabs.set(8,{id:8,url:'https://example.test/private?token=secret',title:'Private title',status:'complete'});
  const filtered=await h.list({host:'example.test',limit:1});
  assert.deepEqual(Array.from(filtered.tabs,t=>t.id),[7]);
  assert.equal(filtered.tabs[0].reason,'DOCUMENT_UNAVAILABLE');
  assert.equal(filtered.truncated,false,'excluded local rows do not consume the limit');
  h.tabs.delete(7);
  assert.equal((await h.list({host:'example.test'})).tabs.length,0);
  const all=await h.list({});
  assert.equal(all.tabs.length,1);
  assert.equal(all.tabs[0].reason,'LOCAL_ADDRESS');
  assert.equal(all.tabs[0].redacted,true);
  assert.equal(all.tabs[0].title,undefined);
  assert.equal(all.tabs[0].url,undefined);
});
