import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync,spawn} from 'node:child_process';
import {setTimeout as wait} from 'node:timers/promises';
const require=createRequire(import.meta.url),agentRequire=createRequire(new URL('../test-environments/node/remote-agent.cjs',import.meta.url));
const {Environments,safeEnv}=require('../test-environments/node/core.cjs');
const {Remote,target,sshArguments,BOOTSTRAP,hash}=require('../test-environments/node/remote.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'test-environments-ssh-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function git(root,args){return execFileSync('git',['-C',root,...args],{encoding:'utf8',env:{...safeEnv(),HOME:root,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'},stdio:['ignore','pipe','pipe']}).trim();}
function fakeTransport(home){return async(_target,payload)=>new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,['-e',BOOTSTRAP],{env:{...safeEnv(),HOME:home,TEST_ENVIRONMENTS_HOME:path.join(home,'store'),GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'},stdio:['pipe','pipe','pipe']});let out='',err='';
 child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);
 child.on('close',code=>{try{assert.equal(code,0,err);const r=JSON.parse(out);if(!r.ok)reject(Object.assign(Error(r.message),{code:r.errorCode,execution:r.execution}));else resolve(r.data);}catch(e){reject(e);}});child.stdin.end(JSON.stringify(payload));
});}
async function until(fn,check){const end=Date.now()+12000;while(Date.now()<end){const value=await fn();if(check(value))return value;await wait(100);}assert.fail('Timed out waiting for simulated remote run');}
function setup(t){
 const dir=fixture(t),repo=path.join(dir,'repository'),b=path.join(dir,'computer-b'),a=path.join(dir,'computer-a');fs.mkdirSync(repo);fs.mkdirSync(b);fs.mkdirSync(a);
 git(repo,['init']);fs.writeFileSync(path.join(repo,'app.cjs'),"console.log('example application');setInterval(()=>{},1000);");
 fs.writeFileSync(path.join(repo,'prepare.cjs'),"require('fs').writeFileSync('sample.txt','example sample');");
 fs.writeFileSync(path.join(repo,'verify.cjs'),"if(require('fs').readFileSync('sample.txt','utf8')!=='example sample')process.exit(3);");
 git(repo,['add','.']);git(repo,['-c','user.name=Example','-c','user.email=example@example.test','commit','-s','-m','Example PR fixture']);
 const commit=git(repo,['rev-parse','HEAD']),bare=path.join(dir,'upstream.git');git(repo,['clone','--bare',repo,bare]);git(bare,['update-ref','refs/pull/17/head',commit]);
 git(repo,['remote','add','origin','https://github.com/example/test-project.git']);git(repo,['config',`url.${bare}.insteadOf`,'https://github.com/example/test-project.git']);
 fs.writeFileSync(path.join(repo,'local-uncommitted.txt'),'must remain');
 const store=new Environments(path.join(b,'store'));store.saveProject({id:'project',label:'Example',root:repo,adapter:'command',commands:{start:[process.execPath,'app.cjs'],prepare:[process.execPath,'prepare.cjs'],verify:[process.execPath,'verify.cjs']}});
 store.saveProfile({id:'daily',project:'project',label:'Daily',mode:'legacy',platform:'desktop'});
 fs.writeFileSync(path.join(b,'session-placeholder'),'must stay on B; not a credential');
 return {dir,repo,b,a,commit,remote:new Remote(a,{send:fakeTransport(b)}),target:{host:'computer-b.example.test'}};
}

test('one SSH template accepts different computers without accepting shell/options or forwarding agents',()=>{
 for(const host of ['computer-b.example.test','other-computer']){
  const args=sshArguments({host,node:'/opt/node bin/node'});assert.ok(args.includes('StrictHostKeyChecking=yes'));assert.ok(args.includes('BatchMode=yes'));assert.ok(args.includes('ForwardAgent=no'));assert.equal(args.at(-2),host);assert.ok(args.at(-1).startsWith("'/opt/node bin/node' -e '"));
 }
 for(const host of ['-oProxyCommand=bad','host;touch bad','user@host','$(anything)','host\ncommand'])assert.throws(()=>target({host}),{code:'INVALID_SSH_TARGET'});
 assert.throws(()=>target({host:'example.test',password:'not-allowed'}),{code:'INVALID_SSH_TARGET'});
});

test('simulated SSH runs actual pinned Git worktree, shared CLI, sample/verify commands, stop and artifact transfer',async t=>{
 const f=setup(t),r=f.remote;
 const catalog=await r.invoke('remote_catalog',{target:f.target});assert.equal(catalog.catalog.profiles.daily.label,'Daily');
 const planned=await r.invoke('remote_plan',{target:f.target,profile:'daily',pr:{repo:'example/test-project',number:17,commit:f.commit},requirements:[{kind:'human',label:'Real trackpad input in the actual sidebar'},{kind:'device-tool',label:'Physical phone',deviceId:'example-device'}]});
 assert.equal(planned.execution,'not_executed');const runId=planned.runId;
 try{
  fs.writeFileSync(path.join(f.repo,'.git','FETCH_HEAD'),'existing local fetch receipt');
  const started=await r.invoke('remote_start',{runId});assert.equal(started.execution,'requested');
  assert.throws(()=>r.read('invalid'),{code:'INVALID_REMOTE_ID'});
  await assert.rejects(r.invoke('remote_start',{runId}),{code:'REMOTE_ALREADY_REQUESTED'});
  const active=await until(()=>r.invoke('remote_status',{runId}),s=>s.state==='running');assert.equal(active.actualCommit,f.commit);
  assert.equal(fs.readFileSync(path.join(f.repo,'.git','FETCH_HEAD'),'utf8'),'existing local fetch receipt');
  assert.ok(Array.isArray(active.accounts));
  assert.notEqual(active.checkout,fs.realpathSync(f.repo));assert.equal(fs.readFileSync(path.join(f.repo,'local-uncommitted.txt'),'utf8'),'must remain');
  for(const action of ['prepare','verify']){
   await r.invoke('remote_action',{runId,action});
   await until(()=>r.invoke('remote_status',{runId}),s=>s.actions.some(a=>a.status.action===action&&a.status.state==='completed'));
  }
  const files=await r.invoke('remote_collect',{runId,logs:true,outputDir:path.join(f.a,'task')});
  assert.ok(files.files.some(a=>a.name==='result.json'));assert.ok(files.files.some(a=>a.name==='app.log'));
  assert.ok(files.result.requirements.every(r=>r.state==='pending'));assert.equal(files.result.acceptance,'not-certified-by-command-exit');
  assert.equal(files.files.some(a=>a.path.includes('session-placeholder')),false);
  assert.ok(files.files.every(a=>!fs.readFileSync(a.path,'utf8').includes('must stay on B')));
  await r.invoke('remote_stop',{runId});assert.equal((await until(()=>r.invoke('remote_status',{runId}),s=>s.state==='stopped')).state,'stopped');
  assert.ok(fs.existsSync(path.join(f.b,'session-placeholder')));assert.ok(fs.existsSync(active.checkout));
 }finally{try{await r.invoke('remote_status',{runId});await r.invoke('remote_stop',{runId});await until(()=>r.invoke('remote_status',{runId}),s=>s.state==='stopped'||s.state==='failed');}catch{}}
});

test('wrong repository or PR SHA is rejected before any app starts',async t=>{
 const f=setup(t),r=f.remote;
 await assert.rejects(r.invoke('remote_plan',{target:f.target,profile:'daily',pr:{repo:'example/wrong-project',number:17,commit:f.commit}}),{code:'REPOSITORY_MISMATCH'});
 const planned=await r.invoke('remote_plan',{target:f.target,profile:'daily',pr:{repo:'example/test-project',number:17,commit:'0'.repeat(40)}});
 await r.invoke('remote_start',{runId:planned.runId});
 const result=await until(()=>r.invoke('remote_status',{runId:planned.runId}),s=>s.state==='failed');assert.equal(result.errorCode,'PR_HEAD_CHANGED');assert.equal(result.job,null);
});

test('lost start receipt preserves the same runId and blocks blind retries until reconciliation',async t=>{
 const dir=fixture(t);let starts=0;
 const r=new Remote(dir,{send:async(_t,q)=>{if(q.request.method==='plan')return {protocol:1};if(q.request.method==='start'){starts++;throw Object.assign(Error('lost reply'),{code:'SSH_UNCONFIRMED',execution:'unknown'});}return {state:'preparing'};}});
 const plan=await r.invoke('remote_plan',{target:{host:'example.test'},profile:'daily',pr:{}});
 await assert.rejects(r.invoke('remote_start',{runId:plan.runId}),{code:'SSH_UNCONFIRMED'});
 await assert.rejects(r.invoke('remote_start',{runId:plan.runId}),{code:'REMOTE_EXECUTION_UNKNOWN'});assert.equal(starts,1);
 assert.equal((await r.invoke('remote_status',{runId:plan.runId})).state,'preparing');
 await assert.rejects(r.invoke('remote_start',{runId:plan.runId}),{code:'REMOTE_ALREADY_REQUESTED'});assert.equal(starts,1);
});

test('artifact collection rejects credential paths, traversal and wrong hashes',t=>{
 const dir=fixture(t),r=new Remote(dir),runId='00000000-0000-4000-8000-000000000001';r.save({runId});const record=r.read(runId);
 for(const name of ['../auth.json','catalog.json','session-placeholder'])assert.throws(()=>r.collect(record,{files:[{name,content:'',sha256:hash(Buffer.alloc(0))}]}),{code:'INVALID_ARTIFACTS'});
 assert.throws(()=>r.collect(record,{files:[{name:'result.json',content:Buffer.from('data').toString('base64'),sha256:'0'.repeat(64)}]}),{code:'ARTIFACT_HASH_MISMATCH'});
});

test('a definitively rejected start stays not-executed rather than being confused with a lost receipt',async t=>{
 const dir=fixture(t);let requests=0;
 const r=new Remote(dir,{send:async(_t,q)=>{if(q.request.method==='plan')return {protocol:1};requests++;throw Object.assign(Error('changed plan'),{code:'REMOTE_PLAN_CHANGED',execution:'not_executed'});}});
 const plan=await r.invoke('remote_plan',{target:{host:'example.test'},profile:'daily',pr:{}});
 await assert.rejects(r.invoke('remote_start',{runId:plan.runId}),{code:'REMOTE_PLAN_CHANGED'});
 assert.equal((await r.invoke('remote_status',{runId:plan.runId})).execution,'not_executed');
 assert.equal((await r.invoke('remote_stop',{runId:plan.runId})).state,'not-executed');assert.equal(requests,1);
 const core=new Environments(dir);
 assert.throws(()=>core.invoke('remote',{operation:'exec'}),{code:'UNKNOWN_OPERATION'});
 await assert.rejects(core.invoke('remote',{operation:'start',runId:'invalid'}),{code:'INVALID_REMOTE_ID'});
});

test('SSH preserves split UTF-8 receipts and distinguishes errors after process launch',async()=>{
 const {transport}=require('../test-environments/node/remote.cjs');
 const {EventEmitter}=await import('node:events');const {PassThrough}=await import('node:stream');
 function child(mode){const c=new EventEmitter();c.stdin=new PassThrough();c.stdout=new PassThrough();c.kill=()=>{};
  queueMicrotask(()=>{if(mode!=='before')c.emit('spawn');if(mode!=='reply'){c.emit('error',Error('spawn failure'));return;}
   for(const byte of Buffer.from(JSON.stringify({ok:true,data:{label:'电脑乙🙂'}})))c.stdout.write(Buffer.from([byte]));c.emit('close',0);});return c;}
 assert.equal((await transport({host:'example.test'},{},{spawnProcess:()=>child('reply')})).label,'电脑乙🙂');
 await assert.rejects(transport({host:'example.test'},{},{spawnProcess:()=>child('after')}),{execution:'unknown'});
 await assert.rejects(transport({host:'example.test'},{},{spawnProcess:()=>child('before')}),{execution:'not_executed'});
});

test('collection validates the whole manifest before writing and keeps independent evidence snapshots',t=>{
 const dir=fixture(t),r=new Remote(dir),runId='00000000-0000-4000-8000-000000000002';r.save({runId});const record=r.read(runId),outputDir=path.join(dir,'task');
 const file=(name,text)=>({name,content:Buffer.from(text).toString('base64'),sha256:hash(Buffer.from(text))});
 assert.throws(()=>r.collect(record,{files:[file('result.json','new'),{...file('app.log','bad'),sha256:'0'.repeat(64)}]},outputDir),{code:'ARTIFACT_HASH_MISMATCH'});
 assert.equal(fs.existsSync(outputDir),false);
 assert.throws(()=>r.collect(record,{files:[file('result.json','one'),file('result.json','two')]},outputDir),{code:'INVALID_ARTIFACTS'});
 const first=r.collect(record,{files:[file('result.json','old'),file('inspection.png','old image')]},outputDir);
 const second=r.collect(record,{files:[file('result.json','new')]},outputDir);
 assert.notEqual(path.dirname(first.files[0].path),path.dirname(second.files[0].path));
 assert.equal(fs.readFileSync(first.files[0].path,'utf8'),'old');assert.equal(fs.existsSync(path.join(path.dirname(second.files[0].path),'inspection.png')),false);
});

test('overlapping requests cannot overwrite an unknown action receipt with stale status',async t=>{
 const dir=fixture(t);let finish;
 const r=new Remote(dir,{send:async()=>new Promise(resolve=>{finish=resolve;})}),runId='00000000-0000-4000-8000-000000000003';r.save({runId,target:{host:'example.test'},state:'running'});
 const pending=r.invoke('remote_status',{runId});
 await assert.rejects(new Remote(dir).invoke('remote_action',{runId,action:'verify'}),{code:'REMOTE_REQUEST_BUSY'});
 finish({state:'running'});await pending;
 assert.equal(fs.existsSync(path.join(path.dirname(r.file(runId)),'.request-lock')),false);
});

test('cancelled runs refuse new commands and account switches without dispatching to the app',async t=>{
 const f=setup(t),r=f.remote;
 const p=await r.invoke('remote_plan',{target:f.target,profile:'daily',pr:{repo:'example/test-project',number:17,commit:f.commit}});
 const record=r.read(p.runId),dir=path.join(f.b,'store','ssh-runs',p.runId);fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'run.json'),JSON.stringify({plan:record.plan,planHash:record.planHash,actions:[]}));fs.writeFileSync(path.join(dir,'cancel.json'),'{}');
 await assert.rejects(r.invoke('remote_action',{runId:p.runId,action:'verify'}),{code:'REMOTE_RUN_STOPPING',execution:'not_executed'});
 await assert.rejects(r.invoke('remote_select_account',{runId:p.runId,account:'example'}),{code:'REMOTE_RUN_STOPPING',execution:'not_executed'});
 assert.equal(fs.existsSync(path.join(dir,'catalog','jobs')),false);
});

test('an abandoned request lock can be reconciled without trusting a reused PID',async t=>{
 const dir=fixture(t),r=new Remote(dir,{send:async()=>({state:'running'})}),runId='00000000-0000-4000-8000-000000000004';r.save({runId,target:{host:'example.test'},state:'unknown'});
 const lock=path.join(path.dirname(r.file(runId)),'.request-lock');fs.mkdirSync(lock);
 fs.writeFileSync(path.join(lock,'00000000-0000-4000-8000-000000000005.json'),JSON.stringify({pid:process.pid,identity:'a different process start'}));
 assert.equal((await r.invoke('remote_status',{runId})).state,'running');assert.equal(r.read(runId).state,'running');assert.equal(fs.existsSync(lock),false);
});

test('cancellation during command registration stops the new job and status exposes only public account references',async t=>{
 const vm=await import('node:vm'),dir=fixture(t),runId='00000000-0000-4000-8000-000000000006',runDir=path.join(dir,'ssh-runs',runId);fs.mkdirSync(runDir,{recursive:true});
 const stopped=[],run={planHash:'example-hash',jobId:'main-job',actions:[],plan:{profile:'daily',source:{project:{commands:{verify:['example']}}},requirements:[]}};
 fs.writeFileSync(path.join(runDir,'run.json'),JSON.stringify(run));
 class Core{
  status(){return {state:'running'};}jobs(){return [{jobId:'main-job',action:'start',state:'running'}];}
  read(){return {accounts:{a:{id:'a',project:'project',label:'Example',selector:'account-a',sessions:{private:'not-public'},token:'must-not-leak'}}};}
  start(){fs.writeFileSync(path.join(runDir,'cancel.json'),'{}');return {jobId:'new-action'};}stop(id){stopped.push(id);}
 }
 const context={module:{exports:{}},require:name=>name==='./core.cjs'?{Environments:Core,defaultHome:()=>dir,atomic:require('../test-environments/node/core.cjs').atomic}:agentRequire(name)};
 vm.runInNewContext(fs.readFileSync(new URL('../test-environments/node/remote-agent.cjs',import.meta.url),'utf8'),context);
 const request={runId,planHash:'example-hash'},result=await context.module.exports.dispatch({...request,method:'action',action:'verify',actionId:'00000000-0000-4000-8000-000000000007'});
 assert.equal(result.execution,'requested');assert.deepEqual(stopped,['new-action']);
 const status=context.module.exports.status(request);assert.equal(status.accounts[0].id,'a');assert.equal(JSON.stringify(status.accounts).includes('must-not-leak'),false);assert.equal(JSON.stringify(status.accounts).includes('sessions'),false);
});

test('remote evidence reads stay bounded across file growth and short reads',async t=>{
 const vm=await import('node:vm'),dir=fixture(t),file=path.join(dir,'app.log');fs.writeFileSync(file,'abcdefghij');
 const context={module:{exports:{}},require:name=>name==='node:fs'?{...fs,fstatSync:fd=>({...fs.fstatSync(fd),size:3,isFile:()=>true}),readSync:(fd,bytes,offset,length,position)=>fs.readSync(fd,bytes,offset,Math.min(1,length),position)}:agentRequire(name),Buffer};
 vm.runInNewContext(fs.readFileSync(new URL('../test-environments/node/remote-agent.cjs',import.meta.url),'utf8'),context);
 assert.equal(context.module.exports.readArtifact(file,4).toString(),'abc');
});

test('PR preview can resolve an omitted pin through the verified target repository without starting',async t=>{
 const f=setup(t),planned=await f.remote.invoke('remote_plan',{target:f.target,profile:'daily',pr:{repo:'example/test-project',number:17}});
 assert.equal(planned.plan.pr.commit,f.commit);assert.equal(planned.execution,'not_executed');assert.equal(fs.existsSync(path.join(f.b,'store','ssh-runs',planned.runId)),false);
 await assert.rejects(f.remote.invoke('remote_plan',{target:f.target,profile:'daily',pr:{repo:'example/wrong',number:17}}),{code:'REPOSITORY_MISMATCH'});
 await assert.rejects(f.remote.invoke('remote_plan',{target:f.target,profile:'daily',pr:{repo:'example/test-project',number:999}}),{code:'GIT_PROBE_FAILED'});
 assert.equal(fs.existsSync(path.join(f.b,'store','ssh-runs')),false);
});
