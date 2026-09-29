const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {dispatch}=require('../node/engine.cjs');
test('freeze requires Python only before new publication and retains calibrated material',()=>fixture(async(root)=>{
 const cal=await dispatch('calibrate',{root,id:'sample',revision:'v1'}),p={root,checkId:cal.checkId},old=process.env.PATH,mkdtemp=fs.mkdtemp;
 try{
  process.env.PATH=root;fs.mkdtemp=async()=>{throw Error('must preflight before staging');};
  await assert.rejects(dispatch('freeze',p),{code:'PYTHON_UNAVAILABLE'});
 }finally{process.env.PATH=old;fs.mkdtemp=mkdtemp;}
 const first=await dispatch('freeze',p);
 try{process.env.PATH=root;assert.deepEqual(await dispatch('freeze',p),first);}finally{process.env.PATH=old;}
}));
test('missing Python leaves calibration unexecuted and recoverable without a failed report',()=>fixture(async(root)=>{
 const {checkId}=await dispatch('calibrate_begin',{root,id:'sample',revision:'v1'}),p={root,checkId,step:0},old=process.env.PATH;
 try{
  process.env.PATH=root;
  await assert.rejects(dispatch('calibrate_step',p),e=>e.code==='PYTHON_UNAVAILABLE'&&/Python 3.*PATH/.test(e.message));
  await assert.rejects(fs.access(path.join(root,'eval-lab-data/calibrations',checkId,'attempt-0')),{code:'ENOENT'});
  await assert.rejects(fs.access(path.join(root,'eval-lab-data/calibrations',checkId,'step-0.json')),{code:'ENOENT'});
 }finally{process.env.PATH=old;}
 assert.equal((await dispatch('calibrate_step',p)).status,'graded');
}));
test('Python disappearing after the probe does not create a calibration failure report',()=>fixture(async(root)=>{
 const cp=require('node:child_process'),spawn=cp.spawn,{checkId}=await dispatch('calibrate_begin',{root,id:'sample',revision:'v1'}),p={root,checkId,step:0};
 cp.spawn=(command,args,options)=>spawn(args[0]==='-B'?path.join(root,'missing-python'):command,args,options);
 try{await assert.rejects(dispatch('calibrate_step',p),{code:'PYTHON_UNAVAILABLE'});}finally{cp.spawn=spawn;}
 await assert.rejects(fs.access(path.join(root,'eval-lab-data/calibrations',checkId,'attempt-0')),{code:'ENOENT'});
 assert.equal((await dispatch('calibrate_step',p)).status,'graded');
}));
test('calibration rejects a scoring spec replaced after plan hash verification',()=>fixture(async(root,directory)=>{
 const {checkId}=await dispatch('calibrate_begin',{root,id:'sample',revision:'v1'}),file=path.join(directory,'question.json'),original=await fs.readFile(file),open=fs.open;
 const p={root,checkId,step:0};
 try{
  fs.open=async function(target,...args){if(String(target)===file){const spec=JSON.parse(original);spec.groups[0].items=['b'];await fs.writeFile(file,JSON.stringify(spec));}return open.call(this,target,...args);};
  await assert.rejects(dispatch('calibrate_step',p),/Question package changed/);
  await assert.rejects(fs.access(path.join(root,'eval-lab-data/calibrations',checkId,'attempt-0')),{code:'ENOENT'});
  fs.open=open;await fs.writeFile(file,original);assert.equal((await dispatch('calibrate_step',p)).scoreExact,'0');
 }finally{fs.open=open;}
}));
test('explicit retry retains the failed report and has a stable identity after lost replies',()=>fixture(async(root)=>{
 const p={root,id:'sample',revision:'v1'},child=require('node:child_process'),spawn=child.spawn;
 child.spawn=(command,args,options)=>spawn(command,args[0]==='-B'?['-c','raise SystemExit(1)']:args,options);
 let failed;
 try{failed=await dispatch('calibrate',p);}finally{child.spawn=spawn;}
 const old=path.join(root,'eval-lab-data/calibrations',failed.checkId,'calibration.json'),bytes=await fs.readFile(old);
 const retry={...p,retryFrom:failed.checkId};
 const [a,b]=await Promise.all([dispatch('calibrate_begin',retry),dispatch('calibrate_begin',retry)]);
 assert.notEqual(a.checkId,failed.checkId);assert.deepEqual(a,b);
 assert.deepEqual(await dispatch('calibrate_begin',p),a);
 const result=await dispatch('calibrate',retry);assert.equal(result.ok,true);
 assert.deepEqual(await dispatch('calibrate',retry),result);
 assert.deepEqual(await fs.readFile(old),bytes);
 await assert.rejects(dispatch('calibrate_begin',{...p,retryFrom:a.checkId}),/retry|重试/);
}));
test('retry captures a corrected draft while keeping the failed snapshot and refusing unknown execution',()=>fixture(async(root,directory)=>{
 const p={root,id:'sample',revision:'v1'},grade=path.join(directory,'author/grade.py'),original=await fs.readFile(grade);
 await fs.writeFile(grade,"import json,sys,pathlib\npathlib.Path(sys.argv[2]).write_text(json.dumps({'status':'graded','items':{'a':True}}))\n");
 const failed=await dispatch('calibrate',p),old=path.join(root,'eval-lab-data/calibrations',failed.checkId,'calibration.json'),bytes=await fs.readFile(old);
 await fs.writeFile(grade,original.toString().replace("'a':","'b':"));
 const specFile=path.join(directory,'question.json'),spec=JSON.parse(await fs.readFile(specFile));spec.title='Corrected';spec.groups[0].items=['b'];await fs.writeFile(specFile,JSON.stringify(spec));
 await assert.rejects(dispatch('calibrate_begin',p),/明确重试/);
 assert.equal((await fs.readdir(path.join(root,'eval-lab-data/calibrations'))).length,1);
 const retry={...p,retryFrom:failed.checkId},a=await dispatch('calibrate_begin',retry);
 assert.notEqual(a.checkId,failed.checkId);assert.deepEqual(await dispatch('calibrate_begin',retry),a);assert.deepEqual(await dispatch('calibrate_begin',p),a);
 assert.equal((await dispatch('calibrate',retry)).ok,true);assert.deepEqual(await fs.readFile(old),bytes);
 await fs.appendFile(grade,'\n# later edit');assert.deepEqual(await dispatch('calibrate_begin',retry),a);await assert.rejects(dispatch('calibrate',retry),/Draft changed/);
}));
test('explicit retry rejects unfinished or unknown calibration executions',()=>fixture(async(root)=>{
 const p={root,id:'sample',revision:'v1'},a=await dispatch('calibrate_begin',p);
 await fs.mkdir(path.join(root,'eval-lab-data/calibrations',a.checkId,'attempt-0'));
 await fs.appendFile(path.join(root,'eval-lab-data/drafts/sample/v1/author/grade.py'),'\n# changed while unknown');
 await assert.rejects(dispatch('calibrate_begin',{...p,retryFrom:a.checkId}),/retry|重试/);
 assert.equal((await fs.readdir(path.join(root,'eval-lab-data/calibrations'))).length,1);
}));
test('failed grader receipts remain readable without Python and finish without re-executing',()=>fixture(async(root)=>{
 const cp=require('node:child_process'),spawn=cp.spawn;
 const {checkId}=await dispatch('calibrate_begin',{root,id:'sample',revision:'v1'}),p={root,checkId};
 let starts=0;cp.spawn=(command,args,options)=>{if(args[0]==='-B'){starts++;return spawn(command,['-c','raise SystemExit(1)'],options);}return spawn(command,args,options);};
 try{for(let step=0;step<3;step++)assert.equal((await dispatch('calibrate_step',{...p,step})).status,'environment_invalid');}finally{cp.spawn=spawn;}
 const folder=path.join(root,'eval-lab-data/calibrations',checkId);
 const file=path.join(folder,'step-0.json'),value=JSON.parse(await fs.readFile(file,'utf8'));
 assert.equal(value.execution.timedOut,false);assert.equal(starts,3);
 const originalPath=process.env.PATH;process.env.PATH=root;
 try{
 await fs.rename(file,path.join(folder,'attempt-0/receipt.json'));
 assert.equal((await dispatch('calibrate_step',{...p,step:0})).status,'environment_invalid');
 assert.equal((await dispatch('calibrate_step',{...p,step:1})).status,'environment_invalid');
 assert.equal((await dispatch('calibrate_finish',p)).ok,false);
 assert.equal((await dispatch('calibrate_finish',p)).ok,false);
 value.status='graded';value.raw={status:'graded',items:{a:false}};value.score=0;value.scoreExact='0';
 await fs.writeFile(file,JSON.stringify(value));
 await assert.rejects(dispatch('calibrate_step',{...p,step:0}),/receipt mismatch/);
 }finally{process.env.PATH=originalPath;}
}));
test('completed unpublished calibration receipt recovers without executing the grader again',()=>fixture(async(root)=>{
 const {checkId}=await dispatch('calibrate_begin',{root,id:'sample',revision:'v1'}),p={root,checkId,step:0};
 const result=await dispatch('calibrate_step',p),folder=path.join(root,'eval-lab-data/calibrations',checkId);
 await fs.rename(path.join(folder,'step-0.json'),path.join(folder,'attempt-0/receipt.json'));
 await fs.unlink(path.join(folder,'attempt-0/source/answer'));
 assert.deepEqual(await Promise.all([dispatch('calibrate_step',p),dispatch('calibrate_step',p)]),[result,result]);
 assert.deepEqual(await dispatch('calibrate_step',p),result);
}));
test('malformed completed receipts are preserved but never published or replayed',()=>fixture(async(root)=>{
 const {checkId}=await dispatch('calibrate_begin',{root,id:'sample',revision:'v1'}),p={root,checkId,step:0};
 await dispatch('calibrate_step',p);const folder=path.join(root,'eval-lab-data/calibrations',checkId),published=path.join(folder,'step-0.json'),pending=path.join(folder,'attempt-0/receipt.json');
 const result=JSON.parse(await fs.readFile(published,'utf8'));result.score=1;await fs.writeFile(pending,JSON.stringify(result));await fs.unlink(published);
 await assert.rejects(dispatch('calibrate_step',p),/receipt mismatch/);await assert.rejects(fs.access(published));
 assert.equal(await fs.readFile(pending,'utf8'),JSON.stringify(result));
}));
async function fixture(fn){const root=await fs.mkdtemp(path.join(os.tmpdir(),'eval-calibration-'));try{
 const {directory}=await dispatch('draft',{root,id:'sample',revision:'v1',records:[{sessionId:'synthetic',text:'Fixture'}]});
 for(const name of ['candidate','reference','controls/incomplete','author'])await fs.mkdir(path.join(directory,name),{recursive:true});
 await fs.writeFile(path.join(directory,'question.json'),JSON.stringify({id:'sample',revision:'v1',title:'Fixture',scoringVersion:'v1',groups:[{id:'g',weight:'1',mode:'all',items:['a']}]}));
 for(const name of ['candidate','reference','controls/incomplete'])await fs.writeFile(path.join(directory,name,'answer'),name==='reference'?'yes':'no');
 await fs.writeFile(path.join(directory,'author/grade.py'),"import pathlib,json,sys\np=pathlib.Path(sys.argv[1]); (p/'executed').write_text('once')\npathlib.Path(sys.argv[2]).write_text(json.dumps({'status':'graded','items':{'a':(p/'answer').read_text()=='yes'}}))\n");
 await fn(root,directory);
}finally{await fs.rm(root,{recursive:true,force:true});}}
test('calibration stages persist receipts and cannot finish before all controls',()=>fixture(async(root)=>{
 const {checkId}=await dispatch('calibrate_begin',{root,id:'sample',revision:'v1'}),p={root,checkId};
 const one=await dispatch('calibrate_step',{...p,step:0});assert.equal(one.scoreExact,'0');assert.equal(one.execution,undefined);
 assert.equal((await dispatch('calibrate_begin',{root,id:'sample',revision:'v1'})).checkId,checkId);
 const check=path.join(root,'eval-lab-data/calibrations',checkId);
 await fs.unlink(path.join(check,'attempt-0/source/answer'));
 assert.deepEqual(await dispatch('calibrate_step',{...p,step:0}),one);
 await assert.rejects(dispatch('calibrate_finish',p),{code:'ENOENT'});
 await dispatch('calibrate_step',{...p,step:1});await dispatch('calibrate_step',{...p,step:2});
 const result=await dispatch('calibrate_finish',p);assert.equal(result.ok,true);assert.equal(result.results.length,3);
 const original=await fs.readFile(path.join(check,'calibration.json'),'utf8');
 assert.deepEqual(await dispatch('calibrate_finish',p),result);assert.equal(await fs.readFile(path.join(check,'calibration.json'),'utf8'),original);
}));
test('unknown attempts are not replayed and changed drafts cannot finish',()=>fixture(async(root,directory)=>{
 const {checkId}=await dispatch('calibrate_begin',{root,id:'sample',revision:'v1'}),p={root,checkId};
 const check=path.join(root,'eval-lab-data/calibrations',checkId);await fs.mkdir(path.join(check,'attempt-0'));
 assert.equal((await dispatch('calibrate_begin',{root,id:'sample',revision:'v1'})).checkId,checkId);
 await assert.rejects(dispatch('calibrate_step',{...p,step:0}),{code:'EEXIST'});
 await fs.appendFile(path.join(directory,'reference/answer'),'changed');
 await assert.rejects(dispatch('calibrate_step',{...p,step:1}),/Draft changed/);
 await assert.rejects(dispatch('calibrate_finish',p),/Draft changed/);
}));
test('pre-release random IDs remain untouched and do not gate current calibration',()=>fixture(async(root)=>{
 const p={root,id:'sample',revision:'v1'},current=await dispatch('calibrate_begin',p);
 const parent=path.join(root,'eval-lab-data/calibrations'),legacy='legacy-check';
 await fs.rename(path.join(parent,current.checkId),path.join(parent,legacy));
 const file=path.join(parent,legacy,'plan.json'),plan=JSON.parse(await fs.readFile(file,'utf8'));
 plan.checkId=legacy;await fs.writeFile(file,JSON.stringify(plan));await fs.mkdir(path.join(parent,legacy,'attempt-0'));
 assert.equal((await dispatch('calibrate_begin',p)).checkId,current.checkId);
 assert.equal((await dispatch('calibrate',p)).ok,true);
 assert.equal(JSON.parse(await fs.readFile(file)).checkId,legacy);
 assert.ok((await fs.stat(path.join(parent,legacy,'attempt-0'))).isDirectory());
}));
test('missing plan recovers preparation only, publishes atomically and preserves unknown attempts',()=>fixture(async(root)=>{
 const p={root,id:'sample',revision:'v1'},first=await dispatch('calibrate_begin',p),folder=path.join(root,'eval-lab-data/calibrations',first.checkId),plan=path.join(folder,'plan.json');
 const bytes=await fs.readFile(plan);await fs.unlink(plan);await fs.writeFile(path.join(folder,'plan-deadbeef.tmp'),'{partial');
 const open=fs.open;let failed=false;
 fs.open=async(file,...args)=>{const h=await open(file,...args);if(String(file).includes('/plan-')&&!failed){failed=true;h.writeFile=async()=>{await h.write('{partial');throw Object.assign(Error('disk full'),{code:'ENOSPC'});};}return h;};
 try{await assert.rejects(dispatch('calibrate_begin',p),{code:'ENOSPC'});}finally{fs.open=open;}
 await assert.rejects(fs.access(plan));
 const recovered=await Promise.all([dispatch('calibrate_begin',p),dispatch('calibrate_begin',p)]);assert.deepEqual(recovered,[first,first]);assert.deepEqual(await fs.readFile(plan),bytes);
 await fs.unlink(plan);await fs.mkdir(path.join(folder,'attempt-0'));await assert.rejects(dispatch('calibrate_begin',p),/execution evidence/);await assert.rejects(fs.access(plan));
 await fs.writeFile(plan,'{broken');await assert.rejects(dispatch('calibrate_begin',p));assert.equal(await fs.readFile(plan,'utf8'),'{broken');
}));

