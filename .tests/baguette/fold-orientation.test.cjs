const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const web=path.join(__dirname,'../../cindy-simulator/vendor/baguette/Baguette_Baguette.bundle/Web');
test('opening and reconnecting the flat viewer reads the guest orientation without writing it',()=>{
 const source=fs.readFileSync(path.join(web,'sim-native.js'),'utf8');
 assert.ok(!source.includes('resetToPortrait'));
 assert.ok(!source.includes('cindyOrientation'));
 const callbacks=source.slice(source.indexOf('  function sessionCallbacks('),source.indexOf('  function startSession('));
 const snap=source.slice(source.indexOf('  function snapOrientation('),source.indexOf('  // Map a normalized coord'));
 const make=()=>{
  const sent=[],context={document:{getElementById:()=>null},routeStreamText:()=>false,fetch:()=>assert.fail('viewer initialization must not write orientation')};
  vm.createContext(context);
  vm.runInContext("let deviceMode=false,foldable=false,currentOrientation='portrait',orientationIndex=0,rotationDegrees=0;const ORIENTATION_CYCLE=['portrait','landscape-left','portrait-upside-down','landscape-right'];function orientationCycle(){return ORIENTATION_CYCLE;}"+snap+callbacks,context);
  context.active={send:p=>sent.push(p)};vm.runInContext('let session=active',context);
  return {context,sent,callbacks:context.sessionCallbacks(),orientation:()=>vm.runInContext('currentOrientation',context)};
 };
 const reply=orientation=>({type:'describe_ui_result',ok:true,tree:{screen:{orientation}}});
 for(const orientation of ['portrait','landscape-left','portrait-upside-down','landscape-right']){
  const f=make();f.callbacks.onOpen();assert.deepEqual(JSON.parse(JSON.stringify(f.sent)),[{type:'describe_ui',x:1,y:1}]);
  assert.equal(f.callbacks.onText(reply(orientation)),true);assert.equal(f.orientation(),orientation);
  // A format swap or reload uses a fresh callback and observes the device again.
  const next=f.context.sessionCallbacks();next.onOpen();next.onText(reply('landscape-right'));assert.equal(f.orientation(),'landscape-right');
 }
 for(const failure of [{type:'describe_ui_result',ok:false},{type:'describe_ui_result',ok:true,tree:{}},reply('invalid')]){
  const f=make();f.callbacks.onOpen();f.callbacks.onText(failure);assert.equal(f.orientation(),'portrait');
 }
 const manual=make();manual.callbacks.onOpen();vm.runInContext("currentOrientation='landscape-right'",manual.context);
 manual.callbacks.onText(reply('landscape-left'));assert.equal(manual.orientation(),'landscape-right','late read cannot undo explicit rotation');
 const old=make();old.callbacks.onOpen();old.context.active={send:p=>old.sent.push(p)};vm.runInContext('session=active',old.context);
 old.callbacks.onText(reply('landscape-left'));assert.equal(old.orientation(),'portrait','retired streams cannot change a newer view');
 for(const mode of ['deviceMode','foldable']){
  const f=make();vm.runInContext(`${mode}=true`,f.context);f.callbacks.onOpen();assert.equal(f.sent.length,0,'physical devices and the 3D panel retain their own orientation paths');
 }
});

