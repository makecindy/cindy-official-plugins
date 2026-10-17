'use strict';
const {link}=require('./storage.cjs');
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const inputError=require('./input-error.cjs');
const names=['candidate','reference','controls/incomplete'];
const publicStep=({name,status,scoreExact})=>({name,status,scoreExact});
module.exports=function calibration({base,within,files,read,write,id,validateSpec,score,runCommand,draftDirectory=async p=>within(await base(p.root),'drafts/'+id(p.id)+'/'+id(p.revision))}){
 function receipt(result,name,spec){
  const execution=result?.execution;
  if(result?.name!==name||typeof execution?.timedOut!=='boolean'||!(execution.code===null||Number.isInteger(execution.code))||!['graded','environment_invalid'].includes(result.status)||result.raw?.status!==result.status)throw Error('Calibration receipt mismatch');
  if(result.status==='graded'){
   const calculated=score(spec,result.raw.items);
   if(!Number.isFinite(result.score)||result.score<0||result.score>1||typeof result.scoreExact!=='string')throw Error('Calibration receipt mismatch');
   if(result.execution.code!==0||result.execution.timedOut||result.score!==calculated.value||result.scoreExact!==calculated.exact)throw Error('Calibration receipt mismatch');
  }else if(result.score!==null||result.scoreExact!==null)throw Error('Calibration receipt mismatch');
  return result;
 }
 async function begin(p){
  const home=await base(p.root),dir=await draftDirectory(p);
  const hashes=await files(dir);
  const spec=await read(path.join(dir,'question.json'),hashes['question.json']||'');validateSpec(spec);
  if(spec.id!==p.id||spec.revision!==p.revision)throw Error('Question identity mismatch');
  for(const name of [...names,'author'])if(!(await fs.stat(path.join(dir,name))).isDirectory())throw Error('Missing '+name);
  const identity={id:p.id,revision:p.revision,hashes};
  // The draft snapshot owns the ID, so a lost begin/step response cannot create
  // another execution of the same unknown attempt on the next request.
  let checkId='snapshot-'+crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  let checks=await within(home,'calibrations/'+checkId),plan={checkId,...identity};
  await fs.mkdir(path.dirname(checks),{recursive:true});
  // Find this question’s current snapshots and explicit retries.
  const matches=[];
  for(const item of await fs.readdir(path.dirname(checks),{withFileTypes:true})){
   if(!item.isDirectory()||!/^(snapshot|retry)-[a-f0-9]{64}$/.test(item.name))continue;
   const entry=item.name;
   const folder=await within(home,'calibrations/'+id(entry));let old;
   try{old=await read(path.join(folder,'plan.json'));}catch(e){if(e.code==='ENOENT')continue;throw e;}
   if(old.id===p.id&&old.revision===p.revision){
    if(old.checkId!==entry)throw Error('Calibration identity conflict');matches.push(old);
   }
  }
  // IDs and retryFrom are written by this plugin. A successor makes its parent historical.
  const children=new Map(matches.filter(x=>x.retryFrom).map(x=>[x.retryFrom,x]));
  const sameSnapshot=matches.filter(x=>JSON.stringify(x.hashes)===JSON.stringify(hashes));
  const latest=sameSnapshot.filter(x=>!children.has(x.checkId));
  if(p.retryFrom===undefined&&latest.length>1)throw Error('同一草稿存在多个校准记录，请先核对原执行状态；不会重复执行评分。');
  async function admitNewAttempt(previous){
   // Completed reports stay historical; unfinished current attempts still block.
   for(const leaf of matches.filter(x=>!children.has(x.checkId))){
    if(leaf.checkId===previous?.checkId)continue;
    let report;try{report=await read(path.join(home,'calibrations',leaf.checkId,'calibration.json'));}catch(e){if(e.code!=='ENOENT')throw e;throw Error('校准尚未结束或执行状态未知，不能重试。');}
    if(!previous&&report.ok!==true)throw Error('已有未通过的校准报告，请选择该报告明确重试；不会创建并行校准。');
   }
   await idle(p);
  }
  if(p.retryFrom!==undefined){
   const previous=matches.find(x=>x.checkId===p.retryFrom);
   if(!previous)throw Error('校准重试与当前草稿不匹配。');
   // One explicitly selected completed report owns exactly one successor.
   // Repeating the same request after a lost reply recovers that successor.
   const successor=children.get(previous.checkId);
   if(successor)return {checkId:successor.checkId};
   let completed;
   try{completed=await read(path.join(home,'calibrations',previous.checkId,'calibration.json'));}catch(e){if(e.code!=='ENOENT')throw e;throw Error('校准尚未结束或执行状态未知，不能重试。');}
   if(completed.checkId!==previous.checkId||completed.id!==previous.id||completed.revision!==previous.revision||JSON.stringify(completed.hashes)!==JSON.stringify(previous.hashes)||completed.ok!==false||!Array.isArray(completed.results)||completed.results.length!==names.length)throw Error('只有已结束且未通过的校准可以重试。');
   await admitNewAttempt(previous);
   checkId='retry-'+crypto.createHash('sha256').update(previous.checkId).digest('hex');
   checks=await within(home,'calibrations/'+checkId);plan={checkId,...identity,retryFrom:previous.checkId};
  }else{
   if(latest.length===1)return {checkId:latest[0].checkId};
   if(sameSnapshot.length)throw Error('Draft changed; recalibrate');
   // Changed successful drafts remain compatible; failed drafts require explicit retry.
   await admitNewAttempt();
  }
  await fs.mkdir(checks,{recursive:true});
  const dest=path.join(checks,'plan.json');
  try{
   const existing=await read(dest);
   if(JSON.stringify(existing)!==JSON.stringify(plan))throw Error('Calibration identity conflict');
   return {checkId};
  }catch(e){if(e.code!=='ENOENT')throw e;}
  // No execution can precede a published plan. Recover only preparation files;
  // unknown attempts or receipts require execution recovery, never reinitialization.
  if((await fs.readdir(checks)).some(name=>name!=='plan.json'&&!/^plan-[0-9a-f-]+\.tmp$/.test(name)))throw Error('Calibration preparation has execution evidence; recovery required');
  const tmp=path.join(checks,'plan-'+crypto.randomUUID()+'.tmp');
  try{
   await write(tmp,plan);
   try{await link(tmp,dest);}catch(e){if(e.code!=='EEXIST')throw e;if(JSON.stringify(await read(dest))!==JSON.stringify(plan))throw Error('Calibration identity conflict');}
  }finally{await fs.rm(tmp,{force:true});}
  return {checkId};
 }
 async function context(p){
  const home=await base(p.root),checks=await within(home,'calibrations/'+id(p.checkId)),plan=await read(path.join(checks,'plan.json'));
  const dir=await draftDirectory({...p,id:plan.id,revision:plan.revision});
  if(JSON.stringify(plan.hashes)!==JSON.stringify(await files(dir)))throw Error('Draft changed; recalibrate');
  const spec=await read(path.join(dir,'question.json'),plan.hashes['question.json']||'');validateSpec(spec);
  return {checks,plan,dir,spec};
 }
 async function step(p){
  if(!Number.isInteger(p.step)||p.step<0||p.step>=names.length)throw Error('Invalid calibration step');
  const {checks,plan,dir,spec}=await context(p),name=names[p.step],resultPath=path.join(checks,'step-'+p.step+'.json');
  try{return publicStep(receipt(await read(resultPath),name,spec));}catch(e){if(e.code!=='ENOENT')throw e;}
  // A durable attempt marker prevents replay of an unknown or still-running process.
  // Completed receipts are reusable; unknown attempts are never replayed.
  const attempt=path.join(checks,'attempt-'+p.step);
  try{await fs.mkdir(attempt);}catch(e){
   if(e.code!=='EEXIST')throw e;
   let result;
   try{result=await read(path.join(attempt,'receipt.json'));}catch(error){
    if(error.code==='ENOENT'){
     try{return publicStep(receipt(await read(resultPath),name,spec));}catch(missing){if(missing.code!=='ENOENT')throw missing;}
     throw Object.assign(Error('Calibration execution is unknown; existing files preserved, no replay.'),{code:'EEXIST'});
    }
    throw error;
   }
   receipt(result,name,spec);
   try{await link(path.join(attempt,'receipt.json'),resultPath);}catch(error){if(error.code!=='EEXIST')throw error;if(JSON.stringify(await read(resultPath))!==JSON.stringify(result))throw Error('Calibration receipt conflict');}
   return publicStep(result);
  }
  const source=path.join(attempt,'source'),output=path.join(attempt,'grade.json');
  try{
   await require('./python-runtime.cjs').preflight(runCommand);
   await fs.cp(path.join(dir,name),source,{recursive:true,errorOnExist:true,force:false});
   const expected=Object.fromEntries(Object.entries(plan.hashes).filter(([key])=>key.startsWith(name+'/')).map(([key,hash])=>[key.slice(name.length+1),hash]));
   if(JSON.stringify(await files(source))!==JSON.stringify(expected))throw Object.assign(Error('Draft changed; recalibrate'),{code:'DRAFT_CHANGED'});
  }
  catch(error){try{await fs.rm(attempt,{recursive:true,force:true});}catch(cleanup){throw inputError(cleanup,true);}throw error.pythonStartup||['DRAFT_CHANGED','PYTHON_UNAVAILABLE'].includes(error.code)?error:inputError(error);}
  const execution=await runCommand('python3',['-B',path.join(__dirname,'verified_grader.py'),path.join(dir,'author/grade.py'),plan.hashes['author/grade.py'],source,output]);
  if(execution.errorCode){
   try{await fs.rm(attempt,{recursive:true,force:true});}catch(error){throw inputError(error,true);}
   throw require('./python-runtime.cjs').startupError(execution.errorCode);
  }
  let raw,calculated;
  try{raw=await read(output);if(execution.code!==0||execution.timedOut)raw={status:'environment_invalid',reason:'Grader process failed or timed out'};if(!raw||!['graded','environment_invalid'].includes(raw.status))throw Error('Invalid grader result status');if(raw.status==='graded')calculated=score(spec,raw.items);}catch(e){raw={status:'environment_invalid',reason:e.message};}
  const result={name,status:raw.status,score:calculated?.value??null,scoreExact:calculated?.exact??null,execution,raw};
  receipt(result,name,spec);
  const tmp=path.join(attempt,'receipt.json');await write(tmp,result);await fs.rename(tmp,resultPath);
  return publicStep(result);
 }
 async function finish(p){
  const {checks,plan,spec}=await context(p),results=[];
  for(let i=0;i<names.length;i++)results.push(receipt(await read(path.join(checks,'step-'+i+'.json')),names[i],spec));
  const ok=results.every(x=>x.status==='graded')&&results[1].score===1&&results[0].score<1&&results[2].score<1;
  const cal={...plan,ok,results},dest=path.join(checks,'calibration.json');
  const tmp=path.join(checks,'finish-'+crypto.randomUUID()+'.tmp');
  try{
   await write(tmp,cal);
   try{await link(tmp,dest);}catch(e){if(e.code!=='EEXIST')throw e;if(JSON.stringify(await read(dest))!==JSON.stringify(cal))throw Error('Calibration result conflict');}
  }finally{await fs.rm(tmp,{force:true});}
  return {checkId:plan.checkId,ok,results:results.map(({name,status,scoreExact})=>({name,status,scoreExact}))};
 }
 async function all(p){const {checkId}=await begin(p);for(let stepIndex=0;stepIndex<names.length;stepIndex++)await step({...p,checkId,step:stepIndex});return finish({...p,checkId});}
 async function idle(p){
  const parent=path.join(await base(p.root),'calibrations');let entries;
  try{entries=await fs.readdir(parent,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return {ok:true};throw e;}
  for(const item of entries){
   if(!item.isDirectory()||!/^(snapshot|retry)-[a-f0-9]{64}$/.test(item.name))continue;
   const entry=item.name;
   const folder=await within(await base(p.root),'calibrations/'+id(entry));let plan;
   try{plan=await read(path.join(folder,'plan.json'));}catch(e){if(e.code==='ENOENT')continue;throw e;}
   if(plan.id!==p.id||plan.revision!==p.revision)continue;
   if((await fs.readdir(folder)).some(x=>x.startsWith('attempt-'))){
    let report;try{report=await read(path.join(folder,'calibration.json'));}catch(e){if(e.code!=='ENOENT')throw e;throw Error('校准尚未结束或执行状态未知，不能结束出题。');}
    if(plan.checkId!==entry||report.checkId!==entry||typeof report.ok!=='boolean'||!Array.isArray(report.results)||report.results.length!==names.length)throw Error('校准尚未结束或执行状态未知，不能结束出题。');
    // finish publishes this report only after all three validated steps. It is
    // the completion record; archived step files are not another approval gate.
   }
  }
  return {ok:true};
 }
 return {begin,step,finish,all,idle};
};
