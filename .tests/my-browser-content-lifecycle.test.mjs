import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
const source=await fs.readFile(new URL('../my-browser/extension/content.js',import.meta.url),'utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(send=async()=>({enabled:false}),preferences={}){
  const timers=new Map(),sent=[],listeners=new Set(),nodes=[],storageListeners=new Set(),documentHandlers={};let sequence=0,stored={...preferences};
  class Node extends EventTarget {
    constructor(){super();nodes.push(this);this.handlers={};this.attrs={};this.children=[];this.className='';this.isConnected=true;this.style={props:Object.create(null),setProperty(k,v){this.props[k]=v;},getPropertyValue(k){return this.props[k]||'';},removeProperty(k){delete this.props[k];}};}
    dataset={};textContent='';
    addEventListener(name,fn){this.handlers[name]=fn;super.addEventListener(name,fn);}
    append(...items){for(const n of items){if(n.parentNode)n.parentNode.children=n.parentNode.children.filter(child=>child!==n);this.children.push(n);n.parentNode=this;n.isConnected=true;}}
    setAttribute(k,v){this.attrs[k]=v;} remove(){this.isConnected=false;} attachShadow(){return new Node();}
    querySelector(sel){
      if(typeof sel==='string'&&sel.startsWith('.')){
        const cls=sel.slice(1);
        const match=n=>typeof n.className==='string'&&n.className.split(/\s+/).includes(cls);
        const walk=list=>{for(const n of list||[]){if(match(n))return n;const found=walk(n.children);if(found)return found;}return null;};
        return walk(this.children);
      }
      return {disabled:false};
    }
    querySelectorAll(){return [];}
    replaceChildren(...items){for(const n of this.children)n.isConnected=false;this.children=items;for(const n of items)n.isConnected=true;}
    closest(){return null;} getClientRects(){return [];}
    getBoundingClientRect(){return {top:0,bottom:0,left:0,right:0,width:0,height:0};}
  }
  const document=new EventTarget();document.querySelector=()=>null;document.title='Fixture';
  const addDocumentListener=document.addEventListener.bind(document);
  document.addEventListener=(name,fn,options)=>{documentHandlers[name]=fn;addDocumentListener(name,fn,options);};
  document.querySelectorAll=()=>[];
  document.createElement=document.createElementNS=()=>new Node();document.documentElement=new Node();document.body=new Node();
  function setPreferences(value){const oldValue=stored;stored={...value};for(const fn of storageListeners)fn({cindyReadingPreferences:{oldValue,newValue:stored}},'local');}
  const chrome={runtime:{id:'fixture',getURL:p=>'chrome-extension://fixture/'+p,sendMessage:m=>{sent.push(m);return send(m);},onMessage:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)}},storage:{local:{get:async()=>({cindyReadingPreferences:{...stored}}),set:async data=>setPreferences(data.cindyReadingPreferences)},onChanged:{addListener:fn=>storageListeners.add(fn),removeListener:fn=>storageListeners.delete(fn)}}};
  const context={chrome,document,Event,window:new EventTarget(),location:{href:'https://example.test/start',hostname:'example.test',origin:'https://example.test'},AbortController,getComputedStyle:()=>({backgroundColor:'rgb(255,255,255)'}),CindyLearning:{uuid:()=> 'fixture-request-'+(++sequence),validTarget:()=>false,languageName:v=>v},CindyUI:{copy:()=>({close:"Close"}),css:'',languagePicker:()=>new Node(),error:()=>'err'},speechSynthesis:{cancel(){}},MutationObserver:class{observe(){} disconnect(){}},setInterval:fn=>{timers.set(++sequence,fn);return sequence;},clearInterval:id=>timers.delete(id),clearTimeout(){},setTimeout};
  vm.runInNewContext(source,context);
  return {chrome,context,timers,sent,listeners,nodes,documentHandlers,setPreferences,preferences:()=>stored};
}

