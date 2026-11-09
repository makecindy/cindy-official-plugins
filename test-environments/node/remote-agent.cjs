'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync,spawn}=require('node:child_process');
const {Environments,defaultHome,atomic,alive}=require('./core.cjs');
const {identity}=require('./observation.cjs');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash=v=>crypto.createHash('sha256').update(Buffer.isBuffer(v)?v:JSON.stringify(v)).digest('hex');
function fail(code,execution='not_executed'){throw Object.assign(new Error(code),{code,execution});}
function git(root,args){try{return execFileSync('git',['-C',root,...args],{encoding:'utf8',timeout:5000,stdio:['ignore','pipe','ignore']}).trim();}catch{fail('GIT_PROBE_FAILED');}}
function hardware(){let model='unknown';try{model=process.platform==='darwin'?execFileSync('sysctl',['-n','hw.model'],{encoding:'utf8',timeout:2000,stdio:['ignore','pipe','ignore']}).trim():fs.readFileSync('/sys/class/dmi/id/product_name','utf8').trim();}catch{}return {platform:process.platform,arch:os.arch(),model,node:process.versions.node};}
function profileSnapshot(profileId){
 const db=new Environments().read(),profile=db.profiles[profileId],project=profile&&db.projects[profile.project];if(!project)fail('REMOTE_PROFILE_REQUIRED');
 const accounts=Object.values(db.accounts).filter(a=>a.project===project.id).map(a=>({id:a.id,project:a.project,label:a.label,selector:a.selector}));
 const cases=Object.values(db.cases).filter(c=>c.profile===profile.id);
 return {project,profile,accounts,cases};
}
function validatePr(pr){if(!pr||! /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(pr.repo||'')||!Number.isSafeInteger(pr.number)||pr.number<1||! /^[a-f0-9]{40}$/.test(pr.commit||''))fail('INVALID_PR_REVISION');return {repo:pr.repo,number:pr.number,commit:pr.commit};}
function verifyRepository(root,repo){
 const actual=fs.realpathSync(root);if(git(actual,['rev-parse','--show-toplevel'])!==actual)fail('INVALID_REPOSITORY_ROOT');
 const origin=git(actual,['config','--get','remote.origin.url']);
 if(![`https://github.com/${repo}`,`https://github.com/${repo}.git`,`git@github.com:${repo}`,`git@github.com:${repo}.git`].includes(origin))fail('REPOSITORY_MISMATCH');
 return actual;
}
function requirements(values){
 if(!Array.isArray(values)||values.length>50)fail('INVALID_REQUIREMENTS');
 return values.map(r=>{if(!r||Object.keys(r).some(k=>!['kind','label','deviceId'].includes(k))||!['human','device-tool'].includes(r.kind)||typeof r.label!=='string'||!r.label.trim()||r.label.length>500||r.deviceId!==undefined&&(typeof r.deviceId!=='string'||r.deviceId.length>256))fail('INVALID_REQUIREMENTS');return {...r,state:'pending'};});
}
function plan(request){
 if(!['darwin','linux'].includes(process.platform))fail('REMOTE_PLATFORM_UNSUPPORTED');
 const source=profileSnapshot(request.profile),pr=validatePr(request.pr),root=verifyRepository(source.project.root,pr.repo);
 for(const argv of Object.values(source.project.commands||{}))for(const arg of argv)if(arg===root||arg.startsWith(root+path.sep))fail('COMMAND_USES_ORIGINAL_CHECKOUT');
 return {protocol:1,pr,repositoryRoot:root,profile:source.profile.id,configHash:hash(source),hardware:hardware(),
  requirements:requirements(request.requirements||[]),source,
  workflow:['checkout-pinned-pr','build-start','reuse-b-local-login','prepare-samples','execute-cases','stop','collect'],
  authorization:{reuse:'B-local application vault',firstAuthorization:'not-implemented; independent of SSH'},
  evidence:{realHardware:'not-yet-verified',human:'pending when required',publication:'private until reviewed'}};
}
function runDirectory(id){if(!UUID.test(id||''))fail('INVALID_REMOTE_ID');return path.join(defaultHome(),'ssh-runs',id);}
function readRun(request){const dir=runDirectory(request.runId),run=JSON.parse(fs.readFileSync(path.join(dir,'run.json'),'utf8'));if(run.planHash!==request.planHash)fail('REMOTE_RUN_MISMATCH');return {dir,run};}
function coreFor(dir){return new Environments(path.join(dir,'catalog'));}
function recoverJob(dir,run){if(!run.jobId&&fs.existsSync(path.join(dir,'catalog','catalog.json'))){Object.assign(run,JSON.parse(fs.readFileSync(path.join(dir,'run.json'),'utf8')));if(run.jobId||run.supervisorPid&&identity(run.supervisorPid)===run.supervisorIdentity)return;const jobs=coreFor(dir).jobs().filter(j=>j.action==='start');if(jobs.length===1){run.jobId=jobs[0].jobId;atomic(path.join(dir,'run.json'),run);}}}
function status(request){
 const {dir,run}=readRun(request);recoverJob(dir,run);
 const job=run.jobId?coreFor(dir).status(run.jobId):null;
 const known=run.actions||[],actions=run.jobId?coreFor(dir).jobs().filter(j=>j.action!=='start').map(j=>({...known.find(a=>a.jobId===j.jobId),jobId:j.jobId,status:j})):[];
 let state=job?job.state:run.state;
 if(fs.existsSync(path.join(dir,'cancel.json'))&&[job,...actions.map(a=>a.status)].some(j=>j&&!['completed','failed','stopped'].includes(j.state)))state='stopping';
 if(!job&&!['failed','stopped'].includes(state)&&(!run.supervisorPid||identity(run.supervisorPid)!==run.supervisorIdentity))state='unknown';
 return {runId:request.runId,state,stage:run.stage,execution:job?.execution||run.execution||'unknown',pr:run.plan.pr,
  actualCommit:run.actualCommit||null,checkout:run.checkout||null,hardware:run.plan.hardware,profile:run.plan.profile,
  job,actions,requirements:run.plan.requirements,acceptance:'not-certified-by-command-exit',errorCode:run.errorCode||null};
}
function readArtifact(file,max,tail=false){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>max&&!tail)fail('ARTIFACT_SIZE_LIMIT');if(stat.size<=max)return fs.readFileSync(fd);const bytes=Buffer.alloc(max);fs.readSync(fd,bytes,0,max,stat.size-max);return Buffer.concat([Buffer.from('[Truncated: last bytes of this run log]\n'),bytes]);}finally{fs.closeSync(fd);}
}
async function dispatch(request){
 if(!request||typeof request.method!=='string')fail('INVALID_REMOTE_REQUEST');
 if(request.method==='catalog')return {protocol:1,hardware:hardware(),catalog:new Environments().catalog()};
 if(request.method==='plan')return plan(request);
 if(request.method==='start'){
  const dir=runDirectory(request.runId);
  if(hash(request.plan)!==request.planHash)fail('REMOTE_PLAN_MISMATCH');
  if(fs.existsSync(path.join(dir,'run.json')))return status(request);
  const fresh=plan({profile:request.plan.profile,pr:request.plan.pr,requirements:request.plan.requirements.map(({state,...r})=>r)});
  if(hash(fresh)!==request.planHash)fail('REMOTE_PLAN_CHANGED');
  try{fs.mkdirSync(dir,{mode:0o700,recursive:false});}catch(e){if(e.code==='ENOENT'){fs.mkdirSync(path.dirname(dir),{recursive:true,mode:0o700});fs.mkdirSync(dir,{mode:0o700});}else if(e.code==='EEXIST')fail('REMOTE_START_UNCONFIRMED','unknown');else throw e;}
  const run={plan:request.plan,planHash:request.planHash,state:'preparing',stage:'checkout',execution:'not_executed',actions:[]};atomic(path.join(dir,'run.json'),run);
  const log=fs.openSync(path.join(dir,'build.log'),'a',0o600);let child;
  try{child=spawn(process.execPath,[path.join(__dirname,'remote-runner.cjs'),dir],{detached:true,stdio:['ignore',log,log],env:{...process.env,PATH:path.dirname(process.execPath)+path.delimiter+(process.env.PATH||'')}});child.unref();}finally{fs.closeSync(log);}
  child.on('error',()=>atomic(path.join(dir,'run.json'),{...run,state:'failed',errorCode:'REMOTE_RUNNER_START_FAILED'}));
  return {runId:request.runId,state:'preparing',execution:'requested',nextAction:'Query this runId. Do not repeat start after a lost SSH reply.'};
 }
 const {dir,run}=readRun(request);recoverJob(dir,run);const core=coreFor(dir);
 if(request.method==='status')return status(request);
 if(request.method==='stop'){
  atomic(path.join(dir,'cancel.json'),{requested:true});
  for(const job of core.jobs())if(!['completed','failed','stopped'].includes(job.state))core.stop(job.jobId);
  return {runId:request.runId,state:'stopping',execution:'requested',nextAction:'Query until the owned instance stops. No profiles or credentials are deleted.'};
 }
 if(request.method==='select_account'){
  if(!run.jobId)fail('REMOTE_APP_NOT_STARTED');return core.selectAccount(run.jobId,request.account);
 }
 if(request.method==='action'){
  if(!['prepare','verify'].includes(request.action)||!UUID.test(request.actionId||''))fail('INVALID_ACTION');
  if((run.actions||[]).some(a=>a.actionId===request.actionId))return status(request);
  if(!run.jobId||!['ready','running'].includes(core.status(run.jobId).state))fail('REMOTE_APP_NOT_READY');
  if(core.jobs().some(j=>j.action!=='start'&&!['stopped','failed','completed'].includes(j.state)))fail('REMOTE_ACTION_PENDING');
  if(!run.plan.source.project.commands?.[request.action])fail('ACTION_NOT_CONFIGURED');
  const lock=path.join(dir,'.action-lock');try{fs.mkdirSync(lock);}catch{fail('REMOTE_ACTION_BUSY');}
  try{
   if(core.jobs().some(j=>j.action!=='start'&&!['stopped','failed','completed'].includes(j.state)))fail('REMOTE_ACTION_PENDING');
   const result=core.start(run.plan.profile,request.action);run.actions.push({actionId:request.actionId,action:request.action,jobId:result.jobId});atomic(path.join(dir,'run.json'),run);
   return {runId:request.runId,actionId:request.actionId,jobId:result.jobId,execution:'requested',requirements:run.plan.requirements};
  }finally{fs.rmdirSync(lock);}
 }
 if(request.method==='collect'){
  const result=status(request),files=[];
  function add(name,bytes){files.push({name,content:bytes.toString('base64'),sha256:hash(bytes)});}
  add('result.json',Buffer.from(JSON.stringify(result,null,2)+'\n'));
  if(request.logs){add('build.log',readArtifact(path.join(dir,'build.log'),2*1024*1024,true));if(run.jobId)add('app.log',readArtifact(path.join(dir,'catalog','jobs',run.jobId,'output.log'),2*1024*1024,true));}
  if(request.screenshot){if(!run.jobId)fail('REMOTE_APP_NOT_STARTED');const shot=await core.inspect(run.jobId,true);add('inspection.png',readArtifact(shot.screenshot,16*1024*1024));}
  return {result,files};
 }
 fail('UNKNOWN_REMOTE_OPERATION');
}
module.exports={dispatch,plan,status,hash,hardware,requirements,runDirectory};
