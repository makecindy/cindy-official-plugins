const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),crypto=require('node:crypto');
const configuration={model:'test-model',harness:'codex',provider:'own-account',effort:'high'};
function bridge(initial={root:'/selected'},catalog={ok:true,models:[{id:'test-model',name:'Model',agent:'codex',providerId:'own-account',providerName:'My account',efforts:['low','high'],defaultEffort:'low'}]}){
 let onMessage,bc,cfg=structuredClone(initial);const calls=[],replies=[],runs=new Map(),tasks=new Map();let sequence=0;
 const cindy={downloads:{start:async()=>({ok:true,token:'fixture'})},library:async x=>{if(x.op==='write'){cfg=JSON.parse(x.content);return {ok:true};}return {ok:true,content:JSON.stringify(cfg)};},node:{request:async x=>{calls.push(x);let result={ok:true};if(x.method==='defaults')result={root:'/automatic'};if(x.method==='bank')result={questions:[{key:'online:fixture:audio@v2'}]};if(x.method==='online_inspect')result={indexId:'fixture'};if(x.method==='online_plan')result={artifacts:[]};if(x.method==='online_install')result={bank:'/bank/fixture',key:'audio@v2'};if(x.method==='grade'||x.method==='reconcile_result')result={status:'graded',scoreExact:'1'};if(x.method==='coordinator_state')result={path:'/state.json'};if(x.method==='coordinator_plan')result={path:'/plan.json',prompt:'Coordinate the plan.'};if(['runs','drafts'].includes(x.method))result=[];if(x.method==='prepare')result={runId:x.params.runId,workspace:x.params.workspace||'/answers/'+x.params.runId,prompt:'Read TASK.md and verify.'};return {ok:true,result};}},tasks:{
 capabilities:async()=>({operations:['create','send','getRun']}),
 create:async x=>{calls.push({create:x});const task={taskId:'t'+(++sequence),revision:1,resolvedConfig:x.route,workingDir:'/isolated/'+sequence,permissionMode:'auto'};tasks.set(task.taskId,task);return task;},
 setTeamPlan:async x=>{calls.push({setTeamPlan:x});return {ok:true};},releaseWorker:async x=>{calls.push({releaseWorker:x});return {ok:true};},get:async x=>tasks.get(x.taskId),startTeam:async()=>({ok:true,teamId:'team'}),getTeam:async()=>({ok:true,leadWorking:true,workers:[]}),
 send:async x=>{calls.push({send:x});const route=tasks.get(x.taskId)?.resolvedConfig;const run={runId:'r'+sequence,taskId:x.taskId,status:'running',acceptedConfig:route,acceptedAt:1,execution:{instanceId:'native',generation:1}};runs.set(run.runId,run);return run;},
 getRun:async x=>runs.get(x.runId),cancel:async x=>{calls.push({cancel:x});return {status:'cancelled'};}
 },onHostMessage:fn=>onMessage=fn,send:async x=>calls.push(x)};
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../main.js'),'utf8'),{cindy,crypto,fetch:async url=>url==='agent-models'?{ok:catalog.ok,status:catalog.status||200,json:async()=>catalog}:{ok:true,json:async()=>[{key:'audio@v2'}]},BroadcastChannel:class{constructor(){bc=this;}postMessage(x){replies.push(x);}},Map,Error,JSON,Date,Set});
 return {calls,replies,runs,get config(){return cfg;},tool:m=>onMessage(m),ui:(id,action,args={})=>bc.onmessage({data:{type:'request',id,action,args}}),cindy};
}
const args={questions:['audio@v2'],configurations:[configuration]};
test('paused queues and confirmation prompts keep stopping pending until cleared',async()=>{
 for(const flag of ['queue_paused','waitingForUser']){
  const b=bridge();await b.ui('start','start',args);await b.ui('stop','cancel');await b.ui('stopping','query');
  b.runs.get('r1').status='completed';let pending=true;
  b.cindy.tasks.getTeam=async()=>({ok:true,leadWorking:false,workers:[worker(b,{[flag]:pending})]});
  await b.ui('paused','query');assert.equal(b.config.batch.status,'stopping');
  assert.equal(b.calls.filter(x=>x.method==='grade').length,0);
  await b.ui('another','start',args);assert.equal(b.replies.at(-1).ok,false);
  pending=false;await b.ui('cleared','query');assert.equal(b.config.batch.status,'cancelled');
 }
});
test('authoring is single flight and uses a random draft identity',async()=>{
 const b=bridge(),source={records:[{sessionId:'fixture',text:'selected material'}]};
 await Promise.all([b.ui('author-a','author',source),b.ui('author-b','author',source)]);
 assert.equal(b.calls.filter(x=>x.create).length,1);assert.equal(b.calls.filter(x=>x.send).length,1);
 assert.match(b.config.author.id,/^question-[a-f0-9-]{36}$/);
 const original=b.config.author.id;await b.ui('author-c','author',source);
 assert.equal(b.replies.at(-1).ok,false);assert.equal(b.config.author.id,original);
 assert.equal(b.calls.filter(x=>x.method==='draft').length,1);
});
test('one or multiple cached online versions resolve through the configured index before any paid task',async()=>{
 for(const count of [1,2])for(const offline of [true,false]){
  const b=bridge(),request=b.cindy.node.request;let installed=false,inspected=0;
  const keys=['a','b'].map(c=>'online:'+c.repeat(64)+':audio@v2');
  b.cindy.node.request=async x=>{
   if(x.method==='bank')return {ok:true,result:{questions:(installed?keys:keys.slice(0,count)).map((key,i)=>({key,distributionHash:String(i)}))}};
   if(x.method==='online_inspect'){inspected++;assert.equal(b.calls.filter(x=>x.create).length,0);if(offline)throw Error('Offline');return {ok:true,result:{indexId:'current'}};}
   if(x.method==='online_plan')return {ok:true,result:{artifacts:[]}};
   if(x.method==='online_install'){installed=true;assert.equal(x.params.indexId,'current');return {ok:true,result:{bank:'/bank/'+'b'.repeat(64),key:'audio@v2'}};}
   return request(x);
  };
  b.cindy.downloads={start:async()=>({ok:true,token:'unused'})};
  await b.ui('start','start',args);assert.equal(inspected,1);
  if(offline){assert.equal(b.replies.at(-1).ok,false);assert.equal(b.calls.filter(x=>x.create).length,0);}
  else {assert.equal(installed,true);assert.equal(b.config.batch.items[0].question,keys[1]);}
 }
});
test('imported suffix cannot replace a default question and missing qualified keys fail closed',async()=>{
 for(const key of ['audio@v2','online:missing:audio@v2']){
  const b=bridge(),request=b.cindy.node.request;let inspected=0;
  b.cindy.node.request=async x=>{if(x.method==='bank')return {ok:true,result:{questions:[{key:'imported:other:audio@v2'}]}};if(x.method==='online_inspect'){inspected++;throw Error('Offline');}return request(x);};
  await b.ui('start','start',{...args,questions:[key]});assert.equal(b.calls.filter(x=>x.create).length,0);assert.equal(b.replies.at(-1).ok,false);assert.equal(inspected,key.includes(':')?0:1);
 }
});
test('online install forwards opaque receipts and rejects an old path-only host',async()=>{
 for(const modern of [true,false]){
  const b=bridge(),hash='a'.repeat(64),request=b.cindy.node.request;
  b.cindy.node.request=async x=>x.method==='online_plan'?{ok:true,result:{artifacts:[{sha256:hash,bytes:6,url:'https://github.com/file'}]}}:request(x);
  b.cindy.downloads={start:async()=>modern?{ok:true,token:'host-receipt'}:{ok:true,path:'/private/host/file'},cancel:async()=>({ok:true})};
  await b.ui('download','online_install',{indexId:'index',question:'audio@v2'});
  const call=b.calls.find(x=>x.method==='online_install');
  if(modern){assert.deepEqual({...call.downloadTokens},{['artifact_'+hash]:'host-receipt'});assert.equal(call.params.requireHostDownloads,true);assert.equal(call.params.hostArtifacts,undefined);}
  else {assert.equal(call,undefined);assert.equal(b.replies.at(-1).ok,false);}
 }
});
test('one coordinator uses exact route, isolated workspace and stable keys; duplicate clicks do not pay twice',async()=>{
 const b=bridge();await Promise.all([b.ui('same','start',args),b.ui('same','start',args)]);assert.equal(b.calls.filter(x=>x.send).length,1);assert.equal(b.calls.filter(x=>x.create).length,1);assert.equal(b.calls.find(x=>x.create).create.isolatedWorkspace,true);assert.equal(b.calls.find(x=>x.create).create.route.providerId,'own-account');assert.equal(b.calls.find(x=>x.method==='prepare').params.executionChannel,'Orca Worker');assert.equal(b.calls.filter(x=>x.task).length,0);
 await b.ui('newclick','start',args);assert.equal(b.replies.at(-1).ok,false);assert.equal(b.calls.filter(x=>x.send).length,1);
});
function worker(b,overrides={}){const i=b.config.batch.items[0];return {label:'eval-'+i.runId.replaceAll('-','').slice(0,27),worker_id:'w',session_id:'worker-session',model:configuration.model,agent_kind:'codex',effort:'high',providerId:'own-account',fastMode:false,working_dir:i.prepared.workspace,status:'done',is_working:false,queued_count:0,completedAt:2000,...overrides};}
test('Lead completion is not a sample completion; idle workers are not graded',async()=>{
 const b=bridge();await b.ui('start','start',args);b.runs.get('r1').status='completed';
 b.cindy.tasks.getTeam=async()=>({ok:true,leadWorking:false,workers:[worker(b,{status:'idle',completedAt:null})]});
 await b.ui('poll1','query');assert.equal(b.calls.filter(x=>x.method==='grade').length,0);
 b.cindy.tasks.getTeam=async()=>({ok:true,leadWorking:false,workers:[worker(b)]});
 await b.ui('poll2','query');const grade=b.calls.find(x=>x.method==='grade');assert.equal(grade.params.receipt.channel,'Orca Worker');assert.equal(grade.params.receipt.provenance,'host-team-observed');assert.equal(b.config.batch.status,'completed');await b.ui('again','query');assert.equal(b.calls.filter(x=>x.method==='grade').length,1);
});
test('a completed worker route mismatch is not scored',async()=>{const b=bridge();await b.ui('start','start',args);b.cindy.tasks.getTeam=async()=>({ok:true,leadWorking:false,workers:[worker(b,{model:'wrong'})]});await b.ui('poll','query');assert.equal(b.calls.filter(x=>x.method==='grade').length,0);assert.match(b.config.batch.items[0].error,/配置/);});
test('stop stays pending until Lead receipt and all Workers are inactive',async()=>{const b=bridge();await b.ui('start','start',{...args,configurations:[configuration,{...configuration,effort:'low'}]});await b.ui('cancel','cancel');assert.equal(b.calls.filter(x=>x.create).length,1);assert.equal(b.config.batch.status,'stopping');await b.ui('poll','query');assert.equal(b.config.batch.status,'stopping');b.runs.get('r1').status='completed';b.cindy.tasks.getTeam=async()=>({ok:true,leadWorking:false,workers:[]});await b.ui('stopped','query');assert.equal(b.config.batch.status,'cancelled');});
test('readonly permission and missing task capability never dispatch',async()=>{const b=bridge();b.cindy.tasks.create=async()=>({taskId:'t',revision:1,permissionMode:'plan'});b.cindy.tasks.get=async()=>({taskId:'t',revision:1,permissionMode:'plan'});await b.ui('start','start',args);assert.equal(b.calls.filter(x=>x.send).length,0);assert.equal(b.config.batch.phase,'permission');const old=bridge();delete old.cindy.tasks;await old.ui('start','start',args);assert.equal(old.replies.at(-1).ok,false);assert.equal(old.calls.filter(x=>x.method==='prepare').length,0);});
test('catalog unavailable or changed provider never dispatches, nor uses paid discovery',async()=>{for(const status of [404,503]){const b=bridge({root:'/selected'},{ok:false,status});await b.ui('start','start',args);assert.equal(b.calls.filter(x=>x.send).length,0);assert.equal(b.replies.at(-1).ok,false);}const b=bridge();await b.ui('start','start',{...args,configurations:[{...configuration,provider:'other'}]});assert.equal(b.calls.filter(x=>x.create).length,0);});
test('root overrides are ignored and fresh install stores profile',async()=>{const b=bridge({});await b.ui('status','status');assert.match(b.config.profile,/^[a-f0-9-]{36}$/);await b.tool({type:'tool-call',tool:'list_runs',callId:'real',args:{root:'/attacker'}});assert.equal(b.calls.at(-2).params.root,'/automatic');});

