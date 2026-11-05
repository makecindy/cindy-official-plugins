(function(){
  'use strict';
  const $=id=>document.getElementById(id),channel=new BroadcastChannel('podcast-insights-v2'),pending=new Map();
  let pendingFocus=null;
  let ui,show='',episode='',next=null,episodeOffset=null,notesNext=null,nextChar=0,highlight='',busy=false,refreshPending=false,readerNeedsRetry=false,readerVersion='';
  let libraryScroll=0,minutesId='',viewMode='library',navigation=0,selectionQueue=Promise.resolve();
  function saveSelection(selected,token=navigation){
    const work=selectionQueue.then(async()=>{if(token!==navigation)return;const r=await fetch('/kv');if(!r.ok)throw new Error(ui.selectionSaveFailed);const cfg=await r.json();if(token!==navigation)return;const saved=await fetch('/kv',{method:'PUT',body:JSON.stringify({...cfg,selected})});if(!saved.ok)throw new Error(ui.selectionSaveFailed);});
    selectionQueue=work.catch(()=>{});return work;
  }
  function detailMode(enabled){
    if(enabled&&!document.body.classList.contains('knowledge-mode'))libraryScroll=window.scrollY;
    document.body.classList.toggle('knowledge-mode',enabled);
    document.querySelector('main').classList.toggle('reading-mode',enabled);
    if(enabled)window.scrollTo(0,0);
  }
  async function backToLibrary(){navigation++;viewMode='library';minutesId='';detailMode(false);$('search').hidden=false;$('episode-title').textContent=ui.reader;$('reader').replaceChildren();$('reader').classList.remove('reading-empty');$('episode-actions').hidden=true;episode='';readerVersion='';readerNeedsRetry=false;$('more').hidden=true;notice('');window.scrollTo(0,libraryScroll);await saveSelection(null);}
  const notice=s=>$('notice').textContent=s || '';
  function request(tool,args={}){const reqId=crypto.randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(reqId);reject(new Error(ui.timeout));},120000);pending.set(reqId,{resolve,reject,timer});channel.postMessage({type:'request',reqId,tool,args});});}
  function connect(){const reqId=crypto.randomUUID();return new Promise((resolve,reject)=>{const send=()=>channel.postMessage({type:'ping',reqId});const repeat=setInterval(send,250);const timer=setTimeout(()=>{clearInterval(repeat);pending.delete(reqId);reject(new Error(ui.timeout));},15000);pending.set(reqId,{resolve:()=>{clearInterval(repeat);resolve();},reject,timer});send();});}
  const node=(tag,text)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;return e;};
  const button=(text,fn)=>{const b=node('button',text);b.type='button';b.onclick=()=>act(fn);return b;};
  async function act(fn){if(busy)return;busy=true;try{await fn();}catch(e){notice(e.message);}finally{busy=false;if(pendingFocus){const focus=pendingFocus;pendingFocus=null;act(()=>focus.mode==='minutes'?openMinutes(focus.episode_id):read(focus.episode_id,0,0,focus.segment_id));}else if(refreshPending){refreshPending=false;act(()=>refresh());}}}
  const stamp=ms=>{if(ms==null)return ui.unknown;const seconds=Math.floor(ms/1000);return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(n=>String(n).padStart(2,'0')).join(':');};
  const confirmDelete=async(kind,id)=>{if(!confirm(ui.confirmDelete))return;await request('delete',{kind,id,confirm:true});episode='';highlight='';readerVersion='';readerNeedsRetry=false;next=null;nextChar=0;notesNext=null;$('reader').replaceChildren();$('episode-actions').hidden=true;$('more').hidden=true;$('notes').replaceChildren();$('more-notes').hidden=true;await refresh();await notes(false);notice(ui.deletedBackup);};
  async function refresh(append=false){
    const r=await request('podcast_library',{show_id:show || undefined,transcript_state:$('state').value || undefined,offset:append?episodeOffset || 0:0});
    if(!append){$('shows').replaceChildren(button(ui.allShows,async()=>{show='';await refresh();}));for(const s of r.shows){const row=node('div');row.append(button(s.title,async()=>{show=s.id;await refresh();}),button(ui.deleteShow,()=>confirmDelete('show',s.id)));$('shows').append(row);}$('episodes').replaceChildren();}
    if(r.shows_truncated||r.jobs_truncated)notice(ui.libraryLimited);
    $('space').textContent=ui.space+': '+(r.used_bytes/1024/1024).toFixed(1)+' MB';
    for(const e of r.episodes){const row=node('div');row.className='item';row.append(button(e.title,async()=>{$('episode-title').textContent=e.title;const saved=await request('minutes_document',{episode_id:e.id});if(saved.available)await openMinutes(e.id,saved);else await read(e.id);}),node('small',ui[e.transcript_state] || e.transcript_state));$('episodes').append(row);}
    if(!r.episodes.length&&!append)$('episodes').append(node('p',ui.empty));episodeOffset=r.next_offset;$('more-episodes').hidden=episodeOffset==null;
    if(!append){
      const index=await request('minutes_index');$('minutes-list').replaceChildren();
      for(const saved of index.minutes){const row=node('div');row.className='minutes-saved-item';const open=button(saved.title,()=>openMinutes(saved.episode_id));open.className='minutes-saved-open';row.append(node('small',saved.show_title+' · '+saved.chapter_count+' '+ui.minutesChapters),open);$('minutes-list').append(row);}
      if(!index.minutes.length)$('minutes-list').append(node('p',ui.minutesIndexEmpty));
      if(viewMode==='minutes'&&episode){const latest=await request('minutes_document',{episode_id:episode});if(latest.available&&latest.id!==minutesId)await openMinutes(episode,latest);return;}
    }
    if(!append&&episode){
      if(readerNeedsRetry)await read(episode,0,0,highlight);
      else if(readerVersion){
        const latest=await request('podcast_read',{episode_id:episode,max_chars:1});
        if(latest.segments[0]?.transcript_id!==readerVersion)await read(episode);
      }
    }
  }
  function renderSegment(s,e){
    const block=node('div');block.className='item'+(highlight===s.id?' selected':'');block.id='segment-'+s.id;
    if(s.episode_title){block.append(node('p',s.show_title+' · '+s.episode_title),button(ui.viewLibrary,()=>read(s.episode_id,0,0,s.id)));}
    block.append(node('small',(s.speaker || ui.noSpeaker)+' · '+stamp(s.start_ms)));
    const quote=node('blockquote');
    const q=$('query').value,idx=q?s.text.toLowerCase().indexOf(q.toLowerCase()):-1;
    if(idx>=0){quote.append(document.createTextNode(s.text.slice(0,idx)),node('mark',s.text.slice(idx,idx+q.length)),document.createTextNode(s.text.slice(idx+q.length)));}else quote.textContent=s.text;
    block.append(quote);if(s.text_truncated)block.append(node('small',ui.searchExcerpt));
    if(e.page_url){const a=node('a',ui.source);a.href=e.page_url;block.append(a);}
    block.append(button(ui.saveNote,async()=>{
      const selected=String(getSelection() || '').trim(),q=selected&&s.text.includes(selected)?selected:s.text;
      if(q.length>1200)throw new Error(ui.quoteTooLong);
      const note=prompt(ui.notePrompt,'');if(note==null)return;if(note.length>5000)throw new Error(ui.errors.NOTE_TOO_LONG);
      await request('note',{segment_id:s.id,quote:q,note});await notes();notice(ui.noteSaved);
    }));return block;
  }
  async function read(eid,offset=0,charOffset=0,focusSegment=''){
    if(offset===0&&charOffset===0){navigation++;viewMode='transcript';minutesId='';}
    detailMode(false);$('reader').classList.remove('reading-empty');$('search').hidden=false;$('notes').hidden=false;$('export').hidden=false;
    if(episode!==eid || (offset===0&&charOffset===0)){highlight=focusSegment;readerVersion='';next=null;nextChar=0;$('more').hidden=true;$('reader').replaceChildren();notice('');}
    const previousVersion=readerVersion;episode=eid;readerNeedsRetry=!readerVersion;$('episode-actions').hidden=false;const r=await request('podcast_read',{episode_id:eid,offset,char_offset:charOffset,...(highlight&&offset===0&&charOffset===0?{around_segment:highlight}:{})});const responseVersion=r.segments[0]?.transcript_id || '';if((offset!==0||charOffset!==0)&&previousVersion!==responseVersion){await read(eid);return;}readerNeedsRetry=false;readerVersion=responseVersion;episode=eid;$('episode-title').textContent=r.episode.title;$('episode-actions').hidden=false;
    if(offset===0&&charOffset===0)$('reader').replaceChildren();for(const s of r.segments)$('reader').append(renderSegment(s,r.episode));next=r.next_offset;nextChar=r.next_char_offset || 0;$('more').hidden=next==null;
    if(highlight)document.getElementById('segment-'+highlight)?.scrollIntoView({block:'center'});
    if(offset===0&&charOffset===0)await saveSelection({episode_id:eid,mode:'transcript',segment_id:focusSegment||undefined});
  }
  async function openMinutes(eid,preloaded,restore){
    if(!eid)return;const token=++navigation;episode=eid;viewMode='minutes';notice(ui.minutesLoading);const r=preloaded||await request('minutes_document',{episode_id:eid});minutesId=r.id||'';
    $('reader').replaceChildren();$('reader').classList.remove('reading-empty');$('more').hidden=true;next=null;readerVersion='';readerNeedsRetry=false;detailMode(true);$('search').hidden=true;$('episode-actions').hidden=false;
    const language=document.documentElement.lang==='zh-CN'?'zh-CN':'en';
    const generate=async regenerate=>{const result=await request('minutes_generate',{action:'generate',episode_id:eid,language,regenerate});notice(result.message||ui.minutesStarted);};
    const toolbar=node('div');toolbar.className='reading-toolbar';toolbar.append(button(ui.backToLibrary,backToLibrary));const actions=node('div');actions.className='reading-toolbar-actions';toolbar.append(actions);$('reader').append(toolbar);
    if(!r.available){const empty=node('div');empty.className='reading-empty';empty.append(node('p',ui.minutesMissing),node('p',ui.minutesModelNotice),button(ui.minutesGenerate,()=>generate(false)));$('reader').append(empty);notice('');return;}
    notice(r.stale?ui.minutesStale:'');actions.append(button(ui.minutesOriginal,()=>read(eid)),button(ui.minutesRegenerate,()=>generate(true)));
    const body=node('div');body.className='reading-host';body.innerHTML=PodcastReading.render(r.document,{interactive:true});$('reader').append(body);
    PodcastReading.bind(body,r.document,index=>act(async()=>{const question=prompt(ui.minutesQuestion);if(!question?.trim())return;const chapter=r.document.chapters[index];const result=await request('chapter_ask',{episode_id:eid,transcript_id:r.document.transcript_id,from_segment_idx:chapter.start_idx,to_segment_idx:chapter.end_idx,chapter:chapter.title,question:question.slice(0,2000)});notice(result.message||ui.openTask);}));
    const scroller=body.querySelector('.minutes-body'),toc=body.querySelector('.minutes-toc');
    if(restore?.record_id===r.id){scroller.scrollTop=Math.max(0,Number(restore.scroll_top)||0);toc.scrollTop=Math.max(0,Number(restore.toc_scroll)||0);}
    const selected=()=>({episode_id:eid,mode:'minutes',record_id:r.id,scroll_top:scroller.scrollTop,toc_scroll:toc.scrollTop});
    let timer;const remember=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(token===navigation)saveSelection(selected(),token).catch(e=>notice(e.message));},250);};
    scroller.addEventListener('scroll',remember,{passive:true});toc.addEventListener('scroll',remember,{passive:true});await saveSelection(selected(),token);
  }
  async function notes(append=false){const r=await request('notes',{offset:append?notesNext || 0:0});if(!append)$('notes').replaceChildren();notesNext=r.next_offset;$('more-notes').hidden=notesNext==null;for(const n of r.notes){const row=node('label');row.className='item';const cb=node('input');cb.type='checkbox';cb.value=n.id;row.append(cb,node('span',n.show_title+' · '+n.title),node('blockquote',n.quote),node('span',n.note));$('notes').append(row);}}
  channel.onmessage=event=>{const m=event.data;if(m.type==='response'||m.type==='pong'){const p=pending.get(m.reqId);if(!p)return;clearTimeout(p.timer);pending.delete(m.reqId);(m.type==='pong'||m.ok)?p.resolve(m.result):p.reject(new Error(m.message || ui.failed));}
    if(m.type==='changed'){if(busy)refreshPending=true;else act(()=>refresh());}
    if(m.type==='minutes-focus'){if(busy)pendingFocus={...m,mode:'minutes'};else act(()=>openMinutes(m.episode_id));}
    if(m.type==='focus'){if(busy)pendingFocus=m;else act(()=>read(m.episode_id,0,0,m.segment_id));}
  };
  addEventListener('podcast-ui-ready',()=>{ui=PodcastUI;
    $('import').onsubmit=e=>{e.preventDefault();act(async()=>{const r=await request('import_link',{url:$('url').value});notice(r.message || ui.openTask);});};
    $('search').onsubmit=e=>{e.preventDefault();act(async()=>{const r=await request('podcast_search',{query:$('query').value,show_id:show || undefined});episode='';highlight='';next=null;nextChar=0;$('episode-title').textContent=ui.searchResults;$('episode-actions').hidden=true;$('reader').replaceChildren();for(const s of r.evidence)$('reader').append(renderSegment(s,s));notice(!r.evidence.length?ui.noHits:r.results_truncated?ui.searchLimited:'');$('more').hidden=true;});};
    $('state').onchange=()=>act(()=>refresh());$('more-episodes').onclick=()=>act(()=>refresh(true));$('clear').onclick=()=>act(()=>confirmDelete('all',''));$('delete-episode').onclick=()=>act(()=>confirmDelete('episode',episode));
    $('minutes-open').onclick=()=>act(()=>openMinutes(episode));
    $('feishu').onclick=()=>act(async()=>{const r=await request('feishu',{episode_id:episode});notice(r.message || ui.openTask);});
    $('cloud').onclick=()=>act(async()=>{const r=await request('cloud',{episode_id:episode});notice(r.message || ui.openTask);});
    $('file').onchange=()=>act(async()=>{const file=$('file').files[0];if(!file)return;if(file.size>5*1024*1024)throw new Error(ui.fileTooLarge);await request('podcast_import_transcript',{episode_id:episode,format:file.name.split('.').at(-1).toLowerCase(),content:await file.text()});$('file').value='';highlight='';await read(episode);});
    $('more-notes').onclick=()=>act(()=>notes(true));$('more').onclick=()=>act(()=>read(episode,next,nextChar));$('export').onclick=()=>act(async()=>{const ids=Array.from($('notes').querySelectorAll('input:checked')).map(e=>e.value);if(!ids.length){notice(ui.selectNotes);return;}const r=await request('export_notes',{ids});notice(r.cancelled?ui.cancelled:ui.exported);});
    act(async()=>{const r=await fetch('/wake');if(!r.ok)throw new Error(ui.failed);await connect();await refresh();await notes();const cfg=await (await fetch('/kv')).json();if(cfg.selected){try{if(cfg.selected.mode==='minutes')await openMinutes(cfg.selected.episode_id,undefined,cfg.selected);else await read(cfg.selected.episode_id,0,0,cfg.selected.segment_id);}catch(e){notice(e.message);}}request('resume').catch(e=>notice(e.message));});
  });
})();
