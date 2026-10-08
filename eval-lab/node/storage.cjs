'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
function storageError(error){
 const compatibility=['EPERM','EOPNOTSUPP','ENOTSUP','EXDEV','ENOSYS'].includes(error.code);
 return Object.assign(Error(compatibility?'此目录不支持评测记录所需的硬链接，请改选支持硬链接的本地目录；已有文件保留。':'评测目录无法写入，请检查空间、读写权限和连接；已有文件保留。'),{code:error.code||'STORAGE_UNAVAILABLE'});
}
async function validateStorage(root){
 let probe;
 try{
  probe=await fs.mkdtemp(path.join(root,'.eval-storage-'));
  const source=path.join(probe,'source');await fs.writeFile(source,'probe',{flag:'wx'});await fs.link(source,path.join(probe,'linked'));
 }catch(e){throw storageError(e);}
 finally{if(probe)await fs.rm(probe,{recursive:true,force:true}).catch(()=>{});}
 return {ok:true};
}
async function link(source,target){try{return await fs.link(source,target);}catch(e){throw storageError(e);}}
module.exports={storageError,validateStorage,link};
