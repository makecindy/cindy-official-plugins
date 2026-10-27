'use strict';
(() => {
  if(globalThis.__cindyReading)return;
  const api=globalThis.browser||globalThis.chrome,L=globalThis.CindyLearning,U=globalThis.CindyUI;
  if(!api?.runtime?.id)return;
  const brandURL=api.runtime.getURL('icons/48.png'),lifecycle=new AbortController();
  globalThis.__cindyReading=true;
  let disposed=false,navigationTimer;
  function runtimeReady(){if(disposed)return false;if(!api?.runtime?.id||typeof api.runtime.sendMessage!=='function'){dispose();return false;}return true;}
  async function extensionCall(fn){
    // Defer even synchronous API access so callers can catch invalid contexts.
    await Promise.resolve();
    if(!runtimeReady())throw Error('REQUEST_CANCELLED');
    try{const result=await fn();if(!runtimeReady())throw Error('REQUEST_CANCELLED');return result;}
    catch(e){if(!api?.runtime?.id||/extension context invalidated/i.test(e?.message||'')){dispose();throw Error('REQUEST_CANCELLED');}throw e;}
  }
  const sendMessage=message=>extensionCall(()=>api.runtime.sendMessage(message));
  function dispose(){
    if(disposed)return;disposed=true;panelEpoch++;generation++;lifecycle.abort();clearInterval(navigationTimer);
    requests.clear();progressHandlers.clear();stopPage();stopVideo();
    for(const rec of translations.values())rec.host.remove();translations.clear();
    for(const entry of document.querySelectorAll('[data-cindy-player-entry]'))entry.remove();
    selectionButton?.remove();selectionButton=null;host?.remove();host=null;shadow=null;footer=null;status=null;
    try{api?.runtime?.onMessage?.removeListener(onRuntimeMessage);api?.storage?.onChanged?.removeListener(onPreferencesChanged);}catch{}
  }
  let subtitleCacheSupported=false,expandedLanguages=false,prefs={videoTarget:'zh-CN',videoMode:'both',videoSize:'medium',autoVideo:true,bufferPause:false,captionTheme:'dark',autoSites:{}},selectionPoint=null,configuring=null,subtitleSegmentation=false,subtitleEditorial=false,locale='en',t=U.copy(locale),target='zh-CN',host,shadow,body,status,footer,cancelButton,selected='',selectedContext='',lastResult='',taskKey='',taskPayload='',generation=0,translated=false;
  let cueMedia,cueMediaSource='',video,cues=[],activeCue=-1,repeat=false,autoPause=false,previousCue=-1,videoHandler,videoSession,videoTimer;
  const progressHandlers=new Map(),requests=new Set(),translations=new Map();let observer,translateRunning=null;
  function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
  function button(text,fn,cls=''){const b=el('button',text,cls);b.type='button';b.addEventListener('click',e=>{if(e.isTrusted&&runtimeReady())Promise.resolve().then(fn).catch(report);});return b;}
  function report(e){if(disposed)return;const code=e?.message||e,message=code==='TIMEOUT'&&videoSession&&!cues.some(c=>c.translation)?U.subtitleStatusCopy(locale).emptyTimeout:U.error(code,locale,e?.reason),detail=U.errorDetail(code,e?.reason);videoSession?.overlay?.notify(message,true,detail);if(status){status.textContent=message;status.title=detail;status.className='status error';updateFooter();}}
  function note(text){if(disposed)return;const failed=videoSession?.chunks?.find(c=>c.error);videoSession?.overlay?.notify(failed?U.error(failed.error,locale):text,!!failed);if(!status)return;status.textContent=text;status.className='status';updateFooter();}
  function updateFooter(){if(!footer)return;cancelButton.hidden=!requests.size;footer.hidden=!requests.size&&!status.textContent;}
  function pageTheme(){for(const node of [document.body,document.documentElement]){if(!node)continue;const c=getComputedStyle(node).backgroundColor.match(/[\d.]+/g)?.map(Number);if(c&&c.length>=3&&(c.length===3||c[3]>=0.5))return (c[0]*.2126+c[1]*.7152+c[2]*.0722)<128?'dark':'light';}return getComputedStyle(document.documentElement).colorScheme==='dark'?'dark':'light';}
  function isolateHost(node,layout){node.style.setProperty('all','initial','important');for(const [key,value]of Object.entries(layout))node.style.setProperty(key,value,'important');}
  function captionIcon(active){const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');const box=document.createElementNS(ns,'rect');box.setAttribute('x','2.5');box.setAttribute('y','5.5');box.setAttribute('width','19');box.setAttribute('height','13');box.setAttribute('rx','3');box.setAttribute('fill',active?'currentColor':'none');box.setAttribute('stroke','currentColor');box.setAttribute('stroke-width','1.7');const text=document.createElementNS(ns,'text');text.setAttribute('x','12');text.setAttribute('y','15.6');text.setAttribute('text-anchor','middle');text.setAttribute('font-size',locale==='zh-CN'?'9.5':'8');text.setAttribute('font-weight','700');text.setAttribute('font-family','Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif');text.setAttribute('fill',active?'#111':'currentColor');text.textContent=locale==='zh-CN'?'译':'CC';svg.append(box,text);return svg;}
  function iconButton(label,path,fn){const b=button('',fn,'quiet icon');b.setAttribute('aria-label',label);b.title=label;const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');const shape=document.createElementNS(svg.namespaceURI,'path');shape.setAttribute('d',path);svg.append(shape);b.append(svg);return b;}
  function source(){return {url:location.href,title:document.title.slice(0,500),...(video?{time:video.currentTime}:{})};}
  async function request(req,onProgress){
    const id=L.uuid(),url=location.href;requests.add(id);if(onProgress)progressHandlers.set(id,onProgress);updateFooter();
    try{const r=await sendMessage({type:'cindy-learning',id,request:{...(!['config','preferences'].includes(req.op)?{target}:{}),...req,source:req.source||source()}});if(location.href!==url)throw Error('PAGE_CHANGED');if(!r?.ok)throw Object.assign(Error(r?.error||'MODEL_UNAVAILABLE'),{stage:r?.stage,reason:r?.reason});return r;}
    finally{requests.delete(id);progressHandlers.delete(id);updateFooter();}
  }
  function cancel(){generation++;for(const id of requests)sendMessage({type:'cindy-cancel',id}).catch(()=>{});requests.clear();progressHandlers.clear();updateFooter();}
  function speak(text,language){speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang=language||target;u.rate=0.9;speechSynthesis.speak(u);}
  async function configure(){
    if(configuring)return configuring;
    configuring=(async()=>{const r=await request({op:'config'});subtitleSegmentation=r.features?.includes('subtitle-segmentation-v1')===true;subtitleEditorial=r.features?.includes('subtitle-editorial-v1')===true;subtitleCacheSupported=r.features?.includes('subtitle-cache-v1')===true;expandedLanguages=r.features?.includes('language-target-v1')===true;locale=r.locale||'en';t=U.copy(locale);
      const stored=(await extensionCall(()=>api.storage.local.get('cindyReadingPreferences'))).cindyReadingPreferences||{};
      const legacy=stored.webTarget?{}:await request({op:'preferences'});
      target=L.validTarget(stored.webTarget)?stored.webTarget:L.validTarget(legacy.target)?legacy.target:'zh-CN';
      prefs={webTarget:target,videoTarget:L.validTarget(stored.videoTarget)?stored.videoTarget:target,videoMode:['both','translation','original','off'].includes(stored.videoMode)?stored.videoMode:'both',videoSize:['small','medium','large'].includes(stored.videoSize)?stored.videoSize:'medium',autoVideo:stored.autoVideo!==false,bufferPause:stored.bufferPause===true,captionTheme:stored.captionTheme==='light'?'light':'dark',autoSites:stored.autoSites&&typeof stored.autoSites==='object'?stored.autoSites:{},theme:['light','dark'].includes(stored.theme)?stored.theme:null};
    })();try{await configuring;}finally{configuring=null;}
  }
  let preferenceSave=Promise.resolve();
  function savePreferences(changes={}){
    preferenceSave=preferenceSave.catch(()=>{}).then(async()=>{
      const stored=(await extensionCall(()=>api.storage.local.get('cindyReadingPreferences'))).cindyReadingPreferences||{};
      const merged={...stored,...changes};
      if(changes.autoSites){const autoSites={...(stored.autoSites&&typeof stored.autoSites==='object'?stored.autoSites:{})};for(const [origin,value]of Object.entries(changes.autoSites)){if(value===undefined)delete autoSites[origin];else autoSites[origin]=value;}merged.autoSites=autoSites;}
      await extensionCall(()=>api.storage.local.set({cindyReadingPreferences:merged}));
      Object.assign(prefs,merged);prefs.autoSites=merged.autoSites&&typeof merged.autoSites==='object'?merged.autoSites:{};
    });
    return preferenceSave;
  }
  function needsTranslation(){if(videoSession?.sameLanguage)return false;return prefs.videoMode==='both'||prefs.videoMode==='translation';}
  function field(label,control){const row=el('div',undefined,'field');row.append(el('span',label),control);return row;}
  function switchControl(label,value,change){const b=button('',()=>{const next=b.getAttribute('aria-checked')!=='true';b.setAttribute('aria-checked',String(next));return change(next);},'switch');b.setAttribute('role','switch');b.setAttribute('aria-label',label);b.setAttribute('aria-checked',String(value));return b;}
  function languageControl(videoLanguage=false){return U.languagePicker({locale,value:videoLanguage?prefs.videoTarget:target,expanded:expandedLanguages,onchange:value=>{
    if(videoLanguage){prefs.videoTarget=value;resetSubtitleTranslation();videoSession?.overlay?.update();savePreferences({videoTarget:value}).catch(report);}else{target=value;prefs.webTarget=value;request({op:'preferences',target:value}).catch(report);if(translated){restorePage();togglePage();}savePreferences({webTarget:value}).catch(report);}
  }});}
  function resetSubtitleTranslation(){if(!videoSession)return;cancel();for(const chunk of videoSession.chunks||[]){chunk.done=false;delete chunk.error;delete chunk.recovery;delete chunk.retryAt;delete chunk.retries;delete chunk.cache;delete chunk.context;}cues=[];videoSession.paused=false;videoSession.failed=false;videoHandler?.();translateCues();}
  function applyVideoMode(mode){prefs.videoMode=mode;savePreferences({videoMode:mode}).catch(report);if(!needsTranslation())cancel();else if(videoSession){videoSession.paused=false;videoSession.failed=false;translateCues();}videoSession?.playback?.update();videoHandler?.();videoSession?.overlay?.update();}
  function stopPage(){translated=false;observer?.disconnect();observer=null;clearTimeout(translateTimer);}
  function rememberVideo(enabled){if(disposed)return;sendMessage({type:'cindy-video-state',enabled}).catch(()=>{});}
  function close(){panelEpoch++;rememberVideo(false);cancel();stopVideo();speechSynthesis.cancel();host?.remove();host=null;shadow=null;footer=null;status=null;ensureVideoEntry();}
  function hidePanel(){panelEpoch++;host?.style.setProperty('display','none','important');}
  function makePanel(){
    if(host){host.style.setProperty('display','block','important');host.style.removeProperty('left');host.style.setProperty('right','16px','important');host.style.setProperty('top','16px','important');return;}
    host=el('div');host.setAttribute('data-cindy-panel','');isolateHost(host,{position:'fixed',display:'block','z-index':'2147483646',top:'16px',right:'16px',width:'min(336px,calc(100vw - 32px))','max-height':'calc(100vh - 32px)'});
    shadow=host.attachShadow({mode:'closed'});shadow.append(el('style',U.css+`.panel{display:flex;flex-direction:column;max-height:calc(100vh - 32px);background:var(--card);border:1px solid var(--board);border-radius:12px;overflow:hidden}header{padding:12px 16px;border-bottom:1px solid var(--board)}.heading{flex-wrap:nowrap}main{padding:20px;overflow:auto;min-height:0}footer{display:flex;align-items:center;gap:8px;padding:10px 16px;border-top:1px solid var(--board)}footer .status{flex:1;min-width:0}footer button{flex:none}.selection-source{font-size:12px;color:var(--muted);max-height:90px;overflow:auto}.result{font-size:16px;line-height:1.7}.result:empty{display:none}details{border-top:1px solid var(--board);padding-top:12px}summary{cursor:pointer;font-size:12px;color:var(--muted)}details .stack{margin-top:12px}`));
    const panel=el('section',undefined,'panel cindy-root');panel.dataset.theme=prefs.theme||pageTheme();panel.setAttribute('aria-label','Cindy');const header=el('header',undefined,'row heading'),brand=el('img');brand.className='brand';brand.src=brandURL;brand.alt='';
    header.append(brand,el('h1','Cindy','grow'),iconButton(t.settings,'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',showSettings),iconButton(t.close,'M6 6l12 12M18 6 6 18',hidePanel));
    body=el('main',undefined,'stack');status=el('div','','status');status.setAttribute('role','status');footer=el('footer');cancelButton=button(t.cancel,()=>{if(videoSession){videoSession.paused=true;videoSession.retryButton.hidden=false;}cancel();videoSession?.playback?.update();stopPage();note(t.cancel);},'quiet');footer.append(status,cancelButton);panel.append(header,body,footer);shadow.append(panel);document.documentElement.append(host);updateFooter();
  }
  function clear(mode){if(mode!=='settings'){cancel();stopVideo();}body.onkeydown=null;body.replaceChildren();note('');}
  function showPageHome(preserveWork=false){clear(preserveWork?'settings':'page');const media=document.querySelector('video,audio');body.append(el('h2',t.readTitle),el('p',t.readHint,'muted'),field(t.target,languageControl()));if(media)body.append(button(t.video,()=>showVideo(),'primary full'));body.append(button(translated?t.restore:t.translatePage,()=>{const work=togglePage();if(host)showPageHome(true);return work;},'primary full'),el('small',translated?t.restoreHint:t.selectionHint),field(t.autoSite,switchControl(t.autoSite,prefs.autoSites[location.origin]===true,value=>{if(value)prefs.autoSites[location.origin]=true;else delete prefs.autoSites[location.origin];return savePreferences({autoSites:{[location.origin]:value?true:undefined}});})),button(t.modelSettings,showSettings,'text-link'),button(t.textFile,()=>sendMessage({type:'cindy-open-reader'}),'quiet'));}
  function showSettings(){clear('settings');body.append(button(t.back,()=>videoSession?videoSettings():showPageHome(),'quiet'),el('h2',t.settings),field(t.webLanguage,languageControl()));
    body.append(field(t.autoVideo,switchControl(t.autoVideo,prefs.autoVideo,v=>{prefs.autoVideo=v;return savePreferences({autoVideo:v});})));
    const theme=el('select');theme.setAttribute('aria-label',t.appearance);for(const [value,label]of [['light',t.light],['dark',t.dark]]){const o=el('option',label);o.value=value;theme.append(o);}theme.value=prefs.theme||pageTheme();theme.onchange=()=>{prefs.theme=theme.value;shadow.querySelector('.cindy-root').dataset.theme=prefs.theme;videoSession?.overlay?.update();savePreferences({theme:prefs.theme}).catch(report);};body.append(field(t.appearance,theme),el('h2',t.modelSettings),el('p',t.modelHint,'muted'));
    const link=el('a',t.open);link.href='cindy://focus';body.append(link);
  }
  function onPreferencesChanged(changes,area){
    const change=changes?.cindyReadingPreferences;
    if(area!=='local'||!change?.newValue)return;
    const stored=change.newValue,previous=change.oldValue||{};
    const videoWasEnabled=previous.autoVideo!==false,videoIsEnabled=stored.autoVideo!==false;
    const siteWasEnabled=previous.autoSites?.[location.origin]===true,siteIsEnabled=stored.autoSites?.[location.origin]===true;
    const nextVideoTarget=L.validTarget(stored.videoTarget)?stored.videoTarget:prefs.videoTarget;
    const videoTargetChanged=nextVideoTarget!==prefs.videoTarget;
    target=L.validTarget(stored.webTarget)?stored.webTarget:target;
    prefs.webTarget=target;
    prefs.videoTarget=nextVideoTarget;
    prefs.videoMode=['both','translation','original','off'].includes(stored.videoMode)?stored.videoMode:prefs.videoMode;
    prefs.videoSize=['small','medium','large'].includes(stored.videoSize)?stored.videoSize:prefs.videoSize;
    prefs.bufferPause=stored.bufferPause!==false;
    prefs.theme=['light','dark'].includes(stored.theme)?stored.theme:null;
    prefs.autoVideo=stored.autoVideo!==false;
    prefs.autoSites=stored.autoSites&&typeof stored.autoSites==='object'?stored.autoSites:{};
    if(videoTargetChanged&&videoSession){resetSubtitleTranslation();videoSession.overlay?.update();}
    const youtube=/(^|\.)youtube\.com$/.test(location.hostname);
    const relevantEnable=youtube?!videoWasEnabled&&videoIsEnabled:!siteWasEnabled&&siteIsEnabled;
    if(relevantEnable){nextAutoAttempt=0;if(!videoSession)autoOpen();}
    else if(!videoIsEnabled)nextAutoAttempt=Date.now()+5000;
  }
  api.storage?.onChanged?.addListener(onPreferencesChanged);
  function selection(){
    const s=window.getSelection();const node=s?.anchorNode?.parentElement;
    if(!s||!node||node.closest('input,textarea,[contenteditable]')){selected='';selectedContext='';return;}
    const value=s.toString().trim();if(value&&value.length<=20000){selected=value;selectedContext=(node.closest('p,li,article')?.innerText||node.innerText||'').slice(0,4000);lastResult='';}
  }
  let panelSetup=null,panelEpoch=0;
  function preparePanel(epoch){
    if(panelSetup?.epoch===epoch)return panelSetup.promise;
    const openingNewPanel=!host;
    makePanel();note(t.working);
    const openingPanel=host;
    const setup={epoch};
    setup.promise=(async()=>{
      try{await configure();}catch(e){if(!disposed&&epoch===panelEpoch)report(e);return false;}
      if(!runtimeReady()||epoch!==panelEpoch||host!==openingPanel||host.style.getPropertyValue('display')==='none')return false;
      if(openingNewPanel){host.remove();host=null;}
      makePanel();return true;
    })().finally(()=>{if(panelSetup===setup)panelSetup=null;});
    panelSetup=setup;return setup.promise;
  }
  async function open(action){
    const epoch=panelEpoch;
    if(action==='selection'&&window.getSelection()?.toString().trim())selection();
    if(action==='settings'&&videoSession){showSettings();videoSession.overlay.openSettings(false);return;}
    if((action==='video'||action==='open'&&/(^|\.)youtube\.com$/.test(location.hostname))&&videoSession){videoSession.overlay.openSettings();return;}
    // Share only setup, never the model operation. Close invalidates all clicks
    // already waiting here; a new explicit click gets the new panel epoch.
    if(!await preparePanel(epoch)||epoch!==panelEpoch||!runtimeReady())return;
    if(action==='translate-page'){const work=togglePage();showPageHome(true);await work;return;}
    if(action==='settings'){showSettings();return;}
    if(action==='video'||(/(^|\.)youtube\.com$/.test(location.hostname)&&action!=='selection')){await showVideo();if(action!=='auto')videoSession?.overlay?.openSettings();return;}
    if(action==='selection'&&selected){showSelection();await translateSelection();return;}
    showPageHome();
  }
  function showSelection(){clear('selection');if(selectionPoint){host.style.setProperty('left',Math.max(12,Math.min(selectionPoint.x,innerWidth-348))+'px','important');host.style.setProperty('top',Math.max(12,Math.min(selectionPoint.y,innerHeight-300))+'px','important');host.style.removeProperty('right');}
    body.append(el('p',selected,'selection-source'),el('p',lastResult,'result'));const actions=el('div',undefined,'row');actions.append(button(t.explain,()=>analyze('explain'),'text-link'),button(t.copyText,async()=>{await navigator.clipboard.writeText(lastResult);note(t.copied);},'quiet'));body.append(actions);
    const more=el('details'),moreBody=el('div',undefined,'stack');more.append(el('summary',t.more),moreBody);const input=el('textarea');input.value=selected;input.setAttribute('aria-label',t.source);input.oninput=()=>{selected=input.value;lastResult='';};moreBody.append(input,button(t.translate,translateSelection),button(t.summary,()=>analyze('summary')),button(t.listen,()=>speak(lastResult||selected)));
    const instruction=el('textarea');instruction.placeholder=t.taskInstruction;instruction.setAttribute('aria-label',t.taskInstruction);moreBody.append(instruction,button(t.handoff,async()=>{if(!selected.trim())return;const payload=JSON.stringify([selected,selectedContext,instruction.value,source().url]);if(payload!==taskPayload){taskKey=L.uuid();taskPayload=payload;}note(t.working);const r=await request({op:'task',id:taskKey,text:selected,context:selectedContext,instruction:instruction.value});note(t.taskSent+' '+r.title);}));body.append(more);
  }
  async function translateSelection(){if(!selected.trim())return;const g=++generation,result=body.querySelector('.result');note(t.working);
    try{const r=await request({op:'translate',text:selected});if(g!==generation||!result?.isConnected||body.querySelector('.result')!==result)return;lastResult=r.translations[0];result.textContent=lastResult;note('');}
    catch(e){if(g===generation&&result?.isConnected&&body.querySelector('.result')===result)throw e;}
  }
  async function analyze(op){if(!selected.trim())return;const g=++generation,result=body.querySelector('.result');note(t.working);
    try{const r=await request({op,text:selected,context:selectedContext});if(g!==generation||!result?.isConnected||body.querySelector('.result')!==result)return;lastResult=r.text;result.textContent=lastResult;note('');}
    catch(e){if(g===generation&&result?.isConnected&&body.querySelector('.result')===result)throw e;}
  }
  function restorePage(){cancel();translated=false;observer?.disconnect();observer=null;for(const [node,rec]of translations){rec.host.remove();}translations.clear();if(status)note(t.restore);}
  const pageTextSelector='p,h1,h2,h3,li,blockquote,figcaption,[slot="title"]';
  function candidates(){return [...(document.querySelector('article,main,[role=main]')||document.body).querySelectorAll(pageTextSelector)].filter(n=>!translations.has(n)&&!n.closest('pre,code,nav,footer,header,textarea,[contenteditable],script,style')&&n.getClientRects().length&&n.innerText?.trim().length>2&&n.innerText.length<=4000&&!n.querySelector(pageTextSelector)&&n.getBoundingClientRect().top<innerHeight*2&&n.getBoundingClientRect().bottom>0);}
  async function translateVisible(){
    const g=generation;
    if(!translated||translateRunning===g)return;
    // A cancelled generation must not block (or unlock) its replacement.
    translateRunning=g;
    try{
      const nodes=candidates().slice(0,12),texts=[];const accepted=[];
      for(const n of nodes){if(texts.join('').length+n.innerText.length>18000)break;texts.push(n.innerText);accepted.push(n);}
      if(!accepted.length)return;
      const r=await request({op:'translate',texts});if(g!==generation||!translated)return;
      accepted.forEach((node,i)=>{
        if(!node.isConnected||node.innerText!==texts[i])return;
        const h=el('span');
        // Named-slot content (e.g. Reddit post titles) has no visible default
        // slot. Project the sibling into the same slot without editing the link.
        if(node.hasAttribute('slot'))h.slot=node.slot;
        h.setAttribute('data-cindy-translation','');
        const root=h.attachShadow({mode:'closed'});root.append(el('style',':host{display:block;margin:6px 0 12px;font:inherit;color:inherit;opacity:.8}'),el('span',r.translations[i]));node.after(h);translations.set(node,{host:h,text:texts[i]});
      });
      if(status)note(`${t.progress} ${translations.size}`);
    }catch(e){if(g===generation){translated=false;observer?.disconnect();report(e);}}
    finally{if(translateRunning===g)translateRunning=null;if(translated&&g===generation&&candidates().length)queueTranslate();}
  }
  async function togglePage(){if(translated||translations.size){restorePage();return;}translated=true;note(t.working);
    observer=new MutationObserver(()=>{for(const [n,r]of translations)if(!n.isConnected||n.innerText!==r.text){r.host.remove();translations.delete(n);}queueTranslate();});observer.observe(document.body,{subtree:true,childList:true,characterData:true});await translateVisible();}
  let translateTimer;function queueTranslate(){clearTimeout(translateTimer);translateTimer=setTimeout(()=>translateVisible(),350);}
  window.addEventListener('scroll',()=>{if(translated)queueTranslate();},{passive:true,signal:lifecycle.signal});
  function stopVideo(){if(videoSession)rememberVideo(false);clearTimeout(videoTimer);if(video&&videoSession?.seekHandler)video.removeEventListener('seeked',videoSession.seekHandler);videoSession?.playback?.dispose();videoSession?.overlay?.destroy();videoSession=null;if(video&&videoHandler)video.removeEventListener('timeupdate',videoHandler);videoHandler=null;video=null;activeCue=-1;previousCue=-1;}
  function ensureVideoEntry(){
    if(!runtimeReady())return;
    // A running subtitle session mounts its own settings toggle in the control
    // bar; the entry must never sit beside it. YouTube fires yt-navigate-finish
    // after the session may already have auto-started, so remove, don't add.
    if(videoSession){for(const entry of document.querySelectorAll('[data-cindy-player-entry]'))entry.remove();return;}
    const media=document.querySelector('video'),player=media?.closest('#movie_player,.html5-video-player');
    const native=player?.querySelector('.ytp-right-controls');
    // Only mount in an adapted control bar. A generic video's parent can be
    // part of the page layout (e.g. a short-video feed), not player controls.
    for(const entry of document.querySelectorAll('[data-cindy-player-entry]'))if(entry.parentElement!==native)entry.remove();
    if(!native)return;
    let host=native.querySelector('[data-cindy-player-entry]');
    if(!host){
      host=el('div');host.setAttribute('data-cindy-player-entry','');isolateHost(host,{display:'inline-flex',height:'100%','vertical-align':'top'});
      const root=host.attachShadow({mode:'closed'});root.append(el('style',U.css+'.cindy-root{display:flex;align-items:center;height:100%;background:transparent}button{color:#fff!important;background:transparent!important;border:0!important;min-height:36px;width:36px;padding:0;font-weight:600;display:inline-flex;align-items:center;justify-content:center}button svg{width:24px;height:24px;display:block}'));const control=el('div',undefined,'cindy-root'),entry=button('',()=>open('video'),'quiet');entry.setAttribute('aria-label','Cindy · '+t.video);entry.title='Cindy · '+t.video;entry.append(captionIcon(false));control.append(entry);root.append(control);
      for(const event of ['click','dblclick','pointerdown','pointerup','keydown','keyup','keypress'])host.addEventListener(event,e=>e.stopPropagation());
    }
    if(host.parentElement!==native)native.prepend(host);
  }
  function mountVideoCaptions(media){
    const player=media.closest('#movie_player,.html5-video-player')||media.parentElement;
    player.querySelector('[data-cindy-player-entry]')?.remove();
    const overlayHost=el('div');overlayHost.setAttribute('data-cindy-captions','');
    const oldPosition=player.style.getPropertyValue('position'),oldPriority=player.style.getPropertyPriority('position');
    const positioned=getComputedStyle(player).position==='static';if(positioned)player.style.setProperty('position','relative');
    isolateHost(overlayHost,{position:'absolute',display:'block','z-index':'60','pointer-events':'none',overflow:'visible'});
    const root=overlayHost.attachShadow({mode:'closed'});
    const css=U.css+`
      .captions-root{position:absolute;inset:0;pointer-events:none}
      .caption-box{position:absolute;bottom:var(--caption-bottom,16px);transition:bottom .18s ease-out,left .18s ease-out;left:50%;transform:translateX(-50%);width:max-content;max-width:min(70%,900px);padding:6px 14px 8px;border-radius:8px;background:rgba(18,18,17,.55);color:#fff;text-align:center;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-weight:600;text-shadow:0 0 2px rgba(0,0,0,.95),0 1px 2px rgba(0,0,0,.9);line-height:1.3;overflow-wrap:anywhere}.caption-box[data-caption-theme=light]{background:rgba(255,255,255,.8);color:#1a1a1a;text-shadow:none}.caption-hint{position:absolute;bottom:var(--caption-bottom,16px);left:50%;transform:translateX(-50%);max-width:88%;padding:6px 14px;border-radius:9999px;background:rgba(18,18,17,.6);color:#fff;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px;line-height:18px;text-align:center}
      .caption-original{font-size:calc(var(--caption-size)*.78);font-weight:400;opacity:.86;white-space:pre-line}
      .caption-translation{font-size:var(--caption-size);margin-top:5px;white-space:pre-line}
      @media(prefers-reduced-motion:reduce){.caption-box{transition:none}}
      .caption-bar{position:absolute;bottom:8px;right:70px;display:flex;gap:4px;align-items:center;padding:3px;border:1px solid var(--board);border-radius:9999px;background:var(--surface);pointer-events:auto;opacity:0;transition:opacity .15s}
      .captions-root[data-controls=true] .caption-bar,.caption-bar:hover,.caption-bar:focus-within{opacity:1}.caption-bar .label{font-size:12px;padding:0 8px}.caption-bar button{padding:4px 10px}
      .caption-settings{position:absolute;bottom:56px;right:12px;width:min(292px,calc(100% - 24px));max-height:calc(100% - 68px);overflow:auto;overscroll-behavior:contain;pointer-events:auto;background:var(--card);border:1px solid var(--board);border-radius:12px}
      .caption-heading{position:sticky;top:0;z-index:1;background:var(--card);padding:10px 12px;border-bottom:1px solid var(--board);flex-wrap:nowrap}.caption-settings .status{display:none}.caption-settings footer:has(button[hidden]){display:none}.captions-root:not([data-wide=true]):has(.caption-settings:not([hidden])) .caption-box{visibility:hidden}.captions-root[data-wide=true]:has(.caption-settings:not([hidden])) .caption-box{left:calc((100% - 316px)/2);max-width:calc(100% - 340px)}.captions-root[data-compact=true] .caption-settings{left:0;right:0;width:auto;border-radius:12px 12px 0 0}.caption-notice[data-ready=true]:not(.error) .preparation-track{display:none}main{padding:12px}footer{padding:8px 12px;border-top:1px solid var(--board)}.video-list{max-height:180px;overflow:auto}.cue small{display:block}.status.error{color:var(--danger)}
      .caption-notice{padding:12px;border-bottom:1px solid var(--board);background:var(--surface);color:var(--text);font-size:12px;line-height:18px;pointer-events:auto}.preparation-heading{display:flex;justify-content:space-between;gap:8px;font-weight:500}.preparation-track{height:4px;background:var(--board);border-radius:2px;overflow:hidden;margin:8px 0}.preparation-fill{height:100%;background:var(--text);width:0}.preparation-detail,.preparation-cache{color:var(--muted);margin-top:4px}.preparation-error{color:var(--danger);margin-top:6px;overflow-wrap:anywhere}.preparation-error:empty{display:none}.caption-notice button{margin-top:8px}
      .caption-notice.error .preparation-heading{color:var(--danger)}.caption-notice .preparation-error{color:var(--text)}.preparation-cache.warning{color:var(--danger)}.detail-code{font-size:11px;color:var(--muted);margin-top:4px;overflow-wrap:anywhere}.detail-code:empty{display:none}.caption-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.caption-actions:not(:has(button:not([hidden]))){display:none}.caption-notice button{margin-top:0}
    `;
    root.append(el('style',css));const surface=el('div',undefined,'cindy-root captions-root');surface.dataset.theme=prefs.theme||pageTheme();
    const box=el('div',undefined,'caption-box');box.setAttribute('aria-label',t.bilingualSubtitles);box.hidden=true;
    const original=el('div','', 'caption-original'),translation=el('div','', 'caption-translation');box.append(original,translation);
    const settings=el('section',undefined,'caption-settings');settings.setAttribute('aria-label',t.subtitleSettings);settings.hidden=true;
    const originalParent=body.parentElement;const settingsHeader=el('div',undefined,'row caption-heading');settingsHeader.append(el('h2','Cindy · '+t.video,'grow'),iconButton(t.closeSettings,'M6 6l12 12M18 6 6 18',()=>{settings.hidden=true;toggle.setAttribute('aria-expanded','false');}));settings.append(settingsHeader,body,footer);
    const bar=el('div',undefined,'caption-bar'),toggle=button('',()=>{settings.hidden=!settings.hidden;if(!settings.hidden)videoSettings();toggle.setAttribute('aria-expanded',String(!settings.hidden));surface.dataset.controls='true';});toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label',t.subtitleSettings);toggle.title=t.subtitleSettings;toggle.append(captionIcon(true));
    bar.append(toggle);
    const controlHost=el('div');controlHost.setAttribute('data-cindy-player-control','');isolateHost(controlHost,{display:'inline-flex',height:'100%','vertical-align':'top'});
    const cr=controlHost.attachShadow({mode:'closed'});cr.append(el('style',U.css+'.cindy-root{display:flex;align-items:center;height:100%;background:transparent}button{color:#fff!important;background:transparent!important;border:0!important;min-height:36px;padding:0 10px}button svg{width:24px;height:24px;display:block}'));const control=el('div',undefined,'cindy-root');cr.append(control);
    const placeControl=()=>{const native=player.querySelector('.ytp-right-controls');if(native){if(controlHost.parentElement!==native)native.prepend(controlHost);if(toggle.parentElement!==control)control.append(toggle);bar.hidden=true;}else{if(toggle.parentElement!==bar)bar.append(toggle);controlHost.remove();bar.hidden=false;}};placeControl();
    for(const event of ['click','dblclick','pointerdown','pointerup','keydown','keyup','keypress'])controlHost.addEventListener(event,e=>e.stopPropagation());
    const st=U.subtitleStatusCopy(locale),notice=el('div','', 'caption-notice'),noticeText=el('div','','preparation-error'),codeText=el('div','','detail-code'),retry=button(t.retrySubtitles,()=>videoSession?.retry(),'quiet');retry.hidden=true;const useSite=button(t.useSiteCaptions,()=>videoSession?.retry(),'quiet'),importBtn=button(t.subtitles,importSubtitleFile,'quiet'),actions=el('div',undefined,'caption-actions'),hint=el('div','','caption-hint');hint.hidden=true;useSite.hidden=true;importBtn.hidden=true;let noticeCode='';
    const heading=el('div',undefined,'preparation-heading'),percent=el('span','0%'),track=el('div',undefined,'preparation-track'),fill=el('div',undefined,'preparation-fill'),detail=el('div','','preparation-detail'),cacheDetail=el('div','','preparation-cache');
    const title=el('span',st.title);heading.append(title,percent);track.append(fill);track.setAttribute('role','progressbar');track.setAttribute('aria-label',st.title);track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');actions.append(useSite,importBtn,retry);notice.append(heading,track,detail,cacheDetail,noticeText,codeText,actions);
    const clock=seconds=>{if(!Number.isFinite(seconds))return '—';const value=Math.max(0,Math.floor(seconds));return Math.floor(value/60)+':'+String(value%60).padStart(2,'0');};
    let noticeError=false;
    const progress=()=>{
      const session=videoSession;if(!session)return;
      const empty=session.noCaptions&&!noticeError;
      // A missing caption source is a page problem with its own next steps, not a translation failure.
      const sourceProblem=noticeError&&/^(SUBTITLE_|INVALID_SUBTITLE)/.test(noticeCode)&&!session.words?.length;
      notice.hidden=!needsTranslation()&&!empty&&!sourceProblem;
      const label=t.video+' · '+(prefs.videoMode==='off'?t.off:prefs.videoMode==='original'?t.source:L.languageName(prefs.videoTarget));toggle.title=label;
      const buffer=L.subtitleBuffer(session.chunks,media.currentTime,media.playbackRate),ready=buffer.ready&&!empty&&!noticeError;
      const until=Number.isFinite(buffer.ahead)?clock(media.currentTime+buffer.ahead):null;
      const buffering=!!session.playback?.buffering;
      hint.hidden=!buffering;if(buffering)hint.textContent=t.waitingPlayback+' '+st.preparingTo.replace('{time}',until||clock(media.currentTime));
      if(notice.hidden)return;
      const p=L.subtitlePreparation(session.chunks,media.currentTime),phase=session.paused?'paused':p.stage;
      const value=ready?100:Math.min(99,Math.floor(buffer.ahead/15*100));
      percent.textContent=noticeError?st.needsRetry:empty?'—':ready?st.ready:session.paused?st.stages.paused:st.preparingShort;
      title.textContent=empty||sourceProblem?t.captionsUnavailableTitle:st.title;
      fill.style.width=value+'%';if(p.total)track.setAttribute('aria-valuenow',String(value));else track.removeAttribute('aria-valuenow');
      track.setAttribute('aria-valuetext',percent.textContent);notice.dataset.ready=String(ready);notice.classList.toggle('error',noticeError);
      if(!ready)toggle.title=t.video+' · '+(noticeError?st.needsRetry:session.paused?st.paused:st.preparingShort);
      const stageText=st.stages[phase]||st.preparing;
      detail.textContent=empty||sourceProblem?t.captionsUnavailableBody:session.paused?st.stages.paused:ready?(buffer.complete?st.stages.prepared:st.preparedTo.replace('{time}',until)):p.stage==='failed'?st.stages.failed:(session.words?.length&&until?st.preparingTo.replace('{time}',until):st.preparingStart)+' · '+stageText;
      cacheDetail.textContent=empty||sourceProblem?'':p.cacheError?st.cacheFailed+' · '+t.errorDetails+' '+U.errorDetail(p.cacheError):p.saved?st.saved+(p.cached?' · '+st.cacheHit+' '+p.cached:''):p.complete?st.temporary:'';
      cacheDetail.classList.toggle('warning',!!p.cacheError);
      notice.dataset.complete=String(p.complete&&!noticeError&&!p.cacheError);
      const chunkError=session.chunks?.some(c=>c.error);
      retry.hidden=!(noticeError&&!sourceProblem)&&!chunkError;useSite.hidden=!(empty||sourceProblem);importBtn.hidden=!(empty||sourceProblem);
      noticeText.hidden=sourceProblem;codeText.hidden=!noticeError;
    };
    const progressTimer=setInterval(progress,1000);progress();
    settings.insertBefore(notice,body);surface.append(box,hint,bar,settings);root.append(surface);player.append(overlayHost);host.style.setProperty('display','none','important');
    const nativeNodes=new Map(),nativeTracks=new Map();let currentText='',frame=0,lastFrame=0,controlsTimer,captionSize=16,fitKey='';
    const fitCaption=()=>{
      if(box.hidden)return;
      const bounds=overlayHost.getBoundingClientRect(),bottom=parseFloat(surface.style.getPropertyValue('--caption-bottom'))||16;
      const key=[original.textContent,translation.textContent,original.hidden,translation.hidden,bounds.width,bounds.height,bottom,captionSize].join('|');
      if(key===fitKey)return;fitKey=key;
      let size=captionSize;surface.style.setProperty('--caption-size',size+'px');
      const available=Math.max(24,bounds.height-bottom-12);
      for(let step=0;step<5&&box.getBoundingClientRect().height>available&&size>11;step++){
        size=Math.max(11,size*.87);surface.style.setProperty('--caption-size',size+'px');
      }
    };
    const syncControls=()=>{
      const native=player.querySelector('.ytp-chrome-bottom'),hasNative=!!native||!!player.querySelector('.ytp-right-controls');
      const visible=hasNative?!player.classList.contains('ytp-autohide'):media.paused||surface.dataset.controls==='true';
      const p=player.getBoundingClientRect(),barRect=native?.getBoundingClientRect();
      const nativeRight=player.querySelector('.ytp-right-controls');
      if(nativeRight){
        const others=[...nativeRight.children].filter(n=>n!==controlHost).reduce((sum,n)=>sum+n.getBoundingClientRect().width,0);
        const left=player.querySelector('.ytp-left-controls')?.getBoundingClientRect().width||0;
        toggle.style.maxWidth=Math.min(190,Math.max(36,p.width-left-others-32))+'px';
        // The player entry is icon-only; its current mode remains available
        // through the tooltip and accessible label.
      }
      // A scrolled or short player must still expose the menu and close button.
      const visibleTop=Math.max(0,-p.top),visibleBottom=Math.min(p.height,innerHeight-p.top);
      const menuBottom=Math.max(56,p.height-visibleBottom+8);
      settings.style.bottom=menuBottom+'px';settings.style.maxHeight=Math.max(0,p.height-visibleTop-menuBottom-8)+'px';
      const clearance=barRect?.height?Math.max(0,p.bottom-barRect.top)+12:60;
      surface.style.setProperty('--caption-bottom',(visible?Math.max(52,Math.min(p.height*.35,clearance)):Math.max(12,Math.min(28,p.height*.025)))+'px');fitCaption();
    };
    const showControls=()=>{surface.dataset.controls='true';syncControls();clearTimeout(controlsTimer);controlsTimer=setTimeout(()=>{if(settings.hidden)surface.dataset.controls='false';syncControls();},2200);};player.addEventListener('pointermove',showControls);showControls();
    // YouTube owns control visibility, including keyboard, pause and fullscreen.
    const controlsObserver=new MutationObserver(syncControls);controlsObserver.observe(player,{attributes:true,attributeFilter:['class']});
    for(const event of ['click','dblclick','pointerdown','pointerup','keydown','keyup','keypress'])overlayHost.addEventListener(event,e=>e.stopPropagation());
    const restoreNodes=()=>{for(const [node,old]of nativeNodes){if(node.style.getPropertyValue('visibility')==='hidden'){if(old.value)node.style.setProperty('visibility',old.value,old.priority);else node.style.removeProperty('visibility');}}nativeNodes.clear();};
    const suppressNative=()=>{for(const node of player.querySelectorAll('.ytp-caption-window-container')){if(!nativeNodes.has(node))nativeNodes.set(node,{value:node.style.getPropertyValue('visibility'),priority:node.style.getPropertyPriority('visibility')});node.style.setProperty('visibility','hidden','important');}};
    const playerFrame=player.matches('#movie_player,.html5-video-player');
    const position=()=>{
      const p=player.getBoundingClientRect(),r=playerFrame?p:media.getBoundingClientRect();
      // YouTube temporarily moves the video outside its viewport while loading.
      // Its return can be position-only (no ResizeObserver notification), so anchor
      // captions and settings to the stable player, not that transient video rect.
      const bounds=playerFrame?{left:'0px',top:'0px',width:'100%',height:'100%'}:{left:(r.left-p.left+player.scrollLeft)+'px',top:(r.top-p.top+player.scrollTop)+'px',width:r.width+'px',height:r.height+'px'};
      for(const [key,value]of Object.entries(bounds))overlayHost.style.setProperty(key,value,'important');
      syncControls();
      surface.dataset.wide=String(r.width>=640);surface.dataset.compact=String(r.width<480);
      captionSize=Math.max(16,Math.min(40,r.width*.027))*({small:.85,medium:1,large:1.18}[prefs.videoSize]||1);fitCaption();
    };
    const resize=new ResizeObserver(position);resize.observe(media);resize.observe(player);position();
    const observer=new MutationObserver(()=>{placeControl();syncControls();if(currentText||prefs.videoMode==='off')suppressNative();});observer.observe(player,{childList:true,subtree:true});
    const tick=time=>{if(time-lastFrame>=50){lastFrame=time;videoHandler?.();}if(!media.paused&&!media.ended)frame=requestAnimationFrame(tick);};
    const play=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(tick);},sync=()=>{position();videoHandler?.();};
    media.addEventListener('play',play);media.addEventListener('seeked',sync);media.addEventListener('loadedmetadata',sync);document.addEventListener('fullscreenchange',sync);window.addEventListener('scroll',position,{passive:true});window.addEventListener('resize',position);if(!media.paused)play();
    const update=()=>{surface.dataset.theme=prefs.theme||pageTheme();box.dataset.captionTheme=prefs.captionTheme||'dark';toggle.title=t.video+' · '+(prefs.videoMode==='off'?t.off:prefs.videoMode==='original'?t.source:L.languageName(prefs.videoTarget));position();progress();};update();
    overlayHost.addEventListener('keydown',e=>{if(e.key==='Escape'){settings.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.focus();}});
    const outside=e=>{if(!e.composedPath().includes(overlayHost)&&!e.composedPath().includes(controlHost)){settings.hidden=true;toggle.setAttribute('aria-expanded','false');}};document.addEventListener('pointerdown',outside);
    return {
      update,progress,openSettings(render=true){if(render)videoSettings();settings.hidden=false;toggle.setAttribute('aria-expanded','true');surface.dataset.controls='true';},closeSettings(){settings.hidden=true;toggle.setAttribute('aria-expanded','false');},
      track(track){if(!nativeTracks.has(track))nativeTracks.set(track,track.mode);if(track.mode!=='hidden')track.mode='hidden';},
      render(cue){const text=cue?.text||'',translated=cue?.translation||'';currentText=text;box.hidden=!text||prefs.videoMode==='off';original.hidden=prefs.videoMode==='translation'&&!!translated;translation.hidden=!translated||prefs.videoMode==='original';if(original.textContent!==text)original.textContent=text;if(translation.textContent!==translated)translation.textContent=translated;if(text||prefs.videoMode==='off')suppressNative();else restoreNodes();if(!needsTranslation())notice.hidden=true;fitCaption();},
      notify(text,error=false,detail=''){noticeError=error;noticeCode=error?detail:'';noticeText.textContent=error?text:'';codeText.textContent=error&&detail?t.errorDetails+' · '+detail:'';progress();},
      destroy(){clearInterval(progressTimer);document.removeEventListener('pointerdown',outside);controlHost.remove();clearTimeout(controlsTimer);player.removeEventListener('pointermove',showControls);cancelAnimationFrame(frame);resize.disconnect();observer.disconnect();controlsObserver.disconnect();media.removeEventListener('play',play);media.removeEventListener('seeked',sync);media.removeEventListener('loadedmetadata',sync);document.removeEventListener('fullscreenchange',sync);window.removeEventListener('scroll',position);window.removeEventListener('resize',position);restoreNodes();for(const [track,mode]of nativeTracks)if(track.mode==='hidden')track.mode=mode;originalParent.append(body,footer);overlayHost.remove();host?.style.setProperty('display','block','important');if(positioned&&player.style.position==='relative'){if(oldPosition)player.style.setProperty('position',oldPosition,oldPriority);else player.style.removeProperty('position');}}
    };
  }
  function cueList(){const article=body.querySelector('.subtitle-document');if(article){article.replaceChildren();for(const p of L.subtitleDocument(cues)){article.append(el('p',p.text),el('p',p.translation,'muted'));}}const list=body.querySelector('.video-list');if(!list)return;list.replaceChildren();cues.forEach((c,i)=>{const b=button(c.text,()=>jump(i),'cue');b.dataset.index=String(i);b.classList.toggle('active',i===activeCue);if(c.translation)b.append(el('small',c.translation));list.append(b);});}
  function jump(i){if(!video||!cues[i])return;video.currentTime=cues[i].start;activeCue=i;previousCue=i;video.play().catch(report);}
  async function translateCues(){
    const session=videoSession;if(!needsTranslation()||!session||session.running||session.paused||session.failed||!L.pendingSubtitleChunks(session.chunks,video.currentTime,video.playbackRate).length)return;
    if(!subtitleSegmentation||!subtitleEditorial){session.failed=true;session.retryButton.hidden=false;report('UPDATE_CINDY_CHROME');session.playback?.update();return;}
    session.running=true;const g=generation,revision=session.revision;
    const current=()=>session===videoSession&&g===generation&&revision===session.revision&&!session.paused;
    try {
      async function worker(){
        while(current()&&!session.failed){
          const pending=L.pendingSubtitleChunks(session.chunks,video.currentTime,video.playbackRate);if(!pending.length)return;
          const chunk=pending[0];chunk.busy=true;chunk.progress={stage:'accepted',updatedAt:Date.now(),attempt:1};session.overlay?.progress();
          const nearby=L.joinWords(session.words.slice(Math.max(0,chunk.start-120),Math.min(session.words.length,chunk.end+120)));
          const previous=session.chunks.filter(c=>c.done&&c.end<=chunk.start).slice(-2).flatMap(c=>c.cues).slice(-6).map(c=>c.text+' → '+c.translation).join('\n');
          const context=chunk.context||=('Video title: '+document.title.slice(0,500)+'\nTranscript opening: '+L.joinWords(session.words.slice(0,100))+'\nPreviously prepared wording: '+previous+'\nSurrounding transcript: '+nearby).slice(0,8000);
          try{
            const r=await request({op:'subtitles',target:prefs.videoTarget,editorial:true,words:chunk.words,nextStart:chunk.nextStart,context},progress=>{if(current()){chunk.progress=progress;session.overlay?.progress();}});if(!current())return;
            chunk.done=true;chunk.cues=r.cues;chunk.cache=r.cache;session.overlay?.progress();cues=session.chunks.flatMap(c=>c.done?c.cues:[]).sort((a,b)=>a.start-b.start);previousCue=-1;activeCue=-1;cueList();videoHandler?.();
            if(!session.playback?.buffering)note(`${t.progress} ${session.chunks.filter(c=>c.done).length} / ${session.chunks.length}`);
          }catch(e){
            if(!current())return;
            chunk.progress={...chunk.progress,...(e.stage?{stage:e.stage}:{}),finishedAt:Date.now()};
            if(['TIMEOUT','BUSY','BRIDGE_REQUEST_FAILED','SESSION_CHANGED','TASK_FAILED'].includes(e.message)){
              chunk.retries=(chunk.retries||0)+1;
              if(chunk.retries<=2){
                if(e.message==='TIMEOUT'&&chunk.retries===1){
                  const parts=L.splitSubtitleChunk(chunk);
                  if(parts.length){for(const part of parts){part.context=context;part.retries=2;part.recovery=chunk.recovery;}session.chunks.splice(session.chunks.indexOf(chunk),1,...parts);continue;}
                }
                chunk.retryAt=Date.now()+1500*chunk.retries;continue;
              }
              chunk.error=e.message;session.failed=true;session.retryButton.hidden=false;report(e);session.playback?.update();return;
            }
            if(!['BAD_MODEL_OUTPUT','SUBTITLE_FORMAT','SUBTITLE_COVERAGE','SUBTITLE_TRANSLATION','SUBTITLE_PAUSE','SUBTITLE_DURATION','SUBTITLE_LENGTH'].includes(e.message)){chunk.error=e.message;session.failed=true;session.retryButton.hidden=false;report(e);session.playback?.update();return;}
            const recovery=chunk.recovery||(chunk.recovery={count:0});
            if((chunk.depth||0)<4&&recovery.count<8){const parts=L.splitSubtitleChunk(chunk);if(parts.length){recovery.count++;for(const part of parts){part.recovery=recovery;part.context=context;}session.chunks.splice(session.chunks.indexOf(chunk),1,...parts);if(!session.playback?.buffering)note(t.repairingSubtitles);continue;}}
            chunk.error=e.message;session.retryButton.hidden=false;report(e);
            if(session.chunks.filter(c=>c.error).length>=2)session.failed=true;
          }finally{chunk.busy=false;session.overlay?.progress();}
        }
      }
      // Prepare the current passage and its successor concurrently, then stop at the look-ahead limit.
      await Promise.all([worker(),worker()]);
      if(current()){const failed=session.chunks.find(c=>c.error);if(failed)report(failed.error);session.playback?.update();}
    }catch(e){if(current()){session.failed=true;session.retryButton.hidden=false;report(e);}}
    finally{session.running=false;if(session===videoSession&&(g!==generation||revision!==session.revision)&&!session.paused&&!session.failed)translateCues();}
  }
  // Only automatic sessions skip translation; a person who opened subtitles on purpose keeps the choice.
  function checkSameLanguage(session,language){if(session.languageChecked||!session.auto)return;session.languageChecked=true;session.language=language||null;if(language&&L.sameLanguage(language,prefs.videoTarget)){session.sameLanguage=true;cancel();videoSettings();session.overlay?.update();}}
  function mergeCues(next){
    const session=videoSession;if(!session)return;
    const signature=JSON.stringify(next);if(signature===session.transcript)return;
    // Build the entire transcript timeline before asking for semantic grouping and translation.
    const words=L.subtitleWords(next,true);session.transcript=signature;session.originalCues=next;session.failed=false;session.words=words;session.chunks=L.subtitleChunks(words,true);session.revision=(session.revision||0)+1;
    cancel();cues=[];cueList();videoHandler?.();note(words.length?t.organizingSubtitles:t.waitSubtitles);
  }
  async function readCues(session){
    if(session!==videoSession||session.reading)return;
    session.reading=true;clearTimeout(videoTimer);
    try {
      if(!video.isConnected||(video.currentSrc&&video.currentSrc!==session.src)){showVideo();return;}
      const youtube=/(^|\.)youtube\.com$/.test(location.hostname);
      if(!session.imported){
        const tracks=[...video.textTracks],track=tracks.find(x=>x.mode==='showing')||tracks.find(x=>x===session.nativeTrack)||tracks.find(x=>x.kind==='subtitles'||x.kind==='captions');
        if(track){session.nativeTrack=track;session.overlay?.track(track);const next=[...(track.cues||[])].map(c=>({start:c.startTime,end:c.endTime,text:L.cleanSubtitleText(c.text).slice(0,4000)})).filter(c=>c.text&&c.end>c.start);if(next.length&&!youtube){checkSameLanguage(session,track.language);mergeCues(next);}}
        if(youtube&&!session.fullTranscript&&!session.readBlocked&&Date.now()>=session.nextRead){
          session.attempts++;session.nextRead=Date.now()+Math.min(30000,3000*session.attempts);
          const result=await sendMessage({type:'cindy-captions',language:'auto'});
          if(session!==videoSession)return;
          if(result?.ok){if(result.cues?.length){session.fullTranscript=true;checkSameLanguage(session,result.language);mergeCues(result.cues);}}else throw Object.assign(Error(result?.error||'SUBTITLE_UNAVAILABLE'),{reason:result?.reason});
        }
      }
      // A page without any caption track also deserves a clear answer instead of an endless wait.
      if(!youtube&&!session.imported&&!session.words?.length)session.attempts++;
      if(session.words?.length){session.noCaptions=false;translateCues();}else if(!session.readBlocked){session.noCaptions=session.attempts>=(youtube?3:8);note(session.noCaptions?t.noCaptions:t.waitSubtitles);session.playback?.update();}
    }catch(e){if(session===videoSession){session.readBlocked=e.message!=='SUBTITLE_UNAVAILABLE';session.noCaptions=session.readBlocked||session.attempts>=3;session.playback?.update();session.retryButton.hidden=false;report(e);}}
    finally{session.reading=false;if(session===videoSession)videoTimer=setTimeout(()=>readCues(session),1200);}
  }
  let videoTab='subtitles';
  function videoSettings(){
    const session=videoSession;if(!session)return;body.replaceChildren();
    // Three short pages instead of one long scroll: what to show, how to learn, how it behaves.
    const tabs=el('div',undefined,'tabs');for(const [id,label]of [['subtitles',t.video],['learning',t.learning],['options',t.options]]){const b=button(label,()=>{videoTab=id;videoSettings();});b.setAttribute('aria-pressed',String(videoTab===id));tabs.append(b);}body.append(tabs);
    const segmented=(entries,current,pick)=>{const row=el('div',undefined,'segmented');for(const [value,label]of entries){const b=button(label,()=>pick(value));b.setAttribute('aria-pressed',String(current===value));row.append(b);}return row;};
    if(videoTab==='subtitles'){
      // Modes are grouped by cost: the first pair asks the model, the second never does.
      body.append(field(t.translateShort,segmented([['both',t.both],['translation',t.translationOnly]],prefs.videoMode,mode=>{applyVideoMode(mode);videoSettings();})),field(t.noTranslateShort,segmented([['original',t.originalOnly],['off',t.off]],prefs.videoMode,mode=>{applyVideoMode(mode);videoSettings();})));
      if(session.sameLanguage){const same=el('div',undefined,'card stack');same.append(el('p',t.sameLanguage.replace('{language}',L.languageName(prefs.videoTarget)||prefs.videoTarget)),button(t.translateAnyway,()=>{session.sameLanguage=false;session.paused=false;session.failed=false;translateCues();session.playback?.update();videoHandler?.();session.overlay?.update();videoSettings();},'quiet'));body.append(same);}
      const picker=languageControl(true);picker.querySelector('button').disabled=!needsTranslation();body.append(field(t.videoLanguage,picker));
      if(prefs.videoMode==='off'||prefs.videoMode==='original')body.append(el('small',prefs.videoMode==='off'?t.offHint:t.originalHint));
      body.append(field(t.subtitleSize,segmented([['small',t.small],['medium',t.medium],['large',t.large]],prefs.videoSize,size=>{prefs.videoSize=size;savePreferences({videoSize:size}).catch(report);session.overlay?.update();videoSettings();})),field(t.captionTheme,segmented([['dark',t.dark],['light',t.light]],prefs.captionTheme||'dark',value=>{prefs.captionTheme=value;savePreferences({captionTheme:value}).catch(report);session.overlay?.update();videoSettings();})));
    }else if(videoTab==='learning'){
      const keyed=(text,key,fn)=>{const b=button(text,fn);b.append(el('kbd',key));b.setAttribute('aria-keyshortcuts',key);return b;};
      const controls=el('div',undefined,'tool-row');controls.append(keyed(t.previous,'A',()=>jump(Math.max(0,activeCue-1))),keyed(t.replay,'S',()=>jump(Math.max(0,activeCue))),keyed(t.next,'D',()=>jump(Math.min(cues.length-1,activeCue+1))));body.append(controls);
      const speed=el('select');speed.setAttribute('aria-label',t.playbackSpeed);for(const n of [.5,.75,1,1.25,1.5,2]){const o=el('option',n+'×');o.value=n;speed.append(o);}speed.value=video.playbackRate;speed.onchange=()=>video.playbackRate=Number(speed.value);
      body.append(field(t.playbackSpeed,speed),field(t.repeat+' · R',switchControl(t.repeat,repeat,v=>repeat=v)),field(t.pause+' · Q',switchControl(t.pause,autoPause,v=>autoPause=v)),el('small',t.shortcutsHint));
      const documentView=el('details');documentView.append(el('summary',t.readTranscript),el('article',undefined,'subtitle-document'));body.append(documentView,el('div',undefined,'list video-list'));
    }else{
      body.append(field(t.bufferPause,switchControl(t.bufferPause,prefs.bufferPause,v=>{prefs.bufferPause=v;session.playback?.update();return savePreferences({bufferPause:v});})),field(t.autoVideo,switchControl(t.autoVideo,prefs.autoVideo,v=>{prefs.autoVideo=v;return savePreferences({autoVideo:v});})),el('small',t.videoLanguageHint));
      const files=el('div',undefined,'stack');files.append(el('h3',t.subtitleFiles,'section-title'));const fileRow=el('div',undefined,'row');fileRow.append(button(t.subtitles,importSubtitleFile),button(t.export,()=>download(L.exportSubtitles(cues),'subtitles.srt')),...(subtitleCacheSupported?[button(U.subtitleStatusCopy(locale).retranslate,async()=>{cancel();session.paused=true;session.playback?.update();await request({op:'subtitle-cache-clear',target:prefs.videoTarget});if(session!==videoSession)return;resetSubtitleTranslation();})]:[]),session.retryButton);files.append(fileRow);body.append(files);
      body.append(button(t.modelSettings,showSettings,'text-link'));
    }
    cueList();
  }
  function importSubtitleFile(){const session=videoSession;if(!session)return;const file=el('input');file.type='file';file.accept='.srt,.vtt';file.hidden=true;file.onchange=async()=>{try{const f=file.files[0];if(!f)return;if(f.size>2000000)throw Error('SUBTITLE_TOO_LARGE');const next=L.parseSubtitles(await f.text());if(session!==videoSession)return;session.imported=true;session.failed=false;session.paused=false;session.noCaptions=false;session.sameLanguage=false;mergeCues(next);translateCues();session.overlay?.update();}catch(e){report(e);}finally{file.remove();}};body.append(file);file.click();}
  async function showVideo(){
    clear('video');video=[...document.querySelectorAll('video,audio')].find(v=>v.getClientRects().length)||document.querySelector('video,audio');
    if(!video){body.append(el('p',t.noVideo));videoTimer=setTimeout(showVideo,1200);return;}
    const media=video;
    if(cueMedia!==media||media.currentSrc!==cueMediaSource){cues=[];cueMedia=media;cueMediaSource=media.currentSrc;}
    cues=[];const session=videoSession={src:media.currentSrc,running:false,paused:false,failed:false,imported:false,attempts:0,nextRead:0};
    session.retry=async()=>{if(!subtitleSegmentation||!subtitleEditorial)await configure();session.retryButton.hidden=true;for(const chunk of session.chunks||[]){delete chunk.error;delete chunk.recovery;delete chunk.retryAt;delete chunk.retries;}session.failed=false;session.paused=false;session.attempts=0;session.nextRead=0;session.readBlocked=false;clearTimeout(videoTimer);return readCues(session);};
    // A manually opened player session is restorable on every supported site,
    // including YouTube when automatic opening is disabled.
    rememberVideo(true);
    session.retryButton=button(t.retrySubtitles,session.retry);session.retryButton.hidden=true;videoSettings();session.overlay=mountVideoCaptions(media);note(t.waitSubtitles);
    videoHandler=()=>{
      session.playback?.update();
      if(prefs.videoMode!=='off'&&previousCue>=0&&cues[previousCue]&&media.currentTime>=cues[previousCue].end&&media.currentTime<cues[previousCue].end+1){if(repeat){media.currentTime=cues[previousCue].start;return;}if(autoPause){session.playback?.pauseByUser();previousCue=-1;}}
      const i=cues.findIndex(c=>media.currentTime>=c.start&&media.currentTime<c.end),changed=i!==activeCue;activeCue=i;if(i>=0)previousCue=i;
      const pending=session.chunks?.some(c=>!c.done&&media.currentTime>=c.words[0].start&&media.currentTime<c.words.at(-1).end);const raw=session.originalCues?.find(c=>media.currentTime>=c.start&&media.currentTime<c.end);const shown=prefs.videoMode==='original'?raw:cues[i]||((pending||session.failed)?raw:undefined);session.overlay?.render(shown);
      if(changed)for(const b of body.querySelectorAll('[data-index]'))b.classList.toggle('active',Number(b.dataset.index)===i);
    };media.addEventListener('timeupdate',videoHandler);session.playback=globalThis.CindySubtitlePlayback.create(media,{state:()=>!needsTranslation()||!prefs.bufferPause||session.paused||session.noCaptions?{ready:true,ahead:Infinity}:session.failed||session.chunks?.some(c=>c.error&&c.words.at(-1).end>media.currentTime&&c.words[0].start<=media.currentTime+15*media.playbackRate)?{blocked:true}:!session.words?.length?{ahead:0,ready:false}:L.subtitleBuffer(session.chunks,media.currentTime,media.playbackRate),waiting:()=>note(t.bufferingSubtitles),ready:()=>{if(!session.failed)note(t.subtitlesReady);},error:report});
    session.seekHandler=()=>{const time=media.currentTime,until=time+90*media.playbackRate,busy=(session.chunks||[]).filter(c=>c.busy);if(busy.length&&!busy.some(c=>c.words.at(-1).end>time&&c.words[0].start<=until))cancel();if(L.pendingSubtitleChunks(session.chunks,time,media.playbackRate).length)session.failed=false;translateCues();};media.addEventListener('seeked',session.seekHandler);videoHandler();readCues(session);
  }
  function download(text,name){const u=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),a=el('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
  let selectionButton, selectionStart, selectionDragged=false;
  const selectionEventIsOurs=e=>e.composedPath().includes(host)||e.composedPath().some(n=>n instanceof Element&&n.hasAttribute('data-cindy-captions'));
  document.addEventListener('mousedown',e=>{
    if(!e.isTrusted||e.button!==0||selectionEventIsOurs(e))return;
    selectionButton?.remove();selectionButton=null;
    selectionStart={x:e.clientX,y:e.clientY};selectionDragged=false;
  },{signal:lifecycle.signal});
  document.addEventListener('mousemove',e=>{
    if(!selectionStart||selectionDragged)return;
    selectionDragged=Math.abs(e.clientX-selectionStart.x)>4||Math.abs(e.clientY-selectionStart.y)>4;
  },{passive:true,signal:lifecycle.signal});
  document.addEventListener('mouseup',e=>{
    const dragged=selectionDragged;selectionStart=null;selectionDragged=false;
    if(!e.isTrusted||selectionEventIsOurs(e))return;
    selection();selectionButton?.remove();selectionButton=null;
    // A click or double-click selects text on the page but is not an explicit
    // request for Cindy. Only a real drag may create the contextual entry.
    if(!dragged||!window.getSelection()?.toString().trim()||!selected)return;
    if(!runtimeReady())return;selectionPoint={x:e.clientX,y:e.clientY+12};const h=el('div');h.dataset.cindySelectionEntry='true';isolateHost(h,{position:'fixed',left:Math.min(e.clientX,innerWidth-90)+'px',top:Math.min(e.clientY+12,innerHeight-45)+'px','z-index':'2147483645'});const s=h.attachShadow({mode:'closed'}),root=el('div',undefined,'cindy-root');root.dataset.theme=pageTheme();root.append(button('Cindy',()=>{h.remove();return open('selection');},'primary'));s.append(el('style',U.css),root);document.documentElement.append(h);selectionButton=h;
  },{signal:lifecycle.signal});
  function onRuntimeMessage(m,_sender,reply){if(!runtimeReady())return;if(m?.type==='cindy-learning-progress'){if(_sender.id===api.runtime.id)progressHandlers.get(m.id)?.(m.progress);return;}if(m?.type!=='cindy-ui')return;open(m.action).then(()=>{if(!disposed)reply({ok:true});},e=>{report(e);if(!disposed)reply({ok:false,error:e.message});}).catch(()=>{});return true;}
  api.runtime.onMessage.addListener(onRuntimeMessage);
  let autoOpening=false,nextAutoAttempt=0;
  async function autoOpen(){
    if(!runtimeReady()||autoOpening||videoSession)return;
    const youtube=/(^|\.)youtube\.com$/.test(location.hostname)&&!!document.querySelector('video');
    if(!youtube&&(translated||translations.size))return;
    if(document.querySelector('video,audio'))ensureVideoEntry();
    let stored;
    try{stored=(await extensionCall(()=>api.storage.local.get('cindyReadingPreferences'))).cindyReadingPreferences||{};}catch{return;}
    // YouTube subtitles are enabled on a fresh install. An explicit false is
    // the only opt-out; site translation remains opt-in per origin.
    const enabled=youtube?stored.autoVideo!==false:stored.autoSites?.[location.origin]===true;
    if(!enabled){
      // Keep the one-second navigation timer from re-reading the stored opt-out
      // forever. An explicit settings change runs configure() and restores the
      // current persisted preference before the next automatic attempt.
      if(youtube)prefs.autoVideo=false;
      else if(prefs.autoSites&&typeof prefs.autoSites==='object')prefs.autoSites[location.origin]=false;
      nextAutoAttempt=Date.now()+5000;
      return;
    }
    autoOpening=true;nextAutoAttempt=Date.now()+5000;
    try{await configure();if(youtube&&prefs.autoVideo){makePanel();await showVideo();if(videoSession)videoSession.auto=true;}else if(prefs.autoSites[location.origin]===true){await togglePage();}}catch{}finally{autoOpening=false;}
  }
  sendMessage({type:'cindy-video-resume'}).then(r=>{if(r?.enabled)open('video').catch(()=>{});else autoOpen();}).catch(()=>{});
  let lastURL=location.href;navigationTimer=setInterval(()=>{if(!runtimeReady())return;const youtube=/(^|\.)youtube\.com$/.test(location.hostname);if(!videoSession)ensureVideoEntry();if(lastURL!==location.href){lastURL=location.href;restorePage();close();selectionButton?.remove();selected='';cues=[];autoOpen();}else if(!videoSession&&youtube&&prefs.autoVideo&&Date.now()>=nextAutoAttempt)autoOpen();},1000);
  document.addEventListener('yt-navigate-finish',()=>{ensureVideoEntry();autoOpen();},{signal:lifecycle.signal});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){videoSession?.overlay?.closeSettings();if(!videoSession)hidePanel();selectionButton?.remove();}},{signal:lifecycle.signal});
  // Learning shortcuts follow the video, not the panel: they are only skipped inside editable fields and Cindy's own surfaces.
  function videoShortcut(e){if(!videoSession||!e.isTrusted||e.metaKey||e.ctrlKey||e.altKey||e.shiftKey||prefs.videoMode==='off')return;const path=e.composedPath(),target=path[0];if(target instanceof Element&&(/INPUT|TEXTAREA|SELECT/.test(target.tagName)||target.isContentEditable))return;if(path.some(n=>n instanceof Element&&(n.hasAttribute('data-cindy-panel')||n.hasAttribute('data-cindy-captions'))))return;const actions={a:()=>jump(Math.max(0,activeCue-1)),s:()=>jump(Math.max(0,activeCue)),d:()=>jump(Math.min(cues.length-1,activeCue+1)),q:()=>{autoPause=!autoPause;videoSettings();},r:()=>{repeat=!repeat;videoSettings();}};const run=actions[e.key];if(!run)return;e.preventDefault();e.stopPropagation();run();}
  document.addEventListener('keydown',videoShortcut,{capture:true,signal:lifecycle.signal});
})();
