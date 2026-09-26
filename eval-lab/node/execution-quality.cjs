'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const ms=x=>typeof x==='number'&&Number.isFinite(x)?x:typeof x==='string'?Date.parse(x):NaN;
function timing(receipt,gradingStartedAt,gradingEndedAt){
 const start=ms(receipt.startedAt),end=ms(receipt.completedAt),accepted=ms(receipt.acceptedAt);
 return {durationSeconds:Number.isFinite(start)&&Number.isFinite(end)&&end>=start?(end-start)/1000:null,queueSeconds:Number.isFinite(accepted)&&Number.isFinite(start)&&start>=accepted?(start-accepted)/1000:null,gradingSeconds:Number.isFinite(gradingStartedAt)&&Number.isFinite(gradingEndedAt)?Math.max(0,gradingEndedAt-gradingStartedAt)/1000:null,timingBasis:receipt.timingBasis||'unavailable',costUSD:Number.isFinite(receipt.usage?.costUSD)&&receipt.usage.costUSD>=0?receipt.usage.costUSD:null,costBasis:receipt.usage?.costUSD!=null?(receipt.usage.approximate?'host-session-estimate':'host-session-total'):'unknown'};
}
// Evidence is produced by the unchanged supplied harness. A report sentence alone is not a verdict.
async function environmentEvidence(workspace,candidate){
 const dir=path.join(workspace,'tests/environment-preflight');let names;
 try{names=await fs.readdir(dir);}catch(e){if(e.code==='ENOENT')return null;throw e;}
 const receipts=[];
 for(const name of names.filter(n=>/^receipt-[a-zA-Z0-9-]+\.json$/.test(n))){
  const f=path.join(dir,name);if((await fs.lstat(f)).isSymbolicLink())continue;
  try{const r=JSON.parse(await fs.readFile(f,'utf8'));if(r.phase==='verified'&&r.root===workspace&&r.cwd===workspace&&Number.isFinite(ms(r.verifiedAt)))receipts.push({r,name});}catch{}
 }
 receipts.sort((a,b)=>ms(b.r.verifiedAt)-ms(a.r.verifiedAt));const entry=receipts[0];if(!entry||entry.r.ok===true||entry.r.browser!==false)return null;
 const stderr=entry.r.browserOutput?.stderr;
 if(typeof stderr!=='string'||!(/listen (EPERM|EACCES).*127\.0\.0\.1/.test(stderr)))return null;
 for(const rel of ['lab/preflight.cjs','lab/browser-console.cjs']){
  try{const [a,b]=await Promise.all([fs.readFile(path.join(workspace,rel)),fs.readFile(path.join(candidate,rel))]);if(digest(a)!==digest(b))return null;}catch(e){if(rel==='lab/preflight.cjs'||e.code!=='ENOENT')return null;}
 }
 return {status:'environment_invalid',reason:'运行环境禁止回环监听，浏览器预检失败；本次不计入正式总分。',evidence:'tests/environment-preflight/'+entry.name,verifiedAt:entry.r.verifiedAt};
}
module.exports={environmentEvidence,timing,ms};
