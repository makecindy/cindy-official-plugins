const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../../cindy-simulator/node/platform-stage.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function stage(platform='tvOS',respond=async()=>({ok:true}),withVision=false,webCodecs=true){
 const events={},windowEvents={},docEvents={},calls=[],status={},timers=new Map(),sessions=[];let now=1000,nextTimer=0,stream;
 const listen=(target,name,fn)=>(target[name]??=[]).push(fn),fire=(target,name,event)=>{for(const fn of target[name]||[])fn(event);};
 const canvas={width:1920,height:1080,style:{},focus(){},setPointerCapture(){},getBoundingClientRect:()=>({left:0,top:0,width:1920,height:1080}),addEventListener:(name,fn)=>listen(events,name,fn)};
 class Clock extends Date{static now(){return now;}}
 const context={URL,URLSearchParams,Date:Clock,location:{search:`?platform=${platform}&udid=test&cindyViewer=token`},
  document:{hidden:false,activeElement:canvas,hasFocus:()=>true,getElementById:id=>id==='display'?canvas:status,addEventListener:(name,fn)=>listen(docEvents,name,fn)},
  fetch:async(_url,options)=>{const args=JSON.parse(options.body);calls.push(args);await respond(args.action,args);return {ok:true};},
  crypto:require('node:crypto'),setTimeout:(fn,ms)=>{const id=++nextTimer;timers.set(id,{at:now+ms,fn});return id;},clearTimeout:id=>timers.delete(id),
  parent:{document:{getElementById:()=>null},cindySim:{api:async(action,args)=>{calls.push({action,...args});return respond(action,args);}}},
  addEventListener:(name,fn)=>listen(windowEvents,name,fn),
  StreamSession:class{constructor(options){stream=options;this.sent=[];sessions.push(this);}static buildWSUrl(udid,format){return 'ws://127.0.0.1/stream?format='+format;}start(){this.send=m=>this.sent.push(m);}stop(){this.stopped=true;}},
  FrameDecoder:{isHardwareAvailable:()=>webCodecs},
 };
 if(withVision)vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../cindy-simulator/node/vision-stage.js'),'utf8'),context);
 vm.runInNewContext(source,context);
 function emit(name,props={}){const e={button:0,pointerId:1,isPrimary:true,clientX:960,clientY:540,deltaX:0,deltaY:0,deltaMode:0,preventDefault(){this.prevented=true;},...props};fire(events,name,e);return e;}
 return {emit,calls,status,cameraDrag:mode=>context.cindyVision.cameraDrag(mode),choose:value=>context.cindyVision.choose(value),advance:ms=>{now+=ms;},elapse:ms=>{now+=ms;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn();}},windowEvent:name=>fire(windowEvents,name),hide:()=>{context.document.hidden=true;fire(docEvents,'visibilitychange');},show:()=>{context.document.hidden=false;},reveal:()=>{context.document.hidden=false;fire(docEvents,'visibilitychange');},sessions,stream:()=>stream,disconnect:()=>stream.onClose()};
}
test('all input kinds share order in discrete/gesture/discrete interleavings without replay or deadlock',async()=>{
 for(const first of ['press','key','paste'])for(const kind of first==='press'?['wheel']:['pointer','wheel','camera'])for(const started of [false,true])for(const outcome of ['success','cancel','failure']){
  if(kind==='camera'&&!started)continue; // Mode changes intentionally cancel queued keys before they start.
  let ack,reject,blocked=false;const tv=first==='press';
  const s=stage(tv?'tvOS':'visionOS',async(action)=>{if(action===first&&!blocked){blocked=true;await new Promise((resolve,r)=>{ack=resolve;reject=r;});}},!tv);
  if(!tv)s.choose('keyboard');
  if(tv)s.emit('contextmenu');else if(first==='paste')s.emit('paste',{clipboardData:{getData:()=> 'first'}});else s.emit('keydown',{code:'KeyB'});
  if(started){await tick();assert.equal(s.calls.length,1);}
  if(kind==='wheel'){s.emit('wheel',{deltaY:-10});s.emit('wheel',{deltaY:-20});s.elapse(tv?101:121);}
  else if(kind==='pointer'){s.emit('pointerdown');s.emit('pointermove',{clientX:1000});s.emit('pointerup');}
  else{const drag=s.cameraDrag('pan');drag.move(50,20);drag.end();}
  if(tv){s.emit('pointerdown');s.emit('pointerup');}else s.emit('keydown',{code:'KeyC'});
  await tick();assert.equal(s.calls.length,1,`${first}/${kind}: later began must wait for earlier discrete input`);
  if(outcome==='cancel')s.windowEvent('blur');
  if(outcome==='failure')reject(Error('uncertain delivery'));else ack();
  await tick();
  if(outcome==='success'){
   assert.deepEqual(s.calls.map(p=>p.phase||p.action),[first,'began','changed','ended',tv?'press':'key']);
   assert.equal(s.calls[1].gesture,s.calls[3].gesture);
  }else assert.equal(s.calls.length,1,`${outcome} discards every queued input without replay`);
 }
});
test('Vision keyboard switch gates keys and paste while preserving camera navigation',async()=>{
 const s=stage('visionOS',undefined,true),paste={clipboardData:{getData:()=> 'example'}};
 for(const code of ['KeyB','Digit1','Enter'])assert.equal(s.emit('keydown',{code}).prevented,true);
 s.emit('keydown',{code:'KeyV',metaKey:true});s.emit('paste',paste);await tick();assert.equal(s.calls.length,0);
 s.emit('keydown',{code:'KeyW'});await tick();s.emit('keyup',{code:'KeyW'});await tick();
 assert.ok(s.calls.length>0);assert.ok(s.calls.every(p=>p.action==='spatial'&&p.mode==='move'));
 s.calls.length=0;s.choose('keyboard');
 for(const code of ['KeyB','Digit1','Enter','KeyW','ArrowUp'])s.emit('keydown',{code});
 s.emit('keydown',{code:'KeyV',metaKey:true});s.emit('paste',paste);await tick();
 assert.deepEqual(s.calls.map(p=>p.action),['key','key','key','key','key','paste']);
 s.emit('keydown',{code:'Escape'});s.emit('keydown',{code:'Enter'});s.emit('paste',paste);await tick();assert.equal(s.calls.length,6);
});
test('Vision drops queued keyboard and paste input if the switch is disabled before dispatch',async()=>{
 let release;const held=new Promise(resolve=>release=resolve),s=stage('visionOS',async()=>held,true);
 s.choose('keyboard');s.emit('keydown',{code:'KeyB'});await tick();assert.equal(s.calls.length,1);
 s.emit('keydown',{code:'Enter'});s.emit('paste',{clipboardData:{getData:()=> 'queued'}});
 s.choose('keyboard');release();await tick();assert.equal(s.calls.length,1);
});
test('Vision cancellation invalidates queued keyboard and paste even while keyboard capture stays enabled',async()=>{
 let release;const s=stage('visionOS',async()=>new Promise(resolve=>release=resolve),true);
 s.choose('keyboard');s.emit('keydown',{code:'KeyB'});await tick();
 s.emit('keydown',{code:'Enter'});s.emit('paste',{clipboardData:{getData:()=> 'queued'}});s.choose('pan');
 release();await tick();assert.equal(s.calls.length,1);
});
test('Vision spatial failures invalidate queued keyboard and paste input at every delivery phase',async()=>{
 for(const phase of ['began','changed','ended']){
  let reject;const s=stage('visionOS',async(_action,p)=>{if(p.phase===phase)await new Promise((_resolve,r)=>reject=r);},true);
  s.choose('keyboard');s.emit('pointerdown');await tick();s.emit('pointermove',{clientX:1000});await tick();s.emit('pointerup');await tick();
  s.emit('keydown',{code:'Enter'});s.emit('paste',{clipboardData:{getData:()=> 'queued'}});reject(Error('lost acknowledgement'));await tick();
  assert.ok(s.calls.every(p=>p.action==='spatial'));
 }
});
test('TV and captured Vision forward modified arrow keys with their original modifiers',async()=>{
 for(const platform of ['tvOS','visionOS']){
  const s=stage(platform,undefined,platform==='visionOS');if(platform==='visionOS')s.choose('keyboard');
  for(const modifier of ['metaKey','ctrlKey'])for(const code of ['ArrowLeft','ArrowRight'])s.emit('keydown',{code,[modifier]:true,shiftKey:true});
  await tick();assert.deepEqual(s.calls.map(p=>[p.action,p.code,p.modifiers]),[
   ['key','ArrowLeft',['shift','command']],['key','ArrowRight',['shift','command']],
   ['key','ArrowLeft',['control','shift']],['key','ArrowRight',['control','shift']]
  ]);
 }
});
test('TV screen click confirms focus anywhere; right-click returns once without selecting',async()=>{
 const s=stage();s.emit('pointerdown');s.emit('pointerup');await tick();
 s.emit('pointerdown',{button:2});s.emit('pointerup',{button:2});const menu=s.emit('contextmenu');await tick();
 assert.equal(menu.prevented,true);assert.deepEqual(s.calls,[{action:'press',button:'select'},{action:'press',button:'back'}]);
 s.emit('pointerdown',{ctrlKey:true});s.emit('pointerup');s.emit('contextmenu');await tick();
 assert.deepEqual(s.calls.at(-1),{action:'press',button:'back'});assert.equal(s.calls.length,3);
});
test('TV dragged, canceled, secondary-touch and outside releases cannot select',async()=>{
 const s=stage();
 s.emit('pointerdown');s.emit('pointermove',{clientX:990});s.emit('pointermove');s.emit('pointerup');
 for(const name of ['pointercancel','lostpointercapture']){s.emit('pointerdown');s.emit(name);s.emit('pointerup');}
 s.emit('pointerdown');s.emit('pointerdown',{isPrimary:false,pointerId:2});s.emit('pointerup');
 s.emit('pointerdown');s.emit('pointerup',{clientX:2000});
 s.emit('pointerdown');s.windowEvent('blur');s.emit('pointerup');
 await tick();assert.deepEqual(s.calls,[]);
});
test('TV sends continuous native contact positions following finger motion on both axes',async()=>{
 const s=stage();
 assert.equal(s.emit('wheel',{deltaX:50,deltaY:-100}).prevented,true);await tick();
 s.emit('wheel',{deltaY:-5,deltaMode:1});await tick();
 s.emit('wheel',{deltaY:.1,deltaMode:2});await tick();
 s.elapse(101);await tick();
 assert.deepEqual(s.calls.map(c=>c.phase),['began','changed','changed','changed','ended']);
 assert.ok(s.calls.every(c=>c.action==='trackpad'&&c.gesture===s.calls[0].gesture));
 assert.equal(s.calls[0].x,.85);assert.equal(s.calls[0].y,.15);
 assert.ok(s.calls[1].x<s.calls[0].x);assert.ok(s.calls[1].y>s.calls[0].y);
 assert.ok(Math.abs(s.calls[2].y-.75)<1e-9);assert.ok(Math.abs(s.calls[3].y-.39)<1e-9);
 assert.equal(s.calls.at(-1).y,s.calls.at(-2).y);
});
test('TV coalesces in-flight positions without losing displacement or queueing stale samples',async()=>{
 let release;const s=stage('tvOS',async(action,p)=>{if(p.phase==='changed')await new Promise(r=>{release=r;});});
 s.emit('wheel',{deltaY:-10});await tick();
 for(let i=0;i<100;i++)s.emit('wheel',{deltaY:-10});
 assert.equal(s.calls.length,2);s.elapse(101);release();await tick();
 assert.equal(s.calls.length,3);assert.equal(s.calls[2].y,1);assert.equal(s.calls[2].phase,'changed');
 release();await tick();assert.equal(s.calls.length,4);assert.equal(s.calls[3].phase,'ended');
});
test('TV normally finished queued short swipes survive slow acknowledgements before discrete input',async()=>{
 for(const phase of ['began','changed','ended'])for(const delay of [101,1001]){
  let ack,blocked=false;const s=stage('tvOS',async(_action,p)=>{if(p.phase===phase&&!blocked){blocked=true;await new Promise(resolve=>ack=resolve);}});
  s.emit('wheel',{deltaY:-10});await tick();s.elapse(101);await tick();
  for(let i=0;i<2;i++){s.emit('wheel',{deltaY:-20});s.elapse(101);}
  s.elapse(delay);s.emit('contextmenu');await tick();
  ack();await tick();
  const groups=new Map();
  for(const p of s.calls.filter(p=>p.action==='trackpad')){if(!groups.has(p.gesture))groups.set(p.gesture,[]);groups.get(p.gesture).push(p);}
  assert.equal(groups.size,3,`every accepted short swipe is delivered after delayed ${phase}`);
  let i=0;for(const packets of groups.values()){
   assert.deepEqual(packets.map(p=>p.phase),['began','changed','ended']);
   assert.ok(Math.abs(packets[1].y-packets[0].y-(i++?20:10)/300)<1e-9);assert.equal(packets[2].y,packets[1].y);
  }
  assert.deepEqual(s.calls.at(-1),{action:'press',button:'back'});
  const ids=[...groups.keys()];assert.deepEqual(s.calls.filter(p=>p.action==='trackpad').map(p=>p.gesture),ids.flatMap(id=>[id,id,id]));
 }
});
test('TV cancellation discards motion and starts across all unfinished wheel gestures',async()=>{
 for(const phase of ['began','changed','ended'])for(const stop of [s=>s.windowEvent('blur'),s=>s.hide(),s=>s.disconnect(),s=>s.windowEvent('pagehide'),s=>s.emit('pointercancel')]){
  let ack;const s=stage('tvOS',async(_action,p)=>{if(p.phase===phase)await new Promise(resolve=>ack=resolve);});
  s.emit('wheel',{deltaY:-10});await tick();s.emit('wheel',{deltaY:-10});s.elapse(101);await tick();
  s.emit('wheel',{deltaY:-10});s.elapse(101);s.emit('wheel',{deltaY:-10});
  const n=s.calls.length,old=s.calls[0].gesture;stop(s);ack();await tick();
  assert.ok(s.calls.every(p=>p.gesture===old),'no queued wheel gesture starts after cancellation');
  assert.ok(s.calls.slice(n).every(p=>p.phase==='ended'),'only release follows cancellation');
  if(phase==='ended')ack();await tick();assert.equal(s.calls.filter(p=>p.phase==='ended').length,1);
 }
});
test('TV acknowledgement failure cancels every queued wheel gesture',async()=>{
 for(const phase of ['began','changed','ended']){
  let reject;const s=stage('tvOS',async(_action,p)=>{if(p.phase===phase)await new Promise((_resolve,r)=>reject=r);});
  s.emit('wheel',{deltaY:-10});await tick();s.emit('wheel',{deltaY:-10});s.elapse(101);await tick();
  s.emit('wheel',{deltaY:-10});s.elapse(101);s.emit('wheel',{deltaY:-10});
  const old=s.calls[0].gesture;reject(Error('lost acknowledgement'));await tick();
  assert.ok(s.calls.every(p=>p.gesture===old));assert.match(s.status.textContent,/Input not confirmed/);
 }
});
test('TV lifts the contact before select/back and on blur, hidden page, stream loss or page exit',async()=>{
 for(const finish of [s=>{s.emit('pointerdown');s.emit('pointerup');},s=>s.emit('contextmenu'),s=>s.windowEvent('blur'),s=>s.hide(),s=>s.disconnect(),s=>s.windowEvent('pagehide')]){
  const s=stage();s.emit('wheel',{deltaY:-100});await tick();finish(s);await tick();
  assert.equal(s.calls[2].phase,'ended');
  if(s.calls[3])assert.equal(s.calls[3].action,'press');
 }
 const s=stage();s.emit('pointerdown');s.emit('wheel',{deltaY:-100});s.emit('pointerup');await tick();
 assert.ok(s.calls.every(c=>c.action==='trackpad'));
 s.windowEvent('pagehide');await tick();const count=s.calls.length;s.emit('wheel',{deltaY:-100});s.emit('contextmenu');await tick();assert.equal(s.calls.length,count);
});
test('TV ignores pinch/invalid motion; failed gestures do not retry until a new gesture',async()=>{
 let fail=true;const s=stage('tvOS',async()=>{if(fail)throw Error('failed');});
 assert.equal(s.emit('wheel',{ctrlKey:true,deltaY:100}).prevented,undefined);
 s.emit('wheel',{deltaY:NaN});await tick();assert.equal(s.calls.length,0);
 s.emit('wheel',{deltaY:-100});await tick();assert.match(s.status.textContent,/Input not confirmed/);assert.equal(s.calls.length,1);
 fail=false;s.emit('wheel',{deltaY:-100});await tick();assert.equal(s.calls.length,1);
 s.elapse(200);s.emit('wheel',{deltaY:-100});await tick();assert.equal(s.calls.length,3);
 s.elapse(101);await tick();assert.equal(s.calls.at(-1).phase,'ended');
});
test('Vision keeps spatial tap/hold and does not acquire TV wheel or context-menu actions',async()=>{
 const s=stage('visionOS');s.emit('pointerdown');s.advance(800);s.emit('pointerup');await tick();
 assert.deepEqual(s.calls,[{action:'tap',x:0.5,y:0.5,duration:0.8}]);
 assert.equal(s.emit('wheel',{deltaY:100}).prevented,undefined);
 assert.equal(s.emit('contextmenu').prevented,undefined);await tick();assert.equal(s.calls.length,1);
});

