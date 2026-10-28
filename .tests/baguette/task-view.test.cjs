const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createTaskBindings}=require('../../baguette-simulator/node/tasks.cjs');
const {createRuntime}=require('../../baguette-simulator/node/runtime.cjs');
const A='00000000-0000-4000-8000-00000000000A',B='00000000-0000-4000-8000-00000000000B';
const tmp=async t=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'baguette-task-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;};

test('task bindings persist, count tasks per device, and ignore malformed ids',async t=>{
 const file=path.join(await tmp(t),'task-bindings.json');
 const store=createTaskBindings(file);
 await Promise.all([store.bind('task-1',A),store.bind('task-2',A),store.bind('task-3',B)]);
 assert.equal(await store.bind('../x',A),false);assert.equal(await store.bind('task-4','not-a-udid'),false);
 const reloaded=createTaskBindings(file);
 assert.equal((await reloaded.get('task-1')).udid,A);assert.deepEqual(await reloaded.counts(),{[A]:2,[B]:1});
 assert.equal((await fs.stat(file)).mode&0o777,0o600);
 // A deleted device leaves no task pointing at it.
 const gone=createTaskBindings(path.join(await tmp(t),'forget.json'));
 await gone.bind('task-a',A);await gone.bind('task-b',A);await gone.bind('task-c',B);
 assert.equal(await gone.forgetDevice(A.toLowerCase()),true);
 assert.equal(await gone.get('task-a'),null);assert.equal((await gone.get('task-c')).udid,B);
 assert.equal(await gone.forgetDevice(A),false);
});

test('unreadable task bindings block every access and queued write until the file is restored',async t=>{
 const original=JSON.stringify({version:1,bindings:{'task-1':{udid:A,at:1},'task-2':{udid:B,at:2}}});
 for(const broken of ['{', 'null', '{}', '{"version":2,"bindings":{}}', '{"version":1,"bindings":[]}', '{"version":1,"bindings":{"task-1":null}}', 'directory']){
  const dir=await tmp(t),file=path.join(dir,'task-bindings.json'),store=createTaskBindings(file);
  if(broken==='directory'){await fs.mkdir(file);await fs.writeFile(path.join(file,'evidence'),original);}
  else await fs.writeFile(file,broken);
  const failed=await Promise.allSettled([store.get('task-1'),store.counts(),store.bind('task-3',A),store.bind('task-4',B),store.forgetDevice(A)]);
  for(const result of failed){assert.equal(result.status,'rejected',broken);assert.equal(result.reason.code,'TASK_BINDINGS_UNREADABLE');assert.equal(result.reason.execution,'not_executed');}
  if(broken==='directory'){assert.equal(await fs.readFile(path.join(file,'evidence'),'utf8'),original);await fs.rm(file,{recursive:true});}
  else assert.equal(await fs.readFile(file,'utf8'),broken,'failed writes preserve the exact source');
  assert.deepEqual(await fs.readdir(dir),broken==='directory'?[]:['task-bindings.json'],'no temporary output was created');
  await fs.writeFile(file,original);
  assert.deepEqual(await store.counts(),{[A]:1,[B]:1},'failed reads were not cached');
  await Promise.all([store.bind('task-3',A),store.bind('task-4',B)]);
  assert.deepEqual(await createTaskBindings(file).counts(),{[A]:2,[B]:2},'restored bindings survive queued updates');
  assert.equal(await store.forgetDevice(A),true);assert.deepEqual(await createTaskBindings(file).counts(),{[B]:2});
 }
});

