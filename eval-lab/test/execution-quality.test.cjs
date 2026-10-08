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

test('optional diagnostics cannot throw on malformed directories or disappearing receipts',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eval-quality-bad-')),target=path.join(root,'tests/environment-preflight');
 try{
  await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,'candidate file');assert.equal(await environmentEvidence(root,root),null);
  await fs.unlink(target);await fs.mkdir(target);await fs.writeFile(path.join(target,'receipt-a.json'),'{}');
  const stat=fs.lstat;fs.lstat=async p=>{if(p===path.join(target,'receipt-a.json'))throw Object.assign(Error('gone'),{code:'ENOENT'});return stat(p);};
  try{assert.equal(await environmentEvidence(root,root),null);}finally{fs.lstat=stat;}
  const read=fs.readdir;fs.readdir=async()=>{throw Object.assign(Error('unreadable'),{code:'EACCES'});};
  try{assert.equal(await environmentEvidence(root,root),null);}finally{fs.readdir=read;}
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('oversized optional receipts never use whole-file reads or block diagnostics',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'eval-quality-large-')),dir=path.join(root,'tests/environment-preflight'),original=fs.readFile;
 let unbounded=0;
 try{
  await fs.mkdir(dir,{recursive:true});const file=path.join(dir,'receipt-large.json'),handle=await fs.open(file,'w');await handle.truncate(64*1024*1024);await handle.close();
  fs.readFile=async(p,...args)=>{if(p===file){unbounded++;throw Error('whole-file read');}return original(p,...args);};
  assert.equal(await environmentEvidence(root,root),null);assert.equal(unbounded,0);
 }finally{fs.readFile=original;await fs.rm(root,{recursive:true,force:true});}
});
