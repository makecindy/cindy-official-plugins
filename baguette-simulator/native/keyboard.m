// SimulatorKit HID adapter. Protocol and loading based on Baguette v0.1.98
// (Apache-2.0). Unlike its fire-and-forget CLI, wait for every delivery.
#import <Foundation/Foundation.h>
#import <objc/message.h>
#import <dlfcn.h>
#import <sys/file.h>
#import <fcntl.h>
#import <unistd.h>
typedef void *(*HID)(uint32_t,uint32_t,uint32_t,uint32_t);
static BOOL sendEvent(id client, void *message) {
 if(!message)return NO;
 dispatch_semaphore_t done=dispatch_semaphore_create(0);
 __block BOOL ok=NO;
 void (^completion)(NSError *)=^(NSError *error){ok=(error==nil);dispatch_semaphore_signal(done);};
 ((void(*)(id,SEL,void*,BOOL,dispatch_queue_t,id))objc_msgSend)(client,NSSelectorFromString(@"sendWithMessage:freeWhenDone:completionQueue:completion:"),message,YES,dispatch_get_global_queue(QOS_CLASS_USER_INITIATED,0),completion);
 return dispatch_semaphore_wait(done,dispatch_time(DISPATCH_TIME_NOW,NSEC_PER_SEC))==0 && ok;
}
static BOOL releaseKeys(id client,HID hid){BOOL ok=YES;for(uint32_t key=4;key<=231;key++)if(!sendEvent(client,hid(0x32,7,key,2)))ok=NO;return ok;}
int main(int argc,const char **argv){@autoreleasepool{
 if(argc!=6)return 2; // device set, UDID, developer dir, HID usage (0=release), modifier bitmask
 NSString *setPath=@(argv[1]),*udid=@(argv[2]),*dev=@(argv[3]);int key=atoi(argv[4]),mask=atoi(argv[5]);
 if(key<0||key>103||mask<0||mask>15||![[NSUUID alloc]initWithUUIDString:udid])return 2;
 int lock=open([[setPath stringByAppendingPathComponent:[NSString stringWithFormat:@".keyboard-%@.lock",udid]]fileSystemRepresentation],O_CREAT|O_RDWR,0600);
 if(lock<0||flock(lock,LOCK_EX|LOCK_NB)!=0)return 3;
 if(!dlopen("/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator",RTLD_NOW|RTLD_GLOBAL))return 4;
 void *kit=NULL;for(NSString *relative in @[@"Library/PrivateFrameworks/SimulatorKit.framework/SimulatorKit",@"../SharedFrameworks/SimulatorKit.framework/SimulatorKit"]){kit=dlopen([[dev stringByAppendingPathComponent:relative]fileSystemRepresentation],RTLD_NOW|RTLD_GLOBAL);if(kit)break;}if(!kit)return 4;
 NSError *error=nil;id context=((id(*)(id,SEL,id,NSError**))objc_msgSend)(NSClassFromString(@"SimServiceContext"),NSSelectorFromString(@"sharedServiceContextForDeveloperDir:error:"),dev,&error);
 if(!context)return 4;
 id set=((id(*)(id,SEL,id,NSError**))objc_msgSend)(context,NSSelectorFromString(@"deviceSetWithPath:error:"),setPath,&error);if(!set)return 4;
 id device=nil;for(id d in [set valueForKey:@"availableDevices"])if([[[d valueForKey:@"UDID"]UUIDString]caseInsensitiveCompare:udid]==NSOrderedSame){device=d;break;}
 if(!device||[[device valueForKey:@"state"]intValue]!=3)return 4;
 id cls=NSClassFromString(@"_TtC12SimulatorKit24SimDeviceLegacyHIDClient");if(!cls)return 4;
 id client=((id(*)(id,SEL,id,NSError**))objc_msgSend)([cls alloc],NSSelectorFromString(@"initWithDevice:error:"),device,&error);
 HID hid=(HID)dlsym(kit,"IndigoHIDMessageForHIDArbitrary");if(!client||!hid)return 4;
 BOOL ok=YES;
 // Release existing latched keys before any new chord. No key-down during recovery.
 if(!releaseKeys(client,hid))return 5;
 if(key){
  for(int i=0;i<4;i++)if(mask&(1<<i))if(!sendEvent(client,hid(0x32,7,224+i,1)))ok=NO;
  if(ok)ok=sendEvent(client,hid(0x32,7,key,1));
  usleep(20000);
  // Always attempt the full release, including on partial failure.
  if(!sendEvent(client,hid(0x32,7,key,2)))ok=NO;
  for(int i=3;i>=0;i--)if(!sendEvent(client,hid(0x32,7,224+i,2)))ok=NO;
 }
 if(!ok)releaseKeys(client,hid);
 close(lock);return ok?0:5;
}}
