'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
// Called only after distribution hashes are verified. Never read the mutable answer workspace.
async function taskScope(candidate,prompt){
 const parts=[prompt,'以下是题包给作答者的公开范围说明。环境说明明确要求的编辑探针属于允许的验证步骤；其余原有测试和运行环境保持只读。'];
 for(const name of ['TASK.md','ENVIRONMENT.md']){
  try{parts.push(name+'\n'+await fs.readFile(path.join(candidate,name),'utf8'));}
  catch(e){if(e.code!=='ENOENT')throw e;}
 }
 const value=parts.join('\n\n');
 if(value.length>8000)throw Error('题包公开任务范围超过宿主上限，无法完整登记；请缩短范围说明，不会截断限制。');
 return value;
}
module.exports={taskScope};
