const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const {dispatch,files}=require('../node/engine.cjs');
async function fixture(fn){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eval-crash-')),bank=path.join(root,'bank'),q=path.join(bank,'q');
 try{
  await fs.mkdir(path.join(q,'candidate'),{recursive:true});await fs.mkdir(path.join(q,'author'));
  await fs.writeFile(path.join(q,'candidate/answer'),'paid answer');
  await fs.writeFile(path.join(q,'question.json'),JSON.stringify({id:'q',revision:'v1',title:'Fixture',scoringVersion:'v1',groups:[{id:'g',weight:'1',mode:'all',items:['a']}]}));
  await fs.writeFile(path.join(q,'author/grade.py'),"import json,sys,pathlib\npathlib.Path(sys.argv[1],'generated-test-cache').write_text('test artifact'); p=pathlib.Path(sys.argv[2]); counter=(p.parent.parent if p.parent.name.startswith('grading-') else p.parent)/'executions'; counter.write_text(counter.read_text()+'x' if counter.exists() else 'x'); p.write_text(json.dumps({'status':'graded','items':{'a':True}}))\n");
  await fs.writeFile(path.join(bank,'distribution.json'),JSON.stringify({format:'eval-lab-bank-v1',questions:[{key:'q@v1',path:'q',files:await files(q)}]}));
  await fn({root,bank,question:'q@v1',runId:'same-run',model:'m',provider:'p',harness:'h',effort:'e'});
 }finally{await fs.rm(root,{recursive:true,force:true});}
}
async function killAtPublication(method,p,filename){
 const child=cp.fork(path.join(__dirname,'fixtures/crash-child.cjs'),[],{stdio:['ignore','ignore','pipe','ipc']});
 child.send({method,p,filename});
 const closed=new Promise(resolve=>child.once('close',resolve));let timer;
 try{await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('Crash point was not reached')),10000);child.once('error',reject);child.once('message',m=>m==='paused'?resolve():reject(Error(JSON.stringify(m))));child.once('exit',()=>reject(Error('Child exited early')));});}
 finally{clearTimeout(timer);child.kill('SIGKILL');await closed;}
}
test('a killed preparation recovers exact copies, while modified paid content is preserved',()=>fixture(async p=>{
 await killAtPublication('prepare',p,'run.json');
 const workspace=path.join(p.root,'eval-lab-data/runs/same-run/workspace'),answer=path.join(workspace,'answer');
 assert.equal(await fs.readFile(answer,'utf8'),'paid answer');
 await fs.writeFile(answer,'user changed answer');await assert.rejects(dispatch('prepare',p),/保留现场/);assert.equal(await fs.readFile(answer,'utf8'),'user changed answer');
 await fs.writeFile(answer,'paid answer');const recovered=await dispatch('prepare',p);assert.equal(recovered.workspace,await fs.realpath(workspace));
 assert.equal((await dispatch('runs',p)).length,1);
}));
test('a killed result publication recovers from process evidence without running the grader again',()=>fixture(async p=>{
 const run=await dispatch('prepare',p),dir=path.join(p.root,'eval-lab-data/runs/same-run');
 const request={root:p.root,runId:run.runId,receipt:{channel:'Orca Worker',sessionId:'fixture',completedAt:new Date().toISOString()}};
 await killAtPublication('grade',request,'grading-completion.json');
 assert.equal(await fs.readFile(path.join(dir,'executions'),'utf8'),'x');
 const oldPath=process.env.PATH;process.env.PATH=p.root;
 try{assert.equal((await dispatch('grade',request)).score,1);assert.equal((await dispatch('grade',request)).score,1);}finally{process.env.PATH=oldPath;}
 assert.equal(await fs.readFile(path.join(dir,'executions'),'utf8'),'x');
 assert.equal(await fs.readFile(path.join(run.workspace,'answer'),'utf8'),'paid answer');
}));
test('pre-release attempt markers do not block local regrading or change paid answers',()=>fixture(async p=>{
 const run=await dispatch('prepare',p),dir=path.join(p.root,'eval-lab-data/runs/same-run');await fs.writeFile(path.join(dir,'grading.lock'),'');
 await fs.mkdir(path.join(dir,'submission'));await fs.writeFile(path.join(dir,'submission/answer'),'incomplete old snapshot');
 await fs.writeFile(path.join(dir,'grading-context.json'),'{}');
 const request={root:p.root,runId:run.runId,receipt:{channel:'Orca Worker',sessionId:'fixture',completedAt:new Date().toISOString()}};
 assert.equal((await dispatch('grade',request)).score,1);
 assert.equal(await fs.readFile(path.join(dir,'grading.lock'),'utf8'),'');
 assert.equal(await fs.readFile(path.join(dir,'submission/answer'),'utf8'),'incomplete old snapshot');
 assert.equal(await fs.readFile(path.join(run.workspace,'answer'),'utf8'),'paid answer');
}));
function injectGrading(phase,marker){
 const spawn=cp.spawn;let child;
 cp.spawn=function(command,args,options){
  if(args[1]?.endsWith('/grade-run.py')){args=[args[0],path.join(__dirname,'fixtures/grade-crash.py'),args[1],phase,marker,...args.slice(2)];child=spawn.call(this,command,args,options);return child;}
  return spawn.call(this,command,args,options);
 };
 return {restore:()=>{cp.spawn=spawn;},child:()=>child};
}
async function waitFile(file){
 const deadline=Date.now()+10000;
 while(Date.now()<deadline){try{return await fs.readFile(file,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}await new Promise(r=>setTimeout(r,20));}
 throw Error('Grading pause not reached');
}
test('a grader surviving its Node parent keeps ownership and publishes a reusable result',()=>fixture(async p=>{
 const run=await dispatch('prepare',p),dir=path.join(p.root,'eval-lab-data/runs/same-run'),marker=path.join(p.root,'pause');
 const request={root:p.root,runId:run.runId,receipt:{channel:'Orca Worker',sessionId:'fixture',completedAt:new Date().toISOString()}};
 const child=cp.fork(path.join(__dirname,'fixtures/crash-child.cjs'),[],{stdio:['ignore','ignore','ignore','ipc']});
 const closed=new Promise(resolve=>child.once('close',resolve));let graderPid;
 try{
  child.send({method:'grade',p:request,gradingPause:marker});graderPid=Number(await waitFile(marker));
  child.kill('SIGKILL');await closed;
  await assert.rejects(dispatch('grade',request),/不会重复评分/);
  await fs.writeFile(marker+'.continue','');await waitFile(path.join(dir,'grader-execution.json'));
  assert.equal((await dispatch('grade',request)).score,1);
  assert.equal(await fs.readFile(path.join(dir,'executions'),'utf8'),'x');
  assert.equal(await fs.readFile(path.join(run.workspace,'answer'),'utf8'),'paid answer');
 }finally{child.kill('SIGKILL');await closed;if(graderPid)try{process.kill(graderPid,'SIGKILL');}catch{}}
}));
for(const phase of ['copy','receipt'])test('killed grading '+phase+' releases its lock and retries only local scoring',()=>fixture(async p=>{
 const run=await dispatch('prepare',p),dir=path.join(p.root,'eval-lab-data/runs/same-run'),marker=path.join(p.root,'pause');
 const request={root:p.root,runId:run.runId,receipt:{channel:'Orca Worker',sessionId:'fixture',completedAt:new Date().toISOString()}};
 const injected=injectGrading(phase,marker),first=dispatch('grade',request);const rejected=assert.rejects(first,/本地评分中断/);
 try{
  await waitFile(marker);injected.restore();
  await assert.rejects(dispatch('grade',request),/不会重复评分/);
  injected.child().kill('SIGKILL');await rejected;
 }finally{injected.restore();injected.child()?.kill('SIGKILL');}
 assert.equal((await dispatch('grade',request)).score,1);
 assert.equal(await fs.readFile(path.join(dir,'executions'),'utf8'),phase==='copy'?'x':'xx');
 assert.equal((await dispatch('grade',request)).score,1);
 assert.equal(await fs.readFile(path.join(dir,'executions'),'utf8'),phase==='copy'?'x':'xx');
 assert.equal(await fs.readFile(path.join(run.workspace,'answer'),'utf8'),'paid answer');
}));
test('grading copy failures retain paid files and recover after storage becomes available',async()=>{
 for(const code of ['ENOSPC','EDQUOT','EACCES','EPERM','EROFS','EIO','ENOENT'])await fixture(async p=>{
  const run=await dispatch('prepare',p),request={root:p.root,runId:run.runId,receipt:{channel:'Orca Worker',sessionId:'fixture',completedAt:new Date().toISOString()}};
  const injected=injectGrading('error-'+code,path.join(p.root,'unused'));
  try{await assert.rejects(dispatch('grade',request),e=>e.code===code&&!e.message.includes(p.root)&&/评分快照复制失败/.test(e.message));}finally{injected.restore();}
  assert.equal(await fs.readFile(path.join(run.workspace,'answer'),'utf8'),'paid answer');assert.equal((await dispatch('grade',request)).score,1);
 });
});

test('symlink refusal tells the user what to fix without exposing paths',()=>fixture(async p=>{
 const run=await dispatch('prepare',p);await fs.symlink(path.join(run.workspace,'answer'),path.join(run.workspace,'private-link'));
 const request={root:p.root,runId:run.runId,receipt:{channel:'Orca Worker',sessionId:'fixture',completedAt:new Date().toISOString()}};
 await assert.rejects(dispatch('grade',request),e=>/符号链接/.test(e.message)&&!e.message.includes(p.root)&&!e.message.includes('private-link'));
 assert.equal(await fs.readFile(path.join(run.workspace,'answer'),'utf8'),'paid answer');
}));
test('malformed optional diagnostic directory does not block independent score publication',()=>fixture(async p=>{
 const run=await dispatch('prepare',p);await fs.mkdir(path.join(run.workspace,'tests'));await fs.writeFile(path.join(run.workspace,'tests/environment-preflight'),'candidate file');
 const request={root:p.root,runId:run.runId,receipt:{channel:'Orca Worker',sessionId:'fixture',completedAt:new Date().toISOString()}};
 const result=await dispatch('grade',request);assert.equal(result.score,1);assert.equal(JSON.parse(await fs.readFile(path.join(p.root,'eval-lab-data/runs/same-run/result.json'),'utf8')).environmentDiagnostic,null);assert.equal((await dispatch('grade',request)).score,1);
 assert.equal(await fs.readFile(path.join(p.root,'eval-lab-data/runs/same-run/executions'),'utf8'),'x');
}));

test('candidate preparation storage failures hide paths and preserve recoverable preparation',async()=>{
 for(const code of ['ENOSPC','EDQUOT','EACCES','EPERM','EROFS','EIO','ENOENT','UNKNOWN'])await fixture(async p=>{
  const copy=fs.cp;fs.cp=async()=>{throw Object.assign(Error('copyfile '+p.root+'/private-bank -> '+p.root+'/private-run'),{code});};
  try{await assert.rejects(dispatch('prepare',p),e=>e.code===code&&!e.message.includes(p.root)&&/作答准备/.test(e.message));}finally{fs.cp=copy;}
  const run=await dispatch('prepare',p);assert.equal(await fs.readFile(path.join(run.workspace,'answer'),'utf8'),'paid answer');
 });
});

test('preparation rejects bank edits after verification before recording new content',()=>fixture(async p=>{
 const readdir=fs.readdir,candidate=await fs.realpath(path.join(p.bank,'q/candidate'));let reads=0;
 fs.readdir=async function(dir,...args){if(dir===candidate&&++reads===2)await fs.writeFile(path.join(candidate,'answer'),'edited after verification');return readdir.call(this,dir,...args);};
 try{await assert.rejects(dispatch('prepare',p),/Question package changed/);}finally{fs.readdir=readdir;}
 await assert.rejects(fs.access(path.join(p.root,'eval-lab-data/runs/same-run/run.json')));
}));
