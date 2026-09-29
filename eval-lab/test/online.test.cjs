const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),cp=require('node:child_process');
const {service,source,validate}=require('../node/online.cjs');const {files,within,runCommand}=require('../node/engine.cjs');
test('connection failures are actionable without replacing HTTP or validation errors',async()=>{
 const https=require('node:https'),{EventEmitter}=require('node:events'),original=https.get;
 try{
  for(const code of ['ENOTFOUND','ECONNRESET','CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE','ERR_TLS_CERT_ALTNAME_INVALID']){
   https.get=()=>{const r=new EventEmitter();r.setTimeout=()=>{};process.nextTick(()=>r.emit('error',Object.assign(Error('raw connection diagnostic'),{code})));return r;};
   await assert.rejects(require('../node/online.cjs').download('https://github.com/makecindy/eval-bank/releases/download/test/index.json','unused',100),/CERT|TLS|VERIFY/.test(code)?/安全连接验证失败.*证书/:/连接失败.*网络.*重试/);
  }
 }finally{https.get=original;}
});
test('download failures explain the next action without asking for credentials',()=>{
 const {downloadError}=require('../node/online.cjs');
 assert.match(downloadError(403),/限制.*稍后/);assert.match(downloadError(429),/不需要/);
 assert.match(downloadError(404),/发布源.*维护者/);assert.match(downloadError(503),/暂时不可用.*稍后/);
});
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const url='https://github.com/makecindy/eval-bank/releases/download/test/index.json';
test('only explicit public makecindy Release sources accepted',()=>{assert.equal(source(url).hostname,'github.com');for(const u of ['http://github.com/makecindy/cindy/releases/download/a/b','https://127.0.0.1/index','https://github.com/evil/cindy/releases/download/a/b','https://github.com/makecindy/cindy/blob/main/index.json',url+'?token=secret'])assert.throws(()=>source(u));});
test('download verifies, deduplicates runtimes, freezes versions, works offline; corruption rejected',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'online-bank-'));try{
 const src=path.join(root,'source');await fs.mkdir(src);await fs.writeFile(path.join(src,'question.json'),JSON.stringify({id:'fixture',revision:'v1',scoringVersion:'v1',title:'Fixture',groups:[{id:'core',weight:'1',mode:'all',items:['a']}]}));await fs.mkdir(path.join(src,'candidate'));await fs.writeFile(path.join(src,'candidate','hello.js'),'hello');
 const archive=path.join(root,'fixture.zip');cp.execFileSync('python3',['-c',"import zipfile,sys,pathlib;z=zipfile.ZipFile(sys.argv[2],'w');[(z.write(p,p.relative_to(sys.argv[1]))) for p in pathlib.Path(sys.argv[1]).rglob('*') if p.is_file()];z.close()",src,archive]);const bytes=await fs.readFile(archive),h=hash(bytes),name=h+'.zip';const q={key:'fixture@v1',revision:'v1',path:'questions/fixture/v1',files:await files(src),layers:[{artifact:name,mount:''}]};
 const index={format:'eval-lab-online-v1',platform:'darwin-arm64',questions:[q],artifacts:{[name]:{url:url.replace('index.json',name),sha256:h,bytes:bytes.length,expandedBytes:(await fs.readFile(path.join(src,'question.json'))).length+5}}};let indexText=JSON.stringify(index),offline=false,calls=0,corrupt=false;
 const svc=service({platform:'darwin',arch:'arm64',base:async()=>root,within,files,runCommand,fetchFile:async(u,d)=>{if(offline)throw Error('Offline');const b=u.endsWith('index.json')?Buffer.from(indexText):corrupt?Buffer.from('bad'):bytes;await fs.writeFile(d,b,{flag:'wx'});calls++;return {sha256:hash(b),bytes:b.length};}});
 const discovered=await svc.inspect({root,url});const p={root,indexId:discovered.indexId,question:q.key};const [a,b]=await Promise.all([svc.install(p),svc.install(p)]);assert.equal(a.bank,b.bank);assert.equal(calls,2);offline=true;assert.deepEqual((await svc.cached({root,url})).questions,discovered.questions);assert.deepEqual(await svc.install(p),a);assert.equal(calls,2);
 offline=false;index.questions[0].title='Updated index';indexText=JSON.stringify(index);const next=await svc.inspect({root,url});assert.deepEqual((await svc.cached({root,url})).questions,next.questions);const v2=await svc.install({...p,indexId:next.indexId});assert.notEqual(v2.bank,a.bank);assert.equal(calls,3);assert.equal((await svc.banks({root})).length,2);assert.ok(await fs.stat(a.bank));
 await fs.writeFile(path.join(a.bank,q.path,'candidate/hello.js'),'tampered');await svc.install(p);assert.equal(await fs.readFile(path.join(a.bank,q.path,'candidate/hello.js'),'utf8'),'hello');const backups=await fs.readdir(path.join(root,'online/backups'));assert.equal(backups.length,1);assert.equal(await fs.readFile(path.join(root,'online/backups',backups[0],q.path,'candidate/hello.js'),'utf8'),'tampered');
 const rename=fs.rename,operation=svc.begin({root});let cancellation;
 await fs.writeFile(path.join(a.bank,q.path,'candidate/hello.js'),'cancelled-original');
 fs.rename=async(from,to)=>{const value=await rename(from,to);if(from===a.bank&&to.includes(path.sep+'backups'+path.sep))cancellation=svc.cancel({root,...operation});return value;};
 try{await assert.rejects(svc.install({...p,...operation}),/下载已取消/);assert.deepEqual(await cancellation,{ok:true});}finally{fs.rename=rename;}
 assert.equal(await fs.readFile(path.join(a.bank,q.path,'candidate/hello.js'),'utf8'),'cancelled-original');
 await fs.unlink(path.join(a.bank,'distribution.json'));await svc.install(p);assert.equal((await fs.readdir(path.join(root,'online/backups'))).length,2);
 await fs.unlink(path.join(root,'online/artifacts',h+'.zip'));index.questions[0].title='New';indexText=JSON.stringify(index);const last=await svc.inspect({root,url});corrupt=true;await assert.rejects(svc.install({...p,indexId:last.indexId}),/题包校验或解压失败/);assert.equal((await svc.banks({root})).length,2);
 index.questions[0].title='Host downloaded';indexText=JSON.stringify(index);const hostIndex=await svc.inspect({root,url});
 const planned=await svc.plan({root,indexId:hostIndex.indexId,question:q.key});assert.equal(planned.artifacts[0].sha256,h);
 const hostArgs={root,indexId:hostIndex.indexId,question:q.key,requireHostDownloads:true};
 await assert.rejects(svc.install(hostArgs),/更新 Cindy/);
 await assert.rejects(svc.install({...hostArgs,downloads:{}}),/题包校验或解压失败/);
 const hostResult=await svc.install({...hostArgs,downloads:{['artifact_'+h]:archive}});assert.ok(await fs.stat(hostResult.bank));
 const invalid=structuredClone(index);invalid.questions[0].layers[0].mount='../escape';assert.throws(()=>validate(invalid,url));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('extractor rejects zip traversal and symlinks, enforces expanded size and executable modes',async()=>{const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'online-zip-')));try{for(const kind of ['traversal','symlink','size','normal']){const zip=path.join(root,kind+'.zip');cp.execFileSync('python3',['-c',"import zipfile,sys;z=zipfile.ZipFile(sys.argv[1],'w');i=zipfile.ZipInfo('../escape' if sys.argv[2]=='traversal' else 'node');i.external_attr=(0o120777 if sys.argv[2]=='symlink' else 0o100755)<<16;z.writestr(i,'data');z.close()",zip,kind]);const r=await runCommand('python3',[path.join(__dirname,'../node/unpack.py'),zip,path.join(root,kind),kind==='size'?'3':'4']);if(kind==='normal'){assert.equal(r.code,0);assert.ok((await fs.stat(path.join(root,kind,'node'))).mode&0o111);}else assert.notEqual(r.code,0);}await assert.rejects(fs.access(path.join(root,'escape')));}finally{await fs.rm(root,{recursive:true,force:true});}});

