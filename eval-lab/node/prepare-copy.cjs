'use strict';
const {link}=require('./storage.cjs');
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const inputError=require('./input-error.cjs');
module.exports=async function(options){
 try{return await prepareCopy(options);}catch(error){if(error.code)throw inputError(error,false,'作答准备');throw error;}
};
async function prepareCopy({runDir,workspace,candidate,expectedHashes,record,read,write,files,within}){
 const planPath=path.join(runDir,'preparation.json'),hashes=await files(candidate);
 if(Object.keys(hashes).length!==Object.keys(expectedHashes).length||Object.entries(expectedHashes).some(([name,hash])=>hashes[name]!==hash))throw Error('Question package changed during preparation');
 let plan;
 try{plan=await read(planPath);}catch(e){if(e.code!=='ENOENT')throw e;}
 const same=r=>['runId','batchId','bank','question','model','provider','harness','effort','workspace','distributionHash','executionChannel'].every(k=>r[k]===record[k]);
 if(plan){if(!same(plan.record)||JSON.stringify(plan.hashes)!==JSON.stringify(hashes))throw Error('Run preparation identity conflict');}
 else{
  try{if((await fs.readdir(workspace)).length)throw Error('作答目录不是空目录，拒绝覆盖');}catch(e){if(e.code!=='ENOENT')throw e;}
  plan={record,hashes};
  try{await write(planPath,plan);}catch(e){if(e.code!=='EEXIST')throw e;plan=await read(planPath);if(!same(plan.record)||JSON.stringify(plan.hashes)!==JSON.stringify(hashes))throw Error('Run preparation identity conflict');}
 }
 await fs.mkdir(workspace,{recursive:true});
 const actual=await files(workspace);
 for(const [name,hash]of Object.entries(actual))if(hashes[name]!==hash)throw Error('作答目录已有修改或未知文件，保留现场，不自动覆盖。');
 async function directories(rel=''){
  for(const entry of await fs.readdir(path.join(candidate,rel),{withFileTypes:true}))if(entry.isDirectory()){
   const name=rel?rel+'/'+entry.name:entry.name;await fs.mkdir(await within(workspace,name),{recursive:true});await directories(name);
  }
 }
 await directories();
 for(const [name,hash]of Object.entries(hashes)){
  if(actual[name]===hash)continue;
  const target=await within(workspace,name);await fs.mkdir(path.dirname(target),{recursive:true});
  const tmp=path.join(runDir,'candidate-'+crypto.randomUUID()+'.tmp');
  try{
   await fs.cp(path.join(candidate,name),tmp,{errorOnExist:true,force:false});
   // Publishing a whole file keeps a killed copy out of the answer workspace.
   try{await link(tmp,target);}catch(e){if(e.code!=='EEXIST')throw e;if((await files(workspace))[name]!==hash)throw Error('作答目录已有修改或未知文件，保留现场，不自动覆盖。');}
  }finally{await fs.unlink(tmp).catch(()=>{});}
 }
 if(JSON.stringify(await files(workspace))!==JSON.stringify(hashes))throw Error('作答目录已有修改或未知文件，保留现场，不自动覆盖。');
 try{await write(path.join(runDir,'run.json'),plan.record);}catch(e){if(e.code!=='EEXIST')throw e;let old;try{old=await read(path.join(runDir,'run.json'));}catch{throw e;}if(JSON.stringify(old)!==JSON.stringify(plan.record))throw e;}
 return plan.record;
};