test('device assignment queries propagate unreadable bindings instead of claiming devices are free',async t=>{
 for(const broken of ['{','directory']){
  const dir=await tmp(t),file=path.join(dir,'bindings.json'),tasks=createTaskBindings(file),calls=[];
  if(broken==='directory')await fs.mkdir(file);else await fs.writeFile(file,broken);
  const runtime=createRuntime({tasks,settingsFile:path.join(dir,'settings.json'),dispatch:async method=>{calls.push(method);return {devices:[{udid:A,state:'Booted'},{udid:B,state:'Shutdown'}]};}});
  for(const [method,params] of [['devices',{}],['devices',{session_context:{session_id:'task-1'}}],['manage_state',{}],['manage_state',{_task:'task-1'}],['task_state',{_task:'task-1'}]])await assert.rejects(runtime.request(method,params),e=>e.code==='TASK_BINDINGS_UNREADABLE');
  assert.ok(calls.every(m=>m==='devices'),'failed reads do not open viewers or mutate devices');
  if(broken==='directory')await fs.rmdir(file);else assert.equal(await fs.readFile(file,'utf8'),broken);
  await fs.writeFile(file,JSON.stringify({version:1,bindings:{'task-1':{udid:A,at:1}}}));
  const seen=await runtime.request('devices',{session_context:{session_id:'task-1'}});
  assert.deepEqual(seen.devices.map(d=>[d.tasks,d.thisTask]),[[1,true],[0,false]],'restored bindings are read without restarting');
 }
 // A counts success must not mask a later per-task read failure either.
 const error=Object.assign(Error('unreadable task'),{code:'TASK_BINDINGS_UNREADABLE'});
 const runtime=createRuntime({tasks:{counts:async()=>({[A]:1}),get:async()=>{throw error;}},settingsFile:path.join(await tmp(t),'s.json'),dispatch:async()=>({devices:[{udid:A,state:'Booted'}]})});
 await assert.rejects(runtime.request('devices',{session_context:{session_id:'task-1'}}),e=>e===error);
});

async function runtimeFixture(t,{viewerUrl=null}={}){
 const dir=await tmp(t);const tasks=createTaskBindings(path.join(dir,'b.json'));const calls=[];
 const states={[A]:'Shutdown',[B]:'Booted'};
 const runtime=createRuntime({settingsFile:path.join(dir,'s.json'),tasks,existingViewerUrl:()=>viewerUrl,
  dispatch:async(method,p={})=>{calls.push(method);
   if(method==='devices')return {devices:[{udid:A,name:'Alpha',state:states[A]},{udid:B,name:'Beta',state:states[B]}]};
   if(method==='boot'){states[p.udid]='Booted';return {ok:true,execution:'executed'};}
   if(method==='open_viewer')return {ok:true,ready:true,url:`http://127.0.0.1:9/control?udid=${p.udid}&lang=en#cindyClipboard=9.t`};
   return {ok:true};}});
 return {runtime,tasks,calls,states};
}

test('starting a device from a task assigns it, and devices tell each task what is free',async t=>{
 const f=await runtimeFixture(t);
 await f.runtime.request('boot',{udid:A,session_context:{session_id:'task-1'}});
 const seen=await f.runtime.request('devices',{session_context:{session_id:'task-1'}});
 assert.deepEqual(seen.devices.map(d=>[d.name,d.tasks,d.thisTask]),[['Alpha',1,true],['Beta',0,false]]);
 const other=await f.runtime.request('devices',{session_context:{session_id:'task-2'}});
 assert.deepEqual(other.devices.map(d=>d.thisTask),[false,false]);
 // The management view sees which device the task in front uses, and nothing more without one.
 const managed=await f.runtime.request('manage_state',{_task:'task-1'});
 assert.equal(managed.currentTask,'task-1');assert.deepEqual(managed.devices.map(d=>d.thisTask),[true,false]);
 const idle=await f.runtime.request('manage_state',{_task:'../x'});
 assert.equal(idle.currentTask,null);assert.deepEqual(idle.devices.map(d=>d.thisTask),[undefined,undefined]);
 // A failed start does not move the task.
 const failing=await runtimeFixture(t);
 await failing.tasks.bind('task-9',B);
 await assert.rejects(createRuntime({settingsFile:path.join(await tmp(t),'s.json'),tasks:failing.tasks,dispatch:async m=>{if(m==='boot')throw Object.assign(Error('boot failed'),{code:'BOOT_FAILED'});return {devices:[]};}}).request('boot',{udid:A,session_context:{session_id:'task-9'}}));
 assert.equal((await failing.tasks.get('task-9')).udid,B);
});

