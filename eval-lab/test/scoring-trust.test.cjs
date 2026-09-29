const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {dispatch,files}=require('../node/engine.cjs');
const {checkPlatform}=require('../node/question-platform.cjs');
test('grading rejects a replacement scoring spec after package verification',async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'eval-spec-version-'))),open=fs.open;
 try{
  const bank=path.join(root,'bank'),q=path.join(bank,'q'),file=path.join(q,'question.json');
  await fs.mkdir(path.join(q,'candidate'),{recursive:true});await fs.mkdir(path.join(q,'author'));
  await fs.writeFile(path.join(q,'candidate/TASK.md'),'Saved answer');
  const spec={id:'q',revision:'v1',title:'Q',scoringVersion:'v1',groups:[{id:'g',weight:'1',mode:'all',items:['a']}]},original=JSON.stringify(spec);
  await fs.writeFile(file,original);
  await fs.writeFile(path.join(q,'author/grade.py'),"import json,sys,pathlib\npathlib.Path(sys.argv[2]).write_text(json.dumps({'status':'graded','items':{'a':False}}))\n");
  await fs.writeFile(path.join(bank,'distribution.json'),JSON.stringify({format:'eval-lab-bank-v1',questions:[{key:'q@v1',path:'q',files:await files(q)}]}));
  const r=await dispatch('prepare',{root,bank,question:'q@v1',model:'fixture',provider:'fixture',harness:'fixture',effort:'default'}),before=await files(r.workspace),p={root,runId:r.runId,receipt:{channel:'Orca Worker',sessionId:'fixture',completedAt:2000}};
  fs.open=async function(target,...args){if(String(target)===file){spec.groups[0].items=['b'];await fs.writeFile(file,JSON.stringify(spec));}return open.call(this,target,...args);};
  await assert.rejects(dispatch('grade',p),/Question package changed/);
  await assert.rejects(fs.access(path.join(path.dirname(r.workspace),'grader-execution.json')),{code:'ENOENT'});
  assert.deepEqual(await files(r.workspace),before);
  fs.open=open;await fs.writeFile(file,original);assert.equal((await dispatch('grade',p)).score,0);
 }finally{fs.open=open;await fs.rm(root,{recursive:true,force:true});}
});
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
  const beforeList=await files(dir);await fs.rename(bank,bank+'-offline');
  const rows=await dispatch('runs',{root});assert.equal(rows[0].score,1);assert.equal(rows[0].status,'graded');await assert.rejects(fs.access(path.join(dir,'assessment-review-v1.json')),{code:'ENOENT'});
  assert.deepEqual(await files(dir),beforeList);await fs.rename(bank+'-offline',bank);
  const sidecar=path.join(dir,'assessment-review.json'),originalReview=await fs.readFile(sidecar),saved=await fs.readFile(path.join(dir,'result.json')),expectedExport=(await dispatch('export',{root,runIds:[r.runId],locale:'en'})).html;
  for(const content of ['{','null','[]',JSON.stringify({padding:'x'.repeat(16*1024*1024)})]){
   await fs.writeFile(sidecar,content);const rows=await dispatch('runs',{root});assert.equal(rows[0].score,1);assert.equal(rows[0].status,'graded');
   assert.equal((await dispatch('export',{root,runIds:[r.runId],locale:'en'})).html,expectedExport);
   assert.equal((await dispatch('grade',{root,runId:r.runId,receipt:{channel:'Orca Worker',sessionId:'fixture',completedAt:2000}})).score,1);
   assert.deepEqual(await fs.readFile(path.join(dir,'result.json')),saved);assert.equal(await fs.readFile(sidecar,'utf8'),content);
  }
  await fs.writeFile(sidecar,'{');await assert.rejects(dispatch('reconcile_result',{root,runId:r.runId}),/评分诊断损坏/);assert.equal(await fs.readFile(sidecar,'utf8'),'{');
  await fs.writeFile(sidecar,originalReview);
  const again=await dispatch('reconcile_result',{root,runId:r.runId,receipt:{usage:{costUSD:0.25},acceptedAt:1000,startedAt:2000,completedAt:5000}});assert.equal(again.score,1);assert.equal(again.costUSD,0.25);assert.equal(again.durationSeconds,3);assert.equal((await dispatch('runs',{root}))[0].costUSD,0.25);await fs.access(path.join(dir,'assessment-review-v1.json'));
  await fs.writeFile(path.join(dir,'result.json'),'{');assert.match((await dispatch('runs',{root}))[0].recordError,/记录损坏/);await assert.rejects(dispatch('export',{root,runIds:[r.runId]}),SyntaxError);await fs.writeFile(path.join(dir,'result.json'),saved);
  const raw=JSON.parse(await fs.readFile(path.join(dir,'result.json')));raw.status='environment_invalid';raw.score=null;raw.scoreExact=null;await fs.writeFile(path.join(dir,'result.json'),JSON.stringify(raw));assert.equal((await dispatch('runs',{root}))[0].status,'environment_invalid');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('grading refuses an entrypoint changed after verification and preserves the saved answer',async()=>{
 const cp=require('node:child_process'),sync=require('node:fs'),spawn=cp.spawn;
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eval-grader-version-'));
 try{
  const bank=path.join(root,'bank'),q=path.join(bank,'q'),grader=path.join(q,'author/grade.py');
  await fs.mkdir(path.join(q,'candidate'),{recursive:true});await fs.mkdir(path.join(q,'author'));
  await fs.writeFile(path.join(q,'candidate/TASK.md'),'Saved answer');
  await fs.writeFile(path.join(q,'question.json'),JSON.stringify({id:'q',revision:'v1',title:'Q',scoringVersion:'v1',groups:[{id:'g',weight:'1',mode:'all',items:['a']}]}));
  const original="import json,sys,pathlib\npathlib.Path(sys.argv[2]).write_text(json.dumps({'status':'graded','items':{'a':False}}))\n";
  await fs.writeFile(grader,original);
  await fs.writeFile(path.join(bank,'distribution.json'),JSON.stringify({format:'eval-lab-bank-v1',questions:[{key:'q@v1',path:'q',files:await files(q)}]}));
  const r=await dispatch('prepare',{root,bank,question:'q@v1',model:'fixture',provider:'fixture',harness:'fixture',effort:'default'});
  const before=await files(r.workspace),receipt={channel:'Orca Worker',sessionId:'fixture',completedAt:2000};let starts=0;
  cp.spawn=function(command,args,options){if(args[1]?.endsWith('grade-run.py')){starts++;sync.writeFileSync(grader,original.replace('False','True'));}return spawn.call(this,command,args,options);};
  await assert.rejects(dispatch('grade',{root,runId:r.runId,receipt}),/Grader changed/);
  await assert.rejects(fs.access(path.join(path.dirname(r.workspace),'result.json')),{code:'ENOENT'});
  assert.deepEqual(await files(r.workspace),before);assert.equal(starts,1);
  cp.spawn=spawn;await fs.writeFile(grader,original);
  assert.equal((await dispatch('grade',{root,runId:r.runId,receipt})).score,0);
 }finally{cp.spawn=spawn;await fs.rm(root,{recursive:true,force:true});}
});


