/* Official Cindy logic page. Host, not tool arguments, mints session_context. */
(() => {
  const next = operation => ({ghost_id:'agentcompass',tool:'status',args:{operation}});
  const terminal = new Set(['completed','failed','cancelled','interrupted']);
  const sameRoute = (a,b) => ['agentKind','providerId','model','effort','fastMode'].every(k=>a?.[k]===b?.[k]);
  async function node(msg,method,params) {
    const reply=await cindy.node.request({method,params:{...params,context:msg.args.session_context},
      callId:msg.callId,cancelWithCall:true,timeoutMs:120000});
    if (!reply.ok) throw Error(reply.message || 'Node bridge unavailable');
    return reply.result;
  }
  async function persist(msg,operation,record) {
    await node(msg,'save',{operation,record});
  }
  async function capabilities() {
    if (typeof cindy.tasks?.capabilities!=='function') throw Error('UNSUPPORTED: Cindy has no public tasks API. No worker started.');
    const caps=await cindy.tasks.capabilities();
    for (const op of ['models','create','send','get','getRun','listRuns','readMessages','cancel'])
      if (!caps.operations?.includes(op)) throw Error('UNSUPPORTED: Cindy tasks lacks '+op+'. No worker started.');
    if (!caps.exactRoute || !caps.createPermissionMode) throw Error('UNSUPPORTED: exact route and per-task permission are required.');
    return caps;
  }
  function selectRoute(bundle,catalog,mappings) {
    const kind={claude:'cc',codex:'codex',pi:'pi'}[bundle.harness];
    const binding=mappings.filter(m=>m.routerProvider===bundle.provider && m.routerAccount===bundle.account);
    if (binding.length>1) throw Error('Ambiguous configured account mapping');
    if (binding[0] && binding[0].agentKind!==kind) throw Error('Account mapping changes the routed harness');
    const providerId=binding[0]?.providerId || (bundle.provider===bundle.account ? bundle.provider : null);
    if (!kind || !providerId) throw Error('No explicit Cindy provider/account binding for routed account');
    const matches=[];
    for (const row of catalog.models || []) {
      const route=row.route;
      if (route?.agentKind!==kind || route.providerId!==providerId || route.model!==(bundle.launch_model || bundle.model)) continue;
      const effort=bundle.effort || '';
      if (route.effort!==effort && !row.efforts?.includes(effort)) continue;
      const fast=Boolean(bundle.fast);
      if (fast && !row.supportsFastMode) continue;
      matches.push({...route,effort,fastMode:fast});
    }
    if (matches.length!==1) throw Error('Exact routed harness/account/model/effort is unavailable or ambiguous in Cindy catalog');
    const expected={claude:'bypassPermissions',codex:'full-access',pi:'full-access'}[bundle.harness];
    if (bundle.modeId!==expected) throw Error('Cindy adapter cannot reproduce routed permission mode; reroute');
    return matches[0];
  }
  async function collect(msg,operation,record) {
    if (record.state==='cleaned') return {status:'cleaned',operation,next_action:'The old task is archived. New work needs a new assignment.'};
    if (!record.runId) return {status:record.state,operation,next_tool:next(operation),
      cause:'No confirmed run receipt. Inspect the Cindy task; do not resend unknown delivery.'};
    const run=await cindy.tasks.getRun({runId:record.runId});
    record.run=run;
    record.state=run.status;
    if (terminal.has(run.status)) {
      for (let i=0;i<10 && !record.messagesComplete;i++) {
        const page=await cindy.tasks.readMessages({taskId:record.taskId,limit:100,
          ...(record.messageCursor ? {after:record.messageCursor} : {})});
        const {artifact}=await node(msg,'output',{operation,page});
        (record.artifacts ||= []).push(artifact);
        const final=page.items?.find(item=>item.id===run.outputMessageId);
        if (final) record.finalMessage=final;
        record.messageCursor=page.nextCursor;
        record.messagesComplete=!page.nextCursor;
        await persist(msg,operation,record);
      }
    }
    await persist(msg,operation,record);
    const text=record.finalMessage ? (typeof record.finalMessage.content==='string' ? record.finalMessage.content : JSON.stringify(record.finalMessage.content)) : '';
    return {status:run.status,operation,taskId:record.taskId,runId:run.runId,
      error:run.error || null,outputMessageId:run.outputMessageId || null,
      output_available:Boolean(record.finalMessage),messages_complete:Boolean(record.messagesComplete),
      final_result_summary:text.slice(0,4000),summary_shortened:text.length>4000,
      full_result_artifacts:record.artifacts || [],next_tool:next(operation),
      next_action:terminal.has(run.status) ? 'Read the exact output message/artifacts. Cleanup archives when supported, otherwise gives the confirmed task ID for manual archiving in Cindy.' :
        'No automatic callback. Call next_tool to collect this same run; stop requests scoped cancellation.'};
  }
  async function handle(msg) {
    const ctx=msg.args?.session_context;
    if (!ctx?.session_id || !ctx.workdir_is_local || ctx.workdir_is_read_only!==false)
      throw Error('Host-verified writable local session_context is required; remote/read-only contexts are unsupported.');
    const caps=await capabilities();
    const canArchive=caps.operations.includes('archive') && typeof cindy.tasks.archive==='function';
    let operation=msg.args.operation;
    let record;
    if (msg.tool==='roll') {
      const prepared=await node(msg,'prepare',{task:msg.args.task});
      operation=prepared.operation;
      record=prepared;
      // self, split or a router-side launch: the router's own answer, not a Cindy task.
      if (record.router.status!=='native') return record.router;
      if (record.state!=='prepared') return await collect(msg,operation,record);
      const route=selectRoute(record.bundle,await cindy.tasks.models(),record.mappings);
      if (!record.prompt || record.prompt.length>32768) throw Error('Full task plus return contract exceeds Cindy send limit (32768 characters); nothing launched.');
      record.route=route;
      record.createRequest={requestKey:operation+':create',title:'AgentCompass '+operation.slice(0,12),route,permissionMode:'bypassPermissions'};
      record.state='creating';
      await persist(msg,operation,record);
      let task;
      try {task=await cindy.tasks.create(record.createRequest);} catch(error) {
        record.state='unknown_create';record.error=error.message;await persist(msg,operation,record);
        return {status:record.state,operation,error:record.error,next_tool:next(operation)};
      }
      record.taskId=task.taskId;
      if (!sameRoute(task.resolvedConfig,route) || task.permissionMode!=='bypassPermissions' ||
          task.planModeEnabled || task.workingDir!==ctx.workdir) {
        record.state='blocked';record.error='Created draft has different route/permissions/workdir. Configure plugin task directory to the current project; no model input sent.';
        if (canArchive) {
          try {await cindy.tasks.archive({taskId:task.taskId});record.draft_cleanup='archived';}
          catch(error) {record.draft_cleanup='needs_cleanup';record.cleanup_error=error.message;}
        } else {
          record.draft_cleanup='manual_cleanup_required';
          record.cleanup_error='Cindy has no public archive API. Archive this confirmed idle draft in the Cindy task list.';
        }
        await persist(msg,operation,record);
        return {status:'blocked',operation,taskId:task.taskId,error:record.error,
          draft_cleanup:record.draft_cleanup,cleanup_error:record.cleanup_error || null,
          next_tool:{ghost_id:'agentcompass',tool:'cleanup',args:{operation}}};
      }
      record.sendRequest={taskId:task.taskId,expectedRevision:task.revision,requestKey:operation+':send',text:record.prompt};
      record.state='sending';
      await persist(msg,operation,record);
      try {
        const run=await cindy.tasks.send(record.sendRequest);
        record.runId=run.runId;record.state=run.status;
      } catch(error) {record.state='unknown_send';record.error=error.message;}
      await persist(msg,operation,record);
      return {status:record.state,operation,taskId:record.taskId,runId:record.runId || null,
        error:record.error || null,automatic_callback:false,next_tool:next(operation)};
    }
    record=await node(msg,'load',{operation});
    if (record.state==='unknown_send' && record.taskId) {
      const page=await cindy.tasks.listRuns({taskId:record.taskId,limit:100});
      // This newly-created task receives only this one plugin input. Never guess from timestamps.
      if (!page.nextCursor && page.items?.length===1 && sameRoute(page.items[0].acceptedConfig,record.route)) {
        record.runId=page.items[0].runId;
        await persist(msg,operation,record);
      }
    }
    if (msg.tool==='stop') {
      if (!record.runId) throw Error('No confirmed run to cancel. Inspect the Cindy task; unknown delivery is not resent.');
      const run=await cindy.tasks.cancel({runId:record.runId,requestKey:operation+':cancel'});
      record.state=run.status;await persist(msg,operation,record);
      return {status:run.status,operation,next_tool:next(operation)};
    }
    if (msg.tool==='cleanup') {
      if (record.state==='cleaned') return {status:'cleaned',operation};
      const run=record.runId ? await cindy.tasks.getRun({runId:record.runId}) : null;
      if (run && !terminal.has(run.status)) throw Error('Run is still active; stop and collect its terminal state first.');
      if (!record.taskId) throw Error('No confirmed task to archive');
      if (!canArchive) return {status:'manual_cleanup_required',operation,taskId:record.taskId,
        run_status:run?.status || null,archived:false,
        next_action:'Cindy has no public archive API. Archive this confirmed inactive task in the Cindy task list. History and the operation receipt are retained; do not resend the assignment.'};
      await cindy.tasks.archive({taskId:record.taskId});
      record.state='cleaned';await persist(msg,operation,record);
      return {status:'cleaned',operation};
    }
    if (msg.tool!=='status') throw Error('Unsupported tool');
    return await collect(msg,operation,record);
  }
  // One logic page serves all sessions. Serialize each mutation and its durable receipt.
  let queue=Promise.resolve();
  cindy.onHostMessage(msg=>{
    if (msg.type!=='tool-call') return;
    queue=queue.then(async()=>{
      try {cindy.send({type:'tool-result',callId:msg.callId,ok:true,result:await handle(msg)});}
      catch(error) {cindy.send({type:'tool-result',callId:msg.callId,ok:false,errorCode:'ROUTER_BLOCKED',
        message:error.message+' Check plugin permissions, task directory and exact account mapping; no automatic retry.'});}
    });
  });
})();