test('the task page state reuses a running viewer without the runtime lock and names the task in the address',async t=>{
 const f=await runtimeFixture(t,{viewerUrl:'http://127.0.0.1:9/control?udid=B&lang=en#cindyClipboard=9.t'});
 await f.tasks.bind('task-1',B);
 const state=await f.runtime.request('task_state',{_task:'task-1'});
 assert.equal(state.device.name,'Beta');assert.equal(state.viewer.url,'http://127.0.0.1:9/control?udid=B&lang=en&task=task-1#cindyClipboard=9.t');
 assert.ok(!f.calls.includes('open_viewer'),'no lock taken when the viewer already runs');
 const none=await f.runtime.request('task_state',{_task:'task-2'});
 assert.equal(none.device,null);assert.equal(none.viewer,null);
 await assert.rejects(f.runtime.request('task_bind',{_task:'task-2',udid:'00000000-0000-4000-8000-0000000000FF'}),e=>e.code==='INVALID_ARGUMENT');
 await assert.rejects(f.runtime.request('task_state',{_task:'../x'}),e=>e.code==='INVALID_ARGUMENT');
});

test('task binding preserves durable identity through every post-save status and viewer failure',async t=>{
 for(const phase of ['devices','counts','get','viewer','success','bind']){
  const dir=await tmp(t),file=path.join(dir,'bindings.json'),store=createTaskBindings(file),calls=[];
  await store.bind('task-1',A);let saved=false;
  const error=Object.assign(Error('fixture failure'),{code:'FIXTURE_FAILED',execution:'not_executed'});
  const tasks={bind:async(...args)=>{if(phase==='bind')throw error;await store.bind(...args);saved=true;},
   counts:async()=>{if(saved&&phase==='counts')throw error;return store.counts();},
   get:async(...args)=>{if(saved&&phase==='get')throw error;return store.get(...args);}};
  const runtime=createRuntime({tasks,settingsFile:path.join(dir,'settings.json'),dispatch:async method=>{
   calls.push(method);
   if((saved&&phase==='devices'&&method==='devices')||(phase==='viewer'&&method==='open_viewer'))throw error;
   return method==='devices'?{devices:[{udid:A,state:'Booted'},{udid:B,state:'Booted'}]}:{ok:true,url:'http://127.0.0.1:1/control?udid=B#token'};
  }});
  if(phase==='bind'){
   await assert.rejects(runtime.request('task_bind',{_task:'task-1',udid:B}),e=>e===error);
   assert.equal((await createTaskBindings(file).get('task-1')).udid,A);continue;
  }
  const result=await runtime.request('task_bind',{_task:'task-1',udid:B.toLowerCase()});
  assert.equal(result.ok,true);assert.equal(result.execution,'executed');assert.equal(result.boundUdid,B);assert.equal(result.sessionId,'task-1');
  assert.equal((await createTaskBindings(file).get('task-1')).udid,B,'fresh store proves the binding was persisted');
  if(phase==='success'){assert.equal(result.taskStateError,undefined);assert.ok(result.viewer);}
  else {assert.equal(result.taskStateError.code,'FIXTURE_FAILED');assert.match(result.taskStateError.message,/do not repeat/);assert.equal(result.viewer,undefined);}
  assert.equal(calls.filter(m=>m==='open_viewer').length,phase==='viewer'||phase==='success'?1:0);
 }
});

