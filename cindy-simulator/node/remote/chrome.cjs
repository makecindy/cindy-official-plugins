'use strict';
// The device body (bezel, screen position, corner shape) of a simulator shown
// on another of the user's computers. The computer that runs the device makes
// it from its own Xcode artwork, exactly as for a device shown locally
// (physical/chrome.cjs); the viewing computer asks for it in pieces small
// enough for one plugin-to-plugin request and keeps it in memory only.
const {createHash}=require('node:crypto');
const CHUNK=40000,MAX_BYTES=4*1024*1024,KEEP=8;
const KEY=/^[0-9a-f]{32}$/;
const fail=(code)=>Object.assign(Error(code),{code,execution:'not_executed'});
const pictureOf=p=>(p?.rotation===undefined||(Number.isInteger(p.rotation)&&p.rotation>=0&&p.rotation<=3))&&Number.isInteger(p?.width)&&Number.isInteger(p?.height)&&p.width>0&&p.height>0&&p.width<=16384&&p.height<=16384?{width:p.width,height:p.height,...(p.rotation===undefined?{}:{rotation:p.rotation})}:null;
const remember=(map,key,value)=>{map.delete(key);map.set(key,value);while(map.size>KEEP)map.delete(map.keys().next().value);};

// On the computer that runs the device.
function createChromeSource({definition}){
  const texts=new Map();
  return {
    async meta(deviceType,picture){
      picture=pictureOf(picture);if(!picture)throw fail('INVALID_ARGUMENT');
      const found=await definition(deviceType,picture).catch(()=>null);
      const s=found?.screen;
      // No artwork for this model here (or not an iPhone/iPad): the viewer keeps its plain body.
      if(!s?.bezelImage?.rest||!s.viewport||!s.rect)return {none:true};
      const text=JSON.stringify({viewport:s.viewport,rect:s.rect,clipRadius:s.clipRadius||0,crease:s.crease===true,image:s.bezelImage.rest,mask:s.maskImage||null});
      if(text.length>MAX_BYTES)return {none:true};
      const key=createHash('sha256').update(text).digest('hex').slice(0,32);
      remember(texts,key,text);
      return {key,size:text.length,chunks:Math.ceil(text.length/CHUNK)};
    },
    chunk(key,index){
      const text=KEY.test(key)?texts.get(key):null;
      if(!text||!Number.isInteger(index)||index<0||index*CHUNK>=text.length)throw fail('CHROME_EXPIRED');
      return {data:text.slice(index*CHUNK,(index+1)*CHUNK)};
    },
  };
}

// On the computer that shows it.
function createChromeStore(){
  const ready=new Map(),partial=new Map();
  const png=value=>typeof value==='string'&&/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value);
  const box=(b,keys)=>b&&typeof b==='object'&&keys.every(k=>Number.isFinite(b[k])&&b[k]>=0&&b[k]<=100000);
  function accept(key,text){
    if(createHash('sha256').update(text).digest('hex').slice(0,32)!==key)return false;
    let d;try{d=JSON.parse(text);}catch{return false;}
    // Only what the bezel part draws: sizes, and two PNG images as data.
    if(!box(d.viewport,['width','height'])||!box(d.rect,['x','y','width','height'])||!(d.viewport.width>0&&d.viewport.height>0&&d.rect.width>0&&d.rect.height>0)||!png(d.image)||(d.mask!==null&&!png(d.mask)))return false;
    remember(ready,key,{viewport:{width:d.viewport.width,height:d.viewport.height},rect:{x:d.rect.x,y:d.rect.y,width:d.rect.width,height:d.rect.height},
      clipRadius:Number.isFinite(d.clipRadius)&&d.clipRadius>=0?d.clipRadius:0,crease:d.crease===true,maskImage:d.mask,bezelImage:{rest:d.image,bare:d.image}});
    return true;
  }
  return {
    has:key=>ready.has(key),
    get:key=>ready.get(key)||null,
    // Pieces arrive in order; anything else starts over rather than guessing.
    put(key,index,total,data){
      if(!KEY.test(key)||!Number.isInteger(index)||!Number.isInteger(total)||total<1||total>Math.ceil(MAX_BYTES/CHUNK)||index<0||index>=total||typeof data!=='string'||!data.length||data.length>CHUNK)throw fail('INVALID_ARGUMENT');
      if(ready.has(key))return {complete:true};
      const pending=index===0?{total,parts:[]}:partial.get(key);
      if(!pending||pending.total!==total||pending.parts.length!==index){partial.delete(key);throw fail('CHROME_OUT_OF_ORDER');}
      pending.parts.push(data);remember(partial,key,pending);
      if(pending.parts.length<total)return {complete:false};
      partial.delete(key);
      if(!accept(key,pending.parts.join('')))throw fail('CHROME_INVALID');
      return {complete:true};
    },
  };
}
module.exports={createChromeSource,createChromeStore,pictureOf,CHUNK};
