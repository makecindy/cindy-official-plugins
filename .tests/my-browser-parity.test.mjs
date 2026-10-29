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
  let authorizePolicy=P.defaults();const authorizations=[];
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
  const context={chrome,MyBrowserPolicy:P,MyBrowserNetwork:{create:()=>({assertSupported,isReady:async()=>true,document:async()=> 'doc'})},fetch:async(url,init)=>{if(/authorize/.test(String(url)))authorizations.push(JSON.parse(init.body));return {ok:true,json:async()=>({policy:authorizePolicy})};},navigator:{userAgent:'Chrome/140'},URL,crypto:globalThis.crypto,TextEncoder,btoa,AbortController,
    // Timers fire at once by default; 'never' keeps idle timers and deadlines from firing.
    setTimeout(fn){if(options.timers!=='never')queueMicrotask(fn);return 0;},clearTimeout(){}};
  vm.runInNewContext(source.replace(/\nchain\(\);\s*$/,'')+'\nglobalThis.tabTest={handle};',context);
  const run=(action,payload,policy=P.defaults())=>(authorizePolicy=policy,context.tabTest.handle({id:'job',action,payload},policy,{base:'http://fixture',session:'fixture'}));
  // A tab the user has open in their own window, behind the one they are looking at.
  if(!shared)tabs.set(1,{id:1,url:'https://example.test/user',windowId:1,status:'complete',active:true});
  if(!shared)tabs.set(2,{id:2,url:'https://example.test/behind',windowId:1,status:'complete',active:false});
  return {run,tabs,windows,calls,state,chrome,authorizations};
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

// Site recipes drive the page through the debugger. They may send only the methods Cindy's recipe
// runtime uses, and cookies come back for the site of the tab being operated on only: the profile's
// other cookies (Network.getAllCookies, Storage.getCookies unfiltered) are never exported.
test('recipe protocol sessions: listed methods only, cookies of the tab\'s own site only',async()=>{
  const h=harness(undefined,undefined,{timers:'never'});
  const sent=[];let event;
  h.chrome.permissions.contains=async()=>true;
  h.chrome.debugger={attach:async()=>{},detach:async()=>{},onEvent:{addListener(fn){event=fn;}},onDetach:{addListener(){}},
    sendCommand:async(_target,method,params)=>{sent.push([method,params]);
      if(method==='Storage.getCookies')return {cookies:[{name:'a',domain:'.example.test'},{name:'b',domain:'www.example.test'},{name:'c',domain:'.other.test'},{name:'d',domain:'mail.example.test'},{name:'e',domain:'example.test.evil.test'}]};
      if(method==='Network.getCookies')return {cookies:[{name:'a',domain:'.example.test'},{name:'x',domain:'.tracker.test'}]};
      return {};}};
  const tab={url:'https://example.test/user',tabId:1};
  const policy={...P.defaults(),read:{block:['mail.example.test']}};
  assert.equal((await h.run('cdp',{...tab,op:'begin'},policy)).ok,true);
  // Not on the list: refused before anything reaches the browser.
  for(const method of ['Network.getAllCookies','Runtime.evaluate','Target.createTarget','Storage.setCookies']){
    assert.throws(()=>P.validate('cdp',{...tab,op:'command',method}),/not available to site recipes/);
    const refused=await h.run('cdp',{...tab,op:'command',method},policy);
    assert.equal(refused.error,'INVALID_JOB',method);assert.match(refused.message,/not available to site recipes/);assert.equal(refused.execution,'not_executed');
  }
  for(const method of P.CDP_METHODS)if(method!=='Network.getCookies')P.validate('cdp',{...tab,op:'command',method,params:{}});
  // Network.getCookies must name pages of the tab's site.
  assert.throws(()=>P.validate('cdp',{...tab,op:'command',method:'Network.getCookies',params:{}}),/params\.urls/);
  assert.throws(()=>P.validate('cdp',{...tab,op:'command',method:'Network.getCookies',params:{urls:[]}}),/params\.urls/);
  assert.equal((await h.run('cdp',{...tab,op:'command',method:'Network.getCookies'},policy)).error,'INVALID_JOB');
  for(const urls of [['https://other.test/'],['https://www.example.test/','https://other.test/'],['https://mail.example.test/inbox']]){
    const refused=await h.run('cdp',{...tab,op:'command',method:'Network.getCookies',params:{urls}},policy);
    assert.equal(refused.error,'COOKIES_NOT_ALLOWED',JSON.stringify(urls));assert.equal(refused.execution,'not_executed');
  }
  const own=await h.run('cdp',{...tab,op:'command',method:'Network.getCookies',params:{urls:['https://www.example.test/a']}},policy);
  assert.equal(own.ok,true,JSON.stringify(own));same(own.result.cookies.map(c=>c.name),['a']);
  // Storage.getCookies reads the whole profile; only the tab's site comes back, minus blocked sites.
  const all=await h.run('cdp',{...tab,op:'command',method:'Storage.getCookies',params:{browserContextId:'other'}},policy);
  assert.equal(all.ok,true);same(all.result.cookies.map(c=>c.name),['a','b']);
  same(sent.filter(([m])=>/Cookies$/.test(m)),[['Network.getCookies',{urls:['https://www.example.test/a']}],['Storage.getCookies',{}]]);
  // Recorded network events never carry cookie headers.
  event({tabId:1},'Network.requestWillBeSentExtraInfo',{headers:{Cookie:'sid=1'}});
  event({tabId:1},'Network.responseReceived',{requestId:'r',response:{url:'https://www.example.test/api',headers:{'Set-Cookie':'sid=2','content-type':'application/json'}}});
  const events=await h.run('cdp',{...tab,op:'events'},policy);
  same(events.events,[['Network.responseReceived',{requestId:'r',response:{url:'https://www.example.test/api',headers:{'content-type':'application/json'}}}]]);
});