function logicPage({taskView,preview=async()=>({ok:true}),bindingResult,targetResult={ok:true,sessionId:'task-1'},toolResult,shotResult}={}){
 const code=require('node:fs').readFileSync('baguette-simulator/main.js','utf8');
 const buses=new Map();
 class BroadcastChannel{constructor(n){this.name=n;this.onmessage=null;(buses.get(n)||buses.set(n,new Set()).get(n)).add(this);}postMessage(data){for(const p of buses.get(this.name))if(p!==this)queueMicrotask(()=>p.onmessage?.({data}));}}
 let handler;const sent=[],previews=[],views=[],calls=[];
 const cindy={onHostMessage:fn=>handler=fn,request:async()=>({ok:true,context:{locale:'en'}}),send:async p=>sent.push(p),
  preview:async p=>{previews.push(p);return preview(p);},
  node:{request:async r=>{calls.push(r);if(r.method==='device_hold')return {ok:true,result:{running:false}};
   if(r.method==='screenshot'&&shotResult){if(shotResult instanceof Error)throw shotResult;return {ok:true,result:shotResult};}
   if(r.method==='app'&&toolResult)return {ok:true,result:toolResult};
   if(r.method==='task_target')return {ok:true,result:targetResult};
   if(r.method==='task_state')return {ok:true,result:{ok:true,sessionId:r.params._task,device:null,devices:[],viewer:null}};
   if(r.method==='task_bind'&&bindingResult)return {ok:true,result:bindingResult};
   return {ok:true,result:{ok:true,ready:true,url:'http://127.0.0.1:9/control?udid=A&lang=en#cindyClipboard=9.t'}};}}};
 if(taskView)cindy.taskView=async r=>{views.push(r);return taskView(r);};
 vm.runInNewContext(code,{cindy,BroadcastChannel,Object,String,Promise,Set,RegExp,queueMicrotask,setTimeout});
 const page=new BroadcastChannel('baguette-pages');const pushed=[],replies=[];
 page.onmessage=({data})=>{if(data.type==='viewer')pushed.push(data);if(data.type==='response')replies.push(data);};
 return {call:(args,tool='open_viewer')=>handler({type:'tool-call',tool,callId:'c',args}),sent,previews,views,calls,page,pushed,replies};
}
const settle=()=>new Promise(r=>setTimeout(r,10));

test('Host page failure observes once and retains a confirmed launch even when capture rejects',async()=>{
 for(const explicit of [true,false])for(const shotResult of [{ok:true,path:'/fixture/frame.jpg',screenshotAttached:true,_modelImages:[{data:'fixture'}]},new Error('capture unavailable')]){
  const f=logicPage({taskView:async()=>({ok:false,errorCode:'HOST_NOT_READY'}),
   toolResult:{ok:true,udid:A,appLaunched:true,execution:'executed',viewer:{ready:true,url:'http://example.test/'}},shotResult});
  await f.call({action:'launch',...(explicit?{udid:A}:{}),session_context:{session_id:'task-1'}},'app');
  const out=f.sent[0];assert.equal(out.ok,true);assert.equal(out.result.appLaunched,true);assert.equal(out.result.execution,'executed');assert.equal(out.result.outcome,'partial');
  assert.equal(f.calls.filter(c=>c.method==='app').length,1);assert.equal(f.calls.filter(c=>c.method==='screenshot').length,1);
  assert.ok(f.calls.find(c=>c.method==='screenshot').params._observationBudgetMs<=12000);
  assert.equal(f.calls.find(c=>c.method==='screenshot').params.udid,A,'observe the resolved device even when the caller omitted udid');
  assert.equal(f.calls.find(c=>c.method==='screenshot').params.session_context.session_id,'task-1');
  if(shotResult instanceof Error)assert.match(out.result.screenshot.error,/unavailable/);else assert.equal(out.images.length,1);
 }
});

