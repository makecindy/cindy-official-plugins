(function(){
  'use strict';
  const $=id=>document.getElementById(id),channel=new BroadcastChannel('podcast-insights-v2'),pending=new Map();
  let pendingFocus=null;
  let ui,show='',episode='',next=null,episodeOffset=null,notesNext=null,nextChar=0,highlight='',busy=false,refreshPending=false,readerNeedsRetry=false,readerVersion='';
  const notice=s=>$('notice').textContent=s || '';
  function request(tool,args={}){const reqId=crypto.randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(reqId);reject(new Error(ui.timeout));},120000);pending.set(reqId,{resolve,reject,timer});channel.postMessage({type:'request',reqId,tool,args});});}
  function connect(){const reqId=crypto.randomUUID();return new Promise((resolve,reject)=>{const send=()=>channel.postMessage({type:'ping',reqId});const repeat=setInterval(send,250);const timer=setTimeout(()=>{clearInterval(repeat);pending.delete(reqId);reject(new Error(ui.timeout));},15000);pending.set(reqId,{resolve:()=>{clearInterval(repeat);resolve();},reject,timer});send();});}
  const node=(tag,text)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;return e;};
  const button=(text,fn)=>{const b=node('button',text);b.type='button';b.onclick=()=>act(fn);return b;};
  async function act(fn){if(busy)return;busy=true;try{await fn();}catch(e){notice(e.message);}finally{busy=false;if(pendingFocus){const focus=pendingFocus;pendingFocus=null;act(()=>read(focus.episode_id,0,0,focus.segment_id));}else if(refreshPending){refreshPending=false;act(()=>refresh());}}}
  const stamp=ms=>{if(ms==null)return ui.unknown;const seconds=Math.floor(ms/1000);return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(n=>String(n).padStart(2,'0')).join(':');};
  const confirmDelete=async(kind,id)=>{if(!confirm(ui.confirmDelete))return;await request('delete',{kind,id,confirm:true});episode='';highlight='';readerVersion='';readerNeedsRetry=false;next=null;nextChar=0;notesNext=null;$('reader').replaceChildren();$('episode-actions').hidden=true;$('more').hidden=true;$('notes').replaceChildren();$('more-notes').hidden=true;await refresh();await notes(false);notice(ui.deletedBackup);};
  async function refresh(append=false){
    const r=await request('podcast_library',{show_id:show || undefined,transcript_state:$('state').value || undefined,offset:append?episodeOffset || 0:0});
    if(!append){$('shows').replaceChildren(button(ui.allShows,async()=>{show='';await refresh();}));for(const s of r.shows){const row=node('div');row.append(button(s.title,async()=>{show=s.id;await refresh();}),button(ui.deleteShow,()=>confirmDelete('show',s.id)));$('shows').append(row);}$('episodes').replaceChildren();}
    if(r.shows_truncated||r.jobs_truncated)notice(ui.libraryLimited);
    $('space').textContent=ui.space+': '+(r.used_bytes/1024/1024).toFixed(1)+' MB';
    for(const e of r.episodes){const row=node('div');row.className='item';row.append(button(e.title,async()=>{$('episode-title').textContent=e.title;await read(e.id);}),node('small',ui[e.transcript_state] || e.transcript_state));$('episodes').append(row);}
    if(!r.episodes.length&&!append)$('episodes').append(node('p',ui.empty));episodeOffset=r.next_offset;$('more-episodes').hidden=episodeOffset==null;
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
    if(episode!==eid || (offset===0&&charOffset===0)){highlight=focusSegment;readerVersion='';next=null;nextChar=0;$('more').hidden=true;$('reader').replaceChildren();notice('');}
    const previousVersion=readerVersion;episode=eid;readerNeedsRetry=!readerVersion;$('episode-actions').hidden=false;const r=await request('podcast_read',{episode_id:eid,offset,char_offset:charOffset,...(highlight&&offset===0&&charOffset===0?{around_segment:highlight}:{})});const responseVersion=r.segments[0]?.transcript_id || '';if((offset!==0||charOffset!==0)&&previousVersion!==responseVersion){await read(eid);return;}readerNeedsRetry=false;readerVersion=responseVersion;episode=eid;$('episode-title').textContent=r.episode.title;$('episode-actions').hidden=false;
    if(offset===0&&charOffset===0)$('reader').replaceChildren();for(const s of r.segments)$('reader').append(renderSegment(s,r.episode));next=r.next_offset;nextChar=r.next_char_offset || 0;$('more').hidden=next==null;
    if(highlight)document.getElementById('segment-'+highlight)?.scrollIntoView({block:'center'});
  }
  async function notes(append=false){const r=await request('notes',{offset:append?notesNext || 0:0});if(!append)$('notes').replaceChildren();notesNext=r.next_offset;$('more-notes').hidden=notesNext==null;for(const n of r.notes){const row=node('label');row.className='item';const cb=node('input');cb.type='checkbox';cb.value=n.id;row.append(cb,node('span',n.show_title+' · '+n.title),node('blockquote',n.quote),node('span',n.note));$('notes').append(row);}}
  channel.onmessage=event=>{const m=event.data;if(m.type==='response'||m.type==='pong'){const p=pending.get(m.reqId);if(!p)return;clearTimeout(p.timer);pending.delete(m.reqId);(m.type==='pong'||m.ok)?p.resolve(m.result):p.reject(new Error(m.message || ui.failed));}
    if(m.type==='changed'){if(busy)refreshPending=true;else act(()=>refresh());}
    if(m.type==='focus'){if(busy)pendingFocus=m;else act(()=>read(m.episode_id,0,0,m.segment_id));}
  };
  addEventListener('podcast-ui-ready',()=>{ui=PodcastUI;
    $('import').onsubmit=e=>{e.preventDefault();act(async()=>{const r=await request('import_link',{url:$('url').value});notice(r.message || ui.openTask);});};
    $('search').onsubmit=e=>{e.preventDefault();act(async()=>{const r=await request('podcast_search',{query:$('query').value,show_id:show || undefined});episode='';highlight='';next=null;nextChar=0;$('episode-title').textContent=ui.searchResults;$('episode-actions').hidden=true;$('reader').replaceChildren();for(const s of r.evidence)$('reader').append(renderSegment(s,s));notice(!r.evidence.length?ui.noHits:r.results_truncated?ui.searchLimited:'');$('more').hidden=true;});};
    $('state').onchange=()=>act(()=>refresh());$('more-episodes').onclick=()=>act(()=>refresh(true));$('clear').onclick=()=>act(()=>confirmDelete('all',''));$('delete-episode').onclick=()=>act(()=>confirmDelete('episode',episode));
    $('cloud').onclick=()=>act(async()=>{const r=await request('cloud',{episode_id:episode});notice(r.message || ui.openTask);});
    $('file').onchange=()=>act(async()=>{const file=$('file').files[0];if(!file)return;if(file.size>5*1024*1024)throw new Error(ui.fileTooLarge);await request('podcast_import_transcript',{episode_id:episode,format:file.name.split('.').at(-1).toLowerCase(),content:await file.text()});$('file').value='';highlight='';await read(episode);});
    $('more-notes').onclick=()=>act(()=>notes(true));$('more').onclick=()=>act(()=>read(episode,next,nextChar));$('export').onclick=()=>act(async()=>{const ids=Array.from($('notes').querySelectorAll('input:checked')).map(e=>e.value);if(!ids.length){notice(ui.selectNotes);return;}const r=await request('export_notes',{ids});notice(r.cancelled?ui.cancelled:ui.exported);});
    act(async()=>{const r=await fetch('/wake');if(!r.ok)throw new Error(ui.failed);await connect();await refresh();await notes();const cfg=await (await fetch('/kv')).json();if(cfg.selected){try{await read(cfg.selected.episode_id,0,0,cfg.selected.segment_id);}catch(e){notice(e.message);}}request('resume').catch(e=>notice(e.message));});
  });
})();
