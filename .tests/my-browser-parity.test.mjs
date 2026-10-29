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

function harness(local={clientId:'fixture'},shared,options={}) {
  const tabs=shared?.tabs||new Map(),windows=shared?.windows||new Map([[1,{id:1,state:'normal'}]]),data={},calls=[];let next=10,nextWindow=500;
  const state={closeOnCreate:false};
  const chrome={permissions:{contains:async()=>false},action:{onClicked:{addListener(){}}},runtime:{getURL:path=> 'chrome-extension://fixture/'+(path||''),getManifest:()=>({version:'0.4.42'}),onStartup:{addListener(){}},onInstalled:{addListener(){}},onMessage:{addListener(){}}},
    storage:{local:{get:async key=>({[key]:structuredClone(local[key])}),set:async value=>Object.assign(local,structuredClone(value)),remove:async keys=>{for(const k of [].concat(keys))delete local[k];}},session:{get:async key=>({[key]:structuredClone(data[key])}),set:async value=>Object.assign(data,structuredClone(value))}},
    tabs:{get:async id=>{if(!tabs.has(id))throw new Error('No tab');return {...tabs.get(id)};},query:async q=>[...tabs.values()].filter(t=>!q?.windowId || t.windowId===q.windowId).map(t=>({...t})),
      create:async({url,windowId=1,active=false})=>{const t={id:next++,url,windowId,status:'complete',active};if(state.closeOnCreate)queueMicrotask(()=>tabs.delete(t.id));if(active)for(const o of tabs.values())if(o.windowId===windowId)o.active=false;tabs.set(t.id,t);calls.push(['tabs.create',{url,windowId,active}]);return {...t};},
      update:async(id,props)=>{calls.push(['tabs.update',id,props]);const t=tabs.get(id);if(props.active)for(const o of tabs.values())if(o.windowId===t.windowId)o.active=false;Object.assign(t,props);return {...t};},
      remove:async id=>{tabs.delete(id);calls.push(['tabs.remove',id]);},
      captureVisibleTab:async(windowId,options)=>{calls.push(['capture',windowId,options]);return 'data:image/'+options.format+';base64,AAAA';},
      onActivated:{addListener(){}},onRemoved:{addListener(){}}},alarms:{create(){},onAlarm:{addListener(){}}},
    windows:{create:async options=>{calls.push(['windows.create',options]);const w={id:nextWindow++,state:'normal'};windows.set(w.id,w);const t=await chrome.tabs.create({url:options.url,windowId:w.id,active:true});return {id:w.id,tabs:[t]};},
      get:async id=>{if(!windows.has(id))throw new Error('No window');return {...windows.get(id)};},getLastFocused:async()=>({id:1}),getAll:async()=>[...windows.values()].map(w=>({...w,focused:w.id===1})),update:async(id,props)=>{calls.push(['windows.update',id,props]);Object.assign(windows.get(id),props);return {};}}};
  const context={chrome,MyBrowserPolicy:P,MyBrowserNetwork:{create:()=>({assertSupported,isReady:async()=>true,document:async()=> 'doc'})},fetch:async()=>({ok:true,json:async()=>({policy:P.defaults()})}),navigator:{userAgent:'Chrome/140'},URL,crypto:globalThis.crypto,TextEncoder,btoa,AbortController,
    // Timers fire at once by default; 'never' keeps idle timers and deadlines from firing.
    setTimeout(fn){if(options.timers!=='never')queueMicrotask(fn);return 0;},clearTimeout(){}};
  vm.runInNewContext(source.replace(/\nchain\(\);\s*$/,'')+'\nglobalThis.tabTest={handle};',context);
  const run=(action,payload,policy=P.defaults())=>context.tabTest.handle({id:'job',action,payload},policy,{base:'http://fixture',session:'fixture'});
  // A tab the user has open in their own window, behind the one they are looking at.
  if(!shared)tabs.set(1,{id:1,url:'https://example.test/user',windowId:1,status:'complete',active:true});
  if(!shared)tabs.set(2,{id:2,url:'https://example.test/behind',windowId:1,status:'complete',active:false});
  return {run,tabs,windows,calls,state,chrome};
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
  P.validate('cdp',{url:'https://example.test/',tabId:1,op:'command',method:'Network.getCookies',params:{urls:['https://example.test/']}});
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
  same(h.calls.find(c=>c[0]==='windows.create')[1],{url:'https://example.test/a',state:'minimized',focused:false,type:'normal'});
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
  assert.equal((await h.run('focus',{url:'https://example.test/behind',tabId:2})).error,'USER_WINDOW');
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

test('a new tab closed while it loads is reported as closed, not as an unknown failure',async()=>{
  const h=harness();h.state.closeOnCreate=true;
  const opened=await h.run('open',{url:'https://example.test/a'});
  assert.equal(opened.error,'TAB_CLOSED');assert.equal(opened.execution,'executed');
});

test('focus never changes what the user sees: Cindy window only, no window brought to the front',async()=>{
  const h=harness();
  const opened=await h.run('open',{url:'https://example.test/login'});
  const handoff=await h.run('focus',{url:'https://example.test/login',tabId:opened.tabId});
  assert.equal(handoff.handoff,true);
  same(h.calls.filter(c=>c[0]==='windows.update').at(-1),['windows.update',500,{drawAttention:true}]);
  assert.equal(h.calls.some(c=>c[0]==='windows.update' && c[2].focused),false);
  const user=await h.run('focus',{url:'https://example.test/behind',tabId:2});
  assert.equal(user.error,'USER_WINDOW');
  assert.equal(h.tabs.get(1).active,true);assert.equal(h.tabs.get(2).active,false);
});
test('unmark ends the mark on a tab without addressing a page',async()=>{
  const h=harness();
  P.validate('unmark',{tabId:2});assert.throws(()=>P.validate('unmark',{}),/tab id/);
  const done=await h.run('unmark',{tabId:2});
  assert.equal(done.ok,true);assert.equal(done.tabId,2);
});

test('after an extension reload Cindy still knows its own window (session storage is gone, local is not)',async()=>{
  const local={clientId:'fixture'};
  const before=harness(local);
  const opened=await before.run('open',{url:'https://example.test/a'});
  const after=harness(local,{tabs:before.tabs,windows:before.windows});
  const handoff=await after.run('focus',{url:'https://example.test/a',tabId:opened.tabId});
  assert.equal(handoff.handoff,true,JSON.stringify(handoff));
  await after.run('open',{url:'https://example.test/b'});
  assert.equal(after.calls.filter(c=>c[0]==='windows.create').length,0);
});

test('a new page never jumps in front in Cindy\'s window while the user has it open',async()=>{
  const h=harness();
  await h.run('open',{url:'https://example.test/a'});
  h.windows.get(500).state='normal';
  await h.run('open',{url:'https://example.test/b'});
  same(h.calls.filter(c=>c[0]==='tabs.create').at(-1),['tabs.create',{url:'https://example.test/b',windowId:500,active:false}]);
  h.windows.get(500).state='minimized';
  await h.run('open',{url:'https://example.test/c'});
  same(h.calls.filter(c=>c[0]==='tabs.create').at(-1),['tabs.create',{url:'https://example.test/c',windowId:500,active:true}]);
});

// Site recipes drive the page through the debugger. There is no method list, site filter or header
// stripping of our own (2026-10-30), as in Cindy's own browser.
test('recipe protocol sessions pass commands and network events through',async()=>{
  const h=harness(undefined,undefined,{timers:'never'});
  const sent=[];let event;
  h.chrome.permissions.contains=async()=>true;
  h.chrome.debugger={attach:async()=>{},detach:async()=>{},onEvent:{addListener(fn){event=fn;}},onDetach:{addListener(){}},
    sendCommand:async(_target,method,params)=>{sent.push([method,params]);return method==='Storage.getCookies'?{cookies:[{name:'a',domain:'.example.test'},{name:'c',domain:'.other.test'}]}:{};}};
  const tab={url:'https://example.test/user',tabId:1};
  assert.equal((await h.run('cdp',{...tab,op:'begin'})).ok,true);
  const all=await h.run('cdp',{...tab,op:'command',method:'Storage.getCookies',params:{}});
  assert.equal(all.ok,true);same(all.result.cookies.map(c=>c.name),['a','c']);
  assert.equal((await h.run('cdp',{...tab,op:'command',method:'Network.getCookies'})).ok,true);
  same(sent.map(([m])=>m),['Storage.getCookies','Network.getCookies']);
  event({tabId:1},'Network.requestWillBeSentExtraInfo',{headers:{Cookie:'sid=1'}});
  event({tabId:1},'Network.responseReceived',{requestId:'r',response:{url:'https://www.example.test/api',headers:{'Set-Cookie':'sid=2','content-type':'application/json'}}});
  const events=await h.run('cdp',{...tab,op:'events'});
  same(events.events,[['Network.requestWillBeSentExtraInfo',{headers:{Cookie:'sid=1'}}],['Network.responseReceived',{requestId:'r',response:{url:'https://www.example.test/api',headers:{'Set-Cookie':'sid=2','content-type':'application/json'}}}]]);
});

// Opening an address again keeps the earlier tab in the ledger, so it is still reclaimed when idle.
test('open keeps earlier tabs of the same address and has no fixed tab limit',async()=>{
  const h=harness();
  const first=await h.run('open',{url:'https://example.test/same'}),second=await h.run('open',{url:'https://example.test/same'});
  assert.equal(first.ok,true);assert.equal(second.ok,true);assert.notEqual(first.tabId,second.tabId);
  for(let i=0;i<14;i++)assert.equal((await h.run('open',{url:'https://example.test/p'+i})).ok,true);
});


// Review 2026-10-29: a failed capture left Cindy's activity mark hidden for the rest of the operation.
test('a failed screenshot shows Cindy\'s mark again',async()=>{
  const h=harness();const marks=[];
  h.chrome.tabs.sendMessage=async(tabId,message)=>{marks.push(message.hidden?'hidden':'shown');};
  h.chrome.tabs.captureVisibleTab=async()=>{throw new Error('Cannot capture this page');};
  const shot=await h.run('screenshot',{url:'https://example.test/user',tabId:1});
  assert.equal(shot.ok,false);
  assert.equal(marks.at(-1),'shown',JSON.stringify(marks));
  assert.ok(marks.includes('hidden'));
});

// 2026-10-30: uploads with paths go through Chrome's debugger when the user has allowed it, so Chrome
// reads the files itself and the ~30 MB transfer bound does not apply; without it, bytes take the plain
// route, and a batch sent without bytes asks the user to allow the debugger.
test('uploads by path through the debugger when allowed; otherwise falls back or asks for it',async()=>{
  const h=harness(undefined,undefined,{timers:'never'});
  const sent=[];let markerSet=false;
  h.chrome.scripting={executeScript:async({args})=>{
    if(args.length===4){markerSet=true;return [{documentId:'doc',result:{ok:true}}];}
    return [{documentId:'doc',result:{url:'https://example.test/user',files:[{name:'big.bin',size:31000000}]}}];
  }};
  h.chrome.debugger={attach:async()=>{},detach:async()=>{},onEvent:{addListener(){}},onDetach:{addListener(){}},
    sendCommand:async(_t,method,params)=>{sent.push([method,params]);return method==='Runtime.evaluate'?{result:{objectId:'obj-1'}}:{};}};
  const payload={url:'https://example.test/user',tabId:1,selector:'input[type=file]',paths:['/Users/me/big.bin']};
  h.chrome.permissions.contains=async()=>true;
  const done=await h.run('upload',payload);
  assert.equal(done.ok,true,JSON.stringify(done));assert.equal(done.viaDebugger,true);assert.equal(markerSet,true);
  same(sent.find(([m])=>m==='DOM.setFileInputFiles'),['DOM.setFileInputFiles',{objectId:'obj-1',files:['/Users/me/big.bin']}]);
  h.chrome.permissions.contains=async()=>false;
  const denied=await h.run('upload',payload);
  assert.equal(denied.error,'DEBUGGER_NOT_ALLOWED');assert.equal(denied.execution,'not_executed');
});

// Review 2026-10-30: absolute upload paths include Windows network shares (\\server\share\file).
test('upload paths accept POSIX, drive and UNC absolute paths and reject relative ones',()=>{
  for(const p of ['/a/b.txt','C:\\x\\y.txt','C:/x/y.txt','\\\\server\\share\\r.pdf'])P.validate('upload',{url:'https://example.test',tabId:1,selector:'i',paths:[p]});
  assert.throws(()=>P.validate('upload',{url:'https://example.test',tabId:1,selector:'i',paths:['rel/x.txt']}),/absolute file paths/);
});

// Review 2026-10-30 (Codex P2): another debugger holding the tab is a failure, not a successful attach.
test('another debugger holding the tab fails the attach; our own leftover is accepted',async()=>{
  const h=harness(undefined,undefined,{timers:'never'});
  h.chrome.permissions.contains=async()=>true;
  let message='Another debugger is already attached to the tab with id: 1.';
  h.chrome.debugger={attach:async()=>{throw new Error(message);},detach:async()=>{},onEvent:{addListener(){}},onDetach:{addListener(){}},sendCommand:async()=>({})};
  const tab={url:'https://example.test/user',tabId:1};
  const foreign=await h.run('cdp',{...tab,op:'begin'});
  assert.equal(foreign.ok,false);assert.equal(foreign.error,'DEBUGGER_ATTACH_FAILED');
  message='Debugger is already attached to the tab with id: 1.';
  assert.equal((await h.run('cdp',{...tab,op:'begin'})).ok,true);
});
