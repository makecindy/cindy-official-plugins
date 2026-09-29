'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),https=require('node:https');
const {pipeline}=require('node:stream/promises');const {Transform}=require('node:stream');const {createWriteStream,createReadStream}=require('node:fs');
const {checkPlatform}=require('./question-platform.cjs');
const {validateSpec}=require('../lib/core.cjs');
const readMetadata=require('./read-metadata.cjs');
const python=require('./python-runtime.cjs');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const safe=p=>typeof p==='string'&&p.length>0&&!p.includes('\\')&&!p.includes('\0')&&!p.split('/').some(x=>!x||x==='.'||x==='..')&&!path.isAbsolute(p);
function source(url){const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||u.hostname!=='github.com'||!/^\/makecindy\/[\w.-]+\/releases\/download\/[^/]+\/[^/]+$/.test(u.pathname))throw Error('请使用 makecindy GitHub Release 的 HTTPS 附件地址');return u;}
function redirect(url){const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port||!['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(u.hostname))throw Error('Unsupported download redirect');return u;}
function downloadError(status){
 if(status===403||status===429)return 'GitHub 限制了公开附件下载，请稍后重试或检查网络访问限制；插件不需要 GitHub Token。';
 if(status===404)return '找不到公开题库附件，请检查题库发布源或联系题库维护者确认 Release 仍可用。';
 if(status>=500)return 'GitHub 下载服务暂时不可用，请稍后重试；已有离线题库仍可使用。';
 return 'GitHub 未能提供题库附件，请检查公开 Release 地址与网络连接。';
}
function connectionError(error){
 const code=String(error?.code||'');
 if(/CERT|TLS|SSL|ISSUER|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code))return '题库安全连接验证失败，请检查系统时间和代理证书，或联系题库维护者；不要关闭证书校验。';
 return '题库连接失败，请检查网络、DNS 或代理设置后重试；已有离线题库仍可使用。';
}
function storageError(error){return Object.assign(Error('题库无法写入，请检查可用磁盘空间和插件存储权限后重试。'),{code:error.code||'STORAGE_UNAVAILABLE'});}
async function request(url,hops=0){if(hops>5)throw Error('Too many redirects');return new Promise((resolve,reject)=>{const r=https.get(redirect(url),{headers:{'User-Agent':'Cindy-Eval-Lab','Accept':'application/octet-stream'}},s=>{if([301,302,303,307,308].includes(s.statusCode)){s.resume();request(new URL(s.headers.location,url).href,hops+1).then(resolve,reject);}else if(s.statusCode!==200){s.resume();reject(Error(downloadError(s.statusCode)));}else resolve(s);});r.setTimeout(30000,()=>r.destroy(Error('Download stalled')));r.on('error',e=>reject(Error(connectionError(e))));});}
async function download(url,dest,limit,expected){source(url);const stream=await request(url);const h=crypto.createHash('sha256');let bytes=0;const timer=setTimeout(()=>stream.destroy(Error('Download deadline exceeded')),12*60*1000);let writeError;const output=createWriteStream(dest,{flags:'wx'});output.on('error',e=>{if(['ENOSPC','EACCES','EPERM','EDQUOT','EIO','EROFS','ENOENT','EEXIST'].includes(e.code))writeError=e;});try{await pipeline(stream,new Transform({transform(chunk,enc,cb){bytes+=chunk.length;if(bytes>limit)return cb(Object.assign(Error('Download exceeds declared size'),{code:'SIZE_LIMIT'}));h.update(chunk);cb(null,chunk);}}),output);const hash=h.digest('hex');if(expected&&(hash!==expected.sha256||bytes!==expected.bytes))throw Error('下载内容校验失败');return {sha256:hash,bytes};}catch(e){if(writeError)throw storageError(writeError);if(e.message==='下载内容校验失败'||e.code==='SIZE_LIMIT')throw Error('下载内容校验失败，请重新获取题库；仍失败请联系维护者。');throw Error(connectionError(e));}finally{clearTimeout(timer);}}
async function fileHash(p,signal){const h=crypto.createHash('sha256');for await(const c of createReadStream(p,{signal}))h.update(c);return h.digest('hex');}
function validateRaw(index,url){source(url);if(index.format!=='eval-lab-online-v1'||index.platform!=='darwin-arm64'||!Array.isArray(index.questions)||!index.questions.length||index.questions.length>100||!index.artifacts)throw Error('Invalid online index');const prefix=url.slice(0,url.lastIndexOf('/')+1),keys=new Set();for(const [name,a]of Object.entries(index.artifacts)){if(!/^[a-f0-9]{64}\.zip$/.test(name)||a.url!==prefix+name||!Number.isSafeInteger(a.bytes)||a.bytes<1||a.bytes>8*2**30||!Number.isSafeInteger(a.expandedBytes)||a.expandedBytes<0||a.expandedBytes>32*2**30||!/^[a-f0-9]{64}$/.test(a.sha256))throw Error('Invalid artifact');source(a.url);}for(const q of index.questions){if(typeof q.key!=='string'||keys.has(q.key)||!safe(q.path)||!q.files||!Array.isArray(q.layers)||q.layers.length>20||!q.layers.length)throw Error('Invalid question');keys.add(q.key);for(const [f,h]of Object.entries(q.files))if(!safe(f)||!/^[a-f0-9]{64}$/.test(h))throw Error('Invalid question files');if(Object.keys(q.files).length>50000)throw Error('Too many files');const archives=new Set();let downloadBytes=0,expandedBytes=0;
 for(const l of q.layers){
  if(typeof l?.artifact!=='string'||!Object.hasOwn(index.artifacts,l.artifact))throw Error('Invalid layer');
  const artifact=index.artifacts[l.artifact];
  if(!artifact||typeof artifact!=='object'||Array.isArray(artifact)||(l.mount!==''&&!safe(l.mount)))throw Error('Invalid layer');
  if(!archives.has(l.artifact)){archives.add(l.artifact);downloadBytes+=artifact.bytes;}
  expandedBytes+=artifact.expandedBytes;
  if(downloadBytes>8*2**30||expandedBytes>32*2**30)throw Error('Question exceeds capacity limits');
 }}return index;}
const invalidIndex='题库索引损坏或不兼容，请检查发布源并重新获取；仍失败请联系题库维护者。';
function validate(index,url){source(url);try{return validateRaw(index,url);}catch{throw Error(invalidIndex);}}
function parseIndex(text,url){let value;try{value=JSON.parse(text);}catch{throw Error(invalidIndex);}return validate(value,url);}
const inflight=new Map();
function once(key,fn){if(!inflight.has(key))inflight.set(key,Promise.resolve().then(fn).finally(()=>inflight.delete(key)));return inflight.get(key);}
const unpackTimeout=bytes=>Math.min(14*60*1000,Math.max(120000,Math.ceil(bytes/(10*2**20))*1000+20000));
function installError(e){
 if(e.name==='AbortError')return Object.assign(Error('下载已取消'),{name:'AbortError',code:'ABORT_ERR'});
 if(e.pythonStartup||e.message==='下载已取消'||['UNSUPPORTED_PLATFORM','PYTHON_UNAVAILABLE'].includes(e.code))return e;
 let code='INSTALL_FAILED',message='题库安装未完成，请重试；仍失败请联系题库维护者。';
 if(e.code==='EXTRACTION_TIMEOUT'){code=e.code;message='题库解包超时，请检查磁盘负载或改用更快的存储后重试；已有题库和成绩保留。';}
 else if(/更新 Cindy/.test(e.message)){code='HOST_UPDATE_REQUIRED';message='请更新 Cindy 以使用受管下载';}
 else if(/Cached question changed/.test(e.message)){code='CACHE_DAMAGED';message='已安装题库校验失败，请在高级设置中重新导入可信题库或联系维护者；已有成绩保留。';}
 else if(e.code==='PACKAGE_INVALID'||/integrity|content mismatch|identity mismatch|解压失败/i.test(e.message)){code='PACKAGE_INVALID';message='题包校验或解压失败，请重新下载；仍失败请联系题库维护者。';}
 else if(['ENOSPC','EDQUOT','EACCES','EPERM','EROFS','EIO','EMFILE','ENFILE','ENOENT'].includes(e.code)){code='STORAGE_UNAVAILABLE';message='题库无法写入，请检查可用磁盘空间和插件存储权限后重试。';}
 return Object.assign(Error(message),{code});
}
function service({base,within,files,runCommand,fetchFile=download,platform=process.platform,arch=process.arch,stepBytes}){
 const preflight=()=>python.preflight(runCommand);
 const operations=new Map();
 const staged=require('./install-steps.cjs')({home,within,validate,checkPlatform,verifySpec,preflight,platform,arch,stepBytes});
 async function verifySpec(dir,q){
  let spec;try{spec=await readMetadata(path.join(dir,'question.json'),q.files['question.json']||'');validateSpec(spec);if(q.key!==spec.id+'@'+spec.revision||q.revision!==spec.revision)throw Error('Question identity mismatch');}
  catch(e){if(e.code&&!['ENOENT','PACKAGE_INVALID'].includes(e.code))throw e;throw Object.assign(Error('Invalid question specification'),{code:'PACKAGE_INVALID'});}
  checkPlatform(spec.environment,platform,arch);
 }

 function begin(p){
  if(operations.size>=8)throw Error('Too many pending installs');
  const operationId=crypto.randomUUID();
  operations.set(operationId,{root:p.root,controller:new AbortController(),done:null});
  return {operationId};
 }
 async function cancel(p){
  const op=operations.get(p.operationId);
  if(!op)return {ok:true};
  if(op.root!==p.root)throw Error('Install owner changed');
  op.controller.abort(Error('下载已取消'));
  if(op.stepped){await op.extractor?.stop();if(op.busy)await op.busy.catch(()=>{});await staged.cleanup(op);operations.delete(p.operationId);return {ok:true};}
  if(op.done)await op.done.catch(e=>{if(e.name!=='AbortError'&&e.message!=='下载已取消')throw e;});
  operations.delete(p.operationId);return {ok:true};
 }
 function install(p){
  if(!p.operationId)return installFiles(p).catch(e=>{throw installError(e);});
  const op=operations.get(p.operationId);
  if(!op||op.root!==p.root)throw Error('下载已取消');
  if(op.done)throw Error('Install already started');
  op.done=installFiles({...p,signal:op.controller.signal}).catch(e=>{throw installError(e);}).finally(()=>operations.delete(p.operationId));
  return op.done;
 }
 async function step(p){
  const op=operations.get(p.operationId);
  if(!op||op.root!==p.root)throw Error('下载已取消');
  if(op.busy||op.done)throw Error('题库正在安装，请等待当前操作完成后重试。');
  const identity=JSON.stringify([p.indexId,p.question]);
  if(op.identity&&op.identity!==identity)throw Error('Install owner changed');
  if(op.completed)return op.completed;
  if([...operations.values()].some(x=>x!==op&&x.root===p.root&&x.identity===identity))throw Error('题库正在安装，请等待当前操作完成后重试。');
  op.stepped=true;
  op.busy=staged.step(op,p).catch(e=>{if(op.controller.signal.aborted)throw Error('下载已取消');throw installError(e);});
  try{const result=await op.busy;if(result.done)op.completed=result;return result;}finally{op.busy=null;}
 }

 async function home(root){const h=await base(root),d=await within(h,'online');await fs.mkdir(d,{recursive:true});return d;}
 async function inspect(p){
  const h=await home(p.root),tmp=path.join(h,crypto.randomUUID()+'.part');let pending;
  try{
   const hash=await fetchFile(p.url,tmp,16*1024*1024),index=parseIndex(await fs.readFile(tmp,'utf8'),p.url);
   const dest=path.join(h,'indices',hash.sha256);await fs.mkdir(dest,{recursive:true});
   pending=path.join(dest,crypto.randomUUID()+'.tmp');
   await fs.writeFile(pending,JSON.stringify({url:p.url,index}),{flag:'wx'});
   await fs.rename(pending,path.join(dest,'index.json'));
   return project(hash.sha256,index);
  }catch(e){if(['ENOSPC','EACCES','EPERM','EDQUOT','EIO','EROFS'].includes(e.code))throw storageError(e);throw e;}
  finally{await fs.rm(tmp,{force:true});if(pending)await fs.rm(pending,{force:true});}
 }


 function project(indexId,index){return {indexId,questions:index.questions.map(q=>({key:q.key,title:q.title,revision:q.revision,questionId:q.key.split('@')[0],releaseHash:q.sourceManifestSha256,distributionHash:digest(JSON.stringify(q.files)),installedKey:'online:'+digest(JSON.stringify(q))+':'+q.key,bytes:[...new Set(q.layers.map(l=>l.artifact))].reduce((n,k)=>n+index.artifacts[k].bytes,0)}))};}
 async function cached(p){
  const h=await home(p.root);let entries;try{entries=await fs.readdir(path.join(h,'indices'));}catch(e){if(e.code==='ENOENT')return {questions:[]};throw e;}
  const found=[];
  for(const id of entries.filter(x=>/^[a-f0-9]{64}$/.test(x))){
   const file=path.join(h,'indices',id,'index.json');
   try{const saved=JSON.parse(await fs.readFile(file,'utf8'));if(saved?.url!==p.url)continue;found.push({id,index:validate(saved.index,p.url),mtime:(await fs.stat(file)).mtimeMs});}
   catch(e){if(e instanceof SyntaxError||e.code==='ENOENT'||e.message===invalidIndex)continue;throw e;}
  }
  found.sort((a,b)=>b.mtime-a.mtime||a.id.localeCompare(b.id));
  return found.length?{...project(found[0].id,found[0].index),cached:true}:{questions:[]};
 }

 async function plan(p){if(!/^[a-f0-9]{64}$/.test(p.indexId))throw Error('Invalid index ID');const h=await home(p.root),saved=JSON.parse(await fs.readFile(path.join(h,'indices',p.indexId,'index.json'),'utf8')),index=validate(saved.index,saved.url),q=index.questions.find(q=>q.key===p.question);if(!q)throw Error('Question not found');checkPlatform(index.platform,platform,arch);await preflight();return {artifacts:[...new Set(q.layers.map(l=>l.artifact))].map(k=>index.artifacts[k])};}
 async function installFiles(p){const signal=p.signal;signal?.throwIfAborted();if(p.requireHostDownloads){if(!p.downloads||typeof p.downloads!=='object')throw Error('请更新 Cindy 以使用受管下载');p={...p,hostArtifacts:Object.fromEntries(Object.entries(p.downloads).filter(([k])=>/^artifact_[a-f0-9]{64}$/.test(k)).map(([k,v])=>[k.slice(9),v]))};}if(!/^[a-f0-9]{64}$/.test(p.indexId))throw Error('Invalid index ID');const h=await home(p.root);const key=h+':'+p.indexId+':'+p.question;if(p.operationId&&inflight.has(key))throw Error('题库正在安装，请等待当前操作完成后重试。');return once(key,async()=>{signal?.throwIfAborted();const saved=JSON.parse(await fs.readFile(path.join(h,'indices',p.indexId,'index.json'),'utf8'));const index=validate(saved.index,saved.url),q=index.questions.find(q=>q.key===p.question);if(!q)throw Error('Question not found');checkPlatform(index.platform,platform,arch);const release=digest(JSON.stringify(q));const dest=await within(h,'banks/'+release);const result={bank:dest,key:q.key,title:q.title};try{const m=await readMetadata(path.join(dest,'distribution.json'));const actual=await files(path.join(dest,q.path),'',signal);if(m?.format!=='eval-lab-bank-v1'||JSON.stringify(m.questions)!==JSON.stringify([q])||Object.keys(actual).length!==Object.keys(q.files).length||Object.entries(q.files).some(([f,h])=>actual[f]!==h))throw Error('Cached question changed');await verifySpec(path.join(dest,q.path),q);return result;}catch(e){if(!['ENOENT','PACKAGE_INVALID'].includes(e.code)&&!(e instanceof SyntaxError)&&e.message!=='Cached question changed')throw e;}
 await preflight();
 const staging=await fs.mkdtemp(path.join(h,'staging-'));try{const target=path.join(staging,q.path);await fs.mkdir(target,{recursive:true});for(const l of q.layers){signal?.throwIfAborted();const a=index.artifacts[l.artifact],cache=p.hostArtifacts?p.hostArtifacts[a.sha256]:await within(h,'artifacts/'+a.sha256+'.zip');if(p.hostArtifacts){if(typeof cache!=='string'||(await fs.stat(cache)).size!==a.bytes||await fileHash(cache,signal)!==a.sha256)throw Error('Host artifact integrity failure');}if(!p.hostArtifacts){await fs.mkdir(path.dirname(cache),{recursive:true});await once(cache,async()=>{try{if((await fs.stat(cache)).size===a.bytes&&await fileHash(cache,signal)===a.sha256)return;}catch(e){if(e.code!=='ENOENT')throw e;}const temp=cache+'.'+crypto.randomUUID()+'.part';try{await fetchFile(a.url,temp,a.bytes,a);if(await fileHash(temp,signal)!==a.sha256||(await fs.stat(temp)).size!==a.bytes)throw Error('Artifact integrity failure');await fs.rename(temp,cache);}finally{await fs.rm(temp,{force:true});}});}const unpack=await runCommand('python3',[path.join(__dirname,'unpack.py'),cache,path.join(target,l.mount),String(a.expandedBytes)],{timeout:unpackTimeout(a.expandedBytes),signal});signal?.throwIfAborted();if(unpack.errorCode)throw python.startupError(unpack.errorCode);if(unpack.timedOut)throw Object.assign(Error('Extraction timed out'),{code:'EXTRACTION_TIMEOUT'});if(unpack.code!==0)throw Error('题库解压失败: '+(unpack.stderr||unpack.error));}
 signal?.throwIfAborted();const actual=await files(target,'',signal);signal?.throwIfAborted();if(Object.keys(actual).length!==Object.keys(q.files).length||Object.entries(q.files).some(([f,h])=>actual[f]!==h))throw Error('Question content mismatch');await verifySpec(target,q);await fs.writeFile(path.join(staging,'distribution.json'),JSON.stringify({format:'eval-lab-bank-v1',platform:index.platform,suite:index.suite,online:{indexId:p.indexId,url:saved.url},questions:[q]}));await fs.mkdir(path.dirname(dest),{recursive:true});signal?.throwIfAborted();let backup;try{await fs.lstat(dest);const folder=await within(h,'backups');await fs.mkdir(folder,{recursive:true});const saved=path.join(folder,release+'-'+crypto.randomUUID());signal?.throwIfAborted();await fs.rename(dest,saved);backup=saved;}catch(e){if(e.code!=='ENOENT')throw e;}try{signal?.throwIfAborted();await fs.rename(staging,dest);}catch(e){if(backup)await fs.rename(backup,dest);throw e;}return result;}finally{await fs.rm(staging,{recursive:true,force:true});}});}
 async function banks(p){const h=await home(p.root);let names;try{names=await fs.readdir(path.join(h,'banks'));}catch(e){if(e.code==='ENOENT')return [];throw e;}return names.filter(n=>/^[a-f0-9]{64}$/.test(n)).map(n=>({id:n,path:path.join(h,'banks',n)}));}
 return {inspect,cached,plan,begin,cancel,install,step,banks};
}
module.exports={unpackTimeout,service,validate,source,download,downloadError};
