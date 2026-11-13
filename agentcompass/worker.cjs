'use strict';
// Official Cindy JSON-RPC stdio worker. No Electron/private IPC or credentials.
// It routes the task for the host-verified Cindy session - with the built-in AgentCompass engine (engine/route.mjs) by
// default, or the external `agentcompass roll` when configured - and turns the native route into an explicit Cindy task
// contract.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {spawn,spawnSync} = require('node:child_process');
const readline = require('node:readline');
const {pathToFileURL} = require('node:url');
const HOME_STATE = path.join(os.homedir(), '.agent-compass', 'cindy-plugin');
// Configuration, read again on every request so a fix made after a failed roll applies to its retry. First found wins:
//   router.json next to this file (scripts/build_plugin.py), then ~/.agent-compass/cindy-plugin/router.json:
//     {"command": [...complete roll command...], "accountMappings": [...], "stateRoot": "..."}  the external CLI
//   ~/.agent-compass/cindy-plugin/config.json {"engine": "cli"}: the external CLI found on PATH or in ~/.local/bin, the
//     built-in engine when it is not installed
//   none of them (a market install): the built-in engine
function validateClassifierConfig(value) {
  if (!value || typeof value !== 'object') return {};
  const out = {};
  if (value.classifierTimeoutMs !== undefined) {
    if (typeof value.classifierTimeoutMs !== 'number' || !Number.isInteger(value.classifierTimeoutMs) ||
        value.classifierTimeoutMs < 100 || value.classifierTimeoutMs > 65000)
      throw Error('"classifierTimeoutMs" must be an integer between 100 and 65000');
    out.classifierTimeoutMs = value.classifierTimeoutMs;
  }
  if (value.classifierCacheTtlMs !== undefined) {
    if (typeof value.classifierCacheTtlMs !== 'number' || !Number.isInteger(value.classifierCacheTtlMs) ||
        value.classifierCacheTtlMs < 0 || value.classifierCacheTtlMs > 86400000)
      throw Error('"classifierCacheTtlMs" must be an integer between 0 and 86400000');
    out.classifierCacheTtlMs = value.classifierCacheTtlMs;
  }
  if (value.stateRoot !== undefined) {
    if (typeof value.stateRoot !== 'string' || !value.stateRoot.trim())
      throw Error('"stateRoot" must be a non-empty string');
    out.stateRoot = value.stateRoot;
  }
  return out;
}
function settings() {
  for (const file of [path.join(__dirname, 'router.json'), path.join(HOME_STATE, 'router.json')]) {
    if (!fs.existsSync(file)) continue;
    try {return {...JSON.parse(fs.readFileSync(file, 'utf8')), engine:'cli', source:file};}
    catch (error) {return {source:file, error:'Unreadable plugin configuration '+file+': '+error.message};}
  }
  const file = path.join(HOME_STATE, 'config.json');
  if (!fs.existsSync(file)) return {engine:'builtin', source:null};
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    const engine = value?.engine ?? 'builtin';
    if (!['builtin', 'cli'].includes(engine)) throw Error('"engine" must be "builtin" or "cli"');
    const clf = validateClassifierConfig(value);
    return {engine, ...clf, source:null, optIn:file};
  } catch (error) {return {source:file, error:'Unreadable plugin configuration '+file+': '+error.message};}
}
const stateRoot = conf => conf.stateRoot || HOME_STATE;
// `agentcompass` on PATH, then ~/.local/bin where `uv tool install` and the installer put it. On Windows only the
// .exe: a .cmd/.bat shim cannot be spawned without a shell, and the arguments must not pass through one.
function discover() {
  const name = process.platform==='win32' ? 'agentcompass.exe' : 'agentcompass';
  const dirs = [...(process.env.PATH || '').split(path.delimiter), path.join(os.homedir(), '.local', 'bin')];
  for (const dir of dirs.filter(d=>d && path.isAbsolute(d))) {
    const file = path.join(dir, name);
    try {
      if (!fs.statSync(file).isFile()) continue;
      if (process.platform!=='win32') fs.accessSync(file, fs.constants.X_OK);
      return file;
    } catch {}
  }
  return null;
}
// Cindy connection bindings for the external CLI's account names: the configuration's own, else
// ~/.agent-compass/cindy-plugin/account-map.json, else none (a routed account then needs a Cindy connection of the same
// name). The built-in engine routes to catalog connections directly and needs none.
function accountMappings(conf) {
  if (conf.accountMappings !== undefined) return conf.accountMappings;
  const file = path.join(HOME_STATE, 'account-map.json');
  if (!fs.existsSync(file)) return [];
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  const keys = ['agentKind', 'providerId', 'routerAccount', 'routerProvider'];
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row!=='object' ||
      JSON.stringify(Object.keys(row).sort())!==JSON.stringify(keys) || !['cc', 'codex', 'pi'].includes(row.agentKind) ||
      keys.some(key => typeof row[key]!=='string' || !row[key].trim())))
    throw Error(file+' must be a JSON array of routerProvider/routerAccount/providerId/agentKind bindings');
  return rows;
}
// The worker runs as a Cindy task in the parent's local project directory: a remote worker cannot.
const LOCAL_ONLY = 'The worker runs as a Cindy task in the parent session\'s local project directory.';
// Launcher defaults the router leaves implicit; Pi's fixed full-tool worker is expressed as full-access.
const MODES = {claude:'bypassPermissions', codex:'full-access', pi:'full-access'};
const RETURN_CHANNEL = '\nCindy plugin task return channel: this task has no worker-to-parent mailbox. ' +
  'Return [Worker final report] or BLOCKED / needs_input as your final assistant reply. ' +
  'The parent collects that exact result through the AgentCompass plugin status tool. ' +
  'Do not use Paseo, askpass routes, user-dialog tools or invent a callback.\n';
