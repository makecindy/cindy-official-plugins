'use strict';
// Sites that publish timed captions but do not expose them as text tracks.
// `read` runs in the page so it uses the page's own login and CORS; it is one
// fixed function, and every caption address is checked against the site's hosts.
(function(root){
  const EMBEDS=/^https:\/\/(?:www\.youtube\.com\/embed\/|www\.youtube-nocookie\.com\/embed\/|player\.vimeo\.com\/video\/|geo\.dailymotion\.com\/player\/|player\.bilibili\.com\/player\.html)/;
  const SITES=[['tiktok',/(^|\.)tiktok\.com$/],['dailymotion',/(^|\.)dailymotion\.com$/],['bilibili',/(^|\.)bilibili\.com$/]];
  const site=url=>{try{const host=new URL(url).hostname;return SITES.find(([,re])=>re.test(host))?.[0]||null;}catch{return null;}};
  async function read(site,hint){
    const LIMIT=2000000;
    const fetchText=async(url,hosts,init)=>{
      const u=new URL(url,location.href);
      if(u.protocol!=='https:'||!hosts.test(u.hostname)||u.username||u.password)throw Error('INVALID_SUBTITLE_SOURCE');
      const r=await fetch(u.href,{signal:AbortSignal.timeout(15000),...init});
      if(!r.ok)throw Error('SUBTITLE_UNAVAILABLE');
      const text=await r.text();
      if(text.length>LIMIT)throw Error('SUBTITLE_TOO_LARGE');
      return text;
    };
    const short=value=>String(value||'').toLowerCase().split(/[-_]/)[0];
    const iso={eng:'en',cmn:'zh',spa:'es',fra:'fr',deu:'de',jpn:'ja',kor:'ko',por:'pt',rus:'ru',ara:'ar',ita:'it',ind:'id',vie:'vi',tha:'th',tur:'tr',hin:'hi'};
    const finish=async(tracks,hosts,videoId,format)=>{
      tracks=tracks.filter(t=>t.url&&t.id).slice(0,60);
      if(!tracks.length)return {ok:true,tracks:[],videoId,cues:[]};
      // The spoken language wins over translations the site generated from it.
      const target=short(hint.target),page=short(document.documentElement.lang);
      const chosen=tracks.find(t=>t.id===hint.track)||tracks.find(t=>t.original)||tracks.find(t=>t.language!==target&&t.language===page)||tracks.find(t=>t.language==='en'&&t.language!==target)||tracks.find(t=>t.language!==target)||tracks[0];
      const text=await fetchText(chosen.url,hosts,format==='bilibili'?{credentials:'omit'}:undefined);
      return {ok:true,tracks:tracks.map(({id,language,label})=>({id,language,label})),chosen:chosen.id,language:chosen.language,format,text,videoId};
    };
    try{
      if(site==='dailymotion'){
        if(!/^[a-z0-9]{1,24}$/i.test(hint.id||''))return {ok:true,tracks:[],cues:[]};
        const data=JSON.parse(await fetchText('https://www.dailymotion.com/player/metadata/video/'+hint.id,/(^|\.)dailymotion\.com$/));
        const tracks=Object.entries(data?.subtitles?.data||{}).map(([id,value])=>({id,language:short(id),label:String(value?.label||id).slice(0,80),url:value?.urls?.[0]}));
        return await finish(tracks,/(^|\.)(dmcdn\.net|dailymotion\.com)$/,'dailymotion:'+hint.id,'text');
      }
      if(site==='tiktok'){
        if(!/^\d{1,24}$/.test(hint.id||''))return {ok:true,tracks:[],cues:[]};
        // The player keeps its post's data in its React props, for feed items too. TikTok refuses
        // scripted page requests, and the JSON in the document only describes the first post opened.
        const fromPlayer=()=>{const node=document.querySelector(`[id^="xgwrapper-"][id$="-${hint.id}"]`);const key=node&&Object.keys(node).find(k=>k.startsWith('__reactFiber'));let fiber=key&&node[key];for(let i=0;i<40&&fiber;i++,fiber=fiber.return){const infos=fiber.memoizedProps?.videoInfo?.subtitleInfos;if(Array.isArray(infos))return infos;}return null;};
        const fromDocument=()=>{try{const item=JSON.parse(document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__').textContent).__DEFAULT_SCOPE__['webapp.video-detail'].itemInfo.itemStruct;return item.id===hint.id?item.video?.subtitleInfos:null;}catch{return null;}};
        const tracks=(fromPlayer()||fromDocument()||[]).filter(t=>/vtt/i.test(t.Format||'')).map(t=>{const code=String(t.LanguageCodeName||'');const base=short(code);return {id:code,language:iso[base]||base,label:code,url:t.Url,original:t.Source==='ASR'};});
        return await finish(tracks,/(^|\.)(tiktok|tiktokcdn|tiktokcdn-us|tiktokv|ibytedtos|byteoversea|muscdn)\.(com|net|us)$/,'tiktok:'+hint.id,'text');
      }
      if(site==='bilibili'){
        const state=globalThis.__INITIAL_STATE__,bvid=state?.bvid||location.pathname.match(/\/(BV\w{1,20})/)?.[1]||new URLSearchParams(location.search).get('bvid'),page=Number(new URLSearchParams(location.search).get('p'))||1;
        const cid=state?.videoData?.pages?.[page-1]?.cid||state?.cid||state?.videoData?.cid;
        if(!bvid||!cid)return {ok:true,tracks:[],cues:[]};
        const reply=JSON.parse(await fetchText(`https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}`,/(^|\.)bilibili\.com$/,{credentials:'include'}));
        const subtitle=reply?.data?.subtitle,tracks=(subtitle?.subtitles||[]).map(t=>{const language=short(String(t.lan||'').replace(/^ai-/,''));return {id:String(t.lan||''),language,label:String(t.lan_doc||t.lan||'').slice(0,80),url:t.subtitle_url};});
        if(!tracks.length&&reply?.data?.need_login_subtitle)return {ok:false,error:'SUBTITLE_LOGIN_REQUIRED'};
        return await finish(tracks,/(^|\.)(hdslb\.com|bilivideo\.com|bilibili\.com)$/,'bilibili:'+bvid+(page>1?'_'+page:''),'bilibili');
      }
      return {ok:true,tracks:[],cues:[]};
    }catch(e){
      return {ok:false,error:['SUBTITLE_TOO_LARGE','SUBTITLE_UNAVAILABLE','INVALID_SUBTITLE_SOURCE'].includes(e.message)?e.message:['TimeoutError','AbortError'].includes(e.name)?'SUBTITLE_TIMEOUT':'SUBTITLE_FETCH_FAILED'};
    }
  }
  function cues(result,parse){
    if(!result?.text)return [];
    if(result.format!=='bilibili')return parse(result.text);
    let body;try{body=JSON.parse(result.text).body;}catch{throw Error('SUBTITLE_RESPONSE_INVALID');}
    if(!Array.isArray(body))throw Error('SUBTITLE_RESPONSE_INVALID');
    return body.filter(c=>Number.isFinite(c?.from)&&Number.isFinite(c?.to)&&c.to>c.from&&typeof c.content==='string'&&c.content.trim()).slice(0,10000).map(c=>({start:c.from,end:c.to,text:c.content.trim().slice(0,4000)}));
  }
  root.CindySiteCaptions={site,embedded:url=>EMBEDS.test(String(url)),read,cues};
})(globalThis);
