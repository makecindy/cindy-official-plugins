import {createRequire} from 'node:module';
import {createLearningService} from '../my-browser/learning-service.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createTranslationTask} from '../my-browser/translation-task.js';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function fixture(){
  let state,creates=0,seq=0,auto=true,sendFailure=false;
  const runs=new Map(),keys=new Map(),sends=[],cancelled=[],messages=[{id:'unrelated',role:'assistant',content:'not this result'}],events=[];
  const task={taskId:'one',title:'Browser translation',status:'active',revision:3};
  const tasks={capabilities:async()=>({operations:['create','get','send','getRun','readMessages','cancel']}),
    create:async()=>{creates++;return task;},get:async()=>task,
    send:async input=>{
      if(keys.has(input.requestKey))return structuredClone(runs.get(keys.get(input.requestKey)));
      sends.push(input);const n=++seq,run={runId:'r'+n,taskId:'one',status:'running',outputMessageId:'a'+n,acceptedConfig:{model:'chosen-by-user'}};
      runs.set(run.runId,run);keys.set(input.requestKey,run.runId);
      messages.push({id:'a'+n,role:'assistant',content:[{type:'text',text:JSON.stringify({translation:'result '+n})}]});
      if(sendFailure){sendFailure=false;throw Object.assign(Error('unconfirmed'),{code:'HOST_NOT_READY'});}
      return structuredClone(run);
    },
    getRun:async({runId})=>{const run=runs.get(runId);if(auto&&run.status==='running')run.status='completed';return structuredClone(run);},
    cancel:async({runId})=>{cancelled.push(runId);runs.get(runId).status='cancelled';return structuredClone(runs.get(runId));},
    readMessages:async()=>({items:messages,nextCursor:null})
  };
  const options={tasks,load:async()=>structuredClone(state),save:async value=>{state=structuredClone(value);},interval:1,timeout:500,locale:()=> 'zh-CN'};
  const make=()=>createTranslationTask(options);
  return {make,options,tasks,task,runs,sends,cancelled,messages,events,stats:()=>({creates,state}),auto:v=>auto=v,failSend:()=>sendFailure=true};
}
test('executes translations in one visible task and reuses it after restart, with the exact run output',async()=>{
  const f=fixture(),model=f.make();
  const a=await model({prompt:'Translate first',expectJson:true,source:{url:'https://example.test/a'}});
  const b=await model({prompt:'Translate another video'});
  const c=await f.make()({prompt:'After plugin restart'});
  assert.equal(f.stats().creates,1);assert.equal(f.sends.length,3);
  assert.equal(a.text,'{"translation":"result 1"}');assert.equal(b.text,'{"translation":"result 2"}');assert.equal(c.model,'chosen-by-user');
  assert.ok(f.sends.every(s=>s.taskId==='one'&&s.expectedRevision===3));assert.match(f.sends[0].text,/example.test\/a/);
  assert.equal(f.stats().state.pending,undefined);
});
function withPluginDefaults(f){
  let model='grok',checks=0;
  f.task.resolvedConfig={model:'astra'};
  const caps=f.tasks.capabilities;
  f.tasks.capabilities=async()=>({...await caps(),pluginDefaultModel:true,operations:[...(await caps()).operations,'setModel']});
  f.tasks.setModel=async req=>{
    checks++;assert.equal(req.route,'plugin-default');assert.equal(req.taskId,'one');assert.equal(req.expectedRevision,f.task.revision);
    if(f.task.resolvedConfig.model!==model){f.task.resolvedConfig={model};f.task.revision++;}
    return {task:structuredClone(f.task)};
  };
  const send=f.tasks.send;
  f.tasks.send=async req=>{assert.equal(req.expectedRevision,f.task.revision);return send(req);};
  return {select:value=>{model=value;},checks:()=>checks};
}
test('checks saved plugin model for first translation and each existing-task request, including restart',async()=>{
  const f=fixture(),defaults=withPluginDefaults(f),model=f.make();
  await model({prompt:'first'});
  assert.equal(f.task.resolvedConfig.model,'grok');assert.equal(defaults.checks(),1);
  defaults.select('astra');await model({prompt:'second'});
  assert.equal(f.task.resolvedConfig.model,'astra');
  defaults.select('grok');await f.make()({prompt:'third'});
  assert.equal(f.task.resolvedConfig.model,'grok');assert.equal(defaults.checks(),3);
  await model({prompt:'fourth'});assert.equal(defaults.checks(),4);
  assert.equal(f.stats().creates,1);assert.deepEqual(f.sends.map(s=>s.expectedRevision),[4,5,6,6]);
});
test('model preference failure never silently sends with the old task model',async()=>{
  const f=fixture();withPluginDefaults(f);
  f.tasks.setModel=async()=>{throw Object.assign(Error('unavailable'),{code:'ROUTE_UNAVAILABLE'});};
  await assert.rejects(f.make()({prompt:'x'}),/ROUTE_UNAVAILABLE/);
  assert.equal(f.sends.length,0);assert.equal(f.stats().state.pending,undefined);
});
test('resumes uncertain delivery before syncing new settings for the next passage',async()=>{
  const f=fixture(),defaults=withPluginDefaults(f);f.failSend();
  await assert.rejects(f.make()({prompt:'first'}),/HOST_NOT_READY/);
  defaults.select('astra');
  await f.make()({prompt:'first'});
  assert.equal(defaults.checks(),1);assert.equal(f.sends.length,1);assert.equal(f.task.resolvedConfig.model,'grok');
  await f.make()({prompt:'second'});
  assert.equal(defaults.checks(),2);assert.equal(f.task.resolvedConfig.model,'astra');assert.equal(f.sends.length,2);
});
test('queued translation reads settings when dispatched, not when it joined the queue',async()=>{
  const f=fixture(),defaults=withPluginDefaults(f),model=f.make();f.auto(false);
  const first=model({prompt:'first'});
  while(!f.sends.length)await wait(1);
  const second=model({prompt:'second'});
  defaults.select('astra');assert.equal(defaults.checks(),1);
  f.auto(true);await Promise.all([first,second]);
  assert.equal(defaults.checks(),2);assert.equal(f.task.resolvedConfig.model,'astra');
  assert.deepEqual(f.sends.map(s=>s.expectedRevision),[4,5]);assert.deepEqual(f.cancelled,[]);
});
test('switching videos cancels the old run; a cancelled queued passage is never sent',async()=>{
  const f=fixture();f.auto(false);const model=f.make();let firstActive=true,queuedActive=true;
  const active=value=>async()=>{if(!value())throw Error('REQUEST_CANCELLED');};
  const first=model({prompt:'old video'},{active:active(()=>firstActive)}).catch(e=>e.message);
  while(!f.sends.length)await wait(1);
  const queued=model({prompt:'old prefetch'},{active:active(()=>queuedActive)}).catch(e=>e.message);
  queuedActive=false;firstActive=false;
  const next=model({prompt:'new video'});
  assert.equal(await first,'REQUEST_CANCELLED');assert.equal(await queued,'REQUEST_CANCELLED');f.auto(true);
  assert.equal((await next).text,'{"translation":"result 2"}');
  assert.deepEqual(f.cancelled,['r1']);assert.equal(f.sends.length,2);assert.match(f.sends[1].text,/new video/);
});
test('uncertain delivery resumes the persisted request after restart instead of cancelling and sending again',async()=>{
  const f=fixture();f.auto(false);f.failSend();
  await assert.rejects(f.make()({prompt:'old',source:{url:'https://example.test/video',time:1}}),/HOST_NOT_READY/);
  const pending=f.stats().state.pending;assert.ok(pending.key);assert.equal(pending.runId,undefined);
  f.auto(true);
  const result=await f.make()({prompt:'old',source:{url:'https://example.test/video',time:5}});
  assert.equal(result.text,'{"translation":"result 1"}');assert.equal(f.sends.length,1);
  assert.deepEqual(f.cancelled,[]);assert.equal(f.stats().creates,1);
});
test('never substitutes another assistant message and does not recreate an archived or deleted task',async()=>{
  const f=fixture();f.tasks.readMessages=async()=>({items:[f.messages[0]],nextCursor:null});
  await assert.rejects(f.make()({prompt:'x'}),/TASK_OUTPUT_MISSING/);
  f.task.status='archived';await assert.rejects(f.make()({prompt:'x'}),/TASK_BUSY/);
  f.tasks.get=async()=>{throw Object.assign(Error('missing'),{code:'TASK_NOT_FOUND'});};
  await assert.rejects(f.make()({prompt:'x'}),/TASK_NOT_FOUND/);assert.equal(f.stats().creates,1);
});
test('missing public task capability fails explicitly without a short-text fallback',async()=>{
  const f=fixture();f.tasks.capabilities=async()=>({operations:['create','send']});
  await assert.rejects(f.make()({prompt:'x'}),/TASKS_UNAVAILABLE/);assert.equal(f.sends.length,0);assert.equal(f.stats().creates,0);
});
test('uses Host message cursors and rejects a run that lacks a terminal output identity',async()=>{
  const f=fixture();const cursors=[];
  f.tasks.readMessages=async req=>{cursors.push(req.after);return req.after?{items:f.messages.slice(1),nextCursor:null}:{items:[f.messages[0]],nextCursor:'host-cursor'};};
  await f.make()({prompt:'x'});assert.deepEqual(cursors,[undefined,'host-cursor']);assert.equal(f.stats().state.messageCursor,'host-cursor');
  const original=f.tasks.getRun;f.tasks.getRun=async r=>{const run=await original(r);delete run.outputMessageId;return run;};
  await assert.rejects(f.make()({prompt:'y'}),/TASK_OUTPUT_MISSING/);
});


