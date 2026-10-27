'use strict';
// Cindy requires this entry from its utility-process bootstrap; it is NOT require.main.
// Keep entry activation unconditional and the testable implementation in bridge.cjs.
const readline = require('node:readline');
const path = require('node:path');
const manifest = require('../extension/manifest.json');
const {createBridge} = require('./bridge.cjs');
const P = require('../extension/policy.js');
const nativeBinding=require('./native-binding.cjs').createNativeBinding();
const bridge = createBridge({nativeToken:nativeBinding.token,notify:(method,params)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',method,params})+'\n')});
const installation = require('./installation.cjs').createInstallation();
// The loopback bridge starts on first use. A host that owns the extension bridge (browserExtension
// slot) only asks this worker for installation helpers, so it must never occupy the port range
// the extension scans or register a competing native binding.
let nativeReady=null;
const ensureBridge=()=>nativeReady??=bridge.request('status').then(status=>{if(!status.ok)return {ok:false};const distribution=require('../distribution.json');const {EXT_ID}=require('./bridge.cjs');return nativeBinding.install(status.port,[...new Set([EXT_ID,distribution.chrome.extensionId,distribution.edge.extensionId].filter(Boolean))]);}).catch(()=>({ok:false}));
const input = readline.createInterface({input:process.stdin});
input.on('line',async line => {
  let req;
  try {req=JSON.parse(line);} catch {return;}
  if (!req || req.id == null) return;
  let result;
  try {
    if (req.method === 'describe') result={ok:true,extension_dir:path.resolve(__dirname,'../extension'),version:manifest.version};
    else if (req.method === 'installation') result={ok:true,...installation.status()};
    else if (req.method === 'openInstallation') result=await installation.open(req.params?.browser,req.params?.mode);
    else {
      await ensureBridge();
      result=await bridge.request(req.method,req.params);
      if(req.method==='status')result.nativeBinding=nativeBinding.status();
    }
  }
  catch(e) {result={ok:false,error:'BRIDGE_ERROR',message:e.message || 'Re-enable Cindy Chrome and check its connection.',execution:req.method==='act' && P.INTERACT.includes(req.params?.action) ? 'unknown' : 'not_executed'};}
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:req.id,result})+'\n');
});
input.on('close',()=>{void (nativeReady ?? Promise.resolve()).finally(async()=>{await bridge.close();await nativeBinding.close();});});
