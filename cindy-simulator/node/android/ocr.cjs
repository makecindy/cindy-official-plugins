'use strict';
const {Worker}=require('node:worker_threads'),path=require('node:path');
const {commandBudget}=require('../budget.cjs');
let busy=false;
async function recognize(bytes,ratio,deadline){
  if(busy)throw Object.assign(Error('Another screen is being read. Retry after it finishes.'),{code:'OCR_BUSY',execution:'not_executed'});
  const timeout=commandBudget(20000,deadline).timeout;busy=true;
  const directory=path.join(__dirname,'../../vendor/android');
  let worker,timer,counter=0,pending=null;
  const error=message=>Object.assign(Error(message),{code:'OCR_FAILED',execution:'not_executed'});
  try{
    worker=new Worker(path.join(directory,'ocr-worker.cjs'),{stdout:true,stderr:true});
    worker.on('error',()=>pending?.reject(error('Android text recognition failed. Use the screenshot to select coordinates.')));
    worker.on('exit',()=>pending?.reject(error('Android text recognition stopped. Use the screenshot to select coordinates.')));
    worker.on('message',m=>{if(m.jobId!==pending?.id)return;if(m.status==='resolve')pending.resolve(m.data);else if(m.status==='reject')pending.reject(error('Could not read text from this screen. Use the screenshot.'));});
    worker.stdout.resume();worker.stderr.resume();
    const job=(action,payload)=>new Promise((resolve,reject)=>{const id=String(++counter);pending={id,resolve,reject};worker.postMessage({workerId:'android-ocr',jobId:id,action,payload});});
    timer=setTimeout(()=>pending?.reject(error('Text recognition exceeded the time budget. Use the screenshot.')),timeout);
    await job('load',{options:{lstmOnly:true,logging:false}});
    await job('loadLanguage',{langs:'eng+chi_sim',options:{langPath:directory,cacheMethod:'none',gzip:true,lstmOnly:true}});
    await job('initialize',{langs:'eng+chi_sim',oem:1,config:{}});
    await job('setParameters',{params:{tessedit_pageseg_mode:'11'}});
    const result=await job('recognize',{image:new Uint8Array(bytes),options:{},output:{tsv:true,text:true}});
    const lines=new Map();
    const words=String(result.tsv||'').split('\n').slice(1).flatMap(line=>{
      const [level,page,block,paragraph,ln,word,left,top,width,height,confidence,...text]=line.split('\t');
      const label=text.join('\t').trim();if(level!=='5'||!label||Number(confidence)<35)return [];
      const frame=[left,top,width,height].map(Number).map(v=>v/ratio);if(!frame.every(Number.isFinite))return [];
      const wordResult={role:'text',label,frame,center:[frame[0]+frame[2]/2,frame[1]+frame[3]/2],source:'ocr'},key=[page,block,paragraph,ln].join(':');
      if(!lines.has(key))lines.set(key,[]);lines.get(key).push(wordResult);return [wordResult];
    });
    for(const group of lines.values())if(group.length>1){
      const x=Math.min(...group.map(w=>w.frame[0])),y=Math.min(...group.map(w=>w.frame[1])),right=Math.max(...group.map(w=>w.frame[0]+w.frame[2])),bottom=Math.max(...group.map(w=>w.frame[1]+w.frame[3]));
      words.push({role:'text',label:group.map(w=>w.label).join(group.every(w=>/^[\p{Script=Han}]+$/u.test(w.label))?'':' '),frame:[x,y,right-x,bottom-y],center:[(x+right)/2,(y+bottom)/2],source:'ocr'});
    }
    return words;
  }catch(e){throw e.code==='OCR_FAILED'?e:error('Android text recognition could not start or finish. Use the screenshot to select coordinates.');}
  finally{
    clearTimeout(timer);pending=null;
    try{await worker?.terminate();}
    catch{throw error('Android text recognition could not stop cleanly. Use the screenshot to select coordinates.');}
    finally{busy=false;}
  }
}
module.exports={recognize};
