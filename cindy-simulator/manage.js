'use strict';
// Management view, laid out like Simulator / Device Hub: every private device in
// a list on the left (running first), the selected one live on the right. Not
// tied to a task; when a task is in front (the view sits beside a chat), a device
// that task does not use yet can be opened in it.
const TEXT = {
  en: {
    title: 'Simulators', search: 'Search', add: 'New device', newIphone: 'iPhone…', newIpad: 'iPad…', newAndroid: 'Android…', newTv: 'Apple TV…', newVision: 'Vision Pro…',
    running: 'Running', off: 'Off', none: 'No matches',
    start: 'Start', starting: 'Starting…', stop: 'Shut Down', stopping: 'Shutting down…', open: 'Open in Current Task', rename: 'Rename',
    erase: 'Erase All Content and Settings…', remove: 'Delete…', more: 'More',
    stateOff: 'Off', stateOn: 'Running', idle: 'idle', unknown: 'activity unknown', operating: 'operation in progress', selectedTask: 'selected by this task', tasks: (n) => n === 1 ? 'recently used by 1 task' : `recently used by ${n} tasks`, thisTask: 'recently used by this task',
    offTitle: (n) => `${n} is off`, offBody: 'Start it to use it here. Apps and data are kept.', screenLost: 'The screen did not connect. The device is still running.', retry: 'Try Again',
    emptyTitle: 'No simulators yet', emptyBody: 'Create a device to run iOS and Android apps in your tasks.', createIphone: 'New device',
    pickTitle: 'Select a simulator', pickBody: 'Its screen shows here.',
    paused: 'Simulators are turned off in Plugins → Device Simulator. Shutting down and deleting still work.',
    pausedTitle: 'Simulators are turned off', pausedBody: 'Turn them on in Plugins → Device Simulator to start a device.',
    foot: (m) => (m ? `Devices shut down after ${m} minutes idle, ` : 'Devices only shut down when you choose, ') + 'never while a screen is open or a tool or script is using them.',
    eraseTitle: (n) => `Erase all content and settings on ${n}?`, eraseBody: 'The device goes back to how it was when created. All apps and data on it are deleted.', eraseOk: 'Erase',
    deleteTitle: (n) => `Delete ${n}?`, deleteBody: 'All apps and data on this device are deleted. This cannot be undone.', deleteTasks: (k) => k === 1 ? ' One task uses it; it will pick another device next time.' : ` ${k} tasks use it; they will pick another device next time.`, deleteOk: 'Delete', cancel: 'Cancel',
    opened: 'Opened in the current task.', created: (n) => `Created ${n}.`, erased: 'Erased.', deleted: 'Deleted.', save: 'Save',
    failed: 'Not completed. Refresh to see the actual state.', busy: 'Another simulator operation is running. Try again in a moment.', timeout: 'No response from the simulator service. Reopen this page.', pluginOff: 'The Device Simulator plugin is turned off.',
    readFailed: 'Could not read the devices.', stateFailed: 'Task binding was saved, but its status or screen could not be read. Refresh the task; do not repeat the binding.', recordFailed: 'Device operation completed, but its task or App record was not saved. Check storage before assigning or switching devices; do not repeat the operation.',
    software: 'Software rendering', goToTask: 'Open Simulator Sidebar', latestTask: 'Open the simulator sidebar in the most recently assigned task', noTask: 'No task uses this device. Refresh the device list.', hostUpdate: 'Update Cindy to jump to a task and open its simulator sidebar.',
  },
  'zh-CN': {
    title: '模拟器', search: '搜索', add: '新建设备', newIphone: 'iPhone…', newIpad: 'iPad…', newAndroid: '安卓…', newTv: 'Apple TV…', newVision: 'Vision Pro…',
    running: '运行中', off: '已关闭', none: '没有匹配的设备',
    start: '启动', starting: '正在启动…', stop: '关闭', stopping: '正在关闭…', open: '在当前任务中打开', rename: '改名',
    erase: '抹掉所有内容和设置…', remove: '删除…', more: '更多',
    stateOff: '已关闭', stateOn: '运行中', idle: '空闲', unknown: '占用待确认', operating: '正在操作', selectedTask: '当前任务选中', tasks: (n) => `${n} 个任务近期使用`, thisTask: '当前任务近期使用',
    offTitle: (n) => `${n} 已关闭`, offBody: '启动后在这里使用，App 和数据都保留。', screenLost: '画面没有连上，设备仍在运行。', retry: '重试',
    emptyTitle: '还没有模拟器', emptyBody: '新建一台，就能在任务里运行 iOS 和安卓 App。', createIphone: '新建设备',
    pickTitle: '选择一台模拟器', pickBody: '它的画面会显示在这里。',
    paused: '模拟器运行已在「插件 → 设备模拟器」里关闭；关闭和删除设备仍可用。',
    pausedTitle: '模拟器运行已关闭', pausedBody: '在「插件 → 设备模拟器」里打开开关后即可启动设备。',
    foot: (m) => (m ? `设备闲置 ${m} 分钟后自动关闭，` : '设备只在手动操作时关闭，') + '画面开着或有工具、脚本在操作时不会关闭。',
    eraseTitle: (n) => `抹掉「${n}」的所有内容和设置？`, eraseBody: '设备会恢复到刚创建时的状态，上面的所有 App 和数据都会删除。', eraseOk: '抹掉',
    deleteTitle: (n) => `删除「${n}」？`, deleteBody: '设备上的所有 App 和数据都会删除，且无法恢复。', deleteTasks: (k) => ` 有 ${k} 个任务在用它，之后会改用别的设备。`, deleteOk: '删除', cancel: '取消',
    opened: '已在当前任务中打开。', created: (n) => `已创建「${n}」。`, erased: '已抹掉。', deleted: '已删除。', save: '保存',
    failed: '操作没有完成，请刷新查看实际状态。', busy: '有其他模拟器操作正在进行，稍后再试。', timeout: '模拟器服务没有响应，请重新打开本页。', pluginOff: '「设备模拟器」插件已停用。',
    readFailed: '没能读取设备。', stateFailed: '任务绑定已保存，但状态或画面未能读取。请刷新任务，不要重复绑定。', recordFailed: '设备操作已完成，但任务绑定或 App 记录未保存。请先检查存储，再分配或切换设备；不要重复设备操作。',
    software: '软件渲染', goToTask: '打开模拟器侧栏', latestTask: '跳到最近关联的任务并打开模拟器侧栏', noTask: '已没有任务使用这台设备，请刷新设备列表。', hostUpdate: '请更新 Cindy，以支持跳到对应任务并打开模拟器侧栏。',
  },
};
const { rpc, h, locale, GLYPH, createDevice, catalog } = globalThis.CindySimPages;
const M = globalThis.CindySimModel;
const $ = (id) => document.getElementById(id);
const SELECTED = 'cindy.hub.selected';
let T = TEXT.en, lang = 'en', state = null, busy = {}, renaming = null, query = '', models = new Map(), shown = { udid: null, url: null };
let selected = (() => { try { return localStorage.getItem(SELECTED); } catch { return null; } })();
let pending = null;

