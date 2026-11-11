// Logic page. Agent tools go to the Node worker. The live view of a task's device
// shows in that task's own page (taskView) on hosts that support it, and in the
// sidebar browser otherwise. Plugin pages reach the worker only through the
// explicit actions below, never through a generic Node method.

async function hostLocale() {
  try { const context = await cindy.request({kind:'app-context'}); if (context?.context?.locale === 'zh-CN') return 'zh-CN'; } catch {}
  return 'en';
}

// The host recycles this on-demand worker after an hour without requests, and
// the worker shuts every device down on exit. While any device is running or a
// viewer window is open, keep one request in flight so the plugin's own idle
// rule (open window or active script keeps a device on) decides instead.
let holding = null;
function holdWhileRunning() {
  if (holding) return;
  holding = (async () => {
    try {
      for (;;) {
        const response = await cindy.node.request({method:'device_hold', params:{}, timeoutMs:115000});
        if (!response.ok || response.result?.running !== true) break;
      }
    } catch {} finally { holding = null; }
  })();
}

const pages = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('baguette-pages') : null;
const hasTaskView = () => typeof cindy.taskView === 'function';
const withTask = (url, sessionId) => sessionId ? url.replace('#', `&task=${encodeURIComponent(sessionId)}#`) : url;
const TASK_LOCATION = {'zh-CN':'Cindy 任务侧栏「设备模拟器」页签', en:'the "Device Simulator" tab in the task sidebar'};

// Show a live view: the task's own page when the host has task pages (the page
// loads its state itself; a page already open gets the URL pushed), otherwise
// the sidebar browser. Returns the facts the Agent should report.
async function showViewer(url, udid, sessionId, locale) {
  if (hasTaskView()) {
    try {
      const opened = await cindy.taskView(sessionId ? {sessionId} : {});
      if (opened?.ok) {
        pages?.postMessage({type:'viewer', sessionId:opened.sessionId, udid, url:withTask(url, opened.sessionId)});
        return {previewOpened:true, location:TASK_LOCATION[locale] || TASK_LOCATION.en, sessionId:opened.sessionId};
      }
      // A host that knows task pages but not this install's page falls through.
      if (opened?.errorCode !== 'PERMISSION_DENIED') return {previewOpened:false, previewError:opened?.message || opened?.errorCode || 'Task page did not open', errorCode:opened?.errorCode};
    } catch (error) { return {previewOpened:false, previewError:String(error?.message || error)}; }
  }
  try {
    const opened = await cindy.preview({url, ...(sessionId ? {sessionId} : {})});
    return opened.ok ? {previewOpened:true, location:'Cindy 侧边栏浏览器'}
      : {previewOpened:false, previewError:opened.message || opened.errorCode || 'Preview did not open', errorCode:opened.errorCode};
  } catch (error) { return {previewOpened:false, previewError:String(error?.message || error)}; }
}

