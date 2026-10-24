'use strict';
// Shared by the task page and the management view: talks to the logic page over
// the plugin's own BroadcastChannel; only the actions main.js lists exist.
(function (root) {
  const channel = new BroadcastChannel('baguette-pages');
  const pending = new Map(), listeners = new Set();
  channel.onmessage = ({ data: m }) => {
    if (m?.type === 'ready') {
      const p = pending.get(m.id); if (!p?.send) return;
      clearInterval(p.retry); const send = p.send; p.send = null; send();
      return;
    }
    if (m?.type === 'response') {
      const p = pending.get(m.id); if (!p) return;
      pending.delete(m.id); clearTimeout(p.timer); clearInterval(p.retry); p.resolve(m.result);
      return;
    }
    for (const fn of listeners) fn(m);
  };
  // Probe until the on-demand logic page is listening, then send the operation
  // exactly once. A slow read must not start duplicate worker commands.
  async function rpc(action, params = {}, timeoutText = 'No response') {
    let wake;
    try { wake = await fetch('/wake', { signal: AbortSignal.timeout(15000) }); } catch { throw Object.assign(Error(timeoutText), { code: 'TIMEOUT' }); }
    if (!wake.ok) throw Object.assign(Error(timeoutText), { code: 'TIMEOUT' });
    const state = (await wake.json().catch(() => ({}))).state;
    if (state === 'off') throw Object.assign(Error('PLUGIN_OFF'), { code: 'PLUGIN_OFF' });
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const send = () => {
        const p = pending.get(id);
        clearTimeout(p.timer); p.timer = setTimeout(expire, timeout);
        channel.postMessage({ type: 'request', id, action, ...params });
      };
      const probe = () => channel.postMessage({ type: 'ping', id });
      const retry = setInterval(probe, 500);
      // Every worker call may use 120s, including reads that open a viewer or
      // inspect Xcode. These two compound actions each await two worker calls.
      const timeout = ['task_boot', 'task_create'].includes(action) ? 245000 : 125000;
      const expire = () => { clearInterval(retry); pending.delete(id); reject(Object.assign(Error(timeoutText), { code: 'TIMEOUT' })); };
      const timer = setTimeout(expire, timeout);
      pending.set(id, { resolve, timer, retry, send }); probe();
    });
  }
  function h(tag, attrs = {}, children = []) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(children)) if (c) n.append(c);
    return n;
  }
  async function locale() {
    try { const r = await (await fetch('/app-context')).json(); return r.context?.locale === 'zh-CN' ? 'zh-CN' : 'en'; } catch { return 'en'; }
  }
  const GLYPH = {
    iphone: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="7.5" y="3" width="9" height="18" rx="2.4"/><rect x="10.7" y="4.7" width="2.6" height=".9" rx=".45" fill="currentColor" stroke="none"/></svg>',
    ipad: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="1.9"/><circle cx="12" cy="4.7" r=".55" fill="currentColor" stroke="none"/></svg>',
    big: '<svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"><rect x="7.5" y="3" width="9" height="18" rx="2.4"/><rect x="10.7" y="4.7" width="2.6" height=".9" rx=".45" fill="currentColor" stroke="none"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M10 15V9"/><path d="M14 15V9"/></svg>',
    pencil: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/></svg>',
  };
  GLYPH.fold = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.2a1.8 1.8 0 0 1 2.2-1.75Q12 6.4 17.8 4.45A1.8 1.8 0 0 1 20 6.2v11.6a1.8 1.8 0 0 1-2.2 1.75Q12 17.6 6.2 19.55A1.8 1.8 0 0 1 4 17.8z"/></svg>';
  GLYPH.tv = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.75" y="4.5" width="18.5" height="12" rx="1.6"/><path d="M9 19.75h6"/></svg>';
  GLYPH.vision = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.75 10.2c0-2 1.6-3.2 3.6-3.2h9.3c2 0 3.6 1.2 3.6 3.2v1.7c0 2.4-1.7 4.1-3.8 4.1-1.5 0-2.3-.7-3.1-1.6-.4-.45-.8-.7-1.35-.7s-.95.25-1.35.7c-.8.9-1.6 1.6-3.1 1.6-2.1 0-3.8-1.7-3.8-4.1z"/></svg>';
  GLYPH.watch = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6.5" y="6" width="11" height="12.5" rx="3"/><path d="M8.5 6V3.5h7V6M8.5 18.5V21h7v-2.5"/><path d="M17.5 11h1"/></svg>';
  GLYPH.plus = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
  GLYPH.more = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>';
  GLYPH.search = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

  // ---- New device sheet (management view and task page) ----
  // Name · OS Version · Model, like Simulator's: models follow the OS chosen,
  // and the name follows the model until edited.
  const SHEET = {
    en: { any: 'New device', android:'New Android', setup:'Set up Android…', iphone: 'New iPhone', ipad: 'New iPad', tv: 'New Apple TV', vision: 'New Vision Pro', name: 'Name', os: 'OS Version', model: 'Model', create: 'Create', cancel: 'Cancel', creating: 'Creating…',
      loading: 'Loading models…', none: 'No matching runtime. Set up Android here, or install Apple runtimes in Xcode.', failed: 'Could not create the device. Check the environment and available disk space, then try again.', iosFailed: 'Not created. Check Xcode and try again.' },
    'zh-CN': { any: '新建设备', android:'新建安卓设备', setup:'安装安卓环境…', iphone: '新建 iPhone', ipad: '新建 iPad', tv: '新建 Apple TV', vision: '新建 Vision Pro', name: '名称', os: '系统版本', model: '机型', create: '创建', cancel: '取消', creating: '正在创建…',
      loading: '正在读取机型…', none: '没有匹配的系统。可在这里安装安卓环境，Apple 系统请通过 Xcode 安装。', failed: '没有创建成功，请检查运行环境和可用磁盘空间后重试。', iosFailed: '没有创建成功，请检查 Xcode 后重试。' },
  };
  let catalogCache = null;
  async function catalog() { if (!catalogCache) { const c = await rpc('catalog', {}); if (!c?.ok) throw c; catalogCache = c; } return catalogCache; }
  function createDevice({ family = 'any', lang = 'en' } = {}) {
    const T = SHEET[lang] || SHEET.en, M = root.CindySimModel;
    return new Promise((resolve) => {
      const nameInput = h('input', { maxlength: '64', autocomplete: 'off', spellcheck: 'false' });
      const osSelect = h('select'), modelSelect = h('select');
      const error = h('p', { class: 'sheet-error', role: 'alert' });
      const create = h('button', { class: 'btn cta', type: 'submit', text: T.create, disabled: true });
      const cancel = h('button', { class: 'btn quiet', type: 'button', text: T.cancel });
      const setup = h('button', {class:'btn quiet',type:'button',text:T.setup,hidden:true});
      const row = (label, control) => h('label', { class: 'sheet-row' }, [h('span', { text: label }), control]);
      const form = h('form', { class: 'sheet', method: 'dialog' }, [
        h('h2', { text: T[family] || T.iphone }),
        h('div', { class: 'sheet-group' }, [row(T.name, nameInput), row(T.os, osSelect), row(T.model, modelSelect)]),
        error, setup, h('div', { class: 'sheet-actions' }, [cancel, create])]);
      const dialog = h('dialog', { class: 'sheet-dialog' }, [form]);
      document.body.append(dialog); dialog.showModal();
      let cat = null, edited = false, done = false;
      const finish = (value) => { if (done) return; done = true; dialog.close(); dialog.remove(); resolve(value); };
      cancel.addEventListener('click', () => finish(null));
      dialog.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
      nameInput.addEventListener('input', () => { edited = true; });
      const models = () => (cat?.deviceTypes || []).filter((d) => family === 'any' || (family === 'android' ? M.platform(d) === 'android' : M.platform(d) !== 'android' && M.family(d) === family));
      function fillModels(keep) {
        const runtime = cat.runtimes.find((r) => r.identifier === osSelect.value);
        const usable = models().filter((d) => runtime && M.runtimesFor(cat, d.identifier).some((r) => r.identifier === runtime.identifier));
        const best = M.defaultChoice({ deviceTypes: usable, runtimes: runtime ? [runtime] : [] });
        modelSelect.replaceChildren(...usable.map((d) => h('option', { value: d.identifier, text: d.name })));
        modelSelect.value = usable.some((d) => d.identifier === keep) ? keep : (best?.deviceType || usable[0]?.identifier || '');
        syncName(); create.disabled = !modelSelect.value;
      }
      function syncName() { if (!edited) nameInput.value = modelSelect.selectedOptions[0]?.textContent || ''; }
      osSelect.addEventListener('change', () => fillModels(modelSelect.value));
      modelSelect.addEventListener('change', syncName);
      error.textContent = T.loading;
      function populate(c) {
        cat = c;
        setup.hidden=(family!=='android'&&family!=='any')||c.platforms?.android?.ready===true;
        const runtimes = c.runtimes.filter((r) => models().some((d) => M.runtimesFor(c, d.identifier).some((v) => v.identifier === r.identifier)))
          .sort((a, b) => String(b.version).localeCompare(String(a.version), undefined, { numeric: true }));
        if (!runtimes.length) { error.textContent = T.none; return; }
        error.textContent = '';
        osSelect.replaceChildren(...runtimes.map((r) => h('option', { value: r.identifier, text: r.name })));
        const best = M.defaultChoice({ deviceTypes: models(), runtimes });
        osSelect.value = best?.runtime || runtimes[0].identifier;
        fillModels(best?.deviceType);
        nameInput.focus(); nameInput.select();
      }
      function showError(e) {
        const selected = cat?.deviceTypes?.find(d => d.identifier === modelSelect.value);
        const apple = selected ? M.platform(selected) !== 'android' : family !== 'android' && family !== 'any';
        error.textContent = e?.message || (apple ? T.iosFailed : T.failed);
      }
      catalog().then(populate).catch(showError);
      setup.addEventListener('click',async()=>{try{if(await setupAndroid(lang)){catalogCache=null;populate(await catalog());}}catch(e){showError(e);}});
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const name = nameInput.value.trim(); if (!name || !modelSelect.value) return;
        create.disabled = true; create.textContent = T.creating; error.textContent = '';
        try {
          const r = await rpc('create', { name, deviceType: modelSelect.value, runtime: osSelect.value });
          if (!r?.ok) throw r;
          finish({ udid: r.udid, name: r.name || name });
        } catch (e) { showError(e); create.disabled = false; create.textContent = T.create; }
      });
    });
  }

  async function setupAndroid(lang='en') {
    const zh=lang==='zh-CN',T={title:zh?'安装安卓环境':'Set up Android',loading:zh?'正在查询可下载的组件…':'Checking available components…',install:zh?'下载并安装':'Download and install',close:zh?'关闭':'Close',accept:zh?'我已阅读并同意以下许可条款':'I have read and accept the licenses below',ready:zh?'安卓环境已就绪':'Android is ready',failed:zh?'安装没有完成。请检查网络和可用磁盘空间后重试。':'Setup did not finish. Check the connection and available disk space, then retry.'};
    return new Promise(resolve=>{
      let done=false,ready=false;
      const status=h('p',{class:'sheet-body',text:T.loading,role:'status'}),content=h('div'),button=h('button',{class:'btn cta',text:T.install,type:'button',disabled:true}),close=h('button',{class:'btn quiet',text:T.close,type:'button'});
      const dialog=h('dialog',{class:'sheet-dialog android-setup'},[h('div',{class:'sheet'},[h('h2',{text:T.title}),status,content,h('div',{class:'sheet-actions'},[close,button])])]);document.body.append(dialog);dialog.showModal();
      const finish=()=>{if(done)return;done=true;dialog.close();dialog.remove();catalogCache=null;resolve(ready);};close.onclick=finish;dialog.addEventListener('cancel',e=>{e.preventDefault();finish();});
      const size=n=>n>=1e9?(n/1e9).toFixed(2)+' GB':(n/1e6).toFixed(1)+' MB';
      async function track(job){
        button.hidden=true;
        const progress=h('progress',{max:1,value:0});content.replaceChildren(progress);
        while(!done){
          if(job.state==='done'){ready=true;status.textContent=T.ready;progress.value=1;return;}
          if(job.state==='failed')throw Error(job.message||T.failed);
          progress.value=job.total?job.bytes/job.total:0;
          status.textContent=job.phase==='extracting'?(zh?'正在安装组件…':'Installing components…'):`${job.package||'Android'} · ${Math.round(progress.value*100)}% · ${size(job.bytes||0)} / ${size(job.total||0)} · ${size(job.bytesPerSecond||0)}/s`;
          await new Promise(r=>setTimeout(r,800));if(done)return;job=await rpc('android_status');if(!job.ok)throw Error(T.failed);
        }
      }
      (async()=>{
        const current=await rpc('android_status');if(done)return;if(current.state==='running')return track(current);
        const plan=await rpc('android_plan');if(done)return;if(!plan.ok)throw Error(plan.message||T.failed);
        if(!plan.packages?.length){ready=true;status.textContent=T.ready;button.hidden=true;return;}
        status.textContent=zh?`将从 Google 下载 ${size(plan.bytes)}，安装到插件专属目录。请预留至少 ${size(Math.max(plan.bytes*4,10e9))} 磁盘空间。`:`Download ${size(plan.bytes)} from Google into the plugin’s own directory. Keep at least ${size(Math.max(plan.bytes*4,10e9))} of disk space free.`;
        for(const pkg of plan.packages)content.append(h('p',{class:'sheet-body',text:`${pkg.name} · ${size(pkg.size)}`}));
        for(const license of plan.licenses)content.append(h('details',{},[h('summary',{text:license.id}),h('pre',{class:'sdk-license',text:license.text})]));
        const accepted=h('input',{type:'checkbox'});content.append(h('label',{class:'sdk-consent'},[accepted,h('span',{text:T.accept})]));accepted.onchange=()=>{button.disabled=!accepted.checked;};
        button.onclick=async()=>{button.disabled=true;accepted.disabled=true;try{const job=await rpc('android_install',{planId:plan.id,acceptLicenses:accepted.checked});if(!job.ok)throw Error(job.message||T.failed);await track(job);}catch(e){status.textContent=e.message||T.failed;button.hidden=true;}};
      })().catch(e=>{status.textContent=e.message||T.failed;button.hidden=true;});
    });
  }
  root.CindySimPages = { rpc, h, locale, GLYPH, createDevice, catalog, setupAndroid, onPush: (fn) => listeners.add(fn) };
})(globalThis);
