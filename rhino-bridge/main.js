const actions = { rhino_status: 'status', rhino_objects: 'objects', rhino_create: 'create', rhino_transform: 'transform', rhino_create_layer: 'create_layer', rhino_assign_layer: 'assign_layer', rhino_operation_result: 'operation_result' };
function backendOf(cfg) {
  if (cfg.backend) return cfg.backend;
  // Preserve the previous version's configured port on upgrade.
  return Object.prototype.hasOwnProperty.call(cfg,'port') ? 'legacy' : 'official';
}
async function invoke(action, args, callId) {
  let dispatched=false;
  try {
  const response = await fetch('/kv');
  if (!response.ok) throw new Error('无法读取插件设置，请重新打开设置页。');
  const cfg=await response.json(), backend=backendOf(cfg);
  let request;
  if (backend==='official') {
    if (!['status','official_list','official_call'].includes(action)) return {ok:false,code:'BRIDGE_MODE',message:'当前为 McNeel 官方模式。请使用 rhino_official_tools 和 rhino_official_call；基础工具仅用于旧版连接器。'};
    request={method:'official/request',params:{config:{routerPath:cfg.routerPath,version:cfg.rhinoVersion ?? '8'},operation:action==='status'?'status':action==='official_list'?'list':'call',args},timeoutMs:110000};
  } else if (backend==='legacy') {
    if (action.startsWith('official_')) return {ok:false,code:'BRIDGE_MODE',message:'当前为基础连接模式。请在设置页切换到 McNeel 官方模式后再调用。'};
    request={method:'rhino/request',params:{action,args,port:cfg.port ?? 19986},timeoutMs:22000};
  } else return {ok:false,code:'BRIDGE_MODE',message:'连接模式无效，请在设置页重新选择。'};
  if(callId){request.callId=callId;request.cancelWithCall=true;}
  dispatched=true;
  const result=await cindy.node.request(request);
  if(!result.ok) return {ok:false,code:'BRIDGE_HOST',operation_id:args.operation_id,message:(result.message || '连接组件调用失败。')+' 若已提交修改，请核对 Rhino 模型，勿直接重试。'};
  return result.result;
  } catch(error) {
    error.executionState=dispatched?'unknown':'not_executed';
    throw error;
  }
}
async function renderOfficial(result,callId){
  if(!result.mcp) return result;
  const images=[],content=[];
  for(const block of result.mcp.content || []){
    if(block.type==='image'){
      if(!['image/png','image/jpeg','image/webp'].includes(block.mimeType) || typeof block.data!=='string'){
        content.push({type:'text',text:'此图片格式未显示。'}); continue;
      }
      try{
        const deposited=await cindy.send({type:'cindy-request',kind:'deposit_media',data:block.data,label:'Rhino 官方视口截图',callId});
        if(deposited.ok && deposited.url){images.push(deposited.url);content.push({type:'text',text:'视口截图已附在结果中。'});}
        else content.push({type:'text',text:'截图已获取，但未能显示。请检查媒体库容量后重新获取小尺寸截图。'});
      }catch{content.push({type:'text',text:'截图回显失败，工具可能已完成；请核对其他返回内容。'});}
    }else content.push(block);
  }
  const rendered={...result,mcp:{...result.mcp,content}};
  if(images.length)rendered.xdt_image_urls=images;
  return rendered;
}
cindy.onHostMessage(async msg=>{
  if(msg.type!=='tool-call')return;
  try{
    const action=msg.tool==='rhino_official_tools'?'official_list':msg.tool==='rhino_official_call'?'official_call':Object.prototype.hasOwnProperty.call(actions,msg.tool)?actions[msg.tool]:null;
    if(!action)throw new Error('工具不存在，请重新读取插件工具列表。');
    const result=await renderOfficial(await invoke(action,msg.args||{},msg.callId),msg.callId);
    if(!result.ok && !result.mcp){
      const executionState=result.executionState||(result.code==='BRIDGE_MODE'?'not_executed':'unknown');
      await cindy.send({type:'tool-result',callId:msg.callId,ok:false,errorCode:result.code||'BRIDGE_FAILED',executionState,message:result.message+(result.operation_id?' 操作编号：'+result.operation_id:'')});
      return;
    }else{
      // MCP business failures retain their exact structured details; result.ok remains false.
      await cindy.send({type:'tool-result',callId:msg.callId,ok:true,result});
    }
  }catch(error){await cindy.send({type:'tool-result',callId:msg.callId,ok:false,errorCode:'BRIDGE_FAILED',message:'插件调用未完成。'+error.message+' 若已提交修改，请先核对 Rhino 模型。'});}
});
const settingsChannel=new BroadcastChannel('rhino-bridge-settings');
let checking=false;
settingsChannel.onmessage=async({data})=>{
  if(data?.type!=='check'||typeof data.id!=='string'||checking)return;
  checking=true;
  try{settingsChannel.postMessage({type:'checked',id:data.id,result:await invoke('status',{})});}
  catch{settingsChannel.postMessage({type:'checked',id:data.id,result:{ok:false,message:'检测失败，请核对所选模式的连接配置。'}});}
  finally{checking=false;}
};
