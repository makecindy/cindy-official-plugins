const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),net=require('node:net');
const {createClipboard}=require('../../cindy-simulator/node/clipboard.cjs');
const udid='00000000-0000-4000-8000-000000000001';
test('an accepted restart completes after its requesting viewer disconnects',async()=>{
 let begin,finish,complete;const entered=new Promise(r=>begin=r),held=new Promise(r=>finish=r),completed=new Promise(r=>complete=r),calls=[];
 const bridge=await createClipboard('http://127.0.0.1:1',async()=>{}, {port:1,restart_device:async p=>{calls.push(p);begin();await held;complete();return {ok:true,memoryMode:{mode:p.memoryMode,verified:true}};}});bridge.devices.add(udid);
 const abort=new AbortController();
 try{
  const pending=fetch(bridge.base+'/control-api',{method:'POST',headers:{Origin:bridge.base,'X-Cindy-Clipboard':bridge.fragment.split('.')[1]},body:JSON.stringify({action:'restart_device',udid,memoryMode:'standard'}),signal:abort.signal}).catch(e=>e);
  await entered;abort.abort();await pending;finish();await completed;
  assert.equal(calls.length,1);assert.equal(calls[0].memoryMode,'standard');assert.equal(calls[0].udid,udid);
 }finally{finish();bridge.close();}
});
test('viewer HTTP and WebSocket require authenticated capability session',async()=>{
 let reads=0,upgrades=0;
 const upstream=http.createServer((req,res)=>{reads++;assert.equal(req.headers.cookie,undefined);res.end('viewer');});
 upstream.on('upgrade',(req,socket)=>{upgrades++;socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');});
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const bridge=await createClipboard('http://127.0.0.1:'+upstream.address().port,async()=>{}, {port:upstream.address().port,status:async()=>({ready:true})});bridge.devices.add(udid);
 try {
  assert.equal((await fetch(bridge.base+'/simulators/'+udid)).status,403);assert.equal(reads,0);
  const token=bridge.fragment.split('.')[1];
  const auth=await fetch(bridge.base+'/control-api',{method:'POST',headers:{Origin:bridge.base,'X-Cindy-Clipboard':token},body:JSON.stringify({action:'status',udid})});
  const cookie=auth.headers.get('set-cookie').split(';')[0];assert.match(auth.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  assert.equal((await fetch(bridge.base+'/simulators/'+udid,{headers:{Cookie:cookie}})).status,200);assert.equal(reads,1);
  async function ws(cookie){return new Promise((resolve,reject)=>{const url=new URL(bridge.base);const s=net.connect(Number(url.port),'127.0.0.1');let data='';s.on('connect',()=>s.write(`GET /stream HTTP/1.1\r\nHost: ${url.host}\r\nOrigin: ${bridge.base}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n${cookie?'Cookie: '+cookie+'\r\n':''}\r\n`));s.on('data',d=>{data+=d;s.destroy();});s.on('error',reject);s.on('close',()=>resolve(data));});}
  assert.equal(await ws(''), '');assert.equal(upgrades,0);
  assert.match(await ws(cookie),/101/);assert.equal(upgrades,1);
 } finally {bridge.close();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));}
});

test('shutdown requires the viewer origin, capability and an opened device; failure is not a success response',async()=>{
 let stops=0;
 const bridge=await createClipboard('http://127.0.0.1:1',async()=>{}, {port:1,shutdown:async()=>{stops++;return {ok:false,errorCode:'STOP_INCOMPLETE',execution:'unknown'};}});
 bridge.devices.add(udid);
 const token=bridge.fragment.split('.')[1];
 const request=(origin,key,device)=>fetch(bridge.base+'/control-api',{method:'POST',headers:{Origin:origin,'X-Cindy-Clipboard':key},body:JSON.stringify({action:'shutdown',udid:device})});
 try {
  assert.equal((await request('https://example.test',token,udid)).status,403);
  assert.equal((await request(bridge.base,'wrong',udid)).status,403);
  assert.equal((await request(bridge.base,token,'00000000-0000-4000-8000-000000000002')).status,400);
  assert.equal(stops,0);
  const result=await request(bridge.base,token,udid);assert.equal(result.status,409);assert.equal((await result.json()).execution,'unknown');assert.equal(stops,1);
 }finally{bridge.close();}
});

test('WebSocket keepalive traffic does not renew idle; authenticated user activity does',async()=>{
 let touches=0,received,upstreamSocket;
 const forwarded=new Promise(resolve=>received=resolve);
 const upstream=http.createServer();
 upstream.on('upgrade',(req,socket)=>{
  upstreamSocket=socket;
  socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
  socket.once('data',data=>received(data));
 });
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const bridge=await createClipboard('http://127.0.0.1:'+upstream.address().port,async()=>{}, {
  port:upstream.address().port,status:async()=>({ready:true}),touch:()=>touches++,activity:async()=>{touches++;return {ok:true};}
 });
 bridge.devices.add(udid);
 let socket;
 try{
  const headers={Origin:bridge.base,'X-Cindy-Clipboard':bridge.fragment.split('.')[1]};
  const auth=await fetch(bridge.base+'/control-api',{method:'POST',headers,body:JSON.stringify({action:'status',udid})});
  const cookie=auth.headers.get('set-cookie').split(';')[0],url=new URL(bridge.base);
  socket=net.connect(Number(url.port),'127.0.0.1');
  await new Promise((resolve,reject)=>{
   socket.on('error',reject);socket.once('data',()=>resolve());
   socket.on('connect',()=>socket.write(`GET /stream HTTP/1.1\r\nHost: ${url.host}\r\nOrigin: ${bridge.base}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nCookie: ${cookie}\r\n\r\n`));
  });
  const pong=Buffer.from([0x8a,0x80,1,2,3,4]);socket.write(pong);
  assert.deepEqual(await forwarded,pong);assert.equal(touches,0);
  assert.equal((await fetch(bridge.base+'/control-api',{method:'POST',headers,body:JSON.stringify({action:'activity',udid})})).status,200);
  assert.equal(touches,1);
 }finally{socket?.destroy();bridge.close();upstreamSocket?.destroy();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));}
});

