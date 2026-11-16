import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
const source=fs.readFileSync(new URL('../../lumi-vercel/settings.js',import.meta.url),'utf8');
async function settings({locale='en',checkOk=true}={}){
 const ids=['credential-state','token','save-token','test','clear-token','connection-result','team','project','defaults-result','token-form','defaults-form'];
 const nodes=Object.fromEntries(ids.map(id=>[id,{value:'',disabled:false,textContent:'',placeholder:'',dataset:{},listeners:{},addEventListener(name,fn){this.listeners[name]=fn;}}]));
 const requests=[],messages=[];let saved=false,channel,pings=0;
 const label={dataset:{i18n:'connection'},textContent:''};
 const context={
  console,crypto:{randomUUID},setTimeout,clearTimeout,setInterval,clearInterval,
  document:{documentElement:{lang:'en'},querySelector:s=>nodes[s.slice(1)],querySelectorAll:()=>[label]},
  BroadcastChannel:class{constructor(){channel=this;}postMessage(m){messages.push(m);if(m.type==='ping'){pings++;if(pings>=2)queueMicrotask(()=>this.onmessage({data:{type:'pong',id:m.id}}));}if(m.type==='connection-check')queueMicrotask(()=>this.onmessage({data:{type:'connection-result',id:m.id,ok:checkOk,user:{id:'actual-user',name:'Real account'},message:checkOk?undefined:'Vercel returned HTTP 401. Reconnect in plugin settings.'}}));}},
  fetch:async(path,options={})=>{
   requests.push({path,...options});let data={};
   if(path==='/app-context')data={context:{uiLocale:locale}};
   else if(path==='/kv')data=options.method?{}:{defaultTeamId:'team_real',defaultProject:'shop'};
   else if(path==='/secrets')data=[{key:'vercel_token',saved,tail:saved?'abcd':undefined}];
   else if(path==='/secrets/vercel_token')saved=options.method==='PUT';
   else if(path!=='/wake')throw Error('Unexpected path '+path);
   return{ok:true,status:options.method?204:200,json:async()=>data};
  }
 };
 vm.runInNewContext(source,context);
 await new Promise(r=>setImmediate(r));
 const trigger=async(id,event='click')=>nodes[id].listeners[event]({preventDefault(){}});
 return{nodes,requests,messages,label,trigger,channel};
}
test('token is submitted only to Host vault, immediately cleared, never written to KV/channel',async()=>{
 const p=await settings();p.nodes.token.value='user-token-that-must-stay-private';await p.trigger('token-form','submit');
 assert.equal(p.nodes.token.value,'');assert.equal(p.nodes.test.disabled,false);assert.ok(p.nodes['credential-state'].textContent.includes('abcd'));
 const writes=p.requests.filter(r=>r.method==='PUT');assert.equal(writes.length,1);assert.equal(writes[0].path,'/secrets/vercel_token');assert.equal(JSON.parse(writes[0].body).value,'user-token-that-must-stay-private');assert.equal(p.messages.length,0);
});
test('only public default fields are persisted',async()=>{
 const p=await settings();p.nodes.team.value='team_selected';p.nodes.project.value='chosen-project';await p.trigger('defaults-form','submit');const r=p.requests.find(r=>r.path==='/kv'&&r.method==='PUT');assert.deepEqual(JSON.parse(r.body),{defaultTeamId:'team_selected',defaultProject:'chosen-project'});
});
test('settings follows Host language and falls back to English',async()=>{
 const zh=await settings({locale:'zh-CN'});assert.equal(zh.label.textContent,'连接 Vercel');const fallback=await settings({locale:'fr'});assert.equal(fallback.label.textContent,'Connect Vercel');
});
test('cold worker startup uses harmless ping handshake and one connection check',async()=>{
 const p=await settings();p.nodes.token.value='private-token';await p.trigger('token-form','submit');await p.trigger('test');assert.ok(p.messages.filter(m=>m.type==='ping').length>=2);assert.equal(p.messages.filter(m=>m.type==='connection-check').length,1);assert.ok(!JSON.stringify(p.messages).includes('private-token'));assert.equal(p.nodes['connection-result'].textContent,'Connected as Real account');
});
test('failed verification is not reported as a successful connection',async()=>{
 const p=await settings({checkOk:false});p.nodes.token.value='private-token';await p.trigger('token-form','submit');await p.trigger('test');assert.equal(p.nodes['connection-result'].dataset.state,'error');assert.ok(p.nodes['connection-result'].textContent.includes('401'));
});
test('disconnect removes Host credential without altering saved defaults',async()=>{
 const p=await settings();p.nodes.token.value='private-token';await p.trigger('token-form','submit');await p.trigger('clear-token');assert.ok(p.requests.some(r=>r.path==='/secrets/vercel_token'&&r.method==='DELETE'));assert.ok(!p.requests.some(r=>r.path==='/kv'&&r.method));assert.equal(p.nodes.test.disabled,true);
});
test('settings includes Japanese and Korean host languages',async()=>{
 const ja=await settings({locale:'ja'});assert.equal(ja.label.textContent,'Vercel に接続');const ko=await settings({locale:'ko'});assert.equal(ko.label.textContent,'Vercel 연결');
});
