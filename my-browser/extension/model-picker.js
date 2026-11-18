'use strict';
// The side panel's model picker, rebuilt after the Cindy app's composer picker
// (UnifiedModelPanel / UnifiedModelRow / ModelConfigFlyout): rail of views, search,
// favorites and recents as configuration copies, effort slider, Fast and engine.
// Data comes only from what Cindy gives plugins; nothing here calls a model.
(()=>{
  const NS='http://www.w3.org/2000/svg',MARKS=()=>globalThis.CindyModelMarks||{};
  const LIST_MIN=160,LIST_MAX=264;
  const EFFORT_ORDER=['none','minimal','low','medium','high','xhigh','max','ultra'];
  const TIER={none:'#a3a3a3',minimal:'#2AAE5B',low:'#2AAE5B',medium:'#14B8A6',high:'#3B82F6',xhigh:'#4F46E5',max:'#8B5CF6',ultra:'#8B5CF6'};
  const ENGINE={cc:{label:'Claude Code',short:'Claude',color:'#d97757'},codex:{label:'Codex',short:'Codex',color:'#7a9dff'},pi:{label:'Pi',short:'Pi',color:'#a78bfa'}};
  const COPY={
    en:{search:'Search models…',recent:'Recent',favorites:'Favorites',all:'All',list:'Model list',noFavorites:'No favorites yet — hover a model and hit ☆ to pin it here',noRecent:'No recent models yet — pick a model and it will show up here',noMatch:'No matching models',loading:'Loading models…',failed:'Could not load models.',retry:'Retry',configure:'Configure models',save:'Save to favorites',unsave:'Remove from favorites',customize:'Customize',context:'context',faster:'Faster',smarter:'Smarter',recommended:'Recommended',fast:'Fast · priority speed · uses more quota',recommendedSetup:'Recommended setup',customized:'Customized',reset:'Reset to recommended',savedSetup:'Saved setup',prefsDenied:'Allow Cindy Chrome to read your model favorites in Cindy to see favorites and recent models here.',prefsUnsupported:'Update Cindy to see your favorites and recent models here.',prefsUnavailable:'Open Cindy to load your favorites and recent models.',updateCindy:'Update Cindy to choose models here.',favoriteFailed:'Could not update favorites.',
      efforts:{none:'Off',minimal:'Minimal',low:'Low',medium:'Medium',high:'High',xhigh:'Extra High',max:'Maximum',ultra:'Ultra'},compact:{xhigh:'Extra',max:'Max'}},
    'zh-CN':{search:'搜索模型…',recent:'最近',favorites:'收藏',all:'全部',list:'模型列表',noFavorites:'还没有收藏——把鼠标停到模型行上，点 ☆ 存到这里',noRecent:'还没有最近使用——选一个模型后，它会出现在这里',noMatch:'没有匹配的模型',loading:'正在读取模型…',failed:'读取模型失败。',retry:'重试',configure:'配置模型',save:'存为收藏',unsave:'取消收藏',customize:'自定义',context:'上下文',faster:'更快',smarter:'更智能',recommended:'推荐',fast:'快速 · 优先加速 · 消耗更多配额',recommendedSetup:'推荐配置',customized:'已自定义',reset:'恢复推荐',savedSetup:'收藏配置',prefsDenied:'在 Cindy 中允许 Cindy Chrome 读取模型收藏后，这里会显示你的收藏和最近使用。',prefsUnsupported:'更新 Cindy 后，这里会显示你的收藏和最近使用。',prefsUnavailable:'打开 Cindy 后即可读取你的收藏和最近使用。',updateCindy:'更新 Cindy 后即可在这里选择模型。',favoriteFailed:'收藏没有改成功。',
      efforts:{none:'关闭',minimal:'最小',low:'低',medium:'中',high:'高',xhigh:'超高',max:'最高',ultra:'极致'},compact:{}},
  };
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  function svg(size,viewBox='0 0 24 24'){const s=document.createElementNS(NS,'svg');s.setAttribute('viewBox',viewBox);s.setAttribute('width',size);s.setAttribute('height',size);s.setAttribute('aria-hidden','true');return s;}
  function path(parent,d,attrs={}){const p=document.createElementNS(NS,'path');p.setAttribute('d',d);for(const [k,v] of Object.entries({fill:'currentColor',...attrs}))p.setAttribute(k,v);parent.append(p);return p;}
  const LUCIDE={search:['m21 21-4.34-4.34','M11 3a8 8 0 1 0 0 16 8 8 0 1 0 0-16'],history:['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8','M3 3v5h5','M12 7v5l4 2'],star:['M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z'],grid:['M3 3h7v7H3z','M14 3h7v7h-7z','M14 14h7v7h-7z','M3 14h7v7H3z'],sliders:['M10 5H3','M12 19H3','M14 3v4','M16 17v4','M21 12h-9','M21 19h-5','M21 5h-7','M8 10v4','M8 12H3'],plus:['M5 12h14','M12 5v14'],check:['M20 6 9 17l-5-5'],down:['m6 9 6 6 6-6'],zap:['M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z']};
  function lucide(name,size,{fill=false,stroke=2}={}){const s=svg(size);for(const d of LUCIDE[name])path(s,d,{fill:fill?'currentColor':'none',stroke:'currentColor','stroke-width':stroke,'stroke-linecap':'round','stroke-linejoin':'round'});return s;}

  // ---- Brand and engine marks (same data and rules as the app's ModelIconMark/ProviderMark) ----
  function providerMark(model,size=13){
    const m=MARKS(),kind=(m.logos?.[model.logoKind]||['anthropic','openai','openai-spectrum','cindy','xd'].includes(model.logoKind))?model.logoKind:m.byId?.[model.providerId];
    if(kind==='anthropic')return single(m.anthropic,size);
    if(kind==='openai'||kind==='openai-spectrum')return single(m.openai,size);
    if(kind==='cindy')return cindyMark(size);
    if(kind==='xd'){const s=svg(size,m.xd.viewBox);s.setAttribute('width',15);s.setAttribute('height',9);for(const d of m.xd.paths)path(s,d);return s;}
    if(kind&&m.logos?.[kind])return single(m.logos[kind],size);
    const name=(model.provider||model.providerId||'').trim();if(!name)return el('span');
    return el('span','monogram',Array.from(name)[0].toUpperCase());
  }
  function modelMark(model,size=13){
    const icon=(model.icon||'').toLowerCase();
    if(/claude|anthropic/.test(icon))return single(MARKS().anthropic,size);
    if(/codex|openai|gpt/.test(icon))return single(MARKS().openai,size);
    if(/cindy|xd/.test(icon))return cindyMark(size);
    return providerMark(model,size);
  }
  function single(d,size){const s=svg(size);if(d)path(s,d);return s;}
  function cindyMark(size){const m=MARKS().cindy||{},s=svg(size),g=document.createElementNS(NS,'g');g.setAttribute('transform',m.transform||'');path(g,m.path||'');path(g,m.earring||'',{fill:m.earringColor||'#F70121'});s.append(g);return s;}
  function engineMark(agent,size=12){
    const m=MARKS(),s=svg(size);
    if(agent==='cc')path(s,m.claudeCode||'',{'fill-rule':'evenodd'});
    else if(agent==='codex'){const g=document.createElementNS(NS,'g');g.setAttribute('transform','translate(12 12) scale(1.1) translate(-12 -12)');path(g,(m.codexOutline||'')+'z',{fill:'none',stroke:'currentColor','stroke-width':2,'stroke-linejoin':'round'});path(g,m.codexGlyphs||'',{stroke:'currentColor','stroke-width':.5,'stroke-linejoin':'round'});s.append(g);}
    else for(const d of ['M3.6 6.6h16.8','M8.4 6.6v11.8','M15.6 6.6v9.6c0 1.5.9 2.2 2.4 2.2'])path(s,d,{fill:'none',stroke:'currentColor','stroke-width':2.4,'stroke-linecap':'round','stroke-linejoin':'round'});
    return s;
  }
  const formatContext=t=>t>=1e6?`${Number.isInteger(t/1e6)?t/1e6:Number((t/1e6).toFixed(1))}M`:t>=1000?`${Number.isInteger(t/1000)?t/1000:Number((t/1000).toFixed(0))}K`:String(t);

  // ---- Catalog: one row per provider+model, engines as candidates ----
  function catalog(list){
    const rows=new Map();
    for(const m of list||[]){
      const key=m.route.providerId+'\n'+m.route.model;
      let row=rows.get(key);
      if(!row){row={key,providerId:m.route.providerId,modelId:m.route.model,name:m.name,provider:m.provider,description:m.description,icon:m.icon,logoKind:m.logoKind,contextWindow:m.contextWindow,visible:m.visible!==false,engines:[]};rows.set(key,row);}
      row.visible||=m.visible!==false;
      row.engines.push({agent:m.route.agentKind,efforts:(m.efforts||[]).filter(e=>EFFORT_ORDER.includes(e)).sort((a,b)=>EFFORT_ORDER.indexOf(a)-EFFORT_ORDER.indexOf(b)),defaultEffort:m.defaultEffort||m.route.effort||'',supportsFastMode:m.supportsFastMode===true,route:m.route});
    }
    return [...rows.values()];
  }
  const sameConfig=(a,b)=>!!a&&!!b&&a.providerId===b.providerId&&a.modelId===b.modelId&&a.agent===b.agent&&(a.effort||'')===(b.effort||'')&&(a.fast||false)===(b.fast||false);
  const configOf=c=>({providerId:c.providerId,modelId:c.modelId,agent:c.agent,...(c.effort?{effort:c.effort}:{}),...(c.fast?{fast:c.fast}:{})});

  function create({trigger,locale:getLocale,data,selected,select,favorite,memory,configure,status}){
    let copy=COPY.en,host=null,panel=null,inner=null,list=null,rail=null,search=null,flyout=null,view='all',query='',rows=[],flash=null,closing=false;
    const engineOf=(row,cfg)=>row.engines.find(e=>e.agent===cfg?.agent)||row.engines[0];
    // Effective configuration of a model row: the live selection, then the row's memory, then recommended.
    function rowConfig(row){
      const sel=selected();
      if(sel&&!sel.favoriteUid&&sel.providerId===row.providerId&&sel.modelId===row.modelId&&row.engines.some(e=>e.agent===sel.agent))return configOf(sel);
      const mem=memory.get(row.key);const engine=engineOf(row,mem);
      return configOf({providerId:row.providerId,modelId:row.modelId,agent:engine.agent,effort:mem&&mem.agent===engine.agent&&engine.efforts.includes(mem.effort)?mem.effort:undefined,fast:mem&&mem.agent===engine.agent&&engine.supportsFastMode?mem.fast:undefined});
    }
    const resolve=cfg=>{const row=rows.find(r=>r.providerId===cfg.providerId&&r.modelId===cfg.modelId);return row&&row.engines.some(e=>e.agent===cfg.agent)?row:null;};
    const label=(cfg,row)=>{const e=engineOf(row,cfg);const effort=cfg.effort||e.defaultEffort;return {engine:e,effort};};
    function triple(cfg,row){
      const {engine,effort}=label(cfg,row),box=el('span','triple');
      const mark=engineMark(engine.agent,12);box.append(mark);
      if(effort)box.append(el('span','effort',copy.efforts[effort]||effort));
      if(cfg.fast){const z=lucide('zap',11,{fill:true,stroke:1.5});z.classList.add('bolt');box.append(z);}
      box.title=[ENGINE[engine.agent]?.short,effort&&(copy.efforts[effort]||effort),cfg.fast&&(getLocale()==='zh-CN'?'快速':'Fast')].filter(Boolean).join(' · ');
      return box;
    }

    // ---- Trigger ----
    function paintTrigger(){
      copy=COPY[getLocale()]||COPY.en;const sel=selected(),row=sel&&resolve(sel);
      const box=trigger;box.replaceChildren();
      if(sel&&row){
        const icon=el('span','trigger-icon');icon.append(modelMark(row,13));box.append(icon,el('span','trigger-name',row.name));
        const {engine,effort}=label(sel,row);const em=el('span','trigger-engine');em.append(engineMark(engine.agent,12));box.append(em);
        if(effort)box.append(el('span','trigger-effort',getLocale()==='zh-CN'?copy.efforts[effort]:(copy.compact[effort]||copy.efforts[effort]||effort)));
        if(sel.fast){const z=el('span','trigger-bolt');z.append(lucide('zap',13,{fill:true,stroke:1.5}));box.append(z);}
      }else box.append(el('span','trigger-name',sel?.label||status.defaultLabel()));
      const chev=el('span','trigger-chevron');chev.append(lucide('down',14));box.append(chev);
      box.setAttribute('aria-expanded',String(!!host));
    }

    // ---- Panel ----
    function open(){
      if(host||trigger.disabled)return;copy=COPY[getLocale()]||COPY.en;view='all';query='';rows=catalog(data().models);
      host=el('div','mp-host');host.setAttribute('role','dialog');panel=el('div','mp-panel');inner=el('div','mp-inner');
      const searchRow=el('div','mp-search');searchRow.append(lucide('search',14));search=el('input');search.type='text';search.placeholder=copy.search;search.setAttribute('aria-label',copy.search);searchRow.append(search);
      const body=el('div','mp-body');rail=el('div','mp-rail');list=el('div','mp-list');list.setAttribute('role','listbox');list.setAttribute('aria-label',copy.list);body.append(rail,list);
      const footer=el('div','mp-footer'),cfg=el('button','mp-configure');cfg.type='button';cfg.append(lucide('plus',14),el('span',undefined,copy.configure));cfg.onclick=()=>{close();configure();};footer.append(cfg);
      inner.append(searchRow,body,footer);panel.append(inner);host.append(panel);document.body.append(host);
      search.addEventListener('input',()=>{query=search.value;draw();});
      paintTrigger();draw(true);place(true);
      document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',keys,true);window.addEventListener('resize',close);
    }
    function place(initial){
      const t=trigger.getBoundingClientRect(),vw=innerWidth,vh=innerHeight,edge=(trigger.closest('form')||trigger).getBoundingClientRect().right;
      const width=Math.max(Math.min(Math.max(300,Math.min(460,vw-24)),vw-16,edge-8),t.width);
      const bottom=vh-t.top+6,right=Math.max(8,vw-edge);
      const height=fit();
      Object.assign(host.style,{right:right+'px',bottom:bottom+'px'});
      if(!initial||matchMedia('(prefers-reduced-motion: reduce)').matches){Object.assign(panel.style,{width:width+'px',height:height+'px'});panel.classList.add('settled');settle();return;}
      Object.assign(panel.style,{width:t.width+'px',height:t.height+'px',borderRadius:t.height/2+'px',transform:`translateY(${t.height+6}px)`});
      requestAnimationFrame(()=>requestAnimationFrame(()=>{if(!panel)return;panel.classList.add('open');Object.assign(panel.style,{width:width+'px',height:height+'px',borderRadius:'12px',transform:'none'});setTimeout(()=>{panel?.classList.add('settled');settle();},220);}));
    }
    // Fit the list to its content (capped). Measured when the panel opens or the catalog first
    // arrives, not on view switches, so moving between Recent/Favorites/All does not jump.
    function fit(){
      const t=trigger.getBoundingClientRect(),body=inner.children[1];
      body.style.height=Math.min(LIST_MAX,Math.max(LIST_MIN,list.scrollHeight,rail.scrollHeight))+'px';
      return Math.min(Math.min(inner.firstChild.offsetHeight+body.offsetHeight+inner.lastChild.offsetHeight,560,innerHeight-120)+2,t.top-6-8);
    }
    function settle(){search?.focus({preventScroll:true});scrollToSelected();}
    function close(){
      if(!host||closing)return;closeFlyout();closing=true;
      document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',keys,true);window.removeEventListener('resize',close);
      const h=host,p=panel,t=trigger.getBoundingClientRect();host=panel=null;
      p.classList.remove('settled');p.classList.add('closing');Object.assign(p.style,{width:t.width+'px',height:t.height+'px',borderRadius:t.height/2+'px',transform:`translateY(${t.height+6}px)`});
      setTimeout(()=>{h.remove();closing=false;},matchMedia('(prefers-reduced-motion: reduce)').matches?0:240);
      paintTrigger();
    }
    function outside(e){if(!host)return;if(host.contains(e.target)||trigger.contains(e.target)||flyout?.contains(e.target))return;close();}
    function keys(e){
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(flyout){const row=flyout.row;closeFlyout();row?.focus();}else{close();trigger.focus();}return;}
      const row=e.target.closest?.('.mp-row');if(!row||e.target!==row)return;
      if(e.key==='Enter'||e.key===' '){e.preventDefault();row.click();}
      else if(e.key==='ArrowLeft'&&row.dataset.custom){e.preventDefault();row.querySelector('.mp-customize')?.click();}
    }

    // ---- Rail ----
    function drawRail(){
      rail.replaceChildren();
      const cell=(id,label,content)=>{const b=el('button','mp-cell');b.type='button';b.setAttribute('aria-label',label);b.setAttribute('aria-pressed',String(view===id&&!(query&&id!=='all')));if(query?id==='all':view===id)b.classList.add('active');b.append(content);b.onclick=()=>{view=id;if(query){query='';search.value='';}draw();};tooltip(b,label);rail.append(b);};
      cell('recent',copy.recent,lucide('history',16));cell('favorites',copy.favorites,lucide('star',16,{fill:view==='favorites'&&!query}));
      rail.append(el('div','mp-sep'));cell('all',copy.all,lucide('grid',16));
      const seen=new Set();for(const r of rows.filter(r=>r.visible)){if(seen.has(r.providerId))continue;seen.add(r.providerId);const box=el('span','mp-cell-mark');box.append(providerMark(r,13));cell('p:'+r.providerId,r.provider||r.providerId,box);}
    }
    let tip=null,tipTimer=0;
    function tooltip(target,text){
      target.addEventListener('pointerenter',()=>{clearTimeout(tipTimer);tipTimer=setTimeout(()=>{tip?.remove();tip=el('div','mp-tooltip',text);document.body.append(tip);const r=target.getBoundingClientRect();tip.style.left=r.right+6+'px';tip.style.top=Math.max(4,r.top+r.height/2-tip.offsetHeight/2)+'px';},500);});
      target.addEventListener('pointerleave',()=>{clearTimeout(tipTimer);tip?.remove();tip=null;});
    }

    // ---- List ----
    function matches(row){if(!query.trim())return true;const hay=[row.modelId,row.name,row.description,row.provider].join(' ').toLowerCase().replace(/\s+/g,'');return query.toLowerCase().split(/\s+/).filter(Boolean).every(w=>hay.includes(w));}
    function draw(initial){
      if(!host)return;drawRail();list.replaceChildren();glide=null;
      const d=data(),sections=[];
      if(d.state==='loading'){const n=el('div','mp-empty');n.append(el('span','mp-spinner'),el('span',undefined,copy.loading));list.append(n);return;}
      if(d.state==='failed'&&d.error==='INVALID_OPERATION'){list.append(el('div','mp-empty',copy.updateCindy));return;}
      if(d.state==='failed'){const n=el('div','mp-empty',copy.failed+' '),b=el('button','mp-link',copy.retry);b.type='button';b.onclick=()=>status.reload();n.append(b);list.append(n);return;}
      const prefsOk=d.preferences==='ok',effective=query.trim()?'all':view;
      const favRows=(d.favorites||[]).map(f=>({fav:f,row:resolve(f)})).filter(x=>x.row&&matches(x.row));
      if(effective==='recent'){
        if(!prefsOk)return note(d.preferences);
        const recents=(d.recents||[]).map(r=>({cfg:configOf(r),row:resolve(r)})).filter(x=>x.row).slice(0,5);
        if(!recents.length)return empty(copy.noRecent);
        sections.push({title:copy.recent,items:recents.map(x=>({kind:'recent',...x}))});
      }else if(effective==='favorites'){
        if(!prefsOk)return note(d.preferences);
        if(!favRows.length)return empty(copy.noFavorites);
        sections.push({title:copy.favorites,items:favRows.map(x=>({kind:'favorite',cfg:configOf(x.fav),uid:x.fav.uid,row:x.row}))});
      }else{
        const provider=effective.startsWith('p:')?effective.slice(2):null;
        const favs=favRows.filter(x=>!provider||x.row.providerId===provider);
        if(favs.length)sections.push({title:copy.favorites,items:favs.map(x=>({kind:'favorite',cfg:configOf(x.fav),uid:x.fav.uid,row:x.row}))});
        const groups=new Map();for(const r of rows.filter(r=>r.visible&&matches(r)&&(!provider||r.providerId===provider))){if(!groups.has(r.providerId))groups.set(r.providerId,[]);groups.get(r.providerId).push(r);}
        for(const items of groups.values())sections.push({title:items[0].provider||items[0].providerId,items:items.map(row=>({kind:'model',cfg:rowConfig(row),row}))});
        if(!sections.length)return empty(copy.noMatch);
      }
      // "Default" follows Cindy Chrome's own model setting; the only way back after picking a model.
      if(effective==='all'&&!query.trim())list.append(defaultRow());
      for(const s of sections){list.append(el('div','mp-section',s.title));for(const item of s.items)list.append(rowEl(item,effective));}
      const hl=el('span','mp-glide');list.prepend(hl);glide=hl;
      list.onpointermove=e=>{const rs=[...list.querySelectorAll('.mp-row')];let best=null,dist=1e9;for(const r of rs){const b=r.getBoundingClientRect(),dd=e.clientY<b.top?b.top-e.clientY:e.clientY>b.bottom?e.clientY-b.bottom:0;if(dd<dist){dist=dd;best=r;}}moveGlide(best);};
      list.onpointerleave=()=>moveGlide(flyout?.row||null);
      list.onfocusin=e=>{const r=e.target.closest('.mp-row');if(r&&r.matches(':focus-visible'))moveGlide(r);};
      function empty(text){list.append(el('div','mp-empty',text));}
      function note(state){list.append(el('div','mp-empty',state==='denied'?copy.prefsDenied:state==='unsupported'?copy.prefsUnsupported:copy.prefsUnavailable));}
    }
    let glide=null,glideRow=null;
    function moveGlide(row){
      if(!glide)return;if(glideRow&&glideRow!==row)glideRow.classList.remove('glided');glideRow=row;
      if(!row){glide.classList.remove('on');return;}
      row.classList.add('glided');glide.style.transform=`translateY(${row.offsetTop}px)`;glide.style.height=row.offsetHeight+'px';glide.style.left=row.offsetLeft+'px';glide.style.width=row.offsetWidth+'px';glide.classList.add('on');
    }
    function scrollToSelected(){const r=list?.querySelector('.mp-row.selected');if(r)list.scrollTop=Math.max(0,r.offsetTop+r.offsetHeight/2-list.clientHeight*.35);}

    function defaultRow(){
      const on=!selected(),r=el('div','mp-row'+(on?' selected':''));r.tabIndex=0;r.setAttribute('role','option');r.setAttribute('aria-selected',String(on));r.dataset.anchor='default';
      const line=el('div','mp-line'),name=el('span','mp-name',status.defaultLabel());line.append(el('span','mp-icon'),name);r.append(line);
      r.onclick=()=>{select(null);close();status.done();};return r;
    }
    function rowEl({kind,cfg,row,uid},effective){
      const sel=selected(),d=data(),prefsOk=d.preferences==='ok';
      const isSelected=kind==='favorite'?sel?.favoriteUid===uid:kind==='model'?!!sel&&!sel.favoriteUid&&sel.providerId===row.providerId&&sel.modelId===row.modelId:false;
      const r=el('div','mp-row'+(isSelected?' selected':''));r.tabIndex=0;r.setAttribute('role','option');r.setAttribute('aria-selected',String(isSelected));r.dataset.anchor=kind+':'+(uid||row.key);
      const line=el('div','mp-line'),icon=el('span','mp-icon');icon.append(modelMark(row,13));
      const name=el('span','mp-name',row.name);name.title=row.name;line.append(icon,name);
      // Star: model rows on hover, favorite rows always filled, recent rows filled when saved.
      const saved=kind==='favorite'?{uid}:kind==='recent'?(d.favorites||[]).find(f=>sameConfig(configOf(f),cfg)):null;
      if(prefsOk){
        const flashing=flash===r.dataset.anchor,filled=!!saved||flashing;
        const star=el('button','mp-star'+(filled?' filled':'')+(kind==='model'||(kind==='recent'&&!filled)?' hover-only':''));star.type='button';star.title=filled&&!flashing?copy.unsave:copy.save;star.setAttribute('aria-label',star.title);star.append(lucide('star',14,{fill:filled}));
        star.onclick=async e=>{e.stopPropagation();
          try{
            if(saved){await favorite({kind:'remove',expected:(d.favorites||[]).find(f=>f.uid===saved.uid)});}
            else{await favorite({kind:'add',item:cfg});if(kind==='model'){flash=r.dataset.anchor;setTimeout(()=>{flash=null;draw();},700);}}
          }catch{status.error(copy.favoriteFailed);}
          draw();};
        line.append(star);
      }
      if(kind!=='recent'){r.dataset.custom='1';const c=el('button','mp-customize');c.type='button';c.title=copy.customize;c.setAttribute('aria-label',copy.customize);c.append(lucide('sliders',14));c.onclick=e=>{e.stopPropagation();openFlyout(r,{kind,cfg,row,uid});};line.append(c);}
      line.append(triple(cfg,row));r.append(line);
      if(kind!=='model'&&row.provider)r.append(el('div','mp-meta',row.provider));
      r.onclick=()=>{select({...cfg,...(kind==='favorite'?{favoriteUid:uid}:{})});close();status.done();};
      r.oncontextmenu=e=>{if(kind==='recent')return;e.preventDefault();openFlyout(r,{kind,cfg,row,uid});};
      return r;
    }

    // ---- Configuration card (the app's flyout; overlaid inside the narrow side panel) ----
    function closeFlyout(){flyout?.remove();flyout=null;}
    function openFlyout(rowNode,item){
      closeFlyout();const {kind,row,uid}=item;let cfg={...item.cfg};
      const card=el('div','mp-flyout');card.setAttribute('role','dialog');card.setAttribute('aria-label',row.name);card.row=rowNode;flyout=card;
      const apply=async next=>{
        const prev=cfg;cfg=configOf(next);
        if(kind==='favorite'){const d=data(),expected=(d.favorites||[]).find(f=>f.uid===uid);try{if(expected)await favorite({kind:'update',expected,item:cfg});}catch{cfg=prev;status.error(copy.favoriteFailed);}}
        else memory.set(row.key,{agent:cfg.agent,effort:cfg.effort,fast:cfg.fast});
        const sel=selected();
        if(sel&&((kind==='favorite'&&sel.favoriteUid===uid)||(kind==='model'&&!sel.favoriteUid&&sel.providerId===row.providerId&&sel.modelId===row.modelId)))select({...cfg,...(kind==='favorite'?{favoriteUid:uid}:{})});
        paint();draw();paintTrigger();
      };
      function paint(){
        card.replaceChildren();const engine=engineOf(row,cfg),d=data(),prefsOk=d.preferences==='ok';
        const head=el('div','mf-head');head.append(el('div','mf-name',row.name));
        if(prefsOk){const saved=kind==='favorite'||(d.favorites||[]).some(f=>sameConfig(configOf(f),cfg));const star=el('button','mp-star'+(saved?' filled':''));star.type='button';star.title=saved?copy.unsave:copy.save;star.setAttribute('aria-label',star.title);star.append(lucide('star',14,{fill:saved}));
          star.onclick=async()=>{try{if(saved){const f=(d.favorites||[]).find(f=>kind==='favorite'?f.uid===uid:sameConfig(configOf(f),cfg));if(f)await favorite({kind:'remove',expected:f});if(kind==='favorite'){closeFlyout();draw();return;}}else await favorite({kind:'add',item:cfg});}catch{status.error(copy.favoriteFailed);}paint();draw();};head.append(star);}
        card.append(head);
        card.append(el('div','mf-meta',[row.provider,row.contextWindow?formatContext(row.contextWindow)+(getLocale()==='zh-CN'?' ':' ')+copy.context:''].filter(Boolean).join(' · ')));
        const controls=el('div','mf-controls');
        if(engine.efforts.length>=2)controls.append(slider(engine,cfg.effort||engine.defaultEffort,v=>apply({...cfg,effort:v===engine.defaultEffort?undefined:v})));
        else controls.append(el('div','mf-spacer'));
        if(engine.supportsFastMode){const f=el('button','mf-fast'+(cfg.fast?' on':''));f.type='button';f.title=copy.fast;f.setAttribute('aria-label',copy.fast);f.setAttribute('aria-pressed',String(!!cfg.fast));f.append(lucide('zap',14,{fill:!!cfg.fast,stroke:1.75}));f.onclick=()=>apply({...cfg,fast:cfg.fast?undefined:true});controls.append(f);}
        card.append(controls);
        if(row.engines.length>1){const list=el('div','mf-engines');for(const e of row.engines){const b=el('button','mf-engine'+(e.agent===cfg.agent?' active':''));b.type='button';const m=el('span','mf-engine-mark');m.style.color=ENGINE[e.agent]?.color;m.append(engineMark(e.agent,12));b.append(m,el('span',undefined,ENGINE[e.agent]?.label||e.agent));if(e.agent===cfg.agent)b.append(lucide('check',12));b.onclick=()=>apply({...cfg,agent:e.agent,effort:undefined,fast:undefined});list.append(b);}card.append(list);}
        const bar=el('div','mf-status');
        const recommended=cfg.agent===row.engines[0].agent&&!cfg.effort&&!cfg.fast;
        if(kind==='favorite'){bar.append(el('span',undefined,copy.savedSetup+' · '));const a=el('button','mp-link',copy.unsave);a.type='button';a.onclick=async()=>{const f=(data().favorites||[]).find(f=>f.uid===uid);try{if(f)await favorite({kind:'remove',expected:f});}catch{status.error(copy.favoriteFailed);}closeFlyout();draw();};bar.append(a);}
        else if(recommended)bar.append(el('span',undefined,copy.recommendedSetup));
        else{bar.append(el('span',undefined,copy.customized+' · '));const a=el('button','mp-link',copy.reset);a.type='button';a.onclick=()=>{memory.delete(row.key);apply({providerId:row.providerId,modelId:row.modelId,agent:row.engines[0].agent});memory.delete(row.key);};bar.append(a);}
        card.append(bar);
        if(!card.contains(document.activeElement))card.querySelector('.mf-thumb,.mf-fast,.mf-engine,button')?.focus({preventScroll:true});
      }
      paint();host.append(card);
      const p=panel.getBoundingClientRect(),r=rowNode.getBoundingClientRect(),w=Math.min(264,p.width-16);
      card.style.width=w+'px';card.style.left=Math.max(8,p.left+8)+'px';
      card.style.top=Math.min(Math.max(p.top+8,r.top-12),Math.max(8,p.bottom-card.offsetHeight-8))+'px';
      moveGlide(rowNode);(card.querySelector('.mf-thumb,.mf-fast,.mf-engine,button'))?.focus();
    }
    function slider(engine,value,onCommit){
      const levels=engine.efforts,box=el('div','mf-slider'),track=el('div','mf-track'),fill=el('div','mf-fill'),thumb=el('div','mf-thumb'),bubble=el('div','mf-bubble');
      thumb.tabIndex=0;thumb.setAttribute('role','slider');thumb.setAttribute('aria-valuemin','0');thumb.setAttribute('aria-valuemax',String(levels.length-1));
      let index=Math.max(0,levels.indexOf(value));
      const ends=el('div','mf-ends');ends.append(el('span',undefined,copy.faster),el('span',undefined,copy.smarter));
      for(let i=1;i<levels.length-1;i++){const dot=el('span','mf-dot');dot.style.left=`calc(${i/(levels.length-1)*100}% )`;track.append(dot);}
      track.append(fill);box.append(bubble,track,thumb,ends);
      const paint=()=>{const pct=index/(levels.length-1)*100,lv=levels[index],c=TIER[lv]||'#3B82F6';fill.style.width=`calc(${pct}% + 6px)`;fill.style.background=c;thumb.style.left=pct+'%';thumb.style.setProperty('--tier',c);thumb.setAttribute('aria-valuenow',String(index));thumb.setAttribute('aria-valuetext',copy.efforts[lv]||lv);
        bubble.replaceChildren();const dot=el('span','mf-bubble-dot');dot.style.background=c;bubble.append(dot,el('span',undefined,(copy.efforts[lv]||lv)+(lv===engine.defaultEffort?' · '+copy.recommended:'')));bubble.style.left=pct+'%';};
      const commit=()=>onCommit(levels[index]);
      const fromX=x=>{const r=track.getBoundingClientRect();index=Math.round(Math.min(1,Math.max(0,(x-r.left)/r.width))*(levels.length-1));paint();};
      box.addEventListener('pointerdown',e=>{if(e.button)return;box.setPointerCapture(e.pointerId);box.classList.add('dragging');fromX(e.clientX);const move=ev=>fromX(ev.clientX),up=()=>{box.classList.remove('dragging');box.removeEventListener('pointermove',move);box.removeEventListener('pointerup',up);box.removeEventListener('pointercancel',up);commit();};box.addEventListener('pointermove',move);box.addEventListener('pointerup',up);box.addEventListener('pointercancel',up);});
      thumb.addEventListener('keydown',e=>{const k={ArrowLeft:-1,ArrowDown:-1,ArrowRight:1,ArrowUp:1}[e.key];if(k!==undefined||e.key==='Home'||e.key==='End'){e.preventDefault();e.stopPropagation();index=e.key==='Home'?0:e.key==='End'?levels.length-1:Math.min(levels.length-1,Math.max(0,index+k));paint();commit();}});
      paint();return box;
    }
    trigger.addEventListener('mousedown',e=>e.preventDefault());
    trigger.addEventListener('click',()=>host?close():open());
    return {open,close,refresh(){const was=list?.querySelector('.mp-row');rows=catalog(data().models);paintTrigger();if(host){draw();if(!was&&list.querySelector('.mp-row')&&panel.classList.contains('settled'))panel.style.height=fit()+'px';}},paintTrigger,get isOpen(){return !!host;},resolveName(cfg){const row=cfg&&resolve(cfg);return row?.name;},catalog:()=>rows};
  }
  globalThis.CindyModelPicker={create,catalog};
})();