test('permission refusal keeps batch; consent resumes same task exactly once',async()=>{
 const b=bridge();const task={taskId:'t',revision:1,workingDir:'/isolated/1',resolvedConfig:{agentKind:'codex',providerId:'own-account',model:'test-model',effort:'high',fastMode:false},permissionMode:'plan'};
 b.cindy.tasks.create=async()=>({...task});
 b.cindy.tasks.get=async()=>({...task});
 b.cindy.tasks.requestWriteAccess=async()=>({granted:false});
 await b.ui('s','start',args);const batch=b.config.batch.id;
 await b.ui('no','allow_write');assert.equal(b.config.batch.phase,'permission');assert.equal(b.calls.filter(x=>x.send).length,0);
 b.cindy.tasks.requestWriteAccess=async request=>{assert.equal(request.mode,'auto');task.permissionMode='auto';task.revision=2;return {granted:true,task:{...task}};};
 await b.ui('yes','allow_write');assert.equal(b.config.batch.id,batch);assert.equal(b.calls.filter(x=>x.send).length,1);assert.equal(b.calls.find(x=>x.send).send.expectedRevision,2);
 assert.equal(b.config.batch.phase,'coordinating');
 await b.ui('again','allow_write');assert.equal(b.calls.filter(x=>x.send).length,1);
});