test('malformed grader output becomes a readable ungraded receipt without replay',async()=>{
 for(const raw of [{},{status:'unexpected'},[],null,{status:'graded',items:{}},{status:'environment_invalid',reason:'fixture'}])await fixture(async(root,directory)=>{
  const text=JSON.stringify(raw);
  await fs.writeFile(path.join(directory,'author/grade.py'),"import pathlib,sys\np=pathlib.Path(sys.argv[1]); (p/'executed').write_text('once')\npathlib.Path(sys.argv[2]).write_text("+JSON.stringify(text)+")\n");
  const {checkId}=await dispatch('calibrate_begin',{root,id:'sample',revision:'v1'}),p={root,checkId},folder=path.join(root,'eval-lab-data/calibrations',checkId);
  for(let step=0;step<3;step++){
   const result=await dispatch('calibrate_step',{...p,step});assert.equal(result.status,'environment_invalid');assert.equal(result.scoreExact,null);
   const attempt=path.join(folder,'attempt-'+step);assert.equal(await fs.readFile(path.join(attempt,'grade.json'),'utf8'),text);
   // Removing the execution input would make a replay observably fail.
   await fs.rm(path.join(attempt,'source'),{recursive:true});
   if(step===0)await fs.rename(path.join(folder,'step-0.json'),path.join(attempt,'receipt.json'));
   assert.deepEqual(await dispatch('calibrate_step',{...p,step}),result);
  }
  const result=await dispatch('calibrate_finish',p);assert.equal(result.ok,false);assert.ok(result.results.every(r=>r.status==='environment_invalid'&&r.scoreExact===null));
  assert.deepEqual(await dispatch('calibrate_finish',p),result);
 });
});

