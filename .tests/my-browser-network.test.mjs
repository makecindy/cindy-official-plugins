import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {publicAddress,create}=createRequire(import.meta.url)('../my-browser/extension/network-guard.js');
function fixture(frames=new Map(),extra={}){
  const events={};const event=name=>({addListener:fn=>events[name]=fn});
  // No webRequest or stored IP evidence: use the actual browser frame contract.
  const chrome={webNavigation:{onBeforeNavigate:event('navigate'),onDOMContentLoaded:event('ready'),getFrame:async({tabId})=>frames.get(tabId)},tabs:{onRemoved:event('removed')},...extra};
  return {guard:create(chrome),frames,emit:(name,extra={})=>events[name](name==='removed'?1:{tabId:1,frameId:0,...extra}),chrome};
}
test('actual peer address classification rejects private, mapped, reserved and absent IPs',()=>{
  for(const ip of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111','2001:4860:4860::8888'])assert.equal(publicAddress(ip),true,ip);
  for(const ip of [undefined,'','example.test','127.0.0.1','10.0.0.1','172.16.2.3','192.168.2.3','100.64.0.1','169.254.1.1','0.0.0.0','224.0.0.1','198.18.0.1','192.0.2.1','203.0.113.1','::1','::ffff:8.8.8.8','fc00::1','fe80::1','64:ff9b::a00:1','2002:7f00:1::','2001:db8::1','999.1.1.1'])assert.equal(publicAddress(ip),false,String(ip));
});

test('proxy, cached, pre-install and restored pages use current browser document identity without peer evidence',async()=>{
  const frames=new Map([[1,{documentId:'doc1',url:'https://example.test/'}]]);
  const h=fixture(frames);assert.equal(await h.guard.document(1),'doc1');
  assert.equal(await fixture(frames).guard.document(1),'doc1');
  frames.set(1,{documentId:'doc2',url:'https://example.test/#section'});
  assert.equal(await h.guard.document(1),'doc2');
  frames.set(1,{documentId:'doc3',url:'https://other.test/'});
  assert.equal(await h.guard.document(1),'doc3');
});
test('local URLs and Chrome protected pages remain inaccessible regardless of proxy use',async()=>{
  const h=fixture();
  for(const url of ['http://localhost/','https://device.local/','http://corp.internal/','http://127.1/','http://10.0.0.1/','http://192.168.1.1/','http://[::1]/','http://[fc00::1]/','http://[fe80::1]/','http://198.18.0.1/','file:///tmp/page','https://user:secret@example.test/']){
    h.frames.set(1,{documentId:'doc',url});
    await assert.rejects(h.guard.document(1),{message:'ADDRESS_UNVERIFIED',reason:'LOCAL_ADDRESS'},url);
  }
  for(const host of ['chrome.google.com','chromewebstore.google.com','sub.chrome.google.com']){
    h.frames.set(1,{documentId:'doc',url:'https://'+host+'/'});
    await assert.rejects(h.guard.document(1),/BROWSER_PAGE_RESTRICTED/);
  }
});
test('public IPv6 literal URLs are allowed; private IPv6 literals stay blocked',async()=>{
  const h=fixture();
  h.frames.set(1,{documentId:'doc',url:'https://[2606:4700:4700::1111]/'});
  assert.equal(await h.guard.document(1),'doc');
  h.frames.set(1,{documentId:'doc',url:'https://[2001:4860:4860::8888]/path'});
  assert.equal(await h.guard.document(1),'doc');
  for(const url of ['http://[::1]/','http://[fc00::1]/','http://[fe80::1]/','http://[2001:db8::1]/']){
    h.frames.set(1,{documentId:'doc',url});
    await assert.rejects(h.guard.document(1),{message:'ADDRESS_UNVERIFIED',reason:'LOCAL_ADDRESS'},url);
  }
});
test('a hostname that resolves to a private IP is refused even when the page is loaded',async()=>{
  const frames=new Map([[1,{documentId:'doc',url:'https://intranet.example.test/'}]]);
  const h=fixture(frames,{dns:{resolve:async()=>({address:'10.0.0.9'})}});
  await assert.rejects(h.guard.document(1),{message:'ADDRESS_UNVERIFIED',reason:'LOCAL_ADDRESS'});
  frames.set(1,{documentId:'doc',url:'https://ula.example.test/'});
  const v6=fixture(frames,{dns:{resolve:async()=>({address:'fc00::1'})}});
  await assert.rejects(v6.guard.document(1),{message:'ADDRESS_UNVERIFIED',reason:'LOCAL_ADDRESS'});
});
test('a later document re-resolves DNS so a private rebound is not served from cache',async()=>{
  const frames=new Map([[1,{documentId:'doc1',url:'https://example.test/'}]]);
  const resolved=[];
  const h=fixture(frames,{dns:{resolve:async()=>{resolved.push(true);return {address:resolved.length===1?'8.8.8.8':'10.0.0.9'};}}});
  assert.equal(await h.guard.document(1),'doc1');
  frames.set(1,{documentId:'doc2',url:'https://example.test/'});
  await assert.rejects(h.guard.document(1),{message:'ADDRESS_UNVERIFIED',reason:'LOCAL_ADDRESS'});
  assert.equal(resolved.length,2);
});
test('a hostname that resolves to a public IP is allowed; DNS failure is the proxy exemption',async()=>{
  const frames=new Map([[1,{documentId:'doc',url:'https://example.test/'}]]);
  const publicDns=fixture(frames,{dns:{resolve:async()=>({address:'8.8.8.8'})}});
  assert.equal(await publicDns.guard.document(1),'doc');
  const publicV6=fixture(frames,{dns:{resolve:async()=>({address:'2606:4700:4700::1111'})}});
  assert.equal(await publicV6.guard.document(1),'doc');
  const remoteDns=fixture(frames,{dns:{resolve:async()=>{throw Error('DNS_FAILED');}}});
  assert.equal(await remoteDns.guard.document(1),'doc');
});
test('missing, failed and inaccessible documents fail without leaking page data',async()=>{
  const h=fixture();
  for(const frame of [undefined,{url:'https://example.test/'},{documentId:'doc',url:'https://example.test/',errorOccurred:true}]){
    h.frames.set(1,frame);await assert.rejects(h.guard.document(1),{message:'ADDRESS_UNVERIFIED',reason:'DOCUMENT_UNAVAILABLE'});
  }
  const inaccessible=create({tabs:{},webNavigation:{onBeforeNavigate:{addListener(){}},getFrame:async()=>{throw Error('private url');}}});
  await assert.rejects(inaccessible.document(1),{message:'ADDRESS_UNVERIFIED',reason:'DOCUMENT_UNAVAILABLE'});
});
test('DOM readiness is bound to the current document, cleared on navigation/removal, and ignores subframes',async()=>{
  const h=fixture();h.frames.set(1,{documentId:'doc1',url:'https://example.test/'});
  assert.equal(await h.guard.isReady(1),false);
  h.emit('ready',{documentId:'doc1',frameId:2});assert.equal(await h.guard.isReady(1),false);
  h.emit('ready',{documentId:'doc1'});assert.equal(await h.guard.isReady(1),true);
  h.frames.set(1,{documentId:'doc2',url:'https://example.test/'});assert.equal(await h.guard.isReady(1),false);
  h.emit('ready',{documentId:'doc2'});assert.equal(await h.guard.isReady(1),true);
  h.emit('navigate');assert.equal(await h.guard.isReady(1),false);
  h.emit('ready',{documentId:'doc2'});h.emit('removed');assert.equal(await h.guard.isReady(1),false);
});
test('a missed DOMContentLoaded after worker restart recovers from the current document readyState',async()=>{
  const frames=new Map([[1,{documentId:'doc1',url:'https://example.test/'}]]);
  let probed;
  const h=fixture(frames,{scripting:{executeScript:async({target})=>{
    probed=target;
    return [{documentId:target.documentIds[0],result:'interactive'}];
  }}});
  assert.equal(await h.guard.isReady(1),true);
  assert.deepEqual(probed,{tabId:1,documentIds:['doc1']});
  assert.equal(await h.guard.isReady(1),true);
});
test('readyState recovery ignores a reply from a different document and incomplete states',async()=>{
  const frames=new Map([[1,{documentId:'doc1',url:'https://example.test/'}]]);
  const stale=fixture(frames,{scripting:{executeScript:async()=>[{documentId:'other',result:'complete'}]}});
  assert.equal(await stale.guard.isReady(1),false);
  const loading=fixture(frames,{scripting:{executeScript:async({target})=>[{documentId:target.documentIds[0],result:'loading'}]}});
  assert.equal(await loading.guard.isReady(1),false);
});

test('each access rechecks DNS after public answers, failures and private answers',async()=>{
  for(const initial of ['8.8.8.8','error']){
    let address=initial,calls=0;
    const frames=new Map([[1,{documentId:'old',url:'https://changing.example.test/'}]]);
    const h=fixture(frames,{dns:{resolve:async()=>{calls++;if(address==='error')throw Error('DNS_FAILED');return {address};}}});
    assert.equal(await h.guard.document(1),'old');
    frames.set(1,{documentId:'new',url:'https://changing.example.test/'});address='127.0.0.1';
    await assert.rejects(h.guard.document(1),{reason:'LOCAL_ADDRESS'});
    address='8.8.8.8';assert.equal(await h.guard.document(1),'new');
    address='fc00::1';await assert.rejects(h.guard.document(1),{reason:'LOCAL_ADDRESS'});
    assert.equal(calls,4);
  }
});

test('public IPv6 passes the shared address check and current-document guard',async()=>{
  const P=createRequire(import.meta.url)('../my-browser/extension/policy.js');
  const h=fixture();
  for(const ip of ['2606:4700:4700::1111','2001:4860:4860::8888']){
    const url='https://['+ip+']/';h.frames.set(1,{documentId:'v6',url});
    for(const action of ['text','snapshot','click'])assert.equal(P.check(P.defaults(),action,url).ok,true);
    assert.equal(await h.guard.document(1),'v6');
  }
  // Decision (2026-10-28): page control in the user's own browser reaches local and private addresses,
  // as the user's browser does; the learning features' guard keeps refusing them by default.
  const {assertSupported}=createRequire(import.meta.url)('../my-browser/extension/network-guard.js');
  for(const ip of ['::1','fc00::1','fe80::1','::ffff:7f00:1','2001:db8::1','2002::1']){
    assert.equal(P.check(P.defaults(),'text','http://['+ip+']/').ok,true);
    assert.throws(()=>assertSupported('http://['+ip+']/'),/ADDRESS_UNVERIFIED/);
    assert.doesNotThrow(()=>assertSupported('http://['+ip+']/',{allowLocal:true}));
  }
});


test('nonzero DNS results use the proxy exemption without allowing later private answers',async()=>{
  const frames=new Map([[1,{documentId:'doc',url:'https://example.test/'}]]);
  let answer;
  const h=fixture(frames,{dns:{resolve:async()=>answer}});
  for(const resultCode of [-105,-2,1]){
    answer={resultCode};assert.equal(await h.guard.document(1),'doc');
    for(const address of ['127.0.0.1','10.0.0.9','fc00::1']){
      answer={resultCode:0,address};
      await assert.rejects(h.guard.document(1),{message:'ADDRESS_UNVERIFIED',reason:'LOCAL_ADDRESS'});
    }
  }
  answer={resultCode:0,address:'8.8.8.8'};assert.equal(await h.guard.document(1),'doc');
  answer={resultCode:0};
  await assert.rejects(h.guard.document(1),{message:'ADDRESS_UNVERIFIED',reason:'LOCAL_ADDRESS'},'missing address in a successful result is not a DNS failure');
});