test('queued keys, clicks and paste are discarded on blur, hidden, stream loss and exit',async()=>{
 for(const finish of [s=>s.windowEvent('blur'),s=>s.hide(),s=>s.disconnect(),s=>s.windowEvent('pagehide')]){
  let release;const held=new Promise(r=>release=r);
  const s=stage('visionOS',async()=>held);
  s.emit('keydown',{code:'KeyA'});await tick();assert.equal(s.calls.length,1);
  s.emit('keydown',{code:'KeyB'});
  s.emit('pointerdown');s.emit('pointerup');
  s.emit('paste',{clipboardData:{getData:()=> 'pending'}});
  finish(s);s.show();release();await tick();
  assert.equal(s.calls.length,1,'nothing queued before leaving can execute after returning');
 }
});
test('input failure and queue saturation discard pending operations without replay',async()=>{
 for(const mode of ['failure','saturated']){
  let resolve,reject;const held=new Promise((a,b)=>{resolve=a;reject=b;});
  const s=stage('tvOS',async()=>held);s.emit('keydown',{code:'KeyA'});await tick();
  for(let i=0;i<(mode==='saturated'?40:3);i++)s.emit('keydown',{code:'KeyB'});
  if(mode==='failure')reject(Error('unknown'));else resolve();
  await tick();assert.equal(s.calls.length,1);assert.match(s.status.textContent,/Input not confirmed/);
 }
});
test('TV and Vision stream H.264 when WebCodecs exists and fall back to MJPEG after repeated decoder failures',()=>{
 for(const platform of ['tvOS','visionOS']){
  const s=stage(platform);assert.equal(s.stream().format,'avcc');assert.match(s.stream().url,/format=avcc/);
  s.stream().onLog('decode: SOFTWARE fallback',true);s.elapse(300);assert.equal(s.sessions.length,1,'a software decoder warning keeps the stream');
  s.stream().onLog('decoder: EncodingError',true);s.elapse(300);assert.equal(s.sessions.length,2);assert.equal(s.stream().format,'avcc');assert.ok(s.sessions[0].stopped);
  s.stream().onLog('decoder: EncodingError',true);s.elapse(300);assert.equal(s.stream().format,'mjpeg');
  assert.equal(stage(platform,undefined,false,false).stream().format,'mjpeg');
 }
});
test('TV and Vision streams drop to a trickle while hidden and return to 60 fps',()=>{
 const s=stage('visionOS');s.stream().onOpen();
 s.hide();s.reveal();
 assert.equal(JSON.stringify(s.sessions[0].sent),JSON.stringify([{type:'set_fps',fps:60},{type:'set_fps',fps:2},{type:'set_fps',fps:60}]));
});