test('malformed and incompatible indices show actionable errors and remove temporary downloads',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'invalid-index-'));try{
  for(const text of ['{broken','null',JSON.stringify({format:'future'}),JSON.stringify({format:'eval-lab-online-v1',platform:'darwin-arm64',questions:[null],artifacts:{}})]){
   const svc=service({platform:'darwin',arch:'arm64',base:async()=>root,within,files,runCommand,fetchFile:async(u,d)=>{await fs.writeFile(d,text);return {sha256:hash(text)};}});
   await assert.rejects(svc.inspect({root,url}),/索引损坏或不兼容.*发布源.*维护者/);
   assert.deepEqual(await fs.readdir(path.join(root,'online')),[]);
  }
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('response body errors are localized without raw diagnostics',async()=>{
 const https=require('node:https'),{EventEmitter}=require('node:events'),{Readable}=require('node:stream'),original=https.get;
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'body-error-'));
 try{for(const oversized of [false,true]){
  https.get=(url,options,cb)=>{const req=new EventEmitter();req.setTimeout=()=>{};process.nextTick(()=>{const stream=new Readable({read(){if(oversized){this.push(Buffer.alloc(20));this.push(null);}else this.destroy(Error('PRIVATE raw transport diagnostic'));}});stream.statusCode=200;cb(stream);});return req;};
  await assert.rejects(require('../node/online.cjs').download(url,path.join(root,String(oversized)),10),oversized?/校验失败.*维护者/:/连接失败.*重试/);
 }}finally{https.get=original;await fs.rm(root,{recursive:true,force:true});}
});

