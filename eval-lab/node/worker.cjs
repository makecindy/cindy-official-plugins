'use strict';
const readline=require('node:readline');const {dispatch}=require('./engine.cjs');
readline.createInterface({input:process.stdin}).on('line',async line=>{let r;let heartbeat;try{r=JSON.parse(line);heartbeat=setInterval(()=>process.stderr.write('Evaluation operation in progress…\n'),10000);const result=await dispatch(r.method,r.params||{});process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\n');}catch(e){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r?.id??null,error:{code:-32000,message:e.message}})+'\n');}finally{clearInterval(heartbeat);}});
