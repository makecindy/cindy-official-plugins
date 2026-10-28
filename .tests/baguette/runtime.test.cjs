const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createRuntime}=require('../../baguette-simulator/node/runtime.cjs');
const udid='00000000-0000-4000-8000-000000000001';
test('restart owns shutdown and boot together while task refresh retains the same controller',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bag-restart-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const tasks=require('../../baguette-simulator/node/tasks.cjs').createTaskBindings(path.join(dir,'tasks.json'));
 await tasks.bind('task-1',udid);
 let state='Booted',release,stopping;const entered=new Promise(r=>stopping=r),hold=new Promise(r=>release=r),calls=[];
 const url='http://127.0.0.1:9/control?udid='+udid+'#capability';
 const runtime=createRuntime({tasks,settingsFile:path.join(dir,'settings.json'),existingViewerUrl:()=>url,dispatch:async(method,p,deadline)=>{
  calls.push({method,p,deadline});
  if(method==='devices')return {devices:[{udid,state,runtime:'com.apple.CoreSimulator.SimRuntime.iOS-27-0'}]};
  if(method==='shutdown'){state='Shutdown';stopping();await hold;return {ok:true};}
  if(method==='boot'){state='Booted';return {ok:true,udid,state,memoryMode:{mode:p.memoryMode,verified:true}};}
  return {ok:true};
 }});
 const pending=runtime.request('settings_restart',{udid,memoryMode:'standard'});await entered;
 const during=await runtime.request('task_state',{_task:'task-1'});
 assert.equal(during.device.state,'Shutdown');assert.equal(during.device.operation.name,'settings_restart');
 assert.equal(during.viewer.url,url.replace('#','&task=task-1#'),'parent polling must not remove the pending controller');
 await assert.rejects(runtime.request('boot',{udid,memoryMode:'saving'}),e=>e.code==='BUSY');
 release();const result=await pending;
 assert.equal(result.memoryMode.mode,'standard');
 const mutations=calls.filter(c=>['shutdown','boot'].includes(c.method));
 assert.deepEqual(mutations.map(c=>c.method),['shutdown','boot']);
 assert.equal(mutations[1].p.memoryMode,'standard');assert.equal(mutations[1].deadline,mutations[0].deadline,'one bounded request');
 assert.equal((await runtime.request('task_state',{_task:'task-1'})).device.operation,undefined);
});

