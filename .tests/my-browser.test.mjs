import './my-browser-dispatch.test.mjs';
import './my-browser-network.test.mjs';
import './my-browser-discovery.test.mjs';
import './my-browser-badge.test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import readline from 'node:readline';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import {webcrypto} from 'node:crypto';
const require = createRequire(import.meta.url);
const {createBridge,EXT_ID} = require('../my-browser/node/bridge.cjs');
const P = require('../my-browser/extension/policy.js');
const sleep = ms => new Promise(r => setTimeout(r,ms));
async function fixture(t,options = {}) {
  const b=createBridge({ports:[0],pollTimeout:20,connectWait:0,jobTimeout:200,...options});
  t.after(()=>b.close());
  const s=await b.request('status'); const url='http://127.0.0.1:'+s.port;
  let session;
  const clientId=crypto.randomUUID();
  const version='0.4.13'; // Stable signed wire contract, independent of extension releases.
  const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
  const jwk=await webcrypto.subtle.exportKey('jwk',pair.publicKey);
  const publicJwk={kty:jwk.kty,crv:jwk.crv,x:jwk.x,y:jwk.y,ext:false};
  const publicKey=Buffer.from(JSON.stringify(publicJwk)).toString('base64url');
  await b.request('setTrustedClients',{clients:[{id:clientId,origin:'chrome-extension://'+EXT_ID,extensionId:EXT_ID,publicKey:JSON.stringify(publicJwk)}]});
  async function http(route,body,headers = {}) {
    const requestHeaders={'X-My-Browser-Extension':EXT_ID,'X-My-Browser-Origin':'chrome-extension://'+EXT_ID,'X-My-Browser-Client':clientId,'X-My-Browser-Version':version,'X-My-Browser-Family':'chrome','X-My-Browser-Key':publicKey,...(session?{'X-My-Browser-Session':session}:{}),...headers};
    const init={method:body===undefined?'GET':'POST',headers:requestHeaders,...(body===undefined?{}:{body:JSON.stringify(body)})};
    let r=await fetch(url+route,init),data=await r.json();
    if(route==='/health'&&data.challenge){
      const proof=Buffer.from(await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,new TextEncoder().encode(data.challenge))).toString('base64url');
      r=await fetch(url+route,{...init,headers:{...requestHeaders,'X-My-Browser-Proof':proof}});data=await r.json();
    }
    return {status:r.status,data};
  }
  session=(await http('/health')).data.session;
  await http('/poll');
  return {b,http,url,clientId};
}
// 2026-10-30: no site lists. check() keeps the address rules only; a policy saved by older versions is
// still parsed (so it cannot break a job) and changes nothing.
test('jobs only need a plain HTTP(S) address; saved site lists change nothing',()=>{
  const p=P.normalizePolicy({read:{block:['blocked.test']},interact:{allow:['example.test'],block:['other.test']}});
  for(const url of ['https://blocked.test','https://other.test','https://[2606:4700:4700::1111]/','http://127.0.0.2','http://[::1]','http://10.2.3.4','http://localhost.'])
    for(const action of ['text','click']) assert.equal(P.check(p,action,url).ok,true,action+' '+url);
  for(const url of ['file:///etc/passwd','https://a:b@example.test','chrome://settings']) assert.equal(P.check(p,'text',url).ok,false,url);
  assert.equal(P.check(p,'nope','https://example.test').error,'INVALID_ACTION');
});
test('payload validation preserves empty text/selection and rejects malformed extraction',()=>{
  assert.doesNotThrow(()=>P.validate('type',{url:'https://example.test',selector:'input',text:''}));
  assert.doesNotThrow(()=>P.validate('select',{url:'https://example.test',selector:'select',values:[]}));
  for(const payload of [{},{fields:[]},{fields:{x:4}},{fields:{x:'a'},limit:101},{fields:{x:'a'},limit:NaN}]) assert.throws(()=>P.validate('extract',{url:'https://example.test',...payload}));
});
test('tab and result URLs lose credentials but keep their identity',()=>{
  const r=P.redactUrl;
  // Placeholder shapes only: fake UUIDs and example.test, never real credential values.
  const code='11111111-1111-4111-8111-111111111111',state='22222222-2222-4222-8222-222222222222',token='33333333-3333-4333-8333-333333333333';
  // OAuth code / state in the query.
  assert.equal(r(`https://example.test/callback?q=cats&code=${code}&state=${state}`).includes(code),false);
  assert.equal(r(`https://example.test/callback?q=cats&code=${code}&state=${state}`).includes(state),false);
  assert.match(r(`https://example.test/callback?q=cats&code=${code}`),/q=cats/,'innocuous parameters survive');
  // Implicit-flow fragment and password-reset style tokens.
  assert.equal(r(`https://example.test/#access_token=${token}&token_type=bearer`).includes(token),false);
  assert.equal(r(`https://example.test/reset?token=${token}`).includes(token),false);
  // A long opaque value under an innocuous name is masked too.
  assert.equal(r(`https://example.test/p?t=${code}`).includes(code),false);
  // Encoding must not shift the analysis: the context word and the credential are both judged on the
  // decoded form, repeatedly, and the credential test no longer depends on a character set.
  const enc=encodeURIComponent(code+'/'+state), dbl=encodeURIComponent(encodeURIComponent(code+'/'+state));
  assert.equal(r(`https://example.test/reset/${enc}`).includes(code),false,'a percent-encoded token must be masked');
  assert.equal(r(`https://example.test/#/verify/${enc}`).includes(code),false,'an encoded token in a route fragment must be masked');
  assert.equal(r(`https://example.test/%72eset/${code}`).includes(code),false,'an encoded context word must still be recognized');
  assert.equal(r(`https://example.test/reset/${dbl}`).includes(code),false,'a double-encoded token must be masked');
  assert.equal(r(`https://example.test/reset/x#code%3D${code}`).includes(code),false,'an encoded fragment key/value must be masked');
  // Basic Auth userinfo supplied by page content.
  const basic=r(`https://${code}:${state}@example.test/private`);
  assert.equal(basic.includes(code),false,'the username must be removed');
  assert.equal(basic.includes(state),false,'the password must be removed');
  assert.equal(basic,'https://example.test/private');
  // Path-embedded credentials: password-reset and magic links put the token in a path segment.
  assert.equal(r(`https://example.test/reset/${code}`).includes(code),false);
  assert.equal(r(`https://example.test/#/verify/${code}`).includes(code),false);
  // Ordinary deep paths must keep working: a commit sha, a numeric id and a readable slug.
  assert.equal(r('https://example.test/commit/'+'a'.repeat(40)),'https://example.test/commit/'+'a'.repeat(40));
  assert.equal(r('https://example.test/user/12345'),'https://example.test/user/12345');
  assert.equal(r('https://example.test/reset-password/success'),'https://example.test/reset-password/success');
  assert.equal(r('https://example.test/notifications/mentions'),'https://example.test/notifications/mentions');
  assert.equal(r(`https://example.test/verify-${code}`).includes(code),false,'a verify- prefix and token in one segment must be masked');
  assert.equal(r(`https://example.test/reset-token-${code}`).includes(code),false,'a reset-token- prefix and token in one segment must be masked');
  assert.equal(r('https://example.test/verify-email'),'https://example.test/verify-email');
  assert.equal(r('https://example.test/verify-abcdefghijklmnop').includes('abcdefghijklmnop'),false,'a long alphabetic token in the same segment must be masked');
  assert.equal(r('https://example.test/verify-abcdefghijkl-mnopqrstuv').includes('abcdefghijkl'),false,'a hyphenated alphabetic token in the same segment must be masked');
  assert.match(r('https://example.test/login-account-settings-tab-details'),/REDACTED/,'a long leftover after a context word is masked whole');
  // Credential semantics are matched per word and nested URLs are inspected recursively, so composite
  // key names and ?next=/reset/<token> cannot smuggle a credential through.
  assert.equal(r(`https://example.test/cb?reset_token=${code}`).includes(code),false,'a composite key must be masked');
  assert.equal(r(`https://example.test/cb?magic_link_token=${code}`).includes(code),false,'underscored composite keys must be masked');
  assert.equal(r(`https://example.test/cb?next=${encodeURIComponent('https://example.test/reset/'+code)}`).includes(code),false,'a nested URL credential must be masked');
  assert.equal(r(`https://example.test/cb?next=${encodeURIComponent('/reset/'+code)}`).includes(code),false,'a nested path credential must be masked');
  assert.equal(r('https://example.test/cb?page=2&sort=name'),'https://example.test/cb?page=2&sort=name','ordinary parameters stay untouched');
  // A plain route fragment carries no credential and keeps tabs identifiable.
  assert.equal(r('https://example.test/#/home'),'https://example.test/#/home');
  assert.equal(r('https://example.test/timeline?lang=en'),'https://example.test/timeline?lang=en');
  // Structurally unusable input is returned unchanged rather than throwing into a browser result.
  assert.equal(r('not a url'),'not a url');
  assert.equal(r(undefined),undefined);
});

