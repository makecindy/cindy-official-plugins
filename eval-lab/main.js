const workerLabel=runId=>'eval-'+runId.replaceAll('-','').slice(0,27);
// Coordinator owns Orca dispatch. The plugin only prepares, observes and grades.
async function coordinatorMessage(j,text,key){
 const task=await cindy.tasks.get({taskId:j.coordinator.taskId});
 if(key!=='stop'&&(await config()).batch?.stopRequestedAt)throw Error('EVAL_STOP_REQUESTED');
 const run=await cindy.tasks.send({taskId:task.taskId,expectedRevision:task.revision,requestKey:j.id+':'+key,text});
 j.controlRun=run;await saveBatch(j);return run;
}
// Approval refusal/timeout is a pause condition, never a retry signal.
async function coordinatorApprovalBlocked(j){
 if(!cindy.tasks.readMessages)return false;
 let after=j.messageCursor,blocked=false;
 for(let page=0;page<4;page++){
  const result=await cindy.tasks.readMessages({taskId:j.coordinator.taskId,limit:100,...(after?{after}:{})});
  for(const m of result.items||[]){
   if(m.role==='tool_result'&&m.createdAt>(j.approvalAcknowledgedAt||0)&&typeof m.content==='string'&&m.content.trim()==='<tool_use_error>user rejected MCP tool call</tool_use_error>')blocked=true;
  }
  if(!result.nextCursor)break;
  after=result.nextCursor;j.messageCursor=after;
 }
 if(blocked){j.phase='blocked';j.message='主任务的工具授权未完成或已拒绝，自动催办已暂停。请打开评测主任务处理授权，再继续协调；已有成绩保留。';await saveBatch(j);}
 return blocked;
}
async function advanceCoordinator(j){
 try{
  if(j.stopRequestedAt&&(!j.controlRun||!j.stopSent))return await stopBatch(j);
  if(!cindy.tasks.startTeam||!cindy.tasks.getTeam)throw Error('请更新 Cindy 以使用主任务协调评测');
  if(!j.coordinator){
   j.coordinator=await cindy.tasks.create({requestKey:j.id+':coordinator',title:'评测主任务 · '+j.items.length+' 份作答',route:taskRoute(j.items[0].config),isolatedWorkspace:true});
   await saveBatch(j);
  }
  j.coordinator=await cindy.tasks.get({taskId:j.coordinator.taskId});
  if(j.coordinator.permissionMode!=='auto'){j.phase='permission';j.message='启用 Auto 自动审批后，主任务和 Worker 将按此权限继续评测。';await saveBatch(j);return jobView(j);}
  if(!j.team){
   j.phase='coordinating';await saveBatch(j);
   const team=await cindy.tasks.startTeam({taskId:j.coordinator.taskId});
   if(!team.ok)throw Error(team.message||'协同模式尚未就绪');
   j.team=team.teamId;await saveBatch(j);
  }
  if(!j.plan){
   j.phase='preparing';await saveBatch(j);
   for(const item of j.items.filter(x=>!doneItem(x))){
    if(!item.prepared){try{item.prepared=await node('prepare',{question:item.question,...item.config,batchId:j.id,runId:item.runId,executionChannel:'Orca Worker'});delete item.error;item.status='pending';}catch(e){if(isTransientReadError(e))throw e;item.status='blocked';item.error='作答准备失败：'+e.message;}await saveBatch(j);}
   }
   if(!j.items.some(x=>!doneItem(x)&&x.prepared))throw Error('没有可开始的作答，请检查题包准备错误');
   j.plan=await node('coordinator_plan',{id:j.id,capacity:j.capacity,coordinatorUsage:j.coordinatorUsage,concurrency:j.concurrency??null,items:j.items.filter(x=>!doneItem(x)&&x.prepared).map(x=>({label:workerLabel(x.runId),runId:x.runId,config:x.config,workspace:x.prepared.workspace,prompt:x.prepared.prompt}))});
   await saveBatch(j);
  }
  if(j.registeredPlan!==2){
   for(const item of j.items.filter(x=>x.prepared&&!x.prepared.authorizationScope)){item.prepared=await node('prepare',{question:item.question,...item.config,batchId:j.id,runId:item.runId,executionChannel:'Orca Worker'});}
   if(!cindy.tasks.setTeamPlan)throw Error('请更新 Cindy 以使用带并发保护的评测');
   await cindy.tasks.setTeamPlan({taskId:j.coordinator.taskId,plan:{concurrency:j.concurrency??null,task:j.plan.prompt,items:j.items.filter(x=>x.prepared&&(j.registeredPlan||!doneItem(x))).map(x=>({label:workerLabel(x.runId),workingDir:x.prepared.workspace,route:taskRoute(x.config),task:x.prepared.authorizationScope||x.prepared.prompt}))}});
   j.registeredPlan=2;await saveBatch(j);
  }
  const team=await cindy.tasks.getTeam({taskId:j.coordinator.taskId});
  if(!team.ok)throw Error('无法核对协同状态');
  j.capacity=team.capacity;j.coordinatorUsage=team.coordinatorUsage;
  for(const item of j.items){const w=team.workers.find(w=>w.label===workerLabel(item.runId));if(w)item.telemetry={acceptedAt:w.acceptedAt,startedAt:w.startedAt,completedAt:w.lastTurnEndedAt||w.completedAt,timingBasis:w.timingBasis,usage:w.usage};}
  if(team.waitingForUser){j.phase='awaiting_confirmation';j.message='评测主任务正在等待你的确认。请在侧栏打开评测主任务处理确认；插件不会代替你批准或自动催办。';await saveBatch(j);return jobView(j);}
  if(j.status!=='stopping'&&await coordinatorApprovalBlocked(j))return jobView(j);
  if(j.status==='stopping'){
   const stopRun=await cindy.tasks.getRun({runId:j.controlRun.runId});
   if(stopRun.status==='completed'&&!team.leadWorking&&!team.workers.some(w=>w.is_working||w.queued_count)){j.status='cancelled';j.phase='cancelled';j.message='评测已停止，已完成成绩保留。';for(const item of j.items.filter(x=>!doneItem(x)))item.status='cancelled';}
   else {j.phase='stopping';j.message='等待主任务停止回执；未确认前不会开始新批次。';}
   await saveBatch(j);return jobView(j);
  }
  for(const item of j.items.filter(x=>!doneItem(x))){
   const matches=team.workers.filter(w=>w.label===workerLabel(item.runId));
   if(matches.length>1){item.status='blocked';item.error='同一作答出现多个 Worker，需主任务核对，不自动计分';continue;}
   const w=matches[0];if(!w)continue;
   item.workerId=w.worker_id;item.taskId=w.session_id;
   const cfg=taskRoute(item.config);
   if(w.model!==cfg.model||w.agent_kind!==cfg.agentKind||(w.effort||'default')!==cfg.effort||w.providerId!==cfg.providerId||w.fastMode!==false||w.working_dir!==item.prepared.workspace){
    item.status='blocked';item.error='Worker 实际配置或目录不匹配，未计分';continue;
   }
   if(w.completedAt&&w.status==='done'&&!w.is_working&&!w.queued_count&&!w.queue_paused&&!w.waitingForUser){
    j.phase='grading';j.currentRunId=item.runId;await saveBatch(j);channel.postMessage({type:'job-progress',job:jobView(j)});
    try{item.result=await node('grade',{runId:item.runId,receipt:{channel:'Orca Worker',sessionId:w.session_id,workerId:w.worker_id,...item.telemetry,completedAt:item.telemetry.completedAt,acceptedConfig:cfg,provenance:'host-team-observed'}});item.status=item.result.status==='environment_invalid'?'environment_invalid':'graded';item.error=item.result.reason||undefined;}
    catch(e){if(isTransientReadError(e))throw e;item.status='blocked';item.error='评分受阻：'+e.message;}
   }else if(w.status==='error'){item.status='blocked';item.error='Worker 异常结束，保留作答，未计分';}
   else {item.status=w.waitingForUser?'awaiting_confirmation':w.queue_paused?'queue_paused':w.is_working?'running':w.queued_count?'queued':'pending';item.waitReason=w.waitingForUser?'等待自动审批或用户确认':w.queue_paused?'队列已暂停':w.is_working?'模型正在执行':w.queued_count?'宿主排队中':'等待终态核对';}
  }
  delete j.currentRunId;
  // Reconcile historical assessments before releasing their sessions; never delete raw grades.
  for(const item of j.items.filter(x=>doneItem(x)||x.status==='blocked')){
   if(item.result&&!item.qualityReviewed){item.result=await node('reconcile_result',{runId:item.runId,receipt:item.telemetry});item.status=item.result.status==='environment_invalid'?'environment_invalid':item.status;item.error=item.result.reason||undefined;item.qualityReviewed=true;await saveBatch(j);}
   const matches=team.workers.filter(w=>w.label===workerLabel(item.runId));
   const w=matches.length===1?matches[0]:null;
   if(w&&(item.result||item.status==='blocked')&&!item.released&&w.worker_id===item.workerId&&w.session_id===item.taskId&&w.lastTurnEndedAt&&!w.is_working&&!w.queued_count&&!w.queue_paused&&!w.waitingForUser){
    // Persist the failure and exact observed terminal before freeing its slot.
    item.terminalReceipt={workerId:w.worker_id,sessionId:w.session_id,completedAt:w.lastTurnEndedAt,status:w.status};await saveBatch(j);
    const release=await cindy.tasks.releaseWorker({taskId:j.coordinator.taskId,workerId:w.worker_id,completedAt:w.lastTurnEndedAt});
    if(release.ok){item.released=true;await saveBatch(j);}else item.releaseReason=release.message;
   }
  }
  const activeWorkers=team.workers.filter(w=>w.is_working||w.queued_count||w.waitingForUser);
  const pending=j.items.filter(x=>!doneItem(x)&&x.prepared&&x.status!=='blocked'&&!team.workers.some(w=>w.label===workerLabel(x.runId)));
  const limit=j.concurrency??team.capacity?.hardLimit??1;
  const available=Math.max(0,Math.min(limit-activeWorkers.length,(team.capacity?.remainingSlots??1)+j.items.filter(x=>x.released&&team.workers.some(w=>w.worker_id===x.workerId)).length));
  const assignments=pending.slice(0,available).map(x=>({label:workerLabel(x.runId),runId:x.runId,config:x.config,workspace:x.prepared.workspace,prompt:x.prepared.prompt}));
  const schedule=await node('coordinator_state',{id:j.id,assignments,active:activeWorkers.map(w=>({label:w.label,workerId:w.worker_id})),settled:j.items.filter(doneItem).map(x=>({label:workerLabel(x.runId),status:x.status})),capacity:{limit,available}});
  for(const item of pending)item.waitReason=available?'等待主任务派发':'等待可用 Worker 槽位';
  if(!j.controlRun){await coordinatorMessage(j,j.plan.prompt,'start');j.schedulerVersion=2;j.scheduleSignature=JSON.stringify(assignments.map(x=>x.label));}
  else if(j.schedulerVersion!==2){if(pending.length||activeWorkers.length)await coordinatorMessage(j,'改用程序调度清单：每次创建前读取 '+JSON.stringify(schedule.path)+'，仅派发 assignments，禁止重建 active/settled。插件确认交卷和评分后自动释放槽位；保留现有作答，不自行归档或重新作答。','scheduler-v2');j.schedulerVersion=2;}
  else if(!team.leadWorking&&assignments.length){
   const signature=JSON.stringify(assignments.map(x=>x.label));
   if(signature!==j.scheduleSignature||Date.now()-(j.lastCheckAt||0)>120000){
    if(signature===j.scheduleSignature&&(j.checks||0)>=3){j.phase='blocked';j.message='派发尚未确认，已暂停自动催办；现有作答保留。';await saveBatch(j);return jobView(j);}
    j.checks=signature===j.scheduleSignature?(j.checks||0)+1:0;j.scheduleSignature=signature;j.lastCheckAt=Date.now();j.checkSequence=(j.checkSequence||0)+1;
    await coordinatorMessage(j,'读取最新调度清单 '+JSON.stringify(schedule.path)+'，核对现有 label 后只派发 assignments。容量不足等待回报；不要重发 active/settled。','schedule-'+j.checkSequence);
   }
  }
  if(j.items.every(doneItem)&&!activeWorkers.length&&!team.leadWorking){j.status='completed';j.phase='completed';j.qualityVersion=1;j.message=j.items.some(x=>x.status==='environment_invalid')?'本批已结束；环境受阻的作答不计入正式总分。':'';}
  else if(j.items.every(x=>doneItem(x)||x.status==='blocked')&&!activeWorkers.length&&!team.leadWorking){j.status='needs_attention';j.phase='blocked';j.message='部分作答受阻，已有成绩已保存。';}
  else {j.phase=activeWorkers.length?'answering':'coordinating';j.message='主任务按调度清单并行派发，交卷后独立评分并释放槽位。';}
  delete j.retryAt;delete j.readRetryCount;await saveBatch(j);
 }catch(e){if(e.message==='EVAL_STOP_REQUESTED')return stopBatch(j);await recordBatchError(j,e);}
 return jobView(j);
}

