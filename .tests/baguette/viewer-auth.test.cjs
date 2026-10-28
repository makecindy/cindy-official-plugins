const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),net=require('node:net');
const {createClipboard}=require('../../baguette-simulator/node/clipboard.cjs');
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
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../../baguette-simulator/node/viewer-stage.js'),'utf8'),context);
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
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../../baguette-simulator/node/viewer-stage.js'),'utf8'),vm.createContext({window,document,location:{href:'http://127.0.0.1:5/simulators/x?handheld=1',host:'127.0.0.1:5'},getComputedStyle:()=>({getPropertyValue:()=>''}),Promise,URL,JSON}));
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