test('jump resolves the latest existing device binding without booting or rebinding',async t=>{
 const f=await runtimeFixture(t);
 await f.tasks.bind('older',A,1);await f.tasks.bind('newer',A,2);await f.tasks.bind('other',B,3);
 assert.equal((await f.runtime.request('task_target',{udid:A.toLowerCase()})).sessionId,'newer');
 await f.tasks.bind('newer',B,4);
 assert.equal((await f.runtime.request('task_target',{udid:A})).sessionId,'older');
 await f.tasks.forgetDevice(A);
 await assert.rejects(f.runtime.request('task_target',{udid:A}),e=>e.code==='TASK_NOT_BOUND');
 assert.deepEqual(f.calls,[],'navigation never starts a device or viewer');
});

test('management jump opens the saved task, never a supplied task, and detects older hosts',async()=>{
 for(const mode of ['supported','older','no-task','host-failure']){
  const f=logicPage({targetResult:mode==='no-task'?{ok:false,errorCode:'TASK_NOT_BOUND'}:{ok:true,sessionId:'bound-task'},
   taskView:async()=>mode==='host-failure'?{ok:false,errorCode:'HOST_NOT_READY'}:{ok:true,sessionId:'bound-task',...(mode==='supported'?{focusRequested:true}:{})}});
  f.page.postMessage({type:'request',id:'jump',action:'go_to_task',udid:A,sessionId:'wrong-task'});await settle();
  assert.equal(f.replies[0].result.ok,mode==='supported');
  assert.deepEqual(f.calls.map(c=>c.method),['task_target']);
  assert.deepEqual(JSON.parse(JSON.stringify(f.views)),mode==='no-task'?[]:[{sessionId:'bound-task',focus:true}]);
  if(mode==='older')assert.equal(f.replies[0].result.errorCode,'HOST_UPDATE_REQUIRED');
 }
});

test('management binding with failed state notifies the focused task to unload its previous device screen',async()=>{
 const result={ok:true,execution:'executed',sessionId:'task-1',boundUdid:B,taskStateError:{code:'VIEWER_FAILED'}};
 const f=logicPage({taskView:async()=>({ok:true,sessionId:'task-1'}),bindingResult:result});
 f.page.postMessage({type:'request',id:'bind-1',action:'open_in_task',udid:B});await settle();
 assert.equal(f.replies[0].result.boundUdid,B);assert.equal(f.replies[0].result.execution,'executed');
 assert.deepEqual(JSON.parse(JSON.stringify(f.pushed)),[{type:'viewer',sessionId:'task-1',udid:B,url:'',taskStateError:{code:'VIEWER_FAILED'}}]);
 assert.deepEqual(f.calls.filter(c=>c.method==='task_bind').map(c=>c.params.udid),[B]);
});

test('completed device operations retain results and expose task record read and write failures',async t=>{
 for(const mode of ['unreadable','write-failed'])for(const method of ['boot','open_viewer','launch_app','delete_device']){
  const dir=await tmp(t),file=path.join(dir,'bindings.json'),tasks=createTaskBindings(file),calls=[];
  if(mode==='unreadable')await fs.writeFile(file,'{');
  else {await tasks.bind('existing-task',B);await tasks.bind('to-delete',A);await fs.rename(file,file+'.saved');await fs.mkdir(file);}
  // Also break recent App storage: one record failure must not skip another.
  const settingsFile=path.join(dir,'settings.json');await fs.writeFile(settingsFile+'.apps.json','{');
  const runtime=createRuntime({tasks,settingsFile,dispatch:async m=>{calls.push(m);return {ok:true,execution:'executed',udid:A,marker:'completed',viewer:{ready:true,url:'screen'}};}});
  const result=await runtime.request(method,{udid:A,bundleId:'test.example.app',session_context:{session_id:'task-1'}});
  assert.equal(result.ok,true);assert.equal(result.execution,'executed');assert.equal(result.marker,'completed');
  assert.ok(result.taskBindingError?.code);assert.match(result.taskBindingError.message,/do not repeat/);
  if(['launch_app','delete_device'].includes(method))assert.ok(result.appContextError?.code);
  assert.deepEqual(calls,[method],'record failure never replays the device operation');
  if(mode==='unreadable')assert.equal(await fs.readFile(file,'utf8'),'{');
  else {await fs.rmdir(file);await fs.rename(file+'.saved',file);}
  if(mode==='unreadable')await fs.writeFile(file,JSON.stringify({version:1,bindings:{'existing-task':{udid:B,at:1}}}));
  const restored=await runtime.request('boot',{udid:A,session_context:{session_id:'task-1'}});
  assert.equal(restored.taskBindingError,undefined);assert.equal((await tasks.get('task-1')).udid,A);
  assert.equal((await tasks.get('existing-task')).udid,B);
 }
 // Without a valid task there is no attempted binding and no invented error.
 const calls=[],runtime=createRuntime({settingsFile:path.join(await tmp(t),'settings.json'),tasks:{bind:async()=>{throw Error('must not bind');}},dispatch:async m=>{calls.push(m);return {ok:true};}});
 for(const session of [undefined,'../invalid'])assert.equal((await runtime.request('boot',{udid:A,session_context:{session_id:session}})).taskBindingError,undefined);
});