test('restart validates before stopping and never boots after an unconfirmed stop or retries a failed boot',async t=>{
 for(const phase of ['invalid','missing','foreign','android','paused','stop-error','unconfirmed','boot-error','saving','standard','minimal']){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bag-restart-fail-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  let state='Booted';const calls=[];
  if(phase==='paused')await fs.writeFile(path.join(dir,'settings.json'),JSON.stringify({enabled:false,idleMinutes:15}));
  const runtime=createRuntime({settingsFile:path.join(dir,'settings.json'),dispatch:async(method,p)=>{
   calls.push(method);
   if(method==='devices')return {devices:phase==='foreign'?[]:[{udid,state,runtime:phase==='android'?'android:36':'com.apple.CoreSimulator.SimRuntime.iOS-27-0'}]};
   if(method==='shutdown'){if(phase==='stop-error')throw Error('stop failed');if(phase!=='unconfirmed')state='Shutdown';return {ok:true};}
   if(method==='boot'){if(phase==='boot-error')throw Error('boot failed');state='Booted';return {ok:true,memoryMode:{mode:p.memoryMode,verified:true}};}
  }});
  const mode=['saving','standard','minimal'].includes(phase)?phase:phase==='invalid'?'custom':phase==='missing'?undefined:'saving';
  if(['saving','standard','minimal','unconfirmed'].includes(phase)){
   const r=await runtime.request('settings_restart',{udid,memoryMode:mode});
   if(phase==='unconfirmed')assert.equal(r.ok,false);else assert.equal(r.memoryMode.mode,mode);
  }else await assert.rejects(runtime.request('settings_restart',{udid,memoryMode:mode}));
  const writes=calls.filter(m=>['shutdown','boot'].includes(m));
  assert.deepEqual(writes,['invalid','missing','foreign','android','paused'].includes(phase)?[]:['stop-error','unconfirmed'].includes(phase)?['shutdown']:['shutdown','boot'],phase);
 }
});
async function fixture(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'baguette-runtime-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  let clock=0,state='Booted',failStop=false,bootTimeout=false,hold;
  const calls=[];
  const options={settingsFile:path.join(dir,'runtime-settings.json'),now:()=>clock,dispatch:async(method,p={})=>{
    calls.push({method,...p});if(hold&&method==='tap')await hold;
    if(method==='devices')return {devices:[{udid,name:'Test device',state}]};
    if(method==='shutdown'){assert.equal(p.udid,udid);if(failStop)throw Object.assign(Error('Shutdown timed out'),{execution:'unknown'});state='Shutdown';}
    if(method==='boot'){
      state='Booted';
      if(bootTimeout)throw Object.assign(Error('bootstatus timed out'),{code:'TIMEOUT',execution:'unknown'});
    }
    return {ok:true};
  }};
  return {runtime:createRuntime(options),restart:()=>createRuntime(options),calls,file:options.settingsFile,advance:ms=>clock+=ms,state:()=>state,fail:()=>failStop=true,timeoutBoot:()=>bootTimeout=true,hold:p=>hold=p};
}
test('destructive results never start an optional device-list read or lose completed execution',async t=>{
  const paths=[['erase_device',{}],['delete_device',{}],['device',{action:'erase'}],['device',{action:'delete'}],['app_uninstall',{bundleId:'test.example.app'}]];
  for(const [method,extra] of paths)for(const elapsed of [1,109999]){
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'bag-destroy-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
    const tasks=require('../../baguette-simulator/node/tasks.cjs').createTaskBindings(path.join(root,'tasks.json'));
    const coreResult={ok:true,udid,execution:'executed',evidence:'original operation result'};
    let clock=0,reads=0,removed=false;
    const runtime=createRuntime({tasks,now:()=>clock,settingsFile:path.join(root,'settings.json'),dispatch:async(m)=>{
      if(m==='launch_app')return {ok:true,udid};
      if(m==='devices'){reads++;clock+=110000;throw Object.assign(Error('optional refresh failed'),{execution:'not_executed'});}
      removed=true;clock=elapsed;return coreResult;
    }});
    await runtime.request('launch_app',{udid,bundleId:'test.example.app',session_context:{session_id:'task-1'}});
    assert.equal(await runtime.currentApp(udid),'test.example.app');
    const result=await runtime.request(method,{udid,...extra});
    assert.equal(removed,true);assert.deepEqual(result,coreResult);assert.equal(clock,elapsed);assert.equal(reads,0);
    assert.equal(await runtime.currentApp(udid),null,'existing App cleanup remains');
    assert.equal((await tasks.get('task-1'))===null,method==='delete_device'||extra.action==='delete','only deletion clears task bindings');
  }
  for(const method of ['erase_device','delete_device'])for(const execution of ['not_executed','unknown','executed']){
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'bag-destroy-fail-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
    const error=Object.assign(Error('core failure'),{code:'OPERATION_FAILED',execution});let forgets=0;
    const runtime=createRuntime({settingsFile:path.join(root,'settings.json'),tasks:{forgetDevice:async()=>forgets++},dispatch:async()=>{throw error;}});
    await assert.rejects(runtime.request(method,{udid}),e=>e===error&&e.execution===execution);assert.equal(forgets,0);
  }
});

