
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {handle,parseBody}=require('../node/worker.cjs');
test('MCP JSON and multiline SSE responses retain matching request IDs',()=>{
 assert.equal(parseBody('{"id":2,"result":{"ok":true}}',2).result.ok,true);
 assert.equal(parseBody('event: message\ndata: {"id":2,\ndata: "result":{"ok":true}}\n\n',2).result.ok,true);
 assert.throws(()=>parseBody('{"id":3}',2));
});
test('reject admin operations, invalid destinations, and missing hosted secrets',async()=>{
 await assert.rejects(handle({method:'local/call',params:{config:{mode:'local'},name:'memory_forget'}}),/Unsupported/);
 for(const endpoint of ['http://localhost/mcp','https://user:pass@example.com/mcp','https://example.com/mcp?token=secret','https://example.com/mcp#x']){
 await assert.rejects(handle({method:'hosted/call',params:{config:{mode:'hosted',endpoint},name:'memory_status'},cindy:{secrets:{cortex_token:'secret'}}}),/HTTPS/);}
 await assert.rejects(handle({method:'hosted/call',params:{config:{mode:'hosted',endpoint:'https://example.com/mcp'},name:'memory_status'}}),/bearer token/);
});
test('hosted MCP initializes, injects token per request, decodes SSE, and closes session',async()=>{
 const original=global.fetch,calls=[];
 global.fetch=async(url,opts)=>{calls.push(opts);if(opts.method==='DELETE')return new Response(null,{status:204});const r=JSON.parse(opts.body);
 if(r.method==='initialize')return new Response(JSON.stringify({id:1,result:{protocolVersion:'2024-11-05'}}),{headers:{'Mcp-Session-Id':'session'}});
 if(!r.id)return new Response(null,{status:202});
 return new Response('data: '+JSON.stringify({id:2,result:{content:[{type:'text',text:'healthy'}]}})+'\n\n',{headers:{'Content-Type':'text/event-stream'}});};
 try{const result=await handle({method:'hosted/call',params:{config:{mode:'hosted',endpoint:'https://example.com/mcp'},name:'memory_status'},cindy:{secrets:{cortex_token:'vault-only'}}});
 assert.equal(result.content[0].text,'healthy');assert.equal(calls.length,4);assert.ok(calls.every(x=>x.headers.Authorization==='Bearer vault-only'));assert.ok(calls.every(x=>x.redirect==='error'));assert.equal(calls[2].headers['Mcp-Session-Id'],'session');}finally{global.fetch=original;}
});
test('hosted errors do not expose server response bodies or replay writes',async()=>{
 const original=global.fetch;let n=0;global.fetch=async()=>{n++;return new Response('sensitive upstream diagnostic',{status:401});};
 try{await assert.rejects(handle({method:'hosted/call',params:{config:{mode:'hosted',endpoint:'https://example.com/mcp'},name:'memory_remember'},cindy:{secrets:{cortex_token:'vault-only'}}}),e=>e.outcome==='not_executed'&&!e.message.includes('sensitive'));assert.equal(n,1);}finally{global.fetch=original;}
});
function harness(recording=true, storage=new Map()){
 let cfg={mode:'local',recording},callback;const sent=[],requests=[],broadcast=[];
 class Channel{constructor(){this.onmessage=null;Channel.instance=this;}postMessage(x){broadcast.push(x);}}
 const ctx=vm.createContext({navigator:{locks:{request:(name,options,action)=>Promise.resolve().then(action)}},crypto:require('node:crypto').webcrypto,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},setTimeout(){},BroadcastChannel:Channel,fetch:async(url,options)=>{if(options?.method==='PUT')cfg=JSON.parse(options.body);return {ok:true,json:async()=>({...cfg})};},cindy:{onHostMessage(fn){callback=fn;},send(x){sent.push(x);},node:{async request(r){requests.push(r);return {ok:true,result:{content:[]}};}}},console:{warn(){},log(){},error(){}}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../main.js'),'utf8'),ctx);
 let i=0;return {ctx,sent,requests,broadcast,storage,raw:msg=>callback(msg),emit(name,text,sessionId='s'){callback({type:'event',name,hookId:'h'+(++i),data:{sessionId,text}});},async drain(){await vm.runInContext('eventQueue',ctx);},change(next){cfg={...cfg,...next};Channel.instance.onmessage({data:{type:'settings-changed'}});}};
}
test('hooks immediately allow, capture text with idempotency, and isolate sessions',async()=>{
 const h=harness();h.emit('will-user-message','alpha','a');h.emit('will-user-message','beta','b');h.emit('will-assistant-message','B','b');h.emit('will-assistant-message','A','a');
 assert.equal(h.sent.length,4);assert.ok(h.sent.every(x=>x.action==='allow'));assert.equal(h.requests.length,0);await h.drain();
 assert.deepEqual(h.requests.map(x=>x.params.args.prompt),['beta','alpha']);assert.ok(h.requests.every(x=>x.params.args.idempotency_key));assert.ok(h.requests.every(x=>x.params.args.metadata.tool_payloads_available===false));
});
test('paused and unmatched messages never write; settings changes discard pending captures',async()=>{
 const h=harness(false);h.emit('will-user-message','private');h.emit('will-assistant-message','response');await h.drain();assert.equal(h.requests.length,0);
 h.change({recording:true});h.emit('will-assistant-message','unmatched');await h.drain();assert.equal(h.requests.length,0);
 h.emit('will-user-message','old destination');await h.drain();h.change({endpoint:'https://new.example/mcp'});h.emit('will-assistant-message','response');await h.drain();assert.equal(h.requests.length,0);
});
test('oversized captures and saturation are bounded and reported',async()=>{
 const h=harness();h.emit('will-user-message','x'.repeat(60001));h.emit('will-assistant-message','answer');await h.drain();assert.equal(h.requests.length,0);assert.ok(h.broadcast.some(x=>x.skipped>0));
 for(let i=0;i<80;i++)h.emit('will-user-message','message',String(i));await h.drain();assert.equal(h.sent.length,82);assert.ok(h.broadcast.some(x=>x.lastResult.includes('queue_overflow')));
});

test('recall includes unpromoted candidate memories with active and confirmed entries',async()=>{
 const h=harness();await vm.runInContext("runTool({tool:'cortex_recall',callId:'test-call',args:{query:'saved canary'}})",h.ctx);
 assert.deepEqual(Array.from(h.requests[0].params.args.filters.status),['candidate','active','confirmed']);
 assert.equal(h.requests[0].cancelWithCall,true);assert.equal(h.requests[0].callId,'test-call');
});

test('local configuration verifies connection before saving and preserves recording state',async()=>{
 const h=harness(false);await vm.runInContext("runTool({tool:'cortex_configure_local',callId:'config-call',args:{executable:'/opt/cortex',home:'/profiles/main',agent_id:'did:example:main'}})",h.ctx);
 assert.equal(h.requests[0].params.name,'memory_status');assert.equal(h.requests[0].callId,'config-call');
 const saved=await vm.runInContext('config()',h.ctx);assert.equal(saved.home,'/profiles/main');assert.equal(saved.agentId,'did:example:main');assert.equal(saved.recording,false);assert.equal(h.sent[0].result.configured,true);
});
test('invalid local configuration is rejected without contacting Cortex',async()=>{
 const h=harness(false);await vm.runInContext("runTool({tool:'cortex_configure_local',callId:'config-call',args:{executable:'relative',home:'/profiles/main'}})",h.ctx);
 assert.equal(h.requests.length,0);assert.equal(h.sent[0].ok,false);
});
test('failed local connection does not overwrite saved settings',async()=>{
 const h=harness(false);vm.runInContext("cindy.node.request=async()=>({ok:false,message:'Connection failed. Check identity.'})",h.ctx);
 await vm.runInContext("runTool({tool:'cortex_configure_local',callId:'config-call',args:{executable:'/opt/cortex',home:'/profiles/new'}})",h.ctx);
 const saved=await vm.runInContext('config()',h.ctx);assert.notEqual(saved.home,'/profiles/new');assert.equal(h.sent[0].ok,false);
});

test('history mode avoids paired hook writes and keeps recording pause effective',async()=>{
 const h=harness();h.change({historyCapture:true,historyDatabase:'/history.db'});
 h.emit('will-user-message','standalone');h.emit('will-assistant-message','reply');await h.drain();assert.equal(h.requests.length,0);
 h.change({recording:false});await vm.runInContext('pollHistory()',h.ctx);assert.equal(h.requests.length,0);
});
test('history configuration validates the source before persisting its explicit opt-in',async()=>{
 const h=harness();await vm.runInContext("runTool({tool:'cortex_configure_history',callId:'history-call',args:{database:'/cindy.db',enabled:true,session_id:'s'}})",h.ctx);
 assert.equal(h.requests[0].method,'capture/validate');assert.equal(h.requests[0].params.sessionId,'s');assert.equal(h.sent.at(-1).ok,true);
 assert.equal(await vm.runInContext('config().then(c=>c.historyCapture)',h.ctx),true);
});
test('history capture reports failed imports and retains retry state',async()=>{
 const h=harness();h.change({historyCapture:true});vm.runInContext("cindy.node.request=async()=>({ok:false,message:'source unavailable'})",h.ctx);
 await vm.runInContext("runTool({tool:'cortex_sync_history',callId:'retry',args:{}})",h.ctx);
 assert.equal(h.sent.at(-1).ok,false);assert.equal(await vm.runInContext('historyBusy',h.ctx),false);assert.match(await vm.runInContext('historyError',h.ctx),/source unavailable/);
});

async function logs(h,limit=100){await vm.runInContext(`runTool({tool:'cortex_diagnostics',callId:'diagnostics-call',args:{limit:${limit}}})`,h.ctx);return h.sent.at(-1).result;}
test('skip diagnostics retain timestamps and opaque IDs without message content',async()=>{
 const h=harness();h.emit('will-assistant-message','DO_NOT_LOG_THIS_SECRET','session-test');await h.drain();
 const report=await logs(h),last=report.events.at(-1);
 assert.equal(last.reason,'missing_user_message');assert.equal(last.session_id,'session-test');assert.equal(last.hook_id,'h1');assert.ok(Number.isFinite(Date.parse(last.timestamp)));assert.equal(report.persistent,true);
 assert.ok(!JSON.stringify(report).includes('DO_NOT_LOG_THIS_SECRET'));assert.ok(!JSON.stringify([...h.storage]).includes('DO_NOT_LOG_THIS_SECRET'));
});
test('configuration clears preserve the cause for the later orphaned reply',async()=>{
 const h=harness();h.emit('will-user-message','private');await h.drain();h.change({endpoint:'https://changed.example/mcp'});h.emit('will-assistant-message','reply');await h.drain();
 const report=await logs(h);assert.ok(report.events.some(x=>x.kind==='reset'&&x.reason==='settings_changed'&&x.session_id==='s'));assert.equal(report.events.at(-1).reason,'settings_changed');assert.equal(report.events.at(-1).kind,'skip');
});
test('diagnostics survive successful writes and restart and keep only the last 100 events',async()=>{
 const h=harness();h.emit('will-assistant-message','orphan');await h.drain();h.emit('will-user-message','new');h.emit('will-assistant-message','good');await h.drain();assert.ok((await logs(h)).events.some(x=>x.reason==='missing_user_message'));
 const restarted=harness(true,h.storage);assert.ok((await logs(restarted)).events.some(x=>x.reason==='missing_user_message'));
 for(let i=0;i<110;i++){restarted.emit('will-assistant-message','orphan');await restarted.drain();}
 const report=await logs(restarted);assert.equal(report.retained,100);assert.equal(report.events.length,100);assert.equal((await logs(restarted,2)).events.length,2);
});
test('oversized inputs, replies and pending eviction have distinct metadata',async()=>{
 const h=harness();h.emit('will-user-message','x'.repeat(60001),'large-user');await h.drain();h.emit('will-user-message','short','large-reply');h.emit('will-assistant-message','x'.repeat(60001),'large-reply');await h.drain();
 for(let i=0;i<33;i++){h.emit('will-user-message','private',String(i));await h.drain();}
 const report=await logs(h);for(const reason of ['user_text_too_large','assistant_text_too_large','pending_session_evicted'])assert.ok(report.events.some(x=>x.reason===reason));
 assert.equal(report.events.find(x=>x.reason==='assistant_text_too_large').characters,60001);
});
test('host drops are counted once and diagnostically separated from queue overflow',async()=>{
 const h=harness();h.raw({type:'event',name:'will-user-message',hookId:'dropped-hook',dropped:2,data:{sessionId:'s',text:'private'}});await h.drain();
 assert.equal(await vm.runInContext('state.skipped',h.ctx),2);assert.equal(h.sent[0].action,'allow');assert.ok((await logs(h)).events.some(x=>x.kind==='skip'&&x.reason==='host_events_dropped'&&x.count===2));
 for(let i=0;i<65;i++)h.emit('will-user-message','private');await h.drain();assert.ok((await logs(h)).events.some(x=>x.reason==='queue_overflow'));
});
test('unavailable diagnostic persistence is disclosed and reads need no backend',async()=>{
 const h=harness();vm.runInContext("localStorage.setItem=()=>{throw new Error('blocked')};cindy.node.request=async()=>{throw new Error('backend unavailable')};fetch=async()=>{throw new Error('settings unavailable')}",h.ctx);
 h.emit('will-user-message','private');await h.drain();const report=await logs(h);assert.equal(report.persistent,false);assert.equal(report.events.at(-1).reason,'settings_read_failed');assert.equal(h.sent.at(-1).ok,true);
});

test('activity recording captures only bounded metadata and survives restart',async()=>{
 const h=harness();h.change({historyCapture:true,captureActivity:true});
 await vm.runInContext("queueActivity({name:'did-thinking-start',data:{sessionId:'s',blockId:'b',text:'NEVER_CAPTURE_REASONING',input:{token:'secret'}}})",h.ctx);
 assert.equal(await vm.runInContext('activityOutbox.length',h.ctx),1);
 assert.ok(!JSON.stringify([...h.storage]).includes('NEVER_CAPTURE_REASONING'));assert.ok(!JSON.stringify([...h.storage]).includes('secret'));
 const restarted=harness(true,h.storage);assert.equal(await vm.runInContext('activityOutbox.length',restarted.ctx),1);
});
test('failed activity delivery retains outbox and successful retry removes it',async()=>{
 const h=harness();h.change({historyCapture:true,captureActivity:true});
 await vm.runInContext("queueActivity({name:'did-thinking-end',data:{sessionId:'s',blockId:'b'}})",h.ctx);
 vm.runInContext("cindy.node.request=async()=>({ok:false,message:'offline'})",h.ctx);
 await vm.runInContext('config().then(c=>flushActivity(c))',h.ctx);assert.equal(await vm.runInContext('activityOutbox.length',h.ctx),1);
 vm.runInContext("cindy.node.request=async()=>({ok:true,result:{imported:1}})",h.ctx);
 await vm.runInContext('config().then(c=>flushActivity(c))',h.ctx);assert.equal(await vm.runInContext('activityOutbox.length',h.ctx),0);
});
test('queued activity never moves to another destination and recording pause stops capture',async()=>{
 const h=harness();h.change({historyCapture:true,captureActivity:true});
 await vm.runInContext("queueActivity({name:'did-turn-start',data:{sessionId:'s'}})",h.ctx);
 h.change({home:'/different/profile'});await vm.runInContext('config().then(c=>flushActivity(c))',h.ctx);assert.equal(h.requests.length,0);
 h.change({recording:false});await vm.runInContext("queueActivity({name:'did-turn-end',data:{sessionId:'s'}})",h.ctx);assert.equal(await vm.runInContext('activityOutbox.length',h.ctx),1);
});
test('capture controls preserve recording and history settings and expose read-only audit',async()=>{
 const h=harness();h.change({historyCapture:true,historyDatabase:'/history.db'});
 await vm.runInContext("runTool({tool:'cortex_configure_capture',callId:'capture-options',args:{archive_files:true,activity_metadata:true}})",h.ctx);
 const cfg=await vm.runInContext('config()',h.ctx);assert.equal(cfg.archiveFiles,true);assert.equal(cfg.captureActivity,true);assert.equal(cfg.historyCapture,true);assert.equal(cfg.recording,true);
 await vm.runInContext("runTool({tool:'cortex_capture_audit',callId:'audit',args:{}})",h.ctx);assert.equal(h.requests.at(-1).method,'capture/audit');assert.equal(h.sent.at(-1).result.archive_files_enabled,true);
});

test('activity identifiers use 128-bit secure randomness and fail closed without it',async()=>{
 const h=harness();h.change({historyCapture:true,captureActivity:true});
 await vm.runInContext("Math.random=()=>0.5; queueActivity({name:'did-turn-start',data:{sessionId:'s'}})",h.ctx);
 await vm.runInContext("queueActivity({name:'did-turn-start',data:{sessionId:'s'}})",h.ctx);
 const ids=Array.from(await vm.runInContext('activityOutbox.map(x=>x.event.id)',h.ctx));
 assert.ok(ids.every(id=>/^[a-f0-9]{32}$/.test(id)));assert.notEqual(ids[0],ids[1]);
 await vm.runInContext("crypto=undefined; queueActivity({name:'did-turn-start',data:{sessionId:'s'}})",h.ctx);
 assert.equal(await vm.runInContext('activityOutbox.length',h.ctx),2);
 assert.equal(await vm.runInContext('diagnostics.at(-1).reason',h.ctx),'secure_random_unavailable');
});

test('a connection check cannot restore recording after a concurrent pause',async()=>{
 const h=harness();await vm.runInContext('cindy.node.request=()=>new Promise(resolve=>globalThis.releaseHealth=resolve)',h.ctx);
 const pending=vm.runInContext("runTool({tool:'cortex_configure_local',callId:'race',args:{executable:'/opt/cortex',home:'/profiles/new'}})",h.ctx);
 await new Promise(setImmediate);h.change({recording:false});h.ctx.releaseHealth({ok:true,result:{content:[]}});await pending;
 const saved=await vm.runInContext('config()',h.ctx);assert.equal(saved.recording,false);assert.equal(saved.home,'/profiles/new');
});
test('history validation cannot reenable capture after a concurrent recording pause',async()=>{
 const h=harness();await vm.runInContext('cindy.node.request=()=>new Promise(resolve=>globalThis.releaseValidation=resolve)',h.ctx);
 const pending=vm.runInContext("runTool({tool:'cortex_configure_history',callId:'race',args:{database:'/cindy.db',enabled:true,session_id:'s'}})",h.ctx);
 await new Promise(setImmediate);h.change({recording:false});h.ctx.releaseValidation({ok:true,result:{ok:true}});await pending;
 const saved=await vm.runInContext('config()',h.ctx);assert.equal(saved.recording,false);assert.equal(saved.historyCapture,false);assert.equal(h.sent.at(-1).ok,false);
});
test('a failed remember after dispatch reports unknown outcome without unsafe retry advice',async()=>{
 const original=global.fetch;let calls=0;global.fetch=async(url,opts)=>{const payload=JSON.parse(opts.body);calls++;
 if(payload.method==='initialize')return new Response(JSON.stringify({id:1,result:{protocolVersion:'2024-11-05'}}));
 if(payload.method==='notifications/initialized')return new Response(null,{status:202});return new Response('private server failure',{status:500});};
 try{await assert.rejects(handle({method:'hosted/call',params:{config:{mode:'hosted',endpoint:'https://example.test/mcp'},name:'memory_remember',args:{content:'canary'}},cindy:{secrets:{cortex_token:'vault-only'}}}),e=>e.outcome==='unknown'&&/check Cortex/i.test(e.message)&&!/then retry/i.test(e.message)&&!e.message.includes('private'));assert.equal(calls,3);}finally{global.fetch=original;}
});

test('remember tool reports unknown worker failures and known pre-dispatch failures',async()=>{
 const h=harness();await vm.runInContext("cindy.node.request=async()=>{throw new Error('worker timed out; then retry');}",h.ctx);
 await vm.runInContext("runTool({tool:'cortex_remember',callId:'unknown',args:{content:'canary',locator:'test'}})",h.ctx);
 assert.equal(h.sent.at(-1).outcome,'unknown');assert.equal(h.sent.at(-1).errorCode,'CORTEX_WRITE_UNKNOWN');assert.match(h.sent.at(-1).message,/Check Cortex/);assert.doesNotMatch(h.sent.at(-1).message,/then retry/);
 await vm.runInContext("cindy.node.request=async()=>({ok:false,message:'[CORTEX_WRITE_NOT_EXECUTED] rejected before dispatch'});",h.ctx);
 await vm.runInContext("runTool({tool:'cortex_remember',callId:'not-sent',args:{}})",h.ctx);assert.equal(h.sent.at(-1).outcome,'not_executed');
 await vm.runInContext("cindy.node.request=async()=>({ok:true,result:{id:'saved'}});",h.ctx);
 await vm.runInContext("runTool({tool:'cortex_remember',callId:'saved',args:{content:'canary',locator:'test'}})",h.ctx);assert.equal(h.sent.at(-1).result.outcome,'executed');
});

test('hosted calls wait for the credential lock and reject stale endpoint snapshots',async()=>{
 const h=harness(false);h.change({mode:'hosted',endpoint:'https://old.example.test/mcp'});
 await vm.runInContext('globalThis.releaseLock=null;navigator.locks.request=(name,options,action)=>new Promise(resolve=>{releaseLock=()=>resolve(action());})',h.ctx);
 const pending=vm.runInContext("call({mode:'hosted',endpoint:'https://old.example.test/mcp'},'memory_remember',{})",h.ctx);
 h.change({endpoint:'https://new.example.test/mcp',settingsRevision:1});h.ctx.releaseLock();
 await assert.rejects(pending,error=>error.outcome==='not_executed');assert.equal(h.requests.length,0);
});
test('an unconfirmed credential change blocks hosted calls before worker dispatch',async()=>{
 const h=harness(false);h.change({mode:'hosted',endpoint:'https://example.test/mcp',credentialPending:true});
 await assert.rejects(vm.runInContext("call({mode:'hosted',endpoint:'https://example.test/mcp'},'memory_remember',{})",h.ctx),error=>error.outcome==='not_executed');assert.equal(h.requests.length,0);
});
test('unavailable shared coordination fails closed without preventing local memory reads',async()=>{
 const h=harness(false);await vm.runInContext('navigator.locks=undefined',h.ctx);
 await vm.runInContext("runTool({tool:'cortex_configure_local',callId:'config',args:{executable:'/opt/cortex',home:'/profiles/main'}})",h.ctx);assert.equal(h.sent.at(-1).ok,false);assert.match(h.sent.at(-1).message,/Update Cindy/);
 await vm.runInContext("runTool({tool:'cortex_status',callId:'status',args:{}})",h.ctx);assert.equal(h.sent.at(-1).ok,true);
});
