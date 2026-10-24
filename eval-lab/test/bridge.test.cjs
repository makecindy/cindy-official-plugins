const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),crypto=require('node:crypto');
const configuration={model:'test-model',harness:'codex',provider:'own-account',effort:'high'};
test('ending failed authoring retains its identity and refuses unknown dispatch or calibration',async()=>{
 for(const mode of ['terminal','running','unknown','pending','calibration']){
  const author={id:'old',revision:'v1',status:'failed',taskId:'task',runId:'run',...(mode==='pending'?{pendingSend:{requestKey:'old'}}:{})},b=bridge({root:'/selected',author});
  b.cindy.tasks.getRun=async()=>mode==='unknown'?undefined:{runId:'run',taskId:'task',status:mode==='running'?'running':'completed'};
  b.cindy.tasks.listRuns=async()=>({items:[await b.cindy.tasks.getRun()]});
  const request=b.cindy.node.request;b.cindy.node.request=async x=>{if(x.method==='calibrate_idle'&&mode==='calibration')throw Error('unknown calibration');return request(x);};
  await b.ui('end','end_author',{id:'old',revision:'v1'});
  const result=b.replies.find(x=>x.id==='end');assert.equal(result.ok,mode==='terminal');
  if(mode==='terminal'){
   assert.equal(b.config.author,null);assert.equal(b.config.authorHistory[0].runId,'run');
   await b.ui('stale','end_author',{id:'old',revision:'v1'});assert.equal(b.replies.find(x=>x.id==='stale').ok,true);
   await b.tool({type:'tool-call',tool:'create_question_draft',callId:'reuse',args:{id:'old',revision:'v1'}});assert.equal(b.config.author,null);
  }else assert.equal(b.config.author.id,'old');
 }
});
test('explicit author calibration retry persists its selected report before Node and recovers lost response',async()=>{
 const b=bridge({root:'/selected',author:{id:'draft',revision:'v1',status:'failed',calibration:{checkId:'previous',ok:false}}}),request=b.cindy.node.request;let lose=true;
 b.cindy.node.request=async x=>{
  if(x.method==='calibrate_begin'){assert.equal(b.config.author.retryFrom,'previous');assert.equal(x.params.retryFrom,'previous');if(lose){lose=false;throw Error('lost');}return {ok:true,result:{checkId:'next'}};}
  if(x.method==='calibrate_finish')return {ok:true,result:{checkId:'next',ok:true}};
  return request(x);
 };
 await b.ui('retry','retry_calibration',{id:'draft',revision:'v1',checkId:'previous'});assert.equal(b.config.author.retryFrom,'previous');
 await b.ui('recover','retry_calibration',{id:'draft',revision:'v1',checkId:'previous'});assert.equal(b.config.author.status,'calibrated');assert.equal(b.config.author.retryFrom,undefined);
});
test('standalone draft retains root and identity across restart until calibration passes',async()=>{
 const b=bridge({root:'/original'});
 await b.tool({type:'tool-call',tool:'create_question_draft',callId:'draft',args:{id:'draft',revision:'v1',records:[{sessionId:'fixture',text:'selected'}]}});
 assert.equal(b.config.author.id,'draft');assert.equal(b.calls.some(x=>x.create||x.send),false);
 const restored=bridge(b.config),request=restored.cindy.node.request;restored.cindy.pick=async()=>({ok:true,path:'/new'});
 await restored.ui('root','setup_root');assert.equal(restored.config.root,'/original');
 for(const entry of ['author','create_question_draft']){
  if(entry==='author')await restored.ui('other','author',{id:'other',revision:'v1'});
  else await restored.tool({type:'tool-call',tool:entry,callId:'other',args:{id:'other',revision:'v1'}});
  assert.equal(restored.config.author.id,'draft');
 }
 let ok=false;restored.cindy.node.request=async x=>x.method==='calibrate_finish'?{ok:true,result:{ok,checkId:'stable'}}:request(x);
 await restored.tool({type:'tool-call',tool:'calibrate_question',callId:'fail',args:{id:'draft',revision:'v1'}});
 assert.equal(restored.config.author.status,'failed');await restored.ui('failed-root','setup_root');assert.equal(restored.config.root,'/original');
 ok=true;await restored.tool({type:'tool-call',tool:'calibrate_question',callId:'pass',args:{id:'draft',revision:'v1'}});
 assert.equal(restored.calls.filter(x=>x.method==='calibrate_begin').every(x=>x.params.root==='/original'),true);
 await restored.ui('allowed','setup_root');assert.equal(restored.config.root,'/new');
});
test('standalone lost draft response retains identity while definite missing input releases it',async()=>{
 const b=bridge({root:'/original'}),request=b.cindy.node.request;
 b.cindy.node.request=async x=>{if(x.method==='draft'){assert.equal(b.config.author.id,'draft');throw Error('response lost');}return request(x);};
 await b.tool({type:'tool-call',tool:'create_question_draft',callId:'draft',args:{id:'draft',revision:'v1'}});
 assert.equal(b.config.author.status,'drafting');b.cindy.pick=async()=>({ok:true,path:'/new'});
 await b.ui('root','setup_root');assert.equal(b.config.root,'/original');
 b.cindy.node.request=async x=>x.method==='draft'?{ok:true,result:{status:'input_required'}}:request(x);
 await b.tool({type:'tool-call',tool:'create_question_draft',callId:'resume',args:{id:'draft',revision:'v1'}});
 assert.equal(b.config.author.status,'failed');await b.ui('released','setup_root');assert.equal(b.config.root,'/new');
});
test('stop after plan publication does not start an idle coordinator',async()=>{
 const b=bridge(),request=b.cindy.node.request;let enter,release;
 const ready=new Promise(r=>enter=r),held=new Promise(r=>release=r);
 b.cindy.tasks.getTeam=async()=>({ok:true,leadWorking:false,workers:[]});
 b.cindy.node.request=async x=>{if(x.method==='coordinator_state'){enter();await held;}return request(x);};
 const start=b.ui('start','start',args);await ready;await b.ui('stop','cancel');release();await start;
 assert.ok(b.config.batch.plan);assert.equal(b.config.batch.status,'cancelled');assert.equal(b.calls.filter(x=>x.send).length,0);
});
test('stop cannot declare unstarted when receipt lookup fails or finds a later page',async()=>{
 for(const mode of ['failure','accepted']){
  const b=bridge(),request=b.cindy.node.request;let enter,release;
  const ready=new Promise(r=>enter=r),held=new Promise(r=>release=r);
  b.cindy.tasks.getTeam=async()=>({ok:true,leadWorking:false,workers:[]});
  b.cindy.tasks.listRuns=async x=>{if(mode==='failure')throw Error('receipt unavailable');return x.after?{items:[{status:'running'}]}:{items:[],nextCursor:'next'};};
  b.cindy.node.request=async x=>{if(x.method==='coordinator_state'){enter();await held;}return request(x);};
  const start=b.ui('start','start',args);await ready;await b.ui('stop','cancel');release();await start;
  assert.notEqual(b.config.batch.status,'cancelled');assert.equal(b.calls.filter(x=>x.send).length,mode==='accepted'?1:0);
 }
});
test('known missing draft input releases authoring without creating a task or replaying the old identity',async()=>{
 const b=bridge({root:'/selected',author:{id:'broken',revision:'v1',status:'drafting'}}),request=b.cindy.node.request;
 b.cindy.node.request=async x=>x.method==='draft'&&x.params.id==='broken'?{ok:true,result:{status:'input_required'}}:request(x);
 await b.ui('resume','author');assert.equal(b.replies.find(x=>x.id==='resume').ok,false);
 assert.equal(b.config.author.status,'failed');assert.equal(b.calls.some(x=>x.create),false);
 await b.ui('new','author',{records:[]});assert.equal(b.replies.find(x=>x.id==='new').ok,true);
 assert.notEqual(b.config.author.id,'broken');
});
test('download cancellation failure still reaches the registered installer',async()=>{
 for(const failure of ['reject','non-ok']){
 const b=bridge(),request=b.cindy.node.request;let enter,release,prepared=false,begins=0;const cancelled=[];
 const ready=new Promise(r=>enter=r),pending=new Promise(r=>release=r);
 b.cindy.downloads.cancel=async()=>{if(failure==='non-ok')return {ok:false,message:'download transport lost'};throw Error('download transport lost');};
 b.cindy.node.request=async x=>{
  if(x.method==='online_begin')return {ok:true,result:{operationId:'install-'+(++begins)}};
  if(x.method==='online_plan')return {ok:true,result:{artifacts:[{sha256:'fixture',url:'https://example.test/a',bytes:1}]}};
  if(x.method==='online_step'){if(!prepared){prepared=true;return {ok:true,result:{done:false,phase:'copy'}};}enter();await pending;return {ok:true,result:{done:true,result:{}}};}
  if(x.method==='online_cancel'){cancelled.push(x.params.operationId);return {ok:true,result:{}};}
  return request(x);
 };
 const install=b.ui('install','online_install',{});await ready;
 await b.ui('cancel','cancel_download');assert.deepEqual(cancelled,['install-1','install-2']);release();await install;assert.equal(b.replies.find(r=>r.id==='cancel').ok,false);
 }
});
test('independent inspect and install pin the selected root until settled',async()=>{
 for(const method of ['online_inspect','online_install']){
  const b=bridge(),request=b.cindy.node.request;let enter,release,picked=0;
  const ready=new Promise(r=>enter=r),pending=new Promise(r=>release=r);
  b.cindy.pick=async()=>{picked++;return {ok:true,path:'/other'};};
  b.cindy.node.request=async x=>{if(x.method===(method==='online_install'?'online_step':method)){enter();await pending;return {ok:true,result:{done:true,result:{}}};}return request(x);};
  const operation=b.ui('operation',method,{});await ready;await b.ui('root','setup_root');
  assert.equal(picked,0);assert.equal(b.config.root,'/selected');release();await operation;
 }
});
test('author draft identity survives a lost reply before any task is created',async()=>{
 const b=bridge(),request=b.cindy.node.request;let first=true;const ids=[];
 b.cindy.node.request=async x=>{if(x.method==='draft'){
  assert.equal(b.config.author.id,x.params.id);ids.push(x.params.id);
  if(first){first=false;throw Error('lost draft reply');}
 }return request(x);};
 await b.ui('first','author',{records:[]});assert.equal(b.replies.find(x=>x.id==='first').ok,false);
 assert.equal(b.calls.some(x=>x.create),false);
 await b.ui('retry','author');assert.equal(b.replies.find(x=>x.id==='retry').ok,true);
 assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);
});
function bridge(initial={root:'/selected'},catalog={ok:true,models:[{id:'test-model',name:'Model',agent:'codex',providerId:'own-account',providerName:'My account',efforts:['low','high'],defaultEffort:'low'}]}){
 let onMessage,bc,cfg=structuredClone(initial);const calls=[],replies=[],runs=new Map(),tasks=new Map();let sequence=0;
 const cindy={downloads:{start:async()=>({ok:true,token:'fixture'})},library:async x=>{if(x.op==='write'){cfg=JSON.parse(x.content);return {ok:true};}return {ok:true,content:JSON.stringify(cfg)};},node:{request:async x=>{calls.push(x);let result={ok:true};if(x.method==='author_stage')result={directory:x.params.workspace+'/author'};if(x.method==='defaults')result={root:'/automatic'};if(x.method==='bank')result={questions:[{key:'online:fixture:audio@v2'}]};if(['online_inspect','online_cached'].includes(x.method))result={indexId:'fixture',questions:[{key:'audio@v2',installedKey:'online:fixture:audio@v2'}]};if(x.method==='online_plan')result={artifacts:[]};if(x.method==='online_begin')result={operationId:'install-fixture'};if(x.method==='online_step')result={done:true,result:{bank:'/bank/fixture',key:'audio@v2'}};if(x.method==='grade'||x.method==='reconcile_result')result={status:'graded',scoreExact:'1'};if(x.method==='record_failure')result={status:'failed',score:null,reason:x.params.reason};if(x.method==='coordinator_state')result={path:'/state.json'};if(x.method==='coordinator_plan')result={workspace:x.params.workspace,path:x.params.workspace+'/plan.json',prompt:'Coordinate the plan.'};if(['runs','drafts'].includes(x.method))result=[];if(x.method==='prepare')result={runId:x.params.runId,workspace:x.params.workspace||'/answers/'+x.params.runId,prompt:'Read TASK.md and verify.'};return {ok:true,result};}},tasks:{
 capabilities:async()=>({operations:['create','send','getRun']}),
 listRuns:async x=>({items:[...runs.values()].filter(r=>r.taskId===x.taskId)}),
 create:async x=>{calls.push({create:x});const task={taskId:'t'+(++sequence),revision:1,resolvedConfig:x.route,workingDir:'/isolated/'+sequence,permissionMode:'auto'};tasks.set(task.taskId,task);return task;},
 setTeamPlan:async x=>{calls.push({setTeamPlan:x});return {ok:true};},releaseWorker:async x=>{calls.push({releaseWorker:x});return {ok:true};},get:async x=>tasks.get(x.taskId),startTeam:async()=>({ok:true,teamId:'team'}),getTeam:async()=>({ok:true,leadWorking:true,workers:[]}),
 send:async x=>{calls.push({send:x});const route=tasks.get(x.taskId)?.resolvedConfig;const run={runId:'r'+sequence,taskId:x.taskId,status:'running',acceptedConfig:route,acceptedAt:1,execution:{instanceId:'native',generation:1}};runs.set(run.runId,run);return run;},
 getRun:async x=>runs.get(x.runId),cancel:async x=>{calls.push({cancel:x});return {status:'cancelled'};}
 },onHostMessage:fn=>onMessage=fn,send:async x=>calls.push(x)};
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../main.js'),'utf8'),{cindy,crypto,fetch:async url=>url==='agent-models'?{ok:catalog.ok,status:catalog.status||200,json:async()=>catalog}:{ok:true,json:async()=>[{key:'audio@v2'}]},BroadcastChannel:class{constructor(){bc=this;}postMessage(x){replies.push(x);}},Map,Error,JSON,Date,Set});
 return {calls,replies,runs,get config(){return cfg;},tool:m=>onMessage(m),ui:(id,action,args={})=>bc.onmessage({data:{type:'request',id,action,args}}),cindy};
}
const args={questions:['audio@v2'],configurations:[configuration]};
test('legacy stop grades a completion that wins cancellation and preserves validation failures',async()=>{
 for(const outcome of ['graded','environment_invalid','wrong-route','missing-execution','grade-error']){
  const b=bridge({root:'/selected',batch:{id:'legacy',status:'running',items:[{runId:'answer',question:'audio@v2',config:configuration,status:'running',task:{taskId:'t'},hostRun:{runId:'host'}}]}});
  b.cindy.tasks.cancel=async()=>({runId:'host',taskId:'t',status:'completed',completedAt:2000,execution:outcome==='missing-execution'?null:{instanceId:'native',generation:1},acceptedConfig:{agentKind:'codex',model:outcome==='wrong-route'?'other':'test-model',providerId:'own-account',effort:'high',fastMode:false}});
  const request=b.cindy.node.request;let grades=0;
  b.cindy.node.request=async x=>{if(x.method==='grade'){grades++;if(outcome==='grade-error')throw Error('grader unavailable');return {ok:true,result:{status:outcome,reason:'environment unavailable',scoreExact:'1'}};}return request(x);};
  await b.ui('stop','cancel');await b.ui('observe','query');
  const item=b.config.batch.items[0];
  if(['graded','environment_invalid'].includes(outcome)){assert.equal(item.status,outcome);assert.equal(b.config.batch.status,'cancelled');assert.equal(grades,1);}
  else{assert.notEqual(item.status,'cancelled');assert.notEqual(b.config.batch.status,'cancelled');assert.equal(grades,outcome==='grade-error'?1:0);}
 }
});
test('legacy completed receipts preserve environment-invalid grades across recovery without regrading',async()=>{
 for(const status of ['environment_invalid','graded']){
  const b=bridge({root:'/selected',batch:{id:'legacy',status:'running',items:[{runId:'answer',question:'audio@v2',config:configuration,status:'running',error:'old error',task:{taskId:'t'},hostRun:{runId:'host'}}]}});
  b.runs.set('host',{runId:'host',taskId:'t',status:'completed',completedAt:2000,acceptedAt:1000,execution:{instanceId:'native',generation:1},acceptedConfig:{agentKind:'codex',model:'test-model',providerId:'own-account',effort:'high',fastMode:false}});
  const request=b.cindy.node.request;let grades=0;
  b.cindy.node.request=async x=>{if(x.method==='grade'){grades++;return {ok:true,result:{status,...(status==='environment_invalid'?{reason:'preflight blocked'}:{scoreExact:'1'})}};}return request(x);};
  await b.ui('recover','query');
  assert.equal(b.config.batch.items[0].status,status);
  assert.equal(b.config.batch.items[0].error,status==='environment_invalid'?'preflight blocked':undefined);
  assert.equal(b.config.batch.status,'completed');
  const recovered=bridge(b.config);await recovered.ui('again','query');await b.ui('again','query');
  assert.equal(grades,1);assert.equal(recovered.calls.some(x=>x.method==='grade'||x.send),false);
  assert.equal(recovered.config.batch.items[0].status,status);
 }
});
test('oversized batches fail before any question download or installation',async()=>{
 const b=bridge();await b.ui('large','start',{questions:Array.from({length:201},(_,i)=>'question-'+i),configurations:[configuration]});
 assert.equal(b.replies.find(x=>x.id==='large').ok,false);
 assert.equal(b.calls.some(x=>['online_inspect','online_plan','online_step','prepare'].includes(x.method)),false);
 assert.equal(b.calls.some(x=>x.create),false);
});
test('legacy partial frozen plans cannot silently resume or acquire omitted members',async()=>{
 const b=bridge({root:'/selected',batch:{id:'old',mode:'coordinator',status:'needs_attention',phase:'blocked',plan:{prompt:'frozen'},registeredPlan:2,items:[{runId:'missing',status:'blocked'}]}});
 await b.ui('resume','resume_coordination');
 assert.equal(b.replies.at(-1).ok,false);assert.match(b.replies.at(-1).message,/计划已冻结/);
 assert.equal(b.config.batch.status,'needs_attention');assert.equal(b.calls.some(x=>x.send||x.setTeamPlan||x.method==='prepare'),false);
});
test('calibration uses one bounded request per control with the same identity and call authority',async()=>{
 const b=bridge(),requests=[];
 b.cindy.node.request=async x=>{requests.push(x);return {ok:true,result:x.method==='calibrate_begin'?{checkId:'same-check'}:x.method==='calibrate_finish'?{checkId:'same-check',ok:true}:{}};};
 await b.tool({type:'tool-call',tool:'calibrate_question',callId:'calibration-call',args:{id:'draft',revision:'v1'}});
 assert.deepEqual(requests.map(x=>x.method),['calibrate_begin','calibrate_step','calibrate_step','calibrate_step','calibrate_finish']);
 assert.deepEqual(requests.slice(1,4).map(x=>x.params.step),[0,1,2]);
 for(const x of requests){assert.equal(x.callId,'calibration-call');assert.equal(x.maxTotalMs,900000);assert.equal(x.params.root,'/selected');}
 for(const x of requests.slice(1))assert.equal(x.params.checkId,'same-check');
 assert.equal(b.calls.at(-1).ok,true);
});
test('stop is durable before installation cancellation fails',async()=>{
 const b=bridge();await b.ui('start','start',args);const request=b.cindy.node.request;let entered,finish;
 const ready=new Promise(r=>entered=r),pending=new Promise(r=>finish=r);
 b.cindy.node.request=async x=>{
  if(x.method==='online_step'){entered();await pending;throw Error('下载已取消');}
  if(x.method==='online_cancel'){assert.equal(b.config.batch.status,'stopping');assert.ok(b.config.batch.stopRequestedAt);throw Error('cancel transport unavailable');}
  return request(x);
 };
 const install=b.ui('install','online_install',{indexId:'fixture',question:'audio@v2'});await ready;
 await b.ui('stop','cancel');assert.equal(b.replies.find(r=>r.id==='stop').ok,false);
 assert.ok(b.config.batch.stopRequestedAt);finish();await install;
});
test('published installation stays successful when cancellation arrives after commit',async()=>{
 const b=bridge(),request=b.cindy.node.request;let entered,finish;
 const ready=new Promise(r=>entered=r),published=new Promise(r=>finish=r);
 b.cindy.node.request=async x=>{
  if(x.method==='online_step'){entered();await published;return {ok:true,result:{done:true,result:{bank:'/bank/fixture',key:'audio@v2'}}};}
  if(x.method==='online_cancel'){finish();return {ok:true,result:{ok:true}};}
  return request(x);
 };
 const install=b.ui('install','online_install',{indexId:'fixture',question:'audio@v2'});await ready;
 await b.ui('stop','cancel_download');await install;assert.equal(b.replies.find(r=>r.id==='install').ok,true);
 assert.equal(b.replies.filter(r=>r.type==='download-progress').at(-1).phase,'ready');
});
test('both stop actions cancel the registered install and wait for cleanup',async()=>{
 for(const action of ['cancel','cancel_download']){
  const b=bridge(),request=b.cindy.node.request;let started,finish,drain;
  const ready=new Promise(r=>started=r),ended=new Promise(r=>finish=r),cleanup=new Promise(r=>drain=r);
  b.cindy.node.request=async x=>{
   if(x.method==='online_step'){assert.equal(x.params.operationId,'install-fixture');started();await ended;await cleanup;throw Error('下载已取消');}
   if(x.method==='online_cancel'){assert.equal(x.params.operationId,'install-fixture');finish();await cleanup;return {ok:true,result:{ok:true}};}
   return request(x);
  };
  const install=b.ui('install','online_install',{indexId:'fixture',question:'audio@v2'});await ready;
  let done=false;const stop=b.ui('stop',action).then(()=>done=true);await Promise.resolve();assert.equal(done,false);
  drain();await stop;await install;assert.equal(b.replies.find(x=>x.id==='install').ok,false);
  assert.equal(b.calls.some(x=>x.create),false);
 }
});
test('prepare tool rejects every invalid model dimension before preparing or downloading',async()=>{
 for(const key of ['model','provider','harness','effort']){
  const b=bridge();await b.tool({type:'tool-call',tool:'prepare_run',callId:'invalid',args:{question:'audio@v2',...configuration,[key]:'unknown'}});
  assert.equal(b.calls.some(x=>['prepare','online_inspect','online_plan'].includes(x.method)),false);
  assert.match(JSON.stringify(b.calls.at(-1)),/模型目录已变化/);
 }
});
test('stopping grades completed submissions before cancellation, including archived lost receipts',async()=>{
 for(const archived of [false,true]){
  const b=bridge(),get=b.cindy.tasks.get;await b.ui('start','start',args);
  b.cindy.tasks.getTeam=async()=>({ok:true,leadWorking:false,workers:[worker(b)]});
  if(archived){b.cindy.tasks.get=async x=>({...await get(x),status:'archived'});b.cindy.tasks.listRuns=async()=>({items:[{status:'completed'}]});}
  await b.ui('stop','cancel');await b.ui('stopping','query');b.runs.get('r1').status='completed';await b.ui('poll','query');
  assert.equal(b.config.batch.status,'cancelled');assert.equal(b.config.batch.items[0].status,'graded');
  assert.equal(b.calls.filter(x=>x.method==='grade').length,1);assert.equal(b.calls.filter(x=>x.releaseWorker).length,1);
  await b.ui('again','query');assert.equal(b.calls.filter(x=>x.method==='grade').length,1);
 }
});
test('diagnostic errors do not block saved grades from releasing their worker',async()=>{
 const b=bridge();await b.ui('start','start',args);const request=b.cindy.node.request;
 b.cindy.node.request=async x=>{if(x.method==='reconcile_result')throw Error('source unavailable');return request(x);};
 b.cindy.tasks.getTeam=async()=>({ok:true,leadWorking:false,workers:[worker(b)]});
 await b.ui('poll','query');assert.equal(b.config.batch.items[0].status,'graded');assert.equal(b.config.batch.items[0].released,true);
 assert.match(b.config.batch.items[0].qualityReviewError,/source unavailable/);assert.equal(b.config.batch.items[0].qualityReviewed,undefined);assert.match(b.replies.find(x=>x.id==='poll').result.items[0].qualityReviewError,/source unavailable/);
 assert.equal(b.calls.filter(x=>x.releaseWorker).length,1);
});
test('failed scoring during stop keeps the completed submission recoverable',async()=>{
 const b=bridge();await b.ui('start','start',args);const request=b.cindy.node.request;let fail=true;
 b.cindy.node.request=async x=>{if(fail&&x.method==='grade')throw Error('disk unavailable');return request(x);};
 b.cindy.tasks.getTeam=async()=>({ok:true,leadWorking:false,workers:[worker(b)]});
 await b.ui('stop','cancel');await b.ui('stopping','query');b.runs.get('r1').status='completed';await b.ui('poll','query');
 assert.equal(b.config.batch.status,'stopping');assert.equal(b.calls.some(x=>x.releaseWorker||x.method==='record_failure'),false);
 fail=false;await b.ui('recover','query');assert.equal(b.config.batch.status,'cancelled');assert.equal(b.config.batch.items[0].status,'graded');
});
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
test('author task receives host-local materials and collects output only after completed receipt',async()=>{
 const b=bridge();await b.ui('author','author',{records:[]});
 const staged=b.calls.find(x=>x.method==='author_stage');assert.equal(staged.params.workspace,'/isolated/1');assert.equal(staged.params.taskId,'t1');
 assert.match(b.calls.find(x=>x.send).send.text,/\/isolated\/1\/author/);
 await b.ui('running','status');assert.equal(b.calls.some(x=>x.method==='author_collect'),false);
 b.runs.get('r1').status='completed';await b.ui('complete','status');
 assert.ok(b.calls.findIndex(x=>x.method==='author_collect')<b.calls.findIndex(x=>x.method==='calibrate_begin'));
 assert.equal(b.config.author.status,'calibrated');
});
test('explicit calibration retries a failed import but never imports a running author task',async()=>{
 const b=bridge();await b.ui('author','author',{records:[]});const request=b.cindy.node.request;let fail=true;
 const args={id:b.config.author.id,revision:'v1'};
 await b.tool({type:'tool-call',tool:'calibrate_question',callId:'early',args});assert.equal(b.calls.at(-1).ok,false);assert.equal(b.calls.some(x=>x.method==='author_collect'),false);
 b.runs.get('r1').status='completed';b.cindy.node.request=async x=>{if(x.method==='author_collect'&&fail)throw Error('handoff disk error');return request(x);};
 await b.ui('complete','status');assert.equal(b.config.author.status,'failed');fail=false;
 await b.tool({type:'tool-call',tool:'calibrate_question',callId:'retry',args});assert.equal(b.calls.at(-1).ok,true);assert.ok(b.calls.some(x=>x.method==='author_collect'));
 assert.equal(b.calls.filter(x=>x.send).length,1);
});
test('one or multiple cached online versions resolve through the configured index before any paid task',async()=>{
 for(const count of [1,2])for(const offline of [true,false]){
  const b=bridge(),request=b.cindy.node.request;let installed=false,inspected=0;
  const keys=['a','b'].map(c=>'online:'+c.repeat(64)+':audio@v2');
  b.cindy.node.request=async x=>{
   if(x.method==='bank')return {ok:true,result:{questions:(installed?keys:keys.slice(0,count)).map((key,i)=>({key,distributionHash:String(i)}))}};
   if(x.method==='online_inspect'){inspected++;assert.equal(b.calls.filter(x=>x.create).length,0);if(offline)throw Error('Offline');return {ok:true,result:{indexId:'current'}};}
   if(x.method==='online_plan')return {ok:true,result:{artifacts:[]}};
   if(x.method==='online_step'){installed=true;assert.equal(x.params.indexId,'current');return {ok:true,result:{done:true,result:{bank:'/bank/'+'b'.repeat(64),key:'audio@v2'}}};}
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
  const b=bridge(),hash='a'.repeat(64),request=b.cindy.node.request;let prepared=false;
  b.cindy.node.request=async x=>{if(x.method==='online_step'&&!prepared){prepared=true;return {ok:true,result:{done:false,phase:'copy'}};}return x.method==='online_plan'?{ok:true,result:{artifacts:[{sha256:hash,bytes:6,url:'https://github.com/file'}]}}:request(x);};
  b.cindy.downloads={start:async()=>modern?{ok:true,token:'host-receipt'}:{ok:true,path:'/private/host/file'},cancel:async()=>({ok:true})};
  await b.ui('download','online_install',{indexId:'index',question:'audio@v2'});
  const call=b.calls.find(x=>x.method==='online_step');
  if(modern){assert.deepEqual({...call.downloadTokens},{['artifact_'+hash]:'host-receipt'});assert.equal(call.params.requireHostDownloads,true);assert.equal(call.params.hostArtifacts,undefined);}
  else {assert.equal(call,undefined);assert.equal(b.replies.at(-1).ok,false);}
 }
});
test('online installation reuses the verified cache without Python planning or downloads',async()=>{
 const b=bridge(),request=b.cindy.node.request;let steps=0;
 b.cindy.downloads=undefined;
 b.cindy.node.request=async x=>{
  if(x.method==='online_plan')throw Error('Python 3 unavailable');
  if(x.method==='online_step')return {ok:true,result:++steps===1?{done:false,phase:'cached'}:{done:true,result:{bank:'/bank/fixture',key:'audio@v2'}}};
  return request(x);
 };
 await b.ui('cached-install','online_install',{});assert.equal(b.replies.find(r=>r.id==='cached-install').ok,true);assert.equal(steps,2);
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
 const saved={status:'graded',scoreExact:'1'};b.config.batch.items[1].status='graded';b.config.batch.items[1].result=saved;b.config.batch.items[1].qualityReviewed=true;
 b.cindy.tasks.getTeam=async()=>({ok:true,leadWorking:false,workers:[]});
 await b.ui('finish','query');assert.equal(b.config.batch.status,'completed');assert.equal(b.config.batch.phase,'completed');
 assert.equal(b.config.batch.items[0].status,'blocked');assert.deepEqual(b.config.batch.items[1].result,saved);
 assert.match(b.config.batch.message,/未运行、未计分/);assert.equal(b.calls.filter(x=>x.setTeamPlan).length,1);
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
test('blocked batches remain paused regardless of old diagnostic text',async()=>{
 for(const message of ['读取身份校验失败(目标 identity 不一致)','需要授权']){
  const b=bridge();await b.ui('start','start',args);b.config.batch.phase='blocked';b.config.batch.message=message;
  const count=b.calls.length;await b.ui('poll','query');assert.equal(b.config.batch.phase,'blocked');assert.equal(b.calls.length,count);
 }
});

test('read races during preparation and grading stay retryable, never turn into sample failures',async()=>{
 for(const method of ['prepare','grade']){
  const b=bridge(),request=b.cindy.node.request;let fail=true;
  b.cindy.node.request=async x=>{if(x.method===(method==='online_install'?'online_step':method)&&fail)throw Error('读取身份校验失败(目标 identity 不一致)');return request(x);};
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
 assert.equal(b.calls.filter(x=>x.download||x.create||['online_plan','online_step'].includes(x.method)).length,0);
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
test('author permission denial preserves one draft and task for later in-page approval',async()=>{
 for(const external of [false,true]){
 const b=bridge(),create=b.cindy.tasks.create;let grant=false;
 b.cindy.tasks.create=async x=>{const task=await create(x);task.permissionMode='plan';return task;};
 b.cindy.tasks.requestWriteAccess=async x=>{
  assert.equal(x.taskId,b.config.author.taskId);assert.equal(x.mode,'auto');
  const task=await b.cindy.tasks.get(x);if(grant){task.permissionMode='auto';task.revision=2;}
  return {granted:grant,task};
 };
 await b.ui('first','author',{records:[]});assert.equal(b.replies.at(-1).ok,false);
 const saved=JSON.parse(JSON.stringify(b.config.author));assert.ok(saved.pendingSend);assert.match(saved.error,/草稿已保存/);
 assert.equal(b.calls.filter(x=>x.send).length,0);
 grant=true;if(external){const task=await b.cindy.tasks.get({taskId:saved.taskId});task.permissionMode='auto';task.revision=2;}
 await b.ui('again','author',{records:[],id:'should-not-create'});
 assert.equal(b.replies.at(-1).ok,true);assert.equal(b.config.author.id,saved.id);
 assert.equal(b.calls.filter(x=>x.create).length,1);
 assert.equal(b.calls.filter(x=>x.send)[0].send.expectedRevision,2);
 assert.equal(b.calls.filter(x=>x.send)[0].send.requestKey,saved.pendingSend.requestKey);
 }
});
test('explicit cached online key works offline without querying the default index',async()=>{
 const b=bridge(),request=b.cindy.node.request,key='online:'+ 'a'.repeat(64)+':audio@v2';
 b.cindy.node.request=async x=>{if(x.method==='bank')return {ok:true,result:{questions:[{key,distributionHash:'a'}]}};if(x.method==='online_inspect')throw Error('must not fetch');return request(x);};
 await b.ui('start','start',{...args,questions:[key]});assert.equal(b.replies.at(-1).ok,true);assert.equal(b.config.batch.items[0].question,key);
});
test('default catalog follows current index rather than counting cached versions',async()=>{
 const standings=require('../standings.js');
 for(const versions of [0,1,2]){
  const b=bridge(),request=b.cindy.node.request;
  const qs=Array.from({length:versions},(_,i)=>({key:'online:release'+i+':audio@v2',questionId:'audio',revision:'v2',releaseHash:'release'+i,distributionHash:'files'+i}));
  const current={key:'audio@v2',installedKey:'online:release1:audio@v2',questionId:'audio',revision:'v2',releaseHash:'release1',distributionHash:'files1'};
  b.cindy.node.request=async x=>x.method==='bank'?{ok:true,result:{questions:qs}}:x.method==='online_cached'?{ok:true,result:{questions:[current]}}:request(x);
  await b.ui('catalog','status');const q=b.replies.at(-1).result.banks[0].questions[0];
  assert.equal(q.unresolved,false);assert.equal(q.releaseHash,'release1');
  assert.equal(standings.aggregate(qs.map(x=>({...x,model:'m',status:'graded',scoreExact:'1'})),[q]).length,versions===2?1:0);
  const local=b.cindy.node.request;b.cindy.node.request=async x=>{if(x.method==='online_inspect')throw Error('must not fetch');return local(x);};
  await b.ui('offline','status');assert.equal(b.replies.at(-1).result.banks[0].questions[0].unresolved,false);
  assert.equal(b.calls.some(x=>x.create||x.send),false);
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
 b.cindy.node.request=async x=>{if(x.method==='calibrate_begin'){count++;throw Error('invalid draft');}return request(x);};
 for(const id of ['s1','s2']){await b.ui(id,'status');assert.equal(b.replies.at(-1).result.author.status,'failed');assert.equal(b.replies.at(-1).result.author.error,'invalid draft');}
 assert.equal(count,1);const author=JSON.stringify(b.config.author);await b.ui('new','author',{records:[]});assert.equal(b.replies.at(-1).ok,false);assert.equal(JSON.stringify(b.config.author),author);
});

test('independent prepare ignores a previous page cancellation',async()=>{
 for(const action of ['cancel','cancel_download']){
  const b=bridge();await b.ui('cancel',action);
  await b.tool({type:'tool-call',tool:'prepare_run',callId:'prepare',args:{question:'audio@v2',...configuration}});
  assert.equal(b.calls.at(-1).ok,true);assert.ok(b.calls.some(x=>x.method==='prepare'));
 }
});
test('lost start receipt is not proof of no dispatch: stop waits for host terminal and team idle',async()=>{
 const b=bridge(),send=b.cindy.tasks.send;let first=true;
 b.cindy.tasks.send=async x=>{const result=await send(x);if(first){first=false;throw Error('transport lost after acceptance');}return result;};
 await b.ui('start','start',args);assert.ok(b.config.batch.plan);assert.equal(b.config.batch.controlRun,undefined);
 await b.ui('cancel','cancel');await b.ui('observe','query');
 assert.equal(b.config.batch.status,'stopping');assert.ok(b.config.batch.controlRun);assert.equal(b.config.batch.stopSent,true);
 const sends=b.calls.filter(x=>x.send);assert.equal(sends.length,2);assert.match(sends[1].send.text,/停止本批评测/);
 b.runs.get(b.config.batch.controlRun.runId).status='completed';
 await b.ui('still-active','query');assert.equal(b.config.batch.status,'stopping');
 b.cindy.tasks.getTeam=async()=>({ok:true,leadWorking:false,workers:[]});
 await b.ui('idle','query');assert.equal(b.config.batch.status,'cancelled');assert.equal(b.calls.filter(x=>x.send).length,2);
});
test('failed automatic calibration leaves the same draft available to the explicit calibration tool',async()=>{
 const b=bridge({root:'/selected',author:{id:'existing-draft',revision:'v1',runId:'done',status:'running'}}),request=b.cindy.node.request;
 b.runs.set('done',{status:'completed'});let failed=true;
 b.cindy.node.request=async x=>{if(x.method==='calibrate_begin'){if(failed)throw Error('temporary disk failure');assert.equal(x.params.id,'existing-draft');return {ok:true,result:{checkId:'retry-check'}};}if(x.method==='calibrate_step')return {ok:true,result:{}};if(x.method==='calibrate_finish')return {ok:true,result:{checkId:'retry-check',ok:true}};return request(x);};
 await b.ui('status','status');assert.equal(b.config.author.status,'failed');failed=false;
 await b.tool({type:'tool-call',tool:'calibrate_question',callId:'retry',args:{id:'existing-draft',revision:'v1'}});
 assert.equal(b.calls.at(-1).ok,true);assert.equal(b.calls.at(-1).result.checkId,'retry-check');assert.equal(b.calls.filter(x=>x.send||x.method==='draft').length,0);
});
test('a lead awaiting confirmation is not a quiescent stopped team',async()=>{
 const b=bridge();await b.ui('start','start',args);await b.ui('stop','cancel');await b.ui('observe','query');
 b.runs.get(b.config.batch.controlRun.runId).status='completed';
 b.cindy.tasks.getTeam=async()=>({ok:true,leadWorking:false,waitingForUser:true,workers:[]});
 await b.ui('waiting','query');assert.equal(b.config.batch.status,'stopping');
});

test('one terminal timestamp drives scoring, failure persistence and slot release',async()=>{
 for(const status of ['done','error'])for(const timestamps of [{completedAt:2000},{completedAt:null,lastTurnEndedAt:3000},{completedAt:2000,lastTurnEndedAt:3000}]){
  const b=bridge();await b.ui('start','start',args);
  b.cindy.tasks.getTeam=async()=>({ok:true,leadWorking:false,workers:[worker(b,{status,...timestamps})]});
  await b.ui('observe','query');const at=timestamps.lastTurnEndedAt||timestamps.completedAt;
  const receipt=b.calls.find(x=>x.method===(status==='done'?'grade':'record_failure')).params.receipt;
  assert.equal(receipt.completedAt,at);assert.equal(b.calls.find(x=>x.releaseWorker).releaseWorker.completedAt,at);
  await b.ui('repeat','query');assert.equal(b.calls.filter(x=>x.releaseWorker).length,1);
 }
});
test('start preserves actionable index errors without dispatching or choosing old cache',async()=>{
 const {downloadError}=require('../node/online.cjs');
 for(const message of [downloadError(403),downloadError(404),'题库索引损坏或不兼容，请检查发布源并重新获取；仍失败请联系题库维护者。','请使用 makecindy GitHub Release 的 HTTPS 附件地址']){
  const b=bridge(),request=b.cindy.node.request;
  b.cindy.node.request=async x=>x.method==='online_inspect'?{ok:false,message}:request(x);
  await b.ui('start','start',args);assert.equal(b.replies.at(-1).ok,false);assert.equal(b.replies.at(-1).message,message);
  assert.equal(b.calls.some(x=>x.create||x.send||x.method==='online_step'),false);
 }
});
test('archived coordinator with lost start response is observed without repeated stop sends',async()=>{
 const b=bridge(),send=b.cindy.tasks.send,get=b.cindy.tasks.get;let archived=false,ended=false,active=true;
 b.cindy.tasks.send=async x=>{if(x.requestKey.endsWith(':stop')){archived=true;throw Object.assign(Error('Archived tasks cannot accept input'),{code:'TASK_BUSY'});}await send(x);throw Error('lost receipt');};
 b.cindy.tasks.get=async x=>({...await get(x),status:archived?'archived':'active'});
 b.cindy.tasks.listRuns=async x=>x.after?{items:[{status:ended?'completed':'running'}],nextCursor:null}:{items:[{status:'completed'}],nextCursor:'second'};
 b.cindy.tasks.getTeam=async()=>({ok:true,leadWorking:active,workers:[]});
 await b.ui('start','start',args);assert.equal(b.config.batch.controlRun,undefined);
 await b.ui('stop','cancel');await b.ui('poll','query');assert.equal(b.config.batch.status,'stopping');
 ended=true;await b.ui('ended','query');assert.equal(b.config.batch.status,'stopping');
 active=false;await b.ui('idle','query');assert.equal(b.config.batch.status,'cancelled');assert.equal(b.calls.filter(x=>x.send).length,1);
});
test('empty or incomplete archived receipts do not prove cancellation',async()=>{
 for(const kind of ['empty','cycle','error']){
  const b=bridge(),get=b.cindy.tasks.get;await b.ui('start','start',args);
  b.cindy.tasks.get=async x=>({...await get(x),status:'archived'});
  b.cindy.tasks.listRuns=async()=>{if(kind==='error')throw Error('read failed');return {items:kind==='empty'?[]:[{status:'completed'}],nextCursor:kind==='cycle'?'same':null};};
  b.cindy.tasks.getTeam=async()=>({ok:true,leadWorking:false,workers:[]});
  await b.ui('stop','cancel');await b.ui('poll','query');assert.equal(b.config.batch.status,'stopping');assert.equal(b.calls.filter(x=>x.send).length,1);
 }
});
test('author creation identity survives lost create replies and receipt persistence failures',async()=>{
 for(const failure of ['reply','save']){
  const b=bridge(),create=b.cindy.tasks.create,library=b.cindy.library;let task,fail=true;const requests=[];
  b.cindy.tasks.create=async request=>{assert.deepEqual(JSON.parse(JSON.stringify(request)),b.config.author.pendingCreate);requests.push(JSON.parse(JSON.stringify(request)));task??=await create(request);if(failure==='reply'&&fail)throw Error('lost reply');return task;};
  b.cindy.library=async x=>x.op==='write'&&JSON.parse(x.content).author?.taskId&&failure==='save'&&fail?{ok:false,message:'disk unavailable'}:library(x);
  await b.ui('first','author',{records:[]});assert.equal(b.replies.at(-1).ok,false);const original=b.config.author.id;assert.equal(b.config.author.status,'creating');
  await b.ui('status','status');assert.equal(b.replies.at(-1).result.author.canResume,true);
  fail=false;await b.ui('retry','author',{id:'different',records:[]});assert.equal(b.replies.at(-1).ok,true);
  assert.equal(b.config.author.id,original);assert.deepEqual(requests[0],requests[1]);assert.equal(b.calls.filter(x=>x.create).length,1);assert.equal(b.calls.filter(x=>x.method==='draft').length,1);assert.equal(b.config.author.pendingCreate,undefined);
 }
});
test('author creation ends proven pre-admission rejection but retains ambiguous failures',async()=>{
 for(const code of ['INVALID_REQUEST','ROUTE_UNAVAILABLE','PERMISSION_DENIED','HOST_NOT_READY','INTERNAL']){
  const b=bridge(),create=b.cindy.tasks.create;let fail=true;
  b.cindy.tasks.create=async request=>{if(fail)throw Object.assign(Error('rejected'),{code});return create(request);};
  await b.ui('first','author',{records:[]});assert.equal(b.replies.at(-1).ok,false);const id=b.config.author.id;
  const rejected=['INVALID_REQUEST','ROUTE_UNAVAILABLE'].includes(code);assert.equal(b.config.author.status,rejected?'failed':'creating');assert.equal(!!b.config.author.pendingCreate,!rejected);
  fail=false;await b.ui('next','author',{records:[],id:'new-draft'});assert.equal(b.replies.at(-1).ok,true);assert.equal(b.config.author.id,rejected?'new-draft':id);
 }
});

test('preflight failure never creates the coordinator or dispatches model work',async()=>{
 const b=bridge(),request=b.cindy.node.request;
 b.cindy.node.request=async x=>{if(x.method==='preflight')throw Error('Python 3 unavailable');return request(x);};
 await b.ui('start','start',args);assert.match(b.config.batch.message,/Python 3/);
 assert.equal(b.calls.some(x=>x.create||x.send||x.setTeamPlan||x.method==='prepare'),false);
});
test('Host workspace and interrupted scheduler save preserve the current frozen plan',async()=>{
 const b=bridge();await b.ui('start','start',args);
 for(const method of ['coordinator_plan','coordinator_state'])assert.equal(b.calls.find(x=>x.method===(method==='online_install'?'online_step':method)).params.workspace,'/isolated/1');
 const j=b.config.batch,plan=JSON.stringify(j.plan);delete j.schedulerVersion;
 await b.ui('poll','query');
 assert.equal(b.calls.filter(x=>x.create).length,1);assert.equal(b.calls.filter(x=>x.setTeamPlan).length,1);
 assert.equal(JSON.stringify(b.config.batch.plan),plan);assert.equal(b.calls.filter(x=>x.method==='coordinator_plan').length,1);
 assert.match(b.calls.filter(x=>x.send).at(-1).send.text,/isolated\/1\/plan.json/);
 const sends=b.calls.filter(x=>x.send).length;await b.ui('poll2','query');assert.equal(b.calls.filter(x=>x.send).length,sends);
 const bad=bridge(),get=bad.cindy.tasks.get;bad.cindy.tasks.get=async x=>({...await get(x),workingDir:undefined});
 await bad.ui('start','start',args);assert.match(bad.config.batch.message,/主任务目录/);assert.equal(bad.calls.some(x=>x.send||x.setTeamPlan),false);
});

test('resumed frozen coordination checks Python before sending more model work',async()=>{
 for(const leadWorking of [false,true]){
 const b=bridge();await b.ui('start','start',args);
 const states=b.calls.filter(x=>x.method==='coordinator_state').length;
 const sends=b.calls.filter(x=>x.send).length,request=b.cindy.node.request;
 b.cindy.tasks.getTeam=async()=>({ok:true,leadWorking,workers:[],capacity:{remainingSlots:1,hardLimit:1}});
 b.cindy.node.request=async x=>{if(x.method==='preflight')throw Error('Python 3 unavailable');return request(x);};
 await b.ui('resume','query');assert.match(b.config.batch.message,/Python 3/);
 assert.equal(b.calls.filter(x=>x.send).length,sends);
 assert.equal(b.calls.filter(x=>x.method==='coordinator_state').length,states);
 // Stopping must remain available when the evaluator is unavailable.
 await b.ui('stop','cancel');await b.ui('stopping','query');assert.equal(b.calls.filter(x=>x.send).length,sends+1);
 assert.match(b.calls.filter(x=>x.send).at(-1).send.requestKey,/:stop$/);
 }
});
test('data root remains bound throughout active authoring and picker races',async()=>{
 for(const status of ['creating','sending','queued','running','completed']){
  const b=bridge({root:'/original',author:{id:'draft',status}});let picks=0;
  b.cindy.pick=async()=>{picks++;return {ok:true,path:'/new',name:'new'};};
  await b.ui('root','setup_root');assert.equal(b.replies.at(-1).ok,false);assert.match(b.replies.at(-1).message,/出题尚未结束/);
  assert.equal(b.config.root,'/original');assert.equal(picks,0);
 }
 const b=bridge({root:'/original'});let select;
 b.cindy.pick=()=>new Promise(resolve=>{select=resolve;});
 const picking=b.ui('root','setup_root');while(!select)await new Promise(resolve=>setImmediate(resolve));
 await b.ui('author','author',{records:[]});select({ok:true,path:'/new',name:'new'});await picking;
 assert.equal(b.replies.find(x=>x.id==='root').ok,false);assert.equal(b.config.root,'/original');
 const done=bridge({root:'/original',author:{status:'calibrated'}});done.cindy.pick=async()=>({ok:true,path:'/new',name:'new'});
 await done.ui('root','setup_root');assert.equal(done.replies.at(-1).ok,true);assert.equal(done.config.root,'/new');
});
test('Python outage does not block recorded results, and ungraded workers retry without release',async()=>{
 for(const scored of [false,true]){
  const b=bridge();await b.ui('start','start',args);const j=b.config.batch;
  const w=worker(b,{lastTurnEndedAt:2000,startedAt:1000,acceptedAt:500});
  b.cindy.tasks.getTeam=async()=>({ok:true,leadWorking:false,workers:[w]});
  if(scored)Object.assign(j.items[0],{status:'graded',result:{status:'graded'},workerId:w.worker_id,taskId:w.session_id});
  const request=b.cindy.node.request;let unavailable=true;
  b.cindy.node.request=async x=>{if(x.method==='preflight'&&unavailable)throw Error('Python 3 unavailable');return request(x);};
  await b.ui('poll','query');
  if(scored){assert.equal(b.config.batch.status,'completed');assert.equal(b.calls.filter(x=>x.releaseWorker).length,1);}
  else{assert.equal(b.config.batch.phase,'recovering');assert.equal(b.calls.some(x=>x.releaseWorker||x.method==='record_failure'),false);unavailable=false;b.config.batch.retryAt=0;await b.ui('retry','query');assert.equal(b.config.batch.status,'completed');assert.equal(b.calls.filter(x=>x.method==='grade').length,1);}
  assert.equal(b.calls.filter(x=>x.send).length,1);
 }
});
test('legacy lost send receipt is read without Python or replay, including stop',async()=>{
 for(const stop of [false,true]){
  const b=bridge({root:'/selected',batch:{id:'legacy',status:'running',items:[{runId:'answer',question:'audio@v2',config:configuration,status:'pending',task:{taskId:'t'},prepared:{workspace:'/answer',prompt:'work'}}]}});
  const run={runId:'accepted',taskId:'t',status:'running',acceptedConfig:{model:'test-model',agentKind:'codex',providerId:'own-account',effort:'high',fastMode:false}};
  b.cindy.tasks.listRuns=async()=>({items:[run],nextCursor:null});b.cindy.tasks.getRun=async()=>run;
  b.cindy.node.request=async()=>{throw Error('Python 3 unavailable');};
  if(stop){await b.ui('stop','cancel');await b.ui('query','query');assert.equal(b.config.batch.status,'cancelled');assert.equal(b.calls.filter(x=>x.cancel).length,1);}
  else{await b.ui('query','query');assert.equal(b.config.batch.items[0].hostRun.runId,'accepted');assert.equal(b.config.batch.items[0].status,'running');}
  assert.equal(b.calls.some(x=>x.send),false);
 }
});
test('unstarted single-task development batches cannot create, prepare, grant or send more work',async()=>{
 for(const phase of ['no task','unprepared','prepared','permission']){
  const item={runId:'answer',question:'audio@v2',config:configuration,status:'pending'};
  if(phase!=='no task')item.task={taskId:'old-task',revision:1,permissionMode:phase==='permission'?'plan':'auto',workingDir:'/answer'};
  if(phase==='prepared')item.prepared={workspace:'/answer',prompt:'old prompt'};
  const b=bridge({root:'/selected',batch:{id:'old',status:'running',items:[item]}});
  b.cindy.tasks.get=async()=>item.task;b.cindy.tasks.requestWriteAccess=async x=>{b.calls.push({grant:x});return {granted:true,task:item.task};};
  await b.ui('poll','query');await b.ui('resume','resume_coordination');await b.ui('grant','allow_write');
  assert.equal(b.replies.at(-1).ok,false);assert.equal(b.config.batch.mode,undefined);
  assert.equal(b.calls.some(x=>x.create||x.send||x.grant||x.method==='prepare'),false);
  assert.equal(JSON.stringify(b.config.batch.items[0]),JSON.stringify(item));
  await b.ui('stop','cancel');await b.ui('stopped','query');assert.equal(b.config.batch.status,'cancelled');
 }
});
test('standalone author calls release the in-flight guard but retain unfinished draft ownership',async()=>{
 for(const tool of ['create_question_draft','calibrate_question','freeze'])for(const fail of [false,true]){
  const b=bridge({root:'/original'});let entered,release;const ready=new Promise(r=>entered=r),held=new Promise(r=>release=r);const request=b.cindy.node.request;
  b.cindy.node.request=async x=>{if(['draft','calibrate_begin','freeze'].includes(x.method)){entered();await held;if(fail)throw Error('write failed');}return request(x);};
  b.cindy.pick=async()=>({ok:true,path:'/new'});
  const work=b.tool({type:'tool-call',tool,callId:'tool',args:{id:'draft',revision:'v1'}});await ready;
  await b.ui('root','setup_root');assert.equal(b.replies.at(-1).ok,false);assert.equal(b.config.root,'/original');
  release();await work;await b.ui('root2','setup_root');assert.equal(b.replies.at(-1).ok,tool!=='create_question_draft');
 }
});
test('recoverable failed author stays bound until explicit calibration succeeds',async()=>{
 const b=bridge({root:'/original',author:{id:'draft',revision:'v1',runId:'done',status:'failed'}});
 b.cindy.pick=async()=>({ok:true,path:'/new'});
 await b.ui('blocked','setup_root');assert.equal(b.replies.at(-1).ok,false);
 await b.tool({type:'tool-call',tool:'calibrate_question',callId:'retry',args:{id:'draft',revision:'v1'}});
 assert.equal(b.config.author.status,'calibrated');await b.ui('allowed','setup_root');assert.equal(b.config.root,'/new');
});
test('one ungraded worker cannot prevent releasing another already scored worker during Python outage',async()=>{
 const b=bridge();await b.ui('start','start',{...args,configurations:[configuration,{...configuration,effort:'low'}]});
 const j=b.config.batch,w=worker(b,{lastTurnEndedAt:2000});
 const second=j.items[1],w2={...w,label:'eval-'+second.runId.replaceAll('-','').slice(0,27),worker_id:'w2',session_id:'s2',effort:'low',working_dir:second.prepared.workspace};
 Object.assign(second,{status:'graded',result:{status:'graded'},workerId:'w2',taskId:'s2'});
 b.cindy.tasks.getTeam=async()=>({ok:true,leadWorking:false,workers:[w,w2]});
 const request=b.cindy.node.request;b.cindy.node.request=async x=>{if(x.method==='preflight')throw Error('Python 3 unavailable');return request(x);};
 await b.ui('poll','query');assert.equal(b.config.batch.phase,'recovering');
 assert.deepEqual(b.calls.filter(x=>x.releaseWorker).map(x=>x.releaseWorker.workerId),['w2']);
 assert.equal(b.config.batch.items[0].status,'completed');assert.equal(b.calls.some(x=>x.method==='record_failure'),false);
});
test('pre-plan and old-plan preparation recover without freezing omitted items',async()=>{
 for(const upgrade of [false,true]){
  const b=bridge();await b.ui('start','start',args);const j=b.config.batch;
  if(upgrade){j.registeredPlan=1;delete j.items[0].prepared.authorizationScope;}else{delete j.plan;delete j.items[0].prepared;}
  const request=b.cindy.node.request;let unavailable=true;
  b.cindy.node.request=async x=>{if(x.method==='preflight'&&unavailable)throw Error('Python 3 unavailable');return request(x);};
  await b.ui('poll','query');assert.equal(b.config.batch.phase,'recovering');assert.notEqual(b.config.batch.items[0].status,'blocked');
  unavailable=false;b.config.batch.retryAt=0;await b.ui('recovered','query');assert.notEqual(b.config.batch.phase,'recovering');assert.ok(b.config.batch.plan);
 }
});
test('root changes distinguish terminal author failure from completed work awaiting calibration',async()=>{
 for(const status of ['failed','cancelled','interrupted','completed','running']){
  const b=bridge({root:'/original',author:{id:'draft',runId:'host',status:'failed'}});
  b.cindy.tasks.getRun=async()=>({status});b.cindy.pick=async()=>({ok:true,path:'/new'});
  await b.ui('root','setup_root');assert.equal(b.replies.at(-1).ok,['failed','cancelled','interrupted'].includes(status));
 }
});
test('both calibration entrypoints retain failed reports and protect root until verified success',async()=>{
 for(const automatic of [false,true]){
  const b=bridge({root:'/original',author:{id:'draft',revision:'v1',runId:'done',status:automatic?'running':'failed'}});
  b.cindy.tasks.getRun=async()=>({status:'completed'});b.cindy.pick=async()=>({ok:true,path:'/new'});
  const request=b.cindy.node.request;let ok=false;
  b.cindy.node.request=async x=>x.method==='calibrate_finish'?{ok:true,result:{ok,checkId:'stable'}}:request(x);
  if(automatic)await b.ui('poll','status');else await b.tool({type:'tool-call',tool:'calibrate_question',callId:'failed',args:{id:'draft',revision:'v1'}});
  assert.equal(b.config.author.status,'failed');assert.equal(b.config.author.calibration.ok,false);assert.match(b.config.author.error,/校准未通过/);
  await b.ui('blocked','setup_root');assert.equal(b.replies.at(-1).ok,false);assert.equal(b.config.root,'/original');
  ok=true;await b.tool({type:'tool-call',tool:'calibrate_question',callId:'retry',args:{id:'draft',revision:'v1'}});
  assert.equal(b.config.author.status,'calibrated');assert.equal(b.config.author.error,null);
  await b.ui('allowed','setup_root');assert.equal(b.config.root,'/new');
 }
});
test('page and tool exports use Host locale with safe English fallback',async()=>{
 for(const locale of ['zh-CN','en','ja',null])for(const entry of ['page','tool']){
  const b=bridge();b.cindy.request=async request=>{assert.equal(request.kind,'app-context');if(locale===null)throw Error('unavailable');return {context:{locale}};};
  b.cindy.library=async()=>({ok:true,content:JSON.stringify({root:'/selected'})});
  const request=b.cindy.node.request;b.cindy.node.request=async x=>x.method==='export'?(b.calls.push(x),{ok:true,result:{html:'report',name:'report.html'}}):request(x);
  if(entry==='page')await b.ui('export','export',{runIds:['r'],locale:'untrusted'});
  else await b.tool({type:'tool-call',tool:'export_report',callId:'export',args:{runIds:['r'],locale:'untrusted'}});
  assert.equal(b.calls.find(x=>x.method==='export').params.locale,locale==='zh-CN'?'zh-CN':'en');
 }
});

test('all draft creation entries preserve failed but recoverable author ownership',async()=>{
 for(const entry of ['author','create_question_draft'])for(const kind of ['handoff','calibration','lookup']){
  const author={id:'old',revision:'v1',status:'failed',taskId:'t-old',runId:'r-old',handoff:true,...(kind==='calibration'?{calibration:{ok:false,checkId:'old-check'}}:{})};
  const b=bridge({author}),before=JSON.stringify(b.config.author);
  b.cindy.tasks.getRun=async()=>{if(kind==='lookup')throw Error('unknown run');return {status:'completed'};};
  if(entry==='author')await b.ui('new','author',{id:'new',revision:'v1',records:[]});
  else await b.tool({type:'tool-call',tool:entry,callId:'new',args:{id:'new',revision:'v1',records:[]}});
  assert.equal(JSON.stringify(b.config.author),before);assert.equal(b.calls.some(x=>x.method==='draft'||x.create||x.send),false);
 }
});

test('default history sources use exact index URL or current installed key, not matching question IDs',async()=>{
 const url='https://github.com/makecindy/eval-bank/releases/download/v1/index.json',b=bridge({indexUrl:url}),request=b.cindy.node.request;
 const q=(tag,sourceIndexUrl)=>({key:'online:'+tag+':audio@v2',questionId:'audio',revision:'v2',sourceKey:tag,sourceIndexUrl});
 const questions=[q('old',url),q('current','https://github.com/makecindy/other/releases/download/v1/index.json'),q('foreign','https://github.com/makecindy/eval-bank/releases/download/v2/index.json'),{...q('imported'),key:'imported:a:audio@v2'}];
 b.cindy.node.request=async x=>x.method==='bank'?{ok:true,result:{questions}}:x.method==='online_cached'?{ok:true,result:{questions:[{key:'audio@v2',questionId:'audio',installedKey:questions[1].key}]}}:request(x);
 await b.ui('sources','status');const defaults=b.replies.at(-1).result.banks[0];assert.deepEqual(Array.from(defaults.questions[0].sourceKeys),['old','current']);
});

test('installed current default stays available as an explicit offline bank',async()=>{
 const b=bridge(),request=b.cindy.node.request,key='online:current:audio@v2';let inspected=0;
 b.cindy.node.request=async x=>{
  if(x.method==='bank')return {ok:true,result:{questions:[{key,title:'Audio installed',questionId:'audio',distributionHash:'current'}]}};
  if(x.method==='online_cached')return {ok:true,result:{questions:[{key:'audio@v2',installedKey:key}]}};
  if(x.method==='online_inspect'){inspected++;throw Error('offline');}
  return request(x);
 };
 await b.ui('catalog','status');const bank=b.replies.find(r=>r.id==='catalog').result.banks.find(b=>b.id===key);assert.ok(bank);
 await b.ui('start','start',{...args,questions:bank.questions.map(q=>q.key)});assert.equal(b.replies.find(r=>r.id==='start').ok,true);assert.equal(inspected,0);assert.equal(b.config.batch.items[0].question,key);
});

test('invalid draft identifiers never persist a pending author or reach Node',async()=>{
 for(const entry of ['author','create_question_draft'])for(const field of ['id','revision'])for(const invalid of ['space id','a/b','a'.repeat(97)]){
  const b=bridge(),params={id:'valid',revision:'v1',[field]:invalid,records:[]};
  if(entry==='author')await b.ui('invalid',entry,params);else await b.tool({type:'tool-call',tool:entry,callId:'invalid',args:params});
  assert.equal(b.config.author,undefined);assert.equal(b.calls.some(x=>x.method==='draft'||x.create||x.send),false);
 }
});
test('installer cleanup failure cannot override a published installation',async()=>{
 const b=bridge(),request=b.cindy.node.request;
 b.cindy.node.request=async x=>x.method==='online_cancel'?{ok:false,message:'cleanup unavailable'}:request(x);
 await b.ui('install','online_install',{});assert.equal(b.replies.find(r=>r.id==='install').ok,true);assert.equal(b.replies.filter(r=>r.type==='download-progress').at(-1).phase,'ready');
});
test('download cancellation failure still advances coordinator stop without status polling',async()=>{
 const b=bridge();await b.ui('start','start',args);const request=b.cindy.node.request;let enter,release,prepared=false;
 const ready=new Promise(r=>enter=r),held=new Promise(r=>release=r);
 b.cindy.node.request=async x=>{if(x.method==='online_step'){if(!prepared){prepared=true;return {ok:true,result:{done:false,phase:'copy'}};}enter();await held;return {ok:true,result:{done:true,result:{}}};}return request(x);};
 b.cindy.downloads.cancel=async()=>({ok:false,message:'cancel unavailable'});
 // Keep the download id live through unpacking.
 const prior=b.cindy.node.request;b.cindy.node.request=async x=>x.method==='online_plan'?{ok:true,result:{artifacts:[{sha256:'x',url:'https://example.test/a',bytes:1}]}}:prior(x);
 const install=b.ui('install','online_install',{});await ready;
 await b.ui('stop','cancel');release();await install;
 assert.ok(b.calls.some(x=>x.send?.requestKey.endsWith(':stop')));assert.equal(b.replies.find(r=>r.id==='stop').ok,false);
});

test('failure recording applies a recovered assessment before releasing the worker',async()=>{
 for(const status of ['graded','environment_invalid','failed']){
  const b=bridge();await b.ui('start','start',args);const request=b.cindy.node.request;
  const result={status,score:status==='graded'?1:null,scoreExact:status==='graded'?'1':null};
  b.cindy.node.request=async x=>{if(x.method==='grade')throw Error('response lost');if(x.method==='record_failure')return {ok:true,result};return request(x);};
  b.cindy.tasks.getTeam=async()=>({ok:true,leadWorking:false,workers:[worker(b)]});
  await b.ui('poll','query');const item=b.config.batch.items[0];assert.equal(item.status,status==='failed'?'blocked':status);assert.deepEqual(item.result,result);assert.equal(item.released,true);
 }
});

test('each copy and extraction step receives the same Host tokens and unchanged Node deadline',async()=>{
 const b=bridge(),request=b.cindy.node.request;let steps=0,prepared=false;
 b.cindy.node.request=async x=>{
  if(x.method==='online_plan')return {ok:true,result:{artifacts:[{sha256:'a'.repeat(64),url:'https://example.test/bank.zip',bytes:10}]}};
  if(x.method==='online_step'){
   if(!prepared){prepared=true;assert.equal(x.downloadTokens,undefined);return {ok:true,result:{done:false,phase:'copy'}};}
   assert.equal(x.downloadTokens['artifact_'+'a'.repeat(64)],'fixture');assert.equal(x.maxTotalMs,900000);
   assert.equal(x.params.operationId,'install-fixture');steps++;
   return {ok:true,result:steps<4?{done:false,phase:'extract'}:{done:true,result:{bank:'/bank/fixture',key:'audio@v2'}}};
  }return request(x);
 };
 await b.ui('install','online_install',{});assert.equal(steps,4);assert.equal(b.replies.find(x=>x.id==='install').ok,true);
});
test('released completed workers recover saved grading evidence without redispatch',async()=>{
 const b=bridge();await b.ui('start','start',args);const request=b.cindy.node.request;let fail=true;
 b.cindy.node.request=async x=>{if(x.method==='grade'&&fail)throw Error('本地评分中断，请恢复评测以重新评分；已有作答保留，不会重新调用模型。');return request(x);};
 b.cindy.tasks.getTeam=async()=>({ok:true,leadWorking:false,workers:[worker(b)]});
 await b.ui('first','query');const before=b.config.batch.items[0];assert.equal(before.released,true);assert.equal(before.status,'blocked');
 fail=false;b.cindy.tasks.getTeam=async()=>({ok:true,leadWorking:false,workers:[]});
 const creates=b.calls.filter(x=>x.create).length,sends=b.calls.filter(x=>x.send).length;await b.ui('again','resume_coordination');assert.equal(b.config.batch.items[0].status,'graded');assert.equal(b.calls.filter(x=>x.create).length,creates);assert.equal(b.calls.filter(x=>x.send).length,sends);
});
test('incompatible selected storage never replaces the previously saved root',async()=>{
 const b=bridge(),request=b.cindy.node.request;
 b.cindy.pick=async()=>({ok:true,path:'/unsupported',name:'Unsupported'});
 b.cindy.node.request=async x=>x.method==='validate_storage'?{ok:false,message:'此目录不支持评测记录所需的硬链接，请改选支持硬链接的本地目录；已有文件保留。'}:request(x);
 await b.ui('pick','setup_root');assert.equal(b.replies.find(x=>x.id==='pick').ok,false);assert.equal(b.config.root,'/selected');
});
test('ended author identities remain read-only through the check-only freeze entry',async()=>{
 const b=bridge({root:'/selected',authorHistory:[{id:'old',revision:'v1'}]}),request=b.cindy.node.request;
 b.cindy.node.request=async x=>x.method==='drafts'?{ok:true,result:[{id:'old',revision:'v1',checkId:'old-check',passed:true}]}:request(x);
 await b.ui('freeze','freeze',{checkId:'old-check'});assert.equal(b.replies.find(x=>x.id==='freeze').ok,false);assert.equal(b.calls.some(x=>x.method==='freeze'),false);
});
test('question listing retains both installed offline and default update entries',async()=>{
 const b=bridge();await b.tool({type:'tool-call',tool:'list_questions',callId:'list',args:{}});
 const result=b.calls.find(x=>x.type==='tool-result'&&x.callId==='list');assert.equal(result.ok,true);
 const keys=result.result.questions.map(x=>x.key);assert.ok(keys.includes('audio@v2'));assert.ok(keys.includes('online:fixture:audio@v2'));
 for(const question of ['audio@v2','online:fixture:audio@v2']){const start=b.calls.length;await b.tool({type:'tool-call',tool:'prepare_run',callId:question,args:{question,...configuration}});assert.equal(b.calls.slice(start).some(x=>x.method==='online_inspect'),question==='audio@v2');}
});
test('terminal slots remain recoverable until release succeeds or Host no longer lists them',async()=>{
 for(const mode of ['completed','blocked','stopping','absent']){
  const b=bridge();await b.ui('start','start',args);let releases=0,grades=0,absent=false;
  const request=b.cindy.node.request;b.cindy.node.request=async x=>{if(x.method==='grade'){grades++;if(mode==='blocked')throw Error('grader failed');}return request(x);};
  b.cindy.tasks.getTeam=async()=>({ok:true,leadWorking:false,workers:absent?[]:[worker(b)]});
  b.cindy.tasks.releaseWorker=async()=>({ok:++releases>1,message:'temporarily occupied'});
  if(mode==='stopping'){b.config.batch.status='stopping';b.config.batch.stopSent=true;b.cindy.tasks.getRun=async()=>({status:'completed'});}
  await b.ui('first','query');assert.ok(!['completed','cancelled'].includes(b.config.batch.status));assert.equal(b.config.batch.qualityVersion,undefined);assert.equal(releases,1);
  const sent=b.calls.filter(x=>x.send).length;
  if(mode==='absent')absent=true;
  await b.ui('retry','query');assert.equal(releases,mode==='absent'?1:2);
  assert.equal(b.config.batch.status,mode==='blocked'?'needs_attention':mode==='stopping'?'cancelled':'completed');
  assert.equal(b.calls.filter(x=>x.send).length,sent);if(mode!=='blocked')assert.equal(grades,1);
 }
});
test('released mismatched workers never enter local regrading on resume',async()=>{
 for(const change of [{model:'wrong'},{agent_kind:'claude'},{effort:'low'},{providerId:'wrong'},{fastMode:true},{working_dir:'/wrong'}]){
  const b=bridge();await b.ui('start','start',args);const request=b.cindy.node.request;let grades=0;
  b.cindy.node.request=async x=>{if(x.method==='grade')grades++;if(x.method==='reconcile_result')return {ok:true,result:{status:'failed',score:null}};return request(x);};
  b.cindy.tasks.getTeam=async()=>({ok:true,leadWorking:false,workers:[worker(b,change)]});
  await b.ui('mismatch','query');assert.equal(b.config.batch.items[0].released,true);
  b.cindy.tasks.getTeam=async()=>({ok:true,leadWorking:false,workers:[]});
  await b.ui('resume','resume_coordination');assert.equal(grades,0);assert.equal(b.config.batch.items[0].status,'blocked');assert.equal(b.config.batch.items[0].result.score,null);
 }
});

test('Host download outlives the Node operation map without losing installation or cancellation',async()=>{
 for(const cancel of [false,true]){
  const b=bridge(),request=b.cindy.node.request,ops=new Set(),cancelled=[];let begins=0,downloaded=false;
  b.cindy.node.request=async x=>{
   if(x.method==='online_begin'){const operationId='op-'+(++begins);ops.add(operationId);return {ok:true,result:{operationId}};}
   if(x.method==='online_cancel'){cancelled.push(x.params.operationId);ops.delete(x.params.operationId);return {ok:true,result:{}};}
   if(x.method==='online_plan')return {ok:true,result:{artifacts:[{sha256:'a'.repeat(64),url:'https://example.test/a',bytes:1}]}};
   if(x.method==='online_step'){assert.ok(ops.has(x.params.operationId),'operation must belong to the current Node process');return {ok:true,result:downloaded?{done:true,result:{bank:'/bank'}}:{done:false,phase:'copy'}};}
   return request(x);
  };
  b.cindy.downloads.cancel=async()=>({ok:true});
  b.cindy.downloads.start=async()=>{assert.deepEqual([...ops],[],'probe must be cleaned before the Host wait');ops.clear();downloaded=true;if(cancel)await b.ui('stop-download','cancel_download');return {ok:true,token:'opaque'};};
  await b.ui('install-after-idle','online_install',{});
  assert.equal(b.replies.find(x=>x.id==='install-after-idle').ok,!cancel);
  if(cancel)assert.equal(b.replies.find(x=>x.id==='stop-download').ok,true);
  assert.equal(begins,cancel?1:2);assert.deepEqual(cancelled,cancel?['op-1']:['op-1','op-2']);
 }
});

test('status exposes damaged custom bank as an actionable row and keeps history',async()=>{
 const b=bridge(),request=b.cindy.node.request;
 b.cindy.node.request=async x=>x.method==='bank'?{ok:true,result:{questions:[],errors:[{id:'custom',message:'Custom manifest damaged'}]}}:x.method==='runs'?{ok:true,result:[{runId:'saved',score:1}]}:request(x);
 await b.ui('damaged-custom','status');const reply=b.replies.find(x=>x.id==='damaged-custom');assert.equal(reply.ok,true);assert.equal(reply.result.banks.find(x=>x.id==='custom').error,'Custom manifest damaged');assert.equal(reply.result.runs[0].runId,'saved');
});