test('learning service consumes the exact task reply, aligns subtitles and reuses the persistent cache',async()=>{
  const core=createRequire(import.meta.url)('../my-browser/extension/learning-core.js');
  const f=fixture(),files=new Map(),stages=[];
  const send=f.tasks.send;f.tasks.send=async req=>{const run=await send(req);f.messages.at(-1).content=JSON.stringify({turns:[{id:0,captions:[{text:'Hello world.',translation:'你好，世界。',paragraphEnd:true}]}]});return run;};
  const service=createLearningService({core,model:f.make(),library:async r=>r.op==='open'?{ok:true}:r.op==='read'?(files.has(r.path)?{ok:true,content:files.get(r.path)}:{ok:false,errorCode:'NOT_FOUND'}):(files.set(r.path,r.content),{ok:true})});
  const req={op:'subtitles',editorial:true,target:'zh-CN',source:{url:'https://www.youtube.com/watch?v=test',title:'Sample'},words:[{start:0,end:1,text:'Hello'},{start:1,end:2,text:'world.'}]};
  const profile='11111111-1111-4111-8111-111111111111';
  const result=await service.handle(profile,req,async()=>true,p=>{stages.push(p.stage);});
  assert.equal(result.cues[0].translation,'你好，世界。');assert.equal(result.cache.state,'saved');
  assert.ok(stages.includes('submitting-task'));assert.ok(stages.includes('model'));
  const cached=await service.handle(profile,req);assert.equal(cached.cues[0].translation,'你好，世界。');assert.equal(f.sends.length,1);assert.equal(f.stats().creates,1);
});