test('create, rename, switch, trackpad and viewport retain origin, capability and opened-device authentication',async()=>{
 let mutations=0;const run=async()=>{mutations++;return {ok:true};};
 const bridge=await createClipboard('http://127.0.0.1:1',async()=>{}, {port:1,create:run,rename:run,switch:run,trackpad:run,viewport:run,restart_device:run});bridge.devices.add(udid);
 try{
  const token=bridge.fragment.split('.')[1];
  for(const action of ['create','rename','switch','trackpad','viewport','restart_device']){
   const request=(origin,key,id)=>fetch(bridge.base+'/control-api',{method:'POST',headers:{Origin:origin,'X-Cindy-Clipboard':key},body:JSON.stringify({action,udid:id,targetUdid:'foreign',name:'Test'})});
   assert.equal((await request('https://example.test',token,udid)).status,403);assert.equal((await request(bridge.base,'invalid',udid)).status,403);assert.equal((await request(bridge.base,token,'foreign')).status,400);
  }
  assert.equal(mutations,0);
 }finally{bridge.close();}
});

test('the embedded frame authorizes by capability in its own URL and Referer, never by origin alone',async()=>{
 let reads=0,upgrades=0;
 const upstream=http.createServer((req,res)=>{reads++;res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<html><head></head><body>viewer</body></html>');});
 upstream.on('upgrade',(req,socket)=>{upgrades++;socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');});
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const bridge=await createClipboard('http://127.0.0.1:'+upstream.address().port,async()=>{}, {port:upstream.address().port,status:async()=>({ready:true})});bridge.devices.add(udid);
 const token=bridge.fragment.split('.')[1];
 const page=`${bridge.base}/simulators/${udid}?handheld=1&cindyViewer=${token}`;
 try {
  // The device page itself: capability in the URL stands in for the cookie the
  // panel frame cannot hold; the host staging and the socket helper come with it.
  const framed=await fetch(page);
  assert.equal(framed.status,200);assert.equal(reads,1);
  assert.equal(framed.headers.get('referrer-policy'),'same-origin');
  const body=await framed.text();
  assert.ok(body.includes(`<script src="/viewer-auth.js?cindyViewer=${token}"></script>`),'the frame gets the socket capability helper');
  assert.ok(body.indexOf('<script src="/viewer-stage.js"></script>')>=0&&body.indexOf('<script src="/viewer-stage.js"></script>')<body.indexOf('</head>'),'the stage helper runs before the page scripts');
  const full=await fetch(page+'&cindyFull=1'),fullBody=await full.text();
  assert.equal(full.status,200);assert.ok(fullBody.includes(`/viewer-auth.js?cindyViewer=${token}`));
  assert.ok(!fullBody.includes('/viewer-stage.js')&&!fullBody.includes('cindy-stage-style'),'advanced tools retain authentication without replacing upstream chrome');
  // Subresources of that page carry the capability in Referer.
  assert.equal((await fetch(bridge.base+'/assets/app.js',{headers:{Referer:page}})).status,200);
  assert.equal((await fetch(bridge.base+'/viewer-auth.js?cindyViewer='+token)).status,200);
  assert.equal((await fetch(bridge.base+'/viewer-stage.js')).status,200);
  // No capability anywhere: still refused, and nothing reaches the simulator.
  const before=reads;
  assert.equal((await fetch(bridge.base+'/simulators/'+udid+'?handheld=1')).status,403);
  assert.equal((await fetch(bridge.base+'/simulators/'+udid+'?cindyViewer=wrong')).status,403);
  assert.equal((await fetch(bridge.base+'/assets/app.js',{headers:{Referer:bridge.base+'/simulators/x?cindyViewer=wrong'}})).status,403);
  // A Referer from somewhere else cannot smuggle the capability in.
  assert.equal((await fetch(bridge.base+'/assets/app.js',{headers:{Referer:'https://evil.test/?cindyViewer='+token}})).status,403);
  assert.equal(reads,before);
  // The stream socket presents the capability in its URL (viewer-auth.js adds it).
  const ws=(query)=>new Promise((resolve,reject)=>{const url=new URL(bridge.base);const s=net.connect(Number(url.port),'127.0.0.1');let data='';
   s.on('connect',()=>s.write(`GET /stream${query} HTTP/1.1\r\nHost: ${url.host}\r\nOrigin: ${bridge.base}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`));
   s.on('data',d=>{data+=d;s.destroy();});s.on('error',reject);s.on('close',()=>resolve(data));});
  assert.equal(await ws('?cindyViewer=wrong'),'');assert.equal(upgrades,0);
  assert.match(await ws('?cindyViewer='+token),/101/);assert.equal(upgrades,1);
 } finally {bridge.close();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));}
});

test('the 3D stage backdrop follows a light/dark change that arrives after it attached',async()=>{
 // Real case: the stage attached while the nested frame still read light, then
 // stayed a white square in dark Cindy because upstream never re-reads the mode.
 const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
 let pageBg='#f8f8f6';const listeners=[];
 const window={matchMedia:()=>({matches:false,addEventListener:(type,fn)=>listeners.push(fn)})};
 const document={getElementById:id=>id==='simNativeView'?{}:null,addEventListener(){},visibilityState:'visible'};
 const context=vm.createContext({window,document,getComputedStyle:()=>({getPropertyValue:()=>pageBg}),Promise});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../../cindy-simulator/node/viewer-stage.js'),'utf8'),context);
 // The upstream class is defined after the helper, as sim-3d.js loads later.
 const sent=[];
 function Sim3DPanel(){}
 Sim3DPanel.prototype.attach=async function(){};
 Sim3DPanel.prototype.detach=function(){};
 Sim3DPanel.prototype.setBackground=function(value){sent.push(value);};
 window.Sim3DPanel=Sim3DPanel;
 const panel=new window.Sim3DPanel();
 await panel.attach();await new Promise(r=>setImmediate(r));
 assert.deepEqual(sent,['#f8f8f6']);
 pageBg='#1f1f1e';listeners.forEach(fn=>fn());
 assert.deepEqual(sent,['#f8f8f6','#1f1f1e']);
 panel.detach();pageBg='#f8f8f6';listeners.forEach(fn=>fn());
 assert.equal(sent.length,2,'a detached stage is left alone');
});

test('a hidden viewer throttles its stream sockets and restores them when shown again',()=>{
 // Real case: a simulator tab behind another sidebar tab (or a covered window)
 // kept Baguette capturing and rendering 3D at full rate, ~11% CPU for nothing.
 const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
 const sockets=[];
 class FakeSocket{constructor(url){this.url=url;this.readyState=0;this.sent=[];this.listeners={};sockets.push(this);}addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}send(data){this.sent.push(JSON.parse(data).fps);}fire(type){if(type==='open')this.readyState=1;for(const fn of this.listeners[type]??[])fn();}}
 const docListeners=[];
 const document={visibilityState:'hidden',getElementById:()=>null,addEventListener:(type,fn)=>{if(type==='visibilitychange')docListeners.push(fn);}};
 const window={WebSocket:FakeSocket,matchMedia:()=>null};
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../../cindy-simulator/node/viewer-stage.js'),'utf8'),vm.createContext({window,document,location:{href:'http://127.0.0.1:5/simulators/x?handheld=1',host:'127.0.0.1:5'},getComputedStyle:()=>({getPropertyValue:()=>''}),Promise,URL,JSON}));
 const flat=new window.WebSocket('ws://127.0.0.1:5/simulators/'+udid+'/stream?format=avcc');
 const three=new window.WebSocket('/simulators/'+udid+'/stream.3d.avcc?width=960');
 const atomic=new window.WebSocket('/simulators/'+udid+'/stream.3d.avcc?frameMetadata=1');
 const logs=new window.WebSocket('/simulators/'+udid+'/logs');
 for(const socket of sockets)socket.fire('open');
 assert.deepEqual([flat.sent,three.sent],[[2],[2]],'opened while hidden: throttled at once');
 document.visibilityState='visible';docListeners.forEach(fn=>fn());
 assert.deepEqual([flat.sent,three.sent],[[2,60],[2,60]]);
 assert.deepEqual([atomic.sent,logs.sent],[[],[]],'atomic 3D frames and non-stream sockets are left alone');
 flat.fire('close');document.visibilityState='hidden';docListeners.forEach(fn=>fn());
 assert.deepEqual([flat.sent,three.sent],[[2,60],[2,60,2]],'a closed socket is forgotten');
});

test('3D view measurement excludes blank canvas margins and follows the lit pieces',async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
 const window={innerWidth:1000,innerHeight:1068,matchMedia:()=>null};
 const context=vm.createContext({window,document:{getElementById:()=>null,addEventListener(){}},Promise,getComputedStyle:()=>({getPropertyValue:()=>''})});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../../cindy-simulator/node/viewer-stage.js'),'utf8'),context);
 const web=path.join(__dirname,'../../cindy-simulator/vendor/baguette/Baguette_Baguette.bundle/Web');
 for(const file of ['screen-quad','screen-pieces'])vm.runInContext(fs.readFileSync(path.join(web,'baguette/gestures/'+file+'.js'),'utf8'),context);
 function Panel(){}
 Panel.prototype.attach=async function(){};Panel.prototype.setBackground=function(){};Panel.prototype.placePosePicker=function(){};Panel.prototype.detach=function(){};
 window.Sim3DPanel=Panel;
 const p=new window.Sim3DPanel();await p.attach();p.placePosePicker({hingeDegrees:180});
 p.canvas={width:1000,height:500,hasAttribute:()=>true,getBoundingClientRect:()=>({left:0,top:0,width:1000,height:1000})};
 p.screenQuad=window.Baguette._ScreenPieces.fromMessage({corners:[[.1,.1],[.9,.1],[.9,.9],[.1,.9]]});p.litPanel='primary';
 const view=window.__cindyView();assert.equal(view.width,800);assert.equal(view.height,400);
 assert.equal(view.fit.width,864);assert.equal(view.fit.height,464);assert.equal(view.fit.centerX,500);assert.equal(view.fit.centerY,500);
 p.cindyButtons=[{at:[.9,.5],control:[.98,.5]}];
 assert.equal(window.__cindyView().fit.width,912,'hardware anchors are included separately from fixed-size glyphs');
 p.cindyButtons=[];
 assert.equal(view.stageHeight,500,'letterboxing is excluded');assert.equal(view.insetY,68,'fixed toolbar is not part of the scaled content');
 p.canvas.width=2000;p.canvas.height=1000;assert.equal(window.__cindyView().width,800,'Retina backing density does not redefine 100%');
 p.litPanel='secondary';assert.equal(window.__cindyView().panel,'secondary');
 p.screenQuad=null;assert.equal(window.__cindyView(),null);p.detach();assert.equal(window.__cindyView(),null);
});

