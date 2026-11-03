'use strict';
// Live frames for the Android viewer.
//
// H.264: the emulator writes native-resolution RGB888 into a private shared
// file (gRPC MMAP transport, so gRPC carries only "frame ready"), and
// native/android-encoder encodes it with VideoToolbox into Baguette's AVCC
// envelope. Each message to the page is [u32 length][display rotation]
// [device rotation][envelope]. At most one frame is in flight; a newer frame
// replaces any frame waiting for the encoder. After the screen goes quiet the
// last picture is re-sent once as a keyframe, then nothing is sent.
//
// PNG remains for pages without WebCodecs and Macs without the helper, with
// the same framing around each PNG. Live Screen passes its own sink with the
// same frames and pose (live-screen.cjs).
//
// Neither path runs adb per frame: display rotation (an activity may lock it)
// is polled about once a second; the device pose comes with each frame.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const {rpc}=require('./grpc.cjs');
const ENCODER=path.join(__dirname,'../../native/android-encoder');
const SETTLE_MS=150,ROTATION_MS=1000,MAX_BUFFERED=4*1024*1024;
// One failure reconnects with H.264 again; a second within a minute switches
// new streams to PNG until the failures age out.
let failures=[];
const encoderFailed=()=>{failures=[...failures.filter(at=>Date.now()-at<60000),Date.now()];};
const healthy=()=>failures.filter(at=>Date.now()-at<60000).length<2;
const encoderAvailable=()=>healthy()&&process.platform==='darwin'&&process.arch==='arm64'&&fs.existsSync(ENCODER);

// Keep display rotation current without blocking frames on adb.
function rotations({d,agent,signal}){
  let display=null,timer=null;
  const state={onChange:null,get display(){return display;}};
  const poll=async()=>{
    try{
      const next=await agent.displayRotation(d,{_deadline:Date.now()+5000});
      // The first known value also counts: frames sent before a failed first
      // poll carried a default of 0.
      const changed=next!==display;display=next;
      // A still screen sends no frames, so a turn must be pushed to the page.
      if(changed)state.onChange?.();
    }catch{/* Keep the last known value. */}
    if(!signal.aborted)timer=setTimeout(poll,ROTATION_MS);
  };
  signal.addEventListener('abort',()=>clearTimeout(timer),{once:true});
  state.ready=poll();
  return state;
}

// The viewer page's framing around each payload.
function poseSink(res){
  return {begin:type=>res.writeHead(200,{'Content-Type':type}),frame:(pose,payload)=>{
    const head=Buffer.alloc(6);head.writeUInt32BE(payload.length+2);head[4]=pose.display;head[5]=pose.device;res.write(head);res.write(payload);
  }};
}

async function streamPng({d,res,signal,rotation,sink,control}){
  // A requested rate (Live Screen) spaces pictures; the newest one waits its
  // turn, so a screen that goes still shows its last picture. Installed before
  // begin, which applies a rate asked for before the stream was fetched.
  let gap=0,sentAt=0,held=null,timer=null;
  if(control)control.fps=fps=>{gap=1000/fps;};
  sink.begin('application/octet-stream');
  const emit=image=>{
    sentAt=Date.now();
    sink.frame({display:rotation.display??0,device:image.format.rotation?.rotation||0,png:true},image.image);
  };
  try{
    await rpc(d.endpoint,'streamScreenshot',{format:0,width:720,height:1600},{unbounded:true,signal,onData:image=>{
      if(!image.image.length||res.destroyed||res.writableLength>2e6)return;
      const wait=sentAt+gap-Date.now();
      if(wait<=0){held=null;return emit(image);}
      held=image;
      if(!timer)timer=setTimeout(()=>{
        timer=null;const next=held;held=null;
        if(next&&!signal.aborted&&!res.destroyed)emit(next);
      },wait);
    }});
  }finally{clearTimeout(timer);timer=null;held=null;}
}

