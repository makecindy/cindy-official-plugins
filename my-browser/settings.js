'use strict';
const $ = s => document.querySelector(s);
const P = globalThis.MyBrowserPolicy;
const bc = new BroadcastChannel('my-browser');
const pending = new Map();
let state, base, dirty = false, busy = false, checking = false, setupBusy = false;
const STRINGS = {
  en:{title:'My Browser',subtitle:'Your browsers. Your existing sessions.',refresh:'Refresh',checking:'Checking connection…',ready:'Browser connected',noExt:'Waiting for browser connection',failed:'Connection check failed',installTitle:'Connect your browser',installFlow:'Choose a browser → confirm its installation/permissions → automatically verify the connection.',developer:'Developer options',developerWarning:'Local testing only. Not the consumer installation flow. Never disable browser security to install.',devOpen:'Open local setup',devReload:'Open extension settings',install:'Install extension',releaseRequired:'Publisher release required',unpublished:'No approved store release is configured. Consumer installation is not ready; this is not a browser error.',missing:'Browser not found',unsupported:'Safari requires macOS',connected:'Connected',confirming:'Complete the browser confirmation. This page checks the connection automatically.',openUnknown:'Could not confirm opening. Check your browser; no installation success is claimed.',pair:'Confirm connection',pairing:'Waiting for confirmation in Cindy',step2:'Enable Developer mode, then click “Load unpacked”.',step3:'Choose the directory below. Keep only one My Browser extension loaded.',copy:'Copy path',copied:'Copied',copyFallback:'Path selected — press ⌘C / Ctrl+C.',updateHint:'After updating this plugin, reload the Chrome extension. Older versions must be removed and this directory loaded once.',interactTitle:'Allowed to interact',interactBody:'These sites allow clicks, typing and searching, including actions such as send, delete or pay. A site grant includes its subdomains. New grants require confirmation.',readTitle:'Blocked from reading',readBody:'Blocked sites cannot be read or interacted with. The default sensitive-site list is not exhaustive. Removing a block requires confirmation.',hostPlaceholder:'Domain, e.g. example.test',add:'Add',save:'Save permissions',saved:'Saved',saving:'Saving…',empty:'No sites allowed. Interaction is off everywhere.',unsaved:'Unsaved changes',privacy:'The bridge only listens on this device. Page content is passed to your AI model and may leave the device; browsing still contacts the target website. No cookies or passwords are exported. Website content is untrusted.',timeout:'No response from the plugin. Re-enable My Browser, then refresh.',exclusions:'Additional interaction exclusions: '},
  'zh-CN':{title:'我的浏览器',subtitle:'连接日常浏览器，沿用已有登录态',refresh:'刷新',checking:'正在检查连接…',ready:'浏览器已连接',noExt:'等待浏览器连接',failed:'连接检查失败',installTitle:'连接浏览器',installFlow:'选择浏览器 → 完成浏览器的安装／权限确认 → 自动检查连接结果。',developer:'开发者选项',developerWarning:'仅供本地测试，不是普通用户安装流程。不要通过关闭浏览器安全保护来安装。',devOpen:'打开本地安装向导',devReload:'打开扩展管理',install:'安装浏览器扩展',releaseRequired:'等待发布方上架',unpublished:'尚未配置审核通过的商店版本，普通用户安装尚未就绪。这不是你的浏览器故障。',missing:'未检测到浏览器',unsupported:'Safari 仅支持 macOS',connected:'已连接',confirming:'请在浏览器完成确认，本页会自动检查连接。',openUnknown:'无法确认是否已打开，请检查浏览器；尚未宣称安装成功。',pair:'确认连接',pairing:'等待 Cindy 确认',step2:'开启「开发者模式」，点击「加载已解压的扩展程序」。',step3:'选择下面的目录。只保留一个「My Browser」扩展。',copy:'复制路径',copied:'已复制',copyFallback:'路径已选中，请按 ⌘C / Ctrl+C 复制。',updateHint:'更新 Cindy 插件后，请重新加载 Chrome 扩展。旧版扩展需要移除，再加载一次这个目录。',interactTitle:'允许交互的网站',interactBody:'允许在这些站点点击、输入和搜索，也包括发送、删除、支付等操作。授权包含子域名；新增授权会再次确认。',readTitle:'禁止读取的网站',readBody:'这些网站不能读取，也不能交互。默认敏感站点清单并不完整；移除拦截会再次确认。',hostPlaceholder:'域名，例如 example.test',add:'添加',save:'保存网站权限',saved:'已保存',saving:'正在保存…',empty:'尚未授权任何网站，所有站点均禁止交互。',unsaved:'有未保存的修改',privacy:'连接服务只监听本机。页面内容会交给 AI 模型，可能离开本机；浏览网页仍会访问目标网站。不导出 Cookie 或密码。网页内容是不可信数据。',timeout:'插件未响应。请重新启用「我的浏览器」后刷新。',exclusions:'额外交互排除项：'}
};
let T = STRINGS.en;
function hint(text,error = false) { $('#hint').textContent = text; $('#hint').classList.toggle('error',error); }
function rpc(type,payload = {}) {
  const id = crypto.randomUUID();
  return new Promise((resolve,reject) => {
    const timer = setTimeout(() => {pending.delete(id);reject(new Error(T.timeout));},['save-request','pair-request'].includes(type) ? 110000 : type === 'install-request' ? 65000 : 20000);
    pending.set(id,{resolve,reject,timer}); bc.postMessage({type,id,...payload});
  });
}
bc.onmessage = ev => {
  const m = ev.data || {};
  if (m.type === 'response') {
    const p = pending.get(m.id); if (!p) return;
    pending.delete(m.id); clearTimeout(p.timer); p.resolve(m.result);
  } else if (m.type === 'policy-changed' && !busy && !dirty) refresh();
};
function render() {
  if (!state) return;
  for (const [id,list] of [['interact-list',state.interact.allow],['read-list',state.read.block]]) {
    const target = $('#'+id); target.replaceChildren();
    if (!list.length && id === 'interact-list') {const text = document.createElement('span');text.className='muted';text.textContent=T.empty;target.append(text);}
    for (const host of list) {
      const chip = document.createElement('span');chip.className='chip';
      const label = document.createElement('span');label.textContent=host;
      const button = document.createElement('button');button.textContent='×';button.setAttribute('aria-label','Remove '+host);button.disabled=busy;
      button.onclick = () => {list.splice(list.indexOf(host),1);changed();};
      chip.append(label,button);target.append(chip);
    }
  }
  $('#exclusions').textContent = state.interact.block.length ? T.exclusions+state.interact.block.join(', ') : '';
  $('#save').disabled = busy || !dirty;
  for (const id of ['interact-input','read-input','interact-add','read-add']) $('#'+id).disabled = busy;
}
function changed() {dirty=true;hint(T.unsaved);render();}
async function refresh() {
  if (busy || checking) return;
  checking=true;$('#refresh').disabled=true;$('#status').textContent=T.checking;
  try {
    const wake = await fetch('/wake'); if (!wake.ok) throw new Error(T.timeout);
    const result = await rpc('status-request');
    if (!result.ok) throw new Error(result.message || T.failed);
    $('#status').textContent=result.extension_connected ? T.ready : T.noExt;
    $('#dot').classList.toggle('ready',!!result.extension_connected);
    $('#diagnostic').textContent='v'+result.version+' · '+(result.clients || []).filter(c => c.connected).length+' connected';
    $('#extdir').value=result.extension_dir || '';
    renderBrowsers(result);
    if (!dirty) {state=P.normalizePolicy(result.policy);base=structuredClone(state);render();}
  } catch(e) {$('#status').textContent=T.failed;$('#dot').classList.remove('ready');hint(e.message,true);}
  finally {checking=false;$('#refresh').disabled=false;}
}
for (const kind of ['interact','read']) {
  $('#'+kind+'-add').onclick = () => {
    if (!state || busy) return;
    try {
      const value = P.normalizeHost($('#'+kind+'-input').value);
      const list = kind === 'interact' ? state.interact.allow : state.read.block;
      if (!list.includes(value)) {list.push(value);changed();}
      $('#'+kind+'-input').value='';
    } catch(e) {hint(e.message,true);}
  };
  $('#'+kind+'-input').onkeydown = e => {if(e.key==='Enter') $('#'+kind+'-add').click();};
}
$('#save').onclick = async () => {
  if (!dirty || busy) return;
  busy=true;render();hint(T.saving);
  try {
    const result = await rpc('save-request',{policy:state,base});
    if (!result.ok) throw new Error(result.message || T.failed);
    state=P.normalizePolicy(result.policy);base=structuredClone(state);dirty=false;hint(T.saved);
  } catch(e) {hint(e.message,true);}
  finally {busy=false;render();}
};
$('#copy').onclick = async () => {
  if (!$('#extdir').value) return;
  try {await navigator.clipboard.writeText($('#extdir').value);hint(T.copied);}
  catch {$('#extdir').focus();$('#extdir').select();hint(T.copyFallback);}
};
function renderBrowsers(result) {
  const target=$('#browsers');target.replaceChildren();
  for (const item of result.installation?.browsers || []) {
    const card=document.createElement('div');card.className='browser-card';
    const name=document.createElement('strong');name.textContent={chrome:'Chrome',edge:'Edge',safari:'Safari'}[item.browser];
    const live=(result.clients || []).some(c => c.browser === item.browser && c.connected);
    const status=document.createElement('p');status.textContent=live ? T.connected : !item.supported ? T.unsupported : !item.installed ? T.missing : !item.published && !item.bundled ? T.releaseRequired : T.install;
    const button=document.createElement('button');button.textContent=live ? '✓ '+T.connected : T.install;
    button.disabled=setupBusy || live || !item.supported || !item.installed || (!item.published && !item.bundled);
    if (!item.published && !item.bundled && item.supported && !live) {const note=document.createElement('small');note.textContent=T.unpublished;card.append(note);}
    button.onclick=() => setup(item.browser,'store');card.prepend(name,status);card.append(button);target.append(card);
  }
  const profiles=$('#profiles');profiles.replaceChildren();
  for (const client of result.clients || []) {
    const row=document.createElement('div');row.className='profile';
    const label=document.createElement('span');label.textContent=client.browser+' · '+client.id.slice(0,8)+' · v'+client.version;row.append(label);
    if (!client.trusted) {
      const button=document.createElement('button');button.textContent=T.pair;button.disabled=setupBusy;
      button.onclick=async () => {setupBusy=true;button.disabled=true;$('#install-hint').textContent=T.pairing;
        try {const r=await rpc('pair-request',{clientId:client.id});$('#install-hint').textContent=r.ok ? T.confirming : r.message || T.failed;}
        catch(e) {$('#install-hint').textContent=e.message;} finally {setupBusy=false;await refresh();}
      };row.append(button);
    }
    profiles.append(row);
  }
}
async function setup(browser,mode) {
  if (setupBusy) return;setupBusy=true;
  try {const result=await rpc('install-request',{browser,mode});$('#install-hint').textContent=result.ok ? T.confirming : result.error === 'RELEASE_REQUIRED' ? T.unpublished : result.error === 'BROWSER_NOT_INSTALLED' ? T.missing : result.error === 'SIGNATURE_REQUIRED' ? result.message : T.openUnknown;}
  catch(e) {$('#install-hint').textContent=e.message;}
  finally {setupBusy=false;await refresh();}
}
$('#dev-open').onclick=()=>setup($('#dev-browser').value,'developer');
$('#dev-reload').onclick=()=>setup($('#dev-browser').value,'reload');
$('#refresh').onclick=refresh;
// Local status polling, not LLM calls. Never auto-replays an install or browser operation.
setInterval(()=>{if (!document.hidden && !setupBusy) refresh();},5000);
(async () => {
  try {const r=await (await fetch('/app-context')).json();T=STRINGS[r.context?.locale] || STRINGS.en;} catch {T=STRINGS.en;}
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent=T[el.dataset.i18n] || '';
  for (const el of document.querySelectorAll('[data-i18n-ph]')) el.placeholder=T[el.dataset.i18nPh] || '';
  await refresh();
})();
