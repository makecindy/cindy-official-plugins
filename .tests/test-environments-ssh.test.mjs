import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync,spawn} from 'node:child_process';
import {setTimeout as wait} from 'node:timers/promises';
const require=createRequire(import.meta.url);
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
  const started=await r.invoke('remote_start',{runId});assert.equal(started.execution,'requested');
  assert.throws(()=>r.read('invalid'),{code:'INVALID_REMOTE_ID'});
  await assert.rejects(r.invoke('remote_start',{runId}),{code:'REMOTE_ALREADY_REQUESTED'});
  const active=await until(()=>r.invoke('remote_status',{runId}),s=>s.state==='running');assert.equal(active.actualCommit,f.commit);
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