test('one failed preparation does not block other samples or create another Lead',async()=>{
 const b=bridge(),original=b.cindy.node.request;let count=0;
 b.cindy.node.request=async x=>{if(x.method==='prepare'&&++count===1)throw Error('broken package');return original(x);};
 await b.ui('start','start',{...args,configurations:[configuration,{...configuration,effort:'low'}]});
 assert.equal(b.calls.filter(x=>x.create).length,1);assert.equal(b.calls.filter(x=>x.send).length,1);
 assert.equal(b.config.batch.items[0].status,'blocked');assert.ok(b.config.batch.items[1].prepared);
 const plan=b.calls.find(x=>x.method==='coordinator_plan').params;
 assert.equal(plan.items.length,1);assert.ok(plan.items[0].label.length<=32);
});
test('declined team activation does not repeatedly prompt on automatic refresh',async()=>{
 const b=bridge();let calls=0;b.cindy.tasks.startTeam=async()=>{calls++;return {ok:false,message:'declined'};};
 await b.ui('start','start',args);await b.ui('poll','query');assert.equal(calls,1);
 await b.ui('resume','resume_coordination');assert.equal(calls,2);assert.equal(b.calls.filter(x=>x.create).length,1);
});

test('native tool rejection pauses without another paid nudge or scoring',async()=>{
 const b=bridge();await b.ui('start','start',args);
 b.cindy.tasks.getTeam=async()=>({ok:true,leadWorking:false,workers:[]});
 b.cindy.tasks.readMessages=async()=>({items:[{role:'tool_result',createdAt:1000,content:'<tool_use_error>user rejected MCP tool call</tool_use_error>'}],nextCursor:null});
 await b.ui('poll','query');assert.equal(b.config.batch.phase,'blocked');assert.match(b.config.batch.message,/授权/);
 await b.ui('again','query');assert.equal(b.calls.filter(x=>x.send).length,1);assert.equal(b.calls.filter(x=>x.method==='grade').length,0);
 await b.ui('resume','resume_coordination');assert.equal(b.calls.filter(x=>x.send).length,2);
});

