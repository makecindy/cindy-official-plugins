function applyAssessment(item,result,fallback='graded'){
 item.result=result;item.status=result.status==='environment_invalid'?'environment_invalid':fallback;item.error=result.reason||undefined;
}
async function settleWorkers(j,team){
  let unavailable;
  for(const item of j.items.filter(x=>x.released&&x.status==='blocked'&&x.terminalReceipt?.status==='done'&&acceptedWorkerConfig(x,x.terminalReceipt.acceptedConfig,x.terminalReceipt.workingDir))){
   try{applyAssessment(item,await node('grade',{runId:item.runId,receipt:{...item.terminalReceipt,channel:'Orca Worker'}}));}
   catch(e){if(isTransientReadError(e))throw e;item.error='评分受阻：'+e.message;}
  }
  for(const item of j.items){const w=team.workers.find(w=>w.label===workerLabel(item.runId));if(w)item.telemetry={acceptedAt:w.acceptedAt,startedAt:w.startedAt,completedAt:workerCompletedAt(w),timingBasis:w.timingBasis,usage:w.usage};}
  for(const item of j.items.filter(x=>!doneItem(x)&&!x.released)){
   const matches=team.workers.filter(w=>w.label===workerLabel(item.runId));
   if(matches.length>1){item.status='blocked';item.error='同一作答出现多个 Worker，需主任务核对，不自动计分';continue;}
   const w=matches[0];if(!w)continue;
   item.workerId=w.worker_id;item.taskId=w.session_id;
   const cfg=taskRoute(item.config);
   if(!acceptedWorkerConfig(item,{model:w.model,agentKind:w.agent_kind,effort:w.effort||'default',providerId:w.providerId,fastMode:w.fastMode},w.working_dir)){
    item.status='blocked';item.error='Worker 实际配置或目录不匹配，未计分';continue;
   }
   if(workerCompletedAt(w)&&w.status==='done'&&!workerPending(w)){
    try{if(unavailable)throw unavailable;await evaluationPreflight();}catch(e){unavailable=e;item.status='completed';continue;}
    j.phase='grading';j.currentRunId=item.runId;await saveBatch(j);channel.postMessage({type:'job-progress',job:jobView(j)});
    try{applyAssessment(item,await node('grade',{runId:item.runId,receipt:{channel:'Orca Worker',sessionId:w.session_id,workerId:w.worker_id,...item.telemetry,completedAt:item.telemetry.completedAt,acceptedConfig:cfg,provenance:'host-team-observed'}}));}
    catch(e){if(isTransientReadError(e))throw e;item.status='blocked';item.error='评分受阻：'+e.message;}
   }else if(w.status==='error'){item.status='blocked';item.error='Worker 异常结束，保留作答，未计分';}
   else {item.status=w.waitingForUser?'awaiting_confirmation':w.queue_paused?'queue_paused':w.is_working?'running':w.queued_count?'queued':'pending';item.waitReason=w.waitingForUser?'等待自动审批或用户确认':w.queue_paused?'队列已暂停':w.is_working?'模型正在执行':w.queued_count?'宿主排队中':'等待终态核对';}
  }
  delete j.currentRunId;
  // Reconcile historical assessments before releasing their sessions; never delete raw grades.
  for(const item of j.items.filter(x=>doneItem(x)||x.status==='blocked')){
   if(item.result&&!item.qualityReviewed){try{applyAssessment(item,await node('reconcile_result',{runId:item.runId,receipt:item.telemetry}),item.status);item.qualityReviewed=true;delete item.qualityReviewError;}catch(e){item.qualityReviewError='诊断复核暂未完成：'+e.message;}await saveBatch(j);}
   const matches=team.workers.filter(w=>w.label===workerLabel(item.runId));
   const w=matches.length===1?matches[0]:null;
   if(j.status==='stopping'&&w?.status==='done'&&!item.result)continue;
   if(w&&(item.result||item.status==='blocked')&&!item.released&&w.worker_id===item.workerId&&w.session_id===item.taskId&&workerCompletedAt(w)&&!workerPending(w)){
    // Persist the failure and exact observed terminal before freeing its slot.
    item.terminalReceipt={...item.telemetry,workerId:w.worker_id,sessionId:w.session_id,completedAt:workerCompletedAt(w),status:w.status,provenance:'host-team-observed',acceptedConfig:{model:w.model,agentKind:w.agent_kind,effort:w.effort||'default',providerId:w.providerId,fastMode:w.fastMode},workingDir:w.working_dir};
    if(!item.result){const result=await node('record_failure',{runId:item.runId,reason:item.error,receipt:item.terminalReceipt});if(['graded','environment_invalid'].includes(result.status))applyAssessment(item,result);else item.result=result;}
    await saveBatch(j);
    const release=await cindy.tasks.releaseWorker({taskId:j.coordinator.taskId,workerId:w.worker_id,completedAt:workerCompletedAt(w)});
    if(release.ok){item.released=true;await saveBatch(j);}else item.releaseReason=release.message;
   }
  }
  if(unavailable)throw unavailable;
}
function acceptedWorkerConfig(item,route,workingDir){
 const expected=taskRoute(item.config);return !!route&&Object.keys(expected).every(key=>route[key]===expected[key])&&workingDir===item.prepared?.workspace;
}
const pendingWorkerRelease=(j,team)=>j.items.some(item=>item.terminalReceipt&&item.workerId&&!item.released&&team.workers.some(w=>w.worker_id===item.workerId));
const workerLabel=runId=>'eval-'+runId.replaceAll('-','').slice(0,27);
const workerPending=w=>!!(w.is_working||w.queued_count||w.queue_paused||w.waitingForUser);
const workerCompletedAt=w=>w.lastTurnEndedAt||w.completedAt;
const terminalRun=r=>['completed','failed','cancelled','interrupted'].includes(r.status);
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
  if(j.stopRequestedAt||j.status==='stopping')return await stopBatch(j);
  if(!cindy.tasks.startTeam||!cindy.tasks.getTeam)throw Error('请更新 Cindy 以使用主任务协调评测');
  if(!j.coordinator){
   await evaluationPreflight();
   j.coordinator=await cindy.tasks.create({requestKey:j.id+':coordinator',title:'评测主任务 · '+j.items.length+' 份作答',route:taskRoute(j.items[0].config),isolatedWorkspace:true});
   await saveBatch(j);
  }
  j.coordinator=await cindy.tasks.get({taskId:j.coordinator.taskId});
  if(j.coordinator.permissionMode!=='auto'){j.phase='permission';j.message='启用 Auto 自动审批后，主任务和 Worker 将按此权限继续评测。';await saveBatch(j);return jobView(j);}
  if(!j.coordinator.workingDir)throw Error('评测主任务目录不可用，请检查任务目录后重试；已有作答保留。');
  if(!j.team){
   j.phase='coordinating';await saveBatch(j);
   const team=await cindy.tasks.startTeam({taskId:j.coordinator.taskId});
   if(!team.ok)throw Error(team.message||'协同模式尚未就绪');
   j.team=team.teamId;await saveBatch(j);
  }
  if(!j.plan){
   await evaluationPreflight();
   j.phase='preparing';await saveBatch(j);
   for(const item of j.items.filter(x=>!doneItem(x))){
    if(!item.prepared){try{item.prepared=await node('prepare',{question:item.question,...item.config,batchId:j.id,runId:item.runId,executionChannel:'Orca Worker'});delete item.error;item.status='pending';}catch(e){if(isTransientReadError(e))throw e;item.status='blocked';item.error='作答准备失败：'+e.message;}await saveBatch(j);}
   }
   if(!j.items.some(x=>!doneItem(x)&&x.prepared))throw Error('没有可开始的作答，请检查题包准备错误');
   j.plan=await node('coordinator_plan',{id:j.id,workspace:j.coordinator.workingDir,capacity:j.capacity,coordinatorUsage:j.coordinatorUsage,concurrency:j.concurrency??null,items:j.items.filter(x=>!doneItem(x)&&x.prepared).map(x=>({label:workerLabel(x.runId),runId:x.runId,config:x.config,workspace:x.prepared.workspace,prompt:x.prepared.prompt}))});
   await saveBatch(j);
  }
  if(!j.plan.workspace){
   j.plan=await node('coordinator_plan',{id:j.id,workspace:j.coordinator.workingDir,legacy:true});
   if(j.controlRun)j.schedulerVersion=1;
   await saveBatch(j);
  }
  if(j.registeredPlan!==2){
   if(j.items.some(x=>x.prepared&&!x.prepared.authorizationScope))await evaluationPreflight();
   for(const item of j.items.filter(x=>x.prepared&&!x.prepared.authorizationScope)){item.prepared=await node('prepare',{question:item.question,...item.config,batchId:j.id,runId:item.runId,executionChannel:'Orca Worker'});}
   if(!cindy.tasks.setTeamPlan)throw Error('请更新 Cindy 以使用带并发保护的评测');
   await cindy.tasks.setTeamPlan({taskId:j.coordinator.taskId,plan:{concurrency:j.concurrency??null,task:j.plan.prompt,items:j.items.filter(x=>x.prepared&&(j.registeredPlan||!doneItem(x))).map(x=>({label:workerLabel(x.runId),workingDir:x.prepared.workspace,route:taskRoute(x.config),task:x.prepared.authorizationScope||x.prepared.prompt}))}});
   j.registeredPlan=2;await saveBatch(j);
  }
  const team=await cindy.tasks.getTeam({taskId:j.coordinator.taskId});
  if(!team.ok)throw Error('无法核对协同状态');
  j.capacity=team.capacity;j.coordinatorUsage=team.coordinatorUsage;
  if(team.waitingForUser){j.phase='awaiting_confirmation';j.message='评测主任务正在等待你的确认。请在侧栏打开评测主任务处理确认；插件不会代替你批准或自动催办。';await saveBatch(j);return jobView(j);}
  if(j.status!=='stopping'&&await coordinatorApprovalBlocked(j))return jobView(j);
  await settleWorkers(j,team);
  const activeWorkers=team.workers.filter(workerPending);
  const pending=j.items.filter(x=>!doneItem(x)&&x.prepared&&x.status!=='blocked'&&!team.workers.some(w=>w.label===workerLabel(x.runId)));
  const limit=j.concurrency??team.capacity?.hardLimit??1;
  const available=Math.max(0,Math.min(limit-activeWorkers.length,(team.capacity?.remainingSlots??1)+j.items.filter(x=>x.released&&team.workers.some(w=>w.worker_id===x.workerId)).length));
  const assignments=pending.slice(0,available).map(x=>({label:workerLabel(x.runId),runId:x.runId,config:x.config,workspace:x.prepared.workspace,prompt:x.prepared.prompt}));
  if(assignments.length)await evaluationPreflight();
  const schedule=await node('coordinator_state',{id:j.id,workspace:j.coordinator.workingDir,assignments,active:activeWorkers.map(w=>({label:w.label,workerId:w.worker_id})),settled:j.items.filter(doneItem).map(x=>({label:workerLabel(x.runId),status:x.status})),capacity:{limit,available}});
  for(const item of pending)item.waitReason=available?'等待主任务派发':'等待可用 Worker 槽位';
  if(!j.controlRun){await coordinatorMessage(j,j.plan.prompt,'start');j.schedulerVersion=2;j.scheduleSignature=JSON.stringify(assignments.map(x=>x.label));}
  else if(j.schedulerVersion!==2){if(pending.length||activeWorkers.length)await coordinatorMessage(j,'协调计划位于 '+JSON.stringify(j.plan.path)+'。改用程序调度清单：每次创建前读取 '+JSON.stringify(schedule.path)+'，仅派发 assignments，禁止重建 active/settled。插件确认交卷和评分后自动释放槽位；保留现有作答，不自行归档或重新作答。','scheduler-workspace-v1');j.schedulerVersion=2;}
  else if(!team.leadWorking&&assignments.length){
   const signature=JSON.stringify(assignments.map(x=>x.label));
   if(signature!==j.scheduleSignature||Date.now()-(j.lastCheckAt||0)>120000){
    if(signature===j.scheduleSignature&&(j.checks||0)>=3){j.phase='blocked';j.message='派发尚未确认，已暂停自动催办；现有作答保留。';await saveBatch(j);return jobView(j);}
    j.checks=signature===j.scheduleSignature?(j.checks||0)+1:0;j.scheduleSignature=signature;j.lastCheckAt=Date.now();j.checkSequence=(j.checkSequence||0)+1;
    await coordinatorMessage(j,'读取最新调度清单 '+JSON.stringify(schedule.path)+'，核对现有 label 后只派发 assignments。容量不足等待回报；不要重发 active/settled。','schedule-'+j.checkSequence);
   }
  }
  if(pendingWorkerRelease(j,team)){j.phase='coordinating';j.message='正在确认 Worker 槽位释放，已有成绩已保存。';}
  else if(j.items.every(doneItem)&&!activeWorkers.length&&!team.leadWorking){j.status='completed';j.phase='completed';j.qualityVersion=1;j.message=j.items.some(x=>x.status==='environment_invalid')?'本批已结束；环境受阻的作答不计入正式总分。':'';}
  else if(j.items.every(x=>doneItem(x)||x.status==='blocked')&&!activeWorkers.length&&!team.leadWorking){
   if(j.items.every(x=>doneItem(x)||!x.prepared)){j.status='completed';j.phase='completed';j.qualityVersion=1;j.message='本批已结束，未准备的作答未运行、未计分。修复准备错误后可对遗漏题目开始新评测；已有成绩保留。';}
   else {j.status='needs_attention';j.phase='blocked';j.message='部分作答受阻，已有成绩已保存。';}
  }
  else {j.phase=activeWorkers.length?'answering':'coordinating';j.message='主任务按调度清单并行派发，交卷后独立评分并释放槽位。';}
  delete j.retryAt;delete j.readRetryCount;await saveBatch(j);
 }catch(e){if(e.message==='EVAL_STOP_REQUESTED')return stopBatch(j);await recordBatchError(j,e);}
 return jobView(j);
}

