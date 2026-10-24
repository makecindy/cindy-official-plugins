const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {dispatch,files,within}=require('../node/engine.cjs');
test('metadata parses the verified bytes and closes its handle on hash mismatch',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eval-metadata-hash-')),file=path.join(root,'question.json'),open=fs.open,read=require('../node/read-metadata.cjs'),crypto=require('node:crypto');
 const bytes=Buffer.from(JSON.stringify({title:'题目 😀'})),hash=crypto.createHash('sha256').update(bytes).digest('hex');let closed=0;
 try{
  await fs.writeFile(file,bytes);
  fs.open=async(...args)=>{const handle=await open(...args),close=handle.close.bind(handle);handle.close=async()=>{closed++;await close();await fs.writeFile(file,'{}');};return handle;};
  assert.deepEqual(await read(file,hash),{title:'题目 😀'});assert.equal(closed,1);
  await assert.rejects(read(file,hash),{code:'PACKAGE_INVALID'});assert.equal(closed,2);
  await assert.rejects(read(file,''),{code:'PACKAGE_INVALID'});assert.equal(closed,3);
 }finally{fs.open=open;await fs.rm(root,{recursive:true,force:true});}
});
for(const name of ['distribution.json','question.json'])test('oversized '+name+' is rejected before a whole-file read',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eval-bank-input-')),bank=path.join(root,'bank'),q=path.join(bank,'q'),readFile=fs.readFile;
 try{
  await fs.mkdir(q,{recursive:true});const target=path.join(name==='distribution.json'?bank:q,name),handle=await fs.open(target,'w');await handle.truncate(64*1024*1024);await handle.close();
  if(name==='question.json')await fs.writeFile(path.join(bank,'distribution.json'),JSON.stringify({format:'eval-lab-bank-v1',questions:[{key:'fixture@v1',path:'q',files:await files(q)}]}));
  fs.readFile=async function(file,...args){if(String(file)===target)throw Error('unbounded metadata read');return readFile.call(this,file,...args);};
  const action=name==='distribution.json'?'bank':'prepare';
  await assert.rejects(dispatch(action,{root,bank,question:'fixture@v1',model:'m',harness:'h',effort:'e',provider:'p'}),e=>e.code==='PACKAGE_INVALID'&&/16 MiB/.test(e.message));
 }finally{fs.readFile=readFile;await fs.rm(root,{recursive:true,force:true});}
});
test('relative paths use forward slashes on every platform',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eval-bank-path-'));
 try{
  await fs.symlink(os.tmpdir(),path.join(root,'link'),'junction');
  for(const rel of ['link\\question','normal\\question','C:\\question'])await assert.rejects(within(root,rel),/Unsafe path/);
  assert.equal(await within(root,'normal/question'),path.join(await fs.realpath(root),'normal/question'));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('metadata growth after stat stays bounded and closes the file handle',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eval-metadata-growth-')),file=path.join(root,'question.json'),open=fs.open,read=require('../node/read-metadata.cjs');let bytes=0,closed=false;
 try{
  const h=await open(file,'w');await h.truncate(64*1024*1024);await h.close();
  fs.open=async(...args)=>{const handle=await open(...args),originalRead=handle.read.bind(handle),close=handle.close.bind(handle);handle.stat=async()=>({size:0});handle.read=async(...a)=>{const r=await originalRead(...a);bytes+=r.bytesRead;return r;};handle.close=async()=>{closed=true;await close();};return handle;};
  await assert.rejects(read(file),{code:'PACKAGE_INVALID'});assert.equal(bytes,16*1024*1024+1);assert.equal(closed,true);
  fs.open=open;await fs.writeFile(file,JSON.stringify({title:'题目 😀'}));assert.deepEqual(await read(file),{title:'题目 😀'});
 }finally{fs.open=open;await fs.rm(root,{recursive:true,force:true});}
});