test('resource inspection bypasses device locks and does not postpone idle shutdown',async t=>{
 const f=await fixture(t),before=(await f.runtime.status()).idleDeadline;
 let release;const pending=new Promise(r=>release=r);f.hold(pending);
 const tap=f.runtime.request('tap',{udid});
 await new Promise(r=>setImmediate(r));
 f.advance(5000);const afterTap=(await f.runtime.status()).idleDeadline;
 await f.runtime.request('resource_usage',{udid});
 assert.equal((await f.runtime.status()).idleDeadline,afterTap);assert.equal(afterTap,before);
 release();await tap;
 await f.runtime.request('settings_save',{enabled:false,idleMinutes:15});
 assert.equal((await f.runtime.request('resource_usage',{udid})).ok,true,'works while paused');
});
test('off stops exact devices, persists across restart, and rejects tool boot; enabling never boots',async t=>{
  const f=await fixture(t);
  assert.equal((await f.runtime.request('settings_save',{enabled:false,idleMinutes:15})).ok,true);
  assert.equal(f.state(),'Shutdown');assert.equal(JSON.parse(await fs.readFile(f.file)).enabled,false);
  const restored=f.restart();await assert.rejects(restored.request('boot',{udid}),e=>e.code==='RUNTIME_DISABLED');
  for(const phase of ['began','changed','ended'])await assert.rejects(restored.request('viewer_trackpad',{udid,phase,gesture:udid,x:.5,y:.5}),e=>e.code==='RUNTIME_DISABLED');
  assert.equal(f.calls.some(c=>c.method==='viewer_trackpad'),false);
  await restored.request('settings_save',{enabled:true,idleMinutes:15});assert.equal(f.state(),'Shutdown');
  assert.equal(f.calls.filter(c=>c.method==='boot').length,0);
});

test('screenshot destination survives worker restart and unrelated settings changes without operating a device',async t=>{
  const f=await fixture(t);
  for(const destination of ['clipboard','desktop']){
    const runtime=f.restart();f.calls.length=0;
    assert.equal((await runtime.request('screenshot_destination',{destination,udid})).destination,destination);
    assert.equal(f.calls.length,0,'saving a preference never boots, stops or screenshots a device');
    assert.equal(JSON.parse(await fs.readFile(f.file)).screenshotDestination,destination);
    const restored=f.restart();
    assert.equal((await restored.status()).settings.screenshotDestination,destination);
    await restored.request('settings_save',{enabled:true,idleMinutes:30});
    assert.equal((await f.restart().status()).settings.screenshotDestination,destination);
  }
  await assert.rejects(f.restart().request('screenshot_destination',{destination:'/tmp/image.png'}),e=>e.code==='INVALID_ARGUMENT');
  assert.equal((await f.restart().status()).settings.screenshotDestination,'desktop');
});

