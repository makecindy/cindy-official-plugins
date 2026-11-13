(function(root){
  'use strict';
  const labels={
    'zh-CN':{content:'正文',eyebrow:'播客知识纪要',overview:'内容概览',points:'核心观点',chapters:'智能章节',decisions:'关键决策',quotes:'金句时刻',links:'相关链接',full:'完整转录',toc:'目录',evidence:'查看原文依据',raw:'查看未整理原文',unknown:'时间未知',speaker:'说话人',boundary:'摘要与章节由模型归纳，原文引句已匹配转录。未人工核对音频或解读；A/B 不代表已核实身份。',decisionNote:'以下是嘉宾明确表达的选择，可能涉及过往经历，不代表本期形成了待办。',emptyDecisions:'本稿未提取到明确决策。',emptyQuotes:'本稿未提取金句。',emptyLinks:'转录未提供可验证的相关链接。',search:'搜索完整转录',original:'定位原文',ask:'围绕本章追问',reading:'阅读版仅去除汉字间识别空格，并按标点及转折停顿分行；不修正疑似识别错误，时间仍对应整段。',matches:'处匹配',all:'全部原文',generated:'生成于'},
    en:{content:'Content',eyebrow:'Podcast reading notes',overview:'Overview',points:'Key insights',chapters:'Chapters',decisions:'Decisions',quotes:'Memorable quotes',links:'Related links',full:'Full transcript',toc:'Contents',evidence:'Show source evidence',raw:'Show unchanged transcript',unknown:'Time unknown',speaker:'Speaker',boundary:'Model-generated synthesis; quotations matched to the transcript. Audio and interpretation have not been manually verified. A/B identities are unverified.',decisionNote:'Explicit choices described by the speakers may refer to past events; they are not automatically action items.',emptyDecisions:'No explicit decisions extracted.',emptyQuotes:'No quotes extracted.',emptyLinks:'No verified links in the transcript.',search:'Search full transcript',original:'Locate original',ask:'Ask about this chapter',reading:'Reading view removes artificial Chinese spacing and breaks at punctuation and discourse pauses. It does not correct ASR errors or interpolate timestamps.',matches:'matches',all:'All transcript',generated:'Generated'}
  };
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Apply the reading cleanup once to both text and optional source ownership.
  // Keeping owners through deletions also handles spaces at storage boundaries.
  function cleanMapped(text,owners=undefined){
    for(const [pattern,last] of [[/([\p{Script=Han}])\s+(?=[\p{Script=Han}])/gu,false],[/\s+([，。！？；：、])/g,true],[/([，。！？；：、])\s+/g,false]]){
      const pieces=[];let cursor=0;
      text=text.replace(pattern,(match,kept,offset)=>{
        if(owners){const start=offset+(last?match.length-kept.length:0);pieces.push(owners.slice(cursor,offset),owners.slice(start,start+kept.length));cursor=offset+match.length;}
        return kept;
      });
      if(owners){pieces.push(owners.slice(cursor));owners=pieces.flat();}
    }
    return {text,owners};
  }
  function clean(s){return cleanMapped(s).text;}
  function paragraphs(s){return clean(s).replace(/([。！？；]|[.!?](?=\s+[A-Z]))\s*/g,'$1\n').replace(/([，,])\s*(?=(?:但是|所以|不过|因此|同时|而且|实际上|总而言之|比如说|另外))/g,'$1\n').split(/\n+/).map(x=>x.trim()).filter(Boolean);}
  const stamp=(ms,L)=>{if(ms==null)return L.unknown;const seconds=Math.floor(ms/1000);return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(n=>String(n).padStart(2,'0')).join(':');};
  function render(d,{interactive=false}={}){
    const L=labels[d.language]||labels['zh-CN'],time=s=>stamp(s.start_ms,L)+(s.end_ms==null?'':'–'+stamp(s.end_ms,L));
    const anchor=(id,text)=>'<a href="#'+esc(id)+'">'+esc(text)+'</a>';
    const reference=p=>'<details class="evidence"><summary>'+esc(L.evidence)+' · '+esc(time(p))+'</summary><blockquote>'+esc(clean(p.quote))+'</blockquote>'+anchor('original-'+p.segment_id,L.original)+'</details>';
    const point=p=>'<li><p>'+esc(p.text)+'</p>'+reference(p)+'</li>';
    const decisions=d.chapters.flatMap(c=>c.decisions),quotes=d.chapters.flatMap(c=>c.quotes);
    const sections=[['overview',L.overview],['insights',L.points],...d.chapters.map((c,i)=>['chapter-'+i,String(i+1).padStart(2,'0')+' '+c.title]),['decisions',L.decisions],['quotes',L.quotes],['links',L.links],['transcript',L.full]];
    return '<div class="minutes-reader"><nav class="minutes-toc" aria-label="'+esc(L.toc)+'"><details open><summary>'+esc(L.toc)+'</summary>'+sections.map(([id,t])=>anchor(id,t)).join('')+'</details></nav><div class="minutes-body" tabindex="0" role="region" aria-label="'+esc(L.content)+'"><header class="minutes-header"><p class="kicker">'+esc(L.eyebrow)+' · '+esc(d.episode.show_title)+'</p><h1>'+esc(d.episode.title)+'</h1><p class="meta">'+esc(d.episode.duration_s?Math.floor(d.episode.duration_s/60)+' min':'')+' · '+esc(L.generated)+' '+esc(d.created_at.slice(0,10))+'</p><p class="boundary">'+esc(L.boundary)+'</p></header><section id="overview"><h2>'+esc(L.overview)+'</h2><p class="lead">'+esc(d.overview)+'</p></section><section id="insights"><h2>'+esc(L.points)+'</h2><ol>'+d.key_points.map(point).join('')+'</ol></section><div class="section-label">'+esc(L.chapters)+'</div>'+d.chapters.map((c,i)=>'<section class="chapter" id="chapter-'+i+'"><p class="meta">'+String(i+1).padStart(2,'0')+' / '+esc(time({start_ms:d.segments.find(s=>s.idx===c.start_idx)?.start_ms,end_ms:d.segments.find(s=>s.idx===c.end_idx)?.end_ms}))+'</p><h2>'+esc(c.title)+'</h2><p>'+esc(c.summary)+'</p><ul>'+c.points.map(point).join('')+'</ul>'+(interactive?'<button type="button" data-ask-chapter="'+i+'">'+esc(L.ask)+'</button>':'')+'</section>').join('')+'<section id="decisions"><h2>'+esc(L.decisions)+'</h2><p class="meta">'+esc(L.decisionNote)+'</p>'+(decisions.length?'<ul>'+decisions.map(point).join('')+'</ul>':'<p class="meta">'+esc(L.emptyDecisions)+'</p>')+'</section><section id="quotes"><h2>'+esc(L.quotes)+'</h2>'+(quotes.length?quotes.map(p=>'<figure><blockquote>'+esc(clean(p.quote))+'</blockquote><figcaption>'+esc(p.text)+' · '+esc(time(p))+'</figcaption>'+anchor('original-'+p.segment_id,L.original)+'</figure>').join(''):'<p class="meta">'+esc(L.emptyQuotes)+'</p>')+'</section><section id="links"><h2>'+esc(L.links)+'</h2>'+(d.links.length?'<ul>'+d.links.map(l=>'<li><a href="'+esc(l.url)+'" rel="noopener noreferrer" target="_blank">'+esc(l.url)+'</a></li>').join('')+'</ul>':'<p class="meta">'+esc(L.emptyLinks)+'</p>')+'</section><section id="transcript"><h2>'+esc(L.full)+' <small>'+d.segments.length+'</small></h2><p class="meta">'+esc(L.reading)+'</p><label class="transcript-search">'+esc(L.search)+'<input data-transcript-search type="search" placeholder="'+esc(L.search)+'"></label><p role="status" data-match-count></p>'+d.segments.map(s=>'<section class="transcript-segment" id="original-'+esc(s.id)+'" data-transcript-segment><p class="meta">'+esc(time(s))+' · '+esc(s.speaker?L.speaker+' '+s.speaker:L.speaker+' —')+'</p><div class="transcript-lines">'+paragraphs(s.text).map(p=>'<p>'+esc(p)+'</p>').join('')+'</div><details><summary>'+esc(L.raw)+'</summary><pre>'+esc(s.text)+'</pre></details></section>').join('')+'</section></div></div>';
  }
  function bind(container,d,onAsk,normalize=cleanMapped){
    const L=labels[d.language]||labels['zh-CN'];
    const toc=container.querySelector('.minutes-toc details');if(toc&&matchMedia('(max-width:720px)').matches)toc.open=false;
    const body=container.querySelector('.minutes-body');
    const links=Array.from(container.querySelectorAll('.minutes-toc a[href^="#"]'));
    const targets=links.map(a=>({a,target:container.querySelector(a.getAttribute('href'))})).filter(x=>x.target);
    let frame=0;
    function sync(){
      frame=0;if(!body)return;const top=body.getBoundingClientRect().top+96;
      let active=targets[0];for(const item of targets)if(item.target.getBoundingClientRect().top<=top)active=item;
      for(const item of targets)if(item===active)item.a.setAttribute('aria-current','location');else item.a.removeAttribute('aria-current');
    }
    body?.addEventListener('scroll',()=>{if(!frame)frame=requestAnimationFrame(sync);},{passive:true});sync();
    // Storage chunks share timing and speaker; search their continuous text and
    // map each occurrence back to every source chunk it touches.
    const nodes=Array.from(container.querySelectorAll('[data-transcript-segment]'));
    const groups=[];
    for(let i=0;i<d.segments.length;i++){
      const s=d.segments[i],prev=d.segments[i-1];
      if(!prev||s.idx!==prev.idx+1||s.start_ms!==prev.start_ms||s.end_ms!==prev.end_ms||s.speaker!==prev.speaker)groups.push([]);
      groups.at(-1).push({s,i});
    }
    container.querySelector('[data-transcript-search]')?.addEventListener('input',e=>{
      const q=normalize(e.target.value.toLocaleLowerCase()).text.trim(),hits=new Set();
      if(q)for(const group of groups){
        let raw='';const owners=[];
        for(const {s,i} of group){const part=s.text.toLocaleLowerCase();raw+=part;for(let j=0;j<part.length;j++)owners.push(i);}
        const normalized=normalize(raw,owners),text=normalized.text;
        for(let at=text.indexOf(q);at>=0;at=text.indexOf(q,at+1))for(let i=normalized.owners[at];i<=normalized.owners[at+q.length-1];i++)hits.add(i);
      }
      let matches=0;nodes.forEach((node,i)=>{const hit=!q||hits.has(i);node.hidden=!hit;if(hit)matches++;});
      container.querySelector('[data-match-count]').textContent=q?matches+' '+L.matches:L.all;
    });
    container.querySelectorAll('a[href^="#"]').forEach(a=>a.addEventListener('click',e=>{const target=container.querySelector(a.getAttribute('href'));if(target&&body){e.preventDefault();target.hidden=false;body.scrollTo({top:body.scrollTop+target.getBoundingClientRect().top-body.getBoundingClientRect().top-24,behavior:'auto'});target.tabIndex=-1;target.focus({preventScroll:true});sync();}}));
    container.querySelectorAll('[data-ask-chapter]').forEach(b=>b.addEventListener('click',()=>onAsk?.(Number(b.dataset.askChapter))));
  }
  function documentHTML(d,css){
    const serialized=JSON.stringify(d).replace(/</g,'\\u003c');
    return '<!doctype html><html lang="'+esc(d.language)+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(d.episode.title)+'</title><style>'+css+'</style></head><body class="reading-document">'+render(d)+'<script>const cleanMapped='+cleanMapped.toString()+';'+ '('+bind.toString()+')(document,'+serialized+');</script></body></html>';
  }
  // Standalone binder has no external closure dependency.
  function standaloneHTML(d,css){return documentHTML(d,css).replace('const L=labels[d.language]||labels[\'zh-CN\'];','const L='+JSON.stringify(labels[d.language]||labels['zh-CN'])+';');}
  const api={render,bind,clean,paragraphs,documentHTML:standaloneHTML};
  if(typeof module!=='undefined')module.exports=api;else root.PodcastReading=api;
})(globalThis);
