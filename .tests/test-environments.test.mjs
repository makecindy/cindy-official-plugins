import './test-environments-login-library.cases.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as wait} from 'node:timers/promises';
import vm from 'node:vm';
import net from 'node:net';
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
test('Cindy plan preserves legacy and uses existing launch flags with real account supervision',t=>{
 const{dir,app}=fixture(t);fs.mkdirSync(path.join(dir,'scripts/lib'),{recursive:true});fs.writeFileSync(path.join(dir,'scripts/restart-desktop-remote.mjs'),'');fs.writeFileSync(path.join(dir,'scripts/desktop-restart-runner.mjs'),'');
 app.invoke('save_project',{project:{id:'cindy',label:'Cindy',root:dir,adapter:'cindy'}});
 const profile={id:'old',label:'Original',project:'cindy',platform:'desktop',mode:'legacy',isolated:'dev2-test'};
 app.invoke('save_profile',{profile});assert.deepEqual(app.invoke('plan',{profile:'old'}).argv,['node',path.join(root,'node/cindy-launch.cjs'),fs.realpathSync(dir),'--region=global','--isolated=dev2-test']);
 assert.throws(()=>app.invoke('save_profile',{profile:{...profile,account:'a'}}));
 app.invoke('save_account',{account:{id:'a',label:'A',project:'cindy',selector:'qa-a'}});
 app.invoke('save_profile',{profile:{...profile,id:'new',mode:'acceptance',account:'a',remoteControl:'off',background:'off'}});
 assert.throws(()=>app.invoke('plan',{profile:'new'}),{code:'DEBUG_PORT_REQUIRED'});
 app.invoke('save_profile',{profile:{...profile,id:'new',mode:'acceptance',account:'a',remoteControl:'off',background:'off',debugPort:9237}});
 const plan=app.invoke('plan',{profile:'new'}),argv=plan.argv;
 assert.ok(argv.includes('--passive'));assert.equal(plan.account.selector,'qa-a');
 assert.ok(!argv.some(a=>/^--(account|preset|fixture|login-source|serve-login|remote-control|background)=/.test(a)));
 assert.deepEqual(plan.workflow.steps,['start','select-account','prepare-samples','execute-cases','stop']);
 assert.equal(fs.existsSync(path.join(dir,'scripts/lib/dev-acceptance.mjs')),false);
 app.invoke('save_profile',{profile:{id:'android',label:'Android',project:'cindy',platform:'android',mode:'acceptance',account:'a'}});
 assert.equal(app.invoke('plan',{profile:'android'}).handoff.plugin,'baguette-simulator');
});
async function until(fn,predicate,timeout=4000){const end=Date.now()+timeout;while(Date.now()<end){const result=fn();if(predicate(result))return result;await wait(20);}assert.fail('Timed out waiting for runner');}
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
test('legacy desktop runner retains login waiting and exact startup failures without acceptance WIP',async t=>{
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
    if(action==='ready')save(receipt,{...record,state:'ready'});
    if(action==='fail')save(path.join(dir,'startup.json'),{state:'failed',code:'FIXTURE_AUTH_FAILURE',pid:process.pid});};
   fs.watch(dir,check);setInterval(()=>{},1000);`);
  fs.writeFileSync(path.join(job,'plan.json'),JSON.stringify({argv:[process.execPath,entry,job],projectRoot:dir,readiness:'cindy',env:{},configuration:{mode:'legacy'}}));
  fs.writeFileSync(path.join(job,'status.json'),JSON.stringify({jobId:name,startedAt:Date.now(),state:'starting'}));
  const child=spawn(process.execPath,[path.join(root,'node/runner.cjs'),job],{stdio:'ignore'});
  const exited=once(child,'exit');const status=()=>JSON.parse(fs.readFileSync(path.join(job,'status.json')));
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){fs.writeFileSync(path.join(job,'cancel.json'),'{}');await exited;}});
  await until(status,s=>s.state==='waiting-for-owner');
  return {job,status,exited};
 };
 const a=await launch('ready-case');
 fs.writeFileSync(path.join(a.job,'action'),'ready');
 const ready=await until(a.status,s=>s.state==='ready');assert.equal(ready.verification,'application-ready');assert.equal(ready.nextAction,undefined);assert.equal(ready.code,undefined);
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

const {SessionMonitor}=require('../test-environments/node/session-monitor.cjs');
const {rememberAccounts}=require('../test-environments/node/account-catalog.cjs');
const {accountExpression,projectSnapshot}=require('../test-environments/node/observation.cjs');
function realAccountPlan(t){
 const {dir,app}=fixture(t);
 fs.mkdirSync(path.join(dir,'scripts'));fs.writeFileSync(path.join(dir,'scripts/restart-desktop-remote.mjs'),'');fs.writeFileSync(path.join(dir,'scripts/desktop-restart-runner.mjs'),'');
 app.invoke('save_project',{project:{id:'cindy',label:'Example project',root:dir,adapter:'cindy'}});
 app.invoke('save_profile',{profile:{id:'daily',label:'Daily',project:'cindy',platform:'desktop',mode:'acceptance',isolated:'accounts',debugPort:9237}});
 const plan={...app.invoke('plan',{profile:'daily'}),catalogHome:app.home};
 const job=path.join(dir,'job');fs.mkdirSync(job);
 return {dir,app,plan,job,application:{userDataDir:path.join(dir,'app-owned-data')}};
}
function snapshot(current='account-a'){
 return {authenticated:!!current,databaseReady:!!current,step:current?'authenticated':'identifier',code:null,remoteControl:false,verified:false,
  accounts:['account-a','account-b'].map(accountKey=>({accountKey,displayName:accountKey==='account-a'?'Example A':'Example B',isCurrent:current===accountKey}))};
}

test('app boundary projects safe fields and reuses existing account/refresh/database APIs',async()=>{
 let current='account-a',calls=[];
 const api={
  authInitialize:async()=>({mode:'cloud',isAuthenticated:true,dataOwnerId:'example-owner',token:'must-not-cross-boundary'}),
  authListAccounts:async()=>({accounts:snapshot(current).accounts.map(a=>({...a,refreshToken:'must-not-cross-boundary'}))}),
  authSwitchAccount:async key=>{calls.push(['switch',key]);current=key;},
  authRefresh:async()=>{calls.push(['refresh']);return true;},
  localDb:{ensureReady:async owner=>{calls.push(['database',owner]);return {ready:true};}},
  deviceLink:{getState:async()=>({remoteControlEnabled:false})}
 };
 const result=projectSnapshot(await vm.runInNewContext(accountExpression('select',{accountKey:'account-b'}),{window:{electronAPI:api}}));
 assert.equal(result.accounts.find(a=>a.isCurrent).accountKey,'account-b');
 assert.equal(JSON.stringify(result).includes('must-not-cross-boundary'),false);
 const verified=projectSnapshot(await vm.runInNewContext(accountExpression('verify'),{window:{electronAPI:api}}));
 assert.equal(verified.verified,true);assert.ok(calls.some(c=>c[0]==='refresh'));
 assert.ok(calls.some(c=>c[0]==='database'&&c[1]==='example-owner'));
 assert.throws(()=>accountExpression('evaluate',{expression:'anything'}),{code:'UNKNOWN_OPERATION'});
 // A key is data, including JS metacharacters; it cannot become an extra action.
 const key='account-";throw Error("injected");//';
 await vm.runInNewContext(accountExpression('select',{accountKey:key}),{window:{electronAPI:api}});
 assert.equal(current,key);
});

test('all app-saved accounts are remembered across plugin restarts and metadata edits without copying credentials',t=>{
 const {app,plan,application}=realAccountPlan(t);
 const supplied={...snapshot(),accessToken:'never-persist',accounts:snapshot().accounts.map(a=>({...a,cookie:'never-persist'}))};
 const safe=projectSnapshot({...supplied,supported:true});
 rememberAccounts(app.home,plan,application,safe);
 const reopened=new Environments(app.home),accounts=Object.values(reopened.catalog().accounts);
 assert.equal(accounts.length,2);assert.ok(accounts.every(a=>a.sessions.daily.listed));
 assert.ok(accounts.find(a=>a.selector==='account-a').sessions.daily.lastAuthenticatedAt);
 const before=reopened.catalog().revision;
 rememberAccounts(app.home,plan,application,safe);assert.equal(reopened.catalog().revision,before);
 const a=accounts[0];reopened.invoke('save_account',{account:{id:a.id,project:a.project,label:'Renamed',selector:a.selector}});
 assert.equal(reopened.catalog().accounts[a.id].sessions.daily.userDataDir,application.userDataDir);
 assert.equal(fs.readFileSync(reopened.file,'utf8').includes('never-persist'),false);
 // Logging out removes reusability, not history or the other saved account.
 rememberAccounts(app.home,plan,application,{...snapshot(null),accounts:[snapshot().accounts[1]]});
 assert.equal(reopened.catalog().accounts[a.id].sessions.daily.listed,false);
 assert.equal(Object.keys(reopened.catalog().accounts).length,2);
});

test('real account A to B to A requires online identity and keeps both local sessions',async t=>{
 const {app,plan,job,application}=realAccountPlan(t);let current='account-a',online=true;const switches=[];
 const perform=async(_plan,_status,op,args)=>{
  if(op==='select'){switches.push(args.accountKey);current=args.accountKey;}
  return {...snapshot(current),verified:op==='verify'&&online};
 };
 const monitor=new SessionMonitor(plan,job,{perform});const state={application};
 assert.equal((await monitor.poll(state)).state,'ready');
 const accounts=Object.values(app.catalog().accounts),a=accounts.find(a=>a.selector==='account-a'),b=accounts.find(a=>a.selector==='account-b');
 const request=account=>fs.writeFileSync(path.join(job,'select-account.json'),JSON.stringify({requestId:'example-request',account}));
 request(b);assert.equal((await monitor.poll(state)).state,'checking-account');
 assert.equal((await monitor.poll(state)).verification,'application-account-online');
 request(a);await monitor.poll(state);assert.equal((await monitor.poll(state)).state,'ready');
 assert.deepEqual(switches,['account-b','account-a']);assert.equal(Object.keys(app.catalog().accounts).length,2);
 assert.deepEqual((await monitor.poll(state)).acceptance,{samples:'not-verified',cases:'not-executed'});
 online=false;const cold=new SessionMonitor(plan,job,{perform});assert.equal((await cold.poll(state)).state,'checking-account');
});

test('a new computer needs its own sign-in; missing credentials never make the account unusable elsewhere',async t=>{
 const first=realAccountPlan(t);rememberAccounts(first.app.home,first.plan,first.application,snapshot());
 const a=Object.values(first.app.catalog().accounts).find(a=>a.selector==='account-a');
 const second=realAccountPlan(t);let loggedIn=false,switches=0;
 // Transfer only the public identity/configuration, never first-computer session bindings.
 second.app.invoke('save_account',{account:{id:a.id,project:'cindy',label:a.label,selector:a.selector}});
 const plan={...second.plan,account:{id:a.id,label:a.label,selector:a.selector}};
 const monitor=new SessionMonitor(plan,second.job,{perform:async(_p,_s,op)=>{
  if(op==='select')switches++;
  return loggedIn?{...snapshot(),verified:op==='verify'}:{...snapshot(null),accounts:[]};
 }});
 assert.equal((await monitor.poll({application:second.application})).code,'ACCOUNT_SIGN_IN_REQUIRED');assert.equal(switches,0);
 loggedIn=true;assert.equal((await monitor.poll({application:second.application})).state,'ready');
 assert.notEqual(first.app.catalog().accounts[a.id].sessions.daily.userDataDir,second.app.catalog().accounts[a.id].sessions.daily.userDataDir);
 assert.equal(first.app.catalog().accounts[a.id].sessions.daily.listed,true);
});

test('uncertain account switching is not retried and requires an explicit new selection',async t=>{
 const {app,plan,job,application}=realAccountPlan(t);let calls=0;
 const monitor=new SessionMonitor({...plan,account:{selector:'account-b'}},job,{perform:async(_p,_s,op)=>{
  if(op==='select'){calls++;throw Error('simulated lost reply');}return snapshot();
 }});
 await assert.rejects(monitor.poll({application}));
 assert.equal((await monitor.poll({application})).code,'ACCOUNT_SELECTION_UNCONFIRMED');assert.equal(calls,1);
 const b=Object.values(app.catalog().accounts).find(a=>a.selector==='account-b');
 fs.writeFileSync(path.join(job,'select-account.json'),JSON.stringify({account:b}));
 await assert.rejects(monitor.poll({application}));assert.equal(calls,2);
});

test('expired saved sessions explicitly require reauthorization without repeated switches',async t=>{
 const {plan,job,application}=realAccountPlan(t);let attempts=0;
 const api={authInitialize:async()=>({mode:'signed-out',isAuthenticated:false}),authListAccounts:async()=>({accounts:snapshot(null).accounts}),
  authGetLoginState:async()=>({success:true,state:{step:'identifier'}}),
  authSwitchAccount:async()=>{attempts++;throw Error('Error invoking remote method: Error: [ACCOUNT_REAUTH_REQUIRED] private detail');}};
 const perform=async(_p,_s,op,args)=>projectSnapshot(await vm.runInNewContext(accountExpression(op,args),{window:{electronAPI:api}}));
 const monitor=new SessionMonitor({...plan,account:{selector:'account-b'}},job,{perform});
 const result=await monitor.poll({application});assert.equal(result.code,'ACCOUNT_REAUTH_REQUIRED');assert.equal(result.state,'waiting-for-owner');
 assert.equal((await monitor.poll({application})).code,'ACCOUNT_REAUTH_REQUIRED');assert.equal(attempts,1);
 assert.equal(JSON.stringify(result).includes('private detail'),false);
});

test('live recording respects catalog locks and removed profiles rather than recreating them',async t=>{
 const {app,plan,job,application}=realAccountPlan(t);
 fs.mkdirSync(path.join(app.home,'.catalog-lock'));
 const monitor=new SessionMonitor(plan,job,{perform:async()=>snapshot()});
 assert.equal((await monitor.poll({application})).code,'CATALOG_BUSY');
 fs.rmdirSync(path.join(app.home,'.catalog-lock'));
 app.invoke('remove',{kind:'profiles',id:'daily'});
 assert.equal(rememberAccounts(app.home,plan,application,snapshot()).reason,'PROFILE_CHANGED');
 assert.equal(Object.keys(app.catalog().accounts).length,0);
});

test('queued selection invalidates stale readiness and rejects duplicate or cross-project requests',t=>{
 const {app,plan,application}=realAccountPlan(t);rememberAccounts(app.home,plan,application,snapshot());
 const jobId='queued-selection',dir=path.join(app.home,'jobs',jobId);fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'plan.json'),JSON.stringify(plan));
 fs.writeFileSync(path.join(dir,'status.json'),JSON.stringify({jobId,state:'ready',profile:'daily',application,verification:'application-account-online',accountVerifiedAt:1}));
 const account=Object.values(app.catalog().accounts)[1];
 assert.equal(app.invoke('select_account',{jobId,account:account.id}).execution,'requested');
 const pending=app.invoke('status',{jobId});assert.equal(pending.state,'checking-account');assert.equal(pending.verification,undefined);
 assert.throws(()=>app.invoke('select_account',{jobId,account:account.id}),{code:'SELECTION_PENDING'});
 assert.throws(()=>app.invoke('select_account',{jobId,account:'missing'}),{code:'ACCOUNT_PROJECT_MISMATCH'});
});

test('real runner and owned CDP transport capture app accounts without acceptance receipts or secret leakage',{skip:process.platform==='win32'},async t=>{
 const {app,plan,job}=realAccountPlan(t);
 const reserve=net.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const configured={...plan,env:{XDT_CDP_PORT:String(port)},argv:[process.execPath,path.resolve(import.meta.dirname,'fixtures/test-environments-app.cjs'),job]};
 fs.writeFileSync(path.join(job,'plan.json'),JSON.stringify(configured));
 fs.writeFileSync(path.join(job,'status.json'),JSON.stringify({jobId:'example-job',profile:'daily',projectRoot:plan.projectRoot,startedAt:Date.now(),state:'starting'}));
 fs.writeFileSync(path.join(job,'account.json'),JSON.stringify({current:null}));
 const runner=spawn(process.execPath,[path.join(root,'node/runner.cjs'),job],{stdio:'ignore'}),exited=once(runner,'exit');
 const status=()=>JSON.parse(fs.readFileSync(path.join(job,'status.json')));
 try{
  await until(status,s=>s.code==='ACCOUNT_SIGN_IN_REQUIRED',10000);
  fs.writeFileSync(path.join(job,'account.json'),JSON.stringify({current:'account-a'}));
  assert.equal((await until(status,s=>s.state==='ready',10000)).verification,'application-account-online');
  fs.writeFileSync(path.join(job,'account.json'),JSON.stringify({current:'account-b'}));
  await until(()=>Object.keys(app.catalog().accounts).length,n=>n===2,10000);
  await until(status,s=>s.state==='ready'&&s.accountsRemembered===2,10000);
  fs.writeFileSync(path.join(job,'cancel.json'),'{}');await exited;
  assert.equal(status().state,'stopped');assert.equal(Object.keys(new Environments(app.home).catalog().accounts).length,2);
  assert.equal(fs.readFileSync(app.file,'utf8').includes('must-not-leak'),false);
  assert.equal(fs.readFileSync(path.join(job,'status.json'),'utf8').includes('must-not-leak'),false);
 }finally{
  if(runner.exitCode===null&&runner.signalCode===null){fs.writeFileSync(path.join(job,'cancel.json'),'{}');await exited;}
 }
});

test('online verification reports the latest account and requires the requested control setting',async t=>{
 const {plan,job,application}=realAccountPlan(t);
 for(const change of ['signed-out','account','control']){
  const initial=snapshot();const changed=change==='signed-out'?snapshot(null):change==='account'?snapshot('account-b'):{...initial,remoteControl:true};
  const monitor=new SessionMonitor({...plan,configuration:{...plan.configuration,remoteControl:'off'}},job,{perform:async(_p,_s,op)=>op==='verify'?{...changed,verified:true}:{...initial,remoteControl:false}});
  const result=await monitor.poll({application});assert.notEqual(result.state,'ready');
  assert.equal(result.login.authenticated,changed.authenticated);
  assert.equal(result.currentAccount?.accountKey,changed.authenticated?changed.accounts.find(a=>a.isCurrent)?.accountKey:undefined);
  if(change==='control')assert.equal(result.code,'REMOTE_CONTROL_UNCONFIRMED');
 }
});

test('a reused supervisor PID cannot preserve stale ready/account verification',t=>{
 const {app}=fixture(t),jobId='stale-supervisor',dir=path.join(app.home,'jobs',jobId);fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'status.json'),JSON.stringify({jobId,state:'ready',supervisorPid:process.pid,supervisorIdentity:'different process start',verification:'application-account-online',accountVerifiedAt:1}));
 const result=app.status(jobId);assert.equal(result.state,'unknown');assert.equal(result.verification,undefined);assert.equal(result.accountVerifiedAt,undefined);
 assert.throws(()=>app.stop(jobId),{code:'JOB_UNCONFIRMED'});
});

test('the public remote worker preserves unknown execution on a lost operation receipt',async()=>{
 let onRequest,reply;
 class App{async invoke(){throw Error('lost receipt');}}
 const context={require:name=>name==='./core.cjs'?{Environments:App}:{createInterface:()=>({on:(_event,callback)=>{onRequest=callback;}})},process:{stdin:{},stdout:{write:text=>{reply=JSON.parse(text);}}}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'node/worker.cjs'),'utf8'),context);
 await onRequest(JSON.stringify({id:1,method:'remote',params:{operation:'start'}}));assert.equal(reply.result.execution,'unknown');
});

test('a previously verified session becoming signed out keeps explicit reauthorization guidance without switching again',async t=>{
 const {plan,job,application}=realAccountPlan(t);let current='account-a',switches=0;
 const monitor=new SessionMonitor({...plan,account:{selector:'account-a'}},job,{perform:async(_p,_s,op)=>{if(op==='select')switches++;return {...snapshot(current),verified:op==='verify'};}});
 assert.equal((await monitor.poll({application})).state,'ready');current=null;
 for(let i=0;i<2;i++){const state=await monitor.poll({application});assert.equal(state.state,'waiting-for-owner');assert.equal(state.code,'ACCOUNT_REAUTH_REQUIRED');assert.equal(state.verification,undefined);}
 assert.equal(switches,0);
});

test('owned CDP capture saves only valid bounded PNGs and rejects screenshots after stop',{skip:process.platform==='win32'},async t=>{
 const {app,plan,job}=realAccountPlan(t),jobId='capture-job';
 const dir=path.join(app.home,'jobs',jobId);fs.mkdirSync(dir,{recursive:true});
 const reserve=net.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const configured={...plan,env:{XDT_CDP_PORT:String(port)},argv:[process.execPath,path.resolve(import.meta.dirname,'fixtures/test-environments-app.cjs'),dir]};
 fs.writeFileSync(path.join(dir,'plan.json'),JSON.stringify(configured));fs.writeFileSync(path.join(dir,'status.json'),JSON.stringify({jobId,profile:'daily',projectRoot:plan.projectRoot,startedAt:Date.now(),state:'starting'}));fs.writeFileSync(path.join(dir,'account.json'),JSON.stringify({current:'account-a'}));
 const runner=spawn(process.execPath,[path.join(root,'node/runner.cjs'),dir],{stdio:'ignore'}),exited=once(runner,'exit');
 t.after(async()=>{if(runner.exitCode===null&&runner.signalCode===null){fs.writeFileSync(path.join(dir,'cancel.json'),'{}');await exited;}});
 await until(()=>app.status(jobId),s=>s.state==='ready',10000);
 fs.writeFileSync(path.join(dir,'capture.json'),JSON.stringify({mode:'valid'}));const result=await app.inspect(jobId,true),png=fs.readFileSync(path.join(root,'assets/icon.png'));assert.deepEqual(fs.readFileSync(result.screenshot),png);assert.equal(fs.statSync(result.screenshot).mode&0o777,0o600);assert.equal(JSON.stringify(result).includes('must-not-leak'),false);
 for(const mode of ['invalid','oversize']){fs.writeFileSync(path.join(dir,'capture.json'),JSON.stringify({mode}));await assert.rejects(app.inspect(jobId,true),{code:'INVALID_CAPTURE'});assert.deepEqual(fs.readFileSync(result.screenshot),png);}
 fs.writeFileSync(path.join(dir,'cancel.json'),'{}');await exited;await assert.rejects(app.inspect(jobId,true),{code:'APP_NOT_INSPECTABLE'});
});

test('native-picked project setup reuses canonical roots and profiles without resetting accounts or starting apps',t=>{
 const {dir,app}=fixture(t),root=path.join(dir,'source');fs.mkdirSync(path.join(root,'scripts'),{recursive:true});fs.writeFileSync(path.join(root,'scripts/restart-desktop-remote.mjs'),'');
 const first=app.ensureTestProject({root,label:'My Cindy'});app.saveAccount({id:'a',project:first.project.id,label:'Example',selector:'example-a'});const profile={...app.catalog().profiles[first.profile.id],account:'a'};app.saveProfile(profile);
 const alias=path.join(dir,'source-link');fs.symlinkSync(root,alias,'dir');const second=app.ensureTestProject({root:alias,label:'Folder name'});assert.equal(second.project.id,first.project.id);assert.equal(second.profile.id,first.profile.id);assert.equal(second.project.label,'My Cindy');assert.equal(app.catalog().profiles[first.profile.id].account,'a');assert.equal(Object.keys(app.catalog().projects).length,1);assert.equal(Object.keys(app.catalog().profiles).length,1);assert.equal(app.jobs().length,0);assert.equal(JSON.stringify(second).includes(root),false);
 assert.equal(app.ensureTestProject({project:first.project.id}).profile.id,first.profile.id);const revision=app.catalog().revision;assert.throws(()=>app.ensureTestProject({root:dir,label:'Not source'}),{code:'INVALID_PROJECT'});assert.equal(app.catalog().revision,revision);assert.throws(()=>app.ensureTestProject({project:'missing'}),{code:'PROJECT_NOT_FOUND'});
});
