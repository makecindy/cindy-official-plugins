import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../my-browser/extension/background.js',import.meta.url),'utf8');

function harness() {
  const noop={addListener(){}};
  const badges=new Map(),calls=[],updates=new Set();
  let failed=false,closed=false,pending;
  const chrome={
    runtime:{getManifest:()=>({version:'0.4.23'}),onStartup:noop,onInstalled:noop,onMessage:noop},
    storage:{local:{get:async()=>({clientId:'fixture'}),set:async()=>{}},session:{get:async()=>({}),set:async()=>{}}},
    tabs:{onRemoved:noop,onActivated:noop,onUpdated:{addListener:fn=>updates.add(fn),removeListener:fn=>updates.delete(fn)},
      async sendMessage(tabId,message){calls.push({tabId,message});if(pending){const result=pending;pending=null;return result;}if(failed)throw Error('Receiving end does not exist');}},
    alarms:{create(){},onAlarm:noop},
    action:{async setBadgeText({tabId,text}){if(closed&&tabId!==undefined)throw Error('No tab');if(text===null)badges.delete(tabId);else badges.set(tabId,text);},async setBadgeBackgroundColor(){}},
  };
  const context={chrome,MyBrowserNetwork:{create:()=>({})},navigator:{userAgent:'Chrome'},URL,crypto:globalThis.crypto,setTimeout,clearTimeout};
  vm.runInNewContext(source.replace(/\nchain\(\);\s*$/,'')+'\nglobalThis.badgeTest={openOnTab,connection};',context);
  return {...context.badgeTest,calls,updated:(...args)=>{for(const fn of updates)fn(...args);},listeners:()=>updates.size,
    badge:tabId=>badges.get(tabId)??badges.get(undefined)??'',fail:value=>{failed=value;},close:()=>{closed=true;},
    defer:()=>{let resolve,reject;pending=new Promise((yes,no)=>{resolve=yes;reject=no;});return {resolve,reject};}};
}

test('page failure stays on its tab and a later successful click clears it',async()=>{
  const h=harness();await h.connection({connected:true});h.fail(true);
  await h.openOnTab(1);
  assert.equal(h.badge(1),'!');assert.equal(h.badge(2),'');assert.equal(h.badge(undefined),'');
  h.fail(false);await h.openOnTab(1);
  assert.equal(h.badge(1),'');assert.equal(h.calls.length,2,'each user click is dispatched only once');
});

for(const change of [{status:'loading'},{url:'https://example.test/next'}])test('refresh/navigation clears the previous document warning: '+JSON.stringify(change),async()=>{
  const h=harness();await h.connection({connected:true});h.fail(true);await h.openOnTab(1);
  h.updated(1,change);await Promise.resolve();assert.equal(h.badge(1),'');
});

test('unrelated tab updates retain the warning and clearing inherits real connection state',async()=>{
  const h=harness();await h.connection({connected:true});h.fail(true);await h.openOnTab(1);
  h.updated(1,{title:'Still the same page'});assert.equal(h.badge(1),'!');
  await h.connection({connected:false});h.fail(false);await h.openOnTab(1);
  assert.equal(h.badge(1),'!','opening a local panel does not prove Cindy is connected');
  await h.connection({connected:true});assert.equal(h.badge(1),'','reconnection remains visible after clearing the tab override');
});

test('a tab closing during a click or navigation does not reject or replay the action',async()=>{
  const h=harness();h.close();await h.openOnTab(1);h.updated(1,{status:'loading'});
  await Promise.resolve();assert.equal(h.calls.length,1);
});

for(const outcome of ['resolve','reject'])for(const change of [{status:'loading'},{url:'https://example.test/next'}])test('navigation ignores late '+outcome+': '+JSON.stringify(change),async()=>{
  const h=harness();await h.connection({connected:true});
  const deferred=h.defer(),oldClick=h.openOnTab(1);
  h.updated(1,change);
  // A warning from a click in the new page must survive an old success too.
  h.fail(outcome==='resolve');await h.openOnTab(1);
  const currentBadge=h.badge(1);
  deferred[outcome](outcome==='reject'?Error('Old channel closed'):undefined);
  await oldClick;
  assert.equal(h.badge(1),currentBadge);
  assert.equal(h.calls.length,2,'navigation never replays a click');
  assert.equal(h.listeners(),1,'settled clicks release their navigation listeners');
});

test('unrelated navigation and title changes do not discard a current click failure',async()=>{
  const h=harness();await h.connection({connected:true});
  const deferred=h.defer(),click=h.openOnTab(1);
  h.updated(2,{status:'loading'});h.updated(1,{title:'Same document'});
  deferred.reject(Error('No receiver'));await click;
  assert.equal(h.badge(1),'!');assert.equal(h.listeners(),1);
});

test('an update injects the new content script into pages that are already open',async()=>{
  // Bug regression (2026-10-28): after a reload the open YouTube tab kept the dead previous copy; clicking the icon did nothing.
  const noop={addListener(){}};const installed=[],injected=[];
  const chrome={
    runtime:{getManifest:()=>({version:'0.4.27',content_scripts:[{js:['brand-icon.js','content.js']}]}),onStartup:noop,onInstalled:{addListener:fn=>installed.push(fn)},onMessage:noop},
    storage:{local:{get:async()=>({clientId:'fixture'}),set:async()=>{}},session:{get:async()=>({}),set:async()=>{}}},
    tabs:{onRemoved:noop,onActivated:noop,onUpdated:noop,query:async({url}={})=>{if(url)assert.deepEqual([...url],['http://*/*','https://*/*']);return [{id:4,url:'https://www.youtube.com/watch?v=x'},{id:9,url:'https://example.test/'}];}},
    scripting:{executeScript:async({target,files})=>{injected.push({tabId:target.tabId,files});if(target.tabId===9)throw Error('Cannot access contents of the page');}},
    alarms:{create(){},onAlarm:noop},action:{async setBadgeText(){},async setBadgeBackgroundColor(){}},
  };
  vm.runInNewContext(source.replace(/\nchain\(\);\s*$/,''),{chrome,MyBrowserNetwork:{create:()=>({})},navigator:{userAgent:'Chrome'},URL,crypto:globalThis.crypto,setTimeout,clearTimeout});
  // The worker's own watchdog (chain) is also an onInstalled listener; only the injector is under test.
  const injectors=installed.filter(fn=>fn.name!=='chain');assert.equal(injectors.length,1);
  for(const fn of injectors)fn({reason:'update'});
  await new Promise(r=>setTimeout(r,10));
  assert.deepEqual(injected,[{tabId:4,files:['brand-icon.js','content.js']},{tabId:9,files:['brand-icon.js','content.js']}],'every open http(s) page, failures ignored');
  injected.length=0;for(const fn of injectors)fn({reason:'chrome_update'});await new Promise(r=>setTimeout(r,10));
  assert.deepEqual(injected,[],'browser updates do not re-inject');
});
