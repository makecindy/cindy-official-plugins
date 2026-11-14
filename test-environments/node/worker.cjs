'use strict';
const readline=require('node:readline');
const {Environments}=require('./core.cjs');
const app=new Environments();
readline.createInterface({input:process.stdin}).on('line',async line=>{
  let request;try{request=JSON.parse(line);}catch{return;}
  if(request.id===undefined)return;
  let result;
  try{result={ok:true,data:await app.invoke(request.method,request.params||{})};}
  catch(e){result={ok:false,errorCode:e.code||'OPERATION_FAILED',message:e.code?e.message:'Operation failed. Existing data was preserved; inspect the project and local catalog.',execution:e.execution||(['add_account','start','stop','select_account','import_cindy','remote'].includes(request.method)||request.method.startsWith('remote_')?'unknown':'not_executed')};}
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\n');
});
