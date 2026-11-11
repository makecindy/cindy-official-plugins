'use strict';
// Task page: this task's own simulator. With a running device it shows the live
// controller full-bleed; otherwise it says what this task has and offers the one
// next step (use a device, create one, start it).
const TEXT = {
  en: {
    loading: 'Loading…', connecting: 'Connecting to the screen…',
    closedTitle: 'Screen closed', closedBody: 'The simulator is still running. Open the screen to continue.', open: 'Open screen', opening: 'Opening…',
    noneTitle: 'This task has no simulator yet', noneBody: 'Pick a device for this task or create a new one. Cindy also picks one when it opens the simulator.',
    use: 'Use', create: 'New device…', creating: 'Creating…', inOther: (n) => n === 1 ? 'recently used by another task' : `recently used by ${n} other tasks`,
    offTitle: (name) => `${name} is off`, start: 'Open', starting: 'Starting…', change: 'Use another device',
    pausedTitle: 'Simulators are turned off', pausedBody: 'Turn them on in Plugins → Device Simulator to use them here.',
    pluginOff: 'The Device Simulator plugin is turned off.', needXcode: 'Needs full Xcode with the required iOS, tvOS or visionOS runtime installed.',
    failed: 'Not completed. Check the device and try again.', busy: 'Another simulator operation is running. Trying again shortly…', timeout: 'No response from the simulator service. Reopen this tab.',
    // A task on another of the account's computers: the same page, for that computer's devices.
    remoteTag: (name) => name ? `Remote · ${name}` : 'Remote · another computer',
    remoteWaiting: 'Connecting to the other computer…', remoteUnavailable: 'The other computer cannot be reached right now. Trying again shortly…',
    remoteHostUpdate: 'Update Cindy on this computer to view devices that run on another computer.',
    remotePluginUpdate: 'Update the Device Simulator plugin on the other computer to choose, start or create its devices from here.',
    remoteNoneBody: 'Pick one of that computer’s devices for this task, or create a new one there.',
    remoteViewOnlyTitle: 'No device is running for this task', remoteViewOnlyBody: 'Once a simulator is opened for this task on the other computer, it appears here. Update the Device Simulator plugin there to choose or create devices from here.',
    remotePausedBody: 'Simulators are turned off on the other computer. Turn them on there in Plugins → Device Simulator.',
    remoteStopping: 'Shutting down…', remoteFailed: (code) => `The other computer did not complete it (${code}). Check the device there and try again.`,
    remoteCreate: (name) => name ? `New device on ${name}` : 'New device on the other computer',
    devices: 'Devices', back: 'Back', stateFailed: 'The operation completed, but task status or the screen could not be read. Refresh this task; do not repeat the operation.', recordFailed: 'Device operation completed, but its task or App record was not saved. Check storage before assigning or switching devices; do not repeat the operation.',
  },
  'zh-CN': {
    loading: '正在读取…', connecting: '正在连接画面…',
    closedTitle: '画面已关闭', closedBody: '模拟器仍在运行，打开画面即可继续。', open: '打开画面', opening: '正在打开…',
    noneTitle: '这个任务还没有模拟器', noneBody: '选一台设备给这个任务用，或新建一台。Cindy 打开模拟器时也会自己选。',
    use: '用这台', create: '新建设备…', creating: '正在创建…', inOther: (n) => `另有 ${n} 个任务近期使用`,
    offTitle: (name) => `${name} 已关闭`, start: '打开', starting: '正在启动…', change: '换一台设备',
    pausedTitle: '模拟器运行已关闭', pausedBody: '在「插件 → 设备模拟器」里打开开关后即可在这里使用。',
    pluginOff: '「设备模拟器」插件已停用。', needXcode: '需要先安装完整的 Xcode 和对应的 iOS、tvOS 或 visionOS 运行时。',
    failed: '操作没有完成，请核对设备后重试。', busy: '有其他模拟器操作正在进行，稍后自动重试…', timeout: '模拟器服务没有响应，请重新打开这个页签。',
    remoteTag: (name) => name ? `远程 · ${name}` : '远程 · 另一台电脑',
    remoteWaiting: '正在连接另一台电脑…', remoteUnavailable: '暂时连不上另一台电脑，稍后自动重试…',
    remoteHostUpdate: '需要先更新这台电脑上的 Cindy，才能查看另一台电脑上的设备。',
    remotePluginUpdate: '需要先更新另一台电脑上的「设备模拟器」插件，才能在这里选择、启动或新建它的设备。',
    remoteNoneBody: '从那台电脑的设备里选一台给这个任务用，或在那台电脑上新建一台。',
    remoteViewOnlyTitle: '这个任务没有运行中的设备', remoteViewOnlyBody: '在另一台电脑上为这个任务打开模拟器后，会自动显示在这里。更新那台电脑上的「设备模拟器」插件后，可以在这里选择或新建设备。',
    remotePausedBody: '另一台电脑上的模拟器运行已关闭，请在那台电脑的「插件 → 设备模拟器」里打开。',
    remoteStopping: '正在关闭…', remoteFailed: (code) => `另一台电脑没有完成这次操作（${code}）。请在那台电脑上核对设备后重试。`,
    remoteCreate: (name) => name ? `在「${name}」上新建设备` : '在另一台电脑上新建设备',
    devices: '设备', back: '返回', stateFailed: '操作已完成，但任务状态或画面未能读取。请刷新此任务，不要重复操作。', recordFailed: '设备操作已完成，但任务绑定或 App 记录未保存。请先检查存储，再分配或切换设备；不要重复设备操作。',
  },
};
const { rpc, h, locale, GLYPH, onPush, createDevice: newDevice } = globalThis.CindySimPages;
const M = globalThis.CindySimModel;
const session = new URLSearchParams(location.search).get('session') || '';
// Set by Cindy when the task lives on another of the account's computers. The
// page is the same; every action goes to the plugin on that computer instead
// of this computer's worker (main.js remoteTask), and every state says so.
const remoteDevice = new URLSearchParams(location.search).get('device') || '';
// Cindy also names that computer; the name is only ever shown.
const remoteName = (new URLSearchParams(location.search).get('deviceName') || '').slice(0, 80);
const call = (action, params, timeoutText) => remoteDevice
  ? rpc('remote_task', { deviceId: remoteDevice, computer: remoteName, call: action, ...params }, timeoutText) : rpc(action, params, timeoutText);
