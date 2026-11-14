import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as wait} from 'node:timers/promises';
const require=createRequire(import.meta.url),{Environments}=require('../test-environments/node/core.cjs');
const root=path.resolve(import.meta.dirname,'../test-environments');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'test-environments-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return {dir,app:new Environments(path.join(dir,'store'))};}
// Public API persistence: stale UI writes, account identity and dependent records.
test('public catalog persists profiles and rejects stale writes, secret fields and rebinding',t=>{
 const{dir,app}=fixture(t);app.invoke('save_project',{project:{id:'sample',label:'Example',root:dir,adapter:'command',commands:{start:[process.execPath,'--version']}}});
 app.invoke('save_account',{account:{id:'a',label:'Account A',project:'sample',selector:'qa-a'}});
 app.invoke('save_profile',{profile:{id:'daily',label:'Daily',project:'sample',platform:'desktop',mode:'acceptance',account:'a',remoteControl:'off'}});
 assert.equal(new Environments(app.home).invoke('catalog').profiles.daily.account,'a');
 assert.throws(()=>app.invoke('save_account',{account:{id:'a',label:'B',project:'sample',selector:'b'}}),{code:'ACCOUNT_IDENTITY_CHANGED'});
 assert.throws(()=>app.invoke('save_account',{account:{id:'b',label:'B',project:'sample',selector:'b',token:'secret'}}),{code:'UNKNOWN_FIELD'});
 assert.throws(()=>app.invoke('save_project',{project:{id:'constructor',label:'bad',root:dir,adapter:'command'}}),{code:'INVALID_ID'});
 assert.throws(()=>app.invoke('remove',{kind:'accounts',id:'a'}),{code:'RECORD_IN_USE'});
 assert.throws(()=>app.invoke('remove',{kind:'profiles',id:'daily',revision:0}),{code:'REVISION_CHANGED'});
 assert.equal(fs.statSync(path.join(app.home,'catalog.json')).mode&0o777,0o600);
});
// Parameter contract: the original launch gets none of the added acceptance options.
test('Cindy plan preserves legacy and resolves exact acceptance account and switches',t=>{
 const{dir,app}=fixture(t);fs.mkdirSync(path.join(dir,'scripts/lib'),{recursive:true});fs.writeFileSync(path.join(dir,'scripts/restart-desktop-remote.mjs'),'');fs.writeFileSync(path.join(dir,'scripts/desktop-restart-runner.mjs'),'');
 app.invoke('save_project',{project:{id:'cindy',label:'Cindy',root:dir,adapter:'cindy'}});
 const profile={id:'old',label:'Original',project:'cindy',platform:'desktop',mode:'legacy',isolated:'dev2-test'};
 app.invoke('save_profile',{profile});assert.deepEqual(app.invoke('plan',{profile:'old'}).argv,['node',path.join(root,'node/cindy-launch.cjs'),fs.realpathSync(dir),'--region=global','--isolated=dev2-test']);
 assert.throws(()=>app.invoke('save_profile',{profile:{...profile,account:'a'}}));
 app.invoke('save_account',{account:{id:'a',label:'A',project:'cindy',selector:'qa-a'}});
 app.invoke('save_profile',{profile:{...profile,id:'new',mode:'acceptance',account:'a',remoteControl:'off',background:'off'}});
 assert.throws(()=>app.invoke('plan',{profile:'new'}),{code:'PROJECT_UPDATE_REQUIRED'});
 fs.writeFileSync(path.join(dir,'scripts/lib/dev-acceptance.mjs'),'');
 const argv=app.invoke('plan',{profile:'new'}).argv;for(const flag of ['--account=qa-a','--remote-control=off','--background=off'])assert.ok(argv.includes(flag));
 app.invoke('save_profile',{profile:{id:'android',label:'Android',project:'cindy',platform:'android',mode:'acceptance',account:'a'}});
 assert.equal(app.invoke('plan',{profile:'android'}).handoff.plugin,'baguette-simulator');
});
async function until(fn,predicate){const end=Date.now()+4000;while(Date.now()<end){const result=fn();if(predicate(result))return result;await wait(20);}assert.fail('Timed out waiting for runner');}
// Real child processes, no mocks: exits and ownership-scoped stop leave data intact.
test('CLI shares catalog; detached job runs, refuses duplicates and stops without deleting data',async t=>{
 const{dir,app}=fixture(t);const entry=path.join(dir,'app.cjs');fs.writeFileSync(entry,"require('node:fs').writeFileSync(process.argv[2], 'retained'); setInterval(()=>{}, 1000);");
 const marker=path.join(dir,'login-placeholder');
 app.invoke('save_project',{project:{id:'example',label:'Example',root:dir,adapter:'command',commands:{start:[process.execPath,entry,marker],verify:[process.execPath,'-e',"process.exit(3)"]}}});
 app.invoke('save_profile',{profile:{id:'daily',label:'Daily',project:'example',platform:'linux',mode:'legacy'}});
 const fromCli=JSON.parse(execFileSync(process.execPath,[path.join(root,'node/cli.cjs'),'catalog'],{env:{...process.env,TEST_ENVIRONMENTS_HOME:app.home},encoding:'utf8'}));assert.equal(fromCli.result.profiles.daily.project,'example');
 const job=app.invoke('start',{profile:'daily'});t.after(async()=>{try{app.invoke('stop',{jobId:job.jobId});await until(()=>app.invoke('status',{jobId:job.jobId}),s=>s.state==='stopped');}catch{}});
 await until(()=>app.invoke('status',{jobId:job.jobId}),s=>s.state==='running'&&fs.existsSync(marker));
 assert.throws(()=>app.invoke('start',{profile:'daily'}),{code:'PROJECT_BUSY'});
 app.invoke('stop',{jobId:job.jobId});const stopped=await until(()=>app.invoke('status',{jobId:job.jobId}),s=>s.state==='stopped');assert.equal(stopped.dataPreserved,true);assert.equal(fs.readFileSync(marker,'utf8'),'retained');
 const failed=app.invoke('start',{profile:'daily',action:'verify'});const result=await until(()=>app.invoke('status',{jobId:failed.jobId}),s=>s.state==='failed');assert.equal(result.commandExitCode,3);
});

