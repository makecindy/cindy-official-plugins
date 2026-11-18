'use strict';
// One run only. No service, credential copying, broad process kill or workspace overwrite.
const fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {Environments,atomic}=require('./core.cjs');
const {identity}=require('./observation.cjs');
const dir=process.argv[2],file=path.join(dir,'run.json');let run=JSON.parse(fs.readFileSync(file,'utf8'));
function write(patch){run={...run,...patch};atomic(file,run);}
function cancelled(){if(fs.existsSync(path.join(dir,'cancel.json'))){write({state:'stopped',stage:'cancelled-before-start'});return true;}return false;}
function git(args){return execFileSync('git',['-C',run.plan.repositoryRoot,...args],{encoding:'utf8',timeout:90000,stdio:['ignore','pipe','pipe']}).trim();}
try{
 write({supervisorPid:process.pid,supervisorIdentity:identity(process.pid)});if(cancelled())process.exit();
 const ref=`refs/test-environments/${path.basename(dir)}`;
 git(['fetch','--no-tags','--no-write-fetch-head','origin',`refs/pull/${run.plan.pr.number}/head:${ref}`]);if(cancelled())process.exit();
 const commit=git(['rev-parse',ref]);if(commit!==run.plan.pr.commit)throw Object.assign(Error(),{code:'PR_HEAD_CHANGED'});
 const checkout=path.join(dir,'checkout');git(['worktree','add','--detach',checkout,commit]);write({checkout,actualCommit:commit,stage:'build-start'});if(cancelled())process.exit();
 const source=run.plan.source,core=new Environments(path.join(dir,'catalog'));
 core.saveProject({...source.project,root:checkout});
 for(const account of source.accounts)core.saveAccount(account);
 core.saveProfile(source.profile);for(const c of source.cases)core.saveCase(c);
 if(cancelled())process.exit();
 const job=core.start(source.profile.id);write({jobId:job.jobId,state:'started',stage:'application',execution:'executed'});
 if(fs.existsSync(path.join(dir,'cancel.json')))core.stop(job.jobId);
}catch(e){write({state:'failed',errorCode:/^[A-Z_]+$/.test(e.code||'')?e.code:'REMOTE_PREPARATION_FAILED',execution:'unknown',applicationExecution:run.jobId?'unknown':run.stage==='checkout'?'not_executed':'unknown'});}
