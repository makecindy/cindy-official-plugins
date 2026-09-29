const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),vm=require('node:vm');
const {service}=require('../node/online.cjs'),{within,files,runCommand}=require('../node/engine.cjs');
const url='https://github.com/makecindy/eval-bank/releases/download/test/index.json';
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
for(const oversized of [false,true])test('corrupt bank replacement preserves the old tree on failures; oversized='+oversized,async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'bank-repair-')),rename=fs.rename;
 try{
  const spec=JSON.stringify({id:'fixture',revision:'v1',scoringVersion:'v1',title:'Fixture',groups:[{id:'core',weight:'1',mode:'all',items:['a']}]}),archive=path.join(root,'archive'),bytes=Buffer.from('fake archive');await fs.writeFile(archive,bytes);
  const sha=digest(bytes),name=sha+'.zip',q={key:'fixture@v1',revision:'v1',path:'question',files:{'question.json':digest(spec)},layers:[{artifact:name,mount:''}]};
  const index={format:'eval-lab-online-v1',platform:'darwin-arm64',questions:[q],artifacts:{[name]:{url:url.replace('index.json',name),sha256:sha,bytes:bytes.length,expandedBytes:spec.length}}};
  let mode='normal',ready,release;const svc=service({platform:'darwin',arch:'arm64',base:async()=>root,within,files,fetchFile:async(u,d)=>{const b=JSON.stringify(index);await fs.writeFile(d,b);return {sha256:digest(b)};},runCommand:async(c,args)=>{if(args[0]==='-I')return {code:0};await fs.writeFile(path.join(args[2],'question.json'),mode==='invalid'?'bad':spec);if(mode==='cancel'){ready();await new Promise(r=>release=r);}return {code:0};}});
  const inspected=await svc.inspect({root,url}),p={root,indexId:inspected.indexId,question:q.key,hostArtifacts:{[sha]:archive}};
  const installed=await svc.install(p),manifest=path.join(installed.bank,'distribution.json');await fs.writeFile(manifest,'broken');if(oversized)await fs.truncate(manifest,16*1024*1024+1);
  const checkOld=async file=>{assert.equal((await fs.stat(file)).size,oversized?16*1024*1024+1:6);assert.equal((await fs.readFile(file)).subarray(0,6).toString(),'broken');};
  mode='invalid';await assert.rejects(svc.install(p),/校验/);await checkOld(manifest);
  mode='cancel';const started=new Promise(r=>ready=r),op=svc.begin({root}),run=svc.install({...p,...op}),rejected=assert.rejects(run,/取消/);await started;const stop=svc.cancel({root,...op});release();await stop;await rejected;await checkOld(manifest);
  mode='normal';fs.rename=async(a,b)=>{if(String(a).includes('/staging-')&&b===installed.bank)throw Object.assign(Error('publish failed'),{code:'EIO'});return rename(a,b);};
  await assert.rejects(svc.install(p));await checkOld(manifest);fs.rename=rename;
  await svc.install(p);assert.equal(JSON.parse(await fs.readFile(manifest)).format,'eval-lab-bank-v1');
  const backups=await fs.readdir(path.join(root,'online/backups'));assert.equal(backups.length,1);await checkOld(path.join(root,'online/backups',backups[0],'distribution.json'));
 }finally{fs.rename=rename;await fs.rm(root,{recursive:true,force:true});}
});
test('damaged installed metadata does not prevent the page from loading or starting default repair',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'bank-catalog-'));try{
  const dir=path.join(root,'eval-lab-data/online/banks','a'.repeat(64));await fs.mkdir(dir,{recursive:true});
  const healthy=path.join(path.dirname(dir),'b'.repeat(64));await fs.mkdir(healthy);await fs.writeFile(path.join(healthy,'distribution.json'),JSON.stringify({format:'eval-lab-bank-v1',questions:[{key:'healthy@v1',title:'Healthy'}]}));
  for(const text of ['null','{broken',JSON.stringify({format:'eval-lab-bank-v1',questions:null}),JSON.stringify({format:'eval-lab-bank-v1',questions:[null]}),'oversized']){await fs.writeFile(path.join(dir,'distribution.json'),text);if(text==='oversized')await fs.truncate(path.join(dir,'distribution.json'),16*1024*1024+1);const result=await require('../node/engine.cjs').dispatch('bank',{root});assert.equal(result.questions.length,1);assert.equal(result.questions[0].title,'Healthy');assert.equal(result.errors.length,1);}
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
function fixture(root){const name='a'.repeat(64)+'.zip',index={format:'eval-lab-online-v1',platform:'darwin-arm64',questions:[{key:'fixture@v1',path:'questions/fixture',files:{},layers:[{artifact:name,mount:''}]}],artifacts:{[name]:{url:url.replace('index.json',name),bytes:1,expandedBytes:1,sha256:'a'.repeat(64)}}},text=JSON.stringify(index);return {id:digest(text),svc:service({platform:'darwin',arch:'arm64',base:async()=>root,within,files,runCommand,fetchFile:async(u,d)=>{await fs.writeFile(d,text);return {sha256:digest(text)};}})};}
test('offline cache isolates damaged entries and an online check repairs the same index',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'index-recovery-'));
 try{const {svc,id}=fixture(root),valid=await svc.inspect({root,url});
  for(const [i,text] of ['{truncated','null',JSON.stringify({url,index:{format:'invalid'}}),JSON.stringify({url:url.replace('/test/','/other/'),index:null})].entries()){
   const dir=path.join(root,'online/indices',String(i).repeat(64));await fs.mkdir(dir);await fs.writeFile(path.join(dir,'index.json'),text);
  }
  assert.deepEqual((await svc.cached({root,url})).questions,valid.questions);
  const target=path.join(root,'online/indices',id,'index.json');await fs.writeFile(target,'{partial');
  assert.deepEqual(await svc.cached({root,url}),{questions:[]});
  await svc.inspect({root,url});assert.deepEqual((await svc.cached({root,url})).questions,valid.questions);
  assert.equal((await svc.plan({root,indexId:id,question:'fixture@v1'})).artifacts.length,1);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('partial index writes leave published data intact, preserve storage error codes and clean temp files',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'index-write-')),write=fs.writeFile;
 try{const {svc,id}=fixture(root);await svc.inspect({root,url});const dest=path.join(root,'online/indices',id),target=path.join(dest,'index.json'),before=await fs.readFile(target,'utf8');
  for(const code of ['ENOSPC','EACCES']){
   fs.writeFile=async(p,...args)=>{if(String(p).endsWith('.tmp')){await write(p,'{partial');throw Object.assign(Error('PRIVATE disk path'),{code});}return write(p,...args);};
   await assert.rejects(svc.inspect({root,url}),e=>e.code===code&&/磁盘空间.*存储权限/.test(e.message)&&!e.message.includes('PRIVATE'));
   assert.equal(await fs.readFile(target,'utf8'),before);assert.deepEqual(await fs.readdir(dest),['index.json']);
  }
 }finally{fs.writeFile=write;await fs.rm(root,{recursive:true,force:true});}
});
test('download sink errors retain actionable storage diagnostics',async()=>{
 const source=await fs.readFile(path.join(__dirname,'../node/online.cjs'),'utf8'),{EventEmitter}=require('node:events'),{Readable,Writable}=require('node:stream');
 for(const code of ['ENOSPC','EACCES','EDQUOT']){
  const module={exports:{}};vm.runInNewContext(source,{module,require:id=>id==='node:https'?{get:(u,o,cb)=>{const req=new EventEmitter();req.setTimeout=()=>{};process.nextTick(()=>{const s=Readable.from(['data']);s.statusCode=200;cb(s);});return req;}}:id==='node:fs'?{...require(id),createWriteStream:()=>new Writable({write(c,e,done){done(Object.assign(Error('PRIVATE output'),{code,syscall:'write'}));}})}:require(require('node:module').createRequire(path.join(__dirname,'../node/online.cjs')).resolve(id)),setTimeout,clearTimeout,URL,AbortController});
  await assert.rejects(module.exports.download(url,'unused',100),e=>e.code===code&&/磁盘空间/.test(e.message)&&!e.message.includes('PRIVATE'));
 }
});
test('Node operations heartbeat until resolve or reject and never emit heartbeat on stdout',async()=>{
 const source=await fs.readFile(path.join(__dirname,'../node/worker.cjs'),'utf8');
 for(const method of ['grade','calibrate','online_install','prepare'])for(const fail of [false,true]){
  let line,tick,resolve,reject,cleared=false;const stderr=[],stdout=[],pending=new Promise((a,b)=>{resolve=a;reject=b;});
  vm.runInNewContext(source,{require:id=>id==='node:readline'?{createInterface:()=>({on:(name,fn)=>{line=fn;}})}:{dispatch:()=>pending},process:{stdin:{},stderr:{write:s=>stderr.push(s)},stdout:{write:s=>stdout.push(s)}},setInterval:(fn,ms)=>{assert.equal(ms,10000);tick=fn;return 1;},clearInterval:()=>{cleared=true;}});
  const running=line(JSON.stringify({id:1,method}));tick();assert.equal(stderr.length,1);assert.equal(stdout.length,0);assert.equal(cleared,false);
  fail?reject(Error('failed')):resolve({ok:true});await running;assert.equal(cleared,true);assert.equal(stdout.length,1);assert.equal(JSON.parse(stdout[0]).id,1);
 }
});
test('extraction budgets scale to the maximum declared size and timeout is not package corruption',async()=>{
 const {unpackTimeout}=require('../node/online.cjs');assert.equal(unpackTimeout(1024),120000);assert.equal(unpackTimeout(8*2**30),840000);
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'unpack-budget-'));try{
  const spec=JSON.stringify({id:'fixture',revision:'v1',scoringVersion:'v1',title:'Fixture',groups:[{id:'core',weight:'1',mode:'all',items:['a']}]}),bytes=Buffer.from('archive'),sha=digest(bytes),name=sha+'.zip',archive=path.join(root,'archive');await fs.writeFile(archive,bytes);
  const index={format:'eval-lab-online-v1',platform:'darwin-arm64',questions:[{key:'fixture@v1',path:'question',files:{'question.json':digest(spec)},layers:[{artifact:name,mount:''}]}],artifacts:{[name]:{url:url.replace('index.json',name),bytes:bytes.length,expandedBytes:8*2**30,sha256:sha}}};
  const svc=service({platform:'darwin',arch:'arm64',base:async()=>root,within,files,fetchFile:async(u,d)=>{const text=JSON.stringify(index);await fs.writeFile(d,text);return {sha256:digest(text)};},runCommand:async(c,a,options)=>{if(a[0]==='-I')return {code:0};assert.equal(options.timeout,840000);return {code:null,timedOut:true,stderr:'private'};}});
  const {indexId}=await svc.inspect({root,url});await assert.rejects(svc.install({root,indexId,question:'fixture@v1',hostArtifacts:{[sha]:archive}}),e=>e.code==='EXTRACTION_TIMEOUT'&&!e.message.includes('private'));
  assert.equal((await fs.readdir(path.join(root,'online'))).some(x=>x.startsWith('staging-')),false);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('unsupported platforms can browse but reject planning and installation before artifacts or staging',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'bank-platform-'));
 try{
  const {svc}=fixture(root),catalog=await svc.inspect({root,url}),p={root,indexId:catalog.indexId,question:'fixture@v1'};
  for(const [platform,arch] of [['linux','x64'],['win32','arm64'],['darwin','x64']]){
   let downloads=0,unpacks=0;
   const unsupported=service({base:async()=>root,within,files,platform,arch,fetchFile:async()=>downloads++,runCommand:async()=>unpacks++});
   assert.equal((await unsupported.cached({root,url})).questions.length,1);
   await assert.rejects(unsupported.plan(p),e=>e.code==='UNSUPPORTED_PLATFORM');
   await assert.rejects(unsupported.install(p),e=>e.code==='UNSUPPORTED_PLATFORM');
   assert.equal(downloads,0);assert.equal(unpacks,0);
   assert.equal((await fs.readdir(path.join(root,'online'))).some(x=>/staging|banks|artifacts/.test(x)),false);
  }
  assert.equal((await svc.plan(p)).artifacts.length,1);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('all dynamic evaluation phases have English fallback text',async()=>{
 const view=await fs.readFile(path.join(__dirname,'../view.js'),'utf8'),code=await fs.readFile(path.join(__dirname,'../i18n.js'),'utf8');
 const labels=vm.runInNewContext('('+view.match(/,labels=(\{[^\n]+?\});/)[1]+')');
 const {translate}=require('../i18n.js');
 for(const text of Object.values(labels)){assert.notEqual(translate('en',text),text);assert.doesNotMatch(translate('en',text),/[\u3400-\u9fff]/);}
});

test('damaged custom manifests leave healthy banks and read-only history reachable',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'custom-bank-recovery-'));
 try{
  const dir=path.join(root,'eval-lab-data/custom-bank'),healthy=path.join(root,'healthy');await fs.mkdir(dir,{recursive:true});await fs.mkdir(healthy);
  await fs.mkdir(path.join(root,'eval-lab-data/calibrations','snapshot-'+'a'.repeat(64)),{recursive:true});
  await fs.writeFile(path.join(root,'eval-lab-data/calibrations','snapshot-'+'a'.repeat(64),'calibration.json'),JSON.stringify({id:'q',revision:'v1',checkId:'old',ok:true}));
  const saved=path.join(root,'eval-lab-data/runs/saved');await fs.mkdir(saved,{recursive:true});const history=JSON.stringify({runId:'saved',bank:dir,status:'graded',score:1,questionId:'q',revision:'v1'});await fs.writeFile(path.join(saved,'result.json'),history);
  const good={format:'eval-lab-bank-v1',questions:[{key:'q@v1',title:'Healthy',files:{}}]};await fs.writeFile(path.join(healthy,'distribution.json'),JSON.stringify(good));
  const engine=require('../node/engine.cjs'),file=path.join(dir,'distribution.json');
  for(const value of ['{broken','null',JSON.stringify({format:'eval-lab-bank-v1',questions:null}),JSON.stringify({format:'eval-lab-bank-v1',questions:[null]}),'missing','oversized']){
   await fs.writeFile(file,value);if(value==='oversized')await fs.truncate(file,16*1024*1024+1);if(value==='missing')await fs.unlink(file);const size=value==='missing'?null:(await fs.stat(file)).size;
   const bank=await engine.dispatch('bank',{root,bank:healthy});assert.equal(bank.questions[0].title,'Healthy');assert.equal(bank.errors[0].id,'custom');assert.match(bank.errors[0].message,/清单.*恢复/);
   assert.deepEqual(await engine.dispatch('drafts',{root}),[]);assert.equal((await engine.dispatch('runs',{root}))[0].score,1);assert.equal(await fs.readFile(path.join(saved,'result.json'),'utf8'),history);if(size===null)await assert.rejects(fs.stat(file),{code:'ENOENT'});else assert.equal((await fs.stat(file)).size,size);
  }
  await fs.writeFile(file,JSON.stringify(good));assert.equal((await engine.dispatch('bank',{root})).questions[0].key,'custom:q@v1');assert.deepEqual(await engine.dispatch('drafts',{root}),[]);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
