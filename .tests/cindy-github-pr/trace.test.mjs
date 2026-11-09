import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {appendTrace,scrub,pruneTraces} from '../../cindy-github/skills/pr/scripts/lib/follow-trace.mjs';
test('trace rotation is bounded and oversized records advertise a replay gap',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'trace-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'trace.jsonl');
 for(let i=0;i<5;i++)appendTrace(file,{schema:1,at:i,data:'x'.repeat(700000)});
 assert.ok(fs.statSync(file).size<=2*1024*1024);assert.ok(fs.statSync(file+'.1').size<=2*1024*1024);
 appendTrace(file,{schema:1,at:5,data:'x'.repeat(3*1024*1024)});
 const rows=fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(rows.at(-1).replayable,false);
 assert.doesNotThrow(()=>appendTrace(path.join(file,'invalid'),{schema:1}));
});
test('trace keeps semantic markers, never original bodies or explanations',()=>{
 const value=scrub({body:'secret approval from someone',reason:'private waiting reason',comments:[{body:'private technical details'}],reviews:[{body:''}]},/approval/);
 assert.deepEqual(value,{body:'approval',comments:[{body:'redacted'}],reviews:[{body:''}]});
});

test('all PR traces share a directory budget; expired traces are removed, state files preserved',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'trace-budget-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const stale=path.join(root,'old.trace.jsonl');fs.writeFileSync(stale,'old');fs.utimesSync(stale,1,1);
 const state=path.join(root,'pr.json');fs.writeFileSync(state,'keep');
 for(let i=0;i<18;i++){const f=path.join(root,`${i}.trace.jsonl`);fs.writeFileSync(f,'');fs.truncateSync(f,2*1024*1024);}
 pruneTraces(root);
 assert.equal(fs.existsSync(stale),false);assert.equal(fs.readFileSync(state,'utf8'),'keep');
 assert.ok(fs.readdirSync(root).filter(n=>n.endsWith('.trace.jsonl')).reduce((n,f)=>n+fs.statSync(path.join(root,f)).size,0)<=32*1024*1024);
});
