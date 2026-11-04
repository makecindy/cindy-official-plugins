// AgentCompass plugin (agentcompass/). Source and full sandbox suite: https://github.com/akiiwa-games/cindy-agentcompass-plugin
// Part 1: main.js at the official tasks API boundary with a fixture host (exact route and permission per harness,
//         fast mode, unchanged task, idempotent create/send, honest stop/cancel/cleanup, PR #274 regressions).
// Part 2: the built-in routing engine (agentcompass/engine/route.mjs) over the catalog a real Cindy 0.1.121 reported.
// Part 3: the real worker.cjs as a node child over JSON-RPC stdio: zero-configuration built-in routing, and the
//         opted-in external CLI (`router.json` or `config.json {"engine":"cli"}`).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {codexHomes, codexQuota, routeTask, selfGate, splitGate} from '../agentcompass/engine/route.mjs';

const source=fs.readFileSync(new URL('../agentcompass/main.js',import.meta.url),'utf8');
const ctx={session_id:'true-parent',workdir:'E:/project',workdir_is_local:true,workdir_is_read_only:false};
const route={agentKind:'codex',providerId:'codex',model:'gpt-test',effort:'high',fastMode:false};
const PROMPT='完整原文\r\nunchanged';
const opOf=(session,task)=>crypto.createHash('sha256').update(session+'\0'+task).digest('hex').slice(0,40);
const coded=(code,message=code)=>Object.assign(Error(message),{code});

function fixture(options={}) {
  const records=new Map(), streams=new Map(), calls=[], messages=[], waiters=new Map();
  let handler, serial=0, prepares=0;
  const task={taskId:'child-task',revision:4,resolvedConfig:{...route},permissionMode:'bypassPermissions',workingDir:ctx.workdir};
  const run={runId:'run-1',taskId:task.taskId,status:'running',acceptedConfig:route,inputMessageId:'plugin-task:run-1'};
  const host={runs:[run],pages:2,input:PROMPT};
  const cindy={
    node:{request:async request=>{
      if (Buffer.byteLength(JSON.stringify(request),'utf8')>256*1024)
        return {ok:false,message:'Host node request exceeds 256 KiB limit'};
      calls.push(['node',request.method]);
      const {method,params}=request;
      if (method==='prepare') {
        calls.push(['prepare',{task:params.task,catalog:params.catalog}]);
        if (options.prepareGate) await options.prepareGate(params.task,params.context);
        const operation=opOf(params.context.session_id,params.task);
        prepares++;
        const fresh=typeof options.prepared==='function' ? options.prepared(prepares) : options.prepared;
        if (!records.has(operation) || records.get(operation).state==='prepared') records.set(operation,fresh || {parent:params.context.session_id,state:'prepared',
          bundle:{provider:'codex',account:'codex',harness:'codex',model:'gpt-test',effort:'high',modeId:'full-access'},
          prompt:PROMPT,router:{status:'native'},mappings:[]});
        return {ok:true,result:{operation,...structuredClone(records.get(operation))}};
      }
      const record=records.get(params.operation);
      if (record?.parent!==params.context.session_id) return {ok:false,message:'parent ownership mismatch'};
      if (method==='save') {
        if (options.saveFails?.(params.record)) return {ok:false,message:'disk full'};
        records.set(params.operation,structuredClone(params.record));return {ok:true,result:{saved:true}};
      }
      if (method==='load') return {ok:true,result:structuredClone(record)};
      if (method==='output') {
        if (typeof params.chunk==='string') {
          const key=params.operation+'\0'+String(params.stream || '');
          const list=params.index===0 ? [] : (streams.get(key) || []);
          list.push(params.chunk);
          if (!params.done) {streams.set(key,list);return {ok:true,result:{artifact:null,partial:true}};}
          streams.delete(key);
          JSON.parse(list.join(''));
        }
        return {ok:true,result:{artifact:'/test/full-message-page-'+(serial++)+'.json'}};
      }
      throw Error('unexpected node method');
    }},
    tasks:{
      capabilities:async()=>({operations:['models','create','send','get','getRun','listRuns','readMessages','cancel','archive'],exactRoute:true,createPermissionMode:true}),
      models:async()=>({models:[{route,efforts:['high'],supportsFastMode:true}]}),
      create:async request=>{calls.push(['create',structuredClone(request)]);return structuredClone(task);},
      send:async request=>{calls.push(['send',structuredClone(request)]);if(options.sendError) throw options.sendError;if(options.uncertain) throw Error('DELIVERY_UNCERTAIN');return structuredClone(run);},
      getRun:async request=>{calls.push(['getRun',request]);return structuredClone(host.runs.find(r=>r.runId===request.runId));},
      listRuns:async()=>{calls.push(['listRuns']);return {items:structuredClone(host.runs),nextCursor:null};},
      readMessages:async request=>{
        calls.push(['readMessages',request]);
        const index=request.after ? Number(request.after.slice('page-'.length)) : 0;
        const last=index>=host.pages-1;
        const items=index===0 ? [{id:'plugin-task:run-1',role:'user',content:host.input},{id:'unrelated',role:'assistant',content:'wrong output'}] :
          [{id:last ? 'out-exact' : 'noise-'+index,role:'assistant',content:last ? (host.output ?? '[Worker final report] '+'实'.repeat(6000)) : 'page '+index}];
        return {items,nextCursor:last ? null : 'page-'+(index+1)};
      },
      cancel:async request=>{calls.push(['cancel',request]);run.status=options.cancelTo || 'stopping';return structuredClone(run);},
      archive:async request=>{calls.push(['archive',request]);return task;}
    },
    onHostMessage:callback=>{handler=callback;},
    send:message=>{messages.push(message);waiters.get(message.callId)?.(message);}
  };
  vm.runInNewContext(source,{cindy,Set,Boolean,Error,JSON,Array});
  const send=(tool,args={},context=ctx)=>new Promise(resolve=>{
    const callId='call-'+(++serial);waiters.set(callId,resolve);
    handler({type:'tool-call',tool,callId,args:{...args,session_context:context}});
  });
  const count=name=>calls.filter(c=>c[0]===name).length;
  return {cindy,task,run,host,send,calls,records,count};
}
const noArchive=f=>{
  const capabilities=f.cindy.tasks.capabilities;
  f.cindy.tasks.capabilities=async()=>{const caps=await capabilities();return {...caps,operations:caps.operations.filter(op=>op!=='archive')};};
  delete f.cindy.tasks.archive;
};