const glyphFor = (d) => {
  const kind = `${d.deviceType || ''} ${d.name || ''}`;
  return /Duo/i.test(kind) ? GLYPH.fold : /iPad/i.test(kind) ? GLYPH.ipad : /Apple-?\s?TV/i.test(kind) ? GLYPH.tv
    : /Vision|xrOS|RealityDevice/i.test(kind) ? GLYPH.vision : /Watch/i.test(kind) ? GLYPH.watch : GLYPH.iphone;
};
const modelName = (d) => models.get(d.deviceType) || String(d.deviceType || '').replace(/^.*SimDeviceType\./, '').replace(/-/g, ' ');
const osVersion = (d) => M.runtimeLabel(d.runtime);
const usage = (d) => d.thisTaskActive ? T.thisTask : d.activeTasks ? T.tasks(d.activeTasks) : d.operation ? T.operating : d.thisTask ? T.selectedTask : d.state === 'Shutdown' ? T.idle : T.unknown;
const enabled = () => state?.settings?.enabled !== false;
let messageTimer = null;
function message(text, error = false) {
  $('message').textContent = text || ''; $('message').classList.toggle('error', !!error);
  clearTimeout(messageTimer); if (text && !error) messageTimer = setTimeout(() => message(''), 4000);
}
function errorText(r) { return ({ BUSY: T.busy, TIMEOUT: T.timeout, PLUGIN_OFF: T.pluginOff, RUNTIME_DISABLED: T.pausedTitle, TASK_NOT_BOUND:T.noTask, HOST_UPDATE_REQUIRED:T.hostUpdate })[r?.errorCode || r?.code] || T.failed; }
function select(udid) { selected = udid; try { localStorage.setItem(SELECTED, udid || ''); } catch {} render(); }

