'use strict';
// Android's display rotation is counter-clockwise from its native touch panel.
// Both Agent gestures and viewer pointers pass through this one conversion.
function toNative(model,rotation,x,y){
  const W=model.width,H=model.height;
  const [nx,ny]=rotation===1?[W-1-y,x]:rotation===2?[W-1-x,H-1-y]:rotation===3?[y,H-1-x]:[x,y];
  return {x:Math.max(0,Math.min(W-1,Math.round(nx))),y:Math.max(0,Math.min(H-1,Math.round(ny)))};
}
// The emulator image follows its accelerometer; an Android activity can lock
// the display independently (notably Launcher). Use the primary input viewport.
async function displayRotation(devices,d,p={}){
  const {stdout}=await devices.adb(d,['shell','dumpsys','input'],{deadline:p._deadline,timeout:5000});
  const match=/Viewport INTERNAL:[^\n]*\bdisplayId=0,[^\n]*\borientation=([0-3])\b/.exec(stdout);
  if(!match)throw Object.assign(Error('Cannot confirm Android display orientation.'),{code:'SCREEN_UNAVAILABLE',execution:'not_executed'});
  return Number(match[1]);
}
function rotateImage(image,turns){
  turns=((turns%4)+4)%4;if(!turns)return image;
  const {width:W,height:H,data}=image,width=turns%2?H:W,height=turns%2?W:H,out=Buffer.alloc(data.length);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const [nx,ny]=turns===1?[H-1-y,x]:turns===2?[W-1-x,H-1-y]:[y,W-1-x];
    const src=(y*W+x)*4,dst=(ny*width+nx)*4;data.copy(out,dst,src,src+4);
  }
  return {width,height,data:out};
}
// Screenshot and contact-sheet frames must use the same display coordinates.
function normalizeFrame(frame,rotation){
  const {PNG}=require('../../vendor/android/deps.cjs');
  const turns=((frame.format.rotation?.rotation||0)-rotation+4)%4;
  const image=rotateImage(PNG.sync.read(frame.image),turns);
  return {image,bytes:turns?PNG.sync.write(image):frame.image};
}
module.exports={toNative,displayRotation,rotateImage,normalizeFrame};
