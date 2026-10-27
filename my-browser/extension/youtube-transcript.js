'use strict';
(function(root) {
  // Runs in the verified video document. Use YouTube's own transcript UI when
  // timedtext returns an empty response; no tokens, cookies or private APIs.
  async function read(expectedURL) {
    // The transcript may render in the dedicated panel or inside the newer "In this video"
    // panel, which carries no target-id: identify panels by their segments, never by id.
    const panelSelector='ytd-engagement-panel-section-list-renderer';
    // YouTube serves either the classic transcript renderer or the modern
    // view-model panel (target-id PAmodern_transcript_view). Chapter headers in
    // the modern panel are separate elements and never match these rows.
    const segmentSelector='ytd-transcript-segment-renderer, transcript-segment-view-model';
    const expanded=p=>p?.getAttribute('visibility')==='ENGAGEMENT_PANEL_VISIBILITY_EXPANDED';
    const visible=selector=>[...document.querySelectorAll(selector)].find(n=>n.getClientRects().length);
    const transcriptPanel=()=>[...document.querySelectorAll(panelSelector)].find(p=>expanded(p)&&p.querySelector(segmentSelector));
    const existing=transcriptPanel();
    let opened=false,expandedDescription=false,interacted=false;
    const interaction=e=>{if(e.isTrusted)interacted=true;};
    const current=()=>{
      if(location.href!==expectedURL)throw Error('PAGE_CHANGED');
      const id=new URL(expectedURL).searchParams.get('v');
      const playing=document.querySelector('ytd-watch-flexy')?.getAttribute('video-id');
      if(id&&playing&&id!==playing)throw Error('PAGE_CHANGED');
    };
    document.addEventListener('pointerdown',interaction,true);
    document.addEventListener('keydown',interaction,true);
    document.addEventListener('wheel',interaction,{capture:true,passive:true});
    try {
      current();
      if(!existing){
        // YouTube renders the transcript entry only inside the expanded
        // description. Expand it temporarily instead of reporting no captions.
        let button=document.querySelector('ytd-video-description-transcript-section-renderer button');
        if(!button){
          const expand=visible('ytd-watch-metadata #description-inline-expander #expand, #description-inline-expander #expand');
          if(!expand)return {ok:true,cues:[]};
          expand.click();expandedDescription=true;
          const shown=Date.now()+3000;
          while(!(button=document.querySelector('ytd-video-description-transcript-section-renderer button'))&&Date.now()<shown){
            await new Promise(resolve=>setTimeout(resolve,100));current();
          }
          if(!button)return {ok:true,cues:[]};
        }
        button.click();opened=true;
      }
      const deadline=Date.now()+12000;let signature='',stable=0;
      while(Date.now()<deadline){
        current();
        const panel=transcriptPanel();
        const nodes=[...(panel?.querySelectorAll(segmentSelector)||[])];
        if(nodes.length>10000)throw Error('SUBTITLE_TOO_LARGE');
        const next=nodes.length+':'+nodes.at(-1)?.textContent;
        if(nodes.length&&next===signature)stable++;else stable=0;
        signature=next;
        if(stable>=2){
          let bytes=0;
          const rows=nodes.map(n=>{
            const data=n.data?.transcriptSegmentRenderer||n.data;
            const exact=Number(data?.startMs)/1000,end=Number(data?.endMs)/1000;
            const stamp=n.querySelector('.segment-timestamp, .ytwTranscriptSegmentViewModelTimestamp')?.textContent.trim();
            const start=Number.isFinite(exact)?exact:/^\d+(?::\d{2}){1,2}$/.test(stamp||'')?stamp.split(':').reduce((sum,x)=>sum*60+Number(x),0):NaN;
            const text=n.querySelector('.segment-text, .ytAttributedStringHost')?.textContent.trim()||'';
            bytes+=text.length*2;
            if(text.length>4000||bytes>2000000)throw Error('SUBTITLE_TOO_LARGE');
            return {start,end,text};
          });
          // Never silently return a partial transcript when YouTube changes markup.
          if(rows.some(r=>!Number.isFinite(r.start)||r.start<0||!r.text))throw Error('SUBTITLE_RESPONSE_INVALID');
          const cues=[];const duration=document.querySelector('video')?.duration;
          for(let i=0;i<rows.length;){
            let j=i+1;while(j<rows.length&&rows[j].start===rows[i].start)j++;
            const row=rows[i],end=Number.isFinite(row.end)&&row.end>row.start?row.end:rows[j]?.start??duration;
            if(!Number.isFinite(end)||end<=row.start)throw Error('SUBTITLE_RESPONSE_INVALID');
            const text=rows.slice(i,j).map(r=>r.text).join(' ');
            if(text.length>4000)throw Error('SUBTITLE_TOO_LARGE');
            cues.push({start:row.start,end,text});i=j;
          }
          current();
          return {ok:true,cues};
        }
        await new Promise(resolve=>setTimeout(resolve,150));
      }
      throw Error('SUBTITLE_UNAVAILABLE');
    }catch(e){return {ok:false,error:['PAGE_CHANGED','SUBTITLE_TOO_LARGE','SUBTITLE_RESPONSE_INVALID'].includes(e.message)?e.message:'SUBTITLE_UNAVAILABLE'};}
    finally{
      document.removeEventListener('pointerdown',interaction,true);
      document.removeEventListener('keydown',interaction,true);
      document.removeEventListener('wheel',interaction,{capture:true});
      // Close only the panel we opened, and only if the user has not taken over.
      if(opened&&!interacted&&location.href===expectedURL)
        transcriptPanel()?.querySelector('#visibility-button button')?.click();
      if(expandedDescription&&!interacted&&location.href===expectedURL)
        visible('ytd-watch-metadata tp-yt-paper-button#collapse, #description-inline-expander #collapse')?.click();
    }
  }
  const api={read};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.CindyYoutubeTranscript=api;
})(globalThis);