cindy.onHostMessage(async function (msg) {
  // The same plugin on another of the account's computers asks about a task's device (see remoteServe).
  if (msg.type === 'device-sync-request') {
    if (typeof cindy.deviceSync !== 'function' || typeof msg.requestId !== 'string') return;
    let data;
    try { data = msg.data?.v === 1 && msg.data.kind === REMOTE_KIND ? await remoteServe(msg.data) : {ok:false, errorCode:'UNSUPPORTED', execution:'not_executed'}; }
    catch { data = {ok:false, errorCode:'NODE_UNAVAILABLE', execution:'unknown'}; }
    await cindy.deviceSync({op:'reply', requestId:msg.requestId, data}).catch(() => {});
    return;
  }
  if (msg.type !== 'tool-call') return;
  // liveScreen.* belong to Cindy's phone view, never to the Agent.
  if (String(msg.tool).startsWith('liveScreen.')) {
    await cindy.send({type:'tool-result',callId:msg.callId,ok:false,errorCode:'UNKNOWN_TOOL',message:'Unknown tool; nothing was executed.'});
    return;
  }
  const started = Date.now();
  try {
    const locale = await hostLocale();
    // Host ceiling is 120s; worker preflight is 3s + 5s.
    // Boot retains 15s start + 90s readiness (113s total).
    // Screenshots the model asks for (the screenshot tool, screenshot:true, observe=screenshot, a wait that ran out)
    // are shown to it inline (host `images`); the worker attaches nothing otherwise.
    const response = await cindy.node.request({method: msg.tool, params: {...msg.args,_agent:true,_locale:locale,_inline:true}, timeoutMs: 120000});
    if (!response.ok) {
      await cindy.send({type:'tool-result',callId:msg.callId,ok:false,errorCode:'NODE_REQUEST_FAILED',message:response.message || 'Worker failed; execution may be unknown. Inspect device before retrying.'});
      return;
    }
    const result = response.result;
    const opening = msg.tool === 'open_viewer' || (msg.tool === 'viewer' && msg.args?.action === 'open');
    const viewer = result.viewer || (opening ? result : null);
    if (result.ok && viewer && viewer.ready && viewer.url) {
      const shown = await showViewer(viewer.url, result.udid ?? msg.args?.udid, msg.args?.session_context?.session_id, locale);
      viewer.previewOpened = shown.previewOpened;
      if (shown.location) viewer.location = shown.location;
      if (shown.previewError) viewer.previewError = shown.previewError;
    }
    if (result.ok && viewer?.previewOpened === false) {
      result.outcome = 'partial';
      result.nextAction = 'Retry viewer action=open for this device. Do not repeat an App launch that already succeeded.';
      // A Host page failure is separate from launch. Observe once, within the
      // original Host budget, retaining the already completed device result.
      const left = Math.min(12000, 110000 - (Date.now() - started));
      if (!result.screenshot && left >= 1000) {
        try {
          const shot = await cindy.node.request({method:'screenshot',params:{udid:result.udid ?? msg.args?.udid,session_context:msg.args?.session_context,_inline:true,_observationBudgetMs:left},timeoutMs:left+1000});
          if (shot.ok && shot.result?.ok !== false) {
            const {ok, _modelImages, ...screen} = shot.result;
            result.screenshot = screen;
            if (_modelImages) result._modelImages = _modelImages;
          } else result.screenshot = {error:shot.message || shot.result?.message || 'Observation unavailable; retry screenshot only.'};
        } catch (error) { result.screenshot = {error:String(error.message || error)}; }
      }
    }
    if (typeof result.met === 'boolean') result.goalMet = result.met;
    // Images go next to `result` (hosts without the field ignore them; the path stays in `result`).
    const images = Array.isArray(result._modelImages) ? result._modelImages : null;
    delete result._modelImages;
    await cindy.send(result.ok ? {type:'tool-result',callId:msg.callId,ok:true,result:result,...(images ? {images} : {})} : {type:'tool-result',callId:msg.callId,ok:false,errorCode:result.errorCode,message:result.message+' (execution: '+result.execution+')'});
    holdWhileRunning();
  } catch (error) {
    await cindy.send({type:'tool-result',callId:msg.callId,ok:false,errorCode:'BRIDGE_FAILED',message:String(error.message || error)+'; execution unknown, inspect before retrying.'});
  }
});

async function worker(method, params) {
  const response = await cindy.node.request({method, params, timeoutMs:120000});
  return response.ok ? {...response.result, ok:response.result?.ok !== false} : {ok:false, errorCode:'NODE_UNAVAILABLE', execution:'unknown'};
}
const SESSION = /^[A-Za-z0-9-]{1,64}$/;
// Sequential page actions retain the completed first step if the next worker
// request rejects, times out, or returns an error. Never replay that first step.
async function afterTaskOperation(completed, method, params, field = 'taskStateError') {
  try {
    const next = await worker(method, params);
    if (!next.ok) throw next;
    return {...completed, ...next, execution:completed.execution || 'executed'};
  } catch (error) {
    return {...completed, execution:completed.execution || 'executed', [field]:{
      code:error.errorCode || error.code || 'TASK_FOLLOWUP_FAILED',
      message:'The first operation completed, but task setup or status failed. Refresh the task and inspect its binding; do not repeat the completed operation.',
    }};
  }
}
const str = (value, max = 256) => typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined;