test('live panel updates remap taps and drags in both directions without resetting manual rotation',async()=>{
 const streams=[],sent=[],frames=new Map();let nextFrame=0;
 const flush=()=>{for(const [id,fn] of frames){frames.delete(id);fn();}};
 const context={window:{},URLSearchParams,requestAnimationFrame:fn=>{frames.set(++nextFrame,fn);return nextFrame;},cancelAnimationFrame:id=>frames.delete(id),location:{protocol:'http:',host:'localhost'},fetch:async()=>({ok:true,json:async()=>({variantSets:[]})})};
 const native=fs.readFileSync(path.join(web,'sim-native.js'),'utf8');
 vm.createContext(context);
 vm.runInContext("let render3DPanel=null,foldable=true,currentLitPanel='primary',currentOrientation='portrait',orientationIndex=0;const ORIENTATION_CYCLE=['portrait','landscape-left','portrait-upside-down','landscape-right'];"+native.slice(native.indexOf('  function orientationCycle()'),native.indexOf('  // Apply orientation visually:'))+native.slice(native.indexOf('  function syncLitPanel('),native.indexOf('  // Theme toggle.'))+native.slice(native.indexOf('  function visualToPortraitNorm('),native.indexOf('  // Map a screen-edge name')),context);
 vm.runInContext(fs.readFileSync(path.join(web,'sim-3d.js'),'utf8'),context);
 context.window.Baguette={_ScreenPieces:{fromMessage:()=>({length:1})}};
 context.window.StreamSession=class {constructor(options){streams.push(options);}start(){}stop(){}send(payload){sent.push(payload);return true;}};
 const panel=new context.window.Sim3DPanel();
 context.testPanel=panel;vm.runInContext('render3DPanel=testPanel',context);
 // DOM/canvas are not needed to exercise production attach, stream callbacks,
 // page orientation state and the actual outgoing coordinate remapper.
 for(const method of ['renderLoading','renderControls','mountStage','setState','cancelPointer','placeButtons','placePosePicker'])panel[method]=()=>{};
 panel.canvas={};panel.outputSize=()=>({width:100,height:100});
 await panel.attach(null,null,'00000000-0000-4000-8000-000000000001',{onLitPanelChange:context.syncLitPanel});
 const emit=litPanel=>streams.at(-1).onText({type:'screen_quad',litPanel});
 const tap=()=>context.remapEnvelopeToPortrait({type:'tap',x:20,y:30,width:100,height:100});
 emit('secondary');assert.deepEqual([tap().x,tap().y],[30,80]);
 flush();assert.equal(sent.at(-1).orientation,'landscape-left');
 const drag=context.remapEnvelopeToPortrait({type:'swipe',startX:20,startY:30,endX:40,endY:50,width:100,height:100});
 assert.deepEqual([drag.startX,drag.startY,drag.endX,drag.endY],[30,80,50,60]);
 vm.runInContext("currentOrientation='landscape-right'",context);
 panel.setInterfaceOrientation('landscape-right');flush();
 emit('secondary');assert.deepEqual([tap().x,tap().y],[70,20]);
 assert.equal(panel.interfaceOrientation,'landscape-right');
 emit('bogus');assert.deepEqual([tap().x,tap().y],[70,20]);
 // Folding keeps the book where it is held: the cover stands a quarter turn behind the
 // unfolded panel (real case: a turned cover unfolded back to an upright book while
 // the guest kept the turn, so its picture lay sideways in the book).
 emit('primary');assert.deepEqual([tap().x,tap().y],[80,70]);
 flush();assert.equal(sent.at(-1).orientation,'portrait-upside-down');assert.equal(vm.runInContext('orientationIndex',context),2);
 panel.sendCamera();flush();assert.equal(sent.at(-1).orientation,'portrait-upside-down');
 const old=streams.at(-1);await panel.attach(null,null,panel.udid,{});
 old.onText({type:'screen_quad',litPanel:'secondary'});assert.deepEqual([tap().x,tap().y],[80,70]);
 emit('secondary');assert.deepEqual([tap().x,tap().y],[70,20]);
 flush();assert.equal(sent.at(-1).orientation,'landscape-right');assert.equal(vm.runInContext('orientationIndex',context),3);
 emit('primary');assert.deepEqual([tap().x,tap().y],[80,70]);
 // An upright book opens and closes upright.
 vm.runInContext("currentOrientation='portrait';orientationIndex=0",context);
 emit('secondary');flush();assert.equal(sent.at(-1).orientation,'landscape-left');
 emit('primary');flush();assert.equal(sent.at(-1).orientation,'portrait');
});

