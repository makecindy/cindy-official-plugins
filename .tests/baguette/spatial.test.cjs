const {test}=require('node:test'),assert=require('node:assert/strict');
const {plan,sample,perform}=require('../../cindy-simulator/node/spatial.cjs');
const screen={width:1920,height:1080};
class Failure extends Error{constructor(code,message){super(message);this.code=code;}}
test('spatial planning validates the entire gesture before input and converts screenshot points',()=>{
 const drag=plan({action:'drag',from:[960,540],to:[1440,810],depth:.3,hold:.2,duration:.1},screen,Failure);
 assert.deepEqual([drag[0].x,drag[0].y,drag[0].z],[.5,.5,0]);
 assert.deepEqual([drag.at(-1).x,drag.at(-1).y,drag.at(-1).z],[.75,.75,.3]);
 assert.equal(drag.at(-1).phase,'ended');assert.equal(drag[1].x,.5);
 assert.equal(plan({action:'pinch',scale:2},screen).at(-1).spread,.2);
 assert.equal(plan({action:'move',by:[1,2,3]},screen).at(-1).z,3);
 assert.equal(plan({action:'pan',by:[1,-1]},screen).at(-1).x,-.5);
 for(const p of [{action:'drag',to:[1921,0]},{action:'pinch',scale:0},{action:'rotate',angle:NaN},{action:'move',by:[0,0,6]},{action:'pan',by:[0,0,1]},{action:'tilt',by:[0,0,1]},{action:'orbit',by:[0,0,1]},{action:'reset',duration:Infinity},{action:'unknown'}])assert.throws(()=>plan(p,screen,Failure),e=>e.code==='INVALID_ARGUMENT');
 const start=drag[0];for(const invalid of [{mode:'unknown'},{aspect:NaN},{x:11},{mode:'pointer',z:1.5}])assert.throws(()=>sample({...start,...invalid},Failure),e=>e.code==='INVALID_ARGUMENT');
});
test('insufficient time sends nothing; uncertain delivery releases without replaying',async()=>{
 const samples=plan({action:'drag',duration:.05},screen),sent=[];let cancelled=0;
 const manager={send:async(_id,p)=>{sent.push(p);if(p.phase==='changed')throw Error('lost ack');},cancel:async()=>cancelled++};
 await assert.rejects(perform(manager,'device',samples,'/Xcode',Date.now()+10),e=>e.execution==='not_executed');assert.equal(sent.length,0);
 await assert.rejects(perform(manager,'device',samples,'/Xcode'),e=>e.execution==='unknown');assert.equal(cancelled,1);assert.deepEqual(sent.map(p=>p.phase),['began','changed']);
});

