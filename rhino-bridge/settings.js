const $=id=>document.getElementById(id),channel=new BroadcastChannel('rhino-bridge-settings');
const dictionaries=globalThis.RHINO_I18N||{},fallback=dictionaries.en||{};
let locale='en',config={},pending=null,timer,loaded=false;
const t=key=>(dictionaries[locale]||fallback)[key]||fallback[key]||key;
const show=text=>{$('status').textContent=text;};
const mode=cfg=>cfg.backend||(Object.prototype.hasOwnProperty.call(cfg,'port')?'legacy':'official');
function applyI18n(){document.documentElement.lang=locale;document.title=t('title');document.querySelectorAll('[data-i18n]').forEach(node=>{node.textContent=t(node.dataset.i18n);});document.querySelectorAll('[data-i18n-placeholder]').forEach(node=>{node.placeholder=t(node.dataset.i18nPlaceholder);});}
function toggle(){$('official').hidden=$('backend').value!=='official';$('legacy').hidden=$('backend').value!=='legacy';}
$('backend').addEventListener('change',toggle);
async function secretState(){const r=await fetch('/secrets');if(!r.ok)throw new Error(t('error.secretRead'));const list=await r.json();$('secret-state').textContent=list.some(x=>x.key==='rhino_token'&&x.saved)?t('secret.saved'):t('secret.missing');}
(async()=>{try{const ctx=await fetch('/app-context').then(r=>r.ok?r.json():null).catch(()=>null);if(ctx?.context?.locale&&dictionaries[ctx.context.locale])locale=ctx.context.locale;applyI18n();const r=await fetch('/kv');if(!r.ok)throw new Error(t('error.configRead'));config=await r.json();$('backend').value=mode(config);$('router').value=config.routerPath||'';$('version').value=config.rhinoVersion||'8';$('port').value=config.port??19986;toggle();loaded=true;await secretState();}catch(e){show(e.message);}})();
function current(){return{...config,backend:$('backend').value,routerPath:$('router').value.trim(),rhinoVersion:$('version').value,port:Number($('port').value)};}
$('config').addEventListener('submit',async event=>{
 event.preventDefault();if(!loaded)return show(t('error.configRead'));const next=current();let token=$('token').value.trim();
 if(next.backend==='official'&&!next.routerPath)return show(t('error.routerRequired'));
 if(next.backend==='legacy'&&(!Number.isInteger(next.port)||next.port<1024||next.port>65535))return show(t('error.port'));
 if(next.backend==='legacy'&&token&&!/^[a-f0-9]{64}$/.test(token))return show(t('error.token'));
 try{
  if(next.backend==='legacy'&&token){const r=await fetch('/secrets/rhino_token',{method:'PUT',body:JSON.stringify({value:token})});$('token').value='';token='';if(!r.ok)throw new Error(t('error.secretSave'));}
  const r=await fetch('/kv',{method:'PUT',body:JSON.stringify(next)});if(!r.ok)throw new Error(t('error.configSave'));config=next;show(t('state.saved'));await secretState();
 }catch(e){show(e.message);}finally{$('token').value='';token='';}
});
$('clear').addEventListener('click',async()=>{try{const r=await fetch('/secrets/rhino_token',{method:'DELETE'});if(!r.ok)throw new Error(t('error.secretClear'));$('token').value='';await secretState();show(t('state.cleared'));}catch(e){show(e.message);}});
$('check').addEventListener('click',()=>{
 if(!loaded||pending)return;
 const next=current();if(next.backend!==mode(config)||next.routerPath!==(config.routerPath||'')||next.rhinoVersion!==(config.rhinoVersion||'8')||next.port!==(config.port??19986)||$('token').value)return show(t('error.unsaved'));
 pending=String(Date.now());$('check').disabled=true;show(t('state.checking'));channel.postMessage({type:'check',id:pending});timer=setTimeout(()=>{pending=null;$('check').disabled=false;show(t('error.checkTimeout'));},115000);
});
channel.onmessage=({data})=>{if(data?.type!=='checked'||data.id!==pending)return;clearTimeout(timer);pending=null;$('check').disabled=false;const r=data.result;if(!r.ok)return show(r.message);
 if(r.backend==='official'){let slots='';for(const b of r.mcp?.content||[])if(b.type==='text')slots+=b.text;show('官方 Router 已连接：'+(r.server?.version||'未知版本')+'。实例信息：'+slots);}
 else show('已连接 Rhino '+r.rhino_version+(r.document?' · '+(r.document.name||'未命名模型')+' · '+r.document.units:'，请打开模型。'));
};
