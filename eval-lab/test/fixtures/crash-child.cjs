const fs=require('node:fs/promises'),path=require('node:path');
process.once('message',async({method,p,filename,gradingPause})=>{
 if(gradingPause){const cp=require('node:child_process'),spawn=cp.spawn;cp.spawn=function(command,args,options){if(args[1]?.endsWith('/grade-run.py'))args=[args[0],path.join(__dirname,'grade-crash.py'),args[1],'copy',gradingPause,...args.slice(2)];return spawn.call(this,command,args,options);};}
 const link=fs.link;
 fs.link=async(a,b)=>{if(path.basename(b)===filename){process.send('paused');await new Promise(()=>{});}return link(a,b);};
 try{await require('../../node/engine.cjs').dispatch(method,p);}catch(e){process.send({error:e.message});process.exitCode=1;process.disconnect();}
});