// ---- Part 1: main.js at the official tasks API boundary
test('exact route/permission, unchanged task, concurrent repeats create and send once',async()=>{
  const f=fixture();
  const replies=await Promise.all([f.send('roll',{task:'x'}),f.send('roll',{task:'x'})]);
  assert.ok(replies.every(r=>r.ok));
  assert.equal(f.count('create'),1);
  assert.equal(f.count('send'),1);
  const request=f.calls.find(c=>c[0]==='send')[1];
  assert.equal(request.expectedRevision,4);
  assert.equal(request.text,PROMPT);
  assert.equal(replies[0].result.automatic_callback,false);
  assert.deepEqual(f.calls.find(c=>c[0]==='prepare')[1].catalog.models[0].route,route,'the live catalog reaches the engine');
});
test('a router answer that is not a native route is returned as is and starts nothing',async()=>{
  for (const status of ['self','split','launched']) {
    const f=fixture({prepared:{parent:ctx.session_id,state:'prepared',bundle:null,prompt:'',router:{status,next_action:'router says'},mappings:[]}});
    const reply=await f.send('roll',{task:'x'});
    assert.equal(reply.ok,true);
    assert.equal(reply.result.status,status);
    assert.equal(f.calls.filter(c=>['create','send'].includes(c[0])).length,0);
  }
});
test('completed result uses exact outputMessageId and persists all pages',async()=>{
  const f=fixture();const first=await f.send('roll',{task:'x'});
  f.run.status='completed';f.run.outputMessageId='out-exact';
  const reply=await f.send('status',{operation:first.result.operation});
  assert.equal(reply.result.status,'completed');
  assert.equal(reply.result.output_available,true);
  assert.equal(reply.result.messages_complete,true);
  assert.equal(reply.result.summary_shortened,true);
  assert.equal(reply.result.full_result_artifacts.length,2);
  assert.match(reply.result.final_result_summary,/Worker final report/);
  assert.equal(reply.result.next_tool.tool,'cleanup');
});
test('unknown send is observed with listRuns and the run input message, and never sent twice',async()=>{
  const f=fixture({uncertain:true});const first=await f.send('roll',{task:'x'});
  assert.equal(first.result.status,'unknown_send');
  const recovered=await f.send('status',{operation:first.result.operation});
  assert.equal(recovered.result.runId,'run-1');
  assert.equal(f.records.get(first.result.operation).delivery,'reconciled');
  assert.equal(f.count('send'),1);
});
test('disabled/offline/old host cannot start anything',async()=>{
  for(const mode of ['missing','denied','no-cancel']) {
    const f=fixture();
    if(mode==='missing') delete f.cindy.tasks;
    else if(mode==='denied') f.cindy.tasks.capabilities=async()=>{throw Error('PERMISSION_DENIED');};
    else {
      const capabilities=f.cindy.tasks.capabilities;
      f.cindy.tasks.capabilities=async()=>{const caps=await capabilities();return {...caps,operations:caps.operations.filter(op=>op!=='cancel')};};
    }
    assert.equal((await f.send('roll',{task:'x'})).ok,false);
    assert.equal(f.count('create'),0);
  }
});
test('wrong model/provider/permission/directory cannot receive model input',async()=>{
  for(const archive of [true,false]) {
  for(const kind of ['model','provider','permission','directory']) {
    const f=fixture();
    if(!archive) noArchive(f);
    if(kind==='model') f.cindy.tasks.models=async()=>({models:[{route:{...route,model:'other'}}]});
    if(kind==='provider') f.cindy.tasks.models=async()=>({models:[{route:{...route,providerId:'other'}}]});
    if(kind==='permission') f.task.permissionMode='ask';
    if(kind==='directory') f.task.workingDir='E:/different';
    const reply=await f.send('roll',{task:'x'});
    assert.equal(f.count('send'),0);
    if(['permission','directory'].includes(kind)) {
      assert.equal(f.count('archive'),archive?1:0);
      assert.equal(reply.result.taskId,f.task.taskId);
      assert.equal(reply.result.draft_cleanup,archive?'archived':'manual_cleanup_required');
    }
  }
  }
});
test('lost create is not retried, definite create refusals are retriable, and a failed run preserves failure without inventing output',async()=>{
  const f=fixture();f.cindy.tasks.create=async()=>{throw Error('transport lost');};
  const first=await f.send('roll',{task:'x'});
  assert.equal(first.result.status,'unknown_create');
  const observed=await f.send('status',{operation:first.result.operation});
  assert.equal(observed.result.status,'unknown_create');
  assert.equal(f.count('send'),0);
  // A definite pre-creation refusal (such as PERMISSION_DENIED) is classified as create_rejected and released for retry.
  const denied=fixture();
  const realCreate=denied.cindy.tasks.create;
  denied.cindy.tasks.create=async()=>{throw coded('PERMISSION_DENIED','plugin permission denied');};
  const rejected=(await denied.send('roll',{task:'x'})).result;
  assert.deepEqual([rejected.status,rejected.error_code,rejected.executed,rejected.next_tool.tool],
    ['create_rejected','PERMISSION_DENIED',false,'roll']);
  assert.equal((await denied.send('status',{operation:rejected.operation})).result.status,'create_rejected');
  denied.cindy.tasks.create=realCreate;
  const recovered=(await denied.send('roll',{task:'x'})).result;
  assert.deepEqual([recovered.status,recovered.taskId,recovered.runId],['running','child-task','run-1']);
  const other=fixture();const launched=await other.send('roll',{task:'x'});
  other.run.status='failed';other.run.error='upstream timeout';
  const failed=await other.send('status',{operation:launched.result.operation});
  assert.equal(failed.result.status,'failed');
  assert.equal(failed.result.error,'upstream timeout');
  assert.equal(failed.result.output_available,false);
});
test('parent/session boundary and readonly/remote fail before dispatch',async()=>{
  const f=fixture();const first=await f.send('roll',{task:'x'});
  assert.equal((await f.send('status',{operation:first.result.operation},{...ctx,session_id:'other'})).ok,false);
  assert.equal((await f.send('roll',{task:'x'},{...ctx,workdir_is_local:false})).ok,false);
  assert.equal((await f.send('roll',{task:'x'},{...ctx,workdir_is_read_only:true})).ok,false);
});
test('archive is optional for dispatch and cancellation; inactive cleanup is honest and repeatable',async()=>{
  for (const archive of [true,false]) {
  const f=fixture();
  if (!archive) noArchive(f);
  const first=await f.send('roll',{task:'x'});assert.equal(first.ok,true);
  const args={operation:first.result.operation};
  assert.equal((await f.send('stop',args)).result.status,'stopping');
  const refused=(await f.send('cleanup',args)).result;
  assert.equal(refused.status,'cleanup_refused');
  assert.match(refused.reason,/run-1 is stopping/);
  f.run.status='cancelled';
  assert.equal((await f.send('status',args)).result.messages_complete,true);
  for(let i=0;i<2;i++) {
    const cleaned=(await f.send('cleanup',args)).result;
    assert.equal(cleaned.status,archive?'cleaned':'manual_cleanup_required');
    if (!archive) {assert.equal(cleaned.taskId,f.task.taskId);assert.equal(cleaned.archived,false);}
  }
  assert.equal(f.count('archive'),archive?1:0);
  }
});