// ---- menus ----
let openMenu = null;
function closeMenu() { if (!openMenu) return; openMenu.menu.remove(); openMenu.scrim.remove(); openMenu.anchor?.setAttribute('aria-expanded', 'false'); openMenu = null; }
function showMenu(anchor, items, at) {
  closeMenu();
  const menu = h('div', { class: 'menu', role: 'menu' }, items.filter(Boolean));
  const scrim = h('div', { class: 'scrim', onclick: closeMenu, oncontextmenu: (e) => { e.preventDefault(); closeMenu(); } });
  document.body.append(scrim, menu);
  const r = at ? { left: at.x, right: at.x, bottom: at.y } : anchor.getBoundingClientRect();
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight, mr = menu.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(r.left, vw - mr.width - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(r.bottom + 6, vh - mr.height - 8)) + 'px';
  anchor?.setAttribute('aria-expanded', 'true'); openMenu = { menu, scrim, anchor };
  menu.querySelector('button:not(:disabled)')?.focus();
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
const item = (label, onclick, extra = {}) => h('button', { class: 'item', role: 'menuitem', ...extra, onclick: () => { closeMenu(); onclick(); } }, [h('span', { class: 'label', text: label })]);
const sep = () => h('div', { class: 'sep' });

function deviceMenu(d, anchor, at) {
  const on = d.state === 'Booted';
  showMenu(anchor, [
    on ? item(T.stop, () => act('shutdown', d)) : item(T.start, () => act('boot', d), { disabled: !enabled() }),
    state.currentTask && !d.thisTask ? item(T.open, () => act('open_in_task', d, T.opened), { disabled: !enabled() }) : null,
    item(T.rename, () => { renaming = d.udid; render(); }),
    sep(),
    item(T.erase, () => confirmThen(d, 'erase')),
    item(T.remove, () => confirmThen(d, 'delete'), { 'data-danger': true }),
  ], at);
}

// ---- confirm sheet ----
function confirmThen(d, kind) {
  const title = kind === 'erase' ? T.eraseTitle(d.name) : T.deleteTitle(d.name);
  const body = kind === 'erase' ? T.eraseBody : T.deleteBody + (d.tasks ? T.deleteTasks(d.tasks) : '');
  const ok = h('button', { class: 'btn danger', type: 'button', text: kind === 'erase' ? T.eraseOk : T.deleteOk });
  const cancel = h('button', { class: 'btn quiet', type: 'button', text: T.cancel });
  const dialog = h('dialog', { class: 'sheet-dialog' }, [h('div', { class: 'sheet' }, [h('h2', { text: title }), h('p', { class: 'sheet-body', text: body }), h('div', { class: 'sheet-actions' }, [cancel, ok])])]);
  document.body.append(dialog); dialog.showModal(); cancel.focus();
  const close = () => { dialog.close(); dialog.remove(); };
  cancel.addEventListener('click', close);
  dialog.addEventListener('cancel', close);
  ok.addEventListener('click', () => { close(); act(kind, d, kind === 'erase' ? T.erased : T.deleted); });
}

// ---- list ----
function row(d) {
  const isSelected = d.udid === selected, working = busy[d.udid];
  const name = renaming === d.udid
    ? h('form', { class: 'rename', onsubmit: (e) => { e.preventDefault(); const v = e.target.elements.n.value.trim(); if (v && v !== d.name) act('rename', d, null, { name: v }); renaming = null; render(); } }, [
      h('input', { name: 'n', value: d.name, maxlength: '64', 'aria-label': T.rename, onkeydown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); renaming = null; render(); } }, onblur: (e) => { if (renaming === d.udid && e.target.isConnected) e.target.form.requestSubmit(); } })])
    : h('span', { class: 'row-name', text: d.name });
  const node = h('div', { class: 'row', role: 'option', 'aria-selected': String(isSelected), tabindex: '0', 'data-udid': d.udid,
    onclick: (e) => { if (!e.target.closest('button, form')) select(d.udid); },
    onkeydown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === node) { e.preventDefault(); select(d.udid); } },
    oncontextmenu: (e) => { e.preventDefault(); select(d.udid); deviceMenu(d, null, { x: e.clientX, y: e.clientY }); } }, [
    h('span', { class: 'tile', 'data-on': String(d.state === 'Booted'), html: glyphFor(d) }),
    h('span', { class: 'row-text' }, [name, h('span', { class: 'row-sub', text: working ? working : `${modelName(d)} · ${usage(d)}${d.renderer === 'software' ? ' · ' + T.software : ''}` }),
      d.tasks ? h('button', { class:'link row-task', type:'button', text:T.goToTask, title:d.tasks > 1 ? T.latestTask : T.goToTask,
        onclick:(e)=>{ e.stopPropagation(); goToTask(d, e.currentTarget); } }) : null]),
    h('span', { class: 'row-os', text: osVersion(d) }),
    h('button', { class: 'icon-btn row-more', type: 'button', title: T.more, 'aria-label': T.more, html: GLYPH.more, onclick: (e) => { e.stopPropagation(); deviceMenu(d, e.currentTarget); } }),
  ]);
  return node;
}
function renderList() {
  const list = $('list'); list.replaceChildren();
  const devices = (state?.devices || []).filter((d) => !query || `${d.name} ${modelName(d)} ${osVersion(d)}`.toLowerCase().includes(query));
  if (!state) return;
  if (!state.devices.length) return;
  if (!devices.length) { list.append(h('p', { class: 'hub-none', text: T.none })); return; }
  for (const [label, group] of [[T.running, devices.filter((d) => d.state !== 'Shutdown')], [T.off, devices.filter((d) => d.state === 'Shutdown')]]) {
    if (!group.length) continue;
    list.append(h('div', { class: 'hub-section', text: label }), ...group.map(row));
  }
  if (renaming) list.querySelector('.rename input')?.select();
}