test('extract validates a closed attribute set before reaching any browser',()=>{
  for(const attr of ['href','src','datetime','title','alt','aria-label','role'])assert.doesNotThrow(()=>P.validate('extract',{url:'https://example.test',fields:{value:{selector:'p',attr}}}));
  for(const attr of ['data-csrf-token','data-token','nonce','value','outerHTML','onclick','HREF',' href',4])assert.throws(()=>P.validate('extract',{url:'https://example.test',fields:{value:{selector:'p',attr}}}));
});
test('cold status starts one listener under concurrency; disconnected actions fail quickly',async t=>{
  const b=createBridge({ports:[0],connectWait:0});t.after(()=>b.close());
  const statuses=await Promise.all(Array.from({length:8},()=>b.request('status')));
  assert.equal(new Set(statuses.map(s=>s.port)).size,1);
  assert.equal(statuses[0].extension_connected,false);
  const result=await b.request('act',{action:'text',payload:{url:'https://example.test'}});
  assert.equal(result.error,'EXTENSION_DISCONNECTED');assert.equal(result.execution,'not_executed');
});
test('loopback HTTP rejects websites, preflights, rebinding, old sessions and arbitrary job submission',async t=>{
  const {http,url}=await fixture(t);
  assert.equal((await fetch(url+'/health')).status,403);
  assert.equal((await http('/health',undefined,{Origin:'https://example.test'})).status,403);
  const rebound = await new Promise(resolve => {
    const req = require('node:http').get(url+'/health',{headers:{Host:'example.test','X-My-Browser-Extension':EXT_ID}},res => {res.resume();resolve(res.statusCode);});
    req.on('error',()=>resolve(0));
  });
  assert.equal(rebound,403);
  assert.equal((await fetch(url+'/health',{method:'OPTIONS',headers:{'X-My-Browser-Extension':EXT_ID}})).status,403);
  assert.equal((await http('/poll',undefined,{'X-My-Browser-Session':'old'})).status,409);
  assert.equal((await http('/act',{action:'click'})).status,404);
});
test('real HTTP poll/ack/result round trip and duplicate ACK rejection',async t=>{
  const {b,http}=await fixture(t);
  const promise=b.request('act',{action:'text',payload:{url:'https://example.test'}});
  await sleep(5);
  const {job}=(await http('/poll')).data;
  assert.match(job.id,/^[0-9a-f-]{36}$/);assert.equal(job.action,'text');
  const ack=await http('/ack',{id:job.id});assert.equal(ack.data.ok,true);
  assert.equal((await http('/ack',{id:job.id})).status,409);
  await http('/result',{id:job.id,result:{ok:true,url:'https://example.test',text:'Hello'}});
  assert.equal((await promise).text,'Hello');assert.equal((await b.request('status')).pending,0);
});
test('acknowledged interaction timeouts are unknown and NEVER redelivered',async t=>{
  const {b,http}=await fixture(t,{jobTimeout:80});const p=P.defaults();p.interact.allow=['example.test'];await b.request('setPolicy',{policy:p});
  const resultPromise=b.request('act',{action:'click',payload:{url:'https://example.test',selector:'button'}});
  await sleep(5);const {job}=(await http('/poll')).data;await http('/ack',{id:job.id});
  const result=await resultPromise;assert.equal(result.execution,'unknown');
  assert.equal((await http('/poll')).data.job,null);
  assert.equal((await http('/result',{id:job.id,result:{ok:true}})).status,409);
});
test('queued and unacknowledged expired jobs cannot execute later',async t=>{
  const {b,http}=await fixture(t,{jobTimeout:60});
  const queued=await b.request('act',{action:'text',payload:{url:'https://example.test'}});
  assert.equal(queued.execution,'not_executed');assert.equal((await http('/poll')).data.job,null);
  const promise=b.request('act',{action:'text',payload:{url:'https://example.test'}});
  await sleep(5);const {job}=(await http('/poll')).data;
  assert.equal((await promise).execution,'not_executed');assert.equal((await http('/ack',{id:job.id})).status,409);
});
test('permission revoked after delivery blocks ACK and leaves no queued operation',async t=>{
  const {b,http}=await fixture(t);const p=P.defaults();p.interact.allow=['example.test'];await b.request('setPolicy',{policy:p});
  const promise=b.request('act',{action:'click',payload:{url:'https://example.test',selector:'button'}});
  await sleep(5);const {job}=(await http('/poll')).data;
  await b.request('setPolicy',{policy:{read:{block:[]},interact:{allow:[],block:[]}}});assert.equal((await promise).execution,'not_executed');
  assert.equal((await http('/ack',{id:job.id})).status,409);
});
test('a site list pushed by an older plugin is acknowledged and blocks nothing in the bundled bridge',async t=>{
  const {b,http}=await fixture(t);
  assert.deepEqual(await b.request('setPolicy',{policy:{...P.defaults(),read:{block:['example.test']}}}),{ok:true,policy:P.defaults()});
  const p=b.request('act',{action:'tabs',payload:{}});await sleep(5);
  const {job}=(await http('/poll')).data;await http('/ack',{id:job.id});
  await http('/result',{id:job.id,result:{tabs:[{id:1,url:'https://example.test',title:'public'},{id:2,url:'chrome://settings',title:'settings'}]}});
  const r=await p;assert.equal(r.tabs[0].title,'public');assert.deepEqual(r.tabs[1],{id:2,redacted:true});
});
test('production stdio worker returns JSON-RPC and exits when host closes stdin',async t=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'cindy-worker-test-'));t.after(()=>fs.rm(home,{recursive:true,force:true}));
  const child=spawn(process.execPath,['-e','require(process.argv[1])',path.resolve(import.meta.dirname,'../my-browser/node/worker.cjs')],{stdio:['pipe','pipe','pipe'],env:{...process.env,HOME:home,USERPROFILE:home,LOCALAPPDATA:home,XDG_CONFIG_HOME:home}});
  t.after(()=>child.kill());
  const lines=readline.createInterface({input:child.stdout});
  const answer=once(lines,'line');child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:'fixture-id',method:'status',params:{}})+'\n');
  const [line]=await answer;const message=JSON.parse(line);assert.equal(message.id,'fixture-id');assert.equal(message.result.ok,true);
  child.stdin.end();await once(child,'exit');lines.close();
});



