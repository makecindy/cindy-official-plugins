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
    offTitle: (n) => `${n} is off`, screenLost: 'The screen did not connect. The device is still running.', retry: 'Try Again',
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
    software: 'Software rendering', goToTask: 'Go to Related Task', latestTask: 'Open the most recently related task and its simulator view', noTask: 'No task uses this device. Refresh the device list.', hostUpdate: 'Update Cindy to jump to a task and open its simulator sidebar.',
  },
  'zh-CN': {
    title: '模拟器', search: '搜索', add: '新建设备', newIphone: 'iPhone…', newIpad: 'iPad…', newAndroid: '安卓…', newTv: 'Apple TV…', newVision: 'Vision Pro…',
    running: '运行中', off: '已关闭', none: '没有匹配的设备',
    start: '启动', starting: '正在启动…', stop: '关闭', stopping: '正在关闭…', open: '在当前任务中打开', rename: '改名',
    erase: '抹掉所有内容和设置…', remove: '删除…', more: '更多',
    stateOff: '已关闭', stateOn: '运行中', idle: '空闲', unknown: '占用待确认', operating: '正在操作', selectedTask: '当前任务选中', tasks: (n) => `${n} 个任务近期使用`, thisTask: '当前任务近期使用',
    offTitle: (n) => `${n} 已关闭`, screenLost: '画面没有连上，设备仍在运行。', retry: '重试',
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
    software: '软件渲染', goToTask: '前往关联任务', latestTask: '打开最近关联的任务及模拟器画面', noTask: '已没有任务使用这台设备，请刷新设备列表。', hostUpdate: '请更新 Cindy，以支持跳到对应任务并打开模拟器侧栏。',
  },
};
const { rpc, h, locale, GLYPH, createDevice, catalog } = globalThis.CindySimPages;
const M = globalThis.CindySimModel;
const $ = (id) => document.getElementById(id);
const SELECTED = 'cindy.hub.selected';
let T = TEXT.en, lang = 'en', state = null, busy = {}, renaming = null, query = '', models = new Map(), shown = { udid: null, url: null };
let selected = (() => { try { return localStorage.getItem(SELECTED); } catch { return null; } })();
let pending = null, resourceView = null, renderedHero = null;
let selectionAnchor = null, batch = null;
const checked = new Set();
const BATCH_TEXT = {
  en: {count:n=>`${n} selected`,hidden:n=>`${n} hidden by search`,stop:n=>`Shut down (${n})`,remove:n=>`Delete (${n})…`,
    title:(action,n)=>action==='delete'?`Delete ${n} devices?`:`Shut down ${n} devices?`,
    deleteBody:'All apps and data on these devices will be permanently deleted. Linked tasks will choose another device next time.',
    stopBody:'Apps on these devices will quit. Device data is kept.',progress:(n,total)=>`Processing ${n} of ${total}…`,result:(n,total)=>`${n} of ${total} completed.`,failed:'Not completed',unattempted:'Remaining devices were not attempted. Check device status before trying again.',record:'The device operation completed, but its saved records could not be updated.'},
  'zh-CN': {count:n=>`已选 ${n} 台`,hidden:n=>`${n} 台被搜索隐藏`,stop:n=>`关闭 (${n})`,remove:n=>`删除 (${n})…`,
    title:(action,n)=>action==='delete'?`删除这 ${n} 台设备？`:`关闭这 ${n} 台设备？`,
    deleteBody:'这些设备的 App 和数据将永久删除，无法恢复。关联任务下次会重新选择设备。',
    stopBody:'这些设备上的 App 将退出，设备数据保留。',progress:(n,total)=>`正在处理 ${n} / ${total}…`,result:(n,total)=>`已完成 ${n} / ${total} 台。`,failed:'未完成',unattempted:'其余设备尚未处理，请核对设备状态后再操作。',record:'设备操作已完成，但关联记录未能更新。'},
};
const BT = () => BATCH_TEXT[lang] || BATCH_TEXT.en;
const filteredDevices = () => (state?.devices || []).filter(d=>!query || `${d.name} ${modelName(d)} ${osVersion(d)}`.toLowerCase().includes(query));
const orderedDevices = () => [...filteredDevices().filter(d=>d.state!=='Shutdown'),...filteredDevices().filter(d=>d.state==='Shutdown')];
const selectedDevices = () => (state?.devices || []).filter(d=>checked.has(d.udid));
function toggleSelection(d, range=false, additive=false) {
  if (batch) return;
  const ids=orderedDevices().map(x=>x.udid), start=ids.indexOf(selectionAnchor || selected), end=ids.indexOf(d.udid);
  if (range && start>=0 && end>=0) {
    if (!additive) checked.clear();
    for (const id of ids.slice(Math.min(start,end),Math.max(start,end)+1)) checked.add(id);
  }
  else { if (checked.has(d.udid)) checked.delete(d.udid); else checked.add(d.udid); selectionAnchor=d.udid; }
  renderList();
}
function chooseRow(d,e) {
  if (batch) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey) toggleSelection(d,e.shiftKey,e.metaKey || e.ctrlKey);
  else { checked.clear(); checked.add(d.udid); selectionAnchor=d.udid; select(d.udid); }
}
function renderSelection() {
  for (const id of checked) if (!state?.devices?.some(d=>d.udid===id)) checked.delete(id);
  if (batch) message(BT().progress(batch.done,batch.total));
  $('search').disabled=$('add').disabled=!!batch;
  $('detail').inert=!!batch;
}
function confirmBatch(action) {
  if (batch || Object.keys(busy).length || !['shutdown','delete'].includes(action)) return;
  // Capture the exact identities shown in this confirmation, not a mutable selection.
  const targets=selectedDevices().filter(d=>action==='delete' || d.state!=='Shutdown').map(d=>({...d}));
  if (!targets.length) return;
  const text=BT(), ok=h('button',{class:'btn '+(action==='delete'?'danger':'cta'),text:action==='delete'?T.deleteOk:T.stop,type:'button'});
  const cancel=h('button',{class:'btn quiet',text:T.cancel,type:'button'});
  const dialog=h('dialog',{class:'sheet-dialog'},[h('div',{class:'sheet'},[
    h('h2',{text:text.title(action,targets.length)}),h('p',{class:'sheet-body',text:action==='delete'?text.deleteBody:text.stopBody}),
    h('ul',{class:'batch-targets'},targets.map(d=>h('li',{},[h('strong',{text:d.name}),h('span',{text:`${osVersion(d)} · ${d.udid.slice(-8)}`})]))),
    h('div',{class:'sheet-actions'},[cancel,ok])])]);
  const dismiss=()=>{dialog.close();dialog.remove();};
  cancel.addEventListener('click',dismiss);dialog.addEventListener('cancel',dismiss);
  ok.addEventListener('click',()=>{ok.disabled=true;dismiss();runBatch(action,targets);});
  document.body.append(dialog);dialog.showModal();cancel.focus();
}
async function runBatch(action, targets) {
  if (batch || Object.keys(busy).length) return;
  pending=null; closeMenu(); batch={done:0,total:targets.length}; message(''); renderSelection();
  const failures=[],warnings=[];let completed=0,stopped=false;
  for (const d of targets) {
    busy[d.udid]=action==='shutdown'?T.stopping:'…'; render();
    try {
      const r=await rpc(action,{udid:d.udid},T.timeout);
      if (r?.ok!==true || r.deviceError || r.outcome==='partial') throw r || Error('UNKNOWN_RESULT');
      completed++; checked.delete(d.udid);
      if (r.taskBindingError || r.appContextError || r.taskStateError) warnings.push(`${d.name}: ${BT().record}`);
      if (action==='delete') {
        state.devices=state.devices.filter(x=>x.udid!==d.udid);
        if (selected===d.udid) selected=null;
      } else state.devices=state.devices.map(x=>x.udid===d.udid?{...x,state:'Shutdown'}:x);
    } catch (error) {
      failures.push(`${d.name}: ${errorText(error)}`);
      // An uncertain transport result must never be replayed automatically.
      const code=error?.errorCode || error?.code;
      if (!code || error?.execution==='unknown' || ['TIMEOUT','PLUGIN_OFF'].includes(code)) stopped=true;
    } finally { delete busy[d.udid];batch.done++; }
    if (stopped) break;
  }
  const remaining=targets.length-batch.done;
  batch=null; if (!await refresh()) warnings.push(T.readFailed); renderSelection();
  message([BT().result(completed,targets.length),failures.length?BT().failed+'：'+failures.join('；'):'',remaining?BT().unattempted:'',...warnings].filter(Boolean).join(' '),!!failures.length || !!warnings.length);
}