// Open a device in the focused task's page (management view / settings page),
// falling back to the sidebar browser on hosts without task pages.
async function openInTask(udid, locale) {
  if (hasTaskView()) {
    const opened = await cindy.taskView({});
    if (!opened?.ok) return {ok:false, errorCode:opened?.errorCode === 'HOST_NOT_READY' ? 'PREVIEW_NEEDS_SESSION' : 'PREVIEW_FAILED', execution:'not_executed'};
    const state = await worker('task_bind', {_task:opened.sessionId, udid, _locale:locale});
    if (state.ok && state.viewer) pages?.postMessage({type:'viewer', sessionId:opened.sessionId, udid, url:state.viewer.url});
    else if (state.ok && state.taskStateError) pages?.postMessage({type:'viewer', sessionId:opened.sessionId, udid, url:'', taskStateError:state.taskStateError});
    return {...state, previewOpened:true};
  }
  const result = await worker('settings_viewer', {udid, _locale:locale});
  if (!result.ok || !result.url) return result;
  const shown = await showViewer(result.url, udid, undefined, locale);
  return shown.previewOpened ? {...result, previewOpened:true}
    : {ok:false, errorCode:shown.errorCode === 'HOST_NOT_READY' ? 'PREVIEW_NEEDS_SESSION' : 'PREVIEW_FAILED', execution:'executed'};
}

// Task page and management view. Each action maps to one fixed worker method
// with sanitized parameters. Cross-task navigation resolves the target from
// the device's saved binding in the worker, never from a page-supplied task id.
// ---- A task that lives on another of the account's computers ----
// Two channels, both only between the same plugin on the same account's
// computers. The picture and input of one device come through Cindy
// (cindy.liveScreenView, wrapped by node/remote). Everything else the task page
// does - which device the task uses, the device list, starting, creating and
// shutting down - is asked of the plugin on that computer (cindy.deviceSync),
// which runs its own fixed worker methods under its own run switch. A computer
// whose plugin predates this still shows its running device, view only.
const DEVICE = /^[A-Za-z0-9._:-]{1,256}$/, SCREEN = /^[A-Za-z0-9._:-]{1,128}$/;
const REMOTE_KIND = 'simulator-task', REMOTE_BYTES = 56000;
async function remoteView(request) {
  try {
    const result = await (typeof cindy.liveScreenView === 'function' ? cindy.liveScreenView(request) : cindy.send({...request, type:'live-screen-view-request'}));
    return result && typeof result === 'object' && typeof result.ok === 'boolean' ? result : {ok:false, errorCode:'HOST_UPDATE_REQUIRED'};
  } catch { return {ok:false, errorCode:'HOST_UPDATE_REQUIRED'}; }
}

// -- on the computer that runs the devices --
// What a device list entry needs on the other computer, and nothing of this one's paths or records.
const slimDevice = d => d && {udid:d.udid, name:d.name, state:d.state, runtime:d.runtime, deviceType:d.deviceType, productFamily:d.productFamily,
  ...(d.platform ? {platform:d.platform} : {}), isAvailable:d.isAvailable !== false, thisTask:d.thisTask === true, tasks:d.tasks || 0,
  activeTasks:d.activeTasks || 0, thisTaskActive:d.thisTaskActive === true,
  ...(d.memoryMode ? {memoryMode:{mode:d.memoryMode.mode, verified:d.memoryMode.verified === true}} : {})};
const slimCatalog = c => ({ok:true, platforms:{android:{ready:c.platforms?.android?.ready === true}},
  deviceTypes:(c.deviceTypes || []).map(d => ({identifier:d.identifier, name:d.name, productFamily:d.productFamily, ...(d.platform ? {platform:d.platform} : {}), minRuntimeVersion:d.minRuntimeVersion, maxRuntimeVersion:d.maxRuntimeVersion})),
  runtimes:(c.runtimes || []).map(r => ({identifier:r.identifier, name:r.name, version:r.version, ...(r.platform ? {platform:r.platform} : {}), ...(Array.isArray(r.supportedDeviceTypes) ? {supportedDeviceTypes:r.supportedDeviceTypes} : {})}))});
