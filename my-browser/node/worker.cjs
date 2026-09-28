'use strict';
// Cindy requires this entry from its utility-process bootstrap; it is NOT require.main.
// Keep entry activation unconditional and the testable implementation in bridge.cjs.
const readline = require('node:readline');
const {createBridge} = require('./bridge.cjs');
const P = require('../extension/policy.js');
const bridge = createBridge();
const installation = require('./installation.cjs').createInstallation();
const input = readline.createInterface({input:process.stdin});
input.on('line',async line => {
  let req;
  try {req=JSON.parse(line);} catch {return;}
  if (!req || req.id == null) return;
  let result;
  try {
    if (req.method === 'installation') result={ok:true,...installation.status()};
    else if (req.method === 'openInstallation') result=await installation.open(req.params?.browser,req.params?.mode);
    else result=await bridge.request(req.method,req.params);
  }
  catch(e) {result={ok:false,error:'BRIDGE_ERROR',message:e.message || 'Re-enable My Browser and check its connection.',execution:req.method==='act' && P.INTERACT.includes(req.params?.action) ? 'unknown' : 'not_executed'};}
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:req.id,result})+'\n');
});
input.on('close',()=>bridge.close());