test('switch binding errors retain selection without changing device power states',async t=>{
 for(const targetState of ['Shutdown','Booted']){
  const dir=await tmp(t),file=path.join(dir,'bindings.json');await fs.writeFile(file,'{');
  const devices=[{udid:A,state:'Booted',isAvailable:true},{udid:B,state:targetState,isAvailable:true}];
  const runtime=createRuntime({tasks:createTaskBindings(file),settingsFile:path.join(dir,'settings.json'),dispatch:async(m,p={})=>{
   if(m==='devices')return {devices};
   assert.fail('selection must not operate devices: '+m);
  }});
  await runtime.request('viewer_switch',{udid:A,targetUdid:B,task:'task-1'});
  let job;
  for(let i=0;i<100;i++){job=(await runtime.status()).deviceJob;if(job.state!=='running')break;await new Promise(r=>setTimeout(r,2));}
  assert.equal(job.state,'done');assert.equal(job.activeUdid,B);
  assert.equal(job.execution,'executed');assert.equal(job.taskBindingError.code,'TASK_BINDINGS_UNREADABLE');
  assert.deepEqual(devices.map(d=>d.state),['Booted',targetState]);
  assert.equal(await fs.readFile(file,'utf8'),'{');
 }
});

test('a host with task pages shows the live view in the calling task, not the browser',async()=>{
 const r=logicPage({taskView:async req=>({ok:true,sessionId:req.sessionId})});
 await r.call({udid:'A',session_context:{session_id:'task-1'}});await settle();
 assert.deepEqual(JSON.parse(JSON.stringify(r.views)),[{sessionId:'task-1'}]);assert.equal(r.previews.length,0);
 assert.equal(r.sent[0].result.previewOpened,true);assert.match(r.sent[0].result.location,/task sidebar/);
 assert.deepEqual(JSON.parse(JSON.stringify(r.pushed)),[{type:'viewer',sessionId:'task-1',udid:'A',url:'http://127.0.0.1:9/control?udid=A&lang=en&task=task-1#cindyClipboard=9.t'}]);
});

test('older hosts, and an install without a task page, fall back to the sidebar browser',async()=>{
 const old=logicPage();await old.call({udid:'A',session_context:{session_id:'task-1'}});await settle();
 assert.equal(old.previews.length,1);assert.equal(old.sent[0].result.previewOpened,true);
 const denied=logicPage({taskView:async()=>({ok:false,errorCode:'PERMISSION_DENIED'})});await denied.call({udid:'A',session_context:{session_id:'task-1'}});await settle();
 assert.equal(denied.previews.length,1);
 const noTask=logicPage({taskView:async()=>({ok:false,errorCode:'HOST_NOT_READY',message:'no task'})});await noTask.call({udid:'A'});await settle();
 assert.equal(noTask.previews.length,0);assert.equal(noTask.sent[0].result.previewOpened,false);
});

