// Persist only validated bilingual captions through the declared Library slot.
// Files are keyed by video identity and target language; browser profiles share them.
export function createSubtitleCache({library,core}) {
  const queues=new Map();
  const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const ok=r=>{if(!r?.ok)throw Error(r?.errorCode||'LIBRARY_UNAVAILABLE');return r;};
  async function file(client,req){
    if(!req.source?.url)throw Error('CACHE_SOURCE_MISSING');
    const url=new URL(req.source.url);
    let identity=url.href;
    if(req.source.videoId)identity=req.source.videoId;
    else if(/(^|\.)youtube\.com$/.test(url.hostname)&&url.searchParams.get('v'))identity='youtube:'+url.searchParams.get('v');
    // Library path segments are capped at 64 characters by the host; a full SHA-256 plus ".json" is 69.
    return `browser/subtitles/${(await hash([1,identity,req.target||'zh-CN'])).slice(0,48)}.json`;
  }
  const key=(words,nextStart)=>hash([1,words,nextStart]);
  function lock(path,fn){const promise=(queues.get(path)||Promise.resolve()).then(fn,fn);queues.set(path,promise);promise.finally(()=>{if(queues.get(path)===promise)queues.delete(path);}).catch(()=>{});return promise;}
  async function read(path){
    ok(await library({op:'open'}));const r=await library({op:'read',path});
    if(!r?.ok&&['NOT_FOUND','FILE_NOT_FOUND','ENOENT'].includes(r?.errorCode))return {version:1,entries:{}};
    ok(r);let data;try{data=JSON.parse(r.content);}catch{throw Error('CACHE_CORRUPT');}
    if(data?.version!==1||!data.entries||Array.isArray(data.entries)||typeof data.entries!=='object')throw Error('CACHE_CORRUPT');
    return data;
  }
  async function open(client,req){
    if(!library)throw Error('LIBRARY_UNAVAILABLE');const path=await file(client,req),data=await lock(path,()=>read(path));
    return {
      async get(words,nextStart){
        const entry=data.entries[await key(words,nextStart)];if(!entry)return null;
        // Re-align persisted text against the actual current words and timing.
        // A changed transcript or corrupt record never supplies stale timestamps.
        try{return {cues:core.alignSubtitleTurn(words,entry.captions,nextStart),model:entry.model};}catch{return null;}
      },
      async put(words,nextStart,cues,model){
        const id=await key(words,nextStart),entry={captions:cues.map(c=>({text:c.text,translation:c.translation,paragraphEnd:!!c.paragraphEnd})),...(typeof model==='string'?{model}:{}),at:Date.now()};
        await lock(path,async()=>{
          const latest=await read(path);if((latest.revision||0)!==(data.revision||0))throw Error('CACHE_INVALIDATED');latest.entries[id]=entry;
          const content=JSON.stringify(latest);
          if(new TextEncoder().encode(content).length>8000000)throw Error('CACHE_FULL');
          ok(await library({op:'write',path,content}));data.entries[id]=entry;
        });
      }
    };
  }
  async function clear(client,req){const path=await file(client,req);await lock(path,async()=>{ok(await library({op:'open'}));ok(await library({op:'write',path,content:JSON.stringify({version:1,revision:crypto.randomUUID(),entries:{}})}));});}
  return {open,clear};
}
