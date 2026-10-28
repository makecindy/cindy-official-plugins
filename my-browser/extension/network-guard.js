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
  const unverified=reason=>Object.assign(new Error('ADDRESS_UNVERIFIED'),{reason});
  function hostAddress(host) {
    if (typeof host!=='string' || !host) return null;
    if (host.startsWith('[') && host.endsWith(']')) return host.slice(1,-1);
    if (host.includes(':')) return host;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;
    return null;
  }
  // allowLocal: page control in the user's own browser may reach local and private addresses, as the
  // user's browser does anyway. Learning features keep the public-address rule.
  function assertSupported(value,{allowLocal=false}={}) {
    let u;try{u=new URL(value);}catch{throw unverified('DOCUMENT_UNAVAILABLE');}
    const host=u.hostname.toLowerCase().replace(/\.$/,'');
    if(!['https:','http:'].includes(u.protocol) || u.username || u.password)
      throw unverified('LOCAL_ADDRESS');
    if(['chrome.google.com','chromewebstore.google.com'].some(h=>host===h || host.endsWith('.'+h)))
      throw new Error('BROWSER_PAGE_RESTRICTED');
    if(allowLocal)return;
    const ip=hostAddress(host);
    if(ip){
      if(!publicAddress(ip))throw unverified('LOCAL_ADDRESS');
    }else if(host==='localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
             host.endsWith('.internal') || !host.includes('.')){
      throw unverified('LOCAL_ADDRESS');
    }
  }
  function create(chrome) {
    const readyDocuments=new Map();
    const remember=map=>{if(map.size>1024)map.delete(map.keys().next().value);};
    chrome.webNavigation?.onBeforeNavigate.addListener(d=>{if(d.frameId===0)readyDocuments.delete(d.tabId);});
    chrome.webNavigation?.onDOMContentLoaded?.addListener(d=>{
      if(d.frameId!==0 || !d.documentId)return;
      readyDocuments.set(d.tabId,d.documentId);remember(readyDocuments);
    });
    chrome.tabs.onRemoved?.addListener(id=>readyDocuments.delete(id));
    async function destinationAllowed(url) {
      // Literal IPs are already classified in assertSupported. Hostnames must
      // resolve to a public address when the browser's DNS can answer. A local
      // proxy's connection-peer IP is not this check: public sites through a
      // system/remote-DNS proxy still resolve publicly, or fail local DNS.
      // Failed/unavailable DNS is the narrow exemption for that proxy case;
      // it never admits a hostname that resolved to a private address.
      const host=new URL(url).hostname.toLowerCase().replace(/\.$/,'');
      if(hostAddress(host))return;
      // Re-resolve for each access. A previous public answer or DNS failure
      // must never authorize a later document after the hostname changes.
      if(typeof chrome.dns?.resolve!=='function')return;
      let address;
      try{
        const result=await chrome.dns.resolve(host);
        // Resolution failures can fulfill the promise without an address.
        if(Number.isInteger(result?.resultCode) && result.resultCode!==0)return;
        address=result?.address;
      }catch{return;}
      const ok=typeof address==='string' && publicAddress(address);
      if(!ok)throw unverified('LOCAL_ADDRESS');
    }
    async function document(tabId,options={}) {
      // Browser-owned document identity is the authority. Connection IP is the
      // proxy's endpoint for proxied traffic, and can be absent on cache hits.
      // Do not turn the connection peer into a refusal. Destination DNS, when
      // the browser reports it, must still be public.
      let frame;try{frame=await chrome.webNavigation?.getFrame({tabId,frameId:0});}catch{}
      if(!frame?.documentId || !frame.url || frame.errorOccurred)throw unverified('DOCUMENT_UNAVAILABLE');
      assertSupported(frame.url,options);
      if(!options.allowLocal)await destinationAllowed(frame.url);
      return frame.documentId;
    }
    async function isReady(tabId) {
      try{
        const documentId=await document(tabId,{allowLocal:true});
        if(readyDocuments.get(tabId)===documentId)return true;
        // DOMContentLoaded may predate this worker (restart / late install).
        // Ask the exact current document; ignore a reply from any other id.
        const out=await chrome.scripting?.executeScript?.({
          target:{tabId,documentIds:[documentId]},world:'ISOLATED',func:()=>document.readyState
        });
        if(out?.[0]?.documentId!==documentId)return false;
        const state=out[0].result;
        if(state!=='interactive' && state!=='complete')return false;
        readyDocuments.set(tabId,documentId);remember(readyDocuments);
        return true;
      }catch{return false;}
    }
    return {document,isReady,assertSupported};
  }
  const api={publicAddress,create,assertSupported};
  if(typeof module!=='undefined' && module.exports)module.exports=api;else root.MyBrowserNetwork=api;
})(globalThis);
