'use strict';
const fs=require('node:fs/promises');
const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
// Persistent records may start empty only when absent. Never turn corrupt or
// unreadable data into a successful read that a later update could overwrite.
async function readJsonRecord(file,{initial,validate,code,message}){
 try{
  let text;
  try{text=await fs.readFile(file,'utf8');}
  catch(error){if(error.code==='ENOENT')return initial;throw error;}
  const value=JSON.parse(text);
  if(!isRecord(value)||!validate(value))throw Error('Invalid saved record');
  return value;
 }catch(cause){throw Object.assign(Error(message,{cause}),{code,execution:'not_executed'});}
}
// A device action has already completed: a failed bookkeeping write must stay
// visible without discarding the action's result or changing its execution.
async function recordUpdate(result,field,update,message){
 try{await update();}
 catch(error){result[field]={code:error.code||'RECORD_UPDATE_FAILED',message};}
 return result;
}
module.exports={readJsonRecord,isRecord,recordUpdate};