// ---- detail ----
function clearScreen() {
  shown = { udid: null, url: null };
  $('screen').hidden = true;
  $('screen').src = 'about:blank';
}
async function showScreen(d) {
  if (shown.udid === d.udid) {
    if (shown.url) { $('screen').hidden = false; $('hero').hidden = true; }
    return; // the same device's pending request already owns this view
  }
  clearScreen();
  const request = shown = { udid: d.udid, url: null };
  try {
    const r = await rpc('viewer_url', { udid: d.udid }, T.timeout);
    if (shown !== request) return;
    if (!r?.ok || !r.url) throw r;
    const [base, hash = ''] = r.url.split('#');
    shown.url = `${base}&embed=hub${hash ? '#' + hash : ''}`;
    $('screen').src = shown.url; $('screen').hidden = false; $('hero').hidden = true;
  } catch { if (shown === request) hero(d); } // only this request may replace its own screen with an error
}
function hero(d, note) {
  clearScreen(); $('hero').hidden = false;
  const big = (glyph) => h('div', { class: 'hero-glyph', html: glyph.replace(/width="20" height="20"/, 'width="56" height="56"').replace(/stroke-width="1.5"/, 'stroke-width="1"') });
  let children;
  if (!state) children = [h('div', { class: 'spinner' })];
  else if (!state.devices.length) children = [big(GLYPH.iphone), h('h2', { text: T.emptyTitle }), h('p', { text: T.emptyBody }),
    h('div', { class: 'hero-actions' }, [h('button', { class: 'btn cta', text: T.createIphone, disabled: !enabled(), onclick: () => newDevice('any') })])];
  else if (!d) children = [big(GLYPH.iphone), h('h2', { text: T.pickTitle }), h('p', { text: T.pickBody })];
  else {
    const working = busy[d.udid], running = d.state !== 'Shutdown' && enabled();
    children = [big(glyphFor(d)), h('h2', { text: d.state === 'Shutdown' ? T.offTitle(d.name) : d.name }),
      h('p', { class: 'hero-meta', text: `${modelName(d)} · ${M.runtimeLabel(d.runtime)} · ${usage(d)}` }),
      h('p', { text: !enabled() ? T.pausedBody : running ? T.screenLost : T.offBody }),
      h('div', { class: 'hero-actions' }, working ? [h('span', { class: 'spinner' }), h('span', { class: 'hero-working', text: working })] : [
        running ? h('button', { class: 'btn cta', text: T.retry, onclick: () => showScreen(d) })
          : h('button', { class: 'btn cta', text: T.start, disabled: !enabled(), onclick: () => act('boot', d) }),
        h('button', { class: 'icon-btn hero-more', type: 'button', title: T.more, 'aria-label': T.more, html: GLYPH.more, onclick: (e) => deviceMenu(d, e.currentTarget) })])];
  }
  if (note) children.push(h('p', { class: 'status error', text: note }));
  $('hero').replaceChildren(h('div', { class: 'hero' }, children));
}
function renderDetail() {
  const devices = state?.devices || [];
  if (!devices.some((d) => d.udid === selected)) selected = devices.find((d) => d.state === 'Booted')?.udid || devices[0]?.udid || null;
  const d = devices.find((x) => x.udid === selected);
  if (d && d.state === 'Booted' && !busy[d.udid] && enabled()) showScreen(d); else hero(d);
}

