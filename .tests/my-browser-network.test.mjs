import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {publicAddress,create}=createRequire(import.meta.url)('../my-browser/extension/network-guard.js');
function fixture(){
  const events={},frames=new Map();
  const event=name=>({addListener:fn=>events[name]=fn});
  const chrome={webRequest:{onBeforeRequest:event('request'),onCompleted:event('response'),onErrorOccurred:event('error')},webNavigation:{onBeforeNavigate:event('navigate'),onCommitted:event('commit'),getFrame:async({tabId})=>frames.get(tabId)},tabs:{onRemoved:event('removed')}};
  const guard=create(chrome);
  const emit=(name,extra={})=>events[name]({tabId:1,frameId:0,url:'https://example.test/',requestId:'request1',...extra});
  const commit=(id='doc1',timeStamp=3)=>{frames.set(1,{documentId:id,url:'https://example.test/'});emit('commit',{documentId:id,timeStamp});};
  return {guard,emit,commit,frames};
}
test('actual peer address classification rejects private, mapped, reserved and absent IPs',()=>{
  for(const ip of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111','2001:4860:4860::8888'])assert.equal(publicAddress(ip),true,ip);
  for(const ip of [undefined,'','example.test','127.0.0.1','10.0.0.1','172.16.2.3','192.168.2.3','100.64.0.1','169.254.1.1','0.0.0.0','224.0.0.1','198.18.0.1','192.0.2.1','203.0.113.1','::1','::ffff:8.8.8.8','fc00::1','fe80::1','64:ff9b::a00:1','2002:7f00:1::','2001:db8::1','999.1.1.1'])assert.equal(publicAddress(ip),false,String(ip));
});
test('public-looking domains served by private IPs never authorize a document',async()=>{
  for(const ip of ['127.0.0.1','10.0.0.1','192.168.1.1',undefined]){
    const h=fixture();h.emit('navigate',{timeStamp:1});h.emit('request',{timeStamp:2});h.commit();h.emit('response',{ip,timeStamp:4});
    await assert.rejects(h.guard.document(1),/ADDRESS_UNVERIFIED/);
  }
});
test('a public response authorizes only its current committed document, in either completion ordering',async()=>{
  for(const responseFirst of [true,false]){
    const h=fixture();h.emit('navigate',{timeStamp:1});h.emit('request',{timeStamp:2});
    if(responseFirst)h.emit('response',{ip:'8.8.8.8',timeStamp:3});
    h.commit();if(!responseFirst)h.emit('response',{ip:'8.8.8.8',timeStamp:4});
    assert.equal(await h.guard.document(1),'doc1');
    h.frames.set(1,{documentId:'other',url:'https://example.test/'});await assert.rejects(h.guard.document(1));
  }
});
test('same-URL reload, late responses and redirects cannot reuse earlier public evidence',async()=>{
  const h=fixture();h.emit('navigate',{timeStamp:1});h.emit('request',{timeStamp:2});h.commit();
  h.emit('navigate',{timeStamp:10});h.commit('doc2',11);
  h.emit('request',{timeStamp:12}); // Same request id is a redirect of the OLD navigation.
  h.emit('response',{timeStamp:13,ip:'8.8.8.8'});await assert.rejects(h.guard.document(1));
  h.emit('request',{requestId:'request2',timeStamp:14});h.emit('response',{requestId:'request2',timeStamp:15,ip:'127.0.0.1'});
  await assert.rejects(h.guard.document(1));
});
test('unobserved, cached without IP, unsupported and restored documents fail closed',async()=>{
  const h=fixture();h.frames.set(1,{documentId:'existing',url:'https://example.test/'});await assert.rejects(h.guard.document(1));
  h.emit('navigate',{timeStamp:1});h.emit('request',{timeStamp:2});h.commit();h.emit('response',{timeStamp:4,fromCache:true});await assert.rejects(h.guard.document(1));
  const unsupported=create({tabs:{}});await assert.rejects(unsupported.document(1));
});

test('network completion delivered before navigation events retains correctly timed evidence',async()=>{
  const h=fixture();h.emit('request',{timeStamp:2});h.emit('response',{timeStamp:3,ip:'8.8.8.8'});h.emit('navigate',{timeStamp:1});h.commit('doc1',4);assert.equal(await h.guard.document(1),'doc1');
});

test('URL fragments do not change the verified network document',async()=>{
  const h=fixture();h.emit('navigate',{timeStamp:1});h.emit('request',{timeStamp:2});h.emit('response',{ip:'8.8.8.8',timeStamp:3});h.emit('commit',{documentId:'hash-doc',timeStamp:4,url:'https://example.test/#section'});h.frames.set(1,{documentId:'hash-doc',url:'https://example.test/#section'});assert.equal(await h.guard.document(1),'hash-doc');
});
