'use strict';
// Real OpenSSH over loopback to a restricted test SSH server. A/B/C remain local
// fixtures; this does not certify two computers, real account reuse or Cindy builds.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process'),{once}=require('node:events'),{setTimeout:wait}=require('node:timers/promises');
const {Server,utils}=require(process.env.TEST_ENVIRONMENTS_SSH2||'ssh2');
const runtime=path.resolve(process.env.TEST_ENVIRONMENTS_RUNTIME||path.join(__dirname,'../test-environments'));
const {Environments,safeEnv}=require(path.join(runtime,'node/core.cjs'));
const {Remote,transport,sshArguments}=require(path.join(runtime,'node/remote.cjs'));
const output=process.env.TEST_ENVIRONMENTS_SSH_EVIDENCE?path.resolve(process.env.TEST_ENVIRONMENTS_SSH_EVIDENCE):fs.mkdtempSync(path.join(os.tmpdir(),'test-env-ssh-evidence-'));fs.mkdirSync(output,{recursive:true,mode:0o700});
function git(root,args){return execFileSync('git',['-C',root,...args],{encoding:'utf8',env:{...safeEnv(),HOME:root,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'},stdio:['ignore','pipe','pipe']}).trim();}
async function until(fn,check){const end=Date.now()+20000;let v;while(Date.now()<end){v=await fn();if(check(v))return v;await wait(200);}assert.fail('Timed out: '+JSON.stringify(v));}
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
test('real OpenSSH loopback: pinned checkout/build/sample/failure/recovery/stop/private artifacts', {timeout:180000},async t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'test-env-ssh-wire-'));fs.chmodSync(temp,0o700);
 const homes={b:path.join(temp,'computer-b'),c:path.join(temp,'computer-c')},a=path.join(temp,'computer-a'),repo=path.join(temp,'repository');
 for(const dir of [...Object.values(homes),a,repo])fs.mkdirSync(dir,{mode:0o700});
 const nodeDir=path.join(temp,'node runtime');fs.mkdirSync(nodeDir);const node=path.join(nodeDir,'node');fs.symlinkSync(process.execPath,node);
 git(repo,['init']);
 fs.writeFileSync(path.join(repo,'app.cjs'),"console.log('模拟应用已启动');setInterval(()=>{},1000);");
 fs.writeFileSync(path.join(repo,'build-start.cjs'),"require('fs').writeFileSync('build.json',JSON.stringify({built:true}));require('./app.cjs');");
 fs.writeFileSync(path.join(repo,'prepare.cjs'),"const fs=require('fs');fs.appendFileSync('prepare-count.txt','once\\n');fs.writeFileSync('sample.txt','模拟验收样本');");
 fs.writeFileSync(path.join(repo,'verify.cjs'),"const fs=require('fs');if(!fs.existsSync('sample.txt')||fs.readFileSync('sample.txt','utf8')!=='模拟验收样本')process.exit(3);console.log('样本验证通过');");
 git(repo,['add','.']);git(repo,['-c','user.name=Example','-c','user.email=example@example.test','commit','-s','-m','Loopback PR fixture']);
 const commit=git(repo,['rev-parse','HEAD']),bare=path.join(temp,'upstream.git');git(repo,['clone','--bare',repo,bare]);git(bare,['update-ref','refs/pull/17/head',commit]);
 git(repo,['remote','add','origin','https://github.com/example/ssh-fixture.git']);git(repo,['config',`url.${bare}.insteadOf`,'https://github.com/example/ssh-fixture.git']);
 fs.writeFileSync(path.join(repo,'local-uncommitted.txt'),'keep original working tree');fs.writeFileSync(path.join(repo,'.git','FETCH_HEAD'),'keep original fetch head');
 for(const [key,home]of Object.entries(homes)){
  const core=new Environments(path.join(home,'store'));core.saveProject({id:'project',label:'模拟电脑 '+key,root:repo,adapter:'command',commands:{start:[process.execPath,'build-start.cjs'],prepare:[process.execPath,'prepare.cjs'],verify:[process.execPath,'verify.cjs']}});core.saveProfile({id:'daily',label:'档案 '+key,project:'project',platform:'desktop',mode:'legacy'});
  fs.writeFileSync(path.join(home,'local-data-sentinel'),'B-local fixture data; not a login credential');
 }
 const key=()=>crypto.generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs1',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}}).privateKey;
 const hostKey=key(),clientKey=key(),allowed=utils.parseKey(clientKey),hostPublic=utils.parseKey(hostKey),identityFile=path.join(temp,'fixture-key');fs.writeFileSync(identityFile,clientKey,{mode:0o600});
 const requests=[],clients=new Set(),children=new Set();let dropMethod=null;
 const server=new Server({hostKeys:[hostKey]},client=>{
  clients.add(client);let machine;
  client.on('error',()=>{});client.on('close',()=>clients.delete(client));
  client.on('authentication',ctx=>{
   machine=ctx.username==='fixture-b'?'b':ctx.username==='fixture-c'?'c':null;
   if(machine&&ctx.method==='publickey'&&ctx.key.data.equals(allowed.getPublicSSH())&&(!ctx.signature||allowed.verify(ctx.blob,ctx.signature,ctx.hashAlgo)===true))ctx.accept();else ctx.reject();
  }).on('ready',()=>client.on('session',(accept,reject)=>{
   const session=accept();session.on('exec',(acceptExec,rejectExec,info)=>{
    if(info.command!==sshArguments({host:'fixture-b.example.test',node}).at(-1))return rejectExec();
    const channel=acceptExec(),chunks=[];channel.on('error',()=>{});channel.on('data',b=>chunks.push(b));
    channel.on('end',()=>{
     const bytes=Buffer.concat(chunks);let q;try{q=JSON.parse(bytes);}catch{channel.exit(2);channel.end();return;}
     const record={machine,method:q.request.method,runId:q.request.runId||null,action:q.request.action||null};requests.push(record);
     const child=spawn('/bin/sh',['-c',info.command],{env:{...safeEnv(),HOME:homes[machine],TEST_ENVIRONMENTS_HOME:path.join(homes[machine],'store'),GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'},stdio:['pipe','pipe','pipe']});children.add(child);let result=[];
     child.stdout.on('data',b=>result.push(b));child.stderr.on('data',b=>channel.stderr.write(b));child.stdin.on('error',()=>{});child.on('error',()=>{channel.exit(2);channel.end();});
     child.on('close',code=>{children.delete(child);const body=Buffer.concat(result);try{record.reply=JSON.parse(body).ok?'confirmed':'rejected';}catch{record.reply='invalid';}
      if(dropMethod===q.request.method&&record.reply==='confirmed'){dropMethod=null;record.receipt='deliberately-dropped-after-execution';client.end();return;}
      channel.write(body);channel.exit(code||0);channel.end();
     });child.stdin.end(bytes);
    });
   });
  }));
 });
 server.on('error',e=>{throw e;});server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;
 const known=path.join(temp,'known-hosts'),config=path.join(temp,'ssh-config');
 fs.writeFileSync(known,`[127.0.0.1]:${port} ${hostPublic.type} ${hostPublic.getPublicSSH().toString('base64')}\n`,{mode:0o600});
 fs.writeFileSync(config,['Host fixture-b.example.test','  User fixture-b','Host fixture-c.example.test','  User fixture-c','Host *','  HostName 127.0.0.1',`  Port ${port}`,`  IdentityFile ${identityFile}`,`  UserKnownHostsFile ${known}`,'  GlobalKnownHostsFile /dev/null','  IdentitiesOnly yes','  IdentityAgent none','  LogLevel ERROR',''].join('\n'),{mode:0o600});
 const send=(target,payload)=>transport(target,payload,{spawnProcess:(_file,args,options)=>spawn('ssh',['-F',config,...args],{...options,env:safeEnv()})});
 const r=new Remote(a,{send}),target={host:'fixture-b.example.test',node},steps=[];let runId,checkout;
 t.after(async()=>{
  try{if(runId){await r.invoke('remote_status',{runId});await r.invoke('remote_stop',{runId});await until(()=>r.invoke('remote_status',{runId}),s=>['stopped','failed'].includes(s.state));}}catch{}
  for(const c of clients)c.end();for(const child of children)child.kill();await new Promise(resolve=>server.close(resolve));fs.rmSync(temp,{recursive:true,force:true});if(!process.env.TEST_ENVIRONMENTS_SSH_EVIDENCE)fs.rmSync(output,{recursive:true,force:true});
 });
 const bin=path.join(temp,'client-bin');fs.mkdirSync(bin);
 fs.writeFileSync(path.join(bin,'ssh'),"#!/bin/sh\nexec /usr/bin/ssh -F '"+config.replace(/'/g,"'\\''")+"' \"$@\"\n",{mode:0o700});
 const clientEnv={...safeEnv(),PATH:bin+path.delimiter+process.env.PATH,TEST_ENVIRONMENTS_HOME:a};
 const cliResult=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[path.join(runtime,'node/cli.cjs'),'remote','--stdin'],{env:clientEnv,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
  child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);child.on('close',code=>{try{assert.equal(code,0,stderr);const reply=JSON.parse(stdout);assert.equal(reply.ok,true);resolve(reply.result);}catch(e){reject(e);}});child.stdin.end(JSON.stringify({operation:'catalog',target}));
 });
 assert.equal(cliResult.catalog.profiles.daily.label,'档案 b');steps.push({step:'public-cli-over-real-ssh',state:'passed'});
 const vm=require('node:vm'),readline=require('node:readline'),worker=spawn(process.execPath,[path.join(runtime,'node/worker.cjs')],{env:clientEnv,stdio:['pipe','pipe','pipe']}),pending=new Map();let handler;const sent=[];
 readline.createInterface({input:worker.stdout}).on('line',line=>{const reply=JSON.parse(line);pending.get(reply.id)?.(reply.result);pending.delete(reply.id);});
 const request=q=>new Promise(resolve=>{const id=crypto.randomUUID();pending.set(id,resolve);worker.stdin.write(JSON.stringify({id,method:q.method,params:q.params})+'\n');});
 t.after(async()=>{worker.kill();await once(worker,'close');});
 vm.runInNewContext(fs.readFileSync(path.join(runtime,'main.js'),'utf8'),{cindy:{node:{request:async q=>({ok:true,result:await request(q)})},onHostMessage:fn=>{handler=fn;},send:async q=>sent.push(q)},BroadcastChannel:class{},setTimeout:fn=>{const timer=setTimeout(fn,60000);timer.unref();return timer;}});
 await handler({type:'tool-call',tool:'remote',callId:crypto.randomUUID(),args:{operation:'catalog',target}});assert.equal(sent[0].ok,true);assert.equal(sent[0].result.catalog.profiles.daily.label,'档案 b');steps.push({step:'ai-bridge-and-worker-over-real-ssh',state:'passed',detail:'Host transport shim; original main.js and real Worker.'});
 const catalogB=await r.invoke('remote_catalog',{target}),catalogC=await r.invoke('remote_catalog',{target:{...target,host:'fixture-c.example.test'}});
 assert.equal(catalogB.catalog.profiles.daily.label,'档案 b');assert.equal(catalogC.catalog.profiles.daily.label,'档案 c');steps.push({step:'target-selection',state:'passed',detail:'Two SSH aliases reach different isolated fixture catalogs; same physical computer.'});
 await assert.rejects(r.invoke('remote_plan',{target,profile:'daily',pr:{repo:'example/wrong',number:17,commit}}),{code:'REPOSITORY_MISMATCH'});steps.push({step:'wrong-repository-rejected',state:'passed'});
 const planned=await r.invoke('remote_plan',{target,profile:'daily',pr:{repo:'example/ssh-fixture',number:17},requirements:[{kind:'human',label:'Real trackpad input'},{kind:'device-tool',label:'Physical phone'}]});runId=planned.runId;assert.equal(planned.plan.pr.commit,commit);assert.equal(planned.execution,'not_executed');
 dropMethod='start';await assert.rejects(r.invoke('remote_start',{runId}),{code:'SSH_UNCONFIRMED',execution:'unknown'});await assert.rejects(r.invoke('remote_start',{runId}),{code:'REMOTE_EXECUTION_UNKNOWN'});
 const active=await until(()=>r.invoke('remote_status',{runId}),s=>s.state==='running');checkout=active.checkout;assert.equal(active.actualCommit,commit);assert.equal(requests.filter(q=>q.method==='start').length,1);assert.equal(JSON.parse(fs.readFileSync(path.join(checkout,'build.json'))).built,true);steps.push({step:'checkout-build-start-and-lost-receipt',state:'passed',runId,commit,detail:'One start executed; recovered using the same runId.'});
 await r.invoke('remote_action',{runId,action:'verify'});const failed=await until(()=>r.invoke('remote_status',{runId}),s=>s.actions.some(a=>a.status.action==='verify'&&a.status.state==='failed'));assert.equal(failed.acceptance,'not-certified-by-command-exit');steps.push({step:'missing-sample-fails-verification',state:'passed'});
 dropMethod='action';await assert.rejects(r.invoke('remote_action',{runId,action:'prepare'}),{code:'SSH_UNCONFIRMED',execution:'unknown'});await assert.rejects(r.invoke('remote_action',{runId,action:'prepare'}),{code:'REMOTE_EXECUTION_UNKNOWN'});
 await until(()=>r.invoke('remote_status',{runId}),s=>s.actions.some(a=>a.status.action==='prepare'&&a.status.state==='completed'));assert.equal(fs.readFileSync(path.join(checkout,'prepare-count.txt'),'utf8'),'once\n');assert.equal(fs.readFileSync(path.join(checkout,'sample.txt'),'utf8'),'模拟验收样本');steps.push({step:'prepare-and-lost-receipt',state:'passed',executions:1});
 await r.invoke('remote_action',{runId,action:'verify'});await until(()=>r.invoke('remote_status',{runId}),s=>s.actions.some(a=>a.status.action==='verify'&&a.status.state==='completed'));steps.push({step:'verify-prepared-sample',state:'passed'});
 // Command-adapter fixtures have no inspectable Cindy page. No screenshot is fabricated.
 await assert.rejects(r.invoke('remote_collect',{runId,screenshot:true}),{code:'APP_NOT_INSPECTABLE'});steps.push({step:'unsupported-screenshot-is-explicit',state:'passed',detail:'No real Cindy page: screenshot must fail explicitly.'});
 dropMethod='stop';await assert.rejects(r.invoke('remote_stop',{runId}),{code:'SSH_UNCONFIRMED',execution:'unknown'});const stopped=await until(()=>r.invoke('remote_status',{runId}),s=>s.state==='stopped');assert.ok(stopped.requirements.every(q=>q.state==='pending'));steps.push({step:'stop-and-lost-receipt',state:'passed',stateAfterRecovery:stopped.state});
 const collected=await r.invoke('remote_collect',{runId,logs:true,outputDir:output});assert.deepEqual(collected.files.map(f=>f.name).sort(),['app.log','build.log','result.json']);for(const f of collected.files)assert.equal(digest(fs.readFileSync(f.path)),f.sha256);assert.ok(collected.files.some(f=>fs.readFileSync(f.path,'utf8').includes('模拟应用已启动')));steps.push({step:'collect-and-verify-private-evidence',state:'passed',files:collected.files.map(({name,sha256,bytes})=>({name,sha256,bytes}))});
 assert.equal(fs.readFileSync(path.join(repo,'local-uncommitted.txt'),'utf8'),'keep original working tree');assert.equal(fs.readFileSync(path.join(repo,'.git','FETCH_HEAD'),'utf8'),'keep original fetch head');assert.ok(fs.existsSync(path.join(homes.b,'local-data-sentinel')));assert.ok(collected.files.every(f=>!fs.readFileSync(f.path,'utf8').includes('B-local fixture data')));steps.push({step:'preserve-original-checkout-and-local-data',state:'passed',detail:'No credential files used or transferred.'});
 // An untrusted host key is rejected by the actual SSH client before bootstrap.
 const wrongKnown=path.join(temp,'wrong-known-hosts'),wrongConfig=path.join(temp,'wrong-config');fs.writeFileSync(wrongKnown,'');fs.writeFileSync(wrongConfig,fs.readFileSync(config,'utf8').replace(known,wrongKnown));const before=requests.length;
 await assert.rejects(transport(target,{protocol:1},{spawnProcess:(_file,args,options)=>spawn('ssh',['-F',wrongConfig,...args],{...options,env:safeEnv()})}),{code:'SSH_UNCONFIRMED'});assert.equal(requests.length,before);steps.push({step:'strict-host-key-rejection',state:'passed',bootstrapExecutions:0});
 const report={runtime,packageVersion:JSON.parse(fs.readFileSync(path.join(runtime,'ghost.json'))).version,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),transport:'actual OpenSSH client over 127.0.0.1 to an ephemeral restricted SSH2 test server',ssh2:require(path.join(process.env.TEST_ENVIRONMENTS_SSH2||'ssh2','package.json')).version,runId,steps,requests,notVerified:['two physical computers','real Cindy build/install','formal account sessions or independent login','real device screenshots','physical phone and human trackpad input','cross-device first authorization'],artifacts:collected.files};
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({runId,stepsPassed:steps.length,evidence:path.join(output,'report.json'),notVerified:report.notVerified}));
});
