// AgentCompass plugin (agentcompass/). Source and full sandbox suite: https://github.com/akiiwa-games/cindy-agentcompass-plugin
// Part 1, main.js at the official tasks API boundary with a fixture host: exact route and permission per harness
// (Codex, Claude, Pi), fast mode, unchanged task, idempotent create/send, honest stop/cancel/cleanup. Not a Cindy runtime test.
// Part 2, the real worker.cjs as a node child over JSON-RPC stdio with a recording stand-in for `agentcompass roll`:
// the native-parent command line, the scrubbed environment, the explicit permission contract, and zero-configuration
// discovery (PATH, ~/.local/bin, ~/.agent-compass/cindy-plugin/{router,account-map}.json).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import {spawnSync} from 'node:child_process';

const source=fs.readFileSync(new URL('../agentcompass/main.js',import.meta.url),'utf8');
const ctx={session_id:'true-parent',workdir:'E:/project',workdir_is_local:true,workdir_is_read_only:false};
const route={agentKind:'codex',providerId:'codex',model:'gpt-test',effort:'high',fastMode:false};
function fixture(options={}) {
  const records=new Map(), calls=[], messages=[], waiters=new Map();
  let handler, serial=0;
  const task={taskId:'child-task',revision:4,resolvedConfig:{...route},permissionMode:'bypassPermissions',workingDir:ctx.workdir};
  const run={runId:'run-1',taskId:task.taskId,status:'running',acceptedConfig:route};
  const cindy={
    node:{request:async request=>{
      calls.push(['node',request.method]);
      const {method,params}=request;
      if (method==='prepare') {
        const operation='a'.repeat(40);
        if (!records.has(operation)) records.set(operation,options.prepared || {parent:ctx.session_id,state:'prepared',
          bundle:{provider:'codex',account:'codex',harness:'codex',model:'gpt-test',effort:'high',modeId:'full-access'},
          prompt:'完整原文\r\nunchanged',router:{status:'native'},mappings:[]});
        return {ok:true,result:{operation,...structuredClone(records.get(operation))}};
      }
      const record=records.get(params.operation);
      if (record?.parent!==params.context.session_id) return {ok:false,message:'parent ownership mismatch'};
      if (method==='save') {records.set(params.operation,structuredClone(params.record));return {ok:true,result:{saved:true}};}
      if (method==='load') return {ok:true,result:structuredClone(record)};
      if (method==='output') return {ok:true,result:{artifact:'/test/full-message-page.json'}};
      throw Error('unexpected node method');
    }},
    tasks:{
      capabilities:async()=>({operations:['models','create','send','get','getRun','listRuns','readMessages','cancel','archive'],exactRoute:true,createPermissionMode:true}),
      models:async()=>({models:[{route,efforts:['high'],supportsFastMode:true}]}),
      create:async request=>{calls.push(['create',structuredClone(request)]);return structuredClone(task);},
      send:async request=>{calls.push(['send',structuredClone(request)]);if(options.uncertain) throw Error('DELIVERY_UNCERTAIN');return structuredClone(run);},
      getRun:async request=>{calls.push(['getRun',request]);return structuredClone(run);},
      listRuns:async()=>({items:[structuredClone(run)],nextCursor:null}),
      readMessages:async request=>{calls.push(['readMessages',request]);return request.after ?
        {items:[{id:'out-exact',role:'assistant',content:'[Worker final report] '+ '实'.repeat(6000)}],nextCursor:null} :
        {items:[{id:'unrelated',content:'wrong output'}],nextCursor:'page-2'};},
      cancel:async request=>{calls.push(['cancel',request]);run.status='stopping';return structuredClone(run);},
      archive:async request=>{calls.push(['archive',request]);return task;}
    },
    onHostMessage:callback=>{handler=callback;},
    send:message=>{messages.push(message);waiters.get(message.callId)?.(message);}
  };
  vm.runInNewContext(source,{cindy,Set,Boolean,Error,JSON});
  const send=(tool,args={},context=ctx)=>new Promise(resolve=>{
    const callId='call-'+(++serial);waiters.set(callId,resolve);
    handler({type:'tool-call',tool,callId,args:{...args,session_context:context}});
  });
  return {cindy,task,run,send,calls,records};
}
test('exact route/permission, unchanged task, concurrent repeats create and send once',async()=>{
  const f=fixture();
  const replies=await Promise.all([f.send('roll',{task:'x'}),f.send('roll',{task:'x'})]);
  assert.ok(replies.every(r=>r.ok));
  assert.equal(f.calls.filter(c=>c[0]==='create').length,1);
  assert.equal(f.calls.filter(c=>c[0]==='send').length,1);
  const request=f.calls.find(c=>c[0]==='send')[1];
  assert.equal(request.expectedRevision,4);
  assert.equal(request.text,'完整原文\r\nunchanged');
  assert.equal(replies[0].result.automatic_callback,false);
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
});
test('unknown send is observed with listRuns and never sent twice',async()=>{
  const f=fixture({uncertain:true});const first=await f.send('roll',{task:'x'});
  assert.equal(first.result.status,'unknown_send');
  const recovered=await f.send('status',{operation:first.result.operation});
  assert.equal(recovered.result.runId,'run-1');
  assert.equal(f.calls.filter(c=>c[0]==='send').length,1);
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
    assert.equal(f.calls.filter(c=>c[0]==='create').length,0);
  }
});
test('wrong model/provider/permission/directory cannot receive model input',async()=>{
  for(const archive of [true,false]) {
  for(const kind of ['model','provider','permission','directory']) {
    const f=fixture();
    if(!archive) {
      const capabilities=f.cindy.tasks.capabilities;
      f.cindy.tasks.capabilities=async()=>{const caps=await capabilities();return {...caps,operations:caps.operations.filter(op=>op!=='archive')};};
      delete f.cindy.tasks.archive;
    }
    if(kind==='model') f.cindy.tasks.models=async()=>({models:[{route:{...route,model:'other'}}]});
    if(kind==='provider') f.cindy.tasks.models=async()=>({models:[{route:{...route,providerId:'other'}}]});
    if(kind==='permission') f.task.permissionMode='ask';
    if(kind==='directory') f.task.workingDir='E:/different';
    const reply=await f.send('roll',{task:'x'});
    assert.equal(f.calls.filter(c=>c[0]==='send').length,0);
    if(['permission','directory'].includes(kind)) {
      assert.equal(f.calls.filter(c=>c[0]==='archive').length,archive?1:0);
      assert.equal(reply.result.taskId,f.task.taskId);
      assert.equal(reply.result.draft_cleanup,archive?'archived':'manual_cleanup_required');
    }
  }
  }
});
test('lost create is not retried and a failed run preserves failure without inventing output',async()=>{
  const f=fixture();f.cindy.tasks.create=async()=>{throw Error('transport lost');};
  const first=await f.send('roll',{task:'x'});
  assert.equal(first.result.status,'unknown_create');
  const observed=await f.send('status',{operation:first.result.operation});
  assert.equal(observed.result.status,'unknown_create');
  assert.equal(f.calls.filter(c=>c[0]==='send').length,0);
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
  if (!archive) {
    const capabilities=f.cindy.tasks.capabilities;
    f.cindy.tasks.capabilities=async()=>{const caps=await capabilities();return {...caps,operations:caps.operations.filter(op=>op!=='archive')};};
    delete f.cindy.tasks.archive;
  }
  const first=await f.send('roll',{task:'x'});assert.equal(first.ok,true);
  const args={operation:first.result.operation};
  assert.equal((await f.send('stop',args)).result.status,'stopping');
  assert.equal((await f.send('cleanup',args)).ok,false);
  f.run.status='cancelled';
  for(let i=0;i<2;i++) {
    const cleaned=(await f.send('cleanup',args)).result;
    assert.equal(cleaned.status,archive?'cleaned':'manual_cleanup_required');
    if (!archive) {assert.equal(cleaned.taskId,f.task.taskId);assert.equal(cleaned.archived,false);}
  }
  assert.equal(f.calls.filter(c=>c[0]==='archive').length,archive?1:0);
  }
});
// Each harness Cindy runs, as the router names it, reaches exactly one catalog row with the bypass permission.
function routed(bundle,catalogRoute,{mappings=[],supportsFastMode=true}={}) {
  const f=fixture({prepared:{parent:ctx.session_id,state:'prepared',router:{status:'native'},bundle,prompt:'p',mappings}});
  f.cindy.tasks.models=async()=>({models:[{route:{...catalogRoute,fastMode:false},efforts:[catalogRoute.effort],supportsFastMode},
    {route:{...catalogRoute,model:catalogRoute.model+'-nearby',fastMode:false},efforts:[catalogRoute.effort],supportsFastMode}]});
  f.task.resolvedConfig={...catalogRoute};
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
  assert.equal(slow.calls.filter(c=>c[0]==='create').length,0);
  const plain=routed({...bundle,fast:false},{...want,fastMode:false});
  await plain.send('roll',{task:'x'});
  assert.equal(plain.calls.find(c=>c[0]==='create')[1].route.fastMode,false);
});
test('stop reports stopping honestly, then status reports the confirmed cancelled terminal state',async()=>{
  const f=fixture();const first=await f.send('roll',{task:'x'});
  const args={operation:first.result.operation};
  const stopping=(await f.send('stop',args)).result;
  assert.equal(stopping.status,'stopping');
  assert.equal((await f.send('status',args)).result.next_action.includes('No automatic callback'),true,'stopping is not terminal');
  f.run.status='cancelled';
  const cancelled=(await f.send('status',args)).result;
  assert.equal(cancelled.status,'cancelled');
  assert.match(cancelled.next_action,/Cleanup archives/);
  assert.equal(cancelled.output_available,false);
});