// Starting and shutting down outlast one request: they run here and the other
// computer reads the outcome with the task's state. One at a time per task.
const remoteOps = new Map();
function remoteStart(sessionId, call, udid, run) {
  const op = {call, udid, state:'running', at:Date.now()};
  remoteOps.set(sessionId, op);
  run().then(r => { if (r?.ok === false) Object.assign(op, {state:'failed', errorCode:r.errorCode || 'FAILED'}); else if (remoteOps.get(sessionId) === op) remoteOps.delete(sessionId); },
    () => Object.assign(op, {state:'failed', errorCode:'NODE_UNAVAILABLE'}));
  holdWhileRunning();
}
async function remoteServe(d) {
  const locale = d.locale === 'zh-CN' ? 'zh-CN' : 'en';
  const failed = r => ({ok:false, errorCode:r?.errorCode || 'FAILED', execution:r?.execution || 'unknown'});
  if (d.call === 'catalog') {
    const c = await worker('viewer_catalog', {});
    if (!c.ok) return failed(c);
    let result = slimCatalog(c);
    // The version ranges alone still pair models with systems.
    if (JSON.stringify(result).length > REMOTE_BYTES) result = {...result, runtimes:result.runtimes.map(({supportedDeviceTypes, ...r}) => r)};
    return {ok:true, result};
  }
  if (d.call === 'create') {
    const r = await worker('create_device', {name:str(d.name, 64), deviceType:str(d.deviceType), runtime:str(d.runtime)});
    return r.ok && r.udid ? {ok:true, result:{ok:true, udid:r.udid, name:r.name}} : failed(r);
  }
  if (!SESSION.test(d.sessionId)) return {ok:false, errorCode:'INVALID_ARGUMENT', execution:'not_executed'};
  const running = remoteOps.get(d.sessionId)?.state === 'running';
  if (d.call === 'task_bind') {
    if (!str(d.udid)) return {ok:false, errorCode:'INVALID_ARGUMENT', execution:'not_executed'};
    const r = await worker('task_bind', {_task:d.sessionId, udid:d.udid, _locale:locale, _remote:true});
    if (!r.ok) return failed(r);
    if (!running) remoteOps.delete(d.sessionId);
  } else if (d.call === 'task_boot' || d.call === 'shutdown') {
    if (!str(d.udid)) return {ok:false, errorCode:'INVALID_ARGUMENT', execution:'not_executed'};
    if (!running) remoteStart(d.sessionId, d.call, d.udid, () => d.call === 'task_boot'
      ? worker('boot', {udid:d.udid, memoryMode:str(d.memoryMode, 32), _task:d.sessionId, _locale:locale})
      : worker('settings_shutdown', {udid:d.udid}));
  } else if (d.call !== 'task_state') return {ok:false, errorCode:'UNSUPPORTED', execution:'not_executed'};
  const s = await worker('remote_task_state', {_task:d.sessionId, _locale:locale});
  if (!s.ok) return failed(s);
  const op = remoteOps.get(d.sessionId);
  // A failure is told once; the page then shows the device as it is.
  if (op?.state === 'failed') remoteOps.delete(d.sessionId);
  // Phones attached to that computer are not offered to other computers.
  let devices = (s.devices || []).filter(x => x.kind !== 'physical').map(slimDevice);
  const state = () => ({device:s.device?.kind === 'physical' ? null : slimDevice(s.device), devices, settings:{enabled:s.settings?.enabled !== false},
    ...(op ? {operation:{call:op.call, udid:op.udid, state:op.state, ...(op.errorCode ? {errorCode:op.errorCode} : {})}} : {})});
  while (devices.length > 8 && JSON.stringify(state()).length > REMOTE_BYTES) devices = devices.slice(0, Math.ceil(devices.length / 2));
  return {ok:true, state:state()};
}

