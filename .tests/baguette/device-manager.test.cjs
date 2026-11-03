const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createRuntime}=require('../../cindy-simulator/node/runtime.cjs');
const a='00000000-0000-4000-8000-00000000000A',b='00000000-0000-4000-8000-00000000000B';
async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'baguette-switch-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const devices=[{udid:a,name:'Duo',state:'Booted',isAvailable:true},{udid:b,name:'Phone',state:'Shutdown',isAvailable:true}],calls=[];
 let failAt,hold,bindStarted,clock=0,using=false;
 const bindings=new Map();
 const opts={settingsFile:path.join(dir,'settings.json'),now:()=>clock,inUse:async()=>using,tasks:{bind:async(s,id)=>{if(hold){bindStarted?.();await hold;}bindings.set(s,id);},forgetDevice:async id=>{for(const [s,device] of bindings)if(device===id)bindings.delete(s);}},dispatch:async(method,p={})=>{
  calls.push({method,...p});if(method==='devices')return {devices:devices.map(d=>({...d}))};
  if(method===failAt)throw Object.assign(Error('Fixture failure'),{code:'FIXTURE_ERROR',execution:'unknown'});
  if(method==='shutdown')devices.find(d=>d.udid===p.udid).state='Shutdown';
  if(method==='boot'){if(hold)await hold;devices.find(d=>d.udid===p.udid).state='Booted';}
  if(method==='app_bundle')return {appPath:'/private-fixture/Test.app'};
  if(method==='open_viewer')return {url:'http://127.0.0.1:1/control?udid='+p.udid};
  return {ok:true};
 }};
 const runtime=createRuntime(opts);
 return {runtime,devices,calls,bindings,file:opts.settingsFile+'.apps.json',restart:()=>createRuntime(opts),fail:m=>failAt=m,hold:p=>{hold=p;return new Promise(resolve=>bindStarted=resolve);},advance:ms=>clock+=ms,inUse:value=>using=value};
}
async function finish(f){for(let i=0;i<100;i++){const job=(await f.runtime.status()).deviceJob;if(job.state!=='running')return job;await new Promise(r=>setTimeout(r,2));}assert.fail('switch did not finish');}
test('recent App read failures never become empty records or allow a switch to mutate devices',async t=>{
 const original=JSON.stringify({[a.toLowerCase()]:'test.example.original',[b]:'test.example.other'});
 for(const broken of ['{','null','[]',JSON.stringify({[a]:null}),'directory']){
  const f=await fixture(t);
  if(broken==='directory'){await fs.mkdir(f.file);await fs.writeFile(path.join(f.file,'evidence'),original);}
  else await fs.writeFile(f.file,broken);
  // Launch succeeds, but its best-effort record update must preserve damaged storage.
  assert.equal((await f.runtime.request('launch_app',{udid:a,bundleId:'test.example.new'})).appContextError.code,'APP_CONTEXT_UNREADABLE');
  await assert.rejects(f.runtime.currentApp(a),e=>e.code==='APP_CONTEXT_UNREADABLE');
  f.calls.length=0;
  await f.runtime.request('viewer_switch',{udid:a,targetUdid:b});
  const job=await finish(f);assert.equal(job.state,'done');assert.equal(job.activeUdid,b);
  assert.ok(f.calls.every(c=>c.method==='devices'),'no app lookup, shutdown, boot, install, launch or viewer start');
  for(const method of ['app_uninstall','erase_device','delete_device']){
   const result=await f.runtime.request(method,{udid:a,bundleId:'test.example.original'});
   assert.equal(result.ok,true);assert.equal(result.appContextError.code,'APP_CONTEXT_UNSAVED','completed removal evidence is retained');
  }
  if(broken==='directory'){assert.equal(await fs.readFile(path.join(f.file,'evidence'),'utf8'),original);await fs.rm(f.file,{recursive:true});}
  else assert.equal(await fs.readFile(f.file,'utf8'),broken);
  assert.ok(!(await fs.readdir(path.dirname(f.file))).some(name=>name.endsWith('.tmp')));
  await fs.writeFile(f.file,original);
  assert.equal(await f.runtime.currentApp(a),'test.example.original','failure was not cached');
  await f.runtime.request('launch_app',{udid:a,bundleId:'test.example.new'});
  assert.equal(await f.restart().currentApp(a),'test.example.new');assert.equal(await f.restart().currentApp(b),'test.example.other');
 }
});
test('a failed recent App write leaves the previous in-memory and disk records intact',async t=>{
 const f=await fixture(t);await f.runtime.request('launch_app',{udid:a,bundleId:'test.example.original'});
 const original=await fs.readFile(f.file,'utf8'),backup=f.file+'.backup';
 await fs.rename(f.file,backup);await fs.mkdir(f.file);
 await f.runtime.request('launch_app',{udid:a,bundleId:'test.example.new'});
 assert.equal(await f.runtime.currentApp(a),'test.example.original','cache commits only after rename succeeds');
 assert.equal(await fs.readFile(backup,'utf8'),original);
 assert.ok(!(await fs.readdir(path.dirname(f.file))).some(name=>name.endsWith('.tmp')));
 await fs.rm(f.file,{recursive:true});await fs.rename(backup,f.file);
 await f.runtime.request('launch_app',{udid:a,bundleId:'test.example.new'});
 assert.equal(await f.runtime.currentApp(a),'test.example.new');assert.equal(await f.restart().currentApp(a),'test.example.new');
});
test('successful uninstall, erase and delete clear only the affected recent app; failures retain it',async t=>{
 for(const method of ['app_uninstall','erase_device','delete_device']) {
  const f=await fixture(t);
  await f.runtime.request('launch_app',{udid:a,bundleId:'test.example.app'});
  await f.runtime.request('launch_app',{udid:b,bundleId:'test.example.other'});
  if(method==='app_uninstall') {
   await f.runtime.request(method,{udid:a,bundleId:'test.example.unrelated'});
   assert.equal(await f.runtime.currentApp(a),'test.example.app');
  }
  f.fail(method);
  await assert.rejects(f.runtime.request(method,{udid:a,bundleId:'test.example.app'}));
  assert.equal(await f.restart().currentApp(a),'test.example.app');
  f.fail(null);await f.runtime.request(method,{udid:a.toLowerCase(),bundleId:'test.example.app'});
  f.runtime=f.restart();
  assert.equal(await f.runtime.currentApp(a),null);assert.equal(await f.runtime.currentApp(b),'test.example.other');
  if(method!=='delete_device') {
   f.calls.length=0;
   await f.runtime.request('viewer_switch',{udid:a,targetUdid:b});assert.equal((await finish(f)).state,'done');
   assert.ok(!f.calls.some(c=>['app_bundle','install_app','launch_app'].includes(c.method)),'removed app never blocks or participates in the switch');
  }
 }
});
test('switch preserves each device and app context without starting, stopping or copying apps',async t=>{
 const f=await fixture(t);await f.runtime.request('launch_app',{udid:a,bundleId:'test.example.app'});f.runtime=f.restart();
 f.calls.length=0;
 await f.runtime.request('viewer_switch',{udid:a,targetUdid:b});const job=await finish(f);assert.equal(job.state,'done');assert.equal(job.activeUdid,b);
 assert.ok(f.calls.every(c=>c.method==='devices'));
 assert.equal(await f.restart().currentApp(b),null);assert.equal(await f.restart().currentApp(a),'test.example.app');
 assert.deepEqual(f.devices.map(d=>d.state),['Booted','Shutdown']);
});
test('switch source and target use the same identity as task binding and recent apps',async t=>{
 const f=await fixture(t);
 await f.runtime.request('launch_app',{udid:a.toLowerCase(),bundleId:'test.example.app',session_context:{session_id:'case-task'}});
 await f.runtime.request('viewer_switch',{udid:a.toLowerCase(),targetUdid:b.toLowerCase(),task:'case-task'});
 const job=await finish(f);assert.equal(job.state,'done');assert.equal(job.activeUdid,b);
 assert.equal(f.bindings.get('case-task'),b);assert.equal(await f.restart().currentApp(b.toLowerCase()),null);
 assert.ok(f.calls.filter(c=>c.udid).every(c=>[a,b].includes(c.udid)));
});

