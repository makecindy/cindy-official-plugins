// Parity with Cindy's dedicated browser (2026-10-28): the user picks which browser the agent uses, so
// the extension offers the same actions; it must not disturb the user's own browsing. Runs the real
// background.js tab handling against a fake chrome API.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const P=require('../my-browser/extension/policy.js');
const {assertSupported}=require('../my-browser/extension/network-guard.js');
// vm objects come from another realm; compare their JSON shape.
const same=(actual,expected)=>assert.deepEqual(JSON.parse(JSON.stringify(actual)),expected);
const source=fs.readFileSync(new URL('../my-browser/extension/background.js',import.meta.url),'utf8');

function harness() {
  const tabs=new Map(),windows=new Map([[1,{id:1,state:'normal'}]]),data={},calls=[];let next=10,nextWindow=500;
  const chrome={permissions:{contains:async()=>false},action:{onClicked:{addListener(){}}},runtime:{getURL:path=> 'chrome-extension://fixture/'+(path||''),getManifest:()=>({version:'0.4.42'}),onStartup:{addListener(){}},onInstalled:{addListener(){}},onMessage:{addListener(){}}},
    storage:{local:{get:async()=>({clientId:'fixture'}),set:async()=>{}},session:{get:async key=>({[key]:structuredClone(data[key])}),set:async value=>Object.assign(data,structuredClone(value))}},
    tabs:{get:async id=>{if(!tabs.has(id))throw new Error('No tab');return {...tabs.get(id)};},query:async q=>[...tabs.values()].filter(t=>!q?.windowId || t.windowId===q.windowId).map(t=>({...t})),
      create:async({url,windowId=1,active=false})=>{const t={id:next++,url,windowId,status:'complete',active};if(active)for(const o of tabs.values())if(o.windowId===windowId)o.active=false;tabs.set(t.id,t);calls.push(['tabs.create',{url,windowId,active}]);return {...t};},
      update:async(id,props)=>{calls.push(['tabs.update',id,props]);const t=tabs.get(id);if(props.active)for(const o of tabs.values())if(o.windowId===t.windowId)o.active=false;Object.assign(t,props);return {...t};},
      remove:async id=>{tabs.delete(id);calls.push(['tabs.remove',id]);},
      captureVisibleTab:async(windowId,options)=>{calls.push(['capture',windowId,options]);return 'data:image/'+options.format+';base64,AAAA';},
      onActivated:{addListener(){}},onRemoved:{addListener(){}}},alarms:{create(){},onAlarm:{addListener(){}}},
    windows:{create:async options=>{calls.push(['windows.create',options]);const w={id:nextWindow++,state:'normal'};windows.set(w.id,w);const t=await chrome.tabs.create({url:options.url,windowId:w.id,active:true});return {id:w.id,tabs:[t]};},
      get:async id=>{if(!windows.has(id))throw new Error('No window');return {...windows.get(id)};},getLastFocused:async()=>({id:1}),update:async(id,props)=>{calls.push(['windows.update',id,props]);Object.assign(windows.get(id),props);return {};}}};
  const context={chrome,MyBrowserPolicy:P,MyBrowserNetwork:{create:()=>({assertSupported,isReady:async()=>true,document:async()=> 'doc'})},fetch:async()=>({ok:true,json:async()=>({policy:P.defaults()})}),navigator:{userAgent:'Chrome/140'},URL,crypto:globalThis.crypto,TextEncoder,btoa,AbortController,
    setTimeout(fn){queueMicrotask(fn);return 0;},clearTimeout(){}};
  vm.runInNewContext(source.replace(/\nchain\(\);\s*$/,'')+'\nglobalThis.tabTest={handle};',context);
  const run=(action,payload)=>context.tabTest.handle({id:'job',action,payload},P.defaults(),{base:'http://fixture',session:'fixture'});
  // A tab the user has open in their own window, behind the one they are looking at.
  tabs.set(1,{id:1,url:'https://example.test/user',windowId:1,status:'complete',active:true});
  tabs.set(2,{id:2,url:'https://example.test/behind',windowId:1,status:'complete',active:false});
  return {run,tabs,windows,calls};
}

