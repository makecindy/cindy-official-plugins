'use strict';
/**
 * 插件详情页里的设置区。只放需要用户决定的几项：
 * 每天自动整理（打开预填好的自动化页，频率和模型在那里选）、第一次读几天、读哪些来源、通讯录主要是同事还是客户。
 * 和主视图一样经同源 BroadcastChannel 交给 main.js 读写。
 */
(() => {
  const STRINGS = {
    'zh-CN': {
      loading: '正在读取设置…',
      sync: '设备同步', syncEnable: '与我的其他电脑同步通讯录', syncNow: '立即同步',
      syncHint: '在同一 Cindy 账号的电脑上分别开启，两台电脑同时在线时自动同步。离线修改会保留，重连后合并；删除也会同步。加密传输，不消耗 AI 额度。',
      syncUnsupported: '当前 Cindy 尚不支持插件设备同步，本地通讯录可继续使用。',
      syncState: { off: '未开启', waiting: '等待其他电脑连接', syncing: '正在同步…', synced: '已与在线电脑同步', error: '同步暂未完成', unsupported: '需要支持插件同步的 Cindy 版本' },
      syncLast: (w) => `上次确认同步：${w}`,
      syncConflict: '两台电脑上的联系人合并发生冲突。请先撤销其中一次合并，再重新同步；本机资料已保留。',
      syncVersion: '同步版本不兼容。请更新两台电脑上的通讯录插件后重试；本机资料已保留。',
      syncError: '这次没同步完，Cindy 会自动接着同步，本机资料都在。',
      syncPeerOff: '另一台电脑还没开启通讯录同步。', syncProgress: (p) => `正在同步 ${p}%…`,

      auto: '每天自动整理',
      autoBtn: '打开自动化页设置', autoAgain: '重新打开自动化页',
      autoHint: '会打开 Cindy 的自动化页，名称和要做的事已经填好；在那里选模型、确认频率后点保存。保存后每天整理一次，每次都会用到 AI 额度。',
      autoOpened: '已打开自动化页：选好模型后点保存，自动整理就开始了。',
      autoLast: (w) => `上次整理：${w}`, autoNever: '还没有整理过。',
      autoStop: '要停用或改频率、换模型：在自动化页编辑或暂停「整理通讯录」。',
      days: '第一次读最近', daysOpt: (d) => `${d} 天`,
      daysHint: '只影响第一次整理。想要更早的，可以在人物页「往来」里往前补。',
      sources: '读哪些来源',
      src: { mail: '邮件', calendar: '日历', im: '消息（飞书、iMessage 等）', cindy: 'Cindy 对话（只有每天自动整理能读）', github: 'GitHub' },
      state: { ok: '能读', missing: '没装插件', unauthorized: '没连接账号', unavailable: '这次用不了', error: '出错了', skipped: '跳过' },
      sourcesHint: '用已装的插件、本机命令行工具和能直接读的数据；都读不到的会跳过，并写明原因。',
      mac: 'macOS 通讯录', macSync: '每天和 macOS 通讯录对一次账（不用 AI）', macSyncHint: '只在你导入过一次后生效；只读，不改 Mac 通讯录。',
      profile: '通讯录主要是', colleagues: '同事和朋友', clients: '很多客户',
      profileHint: { colleagues: '每天整理一次。', clients: '每 6 小时整理一次，客户按公司归类，记下需求、报价和跟进约定。改了之后要重新打开自动化页保存一次才会换频率。' },
      tasksNote: '「现在整理一次」、往前补和写邮件草稿用下方「任务设置」的模型和动手权限；建议把动手权限设为「自动审查」，否则整理时每一步都要你确认。',
      failed: '没有保存成功：', noSchedule: '当前 Cindy 版本还不支持由插件打开自动化页。',
    },
    en: {
      loading: 'Loading settings…',
      sync: 'Device sync', syncEnable: 'Sync contacts with my other computers', syncNow: 'Sync now',
      syncHint: 'Enable on each computer using the same Cindy account. Changes merge when both computers are online, including offline edits and deletions. Encrypted transfer; no AI quota used.',
      syncUnsupported: 'This Cindy version does not support plugin device sync. Local contacts remain available.',
      syncState: { off: 'Off', waiting: 'Waiting for another computer', syncing: 'Syncing…', synced: 'Synced with online computers', error: 'Sync not completed', unsupported: 'A Cindy version supporting plugin sync is required' },
      syncLast: (w) => `Last confirmed sync: ${w}`,
      syncConflict: 'Conflicting contact merges on two computers. Undo one merge, then sync again. Local data is preserved.',
      syncVersion: 'Sync versions are incompatible. Update the Contacts plugin on both computers, then retry. Local data is preserved.',
      syncError: 'This sync did not finish. Cindy keeps trying on its own; your local contacts are safe.',
      syncPeerOff: 'Contacts sync is not turned on on the other computer yet.', syncProgress: (p) => `Syncing ${p}%…`,

      auto: 'Daily tidy-up',
      autoBtn: 'Set up in Automations', autoAgain: 'Open Automations again',
      autoHint: 'Opens Cindy’s Automations page with the name and instructions filled in. Pick a model, check the schedule and save. It then tidies up once a day; each run uses AI quota.',
      autoOpened: 'Automations is open: pick a model and save to start.',
      autoLast: (w) => `Last tidy-up: ${w}`, autoNever: 'Not tidied up yet.',
      autoStop: 'To pause it or change the schedule or model, edit “Tidy up contacts” on the Automations page.',
      days: 'First run reads', daysOpt: (d) => `${d} days`,
      daysHint: 'Only affects the first tidy-up. Go further back from a person’s Exchanges tab.',
      sources: 'Sources',
      src: { mail: 'Mail', calendar: 'Calendar', im: 'Chats (Feishu, iMessage, etc.)', cindy: 'Cindy chats (daily tidy-up only)', github: 'GitHub' },
      state: { ok: 'readable', missing: 'not installed', unauthorized: 'not connected', unavailable: 'not available', error: 'error', skipped: 'skipped' },
      sourcesHint: 'Uses installed plugins, command-line tools and data this Mac can read; sources it cannot read are skipped with the reason shown.',
      mac: 'macOS Contacts', macSync: 'Reconcile with macOS Contacts daily (no AI)', macSyncHint: 'Starts after your first import; read-only, never changes Mac Contacts.',
      profile: 'Contacts are mostly', colleagues: 'Colleagues and friends', clients: 'Many clients',
      profileHint: { colleagues: 'Tidies up once a day.', clients: 'Tidies up every 6 hours, groups clients by company and notes needs, quotes and follow-ups. Save the automation again to change its schedule.' },
      tasksNote: '“Tidy up now”, backfills and email drafts use the model and permission in Task settings below. Set the permission to Auto-review, or every step asks you to confirm.',
      failed: 'Not saved: ', noSchedule: 'This Cindy version cannot open Automations from plugins yet.',
    },
  };
  let T = STRINGS.en;
  let LOCALE = 'en';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, '0')).join(''));

  /* 与 main.js 通信：同主视图，按 id 重发直到收到回执。 */
  const channel = new BroadcastChannel('cindy-contacts');
  const pending = new Map();
  let lastWake = 0;
  const wake = async () => {
    if (Date.now() - lastWake < 20000) return;
    lastWake = Date.now();
    try {
      await fetch('/wake');
    } catch (_) {
      /* 重发兜底 */
    }
  };
  function rpc(method, params) {
    return new Promise((resolve, reject) => {
      const id = uid();
      const send = () => channel.postMessage({ kind: 'req', id, method, params: params || {} });
      const timer = setInterval(() => {
        wake();
        send();
      }, 800);
      pending.set(id, { resolve, reject, timer });
      wake().then(send);
    });
  }
  channel.onmessage = (ev) => {
    const m = ev.data;
    if (!m || m.kind !== 'res' || !pending.has(m.id)) {
      if (m && m.kind === 'event' && ['changed', 'sync'].includes(m.name)) load();
      return;
    }
    const p = pending.get(m.id);
    pending.delete(m.id);
    clearInterval(p.timer);
    if (m.ok) p.resolve(m.result);
    else p.reject(Object.assign(new Error(m.error?.message || 'failed'), { code: m.error?.code }));
  };

  const S = { meta: null, opened: false, error: '' };

  function when(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(LOCALE, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function render() {
    const m = S.meta;
    if (!m || !m.settings) {
      $('#root').innerHTML = `<p class="hint">${esc(T.loading)}</p>`;
      return;
    }
    const st = m.settings;
    const seg = (key, values, label) =>
      `<div class="seg">${values.map((v) => `<button type="button" data-set="${key}" data-value="${esc(v)}" aria-pressed="${st[key] === v}">${esc(label(v))}</button>`).join('')}</div>`;
    let h = '';
    h += `<div class="item"><div class="label">${esc(T.auto)}</div><div class="body">`;
    if (m.schedule) {
      h += `<button class="pill" type="button" id="openAuto">${esc(m.automationRequested ? T.autoAgain : T.autoBtn)}</button>`;
      h += `<p class="hint">${esc(S.opened ? T.autoOpened : T.autoHint)}</p>`;
      const last = m.maintenance && m.maintenance.lastRunAt;
      h += `<p class="status">${esc(last ? T.autoLast(when(last)) : T.autoNever)}</p>`;
      if (m.automationRequested) h += `<p class="hint">${esc(T.autoStop)}</p>`;
    } else {
      h += `<p class="hint">${esc(T.noSchedule)}</p>`;
    }
    h += '</div></div>';
    const ds = m.deviceSync;
    h += `<div class="item"><div class="label">${esc(T.sync)}</div><div class="body">`;
    if (ds?.supported) {
      h += `<div class="checks"><label><input type="checkbox" id="deviceSync"${ds.enabled ? ' checked' : ''}>${esc(T.syncEnable)}</label></div><p class="hint">${esc(T.syncHint)}</p>`;
      if (ds.enabled) {
        // 只说用户能看懂、需要知道的：真要用户处理的（合并冲突、版本、对方没开）单独说，其余插件自己重试，不把内部报错抛给用户。
        const p = ds.progress && ds.progress.total ? Math.floor((ds.progress.done / ds.progress.total) * 100) : null;
        const status = ds.phase === 'syncing' && p !== null ? T.syncProgress(p) : T.syncState[ds.phase] || T.syncState.waiting;
        const errText = !ds.error ? '' : ds.error.code === 'SYNC_MERGE_CONFLICT' ? T.syncConflict : ds.error.code === 'SYNC_VERSION' ? T.syncVersion : ds.error.code === 'SYNC_PEER_DISABLED' ? T.syncPeerOff : T.syncError;
        h += `<button class="pill" type="button" id="syncNow">${esc(T.syncNow)}</button><p class="status">${esc(status)}</p>${ds.lastAt ? `<p class="hint">${esc(T.syncLast(when(ds.lastAt)))}</p>` : ''}${errText ? `<p class="${errText === T.syncError ? 'hint' : 'err'}">${esc(errText)}</p>` : ''}`;
      }
    } else h += `<p class="hint">${esc(T.syncUnsupported)}</p>`;
    h += '</div></div>';
    h += `<div class="item"><div class="label">${esc(T.days)}</div><div class="body">${seg('initialDays', [7, 14, 30], T.daysOpt)}<p class="hint">${esc(T.daysHint)}</p></div></div>`;
    h += `<div class="item"><div class="label">${esc(T.sources)}</div><div class="body"><div class="checks">`;
    for (const k of ['mail', 'calendar', 'im', 'cindy', 'github']) {
      const seen = ((m.sourcesStatus && m.sourcesStatus.items) || []).find((x) => x.source === k);
      h += `<label><input type="checkbox" id="src-${k}" data-source="${k}"${st.sources && st.sources[k] ? ' checked' : ''}>${esc(T.src[k])}${seen && st.sources && st.sources[k] ? `<span class="st${['ok', 'unavailable', 'skipped'].includes(seen.status) ? '' : ' bad'}">${esc(T.state[seen.status] || seen.status)}</span>` : ''}</label>`;
    }
    h += `</div><p class="hint">${esc(T.sourcesHint)}</p></div></div>`;
    h += `<div class="item"><div class="label">${esc(T.mac)}</div><div class="body"><div class="checks"><label><input type="checkbox" id="macAutoSync"${st.macAutoSync ? ' checked' : ''}>${esc(T.macSync)}</label></div><p class="hint">${esc(T.macSyncHint)}</p></div></div>`;
    h += `<div class="item"><div class="label">${esc(T.profile)}</div><div class="body">${seg('profile', ['colleagues', 'clients'], (v) => T[v])}<p class="hint">${esc(T.profileHint[st.profile] || '')}</p></div></div>`;
    h += `<div class="item"><div class="label"></div><div class="body"><p class="hint">${esc(T.tasksNote)}</p>${S.error ? `<p class="err">${esc(S.error)}</p>` : ''}</div></div>`;
    $('#root').innerHTML = h;
  }

  async function load() {
    try {
      S.meta = await rpc('state');
      if (!S.meta.settings) setTimeout(load, 1000);
    } catch (e) {
      S.error = T.failed + e.message;
    }
    render();
  }

  async function save(patch) {
    S.error = '';
    try {
      S.meta.settings = await rpc('settings', patch);
    } catch (e) {
      S.error = T.failed + e.message;
    }
    render();
  }

  document.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'syncNow') {
      b.disabled = true;
      try { await rpc('deviceSync', {}); await load(); } catch (err) { S.error = T.failed + err.message; render(); }
      return;
    }
    if (b.id === 'openAuto') {
      b.disabled = true;
      try {
        S.meta.automationRequested = await rpc('requestAutomation');
        S.opened = true;
        S.error = '';
      } catch (err) {
        S.error = T.failed + err.message;
      }
      return render();
    }
    if (b.dataset.set) {
      const v = b.dataset.value;
      return save({ [b.dataset.set]: /^\d+$/.test(v) ? Number(v) : v });
    }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.source) save({ sources: { [t.dataset.source]: t.checked } });
    if (t.id === 'deviceSync') {
      rpc('deviceSync', { enabled: t.checked }).then(load).catch(err => { S.error = T.failed + err.message; render(); });
    }
    if (t.id === 'macAutoSync') save({ macAutoSync: t.checked });
  });

  (async () => {
    try {
      const ctx = await (await fetch('/app-context')).json();
      LOCALE = (ctx && ctx.context && ctx.context.locale) || 'en';
    } catch (_) {
      LOCALE = 'en';
    }
    T = STRINGS[LOCALE] || STRINGS.en;
    document.documentElement.lang = LOCALE;
    render();
    load();
  })();
})();