function routed(bundle,catalogRoute,{mappings=[],supportsFastMode=true}={}) {
  const f=fixture({prepared:{parent:ctx.session_id,state:'prepared',router:{status:'native'},bundle,prompt:'p',mappings}});
  f.cindy.tasks.models=async()=>({models:[{route:{...catalogRoute,fastMode:false},efforts:[catalogRoute.effort],supportsFastMode},
    {route:{...catalogRoute,model:catalogRoute.model+'-nearby',fastMode:false},efforts:[catalogRoute.effort],supportsFastMode}]});
  f.task.resolvedConfig={...catalogRoute};
  f.run.acceptedConfig={...catalogRoute};
  return f;
}
test('claude routes become Cindy cc with bypassPermissions and keep effort high or max',async()=>{
  for (const effort of ['high','max']) {
    const want={agentKind:'cc',providerId:'claude',model:'claude-opus-5-5',effort,fastMode:false};
    const f=routed({provider:'claude',account:'claude',harness:'claude',model:'claude-opus-5-5',effort,modeId:'bypassPermissions'},want);
    const reply=await f.send('roll',{task:'x'});
    assert.equal(reply.ok,true,JSON.stringify(reply));
    const create=f.calls.find(c=>c[0]==='create')[1];
    assert.deepEqual(create.route,want);
    assert.equal(create.permissionMode,'bypassPermissions');
  }
});
test('the built-in engine names the catalog connection itself: no account map is needed',async()=>{
  const want={agentKind:'pi',providerId:'openai',model:'chatgpt/gpt-6.1-terra',effort:'high',fastMode:false};
  const f=routed({provider:'pi',harness:'pi',account:'openai',providerId:'openai',model:'chatgpt/gpt-6.1-terra',effort:'high',fast:false,modeId:'full-access'},want);
  const reply=await f.send('roll',{task:'x'});
  assert.equal(reply.ok,true,JSON.stringify(reply));
  assert.deepEqual(f.calls.find(c=>c[0]==='create')[1].route,want);
});
test('pi runs the launch model on the mapped Cindy connection; without a mapping it is refused',async()=>{
  const bundle={provider:'pi',account:'codex',harness:'pi',model:'gpt-6.1-sol',launch_model:'openai-codex/gpt-6.1-sol',effort:'high',modeId:'full-access'};
  const want={agentKind:'pi',providerId:'openai-conn',model:'openai-codex/gpt-6.1-sol',effort:'high',fastMode:false};
  const mapped=routed(bundle,want,{mappings:[{routerProvider:'pi',routerAccount:'codex',providerId:'openai-conn',agentKind:'pi'}]});
  const ok=await mapped.send('roll',{task:'x'});
  assert.equal(ok.ok,true,JSON.stringify(ok));
  assert.deepEqual(mapped.calls.find(c=>c[0]==='create')[1].route,want);
  const unmapped=routed(bundle,want);
  const refused=await unmapped.send('roll',{task:'x'});
  assert.equal(refused.ok,false);
  assert.match(refused.message,/No explicit Cindy provider\/account binding/);
  const wrongKind=routed(bundle,want,{mappings:[{routerProvider:'pi',routerAccount:'codex',providerId:'openai-conn',agentKind:'codex'}]});
  assert.match((await wrongKind.send('roll',{task:'x'})).message,/changes the routed harness/);
  assert.equal([unmapped,wrongKind].flatMap(f=>f.calls).filter(c=>c[0]==='create').length,0);
});
test('a codex fast route asks Cindy for fast mode, and only on a row that supports it',async()=>{
  const bundle={provider:'codex',account:'codex',harness:'codex',model:'gpt-6.1-sol',effort:'high',fast:true,modeId:'full-access'};
  const want={agentKind:'codex',providerId:'codex',model:'gpt-6.1-sol',effort:'high',fastMode:true};
  const f=routed(bundle,want);
  const reply=await f.send('roll',{task:'x'});
  assert.equal(reply.ok,true,JSON.stringify(reply));
  assert.deepEqual(f.calls.find(c=>c[0]==='create')[1].route,want);
  const slow=routed(bundle,want,{supportsFastMode:false});
  assert.equal((await slow.send('roll',{task:'x'})).ok,false);
  assert.equal(slow.count('create'),0);
  const plain=routed({...bundle,fast:false},{...want,fastMode:false});
  await plain.send('roll',{task:'x'});
  assert.equal(plain.calls.find(c=>c[0]==='create')[1].route.fastMode,false);
});
test('stop waits a bounded time for the host: stopping is reported as such, a confirmed cancel as terminal',async()=>{
  const f=fixture();const first=await f.send('roll',{task:'x'});
  const args={operation:first.result.operation};
  const stopping=(await f.send('stop',args)).result;
  assert.equal(stopping.status,'stopping');
  assert.equal(stopping.confirmed_terminal,false);
  assert.ok(f.count('getRun')>=10,'stop polled getRun after cancel');
  assert.equal((await f.send('status',args)).result.next_action.includes('No automatic callback'),true,'stopping is not terminal');
  f.run.status='cancelled';
  const cancelled=(await f.send('status',args)).result;
  assert.equal(cancelled.status,'cancelled');
  assert.match(cancelled.next_action,/Cleanup archives/);
  assert.equal(cancelled.output_available,false);
  const quick=fixture({cancelTo:'cancelled'});const op=(await quick.send('roll',{task:'x'})).result.operation;
  const confirmed=(await quick.send('stop',{operation:op})).result;
  assert.deepEqual([confirmed.status,confirmed.confirmed_terminal],['cancelled',true]);
  // If tasks.cancel() succeeds with stopping and a follow-up getRun() poll throws, the accepted cancellation is preserved.
  const pollFail=fixture();const pop=(await pollFail.send('roll',{task:'x'})).result.operation;
  pollFail.cindy.tasks.getRun=async()=>{throw Error('getRun transport error');};
  const pollStopped=await pollFail.send('stop',{operation:pop});
  assert.equal(pollStopped.ok,true);
  assert.deepEqual([pollStopped.result.status,pollStopped.result.confirmed_terminal,pollStopped.result.task_id,pollStopped.result.run_id,pollStopped.result.next_tool.tool],
    ['stopping',false,'child-task','run-1','status']);
  assert.equal(pollFail.records.get(pop).state,'stopping');
  // If tasks.cancel() or tasks.archive() loses its reply, return known handles, executed: 'unknown', and status verification.
  const cancelLost=fixture();const clop=(await cancelLost.send('roll',{task:'x'})).result.operation;
  cancelLost.cindy.tasks.cancel=async()=>{cancelLost.run.status='stopping';throw Error('cancel reply lost');};
  const cancelUnknown=await cancelLost.send('stop',{operation:clop});
  assert.equal(cancelUnknown.ok,true);
  assert.deepEqual([cancelUnknown.result.status,cancelUnknown.result.executed,cancelUnknown.result.confirmed_terminal,cancelUnknown.result.task_id,cancelUnknown.result.run_id,cancelUnknown.result.next_tool.tool],
    ['unknown_cancel','unknown',false,'child-task','run-1','status']);
  // Definite pre-mutation cancellation refusal (e.g. PERMISSION_DENIED) is reported as cancel_rejected with executed: false.
  const cancelRefused=fixture();const crop=(await cancelRefused.send('roll',{task:'x'})).result.operation;
  cancelRefused.cindy.tasks.cancel=async()=>{throw coded('PERMISSION_DENIED','cannot cancel');};
  const cancelRej=await cancelRefused.send('stop',{operation:crop});
  assert.equal(cancelRej.ok,true);
  assert.deepEqual([cancelRej.result.status,cancelRej.result.executed,cancelRej.result.confirmed_terminal,cancelRej.result.error_code,cancelRej.result.task_id,cancelRej.result.run_id,cancelRej.result.next_tool.tool],
    ['cancel_rejected',false,false,'PERMISSION_DENIED','child-task','run-1','stop']);
  const archiveLost=fixture();const alop=(await archiveLost.send('roll',{task:'x'})).result.operation;
  archiveLost.run.status='completed';archiveLost.run.outputMessageId='out-exact';
  await archiveLost.send('status',{operation:alop});
  archiveLost.cindy.tasks.archive=async()=>{archiveLost.calls.push(['archive',{taskId:'child-task'}]);throw Error('archive reply lost');};
  const archiveUnknown=await archiveLost.send('cleanup',{operation:alop});
  assert.equal(archiveUnknown.ok,true);
  assert.deepEqual([archiveUnknown.result.status,archiveUnknown.result.executed,archiveUnknown.result.archived,archiveUnknown.result.task_id,archiveUnknown.result.run_id,archiveUnknown.result.next_tool.tool],
    ['unknown_archive','unknown','unknown','child-task','run-1','status']);
  assert.equal((await archiveLost.send('cleanup',{operation:alop})).result.status,'unknown_archive');
  assert.equal(archiveLost.count('archive'),1,'cleanup does not archive a second time after unknown_archive');
  for (const mode of ['mismatch','presend','send_rejected']) {
    const d=mode==='presend' ? fixture({saveFails:record=>record.state==='sending'})
      : mode==='send_rejected' ? fixture({sendError:coded('REVISION_CONFLICT','conflict')})
      : fixture();
    if (mode==='mismatch') d.task.workingDir='E:/different';
    d.host.runs=[];
    d.cindy.tasks.archive=async()=>{d.calls.push(['archive',{taskId:'child-task'}]);throw Error('draft archive reply lost');};
    const r=(await d.send('roll',{task:'x'})).result;
    assert.deepEqual([r.draft_cleanup,r.archived,r.next_tool.tool],['unknown_archive','unknown','status'],mode);
    const s=(await d.send('status',{operation:r.operation})).result;
    assert.deepEqual([s.draft_cleanup,s.archived,s.next_tool.tool],['unknown_archive','unknown','status'],mode);
    const c=(await d.send('cleanup',{operation:r.operation})).result;
    assert.deepEqual([c.status,c.archived,c.executed,c.next_tool.tool],['unknown_archive','unknown','unknown','status'],mode);
    assert.equal(d.count('archive'),1,mode+' never archives a second time');
  }
});
test('review 1: a persisted `sending` receipt without runId is settled from the host runs, never resent',async()=>{
  const f=fixture();const first=await f.send('roll',{task:'x'});
  const op=first.result.operation;
  const record=f.records.get(op);
  f.records.set(op,{...record,state:'sending',runId:undefined,delivery:undefined});
  const status=(await f.send('status',{operation:op})).result;
  assert.equal(status.runId,'run-1');
  assert.equal(status.status,'running');
  assert.equal(f.records.get(op).delivery,'reconciled');
  assert.equal(f.count('send'),1);
});
test('review 1: a receipt save that fails after a successful send still returns operation, task_id and run_id',async()=>{
  const f=fixture({saveFails:record=>record.state==='running' && record.delivery==='accepted'});
  const reply=await f.send('roll',{task:'x'});
  assert.equal(reply.ok,true,JSON.stringify(reply));
  assert.equal(reply.result.operation,opOf(ctx.session_id,'x'));
  assert.deepEqual([reply.result.task_id,reply.result.run_id,reply.result.receipt_saved],['child-task','run-1',false]);
  assert.match(reply.result.receipt_error,/disk full/);
  assert.equal(f.records.get(reply.result.operation).state,'sending','the disk still says sending');
  const status=(await f.send('status',{operation:reply.result.operation})).result;
  assert.equal(status.runId,'run-1');
  assert.equal(f.count('send'),1);
  const pre=fixture({saveFails:record=>record.state==='sending' || record.state==='blocked'});
  const preReply=await pre.send('roll',{task:'x'});
  assert.equal(preReply.ok,true);
  assert.deepEqual([preReply.result.status,preReply.result.task_id,preReply.result.receipt_saved],['blocked','child-task',false]);
  assert.equal(pre.count('send'),0);
  assert.equal(pre.count('archive'),1);
  const cancelFail=fixture({cancelTo:'cancelled',saveFails:record=>record.state==='cancelled' || record.state==='cleaned'});
  const cop=(await cancelFail.send('roll',{task:'x'})).result.operation;
  const stopped=(await cancelFail.send('stop',{operation:cop})).result;
  assert.deepEqual([stopped.status,stopped.task_id,stopped.run_id,stopped.receipt_saved],['cancelled','child-task','run-1',false]);
  cancelFail.run.status='cancelled';cancelFail.run.outputMessageId='out-exact';
  await cancelFail.send('status',{operation:cop});
  const cleaned=(await cancelFail.send('cleanup',{operation:cop})).result;
  assert.deepEqual([cleaned.status,cleaned.task_id,cleaned.receipt_saved],['cleaned','child-task',false]);
});
test('review 2: a definite send refusal is send_rejected and the draft is discarded, not unknown_send',async()=>{
  for (const code of ['REVISION_CONFLICT','INVALID_REQUEST','PERMISSION_DENIED']) {
  for (const archive of [true,false]) {
    const f=fixture({sendError:coded(code,'Task configuration changed')});
    if (!archive) noArchive(f);
    f.host.runs=[];
    const reply=(await f.send('roll',{task:'x'})).result;
    assert.equal(reply.status,'send_rejected',code);
    assert.equal(reply.error_code,code);
    assert.equal(reply.draft_cleanup,archive ? 'archived' : 'manual_cleanup_required');
    assert.equal(reply.next_tool.tool,'cleanup');
    const cleaned=(await f.send('cleanup',{operation:reply.operation})).result;
    assert.equal(cleaned.status,archive ? 'cleaned' : 'manual_cleanup_required');
    assert.equal(f.count('archive'),archive ? 1 : 0,'archived once');
  }
  }
  const f=fixture({sendError:coded('PERMISSION_DENIED','Account changed')});
  const reply=(await f.send('roll',{task:'x'})).result;
  assert.equal(reply.status,'unknown_send');
  assert.equal(f.count('archive'),0);
  const lost=fixture({sendError:Error('socket hang up')});lost.host.runs=[];
  assert.equal((await lost.send('roll',{task:'x'})).result.status,'unknown_send');
});
test('review 2: a run on the same route is claimed only when its input message is this prompt',async()=>{
  const f=fixture({uncertain:true});
  f.host.input='a message the user typed into the draft';
  const first=(await f.send('roll',{task:'x'})).result;
  const status=(await f.send('status',{operation:first.operation})).result;
  assert.equal(status.status,'unknown_send','route match and one run are not enough');
  assert.equal(f.records.get(first.operation).runId,undefined);
  assert.equal((await f.send('cleanup',{operation:first.operation})).result.status,'cleanup_refused');
  f.host.input=PROMPT;
  const claimed=(await f.send('status',{operation:first.operation})).result;
  assert.equal(claimed.runId,'run-1');
  const two=fixture({uncertain:true});
  two.host.runs=[{runId:'run-0',taskId:'child-task',status:'completed',acceptedConfig:route,inputMessageId:'plugin-task:run-0'},two.run];
  const op=(await two.send('roll',{task:'x'})).result.operation;
  assert.equal((await two.send('status',{operation:op})).result.runId,'run-1');
  assert.equal(two.count('send'),1);
  const structured=fixture({uncertain:true});
  structured.host.input=[{type:'text',text:'prefix\n'+PROMPT}];
  structured.run.status='completed';structured.run.outputMessageId='out-exact';
  structured.host.output=[{type:'text',text:'[Worker final report]\nstructured answer'}];
  const sop=(await structured.send('roll',{task:'x'})).result.operation;
  const sres=(await structured.send('status',{operation:sop})).result;
  assert.equal(sres.runId,'run-1');
  assert.equal(sres.final_result_summary,'[Worker final report]\nstructured answer');
});
test('review 3: cleanup refuses unconfirmed receipts and tasks with any active run, even without a runId',async()=>{
  const lostCreate=fixture();lostCreate.cindy.tasks.create=async()=>{throw Error('transport lost');};
  const a=(await lostCreate.send('roll',{task:'x'})).result.operation;
  assert.equal((await lostCreate.send('cleanup',{operation:a})).result.status,'cleanup_refused');
  for (const state of ['creating','sending','unknown_send']) {
    const f=fixture({uncertain:true});f.host.runs=[];
    const op=(await f.send('roll',{task:'x'})).result.operation;
    f.records.set(op,{...f.records.get(op),state});
    const reply=(await f.send('cleanup',{operation:op})).result;
    assert.equal(reply.status,'cleanup_refused',state);
    assert.equal(f.count('archive'),0,state);
  }
  const f=fixture();f.task.workingDir='E:/different';noArchive(f);
  const op=(await f.send('roll',{task:'x'})).result.operation;
  f.host.runs=[{...f.run,runId:'run-other',status:'running'}];
  const busy=(await f.send('cleanup',{operation:op})).result;
  assert.equal(busy.status,'cleanup_refused');
  assert.match(busy.reason,/run-other is running/);
  assert.deepEqual([...(busy.blocking_runs || [])],['run-other']);
  assert.equal(busy.next_tool,null);
  f.host.runs=[];
  assert.equal((await f.send('cleanup',{operation:op})).result.status,'manual_cleanup_required');
  const h=fixture();const hop=(await h.send('roll',{task:'x'})).result.operation;
  h.run.status='completed';h.run.outputMessageId='out-exact';
  await h.send('status',{operation:hop});
  h.host.runs=[h.run,{...h.run,runId:'run-other',status:'running'}];
  const hBusy=(await h.send('cleanup',{operation:hop})).result;
  assert.equal(hBusy.status,'cleanup_refused');
  assert.deepEqual([...(hBusy.blocking_runs || [])],['run-other']);
  assert.equal(hBusy.next_tool,null);
  assert.match(hBusy.next_action,/run-other/);
  const g=fixture();g.task.workingDir='E:/different';
  const gop=(await g.send('roll',{task:'x'})).result.operation;
  g.records.set(gop,{...g.records.get(gop),draft_cleanup:'needs_cleanup'});
  g.cindy.tasks.listRuns=async()=>{throw coded('HOST_NOT_READY');};
  assert.equal((await g.send('cleanup',{operation:gop})).ok,false);
  assert.equal(g.count('archive'),1,'only the draft discard at roll time');
});
test('review 4: a terminal run with unread message pages points to status, and cleanup waits for messages_complete',async()=>{
  const f=fixture();f.host.pages=12;
  const op=(await f.send('roll',{task:'x'})).result.operation;
  f.run.status='completed';f.run.outputMessageId='out-exact';
  const partial=(await f.send('status',{operation:op})).result;
  assert.equal(partial.messages_complete,false);
  assert.equal(partial.message_pages_read,10);
  assert.equal(partial.next_tool.tool,'status');
  assert.doesNotMatch(partial.next_action,/[Cc]leanup archives/);
  assert.match(partial.next_action,/Call status again/);
  const early=(await f.send('cleanup',{operation:op})).result;
  assert.equal(early.status,'cleanup_refused');
  assert.match(early.reason,/messages_complete/);
  const rest=(await f.send('status',{operation:op})).result;
  assert.deepEqual([rest.messages_complete,rest.message_pages_read,rest.output_available,rest.next_tool.tool],[true,12,true,'cleanup']);
  assert.equal((await f.send('cleanup',{operation:op})).result.status,'cleaned');
  // An oversized message page (> 256 KiB across 100 chatty messages or a large final reply) is chunked across the
  // Node RPC boundary and its receipt stores only the 4,000-char summary, so status and cleanup succeed under the 256 KiB limit.
  const chatty=fixture();
  const cop=(await chatty.send('roll',{task:'x'})).result.operation;
  chatty.run.status='completed';chatty.run.outputMessageId='out-exact';
  chatty.cindy.tasks.readMessages=async request=>{
    chatty.calls.push(['readMessages',request]);
    const items=Array.from({length:99},(_,k)=>({id:'msg-'+k,role:'assistant',content:'m'.repeat(3000)}));
    items.push({id:'out-exact',role:'assistant',content:'[Worker final report] '+'終'.repeat(90000)});
    return {items,nextCursor:null};
  };
  const chattyRes=(await chatty.send('status',{operation:cop})).result;
  assert.equal(chattyRes.status,'completed');
  assert.equal(chattyRes.messages_complete,true);
  assert.equal(chattyRes.output_available,true);
  assert.equal(chattyRes.summary_shortened,true);
  assert.equal(chattyRes.message_pages_read,1);
  assert.equal(chattyRes.next_tool.tool,'cleanup');
  assert.ok(Buffer.byteLength(JSON.stringify(chatty.records.get(cop)),'utf8')<64*1024,'receipt does not re-embed the oversized final message');
  assert.equal((await chatty.send('cleanup',{operation:cop})).result.status,'cleaned');
});
test('review 5: a roll stuck in routing for session A does not delay session B stop, nor A\'s own other operations',async()=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const f=fixture({cancelTo:'cancelled',prepareGate:(task)=>task==='slow' ? gate : null});
  const b={...ctx,session_id:'session-b'};
  const bop=(await f.send('roll',{task:'x'},b)).result.operation;
  const aop=(await f.send('roll',{task:'earlier'})).result.operation;
  const stuck=f.send('roll',{task:'slow'});
  let routed=false;stuck.then(()=>{routed=true;});
  const stopped=await f.send('stop',{operation:bop},b);
  assert.equal(stopped.result.status,'cancelled');
  assert.equal((await f.send('status',{operation:aop})).ok,true);
  assert.equal(routed,false,'session A is still routing');
  release();
  assert.equal((await stuck).ok,true);
});
test('review 7: a prepared receipt is routed again on retry, so a fixed account map is used',async()=>{
  const bundle={provider:'pi',account:'codex',harness:'pi',model:'gpt-6.1-sol',launch_model:'openai-codex/gpt-6.1-sol',effort:'high',modeId:'full-access'};
  const want={agentKind:'pi',providerId:'openai-conn',model:'openai-codex/gpt-6.1-sol',effort:'high',fastMode:false};
  const map=[{routerProvider:'pi',routerAccount:'codex',providerId:'openai-conn',agentKind:'pi'}];
  const f=routed(bundle,want);
  f.records.clear();
  const fixtureOptions=n=>({parent:ctx.session_id,state:'prepared',router:{status:'native'},bundle,prompt:'p',mappings:n===1 ? [] : map});
  const g=fixture({prepared:fixtureOptions});
  g.cindy.tasks.models=f.cindy.tasks.models;g.task.resolvedConfig={...want};g.run.acceptedConfig={...want};
  const failed=await g.send('roll',{task:'x'});
  assert.equal(failed.ok,false);
  assert.match(failed.message,/No explicit Cindy provider\/account binding/);
  assert.equal(g.records.get(opOf(ctx.session_id,'x')).state,'prepared');
  const retried=await g.send('roll',{task:'x'});
  assert.equal(retried.ok,true,JSON.stringify(retried));
  assert.deepEqual(g.calls.find(c=>c[0]==='create')[1].route,want);
  assert.equal(g.count('prepare'),2);
});

