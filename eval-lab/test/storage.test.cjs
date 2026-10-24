const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {validateStorage}=require('../node/storage.cjs');
test('storage probe cleans only its own files and hides unsupported volume paths',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eval-storage-test-')),link=fs.link;
 try{
  await fs.writeFile(path.join(root,'retained'),'private');
  assert.deepEqual(await validateStorage(root),{ok:true});
  for(const code of ['EPERM','EOPNOTSUPP','EIO']){
   fs.link=async()=>{throw Object.assign(Error(root+'/private'),{code});};
   await assert.rejects(validateStorage(root),e=>e.code===code&&!e.message.includes(root));
  }
  assert.deepEqual(await fs.readdir(root),['retained']);assert.equal(await fs.readFile(path.join(root,'retained'),'utf8'),'private');
 }finally{fs.link=link;await fs.rm(root,{recursive:true,force:true});}
});
