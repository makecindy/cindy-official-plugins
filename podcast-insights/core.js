(function (root) {
  'use strict';
  const L = typeof module !== 'undefined' ? require('./legacy-core.js') : root.PodcastCore;
  const bytes = s => new TextEncoder().encode(s).length;
  const norm = s => String(s).normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, '');
  function metadata(feed){
    const check=(value,max)=>{if(value!=null&&(typeof value!=='string'||value.length>max))L.fail('METADATA_FIELD_TOO_LONG');};
    for(const [key,max] of [['title',500],['author',300],['language',64],['link',4000]])check(feed[key],max);
    for(const e of feed.episodes || []){
      for(const [key,max] of [['title',500],['guid',4000],['published_at',128],['audio_url',4000],['page_url',4000]])check(e[key],max);
      if((e.transcripts || []).length>50)L.fail('METADATA_FIELD_TOO_LONG');
      for(const t of e.transcripts || []){check(t.type,128);check(t.url,4000);}
    }
  }
  function excerpt(full,needle,limit){
    let left=0,right=full.length,matchEnd=full.length;
    if(full.length>limit){
      const offset=norm(full).indexOf(norm(needle));
      const boundary=target=>{let lo=0,hi=full.length;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(norm(full.slice(0,mid)).length<target)lo=mid+1;else hi=mid;}return lo;};
      const exact=full.indexOf(needle);
      const matchStart=exact>=0?exact:Math.max(0,boundary(offset+1)-8);matchEnd=exact>=0?exact+needle.length:Math.min(full.length,boundary(offset+norm(needle).length)+8);
      left=Math.max(0,matchStart-Math.min(80,Math.max(0,limit-(matchEnd-matchStart))));right=Math.min(full.length,left+limit);
    }
    return {text:full.slice(left,right),text_truncated:left>0||right<full.length,excerpt_start:left,match_truncated:right<matchEnd};
  }
  function budgetRows(rows,maxRows,maxBytes){
    const out=[];let used=2;
    for(const row of rows){const size=bytes(JSON.stringify(row))+1;if(out.length>=maxRows||used+size>maxBytes)break;out.push(row);used+=size;}
    return out;
  }
  const isoDate = v => { const n=Date.parse(v); return Number.isFinite(n)?new Date(n).toISOString():''; };
  const feedUrl = value => { const u = new URL(L.url(value)); u.hash = ''; return u.href; };
  const nodes = (el, name) => Array.from(el.getElementsByTagName('*')).filter(n => n.localName === name);
  const text = (el, name) => nodes(el, name)[0]?.textContent?.trim() || '';
  function duration(s) {
    if (!s) return null;
    const p = String(s).split(':').map(Number);
    if (p.some(v => !Number.isFinite(v) || v < 0)) return null;
    return p.reduce((a, n) => a * 60 + n, 0);
  }
  function feed(xml, source) {
    if (bytes(xml) > 10 * 1024 * 1024) L.fail('FEED_TOO_LARGE');
    // Never resolve declared entities. Refuse entity declarations and remove harmless doctypes.
    if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(xml)) L.fail('UNSAFE_XML');
    const clean = xml.replace(/<!DOCTYPE[^>]*>/gi, '');
    if (typeof DOMParser === 'undefined') L.fail('XML_UNAVAILABLE');
    const doc = new DOMParser().parseFromString(clean, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length || !['rss','feed'].includes(doc.documentElement.localName)) L.fail('INVALID_FEED');
    const channel = nodes(doc, 'channel')[0] || doc.documentElement;
    const direct = n => Array.from(channel.children).find(e => e.localName === n)?.textContent?.trim() || '';
    const safe = v => { try { return v ? L.url(v, source) : ''; } catch { return ''; } };
    const types = ['application/json','text/vtt','application/x-subrip','text/html','text/plain'];
    const all = nodes(doc, 'item').concat(nodes(doc, 'entry'));
    return { title: direct('title') || source, author: direct('author'), language: direct('language'), link: safe(direct('link')), truncated: all.length > 500,
      episodes: all.slice(0,500).map(e => {
        const enclosure = nodes(e,'enclosure')[0] || nodes(e,'link').find(n => n.getAttribute('rel') === 'enclosure');
        const audio = safe(enclosure?.getAttribute('url') || enclosure?.getAttribute('href'));
        const transcripts = nodes(e,'transcript').map(n => ({url:safe(n.getAttribute('url')),type:n.getAttribute('type') || 'text/plain'})).filter(t=>t.url).sort((a,b)=>(types.indexOf(a.type)<0?99:types.indexOf(a.type))-(types.indexOf(b.type)<0?99:types.indexOf(b.type)));
        const alt = nodes(e,'link').find(n => !n.getAttribute('rel') || n.getAttribute('rel') === 'alternate');
        const page = safe(alt?.getAttribute('href') || alt?.textContent?.trim());
        return {title:text(e,'title') || 'Untitled', guid:text(e,'guid') || text(e,'id') || audio || page, audio_url:audio,page_url:page,
          published_at:text(e,'pubDate') || text(e,'published') || text(e,'updated'),duration_s:duration(text(e,'duration')),audio_bytes:Number(enclosure?.getAttribute('length')) || null,transcripts};
      }).filter(e=>e.guid) };
  }
  function segments(content, format) {
    if (typeof content !== 'string' || bytes(content)>5*1024*1024) L.fail('TRANSCRIPT_TOO_LARGE');
    if (format === 'md') format = 'txt';
    if (format === 'json') {
      let j; try { j=JSON.parse(content); } catch { L.fail('INVALID_TRANSCRIPT'); }
      const rows = Array.isArray(j) ? j : j.segments;
      if (!Array.isArray(rows)) L.fail('INVALID_TRANSCRIPT');
      content=JSON.stringify(rows.map(r=>({text:r.text || r.body,start:r.start ?? r.startTime,end:r.end ?? r.endTime,speaker:r.speaker?.name || r.speaker})));
    }
    const parsed=L.transcript(content,format), merged=[];
    for (const r of parsed) {
      const prev=merged.at(-1);
      if (prev && prev.text.length+r.text.length<300 && prev.speaker===r.speaker && prev.start==null && r.start==null) { prev.text+='\n'+r.text; prev.end=r.end; }
      else merged.push({...r});
    }
    return merged.map((r,idx)=>({idx,text:r.text,norm:norm(r.text),start_ms:r.start==null?null:Math.round(r.start*1000),end_ms:r.end==null?null:Math.round(r.end*1000),speaker:r.speaker || ''}));
  }
  function xyz(html, source) {
    if (bytes(html)>10*1024*1024) L.fail('PAGE_TOO_LARGE');
    const m=html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!m) L.fail('XYZ_PARSE_FAILED');
    let j;try {j=JSON.parse(m[1]);}catch {L.fail('XYZ_PARSE_FAILED');}
    let show='', episode=null, visited=0;
    const walk=(o,depth=0)=>{
      if (!o || typeof o!=='object' || depth>25 || ++visited>30000) return;
      if (o.podcast?.title) show=o.podcast.title;
      if (o.enclosure?.url && o.title && !episode) episode={title:o.title,guid:o.eid || o.id || source,audio_url:L.url(o.enclosure.url),page_url:source,duration_s:duration(o.duration),audio_bytes:null,published_at:o.pubDate || '',transcripts:[]};
      if (o.pid && o.title && !o.enclosure) show ||= o.title;
      for (const v of Object.values(o)) walk(v,depth+1);
    };walk(j);
    if (!show && !episode) L.fail('XYZ_PARSE_FAILED');
    return {title:show || episode.title,episodes:episode?[episode]:[]};
  }
  const api={...L,bytes,norm,metadata,excerpt,budgetRows,isoDate,feedUrl,feed,segments,xyz,duration};
  if (typeof module!=='undefined') module.exports=api; else root.PodcastCore=api;
})(globalThis);
