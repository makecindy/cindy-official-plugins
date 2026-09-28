const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
test('native release submits all usages before one shared timeout, including absent and late callbacks',{skip:process.platform!=='darwin'},()=>{
 const source=fs.readFileSync('baguette-simulator/native/keyboard.m','utf8');
 const production=source.slice(0,source.indexOf('\nint main('));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'baguette-release-'));
 try{
  const harness=production+`
#include <assert.h>
static void *hid(uint32_t type,uint32_t page,uint32_t key,uint32_t state){assert(type==0x32 && page==7 && state==2);return (void *)(uintptr_t)key;}
@interface FakeClient : NSObject
@property int count;
@property int failKey;
@property int mode;
@end
@implementation FakeClient
-(void)sendWithMessage:(void *)message freeWhenDone:(BOOL)freeMessage completionQueue:(dispatch_queue_t)queue completion:(void (^)(NSError *))completion {
 int key=(int)(uintptr_t)message;assert(key==4+self.count);self.count++;
 if(self.mode==1)return;
 NSError *error=(self.failKey==-1||key==self.failKey)?[NSError errorWithDomain:@"fixture" code:1 userInfo:nil]:nil;
 if(self.mode==2)dispatch_after(dispatch_time(DISPATCH_TIME_NOW,1500*NSEC_PER_MSEC),queue,^{completion(error);});
 else dispatch_async(queue,^{completion(error);});
}
@end
int main(void){@autoreleasepool{
 int cases[]={4,100,231,-1,0};
 for(int i=0;i<5;i++){FakeClient *c=[FakeClient new];c.failKey=cases[i];assert(releaseKeys(c,hid)==(cases[i]==0));assert(c.count==228);}
 for(int mode=1;mode<=2;mode++){
  FakeClient *c=[FakeClient new];c.mode=mode;double start=NSProcessInfo.processInfo.systemUptime;
  assert(!releaseKeys(c,hid));assert(c.count==228);
  double elapsed=NSProcessInfo.processInfo.systemUptime-start;
  assert(elapsed>=0.9 && elapsed<3.0);
 }
 usleep(700000); // late callbacks after timeout remain safe
 return 0;
}}
`;
  fs.writeFileSync(path.join(dir,'test.m'),harness);
  execFileSync('xcrun',['clang','-fobjc-arc','-fblocks','-framework','Foundation',path.join(dir,'test.m'),'-o',path.join(dir,'test')]);
  execFileSync(path.join(dir,'test'),[],{timeout:10000});
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