// -- on the computer that shows them --
async function remoteAsk(deviceId, data) {
  if (typeof cindy.deviceSync !== 'function') return {ok:false, errorCode:'SYNC_NOT_ALLOWED'};
  try {
    const r = await cindy.deviceSync({op:'request', peer:deviceId, data:{v:1, kind:REMOTE_KIND, ...data}});
    if (!r?.ok) return {ok:false, errorCode:r?.errorCode || 'SYNC_OFFLINE'};
    return r.data && typeof r.data === 'object' && typeof r.data.ok === 'boolean' ? r.data : {ok:false, errorCode:'REMOTE_PLUGIN_UPDATE_REQUIRED'};
  } catch { return {ok:false, errorCode:'SYNC_NOT_ALLOWED'}; }
}
// A label only: Cindy's own name for that computer, else the one it gave the page.
async function computerName(deviceId, label) {
  const given = str(label, 80) || '';
  if (typeof cindy.deviceSync !== 'function') return given;
  try { const s = await cindy.deviceSync({op:'status'}); return String(s?.peers?.find(p => p.deviceId === deviceId)?.deviceName || given).slice(0, 80); } catch { return given; }
}
// Whether that computer's plugin answers management requests: 'yes', 'no'
// (asked again after a while: it may be updated), or not known yet. An answer
// can take the whole request timeout, so the first page load never waits for it.
const remoteManage = new Map();
const MANAGE_RETRY_MS = 5 * 60000;
const NO_MANAGE = new Set(['SYNC_NOT_ALLOWED', 'SYNC_RESULT_UNKNOWN', 'SYNC_REQUEST_EXPIRED', 'SYNC_SECURE_STORAGE_UNAVAILABLE', 'REMOTE_PLUGIN_UPDATE_REQUIRED', 'UNSUPPORTED']);
function manages(deviceId) {
  const known = remoteManage.get(deviceId);
  return known?.state === 'no' && Date.now() - known.at > MANAGE_RETRY_MS ? undefined : known;
}
function learnManage(deviceId, reply) {
  if (reply.ok) remoteManage.set(deviceId, {state:'yes', at:Date.now()});
  else if (NO_MANAGE.has(reply.errorCode)) remoteManage.set(deviceId, {state:'no', at:Date.now()});
  return reply;
}
// The device shown here: Cindy's address for its picture, wrapped in this computer's controller page.
async function remoteViewer(m, locale, state, extra) {
  const device = state.device;
  if (!device || device.state !== 'Booted' || state.settings?.enabled === false || !SCREEN.test(device.udid)) return state;
  const opened = await remoteView({op:'open', deviceId:m.deviceId, id:device.udid});
  if (!opened.ok || typeof opened.url !== 'string') return {...state, viewerError:opened.errorCode || 'REMOTE_UNAVAILABLE'};
  const platform = device.platform === 'android' ? 'android' : /tvOS/.test(device.runtime || '') ? 'tvos' : /xrOS|visionOS/.test(device.runtime || '') ? 'visionos'
    : /iPad/.test(device.productFamily || device.deviceType || device.name || '') ? 'ipados' : 'ios';
  const viewer = await worker('remote_viewer', {id:device.udid, url:opened.url, name:device.name, platform:extra.platform || platform,
    devices:state.devices, computer:extra.computer, manage:extra.manage, _locale:locale, _task:m.sessionId});
  return viewer.ok && viewer.url ? {...state, viewer:{udid:device.udid, url:viewer.url}} : {...state, viewerError:viewer.errorCode || 'NODE_UNAVAILABLE'};
}
// View only: what Cindy itself lists for that computer, for a plugin there that cannot be asked.
async function remoteViewOnly(m, locale, computer) {
  const listed = await remoteView({op:'screens', deviceId:m.deviceId});
  if (!listed.ok) return {ok:false, errorCode:listed.errorCode || 'REMOTE_UNAVAILABLE', execution:'not_executed'};
  const screens = (Array.isArray(listed.screens) ? listed.screens : [])
    .filter(s => s && SCREEN.test(s.id) && Array.isArray(s.taskIds) && s.taskIds.includes(m.sessionId));
  // The device the page already shows stays; otherwise the task's first.
  const screen = screens.find(s => s.id === m.screenId) || screens[0];
  const device = screen ? {udid:screen.id, name:String(screen.name || screen.id).slice(0, 128), state:'Booted', isAvailable:true, thisTask:true,
    ...(screen.platform === 'android' ? {platform:'android'} : {}), runtime:screen.platform === 'tvos' ? 'tvOS' : screen.platform === 'visionos' ? 'visionOS' : '',
    productFamily:screen.platform === 'ipados' ? 'iPad' : 'iPhone'} : null;
  const state = await remoteViewer(m, locale, {device, devices:device ? [device] : [], settings:{enabled:true}}, {computer, manage:false, platform:screen?.platform});
  return {ok:true, remote:{computer, manage:false}, ...state};
}
async function remoteTask(m, locale) {
  const calls = ['task_state', 'task_bind', 'task_boot', 'catalog', 'create', 'shutdown'];
  if (typeof m.deviceId !== 'string' || !DEVICE.test(m.deviceId) || !calls.includes(m.call)) return false;
  const global = m.call === 'catalog' || m.call === 'create';
  if (!global && !SESSION.test(m.sessionId)) return false;
  const known = manages(m.deviceId);
  const ask = () => remoteAsk(m.deviceId, {call:m.call, sessionId:global ? undefined : m.sessionId, udid:str(m.udid), name:str(m.name, 64),
    deviceType:str(m.deviceType), runtime:str(m.runtime), memoryMode:str(m.memoryMode, 32), locale}).then(r => learnManage(m.deviceId, r));
  if (m.call !== 'task_state') {
    if (known?.state === 'no') return {ok:false, errorCode:'REMOTE_PLUGIN_UPDATE_REQUIRED', execution:'not_executed'};
    const reply = await ask();
    if (!reply.ok) return {ok:false, errorCode:reply.errorCode, execution:reply.execution || 'unknown'};
    if (global) return reply.result;
    const computer = await computerName(m.deviceId, m.computer);
    return {ok:true, remote:{computer, manage:true}, ...await remoteViewer(m, locale, reply.state, {computer, manage:true})};
  }
  const computer = await computerName(m.deviceId, m.computer);
  if (known?.state !== 'yes') {
    // Show what can be shown at once; learn in the background whether more can be asked.
    if (!known) { remoteManage.set(m.deviceId, {state:'asking', at:Date.now()}); void remoteAsk(m.deviceId, {call:'task_state', sessionId:m.sessionId, locale}).then(r => { if (!learnManage(m.deviceId, r).ok && remoteManage.get(m.deviceId)?.state === 'asking') remoteManage.delete(m.deviceId); }); }
    return remoteViewOnly(m, locale, computer);
  }
  const reply = await ask();
  if (!reply.ok) return {ok:false, errorCode:reply.errorCode, execution:'not_executed'};
  return {ok:true, remote:{computer, manage:true}, ...await remoteViewer(m, locale, reply.state, {computer, manage:true})};
}

