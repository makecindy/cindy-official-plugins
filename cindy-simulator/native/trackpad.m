// Siri Remote trackpad Indigo protocol; facebook/idb 1de1629a (MIT).
// Bounded stdin gesture stream, owned device set only. See platform-support.md.
#import <Foundation/Foundation.h>
#import <objc/message.h>
#import <dlfcn.h>
#import <sys/file.h>
#import <fcntl.h>
#import <unistd.h>
#import <xpc/xpc.h>
#import <signal.h>
#import <poll.h>
#import <errno.h>
#import <malloc/malloc.h>
#import <mach/mach_time.h>
#import <math.h>
static volatile sig_atomic_t stopping=0;
static void interrupted(int sig){stopping=1;}
static BOOL sendEvent(id client, void *message) {
 if(!message)return NO;
 dispatch_semaphore_t done=dispatch_semaphore_create(0);
 __block BOOL ok=NO;
 void (^completion)(NSError *)=^(NSError *error){ok=(error==nil);dispatch_semaphore_signal(done);};
 ((void(*)(id,SEL,void*,BOOL,dispatch_queue_t,id))objc_msgSend)(client,NSSelectorFromString(@"sendWithMessage:freeWhenDone:completionQueue:completion:"),message,YES,dispatch_get_global_queue(QOS_CLASS_USER_INITIATED,0),completion);
 return dispatch_semaphore_wait(done,dispatch_time(DISPATCH_TIME_NOW,NSEC_PER_SEC))==0 && ok;
}


static void put32(unsigned char *p,size_t at,uint32_t n){memcpy(p+at,&n,4);}
typedef void *(*Builder)(CGPoint,uint32_t);
static void *event(Builder build,double x,double y,int phase){
 unsigned char *m=build(CGPointMake(x,y),0x16);if(!m)return NULL;
 if(malloc_size(m)<0x110){free(m);return NULL;}
 if(phase==0){put32(m,0x38,0x23);put32(m,0xd8,3);}
 if(phase==2){put32(m,0x38,0x21);put32(m,0x64,0);put32(m,0x68,0);put32(m,0xd8,1);put32(m,0x104,0);put32(m,0x108,0);}
 return m;
}
int main(int argc,const char **argv){@autoreleasepool{
 if(argc!=4)return 2;
 double x=.5,y=.5;
 NSString *setPath=@(argv[1]),*udid=@(argv[2]),*dev=@(argv[3]);
 if(![[NSUUID alloc]initWithUUIDString:udid])return 2;
 int lock=open([[setPath stringByAppendingPathComponent:[NSString stringWithFormat:@".keyboard-%@.lock",udid]]fileSystemRepresentation],O_CREAT|O_RDWR,0600);
 if(lock<0)return 3;
 if(!dlopen("/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator",RTLD_NOW|RTLD_GLOBAL))return 4;
 void *kit=NULL;for(NSString *relative in @[@"Library/PrivateFrameworks/SimulatorKit.framework/SimulatorKit",@"../SharedFrameworks/SimulatorKit.framework/SimulatorKit"]){kit=dlopen([[dev stringByAppendingPathComponent:relative]fileSystemRepresentation],RTLD_NOW|RTLD_GLOBAL);if(kit)break;}if(!kit)return 4;
 NSError *error=nil;id context=((id(*)(id,SEL,id,NSError**))objc_msgSend)(NSClassFromString(@"SimServiceContext"),NSSelectorFromString(@"sharedServiceContextForDeveloperDir:error:"),dev,&error);if(!context)return 4;
 id set=((id(*)(id,SEL,id,NSError**))objc_msgSend)(context,NSSelectorFromString(@"deviceSetWithPath:error:"),setPath,&error);if(!set)return 4;
 id device=nil;for(id d in [set valueForKey:@"availableDevices"])if([[[d valueForKey:@"UDID"]UUIDString]caseInsensitiveCompare:udid]==NSOrderedSame){device=d;break;}
 if(!device||[[device valueForKey:@"state"]intValue]!=3)return 4;
 id cls=NSClassFromString(@"_TtC12SimulatorKit24SimDeviceLegacyHIDClient");if(!cls)return 4;
 id client=((id(*)(id,SEL,id,NSError**))objc_msgSend)([cls alloc],NSSelectorFromString(@"initWithDevice:error:"),device,&error);if(!client)return 4;

 Builder build=(Builder)dlsym(kit,"IndigoHIDMessageForTrackpadMoveEvent");if(!build)return 4;
 // The viewer owns this connection through stdin. Only an active contact holds
 // the input lock; idle connections inject nothing and block on the pipe.
 signal(SIGTERM,interrupted);signal(SIGINT,interrupted);signal(SIGPIPE,SIG_IGN);
 puts("ready");fflush(stdout);
 BOOL active=NO,ok=YES;int commands=0;double started=0;
 while(!stopping){
  if(active&&(commands>=2000||NSProcessInfo.processInfo.systemUptime-started>=20))break;
  char line[128];size_t n=0;BOOL complete=NO;
  while(n<sizeof(line)-1&&!stopping){
   struct pollfd fd={STDIN_FILENO,POLLIN,0};int ready=poll(&fd,1,active||n?750:-1);
   if(ready<=0)break;
   char c;ssize_t count=read(STDIN_FILENO,&c,1);if(count!=1)break;
   if(c=='\n'){complete=YES;break;}line[n++]=c;
  }
  if(!complete)break;line[n]=0;
  int phase=-1;double nextX=0,nextY=0;char extra;
  if(sscanf(line,"%d %lf %lf %c",&phase,&nextX,&nextY,&extra)!=3 || phase<0||phase>2 || !isfinite(nextX)||!isfinite(nextY)||nextX<0||nextX>1||nextY<0||nextY>1 || (phase==0?active:!active)){ok=NO;break;}
  x=nextX;y=nextY;commands++;
  // Mark began active before sending so a failed acknowledgement still lifts it.
  if(phase==0){
   if(flock(lock,LOCK_EX|LOCK_NB)!=0){ok=NO;break;}
   active=YES;commands=1;started=NSProcessInfo.processInfo.systemUptime;
  }
  ok=sendEvent(client,event(build,x,y,phase));
  if(!ok)break;
  if(phase==2){active=NO;flock(lock,LOCK_UN);}
  puts("ok");fflush(stdout);
 }
 if(active)ok=sendEvent(client,event(build,x,y,2))&&ok;
 close(lock);return ok?0:5;
}}