test('grading executes the verified bytes after a later replacement with normal Python entrypoint context',async()=>{
 const cp=require('node:child_process'),spawn=cp.spawn;
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eval-grader-loaded-'));
 try{
  const bank=path.join(root,'bank'),q=path.join(bank,'q'),grader=path.join(q,'author/grade.py');
  await fs.mkdir(path.join(q,'candidate'),{recursive:true});await fs.mkdir(path.join(q,'author'));
  await fs.writeFile(path.join(q,'candidate/TASK.md'),'Saved answer');
  await fs.writeFile(path.join(q,'question.json'),JSON.stringify({id:'q',revision:'v1',title:'Q',scoringVersion:'v1',groups:[{id:'g',weight:'1',mode:'all',items:['a']}]}));
  await fs.writeFile(path.join(q,'author/helper.py'),'value = 42\n');
  await fs.writeFile(path.join(q,'author/data.txt'),'local resource');
  await fs.writeFile(grader,"import json,sys,pathlib,helper,__main__\nanswer = False\nassert __main__.answer is answer\nassert helper.value == 42\nassert pathlib.Path(__file__).with_name('data.txt').read_text() == 'local resource'\npathlib.Path(sys.argv[2]).write_text(json.dumps({'status':'graded','items':{'a':answer}}))\n");
  await fs.writeFile(path.join(bank,'distribution.json'),JSON.stringify({format:'eval-lab-bank-v1',questions:[{key:'q@v1',path:'q',files:await files(q)}]}));
  const r=await dispatch('prepare',{root,bank,question:'q@v1',model:'fixture',provider:'fixture',harness:'fixture',effort:'default'});
  cp.spawn=function(command,args,options){if(args[1]?.endsWith('grade-run.py'))args=[args[0],path.join(__dirname,'fixtures/grade-crash.py'),args[1],'entry-read',path.join(root,'marker'),...args.slice(2)];return spawn.call(this,command,args,options);};
  const result=await dispatch('grade',{root,runId:r.runId,receipt:{channel:'Orca Worker',sessionId:'fixture',completedAt:2000}});
  assert.equal(result.status,'graded');assert.equal(result.score,0);
  assert.match(await fs.readFile(grader,'utf8'),/answer = True/);
 }finally{cp.spawn=spawn;await fs.rm(root,{recursive:true,force:true});}
});

test('oversized valid grader JSON settles unscored and reuses the receipt',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eval-output-budget-'));
 try{
  const bank=path.join(root,'bank'),q=path.join(bank,'q');await fs.mkdir(path.join(q,'candidate'),{recursive:true});await fs.mkdir(path.join(q,'author'));
  await fs.writeFile(path.join(q,'candidate/TASK.md'),'Saved answer');
  await fs.writeFile(path.join(q,'question.json'),JSON.stringify({id:'q',revision:'v1',title:'Q',scoringVersion:'v1',groups:[{id:'g',weight:'1',mode:'all',items:['a']}]}));
  await fs.writeFile(path.join(q,'author/grade.py'),"import pathlib,sys\npathlib.Path(sys.argv[2]).write_text('{\"status\":\"graded\",\"items\":{\"a\":true}}'+' '*(17*1024*1024))\n");
  await fs.writeFile(path.join(bank,'distribution.json'),JSON.stringify({format:'eval-lab-bank-v1',questions:[{key:'q@v1',path:'q',files:await files(q)}]}));
  const r=await dispatch('prepare',{root,bank,question:'q@v1',model:'fixture',provider:'fixture',harness:'fixture',effort:'default'}),before=await files(r.workspace),p={root,runId:r.runId,receipt:{channel:'Orca Worker',sessionId:'fixture',completedAt:2000}};
  const result=await dispatch('grade',p);assert.equal(result.status,'environment_invalid');assert.equal(result.score,null);assert.match(JSON.parse(await fs.readFile(path.join(path.dirname(r.workspace),'result.json'))).reason,/16 MiB/);
  assert.equal((await dispatch('grade',p)).status,'environment_invalid');assert.deepEqual(await files(r.workspace),before);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
