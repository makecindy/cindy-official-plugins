#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const {Environments}=require('./core.cjs');
// Payload comes from stdin so private account references need not enter shell history.
const method=process.argv[2]||'catalog';
(async()=>{try{
  const raw=process.argv.includes('--stdin')?fs.readFileSync(0,'utf8'):'';
  const args=raw.trim()?JSON.parse(raw):{};
  console.log(JSON.stringify({ok:true,result:await new Environments().invoke(method,args)},null,2));
}catch(e){console.error(JSON.stringify({ok:false,errorCode:e.code||'OPERATION_FAILED',message:e.code?e.message:'Operation failed; inspect the local project and catalog.',execution:e.execution||'unknown'}));process.exitCode=1;}})();
