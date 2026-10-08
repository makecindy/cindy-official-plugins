'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const inputs=['sources.private.json','AUTHOR_TASK.md'];
const outputs=['question.json','candidate','reference','author','controls'];
async function regularTree(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){if(e.isDirectory())await regularTree(path.join(dir,e.name));else if(!e.isFile())throw Error('Author output must contain only regular files and directories');}}
module.exports=({base,within,files,read,write,id,validateSpec})=>{
 const draft=async p=>within(await base(p.root),'drafts/'+id(p.id)+'/'+id(p.revision));
 async function directory(p){const d=await draft(p),result=await within(d,'authored');try{await fs.stat(result);return result;}catch(e){if(e.code!=='ENOENT')throw e;return d;}}
 async function workspace(p){if(!path.isAbsolute(p.workspace)||(await fs.lstat(p.workspace)).isSymbolicLink())throw Error('Invalid author workspace');return fs.realpath(p.workspace);}
 async function stage(p){
  const d=await draft(p),root=await workspace(p),binding={taskId:p.taskId,workspace:root};
  if(typeof p.taskId!=='string'||!p.taskId)throw Error('Missing author task identity');
  const receipt=await within(d,'handoff.json');
  try{await write(receipt,binding);}catch(e){if(e.code!=='EEXIST')throw e;if(JSON.stringify(await read(receipt))!==JSON.stringify(binding))throw Error('Author task identity changed');}
  const rel='eval-author-'+crypto.createHash('sha256').update(JSON.stringify([p.id,p.revision])).digest('hex'),dest=await within(root,rel);
  const verifyInputs=async target=>{for(const name of inputs){const file=await within(target,name);if(!(await fs.readFile(file)).equals(await fs.readFile(await within(d,name))))throw Error('Author source records changed');}};
  try{await fs.stat(dest);await verifyInputs(dest);return {directory:dest};}catch(e){if(e.code!=='ENOENT')throw e;}
  const tmp=await fs.mkdtemp(path.join(root,'.eval-author-'));
  try{for(const name of inputs)await fs.copyFile(await within(d,name),path.join(tmp,name));await verifyInputs(tmp);await fs.rename(tmp,dest);}finally{await fs.rm(tmp,{recursive:true,force:true});}
  return {directory:dest};
 }
 async function collect(p){
  const d=await draft(p),binding=await read(await within(d,'handoff.json'));
  if(binding.taskId!==p.taskId||binding.workspace!==await workspace(p))throw Error('Author task identity changed');
  const result=await within(d,'authored');
  try{await fs.stat(result);return {directory:result};}catch(e){if(e.code!=='ENOENT')throw e;}
  const source=(await stage(p)).directory,tmp=await fs.mkdtemp(path.join(d,'.authored-'));
  try{
   // Validate the complete tree before copying; candidate code is never run here.
   await regularTree(source);await files(source);
   for(const name of outputs)await fs.cp(await within(source,name),path.join(tmp,name),{recursive:true,errorOnExist:true,force:false});
   for(const name of inputs)await fs.copyFile(await within(d,name),path.join(tmp,name));
   const hashes=await files(tmp),spec=await read(path.join(tmp,'question.json'),hashes['question.json']||'');validateSpec(spec);
   if(spec.id!==p.id||spec.revision!==p.revision)throw Error('Question identity mismatch');
   for(const name of ['candidate','reference','author','controls/incomplete'])if(!(await fs.stat(await within(tmp,name))).isDirectory())throw Error('Missing '+name);
   // Reject an inconsistent copy if the task's output changed during handoff.
   const current=await files(source);
   for(const name of outputs){const copied=Object.fromEntries(Object.entries(hashes).filter(([f])=>f===name||f.startsWith(name+'/')));const expected=Object.fromEntries(Object.entries(current).filter(([f])=>f===name||f.startsWith(name+'/')));if(JSON.stringify(copied)!==JSON.stringify(expected))throw Error('Author output changed during handoff');}
   await fs.rename(tmp,result);return {directory:result};
  }finally{await fs.rm(tmp,{recursive:true,force:true});}
 }
 const guarded=fn=>async p=>{try{return await fn(p);}catch(cause){throw Object.assign(Error('出题材料交接未完成，请检查任务目录与题包内容后重试；原始草稿保留。'),{code:'AUTHOR_HANDOFF_FAILED',cause});}};
 return {stage:guarded(stage),collect:guarded(collect),directory};
};