test('the foldable turns with an animation and reports how its book is rolled',()=>{
 // Real case: the server rolls the 3D book in place at once, so Duo jumped a quarter
 // turn while the iPhone chrome turned smoothly; posture glyphs never followed.
 const make=({reduced=false}={})=>{
  const appended=[],timers=[];
  const canvasStyle={removeProperty(k){delete this[k];}};
  const canvas={isConnected:true,width:800,height:600,style:canvasStyle,getBoundingClientRect:()=>({left:10,top:20,width:400,height:300})};
  const document={getElementById:()=>null,addEventListener(){},visibilityState:'visible',
   body:{append:n=>appended.push(n)},
   createElement:()=>({style:{},setAttribute(){},getContext:()=>({drawImage(){}}),remove(){this.removed=true;}})};
  const window={matchMedia:q=>({matches:reduced&&/reduce/.test(q),addEventListener(){}})};
  const context=vm.createContext({window,document,getComputedStyle:()=>({objectFit:'contain',getPropertyValue:()=>''}),Promise,
   setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../../cindy-simulator/node/viewer-stage.js'),'utf8'),context);
  function Sim3DPanel(){}
  Sim3DPanel.prototype.attach=function(){};Sim3DPanel.prototype.setBackground=function(){};
  Sim3DPanel.prototype.placePosePicker=function(){};Sim3DPanel.prototype.detach=function(){};
  window.Sim3DPanel=Sim3DPanel;
  const panel=new window.Sim3DPanel();panel.attach();panel.canvas=canvas;panel.litPanel='primary';panel.interfaceOrientation=null;
  panel.placePosePicker({hingeDegrees:0});
  const cycle=['portrait','landscape-left','portrait-upside-down','landscape-right'];
  let index=0;window.__nativeRotateBy=step=>{index=(index+step+4)%4;panel.interfaceOrientation=cycle[index];};
  return {pose:window.__cindyPose,panel,appended,timers,canvas};
 };
 const f=make();
 assert.equal(f.pose.roll(),0);
 assert.equal(f.pose.turn(1),true);assert.equal(f.pose.roll(),90,'rotate right turns the cover clockwise');
 assert.equal(f.appended.length,1);assert.equal(f.appended[0].style.transform,'rotate(90deg)');
 assert.equal(f.canvas.style.opacity,'0','the rolled live stream waits under the turning frame');
 f.timers.splice(0).forEach(fn=>fn());f.timers.splice(0).forEach(fn=>fn());
 assert.equal(f.appended[0].removed,true);assert.equal(f.canvas.style.opacity,undefined,'the live stream is shown once the turn lands');
 f.pose.turn(-1);f.timers.splice(0).forEach(fn=>fn());f.timers.splice(0).forEach(fn=>fn());
 f.pose.turn(-1);assert.equal(f.pose.roll(),270);
 assert.equal(f.appended.at(-1).style.transform,'rotate(-90deg)','each step takes the short way round');
 assert.equal(f.appended.at(-2).removed,true,'a landed turn is gone before the next starts');
 // A second turn before the first lands carries on from the frame already turning,
 // instead of snapshotting a picture the stream has not repainted yet (it would
 // turn too little and then jump).
 f.timers.splice(0).forEach(fn=>fn());f.timers.splice(0).forEach(fn=>fn());
 const count=f.appended.length,first=f.pose.roll();
 f.pose.turn(1);f.pose.turn(1);
 assert.equal(f.appended.length,count+1,'one turning frame serves consecutive turns');
 assert.equal(f.appended.at(-1).style.transform,'rotate(180deg)');assert.equal(f.appended.at(-1).removed,undefined);
 assert.equal((first+180)%360,f.pose.roll());
 f.timers.splice(0).forEach(fn=>fn());f.timers.splice(0).forEach(fn=>fn());
 assert.equal(f.appended.at(-1).removed,true);assert.equal(f.canvas.style.opacity,undefined);
 // The unfolded panel stands in landscape-left; switching panels is not a turn.
 f.panel.litPanel='secondary';f.panel.interfaceOrientation='landscape-left';assert.equal(f.pose.roll(),0);
 f.panel.interfaceOrientation='portrait';assert.equal(f.pose.roll(),270);
 const still=make({reduced:true});still.pose.turn(1);
 assert.equal(still.pose.roll(),90);assert.equal(still.appended.length,0,'reduced motion turns at once');
});

test('an opened foldable starts at the guest orientation and rotation writes the device hold',()=>{
 // Real cases: reopening the viewer on a turned, unfolded Duo drew it upright while the
 // guest kept the turn; rotating while unfolded sent the panel orientation as the device
 // orientation, which the guest's unfolded panel reads a step further on.
 const native=fs.readFileSync(path.join(web,'sim-native.js'),'utf8');
 const start=native.slice(native.indexOf('  function startMainView('),native.indexOf('  // Lazy-mounts the AXInspector'));
 const rotateFrom=native.indexOf('    window.__nativeRotateBy = (step) => {');
 const rotate=native.slice(rotateFrom,native.indexOf('      // Mirror the rotation in the UI immediately.',rotateFrom))+'};';
 const make=(litPanel,guest)=>{
  const posts=[],camera=[];
  const context={window:{},document:{getElementById:()=>null},encodeURIComponent,fetch:url=>{posts.push(new URL(url,'http://x').searchParams.get('value'));return Promise.resolve();}};
  vm.createContext(context);
  vm.runInContext(`let foldable=true,udid='u',currentLitPanel=${JSON.stringify(litPanel)},foldOrientation=${JSON.stringify(guest)},currentOrientation='portrait',orientationIndex=0;
   const ORIENTATION_CYCLE=['portrait','landscape-left','portrait-upside-down','landscape-right'];function orientationCycle(){return ORIENTATION_CYCLE;}
   const render3DPanel={setInterfaceOrientation:v=>camera.push(v)};function toggle3D(){}function startSession(){}`+start+rotate,Object.assign(context,{camera}));
  vm.runInContext('startMainView()',context);
  return {posts,camera,orientation:()=>vm.runInContext('currentOrientation',context),rotate:s=>context.window.__nativeRotateBy(s)};
 };
 const open=make('secondary','portrait-upside-down');
 assert.equal(open.orientation(),'portrait-upside-down');assert.deepEqual(open.camera,['portrait-upside-down']);
 open.rotate(1);assert.equal(open.orientation(),'landscape-right');assert.deepEqual(open.posts,['portrait-upside-down'],'the panel reads one step past the device hold');
 open.rotate(-1);open.rotate(-1);assert.deepEqual(open.posts,['portrait-upside-down','landscape-left','portrait']);
 const cover=make('primary',null);
 assert.equal(cover.orientation(),'portrait');cover.rotate(1);assert.deepEqual(cover.posts,['landscape-left'],'the cover shows the device hold as is');
 assert.equal(make('secondary',null).orientation(),'landscape-left','without a reading the book opens upright');
 assert.equal(make('secondary','sideways').orientation(),'landscape-left');
});
