'use strict';
(function(root) {
  function publicAddress(ip) {
    if (typeof ip !== 'string') return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
      const [a,b,c,d]=ip.split('.').map(Number);
      return [a,b,c,d].every(n=>n<=255) && a!==0 && a!==10 && a!==127 && a<224 &&
        !(a===100 && b>=64 && b<=127) && !(a===169 && b===254) && !(a===172 && b>=16 && b<=31) &&
        !(a===192 && (b===168 || (b===0 && [0,2].includes(c)) || (b===88 && c===99))) &&
        !(a===198 && ([18,19].includes(b) || (b===51 && c===100))) && !(a===203 && b===0 && c===113);
    }
    // Accept global IPv6 unicast only; mapped/translation, link-local, ULA,
    // multicast, documentation and transition ranges never become public evidence.
    try {
      const host=new URL('http://['+ip+']/').hostname.slice(1,-1);
      const [first,second]=host.split(':').map(x=>parseInt(x || '0',16));
      return first>=0x2000 && first<=0x3fff && first!==0x2002 && first!==0x3fff &&
        !(first===0x2001 && (second<0x200 || second===0xdb8));
    } catch {return false;}
  }
  const networkURL=value=>{const u=new URL(value);u.hash='';return u.href;};
  function create(chrome) {
    const states=new Map(),requests=new Map(),responses=new Map();
    const filter={urls:['http://*/*','https://*/*'],types:['main_frame']};
    const invalidate=tabId=>{states.delete(tabId);responses.delete(tabId);for(const [id,r] of requests)if(r.tabId===tabId)requests.delete(id);};
    if (chrome.webRequest && chrome.webNavigation) {
      chrome.webNavigation.onBeforeNavigate.addListener(d=>{
        if(d.frameId!==0)return;
        const prev=states.get(d.tabId);
        if(prev && prev.start>d.timeStamp)return;
        states.set(d.tabId,{start:d.timeStamp,document:null});
        // Delivery between the two APIs is not ordered. Compare event times;
        // never attach a late response from an older navigation to the new document.
        // Keep request start times through redirects, including superseded requests.
      });
      chrome.webRequest.onBeforeRequest.addListener(d=>{
        const previous=requests.get(d.requestId);
        if(requests.size>=1024){requests.clear();states.clear();responses.clear();return;}
        const r={tabId:d.tabId,start:previous?.start ?? d.timeStamp,url:d.url};
        requests.set(d.requestId,r);
      },filter);
      chrome.webRequest.onCompleted.addListener(d=>{
        const r=requests.get(d.requestId);requests.delete(d.requestId);
        if(!r || r.tabId!==d.tabId || r.url!==d.url)return;
        const list=responses.get(d.tabId) || [];
        list.push({start:r.start,url:d.url,public:publicAddress(d.ip)});
        responses.set(d.tabId,list.slice(-4));
      },filter);
      chrome.webRequest.onErrorOccurred.addListener(d=>{requests.delete(d.requestId);responses.delete(d.tabId);},filter);
      chrome.webNavigation.onCommitted.addListener(d=>{
        if(d.frameId!==0)return;
        const s=states.get(d.tabId);
        if(s && d.timeStamp>=s.start)s.document={id:d.documentId,url:d.url,time:d.timeStamp};
      });
      chrome.tabs.onRemoved.addListener(invalidate);
    }
    async function document(tabId) {
      const frame=await chrome.webNavigation?.getFrame({tabId,frameId:0});
      const s=states.get(tabId);
      const matches=(responses.get(tabId) || []).filter(r=>s?.document && r.start>=s.start && r.start<=s.document.time && networkURL(r.url)===networkURL(s.document.url));
      if(!frame?.documentId || !s?.document || matches.length!==1 || !matches[0].public || s.document.id!==frame.documentId ||
         new URL(frame.url).origin!==new URL(matches[0].url).origin) throw new Error('ADDRESS_UNVERIFIED');
      return frame.documentId;
    }
    return {document};
  }
  const api={publicAddress,create};
  if(typeof module!=='undefined' && module.exports)module.exports=api;else root.MyBrowserNetwork=api;
})(globalThis);