// ---- Part 2: the built-in routing engine over a real Cindy 0.1.121 catalog
const REAL_CATALOG = {
  models: [
    ...['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6.1-terra', 'gpt-6-sol', 'gpt-6-luna'].map(model => ({
      route: {agentKind: 'codex', model, providerId: 'openai', effort: 'medium', fastMode: false},
      efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      supportsFastMode: true,
    })),
    ...['chatgpt/gpt-6.1-sol', 'chatgpt/gpt-6-astra', 'chatgpt/gpt-6.1-terra', 'chatgpt/gpt-6-sol', 'chatgpt/gpt-6-luna'].map(model => ({
      route: {agentKind: 'pi', model, providerId: 'openai', effort: 'medium', fastMode: false},
      efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      supportsFastMode: true,
    })),
    {
      route: {agentKind: 'pi', model: 'chatgpt/gpt-5.3-codex-spark', providerId: 'openai', effort: 'xhigh', fastMode: false},
      efforts: ['minimal', 'xhigh'],
      supportsFastMode: false,
    },
  ],
};
const WITH_CLAUDE = {models: [...REAL_CATALOG.models,
  ...['claude-opus-5-5', 'claude-sonnet-5-5'].map(model => ({route: {agentKind: 'cc', providerId: 'anthropic', model, effort: 'high', fastMode: false},
    efforts: ['low', 'medium', 'high', 'max'], supportsFastMode: false}))]};
