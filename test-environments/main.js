'use strict';
const METHODS=['catalog','save_project','save_account','save_profile','save_case','remove','import_cindy','select_account','plan','start','status','stop','inspect','remote'];
async function request(method,args){
  if(method==='prepare_project'){const r=await cindy.node.request({method:'ensure_test_project',params:{project:args?.project},timeoutMs:30000});return r.ok?r.result:{ok:false,errorCode:'WORKER_UNAVAILABLE',message:'Inspect the catalog before trying again.',execution:'unknown'};}
  if(method==='pick_project'){
    if(typeof cindy.pick!=='function')return {ok:false,errorCode:'PICK_UNAVAILABLE',message:'Native directory selection is unavailable. Update Cindy or use Advanced management.',execution:'not_executed'};
    const titles={en:'Choose a Cindy project','zh-CN':'选择 Cindy 项目',ja:'Cindy プロジェクトを選択',ko:'Cindy 프로젝트 선택'};
    const picked=await cindy.pick({mode:'directory',title:titles[args?.locale]||titles.en});
    if(!picked.ok){if(picked.errorCode==='CANCELLED')return {ok:true,data:{cancelled:true}};return {ok:false,errorCode:picked.errorCode||'PICK_FAILED',message:picked.message||'The project was not selected.',execution:'not_executed'};}
    if(typeof picked.path!=='string'||!picked.path)return {ok:false,errorCode:'PICK_PATH_UNAVAILABLE',message:'The selected project path was not provided to the Node service.',execution:'not_executed'};
    const r=await cindy.node.request({method:'ensure_test_project',params:{root:picked.path,...(picked.name?{label:picked.name}:{})},timeoutMs:30000});
    return r.ok?r.result:{ok:false,errorCode:'WORKER_UNAVAILABLE',message:'Inspect the project catalog before trying again.',execution:'unknown'};
  }
  if(!METHODS.includes(method))return {ok:false,errorCode:'UNKNOWN_OPERATION',message:'Unknown operation.',execution:'not_executed'};
  const r=await cindy.node.request({method,params:args||{},timeoutMs:30000});
  return r.ok?r.result:{ok:false,errorCode:'WORKER_UNAVAILABLE',message:'The local service did not reply. Check status before repeating a launch.',execution:'unknown'};
}
cindy.onHostMessage(async msg=>{
  if(msg.type!=='tool-call')return;
  let result;
  try{result=METHODS.includes(msg.tool)?await request(msg.tool,msg.args):{ok:false,errorCode:'UNKNOWN_OPERATION',message:'Unknown operation.',execution:'not_executed'};}catch{result={ok:false,errorCode:'WORKER_UNAVAILABLE',message:'Check status before repeating this operation.',execution:'unknown'};}
  await cindy.send(result.ok?{type:'tool-result',callId:msg.callId,ok:true,result:result.data}:{type:'tool-result',callId:msg.callId,ok:false,errorCode:result.errorCode,message:result.message+' (execution: '+result.execution+')'});
});
// Same-origin pages of this plugin only. No cross-plugin channel or Host IPC.
const pages=new BroadcastChannel('test-environments-pages');
const replies=new Map();
pages.onmessage=async({data})=>{
  if(data?.type!=='request'||typeof data.id!=='string'||data.id.length>80)return;
  let work=replies.get(data.id);
  if(!work){work=(async()=>{try{return await request(data.method,data.args);}catch{return {ok:false,errorCode:'WORKER_UNAVAILABLE',message:'Check status before repeating this operation.'};}})();replies.set(data.id,work);void work.finally(()=>setTimeout(()=>replies.delete(data.id),60000));}
  pages.postMessage({type:'accepted',id:data.id});
  pages.postMessage({type:'response',id:data.id,result:await work});
};