test('policy: open is a read like navigate; new actions need a tab id and bounded input',()=>{
  assert.ok(P.READ.includes('open'));assert.ok(!P.INTERACT.includes('open'));
  for(const action of ['screenshot','console','requests','responseBody','wait'])assert.ok(P.READ.includes(action),action);
  for(const action of ['focus','close','upload','evaluate','clickCoords','drag','dialog','resize'])assert.ok(P.INTERACT.includes(action),action);
  assert.throws(()=>P.validate('screenshot',{url:'https://example.test/'}),/tab id/);
  P.validate('clickCoords',{url:'https://example.test/',tabId:1,ref:'r1',modifiers:['Shift','ControlOrMeta']});
  P.validate('clickCoords',{url:'https://example.test/',tabId:1,x:3,y:4});
  // On-demand debugger: pdf reads, raw protocol interacts, the access check addresses no page.
  assert.ok(P.READ.includes('pdf'));assert.ok(P.INTERACT.includes('cdp'));
  P.validate('debuggerAccess',{});assert.equal(P.check(P.defaults(),'debuggerAccess').ok,true);
  P.validate('cdp',{url:'https://example.test/',tabId:1,op:'command',method:'Network.getCookies',params:{}});
  assert.throws(()=>P.validate('cdp',{url:'https://example.test/',tabId:1,op:'command',method:'eval(1)'}),/protocol method/);
  assert.throws(()=>P.validate('cdp',{url:'https://example.test/',tabId:1,op:'attach'}),/op/);
  assert.throws(()=>P.validate('pdf',{url:'https://example.test/'}),/tab id/);
  assert.throws(()=>P.validate('clickCoords',{url:'https://example.test/',tabId:1}),/x and y/);
  assert.throws(()=>P.validate('clickCoords',{url:'https://example.test/',tabId:1,x:1,y:1,modifiers:['Hyper']}),/modifiers/);
  assert.throws(()=>P.validate('resize',{url:'https://example.test/',tabId:1,width:50,height:600}),/200/);
  assert.throws(()=>P.validate('upload',{url:'https://example.test/',tabId:1,ref:'r',files:[]}),/files/);
  assert.equal(P.check(P.defaults(),'text','http://127.0.0.1:3000/').ok,true);
});

test('open goes to an unfocused Cindy window and reuses it; the user window is untouched',async()=>{
  const h=harness();
  const first=await h.run('open',{url:'https://example.test/a'});
  assert.equal(first.ok,true);assert.equal(first.window,500);
  same(h.calls.find(c=>c[0]==='windows.create')[1],{url:'https://example.test/a',focused:false,type:'normal'});
  const second=await h.run('open',{url:'https://example.test/b'});
  assert.equal(second.window,500);assert.equal(h.calls.filter(c=>c[0]==='windows.create').length,1);
  assert.equal(h.tabs.get(1).active,true);
});

test('screenshot never switches the tab the user is looking at',async()=>{
  const h=harness();
  const behind=await h.run('screenshot',{url:'https://example.test/behind',tabId:2});
  assert.equal(behind.error,'TAB_NOT_VISIBLE');assert.equal(h.tabs.get(1).active,true);
  assert.equal(h.calls.some(c=>c[0]==='capture'),false);
  const visible=await h.run('screenshot',{url:'https://example.test/user',tabId:1,type:'jpeg'});
  assert.equal(visible.ok,true);assert.equal(visible.mimeType,'image/jpeg');assert.equal(visible.data,'AAAA');
  same(h.calls.at(-1),['capture',1,{format:'jpeg',quality:85}]);
  const opened=await h.run('open',{url:'https://example.test/a'});
  await h.run('open',{url:'https://example.test/b'});
  const agent=await h.run('screenshot',{url:'https://example.test/a',tabId:opened.tabId});
  assert.equal(agent.ok,true);assert.equal(h.tabs.get(opened.tabId).active,true);
});

test('resize only touches the Cindy window; focus and close act on the addressed tab',async()=>{
  const h=harness();
  assert.equal((await h.run('resize',{url:'https://example.test/user',tabId:1,width:800,height:600})).error,'USER_WINDOW');
  const opened=await h.run('open',{url:'https://example.test/a'});
  assert.equal((await h.run('resize',{url:'https://example.test/a',tabId:opened.tabId,width:800,height:600})).ok,true);
  same(h.calls.at(-1),['windows.update',500,{width:800,height:600,state:'normal'}]);
  assert.equal((await h.run('focus',{url:'https://example.test/behind',tabId:2})).ok,true);
  assert.equal(h.calls.some(c=>c[0]==='windows.update' && c[1]===1),false);
  assert.equal((await h.run('close',{url:'https://example.test/a',tabId:opened.tabId})).ok,true);
  assert.equal(h.tabs.has(opened.tabId),false);
  assert.equal((await h.run('snapshot',{url:'https://example.test/a',tabId:opened.tabId})).error,'TAB_CLOSED');
});

test('the first action that needs the debugger opens its page in the user window, once',async()=>{
  const h=harness();
  const first=await h.run('pdf',{url:'https://example.test/user',tabId:1});
  assert.equal(first.error,'DEBUGGER_NOT_ALLOWED');assert.equal(first.grantPageOpened,true);
  const created=h.calls.filter(c=>c[0]==='tabs.create');
  same(created,[['tabs.create',{url:'chrome-extension://fixture/permissions.html?needed=1',windowId:1,active:true}]]);
  const again=await h.run('cdp',{url:'https://example.test/user',tabId:1,op:'begin'});
  assert.equal(again.error,'DEBUGGER_NOT_ALLOWED');assert.equal(again.grantPageOpened,false);
  assert.equal(h.calls.filter(c=>c[0]==='tabs.create').length,1);
  // A screenshot never prompts: it falls back to the visible area and says so.
  const opened=await h.run('open',{url:'https://example.test/a'});
  const shot=await h.run('screenshot',{url:'https://example.test/a',tabId:opened.tabId,fullPage:true});
  assert.equal(shot.ok,true,JSON.stringify(shot));assert.match(shot.note,/visible area/);
  assert.equal(h.calls.filter(c=>c[0]==='tabs.create' && String(c[1].url).includes('permissions')).length,1);
});
