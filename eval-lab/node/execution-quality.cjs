'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const readMetadata=require('./read-metadata.cjs');
async function digest(file){if(!(await fs.lstat(file)).isFile())throw Error('Not a regular file');const hash=crypto.createHash('sha256');for await(const chunk of require('node:fs').createReadStream(file))hash.update(chunk);return hash.digest('hex');}
const ms=x=>typeof x==='number'&&Number.isFinite(x)?x:typeof x==='string'?Date.parse(x):NaN;
function timing(receipt,gradingStartedAt,gradingEndedAt){
 const start=ms(receipt.startedAt),end=ms(receipt.completedAt),accepted=ms(receipt.acceptedAt);
 return {durationSeconds:Number.isFinite(start)&&Number.isFinite(end)&&end>=start?(end-start)/1000:null,queueSeconds:Number.isFinite(accepted)&&Number.isFinite(start)&&start>=accepted?(start-accepted)/1000:null,gradingSeconds:Number.isFinite(gradingStartedAt)&&Number.isFinite(gradingEndedAt)?Math.max(0,gradingEndedAt-gradingStartedAt)/1000:null,timingBasis:receipt.timingBasis||'unavailable',costUSD:Number.isFinite(receipt.usage?.costUSD)&&receipt.usage.costUSD>=0?receipt.usage.costUSD:null,costBasis:receipt.usage?.costUSD!=null?(receipt.usage.approximate?'host-session-estimate':'host-session-total'):'unknown'};
}
// Worker-writable diagnostic only. Matching harness bytes does not authenticate a receipt.
async function environmentEvidence(workspace,candidate){
 try{return await readEnvironmentEvidence(workspace,candidate);}catch{return null;}
}
async function readEnvironmentEvidence(workspace,candidate){
 const dir=path.join(workspace,'tests/environment-preflight');let names;
 try{names=await fs.readdir(dir);}catch(e){if(e.code==='ENOENT')return null;throw e;}
 let entry;
 for(const name of names.filter(n=>/^receipt-[a-zA-Z0-9-]+\.json$/.test(n))){
  const f=path.join(dir,name);if(!(await fs.lstat(f)).isFile())continue;
  try{const r=await readMetadata(f);if(r.phase==='verified'&&r.root===workspace&&r.cwd===workspace&&Number.isFinite(ms(r.verifiedAt))&&(!entry||ms(r.verifiedAt)>ms(entry.r.verifiedAt)))entry={r,name};}catch{}
 }
 if(!entry||entry.r.ok===true||entry.r.browser!==false)return null;
 const stderr=entry.r.browserOutput?.stderr;
 if(typeof stderr!=='string'||!(/listen (EPERM|EACCES).*127\.0\.0\.1/.test(stderr)))return null;
 for(const rel of ['lab/preflight.cjs','lab/browser-console.cjs']){
  try{const [a,b]=await Promise.all([digest(path.join(workspace,rel)),digest(path.join(candidate,rel))]);if(a!==b)return null;}catch(e){if(rel==='lab/preflight.cjs'||e.code!=='ENOENT')return null;}
 }
 return {status:'environment_invalid',reason:'作答目录报告回环监听失败；此记录未经宿主认证，仅作诊断。',evidence:'tests/environment-preflight/'+entry.name,verifiedAt:entry.r.verifiedAt};
}
module.exports={environmentEvidence,timing,ms};
