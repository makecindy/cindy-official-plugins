/* Official Cindy logic page. Host, not tool arguments, mints session_context. */
(() => {
  const next = (tool,operation) => ({ghost_id:'agentcompass',tool,args:{operation}});
  const terminal = new Set(['completed','failed','cancelled','interrupted']);
  // Receipts whose delivery is not proven either way: never resent, never treated as idle.
  const UNCONFIRMED = new Set(['creating','unknown_create','sending','unknown_send']);
  // Host refusals of tasks.send. Cindy checks these before it stores the run, so the input was never accepted.
  const REJECTED = new Set(['REVISION_CONFLICT','TASK_BUSY','INVALID_REQUEST','INVALID_ATTACHMENTS','PERMISSION_DENIED',
    'ROUTE_UNAVAILABLE','NOT_FOUND','TASK_NOT_FOUND','UNSUPPORTED_CAPABILITY','INVALID_INVOCATION']);
  const sameRoute = (a,b) => ['agentKind','providerId','model','effort','fastMode'].every(k=>a?.[k]===b?.[k]);
  const text = content => typeof content==='string' ? content :
    Array.isArray(content) ? content.map(part=>typeof part==='string' ? part :
      typeof part?.text==='string' ? part.text : typeof part?.input_text==='string' ? part.input_text :
      typeof part?.content==='string' ? part.content : JSON.stringify(part ?? '')).join('') :
    typeof content?.text==='string' ? content.text : JSON.stringify(content ?? '');
  const pause = ms => new Promise(resolve=>typeof setTimeout==='function' ? setTimeout(resolve,ms) : resolve());
  // Calls of one key run one at a time; different keys never wait for each other.
  const locks = new Map();
  function exclusive(key,work) {
    const run=(locks.get(key) || Promise.resolve()).then(()=>work());
    const tail=run.catch(()=>{});
    locks.set(key,tail);
    tail.then(()=>{if (locks.get(key)===tail) locks.delete(key);});
    return run;
  }
  async function node(msg,method,params) {
    const reply=await cindy.node.request({method,params:{...params,context:msg.args.session_context},
      callId:msg.callId,cancelWithCall:true,timeoutMs:120000});
    if (!reply.ok) throw Error(reply.message || 'Node bridge unavailable');
    return reply.result;
  }
  const memory = new Map();
  async function persist(msg,operation,record) {
    await node(msg,'save',{operation,record});
    memory.delete(operation);
  }
  async function tryPersist(msg,operation,record) {
    try {await persist(msg,operation,record);return null;}
    catch(error) {memory.set(operation,JSON.parse(JSON.stringify(record)));return error.message || String(error);}
  }
  async function loadRecord(msg,operation) {
    const disk=await node(msg,'load',{operation});
    const mem=memory.get(operation);
    if (mem && mem.parent===disk.parent && (!disk.taskId || (mem.messagesComplete && !disk.messagesComplete) || mem.state==='cleaned')) {
      await tryPersist(msg,operation,mem);
      return JSON.parse(JSON.stringify(mem));
    }
    return disk;
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
    let providerId=bundle.providerId;
    // The built-in engine names the catalog connection itself; the external router names its account.
    if (!providerId) {
      const binding=mappings.filter(m=>m.routerProvider===bundle.provider && m.routerAccount===bundle.account);
      if (binding.length>1) throw Error('Ambiguous configured account mapping');
      if (binding[0] && binding[0].agentKind!==kind) throw Error('Account mapping changes the routed harness');
      providerId=binding[0]?.providerId || (bundle.provider===bundle.account ? bundle.provider : null);
    }
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
  async function allRuns(taskId) {
    const runs=[];
    let after=null;
    for (let i=0;i<20;i++) {
      const page=await cindy.tasks.listRuns({taskId,limit:100,...(after ? {after} : {})});
      runs.push(...(page.items || []));
      if (!page.nextCursor) return runs;
      after=page.nextCursor;
    }
    throw Error('Task '+taskId+' has more runs than this plugin reads; inspect it in Cindy.');
  }
  // A run belongs to this operation only if its input message is this operation's prompt. Route and run count alone
  // do not prove it: someone else may have written to the draft with the same configuration.
  async function carriesPrompt(record,run) {
    let after=null;
    for (let i=0;i<20;i++) {
      const page=await cindy.tasks.readMessages({taskId:record.taskId,limit:100,...(after ? {after} : {})});
      const input=run.inputMessageId ? page.items?.find(item=>item.id===run.inputMessageId) :
        page.items?.find(item=>item.role==='user');
      if (input) return input.role==='user' && text(input.content).includes(record.prompt);
      if (!page.nextCursor) return false;
      after=page.nextCursor;
    }
    return false;
  }
  // Settle what a crash, a lost answer or a failed save left behind, from the host's durable records. Nothing is resent.
  // Callers hold the operation's lock, so a `sending` receipt seen here is not being sent by this page.
  async function reconcile(msg,operation,record) {
    if (record.state==='creating' && !record.taskId) {
      record.state='unknown_create';
      record.error ||= 'The create answer was never recorded. Inspect the Cindy task list; nothing is created again.';
      await tryPersist(msg,operation,record);
      return record;
    }
    if (!['sending','unknown_send'].includes(record.state) || record.runId || !record.taskId) return record;
    const runs=(await allRuns(record.taskId)).filter(run=>sameRoute(run.acceptedConfig,record.route));
    for (const run of runs) {
      if (!await carriesPrompt(record,run)) continue;
      record.runId=run.runId;record.state=run.status;record.delivery='reconciled';
      await tryPersist(msg,operation,record);
      return record;
    }
    if (record.state==='sending') {
      record.state='unknown_send';
      record.error ||= 'The send answer was never recorded and no run of task '+record.taskId+' carries this prompt yet.';
      await tryPersist(msg,operation,record);
    }
    return record;
  }
  // A created draft that received no plugin input: archived when Cindy can, otherwise handed back for manual archiving.
  async function discardDraft(record,canArchive) {
    if (canArchive) {
      try {await cindy.tasks.archive({taskId:record.taskId});record.draft_cleanup='archived';}
      catch(error) {record.draft_cleanup='needs_cleanup';record.cleanup_error=error.message;}
    } else {
      record.draft_cleanup='manual_cleanup_required';
      record.cleanup_error='Cindy has no public archive API. Archive this draft, which received no plugin input, in the Cindy task list.';
    }
  }
  function unconfirmed(record,operation) {
    const why={unknown_create:'Cindy may have created the draft, but its answer never arrived. Inspect the Cindy task list; nothing is created again.',
      unknown_send:'Delivery to task '+record.taskId+' is unconfirmed. Status keeps checking its durable runs; the input is never resent.',
      sending:'The send of task '+record.taskId+' is in progress or unconfirmed.',
      creating:'The draft is being created.'}[record.state];
    return {status:record.state,operation,taskId:record.taskId || null,error:record.error || null,next_tool:next('status',operation),
      next_action:why};
  }
  async function collect(msg,operation,record) {
    if (record.state==='cleaned') return {status:'cleaned',operation,next_action:'The old task is archived. New work needs a new assignment.'};
    if (!record.runId) {
      if (UNCONFIRMED.has(record.state)) return unconfirmed(record,operation);
      if (['blocked','send_rejected'].includes(record.state)) return {status:record.state,operation,taskId:record.taskId || null,
        error:record.error || null,draft_cleanup:record.draft_cleanup || null,next_tool:next('cleanup',operation),
        next_action:'No input was accepted. Cleanup archives or hands back the draft.'};
      return {status:record.state,operation,next_tool:next('status',operation),
        cause:'No Cindy task was started for this operation yet.'};
    }
    const run=await cindy.tasks.getRun({runId:record.runId});
    record.run=run;
    record.state=run.status;
    let saveError=null;
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
        saveError=(await tryPersist(msg,operation,record)) || saveError;
      }
    }
    saveError=(await tryPersist(msg,operation,record)) || saveError;
    const output=record.finalMessage ? text(record.finalMessage.content) : '';
    const done=terminal.has(run.status) && Boolean(record.messagesComplete);
    return {status:run.status,operation,taskId:record.taskId,runId:run.runId,
      error:run.error || null,outputMessageId:run.outputMessageId || null,
      output_available:Boolean(record.finalMessage),messages_complete:Boolean(record.messagesComplete),
      message_pages_read:(record.artifacts || []).length,
      final_result_summary:output.slice(0,4000),summary_shortened:output.length>4000,
      full_result_artifacts:record.artifacts || [],
      ...(saveError ? {receipt_saved:false,receipt_error:saveError} : {}),
      next_tool:next(done ? 'cleanup' : 'status',operation),
      next_action:done ? 'Read the exact output message/artifacts. Cleanup archives when supported, otherwise gives the confirmed task ID for manual archiving in Cindy.' :
        terminal.has(run.status) ? 'The run is '+run.status+' but its messages are not all collected yet. Call status again to read the remaining pages; do not clean up before messages_complete is true.' :
        'No automatic callback. Call next_tool to collect this same run; stop requests scoped cancellation.'};
  }
  async function roll(msg,ctx,canArchive) {
    // The catalog the built-in engine routes over: exactly what this Cindy can run now.
    const prepared=await node(msg,'prepare',{task:msg.args.task,catalog:await cindy.tasks.models()});
    const operation=prepared.operation;
    // self, split or a router-side launch: the router's own answer, not a Cindy task.
    if (prepared.router?.status!=='native' && prepared.state==='prepared') return prepared.router;
    return await exclusive('op\0'+operation,async()=>{
      let record=await loadRecord(msg,operation);
      if (record.state!=='prepared') return await collect(msg,operation,await reconcile(msg,operation,record));
      const route=selectRoute(record.bundle,await cindy.tasks.models(),record.mappings);
      if (!record.prompt || record.prompt.length>32768) throw Error('Full task plus return contract exceeds Cindy send limit (32768 characters); nothing launched.');
      record.route=route;
      record.createRequest={requestKey:operation+':create',title:'AgentCompass '+operation.slice(0,12),route,permissionMode:'bypassPermissions'};
      record.state='creating';
      await persist(msg,operation,record);
      let task;
      try {task=await cindy.tasks.create(record.createRequest);} catch(error) {
        record.state='unknown_create';record.error=error.message;
        const saveError=await tryPersist(msg,operation,record);
        return {status:record.state,operation,error:record.error,
          ...(saveError ? {receipt_saved:false,receipt_error:saveError} : {}),next_tool:next('status',operation)};
      }
      record.taskId=task.taskId;
      if (!sameRoute(task.resolvedConfig,route) || task.permissionMode!=='bypassPermissions' ||
          task.planModeEnabled || task.workingDir!==ctx.workdir) {
        record.state='blocked';record.error='Created draft has different route/permissions/workdir. Configure plugin task directory to the current project; no model input sent.';
        await discardDraft(record,canArchive);
        const saveError=await tryPersist(msg,operation,record);
        return {status:'blocked',operation,taskId:task.taskId,task_id:task.taskId,error:record.error,
          draft_cleanup:record.draft_cleanup,cleanup_error:record.cleanup_error || null,
          ...(saveError ? {receipt_saved:false,receipt_error:saveError} : {}),next_tool:next('cleanup',operation)};
      }
      record.sendRequest={taskId:task.taskId,expectedRevision:task.revision,requestKey:operation+':send',text:record.prompt};
      record.state='sending';
      const preSendError=await tryPersist(msg,operation,record);
      if (preSendError) {
        record.state='blocked';
        record.error='Created draft could not be recorded before send: '+preSendError;
        await discardDraft(record,canArchive);
        await tryPersist(msg,operation,record);
        return {status:'blocked',operation,taskId:task.taskId,task_id:task.taskId,runId:null,run_id:null,
          error:record.error,draft_cleanup:record.draft_cleanup,cleanup_error:record.cleanup_error || null,
          receipt_saved:false,receipt_error:preSendError,next_tool:next('cleanup',operation)};
      }
      let run, failure;
      try {run=await cindy.tasks.send(record.sendRequest);} catch(error) {failure=error;}
      if (run) {record.runId=run.runId;record.state=run.status;record.delivery='accepted';}
      else {
        record.error=failure?.message || String(failure);record.errorCode=failure?.code || null;
        // A refusal Cindy makes before storing the run, confirmed by the task having no run at all.
        let idle=false;
        if (REJECTED.has(record.errorCode)) try {idle=(await allRuns(task.taskId)).length===0;} catch {}
        if (idle) {record.state='send_rejected';await discardDraft(record,canArchive);}
        else record.state='unknown_send';
      }
      // The run exists even when its receipt cannot be saved: hand back the handles instead of failing the call.
      // The receipt on disk then says `sending`, which status settles from the host's runs without resending.
      const saveError=await tryPersist(msg,operation,record);
      return {status:record.state,operation,taskId:record.taskId,runId:record.runId || null,
        task_id:record.taskId,run_id:record.runId || null,
        error:record.error || null,error_code:record.errorCode || null,automatic_callback:false,
        ...(record.state==='send_rejected' ? {draft_cleanup:record.draft_cleanup,cleanup_error:record.cleanup_error || null} : {}),
        ...(saveError ? {receipt_saved:false,receipt_error:saveError} : {}),
        next_tool:next(record.state==='send_rejected' ? 'cleanup' : 'status',operation)};
    });
  }
  async function stop(msg,operation,record) {
    record=await reconcile(msg,operation,record);
    if (!record.runId) throw Error('No confirmed run to cancel. Inspect the Cindy task; unknown delivery is not resent.');
    let run=await cindy.tasks.cancel({runId:record.runId,requestKey:operation+':cancel'});
    // Cindy stops a turn at its next safe point: wait a bounded time for the confirmed terminal state, then say which.
    for (let i=0;i<10 && !terminal.has(run.status);i++) {await pause(1000);run=await cindy.tasks.getRun({runId:record.runId});}
    record.state=run.status;const saveError=await tryPersist(msg,operation,record);
    return {status:run.status,operation,taskId:record.taskId,runId:record.runId,task_id:record.taskId,run_id:record.runId,
      confirmed_terminal:terminal.has(run.status),
      ...(saveError ? {receipt_saved:false,receipt_error:saveError} : {}),
      next_tool:next('status',operation),
      next_action:terminal.has(run.status) ? 'Cindy confirmed the run '+run.status+'. Call status to collect its messages, then cleanup.' :
        'Cindy accepted the cancellation but the run is still '+run.status+': a command already in flight finishes first. Call status until the run is terminal.'};
  }
  async function cleanup(msg,operation,record,canArchive) {
    if (record.state==='cleaned') return {status:'cleaned',operation};
    record=await reconcile(msg,operation,record);
    const refuse=(reason,tool='status')=>({status:'cleanup_refused',operation,taskId:record.taskId || null,state:record.state,
      archived:false,reason,next_tool:next(tool,operation)});
    if (!record.taskId) return refuse(record.state==='unknown_create' ? unconfirmed(record,operation).next_action :
      'No Cindy task was created for this operation; there is nothing to archive.');
    if (UNCONFIRMED.has(record.state)) return refuse(unconfirmed(record,operation).next_action);
    // Idle means every run of the task is terminal: this operation's and any other input written to it.
    const active=(await allRuns(record.taskId)).filter(run=>!terminal.has(run.status));
    if (record.runId) {
      const run=await cindy.tasks.getRun({runId:record.runId});
      if (!terminal.has(run.status) && !active.some(r=>r.runId===run.runId)) active.push(run);
    }
    if (active.length) return refuse('Run '+active.map(r=>r.runId+' is '+r.status).join(', ')+'; stop it and collect its terminal state first.',
      record.runId ? 'stop' : 'status');
    if (record.runId && !record.messagesComplete)
      return refuse('The run is finished but its messages are not all collected. Call status until messages_complete is true.');
    if (record.draft_cleanup==='archived') {
      record.state='cleaned';const saveError=await tryPersist(msg,operation,record);
      return {status:'cleaned',operation,taskId:record.taskId,task_id:record.taskId,
        ...(saveError ? {receipt_saved:false,receipt_error:saveError} : {})};
    }
    if (!canArchive) return {status:'manual_cleanup_required',operation,taskId:record.taskId,
      run_status:record.run?.status || null,archived:false,
      next_action:'Cindy has no public archive API. Archive this confirmed inactive task in the Cindy task list. History and the operation receipt are retained; do not resend the assignment.'};
    await cindy.tasks.archive({taskId:record.taskId});
    record.state='cleaned';const saveError=await tryPersist(msg,operation,record);
    return {status:'cleaned',operation,taskId:record.taskId,task_id:record.taskId,
      ...(saveError ? {receipt_saved:false,receipt_error:saveError} : {})};
  }
  async function handle(msg) {
    const ctx=msg.args?.session_context;
    if (!ctx?.session_id || !ctx.workdir_is_local || ctx.workdir_is_read_only!==false)
      throw Error('Host-verified writable local session_context is required; remote/read-only contexts are unsupported.');
    const caps=await capabilities();
    const canArchive=caps.operations.includes('archive') && typeof cindy.tasks.archive==='function';
    // Routing one roll holds only that assignment's lock: other sessions and other operations go on meanwhile.
    if (msg.tool==='roll') return await exclusive('roll\0'+ctx.session_id+'\0'+String(msg.args.task),()=>roll(msg,ctx,canArchive));
    if (!['status','stop','cleanup'].includes(msg.tool)) throw Error('Unsupported tool');
    const operation=msg.args.operation;
    return await exclusive('op\0'+operation,async()=>{
      const record=await loadRecord(msg,operation);
      if (msg.tool==='stop') return await stop(msg,operation,record);
      if (msg.tool==='cleanup') return await cleanup(msg,operation,record,canArchive);
      return await collect(msg,operation,await reconcile(msg,operation,record));
    });
  }
  cindy.onHostMessage(msg=>{
    if (msg.type!=='tool-call') return;
    handle(msg).then(
      result=>cindy.send({type:'tool-result',callId:msg.callId,ok:true,result}),
      error=>cindy.send({type:'tool-result',callId:msg.callId,ok:false,errorCode:'ROUTER_BLOCKED',
        message:error.message+' Check plugin permissions, task directory and exact account mapping; no automatic retry.'}));
  });
})();