function dragSelection(f){
  f.context.window.getSelection=()=>({anchorNode:{parentElement:{closest:()=>null,innerText:'Fixture text'}},toString:()=> 'Fixture text'});
  f.context.innerWidth=1200;f.context.innerHeight=800;
  const event={isTrusted:true,button:0,clientX:20,clientY:20,composedPath:()=>[]};
  f.documentHandlers.mousedown(event);
  f.documentHandlers.mousemove({...event,clientX:80});
  f.documentHandlers.mouseup({...event,clientX:80});
}
const visibleSelectionButtons=f=>f.nodes.filter(n=>n.dataset.cindySelectionEntry==='true'&&n.isConnected);

test('selection popup is off by default and a saved opt-in is read without opening a panel',async()=>{
  const disabled=fixture(),enabled=fixture(undefined,{selectionButton:true});await settle();
  dragSelection(disabled);dragSelection(enabled);
  assert.equal(visibleSelectionButtons(disabled).length,0);
  assert.equal(visibleSelectionButtons(enabled).length,1);
});

test('selection preference changes hide a visible popup and apply to later drags',async()=>{
  const f=fixture(undefined,{selectionButton:true});await settle();dragSelection(f);
  assert.equal(visibleSelectionButtons(f).length,1);
  f.setPreferences({selectionButton:false});
  assert.equal(visibleSelectionButtons(f).length,0);
  dragSelection(f);assert.equal(visibleSelectionButtons(f).length,0);
  f.setPreferences({selectionButton:true});dragSelection(f);
  assert.equal(visibleSelectionButtons(f).length,1);
});

test('selection checkbox persists its value and preserves unrelated preferences',async()=>{
  const f=fixture(async()=>({ok:true,enabled:false}),{autoVideo:false});await settle();
  const replies=[];[...f.listeners][0]({type:'cindy-ui',action:'settings'},{id:'fixture'},r=>replies.push(r));
  await settle();await settle();
  assert.equal(replies[0]?.ok,true);
  const checkbox=f.nodes.find(n=>n.type==='checkbox');assert.ok(checkbox);assert.equal(checkbox.checked,false);
  checkbox.checked=true;checkbox.handlers.change();await settle();await settle();
  assert.equal(f.preferences().selectionButton,true);assert.equal(f.preferences().autoVideo,false);
  const reopened=fixture(undefined,f.preferences());await settle();dragSelection(reopened);
  assert.equal(visibleSelectionButtons(reopened).length,1);
  f.setPreferences({...f.preferences(),selectionButton:false});assert.equal(checkbox.checked,false);
});

test('a late startup preference read cannot undo a newer storage change',async()=>{
  let resolveRead;const f=fixture();
  f.chrome.storage.local.get=()=>new Promise(resolve=>{resolveRead=resolve;});await settle();
  f.setPreferences({selectionButton:false});
  resolveRead({cindyReadingPreferences:{selectionButton:true}});await settle();
  dragSelection(f);assert.equal(visibleSelectionButtons(f).length,0);
});

test('configure keeps a newer selection setting while legacy preferences are pending',async()=>{
  let resolveLegacy;
  const f=fixture(m=>m.request?.op==='preferences'?new Promise(resolve=>{resolveLegacy=resolve;}):Promise.resolve({ok:true,enabled:false}),{selectionButton:true});
  await settle();const replies=[];
  [...f.listeners][0]({type:'cindy-ui',action:'settings'},{id:'fixture'},r=>replies.push(r));
  await settle();assert.equal(typeof resolveLegacy,'function');
  f.setPreferences({selectionButton:false});
  resolveLegacy({ok:true,target:'zh-CN'});await settle();await settle();
  assert.equal(replies[0]?.ok,true);
  assert.equal(f.nodes.findLast(n=>n.type==='checkbox').checked,false);
  dragSelection(f);assert.equal(visibleSelectionButtons(f).length,0);
});

test('configure preserves a saved selection setting when no update intervenes',async()=>{
  const f=fixture(async()=>({ok:true,enabled:false}),{selectionButton:true});await settle();
  [...f.listeners][0]({type:'cindy-ui',action:'settings'},{id:'fixture'},()=>{});
  await settle();await settle();
  assert.equal(f.nodes.findLast(n=>n.type==='checkbox').checked,true);
  dragSelection(f);assert.equal(visibleSelectionButtons(f).length,1);
});

