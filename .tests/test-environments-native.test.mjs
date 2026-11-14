import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const main=fs.readFileSync(new URL('../test-environments/main.js',import.meta.url),'utf8');
function runtime(request){let channel,host;const sent=[],calls=[];vm.runInNewContext(main,{cindy:{node:{request:async q=>{calls.push(q);return request(q);}},onHostMessage:cb=>host=cb,send:async r=>sent.push(r)},BroadcastChannel:class{constructor(){channel=this;}postMessage(v){sent.push(v);}},setTimeout:()=>0});return {calls,sent,page:data=>channel.onmessage({data:{type:'request',...data}}),host:msg=>host(msg)};}
test('repeated page delivery opens login once and selection uses the same account tool as the conversation',async()=>{
 let finish;const r=runtime(()=>new Promise(resolve=>finish=resolve));const a=r.page({id:'one',method:'add_account'}),b=r.page({id:'one',method:'add_account'});assert.equal(r.calls.length,1);finish({ok:true,result:{ok:true,data:{jobId:'example'}}});await Promise.all([a,b]);assert.equal(r.sent.filter(q=>q.type==='response').length,2);
});
test('removed directory picker and manual identity entry cannot be dispatched from the page or conversation',async()=>{
 const r=runtime(async()=>({ok:true,result:{ok:true,data:{accounts:[]}}}));for(const tool of ['pick_project','prepare_project','save_account']){await r.page({id:tool,method:tool});assert.equal(r.sent.at(-1).result.errorCode,'UNKNOWN_OPERATION');}assert.equal(r.calls.length,0);await r.host({type:'tool-call',tool:'login_accounts',callId:'accounts',args:{account:'example'}});assert.equal(r.calls[0].params.account,'example');
});