test('pending human confirmation is not shown as working or automatically retried',async()=>{
 const b=bridge();await b.ui('start','start',args);
 b.cindy.tasks.getTeam=async()=>({ok:true,leadWorking:true,waitingForUser:true,workers:[]});
 await b.ui('poll','query');assert.equal(b.config.batch.phase,'awaiting_confirmation');assert.match(b.config.batch.message,/确认/);
 await b.ui('again','query');assert.equal(b.calls.filter(x=>x.send).length,1);
});
test('parallel state excludes active labels, environment results remain ungraded and release follows saved result',async()=>{
 const b=bridge();await b.ui('start','start',{...args,configurations:[configuration,{...configuration,effort:'low'}],concurrency:2});
 const original=b.cindy.node.request;b.cindy.node.request=async x=>x.method==='grade'||x.method==='reconcile_result'?{ok:true,result:{status:'environment_invalid',reason:'preflight blocked'}}:original(x);
 b.cindy.tasks.getTeam=async()=>({ok:true,leadWorking:false,capacity:{hardLimit:2,remainingSlots:1},workers:[worker(b,{lastTurnEndedAt:2000,startedAt:1000,acceptedAt:500})]});
 await b.ui('poll','query');assert.equal(b.config.batch.items[0].status,'environment_invalid');assert.equal(b.config.batch.items[0].released,true);
 const states=b.calls.filter(x=>x.method==='coordinator_state');assert.equal(states.at(-1).params.assignments.length,1);assert.notEqual(states.at(-1).params.assignments[0].runId,b.config.batch.items[0].runId);assert.equal(b.calls.filter(x=>x.releaseWorker).length,1);
 await b.ui('again','query');assert.equal(b.calls.filter(x=>x.releaseWorker).length,1);
});
test('cancel while copying a question returns immediately and prevents subsequent preparation or dispatch',async()=>{
 const b=bridge();let release,entered;const ready=new Promise(r=>entered=r),held=new Promise(r=>release=r);const request=b.cindy.node.request;
 b.cindy.node.request=async x=>{if(x.method==='prepare'){entered();await held;}return request(x);};
 const start=b.ui('start-slow','start',{...args,configurations:[configuration,{...configuration,effort:'low'}]});await ready;
 await b.ui('stop-slow','cancel');assert.equal(b.config.batch.status,'stopping');assert.equal(b.calls.filter(x=>x.send).length,0);
 release();await start;assert.equal(b.config.batch.status,'cancelled');assert.equal(b.calls.filter(x=>x.method==='prepare').length,1);assert.equal(b.calls.filter(x=>x.send).length,0);
});
test('cancel during coordinator creation preserves the late receipt but never starts a team or sends',async()=>{
 const b=bridge();let release,entered;const ready=new Promise(r=>entered=r),held=new Promise(r=>release=r);const create=b.cindy.tasks.create;
 b.cindy.tasks.create=async x=>{entered();await held;return create(x);};const start=b.ui('start-create','start',args);await ready;await b.ui('stop-create','cancel');release();await start;
 assert.equal(b.config.batch.status,'cancelled');assert.ok(b.config.batch.coordinator.taskId);assert.equal(b.calls.filter(x=>x.send).length,0);assert.equal(b.calls.filter(x=>x.method==='prepare').length,0);
});

