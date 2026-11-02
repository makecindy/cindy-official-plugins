#import <Foundation/Foundation.h>
#import <objc/message.h>
#import <dlfcn.h>
#import <sys/file.h>
#import <fcntl.h>
#import <unistd.h>
#import <xpc/xpc.h>
#import <math.h>
#import <signal.h>
static volatile sig_atomic_t stopping=0;
static void interrupted(int sig){stopping=1;}
static void waitHold(double seconds){
 double until=NSProcessInfo.processInfo.systemUptime+seconds;
 while(!stopping){double left=until-NSProcessInfo.processInfo.systemUptime;if(left<=0)break;usleep((useconds_t)(fmin(left,0.01)*1000000));}
}
// DTUHID wire protocol reference: facebook/idb 1de1629a (MIT).
// Only fixed keyboard/button messages are accepted; no network or guest code injection.
static const char *service="com.apple.coredevice.feature.remote.hid.digitizer";
static xpc_object_t value(id v){
 if([v isKindOfClass:NSDictionary.class]){xpc_object_t o=xpc_dictionary_create(NULL,NULL,0);for(NSString *k in v)xpc_dictionary_set_value(o,k.UTF8String,value(v[k]));return o;}
 if([v isKindOfClass:NSString.class])return xpc_string_create([v UTF8String]);
 if([v isKindOfClass:NSNumber.class]){if(strcmp([v objCType],@encode(double))==0)return xpc_double_create([v doubleValue]);return xpc_uint64_create([v unsignedLongLongValue]);}return xpc_null_create();
}
static xpc_object_t message(NSString *type,NSDictionary *payload,BOOL barrier){
 xpc_object_t m=xpc_dictionary_create(NULL,NULL,0);xpc_dictionary_set_string(m,"messageType",type.UTF8String);xpc_dictionary_set_string(m,"featureIdentifier",service);xpc_dictionary_set_bool(m,"isBarrier",barrier);xpc_dictionary_set_value(m,"payload",value(payload));return m;
}
int main(int argc,const char **argv){@autoreleasepool{
 signal(SIGTERM,interrupted);signal(SIGINT,interrupted);
 if(argc!=8)return 2;
 NSString *kind=@(argv[4]);int key=0;
 NSScanner *scanner=[NSScanner scannerWithString:@(argv[5])];
 BOOL batch=[kind isEqual:@"keys"];
 NSArray *keys=nil;
 if(batch){
  keys=[NSJSONSerialization JSONObjectWithData:[@(argv[5]) dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
  if(![keys isKindOfClass:NSArray.class]||keys.count<1||keys.count>300)return 2;
  for(id pair in keys){if(![pair isKindOfClass:NSArray.class]||[pair count]!=2)return 2;
   for(id n in pair)if(![n isKindOfClass:NSNumber.class]||!isfinite([n doubleValue])||[n doubleValue]!=[n intValue])return 2;
   if([pair[0] intValue]<4||[pair[0] intValue]>103||[pair[1] intValue]<0||[pair[1] intValue]>15)return 2;
  }
 }else if(![scanner scanInt:&key]||!scanner.isAtEnd||key<0||key>255||![@[@"key",@"button"] containsObject:kind])return 2;

 int mask=0;double duration=0;
 NSScanner *mods=[NSScanner scannerWithString:@(argv[6])],*hold=[NSScanner scannerWithString:@(argv[7])];
 if(![mods scanInt:&mask]||!mods.isAtEnd||mask<0||mask>15||![hold scanDouble:&duration]||!hold.isAtEnd||!isfinite(duration)||duration<0||duration>10)return 2;
 if(([kind isEqual:@"button"]||batch)&&mask)return 2;
 NSString *setPath=@(argv[1]),*udid=@(argv[2]),*dev=@(argv[3]);
 if(![[NSUUID alloc]initWithUUIDString:udid])return 2;
 int lock=open([[setPath stringByAppendingPathComponent:[NSString stringWithFormat:@".keyboard-%@.lock",udid]]fileSystemRepresentation],O_CREAT|O_RDWR,0600);
 if(lock<0||flock(lock,LOCK_EX|LOCK_NB)!=0)return 3;
 if(!dlopen("/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator",RTLD_NOW|RTLD_GLOBAL))return 4;
 void *kit=NULL;for(NSString *relative in @[@"Library/PrivateFrameworks/SimulatorKit.framework/SimulatorKit",@"../SharedFrameworks/SimulatorKit.framework/SimulatorKit"]){kit=dlopen([[dev stringByAppendingPathComponent:relative]fileSystemRepresentation],RTLD_NOW|RTLD_GLOBAL);if(kit)break;}if(!kit)return 4;
 NSError *error=nil;id context=((id(*)(id,SEL,id,NSError**))objc_msgSend)(NSClassFromString(@"SimServiceContext"),NSSelectorFromString(@"sharedServiceContextForDeveloperDir:error:"),dev,&error);
 if(!context)return 4;
 id set=((id(*)(id,SEL,id,NSError**))objc_msgSend)(context,NSSelectorFromString(@"deviceSetWithPath:error:"),setPath,&error);if(!set)return 4;
 id device=nil;for(id d in [set valueForKey:@"availableDevices"])if([[[d valueForKey:@"UDID"]UUIDString]caseInsensitiveCompare:udid]==NSOrderedSame){device=d;break;}
 if(!device||[[device valueForKey:@"state"]intValue]!=3)return 4;

 typedef xpc_endpoint_t (*Endpoint)(mach_port_t,uint64_t,uint64_t);
 typedef void(*Enable)(xpc_connection_t);
 Endpoint endpoint=(Endpoint)dlsym(RTLD_DEFAULT,"xpc_endpoint_create_mach_port_4sim");Enable enable=(Enable)dlsym(RTLD_DEFAULT,"xpc_connection_enable_sim2host_4sim");if(!endpoint||!enable)return 4;
 mach_port_t port=((mach_port_t(*)(id,SEL,id,NSError**))objc_msgSend)(device,NSSelectorFromString(@"lookup:error:"),@(service),&error);if(!port){fprintf(stderr,"lookup %s\n",error.description.UTF8String);return 4;}
 xpc_endpoint_t ep=endpoint(port,0,0);if(!ep)return 4;xpc_connection_t connection=xpc_connection_create_from_endpoint(ep);if(!connection)return 4;enable(connection);
 dispatch_queue_t q=dispatch_queue_create("cindy.platform-input",DISPATCH_QUEUE_SERIAL);xpc_connection_set_target_queue(connection,q);xpc_connection_set_event_handler(connection,^(xpc_object_t e){});xpc_connection_resume(connection);
 dispatch_semaphore_t done=dispatch_semaphore_create(0);__block BOOL ready=NO;
 xpc_connection_send_message_with_reply(connection,message(@"IndigoKeyboardButtonEvent",@{@"usageCode":@0,@"state":@2},YES),q,^(xpc_object_t r){ready=xpc_get_type(r)!=XPC_TYPE_ERROR;dispatch_semaphore_signal(done);});
 if(dispatch_semaphore_wait(done,dispatch_time(DISPATCH_TIME_NOW,4*NSEC_PER_SEC))!=0||!ready){fprintf(stderr,"no live input service\n");return 4;}usleep(200000);
 BOOL keyboard=batch||[kind isEqual:@"key"];
 void (^keyEvent)(int,int)=^(int code,int state){xpc_connection_send_message(connection,message(@"IndigoKeyboardButtonEvent",@{@"usageCode":@(code),@"state":@(state)},NO));};
 if(keyboard){for(int code=4;code<=231;code++)keyEvent(code,2);}
 for(NSArray *pair in (batch?keys:@[@[@(key),@(mask)]])){
  if(stopping)break;
  int key=[pair[0] intValue],mask=[pair[1] intValue];
  if(!key)continue;
  if(keyboard)for(int i=0;i<4;i++)if(mask&(1<<i))keyEvent(224+i,1);
  for(int state=1;state<=2;state++){
   if(keyboard)keyEvent(key,state);
   else xpc_connection_send_message(connection,message(@"IndigoButtonEvent",@{@"usagePage":@12,@"usageCode":@(key),@"state":@(state)},NO));
   if(state==1)waitHold(fmax(duration,0.08));
  }
  if(keyboard)for(int i=3;i>=0;i--)keyEvent(224+i,2);
 }
 // A guest reply, not just a local send barrier, confirms the final release.
 dispatch_semaphore_t sent=dispatch_semaphore_create(0);__block BOOL delivered=NO;
 xpc_connection_send_message_with_reply(connection,message(@"IndigoKeyboardButtonEvent",@{@"usageCode":@0,@"state":@2},YES),q,^(xpc_object_t reply){delivered=xpc_get_type(reply)!=XPC_TYPE_ERROR;dispatch_semaphore_signal(sent);});
 long result=dispatch_semaphore_wait(sent,dispatch_time(DISPATCH_TIME_NOW,3*NSEC_PER_SEC));
 usleep(200000);xpc_connection_cancel(connection);close(lock);return result||!delivered||stopping?5:0;
}}