const glyphFor = (d) => {
  const kind = `${d.deviceType || ''} ${d.name || ''}`;
  return /Duo/i.test(kind) ? GLYPH.fold : /iPad/i.test(kind) ? GLYPH.ipad : /Apple-?\s?TV/i.test(kind) ? GLYPH.tv
    : /Vision|xrOS|RealityDevice/i.test(kind) ? GLYPH.vision : /Watch/i.test(kind) ? GLYPH.watch : GLYPH.iphone;
};
const modelName = (d) => models.get(d.deviceType) || String(d.deviceType || '').replace(/^.*SimDeviceType\./, '').replace(/-/g, ' ');
const osVersion = (d) => M.runtimeLabel(d.runtime);
const usage = (d) => d.thisTaskActive ? T.thisTask : d.activeTasks ? T.tasks(d.activeTasks) : d.operation ? T.operating : d.thisTask ? T.selectedTask : d.state === 'Shutdown' ? T.idle : d.state === 'Booted' ? T.stateOn : T.unknown;
const enabled = () => state?.settings?.enabled !== false;
let messageTimer = null;
function message(text, error = false) {
  $('message').textContent = text || ''; $('message').classList.toggle('error', !!error);
  clearTimeout(messageTimer); if (text && !error && !batch) messageTimer = setTimeout(() => message(''), 4000);
}
function errorText(r) { return ({ BUSY: T.busy, TIMEOUT: T.timeout, PLUGIN_OFF: T.pluginOff, RUNTIME_DISABLED: T.pausedTitle, TASK_NOT_BOUND:T.noTask, HOST_UPDATE_REQUIRED:T.hostUpdate })[r?.errorCode || r?.code] || T.failed; }
function select(udid) { selected = udid; try { localStorage.setItem(SELECTED, udid || ''); } catch {} render(); }