test('legacy in-flight tasks are cancelled through host, not just marked stopped',async()=>{
 const b=bridge({root:'/selected',batch:{id:'legacy',status:'running',items:[{runId:'answer',question:'audio@v2',config:configuration,status:'running',task:{taskId:'t'},hostRun:{runId:'host'}}]}});
 let ended=false;b.cindy.tasks.cancel=async x=>{b.calls.push({cancel:x});return {status:ended?'cancelled':'stopping'};};
 await b.ui('cancel','cancel');await b.ui('poll','query');assert.equal(b.config.batch.status,'stopping');assert.equal(b.calls.find(x=>x.cancel).cancel.runId,'host');
 ended=true;await b.ui('stopped','query');assert.equal(b.config.batch.status,'cancelled');assert.equal(b.calls.filter(x=>x.send).length,0);
});

test('settings reads wait for an in-flight atomic write, including status refresh',async()=>{
 const b=bridge();let writing=false,overlap=false,release,entered;const held=new Promise(r=>release=r),ready=new Promise(r=>entered=r);const library=b.cindy.library;
 b.cindy.library=async x=>{if(x.op==='write'){writing=true;entered();await held;const r=await library(x);writing=false;return r;}if(writing)overlap=true;return library(x);};
 const write=b.ui('source','save_source',{url:'https://example.test/index.json'});await ready;
 const read=b.ui('refresh','status');await new Promise(r=>setImmediate(r));assert.equal(overlap,false);release();await Promise.all([write,read]);assert.equal(overlap,false);assert.equal(b.config.indexUrl,'https://example.test/index.json');
});
test('transient read identity mismatch is revalidated; permission errors are not retried',async()=>{
 const b=bridge(),library=b.cindy.library;let failed=0;
 b.cindy.library=async x=>x.op==='read'&&failed++<2?{ok:false,errorCode:'INTERNAL',message:'读取身份校验失败(目标 identity 不一致)'}:library(x);
 await b.ui('start','start',args);assert.equal(b.config.batch.phase,'coordinating');assert.equal(b.calls.filter(x=>x.send).length,1);
 let denied=0;b.cindy.library=async()=>{denied++;return {ok:false,errorCode:'PERMISSION_DENIED',message:'permission denied'};};await b.ui('denied','status');assert.equal(denied,1);assert.equal(b.replies.at(-1).ok,false);
});
test('exhausted transient reads back off then recover without duplicate dispatch',async()=>{
 const b=bridge();await b.ui('start','start',args);const library=b.cindy.library;let failures=3;
 // Trigger a read failure inside the coordinator, then allow the error state to persist.
 const get=b.cindy.tasks.get;b.cindy.tasks.get=async x=>{b.cindy.library=async req=>req.op==='read'&&failures-->0?{ok:false,errorCode:'INTERNAL',message:'读取身份校验失败(目标 identity 不一致)'}:library(req);return get(x);};
 await b.ui('poll','query');assert.equal(b.config.batch.phase,'recovering');assert.ok(b.config.batch.retryAt>Date.now());
 const calls=b.calls.length;await b.ui('backoff','query');assert.equal(b.calls.length,calls);
 b.cindy.tasks.get=get;b.config.batch.retryAt=0;await b.ui('recover','query');assert.equal(b.config.batch.phase,'coordinating');assert.equal(b.calls.filter(x=>x.send).length,1);assert.equal(b.config.batch.readRetryCount,undefined);
});
test('old identity-error pause resumes automatically but other blocked reasons remain paused',async()=>{
 const b=bridge();await b.ui('start','start',args);b.config.batch.phase='blocked';b.config.batch.message='读取身份校验失败(目标 identity 不一致)';
 await b.ui('migrate','query');assert.equal(b.config.batch.phase,'coordinating');assert.equal(b.calls.filter(x=>x.send).length,1);
 b.config.batch.phase='blocked';b.config.batch.message='需要授权';const count=b.calls.length;await b.ui('permission','query');assert.equal(b.config.batch.phase,'blocked');assert.equal(b.calls.length,count);
});

