#!/usr/bin/env node
// Replay one PR's chronological trace, keeping state across observations and finish receipts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const [trace, scripts = path.dirname(fileURLToPath(import.meta.url))] = process.argv.slice(2);
if (!trace) throw new Error('Usage: pr-follow-replay.mjs <trace.jsonl> [candidate scripts directory]');
const {runGate,stateFilePath,repoStateFilePath} = await import(pathToFileURL(path.resolve(scripts,'pr-heartbeat-gate.mjs')));
const rows = fs.readFileSync(trace,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'pr-follow-replay-'));
let seeded = false, previousAt = -Infinity, key, observed = 0, candidate = 0, gaps = 0;
const differences = [];
try {
  for (const row of rows) {
    if (!row.replayable || row.schema !== 1) {gaps++; break;}
    const currentKey = `${row.repo}#${row.number}`;
    if ((key && key !== currentKey) || row.at < previousAt) throw new Error('Trace must contain one PR in chronological order');
    key=currentKey;previousAt=row.at;
    if (!seeded) {
      for(const [file,data] of [[stateFilePath(dir,row.repo,row.number),row.before],[repoStateFilePath(dir,row.repo),row.repoBefore]]) {
        if(data) fs.writeFileSync(file,JSON.stringify(data));
      }
      seeded=true;
    }
    const argv=[...row.argv,'--state-dir',dir,'--json'];
    if(row.waitPlan) {const file=path.join(dir,'wait.json');fs.writeFileSync(file,JSON.stringify(row.waitPlan));argv.push('--wait',file);}
    let missingInput=false,stdout='';
    const exitCode=await runGate(argv,{env:{...process.env,CINDY_PR_TRACE:'0'},now:()=>row.at,
      runSnapshot:async()=>{if(!row.snapshot){missingInput=true;return {code:1,stdout:'',stderr:'unrecorded snapshot'};}return {code:0,stdout:JSON.stringify(row.snapshot),stderr:''};},
      runProbe:async()=>row.probe?{code:0,stdout:JSON.stringify(row.probe),stderr:''}:{code:1},
      readTrigger:async()=>row.trigger??null,out:s=>{stdout+=s;},err:()=>{},
    });
    if(missingInput){gaps++;break;}
    const finish=['wait','ack','resume','defer'].includes(row.decision);
    if(!finish){observed+=row.exitCode===0;candidate+=exitCode===0;}
    let reason;try{reason=JSON.parse(stdout).reason;}catch{reason='error';}
    if(exitCode!==row.exitCode || (!finish && reason!==row.decision))differences.push({at:row.at,observed:row.decision,candidate:reason,exitCode,finish});
    // Once a recorded model action is rejected, do not invent what that model would have done.
    if(finish && exitCode!==row.exitCode){gaps++;break;}
  }
  console.log(JSON.stringify({observedWakes:observed,candidateWakes:candidate,gaps,complete:gaps===0,differences,
    limitation:'Recorded agent receipts, not simulated model decisions. No claim about empty work or real model execution. Stops at missing input or a rejected receipt.'},null,2));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
