'use strict';
// Shared, deterministic input and subtitle handling. No network or host access.
(function(root) {
  // One budget shared by the browser, bridge and public-task adapter. Each
  // model attempt can wait behind one active run in the two-slot scheduler.
  const learningTiming=Object.freeze({model:240000,cancel:15000,queue:30000,transport:30000,resultRetention:330000});
  function learningRequestTimeout(req){
    if(!['subtitles','subtitle-document','translate','explain','summary','conversation','task'].includes(req.op))return learningTiming.transport;
    const attempts=req.op==='subtitles'?(req.editorial?2:3):req.op==='translate'?2:1;
    return attempts*(2*(learningTiming.model+learningTiming.cancel)+learningTiming.queue)+learningTiming.transport;
  }
  const languages = {auto:'Auto',en:'English','zh-CN':'简体中文','zh-TW':'繁體中文',ja:'日本語',ko:'한국어',fr:'Français',de:'Deutsch',es:'Español',it:'Italiano',pt:'Português',ru:'Русский',ar:'العربية',hi:'हिन्दी',th:'ไทย',vi:'Tiếng Việt'};
  // A language directory is not a claim about any model's translation capability.
  const commonLanguages=Object.keys(languages).filter(code=>code!=='auto');
  const codes='aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zu'.split(' ');
  for(const code of codes)if(!languages[code]){try{languages[code]=new Intl.DisplayNames([code],{type:'language'}).of(code);}catch{languages[code]=code;}}
  function validTarget(value){return typeof value==='string'&&((Object.hasOwn(languages,value)&&value!=='auto')||/^custom:[\p{L}\p{M}][\p{L}\p{M}\p{N} ()’'·-]{0,79}$/u.test(value));}
  // Same primary language tag (zh-Hans / zh-CN / zh) means the captions already match the target.
  // YouTube's own translation track (tlang) names Chinese by script; custom names have no track.
  function youtubeTranslationLanguage(target){if(typeof target!=='string'||target.startsWith('custom:'))return null;const map={'zh-CN':'zh-Hans','zh-SG':'zh-Hans','zh-TW':'zh-Hant','zh-HK':'zh-Hant','zh':'zh-Hans'};if(map[target])return map[target];return /^[a-z]{2,3}(?:-[A-Za-z]{2,8})?$/.test(target)?target:null;}
  // After the look-ahead window is satisfied, keep going: next passage after the playhead first, then anything earlier.
  // `ahead` caps how far past the playhead background work reaches (seconds); earlier passages are always eligible.
  function backgroundSubtitleChunk(chunks,time,now=Date.now(),ahead=Infinity){const open=(chunks||[]).filter(c=>!c.done&&!c.error&&!c.busy&&!(c.retryAt>now)).sort((a,b)=>a.words[0].start-b.words[0].start);return open.find(c=>c.words.at(-1).end>time&&c.words[0].start<=time+ahead)||open.find(c=>c.words.at(-1).end<=time)||null;}
  function sameLanguage(a,b){const base=v=>typeof v==='string'&&!v.startsWith('custom:')?v.toLowerCase().split(/[-_]/)[0]:'';const x=base(a),y=base(b);return !!x&&x===y;}
  function languageName(value){return Object.hasOwn(languages,value)?languages[value]:validTarget(value)?value.slice(7):'';}
  const operations = new Set(['translate','explain','summary','conversation','save','list','remove','review','import','preferences','config','task','subtitles','subtitle-document','subtitle-cache-clear']);
  function string(value,max,required=false) {
    if (typeof value !== 'string' || value.length>max || (required && !value.trim())) throw Error('INVALID_INPUT');
    return value;
  }
  function source(value) {
    if (!value) return {url:'',title:''};
    const url=string(value.url || '',8192), title=string(value.title || '',500);
    if (url && !/^https?:$/.test(new URL(url).protocol)) throw Error('INVALID_SOURCE');
    const time=value.time;
    if (time!==undefined && (!Number.isFinite(time) || time<0 || time>864000)) throw Error('INVALID_TIME');
    return {url:url ? new URL(url).href : '',title,...(time===undefined?{}:{time})};
  }
  function validate(input) {
    if (!input || !operations.has(input.op)) throw Error('INVALID_OPERATION');
    const out={op:input.op,source:source(input.source)};
    if (input.target!==undefined) {
      if (!validTarget(input.target)) throw Error('INVALID_LANGUAGE');
      out.target=input.target;
    }
    if (input.language!==undefined) {
      if (!Object.hasOwn(languages,input.language)) throw Error('INVALID_LANGUAGE');
      out.language=input.language;
    }
    for (const [key,max] of [['text',20000],['translation',20000],['context',input.op==='subtitle-document'||(input.op==='subtitles'&&input.editorial===true)?8000:4000],['query',200],['scenario',1000],['instruction',4000]]) if(input[key]!==undefined) out[key]=string(input[key],max);
    if (['translate','explain','summary','conversation','save','task'].includes(out.op) && !out.text?.trim() && !input.texts) throw Error('EMPTY_TEXT');
    if (input.texts!==undefined) {
      if(out.op!=='translate' || !Array.isArray(input.texts) || !input.texts.length || input.texts.length>24) throw Error('INVALID_BATCH');
      out.texts=input.texts.map(x=>string(x,4000,true));
      if(out.texts.join('').length>20000) throw Error('BATCH_TOO_LARGE');
    }
    if(out.op==='subtitle-document'&&!out.text?.trim())throw Error('EMPTY_TEXT');
    if(out.op==='subtitles') {
      out.editorial=input.editorial===true;
      if(!Array.isArray(input.words)||!input.words.length||input.words.length>(out.editorial?360:240))throw Error('INVALID_BATCH');
      out.words=input.words.map((w,i)=>{const text=string(w.text,500,true);if(!Number.isFinite(w.start)||!Number.isFinite(w.end)||w.start<0||w.end<=w.start||w.end>864000||(i&&w.start<input.words[i-1].end-.001))throw Error('INVALID_TIME');return {text,start:w.start,end:w.end,breakBefore:w.breakBefore===true};});
      if(out.words.map(w=>w.text).join('').length>12000)throw Error('BATCH_TOO_LARGE');
      if(input.nextStart!==undefined){if(!Number.isFinite(input.nextStart)||input.nextStart<out.words.at(-1).end||input.nextStart>864000)throw Error('INVALID_TIME');out.nextStart=input.nextStart;}
    }
    if (input.id!==undefined) out.id=string(input.id,100,true);
    if (['remove','review','task'].includes(out.op) && !out.id) throw Error('INVALID_ID');
    if(out.op==='task'&&!/^[a-f0-9-]{36}$/.test(out.id))throw Error('INVALID_ID');
    if(out.op==='review') {if(!['again','hard','good','easy'].includes(input.rating)) throw Error('INVALID_RATING');out.rating=input.rating;}
    if(out.op==='import') {
      if(!Array.isArray(input.entries) || input.entries.length>500) throw Error('IMPORT_TOO_LARGE');
      out.entries=input.entries.map(e=>validate({...e,op:'save'}));
    }
    if(out.op==='list') {
      out.offset=Number.isInteger(input.offset)&&input.offset>=0?input.offset:0;
      out.limit=Number.isInteger(input.limit)?Math.min(100,Math.max(1,input.limit)):50;
      out.due=input.due===true;
    }
    return out;
  }
  function timestamp(text) {
    const values=text.replace(',','.').split(':').map(Number);
    if(values.length<2 || values.length>3 || values.some(x=>!Number.isFinite(x)||x<0)) return NaN;
    return values.reduce((v,n)=>v*60+n,0);
  }
  // Strip caption markup without a partial multi-character regex. Caption
  // text is later assigned through textContent, but removing tags here keeps
  // the parser's plain-text contract explicit and avoids treating a malformed
  // `<script` prefix as markup.
  function stripCaptionMarkup(value) {
    let output='';
    for(let i=0;i<value.length;i++){
      if(value[i]!=='<'){output+=value[i];continue;}
      let cursor=i+1;if(value[cursor]==='/')cursor++;
      const first=value.charCodeAt(cursor);
      if(!((first>=65&&first<=90)||(first>=97&&first<=122))){output+='<';continue;}
      while(cursor<value.length){
        const code=value.charCodeAt(cursor);
        if(!((code>=65&&code<=90)||(code>=97&&code<=122)||(code>=48&&code<=57)||code===45||code===58||code===95))break;
        cursor++;
      }
      while(cursor<value.length&&value[cursor]!=='>'&&value[cursor]!=='<'&&value[cursor]!=='\n'&&value[cursor]!=='\r')cursor++;
      if(value[cursor]==='>'){i=cursor;continue;}
      output+='<';
    }
    return output;
  }
  const captionEntities=Object.freeze({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",'#39':"'"});
  function decodeCaptionEntities(value) {
    return value.replace(/&(?:amp|lt|gt|quot|apos|#39);/gi,entity=>captionEntities[entity.slice(1,-1).toLowerCase()]||entity);
  }
  function parseSubtitles(text) {
    if(typeof text!=='string' || text.length>2000000) throw Error('SUBTITLE_TOO_LARGE');
    const cues=[];
    for(const block of text.replace(/\r/g,'').split(/\n\s*\n/)) {
      const lines=block.split('\n'), i=lines.findIndex(l=>l.includes('-->'));
      if(i<0)continue;
      const [a,b]=lines[i].split('-->'),start=timestamp(a.trim()),end=timestamp(b.trim().split(/\s/)[0]);
      const content=decodeCaptionEntities(stripCaptionMarkup(lines.slice(i+1).join(' '))).trim();
      if(Number.isFinite(start)&&Number.isFinite(end)&&end>start&&content) cues.push({start,end,text:content.slice(0,4000)});
      if(cues.length>10000)throw Error('SUBTITLE_TOO_LARGE');
    }
    return cues.sort((a,b)=>a.start-b.start);
  }
  function joinWords(words) {
    let text='';for(const w of words){const part=w.text.trim();if(!part)continue;const tight=/^[,.;:!?，。！？、；：)\]”’]/u.test(part)||/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}，。！？、；：]$/u.test(text)&&/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(part);text+=(text&&!tight?' ':'')+part;}return text;
  }
  function timedWords(text,start,end) {
    const parts=text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu)||[];
    const total=parts.reduce((n,p)=>n+p.length,0);let offset=0;
    return parts.map(text=>{const a=start+(end-start)*offset/total;offset+=text.length;return {text,start:a,end:start+(end-start)*offset/total};});
  }
  function youtubeSubtitles(data) {
    const cues=[],events=(Array.isArray(data.events)?data.events:[]).filter(e=>Array.isArray(e?.segs)&&Number.isFinite(e.tStartMs)&&Number.isFinite(e.dDurationMs)&&e.tStartMs>=0&&e.dDurationMs>0&&e.segs.some(s=>typeof s.utf8==='string'&&s.utf8.trim()));
    for(let eventIndex=0;eventIndex<events.length;eventIndex++){
      const e=events[eventIndex];
      if(!Array.isArray(e.segs)||!Number.isFinite(e.tStartMs)||!Number.isFinite(e.dDurationMs)||e.tStartMs<0||e.dDurationMs<=0)continue;
      const start=e.tStartMs/1000,end=(e.tStartMs+e.dDurationMs)/1000,segs=e.segs.filter(s=>typeof s.utf8==='string'&&s.utf8.trim());
      if(segs.length&&segs[0].tOffsetMs===undefined)segs[0]={...segs[0],tOffsetMs:0};
      const text=segs.map(s=>s.utf8).join('').trim();if(!text)continue;if(text.length>4000||cues.length>=10000)throw Error('SUBTITLE_TOO_LARGE');
      let words;
      if(segs.every((s,i)=>Number.isFinite(s.tOffsetMs)&&s.tOffsetMs>=0&&s.tOffsetMs<e.dDurationMs&&(!i||s.tOffsetMs>=segs[i-1].tOffsetMs))){
        words=[];for(let i=0;i<segs.length;){let j=i+1;while(j<segs.length&&segs[j].tOffsetMs===segs[i].tOffsetMs)j++;const group=segs.slice(i,j),speakerChange=group.some(s=>s.isSpeakerChange===1||/^\s*>>/.test(s.utf8)),a=start+segs[i].tOffsetMs/1000,b=j<segs.length?start+segs[j].tOffsetMs/1000:Math.max(a+.01,Math.min(end,(events[eventIndex+1]?.tStartMs??end*1000)/1000)),part=timedWords(group.map(s=>s.utf8).join('').replace(/^\s*>>\s*/,''),a,b);if(part.length)part[0].breakBefore=speakerChange;words.push(...part);i=j;}
      }
      cues.push({start,end,text,...(words?{words}:{})});
    }
    return cues;
  }
  function subtitleWords(raw,editorial=false) {
    const result=[];let previous;
    for(const cue of [...raw].sort((a,b)=>a.start-b.start)){
      if(!cue.text?.trim()||!Number.isFinite(cue.start)||!Number.isFinite(cue.end)||cue.end<=cue.start)continue;
      if(previous&&cue.start===previous.start&&cue.end===previous.end&&cue.text===previous.text)continue;
      let words=cue.words?.length?cue.words.map(w=>({...w})):timedWords(editorial?cue.text.replace(/^\s*>>\s*/,''):cue.text,cue.start,cue.end);
      if(editorial)words=words.filter(w=>!/^(?:>>|[♪♫]+)$/.test(w.text.trim()));
      // Remove the repeated prefix of an overlapping rolling-caption window, not spoken repetitions.
      if(!cue.words?.length&&previous&&cue.start<previous.end&&words.length>2){let overlap=0;for(let n=2;n<words.length&&n<=Math.min(result.length,30);n++)if(words.slice(0,n).every((w,i)=>w.text.trim()===result[result.length-n+i].text.trim()))overlap=n;if(overlap)words=words.slice(overlap);}
      if(words.length){words[0].breakBefore=Boolean(words[0].breakBefore||result.length&&(words[0].start-result.at(-1).end>=(editorial?1.2:.65)||/^\s*(?:>>|[-–—]\s)/u.test(cue.text)||!editorial&&(/^\s*\[/u.test(cue.text)||/\]\s*$/.test(previous?.text||''))));result.push(...words);}
      previous=cue;
    }
    // Conflicting source timestamps must not silently drop words or reorder spoken text.
    for(let i=1;i<result.length;i++)if(result[i].start<=result[i-1].start){result[i].start=result[i-1].start+.01;result[i].end=Math.max(result[i].end,result[i].start+.01);}
    for(let i=0;i<result.length-1;i++)if(result[i].end>result[i+1].start)result[i].end=result[i+1].start;
    return result;
  }
  function subtitleChunks(words,editorial=false) {
    const chunks=[];let start=0;
    while(start<words.length){let end=Math.min(start+180,words.length);
      if(editorial){let chars=0;for(let i=start;i<end;i++){chars+=words[i].text.length;if(i>start&&(chars>3200||words[i].start-words[start].start>=45)){end=i;break;}}}
      if(end<words.length){for(let i=end;i>start+Math.min(60,Math.floor((end-start)/2));i--)if(words[i]?.breakBefore||/[.!?。！？]["”’]?$/u.test(words[i-1].text)){end=i;break;}}
      chunks.push({start,end,words:words.slice(start,end),nextStart:words[end]?.start});start=end;
    }return chunks;
  }
  // These codes describe structure only; never include model output or page text in errors.
  function subtitleSegments(words,groups,nextStart,editorial=false) {
    if(!Array.isArray(groups)||!groups.length||groups.length>words.length)throw Error('SUBTITLE_FORMAT');
    const cues=[];let first=0;
    for(const group of groups){
      const last=group?.end;
      if(!Number.isInteger(last)||last<first||last>=words.length||(group.start!==undefined&&group.start!==first))throw Error('SUBTITLE_COVERAGE');
      if(typeof group.translation!=='string'||!group.translation.trim())throw Error('SUBTITLE_TRANSLATION');
      const segment=words.slice(first,last+1),sourceText=joinWords(segment),text=editorial?cleanSubtitleText(group.text):sourceText,start=segment[0].start,speechEnd=Math.min(segment.at(-1).end,start+8.5);
      if(!text)throw Error('SUBTITLE_TRANSLATION');
      if(segment.slice(1).some(w=>w.breakBefore))throw Error('SUBTITLE_PAUSE');
      if(segment.at(-1).start-start>=8.5)throw Error('SUBTITLE_DURATION');
      if(text.length>110||group.translation.trim().length>110)throw Error('SUBTITLE_LENGTH');
      const boundary=words[last+1]?.start??nextStart??speechEnd+.5;
      const reading=Math.max(1.2,Math.min(7,Math.max(text.length/20,group.translation.length/12)));
      const end=Math.min(boundary,start+8.5,speechEnd+.7,Math.max(speechEnd+.15,start+reading,editorial&&boundary-speechEnd<=.7?boundary:0));
      if(end<=start)throw Error('SUBTITLE_DURATION');
      const translation=editorial?cleanSubtitleText(group.translation):group.translation.trim();if(!translation)throw Error('SUBTITLE_TRANSLATION');
      cues.push({start,end,text,translation,...(editorial?{sourceText,paragraphEnd:group.paragraphEnd===true}:{})});first=last+1;
    }
    if(first!==words.length)throw Error('SUBTITLE_COVERAGE');return cues;
  }
  function cleanSubtitleText(text) {
    return typeof text==='string'?stripCaptionMarkup(text).replace(/^\s*>>\s*/,'').replace(/[♪♫]+/g,'').replace(/\s+/g,' ').trim():'';
  }
  function subtitleTurns(words) {
    const turns=[];let start=0;
    for(let i=1;i<=words.length;i++)if(i===words.length||words[i].breakBefore){turns.push({id:turns.length,start,end:i,words:words.slice(start,i)});start=i;}
    return turns;
  }
  // Align edited prose to original speech using monotonic lexical anchors. The model
  // writes language, never indices or timestamps. Removed fillers remain inside the
  // neighbouring caption's source range; speaker boundaries are applied before this.
  function alignSubtitleTurn(words,captions,nextStart) {
    if(!Array.isArray(captions)||!captions.length||captions.length>words.length)throw Error('SUBTITLE_FORMAT');
    const normalize=text=>text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
    const source=words.map(w=>normalize(w.text)),edited=[],ends=[];
    for(const caption of captions){const text=cleanSubtitleText(caption.text);if(!text)throw Error('SUBTITLE_TRANSLATION');for(const w of timedWords(text,0,1))edited.push(normalize(w.text));ends.push(edited.length);}
    if(edited.length>words.length*3+20)throw Error('SUBTITLE_COVERAGE');
    const rows=Array.from({length:source.length+1},()=>new Uint16Array(edited.length+1));
    for(let i=source.length-1;i>=0;i--)for(let j=edited.length-1;j>=0;j--)rows[i][j]=source[i]&&source[i]===edited[j]?1+rows[i+1][j+1]:Math.max(rows[i+1][j],rows[i][j+1]);
    const anchors=new Map();let i=0,j=0;
    while(i<source.length&&j<edited.length){if(source[i]&&source[i]===edited[j]){anchors.set(j,i);i++;j++;}else if(rows[i+1][j]>=rows[i][j+1])i++;else j++;}
    const groups=[];let from=0,last=-1;
    for(let k=0;k<captions.length;k++){
      const matches=[];for(let p=from;p<ends[k];p++)if(anchors.has(p))matches.push(anchors.get(p));
      // Refuse a paraphrase with no lexical alignment instead of inventing timing.
      if(!matches.length)throw Error('SUBTITLE_COVERAGE');
      const end=k===captions.length-1?words.length-1:matches.at(-1);
      if(end<=last)throw Error('SUBTITLE_COVERAGE');groups.push({...captions[k],end});last=end;from=ends[k];
    }
    return subtitleSegments(words,groups,nextStart,true);
  }
  // YouTube lists caption tracks alphabetically by language, so "the first manual track" is
  // often Arabic on an English video. The spoken language is whatever the auto-generated (asr)
  // track is in, or what the audio track's default caption points at; prefer a manual track in
  // that language, then the asr track itself.
  function youtubeCaptionTrack(tracks,wanted,defaultIndex) {
    const list=Array.isArray(tracks)?tracks.filter(t=>t&&typeof t.language==='string'):[];
    if(!list.length)return undefined;
    const base=code=>String(code||'').toLowerCase().split(/[-_]/)[0];
    if(wanted&&wanted!=='auto'){const exact=list.find(t=>t.language===wanted)||list.find(t=>base(t.language)===base(wanted));if(exact)return exact;}
    const asr=list.find(t=>t.kind==='asr');
    const preset=Number.isInteger(defaultIndex)?tracks[defaultIndex]:undefined;
    const spoken=base(asr?.language||preset?.language);
    if(spoken){const manual=list.find(t=>t.kind!=='asr'&&base(t.language)===spoken);if(manual)return manual;}
    return asr||(preset&&list.includes(preset)?preset:undefined)||list.find(t=>t.kind!=='asr')||list[0];
  }
  function subtitleDocument(cues) {
    const paragraphs=[];let text=[],translation=[];
    const flush=()=>{if(text.length)paragraphs.push({text:joinWords(text.map(text=>({text}))),translation:joinWords(translation.map(text=>({text})))});text=[];translation=[];};
    for(const cue of cues){text.push(cue.text);translation.push(cue.translation||'');if(cue.paragraphEnd)flush();}flush();return paragraphs;
  }
  // Coverage comes from finished preparation windows, not caption density: genuine silence is ready too.
  function pendingSubtitleChunks(chunks,time,rate=1,now=Date.now()) {
    const until=time+90*Math.max(.25,rate);
    return (chunks||[]).filter(c=>!c.done&&!c.error&&!c.busy&&!(c.retryAt>now)&&c.words.at(-1).end>time&&c.words[0].start<=until);
  }
  function subtitleBuffer(chunks,time,rate=1) {
    if(!chunks?.length)return {ahead:0,ready:false,complete:false};
    const ordered=[...chunks].sort((a,b)=>a.start-b.start),remaining=ordered.filter(c=>c.words.at(-1).end>time);
    if(!remaining.length)return {ahead:Infinity,ready:true,complete:true};
    let until=time,complete=true;
    for(const chunk of remaining){if(!chunk.done){complete=false;until=Math.max(until,chunk.words[0].start);break;}until=chunk.nextStart??chunk.words.at(-1).end;}
    const ahead=Math.max(0,until-time)/Math.max(.25,rate);
    return {ahead,ready:complete||ahead>=15,complete};
  }
  function subtitlePreparation(chunks,time=0,now=Date.now()){
    const all=chunks||[],total=all.reduce((n,c)=>n+c.words.length,0),done=all.filter(c=>c.done),completed=done.reduce((n,c)=>n+c.words.length,0);
    const pending=all.filter(c=>!c.done&&c.words.at(-1).end>time),chunk=pending.find(c=>c.words[0].start<=time)||pending.find(c=>c.busy||c.error||c.retryAt>now);
    const p=chunk?.progress;
    return {percent:total?Math.floor(completed/total*100):0,done:done.length,total:all.length,
      ahead:all.length?subtitleBuffer(all,time).ahead:0,complete:total>0&&completed===total,
      stage:chunk?.error?'failed':chunk?.retryAt>now?'retry':p?.stage||(all.length?'prepared':'reading'),
      receivedChars:p?.receivedChars||0,errorStage:chunk?.error?p?.stage:undefined,elapsed:p?Math.max(0,Math.floor(((p.finishedAt||now)-p.updatedAt)/1000)):0,attempt:p?.attempt||1,
      range:chunk?[chunk.words[0].start,chunk.words.at(-1).end]:null,
      cached:done.filter(c=>c.cache?.state==='hit').length,saved:done.filter(c=>['hit','saved'].includes(c.cache?.state)).length,
      cacheError:done.find(c=>c.cache?.state==='unavailable')?.cache?.error};
  }
  function splitSubtitleChunk(chunk) {
    const {words}=chunk;if(words.length<2)return [];
    const middle=Math.floor(words.length/2),candidates=[];
    for(let i=1;i<words.length;i++)if(words[i].breakBefore||/[.!?。！？,，;；]["”’]?$/u.test(words[i-1].text))candidates.push(i);
    const cut=candidates.sort((a,b)=>Math.abs(a-middle)-Math.abs(b-middle))[0]||middle;
    const depth=(chunk.depth||0)+1,start=chunk.start||0;
    return [{start,end:start+cut,words:words.slice(0,cut),nextStart:words[cut].start,depth},{start:start+cut,end:start+words.length,words:words.slice(cut),nextStart:chunk.nextStart,depth}];
  }
  function clock(seconds) {
    const ms=Math.max(0,Math.round(seconds*1000)), sec=Math.floor(ms/1000);
    return [Math.floor(sec/3600),Math.floor(sec/60)%60,sec%60].map(n=>String(n).padStart(2,'0')).join(':')+','+String(ms%1000).padStart(3,'0');
  }
  function exportSubtitles(cues) {return cues.map((c,i)=>`${i+1}\n${clock(c.start)} --> ${clock(c.end)}\n${c.text}${c.translation?'\n'+c.translation:''}\n`).join('\n');}
  function schedule(entry,rating,now=Date.now()) {
    const previous=Number(entry.interval)||0;
    const days=rating==='again'?0:rating==='hard'?Math.max(1,previous*1.2):rating==='easy'?Math.max(4,previous*3):Math.max(1,previous*2.2);
    return {...entry,interval:days,due:now+(days?days*86400000:600000),reviews:(entry.reviews||0)+1,updated:now};
  }
  function uuid(){if(globalThis.crypto.randomUUID)return globalThis.crypto.randomUUID();const bytes=globalThis.crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;return Array.from(bytes,(v,i)=>([4,6,8,10].includes(i)?'-':'')+v.toString(16).padStart(2,'0')).join('');}
  const api={youtubeCaptionTrack,youtubeTranslationLanguage,backgroundSubtitleChunk,sameLanguage,learningTiming,learningRequestTimeout,uuid,languages,commonLanguages,validTarget,languageName,validate,parseSubtitles,exportSubtitles,schedule,source,joinWords,youtubeSubtitles,subtitleWords,subtitleChunks,subtitleSegments,splitSubtitleChunk,cleanSubtitleText,subtitleTurns,alignSubtitleTurn,subtitleDocument,subtitleBuffer,pendingSubtitleChunks,subtitlePreparation};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.CindyLearning=api;
})(globalThis);
