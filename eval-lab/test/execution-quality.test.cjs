const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {environmentEvidence,timing}=require('../node/execution-quality.cjs');
test('environment failure requires supplied harness receipt, latest success supersedes failure',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eval-quality-')),workspace=path.join(root,'work'),candidate=path.join(root,'candidate');
 try{for(const d of [workspace,candidate]){await fs.mkdir(path.join(d,'lab'),{recursive:true});await fs.writeFile(path.join(d,'lab/preflight.cjs'),'supplied');}await fs.mkdir(path.join(workspace,'tests/environment-preflight'),{recursive:true});
 await fs.writeFile(path.join(workspace,'BUGS_FOUND.md'),'environment failed listen EPERM');assert.equal(await environmentEvidence(workspace,candidate),null);
 const r={phase:'verified',root:workspace,cwd:workspace,browser:false,ok:false,verifiedAt:'2026-09-26T01:00:00Z',browserOutput:{stderr:'Error: listen EPERM: operation not permitted 127.0.0.1'}};
 await fs.writeFile(path.join(workspace,'tests/environment-preflight/receipt-a.json'),JSON.stringify(r));assert.equal((await environmentEvidence(workspace,candidate)).status,'environment_invalid');
 await fs.writeFile(path.join(workspace,'tests/environment-preflight/receipt-b.json'),JSON.stringify({...r,ok:true,browser:true,verifiedAt:'2026-09-26T01:01:00Z'}));assert.equal(await environmentEvidence(workspace,candidate),null);
 }finally{await fs.rm(root,{recursive:true});}
});
test('numeric timestamps and missing actual prices remain truthful',()=>{
 assert.deepEqual(timing({startedAt:2000,acceptedAt:1000,completedAt:5000,timingBasis:'host-message-window'},6000,8000),{durationSeconds:3,queueSeconds:1,gradingSeconds:2,timingBasis:'host-message-window',costUSD:null,costBasis:'unknown'});
 assert.equal(timing({completedAt:5000}).durationSeconds,null);
 assert.equal(timing({usage:{costUSD:0.25,approximate:true}}).costBasis,'host-session-estimate');
});