test('failed preference writes retain the last saved destination',async t=>{
  const f=await fixture(t);
  await f.runtime.request('screenshot_destination',{destination:'clipboard'});
  await fs.rm(f.file);await fs.mkdir(f.file);
  await assert.rejects(f.runtime.request('screenshot_destination',{destination:'desktop'}));
  assert.equal((await f.runtime.status()).settings.screenshotDestination,'clipboard');
});
test('status polling does not renew idle; real operations do, and manual mode stays running',async t=>{
  const f=await fixture(t);await f.runtime.request('devices');f.advance(14*60000);await f.runtime.request('settings_status');
  await f.runtime.checkIdle();assert.equal(f.state(),'Booted');f.advance(60000);await f.runtime.checkIdle();assert.equal(f.state(),'Shutdown');
  await f.runtime.request('boot',{udid});f.advance(14*60000);await f.runtime.request('tap',{udid});f.advance(60000);await f.runtime.checkIdle();assert.equal(f.state(),'Booted');
  await f.runtime.request('settings_save',{enabled:true,idleMinutes:0});f.advance(120*60000);await f.runtime.checkIdle();assert.equal(f.state(),'Booted');
});
test('failed stop keeps start disabled and reports remaining devices, not false success',async t=>{
  const f=await fixture(t);f.fail();const result=await f.runtime.request('settings_save',{enabled:false,idleMinutes:15});
  assert.equal(result.ok,false);assert.equal(result.errorCode,'STOP_INCOMPLETE');assert.deepEqual(result.remaining,[udid]);
  await assert.rejects(f.restart().request('boot',{udid}),e=>e.code==='RUNTIME_DISABLED');
});
test('idle cleanup cannot interrupt an in-flight operation and overlapping requests never queue mutations',async t=>{
  const f=await fixture(t);let release;f.hold(new Promise(r=>release=r));
  const operation=f.runtime.request('tap',{udid});await new Promise(r=>setImmediate(r));f.advance(30*60000);
  assert.equal((await f.runtime.request('settings_status')).devices[0].state,'Booted');
  await f.runtime.checkIdle();assert.equal(f.state(),'Booted');
  await assert.rejects(f.runtime.request('settings_save',{enabled:false,idleMinutes:15}),e=>e.code==='BUSY');
  release();await operation;await f.runtime.checkIdle();assert.equal(f.state(),'Booted');
});
test('invalid settings fail closed; a direct emergency shutdown still works',async t=>{
  const f=await fixture(t);await fs.writeFile(f.file,'invalid');
  await assert.rejects(f.runtime.request('boot',{udid}),e=>e.code==='SETTINGS_UNREADABLE');
  await f.runtime.request('shutdown',{udid});assert.equal(f.state(),'Shutdown');
});
test('normal worker exit attempts and verifies device shutdown',async t=>{
  const f=await fixture(t);assert.equal((await f.runtime.close()).ok,true);assert.equal(f.state(),'Shutdown');
  await assert.rejects(f.runtime.request('boot',{udid}),e=>e.code==='BUSY');
});
test('bootstatus timeout after successful boot re-arms idle after an empty idle cleanup',async t=>{
  const f=await fixture(t);await f.runtime.request('shutdown',{udid});
  f.advance(15*60000);await f.runtime.checkIdle();assert.equal(f.state(),'Shutdown');
  f.timeoutBoot();await assert.rejects(f.runtime.request('settings_boot',{udid}),e=>e.code==='TIMEOUT');
  assert.equal(f.state(),'Booted');
  f.advance(14*60000);await f.runtime.request('settings_status');await f.runtime.checkIdle();
  assert.equal(f.state(),'Booted');
  f.advance(60000);await f.runtime.request('devices');await f.runtime.checkIdle();
  assert.equal(f.state(),'Shutdown');
});
for(const damaged of ['invalid JSON','unreadable directory'])test(`${damaged}: status and user shutdown work, starts and writes stay blocked`,async t=>{
  for(const stop of ['settings_shutdown','settings_stop_all']){
    const f=await fixture(t);
    if(damaged==='invalid JSON')await fs.writeFile(f.file,'{broken');else await fs.mkdir(f.file);
    const status=await f.runtime.request('settings_status');
    assert.equal(status.settingsError.code,'SETTINGS_UNREADABLE');assert.equal(status.settings.enabled,false);
    assert.equal(status.idleDeadline,null);assert.equal(status.devices[0].state,'Booted');
    assert.equal((await f.runtime.request('devices')).devices[0].state,'Booted');
    for(const method of ['boot','settings_boot','settings_viewer'])await assert.rejects(f.runtime.request(method,{udid}),e=>e.code==='SETTINGS_UNREADABLE');
    await assert.rejects(f.runtime.request('settings_save',{enabled:true,idleMinutes:15}),e=>e.code==='SETTINGS_UNREADABLE');
    const result=await f.runtime.request(stop,{udid});assert.equal(result.ok,true);
    assert.equal(result.execution,'executed');assert.equal(result.devices[0].state,'Shutdown');
    assert.equal(result.settingsError.code,'SETTINGS_UNREADABLE');
    assert.equal(f.calls.filter(c=>c.method==='boot').length,0);
  }
});
test('damaged settings preserve incomplete shutdown evidence and recover after file repair',async t=>{
  const f=await fixture(t);await fs.writeFile(f.file,'{broken');f.fail();
  const result=await f.runtime.request('settings_stop_all');
  assert.equal(result.ok,false);assert.equal(result.errorCode,'STOP_INCOMPLETE');
  assert.deepEqual(result.remaining,[udid]);assert.equal(result.settingsError.code,'SETTINGS_UNREADABLE');
  await fs.writeFile(f.file,JSON.stringify({enabled:false,idleMinutes:30}));
  const status=await f.runtime.request('settings_status');assert.equal(status.settingsError,undefined);
  assert.deepEqual(status.settings,{enabled:false,idleMinutes:30});
});