test('pages reach only the listed actions, scoped to their own task',async()=>{
 const r=logicPage({taskView:async()=>({ok:true,sessionId:'front'})});
 r.page.postMessage({type:'request',id:'1',action:'task_state',sessionId:'task-1'});
 r.page.postMessage({type:'request',id:'2',action:'settings_save',enabled:false});
 r.page.postMessage({type:'request',id:'3',action:'task_state',sessionId:'../x'});
 r.page.postMessage({type:'request',id:'4',action:'environment'});
 await settle();await settle();
 assert.deepEqual(r.replies.map(x=>x.id).sort(),['1','3']);
 assert.equal(r.replies.find(x=>x.id==='3').result.errorCode,'INVALID_ARGUMENT');
 assert.deepEqual(r.calls.filter(c=>c.method!=='device_hold').map(c=>[c.method,c.params._task]),[['task_state','task-1']]);
});

test('the management view offers "open in current task" only when a task is in front',async()=>{
 // Real case: the full-page management view has no task in front, so every click
 // failed with "open a task first". It now asks the host without opening anything.
 const front=logicPage({taskView:async req=>req.peek?{ok:true,sessionId:'front'}:{ok:true,sessionId:'front'}});
 front.page.postMessage({type:'request',id:'m1',action:'manage_state'});
 const none=logicPage({taskView:async req=>({ok:false,errorCode:'HOST_NOT_READY'})});
 none.page.postMessage({type:'request',id:'m2',action:'manage_state'});
 await settle();await settle();
 assert.deepEqual(JSON.parse(JSON.stringify(front.views)),[{peek:true}],'peek only, no page opened');
 assert.deepEqual(front.calls.filter(c=>c.method==='manage_state').map(c=>c.params._task),['front']);
 assert.deepEqual(none.calls.filter(c=>c.method==='manage_state').map(c=>c.params._task),[undefined]);
});

test('creation mode survives the task poll replacing its live controller with the off-device page',async()=>{
 const nodes=new Map(),events={},calls=[];
 const get=id=>{if(!nodes.has(id))nodes.set(id,{children:[],contentWindow:{},replaceChildren(){this.children=[];},append(...children){this.children.push(...children);}});return nodes.get(id);};
 let device={udid:A,state:'Booted',runtime:'iOS-27'},poll;
 const context={URL,URLSearchParams,location:{search:'?session=task-1'},BroadcastChannel:class{postMessage(){}},
  addEventListener:(type,fn)=>events[type]=fn,setInterval:fn=>poll=fn,
  document:{hidden:false,documentElement:{},getElementById:get,addEventListener(){}}};
 vm.createContext(context);
 vm.runInContext(require('node:fs').readFileSync('baguette-simulator/pages.js','utf8'),context);
 const pages=context.CindySimPages;
 Object.assign(pages,{locale:async()=> 'en',h:(tag,props,children=[])=>({tag,props,children}),memoryBadge:()=>null,
  memoryPicker:d=>({selected:pages.memoryArgs(d).memoryMode}),
  rpc:async(action,params)=>{calls.push({action,params});return {ok:true,settings:{enabled:true},device,devices:[device],viewer:device.udid===A?{url:'http://127.0.0.1:1/control?udid='+A}:null};}});
 context.CindySimModel={platform:()=> 'iOS',runtimeLabel:()=> 'iOS 27',createResourceSummary:()=>({node:{},update(){},prune(){}}),showMemoryNotice(){}};
 vm.runInContext(require('node:fs').readFileSync('baguette-simulator/task.js','utf8'),context);await settle();
 const message={source:get('screen').contentWindow,origin:'http://127.0.0.1:1',data:{type:'cindy-simulator-created',sessionId:'task-1',udid:B,memoryMode:'minimal'}};
 for(const invalid of [{source:{}},{origin:'https://invalid.test'},{data:{...message.data,sessionId:'another'}}]) events.message({...message,...invalid});
 assert.equal(pages.memoryArgs({udid:B}).memoryMode,'saving');
 events.message(message);device={udid:B,name:'Created',state:'Shutdown',runtime:'iOS-27'};poll();await settle();
 assert.equal(get('screen').src,'about:blank');assert.equal(get('home').hidden,false);
 assert.equal(pages.memoryArgs(device).memoryMode,'minimal');
 const flatten=n=>[n,...(n.children||[]).filter(Boolean).flatMap(flatten)];
 const rendered=get('inner').children.flatMap(flatten);assert.ok(rendered.some(n=>n.selected==='minimal'));
 await rendered.find(n=>n.tag==='button'&&n.props.text==='Open').props.onclick();
 assert.equal(calls.find(c=>c.action==='task_boot').params.memoryMode,'minimal');
});