test('a known revision rejection does not pin all retries to obsolete model settings',async()=>{
  const f=fixture();const send=f.tasks.send;
  f.tasks.send=async()=>{throw Object.assign(Error('settings changed'),{code:'REVISION_CONFLICT'});};
  await assert.rejects(f.make()({prompt:'x'}),/REVISION_CONFLICT/);assert.equal(f.stats().state.pending,undefined);
  f.task.revision=4;f.tasks.send=send;await f.make()({prompt:'x'});assert.equal(f.sends[0].expectedRevision,4);assert.equal(f.stats().creates,1);
});

test('startup reconciliation waits for the same run instead of cancelling it for prefetch',async()=>{
  const f=fixture();const baseSend=f.tasks.send;const events=[];let polls=0;
  f.tasks.send=async request=>{const run=await baseSend(request);events.push('send:'+run.runId);return {...run,status:'queued'};};
  f.tasks.getRun=async({runId})=>{
    const run=f.runs.get(runId);if(runId==='r1'&&++polls<4)return {...run,status:'reconciling'};
    run.status='completed';events.push('completed:'+runId);return structuredClone(run);
  };
  const model=f.make(),stages=[];
  const first=model({prompt:'first passage'},{progress:async stage=>stages.push(stage)});
  const second=model({prompt:'prefetched passage'});
  const result=await Promise.all([first,second]);
  assert.equal(result[0].text,'{"translation":"result 1"}');assert.equal(result[1].text,'{"translation":"result 2"}');
  assert.deepEqual(f.cancelled,[]);assert.ok(events.indexOf('completed:r1')<events.indexOf('send:r2'));
  assert.ok(stages.includes('accepted'));
});
test('public history JSON objects are serialized without discarding the exact completed reply',async()=>{
  const f=fixture(),baseSend=f.tasks.send;
  const content={turns:[{id:0,captions:[{text:'Hello world.',translation:'你好，世界。',paragraphEnd:true}]}]};
  f.tasks.send=async input=>{const run=await baseSend(input);f.messages.at(-1).content=content;return run;};
  assert.deepEqual(JSON.parse((await f.make()({prompt:'x',expectJson:true})).text),content);
});
test('reconciliation remains bounded and cancellation is confirmed before later input',async()=>{
  const f=fixture();f.options.timeout=8;f.tasks.getRun=async({runId})=>({...f.runs.get(runId),status:'reconciling'});
  await assert.rejects(f.make()({prompt:'x'}),/TIMEOUT/);
  assert.deepEqual(f.cancelled,['r1']);assert.equal(f.sends.length,1);
});

