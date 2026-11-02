// visionOS spatial selection. CoreSimulator/SimulatorKit are loaded from Xcode.
// The Paloma collection wire layout is verified against Xcode 27 / visionOS 27;
// no Apple executable or library is redistributed. See platform-support.md.
#import <Foundation/Foundation.h>
#import <objc/message.h>
#import <dlfcn.h>
#import <sys/file.h>
#import <fcntl.h>
#import <unistd.h>
#import <xpc/xpc.h>
#import <simd/simd.h>
#import <mach/mach_time.h>
#import <math.h>
#import <signal.h>
#import <poll.h>
static volatile sig_atomic_t stopping=0;
static void interrupted(int sig){stopping=1;}
static void hold(double seconds){
 double until=NSProcessInfo.processInfo.systemUptime+seconds;
 while(!stopping){double left=until-NSProcessInfo.processInfo.systemUptime;if(left<=0)break;usleep((useconds_t)(fmin(left,0.01)*1000000));}
}
static BOOL sendEvent(id client, void *message) {
 if(!message)return NO;
 dispatch_semaphore_t done=dispatch_semaphore_create(0);
 __block BOOL ok=NO;
 void (^completion)(NSError *)=^(NSError *error){ok=(error==nil);dispatch_semaphore_signal(done);};
 ((void(*)(id,SEL,void*,BOOL,dispatch_queue_t,id))objc_msgSend)(client,NSSelectorFromString(@"sendWithMessage:freeWhenDone:completionQueue:completion:"),message,YES,dispatch_get_global_queue(QOS_CLASS_USER_INITIATED,0),completion);
 return dispatch_semaphore_wait(done,dispatch_time(DISPATCH_TIME_NOW,NSEC_PER_SEC))==0 && ok;
}

