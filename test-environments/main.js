'use strict';
const METHODS=['catalog','save_project','save_account','save_profile','save_case','remove','import_cindy','select_account','plan','start','status','stop','inspect','remote'];
async function request(method,args){
  if(!METHODS.includes(method))return {ok:false,errorCode:'UNKNOWN_OPERATION',message:'Unknown operation.',execution:'not_executed'};
  const r=await cindy.node.request({method,params:args||{},timeoutMs:30000});
  return r.ok?r.result:{ok:false,errorCode:'WORKER_UNAVAILABLE',message:'The local service did not reply. Check status before repeating a launch.',execution:'unknown'};
}
cindy.onHostMessage(async msg=>{
  if(msg.type!=='tool-call')return;
  let result;
  try{result=await request(msg.tool,msg.args);}catch{result={ok:false,errorCode:'WORKER_UNAVAILABLE',message:'Check status before repeating this operation.',execution:'unknown'};}
  await cindy.send(result.ok?{type:'tool-result',callId:msg.callId,ok:true,result:result.data}:{type:'tool-result',callId:msg.callId,ok:false,errorCode:result.errorCode,message:result.message+' (execution: '+result.execution+')'});
});
// Same-origin pages of this plugin only. No cross-plugin channel or Host IPC.
const pages=new BroadcastChannel('test-environments-pages');
const replies=new Map();
pages.onmessage=async({data})=>{
  if(data?.type!=='request'||typeof data.id!=='string'||data.id.length>80)return;
  let work=replies.get(data.id);
  if(!work){work=(async()=>{try{return await request(data.method,data.args);}catch{return {ok:false,errorCode:'WORKER_UNAVAILABLE',message:'Check status before repeating this operation.'};}})();replies.set(data.id,work);setTimeout(()=>replies.delete(data.id),60000);}
  pages.postMessage({type:'response',id:data.id,result:await work});
};
