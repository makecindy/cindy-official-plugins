'use strict';
(async () => {
  const $ = id => document.getElementById(id);
  let strings = {}, entries = [], selected = 'global', config = {}, busy = false, loaded = false;
  let initialized=false;
  const clouds = {global:{key:'outlook_global',port:53687,portal:'https://portal.azure.com'},china:{key:'outlook_china',port:53688,portal:'https://portal.azure.cn'}};
  const t = key => strings[key] || key;
  async function request(path, init) {
    const r = await fetch(path, init?.body ? {...init,headers:{'Content-Type':'application/json'}} : init);
    if (!r.ok) throw new Error(t('requestFailed')+' (HTTP '+r.status+')');
    return r.status === 204 ? null : r.json();
  }
  async function locale() {
    let lang = 'en';
    try { const c = await request('/app-context'); if (['en','zh-CN','ja','ko'].includes(c?.context?.locale)) lang = c.context.locale; } catch (_) { /* English fallback */ }
    try { strings = await request('/ui/'+lang+'.json'); }
    catch (_) { lang = 'en'; strings = await request('/ui/en.json'); }
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  }
  function status(message) { $('status').textContent = message; }
  function errorText(r) {
    const code = typeof r?.error === 'string' ? r.error : '';
    return t(code) === code ? t('connectFailed') : t(code);
  }
  function addButton(row,label,fn) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.disabled = busy;
    b.onclick = () => void perform(fn); row.appendChild(b);
  }
  function render() {
    const c = clouds[selected], e = entries.find(e => e.key === c.key);
    $('cloud').value = selected;
    $('cloud').disabled = busy;
    $('redirect').textContent = 'http://127.0.0.1:'+c.port+'/callback';
    $('portal').href = c.portal;
    $('default-label').textContent = t('defaultService')+': '+t(config.default_cloud === 'china' ? 'china' : 'global');
    $('setup-note').textContent = !loaded ? t('loadFailed') : e?.clientConfigured ? t(e.clientCustom ? 'customReady' : 'builtInReady') : t('appMissing');
    $('advanced').open = loaded && !e?.clientConfigured;
    for (const id of ['default-cloud','save-client','reset-client','client-id']) $(id).disabled = busy || !loaded;
    $('connect').disabled = busy || !loaded || !e?.clientConfigured;
    $('reset-client').disabled = busy || !e?.clientCustom;
    $('accounts').textContent = '';
    if (!loaded) return;
    // Account controls bind to the row's cloud, independently of the service
    // selected for the next sign-in. Both groups remain visible and connected.
    for (const [cloud,cfg] of Object.entries(clouds)) {
      const groupEntry = entries.find(entry => entry.key === cfg.key);
      const group = document.createElement('section');
      group.className='account-group'; group.dataset.cloud=cloud;
      const heading=document.createElement('h2');heading.textContent=t(cloud);
      group.appendChild(heading);
      if (!groupEntry?.accounts?.length) {
        const note=document.createElement('p');note.className='hint';note.textContent=t('noAccounts');group.appendChild(note);
      }
      for (const a of groupEntry?.accounts || []) {
        const row=document.createElement('div');row.className='account';row.dataset.accountId=a.id;
        const name=document.createElement('span');name.className='identity';name.textContent=a.label || a.id;
        const tag=document.createElement('span');tag.className='tag';
        const labels=[a.isDefault ? t('defaultAccount') : '',a.status !== 'connected' ? t('expired') : a.scopeStale ? t('scopeStale') : t('connected')];
        tag.textContent=labels.filter(Boolean).join(' · ');name.appendChild(tag);row.appendChild(name);
        if (a.status !== 'connected' || a.scopeStale) addButton(row,t('reconnect'),()=>connect(cloud));
        if (!a.isDefault && a.status === 'connected') addButton(row,t('setDefault'),async()=>{
          await request('/oauth/'+cfg.key+'/default',{method:'POST',body:JSON.stringify({accountId:a.id})});status(t('saved'));
        });
        addButton(row,t('disconnect'),async()=>{
          await request('/oauth/'+cfg.key+'/accounts/'+encodeURIComponent(a.id),{method:'DELETE'});status(t('disconnected'));
        });
        group.appendChild(row);
      }
      $('accounts').appendChild(group);
    }
  }

  async function load() {
    try {
      const values = await Promise.all([request('/oauth'),request('/kv')]);
      if (!Array.isArray(values[0])) throw new Error(t('loadFailed'));
      entries=values[0]; config=values[1] || {};
      if(!initialized){selected=config.default_cloud==='china'?'china':'global';initialized=true;}
      loaded=true;
    } catch (_) { loaded=false; entries=[]; status(t('loadFailed')); }
    render();
  }
  async function perform(fn) {
    if (busy) return;
    busy=true; render();
    try { await fn(); } catch (e) { status(e.message || t('requestFailed')); }
    finally { await load(); busy=false; render(); }
  }
  async function connect(cloud = selected) {
    status(t('connecting'));
    const r = await request('/oauth/'+clouds[cloud].key+'/connect',{method:'POST'});
    if (!r.ok) { status(errorText(r)); return; }
    status(t('connected')+': '+(r.account?.label || ''));
  }
  $('cloud').onchange = () => { selected=$('cloud').value; $('client-id').value=''; status('');void perform(async()=>{}); };
  $('connect').onclick = () => void perform(connect);
  $('default-cloud').onclick = () => void perform(async () => {
    // Read-modify-write: preserve future unrelated preferences.
    const current = await request('/kv');
    await request('/kv',{method:'PUT',body:JSON.stringify({...current,default_cloud:selected})}); status(t('saved'));
  });
  $('save-client').onclick = () => void perform(async () => {
    const clientId=$('client-id').value.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) throw new Error(t('invalidClient'));
    await request('/oauth/'+clouds[selected].key+'/client',{method:'PUT',body:JSON.stringify({clientId})});
    $('client-id').value=''; status(t('clientSaved'));
  });
  $('reset-client').onclick = () => void perform(async () => {
    await request('/oauth/'+clouds[selected].key+'/client',{method:'DELETE'}); $('client-id').value=''; status(t('clientCleared'));
  });
  await locale(); await load();
  render();
})();