test('the first 3D frame waits for fitted layout and metadata/paint notify the controller immediately',async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
 let notifications=0,painted=false;const states=[],motions=[],attrs=new Set();
 const window={parent:{cindySim:{measure:async options=>{notifications++;motions.push(options.animate);}}},innerWidth:1000,innerHeight:1068,matchMedia:()=>null};
 const context=vm.createContext({window,document:{getElementById:()=>null,addEventListener(){}},Promise,getComputedStyle:()=>({getPropertyValue:()=>''})});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../../cindy-simulator/node/viewer-stage.js'),'utf8'),context);
 const web=path.join(__dirname,'../../cindy-simulator/vendor/baguette/Baguette_Baguette.bundle/Web');
 for(const file of ['screen-quad','screen-pieces'])vm.runInContext(fs.readFileSync(path.join(web,'baguette/gestures/'+file+'.js'),'utf8'),context);
 const stage={setAttribute:k=>attrs.add(k),removeAttribute:k=>attrs.delete(k)};
 const canvas={width:1000,height:500,hasAttribute:()=>painted,setAttribute:()=>{painted=true;},getBoundingClientRect:()=>({left:0,top:0,width:1000,height:1000})};
 function Panel(){}
 Panel.prototype.attach=async function(){this.stage=stage;this.canvas=canvas;};
 Panel.prototype.setBackground=function(){};Panel.prototype.placePosePicker=function(){};Panel.prototype.detach=function(){};
 Panel.prototype.setState=function(message){states.push(message);if(!message)painted=true;};
 window.Sim3DPanel=Panel;
 const p=new Panel();await p.attach();
 assert.equal(attrs.has('data-cindy-layout-pending'),true);
 p.screenQuad=window.Baguette._ScreenPieces.fromMessage({corners:[[.1,.1],[.9,.1],[.9,.9],[.1,.9]]});
 p.placePosePicker({hingeDegrees:0});assert.equal(notifications,1,'metadata initiates calibration without a timer');
 assert.equal(window.__cindyView(),null,'the default canvas aspect is never treated as a decoded frame');
 window.__cindyLayoutReady();assert.equal(attrs.has('data-cindy-layout-pending'),true,'metadata without a paint cannot reveal');
 p.setState('',false);assert.equal(notifications,2,'first paint remeasures immediately');
 assert.ok(window.__cindyView());assert.deepEqual(states,[],'loading state survives while the decoded picture is fitted');
 p.setState('',false);assert.equal(notifications,2,'later paints do not flood geometry reads');
 p.setState('3D stream failed',false,true);assert.deepEqual(states,['3D stream failed'],'errors stay visible while waiting');
 window.__cindyLayoutReady();assert.equal(attrs.has('data-cindy-layout-pending'),false);assert.equal(states.at(-1),'');
 window.__cindyLayoutReady();assert.equal(states.length,2,'reveal is idempotent');
 assert.deepEqual(motions,[false,false],'initial layout is immediate, never eased from a miniature frame');
 p.placePosePicker({hingeDegrees:180});assert.equal(motions.at(-1),true,'subsequent pose metadata requests a smooth fit');
 p.detach();window.__cindyLayoutReady();assert.equal(states.length,2,'a detached panel cannot reveal');
});