// Regression for macOS /usr/bin/script exiting on stdin EOF in background launches.
test('owned terminal retains a real TTY without owner input and forwards stop', {skip:process.platform!=='darwin'}, async t=>{
 const{dir}=fixture(t),marker=path.join(dir,'tty.json');
 const child=spawn('python3',[path.join(root,'node/terminal.py'),process.execPath,'-e',"require('fs').writeFileSync(process.argv[1],JSON.stringify({input:process.stdin.isTTY,output:process.stdout.isTTY,pid:process.pid}));process.stdin.on('end',()=>process.exit(9));process.stdin.resume();setInterval(()=>{},1000)",marker],{stdio:['ignore','pipe','pipe']});
 const exited=once(child,'exit');t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');});
 await until(()=>fs.existsSync(marker),Boolean);const actual=JSON.parse(fs.readFileSync(marker));assert.equal(actual.input,true);assert.equal(actual.output,true);assert.equal(child.exitCode,null);
 child.kill('SIGTERM');await exited;assert.throws(()=>process.kill(actual.pid,0),{code:'ESRCH'});
});

// Regression: real runner previously ignored the app's login-wait status and
// labelled startup failure as stopped. Existing command tests never exercised
// Cindy's receipt/status protocol. Minimum input: live owned receipt + status
// with DEV_SIGN_IN_REQUIRED, no corresponding stdout message. Integration tier.
test('desktop runner observes login waiting, then readiness or exact failure without a GUI',async t=>{
 const {dir}=fixture(t);
 const launch=async name=>{
  const job=path.join(dir,name),data=path.join(job,'app-data');fs.mkdirSync(path.join(data,'.dev-instances'),{recursive:true});
  const entry=path.join(job,'app.cjs');
  fs.writeFileSync(entry,`const fs=require('fs'),path=require('path');const dir=process.argv[2],data=path.join(dir,'app-data');
   const record={rootDir:${JSON.stringify(dir)},userDataDir:data,isolated:true,profileKind:'isolated-sandbox',startedAtMs:Date.now(),pid:process.pid,instanceId:'owned',state:'starting'};
   const save=(f,v)=>{fs.writeFileSync(f+'.tmp',JSON.stringify(v));fs.renameSync(f+'.tmp',f);};
   const receipt=path.join(data,'.dev-instances',process.pid+'.json');save(receipt,record);
   save(path.join(dir,'startup.json'),{state:'window-ready',code:'DEV_SIGN_IN_REQUIRED',pid:process.pid});
   console.log('==> Isolated dev user data: '+data);
   const check=()=>{let action;try{action=fs.readFileSync(path.join(dir,'action'),'utf8');}catch{return;}
    if(action==='ready')save(receipt,{...record,state:'ready',acceptance:{accountKey:'test-only',remoteControl:false}});
    if(action==='fail')save(path.join(dir,'startup.json'),{state:'failed',code:'FIXTURE_AUTH_FAILURE',pid:process.pid});};
   fs.watch(dir,check);setInterval(()=>{},1000);`);
  fs.writeFileSync(path.join(job,'plan.json'),JSON.stringify({argv:[process.execPath,entry,job],projectRoot:dir,readiness:'cindy',env:{},configuration:{mode:'acceptance'}}));
  fs.writeFileSync(path.join(job,'status.json'),JSON.stringify({jobId:name,startedAt:Date.now(),state:'starting'}));
  const child=spawn(process.execPath,[path.join(root,'node/runner.cjs'),job],{stdio:'ignore'});
  const exited=once(child,'exit');const status=()=>JSON.parse(fs.readFileSync(path.join(job,'status.json')));
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){fs.writeFileSync(path.join(job,'cancel.json'),'{}');await exited;}});
  await until(status,s=>s.state==='waiting-for-owner');
  return {job,status,exited};
 };
 const a=await launch('ready-case');
 fs.writeFileSync(path.join(a.job,'action'),'ready');
 const ready=await until(a.status,s=>s.state==='ready');assert.equal(ready.verification,'application-acceptance-receipt');assert.equal(ready.nextAction,undefined);assert.equal(ready.code,undefined);
 fs.writeFileSync(path.join(a.job,'cancel.json'),'{}');await a.exited;assert.equal(a.status().state,'stopped');
 const b=await launch('failure-case');fs.writeFileSync(path.join(b.job,'action'),'fail');await b.exited;
 assert.equal(b.status().state,'failed');assert.equal(b.status().code,'FIXTURE_AUTH_FAILURE');assert.equal(b.status().dataPreserved,true);
});

