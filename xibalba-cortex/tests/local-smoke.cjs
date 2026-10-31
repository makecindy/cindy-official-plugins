
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {handle}=require('../node/worker.cjs');
async function main(){
 const executable=process.env.CORTEX_SMOKE_EXE;if(!executable)throw new Error('Set CORTEX_SMOKE_EXE to an installed Cortex executable.');
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'cortex-cindy-smoke-'));
 const cfg={mode:'local',executable,home,agentId:'did:key:zCindyPluginSmoke'};
 const old=process.env.XIBALBA_CORTEX_EMBEDDING_URL;process.env.XIBALBA_CORTEX_EMBEDDING_URL='http://127.0.0.1:1/embed';
 const call=async(name,args={})=>{const result=await handle({method:'local/call',params:{config:cfg,name,args}});return result.structuredContent||JSON.parse(result.content.find(x=>x.type==='text').text);};
 try{
  const status=await call('memory_status');assert.ok(status);
  const memory=await call('memory_remember',{content:'Cindy integration canary: café Δ provenance.',source:{kind:'cindy_explicit_memory',locator:'cindy-test://isolated-canary'},evidence_class:'observed_event'});assert.ok(memory.id);
  const verification=await call('memory_verify_chain',{memory_id:memory.id});assert.ok(verification);
  const recall=await call('memory_hybrid_retrieve',{query:'Cindy integration canary',limit:5,max_total_chars:16000,filters:{status:['candidate','active','confirmed']}});assert.ok(recall.trace_id);assert.ok(JSON.stringify(recall).includes(memory.id));
  const trace=await call('memory_retrieval_trace',{trace_id:recall.trace_id});assert.ok(trace);
  const args={external_session_id:'cindy:isolated-test',runtime:'cindy',prompt:'Canary user text.',response:'Canary assistant text.',prompt_id:'test-prompt-1',idempotency_key:'cindy-smoke:turn-1',metadata:{capture_surface:'message_hooks',tool_payloads_available:false}};
  const first=await call('memory_ingest_agent_turn',args),second=await call('memory_ingest_agent_turn',args);assert.ok(first);assert.ok(second);assert.equal(first.exchange.id,second.exchange.id);assert.equal(first.prompt_memory.id,second.prompt_memory.id);assert.equal(first.response_memory.id,second.response_memory.id);
  // Print only verification results, never memory content or credentials.
  console.log(JSON.stringify({local_mcp:'passed',remember:'passed',unicode_roundtrip:memory.content.includes('café Δ'),recall:'passed',trace:'passed',verification,ingestion:'passed',idempotent_replay:first.exchange.id===second.exchange.id},null,2));
 }finally{if(old===undefined)delete process.env.XIBALBA_CORTEX_EMBEDDING_URL;else process.env.XIBALBA_CORTEX_EMBEDDING_URL=old;fs.rmSync(home,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