async function streamAvcc({d,res,signal,rotation,sink,control,spawnEncoder=spawn}){
  const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'cindy-android-frames-')),file=path.join(dir,'screen.raw');
  // Emulator 37.1.11 writes pixels to the file only for an explicit size; a
  // square box of the longer edge keeps both orientations at native
  // resolution. The file covers the whole box so no write can pass its end.
  const box=Math.max(d.model.width,d.model.height),bytes=box*box*4;
  const encoder=spawnEncoder(ENCODER,[],{stdio:['pipe','pipe','ignore']});
  let latest=null,inflight=null,waiting=false,forceKey=true,lastKey=false,settle=null,output=Buffer.alloc(0),description=null,failed=null,gap=0,started=0,pacing=null;
  const stop=()=>{clearTimeout(settle);clearTimeout(pacing);encoder.stdin.end();};
  signal.addEventListener('abort',stop,{once:true});
  // A helper that keeps running but cannot encode (for example no hardware
  // session) counts as a failure, like one that exits.
  let skips=0,breakOut;const broken=new Promise((_,reject)=>{breakOut=reject;});broken.catch(()=>{});
  const fail=error=>{if(failed||signal.aborted)return;encoderFailed();failed=error;stop();breakOut(error);};
  try{
    const handle=await fsp.open(file,'wx',0o600);try{await handle.truncate(bytes);}finally{await handle.close();}
    encoder.once('exit',(code,sig)=>fail(Error(`Android encoder stopped (${code??sig})`)));encoder.once('error',fail);
    encoder.stdin.on('error',()=>{});
    const command=line=>{if(!encoder.stdin.destroyed)encoder.stdin.write(line+'\n');};
    const send=()=>{
      if(inflight||!latest||signal.aborted)return;
      if(res.writableLength>MAX_BUFFERED){
        // Encoded deltas cannot be dropped; skip encoding and restart from a keyframe.
        forceKey=true;if(!waiting){waiting=true;res.once('drain',()=>{waiting=false;send();});}return;
      }
      // A requested rate (Live Screen) spaces encodes; the newest frame waits.
      const wait=started+gap-Date.now();
      if(wait>0){if(!pacing)pacing=setTimeout(()=>{pacing=null;send();},wait);return;}
      clearTimeout(settle);started=Date.now();
      inflight={...latest,key:forceKey};forceKey=false;latest.fresh=false;
      command(`frame ${inflight.width} ${inflight.height} ${inflight.key?1:0}`);
    };
    const result=(type,payload)=>{
      const frame=inflight;inflight=null;if(!frame)return;
      skips=type===2||type===3?0:skips+1;
      if(skips>=10)return fail(Error('Android encoder cannot encode frames'));
      if(type===2||type===3){
        lastKey=type===2;
        const parts=type===2&&description?[description,payload]:[payload];
        for(const part of parts)sink.frame(frame,part);
      }
      if(latest?.fresh)return send();
      // Quiet screen: make the last picture exact once, then stay silent.
      if(!lastKey&&latest){settle=setTimeout(()=>{forceKey=true;send();},SETTLE_MS);}
    };
    encoder.stdout.on('data',chunk=>{
      output=Buffer.concat([output,chunk]);
      while(output.length>=4){
        const length=output.readUInt32BE(0);if(output.length<4+length)break;
        const message=output.subarray(4,4+length);output=output.subarray(4+length);
        // Keep the type byte: the page feeds Baguette's envelope as is.
        if(message[0]===1)description=Buffer.from(message);else result(message[0],Buffer.from(message));
      }
    });
    rotation.onChange=()=>{if(!latest)return;latest.display=rotation.display;latest.fresh=true;forceKey=true;send();};
    if(control){
      control.keyframe=()=>{forceKey=true;if(latest){latest.fresh=true;send();}};
      control.fps=fps=>{gap=1000/fps;};
    }
    command(`open ${bytes} ${file}`);
    await rotation.ready;
    sink.begin('application/x-cindy-android-avcc');
    const frames=rpc(d.endpoint,'streamScreenshot',{format:2,width:box,height:box,transport:{channel:1,handle:'file://'+file}},{unbounded:true,signal,onData:image=>{
      const width=image.format.width||image.width,height=image.format.height||image.height;
      if(!width||!height||width*height*3>bytes||res.destroyed)return;
      latest={width,height,display:rotation.display??0,device:image.format.rotation?.rotation||0,fresh:true};send();
    }});
    await Promise.race([frames,broken]);
  }finally{
    stop();
    await fsp.rm(dir,{recursive:true,force:true});
  }
}

// Serve one viewer connection until it closes or the emulator stream ends.
async function serve({d,agent,res,signal,format,spawnEncoder,sink=poseSink(res),control}){
  const rotation=rotations({d,agent,signal});
  // Tests inject the encoder process; the platform check is for the shipped binary.
  if(format==='avcc'&&(spawnEncoder?healthy():encoderAvailable()))return streamAvcc({d,res,signal,rotation,sink,control,spawnEncoder});
  await rotation.ready;return streamPng({d,res,signal,rotation,sink,control});
}
// Tests start each case with a clean failure history.
const resetFailures=()=>{failures=[];};
module.exports={serve,encoderAvailable,resetFailures,ENCODER};