test('selection checkbox synchronizes after its settings body moves into the player shadow root',async()=>{
  const f=fixture(async()=>({ok:true,enabled:false}),{selectionButton:false});await settle();
  [...f.listeners][0]({type:'cindy-ui',action:'settings'},{id:'fixture'},()=>{});
  await settle();await settle();
  const checkbox=f.nodes.findLast(n=>n.type==='checkbox'),settingsBody=checkbox.parentNode.parentNode;
  const originalParent=settingsBody.parentNode;
  const playerRoot=f.context.document.createElement('div').attachShadow({mode:'closed'});
  playerRoot.append(settingsBody);
  assert.equal(originalParent.querySelector('.selection-button-checkbox'),null);
  f.setPreferences({selectionButton:true});assert.equal(checkbox.checked,true);
  f.setPreferences({selectionButton:false});assert.equal(checkbox.checked,false);
});
test('a reloaded extension leaves no URL polling or page listeners after runtime disappears',async()=>{
  const f=fixture();await settle();const tick=[...f.timers.values()][0];
  f.chrome.runtime=undefined;f.context.location.href+='?photo=1';
  assert.doesNotThrow(tick);assert.equal(f.timers.size,0);
  const count=f.sent.length;f.context.document.dispatchEvent(new Event('yt-navigate-finish'));tick();await settle();
  assert.equal(f.sent.length,count,'invalidated script never sends again');
});
// Bug regression (review 2026-10-29): any page script could dispatch the start event and make the
// live content script tear itself down (the "Cindy is operating this page" mark vanished until reload).
test('a forged start event cannot retire a live content script; an orphaned copy still leaves',async()=>{
  const f=fixture();await settle();
  assert.equal(f.timers.size,1);assert.equal(f.listeners.size,1);
  f.context.document.dispatchEvent(new Event('cindy-content-script-start'));await settle();
  assert.equal(f.timers.size,1,'the live copy keeps polling');assert.equal(f.listeners.size,1,'and keeps its runtime listener');
  // After an extension reload this copy's context is gone: the new copy's announcement retires it at once.
  f.chrome.runtime=undefined;
  f.context.document.dispatchEvent(new Event('cindy-content-script-start'));
  assert.equal(f.timers.size,0);
});
test('synchronous invalidation during video-state send is caught and disposes the old script',async()=>{
  let invalidate=false;const f=fixture(()=>{if(invalidate)throw Error('Extension context invalidated.');return Promise.resolve({enabled:false});});await settle();
  const tick=[...f.timers.values()][0];invalidate=true;f.context.location.href+='?photo=2';
  assert.doesNotThrow(tick);await settle();assert.equal(f.timers.size,0);assert.equal(f.listeners.size,0);
});
test('a temporary message failure does not disable a valid extension context',async()=>{
  let unavailable=true;const f=fixture(()=>{if(unavailable)throw Error('Could not establish connection. Receiving end does not exist.');return Promise.resolve({enabled:false});});await settle();
  assert.equal(f.timers.size,1);assert.equal(f.listeners.size,1);
  unavailable=false;f.context.location.href+='?photo=3';[...f.timers.values()][0]();await settle();
  assert.ok(f.sent.some(m=>m.type==='cindy-video-state'));assert.equal(f.timers.size,1);
});
test('a late startup reply after invalidation cannot reopen UI or restart polling',async()=>{
  let resolve;const f=fixture(()=>new Promise(r=>{resolve=r;}));await settle();
  f.chrome.runtime=undefined;[...f.timers.values()][0]();resolve({enabled:true});await settle();assert.equal(f.timers.size,0);
});

