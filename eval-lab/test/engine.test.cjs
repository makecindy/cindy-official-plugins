const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');const {dispatch}=require('../node/engine.cjs');
test('unavailable imported banks do not hide valid banks or existing results',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eval-missing-import-'));
 try{
  const good=path.join(root,'good');await fs.mkdir(good);
  await fs.writeFile(path.join(good,'distribution.json'),JSON.stringify({format:'eval-lab-bank-v1',questions:[{key:'fixture@v1',title:'Fixture'}]}));
  const catalog=await dispatch('bank',{root,importedBanks:[{id:'offline',path:path.join(root,'missing')},{id:'good',path:good}]});
  assert.equal(catalog.questions[0].key,'imported:good:fixture@v1');assert.equal(catalog.errors[0].id,'offline');
  assert.ok(!JSON.stringify(catalog.errors).includes(root));assert.deepEqual(await dispatch('runs',{root}),[]);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('real default question: prepare isolated workspace, grade frozen baseline, export selected result',async()=>{const bank=process.env.EVAL_TEST_BANK;if(!bank)return;const root=await fs.mkdtemp(path.join(os.tmpdir(),'eval-engine-'));try{const p={root,bank};const catalog=await dispatch('bank',p);assert.equal(catalog.questions.length,7);const importedBanks=[{id:'first-bank',path:bank},{id:'second-bank',path:bank}];const imported=await dispatch('bank',{root,importedBanks});assert.equal(imported.questions.length,14);assert.ok(imported.questions.some(q=>q.key==='imported:second-bank:task-switch-cache@v3'));const r=await dispatch('prepare',{root,importedBanks,question:'imported:first-bank:task-switch-cache@v3',model:'test-fixture-not-a-model-run',harness:'test',provider:'test',effort:'test'});await assert.rejects(fs.access(path.join(r.workspace,'author')));const grade=await dispatch('grade',{...p,runId:r.runId,receipt:{channel:'Orca Worker',sessionId:'mock-receipt-for-engine-test',completedAt:new Date().toISOString()}});assert.equal(grade.status,'graded');assert.equal(grade.score,0);const rows=await dispatch('runs',p);assert.equal(rows.length,1);const exported=await dispatch('export',{...p,runIds:[r.runId]});assert.ok(exported.html.includes('0 / 1'));assert.ok(!exported.html.includes(root));const again=await dispatch('grade',{...p,runId:r.runId,receipt:{channel:'Orca Worker',sessionId:'mock',completedAt:new Date().toISOString()}});assert.equal(again.score,0);assert.equal(again.bank,undefined);assert.equal(again.receipt,undefined);}finally{await fs.rm(root,{recursive:true});}});
test('host-owned empty workspace is populated once, real task receipt grades the same files',async()=>{
 const bank=process.env.EVAL_TEST_BANK;if(!bank)return;
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eval-host-workspace-'));
 try{
  const workspace=path.join(root,'host-task');await fs.mkdir(workspace);
  const p={root,bank,runId:'host-owned-run',workspace,question:'task-switch-cache@v3',model:'fixture-model',harness:'codex',provider:'fixture-provider',effort:'high',executionChannel:'Cindy task'};
  const r=await dispatch('prepare',p);assert.equal(r.workspace,await fs.realpath(workspace));assert.equal((await dispatch('prepare',p)).runId,r.runId);
  await assert.rejects(dispatch('prepare',{...p,runId:'different-run'}),/不是空目录/);
  const receipt={channel:'Cindy task',sessionId:'fixture-task',runId:'fixture-host-run',acceptedAt:1000,startedAt:1000,timingBasis:'host-message-window',completedAt:new Date(2000).toISOString(),execution:{instanceId:'fixture',generation:1},acceptedConfig:{agentKind:'codex',model:p.model,providerId:p.provider,effort:p.effort,fastMode:false}};
  const grade=await dispatch('grade',{root,runId:r.runId,receipt});assert.equal(grade.status,'graded');assert.equal(grade.score,0);assert.equal(grade.durationSeconds,1);assert.equal(grade.executionChannel,'Cindy task');
 }finally{await fs.rm(root,{recursive:true});}
});
test('coordinator parallel capacity and explicit concurrency are frozen in plan',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eval-parallel-'));
 try{
  const a=await dispatch('coordinator_plan',{root,id:'parallel-auto',items:[]});
  assert.match(a.prompt,/填满宿主实际可用/);assert.match(a.prompt,/create_workers/);
  assert.equal(JSON.parse(await fs.readFile(a.path)).concurrency,null);
  const b=await dispatch('coordinator_plan',{root,id:'parallel-two',items:[],concurrency:2});
  assert.match(b.prompt,/同时最多 2 份/);
  assert.equal(JSON.parse(await fs.readFile(b.path)).concurrency,2);
  await assert.rejects(dispatch('coordinator_plan',{root,id:'invalid',items:[],concurrency:0}),/正整数/);
 }finally{await fs.rm(root,{recursive:true});}
});
