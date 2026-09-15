import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createBridge,EXT_ID}=require('../my-browser/node/bridge.cjs');
const {createInstallation}=require('../my-browser/node/installation.cjs');
const version=require('../my-browser/extension/manifest.json').version;
async function fixture(t) {
  const bridge=createBridge({ports:[0],connectWait:0,pollTimeout:10,jobTimeout:500});t.after(()=>bridge.close());
  const {port}=await bridge.request('status');
  async function client(browser='chrome',extensionId=EXT_ID,origin='chrome-extension://'+extensionId) {
    const id=crypto.randomUUID();let session;
    const request=async(route,body)=>{
      const r=await fetch('http://127.0.0.1:'+port+route,{method:body===undefined?'GET':'POST',headers:{'X-My-Browser-Extension':extensionId,'X-My-Browser-Origin':origin,'X-My-Browser-Client':id,'X-My-Browser-Version':version,'X-My-Browser-Family':browser,...(session?{'X-My-Browser-Session':session}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
      return {status:r.status,...await r.json()};
    };
    const health=async()=>{const r=await request('/health');session=r.session;return r;};
    return {id,origin,extensionId,request,health};
  }
  return {bridge,client};
}
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
  const {bridge,client}=await fixture(t);const safari=await client('safari','com.makecindy.mybrowser.Extension','safari-web-extension://'+crypto.randomUUID());
  let r=await safari.health();assert.equal(r.pairing_required,true);assert.equal(r.session,undefined);
  assert.equal((await safari.request('/poll')).status,409);
  assert.equal((await bridge.request('act',{action:'text',payload:{url:'https://example.test'}})).error,'EXTENSION_DISCONNECTED');
  await bridge.request('setTrustedClients',{clients:[{id:safari.id,origin:safari.origin,extensionId:safari.extensionId}]});
  r=await safari.health();assert.equal(r.pairing_required,false);assert.ok(r.session);
  const status=await bridge.request('status');assert.equal(status.clients[0].browser,'safari');assert.equal(status.extension_connected,true);
  await bridge.request('setTrustedClients',{clients:[]});assert.equal((await safari.request('/poll')).status,409);
});
test('unknown Chromium extension identities are not silently trusted',async t=>{
  const {bridge,client}=await fixture(t);const unknown=await client('edge','a'.repeat(32));
  assert.equal((await unknown.health()).pairing_required,true);
  assert.equal((await bridge.request('status')).extension_connected,false);
});
test('consumer install is honestly blocked until published; local developer setup never claims installation',async()=>{
  const calls=[];const i=createInstallation({platform:'darwin',exists:p=>p.includes('Chrome') || p.includes('Safari'),run:async(...args)=>calls.push(args)});
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