test('fresh and cached installs reject hash-correct invalid question specifications',async()=>{
 for(const invalid of [{groups:[]},{scoringVersion:undefined},{groups:[{id:'core',weight:'2',mode:'all',items:['a']}]}])for(const cached of [false,true]){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'invalid-question-'));
  try{
   const spec=JSON.stringify({id:'fixture',revision:'v1',scoringVersion:'v1',title:'Fixture',groups:[{id:'core',weight:'1',mode:'all',items:['a']}],...invalid}),bytes=Buffer.from('fixture archive'),sha=hash(bytes),name=sha+'.zip';
   const q={key:'fixture@v1',revision:'v1',path:'question',files:{'question.json':hash(spec)},layers:[{artifact:name,mount:''}]},index={format:'eval-lab-online-v1',platform:'darwin-arm64',questions:[q],artifacts:{[name]:{url:url.replace('index.json',name),bytes:bytes.length,expandedBytes:spec.length,sha256:sha}}};
   const archive=path.join(root,'archive');await fs.writeFile(archive,bytes);
   const svc=service({platform:'darwin',arch:'arm64',base:async()=>root,within,files,fetchFile:async(u,d)=>{const b=JSON.stringify(index);await fs.writeFile(d,b);return {sha256:hash(b)};},runCommand:async(c,args)=>{if(args[0]==='-I')return {code:0};await fs.writeFile(path.join(args[2],'question.json'),spec);return {code:0};}});
   const {indexId}=await svc.inspect({root,url}),dest=path.join(root,'online/banks',hash(JSON.stringify(q)));
   if(cached){await fs.mkdir(path.join(dest,q.path),{recursive:true});await fs.writeFile(path.join(dest,q.path,'question.json'),spec);await fs.writeFile(path.join(dest,'distribution.json'),JSON.stringify({format:'eval-lab-bank-v1',questions:[q]}));}
   await assert.rejects(svc.install({root,indexId,question:q.key,hostArtifacts:{[sha]:archive}}),e=>e.code==='PACKAGE_INVALID'&&!e.message.includes(root));
   if(cached)assert.equal(await fs.readFile(path.join(dest,q.path,'question.json'),'utf8'),spec);else await assert.rejects(fs.access(dest),{code:'ENOENT'});
   assert.ok(!(await fs.readdir(path.join(root,'online'))).some(x=>x.startsWith('staging-')));
  }finally{await fs.rm(root,{recursive:true,force:true});}
 }
});

test('installation normalizes native abort errors without losing cancellation semantics',async()=>{
 const controller=new AbortController();controller.abort();
 const svc=service({base:async()=>{throw Error('must not reach storage');},within,files,runCommand});
 await assert.rejects(svc.install({signal:controller.signal}),e=>e.name==='AbortError'&&e.code==='ABORT_ERR'&&e.message==='下载已取消');
});

test('malformed redirect rejects normally and preserves Worker cleanup',()=>{
 const script=`const assert=require('node:assert/strict'),https=require('node:https'),{EventEmitter}=require('node:events'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
 let location;https.get=(url,options,callback)=>{const req=new EventEmitter();req.setTimeout=()=>{};process.nextTick(()=>callback({statusCode:302,headers:{location},resume(){}}));return req;};
 (async()=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'eval-redirect-'));try{const {service}=require('./eval-lab/node/online.cjs'),{within}=require('./eval-lab/node/engine.cjs'),svc=service({base:async()=>root,within});for(location of [undefined,'','http://[','http://example.test/a','https://example.test/a']){await assert.rejects(svc.inspect({root,url:'https://github.com/makecindy/eval-bank/releases/download/test/index.json'}),/重定向.*发布源/);assert.deepEqual(await fs.readdir(path.join(root,'online')),[]);}}finally{await fs.rm(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});`;
 const result=cp.spawnSync(process.execPath,['-e',script],{cwd:path.join(__dirname,'../..'),encoding:'utf8'});assert.equal(result.status,0,result.stderr);
});