const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../../cindy-simulator/node/vision-stage.js'),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
function stage(respond=async()=>{}){
 const events={},windowEvents={},docEvents={},calls=[],timers=new Map();let timer=0,focused=true,pads=[];
 const buttons=['keyboard','pointer'].map(vision=>({dataset:{vision},attrs:{},setAttribute(k,v){this.attrs[k]=v;}}));
 const bar={querySelectorAll:()=>buttons};
 const canvas={width:1920,height:1080,style:{},focus(){},setPointerCapture(){},requestPointerLock(){context.document.pointerLockElement=canvas;docEvents.pointerlockchange();},getBoundingClientRect:()=>({left:0,top:0,width:1920,height:1080}),addEventListener:(name,fn)=>events[name]=fn};
 const context={crypto:require('node:crypto'),Date,Math,Promise,navigator:{getGamepads:()=>pads},parent:{document:{getElementById:()=>bar}},document:{activeElement:canvas,hasFocus:()=>focused,hidden:false,exitPointerLock(){this.pointerLockElement=null;docEvents.pointerlockchange();},addEventListener:(name,fn)=>docEvents[name]=fn},addEventListener:(name,fn)=>windowEvents[name]=fn,setTimeout:fn=>{timers.set(++timer,fn);return timer;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(source,context);let errors=0;
 const control=context.createVisionStage({canvas,api:async(action,p)=>{calls.push({action,...p});await respond(p);},message(){},onError(){errors++;},zh:false});
 const emit=(name,p={})=>events[name]({type:name,button:0,buttons:name==='pointerup'?0:1,pointerId:1,clientX:960,clientY:540,preventDefault(){},...p});
 return {calls,control,emit,errors:()=>errors,pressed:id=>buttons.find(b=>b.dataset.vision===id).attrs['aria-pressed'],lock:()=>{context.document.pointerLockElement=canvas;docEvents.pointerlockchange();},unlock:()=>context.document.exitPointerLock(),lockError:()=>docEvents.pointerlockerror(),pad:p=>{pads=p?[p]:[];windowEvents.gamepadconnected();},blur:()=>{focused=false;windowEvents.blur();},hide:()=>{context.document.hidden=true;docEvents.visibilitychange();},exit:()=>windowEvents.pagehide(),pulse:()=>{const fs=[...timers.values()];timers.clear();fs.forEach(f=>f());}};
}
test('keyboard and pointer capture retain independent routing and toolbar states',()=>{
 for(const initiallyEnabled of [false,true]){
  const s=stage();if(initiallyEnabled)s.control.choose('keyboard');
  const check=(enabled,locked)=>{
   assert.equal(s.control.acceptsKeyboard(),enabled);assert.equal(s.control.key({code:'KeyB',preventDefault(){}}),!enabled);
   assert.equal(s.pressed('keyboard'),String(enabled));assert.equal(s.pressed('pointer'),String(locked));
  };
  check(initiallyEnabled,false);
  for(let i=0;i<2;i++){
   s.control.choose('pointer');check(initiallyEnabled,true);
   s.lock();s.lockError();check(initiallyEnabled,true);
   s.control.choose('keyboard');check(!initiallyEnabled,true);
   s.unlock();check(!initiallyEnabled,false); // Exit preserves the latest choice, not an entry snapshot.
   s.unlock();s.lockError();check(!initiallyEnabled,false);
   s.control.choose('keyboard');check(initiallyEnabled,false);
  }
  s.control.choose('pointer');s.control.key({code:'Escape',preventDefault(){}});check(false,false);
  s.lock();s.unlock();check(false,false);assert.equal(s.calls.length,0);
 }
});
test('captured pointer preserves every button edge and held buttons during partial releases',async()=>{
 for(const first of [1,2])for(const moves of [false,true]){
 let ack;const s=stage(p=>p.phase==='changed'&&!ack?new Promise(resolve=>ack=resolve):Promise.resolve());s.lock();
 const firstButton=first===1?0:2,otherButton=first===1?2:0;
 s.emit('pointerdown',{button:firstButton,buttons:first});await tick();s.emit('pointermove',{buttons:first,movementX:10});await tick();
 for(let i=0;i<2;i++){s.emit(moves?'pointermove':'pointerdown',{button:otherButton,buttons:3});s.emit(moves?'pointermove':'pointerup',{button:otherButton,buttons:first});}
 s.emit('pointermove',{buttons:first,movementX:20});ack();await tick();
 assert.equal(s.calls.filter(p=>p.phase==='began').length,1);
 assert.equal(s.calls.filter(p=>p.phase==='ended').length,0,'left button is still held');
 const edges=s.calls.map(p=>p.z).filter((z,i,a)=>i===0||z!==a[i-1]);assert.deepEqual(edges,[first,3,first,3,first]);
 s.emit('pointerup',{button:firstButton,buttons:0});await tick();assert.equal(s.calls.at(-1).phase,'ended');
 assert.ok(s.calls.every(p=>p.gesture===s.calls[0].gesture));
 }
});
test('captured pointer assigns motion to its original button mask across delayed edges',async()=>{
 for(const first of [1,2])for(const phase of ['began','changed'])for(const moveEdges of [false,true]){
  let ack,blocked=false;const s=stage(p=>p.phase===phase&&!blocked?(blocked=true,new Promise(resolve=>ack=resolve)):Promise.resolve());s.lock();
  s.emit('pointermove',{buttons:0,movementX:10,movementY:-10});await tick();
  const expected=Array.from({length:4},()=>[0,0]);expected[0]=[10,-10];let mask=0;
  const send=(name,buttons,dx)=>{expected[mask][0]+=dx;expected[mask][1]-=dx;mask=buttons;s.emit(name,{buttons,button:buttons===2?2:0,movementX:dx,movementY:-dx});};
  // The same physical sequence is reported either as button events or as
  // pointermove mask changes. Both preserve motion before AND after each edge.
  for(const next of [first,3,first===1?2:1,0,first,0]){
   send('pointermove',mask,11);send('pointermove',mask,12);
   send(moveEdges?'pointermove':mask&~next?'pointerup':'pointerdown',next,13);
  }
  // All-up pointerup ends normally; later input may queue a new contact.
  ack();await tick();await s.control.finish();
  const actual=Array.from({length:4},()=>[0,0]);let x=0,y=0,id,previousMask;
  for(const p of s.calls){
   if(p.gesture!==id){id=p.gesture;x=0;y=0;previousMask=p.z;}
   if(p.z!==previousMask){assert.equal(p.x,x,'button edge must precede subsequent movement');assert.equal(p.y,y);}
   actual[p.z][0]+=(p.x-x)*1000;actual[p.z][1]+=(p.y-y)*1000;x=p.x;y=p.y;previousMask=p.z;
  }
  for(let z=0;z<4;z++)for(let i=0;i<2;i++)assert.ok(Math.abs(actual[z][i]-expected[z][i])<1e-7,JSON.stringify({first,phase,moveEdges,z,actual,expected}));
  assert.equal(s.errors(),0);
 }
});
test('captured pointer retains cumulative displacement beyond nine thousand pixels',async()=>{
 const s=stage(p=>sample(p,Failure));s.lock();s.emit('pointerdown',{buttons:1});await tick();
 for(let i=0;i<100;i++){s.emit('pointermove',{buttons:1,movementX:1200,movementY:-600});await tick();}
 assert.ok(Math.abs(s.calls.at(-1).x-120)<1e-8);assert.ok(Math.abs(s.calls.at(-1).y+60)<1e-8);assert.equal(s.errors(),0);
 assert.equal(s.calls.filter(p=>p.phase==='began').length,1);s.emit('pointerup',{buttons:0});await tick();assert.equal(s.calls.at(-1).phase,'ended');
 const valid={...s.calls[0],x:120,y:-60};assert.equal(sample(valid,Failure).x,120);
 assert.throws(()=>sample({...valid,mode:'pan'},Failure),e=>e.code==='INVALID_ARGUMENT');
 assert.throws(()=>sample({...valid,x:Infinity},Failure),e=>e.code==='INVALID_ARGUMENT');
});
test('pointer cancellation drops queued button edges and later contacts while releasing the active mask',async()=>{
 for(const phase of ['began','changed']){
  let ack;const s=stage(p=>p.phase===phase?new Promise(resolve=>ack=resolve):Promise.resolve());s.lock();
  s.emit('pointerdown',{buttons:1});await tick();s.emit('pointermove',{buttons:1,movementX:10});await tick();
  s.emit('pointerdown',{button:2,buttons:3});s.emit('pointerup',{button:2,buttons:1});s.emit('pointerup',{buttons:0});
  s.emit('pointerdown',{buttons:1});s.emit('pointerdown',{button:2,buttons:3});
  const n=s.calls.length,old=s.calls[0].gesture;s.blur();ack();await tick();s.pulse();await tick();
  assert.ok(s.calls.every(p=>p.gesture===old));assert.ok(s.calls.slice(n).every(p=>p.phase==='ended'));
  assert.equal(s.calls.filter(p=>p.phase==='ended').length,1);
 }
});
test('fast click waits for native begin then releases exactly once',async()=>{
 let ack;const s=stage(p=>p.phase==='began'?new Promise(r=>ack=r):Promise.resolve());
 s.emit('pointerdown');s.emit('pointerup');await tick();assert.equal(s.calls.length,1);
 ack();await tick();assert.deepEqual(s.calls.map(p=>p.phase),['began','ended']);assert.equal(s.calls[0].mode,'interact');assert.equal(s.calls[0].gesture,s.calls[1].gesture);
});
test('mode and depth stay fixed during drag; pending motion coalesces without losing release',async()=>{
 let ack;const s=stage(p=>p.phase==='changed'?new Promise(r=>ack=r):Promise.resolve());
 s.emit('pointerdown',{shiftKey:true});await tick();s.emit('pointermove',{clientY:600});await tick();
 for(let i=1;i<=20;i++)s.emit('pointermove',{clientY:600+i*5,altKey:true});s.emit('pointerup');
 assert.equal(s.calls.length,2);ack();await tick();assert.equal(s.calls.length,3);assert.ok(s.calls[2].z>.2);assert.equal(s.calls[2].x,.5);assert.equal(s.calls[2].mode,'interact');
 ack();await tick();assert.equal(s.calls.at(-1).phase,'ended');assert.equal(s.calls.at(-1).z,s.calls.at(-2).z);
});
test('blur, hidden page, stream reset and page exit discard unsent gestures',async()=>{
 for(const stop of [s=>s.blur(),s=>s.hide(),s=>s.control.cancel(),s=>s.exit()]){
  const s=stage();s.emit('pointerdown');stop(s);await tick();assert.equal(s.calls.length,0);
  const active=stage();active.emit('pointerdown');await tick();stop(active);await tick();assert.deepEqual(active.calls.map(p=>p.phase),['began','ended']);
 }
});
test('cancellation retires cached motion and queued starts across every unfinished gesture',async()=>{
 for(const phase of ['began','changed','ended'])for(const stop of [s=>s.blur(),s=>s.hide(),s=>s.control.cancel(),s=>s.exit(),s=>s.emit('pointercancel')]){
  let ack;const s=stage(p=>p.phase===phase?new Promise(resolve=>ack=resolve):Promise.resolve());
  s.emit('pointerdown');await tick();
  s.emit('pointermove',{clientX:1000});await tick();
  s.emit('pointermove',{clientX:1100});s.emit('pointerup');await tick();
  s.emit('pointerdown',{pointerId:2});s.emit('pointerup',{pointerId:2});s.emit('pointerdown',{pointerId:3});
  const count=s.calls.length,old=s.calls[0].gesture;stop(s);ack();await tick();
  assert.ok(s.calls.every(p=>p.gesture===old),'no queued gesture starts after cancellation');
  assert.ok(s.calls.slice(count).every(p=>p.phase==='ended'),'only release may follow cancellation');
  if(s.calls.at(-1).phase==='ended'&&phase==='ended')ack();await tick();
  assert.equal(s.calls.filter(p=>p.phase==='ended').length,1);
 }
});
test('uncertain delivery cancels queued gestures instead of starting them after the failed owner',async()=>{
 for(const phase of ['began','changed','ended']){
  let reject;const s=stage(p=>p.phase===phase?new Promise((_resolve,r)=>reject=r):Promise.resolve());
  s.emit('pointerdown');await tick();s.emit('pointermove',{clientX:1000});await tick();s.emit('pointerup');await tick();
  s.emit('pointerdown',{pointerId:2});const old=s.calls[0].gesture;reject(Error('lost acknowledgement'));await tick();
  assert.ok(s.calls.every(p=>p.gesture===old));assert.equal(s.errors(),1);
 }
});
test('two hands and camera controls use spatial modes; failed begin is never retried',async()=>{
 const s=stage();s.control.choose('two-hands');s.emit('pointerdown');await tick();s.emit('pointermove',{clientX:1152,clientY:432});s.emit('pointerup');await tick();
 assert.equal(s.calls[0].mode,'two-hands');assert.ok(Math.abs(s.calls.at(-1).spread-.2)<1e-9);assert.ok(s.calls.at(-1).angle>0);
 s.control.choose('orbit');s.emit('pointerdown');await tick();s.emit('pointerup');await tick();assert.equal(s.calls.at(-1).mode,'orbit');
 const failed=stage(async()=>{throw Error('offline');});failed.emit('pointerdown');await tick();failed.emit('pointermove');failed.emit('pointerup');await tick();assert.equal(failed.calls.length,1);assert.equal(failed.errors(),1);
});
test('gamepad combines translation and rotation, ends at neutral and never moves an unfocused view',async()=>{
 const s=stage(),p={connected:true,mapping:'standard',axes:[.5,-1,.5,.25],buttons:Array.from({length:8},()=>({value:0}))};p.buttons[7].value=1;
 s.pad(p);await tick();s.pulse();await tick();const v=s.calls.at(-1);
 assert.equal(v.mode,'move');assert.ok(v.x>0&&v.y>0&&v.z<0&&v.yaw<0&&v.pitch<0);
 p.axes.fill(0);p.buttons[7].value=0;s.pulse();await tick();assert.equal(s.calls.at(-1).phase,'ended');
 const count=s.calls.length;s.blur();p.axes[0]=1;s.pulse();await tick();assert.equal(s.calls.length,count);
 const failed=stage(async()=>{throw Error('lost ack');});failed.pad(p);await tick();for(let i=0;i<3;i++){failed.pulse();await tick();}assert.equal(failed.calls.length,1);
});
test('temporary toolbar camera drags preserve canvas mode and stale handles cannot end a newer gesture',async()=>{
 for(const selected of ['interact','orbit'])for(const temporary of ['tilt','pan','orbit','dolly']){
  const s=stage();s.control.choose(selected);
  const drag=s.control.cameraDrag(temporary);drag.move(192,-108);drag.end();await tick();
  assert.deepEqual(s.calls.map(v=>v.phase),['began','changed','ended']);
  assert.equal(s.calls.at(-1).mode,temporary);assert.equal(s.calls.at(-1).x,.1);assert.equal(s.calls.at(-1).y,-.1);
  s.emit('pointerdown');await tick();assert.equal(s.calls.at(-1).mode,selected);
  const n=s.calls.length;drag.move(500,500);drag.end();await tick();assert.equal(s.calls.length,n);
  s.emit('pointerup');await tick();assert.equal(s.calls.at(-1).phase,'ended');
 }
 const s=stage(),drag=s.control.cameraDrag('pan');await tick();s.blur();await tick();
 const n=s.calls.length;drag.move(100,100);drag.end();await tick();assert.equal(s.calls.length,n);assert.equal(s.calls.at(-1).phase,'ended');
});
