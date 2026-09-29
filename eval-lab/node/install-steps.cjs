'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process'),readline=require('node:readline');
const readMetadata=require('./read-metadata.cjs');
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
const invalid=()=>Object.assign(Error('Question content mismatch'),{code:'PACKAGE_INVALID'});
const chunkSize=1024*1024;
// Each operation owns its archives. Borrowed Host files are closed before a step returns.
module.exports=function installSteps({home,within,validate,checkPlatform,verifySpec,preflight,platform,arch,stepBytes=32*1024*1024}){
 const limit=Math.max(1,Math.min(stepBytes,32*1024*1024));
 async function* entries(root,rel=''){
  for(const e of (await fs.readdir(path.join(root,rel),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
   const name=rel?rel+'/'+e.name:e.name;
   if(e.isDirectory())yield* entries(root,name);
   else if(e.isFile())yield name;
   else throw invalid();
  }
 }
 async function hashStep(op){
  let used=0;const deadline=Date.now()+2000;
  while(used<limit&&Date.now()<deadline){
   if(!op.file){
    const next=await op.walk.next();
    if(next.done){if(op.checked!==Object.keys(op.q.files).length)throw invalid();return true;}
    if(!Object.hasOwn(op.q.files,next.value))throw invalid();
    op.file={name:next.value,offset:0,hash:crypto.createHash('sha256')};
   }
   const f=op.file,handle=await fs.open(path.join(op.target,f.name),'r');
   try{
    const b=Buffer.alloc(Math.min(chunkSize,limit-used)),r=await handle.read(b,0,b.length,f.offset);
    if(r.bytesRead){f.hash.update(b.subarray(0,r.bytesRead));f.offset+=r.bytesRead;used+=r.bytesRead;}
    else{if(f.hash.digest('hex')!==op.q.files[f.name])throw invalid();op.checked++;op.file=null;}
   }finally{await handle.close();}
   op.controller.signal.throwIfAborted();
  }
  return false;
 }
 function extractor(op,archive,layer){
  const p=cp.spawn('python3',['-I',path.join(__dirname,'unpack-step.py'),archive,path.join(op.target,layer.mount),String(op.index.artifacts[layer.artifact].expandedBytes)],{stdio:['pipe','pipe','ignore']});
  const abort=()=>p.kill('SIGKILL');op.controller.signal.addEventListener('abort',abort,{once:true});if(op.controller.signal.aborted)abort();
  let pending,ended=false,failure;
  const closed=new Promise(resolve=>p.once('close',()=>{ended=true;op.controller.signal.removeEventListener('abort',abort);if(pending){pending.reject(failure||invalid());pending=null;}resolve();}));
  p.on('error',e=>{failure=require('./python-runtime.cjs').startupError(e.code);if(pending){pending.reject(failure);pending=null;}});
  p.stdin.on('error',()=>{});
  const lines=readline.createInterface({input:p.stdout});
  lines.on('line',line=>{if(!pending)return;const r=pending;pending=null;try{const value=JSON.parse(line);if(value.error&&['ENOSPC','EDQUOT','EACCES','EPERM','EROFS','EIO','EMFILE','ENFILE','ENOENT'].includes(value.code))throw Object.assign(Error('Archive storage unavailable'),{code:value.code});if(value.error||typeof value.done!=='boolean')throw invalid();r.resolve(value);}catch(e){r.reject(e);}});
  return {async step(){if(ended||failure)throw failure||invalid();let timer;try{return await new Promise((resolve,reject)=>{pending={resolve,reject};timer=setTimeout(()=>{failure=Object.assign(Error('Extraction timed out'),{code:'EXTRACTION_TIMEOUT'});p.kill('SIGKILL');},30000);p.stdin.write(JSON.stringify({bytes:limit})+'\n');});}finally{clearTimeout(timer);}},async stop(){p.kill('SIGKILL');await closed;lines.close();},closed};
 }
 async function initialize(op,p){
  if(!/^[a-f0-9]{64}$/.test(p.indexId))throw invalid();
  const h=await home(p.root),saved=JSON.parse(await fs.readFile(path.join(h,'indices',p.indexId,'index.json'),'utf8'));
  const index=validate(saved.index,saved.url),q=index.questions.find(q=>q.key===p.question);
  if(!q)throw invalid();checkPlatform(index.platform,platform,arch);
  const release=digest(JSON.stringify(q)),dest=await within(h,'banks/'+release);
  Object.assign(op,{identity:JSON.stringify([p.indexId,p.question]),h,index,q,saved,release,dest,result:{bank:dest,key:q.key,title:q.title},checked:0});
  try{
   const manifest=await readMetadata(path.join(dest,'distribution.json'));
   if(manifest.format!=='eval-lab-bank-v1'||JSON.stringify(manifest.questions)!==JSON.stringify([q]))throw invalid();
   op.target=path.join(dest,q.path);op.walk=entries(op.target);op.phase='cached';
  }catch(e){if(e.code!=='ENOENT'&&e.code!=='PACKAGE_INVALID'&&!(e instanceof SyntaxError))throw e;await stage(op);}
 }
 async function stage(op){
  await preflight();
  op.staging=await fs.mkdtemp(path.join(op.h,'staging-'));op.target=path.join(op.staging,op.q.path);
  await fs.mkdir(op.target,{recursive:true});op.archives=[...new Set(op.q.layers.map(l=>l.artifact))];op.archiveIndex=0;op.offset=0;op.phase='copy';op.file=null;
  op.archiveDir=await fs.mkdtemp(path.join(op.h,'archive-copy-'));
 }
 async function copy(op,p){
  const key=op.archives[op.archiveIndex],a=op.index.artifacts[key],borrowed=p.downloads?.['artifact_'+a.sha256];
  if(typeof borrowed!=='string')throw invalid();
  const src=await fs.open(borrowed,'r');let dest;
  try{
   if(!(await src.stat()).isFile()||(await src.stat()).size!==a.bytes)throw invalid();
   dest=await fs.open(path.join(op.archiveDir,key),op.offset?'r+':'wx');
   if(!op.offset)op.hash=crypto.createHash('sha256');
   let used=0;const deadline=Date.now()+2000;
   while(used<limit&&op.offset<a.bytes&&Date.now()<deadline){
    op.controller.signal.throwIfAborted();const b=Buffer.alloc(Math.min(chunkSize,limit-used,a.bytes-op.offset));
    const r=await src.read(b,0,b.length,op.offset);if(!r.bytesRead)throw invalid();
    let written=0;while(written<r.bytesRead){const w=await dest.write(b,written,r.bytesRead-written,op.offset+written);if(!w.bytesWritten)throw invalid();written+=w.bytesWritten;}
    op.hash.update(b.subarray(0,r.bytesRead));op.offset+=r.bytesRead;used+=r.bytesRead;
   }
   if(op.offset===a.bytes){if(op.hash.digest('hex')!==a.sha256)throw invalid();op.offset=0;op.archiveIndex++;if(op.archiveIndex===op.archives.length){op.phase='extract';op.layerIndex=0;}}
  }finally{await dest?.close();await src.close();}
 }
 async function publish(op,p){
  await verifySpec(op.target,op.q);
  await fs.writeFile(path.join(op.staging,'distribution.json'),JSON.stringify({format:'eval-lab-bank-v1',platform:op.index.platform,suite:op.index.suite,online:{indexId:p.indexId,url:op.saved.url},questions:[op.q]}));
  await fs.mkdir(path.dirname(op.dest),{recursive:true});op.controller.signal.throwIfAborted();let backup;
  try{await fs.lstat(op.dest);const folder=await within(op.h,'backups');await fs.mkdir(folder,{recursive:true});backup=path.join(folder,op.release+'-'+crypto.randomUUID());await fs.rename(op.dest,backup);}catch(e){if(e.code!=='ENOENT')throw e;}
  try{op.controller.signal.throwIfAborted();await fs.rename(op.staging,op.dest);op.staging=null;}catch(e){if(backup)await fs.rename(backup,op.dest);throw e;}
 }
 async function step(op,p){
  op.controller.signal.throwIfAborted();
  if(!op.identity){await initialize(op,p);if(op.phase==='copy')return {done:false,phase:'copy'};}
  if(op.identity!==JSON.stringify([p.indexId,p.question]))throw Error('Install owner changed');
  if(op.phase==='cached'){
   try{if(await hashStep(op)){await verifySpec(op.target,op.q);return {done:true,result:op.result};}}
   catch(e){if(e.code!=='ENOENT'&&e.code!=='PACKAGE_INVALID')throw e;await stage(op);}
  }else if(op.phase==='copy')await copy(op,p);
  else if(op.phase==='extract'){
   const layer=op.q.layers[op.layerIndex];op.extractor??=extractor(op,path.join(op.archiveDir,layer.artifact),layer);
   const result=await op.extractor.step();
   if(result.done){await op.extractor.closed;op.extractor=null;op.layerIndex++;if(op.layerIndex===op.q.layers.length){op.phase='verify';op.walk=entries(op.target);op.checked=0;op.file=null;}}
  }else if(op.phase==='verify'){
   if(await hashStep(op)){await publish(op,p);return {done:true,result:op.result};}
  }
  return {done:false,phase:op.phase};
 }
 async function cleanup(op){await op.extractor?.stop();op.extractor=null;if(op.staging)await fs.rm(op.staging,{recursive:true,force:true});if(op.archiveDir)await fs.rm(op.archiveDir,{recursive:true,force:true});}
 return {step,cleanup};
};