const channel=new BroadcastChannel('eval-lab');
const inflight=new Map();
async function checked(p){const r=await p;if(!r||!r.ok)throw Error(r?.message||r?.errorCode||'Host request failed');return r;}
const isTransientReadError=e=>e?.message==='读取身份校验失败(目标 identity 不一致)';
let configQueue=Promise.resolve();
function withConfigLock(fn){const work=configQueue.then(fn);configQueue=work.catch(()=>{});return work;}
async function readConfigUnlocked(){
 for(let attempt=0;attempt<3;attempt++){
  const r=await cindy.library({op:'read',path:'settings.json'});
  if(r.ok)return JSON.parse(r.content);
  if(r.errorCode==='NOT_FOUND')return {};
  const error=Error(r.message||'Library unavailable');
  if(!isTransientReadError(error)||attempt===2)throw error;
 }
}
function config(){return withConfigLock(readConfigUnlocked);}
async function saveConfig(x){await checked(cindy.library({op:'write',path:'settings.json',content:JSON.stringify(x)}));}
function updateConfig(change){return withConfigLock(async()=>{const c=await readConfigUnlocked();const next=await change(c);await saveConfig(next);return next;});}
async function recordBatchError(j,e){
 if(isTransientReadError(e)){
  j.readRetryCount=(j.readRetryCount||0)+1;j.retryAt=Date.now()+Math.min(60000,5000*2**Math.min(j.readRetryCount-1,4));
  j.phase='recovering';j.message='进度读取暂时冲突，正在自动恢复；已有作答和成绩保留。';
 }else {j.phase='blocked';j.message=e.message;}
 await saveBatch(j);
}
async function readyConfig(){const c=await config();if(c.root)return c;const saved=await updateConfig(c=>c.root||c.profile?c:{...c,profile:crypto.randomUUID()});if(saved.root)return saved;const r=await checked(cindy.node.request({method:'defaults',params:{profile:saved.profile},timeoutMs:30000}));return {...saved,root:r.result.root,automaticRoot:true};}
async function node(method,args={},callId){const c=await readyConfig();const r=await checked(cindy.node.request({method,params:{...args,root:c.root,bank:c.bank,importedBanks:c.importedBanks||[]},...(callId?{callId}:{}),timeoutMs:120000,maxTotalMs:900000}));return r.result;}
const DEFAULT_INDEX='https://github.com/makecindy/eval-bank/releases/download/eval-bank-20260925/index.json';
const defaultCatalog=fetch('bank/catalog.json').then(r=>{if(!r.ok)throw Error('Default catalog unavailable');return r.json();});
function progress(message){channel.postMessage({type:'progress',message});}
let downloadCancelled=false,downloadBusy=false,activeDownload=null;
async function installQuestion(args){
 if(downloadBusy)throw Error('题库正在准备，请稍候');
 if(!cindy.downloads?.start)throw Error('请更新 Cindy 开发版以使用题库下载');
 downloadBusy=true;downloadCancelled=false;
 try{
 const plan=await node('online_plan',args),hostArtifacts={};
 for(const a of plan.artifacts){
  if(downloadCancelled)throw Error('下载已取消');
  activeDownload='bank-'+a.sha256;
  const r=await checked(cindy.downloads.start({id:activeDownload,url:a.url,sha256:a.sha256,bytes:a.bytes}));
  hostArtifacts[a.sha256]=r.path;
 }
 if(downloadCancelled)throw Error('下载已取消');
 channel.postMessage({type:'download-progress',phase:'unpacking'});
 const result=await node('online_install',{...args,hostArtifacts});
 if(downloadCancelled)throw Error('下载已取消');
 channel.postMessage({type:'download-progress',phase:'ready'});
 return result;
 }catch(e){channel.postMessage({type:'download-progress',phase:downloadCancelled?'cancelled':'failed'});throw e;}
 finally{downloadBusy=false;activeDownload=null;}
}
async function resolveQuestions(wanted){const c=await readyConfig();const available=(await node('bank')).questions;const resolved=[];let remote;for(const key of wanted){if(launchCancelled&&launching)throw Error('已停止准备。');const local=available.find(q=>q.key===key)||available.find(q=>(q.key.startsWith('online:')||q.key.startsWith('imported:'))&&q.key.endsWith(':'+key));if(local){resolved.push(local.key);continue;}if(!remote){progress('正在准备默认题库…');try{remote=await node('online_inspect',{url:c.indexUrl||DEFAULT_INDEX});}catch(e){throw Error('题库暂时无法获取，请稍后重试。请检查网络；已有离线题库可在高级设置中导入。');}}progress('正在下载并校验：'+key);const installed=await installQuestion({indexId:remote.indexId,question:key});const after=(await node('bank')).questions;const q=after.find(q=>q.key==='online:'+installed.bank.split(/[\\/]/).pop()+':'+installed.key);if(!q)throw Error('Downloaded question unavailable');resolved.push(q.key);}return resolved;}
async function readModels(){
 const r=await fetch('agent-models');
 if(r.status===404)throw Error('当前 Cindy 版本不支持模型目录，请升级后重试。');
 if(!r.ok)throw Error('模型目录暂时不可用，请刷新重试。');
 const data=await r.json();if(!data.ok||!Array.isArray(data.models))throw Error('模型目录暂时不可用，请刷新重试。');
 return data.models.map(m=>({model:m.id,label:m.name,visible:m.visible!==false,harness:m.agent,provider:m.providerId,providerLabel:m.providerName,efforts:m.efforts.length?m.efforts:['default'],defaultEffort:m.defaultEffort}));
}
async function taskCapability(){
 if(!cindy.tasks?.create)throw Error('当前 Cindy 不支持普通任务接口，请使用配套开发版。');
 const cap=await cindy.tasks.capabilities();
 if(!cap.operations.includes('getRun'))throw Error('任务接口尚未就绪。');
}
function taskRoute(c){return {agentKind:c.harness==='claude-code'?'cc':c.harness,providerId:c.provider,model:c.model,effort:c.effort,fastMode:false};}
const doneItem=x=>['graded','failed','cancelled','environment_invalid'].includes(x.status);
function jobView(j){if(!j)return null;return {id:j.id,capacity:j.capacity,coordinatorUsage:j.coordinatorUsage,concurrency:j.concurrency??null,coordinatorTaskId:j.coordinator?.taskId,currentRunId:j.currentRunId,status:j.status,phase:j.phase||'preparing',total:j.items.length,finished:j.items.filter(doneItem).length,message:j.message||'',items:j.items.map(x=>({question:x.question,model:x.config.model,effort:x.config.effort,harness:x.config.harness,provider:x.config.provider,status:x.status,taskId:x.task?.taskId||x.taskId,runId:x.runId,error:x.error,waitReason:x.waitReason,telemetry:x.telemetry,released:x.released}))};}
async function saveBatch(j){let stopped=false;await updateConfig(c=>{if(c.batch?.id!==j.id)throw Error('评测批次已变化');if(c.batch.stopRequestedAt){j.stopRequestedAt=c.batch.stopRequestedAt;stopped=!['stopping','cancelled'].includes(j.status);}return {...c,batch:j};});channel.postMessage({type:'job-progress',job:jobView(j)});if(stopped)throw Error('EVAL_STOP_REQUESTED');}
async function stopBatch(j){
 if(j.mode!=='coordinator'){
  j.status='stopping';j.phase='stopping';await saveBatch(j);
  let pending=false;for(const item of j.items.filter(x=>!doneItem(x))){
   if(item.hostRun){const run=await cindy.tasks.cancel({runId:item.hostRun.runId,requestKey:j.id+':stop:'+item.runId});if(!['completed','failed','cancelled','interrupted'].includes(run.status)){pending=true;continue;}}
   item.status='cancelled';
  }
  j.status=pending?'stopping':'cancelled';j.phase=j.status;j.message=pending?'等待任务停止回执；已完成成绩保留。':'评测已停止，已完成成绩保留。';await saveBatch(j);return jobView(j);
 }
 if(!j.controlRun){j.status='cancelled';j.phase='cancelled';j.message='已停止准备，没有派发新的作答。';for(const i of j.items.filter(x=>!doneItem(x)))i.status='cancelled';await saveBatch(j);return jobView(j);}
 j.status='stopping';j.phase='stopping';j.message='正在停止评测，已完成的作答和成绩保留。';await saveBatch(j);
 if(!j.stopSent){await coordinatorMessage(j,'用户要求停止本批评测。停止派发新题；通过 Orca 停止本批仍在执行的 Worker，保留已完成结果与文件，并报告停止结果。','stop');j.stopSent=true;await saveBatch(j);}
 return jobView(j);
}
let advancing=null;
function advanceBatch(){if(advancing)return advancing;advancing=advanceBatchOnce().finally(()=>{advancing=null;});return advancing;}
async function advanceBatchOnce(){
 const j=(await config()).batch;if(!j||(!['running','stopping'].includes(j.status)&&!(j.mode==='coordinator'&&j.status==='completed'&&!j.qualityVersion)))return jobView(j);
 if(j.mode==='coordinator'){
  // Recover only the known read race from older installed versions; permission pauses stay paused.
  if(j.phase==='blocked'&&isTransientReadError({message:j.message})){j.phase='recovering';j.retryAt=0;j.message='正在自动恢复进度核对，已有作答和成绩保留。';}
  if(j.phase==='recovering'&&j.status!=='stopping'&&Date.now()<(j.retryAt||0))return jobView(j);
  if(j.phase==='blocked'&&j.status!=='stopping')return jobView(j);
  return advanceCoordinator(j);
 }
 if(j.stopRequestedAt)return stopBatch(j);
 const item=j.items.find(x=>!doneItem(x));if(!item){j.status='completed';await saveBatch(j);return jobView(j);}
 try{
  await taskCapability();
  if(!item.task){j.mode='coordinator';await saveBatch(j);return advanceCoordinator(j);}
  if(!item.hostRun&&cindy.tasks.get)item.task=await cindy.tasks.get({taskId:item.task.taskId});
  if(item.task.permissionMode==='plan'){j.phase='permission';j.message='需要允许 AI 修改作答文件。确认后继续这一批，无需重新开始。';await saveBatch(j);return jobView(j);}
  j.message='';j.phase='preparing';await saveBatch(j);
  if(!item.prepared){if(!item.task.workingDir)throw Error('宿主未返回独立作答目录');item.prepared=await node('prepare',{question:item.question,...item.config,batchId:j.id,runId:item.runId,workspace:item.task.workingDir,executionChannel:'Cindy task'});await saveBatch(j);}
  if(!item.hostRun){item.hostRun=await cindy.tasks.send({taskId:item.task.taskId,requestKey:j.id+':send:'+item.runId,expectedRevision:item.task.revision,text:item.prepared.prompt});item.status=item.hostRun.status;await saveBatch(j);}
  const run=await cindy.tasks.getRun({runId:item.hostRun.runId});
  if(run.taskId!==item.task.taskId)throw Error('执行回执与任务不匹配');
  const route=taskRoute(item.config);if(Object.keys(route).some(k=>run.acceptedConfig?.[k]!==route[k]))throw Error('实际执行配置与所选模型不一致，未计分');
  item.status=run.status;j.phase=run.status==='running'?'answering':run.status==='queued'?'queued':run.status==='reconciling'?'reconciling':'preparing';
  if(run.status==='completed'){
   if(!run.execution||!run.completedAt)throw Error('完成回执缺少执行身份，暂不评分');
   j.phase='grading';await saveBatch(j);channel.postMessage({type:'job-progress',job:jobView(j)});
   item.result=await node('grade',{runId:item.runId,receipt:{channel:'Cindy task',sessionId:run.taskId,runId:run.runId,completedAt:new Date(run.completedAt).toISOString(),acceptedAt:run.acceptedAt,execution:run.execution,acceptedConfig:run.acceptedConfig,outputMessageId:run.outputMessageId}});
   item.status='graded';delete item.error;
  }else if(['failed','cancelled','interrupted'].includes(run.status)){item.status=run.status==='cancelled'?'cancelled':'failed';item.error=run.error||'任务结束但未完成交卷，未计分';}
  else if(run.status==='reconciling'){item.error='宿主正在核对执行结果；不会重复发送，也不会计为零分。';}
  j.message=item.error||'';
  if(j.items.every(doneItem))j.status='completed';
  delete j.retryAt;delete j.readRetryCount;await saveBatch(j);
 }catch(e){if(e.message==='EVAL_STOP_REQUESTED')return stopBatch(j);await recordBatchError(j,e);}
 return jobView(j);
}
let authorChecking=false;
async function checkAuthor(){
 if(authorChecking)return;const a=(await config()).author;if(!a||['calibrated','failed'].includes(a.status))return;
 authorChecking=true;try{const r=await cindy.tasks.getRun({runId:a.runId});a.status=r.status;if(r.status==='completed'){a.calibration=await node('calibrate',{id:a.id,revision:a.revision});a.status='calibrated';}else if(['failed','cancelled','interrupted'].includes(r.status))a.status='failed';await updateConfig(c=>({...c,author:a}));}catch(e){await updateConfig(c=>({...c,author:{...a,error:e.message}}));}finally{authorChecking=false;}
}
let launching=false,launchCancelled=false;
async function action(name,args={},callId){
 if(launching&&['setup_root','setup_bank','save_source'].includes(name))throw Error('评测正在准备，完成后可更改设置');
 if(name==='setup_root'||name==='setup_bank'){const r=await checked(cindy.pick({mode:'directory',title:name==='setup_root'?'选择评测数据保存目录':'选择解压后的评测题包目录'}));if(r.cancelled)return {cancelled:true};if(name==='setup_root')await updateConfig(c=>({...c,root:r.path}));else {await checked(cindy.node.request({method:'bank',params:{root:(await readyConfig()).root,bank:r.path},timeoutMs:30000}));await updateConfig(c=>({...c,importedBanks:[...(c.importedBanks||[]).filter(b=>b.path!==r.path),{id:crypto.randomUUID(),name:r.name||'导入题库',path:r.path}]}));}return {name:r.name};}
 if(name==='status'){await checkAuthor();let models=[],modelError=null;try{models=await readModels();}catch(e){modelError=e.message;}void advanceBatch().catch(()=>{});const c=await readyConfig();const job=jobView(c.batch);const bank=await node('bank');const defaults=(await defaultCatalog).map(d=>{const matches=bank.questions.filter(q=>q.key===d.key||(q.key.startsWith('online:')&&q.key.endsWith(':'+d.key)));const identities=new Set(matches.map(q=>q.distributionHash));return {...d,...(identities.size===1?matches[0]:{}),key:d.key,unresolved:identities.size>1};});const extra=bank.questions.filter(q=>!defaults.some(d=>q.key===d.key||(q.key.startsWith('online:')&&q.key.endsWith(':'+d.key))));return {configured:true,models,modelError,modelsUpdatedAt:modelError?null:new Date().toISOString(),automaticRoot:!c.root||c.automaticRoot,bank:{questions:[...defaults,...extra]},banks:[{id:'default',name:'Cindy 实战题库',questions:defaults},...(c.importedBanks||[]).map(b=>({id:'imported:'+b.id,name:b.name,questions:bank.questions.filter(q=>q.key.startsWith('imported:'+b.id+':'))})),...extra.filter(q=>!q.key.startsWith('imported:')).map(q=>({id:q.key,name:(c.draftNames||{})[q.key.split('@')[0].replace('custom:','')]||q.title,questions:[q]}))],runs:await node('runs'),drafts:await node('drafts'),job:job||c.job||null,indexUrl:c.indexUrl||DEFAULT_INDEX};}
 if(name==='save_source'){await updateConfig(c=>({...c,indexUrl:args.url}));return {ok:true};}
 if(name==='start'){
  if(launching)throw Error('评测正在准备，请勿重复启动');launching=true;launchCancelled=false;
  try{
   await taskCapability();const current=await config();if(['running','stopping'].includes(current.batch?.status))throw Error('已有评测正在运行，请先等待或停止。');
   if(!Array.isArray(args.questions)||!args.questions.length)throw Error('至少选择一道题');
   const models=await readModels();const configurations=args.configurations;
   if(!Array.isArray(configurations)||!configurations.length)throw Error('请选择模型和强度');
   const chosen=[...new Map(configurations.map(x=>{const row=models.find(m=>m.model===x.model&&m.harness===x.harness&&m.provider===x.provider&&m.efforts.includes(x.effort));if(!row)throw Error('模型目录已变化，请重新读取并选择');const c={model:row.model,harness:row.harness,provider:row.provider,effort:x.effort};return [JSON.stringify(c),c];})).values()];
   const questions=await resolveQuestions([...new Set(args.questions)]);if(questions.length*chosen.length>200)throw Error('单批最多 200 份作答，请分批运行');
   const concurrency=args.concurrency??null;if(concurrency!==null&&(!Number.isInteger(concurrency)||concurrency<1))throw Error('同时作答数必须为正整数');
   if(launchCancelled)return {id:'preparation',status:'cancelled',phase:'cancelled',total:0,finished:0,items:[],message:'已停止准备。'};
   const batch={concurrency,id:crypto.randomUUID(),mode:'coordinator',status:'running',createdAt:new Date().toISOString(),items:questions.flatMap(question=>chosen.map(config=>({runId:crypto.randomUUID(),question,config,status:'pending'})))};
   await updateConfig(c=>({...c,batch}));if(launchCancelled){batch.stopRequestedAt=Date.now();await updateConfig(c=>({...c,batch}));return stopBatch(batch);}progress('题库已就绪，正在创建独立任务…');return await advanceBatch();
  }finally{launching=false;}
 }
 if(name==='allow_write'){
  if(advancing)await advancing;
  const j=(await config()).batch,item=j?.mode==='coordinator'?{task:j.coordinator}:j?.items.find(x=>!doneItem(x));
  if(j?.status!=='running'||!item?.task||item.hostRun)throw Error('当前批次已变化，请刷新');
  if(!cindy.tasks.requestWriteAccess)throw Error('请更新 Cindy 以使用页面内授权');
  const result=await cindy.tasks.requestWriteAccess({taskId:item.task.taskId,...(j.mode==='coordinator'?{mode:'auto'}:{})});
  if(!result.granted)return jobView(j);
  item.task=result.task;if(j.mode==='coordinator')j.coordinator=result.task;j.phase='preparing';j.message='';await saveBatch(j);
  return advanceBatch();
 }
 if(name==='resume_coordination'){
  const j=(await config()).batch;if(j?.mode!=='coordinator')return advanceBatch();
  j.checks=0;j.lastCheckAt=0;j.approvalAcknowledgedAt=Date.now();j.phase='coordinating';j.status='running';await saveBatch(j);return advanceBatch();
 }
 if(name==='cancel'){
  launchCancelled=true;downloadCancelled=true;if(activeDownload)void cindy.downloads.cancel({id:activeDownload}).catch(()=>{});
  const current=(await config()).batch;
  if(!current||!['running','stopping','needs_attention'].includes(current.status))return launching?{id:'preparation',status:'cancelled',phase:'cancelled',total:0,finished:0,items:[],message:'已停止准备。'}:jobView(current);
  const saved=await updateConfig(c=>{if(c.batch?.id!==current.id)throw Error('评测批次已变化');return {...c,batch:{...c.batch,stopRequestedAt:Date.now(),status:'stopping',phase:'stopping',message:'已收到停止请求，正在结束当前操作；不再准备后续题目。'}};});
  const job=jobView(saved.batch);channel.postMessage({type:'job-progress',job});
  if(!advancing)void stopBatch(saved.batch).catch(e=>progress('停止未完成：'+e.message));return job;
 }
 if(name==='cancel_download'){downloadCancelled=true;if(activeDownload)await cindy.downloads.cancel({id:activeDownload});return {ok:true};}
 if(name==='online_install')return installQuestion(args);
 if(name==='online_inspect')return node(name,args,callId);
 if(name==='freeze')return node('freeze',args,callId);
 if(name==='query')return advanceBatch();
 if(name==='export'){const r=await node('export',args,callId);const rel='exports/'+Date.now()+'-report.html';await checked(cindy.library({op:'write',path:rel,content:r.html}));const saved=await checked(cindy.library({op:'saveAs',path:rel,name:r.name}));return {saved:!saved.cancelled,path:rel};}
 if(name==='author'){
  await taskCapability();const draftId=args.id||'question-'+Date.now();const revision=args.revision||'v1';
  const d=await node('draft',{...args,id:draftId,revision},callId);
  if(typeof args.name==='string')await updateConfig(c=>({...c,draftNames:{...c.draftNames,[draftId]:args.name.slice(0,60)}}));
  const task=await cindy.tasks.create({requestKey:'author:'+draftId+':'+revision,title:'评测工坊 · 创建题目',isolatedWorkspace:true});
  if(task.permissionMode==='plan')throw Error('出题草稿已保存。请在插件详情允许修改文件后继续出题。');
  const run=await cindy.tasks.send({taskId:task.taskId,requestKey:'author-send:'+draftId+':'+revision,expectedRevision:task.revision,text:'仅处理 '+JSON.stringify(d.directory)+' 中用户选定的记录，按 AUTHOR_TASK.md 创建题包。完成后运行验证并报告。不运行待测模型，不把聊天私密数据放进公开候选题。'});
  await updateConfig(c=>({...c,author:{id:draftId,revision,taskId:task.taskId,runId:run.runId,status:run.status}}));return {taskId:task.taskId,status:run.status};
 }
 const map={list_questions:'bank',prepare_run:'prepare',list_runs:'runs',export_report:'export',create_question_draft:'draft',calibrate_question:'calibrate'};
 if(!map[name])throw Error('Unknown action');return node(map[name],args,callId);
}
channel.onmessage=async({data:m})=>{if(m?.type!=='request'||typeof m.id!=='string')return;if(!inflight.has(m.id)){inflight.set(m.id,action(m.action,m.args).then(result=>({ok:true,result}),e=>({ok:false,message:e.message})));if(inflight.size>200)inflight.delete(inflight.keys().next().value);}channel.postMessage({type:'response',id:m.id,...await inflight.get(m.id)});};
cindy.onHostMessage(async msg=>{if(msg.type==='event'&&msg.name==='download-progress'){if(msg.data?.id===activeDownload)channel.postMessage({type:'download-progress',...msg.data});return;}if(msg.type!=='tool-call')return;try{const result=await action(msg.tool,msg.args,msg.callId);await cindy.send({type:'tool-result',callId:msg.callId,ok:true,result});}catch(e){await cindy.send({type:'tool-result',callId:msg.callId,ok:false,errorCode:'EVALUATION_ERROR',message:e.message});}});