const computer = () => state?.remote?.computer || remoteName;
// That computer's plugin takes requests from here (an older one only shows its running device).
const manages = () => !remoteDevice || state?.remote?.manage === true;
// Starting and shutting down there outlast one request; the state says while they run.
const remoteOperation = () => remoteDevice && state?.operation?.state === 'running' ? state.operation : null;
const $ = (id) => document.getElementById(id);
let T = TEXT.en, lang = 'en', state = null, busy = null, choosing = false, note = null, viewerUrl = null;
let resourceView = null, refreshedAt = 0;
let pending = null; // identity of the only RPC still allowed to update this page

function show(url) {
  if (url && url !== viewerUrl) { viewerUrl = url; $('screen').src = url; }
  if (!url && viewerUrl) { viewerUrl = null; $('screen').src = 'about:blank'; }
  $('screen').hidden = !viewerUrl; $('home').hidden = !!viewerUrl;
}
function accept(r) {
  state = r;
  if (r.viewer?.url) choosing = false;
  show(r.viewer?.url);
}
function errorText(r) {
  const code = r?.errorCode || r?.code;
  const known = ({ BUSY: T.busy, RUNTIME_DISABLED: T.pausedTitle, TIMEOUT: T.timeout, PLUGIN_OFF: T.pluginOff,
    HOST_UPDATE_REQUIRED: T.remoteHostUpdate, REMOTE_PLUGIN_UPDATE_REQUIRED: T.remotePluginUpdate })[code];
  if (known || !remoteDevice) return known || T.failed;
  // The link to that computer, not the device: say so, and that it is retried.
  return /^SYNC_|^DEVICE_|^REMOTE_|^HOST_|^VIEW_|^INVOKE_/.test(code || '') ? T.remoteUnavailable : T.failed;
}
function hero(glyph, title, body, actions = []) {
  return h('div', { class: 'hero' }, [h('div', { class: 'glyph', html: glyph }),
    remoteDevice ? h('p', { class: 'remote-tag', text: T.remoteTag(computer()) }) : null,
    h('h2', { text: title }), body ? h('p', { text: body }) : null,
    state?.device && !choosing ? h('p',{class:'hero-meta'},[h('span',{text:M.runtimeLabel(state.device.runtime)}),resourceView?.node]) : null,
    actions.length ? h('div', { class: 'actions' }, actions) : null]);
}
function deviceList(exclude) {
  const devices = (state?.devices || []).filter((d) => d.udid !== exclude);
  const rows = M.deviceRows(devices, null, lang);
  if (!rows.length) return null;
  return h('div', { class: 'card' }, rows.map((row) => {
    const d = devices.find((x) => x.udid === row.udid);
    const others = (d.activeTasks || 0) - (d.thisTaskActive ? 1 : 0);
    return h('div', { class: 'device' }, [
      h('span', { class: 'glyph', html: GLYPH[row.family] }),
      h('div', { class: 'text' }, [h('div', { class: 'name', text: row.name }),
        globalThis.CindySimPages.memoryBadge(d,lang,!!busy),
        resourceView?.label(d),
        h('div', { class: 'meta' }, [h('span', { class: 'dot', 'data-tone': busy === row.udid ? 'busy' : row.tone }), h('span', { text: row.meta + (others > 0 ? ' · ' + T.inOther(others) : '') })])]),
      busy === row.udid ? h('span', { class: 'spinner' }) : h('button', { class: 'btn sm', text: T.use, disabled: !!busy || !row.available, onclick: () => act('task_bind', { udid: row.udid }, row.udid) }),
    ]);
  }));
}
function render() {
  const inner = $('inner'); inner.replaceChildren(); resourceView?.prune();
  if (!state) { inner.append(hero(GLYPH.big, note?.text || (remoteDevice ? T.remoteWaiting : T.loading), '')); return; }
  const operation = remoteOperation();
  if (state.settings?.enabled === false) inner.append(hero(GLYPH.pause, T.pausedTitle, remoteDevice ? T.remotePausedBody : T.pausedBody));
  else if (operation) {
    const name = state.devices?.find((d) => d.udid === operation.udid)?.name || state.device?.name || '';
    inner.append(hero(GLYPH.big, name, operation.call === 'shutdown' ? T.remoteStopping : T.starting, [h('span', { class: 'spinner' })]));
  } else if (remoteDevice && !manages() && !state.device) inner.append(hero(GLYPH.big, T.remoteViewOnlyTitle, T.remoteViewOnlyBody));
  else if (state.device && !choosing) {
    const d = state.device;
    const memory = globalThis.CindySimPages.memoryBadge(d,lang,!!busy);
    if (memory) inner.append(memory);
    resourceView?.update(viewerUrl ? null : d);
    if (d.state === 'Booted' && state.viewerClosed) inner.append(hero(GLYPH.big, T.closedTitle, T.closedBody, [
      h('button', { class: 'btn cta', text: busy === d.udid ? T.opening : T.open, disabled: !!busy, onclick: () => act('task_bind', { udid: d.udid }, d.udid) }),
    ]));
    else if (d.state === 'Booted') inner.append(hero(GLYPH.big, d.name, state.viewerError ? errorText({ errorCode: state.viewerError }) : state.busy ? T.busy : T.connecting, [h('span', { class: 'spinner' })]));
    else if(d.kind==='physical')inner.append(hero(GLYPH.big,d.name,lang==='zh-CN'?'手机未连接。请连接 USB 或已配对的网络，解锁并信任这台 Mac。':'Phone disconnected. Connect by USB or a paired network, unlock and trust this Mac.',[
      h('button',{class:'link',text:T.change,onclick:()=>{choosing=true;render();}}),
    ]));
    else inner.append(hero(GLYPH.big, T.offTitle(d.name), null, [
      globalThis.CindySimPages.memoryPicker(d,lang,!!busy),
      h('button', { class: 'btn cta', text: busy === d.udid ? T.starting : T.start, disabled: !!busy, onclick: () => act('task_boot', { udid: d.udid }, d.udid) }),
      (state.devices || []).length > 1 ? h('button', { class: 'link', text: T.change, disabled: !!busy, onclick: () => { choosing = true; render(); } }) : null,
    ]));
  } else {
    const actions = [h('button', { class: (state.devices || []).length ? 'btn quiet' : 'btn cta', text: busy === 'create' ? T.creating : T.create, disabled: !!busy, onclick: createDevice })];
    if (choosing) actions.push(h('button', { class: 'link', text: T.back, onclick: () => { choosing = false; render(); } }));
    inner.append(hero(GLYPH.big, T.noneTitle, remoteDevice ? T.remoteNoneBody : T.noneBody, actions));
    const list = deviceList(choosing ? state.device?.udid : null);
    if (list) { inner.append(h('div', { class: 'list-label', text: T.devices })); inner.append(list); }
  }
  inner.append(h('p', { class: 'status' + (note?.error ? ' error' : ''), text: note?.text || '' }));
}
async function refresh() {
  if (busy || pending) return;
  const request = pending = {};
  try {
    const r = await call('task_state', { sessionId: session, ...(remoteDevice && state?.device ? { screenId: state.device.udid } : {}) }, T.timeout);
    if (pending !== request) return;
    if (!r.ok) throw r;
    accept(r); refreshedAt = Date.now(); if (note && !note.sticky) note = null;
    // An operation that computer could not finish is told once.
    if (remoteDevice && r.operation?.state === 'failed') note = { text: T.remoteFailed(r.operation.errorCode || 'FAILED'), error: true, sticky: true };
  } catch (error) { if (pending !== request) return; if (!viewerUrl && !note?.sticky) note = { text: errorText(error), error: true }; }
  finally { if (pending === request) pending = null; }
  render();
}
async function act(action, params, marker) {
  if (busy) return;
  const request = pending = {};
  busy = marker; note = null; render();
  try {
    const device = state?.devices?.find(d=>d.udid===params.udid)||state?.device;
    const memory = action==='task_boot' ? globalThis.CindySimPages.memoryArgs(device) : {};
    const r = await call(action, { sessionId: session, ...params, ...memory }, T.timeout);
    if (pending !== request) return;
    if (!r.ok) throw r;
    if (action==='task_boot' && !remoteDevice) M.showMemoryNotice(r, lang, memory.memoryMode, device?.name);
    if (r.taskBindingError || r.appContextError) { note = { text: T.recordFailed, error: true, sticky: true }; return; }
    if (r.taskStateError) { state = null; choosing = false; show(null); note = { text: T.stateFailed, error: true, sticky: true }; return; }
    choosing = false; accept(r);
    return true;
  } catch (error) { if (pending === request) note = { text: errorText(error), error: true, sticky: true }; }
  finally { busy = null; render(); if (pending === request) { pending = null; if (!viewerUrl) refresh(); } }
}
// Same sheet as the management view (name, OS version, model); the new device
// then becomes this task's.
async function createDevice() {
  if (busy) return;
  const made = await newDevice({ family: 'any', lang, ...(remoteDevice ? { call: (action, params) => call(action, params, T.timeout), heading: T.remoteCreate(computer()) } : {}) });
  if (!made?.udid) return;
  return act('task_bind', { udid: made.udid }, 'create');
}
// The logic page pushes a fresh viewer when Cindy opens the simulator for this task.
// Only the embedded controller may hand off a newly created device's local choice.
globalThis.addEventListener('message',event=>{
  const m=event.data;
  if(remoteDevice){
    if(!viewerUrl) return;
    try { if(event.origin!==new URL(viewerUrl).origin) return; } catch { return; }
    // The device page lost its stream: renew the address behind it now.
    if(m?.type==='cindy-simulator-remote-ended'){ void refresh(); return; }
    // The controller's device menu: that computer's devices are managed by this page.
    if(m?.type!=='cindy-simulator-remote-action' || event.source!==$('screen').contentWindow || !manages()) return;
    // If the controller is still there afterwards, it is told how it went.
    const settle = (ok) => { try { $('screen').contentWindow?.postMessage({ type: 'cindy-simulator-remote-result', action: m.action, ok, errorCode: ok ? undefined : 'FAILED' }, event.origin); } catch {} };
    if(m.action==='bind' && typeof m.udid==='string') void (async () => {
      let ok = await act('task_bind', { udid: m.udid }, m.udid);
      // As on this computer, switching to a device that is off also starts it.
      if (ok && state?.device?.udid === m.udid && state.device.state === 'Shutdown' && !remoteOperation()) ok = await act('task_boot', { udid: m.udid }, m.udid);
      settle(ok);
    })();
    else if(m.action==='create') void createDevice().then(() => settle(true));
    else if(m.action==='shutdown' && state?.device) void act('shutdown', { udid: state.device.udid }, state.device.udid).then(settle);
    return;
  }
  if(!viewerUrl || event.source!==$('screen').contentWindow || m?.type!=='cindy-simulator-created' || m.sessionId!==session) return;
  try { if(event.origin!==new URL(viewerUrl).origin) return; } catch { return; }
  globalThis.CindySimPages.rememberMemoryChoice(m.udid,m.memoryMode);
});
onPush((m) => {
  // This computer's worker has nothing to say about a task that lives elsewhere.
  if (remoteDevice) return;
  if (m?.type !== 'viewer' || m.sessionId !== session || typeof m.url !== 'string') return;
  pending = null; choosing = false;
  if (m.taskStateError) { state = null; note = { text:T.stateFailed, error:true, sticky:true }; }
  show(m.url); render();
});
(async () => {
  lang = await locale(); T = TEXT[lang] || TEXT.en; document.documentElement.lang = lang;
  // Memory and disk figures belong to the computer that runs the device.
  if (!remoteDevice) resourceView = M.createResourceSummary(lang,(device,refresh)=>rpc('resources',{udid:device.udid,refresh}));
  $('screen').title = lang === 'zh-CN' ? '设备模拟器' : 'Device Simulator';
  render(); await refresh();
  // Bindings can change even while the current device keeps streaming.
  // Asking another computer is slower and dearer: less often, except while it starts or stops a device.
  if (remoteDevice) setInterval(() => { if (!document.hidden && !busy && (remoteOperation() || Date.now() - refreshedAt >= 6000)) refresh(); }, 2000);
  else setInterval(() => { if (!document.hidden && !busy) refresh(); }, 4000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !busy) refresh(); });
})();