test('known input copy failure removes only its unstarted attempt and permits retry',()=>fixture(async(root)=>{
 const {checkId}=await dispatch('calibrate_begin',{root,id:'sample',revision:'v1'}),p={root,checkId,step:0};
 const copy=fs.cp,child=require('node:child_process'),spawn=child.spawn;let starts=0;
 child.spawn=(...args)=>{if(args[1][0]==='-B')starts++;return spawn(...args);};
 try{
  fs.cp=async(...args)=>{await copy(...args);throw Object.assign(Error('copy full'),{code:'ENOSPC'});};
  await assert.rejects(dispatch('calibrate_step',p),/磁盘空间/);assert.equal(starts,0);
  await assert.rejects(fs.access(path.join(root,'eval-lab-data/calibrations',checkId,'attempt-0')));
  fs.cp=copy;assert.equal((await dispatch('calibrate_step',p)).status,'graded');assert.equal(starts,1);
  await dispatch('calibrate_step',p);assert.equal(starts,1);
 }finally{fs.cp=copy;child.spawn=spawn;}
}));

test('calibration copy and cleanup errors never expose source or destination paths',async()=>{
 for(const code of ['ENOSPC','EDQUOT','EACCES','EPERM','EROFS','EIO','ENOENT','UNKNOWN'])await fixture(async(root)=>{
  const {checkId}=await dispatch('calibrate_begin',{root,id:'sample',revision:'v1'}),p={root,checkId,step:0},copy=fs.cp;
  fs.cp=async()=>{throw Object.assign(Error(code+' copyfile '+root+'/private-source -> '+root+'/private-output'),{code});};
  try{await assert.rejects(dispatch('calibrate_step',p),e=>{assert.equal(e.code,code);assert.ok(!e.message.includes(root));assert.match(e.message,/校准材料.*重试/);return true;});}finally{fs.cp=copy;}
 });
 await fixture(async(root)=>{
  const {checkId}=await dispatch('calibrate_begin',{root,id:'sample',revision:'v1'}),p={root,checkId,step:0},copy=fs.cp,remove=fs.rm;
  fs.cp=async()=>{throw Object.assign(Error(root),{code:'EIO'});};fs.rm=async()=>{throw Object.assign(Error(root),{code:'EACCES'});};
  try{await assert.rejects(dispatch('calibrate_step',p),e=>!e.message.includes(root)&&/清理未完成/.test(e.message));}finally{fs.cp=copy;fs.rm=remove;}
  await assert.rejects(dispatch('calibrate_step',p),/execution is unknown/);
 });
});
test('ending authoring uses the published completion report without rechecking archived steps',()=>fixture(async(root)=>{
 const p={root,id:'sample',revision:'v1'};
 assert.deepEqual(await dispatch('calibrate_idle',p),{ok:true});
 const {checkId}=await dispatch('calibrate_begin',p);
 await dispatch('calibrate_step',{root,checkId,step:0});
 await assert.rejects(dispatch('calibrate_idle',p),/不能结束/);
 for(const step of [1,2])await dispatch('calibrate_step',{root,checkId,step});
 await dispatch('calibrate_finish',{root,checkId});
 assert.deepEqual(await dispatch('calibrate_idle',p),{ok:true});
 await fs.unlink(path.join(root,'eval-lab-data/calibrations',checkId,'step-1.json'));
 assert.deepEqual(await dispatch('calibrate_idle',p),{ok:true});
}));