test('an already streaming task page polls binding changes and follows a newly assigned device',async()=>{
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,{replaceChildren(){},append(){}});return nodes.get(id);};
 let device=A,poll;
 const context={URLSearchParams,addEventListener(){},location:{search:'?session=task-1'},document:{hidden:false,documentElement:{},getElementById:get,addEventListener(){}},
  setInterval:fn=>{poll=fn;},CindySimPages:{locale:async()=> 'en',onPush(){},h:()=>({}),GLYPH:{},memoryBadge:()=>null,resourceButton:()=>({}),
   rpc:async()=>({ok:true,settings:{enabled:true},device:{udid:device,state:'Booted'},viewer:{url:'http://127.0.0.1:1/control?udid='+device}})},CindySimModel:{runtimeLabel:()=>'iOS 27',createResourceSummary:()=>({node:{},update(){},prune(){},label:()=>({})})}};
 vm.runInNewContext(require('node:fs').readFileSync('baguette-simulator/task.js','utf8'),context);
 await settle();assert.match(get('screen').src,new RegExp(A));
 device=B;poll();await settle();assert.match(get('screen').src,new RegExp(B));
});

test('a closed task screen stays closed on refresh and offers an explicit reopen action in either language',async()=>{
 for(const lang of ['en','zh-CN']) {
  const nodes=new Map(),calls=[];
  const get=id=>{if(!nodes.has(id))nodes.set(id,{children:[],replaceChildren(){this.children=[];},append(...children){this.children.push(...children);}});return nodes.get(id);};
  let closed=true,poll;
  const context={URLSearchParams,addEventListener(){},location:{search:'?session=task-1'},document:{hidden:false,documentElement:{},getElementById:get,addEventListener(){}},
   setInterval:fn=>{poll=fn;},CindySimPages:{locale:async()=>lang,onPush(){},h:(tag,props,children=[])=>({tag,props,children}),GLYPH:{},memoryBadge:()=>null,resourceButton:()=>({}),
    rpc:async(action,params)=>{calls.push({action,params});if(action==='task_bind')closed=false;return {ok:true,settings:{enabled:true},device:{udid:A,name:'Phone',state:'Booted'},viewerClosed:closed,viewer:closed?null:{url:'http://127.0.0.1:1/control?udid='+A}};}},CindySimModel:{runtimeLabel:()=>'iOS 27',createResourceSummary:()=>({node:{},update(){},prune(){},label:()=>({})})}};
  vm.runInNewContext(require('node:fs').readFileSync('baguette-simulator/task.js','utf8'),context);
  await settle();poll();await settle();
  const flatten=node=>[node,...(node.children||[]).filter(Boolean).flatMap(flatten)];
  const rendered=get('inner').children.flatMap(flatten);
  assert.ok(rendered.some(n=>n.props?.text===(lang==='zh-CN'?'画面已关闭':'Screen closed')));
  assert.ok(!rendered.some(n=>n.props?.class==='spinner'));
  assert.ok(calls.every(c=>c.action==='task_state'),'polling never reopens');
  await rendered.find(n=>n.tag==='button').props.onclick();await settle();
  assert.equal(calls.find(c=>c.action==='task_bind').params.udid,A);assert.match(get('screen').src,new RegExp(A));
 }
});
