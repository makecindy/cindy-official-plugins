'use strict';
// Official Cindy JSON-RPC stdio worker. No Electron/private IPC or credentials.
// It asks the public AgentCompass `roll` for a route on behalf of the host-verified
// Cindy session and turns the native result into an explicit Cindy task contract.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {spawn,spawnSync} = require('node:child_process');
const readline = require('node:readline');
const HOME_STATE = path.join(os.homedir(), '.agent-compass', 'cindy-plugin');
// Configuration, first found wins: router.json next to this file (scripts/build_plugin.py), then
// ~/.agent-compass/cindy-plugin/router.json. With neither (a market install) the router command is
// discovered on every roll, so AgentCompass installed after the plugin is still found.
const config = (() => {
  for (const file of [path.join(__dirname, 'router.json'), path.join(HOME_STATE, 'router.json')]) {
    if (!fs.existsSync(file)) continue;
    try {return {...JSON.parse(fs.readFileSync(file, 'utf8')), source:file};}
    catch (error) {return {source:file, error:'Unreadable plugin configuration '+file+': '+error.message};}
  }
  return {source:null};
})();
const root = config.stateRoot || HOME_STATE;
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
function routerCommand() {
  if (config.error) throw Error(config.error);
  if (config.source) return config.command;
  const found = discover();
  if (!found) throw Error('AgentCompass was not found: install it (`uv tool install agentcompass` or the installer) so ' +
    '`agentcompass` is on PATH or in ~/.local/bin, or write '+path.join(HOME_STATE, 'router.json')+'. Nothing was routed.');
  return [found, 'roll'];
}
// Cindy connection bindings: the configuration's own, else ~/.agent-compass/cindy-plugin/account-map.json, else none
// (a routed account then needs a Cindy connection of the same name).
function accountMappings() {
  if (config.accountMappings !== undefined) return config.accountMappings;
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
  if (!child.pid || child.exitCode!==null) return;
  if (process.platform==='win32') spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
  else {try {process.kill(-child.pid,'SIGKILL');} catch {child.kill('SIGKILL');}}
}
process.on('exit',()=>{for(const child of children) stop(child);});
process.on('SIGTERM',()=>{for(const child of children) stop(child);process.exit(143);});
process.on('SIGINT',()=>{for(const child of children) stop(child);process.exit(130);});
fs.mkdirSync(root, {recursive:true});
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
function owned(operation, ctx) {
  if (typeof operation !== 'string' || !/^[a-f0-9]{40}$/.test(operation)) throw Error('Invalid operation');
  const dir = path.join(root, operation);
  const record = JSON.parse(fs.readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
  if (record.parent !== ctx.session_id) throw Error('Operation belongs to a different parent session');
  return {dir, record};
}
// A native route becomes an explicit Cindy contract; anything Cindy cannot reproduce is refused, never widened.
function contract(result, ctx) {
  if (result.parent_id!==undefined && result.parent_id!==ctx.session_id) throw Error('Router answered for a different parent session');
  const bundle=result.route_bundle || result.route?.bundle;
  if (!bundle || typeof bundle!=='object') throw Error('Router returned no route bundle');
  const harness=bundle.harness || (MODES[bundle.provider] ? bundle.provider : null);
  if (!MODES[harness]) throw Error('Cindy cannot run routed harness '+JSON.stringify(harness)+'; reroute to an exact supported Cindy catalog route, do not substitute.');
  const modeId=bundle.modeId ?? MODES[harness];
  if (modeId!==MODES[harness]) throw Error('Cindy cannot reproduce '+harness+' permission mode '+JSON.stringify(modeId)+'; reroute, an explicitly restricted route is not widened.');
  if (!result.worker_prompt_file) throw Error('Router returned no worker prompt file');
  const prompt=fs.readFileSync(result.worker_prompt_file,'utf8')+RETURN_CHANNEL;
  return {bundle:{...bundle,harness,modeId},prompt};
}
async function route(task, ctx, dir) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(PASEO_|HC_|ORCA_|T3_|ROUTER_PARENT_|ROUTER_CINDY_CONTEXT)/.test(key)));
  const command = routerCommand();
  if (!Array.isArray(command) || !command.length || command.some(v=>typeof v!=='string')) throw Error('Invalid public router command');
  const argv=[...command.slice(1), '--parent-host', 'native', '--parent-id', ctx.session_id, '--parent-address', ctx.session_id,
    '--local-only', LOCAL_ONLY, '--task', '-', '--verbose'];
  return await new Promise((resolve,reject) => {
    const child=spawn(command[0], argv,
      {cwd:ctx.workdir, env, windowsHide:true, detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});
    children.add(child);
    const stdout=[], stderr=[];
    const timer=setTimeout(()=>stop(child), 110000);
    child.stdout.on('data',data=>stdout.push(data));
    child.stderr.on('data',data=>stderr.push(data));
    child.on('error',error=>{clearTimeout(timer);children.delete(child);reject(error);});
    child.on('close',code=>{
      clearTimeout(timer);
      children.delete(child);
      const text=Buffer.concat(stdout).toString('utf8');
      fs.writeFileSync(path.join(dir,'router.stdout.json'),text);
      fs.writeFileSync(path.join(dir,'router.stderr.txt'),Buffer.concat(stderr));
      try {
        const result=JSON.parse(text);
        if (code && !['self','split'].includes(result.status)) throw Error(result.error || result.next || 'Router blocked');
        resolve(result);
      } catch(error) { reject(Error('Router returned no usable route; inspect '+dir+': '+error.message)); }
    });
    child.stdin.end(task, 'utf8');
  });
}
async function handle(method, params) {
  const ctx=context(params.context);
  if (method==='prepare') {
    if (typeof params.task!=='string' || !params.task.trim()) throw Error('Task is empty');
    const operation=digest(ctx.session_id+'\0'+params.task).slice(0,40);
    const dir=path.join(root,operation);
    fs.mkdirSync(dir,{recursive:true});
    const file=path.join(dir,'receipt.json');
    if (fs.existsSync(file)) return {operation,...JSON.parse(fs.readFileSync(file,'utf8'))};
    const mappings=accountMappings();
    const result=await route(params.task,ctx,dir);
    // self/split/a router-side launch are the router's answer to the parent, not a Cindy task.
    const {bundle,prompt}=result.status==='native' ? contract(result,ctx) : {bundle:null,prompt:''};
    const record={parent:ctx.session_id, state:'prepared', router:result, bundle, prompt,
                  directory:ctx.workdir, mappings};
    atomic(file,record);
    return {operation,...record};
  }
  const {dir,record}=owned(params.operation,ctx);
  if (method==='load') return record;
  if (method==='save') {
    const update=params.record;
    if (!update || update.parent!==record.parent) throw Error('Parent cannot be changed');
    atomic(path.join(dir,'receipt.json'),update);
    return {saved:true};
  }
  if (method==='output') {
    const file=path.join(dir,'messages-'+digest(JSON.stringify(params.page)).slice(0,16)+'.json');
    atomic(file,params.page);
    return {artifact:file};
  }
  throw Error('Unsupported method');
}
// Cindy shares one worker across sessions; serialize preparation/persistence.
let queue=Promise.resolve();
readline.createInterface({input:process.stdin}).on('line', line=>{
  queue=queue.then(async()=>{
    let request;
    try {
      request=JSON.parse(line);
      const result=await handle(request.method,request.params || {});
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\n');
    } catch(error) {
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request?.id,error:{code:-32000,message:error.message}})+'\n');
    }
  });
});
