'use strict';
// Page material is captured only after Send, never on tab selection or panel open.
function readChatPage() {
  const root=document.querySelector('main,article,[role="main"]')||document.body;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  const parts=[];let length=0,count=0,node,truncated=false;
  while((node=walker.nextNode())) {
    if(++count>20000){truncated=true;break;}
    const parent=node.parentElement;
    if(!parent||parent.closest('script,style,noscript,input,textarea,select,[contenteditable], [hidden],[aria-hidden="true"], [data-cindy]'))continue;
    if(!parent.getClientRects().length||getComputedStyle(parent).visibility!=='visible')continue;
    const text=node.textContent.replace(/\s+/g,' ').trim();if(!text)continue;
    const remaining=18000-length;if(remaining<=0){truncated=true;break;}if(text.length>remaining){parts.push(text.slice(0,remaining));truncated=true;break;}
    parts.push(text);length+=text.length+1;
  }
  return {text:parts.join('\n'),source:{url:location.href,title:document.title.slice(0,500)},truncated};
}
(async()=>{
  const $=id=>document.getElementById(id),U=globalThis.CindyUI;
  // Lucide outlines, the icon set of the Cindy app.
  const paths={
    pen:['M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7','M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z'],
    languages:['m5 8 6 6','m4 14 6-6 2-3','M2 5h12','M7 2h1','m22 22-5-10-5 10','M14 18h6'],
    globe:['M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20','M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20','M2 12h20'],
    up:['m5 12 7-7 7 7','M12 19V5'],down:['m6 9 6 6 6-6'],check:['M20 6 9 17l-5-5'],
    copy:['M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2','M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'],
    external:['M15 3h6v6','M10 14 21 3','M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
    list:['M3 12h.01','M3 18h.01','M3 6h.01','M8 12h13','M8 18h13','M8 6h13'],
    gear:['M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z','M12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6'],back:['m15 18-6-6 6-6'],loader:['M21 12a9 9 0 1 1-6.219-8.56'],
    sparkle:['M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.13a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.13 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.96 0z'],
    help:['M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20','M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3','M12 17h.01'],
  };
  function icon(name,size=16,stroke=1.75){
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
    for(const [k,v] of Object.entries({viewBox:'0 0 24 24',width:size,height:size,fill:'none',stroke:'currentColor','stroke-width':stroke,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))svg.setAttribute(k,v);
    for(const d of paths[name]){const p=document.createElementNS(ns,'path');p.setAttribute('d',d);svg.append(p);}
    return svg;
  }
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const en={defaultModel:'Default model',chooseModel:'Choose model',newChat:'New chat',translatePage:'Translate',showOriginal:'Original',reloadPage:'Refresh this page, then try again.',translateHint:'Translate this page into your language',originalHint:'Remove the translations',settings:'Settings',back:'Back',target:'Translate to',webMode:'Display',bilingual:'Bilingual',translationOnly:'Translation only',autoSite:'Translate this site automatically',autoSiteHint:'Applies to {{site}}',selectionButton:'Show Cindy button when selecting text',autoVideo:'Turn on subtitles automatically for videos',translationModel:'Model for translation and subtitles',translationModelHint:'Chosen for Cindy Chrome in Cindy',changeInCindy:'Change in Cindy',tabGroups:'Group the tabs Cindy opens',tabGroupsHint:'When Cindy operates your browser, the tabs it opens go into a red "Cindy automation" group. Your own tabs are never moved.',ask:'Ask about this page…',emptyTitle:'Ask about this page',emptyBody:'Cindy reads the page you are viewing when you send.',suggest:['Summarize this page','List the key points','Explain the hard parts in simple words'],privacy:'Page text is sent to your AI when you send.',restricted:'Open a webpage to chat about it',partial:'Only part of this page was read.',noText:'No readable text on this page. Image-only pages and browser PDFs are not supported yet.',upgrade:'Update Cindy Chrome in Cindy to use webpage chat.',stopped:'Stopped',send:'Send',stop:'Stop',thinking:'Reading the page…',copy:'Copy',copied:'Copied'};
  const zh={defaultModel:'默认模型',chooseModel:'选择模型',newChat:'新聊天',translatePage:'翻译',showOriginal:'原文',reloadPage:'请刷新这个网页后再试。',translateHint:'把这个网页翻译成你的语言',originalHint:'去掉译文',settings:'设置',back:'返回',target:'翻译为',webMode:'显示方式',bilingual:'双语',translationOnly:'仅译文',autoSite:'此网站自动翻译',autoSiteHint:'适用于 {{site}}',selectionButton:'选中文字时显示 Cindy 按钮',autoVideo:'打开视频时自动开启字幕',translationModel:'翻译和字幕使用的模型',translationModelHint:'在 Cindy 中为 Cindy Chrome 选择',changeInCindy:'在 Cindy 中更改',tabGroups:'把 Cindy 打开的标签页放进分组',tabGroupsHint:'Cindy 自动操作浏览器时，它打开的标签页会归入红色的「Cindy 自动操作」分组。你自己的标签页不会被移动。',ask:'问问当前网页…',emptyTitle:'问问这个网页',emptyBody:'发送时，Cindy 会读取你正在看的网页。',suggest:['总结这个网页','列出关键要点','用简单的话解释难懂的部分'],privacy:'发送时会把网页文字交给你配置的 AI。',restricted:'打开一个网页后即可提问',partial:'本次只读取了部分网页内容。',noText:'当前网页没有可读取的文字，暂不支持纯图片页面和浏览器 PDF。',upgrade:'请在 Cindy 中更新 Cindy Chrome 插件后使用网页聊天。',stopped:'已停止',send:'发送',stop:'停止',thinking:'正在阅读网页…',copy:'复制',copied:'已复制'};
  let locale='en',copy=en,tab=null,windowId,revision=0,lookup=0,pending=null,ready=false,features=[];
  const chats=new Map();let current=null;
  // Model picker state. selection = a configuration copy ({providerId,modelId,agent,effort?,fast?,favoriteUid?});
  // null = follow the plugin's model setting in Cindy.
  let selection=null,modelData={state:'idle',models:[],favorites:[],recents:[],preferences:'unsupported'},memory={},picker=null;
  $('new-chat').append(icon('pen',17));
  // One-click page translation on every page; video subtitles stay in the video player itself.
  // Page translation runs in the page without opening its panel; the button shows the state.
  let pageState='idle';
  function paintTools(){$('tools-label').textContent=pageState==='on'?copy.showOriginal:copy.translatePage;$('tools-icon').replaceChildren(icon(pageState==='busy'?'loader':'languages',15));$('tools').classList.toggle('busy',pageState==='busy');$('tools').classList.toggle('on',pageState==='on');$('tools').title=pageState==='on'?copy.originalHint:copy.translateHint;$('tools').disabled=!tab||pageState==='busy';$('tools').hidden=!tab;}
  async function readPageState(){const asked=tab;pageState='idle';paintTools();if(!asked)return;try{const r=await chrome.tabs.sendMessage(asked.id,{type:'cindy-page',action:'state'});if(tab===asked&&pageState==='idle'&&r?.translated){pageState='on';paintTools();}}catch{}}
  $('page-icon').append(icon('globe',13));$('send').append(icon('up',15,2.25));

  function setStatus(text,error=false){$('status').textContent=text||'';$('status').classList.toggle('error',!!text&&error);}
  function labels(){copy=locale==='zh-CN'?zh:en;document.documentElement.lang=locale;
    for(const [id,label] of [['new-chat',copy.newChat],['settings',copy.settings],['send',copy.send],['stop',copy.stop]]){$(id).setAttribute('aria-label',label);$(id).title=label;}
    paintTools();
    $('question').placeholder=copy.ask;$('question').setAttribute('aria-label',copy.ask);$('privacy').textContent=copy.privacy;
    $('model').title=copy.chooseModel;picker?.paintTrigger();}
  function grow(){const q=$('question');q.style.height='auto';q.style.height=Math.min(q.scrollHeight,200)+'px';}
  function render(){
    const list=$('messages');list.replaceChildren();
    if(!current?.messages.length&&!pending){
      const box=el('div','empty');box.append(el('h1',undefined,copy.emptyTitle),el('p',undefined,tab?copy.emptyBody:copy.restricted));
      const suggestions=el('div','suggestions');
      copy.suggest.forEach((text,i)=>{const b=el('button','suggestion');b.type='button';b.disabled=!tab||!ready;b.append(icon(['sparkle','list','help'][i],15),el('span',undefined,text));b.onclick=()=>{$('question').value=text;grow();$('composer').requestSubmit();};suggestions.append(b);});
      box.append(suggestions);list.append(box);return;
    }
    for(const item of current?.messages||[]){
      // Answers render as Markdown like the Cindy app; questions stay as typed.
      const p=item.role==='assistant'?el('div','message assistant'):el('div','message '+item.role,item.text);
      if(item.role==='assistant'){p.append(markdown(item.text));
        const meta=el('div','meta'),c=el('button','icon-button');c.type='button';c.title=copy.copy;c.setAttribute('aria-label',copy.copy);c.append(icon('copy',14));
        c.onclick=async()=>{try{await navigator.clipboard.writeText(item.text);c.replaceChildren(icon('check',14));c.title=copy.copied;setTimeout(()=>{c.replaceChildren(icon('copy',14));c.title=copy.copy;},1500);}catch{}};
        meta.append(c);const label=[item.model,item.source?.title||item.source?.url].filter(Boolean).join(' · ');if(label)meta.append(el('span','source',label));p.append(meta);
      }
      list.append(p);
    }
    if(pending){streamNode=el('div','message assistant-live');list.append(streamNode);paintStream();}
    list.scrollTop=list.scrollHeight;
  }
  // The answer being written (side panel progress carries the text so far); "reading the page" until it starts.
  let streamNode=null,streamText='';
  const markdown=text=>globalThis.CindyMarkdown.render(text,{copyLabel:copy.copy,copiedLabel:copy.copied,icon:name=>icon(name,14)});
  function paintStream(){if(!streamNode)return;const list=$('messages'),atEnd=list.scrollHeight-list.scrollTop-list.clientHeight<48;
    streamNode.replaceChildren(streamText?markdown(streamText):el('span','thinking',copy.thinking));if(atEnd)list.scrollTop=list.scrollHeight;}
  chrome.runtime.onMessage?.addListener(m=>{if(m?.type==='cindy-learning-progress'&&m.id===pending&&typeof m.progress?.text==='string'){streamText=m.progress.text;paintStream();}});
  function controls(){const busy=!!pending;$('stop').hidden=!busy;$('send').hidden=busy;$('send').disabled=!tab||!ready||!$('question').value.trim();$('new-chat').hidden=!current?.messages.length;$('new-chat').disabled=busy;$('tools').disabled=!tab;$('question').disabled=busy;$('model').disabled=busy;}
  function cancel(){if(pending){const id=pending;pending=null;chrome.runtime.sendMessage({type:'cindy-cancel',id}).catch(()=>{});controls();render();}}
  async function refresh(){const generation=++lookup;const [next]=await chrome.tabs.query({active:true,windowId});if(generation!==lookup)return;
    const changed=tab?.id!==next?.id||tab?.url!==next?.url;
    if(changed){revision++;if(current)current.draft=$('question').value;cancel();}
    tab=next&&/^https?:/.test(next.url||'')?next:null;
    $('page').textContent=tab?.title||tab?.url||copy.restricted;$('page').title=tab?.url||'';$('page-chip').classList.toggle('unavailable',!tab);if(changed)readPageState();else paintTools();
    if(changed){const key=tab?tab.id+'\n'+tab.url:'';current=key?chats.get(key):null;if(key&&!current){current={id:crypto.randomUUID(),messages:[],draft:''};chats.set(key,current);} $('question').value=current?.draft||'';grow();setStatus('');render();}controls();
  }
  async function configure(){const r=await chrome.runtime.sendMessage({type:'cindy-learning',id:crypto.randomUUID(),request:{op:'config'}});if(!r?.ok)throw Error(r?.error||'CINDY_DISCONNECTED');locale=r.locale||'en';features=r.features||[];labels();ready=features.includes('webpage-chat-v1');if(!ready)setStatus(copy.upgrade);render();controls();}

  // ---- Model picker ----
  const store=chrome.storage?.local;
  async function loadModels(){
    if(!features.includes('webpage-chat-models-v1')){modelData={...modelData,state:'ready'};picker?.refresh();return;}
    if(modelData.state!=='ready')modelData={...modelData,state:'loading'};picker?.refresh();
    try{const r=await chrome.runtime.sendMessage({type:'cindy-learning',id:crypto.randomUUID(),request:{op:'models'}});if(!r?.ok)throw Error(r?.error);
      modelData={state:'ready',models:Array.isArray(r.models)?r.models:[],favorites:Array.isArray(r.favorites)?r.favorites:[],recents:Array.isArray(r.recents)?r.recents:[],preferences:r.preferences||'unsupported'};}
    // An older Cindy does not relay the model list yet: say so instead of showing an empty list.
    catch(error){if(modelData.state!=='ready'||error?.message==='INVALID_OPERATION')modelData={...modelData,state:'failed',error:error?.message};}
    picker?.refresh();
    if(selection&&modelData.state==='ready'&&!picker.resolveName(selection))setSelection(null);
    if(selection?.favoriteUid&&modelData.preferences==='ok'&&!modelData.favorites.some(f=>f.uid===selection.favoriteUid)){const {favoriteUid,...rest}=selection;setSelection(rest);}
  }
  function setSelection(next){selection=next;if(store)(next?store.set({sidepanelModel:next}):store.remove('sidepanelModel')).catch(()=>{});picker?.paintTrigger();}
  // The exact route Cindy runs: the picked engine, effort (or the model's recommended one) and Fast.
  function routeFor(cfg){
    const m=cfg&&modelData.models.find(m=>m.route.providerId===cfg.providerId&&m.route.model===cfg.modelId&&m.route.agentKind===cfg.agent);
    return m?{agentKind:cfg.agent,providerId:cfg.providerId,model:cfg.modelId,effort:cfg.effort||m.defaultEffort||m.route.effort||'',fastMode:cfg.fast||false}:null;
  }
  picker=globalThis.CindyModelPicker.create({
    trigger:$('model'),locale:()=>locale,data:()=>modelData,selected:()=>selection,
    select:cfg=>setSelection(cfg),
    favorite:async mutation=>{const r=await chrome.runtime.sendMessage({type:'cindy-learning',id:crypto.randomUUID(),request:{op:'model-favorite',mutation}});if(!r?.ok)throw Error(r?.error||'FAVORITE_FAILED');modelData={...modelData,favorites:r.favorites||[]};},
    memory:{get:k=>memory[k],set:(k,v)=>{memory[k]=v;store?.set({sidepanelModelMemory:memory}).catch(()=>{});},delete:k=>{delete memory[k];store?.set({sidepanelModelMemory:memory}).catch(()=>{});}},
    configure:()=>{chrome.tabs.create({url:'cindy://settings/providers'}).catch(()=>{});},
    status:{defaultLabel:()=>copy.defaultModel,reload:()=>loadModels(),error:text=>setStatus(text,true),done:()=>$('question').focus()},
  });
  // The app refreshes its catalog every time the picker opens; so does the side panel.
  $('model').addEventListener('pointerdown',()=>{if(!picker.isOpen&&modelData.state!=='loading')loadModels();});

  $('composer').addEventListener('submit',async event=>{
    event.preventDefault();const question=$('question').value.trim();if(!question||pending)return;
    const chat=current,chosen=tab,generation=revision,model=routeFor(selection),modelName=selection&&picker.resolveName(selection);if(!chat||!chosen)return;
    const id=crypto.randomUUID();let userMessage;pending=id;streamText='';picker.close();controls();setStatus('');
    try {
      await configure();if(!ready||pending!==id)return;
      const results=await chrome.scripting.executeScript({target:{tabId:chosen.id},func:readChatPage});
      const result=results.find(r=>r.frameId===0),page=result?.result;
      if(pending!==id||revision!==generation||page?.source.url!==chosen.url)throw Error('PAGE_CHANGED');
      if(!page?.text?.trim()){ setStatus(copy.noText);return; }
      // Recent turns within the relay's 4000-character context budget. Each message is capped first, so
      // a long answer is shortened instead of pushing the whole last turn out.
      let context='';for(const m of [...chat.messages].reverse()){const text=m.text.length>1800?m.text.slice(0,1800)+'…':m.text,line=m.role+': '+text+'\n';if(line.length+context.length>4000)break;context=line+context;}
      userMessage={role:'user',text:question};chat.messages.push(userMessage);$('question').value='';grow();render();
      const response=await chrome.runtime.sendMessage({type:'cindy-learning',id,tabId:chosen.id,documentId:result.documentId,chatId:chat.id,request:{op:'conversation',scenario:'webpage-chat',instruction:question,text:page.text,context,source:page.source,...(model?{route:model}:{})}});
      if(pending!==id||revision!==generation)return;
      if(!response?.ok)throw Error(response?.error||'MODEL_UNAVAILABLE');
      chat.messages.push({role:'assistant',text:response.text,source:page.source,model:modelName||modelData.models.find(m=>m.route.model===response.model)?.name||response.model||''});setStatus(page.truncated?copy.partial:'');
    }catch(error){if(pending===id){if(chat.messages.at(-1)===userMessage)chat.messages.pop();$('question').value=question;grow();setStatus(U.error(error.message,locale),true);}}
    finally{if(pending===id){pending=null;render();controls();$('question').focus();}}
  });
  $('question').addEventListener('input',()=>{grow();controls();});
  $('question').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('composer').requestSubmit();}});
  $('stop').onclick=()=>{cancel();setStatus(copy.stopped);};
  $('new-chat').onclick=()=>{if(!current||pending)return;current.id=crypto.randomUUID();current.messages=[];current.draft='';$('question').value='';grow();setStatus('');render();controls();$('question').focus();};
  $('tools').onclick=async()=>{
    const asked=tab;if(!asked||pageState==='busy')return;const was=pageState;pageState='busy';paintTools();setStatus('');
    try{const r=await chrome.tabs.sendMessage(asked.id,{type:'cindy-page',action:'translate'});if(tab!==asked)return;
      // No answer: the page still runs a script from before the extension updated.
      if(!r){pageState=was;setStatus(copy.reloadPage,true);}
      else{pageState=r.translated?'on':'idle';if(!r.ok)setStatus(U.error(r.error,locale),true);}}
    catch{if(tab===asked){pageState=was;setStatus(copy.reloadPage,true);}}
    paintTools();
  };
  // ---- Settings: the same preferences the page panel used, so pages pick them up as before ----
  $('settings').append(icon('gear',17));
  const L=globalThis.CindyLearning;
  async function readPrefs(){try{return (await chrome.storage.local.get('cindyReadingPreferences')).cindyReadingPreferences||{};}catch{return {};}}
  // One read-merge-write at a time, so two quick changes cannot overwrite each other.
  let saving=Promise.resolve();
  function savePrefs(changes){const run=saving.then(()=>writePrefs(changes));saving=run.catch(()=>{});return run;}
  async function writePrefs(changes){const stored=await readPrefs();const merged={...stored,...changes};
    if(changes.autoSites){const sites={...(stored.autoSites&&typeof stored.autoSites==='object'?stored.autoSites:{})};for(const [o,v] of Object.entries(changes.autoSites)){if(v===undefined)delete sites[o];else sites[o]=v;}merged.autoSites=sites;}
    await chrome.storage.local.set({cindyReadingPreferences:merged});}
  function toggleRow(label,hint,checked,onChange){const row=el('label','setting-row'),text=el('span','setting-text');text.append(el('span',undefined,label));if(hint)text.append(el('small',undefined,hint));
    const input=el('input','switch');input.type='checkbox';input.setAttribute('role','switch');input.checked=checked;input.onchange=()=>onChange(input.checked).catch(()=>{input.checked=!input.checked;});row.append(text,input);return row;}
  async function showSettings(){
    const view=$('settings-view'),prefs=await readPrefs();view.replaceChildren();
    const head=el('div','settings-head'),back=el('button','icon-button');back.type='button';back.title=copy.back;back.setAttribute('aria-label',copy.back);back.append(icon('back',17));back.onclick=hideSettings;head.append(back,el('h2',undefined,copy.settings));view.append(head);
    const target=L.validTarget(prefs.webTarget)?prefs.webTarget:(locale==='zh-CN'?'zh-CN':'en');
    const langRow=el('label','setting-row'),select=el('select','setting-select');langRow.append(el('span','setting-text',copy.target),select);
    for(const code of new Set([target,...L.commonLanguages])){const o=el('option',undefined,L.languageName(code));o.value=code;o.selected=code===target;select.append(o);}
    select.onchange=()=>savePrefs({webTarget:select.value}).catch(()=>{});
    // Bilingual or translation only; open pages switch what is already translated without new model calls.
    const modeRow=el('div','setting-row'),seg=el('div','segmented');seg.setAttribute('role','radiogroup');seg.setAttribute('aria-label',copy.webMode);modeRow.append(el('span','setting-text',copy.webMode),seg);
    for(const [value,label] of [['both',copy.bilingual],['translation',copy.translationOnly]]){const b=el('button',undefined,label);b.type='button';b.setAttribute('role','radio');b.setAttribute('aria-checked',String((prefs.webMode==='translation'?'translation':'both')===value));
      b.onclick=()=>{for(const x of seg.children)x.setAttribute('aria-checked',String(x===b));savePrefs({webMode:value}).catch(()=>{});};seg.append(b);}
    const group=el('div','setting-group');group.append(langRow,modeRow);
    let origin='';try{origin=tab?new URL(tab.url).origin:'';}catch{}
    if(origin)group.append(toggleRow(copy.autoSite,copy.autoSiteHint.replace('{{site}}',new URL(origin).hostname),prefs.autoSites?.[origin]===true,v=>savePrefs({autoSites:{[origin]:v?true:undefined}})));
    const group2=el('div','setting-group');
    group2.append(toggleRow(copy.selectionButton,'',prefs.selectionButton===true,v=>savePrefs({selectionButton:v})),toggleRow(copy.autoVideo,'',prefs.autoVideo!==false,v=>savePrefs({autoVideo:v})));
    // Tab groups need Chrome's optional tabGroups permission: the switch shows whether it is granted,
    // and asks Chrome only when turned on (the click is the user gesture Chrome requires).
    const group3=el('div','setting-group'),tabAccess={permissions:['tabGroups']};
    if(chrome.permissions){
      const granted=await chrome.permissions.contains(tabAccess).catch(()=>false);
      const art=el('div','setting-art');art.append(globalThis.CindyTabGroupArt(locale==='zh-CN'||locale==='zh-TW',{compact:true}));
      group3.append(toggleRow(copy.tabGroups,copy.tabGroupsHint,granted,async v=>{const ok=v?await chrome.permissions.request(tabAccess):await chrome.permissions.remove(tabAccess);if(!ok)throw Error('PERMISSION');}),art);
    }
    // Translation and subtitles keep using the model chosen for the plugin in Cindy (the chat model is picked in the composer).
    const model=el('button','setting-row link');model.type='button';const mt=el('span','setting-text');mt.append(el('span',undefined,copy.translationModel),el('small',undefined,copy.translationModelHint));
    const go=el('span','setting-action');go.append(el('span',undefined,copy.changeInCindy),icon('external',14));model.append(mt,go);
    model.onclick=()=>chrome.tabs.create({url:'cindy://plugins/my-browser'}).catch(()=>{});group2.append(model);
    view.append(group,group2);if(group3.childElementCount)view.append(group3);
    view.hidden=false;$('messages').hidden=true;document.querySelector('footer').hidden=true;$('settings').setAttribute('aria-pressed','true');
  }
  function hideSettings(){$('settings-view').hidden=true;$('messages').hidden=false;document.querySelector('footer').hidden=false;$('settings').setAttribute('aria-pressed','false');}
  $('settings').onclick=()=>$('settings-view').hidden?showSettings():hideSettings();
  // The page panel's settings button opens the side panel here.
  chrome.runtime.onMessage?.addListener(m=>{if(m?.type==='cindy-sidepanel-view'&&m.view==='settings'){chrome.storage.session?.remove('sidepanelView').catch(()=>{});showSettings();}});
  window.addEventListener('pagehide',cancel);
  chrome.tabs.onActivated.addListener(info=>{if(info.windowId===windowId)refresh().catch(()=>{});});
  chrome.tabs.onUpdated.addListener((id,change)=>{if(id!==tab?.id)return;if(change.status==='loading'){revision++;cancel();}if(change.url||change.status==='complete')refresh().catch(()=>{});});
  windowId=(await chrome.windows.getCurrent()).id;
  try{const saved=await store?.get(['sidepanelModel','sidepanelModelMemory']);const c=saved?.sidepanelModel;if(c&&typeof c==='object'&&typeof c.modelId==='string')selection=c;if(saved?.sidepanelModelMemory&&typeof saved.sidepanelModelMemory==='object')memory=saved.sidepanelModelMemory;}catch{}
  labels();await refresh();
  try{await configure();}catch(error){setStatus(U.error(error.message,locale),true);ready=true;controls();render();}
  if(features.includes('webpage-chat-models-v1'))loadModels();
  // Opened from the page panel's settings button: go straight to settings, in the right language.
  try{const r=await chrome.storage.session?.get('sidepanelView');if(r?.sidepanelView==='settings'){chrome.storage.session.remove('sidepanelView').catch(()=>{});showSettings();}}catch{}
})();