const OK_QUOTA = {source: 'test', status: 'ok', used_percent: 17};
const routeBuiltIn = (task, catalog = REAL_CATALOG, quota = OK_QUOTA) => routeTask(task, catalog, {quota});
function inCatalog(result, catalog) {
  const b = result.route.bundle;
  const kind = {claude: 'cc', codex: 'codex', pi: 'pi'}[b.harness];
  return catalog.models.some(row => row.route.agentKind === kind && row.route.providerId === b.providerId && row.route.model === b.model &&
    (row.efforts || [row.route.effort]).includes(b.effort) && (!b.fast || row.supportsFastMode));
}

test('split: several independent deliverables come back as split with the task count; nothing is routed', () => {
  for (const [task, count] of [['Two independent tasks:\n1. Add a dark theme to the settings page.\n2. Fix the CSV export encoding bug in report.py.', '2'],
    ['Two independent tasks:\nTask 1: Fix foo.py, then run its tests.\nTask 2: Translate README.md into Japanese.', '2'],
    ['Task 1: Next.js: fix the hydration bug.\nTask 2: Django: add CSV export.', '2'],
    ['Task 1: write the release notes.\nTask 2: upgrade the lodash dependency.\nTask 3: add retry to the HTTP client.', '3'],
    ['以下是互不相关的任务：\n1. 给设置页加深色主题\n2. 修复 report.py 的 CSV 编码\n3. 升级 lodash\n4. 给 HTTP 客户端加重试', '>3']]) {
    const result = routeBuiltIn(task);
    assert.equal(result.status, 'split', task);
    assert.equal(result.task_count, count);
    assert.equal(result.engine, 'builtin');
    assert.equal(result.route, undefined);
  }
  assert.equal(splitGate('Steps:\n1. Reproduce the crash.\n2. Then fix it.\n3. Then add a regression test.'), null);
  assert.equal(splitGate('Task 1: First implement the helper.\nTask 2: Then test the helper created above.'), null);
  assert.equal(routeBuiltIn('Steps:\n1. Reproduce the crash.\n2. Then fix it.').status, 'native');
  assert.equal(routeBuiltIn('Task 1: First implement the helper.\nTask 2: Then test the helper created above.').status, 'native');
});

test('self: an explicit "answer here" or a short pure question is the current session\'s job', () => {
  for (const task of ['What is the difference between a mutex and a semaphore?', '直接回答：Python 的 GIL 是什么？',
    'Do not delegate this: summarise the README in two lines.',
    'No delegation please. Rename foo in util.py.']) {
    const result = routeBuiltIn(task);
    assert.equal(result.status, 'self', task);
    assert.match(result.next_action, /current session/);
  }
  assert.equal(selfGate('Why does util.py fail? Fix it and add a test.'), null);
  for (const workQuestion of [
    'Can you review the diff for regressions?',
    'Can you translate the supplied paragraph into Japanese?',
    'Fix the "no worker available" error in scheduler.py.',
    'Implement a worker pool with no worker thread leaks.',
  ]) {
    assert.equal(selfGate(workQuestion), null, workQuestion);
    assert.equal(routeBuiltIn(workQuestion).status, 'native', workQuestion);
  }
});

