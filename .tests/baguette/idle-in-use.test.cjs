const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http'),net=require('node:net'),vm=require('node:vm');
const {createRuntime}=require('../../baguette-simulator/node/runtime.cjs');
const {externalUse,names}=require('../../baguette-simulator/node/activity.cjs');
const {createClipboard}=require('../../baguette-simulator/node/clipboard.cjs');
const udid='00000000-0000-4000-8000-000000000001';

async function fixture(t,{inUse=async()=>false,viewing=()=>false}={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'baguette-idle-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 let clock=0,state='Booted';const calls=[];
 const runtime=createRuntime({settingsFile:path.join(dir,'s.json'),now:()=>clock,inUse,viewing,holdMs:30000,holdPollMs:10000,
  sleep:async ms=>{clock+=ms;},
  dispatch:async(method,p={})=>{calls.push(method);if(method==='devices')return {devices:[{udid,state}]};if(method==='shutdown')state='Shutdown';return {ok:true};}});
 return {runtime,calls,advance:ms=>clock+=ms,state:()=>state,setState:s=>state=s};
}

test('an open window or an active script keeps the device past the idle limit; it stops once neither remains',async t=>{
 let using=true;const f=await fixture(t,{inUse:async()=>using});
 f.advance(16*60000);await f.runtime.checkIdle();
 assert.equal(f.state(),'Booted','in use at the deadline: not stopped');
 // Being in use starts a new idle period instead of stopping later on the same clock.
 using=false;f.advance(14*60000);await f.runtime.checkIdle();assert.equal(f.state(),'Booted');
 f.advance(2*60000);await f.runtime.checkIdle();assert.equal(f.state(),'Shutdown');
});

test('turning simulators off still stops devices that are in use',async t=>{
 const f=await fixture(t,{inUse:async()=>true});
 await f.runtime.request('settings_save',{enabled:false,idleMinutes:15});
 assert.equal(f.state(),'Shutdown');
});

test('a watched screen has no shutdown countdown before or after the idle deadline',async t=>{
 let open=true;
 const f=await fixture(t,{viewing:()=>open});
 const {idleLeft}=require('../../baguette-simulator/node/control-model.js');
 // No touch input: enter the warning's final minute, then cross several idle periods.
 for(const elapsed of [14.5,1,16,16]){
  f.advance(elapsed*60000);
  const status=await f.runtime.status();
  assert.equal(status.idleDeadline,null,'watching must not advertise a shutdown deadline');
  assert.equal(idleLeft({...status,device:status.devices[0]},0),null);
  await f.runtime.checkIdle();
  assert.equal(f.state(),'Booted');
 }
 open=false;
 assert.equal(typeof (await f.runtime.status()).idleDeadline,'number');
 f.advance(16*60000);await f.runtime.checkIdle();
 assert.equal(f.state(),'Shutdown','normal idle cleanup still works after the viewer closes');
});

test('unknown external use defers idle shutdown until a later confirmed idle period, while manual stop still works',async t=>{
 let unavailable=true;
 const f=await fixture(t,{inUse:async()=>{if(unavailable)throw Error('ps timed out');return false;}});
 f.advance(16*60000);await f.runtime.checkIdle();assert.equal(f.state(),'Booted');
 unavailable=false;f.advance(14*60000);await f.runtime.checkIdle();assert.equal(f.state(),'Booted');
 f.advance(2*60000);await f.runtime.checkIdle();assert.equal(f.state(),'Shutdown');
 const manual=await fixture(t,{inUse:async()=>{throw Error('ps failed');}});
 await manual.runtime.request('settings_stop_all');assert.equal(manual.state(),'Shutdown');
});

test('device_hold waits while a device runs, returns as soon as none runs, and keeps going while a window is open',async t=>{
 const running=await fixture(t);
 assert.deepEqual(await running.runtime.request('device_hold'),{running:true},'held to the limit');
 const off=await fixture(t);off.setState('Shutdown');
 assert.deepEqual(await off.runtime.request('device_hold'),{running:false});
 const viewed=await fixture(t,{viewing:()=>true});viewed.setState('Shutdown');
 assert.deepEqual(await viewed.runtime.request('device_hold'),{running:true},'a window can start a device itself');
 // Holding never counts as use.
 const idle=await fixture(t);await idle.runtime.request('device_hold');idle.advance(15*60000);await idle.runtime.checkIdle();
 assert.equal(idle.state(),'Shutdown');
});

test('a script naming the device counts; simulator internals and this worker\'s own processes do not',async()=>{
 assert.equal(names(`simctl --set /x spawn ${udid} /bin/sleep 5`,udid),true);
 assert.equal(names(`xcodebuild test -destination platform=iOS Simulator,id=${udid}`,udid),true);
 assert.equal(names(`launchd_sim /Users/a/BaguetteCindy/devices/${udid}/data/var/run/launchd_bootstrap.plist`,udid),false);
 const ps=lines=>async()=>lines.join('\n');
 const worker=100;
 assert.deepEqual(await externalUse([udid],{self:worker,ps:ps([
  `100 1 Electron Helper --type=utility`,`101 100 Baguette serve --port 4000`,`102 101 simctl --set /x spawn ${udid} HingeControl monitor`,
  `200 1 launchd_sim /x/devices/${udid}/data/var/run/launchd_bootstrap.plist`])}),[],'own viewer helper and simulator internals');
 assert.deepEqual(await externalUse([udid],{self:worker,ps:ps([`100 1 worker`,`300 1 /bin/zsh run.sh`,`301 300 simctl io ${udid} screenshot a.png`])}),[udid]);
 assert.deepEqual(await externalUse([],{ps:async()=>{throw Error('not called');}}),[]);
});

test('the viewer server counts open windows by their live stream and forgets them when they close',async()=>{
 const upstream=http.createServer((_q,s)=>s.end());const upstreamSockets=new Set();
 upstream.on('upgrade',(_req,socket)=>{upstreamSockets.add(socket);socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');});
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const bridge=await createClipboard('http://127.0.0.1:1',async()=>{},{port:upstream.address().port,status:async()=>({})});bridge.devices.add(udid);
 const token=bridge.fragment.split('.')[1];
 const auth=await fetch(bridge.base+'/control-api',{method:'POST',headers:{Origin:bridge.base,'X-Cindy-Clipboard':token},body:JSON.stringify({action:'status',udid})});
 const cookie=auth.headers.get('set-cookie').split(';')[0];
 try{
  assert.equal(bridge.viewers(),0);
  const url=new URL(bridge.base);const s=net.connect(Number(url.port),'127.0.0.1');
  await new Promise(r=>s.on('connect',r));
  s.write(`GET /stream HTTP/1.1\r\nHost: ${url.host}\r\nOrigin: ${bridge.base}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nCookie: ${cookie}\r\n\r\n`);
  await new Promise(r=>s.once('data',r));
  assert.equal(bridge.viewers(),1);
  s.destroy();
  for(let i=0;i<50&&bridge.viewers()>0;i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(bridge.viewers(),0);
 }finally{bridge.close();for(const socket of upstreamSockets)socket.destroy();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));}
});

test('the logic page keeps one hold in flight while devices run and stops when none does',async()=>{
 const code=await fs.readFile('baguette-simulator/main.js','utf8');
 let handler;const holds=[];const answers=[true,true,false];
 vm.runInNewContext(code,{Object,String,Promise,setTimeout,cindy:{onHostMessage:fn=>handler=fn,request:async()=>({ok:true,context:{locale:'en'}}),
  preview:async()=>({ok:true}),send:async()=>{},
  node:{request:async r=>{if(r.method==='device_hold'){holds.push(r);return {ok:true,result:{running:await answers.shift()}};}return {ok:true,result:{ok:true,execution:'executed'}};}}}});
 await handler({type:'tool-call',tool:'boot',callId:'c',args:{udid}});
 await new Promise(r=>setTimeout(r,20));
 assert.equal(holds.length,3,'re-issued while running, ended when no device runs');
 assert.ok(holds.every(h=>h.timeoutMs<120000),'within the host request ceiling');
 // A second tool call while a hold is in flight does not start another loop.
 let release;answers.push(new Promise(r=>release=r),false);
 await handler({type:'tool-call',tool:'devices',callId:'d',args:{}});
 await handler({type:'tool-call',tool:'devices',callId:'e',args:{}});
 await new Promise(r=>setTimeout(r,20));
 assert.equal(holds.length,4,'only the first call started a hold');
 release(true);await new Promise(r=>setTimeout(r,20));
 assert.equal(holds.length,5,'the same loop re-issued once, then ended');
});

test('an open page without a stream prevents idle shutdown, including during status errors',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'baguette-viewing-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 let clock=120000,failStatus=false;
 const context={module:{exports:{}},process,Date:class extends Date{static now(){return clock;}},require:name=>require(name.startsWith('./')?path.resolve('baguette-simulator/node',name):name)};
 vm.runInNewContext(await fs.readFile('baguette-simulator/node/viewer.cjs','utf8')+'\nmodule.exports.bridgeForTest=initializeBridge;',context);
 const viewer=context.module.exports;
 const f=await fixture(t,{inUse:async()=>viewer.viewing(),viewing:()=>viewer.viewing()});
 viewer.configureControls({status:async()=>{if(failStatus)throw Error('temporarily unavailable');return f.runtime.status();}});
 const server={base:'http://127.0.0.1:1',port:1};
 t.after(()=>server.clipboard?.close());
 await viewer.bridgeForTest(server,path.join(dir,'devices'),async()=>{});
 const bridge=server.clipboard;bridge.devices.add(udid);
 const poll=token=>fetch(bridge.base+'/control-api',{method:'POST',headers:{Origin:bridge.base,'X-Cindy-Clipboard':token},body:JSON.stringify({action:'status',udid})});
 assert.equal(bridge.viewers(),0,'no video stream');
 assert.equal((await poll('invalid')).status,403);
 assert.equal(viewer.viewing(),false,'unauthenticated requests do not count');
 const token=bridge.fragment.split('.')[1];
 for(const unavailable of [false,true]){
  failStatus=unavailable;clock+=16*60000;
  const response=await poll(token);
  assert.equal(response.status,unavailable?503:200);
  if(!unavailable)assert.equal((await response.json()).idleDeadline,null,'authenticated viewer status suppresses the countdown');
  f.advance(16*60000);await f.runtime.checkIdle();
  assert.equal(f.state(),'Booted','an open page protects the device');
 }
 clock+=viewer.VIEWER_GRACE_MS+1;
 f.advance(16*60000);await f.runtime.checkIdle();
 assert.equal(f.state(),'Shutdown','closing the page lets normal idle shutdown resume');
});
