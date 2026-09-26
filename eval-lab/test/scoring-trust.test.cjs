const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {dispatch,files}=require('../node/engine.cjs');
const {checkPlatform}=require('../node/question-platform.cjs');
test('only explicitly restricted questions require the default platform',()=>{
 assert.throws(()=>checkPlatform('macOS arm64 bundled Node','linux','x64'));
 checkPlatform('portable Python 3','linux','x64');checkPlatform(undefined,'win32','x64');checkPlatform('macOS arm64 bundled Node','darwin','arm64');
});
test('writable environment receipts and old review sidecars cannot replace independent grades',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eval-trust-'));
 try{
  const bank=path.join(root,'bank'),q=path.join(bank,'q');await fs.mkdir(path.join(q,'candidate/lab'),{recursive:true});await fs.mkdir(path.join(q,'author'));
  await fs.writeFile(path.join(q,'candidate/lab/preflight.cjs'),'supplied');await fs.writeFile(path.join(q,'candidate/TASK.md'),'Task');
  await fs.writeFile(path.join(q,'question.json'),JSON.stringify({id:'q',revision:'v1',title:'Q',scoringVersion:'v1',environment:'portable Python 3',groups:[{id:'g',weight:'1',mode:'all',items:['a']}]}));
  await fs.writeFile(path.join(q,'author/grade.py'),"import json,sys,pathlib\npathlib.Path(sys.argv[2]).write_text(json.dumps({'status':'graded','items':{'a':True}}))\n");
  await fs.writeFile(path.join(bank,'distribution.json'),JSON.stringify({format:'eval-lab-bank-v1',questions:[{key:'q@v1',path:'q',files:await files(q)}]}));
  const r=await dispatch('prepare',{root,bank,question:'q@v1',model:'fixture',provider:'fixture',harness:'fixture',effort:'default'});
  const receipts=path.join(r.workspace,'tests/environment-preflight');await fs.mkdir(receipts,{recursive:true});
  await fs.writeFile(path.join(receipts,'receipt-fake.json'),JSON.stringify({phase:'verified',root:r.workspace,cwd:r.workspace,verifiedAt:new Date().toISOString(),ok:false,browser:false,browserOutput:{stderr:'listen EPERM 127.0.0.1'}}));
  const result=await dispatch('grade',{root,runId:r.runId,receipt:{channel:'Orca Worker',sessionId:'fixture',completedAt:2000}});assert.equal(result.score,1);assert.equal(result.status,'graded');
  const dir=path.dirname(r.workspace);await fs.writeFile(path.join(dir,'assessment-review.json'),JSON.stringify({qualityVersion:1,status:'environment_invalid',score:null,scoreExact:null}));
  const rows=await dispatch('runs',{root});assert.equal(rows[0].score,1);assert.equal(rows[0].status,'graded');await fs.access(path.join(dir,'assessment-review-v1.json'));
  const again=await dispatch('reconcile_result',{root,runId:r.runId});assert.equal(again.score,1);
  const raw=JSON.parse(await fs.readFile(path.join(dir,'result.json')));raw.status='environment_invalid';raw.score=null;raw.scoreExact=null;await fs.writeFile(path.join(dir,'result.json'),JSON.stringify(raw));assert.equal((await dispatch('runs',{root}))[0].status,'environment_invalid');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
