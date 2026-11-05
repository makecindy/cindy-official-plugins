const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const web=path.join(__dirname,'../../cindy-simulator/vendor/baguette/Baguette_Baguette.bundle/Web');
function fixture(rotated=false,safari=false){
 const target=()=>{const listeners=new Map();return {addEventListener(n,f){if(!listeners.has(n))listeners.set(n,new Set());listeners.get(n).add(f);},removeEventListener(n,f){listeners.get(n)?.delete(f);},emit(type,p={}){for(const f of [...listeners.get(type)||[]])f({type,clientX:0,clientY:0,preventDefault(){},...p});}};};
 const el=target(),window=target(),document=target(),timers=new Map();let next=0,dots=[];
 Object.assign(window,{document,location:{origin:'http://example.test'},parent:{}});document.getElementById=()=>true;
 if(safari)window.GestureEvent=function(){};
 const scale=.5,left=30,top=50;
 const toClient=(x,y)=>rotated?{x:left+(800-y)*scale,y:top+x*scale}:{x:left+x*scale,y:top+y*scale};
 const fromClient=(x,y)=>{const p=rotated?{x:(y-top)/scale,y:800-(x-left)/scale}:{x:(x-left)/scale,y:(y-top)/scale};return {...p,xNorm:p.x/400,yNorm:p.y/800,inside:p.x>=0&&p.x<=400&&p.y>=0&&p.y<=800};};
 el.getBoundingClientRect=()=>({left,top,width:(rotated?800:400)*scale,height:(rotated?400:800)*scale});
 const calls=[],screen={size:{width:400,height:800}};
 for(const name of ['touchDown','touchMove','touchUp','tap'])screen[name]=points=>calls.push({name,points:[...(Array.isArray(points)?points:[points])].map(p=>({x:p.x,y:p.y}))});
 const context={window,document,performance:{now:()=>1000},setTimeout:f=>{timers.set(++next,f);return next;},clearTimeout:id=>timers.delete(id)};
 for(const name of ['attachable-event-source','edge-bands','mouse-gesture-source','touch-gesture-source','wheel-gesture-source','safari-gesture-event-source','option-hover-preview','pointer-interpreter'])vm.runInNewContext(fs.readFileSync(path.join(web,'baguette/gestures',name+'.js'),'utf8'),context);
 window.Baguette._MouseGestureSource.prototype._ripple=()=>{};
 const source=new window.Baguette._PointerInterpreter(screen,{mapClientPoint:fromClient,mapScreenPoint:toClient,overlay:{host:{getBoundingClientRect:()=>({left:5,top:10})},setFingers:p=>dots=JSON.parse(JSON.stringify(p)),clear:()=>dots=[]}});source.attach(el);
 const event=(type,x=180,y=350,other={})=>{const p=toClient(x,y);el.emit(type,{clientX:p.x,clientY:p.y,...other});};
 const native=(phase,pts)=>el.emit('cindy-trackpad',{detail:{phase,touches:pts.map(([id,x,y])=>({id,...toClient(x,y)}))}});
 const checkDots=points=>{assert.equal(dots.length,points.length);points.forEach((p,i)=>{const c=toClient(Math.max(0,Math.min(400,p.x)),Math.max(0,Math.min(800,p.y)));assert.ok(Math.abs(dots[i].x-(c.x-5))<1e-6);assert.ok(Math.abs(dots[i].y-(c.y-10))<1e-6);});};
 return {event,native,calls,checkDots,source,window,el,timers,toClient,dots:()=>dots};
}

test('flat and rotated 3D screens share mouse, wheel, native-contact and Safari pair semantics',()=>{
 for(const kind of ['pinch','pan','wheel','wheelPinch','native','safari']){
  const results=[];
  for(const rotated of [false,true]){
   const f=fixture(rotated,kind==='safari');
   if(kind==='pinch'||kind==='pan'){
    f.event('mousedown',160,300,{altKey:true,shiftKey:kind==='pan'});
    f.event('mousemove',180,340);f.checkDots(f.calls.at(-1).points);f.event('mouseup',180,340);
   }else if(kind.startsWith('wheel')){
    f.event('wheel',180,350,{ctrlKey:kind==='wheelPinch',deltaX:0,deltaY:0});
    f.event('wheel',180,350,{ctrlKey:kind==='wheelPinch',deltaX:rotated&&kind==='wheel'?20:0,deltaY:kind==='wheelPinch'?-20:rotated?0:-20});
    f.checkDots(f.calls.at(-1).points);for(const fn of f.timers.values())fn();
   }else if(kind==='native'){
    f.native('begin',[[0,100,300],[1,300,300]]);
    f.native('change',[[0,100,300],[1,330,350]]);f.native('change',[[0,100,300],[1,270,280]]);
    f.checkDots(f.calls.at(-1).points);assert.deepEqual(f.calls.at(-1).points[0],{x:100,y:300});
    f.native('change',[[0,100,300]]);f.native('end',[]);
   }else{
    f.event('gesturestart',180,350);f.event('gesturechange',190,360,{scale:1.2,rotation:30});f.checkDots(f.calls.at(-1).points);f.event('gestureend',190,360,{scale:1.2,rotation:30});
   }
   results.push(f.calls);f.source.detach();
  }
  assert.deepEqual(results[0],results[1],kind+' dispatches the same device contacts after projection');
 }
});

