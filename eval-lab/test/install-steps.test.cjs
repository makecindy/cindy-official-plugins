const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),cp=require('node:child_process');
const {service}=require('../node/online.cjs'),{files,within,runCommand}=require('../node/engine.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function fixture(fn){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eval-step-'));
 try{
  const source=path.join(root,'source');await fs.mkdir(source);await fs.writeFile(path.join(source,'large'),crypto.randomBytes(200000));
  await fs.writeFile(path.join(source,'question.json'),JSON.stringify({id:'fixture',revision:'v1',title:'Fixture',scoringVersion:'v1',groups:[{id:'g',weight:'1',mode:'all',items:['a']}]}));
  const archive=path.join(root,'borrowed.zip');cp.execFileSync('python3',['-c',"import pathlib,zipfile,sys;z=zipfile.ZipFile(sys.argv[2],'w',compression=zipfile.ZIP_DEFLATED);[z.write(p,p.name) for p in pathlib.Path(sys.argv[1]).iterdir()];z.close()",source,archive]);
  const b=await fs.readFile(archive),sha=hash(b),name=sha+'.zip',url='https://github.com/makecindy/eval-bank/releases/download/test/index.json';
  const q={key:'fixture@v1',revision:'v1',path:'questions/fixture/v1',files:await files(source),layers:[{artifact:name,mount:''}]};
  const index={format:'eval-lab-online-v1',platform:'darwin-arm64',questions:[q],artifacts:{[name]:{url:url.replace('index.json',name),bytes:b.length,sha256:sha,expandedBytes:200000+(await fs.stat(path.join(source,'question.json'))).size}}};
  const svc=service({base:async()=>root,within,files,runCommand,platform:'darwin',arch:'arm64',stepBytes:4096,fetchFile:async(u,d)=>{const b=Buffer.from(JSON.stringify(index));await fs.writeFile(d,b);return {sha256:hash(b)};}});
  const discovered=await svc.inspect({root,url});const p={root,indexId:discovered.indexId,question:q.key,downloads:{['artifact_'+sha]:archive},requireHostDownloads:true};
  await fn({root,source,archive,svc,p,q});
 }finally{await fs.rm(root,{recursive:true,force:true});}
}
test('one compressed large entry advances across requests and never reads borrowed archives while extracting',()=>fixture(async({root,source,archive,svc,p,q})=>{
 const op=svc.begin(p);let result,steps=0,extracts=0,checks=0,moved=false;
 do{
  result=await svc.step({...p,...op});steps++;if(result.phase==='extract')extracts++;if(result.phase==='verify')checks++;
  if(result.phase==='extract'&&!moved){await fs.rename(archive,archive+'.released');moved=true;}
  assert.ok(steps<300);
 }while(!result.done);
 assert.ok(extracts>10);assert.ok(checks>10);assert.deepEqual(await files(path.join(result.result.bank,q.path)),await files(source));
 await svc.cancel({...p,...op});assert.deepEqual((await fs.readdir(path.join(root,'online'))).filter(x=>/staging-|archive-copy-/.test(x)),[]);
 // Installed cache verification itself is also bounded and needs no borrowed file.
 const oldPath=process.env.PATH;process.env.PATH=root;
 try{const cached=svc.begin(p);let n=0;do{result=await svc.step({...p,...cached});n++;}while(!result.done);assert.ok(n>10);await svc.cancel({...p,...cached});assert.deepEqual(await svc.install(p),result.result);}finally{process.env.PATH=oldPath;}
}));
test('extractor startup failure retains the Python diagnostic and cleans owned staging',()=>fixture(async({root,svc,p})=>{
 const op=svc.begin(p);let result;
 do{result=await svc.step({...p,...op});}while(result.phase!=='extract');
 const oldPath=process.env.PATH;process.env.PATH=root;
 try{await assert.rejects(svc.step({...p,...op}),{code:'PYTHON_UNAVAILABLE'});}finally{process.env.PATH=oldPath;await svc.cancel({...p,...op});}
 assert.deepEqual((await fs.readdir(path.join(root,'online'))).filter(x=>/staging-|archive-copy-/.test(x)),[]);
}));
test('extractor resource and permission failures retain their cause instead of suggesting installation',()=>fixture(async({root,svc,p})=>{
 const spawn=cp.spawn;
 for(const code of ['EACCES','EMFILE','EAGAIN']){
  const op=svc.begin(p);let result;do{result=await svc.step({...p,...op});}while(result.phase!=='extract');
  cp.spawn=(command,args,options)=>{const child=spawn(path.join(root,'missing-python'),args,options);child.once('error',e=>{e.code=code;});return child;};
  try{await assert.rejects(svc.step({...p,...op}),e=>e.code===code&&!/安装 Python/.test(e.message));}finally{cp.spawn=spawn;await svc.cancel({...p,...op});}
 }
 assert.deepEqual((await fs.readdir(path.join(root,'online'))).filter(x=>/staging-|archive-copy-/.test(x)),[]);
}));
test('cancelling any stage preserves the installed bank and removes only operation-owned files',()=>fixture(async({root,svc,p,q})=>{
 for(const phase of ['copy','extract','verify']){
  const op=svc.begin(p);let result;
  // Cancellation during copying must cover archives bigger than one chunk, too.
  if(phase==='copy')await svc.step({...p,...op});
  else do{result=await svc.step({...p,...op});assert.equal(result.done,false);}while(result.phase!==phase);
  await svc.cancel({...p,...op});await assert.rejects(svc.step({...p,...op}),/取消/);
  assert.deepEqual((await fs.readdir(path.join(root,'online'))).filter(x=>/staging-|archive-copy-/.test(x)),[]);
  assert.deepEqual(await svc.banks(p),[]);
 }
}));

test('Python extraction preserves storage failures without exposing paths or blaming archives',()=>fixture(async({root,svc,p})=>{
 const spawn=cp.spawn;
 for(const code of ['ENOSPC','EDQUOT','EACCES','EPERM','EROFS','EIO','NO_ERRNO']){
  const op=svc.begin(p);let result;do{result=await svc.step({...p,...op});}while(result.phase!=='extract');
  cp.spawn=(command,args,options)=>{
   if(args[1]?.endsWith('unpack-step.py')){
    const script="import errno,pathlib,runpy,sys\nscript=sys.argv.pop(1);code=sys.argv.pop()\ndef broken(self,*a,**k): raise (OSError('Invalid data stream') if code=='NO_ERRNO' else OSError(getattr(errno,code),'secret storage path'))\npathlib.Path.open=broken\nrunpy.run_path(script,run_name='__main__')";
    return spawn(command,['-I','-c',script,args[1],...args.slice(2),code],options);
   }return spawn(command,args,options);
  };
  try{await assert.rejects(svc.step({...p,...op}),e=>code==='NO_ERRNO'?e.code==='PACKAGE_INVALID':e.code==='STORAGE_UNAVAILABLE'&&/磁盘空间/.test(e.message)&&!e.message.includes(root)&&!e.message.includes('secret')&&!/重新下载/.test(e.message));}
  finally{cp.spawn=spawn;await svc.cancel({...p,...op});}
 }
}));
