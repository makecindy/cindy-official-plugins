const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {taskScope}=require('../node/task-scope.cjs');
test('registered scope includes public restrictions and explicit environment probe, never hidden graders',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eval-scope-'));
 try{await fs.writeFile(path.join(root,'TASK.md'),'Only edit src/a.ts.');await fs.writeFile(path.join(root,'ENVIRONMENT.md'),'Run ./runtime/node lab/preflight.cjs; edit tests/environment-edit-probe.txt.');await fs.writeFile(path.join(root,'hidden.md'),'SECRET_GRADER');
 const scope=await taskScope(root,'Fix project');assert.match(scope,/Only edit src\/a.ts/);assert.match(scope,/environment-edit-probe/);assert.ok(!scope.includes('SECRET_GRADER'));
 await fs.writeFile(path.join(root,'TASK.md'),'x'.repeat(8001));await assert.rejects(taskScope(root,'Fix project'),/不会截断/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('scope reads bounded bytes from oversized public files and preserves UTF-8 text',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eval-scope-limit-')),readFile=fs.readFile;
 try{
 for(const name of ['TASK.md','ENVIRONMENT.md']){
  const file=path.join(root,name),handle=await fs.open(file,'w');await handle.truncate(64*1024*1024);await handle.close();
  fs.readFile=async function(target,...args){if(String(target)===file)throw Error('unbounded scope read');return readFile.call(this,target,...args);};
  await assert.rejects(taskScope(root,'Fix project'),/不会截断/);fs.readFile=readFile;await fs.unlink(file);
 }
 const text='汉😀'.repeat(1000);await fs.writeFile(path.join(root,'TASK.md'),text);assert.ok((await taskScope(root,'Fix project')).includes(text));
 }finally{fs.readFile=readFile;await fs.rm(root,{recursive:true,force:true});}
});

test('public scope hashes the same bounded bytes before decoding, including absent manifest files',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eval-scope-binding-')),crypto=require('node:crypto');
 try{
  const text='原始范围 😀',hash=crypto.createHash('sha256').update(text).digest('hex'),expected={'candidate/TASK.md':hash};
  await fs.writeFile(path.join(root,'TASK.md'),text);await fs.writeFile(path.join(root,'ENVIRONMENT.md'),'unregistered instructions');
  assert.ok(!(await taskScope(root,'Fix',expected)).includes('unregistered'));
  await fs.writeFile(path.join(root,'TASK.md'),'replacement');await assert.rejects(taskScope(root,'Fix',expected),/Question package changed/);
  await fs.writeFile(path.join(root,'TASK.md'),text);assert.ok((await taskScope(root,'Fix',expected)).includes(text));
  await fs.unlink(path.join(root,'TASK.md'));await assert.rejects(taskScope(root,'Fix',expected),{code:'ENOENT'});
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