const channel=new BroadcastChannel('eval-lab');
const inflight=new Map();
function draftIdentifier(x){if(typeof x!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/.test(x))throw Error('Invalid identifier');return x;}
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
 if(isTransientReadError(e)||e.evaluationUnavailable){
  j.readRetryCount=(j.readRetryCount||0)+1;j.retryAt=Date.now()+Math.min(60000,5000*2**Math.min(j.readRetryCount-1,4));
  j.phase='recovering';j.message=e.evaluationUnavailable?e.message:'进度读取暂时冲突，正在自动恢复；已有作答和成绩保留。';
 }else {j.phase='blocked';j.message=e.message;}
 await saveBatch(j);
}
async function evaluationPreflight(){try{await node('preflight');}catch(e){e.evaluationUnavailable=true;e.message=e.message.replace('尚未开始模型作答。','已有作答和成绩保留。');throw e;}}
async function recoverLegacyRun(j,item){
 if(item.hostRun||!item.task)return;
 if(!cindy.tasks.listRuns)throw Error('无法核对主任务执行回执');
 let after;const runs=[],seen=new Set();
 do{const page=await cindy.tasks.listRuns({taskId:item.task.taskId,...(after?{after}:{})});
  if(!Array.isArray(page.items))throw Error('无法核对主任务执行回执');
  runs.push(...page.items);after=page.nextCursor;
  if(after&&seen.has(after))throw Error('主任务回执分页未完成');if(after)seen.add(after);
 }while(after);
 if(runs.length>1||runs.some(r=>r.taskId!==item.task.taskId))throw Error('执行回执与任务不匹配');
 if(runs.length){item.hostRun=runs[0];await saveBatch(j);}
}
async function readyConfig(){const c=await config();if(c.root)return c;const saved=await updateConfig(c=>c.root||c.profile?c:{...c,profile:crypto.randomUUID()});if(saved.root)return saved;const r=await checked(cindy.node.request({method:'defaults',params:{profile:saved.profile},timeoutMs:30000}));return {...saved,root:r.result.root,automaticRoot:true};}
async function node(method,args={},callId,downloadTokens){
 const c=await readyConfig();
 if(method==='export'){let locale='en';try{const context=await cindy.request({kind:'app-context'});if(context?.context?.locale==='zh-CN')locale='zh-CN';}catch{}args={...args,locale};}
 const request=async(method,args)=>{const r=await checked(cindy.node.request({method,params:{...args,root:c.root,bank:c.bank,importedBanks:c.importedBanks||[]},...(callId?{callId}:{}),...(downloadTokens?{downloadTokens}:{}),timeoutMs:120000,maxTotalMs:900000}));return r.result;};
 if(method==='calibrate'){
  const {checkId}=await request('calibrate_begin',args);
  for(let step=0;step<3;step++)await request('calibrate_step',{checkId,step});
  return request('calibrate_finish',{checkId});
 }
 return request(method,args);}