test('foreign/unavailable targets and paused runtime never start a switch',async t=>{
 const f=await fixture(t);await assert.rejects(f.runtime.request('viewer_switch',{udid:a,targetUdid:'foreign'}),e=>e.code==='DEVICE_NOT_OWNED');
 f.devices[1].isAvailable=false;await assert.rejects(f.runtime.request('viewer_switch',{udid:a,targetUdid:b}),e=>e.code==='DEVICE_UNAVAILABLE');
 assert.ok(f.calls.every(c=>c.method==='devices'));
 await f.runtime.request('settings_save',{enabled:false,idleMinutes:15});f.calls.length=0;
 await assert.rejects(f.runtime.request('viewer_switch',{udid:a,targetUdid:b}),e=>e.code==='RUNTIME_DISABLED');assert.equal(f.calls.length,0);
});
test('switching among three devices and back to a running device never shuts another device down',async t=>{
 const f=await fixture(t),c='00000000-0000-4000-8000-00000000000C';
 f.devices.push({udid:c,name:'Tablet',state:'Booted',isAvailable:true});
 for(const [source,target] of [[a,b],[b,c],[c,a]]){
  await f.runtime.request('viewer_switch',{udid:source,targetUdid:target});
  assert.equal((await finish(f)).state,'done');assert.deepEqual(f.devices.map(d=>d.state),['Booted','Shutdown','Booted']);
 }
 assert.ok(!f.calls.some(c=>c.method==='shutdown'));
});
test('switching preserves the shared idle timeout, active-use protection and manual-only setting',async t=>{
 for(const manual of [false,true]){
  const f=await fixture(t);
  f.devices[1].state='Booted';
  if(manual)await f.runtime.request('settings_save',{enabled:true,idleMinutes:0});
  await f.runtime.request('viewer_switch',{udid:a,targetUdid:b});assert.equal((await finish(f)).state,'done');
  f.inUse(true);f.advance(16*60000);await f.runtime.checkIdle();assert.ok(f.devices.every(d=>d.state==='Booted'));
  f.inUse(false);f.advance(14*60000);await f.runtime.checkIdle();assert.ok(f.devices.every(d=>d.state==='Booted'));
  f.advance(2*60000);await f.runtime.checkIdle();assert.ok(f.devices.every(d=>d.state===(manual?'Booted':'Shutdown')));
 }
});