const PAGE_ACTIONS = {
  remote_task: remoteTask,
  task_state: (m, l) => SESSION.test(m.sessionId) && worker('task_state', {_task:m.sessionId, _locale:l}),
  task_bind: (m, l) => SESSION.test(m.sessionId) && str(m.udid) && worker('task_bind', {_task:m.sessionId, udid:m.udid, _locale:l}),
  task_boot: async (m, l) => {
    if (!SESSION.test(m.sessionId) || !str(m.udid)) return false;
    const booted = await worker('boot', {udid:m.udid, memoryMode:m.memoryMode, _task:m.sessionId, _locale:l});
    return booted.ok && !booted.taskBindingError ? afterTaskOperation(booted, 'task_state', {_task:m.sessionId, _locale:l}) : booted;
  },
  task_create: async (m, l) => {
    if (!SESSION.test(m.sessionId)) return false;
    const created = await worker('create_device', {name:str(m.name, 64), deviceType:str(m.deviceType), runtime:str(m.runtime)});
    return created.ok && created.udid ? afterTaskOperation(created, 'task_bind', {_task:m.sessionId, udid:created.udid, _locale:l}, 'taskBindingError') : created;
  },
  manage_state: async () => {
    // Only offer "open in the current task" when a task is actually in front:
    // the full-page management view usually has none.
    const front = hasTaskView() ? await cindy.taskView({peek:true}).catch(() => null) : null;
    return worker('manage_state', front?.ok && SESSION.test(front.sessionId) ? {_task:front.sessionId} : {});
  },
  catalog: () => worker('viewer_catalog', {}),
  resources: (m) => str(m.udid) && worker('resource_usage', {udid:m.udid,refresh:m.refresh===true}),
  android_plan: () => worker('android_setup_plan', {}),
  android_status: () => worker('android_setup_status', {}),
  android_install: (m) => str(m.planId) && m.acceptLicenses === true && worker('android_setup_install', {planId:m.planId, acceptLicenses:true}),
  boot: (m) => str(m.udid) && worker('settings_boot', {udid:m.udid, memoryMode:m.memoryMode}),
  restart_device: (m) => str(m.udid) && worker('settings_restart', {udid:m.udid, memoryMode:m.memoryMode}),
  shutdown: (m) => str(m.udid) && worker('settings_shutdown', {udid:m.udid}),
  rename: (m) => str(m.udid) && str(m.name, 64) && worker('rename_device', {udid:m.udid, name:m.name}),
  erase: (m) => str(m.udid) && worker('erase_device', {udid:m.udid}),
  delete: (m) => str(m.udid) && worker('delete_device', {udid:m.udid}),
  // The management view shows the selected running device's screen itself.
  viewer_url: (m, l) => str(m.udid) && worker('settings_viewer', {udid:m.udid, _locale:l}),
  create: (m) => worker('create_device', {name:str(m.name, 64), deviceType:str(m.deviceType), runtime:str(m.runtime)}),
  open_in_task: (m, l) => str(m.udid) && openInTask(m.udid, l),
  go_to_task: async (m) => {
    if (!str(m.udid)) return false;
    if (!hasTaskView()) return {ok:false, errorCode:'HOST_UPDATE_REQUIRED'};
    const target = await worker('task_target', {udid:m.udid});
    if (!target.ok) return target;
    if (!SESSION.test(target.sessionId)) return {ok:false, errorCode:'TASK_NOT_BOUND'};
    const opened = await cindy.taskView({sessionId:target.sessionId, focus:true});
    if (!opened?.ok) return {ok:false, errorCode:opened?.errorCode || 'PREVIEW_FAILED'};
    // Older hosts accept unknown fields but only open the tab in the background.
    if (opened.focusRequested !== true) return {ok:false, errorCode:'HOST_UPDATE_REQUIRED'};
    return opened;
  },
};
const KEEPS_RUNNING = new Set(['remote_task', 'task_state', 'task_bind', 'task_boot', 'task_create', 'boot', 'restart_device', 'open_in_task', 'viewer_url', 'android_install']);
if (pages) pages.onmessage = async ({data: msg}) => {
  if (msg?.type === 'ping' && typeof msg.id === 'string') { pages.postMessage({type:'ready', id:msg.id}); return; }
  if (msg?.type !== 'request' || typeof msg.id !== 'string' || !Object.hasOwn(PAGE_ACTIONS, msg.action)) return;
  let result;
  try {
    result = await PAGE_ACTIONS[msg.action](msg, await hostLocale());
    if (!result) result = {ok:false, errorCode:'INVALID_ARGUMENT', execution:'not_executed'};
  } catch { result = {ok:false, errorCode:'PAGE_UNAVAILABLE', execution:'unknown'}; }
  pages.postMessage({type:'response', id:msg.id, result});
  if (KEEPS_RUNNING.has(msg.action)) holdWhileRunning();
};

