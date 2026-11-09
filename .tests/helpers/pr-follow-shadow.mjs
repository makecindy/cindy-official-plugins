#!/usr/bin/env node
// Manual, read-only live sampling. Never touches the installed follower's state or calls a model.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const [url, baselineDir] = process.argv.slice(2);
if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(url ?? '') || !baselineDir) {
  throw new Error('Usage: node .tests/helpers/pr-follow-shadow.mjs <PR_URL> <baseline scripts directory>');
}
const candidateDir = fileURLToPath(new URL('../../cindy-github/skills/pr/scripts/', import.meta.url));
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-follow-shadow-'));
const samples = {};
for (const [label, dir] of [['baseline', path.resolve(baselineDir)], ['candidate', candidateDir]]) {
  const snap = JSON.parse(execFileSync(process.execPath, [path.join(dir, 'pr-snapshot.mjs'), url], {encoding:'utf8'}));
  fs.writeFileSync(path.join(output, `${label}.json`), JSON.stringify(snap, null, 2));
  const {runGate} = await import(pathToFileURL(path.join(dir, 'pr-heartbeat-gate.mjs')));
  const {settleState} = await import(pathToFileURL(path.join(dir, 'lib/follow-pacing.mjs')));
  let stdout = '';
  const exitCode = await runGate([url, '--state-dir', path.join(output,label), '--no-pacing','--json'], {
    runSnapshot:async()=>({code:0,stdout:JSON.stringify(snap),stderr:''}),
    runProbe:async()=>({code:1}),readTrigger:async()=>null,out:s=>{stdout+=s;},err:s=>process.stderr.write(s),
  });
  samples[label] = {
    head:snap.latestCommitOid,base:snap.baseCommitOid,verdict:snap.verdict,
    pending:snap.checksSummary.pendingRuns.map(c=>c.name),unknown:snap.checksSummary.unavailable,
    required:snap.requiredChecks ?? null,decision:JSON.parse(stdout),exitCode,
    // Counterfactual push-window comparison, not an observed live scheduler delay.
    botWindow: settleState({snap,expected:[...new Set(snap.reviews.filter(r=>r.authorIsBot).map(r=>r.author.replace(/\[bot\]$/,'')))],headSeenAt:Date.now()-120000,now:Date.now()}),
  };
}
const receipt = {output,sameHeadAndBase:samples.baseline.head===samples.candidate.head && samples.baseline.base===samples.candidate.base,...samples,
  limitation:'Live reads plus isolated gate execution; no real scheduler/model run. Sequential reads can differ even on the same head. Private raw samples stay outside the repository.'};
fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2));
console.log(JSON.stringify(receipt,null,2));