test('native routes are exact rows of the real catalog: codex for edits, Pi for read-and-report work', () => {
  const edit = routeBuiltIn('Rename the helper foo to bar in util.py and update its two callers.');
  assert.equal(edit.status, 'native');
  assert.equal(edit.route.bundle.harness, 'codex');
  assert.equal(edit.route.bundle.modeId, 'full-access');
  assert.ok(inCatalog(edit, REAL_CATALOG), JSON.stringify(edit.route.bundle));
  const explore = routeBuiltIn('Investigate why the login request fails: trace it through logs/ and the auth module and report the findings only.');
  assert.equal(explore.decision.work_kind, 'exploration_analysis');
  assert.equal(explore.route.bundle.harness, 'pi');
  assert.match(explore.route.bundle.model, /^chatgpt\//);
  assert.ok(inCatalog(explore, REAL_CATALOG), JSON.stringify(explore.route.bundle));
  const review = routeBuiltIn('Review the diff in src/auth for security regressions and subtle bugs (read-only review).', WITH_CLAUDE);
  assert.equal(review.route.bundle.harness, 'claude');
  assert.equal(review.route.bundle.modeId, 'bypassPermissions');
  assert.ok(inCatalog(review, WITH_CLAUDE));
  assert.ok(review.decision.alternatives.length > 0 && review.decision.components);
});

test('fast mode needs the signal word, a fast-capable codex row and known quota under 60%', () => {
  const task = 'Use fast mode: rename the helper foo to bar in util.py and update its two callers.';
  const fast = routeBuiltIn(task);
  assert.equal(fast.route.bundle.fast, true);
  assert.equal(fast.route.bundle.harness, 'codex');
  assert.ok(inCatalog(fast, REAL_CATALOG));
  assert.equal(routeBuiltIn('Rename the helper foo to bar in util.py and update its two callers.').route.bundle.fast, false);
  assert.equal(routeBuiltIn(task, REAL_CATALOG, {source: 'test', status: 'ok', used_percent: 70}).route.bundle.fast, false);
  assert.equal(routeBuiltIn(task, REAL_CATALOG, {source: 'test', status: 'unknown'}).route.bundle.fast, false);
  assert.equal(routeBuiltIn('加急：把 util.py 里的 foo 改名为 bar 并更新两个调用点。').decision.wants_fast, true);
  for (const optedOut of [
    'Rename foo to bar in util.py. Do not use fast mode.',
    'Rename foo to bar in util.py without fast mode.',
    'Rename foo to bar in util.py. This is not urgent.',
    'This is urgent: rename foo to bar in util.py, but do not use fast mode.',
    '把 util.py 里的 foo 改名为 bar，不要使用快速模式。',
    '把 util.py 里的 foo 改名为 bar，这件事不紧急、不用加急。',
  ]) {
    const res = routeBuiltIn(optedOut);
    assert.equal(res.decision.wants_fast, false, optedOut);
    assert.equal(res.route.bundle.fast, false, optedOut);
  }
  for (const enabledDespiteNegatedUrgency of [
    'Rename the non-urgent helper foo to bar in util.py in fast mode.',
    'Rename foo in util.py. This is not urgent but use fast mode.',
    '把 util.py 里的 foo 改名为 bar，这件事不紧急，但请使用快速模式。',
  ]) {
    const res = routeBuiltIn(enabledDespiteNegatedUrgency);
    assert.equal(res.decision.wants_fast, true, enabledDespiteNegatedUrgency);
    assert.equal(res.route.bundle.fast, true, enabledDespiteNegatedUrgency);
  }
});

test('quota: an exhausted Codex window moves the route to another signed-in connection', () => {
  const task = 'Rename the helper foo to bar in util.py and update its two callers.';
  assert.equal(routeBuiltIn(task, WITH_CLAUDE).route.bundle.harness, 'codex');
  const moved = routeBuiltIn(task, WITH_CLAUDE, {source: 'test', status: 'exhausted', used_percent: 97});
  assert.equal(moved.route.bundle.harness, 'claude');
  assert.equal(moved.decision.quota.status, 'exhausted');
  assert.ok(moved.decision.quota_penalized_routes >= 10);
  assert.equal(moved.decision.warning, undefined);
  const only = routeBuiltIn(task, REAL_CATALOG, {source: 'test', status: 'exhausted', used_percent: 97});
  assert.match(only.decision.warning, /short of quota/);
});

test("with no CODEX_HOME the telemetry Cindy's own Codex writes (<app data>/CindyGlobal/codex-home) counts, newest first", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'user-home-'));
  try {
    const env = {APPDATA: path.join(home, 'AppData', 'Roaming'), XDG_CONFIG_HOME: path.join(home, '.config')};
    const homes = codexHomes(env, home);
    assert.equal(homes[0], path.join(home, '.codex'));
    assert.match(homes[1], /CindyGlobal[\\/]codex-home$/);
    assert.deepEqual(codexHomes({CODEX_HOME: '/x'}, home), ['/x']);
    const now = Date.UTC(2026, 10, 3, 12);
    const write = (root, used, age) => {
      const day = path.join(root, 'sessions', '2026', '11', '03');
      fs.mkdirSync(day, {recursive: true});
      const file = path.join(day, 'rollout-a.jsonl');
      fs.writeFileSync(file, JSON.stringify({type: 'event_msg', payload: {type: 'token_count',
        rate_limits: {primary: {used_percent: used, window_minutes: 10080, resets_at: now / 1000 + 600}, secondary: null}}}) + '\n');
      const at = new Date(now - age);
      fs.utimesSync(file, at, at);
    };
    assert.equal(codexQuota(env, now, homes).status, 'unknown');
    write(homes[1], 22, 1000);
    assert.deepEqual([codexQuota(env, now, homes).used_percent, codexQuota(env, now, homes).file.startsWith(homes[1])], [22, true]);
    write(homes[0], 70, 60000);
    assert.equal(codexQuota(env, now, homes).used_percent, 22);
    write(homes[0], 99, 100);
    assert.equal(codexQuota(env, now, homes).used_percent, 22);
    // A session started in an earlier date folder that was updated more recently than today's folder wins by mtime.
    const prevDay = path.join(homes[1], 'sessions', '2026', '11', '02');
    fs.mkdirSync(prevDay, {recursive: true});
    const prevFile = path.join(prevDay, 'rollout-prev.jsonl');
    fs.writeFileSync(prevFile, JSON.stringify({type: 'event_msg', payload: {type: 'token_count',
      rate_limits: {primary: {used_percent: 98, window_minutes: 10080, resets_at: now / 1000 + 600}, secondary: null}}}) + '\n');
    const newerAt = new Date(now - 200);
    fs.utimesSync(prevFile, newerAt, newerAt);
    assert.deepEqual([codexQuota(env, now, homes).status, codexQuota(env, now, homes).used_percent, codexQuota(env, now, homes).file],
      ['exhausted', 98, prevFile]);
  } finally {fs.rmSync(home, {recursive: true, force: true});}
});

test('screenshot review classifies as visual_analysis (not GUI computer_use), multi-Codex catalogs isolate unbound quota, and empty default efforts are retained', () => {
  const visual = routeBuiltIn('Compare screenshots of the login dialog and inspect the screenshot for layout misalignment.');
  assert.equal(visual.decision.work_kind, 'visual_analysis');
  assert.equal(visual.decision.profile.needs_visual, true);
  assert.equal(visual.decision.profile.needs_gui, false);

  const multiCodex = {models: [
    {route: {agentKind: 'codex', providerId: 'openai-a', model: 'gpt-6.1-sol', effort: 'high', fastMode: false}, efforts: ['high'], supportsFastMode: true},
    {route: {agentKind: 'codex', providerId: 'openai-b', model: 'gpt-6.1-sol', effort: 'high', fastMode: false}, efforts: ['high'], supportsFastMode: true},
  ]};
  const unbound = routeTask('Use fast mode: rename foo to bar in util.py.', multiCodex, {quota: {source: 'test', status: 'exhausted', used_percent: 98}});
  assert.equal(unbound.decision.quota_penalized_routes, 0);
  const bound = routeTask('Rename foo to bar in util.py.', multiCodex, {quota: {source: 'test', status: 'exhausted', used_percent: 98, providerId: 'openai-a'}});
  assert.equal(bound.route.bundle.providerId, 'openai-b');

  const emptyEffortCatalog = {models: [
    {route: {agentKind: 'codex', providerId: 'openai', model: 'gpt-6.1-sol', effort: '', fastMode: false}, efforts: [], supportsFastMode: false},
  ]};
  const emptyEffort = routeBuiltIn('Rename foo to bar in util.py.', emptyEffortCatalog);
  assert.equal(emptyEffort.status, 'native');
  assert.equal(emptyEffort.route.bundle.effort, '');

  const sparkOnlyCatalog = {models: [REAL_CATALOG.models.at(-1)]};
  const sparkAlgo = routeBuiltIn('Implement a standalone algorithm.', sparkOnlyCatalog);
  assert.equal(sparkAlgo.status, 'native', 'all host-offered efforts are ranked when static alias efforts do not overlap');
  assert.equal(sparkAlgo.route.bundle.effort, 'xhigh');
  const sparkRoutine = routeBuiltIn('Batch rename foo to bar in all filenames.', sparkOnlyCatalog);
  assert.equal(sparkRoutine.route.bundle.effort, 'xhigh', 'minimal effort is scored conservatively below low and does not clear the 3.0 routine floor on a 3.2-tier model');

  const lunaOnlyCatalog = {models: [REAL_CATALOG.models.find(r => r.route.model === 'gpt-6-luna')]};
  const lunaAlgo = routeBuiltIn('Implement a standalone algorithm.', lunaOnlyCatalog);
  assert.equal(lunaAlgo.status, 'native', 'all host-offered efforts are ranked even when static spec efforts partially overlap');
  assert.equal(lunaAlgo.route.bundle.effort, 'xhigh');

  const multiSegmentPiCatalog = {models: [
    {route: {agentKind: 'pi', providerId: 'openrouter', model: 'openrouter/qwen/qwen3-coder', effort: 'high', fastMode: false}, efforts: ['medium', 'high'], supportsFastMode: false},
  ]};
  const multiSeg = routeBuiltIn('Rename foo to bar in util.py.', multiSegmentPiCatalog);
  assert.equal(multiSeg.status, 'native', 'multi-segment Pi model IDs remain stable across canonicalization and allocator lookup');
  assert.equal(multiSeg.route.bundle.model, 'openrouter/qwen/qwen3-coder');
});

