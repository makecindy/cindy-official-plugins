// Optional unpacked-.cindy smoke: original main.js -> actual packaged Worker,
// and packaged CLI -> the same catalog. This does not substitute for Host installation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import readline from 'node:readline';
import {spawn,execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {once} from 'node:events';
import {setTimeout as wait} from 'node:timers/promises';
const require=createRequire(import.meta.url),{safeEnv}=require('../test-environments/node/core.cjs');
const root=path.resolve(import.meta.dirname,'../test-environments'),version=JSON.parse(fs.readFileSync(path.join(root,'ghost.json'))).version;
const archive=path.resolve(process.env.TEST_ENVIRONMENTS_PACKAGE||path.join(root,`test-environments-${version}.cindy`));
async function until(fn,predicate){const end=Date.now()+10000;while(Date.now()<end){const result=await fn();if(predicate(result))return result;await wait(100);}assert.fail('Timed out waiting for packaged worker');}
test('unpacked .cindy AI bridge and CLI execute the full command workflow with one persistent catalog',{skip:!fs.existsSync(archive)},async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'test-env-package-')),unpacked=path.join(temp,'unpacked'),store=path.join(temp,'store'),project=path.join(temp,'project with spaces');fs.mkdirSync(project);
 execFileSync('python3',['-c','import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; z.extractall(sys.argv[2])',archive,unpacked]);
 const manifest=JSON.parse(fs.readFileSync(path.join(unpacked,'ghost.json')));assert.equal(manifest.version,version);
 fs.writeFileSync(path.join(project,'app.cjs'),"console.log('packaged app');setInterval(()=>{},1000);");fs.writeFileSync(path.join(project,'prepare.cjs'),"require('fs').writeFileSync('sample.txt','packaged sample');");fs.writeFileSync(path.join(project,'verify.cjs'),"if(require('fs').readFileSync('sample.txt','utf8')!=='packaged sample')process.exit(3);");
 const env={...safeEnv(),TEST_ENVIRONMENTS_HOME:store},worker=spawn(process.execPath,[path.join(unpacked,'node/worker.cjs')],{env,stdio:['pipe','pipe','pipe']});let id=0,handler;
 const pending=new Map(),sent=[],requests=[];readline.createInterface({input:worker.stdout}).on('line',line=>{const reply=JSON.parse(line);pending.get(reply.id)?.(reply.result);pending.delete(reply.id);});
 const request=q=>new Promise(resolve=>{requests.push(q.method);const current=++id;pending.set(current,resolve);worker.stdin.write(JSON.stringify({id:current,method:q.method,params:q.params})+'\n');});
 const context={cindy:{node:{request:async q=>({ok:true,result:await request(q)})},onHostMessage:callback=>{handler=callback;},send:async r=>sent.push(r)},BroadcastChannel:class{},setTimeout:fn=>{const timer=setTimeout(fn,60000);timer.unref();return timer;}};
 vm.runInNewContext(fs.readFileSync(path.join(unpacked,'main.js'),'utf8'),context);
 const tool=async(name,args={})=>{const callId=String(++id);await handler({type:'tool-call',tool:name,args,callId});const reply=sent.find(r=>r.callId===callId);assert.ok(reply);return reply;};
 const ok=async(name,args)=>{const r=await tool(name,args);assert.equal(r.ok,true,JSON.stringify(r));return r.result;};
 const {Environments}=require(path.join(unpacked,'node/core.cjs')),core=new Environments(store);
 t.after(async()=>{for(const job of core.jobs())try{core.stop(job.jobId);}catch{}await wait(900);worker.kill();await once(worker,'close');fs.rmSync(temp,{recursive:true,force:true});});
 assert.equal((await tool('exec')).errorCode,'UNKNOWN_OPERATION');assert.equal(requests.includes('exec'),false);
 await ok('save_project',{project:{id:'project',label:'Package fixture',root:project,adapter:'command',commands:{start:[process.execPath,'app.cjs'],prepare:[process.execPath,'prepare.cjs'],verify:[process.execPath,'verify.cjs']}}});
 await ok('save_account',{account:{id:'account-a',label:'Example A',project:'project',selector:'example-a'}});await ok('save_profile',{profile:{id:'daily',label:'Daily',project:'project',platform:'desktop',mode:'acceptance',account:'account-a'}});await ok('save_case',{testCase:{id:'sample',label:'Sample',profile:'daily',steps:[{action:'Inspect sample',expected:'packaged sample'}]}});
 const plan=await ok('plan',{profile:'daily'});assert.equal(plan.account.selector,'example-a');assert.equal(plan.workflow.cases[0].id,'sample');
 const job=await ok('start',{profile:'daily'});await until(()=>ok('status',{jobId:job.jobId}),s=>s.state==='running');assert.equal((await tool('start',{profile:'daily'})).errorCode,'PROJECT_BUSY');
 for(const action of ['prepare','verify']){const j=await ok('start',{profile:'daily',action});await until(()=>ok('status',{jobId:j.jobId}),s=>s.state==='completed');}
 await ok('stop',{jobId:job.jobId});await until(()=>ok('status',{jobId:job.jobId}),s=>s.state==='stopped');
 const cli=JSON.parse(execFileSync(process.execPath,[path.join(unpacked,'node/cli.cjs'),'catalog'],{env,encoding:'utf8'}));assert.equal(cli.result.accounts['account-a'].selector,'example-a');assert.equal(cli.result.profiles.daily.account,'account-a');assert.equal(fs.readFileSync(path.join(project,'sample.txt'),'utf8'),'packaged sample');
 assert.equal((await tool('remove',{kind:'accounts',id:'account-a'})).errorCode,'RECORD_IN_USE');assert.equal((await tool('remote',{operation:'exec'})).errorCode,'UNKNOWN_OPERATION');
 console.log(JSON.stringify({package:archive,version,bridge:'original main.js + real packaged Worker',cli:'same catalog',hostInstallation:'not-tested'}));
});