test('projected hover uses screen centre, rejects scene margins and cancellation drops an active pair',()=>{
 const f=fixture(true);f.event('mouseenter',160,300);f.window.emit('keydown',{key:'Alt'});f.checkDots([{x:160,y:300},{x:240,y:500}]);
 f.window.emit('keydown',{key:'Shift'});f.checkDots([{x:280,y:400},{x:120,y:400}]);
 f.event('mouseenter',-20,300);assert.equal(f.dots().length,0);
 f.event('wheel',-20,300,{deltaY:10});assert.equal(f.calls.length,0);
 f.native('begin',[[0,100,300],[1,300,300]]);f.source.cancel();assert.equal(f.calls.at(-1).name,'touchUp');
 const count=f.calls.length;f.native('change',[[0,110,300],[1,310,300]]);assert.equal(f.calls.length,count);assert.equal(f.dots().length,0);f.source.detach();
});

test('iPhone wheel pinch consumes invisible edge scale and reverses immediately like Android',()=>{
 for(const rotated of [false,true])for(const x of [100,200,300]){
  const f=fixture(rotated);f.event('wheel',x,400,{ctrlKey:true,deltaY:-600});f.event('wheel',x,400,{ctrlKey:true,deltaY:-100});
  assert.deepEqual(f.calls.at(-1).points.map(p=>p.x),[400,0]);
  f.event('wheel',x,400,{ctrlKey:true,deltaY:20});const pts=f.calls.at(-1).points;assert.ok(pts[0].x-pts[1].x<380);f.checkDots(pts);f.source.detach();
 }
});

test('fold pieces project contacts back to their visible half and expose only the lit screen to native capture',()=>{
 const window={},context={window,document:{},URLSearchParams};
 for(const file of ['baguette/gestures/screen-quad.js','baguette/gestures/screen-pieces.js','sim-3d.js'])vm.runInNewContext(fs.readFileSync(path.join(web,file),'utf8'),context);
 const pieces=window.Baguette._ScreenPieces.fromMessage({pieces:[{corners:[[.1,.2],[.45,.25],[.45,.75],[.1,.8]],u:[0,.5],v:[0,1]},{corners:[[.45,.25],[.8,.3],[.8,.7],[.45,.75]],u:[.5,1],v:[0,1]}]});
 for(const u of [.1,.4,.6,.9])for(const v of [.1,.5,.9]){const p=pieces.project(u,v),back=pieces.locate(p.u,p.v);assert.ok(back.inside);assert.ok(Math.abs(back.u-u)<1e-6&&Math.abs(back.v-v)<1e-6);}
 const attrs={},surface={style:{},setAttribute:(k,v)=>attrs[k]=v,removeAttribute:k=>delete attrs[k]};
 const panel=new window.Sim3DPanel();Object.assign(panel,{mode:'interact',interactionSurface:surface,screenQuad:pieces,deviceSize:{width:400,height:800},stage:{getBoundingClientRect:()=>({left:0,top:0})},canvas:{width:1000,height:1000,hasAttribute:()=>true,getBoundingClientRect:()=>({left:10,top:20,width:1000,height:1000})}});
 panel.updateInteractionSurface();assert.equal(attrs['data-cindy-trackpad'],'contacts');assert.equal(surface.style.left,'110px');assert.equal(surface.style.width,'700px');assert.equal(surface.style.height,'600px');assert.match(surface.style.clipPath,/ Z M/,'both folded halves participate in hit testing');
 const client=panel.mapScreenPoint(300,400),back=panel.mapClientPoint(client.x,client.y);assert.ok(Math.abs(back.x-300)<1e-6&&Math.abs(back.y-400)<1e-6);
 panel.mode='pose';panel.updateInteractionSurface();assert.equal(attrs['data-cindy-trackpad'],undefined);assert.equal(surface.hidden,true);
});

test('folded 3D wheel pan parked on the lit-screen edge reverses immediately using the real mapper',()=>{
 const window={addEventListener(){},document:{addEventListener(){}}},context={window,document:{},URLSearchParams,setTimeout:()=>1,clearTimeout(){}};
 for(const file of ['baguette/gestures/screen-quad.js','baguette/gestures/screen-pieces.js','baguette/gestures/attachable-event-source.js','baguette/gestures/wheel-gesture-source.js','sim-3d.js'])vm.runInNewContext(fs.readFileSync(path.join(web,file),'utf8'),context);
 const pieces=window.Baguette._ScreenPieces.fromMessage({pieces:[{corners:[[.1,.2],[.45,.25],[.45,.75],[.1,.8]],u:[0,.5],v:[0,1]},{corners:[[.45,.25],[.8,.3],[.8,.7],[.45,.75]],u:[.5,1],v:[0,1]}]});
 const panel=new window.Sim3DPanel();Object.assign(panel,{mode:'interact',screenQuad:pieces,deviceSize:{width:400,height:800},canvas:{width:1000,height:1000,hasAttribute:()=>true,getBoundingClientRect:()=>({left:10,top:20,width:1000,height:1000})}});
 let wheel,contacts;
 const screen={size:{width:400,height:800},touchDown(){},touchUp(){},touchMove(p){contacts=JSON.parse(JSON.stringify(p));}};
 new window.Baguette._WheelGestureSource(screen,{mapClientPoint:(x,y)=>panel.mapClientPoint(x,y),mapScreenPoint:(x,y)=>panel.mapScreenPoint(x,y)}).attach({getBoundingClientRect:()=>({left:0,top:0,width:1000,height:1000}),addEventListener(n,cb){if(n==='wheel')wheel=cb;}});
 const edge=panel.mapScreenPoint(0,400),send=deltaX=>wheel({clientX:edge.x,clientY:edge.y,deltaX,deltaY:0,preventDefault(){}});
 send(-60);const out=contacts[0].x;send(60);assert.ok(contacts[0].x<out,'reversal moves the fingers back at once');
});