test('a later passage waits for an uncertain earlier run without cancelling it',async()=>{
  const f=fixture();f.failSend();await assert.rejects(f.make()({prompt:'earlier'}),/HOST_NOT_READY/);
  const result=await f.make()({prompt:'later'});assert.equal(result.text,'{"translation":"result 2"}');
  assert.equal(f.runs.get('r1').status,'completed');assert.deepEqual(f.cancelled,[]);
});
test('a changed video cancels its persisted old run before a new request',async()=>{
  const f=fixture();f.auto(false);f.failSend();
  await assert.rejects(f.make()({prompt:'old',scope:'browser-a',source:{url:'https://example.test/old'}}),/HOST_NOT_READY/);
  f.auto(true);await f.make()({prompt:'new',scope:'browser-a',source:{url:'https://example.test/new'}});
  assert.deepEqual(f.cancelled,['r1']);assert.equal(f.sends.length,2);assert.equal(f.stats().creates,1);
});
test('an unreadable completed reply is retried by run identity without model resubmission',async()=>{
  const f=fixture();const read=f.tasks.readMessages;f.tasks.readMessages=async()=>{throw Object.assign(Error('temporarily unavailable'),{code:'HOST_NOT_READY'});};
  await assert.rejects(f.make()({prompt:'same'}),/HOST_NOT_READY/);assert.ok(f.stats().state.pending.runId);
  f.tasks.readMessages=read;await f.make()({prompt:'same'});assert.equal(f.sends.length,1);assert.deepEqual(f.cancelled,[]);
});
test('corrupt saved binding and mismatched host task/run identities never create a substitute',async()=>{
  const f=fixture();await f.options.save({taskId:'one'});
  await assert.rejects(f.make()({prompt:'x'}),/TASK_BINDING_INVALID/);assert.equal(f.stats().creates,0);assert.equal(f.sends.length,0);
  await f.options.save({taskId:'one',requestKey:'stable',title:'Browser translation'});
  f.tasks.get=async()=>({...f.task,taskId:'other'});await assert.rejects(f.make()({prompt:'x'}),/TASK_BINDING_INVALID/);
  f.tasks.get=async()=>f.task;const send=f.tasks.send;f.tasks.send=async input=>({...await send(input),taskId:'other'});
  await assert.rejects(f.make()({prompt:'x'}),/TASK_BINDING_INVALID/);assert.equal(f.stats().creates,0);assert.deepEqual(f.cancelled,[]);
});
test('lost task-create acknowledgement recovers using the same saved creation key',async()=>{
  const f=fixture(),keys=[];let first=true;
  f.tasks.create=async input=>{keys.push(input.requestKey);if(first){first=false;throw Object.assign(Error('lost acknowledgement'),{code:'HOST_NOT_READY'});}return f.task;};
  await assert.rejects(f.make()({prompt:'x'}),/HOST_NOT_READY/);await f.make()({prompt:'x'});
  assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);assert.equal(f.sends.length,1);
});
test('old package receipts migrate in place and keep their exact send key',async()=>{
  const f=fixture();f.failSend();await assert.rejects(f.make()({prompt:'old',source:{url:'https://example.test/video'}}),/HOST_NOT_READY/);
  const state=f.stats().state;delete state.pending.identity;delete state.pending.scope;delete state.pending.url;await f.options.save(state);
  await f.make()({prompt:'old',source:{url:'https://example.test/video',time:17}});
  assert.equal(f.sends.length,1);assert.deepEqual(f.cancelled,[]);assert.equal(f.stats().creates,1);
});

test('an unconfirmed cancellation survives restart and blocks all new sends until settled',async()=>{
  const f=fixture();let clock=0;f.options.now=()=>clock;f.options.sleep=async()=>{clock+=10000;};f.options.timeout=1;
  f.auto(false);f.tasks.cancel=async({runId})=>{f.cancelled.push(runId);f.runs.get(runId).status='stopping';return structuredClone(f.runs.get(runId));};
  await assert.rejects(f.make()({prompt:'old'}),/TASK_STOPPING/);
  assert.equal(f.stats().state.pending.cancelRequested,true);assert.equal(f.sends.length,1);
  await assert.rejects(f.make()({prompt:'new'}),/TASK_STOPPING/);assert.equal(f.sends.length,1);
  f.runs.get('r1').status='cancelled';f.auto(true);f.options.timeout=100000;
  await f.make()({prompt:'new'});assert.equal(f.sends.length,2);assert.equal(f.stats().creates,1);
});