test('site approximates the registrable domain and errs narrow',()=>{
  for(const [host,expected] of [['www.example.test','example.test'],['a.b.example.co.uk','example.co.uk'],['shop.example.com.cn','example.com.cn'],['x.example.com.au','example.com.au'],['m.example.co.jp','example.co.jp'],['example.com.br','example.com.br'],['a.example.co.nz','example.co.nz'],['me.github.io','me.github.io'],['.Example.Test.','example.test'],['93.184.216.34','93.184.216.34'],['[2001:db8::1]','[2001:db8::1]'],['www.example.io','example.io']])assert.equal(P.site(host),expected,host);
  const policy={...P.defaults(),read:{block:['=secure.example.test']}};
  assert.equal(P.cookieHostAllowed(policy,'https://www.example.test/','.example.test'),true);
  assert.equal(P.cookieHostAllowed(policy,'https://www.example.test/','secure.example.test'),false);
  assert.equal(P.cookieHostAllowed(policy,'https://me.github.io/','you.github.io'),false);
  assert.equal(P.cookieUrlAllowed(policy,'https://www.example.test/','ftp://example.test/'),false);
});

// A permission revoked after the acknowledgement must stop the browser actions that return before any page
// script runs, and the host must wait for the ones already started: each registers as a dispatch.
test('tab-level actions and open take the last authorization check as a dispatch',async()=>{
  const h=harness();
  assert.equal((await h.run('close',{url:'https://example.test/behind',tabId:2})).ok,true);
  assert.equal(h.authorizations.at(-1).dispatch,true);
  const before=h.calls.length;
  const revoked=await h.run('close',{url:'https://example.test/user',tabId:1},{...P.defaults(),site:{block:['example.test']},read:{block:['example.test']}});
  assert.equal(revoked.ok,false);assert.equal(revoked.execution,'not_executed');
  assert.equal(h.calls.slice(before).some(([name])=>name==='tabs.remove'),false);
  await h.run('open',{url:'https://example.test/new'});
  assert.equal(h.authorizations.at(-1).dispatch,true);
});

// Opening an address again keeps the earlier tab in the ledger, so it is still reclaimed when idle.
test('open keeps earlier tabs of the same address and has no fixed tab limit',async()=>{
  const h=harness();
  const first=await h.run('open',{url:'https://example.test/same'}),second=await h.run('open',{url:'https://example.test/same'});
  assert.equal(first.ok,true);assert.equal(second.ok,true);assert.notEqual(first.tabId,second.tabId);
  for(let i=0;i<14;i++)assert.equal((await h.run('open',{url:'https://example.test/p'+i})).ok,true);
});

// The last check before navigating a tab covers the address being opened, not the page the tab shows now.
test('navigate by tab id is refused when the target was revoked after the acknowledgement',async()=>{
  const h=harness();
  const revoked={...P.defaults(),read:{block:['blocked.test']}};
  // The acknowledgement allowed it; the authorization answer carries the policy after the revocation.
  const before=h.calls.length;
  const out=await h.run('navigate',{url:'https://blocked.test/page',tabId:1},revoked);
  assert.equal(out.ok,false);assert.equal(out.execution,'not_executed');
  assert.equal(h.calls.slice(before).some(([name])=>name==='tabs.update'),false);
});
