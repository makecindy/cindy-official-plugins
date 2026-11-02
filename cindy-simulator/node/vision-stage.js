'use strict';
// One live contact, using the same absolute-sample/coalescing protocol as TV.
// A mode belongs to a gesture from pointer-down until release; modifier changes
// cannot turn an already held pinch into a camera movement.
globalThis.createVisionStage = function({canvas,api,message,onError,onCancel=()=>{},enqueueGesture,zh}) {
 let mode='interact',keyboard=false,twoHands=false,contact=null,pointer=null,stopped=false;
 let idleTimer=null,beat=null,lastHover=0,keys=new Set(),keyTimer=null,wheel=null;
 let recording=null,saving=false,hoverBlocked=false,game=null,gameTimer=null,gameFailed=false;
 // Ending and queued contacts still belong to this controller until settled.
 const contacts=new Set();
 async function record(){
  if(saving)return;
  try{
   if(recording){saving=true;const r=recording;recording=null;const artifact=await r.stop();const a=document.createElement('a');a.href=artifact.url;a.download=artifact.filename;a.click();setTimeout(()=>URL.revokeObjectURL(artifact.url),30000);}
   else {recording=new BrowserRecorder({canvas,bezel:false,fps:30});recording.start();}
  }catch{recording?.cancel();recording=null;onError();}finally{saving=false;state();}
 }
 const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
 const point=e=>{const r=canvas.getBoundingClientRect();return {x:clamp((e.clientX-r.left)/r.width,0,1),y:clamp((e.clientY-r.top)/r.height,0,1),aspect:r.width/r.height};};
 const usable=()=>!stopped&&!document.hidden;
 const captureError=()=>message(zh?'未能捕获鼠标。请先激活查看器窗口后重试；当前浏览器也可能不支持鼠标捕获。':'Pointer capture failed. Activate the viewer window and retry; the browser may not support pointer lock.');
 function done(c){c.finished=true;contacts.delete(c);c.resolve();if(contact===c){contact=null;clearTimeout(beat);beat=null;}}
 function failed(c){hoverBlocked=true;gameFailed=true;onError();done(c);cancel();}
 async function pump(c){
  if(c.busy||!c.ready||c.finished)return;
  const pending=c.samples.shift()?.sample;if(!pending&&!c.ending)return;
  c.busy=true;
  const phase=pending?'changed':'ended',sample=pending||c.sent;
  try{await api('spatial',{...sample,gesture:c.id,phase});c.sent=sample;if(phase==='ended')done(c);}
  catch{failed(c);}
  finally{c.busy=false;if(!c.finished)pump(c);}
 }
 function heartbeat(c){
  clearTimeout(beat);beat=setTimeout(()=>{if(contact!==c||c.ending||c.finished)return;if(usable()){update(c,{});heartbeat(c);}else finish(true);},250);
 }
 function begin(value){
  if(!usable())return null;
  const previous=contact;if(previous&&!previous.ending)finish();
  const c={id:crypto.randomUUID(),last:{z:0,spread:.1,angle:0,aspect:canvas.width/canvas.height||16/9,...value},samples:[],ready:false,busy:false,ending:false,finished:false};
  c.initial={...c.last};c.sent=c.initial;
  c.done=new Promise(resolve=>{c.resolve=resolve;});contacts.add(c);contact=c;
  const start=async()=>{
   if(!usable()||c.cancelled){done(c);return;}
   try{await api('spatial',{...c.initial,gesture:c.id,phase:'began'});c.ready=true;pump(c);if(!c.ending)heartbeat(c);}
   catch{failed(c);}
  };
  if(enqueueGesture)enqueueGesture(start,c.done);
  else (previous?.done||Promise.resolve()).then(start);
  return c;
 }
 function update(c,value){
  if(!c||c.ending||c.finished)return;
  const previous=c.last;c.last={...c.last,...value};
  // One ordered stream: coalesce only within a button state. Movement on a
  // transition still belongs to the old mask; the edge has zero displacement.
  const enqueue=(sample,edge=false)=>{
   const tail=c.samples.at(-1);
   if(tail&&!tail.edge&&!edge&&(sample.mode!=='pointer'||tail.sample.z===sample.z))tail.sample=sample;
   else c.samples.push({sample,edge});
  };
  const edge=c.last.mode==='pointer'&&c.last.z!==previous.z;
  if(edge)enqueue({...c.last,z:previous.z});
  enqueue(c.last,edge);
  pump(c);
 }
 function finish(discard=false){
  clearTimeout(idleTimer);idleTimer=null;clearTimeout(beat);beat=null;wheel=null;
  const current=contact;
  for(const c of discard?contacts:current?[current]:[]){
   c.ending=true;if(discard){c.samples.length=0;c.cancelled=!c.ready;}pump(c);
  }
  return current?.done||Promise.resolve();
 }
 function cancel(){onCancel();pointer=null;game=null;keys.clear();clearTimeout(keyTimer);keyTimer=null;finish(true);}
 // Toolbar drags are temporary camera gestures, independent of the selected
 // canvas mode. Use displacement: toolbar and canvas live in different frames.
 function cameraDrag(selected){
  if(!['tilt','pan','orbit','dolly'].includes(selected)||!usable())return null;
  const r=canvas.getBoundingClientRect();if(!r.width||!r.height)return null;
  cancel();
  const c=begin({mode:selected,x:0,y:0,aspect:r.width/r.height});if(!c)return null;
  return {
   move(dx,dy){if(contact===c)update(c,{x:clamp(dx/r.width,-4,4),y:clamp(dy/r.height,-4,4)});},
   end(discard=false){if(contact===c)return finish(discard);return c.done;}
  };
 }
 function state(){
  const bar=parent.document.getElementById('vision-controls');
  for(const b of bar?.querySelectorAll('[data-vision]')||[]){
   const id=b.dataset.vision;
   if(id==='reset')b.removeAttribute('aria-pressed');
   else b.setAttribute('aria-pressed',String(id===mode||(id==='record'&&!!recording)||(id==='keyboard'&&keyboard)||(id==='two-hands'&&twoHands)||(id==='pointer'&&document.pointerLockElement===canvas)));
   if(id==='record'){b.title=b.ariaLabel=recording?(zh?'停止并保存录屏':'Stop and save recording'):(zh?'开始录屏':'Start recording');b.setAttribute('aria-description',b.title);}
  }
  canvas.style.cursor=mode==='interact'?'default':mode==='pan'?'grab':'crosshair';
 }
 function choose(value){
  cancel();hoverBlocked=false;canvas.focus();
  if(value==='keyboard')keyboard=!keyboard;
  else if(value==='record')record();
  else if(value==='pointer'){
   if(document.pointerLockElement===canvas)document.exitPointerLock();
   else {try{Promise.resolve(canvas.requestPointerLock()).catch(captureError);}catch{captureError();}}
  }
  else if(value==='two-hands')twoHands=!twoHands;
  else if(value==='reset'){const c=begin({mode:'reset',x:0,y:0});if(c)finish();}
  else if(value==='help')message(zh?'拖动操作 · Shift 拖动远近 · Option 双手缩放/旋转 · Control 转向 · WASD/QE 移动 · 键盘按钮输入文字':'Drag to interact · Shift: depth · Option: two hands · Control: look · WASD/QE: move · Keyboard button: type');
  else if(['interact','tilt','pan','orbit','dolly'].includes(value))mode=value;
  state();
 }
 canvas.addEventListener('pointerdown',e=>{
  if(!usable()||e.isPrimary===false||![0,2].includes(e.button))return;
  e.preventDefault();hoverBlocked=false;canvas.focus();canvas.setPointerCapture(e.pointerId);
  if(document.pointerLockElement===canvas){captured(e);return;}
  const p=point(e),selected=e.ctrlKey||e.button===2?'tilt':mode==='interact'&&(e.altKey||twoHands)?'two-hands':mode;
  const c=begin({...p,mode:selected});if(!c)return;
  pointer={id:e.pointerId,c,start:p,depth:e.shiftKey&&selected==='interact'};
 });
 canvas.addEventListener('pointermove',e=>{
  if(!usable())return;const p=point(e);
  if(document.pointerLockElement===canvas){captured(e);return;}
  if(pointer?.id===e.pointerId){
   const {c,start,depth}=pointer;
   if(c.last.mode==='two-hands'){
    // Pointer-to-centre vector controls two mirrored hand points.
    update(c,{spread:clamp(.1+(p.x-start.x),.01,1),angle:clamp((start.y-p.y)*Math.PI*2,-Math.PI*2,Math.PI*2)});
   }else if(depth)update(c,{z:clamp((p.y-start.y)*2,-2,2)});
   else update(c,p);
  }else if(mode==='interact'&&!hoverBlocked&&!contact&&Date.now()-lastHover>=50){
   lastHover=Date.now();begin({...p,mode:'gaze'});finish();
  }
 });
 canvas.addEventListener('pointerup',e=>{if(document.pointerLockElement===canvas){captured(e);return;}if(pointer?.id!==e.pointerId)return;pointer=null;finish();});
 function captured(e){
  const buttons=(e.buttons||0)&3;
  clearTimeout(idleTimer);idleTimer=null;
  if(e.type==='pointerup'&&!buttons&&(!contact||contact.ending))return;
  if(!contact||contact.ending)begin({mode:'pointer',x:0,y:0,z:(e.buttons||0)&3});
  if(contact?.last.mode!=='pointer')return;
  const dx=Number.isFinite(e.movementX)?e.movementX/1000:0,dy=Number.isFinite(e.movementY)?e.movementY/1000:0;
  update(contact,{x:contact.last.x+dx,y:contact.last.y+dy,z:buttons});
  if(e.type==='pointerup'&&!buttons){finish();return;}
  if(!buttons)idleTimer=setTimeout(()=>finish(),300);
 }
 document.addEventListener('pointerlockchange',()=>{cancel();state();});
 document.addEventListener('pointerlockerror',captureError);
 canvas.addEventListener('pointercancel',cancel);
 canvas.addEventListener('lostpointercapture',()=>{if(pointer)cancel();});
 canvas.addEventListener('contextmenu',e=>e.preventDefault());
 canvas.addEventListener('wheel',e=>{
  if(!usable()||pointer)return;e.preventDefault();canvas.focus();
  const unit=e.deltaMode===1?16:e.deltaMode===2?canvas.getBoundingClientRect().height:1;
  const dx=e.deltaX*unit,dy=e.deltaY*unit;if(!Number.isFinite(dx)||!Number.isFinite(dy))return;
  const selected=e.ctrlKey?'dolly':e.altKey?'two-hands':'pan';
  if(!wheel||wheel.ending||wheel.finished||wheel.last.mode!==selected)wheel=begin({...point(e),mode:selected});
  if(!wheel)return;
  if(selected==='two-hands')update(wheel,{spread:clamp(wheel.last.spread*Math.exp(-dy/300),.01,1)});
  else update(wheel,{x:clamp(wheel.last.x+dx/1000,-4,4),y:clamp(wheel.last.y+dy/1000,-4,4)});
  clearTimeout(idleTimer);idleTimer=setTimeout(()=>finish(),120);
 },{passive:false});
 const directions={KeyW:[0,0,-1],ArrowUp:[0,0,-1],KeyS:[0,0,1],ArrowDown:[0,0,1],KeyA:[-1,0,0],ArrowLeft:[-1,0,0],KeyD:[1,0,0],ArrowRight:[1,0,0],KeyE:[0,1,0],KeyQ:[0,-1,0]};
 function moveKeys(){
  if(!keys.size||!usable()){finish();keyTimer=null;return;}
  if(!contact||contact.ending)begin({mode:'move',x:0,y:0,z:0});
  if(contact?.last.mode==='move'){
   const next={x:contact.last.x,y:contact.last.y,z:contact.last.z};
   for(const code of keys){const d=directions[code];['x','y','z'].forEach((k,i)=>{next[k]=clamp(next[k]+d[i]*.025,-5,5);});}update(contact,next);
  }
  keyTimer=setTimeout(moveKeys,33);
 }
 function key(e){
  if(e.code==='Escape'){e.preventDefault();cancel();keyboard=false;if(document.pointerLockElement)document.exitPointerLock();state();return true;}
  if(!usable()){e.preventDefault();return true;}
  if(keyboard)return false;
  e.preventDefault();
  if(!e.metaKey&&!e.ctrlKey&&!e.altKey&&directions[e.code]){keys.add(e.code);if(!keyTimer)moveKeys();}
  return true;
 }
 canvas.addEventListener('keyup',e=>{keys.delete(e.code);if(!keys.size){clearTimeout(keyTimer);keyTimer=null;if(contact?.last.mode==='move')finish();}});
 // Standard-mapped controllers follow Apple's navigation mapping. Only the
 // focused, visible display consumes them; a failed contact requires neutral
 // sticks before starting again, so uncertain movement is not replayed.
 const gamepads=()=>{try{return Array.from(globalThis.navigator?.getGamepads?.()||[]).filter(p=>p?.connected&&p.mapping==='standard');}catch{return [];}};
 function pollGamepad(){
  clearTimeout(gameTimer);gameTimer=null;if(stopped||document.hidden)return;
  const pads=gamepads();if(!pads.length){if(contact===game)finish();game=null;return;}
  const p=pads[0],axis=n=>{const v=p.axes[n]||0;return Math.abs(v)<.15?0:clamp(v,-1,1);};
  const x=axis(0),z=axis(1),yaw=-axis(2),pitch=-axis(3),y=(p.buttons[7]?.value||0)-(p.buttons[6]?.value||0);
  const neutral=![x,y,z,yaw,pitch].some(v=>Math.abs(v)>.05);
  if(neutral){gameFailed=false;if(contact===game)finish();game=null;}
  else if(!gameFailed&&document.activeElement===canvas&&document.hasFocus()&&!keyboard&&!pointer&&!keys.size&&(!contact||contact===game||contact.ending)){
   if(!game||game.finished||game.ending)game=begin({mode:'move',x:0,y:0,z:0,yaw:0,pitch:0});
   if(game){const v=game.last,c=Math.cos(v.yaw),s=Math.sin(v.yaw);update(game,{
    x:clamp(v.x+(x*c+z*s)*.025,-5,5),y:clamp(v.y+y*.025,-5,5),z:clamp(v.z+(-x*s+z*c)*.025,-5,5),
    yaw:clamp(v.yaw+yaw*.033,-6.28,6.28),pitch:clamp(v.pitch+pitch*.033,-1.5,1.5)});}
  }else if(contact===game){finish();game=null;}
  gameTimer=setTimeout(pollGamepad,33);
 }
 addEventListener('gamepadconnected',pollGamepad);addEventListener('gamepaddisconnected',pollGamepad);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)pollGamepad();});pollGamepad();
 addEventListener('blur',cancel);document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
 addEventListener('pagehide',()=>{stopped=true;cancel();clearTimeout(gameTimer);recording?.cancel();recording=null;});
 const controller={choose,key,finish,cancel,cameraDrag,acceptsKeyboard:()=>keyboard&&usable()};globalThis.cindyVision=controller;state();return controller;
};
