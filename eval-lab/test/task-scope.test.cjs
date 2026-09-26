const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {taskScope}=require('../node/task-scope.cjs');
test('registered scope includes public restrictions and explicit environment probe, never hidden graders',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eval-scope-'));
 try{await fs.writeFile(path.join(root,'TASK.md'),'Only edit src/a.ts.');await fs.writeFile(path.join(root,'ENVIRONMENT.md'),'Run ./runtime/node lab/preflight.cjs; edit tests/environment-edit-probe.txt.');await fs.writeFile(path.join(root,'hidden.md'),'SECRET_GRADER');
 const scope=await taskScope(root,'Fix project');assert.match(scope,/Only edit src\/a.ts/);assert.match(scope,/environment-edit-probe/);assert.ok(!scope.includes('SECRET_GRADER'));
 await fs.writeFile(path.join(root,'TASK.md'),'x'.repeat(8001));await assert.rejects(taskScope(root,'Fix project'),/不会截断/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