// Wrong-port attachment must fail before any HTTP request, rather than reading
// another application's window. This is a new ownership boundary for inspect.
test('inspection refuses another process identity before touching its debug endpoint',async t=>{
 const {dir,app}=fixture(t),job='inspection-test',jobDir=path.join(app.home,'jobs',job);fs.mkdirSync(jobDir,{recursive:true});
 fs.writeFileSync(path.join(jobDir,'plan.json'),JSON.stringify({readiness:'cindy',env:{XDT_CDP_PORT:'12345'}}));
 fs.writeFileSync(path.join(jobDir,'status.json'),JSON.stringify({jobId:job,state:'ready',application:{pid:process.pid,processIdentity:'different-process'}}));
 await assert.rejects(app.invoke('inspect',{jobId:job}),{code:'INSTANCE_CHANGED'});
});

// Regression found by real acceptance: pnpm's coordinator appends --wait-ready
// even when absent from caller argv. Exercise our launch entry with an exported
// coordinator that requires each stage, and rejects that flag at the app stage.
test('plugin launch retains coordinator checks while taking over only readiness waiting',t=>{
 const {dir}=fixture(t);fs.mkdirSync(path.join(dir,'scripts'));const stages=path.join(dir,'stages.json');
 fs.writeFileSync(path.join(dir,'scripts/desktop-restart-runner.mjs'),`import fs from 'node:fs';export function runDesktopRestart(argv,root,run){
  if(!argv.includes('--isolated=test'))throw Error('isolation');
  for(const progress of ['stopping','dependencies','assets','launching'])run({progress,command:process.execPath,args:['-e',"if(process.argv.includes('--wait-ready'))process.exit(7)",...(progress==='launching'?['--','--wait-ready']:[])]});
  fs.writeFileSync(${JSON.stringify(stages)},'complete');
 }export function assertDesktopRestartStepSucceeded(step,result){if(result.status!==0)throw Error('stage failed');}`);
 const cli=path.join(root,'node/cindy-launch.cjs'),env={...process.env,XDT_DESKTOP_DEV_STARTUP_STATUS_FILE:path.join(dir,'startup.json')};
 execFileSync(process.execPath,[cli,dir,'--isolated=test'],{env,stdio:'pipe'});assert.equal(fs.readFileSync(stages,'utf8'),'complete');
 assert.throws(()=>execFileSync(process.execPath,[cli,dir,'--isolated=wrong'],{env,stdio:'pipe'}),{status:1});
});