test('prefetched slow passages share a budget that includes serial queueing and repairs',async()=>{
 const core=createRequire(import.meta.url)('../my-browser/extension/learning-core.js');
 const f=fixture();let clock=0;const sleepers=[],started=new Map();
 const send=f.tasks.send;f.tasks.send=async req=>{const run=await send(req);started.set(run.runId,clock);return run;};
 f.tasks.getRun=async({runId})=>{const run=f.runs.get(runId);if(run.status==='running'&&clock-started.get(runId)>=180000)run.status='completed';return structuredClone(run);};
 const model=createTranslationTask({...f.options,timeout:core.learningTiming.model,now:()=>clock,sleep:()=>new Promise(r=>sleepers.push(r))});
 const deadline=core.learningRequestTimeout({op:'subtitles',editorial:true});
 const active=async()=>{if(clock>=deadline)throw Error('REQUEST_CANCELLED');};
 const requests=[model({prompt:'first'},{active}),model({prompt:'second'},{active})];
 for(let i=0;i<42;i++){await wait(0);clock+=10000;for(const resolve of sleepers.splice(0))resolve();}
 const results=await Promise.all(requests);assert.equal(results.length,2);assert.deepEqual(f.cancelled,[]);
 assert.ok(started.get('r2')>=180000);assert.equal(core.learningRequestTimeout({op:'config'}),core.learningTiming.transport);
 // Both editorial validation attempts may queue behind another 240s model run.
 assert.ok(deadline>4*(core.learningTiming.model+core.learningTiming.cancel)+2*core.learningTiming.queue);
});

test('switching the task model during a passage resubmits it with the new model instead of stopping',async()=>{
  const f=fixture();f.auto(false);const model=f.make();
  const pending=model({prompt:'in flight'});
  while(!f.sends.length)await wait(1);
  // The task model menu changes the config revision and the Host fails the old run.
  f.task.revision=4;f.runs.get('r1').status='failed';f.auto(true);
  const result=await pending;
  assert.equal(result.text,'{"translation":"result 2"}');
  assert.deepEqual(f.sends.map(s=>s.expectedRevision),[3,4]);assert.notEqual(f.sends[0].requestKey,f.sends[1].requestKey);
  assert.deepEqual(f.cancelled,[]);assert.equal(f.stats().state.pending,undefined);assert.equal(f.stats().creates,1);
});
test('a failed run without a configuration change is reported, never silently resubmitted',async()=>{
  const f=fixture();f.auto(false);const pending=f.make()({prompt:'x'});
  while(!f.sends.length)await wait(1);
  f.runs.get('r1').status='failed';f.auto(true);
  await assert.rejects(pending,/TASK_FAILED/);assert.equal(f.sends.length,1);assert.equal(f.stats().state.pending,undefined);
});
test('a one-off revision conflict or concurrent setting change retries with the current settings',async()=>{
  const f=fixture(),send=f.tasks.send;let conflicts=1;
  f.tasks.send=async req=>{if(conflicts-->0){f.task.revision=4;throw Object.assign(Error('settings changed'),{code:'REVISION_CONFLICT'});}return send(req);};
  const result=await f.make()({prompt:'x'});
  assert.equal(result.text,'{"translation":"result 1"}');assert.deepEqual(f.sends.map(s=>s.expectedRevision),[4]);
  const g=fixture(),defaults=withPluginDefaults(g),setModel=g.tasks.setModel;let stale=1;
  g.tasks.setModel=async req=>{if(stale-->0){defaults.select('grok-new');throw Object.assign(Error('plugin setting changed'),{code:'STALE_REVISION'});}return setModel(req);};
  defaults.select('grok');await g.make()({prompt:'y'});
  assert.equal(g.task.resolvedConfig.model,'grok-new');assert.equal(g.sends.length,1);assert.equal(g.stats().state.pending,undefined);
});
test('a run the user cancelled from the task is not resent even if the model changed',async()=>{
  for(const status of ['cancelled','interrupted']){
    const f=fixture();f.auto(false);const pending=f.make()({prompt:'x'});
    while(!f.sends.length)await wait(1);
    f.task.revision=4;f.runs.get('r1').status=status;f.auto(true);
    await assert.rejects(pending,status==='cancelled'?/REQUEST_CANCELLED/:/TASK_INTERRUPTED/);
    assert.equal(f.sends.length,1,status);assert.equal(f.stats().state.pending,undefined,status);
  }
});

