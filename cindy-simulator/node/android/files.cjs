'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const MAX_BYTES=128*1024*1024;
const TYPES={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.mp4':'video/mp4','.webm':'video/webm'};
const fail=(code,message,execution='not_executed')=>Object.assign(Error(message),{code,execution});
function extension(name){const ext=path.extname(name||'').toLowerCase();if(ext!=='.apk'&&!TYPES[ext])throw fail('UNSUPPORTED_FILE','Choose an APK, PNG, JPEG, GIF, WebP, MP4 or WebM file.');return ext;}
async function importMedia(devices,d,p){
  if(typeof p.path!=='string'||!path.isAbsolute(p.path))throw fail('INVALID_ARGUMENT','Use an absolute path to an image or video.');
  const ext=extension(p.path);if(!TYPES[ext])throw fail('UNSUPPORTED_FILE','Use app install for APK files.');
  const file=await fs.realpath(p.path),stat=await fs.stat(file);
  if(!stat.isFile()||!stat.size||stat.size>MAX_BYTES)throw fail('FILE_SIZE','Choose a nonempty file up to 128 MiB.');
  // Generated names keep ADB shell arguments independent of user filenames.
  const destination=`/sdcard/Download/cindy-${randomUUID()}${ext}`;
  let copied=false;
  try{
    await devices.adb(d,['push',file,destination],{deadline:p._deadline,mutation:true});copied=true;
    const size=(await devices.adb(d,['shell','stat','-c','%s',destination],{deadline:p._deadline})).stdout.trim();
    if(Number(size)!==stat.size)throw fail('IMPORT_UNVERIFIED','The copied size did not match. Inspect the device before retrying.','unknown');
    await devices.adb(d,['shell','am','broadcast','-a','android.intent.action.MEDIA_SCANNER_SCAN_FILE','-d','file://'+destination],{deadline:p._deadline,mutation:true});
    return {udid:d.udid,path:destination,bytes:stat.size,execution:'executed',copied:true,scanRequested:true,note:'File is in Downloads; media apps may need a moment to index it.'};
  }catch(e){return {udid:d.udid,path:destination,copied,outcome:'partial',execution:copied?'executed':e.execution||'unknown',importError:{code:e.code||'IMPORT_FAILED',message:e.message},nextAction:'Inspect this destination before retrying; do not copy an already imported file again.'};}
}
module.exports={MAX_BYTES,extension,importMedia};