// ---- menus ----
let openMenu = null;
function closeMenu() {
  if (!openMenu) return;
  const {menu,scrim,anchor}=openMenu, restore=menu.contains?.(document.activeElement);
  menu.remove(); scrim.remove(); anchor?.setAttribute('aria-expanded','false'); openMenu=null;
  if (restore && anchor?.isConnected) anchor.focus({preventScroll:true});
}
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

function selectionMenu(d, anchor, at) {
  if (batch) return;
  if (!checked.has(d.udid)) {
    if (anchor && !at) { const r=anchor.getBoundingClientRect(); at={x:r.left,y:r.bottom}; }
    checked.clear(); checked.add(d.udid); selectionAnchor=d.udid; renderList(); anchor=null;
  }
  anchor ||= [...$('list').querySelectorAll('.row')].find(n=>n.getAttribute('data-udid')===d.udid);
  const devices=selectedDevices();
  if (devices.length<2) return deviceMenu(d,anchor,at);
  const text=BT(), visible=new Set(filteredDevices().map(x=>x.udid));
  const hidden=devices.filter(x=>!visible.has(x.udid)).length, running=devices.filter(x=>x.state!=='Shutdown').length;
  showMenu(anchor,[
    h('div',{class:'menu-summary',text:text.count(devices.length)+(hidden?' · '+text.hidden(hidden):'')}),
    item(text.stop(running),()=>confirmBatch('shutdown'),{disabled:!running || !!Object.keys(busy).length}),
    item(text.remove(devices.length),()=>confirmBatch('delete'),{'data-danger':true,disabled:!!Object.keys(busy).length}),
  ],at);
}

