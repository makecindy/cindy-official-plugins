const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const worker=require('node:path').join(__dirname,'../node/worker.cjs');
test('Cindy require-loaded native worker starts its JSON-RPC listener',()=>{
 const script='globalThis.__CINDY_NODE__=Object.freeze({});require('+JSON.stringify(worker)+');';
 const req={jsonrpc:'2.0',id:'startup-canary',method:'local/call',params:{config:{mode:'local'},name:'memory_forget'}};
 const child=spawnSync(process.execPath,['-e',script],{input:JSON.stringify(req)+'\n',encoding:'utf8',timeout:2000});
 assert.equal(child.error,undefined);
 assert.ok(child.stdout.trim(),'require-loaded worker must respond to a request');
 const response=JSON.parse(child.stdout.trim());
 assert.equal(response.id,req.id);assert.match(response.error.message,/Unsupported Cortex operation/);
});
