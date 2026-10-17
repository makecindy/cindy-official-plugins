const {install}=require('./online-fixture.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),cp=require('node:child_process');
const {service}=require('../node/online.cjs'),{within,files,runCommand}=require('../node/engine.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
test('cancel drains the unpack process, removes staging, preserves installed banks and permits retry',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'install-cancel-')),spawn=cp.spawn,open=fs.open;
 try{
  const src=path.join(root,'source');await fs.mkdir(src);await fs.writeFile(path.join(src,'question.json'),JSON.stringify({id:'fixture',revision:'v1',scoringVersion:'v1',title:'Fixture',groups:[{id:'core',weight:'1',mode:'all',items:['a']}]}));
  const archive=path.join(root,'archive.zip');cp.execFileSync('python3',['-c',"import zipfile,sys;z=zipfile.ZipFile(sys.argv[2],'w');z.write(sys.argv[1],'question.json');z.close()",path.join(src,'question.json'),archive]);
  const bytes=await fs.readFile(archive),sha=hash(bytes),name=sha+'.zip',url='https://github.com/makecindy/eval-bank/releases/download/test/index.json';
  const question={key:'fixture@v1',revision:'v1',path:'questions/fixture/v1',files:await files(src),layers:[{artifact:name,mount:''}]};
  const index={format:'eval-lab-online-v1',platform:'darwin-arm64',questions:[question],artifacts:{[name]:{url:url.replace('index.json',name),sha256:sha,bytes:bytes.length,expandedBytes:(await fs.stat(path.join(src,'question.json'))).size}}};
  const svc=service({platform:'darwin',arch:'arm64',base:async()=>root,within,runCommand,
   fetchFile:async(_,dest)=>{const b=Buffer.from(JSON.stringify(index));await fs.writeFile(dest,b);return {sha256:hash(b),bytes:b.length};}});
  const inspected=await svc.inspect({root,url});
  const params={root,indexId:inspected.indexId,question:question.key,downloads:{['artifact_'+sha]:archive}};
  const old=path.join(root,'online/banks','f'.repeat(64));await fs.mkdir(old,{recursive:true});await fs.writeFile(path.join(old,'keep'),'existing');
  for(const target of ['extract','verify']){
   const operation=svc.begin(params),p={...params,...operation};let state;
   do{state=await svc.step(p);}while(state.phase!==target);
   let started,release,child,closed=false;
   const ready=new Promise(r=>started=r),barrier=new Promise(r=>release=r);
   if(target==='extract')cp.spawn=(command,args,options)=>{
    child=spawn(command,['-I','-c',"import sys,time;sys.stdin.readline();time.sleep(30)"],options);
    child.once('close',()=>closed=true);child.once('spawn',started);return child;
   };
   else fs.open=async(file,...args)=>{const handle=await open(file,...args);if(String(file).includes('/staging-')){started();await barrier;}return handle;};
   const running=svc.step(p),rejected=assert.rejects(running,/取消|abort/i);await ready;
   let cancelled=false;const cancelling=svc.cancel(p).then(()=>{cancelled=true;});
   if(target==='verify'){await Promise.resolve();assert.equal(cancelled,false);release();}
   await cancelling;await rejected;cp.spawn=spawn;fs.open=open;
   if(target==='extract'){assert.equal(closed,true);assert.throws(()=>process.kill(child.pid,0),{code:'ESRCH'});}
   assert.equal((await fs.readdir(path.join(root,'online'))).some(x=>/staging-|archive-copy-/.test(x)),false);
   assert.deepEqual(await fs.readdir(path.join(root,'online/banks')),['f'.repeat(64)]);
   assert.equal(await fs.readFile(path.join(old,'keep'),'utf8'),'existing');
  }
  const early=svc.begin({root});await svc.cancel({root,...early});await assert.rejects(svc.step({...params,...early}),/取消/);
  const result=await install(svc,{...params,...svc.begin({root})});assert.ok(await fs.stat(result.bank));
 }finally{cp.spawn=spawn;fs.open=open;await fs.rm(root,{recursive:true,force:true});}
});