function deviceMenu(d, anchor, at) {
  if (batch) return;
  const on = d.state === 'Booted';
  showMenu(anchor, [
    on ? item(T.stop, () => act('shutdown', d)) : item(T.start, () => act('boot', d), { disabled: !enabled() }),
    state.currentTask && !d.thisTask ? item(T.open, () => act('open_in_task', d, T.opened), { disabled: !enabled() }) : null,
    d.tasks ? item(T.goToTask, () => goToTask(d), { title: T.latestTask }) : null,
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
  const isSelected = checked.has(d.udid), working = busy[d.udid];
  const name = renaming === d.udid
    ? h('form', { class: 'rename', onsubmit: (e) => { e.preventDefault(); const v = e.target.elements.n.value.trim(); if (v && v !== d.name) act('rename', d, null, { name: v }); renaming = null; render(); } }, [
      h('input', { name: 'n', value: d.name, maxlength: '64', 'aria-label': T.rename, onkeydown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); renaming = null; render(); } }, onblur: (e) => { if (renaming === d.udid && e.target.isConnected) e.target.form.requestSubmit(); } })])
    : h('span', { class: 'row-name', text: d.name, title: d.name });
  const node = h('div', { class: 'row', role: 'option', 'aria-selected': String(isSelected), tabindex: '0', 'data-udid': d.udid,
    onclick: (e) => { if (!e.target.closest('button, form, input')) chooseRow(d,e); },
    onkeydown: (e) => {
      if (e.target !== node) return;
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); selectionMenu(d,node); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chooseRow(d,e); }
    },
    oncontextmenu: (e) => { e.preventDefault(); selectionMenu(d,null,{x:e.clientX,y:e.clientY}); } }, [
    h('span', { class: 'tile', 'data-on': String(d.state === 'Booted'), title: working || usage(d), 'aria-label': working || usage(d), html: glyphFor(d) }),
    h('span', { class: 'row-text' }, [h('span', { class: 'row-heading' }, [name,
      h('button', { class: 'icon-btn row-more', type: 'button',disabled:!!batch, title: T.more, 'aria-label': T.more, html: GLYPH.more, onclick: (e) => { e.stopPropagation(); selectionMenu(d,e.currentTarget); } }),
    ]), h('span', { class: 'row-sub', title:[modelName(d),osVersion(d),working || usage(d),d.renderer === 'software' ? T.software : null].filter(Boolean).join(' · ') }, [
      h('span', { class:'row-model', text:working || modelName(d) }),
      h('span', { text:osVersion(d) }),
      d.renderer === 'software' ? h('span', { text:T.software }) : null,
    ]), resourceView?.label(d)]),
  ]);
  return node;
}
function renderList() {
  const list = $('list'), scroll=list.scrollTop, focus=document.activeElement?.closest?.('.row');
  const focusId=focus?.getAttribute('data-udid');
  list.replaceChildren(); resourceView?.prune(); renderSelection();
  const devices = filteredDevices();
  if (!state) return;
  if (!state.devices.length) return;
  if (!devices.length) { list.append(h('p', { class: 'hub-none', text: T.none })); return; }
  for (const [label, group] of [[T.running, devices.filter((d) => d.state !== 'Shutdown')], [T.off, devices.filter((d) => d.state === 'Shutdown')]]) {
    if (!group.length) continue;
    list.append(h('div', { class: 'hub-section', text: label }), ...group.map(row));
  }
  if (renaming) list.querySelector('.rename input')?.select();
  list.scrollTop=scroll;
  if (focusId && !renaming) { const target=[...list.querySelectorAll('.row')].find(n=>n.getAttribute('data-udid')===focusId); target?.focus({preventScroll:true}); }
}