test('cross-platform switches never copy or launch the source app bundle',async t=>{
 for(const runtime of ['com.apple.CoreSimulator.SimRuntime.tvOS-27-0','com.apple.CoreSimulator.SimRuntime.xrOS-27-0']){
  const f=await fixture(t);f.devices[0].runtime='com.apple.CoreSimulator.SimRuntime.iOS-27-0';f.devices[1].runtime=runtime;
  await f.runtime.request('launch_app',{udid:a,bundleId:'test.example.phone'});f.calls.length=0;
  await f.runtime.request('viewer_switch',{udid:a,targetUdid:b});
  assert.equal((await finish(f)).state,'done');
  assert.ok(!f.calls.some(c=>['app_bundle','install_app','launch_app'].includes(c.method)));
  assert.equal(await f.runtime.currentApp(a),'test.example.phone');assert.equal(await f.runtime.currentApp(b),null);
 }
});
test('a selected stopped device starts only on the explicit boot action',async t=>{
 const f=await fixture(t);
 await f.runtime.request('viewer_switch',{udid:a,targetUdid:b});assert.equal((await finish(f)).state,'done');
 assert.equal(f.devices[1].state,'Shutdown');assert.ok(!f.calls.some(c=>c.method==='boot'));
 await f.runtime.request('settings_boot',{udid:b});assert.ok(f.devices.every(d=>d.state==='Booted'));
 assert.equal(f.calls.filter(c=>c.method==='boot').length,1);
});
test('each switch request waits for its final binding result and retains it after another selection',async t=>{
 const f=await fixture(t);let release,answered=false;
 const entered=f.hold(new Promise(r=>release=r));
 const pending=f.runtime.request('viewer_switch',{udid:a,targetUdid:b,task:'task-1'}).then(result=>{answered=true;return result;});
 await entered;
 assert.equal(answered,false,'a running shared snapshot is not the completed request result');
 release();const first=await pending;
 assert.equal(first.state,'done');assert.equal(first.activeUdid,b);assert.equal(f.bindings.get('task-1'),b);
 const next=await f.runtime.request('viewer_switch',{udid:b,targetUdid:a,task:'task-2'});
 assert.equal(next.state,'done');assert.equal(next.activeUdid,a);
 assert.notEqual(first.id,next.id);
 assert.equal(first.activeUdid,b,'later selections cannot replace an earlier response');
 assert.equal(f.bindings.get('task-1'),b);assert.equal(f.bindings.get('task-2'),a);
 assert.deepEqual(f.devices.map(d=>d.state),['Booted','Shutdown']);
});