test('retry uses the published failed report and ignores pre-release random records',()=>fixture(async(root,directory)=>{
 const p={root,id:'sample',revision:'v1'},grade=path.join(directory,'author/grade.py'),original=await fs.readFile(grade);
 await fs.writeFile(grade,"raise RuntimeError('broken')\n");const failed=await dispatch('calibrate',p);
 const parent=path.join(root,'eval-lab-data/calibrations'),source=path.join(parent,failed.checkId),legacy=path.join(parent,'legacy-failed');
 await fs.cp(source,legacy,{recursive:true});await fs.appendFile(grade,'# legacy edit\n');
 const hashes=await require('../node/engine.cjs').files(directory);
 for(const name of ['plan.json','calibration.json']){const f=path.join(legacy,name),v=JSON.parse(await fs.readFile(f));v.checkId='legacy-failed';v.hashes=hashes;await fs.writeFile(f,JSON.stringify(v));}
 const old=await fs.readFile(path.join(source,'calibration.json'));
 await fs.writeFile(grade,original);await assert.rejects(dispatch('calibrate_begin',p),/明确重试/);
 await fs.unlink(path.join(source,'step-1.json'));
 const retry={...p,retryFrom:failed.checkId},result=await dispatch('calibrate',retry);assert.equal(result.ok,true);
 assert.deepEqual(await dispatch('calibrate',retry),result);assert.deepEqual(await fs.readFile(path.join(source,'calibration.json')),old);
}));
test('freeze storage failures hide paths and retain the calibrated draft',()=>fixture(async(root)=>{
 const p={root,id:'sample',revision:'v1'},cal=await dispatch('calibrate',p),copy=fs.cp,remove=fs.rm;
 const report=path.join(root,'eval-lab-data/calibrations',cal.checkId,'calibration.json'),before=await fs.readFile(report);
 try{
 for(const code of ['ENOSPC','EDQUOT','EACCES','EPERM','EROFS','EIO','ENOENT','UNKNOWN']){
  fs.cp=async()=>{throw Object.assign(Error('copy '+root+'/private'),{code});};
  await assert.rejects(dispatch('freeze',{root,checkId:cal.checkId}),e=>e.code===code&&!e.message.includes(root)&&/冻结材料复制失败/.test(e.message));
 }
 fs.rm=async function(file,...args){if(path.basename(file).startsWith('staging-'))throw Object.assign(Error('cleanup '+file),{code:'EACCES'});return remove.call(this,file,...args);};
 await assert.rejects(dispatch('freeze',{root,checkId:cal.checkId}),e=>e.code==='EACCES'&&!e.message.includes(root)&&/冻结材料清理未完成/.test(e.message));
 }finally{fs.cp=copy;fs.rm=remove;}
 assert.deepEqual(await fs.readFile(report),before);assert.equal((await dispatch('freeze',{root,checkId:cal.checkId})).status,'frozen');
}));
test('confirmed repeated freeze remains successful when redundant staging cleanup fails',()=>fixture(async(root)=>{
 const cal=await dispatch('calibrate',{root,id:'sample',revision:'v1'}),p={root,checkId:cal.checkId},first=await dispatch('freeze',p),remove=fs.rm;
 const manifest=path.join(root,'eval-lab-data/custom-bank/distribution.json'),before=await fs.readFile(manifest);
 fs.rm=async function(file,...args){if(path.basename(file).startsWith('staging-'))throw Object.assign(Error('cleanup unavailable'),{code:'EACCES'});return remove.call(this,file,...args);};
 try{assert.deepEqual(await dispatch('freeze',p),first);await fs.writeFile(path.join(root,'eval-lab-data/freeze.lock'),'legacy');assert.deepEqual(await dispatch('freeze',p),first);assert.deepEqual(await fs.readFile(manifest),before);}finally{fs.rm=remove;}
}));

