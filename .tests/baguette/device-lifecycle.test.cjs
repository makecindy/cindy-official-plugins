'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createRuntime}=require('../../cindy-simulator/node/runtime.cjs');
const {createTaskBindings}=require('../../cindy-simulator/node/tasks.cjs');
const {createDeviceLifecycle,planReclamation,EXCESS_IDLE_MS,MAX_IDLE_MS}=require('../../cindy-simulator/node/device-lifecycle.cjs');
const HOUR=3600000;
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
async function setup(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sim-lifecycle-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const settingsFile=path.join(dir,'settings.json'),file=settingsFile+'.devices.json';
 let clock=1000000,watching=false,external=false,deleteError=false,partial=false,readsGate=null;
 const devices=[],calls=[],tasks=createTaskBindings(path.join(dir,'tasks.json'));
 const lifecycle=createDeviceLifecycle(file,()=>clock);
 const options={settingsFile,tasks,now:()=>clock,viewing:()=>watching,inUse:async()=>external,dispatch:async(method,p={})=>{
  calls.push({method,...p});
  if(method==='devices')return {devices:devices.map(d=>({...d}))};
  if(method==='create_device'){const d={udid:id(devices.length+1),name:p.name||'Test',state:'Shutdown',isAvailable:true,deviceType:p.deviceType,runtime:p.runtime};devices.push(d);return {...d,execution:'executed'};}
  if(method==='delete_device'){
   if(deleteError)throw Object.assign(Error('delete failed'),{code:'TEST_FAILURE',execution:'unknown'});
   if(partial)return {ok:false,outcome:'partial',execution:'unknown',deviceError:{code:'TEST_PARTIAL'}};
   devices.splice(devices.findIndex(d=>d.udid===p.udid),1);return {ok:true,udid:p.udid,execution:'executed'};
  }
  if(method==='wait_for'&&readsGate)await readsGate;
  if(method==='boot')devices.find(d=>d.udid===p.udid).state='Booted';
  if(method==='shutdown')devices.find(d=>d.udid===p.udid).state='Shutdown';
  return {ok:true,udid:p.udid};
 }};
 let runtime=createRuntime(options);
 return {devices,calls,lifecycle,file,tasks,get runtime(){return runtime;},time:()=>clock,advance:ms=>clock+=ms,
  restart:()=>runtime=createRuntime({...options,tasks:createTaskBindings(path.join(dir,'tasks.json'))}),
  watching:v=>watching=v,external:v=>external=v,fail:v=>deleteError=v,partial:v=>partial=v,gate:v=>readsGate=v,
  async create(n=1){for(let i=0;i<n;i++)await runtime.request('device',{action:'create',_agent:true,purpose:'UI coverage',isolationReason:'Independent fixture '+i,deviceType:'phone',runtime:'test-os',session_context:{session_id:'task-'+i}});},
  async idle(){clock+=16*60000;await runtime.checkReclamation();},
 };
}
test('Agent requests reuse; manual and legacy devices remain permanent; isolation must be explained',async t=>{
 const f=await setup(t);
 const p={name:'Manual',deviceType:'phone',runtime:'test-os'};
 const manual=await f.runtime.request('create_device',p);assert.equal(manual.retention,'permanent');
 const reused=await f.runtime.request('device',{action:'create',...p,_agent:true,purpose:'Test UI',session_context:{session_id:'one'}});
 assert.equal(reused.reused,true);assert.equal(reused.udid,manual.udid);assert.equal(f.devices.length,1);
 await assert.rejects(f.runtime.request('device',{action:'create',...p,_agent:true}),e=>e.code==='INVALID_ARGUMENT');
 await assert.rejects(f.runtime.request('device',{action:'create',...p,_agent:true,purpose:'Test',isolationReason:' '}),e=>e.code==='INVALID_ARGUMENT');
 const separate=await f.runtime.request('device',{action:'create',...p,_agent:true,purpose:'Login tests',isolationReason:'Requires empty login state'});
 assert.equal(separate.retention,'temporary');assert.equal(f.devices.length,2);
 f.devices.push({udid:id(9),name:'Legacy',state:'Shutdown'});
 const listed=await f.runtime.request('devices');assert.equal(listed.devices.find(d=>d.udid===id(9)).retention,'permanent');
 assert.equal(f.calls.some(c=>c.method==='erase_device'),false);
});
test('same task reuses its allocation; another task cannot reuse an active allocation',async t=>{
 const f=await setup(t),p={action:'create',_agent:true,purpose:'Test',deviceType:'phone',runtime:'test-os',session_context:{session_id:'one'}};
 const first=await f.runtime.request('device',p),again=await f.runtime.request('device',p);
 assert.equal(again.udid,first.udid);assert.equal(again.reused,true);
 const other=await f.runtime.request('device',{...p,session_context:{session_id:'two'}});
 assert.notEqual(other.udid,first.udid);
});
test('72h excess threshold and 7d retained threshold; no deletion before either boundary',async t=>{
 const f=await setup(t);await f.create(4);await f.idle();
 f.advance(EXCESS_IDLE_MS-1);await f.runtime.checkReclamation();assert.equal(f.devices.length,4);
 f.advance(1);await f.runtime.checkReclamation();assert.equal(f.devices.length,2);
 assert.equal((await f.runtime.request('devices')).reclamationHistory.filter(h=>h.outcome==='deleted').length,2);
 f.advance(MAX_IDLE_MS-EXCESS_IDLE_MS-1);await f.runtime.checkReclamation();assert.equal(f.devices.length,2);
 f.advance(1);await f.runtime.checkReclamation();assert.equal(f.devices.length,0);
});
test('retain protects a temporary device and physical devices are never reclaimable',async t=>{
 const f=await setup(t);await f.create();await f.runtime.request('device',{action:'retain',udid:id(1)});
 f.devices.push({udid:id(8),state:'Shutdown',kind:'physical'});
 await f.lifecycle.register(id(8),{temporary:true});await f.idle();f.advance(MAX_IDLE_MS);await f.runtime.checkReclamation();
 assert.equal(f.devices.length,2);
 await assert.rejects(f.runtime.request('device',{action:'retain',udid:id(8)}),e=>e.code==='DEVICE_NOT_OWNED');
});
test('worker restart preserves idle deadline and short usage lease',async t=>{
 const f=await setup(t);await f.create();await f.idle();const before=(await f.lifecycle.snapshot()).devices[id(1)].idleSince;
 f.restart();f.advance(5*24*HOUR);await f.runtime.checkReclamation();assert.equal((await f.lifecycle.snapshot()).devices[id(1)].idleSince,before);
 await f.runtime.request('screenshot',{udid:id(1)});f.restart();await f.runtime.checkReclamation();
 assert.equal((await f.lifecycle.snapshot()).devices[id(1)].idleSince,null);
 f.advance(16*60000);await f.runtime.checkReclamation();const after=(await f.lifecycle.snapshot()).devices[id(1)].idleSince;
 assert.equal(after,f.time());assert.ok(after>before);
});
test('running/unknown devices and active viewers protect devices and restart idle period',async t=>{
 const f=await setup(t);await f.create(3);await f.idle();f.advance(MAX_IDLE_MS);
 f.devices[0].state='Booted';f.devices[1].state='Unknown';f.watching(true);await f.runtime.checkReclamation();assert.equal(f.devices.length,3);
 f.watching(false);f.devices.forEach(d=>d.state='Shutdown');await f.runtime.checkReclamation();assert.equal(f.devices.length,3);
 assert.ok(Object.values((await f.lifecycle.snapshot()).devices).every(d=>d.idleSince===f.time()));
});
test('external use and explicit leases prevent collection; old task bindings alone do not',async t=>{
 const f=await setup(t);await f.create();await f.idle();f.advance(MAX_IDLE_MS);
 f.external(true);await f.runtime.checkReclamation();assert.equal(f.devices.length,1);f.external(false);
 await f.runtime.request('device',{action:'activity',udid:id(1),session_context:{session_id:'long-test'}});
 await f.runtime.checkReclamation();assert.equal(f.devices.length,1);
 await f.runtime.request('device',{action:'release',udid:id(1),session_context:{session_id:'long-test'}});
 await f.tasks.bind('old-task',id(1));f.advance(MAX_IDLE_MS);await f.runtime.checkReclamation();assert.equal(f.devices.length,0);
});
test('status and install polling do not refresh retention; waiting operation blocks GC',async t=>{
 const f=await setup(t);await f.create();await f.idle();const before=(await f.lifecycle.snapshot()).devices[id(1)];
 f.advance(MAX_IDLE_MS);await f.runtime.request('devices');await f.runtime.request('app',{action:'info',udid:id(1)});await f.runtime.request('app',{action:'install_status',udid:id(1)});
 assert.deepEqual((await f.lifecycle.snapshot()).devices[id(1)],before);
 let release;f.gate(new Promise(r=>release=r));const waiting=f.runtime.request('wait_for',{udid:id(1)});
 await new Promise(r=>setImmediate(r));await f.runtime.checkReclamation();assert.equal(f.devices.length,1);release();await waiting;
});
test('failed and partial deletion retain metadata, record outcome, and retry later',async t=>{
 for(const partial of [false,true]){
  const f=await setup(t);await f.create();await f.idle();f.advance(MAX_IDLE_MS);
  if(partial)f.partial(true);else f.fail(true);
  await f.runtime.checkReclamation();assert.equal(f.devices.length,1);
  let saved=await f.lifecycle.snapshot();assert.ok(saved.devices[id(1)]);assert.equal(saved.history.at(-1).outcome,'failed');
  f.fail(false);f.partial(false);await f.runtime.checkReclamation();assert.equal(f.devices.length,0);
 }
});
test('corrupt provenance blocks creation and GC without overwriting records; list still works',async t=>{
 const f=await setup(t);await f.create();await fs.writeFile(f.file,'broken');f.advance(MAX_IDLE_MS);
 await assert.rejects(f.runtime.checkReclamation(),e=>e.code==='LIFECYCLE_UNREADABLE');
 await assert.rejects(f.runtime.request('create_device',{_agent:true,purpose:'New test'}),e=>e.code==='LIFECYCLE_UNREADABLE');
 const listed=await f.runtime.request('devices');assert.equal(listed.devices[0].retention,'unknown');assert.equal(f.devices.length,1);assert.equal(await fs.readFile(f.file,'utf8'),'broken');
});
test('global collection lock rejects a racing boot and does not replay it',async t=>{
 const f=await setup(t);await f.create();await f.idle();f.advance(MAX_IDLE_MS);
 const gc=f.runtime.checkReclamation();await assert.rejects(f.runtime.request('boot',{udid:id(1)}),e=>e.code==='BUSY');await gc;
 assert.equal(f.calls.some(c=>c.method==='boot'),false);
});
test('reclamation ranks only idle temporary devices, preserving the two most recently used',()=>{
 const devices=[1,2,3,4].map(n=>({udid:id(n),state:'Shutdown'}));
 const records=Object.fromEntries(devices.map((d,i)=>[d.udid,{retention:i===3?'permanent':'temporary',idleSince:i*HOUR,leaseUntil:0}]));
 const plan=planReclamation(devices,records,10*HOUR);
 assert.deepEqual(plan.map(p=>[p.udid,p.reason]),[[id(3),'idle-7-days'],[id(2),'idle-7-days'],[id(1),'excess-idle-72-hours']]);
});
test('an overdue matching device is reused instead of deleted and recreated',async t=>{
 const f=await setup(t);await f.create();await f.idle();f.advance(MAX_IDLE_MS);
 const reused=await f.runtime.request('device',{action:'create',_agent:true,purpose:'Resume testing',deviceType:'phone',runtime:'test-os',session_context:{session_id:'new-task'}});
 assert.equal(reused.udid,id(1));assert.equal(reused.reused,true);assert.equal(f.calls.some(c=>c.method==='delete_device'),false);
});
test('a task reuses its own running device; paused plugin suppresses reclamation',async t=>{
 const f=await setup(t);await f.create();
 await f.runtime.request('boot',{udid:id(1),session_context:{session_id:'task-0'}});
 const reused=await f.runtime.request('device',{action:'create',_agent:true,purpose:'More UI tests',deviceType:'phone',runtime:'test-os',session_context:{session_id:'task-0'}});
 assert.equal(reused.reused,true);assert.equal(f.devices.length,1);
 await f.runtime.request('settings_save',{enabled:false,idleMinutes:15});
 await f.idle();f.advance(MAX_IDLE_MS);await f.runtime.checkReclamation();assert.equal(f.devices.length,1);
});
test('logic page stamps Agent provenance itself; user page creation cannot inherit it',async()=>{
 const vm=require('node:vm'),channels={},requests=[];let handler;
 class BroadcastChannel{constructor(name){channels[name]=this;}postMessage(){}}
 const cindy={onHostMessage:fn=>handler=fn,request:async()=>({context:{locale:'en'}}),send:async()=>{},
  node:{request:async request=>{requests.push(request);return {ok:true,result:{ok:true}};}}};
 vm.runInNewContext(await fs.readFile(path.join(__dirname,'../../cindy-simulator/main.js'),'utf8'),{cindy,BroadcastChannel,setTimeout,queueMicrotask});
 await handler({type:'tool-call',tool:'device',callId:'test',args:{action:'create',_agent:false,purpose:'Test'}});
 assert.equal(requests.find(r=>r.method==='device').params._agent,true);
 await channels['baguette-settings'].onmessage({data:{type:'request',id:'manual',action:'create',name:'User phone',deviceType:'phone',runtime:'test-os',_agent:true}});
 assert.equal(requests.find(r=>r.method==='create_device').params._agent,undefined);
});
test('post-delete bookkeeping errors preserve successful deletion in audit history',async t=>{
 const f=await setup(t);await f.create();await f.idle();f.advance(MAX_IDLE_MS);
 f.tasks.forgetDevice=async()=>{throw Object.assign(Error('storage failed'),{code:'TASK_BINDINGS_UNREADABLE'});};
 await f.runtime.checkReclamation();assert.equal(f.devices.length,0);
 const entry=(await f.lifecycle.snapshot()).history.at(-1);
 assert.equal(entry.outcome,'deleted');assert.equal(entry.execution,'executed');assert.equal(entry.taskBindingError.code,'TASK_BINDINGS_UNREADABLE');
});