test('read races during preparation and grading stay retryable, never turn into sample failures',async()=>{
 for(const method of ['prepare','grade']){
  const b=bridge(),request=b.cindy.node.request;let fail=true;
  b.cindy.node.request=async x=>{if(x.method===method&&fail)throw Error('读取身份校验失败(目标 identity 不一致)');return request(x);};
  await b.ui('start','start',args);
  if(method==='grade'){b.cindy.tasks.getTeam=async()=>({ok:true,leadWorking:false,workers:[worker(b)]});await b.ui('grade','query');}
  assert.equal(b.config.batch.phase,'recovering');assert.notEqual(b.config.batch.items[0].status,'blocked');
  fail=false;b.config.batch.retryAt=0;await b.ui('recover','query');assert.equal(b.config.batch.phase,method==='grade'?'completed':'coordinating');assert.equal(b.calls.filter(x=>x.send).length,1);
 }
});

test('public tools cannot grade a caller-supplied terminal receipt',async()=>{
 const b=bridge();await b.tool({type:'tool-call',tool:'grade_run',callId:'forged',args:{runId:'fake',receipt:{channel:'Orca Worker',sessionId:'fake',completedAt:2000}}});assert.equal(b.calls.filter(x=>x.method==='grade').length,0);
});
test('failed terminal releases a single occupied slot and schedules the next sample',async()=>{
 for(const failure of ['error','grade','config']){
  const b=bridge();await b.ui('start','start',{...args,configurations:[configuration,{...configuration,effort:'low'}],concurrency:1});
  const request=b.cindy.node.request;if(failure==='grade')b.cindy.node.request=async x=>{if(x.method==='grade')throw Error('grader failed');return request(x);};
  b.cindy.tasks.getTeam=async()=>({ok:true,leadWorking:false,capacity:{hardLimit:1,remainingSlots:0},workers:[worker(b,{lastTurnEndedAt:2000,...(failure==='error'?{status:'error'}:failure==='config'?{model:'wrong'}:{})})]});
  await b.ui('poll','query');assert.equal(b.config.batch.items[0].status,'blocked');assert.ok(b.config.batch.items[0].terminalReceipt);assert.equal(b.calls.filter(x=>x.releaseWorker).length,1);assert.equal(b.calls.filter(x=>x.method==='coordinator_state').at(-1).params.assignments.length,1);
  await b.ui('again','query');assert.equal(b.calls.filter(x=>x.releaseWorker).length,1);
 }
});
test('ambiguous or active failed workers never release slots',async()=>{
 for(const flags of [{is_working:true},{queued_count:1},{queue_paused:true},{waitingForUser:true},{duplicate:true}]){
  const b=bridge();await b.ui('start','start',args);const w=worker(b,{status:'error',lastTurnEndedAt:2000,...flags});
  b.cindy.tasks.getTeam=async()=>({ok:true,leadWorking:false,workers:flags.duplicate?[w,{...w,worker_id:'other'}]:[w]});await b.ui('poll','query');assert.equal(b.calls.filter(x=>x.releaseWorker).length,0);assert.equal(b.calls.filter(x=>x.method==='grade').length,0);
 }
});

