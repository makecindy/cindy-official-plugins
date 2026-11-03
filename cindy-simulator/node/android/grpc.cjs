'use strict';
const http2 = require('node:http2');
const {protobuf} = require('../../vendor/android/deps.cjs');
const {commandBudget} = require('../budget.cjs');
// Wire-compatible subset of Android Emulator's Apache-2.0
// android.emulation.control.EmulatorController protocol. Field numbers come
// from emulator/lib/emulator_controller.proto, shipped with Emulator 37.1.11.
const schema = protobuf.parse(`syntax = "proto3";
message Empty {}
message ClipData { string text = 1; }
message Touch { int32 x=1; int32 y=2; int32 identifier=3; int32 pressure=4; }
message TouchEvent { repeated Touch touches=1; int32 display=2; }
message KeyboardEvent { int32 codeType=1; int32 eventType=2; int32 keyCode=3; string key=4; string text=5; }
message Rotation { int32 rotation=1; double xAxis=2; double yAxis=3; double zAxis=4; }
message ImageTransport { int32 channel=1; string handle=2; }
message ImageFormat { int32 format=1; Rotation rotation=2; uint32 width=3; uint32 height=4; uint32 display=5; ImageTransport transport=6; }
message Image { ImageFormat format=1; uint32 width=2; uint32 height=3; bytes image=4; uint32 seq=5; uint64 timestampUs=6; }
message VmRunState { int32 state=1; }
message ParameterValue { repeated float data=1; }
message SensorValue { int32 target=1; int32 status=2; ParameterValue value=3; }
message PhysicalModelValue { int32 target=1; int32 status=2; ParameterValue value=3; int32 interpolation=4; }
`).root;
const methods = {
  getScreenshot:['ImageFormat','Image'], streamScreenshot:['ImageFormat','Image'],
  sendTouch:['TouchEvent','Empty'], sendKey:['KeyboardEvent','Empty'],
  getClipboard:['Empty','ClipData'], setClipboard:['ClipData','Empty'],
  setVmState:['VmRunState','Empty'], getVmState:['Empty','VmRunState'],
  setSensor:['SensorValue','Empty'], getSensor:['SensorValue','SensorValue'],
  setPhysicalModel:['PhysicalModelValue','Empty'], getPhysicalModel:['PhysicalModelValue','PhysicalModelValue'],
};
const failure = (message, mutation) => Object.assign(Error(message), {code:'ANDROID_GRPC_FAILED',execution:mutation?'unknown':'not_executed'});
// `unbounded` streams (an open viewer) end only by `signal` or the emulator.
function rpc(endpoint, method, value={}, {deadline=Date.now()+15000, onData, signal, unbounded=false}={}) {
  const types = methods[method];
  if (!types) throw failure('Unknown emulator operation.',false);
  const mutation = !/^(get|stream)/.test(method);
  if (unbounded && !(onData && signal)) throw failure('Unbounded emulator calls need a stream and a cancellation signal.',false);
  const timeout = unbounded ? null : commandBudget(onData?110000:30000,deadline).timeout;
  const requestType=schema.lookupType(types[0]), responseType=schema.lookupType(types[1]);
  const invalid=requestType.verify(value); if(invalid)throw failure(invalid,false);
  const payload=Buffer.from(requestType.encode(value).finish()), head=Buffer.alloc(5);
  head.writeUInt32BE(payload.length,1);
  return new Promise((resolve,reject)=>{
    let done=false, buffer=Buffer.alloc(0), result=null, status=null;
    const client=http2.connect(`http://127.0.0.1:${endpoint.port}`);
    const stream=client.request({':method':'POST',':path':`/android.emulation.control.EmulatorController/${method}`,
      'content-type':'application/grpc','te':'trailers','authorization':`Bearer ${endpoint.token}`,
      ...(timeout===null?{}:{'grpc-timeout':`${timeout}m`})});
    const finish=(error)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);stream.close();client.destroy();error?reject(error):resolve(result);};
    const abort=()=>finish(failure('Emulator request cancelled. Check device state before retrying an action.',mutation));
    const timer=timeout===null?null:setTimeout(()=>finish(failure('Emulator did not respond in time. Refresh the device state.',mutation)),timeout);
    signal?.addEventListener('abort',abort,{once:true});
    client.on('error',()=>finish(failure('Cannot connect to this emulator. Refresh its state and reopen the view.',mutation)));
    stream.on('error',()=>finish(failure('Emulator connection closed. Refresh its state.',mutation)));
    const trailers=h=>{if(h['grpc-status']!==undefined)status=Number(h['grpc-status']);};
    stream.on('response',h=>{trailers(h);if(h[':status']!==200)finish(failure('Emulator rejected the connection. Reopen this device.',mutation));});
    stream.on('trailers',trailers);
    stream.on('data',chunk=>{
      if(done)return;
      buffer=Buffer.concat([buffer,chunk]);
      try{
        while(buffer.length>=5){
          const size=buffer.readUInt32BE(1);
          if(buffer[0]!==0||size>32*1024*1024)throw Error('Invalid frame');
          if(buffer.length<size+5)break;
          result=responseType.toObject(responseType.decode(buffer.subarray(5,5+size)),{defaults:true,longs:Number,bytes:Buffer});
          buffer=buffer.subarray(5+size);
          onData?.(result);
        }
      }catch{finish(failure('Emulator returned an invalid frame.',mutation));}
    });
    stream.on('end',()=>finish(status===0&&buffer.length===0?null:failure(`Emulator operation failed (${status??'connection closed'}). Refresh device state.`,mutation)));
    if(signal?.aborted)return abort();
    stream.end(Buffer.concat([head,payload]));
  });
}
module.exports={rpc,schema};