test('obsolete freeze marker is preserved but does not block the current manifest writer',()=>fixture(async(root)=>{
 const cal=await dispatch('calibrate',{root,id:'sample',revision:'v1'}),marker=path.join(root,'eval-lab-data/freeze.lock');
 await fs.writeFile(marker,'development marker');assert.equal((await dispatch('freeze',{root,checkId:cal.checkId})).status,'frozen');
 assert.equal(await fs.readFile(marker,'utf8'),'development marker');
}));

test('repeated freeze reuses the published version without allocating staging',()=>fixture(async(root)=>{
 const cal=await dispatch('calibrate',{root,id:'sample',revision:'v1'}),p={root,checkId:cal.checkId},first=await dispatch('freeze',p),mkdir=fs.mkdtemp;
 fs.mkdtemp=async function(prefix,...args){if(path.basename(prefix)==='staging-')throw Error('unexpected staging copy');return mkdir.call(this,prefix,...args);};
 try{assert.deepEqual(await dispatch('freeze',p),first);}finally{fs.mkdtemp=mkdir;}
}));
test('freeze rejects edits made while copying the calibrated draft',()=>fixture(async(root,directory)=>{
 const cal=await dispatch('calibrate',{root,id:'sample',revision:'v1'}),copy=fs.cp;let edited=false;
 fs.cp=async function(source,...args){if(!edited&&source===path.join(directory,'candidate')){edited=true;await fs.writeFile(path.join(source,'answer'),'changed during copy');}return copy.call(this,source,...args);};
 try{await assert.rejects(dispatch('freeze',{root,checkId:cal.checkId}),/Draft changed/);}finally{fs.cp=copy;}
 await assert.rejects(fs.access(path.join(root,'eval-lab-data/custom-bank/distribution.json')));
}));

