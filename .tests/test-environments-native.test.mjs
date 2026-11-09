import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const main=fs.readFileSync(new URL('../test-environments/main.js',import.meta.url),'utf8');
function runtime({pick}={}){let hostHandler,channel;const sent=[],timers=[],calls=[],picks=[];const cindy={node:{request:async q=>{calls.push(q);return {ok:true,result:{ok:true,data:{project:{id:'p',label:'Example'},profile:{id:'daily'}}}};}},onHostMessage:handler=>{hostHandler=handler;},send:async r=>sent.push(r)};if(pick)cindy.pick=async q=>{picks.push(q);return pick(q);};const context={cindy,BroadcastChannel:class{constructor(){channel=this;}postMessage(value){sent.push(value);}},setTimeout:fn=>{timers.push(fn);return timers.length;}};vm.runInNewContext(main,context);return {sent,timers,calls,picks,request:payload=>channel.onmessage({data:{type:'request',...payload}}),host:msg=>hostHandler(msg)};}
test('native project selection forwards only the Host-picked directory to Node and exposes no raw picker path to the page',async()=>{
 const r=runtime({pick:async()=>({ok:true,path:'/example.test/source',name:'Source'})});await r.request({id:'example-request',method:'pick_project',args:{locale:'zh-CN',root:'/ignored.test',title:'Ignored'}});assert.equal(r.picks.length,1);assert.equal(r.picks[0].mode,'directory');assert.equal(r.picks[0].title,'选择 Cindy 项目');assert.equal(r.calls[0].method,'ensure_test_project');assert.equal(r.calls[0].params.root,'/example.test/source');assert.equal(JSON.stringify(r.sent).includes('/example.test/source'),false);
 await r.host({type:'tool-call',tool:'pick_project',callId:'example-call',args:{}});assert.equal(r.picks.length,1);assert.equal(r.sent.at(-1).errorCode,'UNKNOWN_OPERATION');
});
test('one native picker remains deduplicated until resolution; cancellation makes no Node changes and never reopens',async()=>{
 let finish;const r=runtime({pick:()=>new Promise(resolve=>{finish=resolve;})});const a=r.request({id:'same',method:'pick_project',args:{}}),b=r.request({id:'same',method:'pick_project',args:{}});assert.equal(r.picks.length,1);assert.equal(r.timers.length,0);finish({ok:false,errorCode:'CANCELLED'});await Promise.all([a,b]);assert.equal(r.calls.length,0);assert.equal(r.sent.filter(q=>q.type==='response').length,2);assert.equal(r.sent.find(q=>q.type==='response').result.data.cancelled,true);assert.equal(r.timers.length,1);assert.equal(r.picks.length,1);
});
test('unavailable or busy native picker fails explicitly and preserves the existing tool service',async()=>{
 const missing=runtime();await missing.request({id:'missing',method:'pick_project',args:{}});assert.equal(missing.sent.at(-1).result.errorCode,'PICK_UNAVAILABLE');assert.equal(missing.calls.length,0);await missing.host({type:'tool-call',tool:'catalog',callId:'catalog',args:{}});assert.equal(missing.calls.length,1);
 const busy=runtime({pick:async()=>({ok:false,errorCode:'BUSY',message:'Close the existing dialog.'})});await busy.request({id:'busy',method:'pick_project',args:{}});assert.equal(busy.sent.at(-1).result.errorCode,'BUSY');assert.equal(busy.calls.length,0);assert.equal(busy.picks.length,1);
});