// ---- detail ----
function clearScreen() {
  shown = { udid: null, url: null };
  $('screen').hidden = true;
  $('screen').src = 'about:blank';
}
async function showScreen(d) {
  resourceView?.update(null);
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
  const key = d ? JSON.stringify([d,busy[d.udid],enabled(),note,modelName(d),lang]) : null;
  if (key && key === renderedHero && !$('hero').hidden) { resourceView?.update(d); return; }
  renderedHero = key;
  clearScreen(); $('hero').hidden = false;
  const big = (glyph) => h('div', { class: 'hero-glyph', html: glyph.replace(/width="20" height="20"/, 'width="40" height="40"').replace(/stroke-width="1.5"/, 'stroke-width="1"') });
  let children;
  if (!state) children = [h('div', { class: 'spinner' })];
  else if (!state.devices.length) children = [big(GLYPH.iphone), h('h2', { text: T.emptyTitle }), h('p', { text: T.emptyBody }),
    h('div', { class: 'hero-actions' }, [h('button', { class: 'btn cta', text: T.createIphone, disabled: !enabled(), onclick: () => newDevice('any') })])];
  else if (!d) children = [big(GLYPH.iphone), h('h2', { text: T.pickTitle }), h('p', { text: T.pickBody })];
  else {
    const working = busy[d.udid], running = d.state !== 'Shutdown' && enabled();
    children = [big(glyphFor(d)), h('h2', { text: d.state === 'Shutdown' ? T.offTitle(d.name) : d.name }),
      h('p', { class: 'hero-meta' }, [h('span',{text:`${modelName(d)} · ${M.runtimeLabel(d.runtime)} · ${usage(d)}`}),resourceView?.node]),
      !enabled() || running ? h('p', { text: !enabled() ? T.pausedBody : T.screenLost }) : null,
      h('div', { class: 'hero-actions' }, working ? [h('span', { class: 'spinner' }), h('span', { class: 'hero-working', text: working })] : [
        running ? h('button', { class: 'btn cta', text: T.retry, onclick: () => showScreen(d) })
          : h('button', { class: 'btn cta', text: T.start, disabled: !enabled(), onclick: () => act('boot', d) }),
        h('button', { class: 'icon-btn hero-more', type: 'button', title: T.more, 'aria-label': T.more, html: GLYPH.more, onclick: (e) => deviceMenu(d, e.currentTarget) })])];
  }
  if (d) {
    const picker = d.state==='Shutdown' ? globalThis.CindySimPages.memoryPicker(d,lang,!!busy[d.udid] || !enabled()) : null;
    const actions = children.pop();
    children.push(h('div',{class:'startup-panel'},[picker,actions]));
  }
  resourceView?.update(d || null);
  if (note) children.push(h('p', { class: 'status error', text: note }));
  $('hero').replaceChildren(h('div', { class: 'hero' }, children));
}
function renderDetail() {
  const devices = state?.devices || [];
  if (!devices.some((d) => d.udid === selected)) selected = devices.find((d) => d.state === 'Booted')?.udid || devices[0]?.udid || null;
  const d = devices.find((x) => x.udid === selected);
  // The controller owns the pending dialog; a transient Shutdown during the
  // worker's restart must not destroy its response handler or chosen mode.
  if (d?.operation?.name === 'settings_restart' && shown.udid === d.udid && shown.url && enabled()) return;
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
async function goToTask(d) {
  try {
    const result = await rpc('go_to_task', {udid:d.udid}, T.timeout);
    if (!result?.ok) throw result;
  } catch (error) { message(errorText(error), true); }
}
async function refresh() {
  if (batch || Object.keys(busy).length || pending) return;
  const request = pending = {};
  let failed=false;
  try {
    const r = await rpc('manage_state', {}, T.timeout); if (pending !== request) return; if (!r.ok) throw r;
    if (!state) {
      message('');
      if (!r.devices.some(d=>d.udid===selected)) selected=r.devices.find(d=>d.state==='Booted')?.udid || r.devices[0]?.udid || null;
      if (selected) checked.add(selected);
    }
    state = r;
  }
  catch (error) { failed=true; if (pending !== request) return; if (!state) message(error?.code ? errorText(error) : T.readFailed, true); }
  finally { if (pending === request) pending = null; }
  render();
  return !failed;
}
async function act(action, d, done, extra = {}) {
  if (batch || busy[d.udid]) return;
  pending = null;
  busy[d.udid] = action === 'boot' ? T.starting : action === 'shutdown' ? T.stopping : '…';
  message(''); render();
  try {
    const memory = action==='boot' ? globalThis.CindySimPages.memoryArgs(d) : {};
    const r = await rpc(action, { udid: d.udid, ...extra, ...memory }, T.timeout);
    if (r?.ok === false || r?.deviceError) throw r;
    if (action==='boot') M.showMemoryNotice(r, lang, memory.memoryMode, d.name);
    if (r.taskBindingError || r.appContextError) message(T.recordFailed, true);
    else if (r.taskStateError) message(T.stateFailed, true);
    else if (done) message(done);
    if (action === 'delete' && selected === d.udid) selected = null;
  } catch (error) { message(errorText(error), true); }
  finally { delete busy[d.udid]; await refresh(); }
}
async function newDevice(family) {
  if (batch) return;
  const made = await createDevice({ family, lang });
  if (!made) return;
  message(T.created(made.name));
  if (made.udid) selected = made.udid;
  pending = null; // creation supersedes a status read started before the new device existed
  await refresh();
  $('list').querySelector(`[data-udid="${made.udid}"]`)?.scrollIntoView({ block: 'nearest' });
}

function setupSplitter() {
  const hub = $('hub'), handle = $('splitter'), media = window.matchMedia('(max-width: 720px)');
  const keys = {width:'cindy.hub.listWidth',height:'cindy.hub.listHeight'}, preferred = {width:300,height:null};
  let axis = media.matches ? 'height' : 'width', pointer = null, offset = 0;
  for (const name of ['width','height']) {
    try {
      const saved = Number(localStorage.getItem(keys[name]));
      if (Number.isFinite(saved) && saved >= (name === 'width' ? 220 : 180) && saved <= (name === 'width' ? 480 : 10000)) preferred[name] = saved;
    } catch {}
  }
  const defaults = () => axis === 'width' ? 300 : Math.min(340,hub.getBoundingClientRect().height * .4);
  const bounds = () => {
    const rect = hub.getBoundingClientRect();
    if (axis === 'width') return {min:220,max:Math.max(220,Math.min(480,rect.width-368))};
    const max = Math.max(0,rect.height-210);
    return {min:Math.min(180,max),max};
  };
  function apply(value, remember = false) {
    const {min,max} = bounds(), size = Math.round(Math.max(min,Math.min(max,value)));
    hub.style.setProperty('--device-list-'+axis,size+'px');
    handle.setAttribute('aria-valuemin',String(min)); handle.setAttribute('aria-valuemax',String(max)); handle.setAttribute('aria-valuenow',String(size));
    handle.setAttribute('aria-valuetext',size+(lang==='zh-CN'?' 像素':' pixels'));
    if (remember) { preferred[axis] = size; try { localStorage.setItem(keys[axis],String(size)); } catch {} }
  }
  function finish() {
    if (pointer === null) return;
    const old = pointer; pointer = null; hub.classList.remove('resizing');
    if (handle.hasPointerCapture(old)) handle.releasePointerCapture(old);
  }
  function layout() {
    const next = media.matches ? 'height' : 'width';
    if (next !== axis) { finish(); axis = next; }
    const dimension = axis === 'width' ? '宽度' : '高度';
    handle.title = lang==='zh-CN'?`拖动调整${dimension}，双击恢复默认`:'Drag to resize. Double-click to reset.';
    handle.setAttribute('aria-label',lang==='zh-CN'?`调整设备列表${dimension}`:`Resize device list ${axis}`);
    handle.setAttribute('aria-orientation',axis === 'width' ? 'vertical' : 'horizontal');
    apply(preferred[axis] ?? defaults());
  }
  function reset() {
    preferred[axis] = axis === 'width' ? 300 : null;
    try { localStorage.removeItem(keys[axis]); } catch {}
    apply(defaults());
  }
  const position = e => axis === 'width' ? e.clientX-hub.getBoundingClientRect().left : e.clientY-hub.getBoundingClientRect().top;
  handle.addEventListener('pointerdown',e=>{
    if (pointer !== null || e.button !== 0) return;
    offset = position(e)-Number(handle.getAttribute('aria-valuenow'));
    e.preventDefault(); pointer=e.pointerId; handle.setPointerCapture(pointer); handle.focus(); hub.classList.add('resizing');
  });
  handle.addEventListener('pointermove',e=>{if(pointer===e.pointerId)apply(position(e)-offset,true);});
  for (const event of ['pointerup','pointercancel','lostpointercapture']) handle.addEventListener(event,finish);
  window.addEventListener('blur',finish);
  handle.addEventListener('dblclick',reset);
  handle.addEventListener('keydown',e=>{
    const {min,max} = bounds(), current=Number(handle.getAttribute('aria-valuenow'));
    if (e.key === 'Enter') { e.preventDefault(); reset(); return; }
    const arrows = axis === 'width' ? {ArrowLeft:current-16,ArrowRight:current+16} : {ArrowUp:current-16,ArrowDown:current+16};
    const value = {...arrows,Home:min,End:max}[e.key];
    if(value!==undefined){e.preventDefault();apply(value,true);}
  });
  media.addEventListener('change',layout);
  new ResizeObserver(layout).observe(hub); layout();
}

(async () => {
  lang = await locale(); T = TEXT[lang] || TEXT.en; document.documentElement.lang = lang;
  resourceView = M.createResourceSummary(lang,(device,refresh)=>rpc('resources',{udid:device.udid,refresh}));
  setupSplitter();
  $('list').addEventListener('keydown',e=>{
    if (batch || e.target.closest('input,form')) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase()==='a') {e.preventDefault();checked.clear();for(const d of filteredDevices())checked.add(d.udid);renderList();}
    if (e.key==='Escape') {e.preventDefault();checked.clear();selectionAnchor=null;renderList();}
    if (['ArrowUp','ArrowDown','Home','End'].includes(e.key) && !e.target.closest('button')) {
      const devices=orderedDevices(), current=devices.findIndex(d=>d.udid===e.target.closest('.row')?.getAttribute('data-udid'));
      const index=e.key==='Home'?0:e.key==='End'?devices.length-1:Math.max(0,Math.min(devices.length-1,current+(e.key==='ArrowUp'?-1:1)));
      if (devices[index]) {
        e.preventDefault();chooseRow(devices[index],e);
        const target=[...$('list').querySelectorAll('.row')].find(n=>n.getAttribute('data-udid')===devices[index].udid);
        target?.focus({preventScroll:true});target?.scrollIntoView({block:'nearest'});
      }
    }
  });
  $('add').innerHTML = GLYPH.plus; $('add').title = T.add; $('add').setAttribute('aria-label', T.add);
  $('search-glyph').innerHTML = GLYPH.search; $('search').placeholder = T.search;
  $('search').addEventListener('input', (e) => { query = e.target.value.trim().toLowerCase(); renderList(); });
  $('add').addEventListener('click', () => showMenu($('add'), [item(T.newIphone, () => newDevice('iphone'), { disabled: !enabled() }), item(T.newIpad, () => newDevice('ipad'), { disabled: !enabled() }), item(T.newTv, () => newDevice('tv'), { disabled: !enabled() }), item(T.newAndroid, () => newDevice('android'), { disabled: !enabled() }), item(T.newVision, () => newDevice('vision'), { disabled: !enabled() })]));
  render(); await refresh();
  catalog().then((c) => { for (const t of c.deviceTypes || []) models.set(t.identifier, t.name); render(); }).catch(() => {});
  setInterval(() => { if (!document.hidden && !openMenu && !renaming && !Object.keys(busy).length && !document.querySelector('dialog[open]')) refresh(); }, 4000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