test('all shutdown entry points share one deadline and retain completed, failed and unprocessed devices',async t=>{
  const ids=[udid,'00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003'];
  const {commandBudget}=require('../../baguette-simulator/node/budget.cjs');
  for(const entry of ['manual','disable','idle','exit'])for(const phase of ['success','slow','failed','viewer','status']){
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'bag-stop-budget-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
    let clock=0,reads=0;const states=new Map(ids.map(id=>[id,'Booted'])),calls=[];
    const file=path.join(root,'settings.json');
    const runtime=createRuntime({settingsFile:file,now:()=>clock,dispatch:async(method,p={},deadline)=>{
      const limit=commandBudget(60000,deadline,()=>clock).timeout;
      calls.push({method,udid:p.udid,deadline});
      const cost=phase==='slow'&&method==='shutdown'?60000:1000;clock+=Math.min(cost,limit);
      if(cost>limit)throw Object.assign(Error('shutdown timed out'),{code:'COMMAND_TIMEOUT',execution:'unknown'});
      if(method==='devices'){
        if(++reads===2&&phase==='status')throw Object.assign(Error('status unavailable'),{code:'STATUS_FAILED',execution:'not_executed'});
        return {devices:ids.map(id=>({udid:id,state:states.get(id)}))};
      }
      if(method==='shutdown'){
        if(phase==='failed'&&p.udid===ids[1])throw Object.assign(Error('shutdown unconfirmed'),{code:'STOP_FAILED',execution:'unknown'});
        states.set(p.udid,'Shutdown');
      }
      if(method==='close_viewer'&&phase==='viewer')throw Object.assign(Error('viewer stop unavailable'),{code:'VIEWER_FAILED',execution:'unknown'});
      return {execution:'executed'};
    }});
    if(entry==='idle')clock=15*60000;
    const start=clock,deadline=start+110000;
    const result=entry==='manual'?await runtime.request('settings_stop_all'):
      entry==='disable'?await runtime.request('settings_save',{enabled:false,idleMinutes:15}):
      entry==='idle'?await runtime.checkIdle():await runtime.close();
    assert.ok(clock<=deadline,entry+': '+phase);assert.ok(calls.every(c=>c.deadline===deadline));
    assert.equal(result.ok,phase==='success');
    if(phase==='slow'){
      assert.deepEqual(result.completed,[ids[0]]);assert.deepEqual(result.unprocessed,[ids[2]]);
      assert.equal(result.outcomes[1].execution,'unknown');assert.equal(result.devicesError.code,'TIME_BUDGET_EXHAUSTED');
      assert.equal(calls.filter(c=>c.method==='shutdown').length,2,'no later device starts after expiry');
      assert.ok(!calls.some(c=>c.method==='close_viewer'));
    }else if(phase==='failed'){
      assert.deepEqual(result.completed,[ids[0],ids[2]]);assert.deepEqual(result.remaining,[ids[1]]);assert.deepEqual(result.unprocessed,[]);
    }else {assert.deepEqual(result.completed,ids);if(phase==='viewer')assert.equal(result.viewerError.code,'VIEWER_FAILED');if(phase==='status')assert.equal(result.devicesError.code,'STATUS_FAILED');}
    if(entry==='disable')assert.equal(JSON.parse(await fs.readFile(file)).enabled,false);
    const settledCalls=calls.length;await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,settledCalls,'no shutdown work continues after return');
  }
});

test('single-device shutdown keeps completion evidence when its status confirmation fails or expires',async t=>{
  for(const phase of ['failed','expired','unconfirmed']){
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'bag-stop-one-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
    let clock=0;const calls=[];
    const runtime=createRuntime({settingsFile:path.join(root,'settings.json'),now:()=>clock,dispatch:async(method,p,deadline)=>{
      calls.push(method);assert.equal(deadline,110000);
      if(method==='shutdown'){if(phase==='expired')clock=110000;return {execution:'executed'};}
      if(phase==='unconfirmed')return {devices:[{udid,state:'Booted'}]};
      throw Object.assign(Error('cannot read status'),{code:'STATUS_FAILED',execution:'not_executed'});
    }});
    const result=await runtime.request('settings_shutdown',{udid});
    assert.equal(result.ok,false);assert.equal(result.execution,'unknown');assert.deepEqual(result.completed,[udid]);
    if(phase==='unconfirmed')assert.deepEqual(result.remaining,[udid]);
    else assert.equal(result.devicesError.code,phase==='failed'?'STATUS_FAILED':'TIME_BUDGET_EXHAUSTED');
    assert.deepEqual(calls,phase==='expired'?['shutdown']:['shutdown','devices']);
  }
});