test('stop while inspecting the index prevents all later download and task work',async()=>{
 const b=bridge(),request=b.cindy.node.request;let finish,entered;
 const waiting=new Promise(r=>entered=r),inspect=new Promise(r=>finish=r);
 b.cindy.node.request=async x=>{
  if(x.method==='bank')return {ok:true,result:{questions:[]}};
  if(x.method==='online_inspect'){entered();await inspect;return {ok:true,result:{indexId:'index'}};}
  return request(x);
 };
 b.cindy.downloads={start:async()=>{b.calls.push({download:true});return {ok:true,token:'receipt'};}};
 const start=b.ui('start','start',args);await waiting;
 await b.ui('stop','cancel');finish();await start;
 assert.equal(b.calls.filter(x=>x.download||x.create||['online_plan','online_install'].includes(x.method)).length,0);
 assert.equal(b.config.batch,undefined);
});
test('failure persistence precedes release and a write failure keeps the slot',async()=>{
 for(const reject of [false,true]){
  const b=bridge();await b.ui('start','start',args);const request=b.cindy.node.request;
  b.cindy.node.request=async x=>{if(x.method==='record_failure'&&reject){b.calls.push(x);throw Error('disk unavailable');}return request(x);};
  b.cindy.tasks.getTeam=async()=>({ok:true,leadWorking:false,workers:[worker(b,{status:'error',lastTurnEndedAt:2000})]});
  await b.ui('poll','query');
  const saved=b.calls.findIndex(x=>x.method==='record_failure'),released=b.calls.findIndex(x=>x.releaseWorker);
  assert.ok(saved>=0);assert.equal(b.calls[saved].params.receipt.status,'error');
  if(reject){assert.equal(released,-1);assert.match(b.config.batch.message,/disk unavailable/);}
  else {assert.ok(released>saved);await b.ui('again','query');assert.equal(b.calls.filter(x=>x.method==='record_failure').length,1);}
 }
});

