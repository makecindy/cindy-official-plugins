'use strict';
const crypto = require('node:crypto');
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const id = x => { if(typeof x !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/.test(x)) throw Error('Invalid identifier'); return x; };
const gcd=(a,b)=>b?gcd(b,a%b):a;
function fraction(n,d=1n){n=BigInt(n);d=BigInt(d);if(d<=0n)throw Error('Invalid denominator');const g=gcd(n<0n?-n:n,d);return {n:n/g,d:d/g};}
function parse(s){if(!/^\d+(\/\d+)?$/.test(String(s)))throw Error('Weights must be positive rational numbers');return fraction(...String(s).split('/'));}
const add=(a,b)=>fraction(a.n*b.d+b.n*a.d,a.d*b.d);
const mul=(a,b)=>fraction(a.n*b.n,a.d*b.d);
const exact=a=>a.d===1n?String(a.n):`${a.n}/${a.d}`;
function validateSpec(s){
 id(s.id);id(s.revision);id(s.scoringVersion);
 if(!s.title || !Array.isArray(s.groups)||!s.groups.length)throw Error('Missing question fields');
 let total=fraction(0), groups=new Set(), items=new Set();
 for(const g of s.groups){id(g.id);if(groups.has(g.id))throw Error('Duplicate group');groups.add(g.id);
  const w=parse(g.weight);if(w.n<=0n)throw Error('Invalid weight');total=add(total,w);
  if(!['ratio','all'].includes(g.mode)||!Array.isArray(g.items)||!g.items.length)throw Error('Invalid group');
  const local=new Set();for(const i of g.items){id(i);if(local.has(i))throw Error('Duplicate assessment item');local.add(i);items.add(i);}
 }
 if(exact(total)!=='1')throw Error('Weights must sum to one');return items;
}
function score(s,items){const expected=validateSpec(s);if(Object.keys(items).length!==expected.size||[...expected].some(k=>typeof items[k]!=='boolean'))throw Error('Missing or invalid assessment result');
 let total=fraction(0);for(const g of s.groups){const n=g.items.filter(k=>items[k]).length;total=add(total,mul(parse(g.weight),g.mode==='all'?fraction(n===g.items.length?1:0):fraction(n,g.items.length)));}return {exact:exact(total),value:Number(total.n)/Number(total.d)};
}
const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function publicResult(r){return {runId:r.runId,batchId:r.batchId??null,createdAt:r.createdAt??null,gradedAt:r.gradedAt??null,question:r.title,questionId:r.questionId,revision:r.revision,releaseHash:r.releaseHash,distributionHash:r.distributionHash,model:r.model,harness:r.harness,effort:r.effort,provider:r.provider,status:r.status,score:r.score??null,scoreExact:r.scoreExact??null,durationSeconds:r.durationSeconds??null,queueSeconds:r.queueSeconds??null,gradingSeconds:r.gradingSeconds??null,timingBasis:r.timingBasis??'unknown',reason:r.status==='environment_invalid'?'环境未满足要求，详细诊断保留在本地。':r.status==='failed'?'本次未完成，详细诊断保留在本地。':null,costUSD:r.costUSD??null,costBasis:r.costBasis??'unknown',executionChannel:r.executionChannel??'unknown'};}
function totals(rows){
 const required=new Set(rows.map(r=>JSON.stringify([r.questionId,r.revision,r.releaseHash,r.distributionHash])));const configs=new Map();
 for(const r of rows){const key=JSON.stringify([r.model,r.harness,r.effort,r.provider]);if(!configs.has(key))configs.set(key,[]);configs.get(key).push(r);}
 return [...configs.values()].map(rs=>{const by=new Map();for(const r of rs){const k=JSON.stringify([r.questionId,r.revision,r.releaseHash,r.distributionHash]);if(!by.has(k))by.set(k,[]);by.get(k).push(r);}const complete=by.size===required.size&&[...by.values()].every(a=>a.length===1&&a[0].status==='graded'&&a[0].scoreExact!=null);let total=fraction(0);if(complete)for(const r of rs)total=add(total,parse(r.scoreExact));return {model:rs[0].model,harness:rs[0].harness,effort:rs[0].effort,complete,total:complete?exact(total):null,required:required.size};});
}
function report(runs){
 const rows=runs.map(publicResult);const summary=totals(rows).map(r=>'<p>'+escape(r.model)+' / '+escape(r.effort)+'：'+(r.complete?escape(r.total)+' / '+r.required:'未生成总分（缺题、无效结果或重复样本）')+'</p>').join('');const body=rows.map(r=>`<tr><td>${escape(r.question)}<small>${escape(r.revision)}</small></td><td>${escape(r.model)}<small>${escape(r.harness)} · ${escape(r.effort)}</small></td><td>${r.status==='graded'?escape(r.scoreExact)+' / 1':r.status==='environment_invalid'?'环境受阻，不计分':escape(r.status)}${r.reason?'<small>'+escape(r.reason)+'</small>':''}</td><td>${r.durationSeconds==null?'未知':escape(r.durationSeconds)+' s'}<small>排队 ${r.queueSeconds==null?'未知':escape(r.queueSeconds)+' s'} · 评分 ${r.gradingSeconds==null?'未知':escape(r.gradingSeconds)+' s'}</small></td><td>${r.costUSD==null?'未知':'$'+escape(r.costUSD)}${r.costBasis==='host-session-estimate'?'<small>宿主估算</small>':''}</td></tr>`).join('');
 return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>评测成绩</title><style>body{font:15px/1.6 system-ui;background:#f8f8f6;color:#262626;max-width:1000px;margin:32px auto;padding:0 20px}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:12px;border-bottom:1px solid #aaa}small{display:block;opacity:.7}.table{overflow:auto}@media(prefers-color-scheme:dark){body{background:#1f1f1e;color:#eee}}</style><h1>评测成绩</h1><p>每题 1 分，按冻结考核点完成度计分。不同版本分开比较；未知费用不记为零。作答耗时按宿主首个模型活动至终态的观测区间统计，不代表纯计算时间。结果来自本地评测，非第三方认证。</p>'+summary+'<div class="table"><table><thead><tr><th>题目</th><th>模型 / 框架 / 强度</th><th>得分</th><th>耗时</th><th>费用 USD</th></tr></thead><tbody>'+body+'</tbody></table></div><p>报告不包含原始任务记录、源码、文件路径或账号标识。</p></html>';
}
module.exports={sha,id,validateSpec,score,report,publicResult,totals};