test('acknowledged reads with lost results are unknown',async t=>{
  const {b,http}=await fixture(t,{jobTimeout:80});
  const pending=b.request('act',{action:'text',payload:{url:'https://example.test'}});
  await sleep(5);const {job}=(await http('/poll')).data;await http('/ack',{id:job.id});
  assert.equal((await pending).execution,'unknown');
  assert.equal((await http('/poll')).data.job,null);
});

test('extract final budget covers redaction growth across single and multiple records',async t=>{
  const {b,http}=await fixture(t,{jobTimeout:3000});
  const url='https://example.test/?'+Array.from({length:15},(_,i)=>'token'+i+'=x').join('&');
  const record=Object.fromEntries(Array.from({length:30},(_,i)=>['field'+i,url]));
  assert.ok(url.length*30<6000);
  assert.ok(P.redactUrl(url).length*30>6000);
  for(const multiple of [false,true]) for(const maxChars of [undefined,256,7000]) {
    const budget=maxChars ?? 6000;
    const promise=b.request('act',{action:'extract',payload:{url:'https://example.test',fields:{link:'a'},multiple,...(maxChars===undefined?{}:{maxChars})}});
    await sleep(5);const {job}=(await http('/poll')).data;
    await http('/ack',{id:job.id});
    await http('/result',{id:job.id,result:{ok:true,url:'https://example.test',truncated:false,...(multiple?{records:[record,record],count:2}:{record})}});
    const result=await promise;
    const rows=multiple?result.records:[result.record];
    const values=rows.flatMap(row=>Object.values(row));
    assert.ok(values.reduce((n,v)=>n+(v?.length||0),0)<=budget);
    assert.equal(result.truncated,true);
    assert.ok(values.every(v=>v===null || v===P.redactUrl(url)),'URLs are returned whole or omitted');
    if(multiple) assert.equal(result.count,2);
  }
  const promise=b.request('act',{action:'extract',payload:{url:'https://example.test',fields:{text:'p'},maxChars:256}});
  await sleep(5);const {job}=(await http('/poll')).data;await http('/ack',{id:job.id});
  await http('/result',{id:job.id,result:{ok:true,record:JSON.parse('{"__proto__":"kept","text":"'+ 't'.repeat(300)+'","missing":null}')}});
  const result=await promise;
  assert.equal(Object.hasOwn(result.record,'__proto__'),true);
  assert.equal(result.record.__proto__,'kept');
  assert.equal(result.record.text.length,252);
  assert.equal(result.record.missing,null);
  assert.equal(result.truncated,true);
});




