import './my-browser-network.test.mjs';
import './my-browser-discovery.test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import readline from 'node:readline';
import path from 'node:path';
const require = createRequire(import.meta.url);
const {createBridge,EXT_ID} = require('../my-browser/node/bridge.cjs');
const P = require('../my-browser/extension/policy.js');
const savedPolicy = cfg => require('../my-browser/saved-policy.js')(cfg,P);
const sleep = ms => new Promise(r => setTimeout(r,ms));
async function fixture(t,options = {}) {
  const b=createBridge({ports:[0],pollTimeout:20,connectWait:0,jobTimeout:200,...options});
  t.after(()=>b.close());
  const s=await b.request('status'); const url='http://127.0.0.1:'+s.port;
  let session;
  const clientId=crypto.randomUUID();
  const version=require('../my-browser/extension/manifest.json').version;
  async function http(route,body,headers = {}) {
    const r=await fetch(url+route,{method:body===undefined?'GET':'POST',headers:{'X-My-Browser-Extension':EXT_ID,'X-My-Browser-Client':clientId,'X-My-Browser-Version':version,'X-My-Browser-Family':'chrome',...(session?{'X-My-Browser-Session':session}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:r.status,data:await r.json()};
  }
  session=(await http('/health')).data.session;
  await http('/poll');
  return {b,http,url,clientId};
}
test('default policy and one normalization path protect both reads and interactions',()=>{
  const p=P.defaults();
  assert.equal(P.check(p,'text','https://example.test').ok,true);
  assert.equal(P.check(p,'click','https://example.test').ok,true);
  assert.deepEqual(P.normalizePolicy(p),p);
  p.read.block=['blocked.test'];
  for(const url of ['https://blocked.test','https://child.blocked.test','http://127.0.0.2','http://2130706433','http://[::1]','http://[::ffff:127.0.0.1]','http://10.2.3.4','http://192.168.1.2','http://localhost.','file:///etc/passwd','https://a:b@example.test']) assert.equal(P.check(p,'text',url).ok,false,url);
  p.interact.allow=['example.test','blocked.test'];
  assert.equal(P.check(p,'click','https://sub.example.test').ok,true);
  assert.equal(P.check(p,'click','https://example.test.evil.test').ok,false);
  assert.equal(P.check(p,'click','https://blocked.test').error,'READ_BLOCKED');
  assert.equal(P.normalizeHost(' WWW.Example.test '),'www.example.test');
  assert.equal(P.normalizeHost('*.example.test'),'example.test');
  assert.equal(P.normalizeHost('=example.test'),'=example.test');
  for(const bad of ['com','https://example.test','example.test/path','example.test:443','example.test@evil.test','*','127.0.0.1']) assert.throws(()=>P.normalizeHost(bad));
  assert.throws(()=>P.normalizePolicy({read:{block:'example.test'},interact:{allow:[]}}));
});
test('payload validation preserves empty text/selection and rejects malformed extraction',()=>{
  assert.doesNotThrow(()=>P.validate('type',{url:'https://example.test',selector:'input',text:''}));
  assert.doesNotThrow(()=>P.validate('select',{url:'https://example.test',selector:'select',values:[]}));
  for(const payload of [{},{fields:[]},{fields:{x:4}},{fields:{x:'a'},limit:101},{fields:{x:'a'},limit:NaN}]) assert.throws(()=>P.validate('extract',{url:'https://example.test',...payload}));
});
test('tab and result URLs lose credentials but keep their identity',()=>{
  const r=P.redactUrl;
  // OAuth code / state in the query.
  assert.equal(/SECRET/.test(r('https://example.test/callback?q=cats&code=SECRET&state=SECRET')),false);
  assert.match(r('https://example.test/callback?q=cats&code=SECRET&state=SECRET'),/q=cats/);
  // Implicit-flow fragment and password-reset style tokens.
  assert.equal(/SECRET/.test(r('https://example.test/#access_token=SECRET&token_type=bearer')),false);
  assert.equal(/SECRET/.test(r('https://example.test/reset?token=SECRET')),false);
  // A long opaque value under an innocuous name is masked too.
  assert.equal(/eyJhbGciOi/.test(r('https://example.test/p?t=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig')),false);
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
test('explicitly blocked tabs and redirected content are redacted by bridge even if extension omits filtering',async t=>{
  const {b,http}=await fixture(t);
  const policy=P.defaults();policy.read.block=['blocked.test'];await b.request('setPolicy',{policy});
  async function roundtrip(action,result){
    const p=b.request('act',{action,payload:action==='tabs'?{}:{url:'https://example.test'}});await sleep(5);
    const {job}=(await http('/poll')).data;await http('/ack',{id:job.id});await http('/result',{id:job.id,result});return p;
  }
  const r=await roundtrip('tabs',{tabs:[{id:1,url:'https://blocked.test',title:'private'},{id:2,url:'https://example.test',title:'public'}]});
  assert.deepEqual(r.tabs[0],{id:1,redacted:true});assert.equal(r.tabs[1].title,'public');
  const redirected=await roundtrip('text',{ok:true,url:'https://blocked.test',text:'private'});assert.equal(redirected.error,'REDIRECT_BLOCKED');assert.equal(redirected.text,undefined);
});
test('production stdio worker returns JSON-RPC and exits when host closes stdin',async t=>{
  const child=spawn(process.execPath,['-e','require(process.argv[1])',path.resolve(import.meta.dirname,'../my-browser/node/worker.cjs')],{stdio:['pipe','pipe','pipe']});
  t.after(()=>child.kill());
  const lines=readline.createInterface({input:child.stdout});
  const answer=once(lines,'line');child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:'fixture-id',method:'status',params:{}})+'\n');
  const [line]=await answer;const message=JSON.parse(line);assert.equal(message.id,'fixture-id');assert.equal(message.result.ok,true);
  child.stdin.end();await once(child,'exit');lines.close();
});

test('all-site interaction preserves explicit blocks and old restricted policies',()=>{
  const p=P.defaults();p.interact.block=['blocked.test'];p.read.block=['private.test'];
  assert.equal(P.check(p,'click','https://other.test').ok,true);
  assert.equal(P.check(p,'click','https://child.blocked.test').ok,false);
  assert.equal(P.check(p,'text','https://private.test').ok,false);
  const old={read:{block:[]},interact:{allow:['example.test'],block:[]}};
  assert.deepEqual(P.normalizePolicy(old),old);
  assert.equal(P.check(P.normalizePolicy(old),'click','https://other.test').ok,false);
  assert.throws(()=>P.normalizePolicy({read:{block:['*']},interact:{allow:[]}}));
});

test('upgrade preserves ambiguous saved restrictions, while fresh installs have no preset blocks',()=>{
  const legacy=['mail.google.com','outlook.com','outlook.live.com','mail.qq.com','mail.163.com',
    '1password.com','lastpass.com','bitwarden.com','accounts.google.com','login.microsoftonline.com',
    'appleid.apple.com','paypal.com','stripe.com','alipay.com','cmbchina.com','icbc.com.cn',
    'bankofamerica.com','chase.com','coinbase.com','binance.com','console.aws.amazon.com',
    'console.cloud.google.com','portal.azure.com'];
  const policy={read:{block:[...legacy,'private.example.test']},interact:{allow:['example.test'],block:[]}};
  const migrated=savedPolicy({policy});
  assert.deepEqual(migrated,policy);
  assert.deepEqual(savedPolicy({}),P.defaults());
  assert.deepEqual(savedPolicy({}).read.block,[]);
  assert.equal(P.check(migrated,'text','https://mail.google.com').ok,false);
  assert.deepEqual(savedPolicy({policy:{...policy,read:{block:legacy}}}).read.block,legacy);
  assert.equal(P.check(migrated,'text','https://private.example.test').ok,false);
  assert.deepEqual(migrated.interact,policy.interact);
  assert.equal(policy.read.block.length,legacy.length+1);
  assert.deepEqual(savedPolicy({policy,siteDefaultsVersion:1}),policy);
  const custom={...policy,read:{block:['mail.google.com','private.example.test']}};
  assert.deepEqual(savedPolicy({policy:custom}),custom);
});

test('acknowledged reads with lost results or revoked authorization are unknown',async t=>{
  const {b,http}=await fixture(t,{jobTimeout:80});
  for(const revoke of [false,true]) {
    const pending=b.request('act',{action:'text',payload:{url:'https://example.test'}});
    await sleep(5);const {job}=(await http('/poll')).data;await http('/ack',{id:job.id});
    if(revoke) {
      await b.request('setPolicy',{policy:{...P.defaults(),read:{block:['example.test']}}});
      assert.equal((await http('/authorize',{id:job.id,url:'https://example.test'})).data.execution,'unknown');
    }
    assert.equal((await pending).execution,'unknown');
    assert.equal((await http('/poll')).data.job,null);
  }
});
