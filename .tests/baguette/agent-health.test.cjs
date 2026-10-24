const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),syncFs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),http=require('node:http');
const {createRuntime}=require('../../cindy-simulator/node/runtime.cjs');
const {createTaskBindings}=require('../../cindy-simulator/node/tasks.cjs');
const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function fixture(t,extra={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'bag-health-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 let clock=0;const calls=[],tasks=createTaskBindings(path.join(root,'tasks.json'));
 const runtime=createRuntime({tasks,settingsFile:path.join(root,'settings.json'),now:()=>clock,sleep:async ms=>{clock+=ms;},
  dispatch:async(method,p={})=>{calls.push({method,...p});if(method==='devices')return {devices:[A,B].map(udid=>({udid,state:'Booted'}))};return {ok:true,execution:'executed',udid:p.udid};},...extra});
 return {root,tasks,runtime,calls,advance:ms=>clock+=ms};
}

// Historical viewer failures: a healthy long-running server had already lost
// its startup marker from the 4 KB log tail. Exercise the shipped ready code.
test('healthy HTTP service is reusable after the listening log scrolls away',async t=>{
 let probes=0;
 const server=http.createServer((req,res)=>{probes++;assert.equal(req.url,'/simulators');res.end('[]');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const file=path.resolve('cindy-simulator/node/viewer.cjs');
 const context={module:{exports:{}},require:require('node:module').createRequire(file),process,Buffer,setTimeout,clearTimeout,Date};
 vm.runInNewContext(syncFs.readFileSync(file,'utf8')+'\nmodule.exports.readyForTest=ready;',context);
 const current={child:{exitCode:null,signalCode:null},log:'[baguette] start: format=avcc\n'.repeat(180).slice(-4000),base:`http://127.0.0.1:${server.address().port}`};
 await context.module.exports.readyForTest(current);
 assert.equal(probes,1);
 current.stopped=true;await assert.rejects(context.module.exports.readyForTest(current),/stopped/);
});

test('another device can launch during installation; same-device conflict names the install job',async t=>{
 const install=deferred(),started=deferred();let writing=true;const calls=[];
 const f=await fixture(t,{pendingOperation:id=>writing&&id===A?install.promise:null,pendingJob:id=>writing&&id===A?{id:'install-1'}:null,
  dispatch:async(method,p)=>{calls.push({method,...p});if(method==='app_install'){started.resolve();return {ok:true,state:'running',job:'install-1'};}return {ok:true};}});
 await f.runtime.request('app',{action:'install',udid:A,session_context:{session_id:'old-hud-task'}});await started.promise;
 await f.runtime.request('app',{action:'launch',udid:B,bundleId:'test.example.b'});
 await assert.rejects(f.runtime.request('app',{action:'launch',udid:A,bundleId:'test.example.a'}),e=>{
  assert.equal(e.execution,'not_executed');assert.equal(e.busy.udid,A);assert.equal(e.busy.operation,'app_install');assert.equal(e.busy.job,'install-1');
  assert.match(e.message,/install_status/);return e.code==='BUSY';
 });
 assert.equal(calls.filter(c=>c.method==='launch_app').length,1);
 writing=false;install.resolve();await install.promise;await new Promise(r=>setImmediate(r));
 await f.runtime.request('app',{action:'launch',udid:A,bundleId:'test.example.a'});
 assert.equal(calls.filter(c=>c.method==='launch_app').length,2);
});

test('brief contention waits once before executing; ambiguous failures are never replayed',async t=>{
 const held=deferred(),began=deferred();let taps=0,waits=0;
 const error=Object.assign(Error('delivery unknown'),{code:'COMMAND_FAILED',execution:'unknown'});
 const f=await fixture(t,{sleep:async()=>{waits++;held.resolve();await new Promise(r=>setImmediate(r));},
  dispatch:async(method)=>{if(method==='tap'){if(++taps===1){began.resolve();await held.promise;}else throw error;}return {ok:true};}});
 const first=f.runtime.request('tap',{udid:A});await began.promise;
 await assert.rejects(f.runtime.request('tap',{udid:A}),e=>e===error);await first;
 assert.equal(taps,2);assert.equal(waits,1);
});

test('global stop remains exclusive and a failed command releases its device lock',async t=>{
 const held=deferred(),began=deferred();let fail=true;
 const f=await fixture(t,{dispatch:async(method)=>{if(method==='tap'){began.resolve();await held.promise;if(fail)throw Error('failed');}return {ok:true};}});
 const first=f.runtime.request('tap',{udid:A});const rejected=assert.rejects(first,/failed/);await began.promise;
 await assert.rejects(f.runtime.request('settings_stop_all'),e=>e.code==='BUSY');
 held.resolve();await rejected;fail=false;await f.runtime.request('tap',{udid:A});
});

test('simultaneous launch completions preserve every App record',async t=>{
 const held=deferred();let count=0;
 const f=await fixture(t,{dispatch:async()=>{if(++count===2)held.resolve();await held.promise;return {ok:true};}});
 await Promise.all([A,B].map((udid,i)=>f.runtime.request('launch_app',{udid,bundleId:'test.example.app'+i})));
 const disk=JSON.parse(await fs.readFile(path.join(f.root,'settings.json.apps.json')));
 assert.equal(disk[A],'test.example.app0');assert.equal(disk[B],'test.example.app1');
});

test('switching the selected device does not erase activity on the previous one',async t=>{
 const f=await fixture(t),session_context={session_id:'old-ui-audit-task'};
 await f.runtime.request('boot',{udid:A,session_context});
 await f.runtime.request('boot',{udid:B,session_context});
 const selected=await f.tasks.get(session_context.session_id);assert.equal(selected.udid,B);
 const devices=(await f.runtime.request('devices',{session_context:{session_id:'old-joystick-task'}})).devices;
 assert.equal(devices[0].tasks,0,'selection count is not an occupancy claim');
 assert.ok(devices.every(d=>d.activeTasks===1&&d.usage==='active'));
 assert.ok(devices.every(d=>d.thisTaskActive===false));
 f.advance(15*60000);
 assert.ok((await f.runtime.request('devices')).devices.every(d=>d.usage==='unknown'&&d.activeTasks===0));
});

test('script activity renews use and release affects only the calling task, without device mutations',async t=>{
 const f=await fixture(t);
 const action=(verb,session)=>f.runtime.request('device',{action:verb,udid:A,session_context:{session_id:session}});
 await action('activity','script-1');await action('activity','script-2');
 assert.equal(f.tasks.usage(A,'script-1',0).activeTasks,2);
 await action('release','script-1');assert.equal(f.tasks.usage(A,'script-2',0).activeTasks,1);
 f.advance(14*60000);await action('activity','script-2');f.advance(2*60000);await f.runtime.checkIdle();
 assert.ok(!f.calls.some(c=>c.method==='shutdown'));
 await action('release','script-2');assert.equal(f.tasks.hasActivity(16*60000),false);
 assert.ok(f.calls.every(c=>c.method==='devices'));
 await assert.rejects(f.runtime.request('device',{action:'activity',udid:A}),e=>e.code==='INVALID_ARGUMENT');
 await assert.rejects(f.runtime.request('device',{action:'activity',udid:'foreign',session_context:{session_id:'script-1'}}),e=>e.code==='DEVICE_NOT_OWNED');
 const restarted=createTaskBindings(path.join(f.root,'tasks.json'));assert.equal(restarted.usage(A,'script-2').activeTasks,0);
});

test('long reads stop fifteen minutes after completion instead of adding a second idle period',async t=>{
 for(const method of ['wait_for','describe_ui','logs','app_info','screenshot']){
  let state='Booted';
  const f=await fixture(t,{dispatch:async(name,p={})=>{
   if(name==='devices')return {devices:[{udid:A,state}]};
   if(name==='shutdown')state='Shutdown';
   if(name===method)f.advance(90000);
   return {ok:true};
  }});
  await f.runtime.request(method,{udid:A,session_context:{session_id:'long-read'}});
  assert.equal((await f.runtime.status()).idleDeadline,90000+15*60000,method);
  f.advance(15*60000-1);await f.runtime.checkIdle();assert.equal(state,'Booted',method);
  f.advance(1);await f.runtime.checkIdle();assert.equal(state,'Shutdown',method);
 }
});

test('activity and release accept lowercase UDIDs and return canonical device identity',async t=>{
 const id='ABCDEFAB-1234-4ABC-8ABC-ABCDEFABCDEF';
 const f=await fixture(t,{dispatch:async()=>({devices:[{udid:id,state:'Booted'}]})});
 const session_context={session_id:'lowercase-device'};
 for(const action of ['activity','release']){
  const result=await f.runtime.request('device',{action,udid:id.toLowerCase(),session_context});
  assert.equal(result.udid,id);assert.equal(result.thisTaskActive,action==='activity');
 }
});