test('calibration discovery ignores Finder metadata and non-snapshot entries',()=>fixture(async(root)=>{
 const p={root,id:'sample',revision:'v1'},cal=await dispatch('calibrate',p),parent=path.join(root,'eval-lab-data/calibrations');
 for(const name of ['.DS_Store','notes','snapshot-'+'f'.repeat(64)])await fs.writeFile(path.join(parent,name),'unrelated');
 await fs.mkdir(path.join(parent,'personal-notes'));
 const rows=await dispatch('drafts',{root});assert.equal(rows.length,1);assert.equal(rows[0].checkId,cal.checkId);
 assert.deepEqual(await dispatch('calibrate_idle',p),{ok:true});
 assert.equal((await dispatch('calibrate_begin',p)).checkId,cal.checkId);
 assert.equal((await dispatch('freeze',{root,checkId:cal.checkId})).status,'frozen');
 assert.deepEqual(await dispatch('drafts',{root}),[]);
 assert.equal(await fs.readFile(path.join(parent,'.DS_Store'),'utf8'),'unrelated');
}));

test('calibration does not grade a control group copied from another draft version',()=>fixture(async(root,directory)=>{
 const p={root,id:'sample',revision:'v1'},a=await dispatch('calibrate_begin',p),copy=fs.cp;
 fs.cp=async(...args)=>{await copy(...args);await fs.writeFile(path.join(args[1],'answer'),'yes');};
 try{await assert.rejects(dispatch('calibrate_step',{root,checkId:a.checkId,step:0}),/Draft changed/);}
 finally{fs.cp=copy;}
 const attempt=path.join(root,'eval-lab-data/calibrations',a.checkId,'attempt-0');
 await assert.rejects(fs.access(path.join(attempt,'source/executed')),{code:'ENOENT'});
 assert.equal((await dispatch('calibrate_step',{root,checkId:a.checkId,step:0})).scoreExact,'0');
}));
test('calibration rejects a swapped grader before executing it under the earlier plan',()=>fixture(async(root,directory)=>{
 const cp=require('node:child_process'),sync=require('node:fs'),spawn=cp.spawn,p={root,id:'sample',revision:'v1'};
 const {checkId}=await dispatch('calibrate_begin',p),grader=path.join(directory,'author/grade.py'),original=await fs.readFile(grader);
 cp.spawn=function(command,args,options){if(args[0]==='-B')sync.writeFileSync(grader,"import json,sys,pathlib\npathlib.Path(sys.argv[2]).write_text(json.dumps({'status':'graded','items':{'a':True}}))\n");return spawn.call(this,command,args,options);};
 try{const result=await dispatch('calibrate_step',{root,checkId,step:0});assert.equal(result.status,'environment_invalid');assert.equal(result.scoreExact,null);}
 finally{cp.spawn=spawn;await fs.writeFile(grader,original);}
}));