// Hosts that grant background tasks: one hidden task per video, archived on switch.
function perVideoFixture({archiveOp=true}={}){
  let state,seq=0;const created=[],archived=[],tasksById=new Map(),runs=new Map(),keys=new Map(),sends=[],messages=[];
  const ops=['create','get','send','getRun','readMessages','cancel',...(archiveOp?['archive']:[])];
  const tasks={capabilities:async()=>({operations:ops,hiddenTasks:true}),
    create:async input=>{let task=created.find(t=>t.requestKey===input.requestKey)?.task;if(!task){task={taskId:'t'+(created.length+1),title:input.title,status:'active',revision:1,hidden:input.hidden===true};tasksById.set(task.taskId,task);}created.push({requestKey:input.requestKey,title:input.title,hidden:input.hidden,task});return structuredClone(task);},
    get:async({taskId})=>{const t=tasksById.get(taskId);if(!t)throw Object.assign(Error('missing'),{code:'TASK_NOT_FOUND'});return structuredClone(t);},
    send:async input=>{if(keys.has(input.requestKey))return structuredClone(runs.get(keys.get(input.requestKey)));sends.push(input);const n=++seq,run={runId:'r'+n,taskId:input.taskId,status:'completed',outputMessageId:'a'+n};runs.set(run.runId,run);keys.set(input.requestKey,run.runId);messages.push({id:'a'+n,role:'assistant',content:'result '+n});return structuredClone(run);},
    getRun:async({runId})=>structuredClone(runs.get(runId)),
    cancel:async({runId})=>{runs.get(runId).status='cancelled';return structuredClone(runs.get(runId));},
    readMessages:async()=>({items:messages,nextCursor:null}),
    archive:async({taskId})=>{const t=tasksById.get(taskId);if(!t)throw Object.assign(Error('missing'),{code:'TASK_NOT_FOUND'});if(t.busy)throw Object.assign(Error('busy'),{code:'TASK_BUSY'});t.status='archived';archived.push(taskId);return structuredClone(t);}};
  const options={tasks,load:async()=>structuredClone(state),save:async v=>{state=structuredClone(v);},interval:1,timeout:500,locale:()=> 'zh-CN'};
  return {make:()=>createTranslationTask(options),options,tasks,created,archived,tasksById,sends,state:()=>state};
}
const yt=(id,title)=>({url:'https://www.youtube.com/watch?v='+id,title,time:3});
test('per-video mode: each video gets its own hidden task titled after it; switching archives the previous one',async()=>{
  const f=perVideoFixture(),model=f.make();
  const a=await model({prompt:'p1',scope:'browser-a',source:yt('aaa','First video - YouTube')});
  await model({prompt:'p2',scope:'browser-a',source:yt('aaa','First video - YouTube',9)});
  assert.equal(a.taskId,'t1');assert.equal(f.created.length,1);assert.equal(f.created[0].hidden,true);assert.equal(f.created[0].title,'字幕翻译 · First video');
  assert.deepEqual(f.archived,[]);
  const b=await model({prompt:'p3',scope:'browser-a',source:yt('bbb','Second video')});
  assert.equal(b.taskId,'t2');assert.deepEqual(f.archived,['t1'],'the previous video task is archived once its run settled');
  // Bug regression (handoff 2026-10-28): returning to the first video used to find its archived task and fail with TASK_BUSY.
  const back=await model({prompt:'p4',scope:'browser-a',source:yt('aaa','First video')});
  assert.equal(back.taskId,'t3','a fresh task under a new creation key');assert.notEqual(f.created[2].requestKey,f.created[0].requestKey);
  assert.deepEqual(f.archived,['t1','t2']);assert.equal(f.state().videos['youtube:aaa'].sends,1);
});
test('per-video mode: a second browser on another video does not retire the first browser\'s task',async()=>{
  const f=perVideoFixture(),model=f.make();
  await model({prompt:'a1',scope:'browser-a',source:yt('aaa','A')});
  await model({prompt:'b1',scope:'browser-b',source:yt('bbb','B')});
  const again=await model({prompt:'a2',scope:'browser-a',source:yt('aaa','A')});
  assert.equal(again.taskId,'t1');assert.deepEqual(f.archived,[]);assert.equal(f.created.length,2);
  // Only when no browser is left on a video does moving away archive it.
  await model({prompt:'b2',scope:'browser-b',source:yt('ccc','C')});assert.deepEqual(f.archived,['t2']);
  await model({prompt:'a3',scope:'browser-a',source:yt('ccc','C')});assert.deepEqual(f.archived,['t2','t1']);
});
test('per-video mode: a task the user archived or deleted is replaced, never resumed',async()=>{
  const f=perVideoFixture(),model=f.make();
  await model({prompt:'a',scope:'s',source:yt('one','One')});
  f.tasksById.get('t1').status='archived';
  assert.equal((await model({prompt:'b',scope:'s',source:yt('one','One')})).taskId,'t2');
  f.tasksById.delete('t2');
  assert.equal((await model({prompt:'c',scope:'s',source:yt('one','One')})).taskId,'t3');
  assert.deepEqual(f.archived,[],'nothing is archived or unarchived on the user\'s behalf');
});
test('per-video mode: a lost creation receipt replays the same creation key instead of minting a second task',async()=>{
  const f=perVideoFixture(),create=f.tasks.create;let lose=1;
  f.tasks.create=async input=>{const task=await create(input);if(lose-->0)throw Object.assign(Error('socket hang up'),{code:'TRANSPORT'});return task;};
  const model=f.make();
  await assert.rejects(model({prompt:'a',scope:'s',source:yt('one','One')}),/TRANSPORT/);
  const r=await model({prompt:'b',scope:'s',source:yt('one','One')});
  assert.equal(r.taskId,'t1');assert.equal(f.created.length,2);assert.equal(f.created[0].requestKey,f.created[1].requestKey);assert.equal(f.tasksById.size,1);
});
test('per-video mode: a second extension connection watching the same video shares its task',async()=>{
  // Bug regression (2026-10-28): two extension client ids were briefly online and the same video got two tasks.
  const f=perVideoFixture(),model=f.make();
  await model({prompt:'a',scope:'client-1',source:yt('same','Same video')});
  await model({prompt:'b',scope:'client-2',source:yt('same','Same video')});
  assert.equal(f.created.length,1);assert.equal(f.sends.length,2);assert.deepEqual(f.archived,[]);
});
test('per-video mode: the same video id with a different page URL shape maps to one task',async()=>{
  const f=perVideoFixture(),model=f.make();
  await model({prompt:'a',scope:'s',source:{url:'https://www.youtube.com/watch?v=xyz&t=12s',title:'V'}});
  await model({prompt:'b',scope:'s',source:{url:'https://m.youtube.com/watch?v=xyz#top',title:'V'}});
  assert.equal(f.created.length,1);assert.equal(f.sends.length,2);
});
test('per-video mode: only the most recent bindings are kept; the forgotten ones are archived',async()=>{
  const f=perVideoFixture(),model=f.make();
  for(let i=0;i<22;i++)await model({prompt:'p'+i,scope:'s',source:yt('v'+i,'Video '+i)});
  // Coming back to an evicted video starts a new task; the archived one is not handed back by the host's idempotent create.
  assert.equal((await model({prompt:'back',scope:'s',source:yt('v0','Video 0')})).taskId,'t23');
  const state=f.state();
  // One browser watching videos in turn leaves only its current binding; every task it left is archived exactly once.
  assert.deepEqual(Object.keys(state.videos),['youtube:v0']);assert.deepEqual(state.recent,['youtube:v0']);
  assert.equal(f.archived.length,22);assert.equal(new Set(f.archived).size,22);
});
test('per-video mode: a long video rolls to a fresh task after the send budget',async()=>{
  const f=perVideoFixture(),model=f.make();
  const state0=await f.options.load();
  for(let i=0;i<101;i++)await model({prompt:'p'+i,scope:'s',source:yt('long','Long')});
  assert.equal(f.created.length,2);assert.notEqual(f.created[0].requestKey,f.created[1].requestKey);
  assert.deepEqual(f.archived,['t1']);assert.equal(f.state().videos['youtube:long'].taskId,'t2');assert.equal(f.sends.length,101);
  assert.equal(state0,undefined);
});
test('per-video mode: archive refusals and hosts without archive never block translation',async()=>{
  const f=perVideoFixture(),model=f.make();
  await model({prompt:'a',scope:'s',source:yt('one','One')});f.tasksById.get('t1').busy=true;
  const r=await model({prompt:'b',scope:'s',source:yt('two','Two')});
  assert.equal(r.taskId,'t2');assert.deepEqual(f.archived,[]);
  const g=perVideoFixture({archiveOp:false}),m2=g.make();
  await m2({prompt:'a',scope:'s',source:yt('one','One')});await m2({prompt:'b',scope:'s',source:yt('two','Two')});
  assert.equal(g.created.length,2);assert.deepEqual(g.archived,[]);
});
test('per-video mode: the legacy shared task is archived once after its pending run is settled',async()=>{
  const f=perVideoFixture();
  f.tasksById.set('legacy',{taskId:'legacy',title:'浏览器翻译',status:'active',revision:2});
  await f.options.save({requestKey:'browser-translation-v1',title:'浏览器翻译',taskId:'legacy'});
  const model=f.make();
  const r=await model({prompt:'a',scope:'s',source:yt('one','One')});
  assert.equal(r.taskId,'t1');assert.deepEqual(f.archived,['legacy']);assert.equal(f.state().legacyArchived,true);
  await model({prompt:'b',scope:'s',source:yt('one','One')});assert.deepEqual(f.archived,['legacy']);
});
test('per-video mode: a pending receipt replays to its own task even after another video is opened',async()=>{
  const f=perVideoFixture();const send=f.tasks.send;let failOnce=true;
  f.tasks.send=async input=>{if(failOnce){failOnce=false;await send(input);throw Object.assign(Error('lost'),{code:'HOST_NOT_READY'});}return send(input);};
  await assert.rejects(f.make()({prompt:'a',scope:'s',source:yt('one','One')}),/HOST_NOT_READY/);
  assert.equal(f.state().pending.taskId,'t1');
  const r=await f.make()({prompt:'b',scope:'s',source:yt('two','Two')});
  assert.equal(r.taskId,'t2');assert.equal(f.sends.length,2);assert.equal(f.sends[0].taskId,'t1');assert.equal(f.tasksById.get('t1').status,'archived');
});

