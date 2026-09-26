/* Shared by the settings page and exported reports. No host access. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.EvalStandings=api;})(globalThis,()=>{
 const configKey=r=>JSON.stringify([r.model,r.harness,r.effort,r.provider]);
 const questionKey=q=>JSON.stringify([q.questionId||q.key?.split(':').pop().split('@')[0],q.revision,q.releaseHash||'',q.distributionHash||'']);
 const stamp=r=>Date.parse(r.gradedAt||r.createdAt||'')||0;
 const newest=(a,b)=>stamp(b)-stamp(a)||String(b.runId).localeCompare(String(a.runId));
 const value=r=>{if(r.status!=='graded'||(r.scoreExact==null&&r.score==null))return null;const p=String(r.scoreExact??r.score??'').split('/').map(Number);const n=p.length===2?p[0]/p[1]:p[0];return Number.isFinite(n)&&n>=0&&n<=1?n:null;};
 function aggregate(runs,questions,mode='latest'){
  const qs=[...new Map(questions.map(q=>[questionKey(q),q])).values()];const keys=new Set(qs.filter(q=>!q.unresolved).map(questionKey));
  const groups=new Map();for(const r of runs){if(!keys.has(questionKey(r)))continue;const k=configKey(r);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}
  return [...groups].map(([key,rs])=>{
   const details=qs.map(q=>{const all=rs.filter(r=>questionKey(r)===questionKey(q)).sort(newest),valid=all.filter(r=>value(r)!==null),selected=mode==='average'?valid:valid.slice(0,1);return {question:q,records:all,selected,score:selected.length?selected.reduce((n,r)=>n+value(r),0)/selected.length:null,recentBlocked:all[0]?.status==='environment_invalid'};});
   const used=details.flatMap(d=>d.selected),complete=details.length>0&&details.every(d=>d.score!==null);
   return {key,model:rs[0].model,harness:rs[0].harness,provider:rs[0].provider,effort:rs[0].effort,details,complete,required:qs.length,answered:details.filter(d=>d.score!==null).length,total:details.reduce((n,d)=>n+(d.score??0),0),updatedAt:Math.max(0,...used.map(stamp)),runIds:used.map(r=>r.runId),attempts:rs.length,costUSD:used.length&&used.every(r=>Number.isFinite(r.costUSD))?used.reduce((n,r)=>n+r.costUSD,0):null};
  }).sort((a,b)=>Number(b.complete)-Number(a.complete)||(a.complete?b.total-a.total:b.answered-a.answered)||b.updatedAt-a.updatedAt||a.key.localeCompare(b.key));
 }
 return {aggregate,questionKey,configKey,stamp,value};
});