test('nothing runnable: an empty or foreign catalog is blocked, never guessed', () => {
  assert.equal(routeBuiltIn('Rename foo to bar in util.py.', {models: []}).status, 'blocked');
  assert.equal(routeBuiltIn('Rename foo to bar in util.py.', {models: [{route: {agentKind: 'gemini', providerId: 'g', model: 'x', effort: ''}}]}).status, 'blocked');
  assert.equal(routeTask('Rename foo to bar in util.py.', undefined, {quota: OK_QUOTA}).status, 'blocked');
});

// ---- Part 3: the real worker.cjs as a node child over JSON-RPC stdio
const PLUGIN = new URL('../agentcompass/', import.meta.url);
const workerContext = dir => ({session_id: 'true-session', workdir: dir, workdir_is_local: true, workdir_is_read_only: false});

const roots = [];
process.on('exit', () => {for (const root of roots) fs.rmSync(root, {recursive: true, force: true});});

function plugin(answer, code = 0, config = 'plugin') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-bridge-'));
  roots.push(root);
  const out = path.join(root, 'plugin');
  fs.mkdirSync(out);
  fs.cpSync(fileURLToPath(PLUGIN), out, {recursive: true});
  fs.rmSync(path.join(out, 'router.json'), {force: true});
  const home = path.join(root, 'home');
  const stateHome = path.join(home, '.agent-compass', 'cindy-plugin');
  fs.mkdirSync(stateHome, {recursive: true});
  const prompt = path.join(root, 'prompt.md');
  fs.writeFileSync(prompt, Buffer.from('unchanged 原文\r\nall lines', 'utf8'));
  const capture = path.join(root, 'captured.json'), calls = path.join(root, 'calls.log');
  const answerFile = path.join(root, 'answer.json');
  fs.writeFileSync(answerFile, JSON.stringify(answer).replace('"@PROMPT"', () => JSON.stringify(prompt)));
  const fake = path.join(root, 'fake-router.cjs');
  fs.writeFileSync(fake, `
const fs=require('node:fs');const chunks=[];
process.stdin.on('data',d=>chunks.push(d)).on('end',()=>{
  const stdin=Buffer.concat(chunks).toString('utf8');
  fs.appendFileSync(${JSON.stringify(calls)},'call\\n');
  fs.writeFileSync(${JSON.stringify(capture)},JSON.stringify({argv:process.argv.slice(2),stdin,
    cwd:process.cwd(),paseo:process.env.PASEO_AGENT_ID??null,hc:process.env.HC_TERMINAL_ID??null,legacy:process.env.ROUTER_CINDY_CONTEXT??null}));
  setTimeout(()=>{process.stdout.write(fs.readFileSync(${JSON.stringify(answerFile)},'utf8'));process.exit(${code});},stdin.includes('SLOW')?1500:0);
});`);
  const settings = {command: [process.execPath, fake], stateRoot: path.join(root, 'state')};
  if (config === 'plugin') fs.writeFileSync(path.join(out, 'router.json'), JSON.stringify(settings));
  if (config === 'home') fs.writeFileSync(path.join(stateHome, 'router.json'), JSON.stringify(settings));
  if (config === 'cli') fs.writeFileSync(path.join(stateHome, 'config.json'), JSON.stringify({engine: 'cli'}));
  const routerCalls = () => fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean).length : 0;
  return {root, out, prompt, capture, home, fake, stateHome, routerCalls,
    state: ['plugin', 'home'].includes(config) ? settings.stateRoot : stateHome};
}