const PLUGIN = new URL('../agentcompass/', import.meta.url);
const workerContext = dir => ({session_id: 'true-session', workdir: dir, workdir_is_local: true, workdir_is_read_only: false});

const roots = [];
process.on('exit', () => {for (const root of roots) fs.rmSync(root, {recursive: true, force: true});});

// One plugin directory with a fake router that records argv, stdin and environment and prints `answer`. `config`:
//   'plugin' router.json next to worker.cjs (scripts/build_plugin.py), 'home' ~/.agent-compass/cindy-plugin/router.json,
//   'none' no configuration at all (a market install; the test puts an `agentcompass` launcher where it should be found).
function plugin(answer, code = 0, config = 'plugin') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-bridge-'));
  roots.push(root);
  const out = path.join(root, 'plugin');
  fs.mkdirSync(out);
  for (const name of ['ghost.json', 'main.js', 'worker.cjs']) fs.copyFileSync(new URL(name, PLUGIN), path.join(out, name));
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.agent-compass', 'cindy-plugin'), {recursive: true});
  const prompt = path.join(root, 'prompt.md');
  fs.writeFileSync(prompt, Buffer.from('unchanged 原文\r\nall lines', 'utf8'));
  const capture = path.join(root, 'captured.json');
  const answerFile = path.join(root, 'answer.json');
  fs.writeFileSync(answerFile, JSON.stringify(answer).replace('"@PROMPT"', () => JSON.stringify(prompt)));
  const fake = path.join(root, 'fake-router.cjs');
  fs.writeFileSync(fake, `
const fs=require('node:fs');const chunks=[];
process.stdin.on('data',d=>chunks.push(d)).on('end',()=>{
  fs.writeFileSync(${JSON.stringify(capture)},JSON.stringify({argv:process.argv.slice(2),stdin:Buffer.concat(chunks).toString('utf8'),
    cwd:process.cwd(),paseo:process.env.PASEO_AGENT_ID??null,hc:process.env.HC_TERMINAL_ID??null,legacy:process.env.ROUTER_CINDY_CONTEXT??null}));
  process.stdout.write(fs.readFileSync(${JSON.stringify(answerFile)},'utf8'));
  process.exit(${code});
});`);
  const settings = {command: [process.execPath, fake], stateRoot: path.join(root, 'state')};
  if (config === 'plugin') fs.writeFileSync(path.join(out, 'router.json'), JSON.stringify(settings));
  if (config === 'home') fs.writeFileSync(path.join(home, '.agent-compass', 'cindy-plugin', 'router.json'), JSON.stringify(settings));
  return {root, out, prompt, capture, home, fake, state: config === 'none' ? path.join(home, '.agent-compass', 'cindy-plugin') : settings.stateRoot};
}