function render() {
  $('title').textContent = T.title;
  $('notice').hidden = !(state && !enabled()); $('notice').textContent = T.paused;
  $('foot').textContent = state ? T.foot(state.settings?.idleMinutes || 0) : '';
  $('search-box').hidden = !(state?.devices?.length > 6);
  renderList(); renderDetail();
}

// ---- data & actions ----
async function goToTask(d, button) {
  button.disabled = true;
  try {
    const result = await rpc('go_to_task', {udid:d.udid}, T.timeout);
    if (!result?.ok) throw result;
  } catch (error) { message(errorText(error), true); }
  finally { button.disabled = false; }
}
async function refresh() {
  if (Object.keys(busy).length || pending) return;
  const request = pending = {};
  try { const r = await rpc('manage_state', {}, T.timeout); if (pending !== request) return; if (!r.ok) throw r; if (!state) message(''); state = r; }
  catch (error) { if (pending !== request) return; if (!state) message(error?.code ? errorText(error) : T.readFailed, true); }
  finally { if (pending === request) pending = null; }
  render();
}
async function act(action, d, done, extra = {}) {
  if (busy[d.udid]) return;
  pending = null;
  busy[d.udid] = action === 'boot' ? T.starting : action === 'shutdown' ? T.stopping : '…';
  message(''); render();
  try {
    const r = await rpc(action, { udid: d.udid, ...extra }, T.timeout);
    if (r?.ok === false || r?.deviceError) throw r;
    if (r.taskBindingError || r.appContextError) message(T.recordFailed, true);
    else if (r.taskStateError) message(T.stateFailed, true);
    else if (done) message(done);
    if (action === 'delete' && selected === d.udid) selected = null;
  } catch (error) { message(errorText(error), true); }
  finally { delete busy[d.udid]; await refresh(); }
}
async function newDevice(family) {
  const made = await createDevice({ family, lang });
  if (!made) return;
  message(T.created(made.name));
  if (made.udid) selected = made.udid;
  pending = null; // creation supersedes a status read started before the new device existed
  await refresh();
  $('list').querySelector(`[data-udid="${made.udid}"]`)?.scrollIntoView({ block: 'nearest' });
}

(async () => {
  lang = await locale(); T = TEXT[lang] || TEXT.en; document.documentElement.lang = lang;
  $('add').innerHTML = GLYPH.plus; $('add').title = T.add; $('add').setAttribute('aria-label', T.add);
  $('search-glyph').innerHTML = GLYPH.search; $('search').placeholder = T.search;
  $('search').addEventListener('input', (e) => { query = e.target.value.trim().toLowerCase(); renderList(); });
  $('add').addEventListener('click', () => showMenu($('add'), [item(T.newIphone, () => newDevice('iphone'), { disabled: !enabled() }), item(T.newIpad, () => newDevice('ipad'), { disabled: !enabled() }), item(T.newTv, () => newDevice('tv'), { disabled: !enabled() }), item(T.newAndroid, () => newDevice('android'), { disabled: !enabled() }), item(T.newVision, () => newDevice('vision'), { disabled: !enabled() })]));
  render(); await refresh();
  catalog().then((c) => { for (const t of c.deviceTypes || []) models.set(t.identifier, t.name); render(); }).catch(() => {});
  setInterval(() => { if (!document.hidden && !openMenu && !renaming && !Object.keys(busy).length && !document.querySelector('dialog[open]')) refresh(); }, 4000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