test('3D starts at standard resolution and zoom, window size and DPR never reopen the stream',async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
 const web=path.join(__dirname,'../../cindy-simulator/vendor/baguette/Baguette_Baguette.bundle/Web');
 const timers=new Map(),observers=[],listeners=new Map(),requests=[];let next=0;
 const box={left:0,top:0,width:400,height:800};
 const window={devicePixelRatio:2,matchMedia:()=>null,
  addEventListener:(k,v)=>listeners.set(k,v),removeEventListener:(k,v)=>{if(listeners.get(k)===v)listeners.delete(k);}};
 const context=vm.createContext({window,document:{getElementById:()=>null,addEventListener(){}},Promise,URLSearchParams,
  location:{protocol:'http:',host:'example.test'},getComputedStyle:()=>({getPropertyValue:()=>''}),
  setTimeout:fn=>{timers.set(++next,fn);return next;},clearTimeout:id=>timers.delete(id),cancelAnimationFrame(){},
  ResizeObserver:class{constructor(fn){this.fn=fn;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../../cindy-simulator/node/viewer-stage.js'),'utf8'),context);
 vm.runInContext(fs.readFileSync(path.join(web,'baguette/gestures/screen-quad.js'),'utf8'),context);
 vm.runInContext(fs.readFileSync(path.join(web,'sim-3d.js'),'utf8'),context);
 const Panel=window.Sim3DPanel;
 window.StreamSession=function(options){this.opts=options;this.start=()=>requests.push(new URL(options.url));this.stop=()=>{};};
 let painted=false;const p=new Panel();p.stage={getBoundingClientRect:()=>box,querySelector:()=>null};p.canvas={width:300,height:150,hasAttribute:()=>painted,getBoundingClientRect:()=>box};p.model={};p.udid='phone';
 p.cancelPointer=()=>{};p.setState=()=>{};
 // attach uses the production async wrapper with a minimal DOM-independent
 // setup; start/outputSize/stop/scheduleRestart are the actual vendor methods.
 context.fetch=async()=>({ok:true,json:async()=>({variantSets:[]})});
 p.renderLoading=()=>{};p.renderControls=()=>{};p.mountStage=()=>{};
 await p.attach({},p.stage,'phone',{deviceSize:{width:1000,height:1600}});await Promise.resolve();
 const size=()=>[Number(requests.at(-1).searchParams.get('width')),Number(requests.at(-1).searchParams.get('height'))];
 assert.deepEqual(size(),[2560,4096],'even a small first window gets the standard high-resolution stream');
 const session=p.session;
 p.canvas.width=2560;p.canvas.height=4096;painted=true;
 for(const [width,height,dpr] of [[800,1600,2],[1600,3200,2],[250,400,1],[1200,600,3],[400,800,2]]){
  box.width=width;box.height=height;window.devicePixelRatio=dpr;
  for(const observer of observers)observer.fn();
  listeners.get('resize')?.();
  assert.deepEqual(JSON.parse(JSON.stringify(p.outputSize())),{width:2560,height:4096});
  assert.equal(p.session,session,'the live stream survives every layout change');
  assert.equal(timers.size,0,'zoom and resize schedule no reconnect');
 }
 assert.equal(observers.length,1,'only hardware-control layout is observed');assert.equal(listeners.has('resize'),false);assert.equal(requests.length,1);
 p.interactiveScreen=null;p.keyboard=null;p.host={innerHTML:''};p.stage.innerHTML='';
 p.detach();assert.equal(timers.size,0);assert.equal(observers[0].disconnected,true);

});

test('3D high-resolution playback avoids H.264 seed-only black screens and recovers failed startup once',async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
 const web=path.join(__dirname,'../../cindy-simulator/vendor/baguette/Baguette_Baguette.bundle/Web');
 const timers=new Map(),sessions=[];let next=0;
 const box={left:0,top:0,width:1280,height:2048};
 const window={devicePixelRatio:2,matchMedia:()=>null,addEventListener(){},removeEventListener(){}};
 const context=vm.createContext({window,document:{getElementById:()=>null,addEventListener(){}},Promise,URLSearchParams,
  location:{protocol:'http:',host:'example.test'},getComputedStyle:()=>({getPropertyValue:()=>''}),
  setTimeout:(fn,delay)=>{timers.set(++next,{fn,delay});return next;},clearTimeout:id=>timers.delete(id),cancelAnimationFrame(){},
  fetch:async()=>({ok:true,json:async()=>({variantSets:[]})})});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../../cindy-simulator/node/viewer-stage.js'),'utf8'),context);
 for(const file of ['baguette/gestures/screen-quad.js','sim-3d.js'])vm.runInContext(fs.readFileSync(path.join(web,file),'utf8'),context);
 window.StreamSession=function(opts){this.opts=opts;this.start=()=>sessions.push(this);this.stop=()=>{this.stopped=true;};};
 const p=new window.Sim3DPanel(),state={querySelector:()=>({}),toggleAttribute(){}};
 p.stage={getBoundingClientRect:()=>box,querySelector:()=>state};
 p.canvas={width:300,height:150,hasAttribute:()=>false,setAttribute(){},getBoundingClientRect:()=>box};
 p.cancelPointer=()=>{};p.renderLoading=()=>{};p.renderControls=()=>{};p.mountStage=()=>{};
 const flush=()=>{for(const [id,{fn}] of [...timers]){timers.delete(id);fn();}};
 await p.attach({},p.stage,'phone',{format:'avcc',deviceSize:{width:1280,height:2048}});await Promise.resolve();
 assert.equal(p.session.opts.format,'mjpeg');assert.match(p.session.opts.url,/stream\.3d\.mjpeg\?[^#]*width=2560&height=4096/);
 assert.equal(p.format,'avcc','fallback does not replace the preferred codec');
 p.session.opts.onPaint();assert.equal(timers.size,0,'MJPEG has no H.264 startup watchdog');
 p.deviceSize={width:512,height:1024};p.start();assert.equal(p.session.opts.format,'avcc');
 p.session.opts.onPaint();assert.equal([...timers.values()][0].delay,4000,'the JPEG seed alone is not playback success');
 p.session.opts.onPaint();assert.equal(timers.size,0,'the first video paint completes startup');
 p.start();const stale=p.session;p.session.opts.onPaint();const pending=[...timers.values()][0].fn;
 p.start();assert.equal(timers.size,0);pending();assert.equal(p.session.opts.format,'avcc','a retired stream cannot trigger fallback');
 stale.opts.onLog('decoder: late failure',true);assert.equal(timers.size,0,'generation rejects stale decoder errors');
 p.session.opts.onPaint();flush();assert.equal(p.session.opts.format,'mjpeg','seed-only startup recovers at the same resolution');
 assert.equal(p.cindyH264Failed,true);assert.equal(timers.size,0);p.start();assert.equal(p.session.opts.format,'mjpeg','resize does not retry the broken codec');
 p.cindyH264Failed=false;p.start();p.session.opts.onLog('decoder: Unsupported configuration',true);
 assert.equal([...timers.values()][0].delay,0,'decoder failures recover on the event without waiting for timeout');
 flush();assert.equal(p.session.opts.format,'mjpeg');assert.equal(timers.size,0);
 p.cindyH264Failed=false;p.start();p.session.opts.onPaint();const retired=[...timers.values()][0].fn;
 p.interactiveScreen=null;p.keyboard=null;p.host={innerHTML:''};p.stage.innerHTML='';
 p.detach();assert.equal(timers.size,0);const count=sessions.length;retired();assert.equal(sessions.length,count,'detached views never restart');
});