test('oversized valid calibration output becomes an unscored receipt',()=>fixture(async(root,directory)=>{
 await fs.writeFile(path.join(directory,'author/grade.py'),"import pathlib,sys\npathlib.Path(sys.argv[2]).write_text('{\"status\":\"graded\",\"items\":{\"a\":true}}'+' '*(17*1024*1024))\n");
 const {checkId}=await dispatch('calibrate_begin',{root,id:'sample',revision:'v1'}),p={root,checkId,step:0};
 const result=await dispatch('calibrate_step',p);assert.equal(result.status,'environment_invalid');assert.equal(result.scoreExact,null);
 const receipt=JSON.parse(await fs.readFile(path.join(root,'eval-lab-data/calibrations',checkId,'step-0.json')));assert.match(receipt.raw.reason,/16 MiB/);
 assert.deepEqual(await dispatch('calibrate_step',p),result);
}));

test('freeze reports manifest budget failure without replacing the bank or losing calibration',()=>fixture(async(root)=>{
 const cal=await dispatch('calibrate',{root,id:'sample',revision:'v1'}),bank=path.join(root,'eval-lab-data/custom-bank'),manifest=path.join(bank,'distribution.json');await fs.mkdir(bank);
 const old=JSON.stringify({format:'eval-lab-bank-v1',questions:[],padding:'x'.repeat(16*1024*1024-150)});await fs.writeFile(manifest,old);
 await assert.rejects(dispatch('freeze',{root,checkId:cal.checkId}),/题库清单超过16 MiB/);assert.equal(await fs.readFile(manifest,'utf8'),old);
 const report=path.join(root,'eval-lab-data/calibrations',cal.checkId,'calibration.json');assert.equal(JSON.parse(await fs.readFile(report)).ok,true);
 await fs.writeFile(manifest,JSON.stringify({format:'eval-lab-bank-v1',questions:[]}));assert.equal((await dispatch('freeze',{root,checkId:cal.checkId})).status,'frozen');
}));