test('two concurrent switches cannot interleave; idle shutdown cannot interrupt the reserved operation',async t=>{
 const f=await fixture(t);let release;const entered=f.hold(new Promise(r=>release=r));
 const first=f.runtime.request('viewer_switch',{udid:a,targetUdid:b,task:'task-1'});
 await entered;
 await assert.rejects(f.runtime.request('viewer_switch',{udid:a,targetUdid:b,task:'task-1'}),e=>e.code==='BUSY');
 await f.runtime.checkIdle();assert.equal(f.devices[0].state,'Booted');await assert.rejects(f.runtime.request('rename_device',{udid:a,name:'Name'}),e=>e.code==='BUSY');
 release();assert.equal((await first).state,'done');assert.equal(f.calls.filter(c=>c.method==='boot').length,0);
});
test('a switch blocked by another operation keeps the source selected',async t=>{
 const f=await fixture(t);let release;
 const occupied=f.runtime.exclusive(()=>new Promise(r=>release=r));
 await f.runtime.request('viewer_switch',{udid:a,targetUdid:b});
 const job=await finish(f);
 assert.equal(job.state,'failed');assert.equal(job.activeUdid,a);assert.equal(job.execution,'not_executed');
 assert.equal(job.errorCode,'BUSY');release();await occupied;
 assert.deepEqual(f.devices.map(d=>d.state),['Booted','Shutdown']);
});

test('task binding follows the selected device without changing its power state',async t=>{
 for(const targetState of ['Shutdown','Booted']) {
  const f=await fixture(t);f.devices[1].state=targetState;let release;
  await f.runtime.request('launch_app',{udid:a,bundleId:'test.example.app',session_context:{session_id:'task-1'}});
  const entered=f.hold(new Promise(r=>release=r));
  const pending=f.runtime.request('viewer_switch',{udid:a,targetUdid:b,task:'task-1'});
  await entered;
  assert.equal(f.bindings.get('task-1'),a,'starting a switch never changes binding speculatively');
  release();const job=await pending;
  assert.equal(f.bindings.get('task-1'),job.activeUdid);
  assert.equal(job.activeUdid,b);assert.equal(f.devices[1].state,targetState);
 }
});
test('switching between iOS and Android only selects without moving or starting apps',async t=>{
 const f=await fixture(t);f.devices[0].platform='ios';f.devices[1].platform='android';
 await f.runtime.request('launch_app',{udid:a,bundleId:'test.ios.app'});await f.runtime.request('launch_app',{udid:b,bundleId:'test.android.app'});f.calls.length=0;
 await f.runtime.request('viewer_switch',{udid:a,targetUdid:b});assert.equal((await finish(f)).state,'done');
 assert.ok(!f.calls.some(c=>['app_bundle','install_app'].includes(c.method)));assert.ok(!f.calls.some(c=>['launch_app','boot','shutdown'].includes(c.method)));
});
