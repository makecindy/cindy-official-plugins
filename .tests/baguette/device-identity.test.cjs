const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createTaskBindings}=require('../../baguette-simulator/node/tasks.cjs');
const {createRuntime}=require('../../baguette-simulator/node/runtime.cjs');
const {createApps}=require('../../baguette-simulator/node/apps.cjs');
const A='ABCDEF12-3456-4ABC-8DEF-1234567890AB',B='ABCDEF12-3456-4ABC-8DEF-1234567890AC';
const variants=id=>[id,id.toLowerCase(),id.slice(0,18)+id.slice(18).toLowerCase()];
const tmp=async t=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'bag-id-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

test('old and new task bindings share one device across case variants without a migration',async t=>{
  const file=path.join(await tmp(t),'bindings.json');
  const bindings=Object.fromEntries(variants(A).map((udid,i)=>['old-'+i,{udid,at:i+1}]));
  bindings.other={udid:B.toLowerCase(),at:4};
  const original=JSON.stringify({version:1,bindings});await fs.writeFile(file,original);
  const store=createTaskBindings(file);
  for(let i=0;i<3;i++){assert.deepEqual(await store.get('old-'+i),{udid:A,at:i+1});await store.bind('old-'+i,variants(A)[i],99);}
  assert.equal(await fs.readFile(file,'utf8'),original,'reading and equivalent binds preserve old timestamps and bytes');
  assert.deepEqual(await store.counts(),{[A]:3,[B]:1});
  await store.bind('new',A.toLowerCase(),5);
  assert.equal(JSON.parse(await fs.readFile(file,'utf8')).bindings.new.udid,A);
  const reloaded=createTaskBindings(file);assert.deepEqual(await reloaded.counts(),{[A]:4,[B]:1});
  assert.equal(await reloaded.forgetDevice(variants(A)[2]),true);
  assert.deepEqual(await createTaskBindings(file).counts(),{[B]:1});
});

test('runtime routes, task pages, shutdown confirmation and locks agree on case variants',async t=>{
  const root=await tmp(t),tasks=createTaskBindings(path.join(root,'bindings.json')),calls=[];
  const devices=[{udid:A,state:'Booted'},{udid:B,state:'Shutdown'}];let held=null;
  const options={tasks,settingsFile:path.join(root,'settings.json'),existingViewerUrl:()=> 'http://example.test/#viewer',
    dispatch:async(method,p={})=>{
      calls.push({method,...p});if(method==='devices')return {devices:devices.map(d=>({...d}))};
      assert.ok([A,B].includes(p.udid));
      if(method==='boot')devices.find(d=>d.udid===p.udid).state='Booted';
      if(method==='shutdown')devices.find(d=>d.udid===p.udid).state='Shutdown';
      if(method==='tap'&&held)await held.promise;
      return {ok:true,udid:p.udid,execution:'executed'};
    }};
  let runtime=createRuntime(options);
  for(const udid of variants(A))for(const [method,action] of [['device','boot'],['viewer','open'],['app','launch']]){
    const params={udid,action,bundleId:'test.example.app',session_context:{session_id:'task-1'}};
    await runtime.request(method,params);assert.equal(params.udid,udid,'caller remains unchanged');
    assert.equal((await tasks.get('task-1')).udid,A);
    const list=await runtime.request('devices',{session_context:{session_id:'task-1'}});
    assert.equal(list.devices[0].tasks,1);assert.equal(list.devices[0].thisTask,true);
    const state=await runtime.request('task_state',{_task:'task-1'});assert.equal(state.device.udid,A);assert.ok(state.viewer);
    const managed=await runtime.request('manage_state',{_task:'task-1'});assert.equal(managed.devices[0].thisTask,true);
  }
  runtime=createRuntime(options);
  assert.equal((await runtime.request('task_bind',{_task:'task-2',udid:A.toLowerCase()})).device.udid,A);
  assert.equal((await runtime.request('devices')).devices[0].tasks,2);
  await runtime.request('settings_shutdown',{udid:A.toLowerCase()});assert.equal(devices[0].state,'Shutdown');
  for(const method of ['app_install_status','logs','screenshot'])await runtime.request(method,{udid:A.toLowerCase()});
  held=deferred();const first=runtime.request('tap',{udid:A.toLowerCase()});
  await new Promise(r=>setImmediate(r));
  await assert.rejects(runtime.request('tap',{udid:variants(A)[2]}),e=>e.code==='BUSY');
  held.resolve();await first;
  assert.equal(calls.filter(c=>c.method==='tap').length,1);
  assert.ok(calls.filter(c=>c.udid).every(c=>c.udid===A));
});

test('installation identity remains exact across case variants, polling modes and terminal states',async t=>{
  const root=await tmp(t),source=path.join(root,'Game.app');await fs.mkdir(source);
  await fs.writeFile(path.join(source,'Game'),'executable');
  const info=JSON.stringify({CFBundleIdentifier:'test.example.game',CFBundleExecutable:'Game'});
  for(const installedId of variants(A))for(const fail of [false,true]){
    const gate=deferred();let installed=false;
    const apps=createApps({Failure:class extends Error{constructor(code,message,execution='not_executed'){super(message);Object.assign(this,{code,execution});}},
      run:async(file)=>({stdout:file.endsWith('plutil')?info:''}),sim:async args=>{if(args[0]==='get_app_container'){if(installed)return {stdout:source};throw Object.assign(Error('An error was encountered processing the command (domain=NSPOSIXErrorDomain, code=2):\nNo such file or directory'),{code:'COMMAND_FAILED'});}if(args[0]==='install'){await gate.promise;if(fail)throw Error('install failed');installed=true;}return {stdout:''};}});
    const job=await apps.install({udid:installedId},{appPath:source,wait:0},{terminate:async()=>{}});
    for(const udid of variants(A)){
      assert.equal((await apps.status({udid,job:job.job,wait:0})).job,job.job);
      assert.equal((await apps.status({udid,wait:0})).udid,A);
      assert.equal(apps.runningFor(udid).id,job.job);assert.ok(apps.pending(udid));
    }
    for(const udid of variants(B))await assert.rejects(apps.status({udid,job:job.job,wait:0}),e=>e.code==='JOB_NOT_FOUND');
    await assert.rejects(apps.status({udid:A,job:'missing',wait:0}),e=>e.code==='JOB_NOT_FOUND');
    gate.resolve();await apps.pending(A);
    for(const udid of variants(A))for(const explicit of [true,false]){
      const query={udid,wait:0,...(explicit?{job:job.job}:{})};
      if(fail)await assert.rejects(apps.status(query),e=>e.code==='INSTALL_FAILED');
      else assert.equal((await apps.status(query)).state,'done');
      assert.equal(apps.runningFor(udid),null);assert.equal(apps.pending(udid),null);
    }
  }
});
