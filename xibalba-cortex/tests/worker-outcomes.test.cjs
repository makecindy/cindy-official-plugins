const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
function worker(scenario){
 let timeout;const child=new EventEmitter();child.stdout=new EventEmitter();child.stdout.setEncoding=()=>{};child.stderr={resume(){}};child.kill=()=>{};child.stdin=new EventEmitter();
 child.stdin.write=line=>{const request=JSON.parse(line);
  if(request.method==='initialize')queueMicrotask(()=>scenario==='pre-timeout'?timeout():child.stdout.emit('data',JSON.stringify({id:1,result:{protocolVersion:'2024-11-05'}})+'\n'));
  if(request.method==='tools/call')queueMicrotask(()=>{
   if(scenario==='timeout')timeout();
   else if(scenario==='exit')child.emit('exit',1);
   else if(scenario==='malformed')child.stdout.emit('data','not-json\n');
   else if(scenario==='stream-error')child.stdin.emit('error',new Error('broken pipe'));
   else if(scenario==='tool-error')child.stdout.emit('data',JSON.stringify({id:2,result:{isError:true,content:[]}})+'\n');
   else child.stdout.emit('data',JSON.stringify({id:2,result:{content:[{type:'text',text:'saved'}]}})+'\n');
  });return true;
 };
 const module={exports:{}};
 const context={module,exports:module.exports,require:name=>name==='node:child_process'?{spawn:()=>child}:require(name),process:{env:{}},Buffer,URL,AbortSignal,TextDecoder,console,setTimeout:fn=>{timeout=fn;return 1;},clearTimeout(){}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../node/worker.cjs'),'utf8'),context);return module.exports;
}
for(const scenario of ['timeout','exit','malformed','stream-error','tool-error'])test(`local remember ${scenario} after send has unknown outcome`,async()=>{
 await assert.rejects(worker(scenario).handle({method:'local/call',params:{config:{mode:'local',executable:'/opt/cortex',home:'/profiles/main'},name:'memory_remember'}}),e=>e.outcome==='unknown'&&/Check Cortex/.test(e.message)&&!/then retry/.test(e.message));
});
test('local timeout before tool dispatch is not executed',async()=>{
 await assert.rejects(worker('pre-timeout').handle({method:'local/call',params:{config:{mode:'local',executable:'/opt/cortex',home:'/profiles/main'},name:'memory_remember'}}),e=>e.outcome==='not_executed');
});
test('local successful remember returns the backend result',async()=>{
 const result=await worker('success').handle({method:'local/call',params:{config:{mode:'local',executable:'/opt/cortex',home:'/profiles/main'},name:'memory_remember'}});assert.equal(result.content[0].text,'saved');
});
