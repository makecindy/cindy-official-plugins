const {install}=require('./online-fixture.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {validate,service}=require('../node/online.cjs');
const {within}=require('../node/engine.cjs');
const GiB=2**30,url='https://github.com/makecindy/eval-bank/releases/download/test/index.json';
test('missing Python rejects planning and installation before artifact work',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eval-python-install-')),id='c'.repeat(64),old=process.env.PATH;
 try{
  const dir=path.join(root,'online/indices',id);await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'index.json'),JSON.stringify({url,index:fixture()}));
  let downloads=0;
  const {files,runCommand}=require('../node/engine.cjs'),svc=service({base:async()=>root,within,files,runCommand,platform:'darwin',arch:'arm64',fetchFile:async()=>{downloads++;throw Error('must not download');}}),p={root,indexId:id,question:'fixture@v1'};
  process.env.PATH=root;
  const missing=e=>e.code==='PYTHON_UNAVAILABLE'&&/Python 3.*PATH/.test(e.message);
  await assert.rejects(svc.plan(p),missing);
  await assert.rejects(install(svc,p),missing);
  assert.equal(downloads,0);assert.deepEqual(await fs.readdir(path.join(root,'online')),['indices']);
 }finally{process.env.PATH=old;await fs.rm(root,{recursive:true,force:true});}
});
function fixture(bytes=8*GiB,expandedBytes=32*GiB){
 const sha='a'.repeat(64),name=sha+'.zip';
 return {format:'eval-lab-online-v1',platform:'darwin-arm64',artifacts:{[name]:{url:url.replace('index.json',name),sha256:sha,bytes,expandedBytes}},questions:[{key:'fixture@v1',path:'question',files:{},layers:[{artifact:name,mount:''}]}]};
}
test('question budgets accept exact boundaries and reject one byte over',()=>{
 assert.ok(validate(fixture(),url));
 for(const [bytes,expanded] of [[8*GiB+1,32*GiB],[8*GiB,32*GiB+1]])assert.throws(()=>validate(fixture(bytes,expanded),url));
 const index=fixture(4*GiB,16*GiB),sha='b'.repeat(64),name=sha+'.zip';
 index.artifacts[name]={url:url.replace('index.json',name),sha256:sha,bytes:4*GiB,expandedBytes:16*GiB};
 index.questions[0].layers.push({artifact:name,mount:'runtime'});
 assert.ok(validate(index,url));
 index.artifacts[name].bytes++;assert.throws(()=>validate(index,url));index.artifacts[name].bytes--;
 index.artifacts[name].expandedBytes++;assert.throws(()=>validate(index,url));
});
test('artifact references must name a validated own entry, including cached indices',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eval-index-shape-')),id='c'.repeat(64);
 try{
  const dir=path.join(root,'online/indices',id);await fs.mkdir(dir,{recursive:true});
  for(const artifact of ['toString','constructor','__proto__','missing',null,[]]){
   const index=fixture();index.questions[0].layers[0].artifact=artifact;
   assert.throws(()=>validate(index,url),/索引损坏/);
   const text=JSON.stringify(index);await fs.writeFile(path.join(dir,'index.json'),JSON.stringify({url,index}));
   const svc=service({base:async()=>root,within,platform:'darwin',arch:'arm64',fetchFile:async(u,d)=>{await fs.writeFile(d,text);return {sha256:id};}});
   await assert.rejects(svc.inspect({root,url}),/索引损坏/);
   await assert.rejects(svc.plan({root,indexId:id,question:'fixture@v1'}),/索引损坏/);
   await assert.rejects(install(svc,{root,indexId:id,question:'fixture@v1'}));
   assert.deepEqual(await svc.cached({root,url}),{questions:[]});
  }
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('downloads deduplicate archives; repeated mounts still count their expansion; budgets are per question',()=>{
 const index=fixture(8*GiB,16*GiB),q=index.questions[0];
 q.layers.push({...q.layers[0],mount:'runtime'});
 assert.ok(validate(index,url));
 index.questions.push({...q,key:'second@v1',path:'second'});
 assert.ok(validate(index,url));
 q.layers.push({...q.layers[0],mount:'another'});
 assert.throws(()=>validate(index,url));
});
test('cached oversized index cannot bypass planning or installation and triggers no extraction',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eval-budget-')),id='b'.repeat(64);let work=0;
 try{
  const index=fixture(8*GiB,16*GiB);index.questions[0].layers.push({artifact:'a'.repeat(64)+'.zip',mount:'x'},{artifact:'a'.repeat(64)+'.zip',mount:'y'});
  const dir=path.join(root,'online/indices',id);await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'index.json'),JSON.stringify({url,index}));
  const svc=service({base:async()=>root,within,platform:'darwin',arch:'arm64',files:async()=>{work++;return {};},runCommand:async()=>{work++;},fetchFile:async()=>{work++;}});
  const args={root,indexId:id,question:'fixture@v1'};
  await assert.rejects(svc.plan(args));await assert.rejects(install(svc,args));
  assert.deepEqual(await svc.cached({root,url}),{questions:[]});assert.equal(work,0);
  assert.deepEqual((await fs.readdir(path.join(root,'online'))).sort(),['indices']);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('oversized stored indices are isolated before whole-file reads at every entry',async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'eval-stored-index-'))),id='b'.repeat(64),healthy='c'.repeat(64),readFile=fs.readFile;
 try{
  const dir=path.join(root,'online/indices',id),good=path.join(root,'online/indices',healthy);await fs.mkdir(dir,{recursive:true});await fs.mkdir(good,{recursive:true});
  const target=path.join(dir,'index.json');await fs.writeFile(target,'');await fs.truncate(target,64*1024*1024);await fs.writeFile(path.join(good,'index.json'),JSON.stringify({url,index:fixture()}));
  fs.readFile=async function(file,...args){if(String(file)===target)throw Error('unbounded cached index read');return readFile.call(this,file,...args);};
  const svc=service({base:async()=>root,within,platform:'darwin',arch:'arm64',runCommand:async()=>{throw Error('must reject before Python');}}),p={root,indexId:id,question:'fixture@v1'};
  assert.equal((await svc.cached({root,url})).indexId,healthy);
  for(const action of ['plan','step']){
   const op=action==='step'?svc.begin(p):{};
   try{await assert.rejects(svc[action]({...p,...op}),{code:'PACKAGE_INVALID'});}finally{if(op.operationId)await svc.cancel({...p,...op});}
  }
  assert.deepEqual(await fs.readdir(path.join(root,'online')),['indices']);
 }finally{fs.readFile=readFile;await fs.rm(root,{recursive:true,force:true});}
});
test('inspection applies the stored wrapper budget before publishing its index',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eval-index-wrapper-')),id='d'.repeat(64);
 try{
  for(const size of [16*1024*1024,16*1024*1024+1]){
   const index=fixture();index.padding='';index.padding=' '.repeat(size-Buffer.byteLength(JSON.stringify({url,index})));const text=JSON.stringify(index);assert.equal(Buffer.byteLength(JSON.stringify({url,index})),size);
   const svc=service({base:async()=>root,within,platform:'darwin',arch:'arm64',runCommand:async()=>({code:0}),fetchFile:async(u,d)=>{await fs.writeFile(d,text);return {sha256:id};}});
   if(size>16*1024*1024){await assert.rejects(svc.inspect({root,url}),{code:'PACKAGE_INVALID'});assert.equal((await svc.cached({root,url})).indexId,id);}
   else{const found=await svc.inspect({root,url});assert.equal(found.indexId,id);assert.equal((await svc.cached({root,url})).indexId,id);assert.equal((await svc.plan({root,indexId:id,question:'fixture@v1'})).artifacts.length,1);}
   assert.deepEqual(await fs.readdir(path.join(root,'online/indices',id)),['index.json']);
  }
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
