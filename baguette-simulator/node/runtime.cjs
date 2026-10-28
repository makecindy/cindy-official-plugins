'use strict';
const fs = require('node:fs/promises');
const {validSession} = require('./tasks.cjs');
const {deviceId} = require('./device-id.cjs');
const {commandBudget} = require('./budget.cjs');
const {readJsonRecord,recordUpdate} = require('./json-record.cjs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

// One owner for tools, settings and viewer actions. Polling never renews use.
// Idle shutdown skips devices still in use: an open viewer window, or another
// tool or script operating a device (`inUse`). `device_hold` keeps this worker
// alive while any device is running, so that rule outlives the host's idle
// recycling of on-demand workers.
const HOLD_MS = 100000, HOLD_POLL_MS = 10000;
function createRuntime({dispatch, settingsFile, now = Date.now, inUse = async () => false, viewing = () => false, forgetViewer = () => {},
  tasks = null, existingViewerUrl = () => null, pendingOperation = () => null, pendingJob = () => null, viewerWanted = () => true,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), holdMs = HOLD_MS, holdPollMs = HOLD_POLL_MS}) {
  let config, lastActivity = now(), lastStop = null, closing = false;
  // The existing saved viewer session carries reopen intent across workers;
  // explicit close retires it, while unexpected worker exit preserves it.
  let viewerClosed = !viewerWanted();
  // One operation at a time per device; '*' (settings, stop-all, idle) excludes everything.
  const busyKeys = new Map();
  let idleHandled = false;
  const assertEnabled=async()=>{if(!(await load()).enabled||closing)throw failure('RUNTIME_DISABLED','Baguette is paused. Open plugin settings.');};
  const manager=require('./device-manager.cjs').createDeviceManager({dispatch,exclusive,assertEnabled,touch,contextFile:settingsFile+'.apps.json',
    onSettled:async(entry,p)=>{if(tasks&&validSession(p.task)&&entry.activeUdid)await taskUpdate(entry,()=>tasks.bind(p.task,entry.activeUdid));}});
  const taskUpdate = (result, update) => recordUpdate(result, 'taskBindingError', update,
    'Task bindings could not be saved. The device outcome is retained; check the bindings file and storage, and do not repeat the device operation.');
  const failure = (code, message, execution = 'not_executed') => Object.assign(new Error(message), {code, execution});
  async function load() {
    if (config) return config;
    const value = await readJsonRecord(settingsFile, {initial:{enabled:true, idleMinutes:15},
      validate:value=>typeof value.enabled === 'boolean' && [0,15,30,60].includes(value.idleMinutes),
      code:'SETTINGS_UNREADABLE', message:'Cannot read Baguette settings. Restore the settings file before starting a device.'});
    config ||= {enabled: value.enabled, idleMinutes: value.idleMinutes,
      ...(['desktop','clipboard'].includes(value.screenshotDestination) ? {screenshotDestination:value.screenshotDestination} : {})};
    return config;
  }
  async function save(value) {
    await fs.mkdir(path.dirname(settingsFile), {recursive: true, mode: 0o700});
    const temporary = settingsFile + '.' + randomUUID() + '.tmp';
    try {
      await fs.writeFile(temporary, JSON.stringify(value), {mode: 0o600});
      await fs.rename(temporary, settingsFile);
      config = value;
    } finally { await fs.rm(temporary, {force:true}).catch(() => {}); }
  }
  function touch() { lastActivity = now(); idleHandled = false; }
  async function status(deadline, knownDevices) {
    let settings, settingsError;
    try { settings = await load(); }
    catch (error) {
      if (error.code !== 'SETTINGS_UNREADABLE') throw error;
      // Read/stop controls survive damaged settings; this is not a saved default.
      settings = {enabled:false, idleMinutes:null};
      settingsError = {code:error.code, message:error.message};
    }
    if (!knownDevices) commandBudget(1, deadline, now);
    return {...(knownDevices || await dispatch('devices', {includeMemoryModes:true}, deadline)), settings: {...settings}, settingsError, lastStop,
      deviceJob:manager.snapshot(),idleDeadline: settings.idleMinutes ? lastActivity + settings.idleMinutes * 60000 : null};
  }
  async function stopAll(reason, deadline = now() + 110000) {
    const run = (method, params = {}) => {
      commandBudget(1, deadline, now);
      return dispatch(method, params, deadline);
    };
    const before = await run('devices');
    const outcomes = [];
    // Enumerate exact private-set UDIDs; never use simctl shutdown all.
    for (const device of before.devices.filter(d => d.state !== 'Shutdown')) {
      try { await run('shutdown', {udid:device.udid}); outcomes.push({udid:device.udid, execution:'executed'}); }
      catch (error) { outcomes.push({udid:device.udid, errorCode:error.code || 'STOP_FAILED', message:error.message, execution:error.execution || 'unknown'}); }
    }
    let viewerError, result;
    try { await run('close_viewer'); }
    catch (error) { viewerError = {code:error.code || 'STOP_FAILED', message:error.message, execution:error.execution || 'unknown'}; }
    try { result = await status(deadline); }
    catch (error) {
      // A last-known list is not fresh shutdown evidence. Return it explicitly
      // marked, while preserving every command outcome and the saved switch.
      result = {...await status(deadline, before), devicesError:{code:error.code || 'STATUS_FAILED', message:error.message}};
    }
    const after = result.devices;
    const remaining = after.filter(d => d.state !== 'Shutdown').map(d => d.udid);
    const completed = outcomes.filter(o => o.execution === 'executed').map(o => o.udid);
    const unprocessed = outcomes.filter(o => o.execution === 'not_executed').map(o => o.udid);
    lastStop = {reason, at:now(), remaining, completed, unprocessed};
    const evidence = {remaining, completed, unprocessed, outcomes, ...(viewerError ? {viewerError} : {}), lastStop};
    if (remaining.length || before.platformErrors?.length || result.platformErrors?.length || result.devicesError || viewerError) return {...result, ...evidence, ok:false, errorCode:'STOP_INCOMPLETE', execution:'unknown'};
    return {...result, ...evidence, ok:true, execution:'executed'};
  }
  async function stopOne(udid, deadline) {
    await dispatch('shutdown', {udid}, deadline);
    let result;
    try { result = await status(deadline); }
    catch (error) { return {ok:false, errorCode:'STOP_UNCONFIRMED', execution:'unknown', completed:[udid], devicesError:{code:error.code || 'STATUS_FAILED', message:error.message}}; }
    const device = result.devices.find(d => deviceId(d.udid) === deviceId(udid));
    if (!device || device.state !== 'Shutdown') return {...result, ok:false, errorCode:'STOP_UNCONFIRMED', execution:'unknown', completed:[udid], remaining:[udid]};
    return {...result, ok:true, execution:'executed'};
  }
  async function exclusive(fn, key = '*', operation = {}) {
    const blocker = () => key === '*' ? busyKeys.values().next().value : busyKeys.get('*') || busyKeys.get(key);
    // Wait only before execution, at most one second and within this call's
    // budget. Never replay a mutation or queue global stop/settings commands.
    for (let attempt = 0; operation.wait && blocker() && !closing && attempt < 10; attempt++) {
      if (operation.deadline !== undefined && operation.deadline - now() <= 1100) break;
      await sleep(100);
    }
    const held = blocker();
    if (held || closing) {
      const job = held?.udid ? pendingJob(held.udid) : null;
      const busy = {operation:held?.operation || 'worker-stopping', scope:held?.scope || 'global',
        ...(held?.udid ? {udid:held.udid} : {}), ...(held?.sessionId ? {sessionId:held.sessionId} : {}),
        elapsedSeconds:held ? Math.max(0, Math.floor((now() - held.startedAt) / 1000)) : 0,
        ...(job ? {job:job.id} : {})};
      const next = job ? `Use app action=install_status udid=${busy.udid} job=${job.id}.`
        : 'Read devices for the active operation, then retry after it finishes.';
      throw Object.assign(failure('BUSY', `${busy.operation} is running ${busy.udid ? 'on device '+busy.udid : 'across devices'} (${busy.elapsedSeconds}s). This request was not executed. ${next}`), {busy});
    }
    if (operation.deadline !== undefined) commandBudget(1, operation.deadline, now);
    busyKeys.set(key, {...operation, operation:operation.operation || 'device-control', scope:key === '*' ? 'global' : 'device',
      udid:operation.udid || (key.startsWith('device:') ? key.slice(7) : undefined), startedAt:now()});
    try { return await fn(); } finally {
      // A tool may return a pollable install job; retain its existing lock until
      // the underlying write settles, including failure. Reads remain available.
      const pending = pendingOperation(key === '*' ? null : key.slice('device:'.length));
      if (pending) pending.then(() => busyKeys.delete(key), () => busyKeys.delete(key));
      else busyKeys.delete(key);
    }
  }
  // The Cindy task a call belongs to: injected session context for Agent tools,
  // or the task page's own task (main.js sets `_task` for page actions only).
  const sessionOf = params => params?.session_context?.session_id ?? params?._task;
  // Keep durable selection separate from recent multi-device activity.
  // No recent activity on a running device means unknown, never proven free.
  async function annotate(devices, session) {
    if (!tasks) return devices;
    const counts = await tasks.counts();
    const mine = session ? (await tasks.get(session))?.udid : null;
    return devices.map(d => {
      const id=deviceId(d.udid), held=busyKeys.get('device:'+id)||busyKeys.get('*');
      const activity=tasks.usage?.(id,session,now()) || {activeTasks:0,thisTaskActive:false};
      return {...d, tasks:counts[id]||0, ...(session ? {thisTask:id===deviceId(mine)} : {}), ...activity,
        usage:held||activity.activeTasks ? 'active' : d.state==='Shutdown' ? 'idle' : 'unknown',
        ...(held ? {operation:{name:held.operation, scope:held.scope, udid:held.udid,
          elapsedSeconds:Math.max(0,Math.floor((now()-held.startedAt)/1000)), ...(pendingJob(id) ? {job:pendingJob(id).id} : {})}} : {})};
    });
  }
  const withTask = (url, session) => url.replace('#', `&task=${encodeURIComponent(session)}#`);
  async function taskState(session, locale) {
    if (!tasks || !validSession(session)) throw failure('INVALID_ARGUMENT', 'Unknown task.');
    const devices = await annotate((await dispatch('devices', {includeMemoryModes:true})).devices, session);
    const binding = await tasks.get(session);
    const device = binding ? devices.find(d => deviceId(d.udid) === deviceId(binding.udid)) || null : null;
    let settings;
    try { settings = await load(); } catch { settings = {enabled:false, idleMinutes:null}; }
    let viewer = null, waiting = false;
    const restarting = device?.operation?.name === 'settings_restart';
    if (device && (device.state === 'Booted' || restarting) && settings.enabled && !viewerClosed) {
      // Reuse a running viewer without taking the runtime lock, so a page refresh
      // never makes an Agent tool call fail with BUSY.
      let url = await existingViewerUrl(device.udid, locale);
      if (!url && !restarting) {
        try { url = (await request('open_viewer', {udid:device.udid, _locale:locale}))?.url || null; }
        catch (error) { if (error.code === 'BUSY') waiting = true; else throw error; }
      }
      if (url) viewer = {udid:device.udid, url:withTask(url, session)};
    }
    return {ok:true, sessionId:session, device, devices, settings:{...settings}, viewer, viewerClosed, busy:waiting};
  }
  // Agent tools grouped by intent → the worker's own operations.
  const ROUTES = {
    device: {create: 'create_device', boot: 'boot', shutdown: 'shutdown', rename: 'rename_device', erase: 'erase_device', delete: 'delete_device', activity:'device_activity', release:'device_release', import_media:'import_media'},
    app: {install: 'app_install', install_status: 'app_install_status', info: 'app_info', launch: 'launch_app', terminate: 'app_terminate', uninstall: 'app_uninstall', open_url: 'open_url'},
    viewer: {open: 'open_viewer', close: 'close_viewer'},
  };
  // Reading a device never changes it, so it does not wait for (or block) input.
  const READ_ONLY = new Set(['describe_ui', 'wait_for', 'logs', 'app_info', 'app_install_status', 'viewer_screen']);
  async function request(method, params = {}, deadline = now() + 110000) {
    // Normalize before routing, locks, lookups and binding writes. Do not mutate
    // the caller's object or bypass the existing device validation/ownership checks.
    params = {...params, ...(typeof params?.udid === 'string' ? {udid:deviceId(params.udid)} : {}),
      ...(typeof params?.targetUdid === 'string' ? {targetUdid:deviceId(params.targetUdid)} : {})};
    if (Object.hasOwn(ROUTES, method)) {
      const actual = ROUTES[method][params?.action];
      if (!actual) throw failure('INVALID_ARGUMENT', `action must be one of ${Object.keys(ROUTES[method]).join(', ')}`);
      return request(actual, params, deadline);
    }
    if (method === 'device_activity' || method === 'device_release') {
      const session=sessionOf(params);
      if (!tasks || !validSession(session)) throw failure('INVALID_ARGUMENT','Device activity requires the calling task session context.');
      if (method==='device_activity') await assertEnabled();
      const listed=(await dispatch('devices',{},deadline)).devices;
      if (!listed.some(d=>deviceId(d.udid)===params.udid)) throw failure('DEVICE_NOT_OWNED','Select an exact device from devices.');
      if (method==='device_release') tasks.release(session,params.udid);
      else {tasks.activity(session,params.udid,now());touch();}
      return {ok:true,udid:params.udid,execution:'executed',...tasks.usage(params.udid,session,now()),
        note:method==='device_release'?'Task activity released; device and App keep running.':'Task activity recorded for 15 minutes. Renew during a long script; release when finished. This is not an exclusive reservation.'};
    }
    if (READ_ONLY.has(method) || (method === 'screenshot' && !params?.destination)) {
      if (!(await load()).enabled) throw failure('RUNTIME_DISABLED', 'Baguette is paused. Enable simulator operation in Plugins → Baguette settings.');
      touch();
      const result=await dispatch(method, params, deadline);
      if (method!=='app_install_status' && result?.ok!==false) {
        tasks?.activity?.(sessionOf(params),params.udid,now());
        touch();
      }
      return result;
    }
    // A settings refresh must not reject a user's stop/permission change.
    // Reading simulator state is safe while a command is in flight.
    if (method === 'settings_status') return status();
    if (method === 'resource_usage') return dispatch(method, params, deadline);
    if (method === 'viewer_switch') {
      return manager.start(params);
    }
    if (method === 'task_state') return taskState(params._task, params._locale);
    if (method === 'task_target') {
      const sessionId = tasks ? await tasks.latestForDevice(params.udid) : null;
      if (!sessionId) throw failure('TASK_NOT_BOUND', 'No task uses this device. Refresh the device list.');
      return {ok:true, sessionId};
    }
    if (method === 'task_bind') {
      if (!tasks || !validSession(params._task)) throw failure('INVALID_ARGUMENT', 'Unknown task.');
      const listed = (await dispatch('devices')).devices;
      if (!listed.some(d => deviceId(d.udid) === params.udid)) throw failure('INVALID_ARGUMENT', 'Unknown device. Refresh the list.');
      await tasks.bind(params._task, params.udid);
      viewerClosed = false;
      const result = {ok:true, execution:'executed', sessionId:params._task, boundUdid:params.udid};
      // Binding is already durable. Status/viewer failure cannot undo it or
      // make the caller believe that its previous device is still assigned.
      return recordUpdate(result, 'taskStateError', async () => Object.assign(result, await taskState(params._task, params._locale)),
        'Task binding was saved, but its status or screen could not be read. Refresh the task; do not repeat the binding.');
    }
    if (method === 'manage_state') {
      // The management view passes the task in front (if any) so rows can say
      // which device it uses.
      const result = await status();
      const current = validSession(params._task) ? params._task : null;
      return {...result, ok:true, currentTask: current, devices: await annotate(result.devices, current)};
    }
    if (method === 'viewer_catalog') return dispatch('environment');
    if (method === 'android_setup_plan' || method === 'android_setup_status') return dispatch(method, params);
    if (method === 'device_hold') return hold();
    // Listing devices and the toolchain reads only; it never waits behind another device's operation, and works while paused.
    if (method === 'devices') {
      const result = await dispatch(method, {...params,includeMemoryModes:true});
      return {...result, devices: await annotate(result.devices, sessionOf(params))};
    }
    if (method === 'environment') return dispatch(method, params);
    // Device operations are independent. The manager serializes only shared
    // record writes; stopping the shared viewer/settings still excludes all.
    const key = typeof params?.udid === 'string' && params.udid && !['settings_stop_all', 'settings_save', 'screenshot_destination', 'close_viewer'].includes(method) ? `device:${params.udid}` : '*';
    return exclusive(async () => {
      // Emergency stop stays available even if settings are damaged.
      if (method === 'shutdown') return dispatch(method, params);
      if (method === 'close_viewer') {
        viewerClosed = true;
        forgetViewer();
        return dispatch(method, params);
      }
      if (method === 'settings_shutdown') return stopOne(params.udid, deadline);
      if (method === 'settings_stop_all') return stopAll('manual', deadline);
      // Managing devices never starts one, so it works while simulators are paused.
      if (method === 'reveal_screenshot') return dispatch(method, params);
      if (method === 'delete_device' || method === 'erase_device') {
        const result = await dispatch(method, params);
        if(result.outcome==='partial')return result;
        await manager.updateRecord(result, () => manager.forget(result.udid || params.udid));
        if (method === 'delete_device' && tasks) await taskUpdate(result, () => tasks.forgetDevice(params.udid));
        // The management page refreshes independently after the operation.
        // Do not start another core budget or replace a completed destructive
        // operation with an error from an optional device-list read.
        return result;
      }
      const settings = await load();
      if (method === 'screenshot_destination') {
        if (!['desktop','clipboard'].includes(params.destination)) throw failure('INVALID_ARGUMENT', 'Invalid screenshot destination.');
        await save({...settings, screenshotDestination:params.destination});
        return {ok:true, destination:params.destination, execution:'executed'};
      }
      if (method === 'settings_save') {
        if (typeof params.enabled !== 'boolean' || ![0,15,30,60].includes(params.idleMinutes)) throw failure('INVALID_ARGUMENT', 'Invalid runtime settings. Refresh this page.');
        // Persist the stop switch BEFORE touching devices. Partial failure must
        // not allow a new boot to undo the user's decision.
        await save({...settings, enabled:params.enabled, idleMinutes:params.idleMinutes});
        // Turning simulators off also retires the saved viewer address.
        if (!params.enabled) { const result = await stopAll('disabled', deadline); forgetViewer(); return result; }
        touch();
        return {...await status(), ok:true, execution:'executed'};
      }
      const actual = {settings_boot:'boot', settings_restart:'boot', settings_viewer:'open_viewer'}[method] || method;
      if (!settings.enabled) throw failure('RUNTIME_DISABLED', 'Baguette is paused. Enable simulator operation in Plugins → Baguette settings.');
      if (method === 'settings_restart') {
        // Keep the existing per-device lock across both steps. A page going away
        // must not strand the device between shutdown and the requested boot.
        if (!['saving','standard','minimal'].includes(params.memoryMode)) throw failure('INVALID_ARGUMENT','Select an explicit memory mode before restarting.');
        const devices = (await dispatch('devices', {}, deadline)).devices;
        const device = devices.find(d => deviceId(d.udid) === params.udid);
        if (!device) throw failure('DEVICE_NOT_OWNED','Select an exact device from devices.');
        if (!/\.SimRuntime\.iOS-/.test(device.runtime)) throw failure('UNSUPPORTED_MEMORY_MODE','Memory modes are only supported for iOS simulators.');
        const stopped = await stopOne(params.udid, deadline);
        if (!stopped.ok) return stopped;
      }
      // A command can mutate a device and then fail (e.g. bootstatus timeout).
      // Re-arm cleanup before dispatch, even when no success result follows.
      touch();
      const result = await dispatch(actual, params, deadline);
      if (actual === 'app_uninstall') await manager.updateRecord(result, () => manager.forget(result.udid || params.udid, params.bundleId));
      if (actual === 'boot' || actual === 'open_viewer' || (actual === 'launch_app' && result?.viewer?.ready)) viewerClosed = false;
      if(actual==='launch_app'&&result?.appLaunched!==false)await manager.updateRecord(result, () => manager.remember(params.udid,params.bundleId));
      // Starting, opening or launching on a device from a task gives that task the device.
      if (tasks && validSession(sessionOf(params)) && ['boot','open_viewer','launch_app'].includes(actual) && result?.ok !== false && result?.appLaunched!==false) {
        await taskUpdate(result, () => tasks.bind(sessionOf(params), params.udid));
      }
      if (result?.ok!==false) tasks?.activity?.(sessionOf(params),params.udid,now());
      touch();
      return result;
    }, key, {operation:method,udid:params.udid,sessionId:sessionOf(params),deadline,wait:key!=='*'});
  }
  // Returns once no device is running and no viewer window is open (or at the
  // hold limit). A window can start a device itself, so it counts too. Never
  // renews use.
  async function hold() {
    const deadline = now() + holdMs;
    for (;;) {
      let running = false;
      try { running = viewing() || (await dispatch('devices')).devices.some(d => d.state !== 'Shutdown'); } catch {}
      if (!running || closing) return {running:false};
      if (now() >= deadline) return {running:true};
      await sleep(Math.min(holdPollMs, deadline - now()));
    }
  }
  async function checkIdle() {
    if (busyKeys.size || closing || idleHandled) return;
    return exclusive(async () => {
      const settings = await load();
      if (settings.enabled && (!settings.idleMinutes || now() - lastActivity < settings.idleMinutes * 60000)) return;
      // Someone is still watching or operating a device: start a new idle period.
      if (settings.enabled && (tasks?.hasActivity?.(now()) || await inUse().catch(() => true))) { touch(); return; }
      const result = await stopAll(settings.enabled ? 'idle' : 'disabled');
      // Incomplete shutdown stays visible; do not silently retry forever.
      idleHandled = true;
      return result;
    });
  }
  return {request, status, checkIdle, touch, exclusive,currentApp:manager.currentApp,assertEnabled,
    async close() { closing = true; return stopAll('worker-exit'); }};
}
module.exports = {createRuntime};
