cindy.onHostMessage(async function (msg) {
  if (msg.type !== 'tool-call') return;
  try {
    let locale='en';
    try { const context=await cindy.request({kind:'app-context'}); if(context?.context?.locale==='zh-CN')locale='zh-CN'; } catch {}
    // Host ceiling is 120s; worker preflight is 3s + 5s.
    // Boot retains 15s start + 90s readiness (113s total).
    const response = await cindy.node.request({method: msg.tool, params: {...msg.args,_locale:locale}, timeoutMs: 120000});
    if (!response.ok) {
      await cindy.send({type:'tool-result',callId:msg.callId,ok:false,errorCode:'NODE_REQUEST_FAILED',message:response.message || 'Worker failed; execution may be unknown. Inspect device before retrying.'});
      return;
    }
    const result=response.result;
    const viewer=result.viewer || (msg.tool==='open_viewer' ? result : null);
    if(result.ok && viewer && viewer.ready && viewer.url) {
      try {
        const opened=await cindy.preview({url:viewer.url,sessionId:msg.args?.session_context?.session_id});
        viewer.previewOpened=opened.ok===true;
        viewer.location='Cindy 侧边栏浏览器';
        if(!opened.ok) viewer.previewError=opened.message || opened.errorCode || 'Preview did not open';
      } catch(error) {viewer.previewOpened=false;viewer.previewError=String(error.message || error);}
    }
    await cindy.send(result.ok ? {type:'tool-result',callId:msg.callId,ok:true,result:result} : {type:'tool-result',callId:msg.callId,ok:false,errorCode:result.errorCode,message:result.message+' (execution: '+result.execution+')'});
  } catch (error) {
    await cindy.send({type:'tool-result',callId:msg.callId,ok:false,errorCode:'BRIDGE_FAILED',message:String(error.message || error)+'; execution unknown, inspect before retrying.'});
  }
});
