const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
test('native release attempts every HID usage even when first or intermediate deliveries fail',()=>{
 const source=fs.readFileSync('baguette-simulator/native/keyboard.m','utf8');
 const release=source.slice(source.indexOf('static BOOL releaseKeys('),source.indexOf('\nint main('));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'baguette-release-'));
 try{
  const harness=`#include <stdint.h>\n#include <assert.h>\ntypedef int BOOL;\n#define YES 1\n#define NO 0\ntypedef void *id;\ntypedef void *(*HID)(uint32_t,uint32_t,uint32_t,uint32_t);\nstatic int count,failKey;\nstatic void *hid(uint32_t type,uint32_t page,uint32_t key,uint32_t state){assert(type==0x32 && page==7 && state==2);return (void *)(uintptr_t)key;}\nstatic BOOL sendEvent(id client,void *message){int key=(int)(uintptr_t)message;assert(key==4+count);count++;return failKey==-1?NO:key!=failKey;}\n${release}\nint main(void){int cases[]={4,100,231,-1,0};for(int i=0;i<5;i++){count=0;failKey=cases[i];assert(releaseKeys(0,hid)==(failKey==0));assert(count==228);}return 0;}\n`;
  fs.writeFileSync(path.join(dir,'test.c'),harness);execFileSync('cc',['-Wall','-Werror',path.join(dir,'test.c'),'-o',path.join(dir,'test')]);execFileSync(path.join(dir,'test'));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
