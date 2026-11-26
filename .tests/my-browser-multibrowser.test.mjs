import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
const require=createRequire(import.meta.url);
const {createBridge,EXT_ID}=require('../my-browser/node/bridge.cjs');
const {createInstallation}=require('../my-browser/node/installation.cjs');
const version='0.4.13'; // Stable signed wire contract, independent of extension releases.
async function fixture(t) {
  const nativeToken='d'.repeat(64);
  const bridge=createBridge({nativeToken,ports:[0],connectWait:0,pollTimeout:10,jobTimeout:500});t.after(()=>bridge.close());
  const {port}=await bridge.request('status');
  const pinned=[];
  async function client(browser='chrome',extensionId=EXT_ID,origin='chrome-extension://'+extensionId,paired=false,native=true) {
    const id=crypto.randomUUID();let session;
    const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
    const jwk=await webcrypto.subtle.exportKey('jwk',pair.publicKey),publicJwk={kty:jwk.kty,crv:jwk.crv,x:jwk.x,y:jwk.y,ext:false};
    const publicKey=Buffer.from(JSON.stringify(publicJwk)).toString('base64url');
    const request=async(route,body)=>{
      const r=await fetch('http://127.0.0.1:'+port+route,{method:body===undefined?'GET':'POST',headers:{'X-My-Browser-Extension':extensionId,'X-My-Browser-Origin':origin,'X-My-Browser-Client':id,'X-My-Browser-Version':version,'X-My-Browser-Family':browser,'X-My-Browser-Key':publicKey,...(session?{'X-My-Browser-Session':session}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
      return {status:r.status,...await r.json()};
    };
    const record={id,origin,extensionId,publicKey:JSON.stringify(publicJwk)};
    const pairNow=async()=>{pinned.push(record);await bridge.request('setTrustedClients',{clients:[...pinned]});};
    if(paired)await pairNow();
    const health=async()=>{let r=await request('/health');if(r.challenge){const proof=Buffer.from(await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,new TextEncoder().encode(r.challenge))).toString('base64url');const response=await fetch('http://127.0.0.1:'+port+'/health',{headers:{'X-My-Browser-Extension':extensionId,'X-My-Browser-Origin':origin,'X-My-Browser-Client':id,'X-My-Browser-Version':version,'X-My-Browser-Family':browser,'X-My-Browser-Key':publicKey,'X-My-Browser-Proof':proof}});r={status:response.status,...await response.json()};}if(native && r.native_binding_required){await fetch('http://127.0.0.1:'+port+'/native/bind',{method:'POST',headers:{Authorization:'Bearer '+nativeToken},body:JSON.stringify({clientId:id,origin,publicKey})});r=await request('/health');}session=r.session;return r;};
    return {id,origin,extensionId,request,health,pair:pairNow};
  }
  return {bridge,client};
}
test('official store and bundled extensions authenticate after native registration without manual pairings',async t=>{
  const {bridge,client}=await fixture(t);
  const storeId=require('../my-browser/distribution.json').chrome.extensionId;
  for(const extensionId of new Set([EXT_ID,storeId])) {
    const browser=await client('chrome',extensionId);
    const unsigned=await browser.request('/health');
    assert.equal(unsigned.session,undefined);
    assert.equal((await bridge.request('status')).clients.find(c=>c.id===browser.id).identitySupported,true);
    assert.equal((await browser.request('/poll')).status,409);
    const first=await browser.health();
    assert.equal(first.pairing_required,false);assert.ok(first.session);
    assert.equal((await browser.request('/learning/challenge')).status,200);
    // Settings refresh and startup both restore an empty legacy binding list.
    await bridge.request('setTrustedClients',{clients:[]});
    assert.equal((await browser.request('/poll')).status,200);
    const again=await browser.health();assert.equal(again.session,first.session);
  }
  assert.equal((await bridge.request('status')).extension_connected,true);
});
test('Chrome and Edge jobs are connection-bound; ambiguous profile selection never guesses',async t=>{
  const {bridge,client}=await fixture(t);const chrome=await client(),edge=await client('edge');await chrome.health();await edge.health();
  let r=await bridge.request('act',{action:'text',payload:{url:'https://example.test'}});assert.equal(r.error,'BROWSER_REQUIRED');
  const done=bridge.request('act',{action:'text',payload:{url:'https://example.test',browser:edge.id}});
  assert.equal((await chrome.request('/poll')).job,null);
  const {job}=await edge.request('/poll');assert.ok(job);
  assert.equal((await chrome.request('/ack',{id:job.id})).status,409);
  assert.equal((await edge.request('/ack',{id:job.id})).ok,true);
  assert.equal((await chrome.request('/result',{id:job.id,result:{ok:true,text:'wrong'}})).status,409);
  await edge.request('/result',{id:job.id,result:{ok:true,url:'https://example.test',text:'correct'}});
  r=await done;assert.equal(r.text,'correct');assert.equal(r.browser,edge.id);assert.equal(r.untrusted_content,true);assert.ok(r.timing.totalMs>=0);
});
test('Safari identities get no bridge session or jobs until exact identity approval via stdio',async t=>{
  const {bridge,client}=await fixture(t);const safari=await client('safari','com.makecindy.mybrowser.Extension','safari-web-extension://'+crypto.randomUUID(),false);
  let r=await safari.health();assert.equal(r.pairing_required,true);assert.equal(r.session,undefined);
  assert.equal((await safari.request('/poll')).status,409);
  assert.equal((await bridge.request('act',{action:'text',payload:{url:'https://example.test'}})).error,'EXTENSION_DISCONNECTED');
  await safari.pair();
  r=await safari.health();assert.equal(r.pairing_required,false);assert.ok(r.session);
  const status=await bridge.request('status');assert.equal(status.clients[0].browser,'safari');assert.equal(status.extension_connected,true);
  await bridge.request('setTrustedClients',{clients:[]});assert.equal((await safari.request('/poll')).status,409);
});
test('unknown Chromium extension identities are not silently trusted',async t=>{
  const {bridge,client}=await fixture(t);const unknown=await client('edge','a'.repeat(32),'chrome-extension://'+ 'a'.repeat(32),false);
  assert.equal((await unknown.health()).pairing_required,true);
  assert.equal((await bridge.request('status')).clients[0].identitySupported,false);
  assert.equal((await bridge.request('status')).extension_connected,false);
});
test('consumer install is honestly blocked until published; local developer setup never claims installation',async()=>{
  const calls=[];const i=createInstallation({platform:'darwin',distribution:{chrome:{storeUrl:null},edge:{storeUrl:null},safari:{appStoreUrl:null}},exists:p=>p.includes('Chrome') || p.includes('Safari'),run:async(...args)=>calls.push(args)});
  assert.equal(i.status().browsers.find(b=>b.browser==='edge').installed,false);
  let r=await i.open('chrome');assert.equal(r.error,'RELEASE_REQUIRED');assert.equal(r.execution,'not_executed');assert.equal(calls.length,0);
  r=await i.open('chrome','developer');assert.equal(calls.length,2);assert.equal(calls[0][0],'/usr/bin/open');assert.equal(r.installed,false);assert.equal(r.stage,'awaiting_browser_confirmation');
  assert.equal((await i.open('chrome;anything','developer')).error,'INVALID_INSTALL_TARGET');
});
test('published install URL is allowlisted and Windows launch uses argv, not a shell',async()=>{
  const calls=[];const catalog={chrome:{storeUrl:'https://chromewebstore.google.com/detail/'+'a'.repeat(32)},edge:{storeUrl:null},safari:{appStoreUrl:null}};
  const i=createInstallation({platform:'win32',env:{PROGRAMFILES:'C:\\Program Files'},exists:()=>true,distribution:catalog,run:async(...args)=>calls.push(args)});
  const r=await i.open('chrome');assert.equal(r.ok,true);assert.equal(r.installed,false);assert.match(calls[0][0],/chrome\.exe$/);assert.deepEqual(calls[0][1],[catalog.chrome.storeUrl]);
  catalog.chrome.storeUrl='https://example.test/';assert.throws(()=>i.status(),/Invalid packaged store URL/);
});
test('OS launch failure is unknown and never automatically retried',async()=>{
  let calls=0;const i=createInstallation({platform:'darwin',exists:()=>true,run:async()=>{calls++;throw new Error('failed');}});
  const r=await i.open('chrome','reload');assert.equal(r.execution,'unknown');assert.equal(calls,1);
});
test('bundled Safari app is not launched if signature/distribution assessment fails',async()=>{
  let launched=0;
  const i=createInstallation({platform:'darwin',exists:()=>true,verifySafari:async()=>{throw new Error('unsigned');},run:async()=>{launched++;}});
  const r=await i.open('safari');assert.equal(r.error,'SIGNATURE_REQUIRED');assert.equal(r.execution,'not_executed');assert.equal(launched,0);
});
test('verified Safari bundle opens only the fixed packaged app and still requires browser confirmation',async()=>{
  let verified=false;const calls=[];
  const i=createInstallation({platform:'darwin',exists:()=>true,verifySafari:async()=>{verified=true;},run:async(...args)=>{assert.equal(verified,true);calls.push(args);}});
  const r=await i.open('safari');assert.equal(r.installed,false);assert.equal(r.stage,'awaiting_browser_confirmation');assert.equal(calls[0][0],'/usr/bin/open');assert.ok(calls[0][1][0].endsWith('/my-browser/native/My Browser.app'));
});

test('ZIP is not an installation route; developer mode opens only the bundled directory',async()=>{
  const calls=[];
  const i=createInstallation({platform:'darwin',exists:p=>p.includes('Google Chrome'),run:async(...args)=>calls.push(args)});
  const chrome=i.status().browsers.find(b=>b.browser==='chrome');
  assert.equal('zip' in chrome,false);
  assert.equal((await i.open('chrome','zip')).error,'INVALID_INSTALL_TARGET');
  const r=await i.open('chrome','developer');assert.equal(r.ok,true);assert.equal(calls.length,2);
  assert.ok(calls[1][1][1].endsWith('/my-browser/extension'));
});

test('a native HTTP caller cannot self-register by claiming the official ID and signing a new key',async t=>{
  const {bridge,client}=await fixture(t);
  const forged=await client('chrome',EXT_ID,'chrome-extension://'+EXT_ID,false,false);
  const health=await forged.health();
  assert.equal(health.session,undefined);assert.equal(health.native_binding_required,true);
  assert.equal((await forged.request('/poll')).status,409);
  assert.equal((await forged.request('/learning/challenge')).status,409);
  assert.equal((await forged.request('/native/bind',{clientId:forged.id})).status,403);
  assert.equal((await bridge.request('status')).extension_connected,false);
});