test('all stop terminal statuses settle only after the whole team is inactive',async()=>{
 for(const status of ['completed','failed','cancelled','interrupted']){
  const b=bridge();await b.ui('start','start',args);await b.ui('stop','cancel');await b.ui('query','query');b.runs.get('r1').status=status;
  let active=true;b.cindy.tasks.getTeam=async()=>({ok:true,leadWorking:active,workers:[]});
  await b.ui('active','query');assert.equal(b.config.batch.status,'stopping');
  active=false;await b.ui('inactive','query');assert.equal(b.config.batch.status,'cancelled');
  assert.equal(b.calls.filter(x=>x.method==='grade').length,0);
 }
});
test('author records the exact request before paid dispatch and reuses it after receipt persistence fails',async()=>{
 const b=bridge(),library=b.cindy.library,send=b.cindy.tasks.send;let fail=true;const requests=[];
 b.cindy.library=async x=>{if(x.op==='write'&&JSON.parse(x.content).author?.runId&&fail)return {ok:false,message:'write failed'};return library(x);};
 b.cindy.tasks.send=async x=>{assert.deepEqual(JSON.parse(JSON.stringify(b.config.author.pendingSend)),JSON.parse(JSON.stringify(x)));requests.push(x);return send(x);};
 await b.ui('first','author',{records:[]});assert.equal(b.replies.at(-1).ok,false);assert.equal(b.config.author.status,'sending');
 const id=b.config.author.id;fail=false;await b.ui('retry','author',{id:'different',records:[]});
 assert.equal(b.replies.at(-1).ok,true);assert.equal(b.config.author.id,id);assert.equal(b.calls.filter(x=>x.create).length,1);
 assert.equal(JSON.stringify(requests[0]),JSON.stringify(requests[1]));assert.ok(b.config.author.runId);assert.equal(b.config.author.pendingSend,undefined);
});
test('failure to persist author request prevents paid dispatch',async()=>{
 const b=bridge(),library=b.cindy.library;b.cindy.library=async x=>x.op==='write'&&JSON.parse(x.content).author?{ok:false,message:'write failed'}:library(x);
 await b.ui('author','author',{records:[]});assert.equal(b.replies.at(-1).ok,false);assert.equal(b.calls.filter(x=>x.send).length,0);
});
test('explicit cached online key works offline without querying the default index',async()=>{
 const b=bridge(),request=b.cindy.node.request,key='online:'+ 'a'.repeat(64)+':audio@v2';
 b.cindy.node.request=async x=>{if(x.method==='bank')return {ok:true,result:{questions:[{key,distributionHash:'a'}]}};if(x.method==='online_inspect')throw Error('must not fetch');return request(x);};
 await b.ui('start','start',{...args,questions:[key]});assert.equal(b.replies.at(-1).ok,true);assert.equal(b.config.batch.items[0].question,key);
});
test('default catalog is shared by status and tools, retaining exact score identity',async()=>{
 const standings=require('../standings.js');
 for(const versions of [0,1,2]){
  const b=bridge(),request=b.cindy.node.request;
  const qs=Array.from({length:versions},(_,i)=>({key:'online:release'+i+':audio@v2',questionId:'audio',revision:'v2',releaseHash:'release'+i,distributionHash:'same-files'}));
  b.cindy.node.request=async x=>x.method==='bank'?{ok:true,result:{questions:qs}}:request(x);
  await b.ui('catalog','status');const q=b.replies.at(-1).result.banks[0].questions[0];
  assert.equal(q.key,'audio@v2');assert.equal(q.unresolved,versions>1);
  if(versions===1){assert.equal(standings.questionKey(q),standings.questionKey(qs[0]));assert.equal(standings.aggregate([{...qs[0],model:'m',status:'graded',scoreExact:'1'}],[q]).length,1);}
  else assert.equal(q.releaseHash,undefined);
  await b.tool({type:'tool-call',tool:'list_questions',callId:'catalog'});
  const result=b.calls.find(x=>x.type==='tool-result').result;assert.equal(result.questions.length,versions||1);
  if(versions)assert.equal(JSON.stringify(result.questions),JSON.stringify(qs));else assert.equal(result.questions[0].key,q.key);
  assert.equal(b.calls.some(x=>x.create||x.send||x.method==='online_inspect'),false);
 }
});
test('prepare tool resolves an uninstalled default but retains offline installed keys',async()=>{
 for(const question of ['audio@v2','online:fixture:audio@v2']){
  const b=bridge();await b.tool({type:'tool-call',tool:'prepare_run',callId:'p',args:{question,...configuration}});
  assert.equal(b.calls.find(x=>x.method==='prepare').params.question,'online:fixture:audio@v2');
  assert.equal(b.calls.some(x=>x.method==='online_inspect'),question==='audio@v2');
  assert.equal(b.calls.some(x=>x.create||x.send),false);
 }
});
test('author rejection ends only definitely unaccepted requests; uncertain failures keep the same request',async()=>{
 for(const code of ['REVISION_CONFLICT','TASK_BUSY','PERMISSION_DENIED',undefined]){
  const b=bridge(),send=b.cindy.tasks.send;let first=true,request;
  b.cindy.tasks.send=async x=>{if(first){first=false;request=JSON.stringify(x);throw Object.assign(Error('failed'),{code});}return send(x);};
  await b.ui('a','author',{records:[]});const id=b.config.author.id;
  const definite=['REVISION_CONFLICT','TASK_BUSY'].includes(code);
  assert.equal(b.config.author.status,definite?'failed':'sending');assert.equal(!!b.config.author.pendingSend,!definite);
  await b.ui('b','author',{records:[]});assert.equal(b.replies.at(-1).ok,true);
  assert.equal(b.config.author.id===id,!definite);
  if(!definite)assert.equal(JSON.stringify(b.calls.find(x=>x.send).send),request);
 }
});
test('failed calibration is terminal, visible, and does not run again on polling',async()=>{
 const b=bridge(),request=b.cindy.node.request;let count=0;
 await b.ui('a','author',{records:[]});b.runs.get('r1').status='completed';
 b.cindy.node.request=async x=>{if(x.method==='calibrate'){count++;throw Error('invalid draft');}return request(x);};
 for(const id of ['s1','s2']){await b.ui(id,'status');assert.equal(b.replies.at(-1).result.author.status,'failed');assert.equal(b.replies.at(-1).result.author.error,'invalid draft');}
 assert.equal(count,1);await b.ui('new','author',{records:[]});assert.equal(b.replies.at(-1).ok,true);
});
