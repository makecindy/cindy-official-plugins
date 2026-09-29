'use strict';
const fs=require('node:fs/promises'),crypto=require('node:crypto');
// Match the online index budget; archive/workspace limits do not apply to JSON metadata.
const limit=16*1024*1024;
module.exports=async function readMetadata(file,expectedHash,oversizeMessage='Question metadata exceeds 16 MiB; reduce the metadata file.'){
 const invalid=()=>Object.assign(Error(oversizeMessage),{code:'PACKAGE_INVALID'});
 const handle=await fs.open(file,'r');
 try{
  if((await handle.stat()).size>limit)throw invalid();
  const chunks=[];let size=0;
  while(size<=limit){
   const buffer=Buffer.alloc(Math.min(64*1024,limit+1-size));
   const {bytesRead}=await handle.read(buffer,0,buffer.length,null);
   if(!bytesRead)break;
   size+=bytesRead;if(size>limit)throw invalid();chunks.push(buffer.subarray(0,bytesRead));
  }
  const bytes=Buffer.concat(chunks,size);
  if(expectedHash!==undefined&&crypto.createHash('sha256').update(bytes).digest('hex')!==expectedHash)throw Object.assign(Error('Question package changed: question.json; restore the registered version and retry.'),{code:'PACKAGE_INVALID'});
  return JSON.parse(bytes.toString('utf8'));
 }finally{await handle.close();}
};
module.exports.limit=limit;