static BOOL scalar(const char *raw,double *out,double low,double high){
 NSScanner *s=[NSScanner scannerWithString:@(raw)];return [s scanDouble:out]&&s.isAtEnd&&isfinite(*out)&&*out>=low&&*out<=high;
}
static BOOL cameraPose(id device,simd_float4x4 *pose,const simd_float4x4 *desired){
 typedef xpc_endpoint_t(*Endpoint)(mach_port_t,uint64_t,uint64_t);typedef void(*Enable)(xpc_connection_t);
 Endpoint endpoint=(Endpoint)dlsym(RTLD_DEFAULT,"xpc_endpoint_create_mach_port_4sim");Enable enable=(Enable)dlsym(RTLD_DEFAULT,"xpc_connection_enable_sim2host_4sim");if(!endpoint||!enable)return NO;
 NSError *error=nil;mach_port_t port=((mach_port_t(*)(id,SEL,id,NSError**))objc_msgSend)(device,NSSelectorFromString(@"lookup:error:"),@"com.apple.vhmdd",&error);if(!port)return NO;
 xpc_endpoint_t ep=endpoint(port,0,0);if(!ep)return NO;
 xpc_connection_t c=xpc_connection_create_from_endpoint(ep);if(!c)return NO;enable(c);
 dispatch_queue_t q=dispatch_queue_create("cindy.spatial.camera",DISPATCH_QUEUE_SERIAL);
 xpc_connection_set_target_queue(c,q);xpc_connection_set_event_handler(c,^(xpc_object_t e){});xpc_connection_resume(c);
 if(desired){
  xpc_object_t update=xpc_dictionary_create(NULL,NULL,0);xpc_dictionary_set_string(update,"cmd","set_pose");
  xpc_dictionary_set_data(update,"pose",desired,sizeof(*desired));xpc_connection_send_message(c,update);
 }
 xpc_object_t request=xpc_dictionary_create(NULL,NULL,0);xpc_dictionary_set_string(request,"cmd","get_pose");
 dispatch_semaphore_t done=dispatch_semaphore_create(0);__block NSData *data=nil;
 xpc_connection_send_message_with_reply(c,request,q,^(xpc_object_t reply){
  if(xpc_get_type(reply)==XPC_TYPE_DICTIONARY){size_t size=0;const void *p=xpc_dictionary_get_data(reply,"pose",&size);if(p&&size==sizeof(simd_float4x4))data=[NSData dataWithBytes:p length:size];}
  dispatch_semaphore_signal(done);
 });
 BOOL ready=dispatch_semaphore_wait(done,dispatch_time(DISPATCH_TIME_NOW,3*NSEC_PER_SEC))==0;
 xpc_connection_cancel(c);if(!ready||!data)return NO;memcpy(pose,data.bytes,sizeof(*pose));
 for(int i=0;i<4;i++)for(int j=0;j<4;j++)if(!isfinite(pose->columns[i][j]))return NO;
 return fabsf(pose->columns[3].w-1)<0.001;
}
static void put32(unsigned char *p,size_t at,uint32_t n){memcpy(p+at,&n,4);}
static void putFloat(unsigned char *p,size_t at,float n){memcpy(p+at,&n,4);}
static void *cameraMessage(simd_float4x4 pose){
 unsigned char *m=calloc(1,192);if(!m)return NULL;
 put32(m,0x18,160);m[0x1c]=1;put32(m,0x20,1);uint64_t stamp=mach_absolute_time();memcpy(m+0x24,&stamp,8);put32(m,0x30,300);
 simd_float4 rotation=simd_quaternion(pose).vector;
 for(int i=0;i<3;i++)putFloat(m,0x54+i*4,pose.columns[3][i]);
 for(int i=0;i<4;i++)putFloat(m,0x64+i*4,rotation[i]);
 return m;
}
static void *selection(simd_float3 origin,simd_float3 direction,BOOL down){
 unsigned char *m=calloc(1,192);if(!m)return NULL;
 // Indigo event header followed by one Paloma manipulator collection.
 put32(m,0x18,160);m[0x1c]=1;put32(m,0x20,1);uint64_t stamp=mach_absolute_time();memcpy(m+0x24,&stamp,8);put32(m,0x30,302);
 // Left pinch + left contact; right hand stays released. These are paired
 // pinch/contact states per hand, not two independently pressed hands.
 put32(m,0x34,3);m[0x38]=down;m[0x39]=2;m[0x3a]=down;put32(m,0x3b,3);m[0x3f]=0;m[0x40]=1;m[0x41]=0;
 for(int i=0;i<3;i++){putFloat(m,0x47+i*4,origin[i]);putFloat(m,0x57+i*4,direction[i]);putFloat(m,0x67+i*4,origin[i]);putFloat(m,0x87+i*4,origin[i]);}
 // Identity hand quaternions; gaze ray supplies the selection location.
 putFloat(m,0x83,1);putFloat(m,0xa3,1);return m;
}
// All positions are absolute within one gesture. Coalescing intermediate samples
// therefore never loses displacement. No guest application code is injected.
enum {Interact,Tilt,Pan,Orbit,Dolly,Move,Reset,Gaze,TwoHands,Pointer};
static BOOL pointerEvent(id client,double dx,double dy,uint32_t buttons,uint32_t previous){
 typedef CFTypeRef(*Create)(CFAllocatorRef,uint64_t,double,double,double,uint32_t,uint32_t,uint32_t);
 typedef void*(*Wrap)(CFTypeRef,uint32_t);
 Create create=(Create)dlsym(RTLD_DEFAULT,"IOHIDEventCreateRelativePointerEvent");
 Wrap wrap=(Wrap)dlsym(RTLD_DEFAULT,"IndigoHIDMessageForPointerEventFromHIDEventRef");
 void(*append)(CFTypeRef,CFTypeRef,uint32_t)=dlsym(RTLD_DEFAULT,"IOHIDEventAppendEvent");
 if(!create||!wrap||!append)return NO;
 CFTypeRef event=create(NULL,mach_absolute_time(),dx,dy,0,buttons,previous,1);if(!event)return NO;
 // SimulatorKit requires a pointer collection even for an unaccelerated
 // relative event with no button transition (IOKit otherwise returns a leaf).
 CFArrayRef(*children)(CFTypeRef)=dlsym(RTLD_DEFAULT,"IOHIDEventGetChildren");
 if(!children){CFRelease(event);return NO;}
 if(!children(event)){
  CFTypeRef child=create(NULL,mach_absolute_time(),dx,dy,0,buttons,previous,1);
  if(!child){CFRelease(event);return NO;}append(event,child,0);CFRelease(child);
 }
 void *m=wrap(event,0x36);CFRelease(event);return sendEvent(client,m);
}
static simd_float3 ray(simd_float4x4 pose,double x,double y,double aspect){
 return simd_normalize(simd_mul(pose,(simd_float4){2*x-1,(1-2*y)/aspect,-1,0}).xyz);
}
static void *manipulator(simd_float4x4 pose,double sx,double sy,double x,double y,double z,double aspect,double spread,double angle,int mode,BOOL down){
 simd_float3 origin=pose.columns[3].xyz;
 simd_float3 direction=ray(pose,mode==Gaze?x:sx,mode==Gaze?y:sy,aspect);
 unsigned char *m=selection(origin,direction,down&&mode!=Gaze);if(!m)return NULL;
 simd_float4 delta={2*(x-sx),2*(sy-y)/aspect,z,0};
 simd_float3 center=origin+simd_mul(pose,delta).xyz;
 simd_float3 offset=simd_mul(pose,(simd_float4){spread*cos(angle),spread*sin(angle),0,0}).xyz;
 simd_float3 left=center-(mode==TwoHands?offset:0),right=center+offset;
 if(mode==TwoHands){m[0x3f]=down;m[0x41]=down;}
 for(int i=0;i<3;i++){putFloat(m,0x67+i*4,left[i]);putFloat(m,0x87+i*4,right[i]);}
 return m;
}
static simd_float4x4 movedCamera(simd_float4x4 start,int mode,double dx,double dy,double dz){
 if(mode==Reset)return matrix_identity_float4x4;
 simd_float4x4 result=start;
 if(mode==Tilt||mode==Orbit){
  simd_float4x4 rotation=simd_matrix4x4(simd_mul(simd_quaternion(-dx*(float)M_PI,(simd_float3){0,1,0}),simd_quaternion(-dy*(float)M_PI,(simd_float3){1,0,0})));
  result=simd_mul(start,rotation);
  if(mode==Orbit){
   simd_float3 pivot=start.columns[3].xyz-start.columns[2].xyz;
   result.columns[3].xyz=pivot+result.columns[2].xyz;result.columns[3].w=1;
  }
 }else{
  simd_float4 delta=mode==Pan?(simd_float4){-2*dx,2*dy,0,0}:mode==Dolly?(simd_float4){0,0,2*dy,0}:(simd_float4){dx,dy,dz,0};
  result.columns[3]=start.columns[3]+simd_mul(start,delta);
 }
 return result;
}
static int stream(id device,id client,int lock){
 signal(SIGPIPE,SIG_IGN);puts("ready");fflush(stdout);
 BOOL active=NO,ok=YES,pointerReady=NO;int mode=0,commands=0;double started=0,sx=0,sy=0,x=0,y=0,z=0,aspect=1,spread=.1,angle=0;
 simd_float4x4 pose=matrix_identity_float4x4;
 while(!stopping){
  if(active&&mode!=Pointer&&(commands>=2000||NSProcessInfo.processInfo.systemUptime-started>=20)){ok=NO;break;}
  char line[512];size_t n=0;BOOL complete=NO;
  while(n<sizeof(line)-1&&!stopping){
   struct pollfd fd={STDIN_FILENO,POLLIN,0};if(poll(&fd,1,active||n?750:-1)<=0)break;
   char c;if(read(STDIN_FILENO,&c,1)!=1)break;if(c=='\n'){complete=YES;break;}line[n++]=c;
  }
  if(!complete)break;line[n]=0;
  int phase=-1,nextMode=-1;double nx,ny,nz,na,ns,nr,yaw,pitch;char extra;
  if(sscanf(line,"%d %d %lf %lf %lf %lf %lf %lf %lf %lf %c",&phase,&nextMode,&nx,&ny,&nz,&na,&ns,&nr,&yaw,&pitch,&extra)!=10||phase<0||phase>2||nextMode<0||nextMode>Pointer){ok=NO;break;}
  double xyLimit=nextMode==Pointer?1e9:10;
  if(!isfinite(yaw)||!isfinite(pitch)||fabs(yaw)>20||fabs(pitch)>20||
    !isfinite(nx)||!isfinite(ny)||!isfinite(nz)||!isfinite(na)||!isfinite(ns)||!isfinite(nr)||fabs(nx)>xyLimit||fabs(ny)>xyLimit||fabs(nz)>10||na<.5||na>4||ns<0||ns>2||fabs(nr)>20||
    (nextMode==Pointer&&(nz<0||nz>3||floor(nz)!=nz))||(phase==0?active:(!active||mode!=nextMode))){ok=NO;break;}
  if(phase==0){
   if(flock(lock,LOCK_EX|LOCK_NB)!=0){ok=NO;break;}
   if(!cameraPose(device,&pose,NULL)){flock(lock,LOCK_UN);ok=NO;break;}
   mode=nextMode;sx=nx;sy=ny;active=YES;commands=0;started=NSProcessInfo.processInfo.systemUptime;
  }
  double previousX=x,previousY=y,previousButtons=z;
  x=nx;y=ny;z=nz;aspect=na;spread=ns;angle=nr;if(mode!=Pointer)commands++;
  if(mode==Pointer){
   if(!pointerReady){
    dlopen("/System/Library/Frameworks/IOKit.framework/IOKit",RTLD_NOW|RTLD_GLOBAL);
    void*(*createService)(void)=dlsym(RTLD_DEFAULT,"IndigoHIDMessageToCreateMouseService");
    ok=createService&&sendEvent(client,createService());pointerReady=ok;
   }
   if(ok)ok=pointerEvent(client,phase==0?0:(x-previousX)*1000,phase==0?0:(y-previousY)*1000,phase==2?0:(uint32_t)z,phase==0?0:(uint32_t)previousButtons);
  }else if(mode==Interact||mode==Gaze||mode==TwoHands){
   // Establish gaze before the first pinch, like Apple's simulator.
   if(phase==0){ok=sendEvent(client,manipulator(pose,sx,sy,x,y,z,aspect,spread,angle,mode,NO));if(mode!=Gaze)hold(.05);}
   if(phase==2&&mode!=Gaze)hold(fmax(0,.11-(NSProcessInfo.processInfo.systemUptime-started)));
   if(ok)ok=sendEvent(client,manipulator(pose,sx,sy,x,y,z,aspect,spread,angle,mode,phase!=2));
  }else if(phase!=0){
   simd_float4x4 desired=movedCamera(pose,mode,x-sx,y-sy,z),actual;
   if(mode==Move){
    simd_float4 translation=desired.columns[3];
    desired=simd_mul(pose,simd_matrix4x4(simd_mul(simd_quaternion((float)yaw,(simd_float3){0,1,0}),simd_quaternion((float)pitch,(simd_float3){1,0,0}))));
    desired.columns[3]=translation;
   }
   // The HID pose moves the rendered viewpoint; the service pose is the
   // shared camera state read by other simulator clients. Update both.
   ok=sendEvent(client,cameraMessage(desired))&&cameraPose(device,&actual,&desired);
   if(ok)for(int i=0;i<16;i++)if(fabsf(((float*)&actual)[i]-((float*)&desired)[i])>.002)ok=NO;
  }
  if(!ok)break;
  if(phase==2){active=NO;flock(lock,LOCK_UN);}
  puts("ok");fflush(stdout);
 }
 if(active&&(mode==Interact||mode==Gaze||mode==TwoHands))ok=sendEvent(client,manipulator(pose,sx,sy,x,y,z,aspect,spread,angle,mode,NO))&&ok;
 if(active&&mode==Pointer)ok=pointerEvent(client,0,0,0,(uint32_t)z)&&ok;
 if(pointerReady){void*(*removeService)(void)=dlsym(RTLD_DEFAULT,"IndigoHIDMessageToRemoveMouseService");if(removeService)ok=sendEvent(client,removeService())&&ok;}
 close(lock);return ok&&!stopping?0:5;
}
int main(int argc,const char **argv){@autoreleasepool{
 signal(SIGTERM,interrupted);signal(SIGINT,interrupted);
 // set, UDID, developer dir, normalized x/y, framebuffer aspect, hold, count
 if(argc!=9&&argc!=5&&argc!=4)return 2;double x=0,y=0,aspect=1,duration=0,count=0;
 if(argc==9&&(!scalar(argv[4],&x,0,1)||!scalar(argv[5],&y,0,1)||!scalar(argv[6],&aspect,0.5,4)||!scalar(argv[7],&duration,0.02,10)||!scalar(argv[8],&count,1,3)||floor(count)!=count))return 2;
 NSString *setPath=@(argv[1]),*udid=@(argv[2]),*dev=@(argv[3]);
 if(![[NSUUID alloc]initWithUUIDString:udid])return 2;
 int lock=open([[setPath stringByAppendingPathComponent:[NSString stringWithFormat:@".keyboard-%@.lock",udid]]fileSystemRepresentation],O_CREAT|O_RDWR,0600);
 if(lock<0||(argc!=4&&flock(lock,LOCK_EX|LOCK_NB)!=0))return 3;
 if(!dlopen("/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator",RTLD_NOW|RTLD_GLOBAL))return 4;
 void *kit=NULL;for(NSString *relative in @[@"Library/PrivateFrameworks/SimulatorKit.framework/SimulatorKit",@"../SharedFrameworks/SimulatorKit.framework/SimulatorKit"]){kit=dlopen([[dev stringByAppendingPathComponent:relative]fileSystemRepresentation],RTLD_NOW|RTLD_GLOBAL);if(kit)break;}if(!kit)return 4;
 NSError *error=nil;id context=((id(*)(id,SEL,id,NSError**))objc_msgSend)(NSClassFromString(@"SimServiceContext"),NSSelectorFromString(@"sharedServiceContextForDeveloperDir:error:"),dev,&error);if(!context)return 4;
 id set=((id(*)(id,SEL,id,NSError**))objc_msgSend)(context,NSSelectorFromString(@"deviceSetWithPath:error:"),setPath,&error);if(!set)return 4;
 id device=nil;for(id d in [set valueForKey:@"availableDevices"])if([[[d valueForKey:@"UDID"]UUIDString]caseInsensitiveCompare:udid]==NSOrderedSame){device=d;break;}
 if(!device||[[device valueForKey:@"state"]intValue]!=3)return 4;
 simd_float4x4 pose;if(!cameraPose(device,&pose,NULL)){fprintf(stderr,"Vision Pro camera pose unavailable\n");return 4;}
 if(argc==5){
  if(strcmp(argv[4],"pose"))return 2;
  printf("[");for(int i=0;i<16;i++)printf("%s%.6f",i?",":"",((float*)&pose)[i]);puts("]");return 0;
 }
 id cls=NSClassFromString(@"_TtC12SimulatorKit24SimDeviceLegacyHIDClient");if(!cls)return 4;
 id client=((id(*)(id,SEL,id,NSError**))objc_msgSend)([cls alloc],NSSelectorFromString(@"initWithDevice:error:"),device,&error);if(!client)return 4;
 if(argc==4)return stream(device,client,lock);
 // The simulator's rectangular camera has a 90-degree horizontal field of
 // view. Convert image coordinates to a camera ray, then to current world pose.
 simd_float4 o=simd_mul(pose,(simd_float4){0,0,0,1});
 simd_float4 d=simd_mul(pose,(simd_float4){(float)(2*x-1),(float)((1-2*y)/aspect),-1,0});
 if(!isfinite(simd_length(d.xyz))||simd_length(d.xyz)<0.0001)return 4;
 simd_float3 origin=o.xyz,direction=simd_normalize(d.xyz);
 if(stopping)return 5;
 if(!sendEvent(client,selection(origin,direction,NO)))return 5;
 usleep(100000);
 for(int i=0;i<(int)count;i++){
  if(stopping)break;
  BOOL pressed=sendEvent(client,selection(origin,direction,YES));
  if(pressed)hold(duration);
  BOOL released=sendEvent(client,selection(origin,direction,NO));
  if(!pressed||!released){fprintf(stderr,"Spatial selection delivery not confirmed\n");return 5;}
  usleep(150000);
 }
 close(lock);return stopping?5:0;
}}
