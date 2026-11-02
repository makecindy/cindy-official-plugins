'use strict';
const text = {
  en:{allow:'Allow simulators to run',allowHint:'Off shuts down every device and keeps AI from starting one.',idle:'Stop automatically when idle',idleHint:'Not stopped while a viewer is open or a tool or script is using the device. Apps quit; data is kept.',m15:'After 15 minutes',m30:'After 30 minutes',m60:'After 1 hour',manual:'Only manually',
    devices:'Devices',add:'Add device',stopAll:'Stop all',refresh:'Refresh',boot:'Start',shutdown:'Stop',viewer:'Open',booted:'Running',off:'Off',busyState:'Working…',
    emptyTitle:'No simulators yet',emptyBody:'Create a device to run iOS and Android apps here.',createFirst:'Create a device',creating:'Creating…',created:'Device created. Start it when you need it.',
    orCustom:'Need another model? Ask Cindy to create it.',needXcode:'Needs full Xcode with an iOS runtime installed before a device can be created.',
    moreTitle:'What the live view can do',moreViewer:'Both platforms share touch, keyboard, rotation, shake and screenshots. Android adds Back. iOS advanced tools also offer location, motion, remote notification injection (may trigger app behavior), network, camera and recording; map search contacts OpenStreetMap. Use tools for Android state and logs. Copy/paste replaces the clipboard. Switching only selects a device. Devices and Apps keep running; nothing starts or transfers automatically. Start a stopped device explicitly.',
    moreStop:'Stop devices here before disabling the plugin. Closing the live view does not stop a device.',
    checking:'Checking devices…',paused:'Starting simulators is disabled. AI cannot start a device.',running:(n)=>`${n} running`,stopped:'All devices are off.',working:'Working…',saved:'Saved.',failed:'Could not confirm. Refresh to see the actual state.',busy:'Another operation is running. Try again in a moment.',disabled:'Simulators are off. Turn them on above first.',timeout:'No response from the simulator service. Reopen this page.',partial:'Shutdown is not fully confirmed. Refresh the device status before continuing.',settingsUnreadable:'Settings cannot be read. Starting is blocked; stopping still works. Restore the settings file and refresh.',readFailed:'Could not read device status.',shutdownDone:'Device stopped.',previewNeedsSession:'Open a conversation first, then open the live view from there. Stopping still works here.',previewFailed:'The live view did not open. Refresh and try again.'},
  'zh-CN':{allow:'允许运行模拟器',allowHint:'关闭后会关掉所有设备，AI 也不能再启动。',idle:'闲置后自动关闭',idleHint:'画面开着、或有工具和脚本在操作时不会关闭。关闭时 App 退出，数据保留。',m15:'15 分钟后',m30:'30 分钟后',m60:'1 小时后',manual:'仅手动',
    devices:'设备',add:'添加设备',stopAll:'全部关闭',refresh:'刷新',boot:'启动',shutdown:'关闭',viewer:'打开画面',booted:'运行中',off:'已关闭',busyState:'处理中…',
    emptyTitle:'还没有模拟器',emptyBody:'创建一台，就能在这里运行和测试 iOS 和安卓 App。',createFirst:'创建设备',creating:'正在创建…',created:'已创建。需要时再启动它。',
    orCustom:'想要别的机型？直接让 Cindy 创建。',needXcode:'需要先安装完整的 Xcode 和一个 iOS 运行时，才能创建设备。',
    moreTitle:'画面里可以做什么',moreViewer:'两端共用触摸、输入、旋转、摇一摇和截图，安卓另有返回。iOS 高级面板还提供定位、运动、注入远程通知（可能触发 App 行为）、网络、摄像头和录屏，地图访问 OpenStreetMap；安卓状态和日志使用工具。复制粘贴会替换剪贴板。切换只选择设备，原设备与 App 继续运行，不自动启动或搬运 App；已关闭的设备需要手动启动。',
    moreStop:'停用插件前先在这里关闭设备。关闭画面不会关闭设备。',
    checking:'正在检查设备…',paused:'已禁止启动模拟器，AI 无法启动设备。',running:(n)=>`${n} 台运行中`,stopped:'所有设备已关闭。',working:'正在处理…',saved:'已保存。',failed:'没能确认结果，请刷新查看实际状态。',busy:'有其他操作正在进行，稍后再试。',disabled:'模拟器已关闭，请先打开上方开关。',timeout:'模拟器服务没有响应，请重新打开本页。',partial:'关机尚未全部确认，请刷新设备状态后再继续。',settingsUnreadable:'无法读取设置：暂时不能启动，仍可关闭设备。恢复设置文件后刷新。',readFailed:'没能读取设备状态。',shutdownDone:'设备已关闭。',previewNeedsSession:'先打开一个对话，再从对话里打开画面；这里仍可关闭设备。',previewFailed:'画面没有打开，请刷新后重试。'}
};
const M=globalThis.CindySimModel;
let T=text.en,state=null,busy=false,reading=false,readFailed=false,catalog=null;
const $=id=>document.getElementById(id), channel=new BroadcastChannel('baguette-settings'), pending=new Map();
const GLYPH={iphone:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="20" x="5" y="2" rx="2.5"/><path d="M12 18h.01"/></svg>',ipad:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="20" x="4" y="2" rx="2"/><path d="M12 18h.01"/></svg>',empty:'<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="20" x="5" y="2" rx="2.5"/><path d="M12 18h.01"/></svg>'};
function message(value,error=false){$('message').textContent=value;$('message').classList.toggle('error',error);}
async function rpc(action,params={}){
  // Logic pages start on demand; opening settings alone does not start one.
  const wake=await fetch('/wake',{signal:AbortSignal.timeout(15000)});
  if(!wake.ok)throw Error(T.timeout);
  const id=crypto.randomUUID();
  return new Promise((resolve,reject)=>{
    const send=()=>{const p=pending.get(id);clearTimeout(p.timer);p.timer=setTimeout(expire,125000);channel.postMessage({type:'request',id,action,...params});};
    // Only repeat the readiness probe; dispatch every operation once.
    const probe=()=>channel.postMessage({type:'ping',id});
    const retry=setInterval(probe,500);
    const expire=()=>{clearInterval(retry);pending.delete(id);reject(Error(T.timeout));};
    const timer=setTimeout(expire,125000);
    pending.set(id,{resolve,timer,retry,send});probe();
  });
}
channel.onmessage=({data:m})=>{
  const p=pending.get(m?.id);if(!p)return;
  if(m.type==='ready'){if(!p.send)return;clearInterval(p.retry);const send=p.send;p.send=null;send();return;}
  if(m.type!=='response')return;pending.delete(m.id);clearTimeout(p.timer);clearInterval(p.retry);p.resolve(m.result);
};
function errorText(r){return ({BUSY:T.busy,RUNTIME_DISABLED:T.disabled,STOP_INCOMPLETE:T.partial,PREVIEW_FAILED:T.previewFailed,PREVIEW_NEEDS_SESSION:T.previewNeedsSession})[r?.errorCode]||T.failed;}
function h(tag,attrs={},children=[]){const n=document.createElement(tag);for(const [k,v] of Object.entries(attrs)){if(v==null||v===false)continue;if(k==='class')n.className=v;else if(k==='text')n.textContent=v;else if(k==='html')n.innerHTML=v;else if(k.startsWith('on'))n.addEventListener(k.slice(2),v);else n.setAttribute(k,v===true?'':v);}for(const c of [].concat(children))if(c)n.append(c);return n;}
function render(){
  if(!state)return;
  const locked=busy||reading,enabled=state.settings.enabled&&!state.settingsError;
  if(!busy){$('enabled').checked=state.settings.enabled;$('idle').value=String(state.settings.idleMinutes);}
  $('enabled').disabled=locked||!!state.settingsError;$('idle').disabled=locked||!!state.settingsError;
  const running=state.devices.filter(d=>d.state!=='Shutdown').length;
  $('stop-all').hidden=!running;$('stop-all').disabled=locked;
  $('add').hidden=!state.devices.length;$('add').disabled=locked||!enabled;
  const list=$('devices');list.replaceChildren();
  if(!state.devices.length){
    list.append(h('div',{class:'empty'},[h('div',{class:'glyph',html:GLYPH.empty}),h('h4',{text:T.emptyTitle}),h('p',{text:T.emptyBody}),
      h('button',{class:'btn cta',text:T.createFirst,disabled:locked||!enabled,onclick:()=>createDefault()}),h('p',{class:'sub',text:T.orCustom})]));
  }
  for(const device of M.deviceRows(state.devices,null,document.documentElement.lang)){
    const raw=state.devices.find(d=>d.udid===device.udid);
    const actions=raw.state==='Shutdown'?['boot']:raw.state==='Booted'?['viewer','shutdown']:['shutdown'];
    list.append(h('div',{class:'device'},[
      h('span',{class:'glyph',html:GLYPH[device.family]}),
      h('div',{class:'text'},[h('div',{class:'name',text:device.name}),h('div',{class:'meta'},[h('span',{class:'dot','data-tone':device.tone}),h('span',{text:device.meta})]),raw.state==='Shutdown'?globalThis.CindySimPages.memoryPicker(raw,document.documentElement.lang,locked):globalThis.CindySimPages.memoryBadge(raw,document.documentElement.lang,locked),globalThis.CindySimPages.resourceLabel(raw,document.documentElement.lang)]),
      h('div',{class:'actions'},actions.map(action=>h('button',{class:'btn sm'+(action==='shutdown'?' danger':action==='viewer'?'':' quiet'),text:T[action],disabled:locked||(action!=='shutdown'&&!enabled),onclick:()=>perform(action,{udid:device.udid})}))),
    ]));
  }
  const banner=state.settingsError?T.settingsUnreadable:!state.settings.enabled?T.paused:null;
  if(banner)message(banner,!!state.settingsError);else if(!readFailed&&!busy&&$('message').textContent&&[T.paused,T.settingsUnreadable].includes($('message').textContent))message('');
}
async function refresh(){
  if(reading||busy)return;reading=true;$('refresh').disabled=true;render();
  try{const result=await rpc('status');if(!result.ok)throw Error(errorText(result));state=result;if(readFailed||$('message').textContent===T.checking)message('');readFailed=false;render();}
  catch(e){readFailed=true;state=null;$('enabled').disabled=$('idle').disabled=true;$('stop-all').hidden=$('add').hidden=true;$('devices').replaceChildren();message(e.message||T.readFailed,true);}
  finally{reading=false;$('refresh').disabled=false;render();}
}
async function perform(action,params={}){
  if(busy)return;busy=true;render();message(T.working);
  if(action==='boot')params={...params,...globalThis.CindySimPages.memoryArgs(state?.devices?.find(d=>d.udid===params.udid))};
  try{const result=await rpc(action,params);if(result.settings&&result.devices)state=result;if(!result.ok)throw Error(errorText(result));if(action==='boot')M.showMemoryNotice(result,document.documentElement.lang,params.memoryMode,state?.devices?.find(d=>d.udid===params.udid)?.name);message(action==='shutdown'||action==='stopAll'?T.shutdownDone:action==='create'?T.created:T.saved);}
  catch(e){message(e.message,true);}
  finally{busy=false;await refresh();render();}
}
async function createDefault(){
  if(busy)return;busy=true;render();message(T.creating);
  try{
    const result=await globalThis.CindySimPages.createDevice({lang:document.documentElement.lang});
    message(result?T.created:'');
  }catch(e){message(e.message,true);}
  finally{busy=false;await refresh();render();}
}
$('enabled').onchange=()=>perform('save',{enabled:$('enabled').checked,idleMinutes:Number($('idle').value)});
$('idle').onchange=()=>perform('save',{enabled:$('enabled').checked,idleMinutes:Number($('idle').value)});
$('stop-all').onclick=()=>perform('stopAll');$('refresh').onclick=refresh;$('add').onclick=createDefault;
$('android-setup').onclick=()=>globalThis.CindySimPages.setupAndroid(document.documentElement.lang);
(async()=>{
  try{const r=await(await fetch('/app-context')).json();T=text[r.context?.locale]||text.en;}catch{}
  document.documentElement.lang=T===text['zh-CN']?'zh-CN':'en';
  $('android-setup').textContent=T===text['zh-CN']?'安装安卓环境…':'Set up Android…';
  for(const el of document.querySelectorAll('[data-i18n]'))el.textContent=T[el.dataset.i18n];
  message(T.checking);await refresh();
  setInterval(()=>{if(!document.hidden)refresh();},10000);
})();