test('native cues share safe markup cleanup and disabled YouTube auto-open stops retry polling',()=>{
  assert.match(source,/text:L\.cleanSubtitleText\(c\.text\)\.slice\(0,4000\)/);
  assert.match(source,/if\(!enabled\)\{[\s\S]*?if\(youtube\)prefs\.autoVideo=false;[\s\S]*?nextAutoAttempt=Date\.now\(\)\+5000;[\s\S]*?return;/);
});

test('an interrupted panel open cannot recreate removed UI when its config reply arrives',async()=>{
  let resolveConfig;const f=fixture(m=>m.type==='cindy-learning'?new Promise(r=>{resolveConfig=r;}):Promise.resolve({enabled:false}));await settle();
  const replies=[];[...f.listeners][0]({type:'cindy-ui',action:'open'},{id:'fixture'},r=>replies.push(r));await settle();
  f.chrome.runtime=undefined;[...f.timers.values()][0]();resolveConfig({ok:true,locale:'en'});await settle();
  assert.equal(f.timers.size,0);assert.deepEqual(replies,[]);
});
test('translate-page issued while config is pending still runs after configure finishes',async()=>{
  let resolveConfig;const observed=[];
  const configReady=new Promise(r=>{resolveConfig=r;});
  const f=fixture(m=>{
    if(m.type==='cindy-learning'){
      if(m.request?.op==='config')return configReady;
      return Promise.resolve({ok:true,translations:['x']});
    }
    return Promise.resolve({enabled:false});
  });
  f.context.MutationObserver=class{observe(target){observed.push(target);}disconnect(){}};
  await settle();
  const replies=[];const listener=[...f.listeners][0];
  listener({type:'cindy-ui',action:'open'},{id:'fixture'},r=>replies.push(['open',r]));await settle();
  listener({type:'cindy-ui',action:'translate-page'},{id:'fixture'},r=>replies.push(['translate',r]));await settle();
  assert.equal(observed.length,0,'translate must wait for the in-flight config');
  resolveConfig({ok:true,locale:'en',features:[]});
  await settle();await settle();await settle();
  assert.equal(replies.length,2);
  assert.equal(replies[0][0],'open');assert.equal(replies[1][0],'translate');
  assert.equal(replies[1][1]?.ok,true);
  assert.ok(observed.includes(f.context.document.body),'queued translate-page must start page translation');
});

test('closing during shared setup discards all waiting clicks but permits a new click',async()=>{
  let resolveConfig;let observed=0;
  const config=new Promise(r=>{resolveConfig=r;});
  const f=fixture(m=>m.request?.op==='config'?config:Promise.resolve({ok:true,enabled:false}));
  f.context.MutationObserver=class{observe(){observed++;}disconnect(){}};
  await settle();const listener=[...f.listeners][0],replies=[];
  listener({type:'cindy-ui',action:'open'},{id:'fixture'},r=>replies.push(r));await settle();
  listener({type:'cindy-ui',action:'translate-page'},{id:'fixture'},r=>replies.push(r));await settle();
  const close=f.nodes.find(n=>n.attrs['aria-label']==='Close');
  close.handlers.click({isTrusted:true});await settle();
  resolveConfig({ok:true,locale:'en'});await settle();await settle();
  assert.equal(replies.length,2);assert.equal(observed,0,'dismissed translate never starts');
  listener({type:'cindy-ui',action:'translate-page'},{id:'fixture'},r=>replies.push(r));
  await settle();await settle();assert.equal(observed,1,'a new explicit click works');
});

test('restore and settings complete while the previous model request is pending',async()=>{
  let resolveModel;const pending=new Promise(r=>{resolveModel=r;});
  const f=fixture(m=>m.request?.op==='translate'?pending:Promise.resolve({ok:true,enabled:false}));
  const paragraph={innerText:'Visible paragraph',closest:()=>null,getClientRects:()=>[{}],querySelector:()=>null,getBoundingClientRect:()=>({top:1,bottom:50})};
  f.context.innerHeight=800;f.context.document.body.querySelectorAll=()=>[paragraph];
  await settle();const listener=[...f.listeners][0],replies=[];
  listener({type:'cindy-ui',action:'translate-page'},{id:'fixture'},r=>replies.push(['first',r]));await settle();await settle();
  assert.ok(f.sent.some(m=>m.request?.op==='translate'));assert.equal(replies.length,0);
  listener({type:'cindy-ui',action:'translate-page'},{id:'fixture'},r=>replies.push(['restore',r]));await settle();await settle();
  assert.equal(replies[0]?.[0],'restore');assert.ok(f.sent.some(m=>m.type==='cindy-cancel'));
  listener({type:'cindy-ui',action:'settings'},{id:'fixture'},r=>replies.push(['settings',r]));await settle();await settle();
  assert.equal(replies[1]?.[0],'settings');
  resolveModel({ok:true,translations:['late']});await settle();assert.equal(replies[2]?.[0],'first');
});

test('restore does not wait for an in-flight page translation request',async()=>{
  let resolveConfig,resolveTranslate;let translates=0;
  const configReady=new Promise(r=>{resolveConfig=r;});
  const f=fixture(m=>{
    if(m.type==='cindy-learning'){
      if(m.request?.op==='config')return configReady;
      if(m.request?.op==='translate'){translates++;return new Promise(r=>{resolveTranslate=r;});}
      return Promise.resolve({ok:true});
    }
    return Promise.resolve({enabled:false});
  });
  f.context.innerHeight=800;f.context.innerWidth=1200;
  f.context.MutationObserver=class{observe(){} disconnect(){}};
  const paragraph={innerText:'Hello from the fixture page',getClientRects:()=>[{}],getBoundingClientRect:()=>({top:10,bottom:40,left:0,right:100,width:100,height:30}),closest:()=>null,querySelector:()=>null,isConnected:true,hasAttribute:()=>false,after(){}};
  f.context.document.body.querySelectorAll=()=>[paragraph];
  await settle();
  const replies=[];const listener=[...f.listeners][0];
  resolveConfig({ok:true,locale:'en',features:[]});
  listener({type:'cindy-ui',action:'translate-page'},{id:'fixture'},r=>replies.push(['start',r]));
  await settle();await settle();
  assert.equal(translates,1);
  listener({type:'cindy-ui',action:'translate-page'},{id:'fixture'},r=>replies.push(['restore',r]));
  await settle();await settle();
  assert.equal(replies.some(r=>r[0]==='restore'&&r[1]?.ok),true,'restore must finish while translation is still pending');
  assert.equal(translates,1,'restore cancels rather than queueing behind the model');
  resolveTranslate({ok:true,translations:['x']});
  await settle();
});
test('restoring an in-flight page translation lets the next translate start immediately',async()=>{
  const pending=[];let translates=0;
  const f=fixture(m=>{
    if(m.type==='cindy-learning'){
      if(m.request?.op==='config')return Promise.resolve({ok:true,locale:'en',features:[]});
      if(m.request?.op==='translate'){translates++;return new Promise(r=>pending.push(r));}
      return Promise.resolve({ok:true});
    }
    return Promise.resolve({enabled:false});
  });
  f.context.innerHeight=800;f.context.innerWidth=1200;
  f.context.MutationObserver=class{observe(){} disconnect(){}};
  const paragraph={innerText:'Hello from the fixture page',getClientRects:()=>[{}],getBoundingClientRect:()=>({top:10,bottom:40,left:0,right:100,width:100,height:30}),closest:()=>null,querySelector:()=>null,isConnected:true,hasAttribute:()=>false,after(){}};
  f.context.document.body.querySelectorAll=()=>[paragraph];
  await settle();
  const replies=[];const listener=[...f.listeners][0];
  listener({type:'cindy-ui',action:'translate-page'},{id:'fixture'},r=>replies.push(['start',r]));
  await settle();await settle();
  assert.equal(translates,1);
  listener({type:'cindy-ui',action:'translate-page'},{id:'fixture'},r=>replies.push(['restore',r]));
  await settle();await settle();
  listener({type:'cindy-ui',action:'translate-page'},{id:'fixture'},r=>replies.push(['restart',r]));
  await settle();await settle();
  assert.equal(translates,2,'restore must drop the running lock so a new translate can start');
  assert.equal(replies.some(r=>r[0]==='restart'),false,'restart must wait for the new model request');
  pending[0]({ok:true,translations:['stale']});
  await settle();await settle();
  assert.equal(replies.some(r=>r[0]==='restart'),false,'a stale reply must not finish the new session');
  pending[1]({ok:true,translations:['fresh']});
  await settle();await settle();
  assert.equal(replies.some(r=>r[0]==='restart'&&r[1]?.ok),true);
});
test('a pending selection reply does not error after switching to page translation',async()=>{
  let resolveSelection;let pageTranslates=0;
  const f=fixture(m=>{
    if(m.type==='cindy-learning'){
      if(m.request?.op==='config')return Promise.resolve({ok:true,locale:'en',features:[]});
      if(m.request?.op==='translate'&&m.request?.text)return new Promise(r=>{resolveSelection=r;});
      if(m.request?.op==='translate'&&m.request?.texts){pageTranslates++;return new Promise(()=>{});}
      return Promise.resolve({ok:true});
    }
    return Promise.resolve({enabled:false});
  });
  f.context.innerHeight=800;f.context.innerWidth=1200;
  f.context.window.getSelection=()=>({toString:()=>'selected phrase',anchorNode:{parentElement:{closest:()=>null,innerText:'selected phrase'}}});
  const paragraph={innerText:'Hello from the fixture page',getClientRects:()=>[{}],getBoundingClientRect:()=>({top:10,bottom:40,left:0,right:100,width:100,height:30}),closest:()=>null,querySelector:()=>null,isConnected:true,hasAttribute:()=>false,after(){}};
  f.context.document.body.querySelectorAll=()=>[paragraph];
  await settle();
  const replies=[];const listener=[...f.listeners][0];
  listener({type:'cindy-ui',action:'selection'},{id:'fixture'},r=>replies.push(['selection',r]));
  await settle();await settle();
  const status=f.nodes.find(n=>n.attrs.role==='status');
  listener({type:'cindy-ui',action:'translate-page'},{id:'fixture'},r=>replies.push(['page',r]));
  await settle();await settle();
  assert.equal(pageTranslates,1);
  resolveSelection({ok:true,translations:['late selection']});
  await settle();await settle();
  assert.equal(replies.find(r=>r[0]==='selection')?.[1]?.ok,true);
  assert.notEqual(status?.className,'status error');
  assert.notEqual(status?.textContent,'err');
});
test('hiding the panel while config is pending drops queued translate-page',async()=>{
  let resolveConfig;const observed=[];
  const configReady=new Promise(r=>{resolveConfig=r;});
  const f=fixture(m=>{
    if(m.type==='cindy-learning'){
      if(m.request?.op==='config')return configReady;
      return Promise.resolve({ok:true,translations:['x']});
    }
    return Promise.resolve({enabled:false});
  });
  f.context.MutationObserver=class{observe(target){observed.push(target);}disconnect(){}};
  await settle();
  const replies=[];const listener=[...f.listeners][0];
  listener({type:'cindy-ui',action:'open'},{id:'fixture'},r=>replies.push(['open',r]));await settle();
  listener({type:'cindy-ui',action:'translate-page'},{id:'fixture'},r=>replies.push(['translate',r]));await settle();
  const ev=new Event('keydown');ev.key='Escape';f.context.document.dispatchEvent(ev);
  resolveConfig({ok:true,locale:'en',features:[]});
  await settle();await settle();await settle();
  assert.equal(observed.length,0,'closed panel must not start queued translation');
});

test('a newer copy of the content script announcing itself disposes the running one',async()=>{
  // Bug regression (2026-10-28): after an extension reload the old copy kept mounting player entries.
  // The reload invalidates the old copy's extension context; the new copy's announcement then retires it
  // at once instead of on its next poll.
  const f=fixture();await settle();assert.equal(f.timers.size,1);
  f.chrome.runtime=undefined;
  f.context.document.dispatchEvent(new Event('cindy-content-script-start'));
  assert.equal(f.timers.size,0);
});
test('the brand icon is inlined and no extension resource is web-accessible',async()=>{
  const manifest=JSON.parse(await fs.readFile(new URL('../my-browser/extension/manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.web_accessible_resources,undefined);
  assert.equal(manifest.content_scripts[0].js[0],'brand-icon.js');
  const icon=await fs.readFile(new URL('../my-browser/extension/brand-icon.js',import.meta.url),'utf8');
  assert.match(icon,/globalThis\.CindyBrandIcon='data:image\/png;base64,[A-Za-z0-9+\/=]+'/);
  assert.match(source,/globalThis\.CindyBrandIcon\|\|api\.runtime\.getURL/);
});
