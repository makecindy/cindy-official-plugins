const cp=require('node:child_process');

// Drive the same begin/step/cancel calls used by main.js, with local borrowed files.
async function install(svc,params){
 const p={...params,...(params.operationId?{}:svc.begin(params))};
 try{let value;do{value=await svc.step(p);}while(!value.done);return value.result;}
 finally{await svc.cancel(p);}
}
function zipSpec(archive,spec){
 cp.execFileSync('python3',['-I','-c',"import sys,zipfile;z=zipfile.ZipFile(sys.argv[1],'w');z.writestr('question.json',sys.stdin.read());z.close()",archive],{input:spec});
}
module.exports={install,zipSpec};