test('per-video mode: fixed rules travel once per task; later passages send a reminder',async()=>{
  // Rule (2026-10-28): the 1.5K-character editing rules were resent with every passage.
  const f=perVideoFixture(),model=f.make();
  const rules='RULES: edit and translate.\n',reminder='REMINDER\n';
  const ask=(n,extra={})=>model({prompt:rules+'{"passage":'+n+'}',rules,reminder,scope:'s',source:yt('one','One'),...extra});
  for(let i=1;i<=3;i++)await ask(i);
  const texts=f.sends.map(s=>s.text);
  assert.ok(texts[0].includes('RULES: edit and translate.'));assert.ok(!texts[0].includes('REMINDER'));
  for(const text of texts.slice(1)){assert.ok(!text.includes('RULES: edit'));assert.ok(text.includes('REMINDER\n{"passage":'));}
  // A retry asks for the full rules again; a model change (new revision) resends them once.
  await ask(4,{fullRules:true});assert.ok(f.sends.at(-1).text.includes('RULES: edit'));
  await ask(5);assert.ok(!f.sends.at(-1).text.includes('RULES: edit'));
  f.tasksById.get('t1').revision=2;await ask(6);assert.ok(f.sends.at(-1).text.includes('RULES: edit'),'after a model change');
  // Different rules (another target language) are sent in full.
  await model({prompt:'OTHER RULES\n{}',rules:'OTHER RULES\n',reminder,scope:'s',source:yt('one','One')});
  assert.ok(f.sends.at(-1).text.includes('OTHER RULES'));
});
test('per-video mode: the full rules come back periodically so a compacted history regains them',async()=>{
  const f=perVideoFixture(),model=f.make();const rules='RULES\n';
  for(let i=0;i<41;i++)await model({prompt:rules+i,rules,reminder:'R\n',scope:'s',source:yt('one','One')});
  const full=f.sends.map((s,i)=>s.text.includes('RULES\n')?i:-1).filter(i=>i>=0);
  assert.deepEqual(full,[0,20,40]);
});

test('per-video mode: earlier translated captions ride with the full rules, so a fresh task keeps names and terms',async()=>{
  const f=perVideoFixture(),model=f.make();const rules='RULES\n',reference='REFERENCE: Rosalyn = 罗莎琳\n';
  const ask=(n,extra={})=>model({prompt:rules+'{"p":'+n+'}',rules,reminder:'R\n',reference,scope:'s',source:yt('one','One'),...extra});
  await ask(1);await ask(2);
  assert.ok(f.sends[0].text.includes('RULES\nREFERENCE: Rosalyn = 罗莎琳\n{"p":1}'),'reference sits between the rules and the passage');
  assert.ok(!f.sends[1].text.includes('REFERENCE'),'within a task the history already has it');
  // A new task for the video (here: the user archived the old one) starts with the reference again.
  f.tasksById.get('t1').status='archived';await ask(3);
  assert.equal(f.sends.at(-1).taskId,'t2');assert.ok(f.sends.at(-1).text.includes('REFERENCE'));
});
