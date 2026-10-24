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
  if (msg.type !== 'tool-call') return;
  try {
    const locale = await hostLocale();
    // Host ceiling is 120s; worker preflight is 3s + 5s.
    // Boot retains 15s start + 90s readiness (113s total).
    // Screenshots the model asks for (the screenshot tool, screenshot:true, observe=screenshot, a wait that ran out)
    // are shown to it inline (host `images`); the worker attaches nothing otherwise.
    const response = await cindy.node.request({method: msg.tool, params: {...msg.args,_locale:locale,_inline:true}, timeoutMs: 120000});
    if (!response.ok) {
      await cindy.send({type:'tool-result',callId:msg.callId,ok:false,errorCode:'NODE_REQUEST_FAILED',message:response.message || 'Worker failed; execution may be unknown. Inspect device before retrying.'});
      return;
    }
    const result = response.result;
    const opening = msg.tool === 'open_viewer' || (msg.tool === 'viewer' && msg.args?.action === 'open');
    const viewer = result.viewer || (opening ? result : null);
    if (result.ok && viewer && viewer.ready && viewer.url) {
      const shown = await showViewer(viewer.url, msg.args?.udid, msg.args?.session_context?.session_id, locale);
      viewer.previewOpened = shown.previewOpened;
      if (shown.location) viewer.location = shown.location;
      if (shown.previewError) viewer.previewError = shown.previewError;
    }
    if (result.ok && viewer?.previewOpened === false) {
      result.outcome = 'partial';
      result.nextAction = 'Retry viewer action=open for this device. Do not repeat an App launch that already succeeded.';
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
const PAGE_ACTIONS = {
  task_state: (m, l) => SESSION.test(m.sessionId) && worker('task_state', {_task:m.sessionId, _locale:l}),
  task_bind: (m, l) => SESSION.test(m.sessionId) && str(m.udid) && worker('task_bind', {_task:m.sessionId, udid:m.udid, _locale:l}),
  task_boot: async (m, l) => {
    if (!SESSION.test(m.sessionId) || !str(m.udid)) return false;
    const booted = await worker('boot', {udid:m.udid, _task:m.sessionId, _locale:l});
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
  android_plan: () => worker('android_setup_plan', {}),
  android_status: () => worker('android_setup_status', {}),
  android_install: (m) => str(m.planId) && m.acceptLicenses === true && worker('android_setup_install', {planId:m.planId, acceptLicenses:true}),
  boot: (m) => str(m.udid) && worker('settings_boot', {udid:m.udid}),
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
const KEEPS_RUNNING = new Set(['task_state', 'task_bind', 'task_boot', 'task_create', 'boot', 'open_in_task', 'viewer_url', 'android_install']);
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
    const methods = {status:'settings_status',save:'settings_save',shutdown:'settings_shutdown',stopAll:'settings_stop_all',boot:'settings_boot',catalog:'viewer_catalog',create:'create_device'};
    if (msg?.type !== 'request' || typeof msg.id !== 'string' || !(Object.hasOwn(methods, msg.action) || msg.action === 'viewer')) return;
    let result;
    try {
      const locale = await hostLocale();
      if (msg.action === 'viewer') result = await openInTask(msg.udid, locale);
      else {
        const params = msg.action === 'save' ? {enabled:msg.enabled,idleMinutes:msg.idleMinutes}
          : msg.action === 'create' ? {name:msg.name,deviceType:msg.deviceType,runtime:msg.runtime}
          : {udid:msg.udid,_locale:locale};
        result = await worker(methods[msg.action], params);
      }
    } catch { result = {ok:false,errorCode:'SETTINGS_UNAVAILABLE',execution:'unknown'}; }
    settings.postMessage({type:'response',id:msg.id,result});
    if (msg.action === 'boot' || msg.action === 'viewer') holdWhileRunning();
  };
}