const POSIX = process.platform !== 'win32';
function launcher(p, dir) {
  fs.mkdirSync(dir, {recursive: true});
  const file = path.join(dir, 'agentcompass');
  fs.writeFileSync(file, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(p.fake)} "$@"\n`);
  fs.chmodSync(file, 0o755);
  return file;
}

const SYSTEM = process.platform === 'win32' ? [path.join(process.env.SYSTEMROOT || 'C:\\Windows', 'System32')] : ['/usr/bin', '/bin'];
const only = dirs => [...dirs, ...SYSTEM].join(path.delimiter);
function rpc(p, requests, env = {}) {
  const proc = spawnSync(process.execPath, [path.join(p.out, 'worker.cjs')], {
    input: requests.map(r => JSON.stringify({jsonrpc: '2.0', ...r}) + '\n').join(''),
    env: {...process.env, PASEO_AGENT_ID: 'stale-paseo', HC_TERMINAL_ID: 'stale-terminal', ROUTER_CINDY_CONTEXT: 'stale',
          HOME: p.home, USERPROFILE: p.home, CODEX_HOME: path.join(p.home, '.codex'), PATH: only([]), ...env},
    encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(proc.status, 0, proc.stderr);
  const order = proc.stdout.trim().split('\n').map(line => JSON.parse(line));
  const replies = [...order].sort((a, b) => a.id - b.id);
  replies.order = order.map(r => r.id);
  return replies;
}
const prepare = (p, task, id = 1, catalog = REAL_CATALOG) => ({id, method: 'prepare', params: {task, catalog, context: workerContext(p.root)}});
const receipts = p => fs.existsSync(p.state) ? fs.readdirSync(p.state, {recursive: true}).filter(f => String(f).endsWith('receipt.json')) : [];

const native = bundle => ({status: 'native', parent_id: 'true-session', parent_host: 'native',
  route: {bundle}, worker_prompt_file: '@PROMPT'});
const codex = native({provider: 'codex', harness: 'codex', account: 'codex', model: 'm', effort: 'high'});

test('zero configuration: the built-in engine routes over the catalog Cindy passed, with no AgentCompass anywhere', () => {
  const p = plugin(codex, 0, 'none');
  const task = 'Rename the helper foo to bar in util.py and update its two callers.\r\n原文';
  const [reply] = rpc(p, [prepare(p, task)]);
  assert.equal(reply.result?.router?.status, 'native', JSON.stringify(reply));
  assert.equal(reply.result.engine, 'builtin');
  const b = reply.result.bundle;
  assert.ok(REAL_CATALOG.models.some(row => row.route.agentKind === b.harness && row.route.providerId === b.providerId &&
    row.route.model === b.model && row.efforts.includes(b.effort)), 'the route is a real catalog row: ' + JSON.stringify(b));
  assert.equal(b.modeId, 'full-access');
  assert.ok(reply.result.prompt.startsWith(task), 'the assignment is sent unchanged');
  assert.match(reply.result.prompt.slice(task.length), /Cindy plugin task return channel/);
  assert.equal(p.routerCalls(), 0);
  assert.deepEqual(receipts(p), [path.join(reply.result.operation, 'receipt.json')]);
  assert.ok(fs.existsSync(path.join(p.stateHome, reply.result.operation, 'router.stdout.json')));
  const op = reply.result.operation, wctx = workerContext(p.root);
  const fullPage = {items: [{id: 'out-1', role: 'assistant', content: 'chunked-body'}], nextCursor: null};
  const rawPage = JSON.stringify(fullPage);
  const outReplies = rpc(p, [
    {id: 2, method: 'output', params: {operation: op, stream: op + ':end:2', index: 0, chunk: rawPage.slice(0, 15), done: false, context: wctx}},
    {id: 3, method: 'output', params: {operation: op, stream: op + ':end:2', index: 1, chunk: rawPage.slice(15), done: true, context: wctx}},
  ]);
  assert.equal(outReplies[0].result.partial, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(outReplies[1].result.artifact, 'utf8')), fullPage);
});

test('built-in split, self, Pi for exploration and fast mode with fresh Codex quota telemetry', () => {
  const p = plugin(codex, 0, 'none');
  const sessions = path.join(p.home, '.codex', 'sessions', '2026', '11', '03');
  fs.mkdirSync(sessions, {recursive: true});
  fs.writeFileSync(path.join(sessions, 'rollout-x.jsonl'), JSON.stringify({type: 'event_msg', payload: {type: 'token_count',
    rate_limits: {primary: {used_percent: 12, window_minutes: 300, resets_at: Math.floor(Date.now() / 1000) + 3600}, secondary: null, plan_type: 'pro'}}}) + '\n');
  const replies = rpc(p, [
    prepare(p, 'Two independent tasks:\n1. Add a dark theme to the settings page.\n2. Fix the CSV export encoding bug in report.py.', 1),
    prepare(p, 'What is the difference between a mutex and a semaphore?', 2),
    prepare(p, 'Investigate why the login request fails: trace it through logs/ and the auth module and report the findings only.', 3),
    prepare(p, 'Use fast mode: rename the helper foo to bar in util.py and update its two callers.', 4),
  ]);
  assert.deepEqual([replies[0].result.router.status, replies[0].result.router.task_count, replies[0].result.bundle], ['split', '2', null]);
  assert.deepEqual([replies[1].result.router.status, replies[1].result.bundle], ['self', null]);
  assert.equal(replies[2].result.bundle.harness, 'pi');
  assert.deepEqual([replies[3].result.bundle.harness, replies[3].result.bundle.fast], ['codex', true]);
  assert.equal(replies[3].result.router.decision.quota.used_percent, 12);
});

test('router.json: the public roll command gets the host session as a native parent, the whole task on stdin and a scrubbed env', () => {
  const p = plugin(native({provider: 'codex', harness: 'codex', account: 'codex', model: 'gpt-test', effort: 'high'}));
  const replies = rpc(p, [prepare(p, 'full assignment 原文\r\n', 1), prepare(p, 'full assignment 原文\r\n', 2)]);
  assert.equal(replies[0].result.operation, replies[1].result.operation);
  assert.equal(replies[0].result.engine, 'cli');
  assert.equal(p.routerCalls(), 2);
  assert.equal(receipts(p).length, 1);
  const seen = JSON.parse(fs.readFileSync(p.capture, 'utf8'));
  assert.deepEqual(seen.argv, ['--parent-host', 'native', '--parent-id', 'true-session', '--parent-address', 'true-session',
    '--local-only', seen.argv[7], '--task', '-', '--verbose']);
  assert.match(seen.argv[7], /local project directory/);
  assert.equal(seen.stdin, 'full assignment 原文\r\n');
  assert.equal(fs.realpathSync(seen.cwd), fs.realpathSync(p.root));
  assert.deepEqual([seen.paseo, seen.hc, seen.legacy], [null, null, null]);
});

test('fleet bundles without modeId get the explicit launcher default and the Cindy return channel', () => {
  for (const [harness, mode] of [['codex', 'full-access'], ['claude', 'bypassPermissions'], ['pi', 'full-access']]) {
    const p = plugin(native({provider: harness, harness, account: harness, model: 'm', effort: 'high'}));
    const [reply] = rpc(p, [prepare(p, 'x')]);
    assert.equal(reply.result.bundle.modeId, mode, harness);
    assert.equal(reply.result.bundle.harness, harness);
    const original = fs.readFileSync(p.prompt, 'utf8');
    assert.ok(reply.result.prompt.startsWith(original), 'the router prompt is kept byte for byte');
    assert.match(reply.result.prompt.slice(original.length), /Cindy plugin task return channel/);
  }
});

test('an explicitly restricted mode or a harness Cindy cannot run is refused and leaves no receipt', () => {
  for (const bundle of [{provider: 'codex', harness: 'codex', account: 'codex', model: 'm', modeId: 'read-only'},
                        {provider: 'agy', harness: 'antigravity-resilient', account: 'agy', model: 'm'}]) {
    const p = plugin(native(bundle));
    const [reply] = rpc(p, [prepare(p, 'x')]);
    assert.ok(reply.error, JSON.stringify(reply));
    assert.match(reply.error.message, /read-only|cannot run routed harness/);
    assert.deepEqual(receipts(p), []);
  }
});

test('self and split from the CLI are recorded as the router answer; a blocked router is an error', () => {
  for (const status of ['self', 'split']) {
    const p = plugin({status, next_action: 'do it'}, 2);
    const [reply] = rpc(p, [prepare(p, 'x')]);
    assert.equal(reply.result.router.status, status);
    assert.equal(reply.result.bundle, null);
  }
  const p = plugin({status: 'blocked', error: 'no account'}, 2);
  const [reply] = rpc(p, [prepare(p, 'x')]);
  assert.match(reply.error.message, /no account/);
});

test('an untrusted context and a foreign session are refused before the router runs', () => {
  const p = plugin(native({provider: 'codex', harness: 'codex', account: 'codex', model: 'm'}));
  const bad = [{...workerContext(p.root), workdir_is_local: false}, {...workerContext(p.root), workdir_is_read_only: true}, {...workerContext(p.root), workdir: 'relative'}, null];
  const replies = rpc(p, bad.map((context, i) => ({id: i + 1, method: 'prepare', params: {task: 'x', context}})));
  assert.ok(replies.every(r => r.error));
  assert.equal(fs.existsSync(p.capture), false);
  const [first] = rpc(p, [prepare(p, 'x')]);
  const [foreign] = rpc(p, [{id: 2, method: 'load', params: {operation: first.result.operation, context: {...workerContext(p.root), session_id: 'other'}}}]);
  assert.match(foreign.error.message, /different parent/);
});

test('config.json {"engine":"cli"}: `agentcompass` on PATH, then ~/.local/bin, runs as `<it> roll ...`', {skip: !POSIX && 'needs a native agentcompass.exe launcher'}, () => {
  const p = plugin(codex, 0, 'cli');
  const bin = path.join(p.root, 'bin');
  const exe = launcher(p, bin);
  assert.equal(path.basename(exe), 'agentcompass');
  const [reply] = rpc(p, [prepare(p, 'opt-in 原文')], {PATH: only([bin])});
  assert.equal(reply.result?.engine, 'cli', JSON.stringify(reply));
  const seen = JSON.parse(fs.readFileSync(p.capture, 'utf8'));
  assert.deepEqual(seen.argv.slice(0, 4), ['roll', '--parent-host', 'native', '--parent-id']);
  assert.equal(seen.stdin, 'opt-in 原文');
  const q = plugin(codex, 0, 'cli');
  launcher(q, path.join(q.home, '.local', 'bin'));
  const [local] = rpc(q, [prepare(q, 'x')]);
  assert.equal(local.result?.engine, 'cli', JSON.stringify(local));
});

test('config.json {"engine":"cli"} with AgentCompass not installed falls back to the built-in engine, no error', () => {
  const p = plugin(codex, 0, 'cli');
  const [reply] = rpc(p, [prepare(p, 'Rename foo to bar in util.py.')]);
  assert.equal(reply.result?.engine, 'builtin', JSON.stringify(reply));
  assert.match(reply.result.router.engine_note, /not installed: the built-in engine routed/);
  fs.writeFileSync(path.join(p.stateHome, 'config.json'), '{"engine":"gpt"}');
  const [bad] = rpc(p, [prepare(p, 'another')]);
  assert.match(bad.error.message, /Unreadable plugin configuration.*"engine" must be/);
});

test('~/.agent-compass/cindy-plugin/router.json is used when the plugin has none; the plugin router.json wins', () => {
  const p = plugin(codex, 0, 'home');
  const [reply] = rpc(p, [prepare(p, 'x')]);
  assert.equal(reply.result?.router?.status, 'native', JSON.stringify(reply));
  assert.ok(fs.existsSync(path.join(p.state, reply.result.operation, 'receipt.json')));
  fs.writeFileSync(path.join(p.out, 'router.json'), JSON.stringify({command: [process.execPath, '-e', 'process.exit(3)'], stateRoot: path.join(p.root, 'own')}));
  const [own] = rpc(p, [prepare(p, 'x')]);
  assert.match(own.error.message, /Router returned no usable route/);
  assert.ok(fs.existsSync(path.join(p.root, 'own')));
  fs.writeFileSync(path.join(p.out, 'router.json'), '{broken');
  const [broken] = rpc(p, [prepare(p, 'x')]);
  assert.match(broken.error.message, /Unreadable plugin configuration/);
});

test('review 6: a router that exits without reading stdin (EPIPE) fails that roll only; the shared worker keeps serving', () => {
  const p = plugin(codex);
  fs.writeFileSync(path.join(p.out, 'router.json'), JSON.stringify({command: [process.execPath, '-e', 'process.exit(0)'], stateRoot: p.state}));
  const huge = 'x'.repeat(8 * 1024 * 1024);
  const replies = rpc(p, [prepare(p, huge, 1), prepare(p, huge + 'again', 2), {id: 3, method: 'load', params: {operation: 'f'.repeat(40), context: workerContext(p.root)}}]);
  for (const reply of replies.slice(0, 2)) assert.match(reply.error.message, /Router returned no usable route/);
  assert.match(replies[2].error.message, /ENOENT|no such file/);
  assert.deepEqual(receipts(p), []);
});

test('review 5: a slow route for one session does not hold up another operation in the shared worker', () => {
  const p = plugin(codex);
  const [done] = rpc(p, [prepare(p, 'quick one')]);
  const replies = rpc(p, [prepare(p, 'SLOW route', 1), {id: 2, method: 'load', params: {operation: done.result.operation, context: workerContext(p.root)}}]);
  assert.equal(replies[1].result.state, 'prepared');
  assert.equal(replies[0].result.router.status, 'native');
  assert.deepEqual(replies.order, [2, 1]);
});