// The settings page is same-origin with the logic page. It exposes only
// explicit device controls, never a generic Node method or shell command.
if (typeof BroadcastChannel !== 'undefined') {
  const settings = new BroadcastChannel('baguette-settings');
  settings.onmessage = async ({data: msg}) => {
    if (msg?.type === 'ping' && typeof msg.id === 'string') { settings.postMessage({type:'ready', id:msg.id}); return; }
    const methods = {status:'settings_status',resources:'resource_usage',save:'settings_save',shutdown:'settings_shutdown',stopAll:'settings_stop_all',boot:'settings_boot',catalog:'viewer_catalog',create:'create_device'};
    if (msg?.type !== 'request' || typeof msg.id !== 'string' || !(Object.hasOwn(methods, msg.action) || msg.action === 'viewer')) return;
    let result;
    try {
      const locale = await hostLocale();
      if (msg.action === 'viewer') result = await openInTask(msg.udid, locale);
      else {
        const params = msg.action === 'save' ? {enabled:msg.enabled,idleMinutes:msg.idleMinutes}
          : msg.action === 'create' ? {name:msg.name,deviceType:msg.deviceType,runtime:msg.runtime}
          : {udid:msg.udid,_locale:locale,...(msg.action==='boot'?{memoryMode:msg.memoryMode}:msg.action==='resources'?{refresh:msg.refresh===true}:{})};
        result = await worker(methods[msg.action], params);
      }
    } catch { result = {ok:false,errorCode:'SETTINGS_UNAVAILABLE',execution:'unknown'}; }
    settings.postMessage({type:'response',id:msg.id,result});
    if (msg.action === 'boot' || msg.action === 'viewer') holdWhileRunning();
  };
}