const DEFAULT_INDEX='https://github.com/makecindy/eval-bank/releases/download/eval-bank-20260925/index.json';
const defaultCatalog=fetch('bank/catalog.json').then(r=>{if(!r.ok)throw Error('Default catalog unavailable');return r.json();});
function progress(message){channel.postMessage({type:'progress',message});}
let downloadCancelled=false,downloadBusy=false,activeDownload=null,activeInstall=null;
async function cancelPreparation(){
 downloadCancelled=true;
 const download=activeDownload,install=activeInstall;
 const results=await Promise.allSettled([
  download?checked(Promise.resolve().then(()=>cindy.downloads.cancel({id:download}))):undefined,
  install?node('online_cancel',{operationId:install}):undefined
 ]);
 const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;
}
async function inspectQuestions(args,callId){
 if(downloadBusy)throw Error('题库正在准备，请稍候');
 downloadBusy=true;try{return await node('online_inspect',args,callId);}finally{downloadBusy=false;}
}
async function installQuestion(args,fromLaunch=false){
 if(fromLaunch&&launchCancelled)throw Error('已停止准备。');
 if(downloadBusy)throw Error('题库正在准备，请稍候');
 downloadBusy=true;if(!fromLaunch)downloadCancelled=false;
 try{
 activeInstall=(await node('online_begin')).operationId;
 if(typeof activeInstall!=='string')throw Error('Install cancellation unavailable');
 let current;
 do{if(downloadCancelled)throw Error('下载已取消');current=await node('online_step',{...args,operationId:activeInstall,requireHostDownloads:true});}while(!current.done&&current.phase==='cached');
 if(!current.done){
 // Host downloads may outlive the Node process. Finish this cache probe first.
 await node('online_cancel',{operationId:activeInstall});activeInstall=null;
 if(!cindy.downloads?.start)throw Error('请更新 Cindy 开发版以使用题库下载');
 const plan=await node('online_plan',args),downloadTokens={};
 for(const a of plan.artifacts){
  if(downloadCancelled)throw Error('下载已取消');
  activeDownload='bank-'+a.sha256;
  const r=await checked(cindy.downloads.start({id:activeDownload,url:a.url,sha256:a.sha256,bytes:a.bytes}));
  if(typeof r.token!=='string')throw Error('请更新 Cindy 以使用受管下载');
  downloadTokens['artifact_'+a.sha256]=r.token;
 }
 if(downloadCancelled)throw Error('下载已取消');
 activeInstall=(await node('online_begin')).operationId;
 if(typeof activeInstall!=='string')throw Error('Install cancellation unavailable');
 channel.postMessage({type:'download-progress',phase:'unpacking'});
 do{if(downloadCancelled)throw Error('下载已取消');current=await node('online_step',{...args,operationId:activeInstall,requireHostDownloads:true},undefined,downloadTokens);}while(!current.done);
 }
 const result=current.result;
 // Successful atomic publication is final even if cancellation arrives late.
 channel.postMessage({type:'download-progress',phase:'ready'});
 return result;
 }catch(e){channel.postMessage({type:'download-progress',phase:downloadCancelled?'cancelled':'failed'});throw e;}
 finally{try{if(activeInstall)await node('online_cancel',{operationId:activeInstall});}catch{/* Cleanup cannot replace the installation outcome. */}finally{downloadBusy=false;activeDownload=null;activeInstall=null;}}
}
async function resolveQuestions(wanted,fromLaunch=false){
 const c=await readyConfig(),available=(await node('bank')).questions,resolved=[];let remote;
 for(const key of wanted){
  if(fromLaunch&&launchCancelled)throw Error('已停止准备。');
  const matches=available.filter(q=>q.key===key||(!key.includes(':')&&q.key.startsWith('online:')&&q.key.endsWith(':'+key)));
  const identities=new Set(matches.map(q=>q.distributionHash));
  if(key.includes(':')&&matches.length&&identities.size===1&&matches.every(q=>q.key===key)){resolved.push(matches[0].key);continue;}
  if(key.includes(':'))throw Error('所选题库版本不可用，请重新选择题库。');

  if(!remote){progress('正在准备默认题库…');remote=await inspectQuestions({url:c.indexUrl||DEFAULT_INDEX});}
  if(fromLaunch&&launchCancelled)throw Error('已停止准备。');
  progress('正在下载并校验：'+key);
  const installed=await installQuestion({indexId:remote.indexId,question:key},fromLaunch);
  const after=(await node('bank')).questions,q=after.find(q=>q.key==='online:'+installed.bank.split(/[\\/]/).pop()+':'+installed.key);
  if(!q)throw Error('下载的题目不可用，请检查题库后重试。');resolved.push(q.key);
 }
 return resolved;
}
async function readModels(){
 const r=await fetch('agent-models');
 if(r.status===404)throw Error('当前 Cindy 版本不支持模型目录，请升级后重试。');
 if(!r.ok)throw Error('模型目录暂时不可用，请刷新重试。');
 const data=await r.json();if(!data.ok||!Array.isArray(data.models))throw Error('模型目录暂时不可用，请刷新重试。');
 return data.models.map(m=>({model:m.id,label:m.name,visible:m.visible!==false,harness:m.agent,provider:m.providerId,providerLabel:m.providerName,efforts:m.efforts.length?m.efforts:['default'],defaultEffort:m.defaultEffort}));
}
function verifiedConfiguration(x,models){
 const row=models.find(m=>m.model===x.model&&m.harness===x.harness&&m.provider===x.provider&&m.efforts.includes(x.effort));
 if(!row)throw Error('模型目录已变化，请重新读取并选择');
 return {model:row.model,harness:row.harness,provider:row.provider,effort:x.effort};
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
async function assessLegacyCompletion(j,item,run){
 if(run.taskId!==item.task.taskId)throw Error('执行回执与任务不匹配');
 const route=taskRoute(item.config);if(Object.keys(route).some(k=>run.acceptedConfig?.[k]!==route[k]))throw Error('实际执行配置与所选模型不一致，未计分');
 if(!run.execution||!run.completedAt)throw Error('完成回执缺少执行身份，暂不评分');
 await evaluationPreflight();
 j.phase='grading';await saveBatch(j);channel.postMessage({type:'job-progress',job:jobView(j)});
 applyAssessment(item,await node('grade',{runId:item.runId,receipt:{channel:'Cindy task',sessionId:run.taskId,runId:run.runId,completedAt:new Date(run.completedAt).toISOString(),acceptedAt:run.acceptedAt,execution:run.execution,acceptedConfig:run.acceptedConfig,outputMessageId:run.outputMessageId}}));
 await saveBatch(j);
}
async function coordinatorRuns(taskId){
 let after,count=0,ended=true;const cursors=new Set();
 do{const page=await cindy.tasks.listRuns({taskId,...(after?{after}:{})});
  if(!Array.isArray(page.items))throw Error('无法核对主任务执行回执');
  count+=page.items.length;ended=ended&&page.items.every(terminalRun);after=page.nextCursor;
  if(after&&cursors.has(after))throw Error('主任务回执分页未完成');if(after)cursors.add(after);
 }while(after);
 return {count,ended};
}
async function stopBatch(j){
 if(j.mode!=='coordinator'){
  j.status='stopping';j.phase='stopping';await saveBatch(j);
  let pending=false;for(const item of j.items.filter(x=>!doneItem(x))){
   await recoverLegacyRun(j,item);
   if(item.hostRun){const run=await cindy.tasks.cancel({runId:item.hostRun.runId,requestKey:j.id+':stop:'+item.runId});if(!terminalRun(run)){pending=true;continue;}if(run.status==='completed'){await assessLegacyCompletion(j,item,run);continue;}}
   item.status='cancelled';
  }
  j.status=pending?'stopping':'cancelled';j.phase=j.status;j.message=pending?'等待任务停止回执；已完成成绩保留。':'评测已停止，已完成成绩保留。';await saveBatch(j);return jobView(j);
 }
 let unstarted=!j.controlRun&&!j.plan;
 if(!j.controlRun&&j.plan){
  // A missing local send response is not proof that Host never accepted it.
  const runs=await coordinatorRuns(j.coordinator.taskId),team=await cindy.tasks.getTeam({taskId:j.coordinator.taskId});
  if(!team.ok||!Array.isArray(team.workers))throw Error('无法核对协同状态');
  unstarted=runs.count===0&&!team.leadWorking&&!team.waitingForUser&&team.workers.length===0;
 }
 if(unstarted){j.status='cancelled';j.phase='cancelled';j.message='已停止准备，没有派发新的作答。';for(const i of j.items.filter(x=>!doneItem(x)))i.status='cancelled';await saveBatch(j);return jobView(j);}
 j.status='stopping';j.phase='stopping';j.message='正在停止评测，已完成的作答和成绩保留。';await saveBatch(j);
 let task=await cindy.tasks.get({taskId:j.coordinator.taskId});
 if(!j.stopSent&&task.status!=='archived'){
  try{await coordinatorMessage(j,'用户要求停止本批评测。停止派发新题；通过 Orca 停止本批仍在执行的 Worker，保留已完成结果与文件，并报告停止结果。','stop');j.stopSent=true;await saveBatch(j);}
  catch(e){if(e.code!=='TASK_BUSY')throw e;task=await cindy.tasks.get({taskId:j.coordinator.taskId});if(task.status!=='archived')throw e;}
 }
 let ended=false;
 if(j.stopSent)ended=terminalRun(await cindy.tasks.getRun({runId:j.controlRun.runId}));
 else if(task.status==='archived'){
  // An archived task cannot accept stop input. Observe all accepted receipts,
  // including a start whose response was lost; never replay start to discover it.
  const runs=await coordinatorRuns(j.coordinator.taskId);ended=runs.ended&&runs.count>0;
 }
 const team=await cindy.tasks.getTeam({taskId:j.coordinator.taskId});
 if(!team.ok)throw Error('无法核对协同状态');
 await settleWorkers(j,team);
 const ungradedCompleted=j.items.some(item=>!doneItem(item)&&team.workers.some(w=>w.label===workerLabel(item.runId)&&w.status==='done'&&workerCompletedAt(w)&&!workerPending(w)));
 if(ungradedCompleted){j.phase='blocked';j.message='已停止派发，已交卷作答的评分尚未完成；文件保留，请处理评分错误后重试。';await saveBatch(j);return jobView(j);}
 if(ended&&!pendingWorkerRelease(j,team)&&!team.leadWorking&&!team.waitingForUser&&!team.workers.some(workerPending)){j.status='cancelled';j.phase='cancelled';j.message='评测已停止，已完成成绩保留。';for(const item of j.items.filter(x=>!doneItem(x)))item.status='cancelled';}
 else j.message='等待主任务停止回执；未确认前不会开始新批次。';
 await saveBatch(j);return jobView(j);
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
 if(j.phase==='recovering'&&Date.now()<(j.retryAt||0))return jobView(j);
 const item=j.items.find(x=>!doneItem(x));if(!item){j.status='completed';await saveBatch(j);return jobView(j);}
 try{
  await taskCapability();
  if(!item.task){j.mode='coordinator';await saveBatch(j);return advanceCoordinator(j);}
  await recoverLegacyRun(j,item);
  if(!item.hostRun&&cindy.tasks.get)item.task=await cindy.tasks.get({taskId:item.task.taskId});
  if(!item.hostRun&&item.task.permissionMode==='plan'){j.phase='permission';j.message='需要允许 AI 修改作答文件。确认后继续这一批，无需重新开始。';await saveBatch(j);return jobView(j);}
  j.message='';j.phase='preparing';await saveBatch(j);
  if(!item.hostRun&&!item.prepared){if(!item.task.workingDir)throw Error('宿主未返回独立作答目录');item.prepared=await node('prepare',{question:item.question,...item.config,batchId:j.id,runId:item.runId,workspace:item.task.workingDir,executionChannel:'Cindy task'});await saveBatch(j);}
  if(!item.hostRun){await evaluationPreflight();item.hostRun=await cindy.tasks.send({taskId:item.task.taskId,requestKey:j.id+':send:'+item.runId,expectedRevision:item.task.revision,text:item.prepared.prompt});item.status=item.hostRun.status;await saveBatch(j);}
  const run=await cindy.tasks.getRun({runId:item.hostRun.runId});
  if(run.taskId!==item.task.taskId)throw Error('执行回执与任务不匹配');
  const route=taskRoute(item.config);if(Object.keys(route).some(k=>run.acceptedConfig?.[k]!==route[k]))throw Error('实际执行配置与所选模型不一致，未计分');
  item.status=run.status;j.phase=run.status==='running'?'answering':run.status==='queued'?'queued':run.status==='reconciling'?'reconciling':'preparing';
  if(run.status==='completed'){
   await assessLegacyCompletion(j,item,run);
  }else if(['failed','cancelled','interrupted'].includes(run.status)){item.status=run.status==='cancelled'?'cancelled':'failed';item.error=run.error||'任务结束但未完成交卷，未计分';}
  else if(run.status==='reconciling'){item.error='宿主正在核对执行结果；不会重复发送，也不会计为零分。';}
  j.message=item.error||'';
  if(j.items.every(doneItem))j.status='completed';
  delete j.retryAt;delete j.readRetryCount;await saveBatch(j);
 }catch(e){if(e.message==='EVAL_STOP_REQUESTED')return stopBatch(j);await recordBatchError(j,e);}
 return jobView(j);
}
let authorChecking=false;
async function questionCatalog(){
 const bank=await node('bank'),c=await config();let current=[],catalogError;
 try{current=(await node('online_cached',{url:c.indexUrl||DEFAULT_INDEX})).questions||[];}catch(e){catalogError=e.message;}
 const defaults=(await defaultCatalog).map(d=>{
  const version=current.find(q=>q.key===d.key),installed=version&&bank.questions.find(q=>q.key===version.installedKey);
  const sourceKeys=bank.questions.filter(q=>q.questionId===(version?.questionId||d.key.split('@')[0])&&(q.key===installed?.key||q.sourceIndexUrl===(c.indexUrl||DEFAULT_INDEX))).map(q=>q.sourceKey).filter(Boolean);
  return {...d,...(version||{}),sourceKeys:[...new Set(sourceKeys)],key:d.key,installedKey:installed?.key,unresolved:!version,cached:!!version};
 });
 return {...bank,catalogError,availableQuestions:[...defaults,...bank.questions],questions:[...defaults,...bank.questions],defaults};
}
async function createAuthor(a){
 let task;
 try{task=await cindy.tasks.create(a.pendingCreate);}catch(e){
  // Only these Host codes prove rejection before a create receipt/session.
  // Permission, storage and transport failures may follow acceptance: retain identity.
  if(['INVALID_REQUEST','ROUTE_UNAVAILABLE'].includes(e.code)){
   const failed={...a,status:'failed',error:'出题请求未被受理，请检查任务配置和插件权限后重新创建。'};delete failed.pendingCreate;
   await updateConfig(c=>({...c,author:failed}));throw Error(failed.error);
  }
  throw e;
 }
 const author={...a,taskId:task.taskId,status:'sending',handoff:{ready:false},permissionPending:task.permissionMode==='plan',pendingSend:{taskId:task.taskId,requestKey:'author-send:'+a.id+':'+a.revision,expectedRevision:task.revision}};
 delete author.pendingCreate;
 await updateConfig(c=>({...c,author}));
 return sendAuthor(author);
}
async function sendAuthor(a){
 if(a.handoff&&!a.handoff.ready){
  const task=await cindy.tasks.get({taskId:a.taskId});
  const prepared=await node('author_stage',{id:a.id,revision:a.revision,taskId:a.taskId,workspace:task.workingDir});
  a={...a,handoff:{ready:true},pendingSend:{...a.pendingSend,text:'仅处理 '+JSON.stringify(prepared.directory)+' 中用户选定的记录，按 AUTHOR_TASK.md 创建题包。题目 id 必须为 '+JSON.stringify(a.id)+'，revision 必须为 '+JSON.stringify(a.revision)+'。完成后报告，由插件导回草稿并独立校准，无需调用 calibrate_question。不运行待测模型，不把聊天私密数据放进公开候选题。'}};
  await updateConfig(c=>({...c,author:a}));
 }
 if(a.permissionPending){
  try{
  let task=await cindy.tasks.get({taskId:a.taskId});
  if(task.permissionMode==='plan'){
   if(!cindy.tasks.requestWriteAccess)throw Error('请更新 Cindy 以使用页面内授权');
   const access=await cindy.tasks.requestWriteAccess({taskId:a.taskId,mode:'auto'});
   if(!access.granted)throw Error('出题草稿已保存。请在插件详情允许修改文件后继续出题。');
   task=access.task;
  }
  a={...a,error:null,permissionPending:false,pendingSend:{...a.pendingSend,expectedRevision:task.revision}};
  await updateConfig(c=>({...c,author:a}));
  }catch(e){await updateConfig(c=>({...c,author:{...a,error:e.message}}));throw e;}
 }
 let run;
 try{run=await cindy.tasks.send(a.pendingSend);}catch(e){
  // These host errors occur before a send receipt exists. Unknown transport
  // failures retain the exact pending request for idempotent reconciliation.
  if(['REVISION_CONFLICT','TASK_BUSY'].includes(e.code)){
   const saved={...a,status:'failed',error:'出题请求未被受理，请检查任务配置和插件权限后重新创建。'};delete saved.pendingSend;
   await updateConfig(c=>({...c,author:saved}));throw Error(saved.error);
  }
  throw e;
 }
 const saved={...a,runId:run.runId,status:run.status};delete saved.pendingSend;
 await updateConfig(c=>({...c,author:saved}));return {taskId:a.taskId,status:run.status};
}
async function collectAuthor(a,run){
 if(!a.handoff)return;
 run=run||await cindy.tasks.getRun({runId:a.runId});
 if(run.status!=='completed')throw Error('出题任务尚未完成，暂不能导回或校准。');
 const task=await cindy.tasks.get({taskId:a.taskId});
 await node('author_collect',{id:a.id,revision:a.revision,taskId:a.taskId,workspace:task.workingDir});
}
function calibrationState(result){return {calibration:result,status:result?.ok===true?'calibrated':'failed',error:result?.ok===true?null:'校准未通过，请检查校准报告并修正草稿后重试。'};}
async function checkAuthor(){
 if(authorChecking||authorStarting)return;const a=(await config()).author;if(authorChecking||authorStarting||!a||!a.runId||['calibrated','failed'].includes(a.status))return;
 authorChecking=true;try{const r=await cindy.tasks.getRun({runId:a.runId});delete a.error;a.status=r.status;if(r.status==='completed'){await collectAuthor(a,r);Object.assign(a,calibrationState(await node('calibrate',{id:a.id,revision:a.revision})));}else if(['failed','cancelled','interrupted'].includes(r.status))a.status='failed';await updateConfig(c=>({...c,author:a}));}catch(e){await updateConfig(c=>({...c,author:{...a,...(a.status==='completed'?{status:'failed'}:{}),error:e.message}}));}finally{authorChecking=false;}
}
let launching=false,launchCancelled=false,authorStarting=false;
async function authorPending(a){
 if(!a||a.status==='calibrated')return false;
 if(a.status!=='failed'||a.calibration)return true;
 if(a.runId){const run=await cindy.tasks.getRun({runId:a.runId});return !['failed','cancelled','interrupted'].includes(run?.status);}
 return false;
}
async function assertRootChangeAllowed(c){
 if(downloadBusy)throw Error('题库正在准备，请稍候');
 const authorActive=await authorPending(c.author);
 if(authorStarting||authorChecking||authorActive)throw Error('出题尚未结束，请完成出题和校准后再更改数据目录。');
 if(launching||['running','stopping'].includes(c.batch?.status))throw Error('评测尚未结束，请完成或停止评测后再更改数据目录。');
}
async function action(name,args={},callId){
 if(['end_author','retry_calibration'].includes(name)){
  if(authorStarting||authorChecking)throw Error('已有出题任务正在启动，请等待完成。');
  authorStarting=true;
  try{
   const c=await readyConfig(),a=c.author;
   if(name==='end_author'&&(c.authorHistory||[]).some(x=>x.id===args.id&&x.revision===args.revision))return {ok:true};
   if(!a||a.id!==args.id||a.revision!==args.revision)throw Error('出题身份已变化，请刷新后重试。');
   if(a.pendingCreate||a.pendingSend||a.status==='drafting')throw Error('出题派发或材料状态未知，请先继续出题核对结果。');
   if(name==='retry_calibration'){
    const retryFrom=a.retryFrom||args.checkId;
    if(!retryFrom||(!a.retryFrom&&(a.calibration?.checkId!==retryFrom||a.calibration?.ok!==false)))throw Error('请从最新已结束的校准报告发起重试。');
    await updateConfig(c=>({...c,author:{...c.author,retryFrom}}));
    const result=await node('calibrate',{id:a.id,revision:a.revision,retryFrom},callId);
    await updateConfig(c=>{const author={...c.author,...calibrationState(result)};delete author.retryFrom;return {...c,author};});
    return result;
   }
   if(a.retryFrom)throw Error('校准尚未结束或执行状态未知，不能结束出题。');
   if(a.runId){const run=await cindy.tasks.getRun({runId:a.runId});if(!run||run.runId!==a.runId||run.taskId!==a.taskId||!terminalRun(run))throw Error('出题仍在运行或状态未知，不能结束。');}
   if(a.taskId){
    let after;const seen=new Set();
    do{const page=await cindy.tasks.listRuns({taskId:a.taskId,...(after?{after}:{})});
     if(!Array.isArray(page.items)||page.items.some(r=>!r||r.taskId!==a.taskId||!terminalRun(r)))throw Error('出题仍在运行或状态未知，不能结束。');
     after=page.nextCursor;if(after&&seen.has(after))throw Error('出题仍在运行或状态未知，不能结束。');if(after)seen.add(after);
    }while(after);
   }
   await node('calibrate_idle',{id:a.id,revision:a.revision},callId);
   await updateConfig(c=>({...c,author:null,authorHistory:[...(c.authorHistory||[]),{...a,root:c.root||c.profile,endedAt:new Date().toISOString()}]}));
   return {ok:true};
  }finally{authorStarting=false;}
 }
 if(launching&&['setup_root','setup_bank','save_source'].includes(name))throw Error('评测正在准备，完成后可更改设置');
 if(name==='setup_root'||name==='setup_bank'){if(name==='setup_root')await assertRootChangeAllowed(await config());const r=await checked(cindy.pick({mode:'directory',title:name==='setup_root'?'选择评测数据保存目录':'选择解压后的评测题包目录'}));if(r.cancelled)return {cancelled:true};if(name==='setup_root'){await checked(cindy.node.request({method:'validate_storage',params:{root:r.path},timeoutMs:30000}));await updateConfig(async c=>{await assertRootChangeAllowed(c);return {...c,root:r.path};});}else {await checked(cindy.node.request({method:'bank',params:{root:(await readyConfig()).root,bank:r.path},timeoutMs:30000}));await updateConfig(c=>({...c,importedBanks:[...(c.importedBanks||[]).filter(b=>b.path!==r.path),{id:crypto.randomUUID(),name:r.name||'导入题库',path:r.path}]}));}return {name:r.name};}
 if(name==='status'){await checkAuthor();let models=[],modelError=null;try{models=await readModels();}catch(e){modelError=e.message;}void advanceBatch().catch(()=>{});const c=await readyConfig();const job=jobView(c.batch);const bank=await questionCatalog();const defaults=bank.defaults;const extra=bank.questions.filter(q=>!defaults.some(d=>q.key===d.key));return {configured:true,models,modelError,modelsUpdatedAt:modelError?null:new Date().toISOString(),automaticRoot:!c.root||c.automaticRoot,bank:{questions:[...defaults,...extra]},banks:[{id:'default',name:'Cindy 实战题库',error:bank.catalogError,questions:defaults},...(bank.errors||[]).filter(e=>e.id==='custom').map(e=>({id:e.id,name:'私人题库',error:e.message,questions:[]})),...(c.importedBanks||[]).map(b=>({id:'imported:'+b.id,name:b.name,error:bank.errors?.find(e=>e.id===b.id)?.message,questions:bank.questions.filter(q=>q.key.startsWith('imported:'+b.id+':'))})),...extra.filter(q=>!q.key.startsWith('imported:')).map(q=>({id:q.key,name:(c.draftNames||{})[q.key.split('@')[0].replace('custom:','')]||q.title,questions:[q]}))],runs:await node('runs'),drafts:await node('drafts'),author:c.author?{id:c.author.id,revision:c.author.revision,checkId:c.author.retryFrom||c.author.calibration?.checkId,canRetry:!!(c.author.retryFrom||c.author.calibration?.ok===false),canEnd:['failed','completed','calibrated'].includes(c.author.status),status:c.author.status,error:c.author.error,canResume:!!(c.author.status==='drafting'||c.author.pendingCreate||c.author.pendingSend)}:null,job:job||c.job||null,indexUrl:c.indexUrl||DEFAULT_INDEX};}
 if(name==='save_source'){await updateConfig(c=>({...c,indexUrl:args.url}));return {ok:true};}
 if(name==='start'){
  if(launching)throw Error('评测正在准备，请勿重复启动');launching=true;launchCancelled=false;downloadCancelled=false;
  try{
   await taskCapability();const current=await config();if(['running','stopping'].includes(current.batch?.status))throw Error('已有评测正在运行，请先等待或停止。');
   if(!Array.isArray(args.questions)||!args.questions.length)throw Error('至少选择一道题');
   const models=await readModels();const configurations=args.configurations;
   if(!Array.isArray(configurations)||!configurations.length)throw Error('请选择模型和强度');
   const chosen=[...new Map(configurations.map(x=>{const c=verifiedConfiguration(x,models);return [JSON.stringify(c),c];})).values()];
   const requested=[...new Set(args.questions)];if(requested.length*chosen.length>200)throw Error('单批最多 200 份作答，请分批运行');
   const concurrency=args.concurrency??null;if(concurrency!==null&&(!Number.isInteger(concurrency)||concurrency<1))throw Error('同时作答数必须为正整数');
   const questions=await resolveQuestions(requested,true);
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
  if(j.plan&&j.items.some(x=>!doneItem(x)&&!x.prepared))throw Error('旧批次的计划已冻结，无法补入未准备的作答。请先停止本批，再为遗漏题目开始新评测；已有成绩保留。');
  j.checks=0;j.lastCheckAt=0;j.approvalAcknowledgedAt=Date.now();j.phase='coordinating';j.status='running';await saveBatch(j);return advanceBatch();
 }
 if(name==='cancel'){
  launchCancelled=true;downloadCancelled=true;
  const current=(await config()).batch;
  if(!current||!['running','stopping','needs_attention'].includes(current.status)){await cancelPreparation();return launching?{id:'preparation',status:'cancelled',phase:'cancelled',total:0,finished:0,items:[],message:'已停止准备。'}:jobView(current);}
  const saved=await updateConfig(c=>{if(c.batch?.id!==current.id)throw Error('评测批次已变化');return {...c,batch:{...c.batch,stopRequestedAt:Date.now(),status:'stopping',phase:'stopping',message:'已收到停止请求，正在结束当前操作；不再准备后续题目。'}};});
  const job=jobView(saved.batch);channel.postMessage({type:'job-progress',job});
  try{await cancelPreparation();}finally{if(!advancing)void advanceBatch().catch(e=>progress('停止未完成：'+e.message));}return job;
 }
 if(name==='cancel_download'){await cancelPreparation();return {ok:true};}
 if(name==='online_install')return installQuestion(args);
 if(name==='online_inspect')return inspectQuestions(args,callId);
 if(name==='query')return advanceBatch();
 if(name==='export'){const r=await node('export',args,callId);const rel='exports/'+Date.now()+'-report.html';await checked(cindy.library({op:'write',path:rel,content:r.html}));const saved=await checked(cindy.library({op:'saveAs',path:rel,name:r.name}));return {saved:!saved.cancelled,path:rel};}
 if(name==='author'){
  if(authorStarting||authorChecking)throw Error('已有出题任务正在启动，请等待完成。');
  authorStarting=true;
  try{
  const current=(await config()).author;
  if(current?.pendingCreate)return await createAuthor(current);
  if(current?.pendingSend)return await sendAuthor(current);
  if(current?.status!=='drafting'&&await authorPending(current))throw Error('已有出题任务尚未结束，请等待完成后再创建。');
  await taskCapability();const resuming=current?.status==='drafting',draftId=resuming?current.id:args.id||'question-'+crypto.randomUUID();const revision=resuming?current.revision:args.revision||'v1';
  draftIdentifier(draftId);draftIdentifier(revision);
  if(((await config()).authorHistory||[]).some(x=>x.id===draftId&&x.revision===revision))throw Error('此出题已结束并保留为历史，请使用新的题目标识或版本。');
  if(!resuming)await updateConfig(c=>({...c,author:{id:draftId,revision,status:'drafting'}}));
  const drafted=await node('draft',{...args,id:draftId,revision,resume:resuming},callId);
  if(drafted.status==='input_required'){
   const error='草稿材料缺失或不完整，请重新选择材料创建题目；原文件保留，尚未派发出题任务。';
   await updateConfig(c=>({...c,author:{id:draftId,revision,status:'failed',error}}));throw Error(error);
  }
  if(typeof args.name==='string')await updateConfig(c=>({...c,draftNames:{...c.draftNames,[draftId]:args.name.slice(0,60)}}));
  const author={id:draftId,revision,status:'creating',pendingCreate:{requestKey:'author:'+draftId+':'+revision,title:'评测工坊 · 创建题目',isolatedWorkspace:true}};
  await updateConfig(c=>({...c,author}));return await createAuthor(author);
  }finally{authorStarting=false;}
 }
 if(name==='list_questions'){const {defaults,availableQuestions,...catalog}=await questionCatalog();return {...catalog,questions:availableQuestions};}
 if(name==='prepare_run'){const config=verifiedConfiguration(args,await readModels());return node('prepare',{...args,...config,question:(await resolveQuestions([args.question]))[0]},callId);}
 if(['calibrate_question','create_question_draft','freeze'].includes(name)){
  if(authorStarting||authorChecking)throw Error('已有出题任务正在启动，请等待完成。');
  authorStarting=true;
  try{
   const a=(await config()).author,matching=a&&a.id===args.id&&a.revision===args.revision;
   if(((await config()).authorHistory||[]).some(x=>x.id===args.id&&x.revision===args.revision))throw Error('此出题已结束并保留为历史，请使用新的题目标识或版本。');
   if(name==='freeze'){
    const draft=(await node('drafts')).find(x=>x.checkId===args.checkId);
    if(draft&&((await config()).authorHistory||[]).some(x=>x.id===draft.id&&x.revision===draft.revision))throw Error('此出题已结束并保留为历史，请使用新的题目标识或版本。');
   }
   if(name==='create_question_draft'){
    draftIdentifier(args.id);draftIdentifier(args.revision);
    if((!matching&&await authorPending(a))||(matching&&(a.runId||a.pendingCreate||a.pendingSend)))throw Error('已有出题任务尚未结束，请等待完成后再创建。');
    await updateConfig(c=>({...c,author:{id:args.id,revision:args.revision,status:'drafting'}}));
    const result=await node('draft',{...args,resume:!!matching},callId);
    if(result.status==='input_required'){
     const error='草稿材料缺失或不完整，请重新选择材料创建题目；原文件保留，尚未派发出题任务。';
     await updateConfig(c=>({...c,author:{id:args.id,revision:args.revision,status:'failed',error}}));throw Error(error);
    }
    await updateConfig(c=>({...c,author:{...c.author,status:'completed'}}));
    return result;
   }
   if(name==='calibrate_question'&&matching&&a.handoff)await collectAuthor(a);
   const result=await node(name==='calibrate_question'?'calibrate':name==='create_question_draft'?'draft':'freeze',name==='calibrate_question'&&matching&&a.retryFrom?{...args,retryFrom:a.retryFrom}:args,callId);
   if(name==='calibrate_question'&&matching)await updateConfig(c=>{const author={...c.author,...calibrationState(result)};delete author.retryFrom;return {...c,author};});
   return result;
  }finally{authorStarting=false;}
 }
 const map={list_runs:'runs',export_report:'export'};
 if(!map[name])throw Error('Unknown action');return node(map[name],args,callId);
}
channel.onmessage=async({data:m})=>{if(m?.type!=='request'||typeof m.id!=='string')return;if(!inflight.has(m.id)){inflight.set(m.id,action(m.action,m.args).then(result=>({ok:true,result}),e=>({ok:false,message:e.message})));if(inflight.size>200)inflight.delete(inflight.keys().next().value);}channel.postMessage({type:'response',id:m.id,...await inflight.get(m.id)});};
cindy.onHostMessage(async msg=>{if(msg.type==='event'&&msg.name==='download-progress'){if(msg.data?.id===activeDownload)channel.postMessage({type:'download-progress',...msg.data});return;}if(msg.type!=='tool-call')return;try{const result=await action(msg.tool,msg.args,msg.callId);await cindy.send({type:'tool-result',callId:msg.callId,ok:true,result});}catch(e){await cindy.send({type:'tool-result',callId:msg.callId,ok:false,errorCode:'EVALUATION_ERROR',message:e.message});}});