// An installed `agentcompass` command that runs the fake router: an executable sh script. On Windows discovery needs a
// native agentcompass.exe (as pip/uv install it); the plugin repository's own tests build one, so these tests run on POSIX.
const POSIX = process.platform !== 'win32';
function launcher(p, dir) {
  fs.mkdirSync(dir, {recursive: true});
  const file = path.join(dir, 'agentcompass');
  fs.writeFileSync(file, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(p.fake)} "$@"\n`);
  fs.chmodSync(file, 0o755);
  return file;
}

function rpc(p, requests, env = {}) {
  const proc = spawnSync(process.execPath, [path.join(p.out, 'worker.cjs')], {
    input: requests.map(r => JSON.stringify({jsonrpc: '2.0', ...r}) + '\n').join(''),
    env: {...process.env, PASEO_AGENT_ID: 'stale-paseo', HC_TERMINAL_ID: 'stale-terminal', ROUTER_CINDY_CONTEXT: 'stale',
          HOME: p.home, USERPROFILE: p.home, ...env},
    encoding: 'utf8', timeout: 30000,
  });
  assert.equal(proc.status, 0, proc.stderr);
  return proc.stdout.trim().split('\n').map(line => JSON.parse(line));
}

const native = bundle => ({status: 'native', parent_id: 'true-session', parent_host: 'native',
  route: {bundle}, worker_prompt_file: '@PROMPT'});

test('the public roll command gets the host session as a native parent, the whole task on stdin and a scrubbed env', () => {
  const p = plugin(native({provider: 'codex', harness: 'codex', account: 'codex', model: 'gpt-test', effort: 'high'}));
  const prepare = id => ({id, method: 'prepare', params: {task: 'full assignment 原文\r\n', context: workerContext(p.root)}});
  const replies = rpc(p, [prepare(1), prepare(2)]);
  assert.equal(replies[0].result.operation, replies[1].result.operation);
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
    const [reply] = rpc(p, [{id: 1, method: 'prepare', params: {task: 'x', context: workerContext(p.root)}}]);
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
    const [reply] = rpc(p, [{id: 1, method: 'prepare', params: {task: 'x', context: workerContext(p.root)}}]);
    assert.ok(reply.error, JSON.stringify(reply));
    assert.match(reply.error.message, /read-only|cannot run routed harness/);
    const receipts = fs.readdirSync(p.state, {recursive: true}).filter(f => String(f).endsWith('receipt.json'));
    assert.deepEqual(receipts, []);
  }
});

test('self and split are recorded as the router answer; a blocked router is an error', () => {
  for (const status of ['self', 'split']) {
    const p = plugin({status, next_action: 'do it'}, 2);
    const [reply] = rpc(p, [{id: 1, method: 'prepare', params: {task: 'x', context: workerContext(p.root)}}]);
    assert.equal(reply.result.router.status, status);
    assert.equal(reply.result.bundle, null);
  }
  const p = plugin({status: 'blocked', error: 'no account'}, 2);
  const [reply] = rpc(p, [{id: 1, method: 'prepare', params: {task: 'x', context: workerContext(p.root)}}]);
  assert.match(reply.error.message, /no account/);
});

test('an untrusted context and a foreign session are refused before the router runs', () => {
  const p = plugin(native({provider: 'codex', harness: 'codex', account: 'codex', model: 'm'}));
  const bad = [{...workerContext(p.root), workdir_is_local: false}, {...workerContext(p.root), workdir_is_read_only: true}, {...workerContext(p.root), workdir: 'relative'}, null];
  const replies = rpc(p, bad.map((context, i) => ({id: i + 1, method: 'prepare', params: {task: 'x', context}})));
  assert.ok(replies.every(r => r.error));
  assert.equal(fs.existsSync(p.capture), false);
  const [first] = rpc(p, [{id: 1, method: 'prepare', params: {task: 'x', context: workerContext(p.root)}}]);
  const [foreign] = rpc(p, [{id: 2, method: 'load', params: {operation: first.result.operation, context: {...workerContext(p.root), session_id: 'other'}}}]);
  assert.match(foreign.error.message, /different parent/);
});

// ---- zero configuration: the plugin directory exactly as the market installs it
const SYSTEM = process.platform === 'win32' ? [path.join(process.env.SYSTEMROOT || 'C:\\Windows', 'System32')] : ['/usr/bin', '/bin'];
const only = dirs => [...dirs, ...SYSTEM].join(path.delimiter);
const prepareX = (p, task = 'zero-config 原文') => ({id: 1, method: 'prepare', params: {task, context: workerContext(p.root)}});
const codex = native({provider: 'codex', harness: 'codex', account: 'codex', model: 'm', effort: 'high'});

test('without router.json the worker starts, finds `agentcompass` on PATH and runs `<it> roll ...`', {skip: !POSIX && 'needs a native agentcompass.exe launcher'}, () => {
  const p = plugin(codex, 0, 'none');
  const bin = path.join(p.root, 'bin');
  const exe = launcher(p, bin);
  assert.equal(path.basename(exe), 'agentcompass');
  const [reply] = rpc(p, [prepareX(p)], {PATH: only([bin])});
  assert.equal(reply.result?.router?.status, 'native', JSON.stringify(reply));
  const seen = JSON.parse(fs.readFileSync(p.capture, 'utf8'));
  assert.deepEqual(seen.argv.slice(0, 4), ['roll', '--parent-host', 'native', '--parent-id']);
  assert.equal(seen.stdin, 'zero-config 原文');
  assert.deepEqual(reply.result.mappings, []);
  assert.ok(fs.existsSync(path.join(p.state, reply.result.operation, 'receipt.json')), 'receipts default to ~/.agent-compass/cindy-plugin');
});

test('not on PATH: ~/.local/bin, where uv tool install puts it, is found', {skip: !POSIX && 'needs a native agentcompass.exe launcher'}, () => {
  const p = plugin(codex, 0, 'none');
  launcher(p, path.join(p.home, '.local', 'bin'));
  const [reply] = rpc(p, [prepareX(p)], {PATH: only([])});
  assert.equal(reply.result?.router?.status, 'native', JSON.stringify(reply));
});

test('AgentCompass nowhere: a clear error, no receipt, and the worker keeps serving', () => {
  const p = plugin(codex, 0, 'none');
  const replies = rpc(p, [prepareX(p), {id: 2, method: 'load', params: {operation: 'f'.repeat(40), context: workerContext(p.root)}}], {PATH: only([])});
  assert.match(replies[0].error.message, /AgentCompass was not found.*PATH.*\.local/s);
  assert.equal(replies[1].id, 2, 'the worker answered the next request');
  assert.equal(fs.existsSync(p.capture), false);
  assert.deepEqual(fs.readdirSync(p.state, {recursive: true}).filter(f => String(f).endsWith('receipt.json')), []);
});

test('~/.agent-compass/cindy-plugin/account-map.json supplies the Cindy connection bindings; a malformed one is refused', {skip: !POSIX && 'needs a native agentcompass.exe launcher'}, () => {
  const p = plugin(codex, 0, 'none');
  const bin = path.join(p.root, 'bin');
  launcher(p, bin);
  const rows = [{routerProvider: 'pi', routerAccount: 'codex', providerId: 'openai-conn', agentKind: 'pi'}];
  const map = path.join(p.home, '.agent-compass', 'cindy-plugin', 'account-map.json');
  fs.writeFileSync(map, JSON.stringify(rows));
  const [reply] = rpc(p, [prepareX(p)], {PATH: only([bin])});
  assert.deepEqual(reply.result.mappings, rows);
  fs.writeFileSync(map, JSON.stringify([{routerProvider: 'pi', agentKind: 'gpt'}]));
  const [bad] = rpc(p, [prepareX(p, 'another task')], {PATH: only([bin])});
  assert.match(bad.error.message, /account-map\.json must be a JSON array/);
});

test('~/.agent-compass/cindy-plugin/router.json is used when the plugin has none; the plugin router.json wins', () => {
  const p = plugin(codex, 0, 'home');
  const [reply] = rpc(p, [prepareX(p)], {PATH: only([])});
  assert.equal(reply.result?.router?.status, 'native', JSON.stringify(reply));
  assert.ok(fs.existsSync(path.join(p.state, reply.result.operation, 'receipt.json')), 'its stateRoot is honoured');
  fs.writeFileSync(path.join(p.out, 'router.json'), JSON.stringify({command: [process.execPath, '-e', 'process.exit(3)'], stateRoot: path.join(p.root, 'own')}));
  const [own] = rpc(p, [prepareX(p)], {PATH: only([])});
  assert.match(own.error.message, /Router returned no usable route/);
  assert.ok(fs.existsSync(path.join(p.root, 'own')), 'the plugin router.json was used');
  fs.writeFileSync(path.join(p.out, 'router.json'), '{broken');
  const [broken] = rpc(p, [prepareX(p)], {PATH: only([])});
  assert.match(broken.error.message, /Unreadable plugin configuration/);
});