const children=new Set();
function stop(child) {
  if (!child.pid) return;
  if (process.platform==='win32') {if (child.exitCode===null) spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}
  else {try {process.kill(-child.pid,'SIGKILL');} catch {if (child.exitCode===null) try {child.kill('SIGKILL');} catch {}}}
}
process.on('exit',()=>{for(const child of children) stop(child);});
process.on('SIGTERM',()=>{for(const child of children) stop(child);process.exit(143);});
process.on('SIGINT',()=>{for(const child of children) stop(child);process.exit(130);});
const digest = text => crypto.createHash('sha256').update(text).digest('hex');
const atomic = (file, value) => {
  const tmp = file + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
};
function context(value) {
  if (!value || typeof value.session_id !== 'string' || !value.session_id.trim() ||
      value.workdir_is_local !== true || value.workdir_is_read_only !== false ||
      typeof value.workdir !== 'string' || !path.isAbsolute(value.workdir))
    throw Error('A host-verified writable local session_context is required. Remote/read-only contexts are unsupported.');
  return value;
}
function owned(root, operation, ctx) {
  if (typeof operation !== 'string' || !/^[a-f0-9]{40}$/.test(operation)) throw Error('Invalid operation');
  const dir = path.join(root, operation);
  const file = path.join(dir, 'receipt.json');
  if (!fs.existsSync(file)) throw Error('Unknown operation '+operation+': no receipt. Nothing is recorded for it; roll the task to start it.');
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (record.parent !== ctx.session_id) throw Error('Operation belongs to a different parent session');
  return {dir, record};
}
// A native route becomes an explicit Cindy contract; anything Cindy cannot reproduce is refused, never widened.
function contract(result, ctx, task) {
  if (result.parent_id!==undefined && result.parent_id!==ctx.session_id) throw Error('Router answered for a different parent session');
  const bundle=result.route_bundle || result.route?.bundle;
  if (!bundle || typeof bundle!=='object') throw Error('Router returned no route bundle');
  const harness=bundle.harness || (MODES[bundle.provider] ? bundle.provider : null);
  if (!MODES[harness]) throw Error('Cindy cannot run routed harness '+JSON.stringify(harness)+'; reroute to an exact supported Cindy catalog route, do not substitute.');
  const modeId=bundle.modeId ?? MODES[harness];
  if (modeId!==MODES[harness]) throw Error('Cindy cannot reproduce '+harness+' permission mode '+JSON.stringify(modeId)+'; reroute, an explicitly restricted route is not widened.');
  // The external router writes its worker prompt to a file; the built-in engine sends the assignment unchanged.
  let prompt;
  if (result.engine==='builtin') prompt=task;
  else if (result.worker_prompt_file) prompt=fs.readFileSync(result.worker_prompt_file,'utf8');
  else throw Error('Router returned no worker prompt file');
  return {bundle:{...bundle,harness,modeId},prompt:prompt+RETURN_CHANNEL};
}
const writeDiag = (file, data) => {try {fs.writeFileSync(file, data);} catch {}};
// Routes Cindy refused to create a task on. A retry routes elsewhere for 15 min, doubling with each consecutive refusal up
// to 2 h; a task created on the route clears it. Only refusals about the route itself count: a malformed request or a
// busy task says nothing about the route, and a lost answer is never a refusal.
const ROUTE_REFUSALS = new Set(['ROUTE_UNAVAILABLE','UNSUPPORTED_CAPABILITY','PERMISSION_DENIED']);
const COOLDOWN_MS = 15*60000, COOLDOWN_MAX_MS = 120*60000;
const bundleKey = bundle => bundle?.providerId && bundle.model ? bundle.harness+'\0'+bundle.providerId+'\0'+bundle.model : null;
const cooldownFile = root => path.join(root, 'route-cooldowns.json');
function cooldowns(root) {
  try {
    const value=JSON.parse(fs.readFileSync(cooldownFile(root), 'utf8'));
    return value && typeof value==='object' && !Array.isArray(value) ? value : {};
  } catch {return {};}
}
function noteCreate(root, before, after, now=Date.now()) {
  const key=bundleKey(after.bundle);
  if (!key) return;
  const all=cooldowns(root);
  if (after.createRejected && !before.createRejected && ROUTE_REFUSALS.has(after.errorCode)) {
    const old=all[key];
    // A refusal more than 2 h after the last cooldown ended starts a new streak.
    const streak=old && now-old.until<=COOLDOWN_MAX_MS ? old.failures+1 : 1;
    all[key]={until:now+Math.min(COOLDOWN_MS*2**(streak-1), COOLDOWN_MAX_MS), code:after.errorCode, failures:streak};
  } else if (after.taskId && !before.taskId && all[key]) delete all[key];
  else return;
  atomic(cooldownFile(root), all);
}
// Classifier failures. Cindy chooses the quick-text model, so a retry cannot go elsewhere: it answers at once with the failure and
// where to change the model, and asks the host again only after 30 s, doubling to 5 min; a classified task clears it. Only a failure
// that says the channel itself cannot answer cools every task (no model to use, or not allowed); anything else may be that task's
// doing (an INTERNAL or TIMEOUT from the provider, a malformed answer), so it cools only that task's text, in every session.
// RATE_LIMITED is Cindy's limit on requests in flight and cools nothing.
const CLASSIFIER_COOLDOWN_MS = 30000, CLASSIFIER_COOLDOWN_MAX_MS = 5*60000;
const CHANNEL_FAILURES = new Set(['classifier_no_candidate', 'classifier_permission_denied']);
const UNRECORDED_FAILURES = new Set(['classifier_rate_limited']);
const classifierCooldownFile = root => path.join(root, 'classifier-cooldowns.json');
function classifierCooldowns(root) {
  try {
    const value=JSON.parse(fs.readFileSync(classifierCooldownFile(root), 'utf8'));
    return value && typeof value==='object' && !Array.isArray(value) ? value : {};
  } catch {return {};}
}
// What decides the quick-text model, as far as the plugin can see it without reading anything of Cindy's: the model this plugin declares and the
// catalog. A change of either ends every cooldown at once, since the failure was about the old choice. A model picked on the plugin card
// (or the auxiliary chain) is not visible to the plugin: that waits for the cooldown, at most 5 minutes, or for a cached answer to expire.
function classifierChoice(mod, catalog) {
  let declared=null;
  try {declared=JSON.parse(fs.readFileSync(path.join(__dirname, 'ghost.json'), 'utf8')).cindy?.oneshotModel ?? null;} catch {}
  return digest(JSON.stringify([declared, (catalog?.models || []).map(row => row?.route)]));
}
// A clock moved back is capped here and kept, so the five minutes run out; capping each read alone would never end the wait.
function classifierCooling(root, taskDigest, choice, now=Date.now()) {
  const all=classifierCooldowns(root);
  let changed=false;
  for (const [key, entry] of Object.entries(all)) {
    if (entry?.choice!==choice) {delete all[key];changed=true;}
    else if (entry.until>now+CLASSIFIER_COOLDOWN_MAX_MS) {entry.until=now+CLASSIFIER_COOLDOWN_MAX_MS;changed=true;}
  }
  if (changed) atomic(classifierCooldownFile(root), all);
  return [all.channel, all['task:'+taskDigest]].find(entry => entry && entry.until>now) || null;
}
function noteClassifierOutcome(root, taskDigest, result, choice, now=Date.now()) {
  const all=classifierCooldowns(root);
  if (result.profile_source!=='unavailable') {
    if (!all.channel && !all['task:'+taskDigest]) return;
    delete all.channel;
    delete all['task:'+taskDigest];
  } else {
    const reason=result.decision?.reason || 'classifier_failed';
    if (UNRECORDED_FAILURES.has(reason)) return;
    const key=CHANNEL_FAILURES.has(reason) ? 'channel' : 'task:'+taskDigest;
    const old=all[key];
    const failures=old?.choice===choice && now-old.until<=CLASSIFIER_COOLDOWN_MAX_MS ? old.failures+1 : 1;
    all[key]={until:now+Math.min(CLASSIFIER_COOLDOWN_MS*2**(failures-1), CLASSIFIER_COOLDOWN_MAX_MS), failures, reason,
      error:result.error, model:result.classifier_model || null, choice};
    for (const [other, entry] of Object.entries(all)) if (!entry || now-entry.until>CLASSIFIER_COOLDOWN_MAX_MS) delete all[other];
  }
  atomic(classifierCooldownFile(root), all);
}
// The answer to one classification request; an answer nobody asked for, or that arrives too late, is refused.
const PENDING_CLASSIFY_TTL_MS = 5*60000;
let engine=null;
async function builtin(input, catalog, dir, root, conf = {}, extra = {}) {
  engine ||= import(pathToFileURL(path.join(__dirname, 'engine', 'route.mjs')).href);
  const mod = await engine;
  const cacheFile = path.join(root, 'score-cache.json');
  const pendingFile = path.join(dir, 'pending-classify.json');
  const taskDigest = digest(mod.taskCacheDescriptor(input));
  let classification = null;
  if (extra.classification !== undefined && extra.classification !== null) {
    let pending = null;
    try { pending = JSON.parse(fs.readFileSync(pendingFile, 'utf8')); } catch {}
    try { fs.rmSync(pendingFile, {force: true}); } catch {}
    const clf = extra.classification;
    const answered = clf.ok === true ? typeof clf.rawOutput === 'string' : clf.ok === false;
    if (!answered || !pending || pending.parent !== extra.parent || pending.taskDigest !== taskDigest ||
        typeof clf.attemptId !== 'string' || clf.attemptId !== pending.attemptId ||
        !(Date.now() - pending.createdAt <= PENDING_CLASSIFY_TTL_MS)) {
      const blocked = mod.unsolicitedClassificationRoute();
      writeDiag(path.join(dir, 'router.stdout.json'), JSON.stringify(blocked, null, 2));
      return blocked;
    }
    classification = {...clf, calibration_cases: pending.calibrationCases};
  } else if (extra.classifyViaHost && extra.profile == null) {
    const req = mod.prepareClassifierRequest(input, {config: conf, cacheFile});
    if (!req.cached) {
      const cooling = req.overLimitBy ? null : classifierCooling(root, taskDigest, classifierChoice(mod, catalog));
      const refused = req.overLimitBy ? mod.classifierTaskTooLongRoute(req) : cooling ? mod.classifierCoolingRoute(cooling) : null;
      if (refused) {
        writeDiag(path.join(dir, 'router.stdout.json'), JSON.stringify(refused, null, 2));
        return refused;
      }
      const attemptId = crypto.randomUUID();
      atomic(pendingFile, {parent: extra.parent, taskDigest, attemptId, calibrationCases: req.calibrationCases, createdAt: Date.now()});
      return {status: 'classify', engine: 'builtin', classifier: {attemptId, prompt: req.prompt, timeoutMs: req.timeoutMs}};
    }
  }
  const result = mod.routeTask(input, catalog, {
    cooling: cooldowns(root),
    config: conf,
    cacheFile,
    profile: extra.profile ?? null,
    classification,
  });
  // Only a classification this plugin asked for can come to here, so only that can fill the shared cache or touch the record.
  if (classification) try {noteClassifierOutcome(root, taskDigest, result, classifierChoice(mod, catalog));} catch {}
  writeDiag(path.join(dir,'router.stdout.json'),JSON.stringify(result,null,2));
  if (result.status === 'blocked') {
    if (result.decision?.reason === 'no_runnable_model') throw Error(result.error);
    if (result.decision?.reason === 'no_route' || result.profile_source === 'unavailable') return result;
    throw Error(result.error);
  }
  return result;
}
async function external(command, task, ctx, dir, timeoutMs=110000) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(PASEO_|HC_|ORCA_|T3_|ROUTER_PARENT_|ROUTER_CINDY_CONTEXT)/.test(key)));
  if (!Array.isArray(command) || !command.length || command.some(v=>typeof v!=='string')) throw Error('Invalid public router command');
  const argv=[...command.slice(1), '--parent-host', 'native', '--parent-id', ctx.session_id, '--parent-address', ctx.session_id,
    '--local-only', LOCAL_ONLY, '--task', '-', '--verbose'];
  return await new Promise((resolve,reject) => {
    const child=spawn(command[0], argv,
      {cwd:ctx.workdir, env, windowsHide:true, detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});
    children.add(child);
    const stdout=[], stderr=[];
    let stdinError=null, timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;stop(child);}, Number.isFinite(timeoutMs) && timeoutMs>0 ? timeoutMs : 110000);
    child.stdout.on('data',data=>stdout.push(data));
    child.stderr.on('data',data=>stderr.push(data));
    // A router that exits before reading the whole task (EPIPE, EOF) fails this roll only; it must not take the shared
    // worker down. The exit code and output still decide the answer.
    child.stdin.on('error',error=>{stdinError=error;});
    child.on('error',error=>{clearTimeout(timer);children.delete(child);reject(error);});
    child.on('close',(code,signal)=>{
      clearTimeout(timer);
      children.delete(child);
      const text=Buffer.concat(stdout).toString('utf8');
      writeDiag(path.join(dir,'router.stdout.json'),text);
      writeDiag(path.join(dir,'router.stderr.txt'),Buffer.concat(stderr));
      try {
        if (timedOut || signal || code===null) throw Error(timedOut ? 'Router timed out' : 'Router terminated by '+(signal || 'signal'));
        const result=JSON.parse(text);
        // v0.6.0: every System-One classifier failed. The router starts no worker on a guess, and neither does this plugin.
        if (result.status==='scorer_unavailable' || result.error==='scorer_unavailable') {
          resolve({
            ...result,
            status:'blocked',
            engine:'cli',
            profile:null,
            profile_source:'unavailable',
            decision:{...(result.decision || {}), reason:'scorer_unavailable', profile_source:'unavailable'},
            error:'The AgentCompass classifiers are all unavailable; nothing was started.',
            next_action:result.next_action || result.next ||
              'Fix a classifier of the AgentCompass install (agentcompass doctor), or remove the CLI configuration (router.json, or {"engine":"cli"} in config.json) to use the built-in engine, then roll again. Nothing was started.',
          });
          return;
        }
        if (code!==0 && !['self','split'].includes(result.status)) throw Error(result.error || result.next || 'Router blocked');
        resolve({...result, engine:'cli'});
      } catch(error) {
        reject(Error('Router returned no usable route; inspect '+dir+': '+error.message+
          (stdinError ? ' (the router stopped reading the task: '+stdinError.code+')' : '')));
      }
    });
    child.stdin.end(task, 'utf8');
  });
}
// The engine for this roll: the configured CLI, an opted-in CLI when it is installed, otherwise the built-in engine.
async function route(conf, task, ctx, dir, catalog, root, extra = {}) {
  const found=conf.engine==='cli' && !conf.command ? discover() : null;
  if (conf.engine==='cli' && (conf.command || found)) {
    if (extra.profile!=null) return {status:'blocked', engine:'cli', profile:null, profile_source:'unavailable',
      decision:{reason:'profile_not_supported_by_cli', profile_source:'unavailable'},
      error:'The configured AgentCompass CLI classifies the task itself and takes no profile; the profile was not used and nothing was started.',
      next_action:'Call roll without `profile`, or remove the CLI configuration (router.json, or {"engine":"cli"} in config.json) to use the built-in engine.'};
    return conf.command ? await external(conf.command, task, ctx, dir, conf.timeoutMs) : await external([found, 'roll'], task, ctx, dir);
  }
  const result=await builtin(task, catalog, dir, root, conf, extra);
  if (conf.engine!=='cli' || result.status==='classify') return result;
  return {...result, engine_note:'config.json asks for the AgentCompass CLI, which is not installed: the built-in engine routed this task.'};
}
// One preparation per operation at a time; different operations never wait for each other.
const busy=new Map();
const outputStreams=new Map();
function exclusive(key, work) {
  const run=(busy.get(key) || Promise.resolve()).then(work, work);
  const tail=run.catch(()=>{});
  busy.set(key, tail);
  tail.then(()=>{if (busy.get(key)===tail) busy.delete(key);});
  return run;
}
async function handle(method, params) {
  const ctx=context(params.context);
  const conf=settings();
  if (conf.error) throw Error(conf.error);
  const root=stateRoot(conf);
  fs.mkdirSync(root, {recursive:true});
  if (method==='prepare') {
    let catalog=params.catalog;
    if (typeof params.chunk==='string') {
      const key='prepare\0'+ctx.session_id+'\0'+String(params.stream || '');
      const list=params.index===0 ? [] : (outputStreams.get(key) || []);
      list.push(params.chunk);
      if (!params.done) {
        outputStreams.set(key,list);
        return {partial:true};
      }
      outputStreams.delete(key);
      catalog=JSON.parse(list.join(''));
    }
    if (typeof params.task!=='string' || !params.task.trim()) throw Error('Task is empty');
    const operation=digest(ctx.session_id+'\0'+params.task).slice(0,40);
    const dir=path.join(root,operation);
    fs.mkdirSync(dir,{recursive:true});
    return await exclusive(dir, async()=>{
    const file=path.join(dir,'receipt.json');
    const old=fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : null;
    if (old && !['prepared','create_rejected'].includes(old.state)) return {operation,...old};
    // Nothing was created yet: route again with the current configuration, account map and catalog, so a retry after
    // a fix is not stuck on the answer that failed.
    const mappings=accountMappings(conf);
    const result=await route(conf,params.task,ctx,dir,catalog,root,{
      operation,
      parent:ctx.session_id,
      classifyViaHost:Boolean(params.classifyViaHost),
      profile:params.profile,
      classification:params.classification,
    });
    if (result.status==='classify') {
      return {operation, parent:ctx.session_id, state:'classify', engine:result.engine, classifier:result.classifier};
    }
    // A blocked answer is not saved over the receipt: a caller may already hold this operation from an earlier answer.
    if (result.status==='blocked') {
      return {
        operation,
        parent:ctx.session_id,
        state:'blocked',
        engine:result.engine,
        router:result,
        bundle:null,
        prompt:'',
        directory:ctx.workdir,
        mappings,
        attempts:(old?.attempts || 0)+1,
      };
    }
    // self/split/a router-side launch are the router's answer to the parent, not a Cindy task.
    const {bundle,prompt}=result.status==='native' ? contract(result,ctx,params.task) : {bundle:null,prompt:''};
    const record={parent:ctx.session_id, state:'prepared', engine:result.engine, router:result, bundle, prompt,
                  directory:ctx.workdir, mappings, attempts:(old?.attempts || 0)+1};
    atomic(file,record);
    return {operation,...record};
    });
  }
  const {dir,record}=owned(root,params.operation,ctx);
  if (method==='load') return record;
  if (method==='save') {
    const update=params.record;
    if (!update || update.parent!==record.parent) throw Error('Parent cannot be changed');
    atomic(path.join(dir,'receipt.json'),update);
    // The receipt is saved; a cooldown that cannot be written only loses a routing preference.
    try {noteCreate(root,record,update);} catch {}
    return {saved:true};
  }
  if (method==='output') {
    if (typeof params.chunk==='string') {
      const key=dir+'\0'+String(params.stream || '');
      const list=params.index===0 ? [] : (outputStreams.get(key) || []);
      list.push(params.chunk);
      if (!params.done) {
        outputStreams.set(key,list);
        return {artifact:null,partial:true};
      }
      outputStreams.delete(key);
      const raw=list.join('');
      const parsed=JSON.parse(raw);
      const file=path.join(dir,'messages-'+digest(raw).slice(0,16)+'.json');
      atomic(file,parsed);
      return {artifact:file};
    }
    const file=path.join(dir,'messages-'+digest(JSON.stringify(params.page)).slice(0,16)+'.json');
    atomic(file,params.page);
    return {artifact:file};
  }
  throw Error('Unsupported method');
}
// Cindy shares one worker across sessions. Requests run concurrently: a slow route for one session never delays
// another session's status, stop or cleanup. The logic page orders the calls of one operation.
const reply=message=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...message})+'\n');
readline.createInterface({input:process.stdin}).on('line', line=>{
  let request;
  try {request=JSON.parse(line);}
  catch(error) {reply({id:null,error:{code:-32700,message:'Parse error: '+error.message}});return;}
  Promise.resolve().then(()=>handle(request.method,request.params || {})).then(
    result=>reply({id:request.id,result}),
    error=>reply({id:request.id,error:{code:-32000,message:error.message}}));
});
