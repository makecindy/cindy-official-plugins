'use strict';
// Borrow exactly the simulator's DeviceKit artwork. Apple assets stay on the
// user's Mac; only model/panel artwork is cached, never phone screenshots.
const fs=require('node:fs/promises'),path=require('node:path');
const {PNG}=require('../../vendor/android/deps.cjs');
const binary=path.join(__dirname,'../../vendor/baguette/Baguette');
function selectPanel(displays,screen){
  return displays.filter(d=>d.displayType==='integrated'&&d.scale>0).find(d=>{
    const w=d.width/d.scale,h=d.height/d.scale;
    return w===screen.width&&h===screen.height||w===screen.height&&h===screen.width;
  });
}
function rotationFor(rect,screen){
  const rotation=Number(/^rot(0|90|180|270)$/.exec(screen.rotation)?.[1]||0);
  const quarter=Math.abs(rect.width/rect.height-screen.width/screen.height)>.01;
  return quarter?(rotation===270?270:90):(rotation===180?180:0);
}
function turnRect(r,v,angle){
  if(angle===90)return {x:v.height-r.y-r.height,y:r.x,width:r.height,height:r.width};
  if(angle===180)return {...r,x:v.width-r.x-r.width,y:v.height-r.y-r.height};
  if(angle===270)return {x:r.y,y:v.width-r.x-r.width,width:r.height,height:r.width};
  return {...r};
}
function turnPNG(bytes,angle){
  if(!angle)return bytes;
  const src=PNG.sync.read(bytes),quarter=angle%180!==0,dst=new PNG({width:quarter?src.height:src.width,height:quarter?src.width:src.height});
  for(let y=0;y<src.height;y++)for(let x=0;x<src.width;x++){
    const dx=angle===90?src.height-1-y:angle===180?src.width-1-x:y;
    const dy=angle===90?x:angle===180?src.height-1-y:src.width-1-x;
    src.data.copy(dst.data,(dy*dst.width+dx)*4,(y*src.width+x)*4,(y*src.width+x+1)*4);
  }
  return PNG.sync.write(dst);
}
function createChrome({root,run}){
  let catalog;const models=new Map(),artwork=new Map(),definitions=new Map();
  const json=async(file,args)=>JSON.parse((await run(file,args,{timeout:10000,maxBuffer:8*1024*1024})).stdout);
  const plist=file=>json('/usr/bin/plutil',['-convert','json','-o','-',file]);
  async function model(identifier){
    if(!identifier)return null;
    if(!catalog)catalog=json('/usr/bin/xcrun',['simctl','list','devicetypes','-j']).catch(e=>{catalog=null;throw e;});
    if(!models.has(identifier))models.set(identifier,(async()=>{
      const type=(await catalog).devicetypes.find(d=>d.modelIdentifier===identifier);
      if(!type||!/^i(?:Phone|Pad)[^/]*$/.test(type.name))return null;
      const resources=path.join(type.bundlePath,'Contents/Resources');
      const capabilities=await plist(path.join(resources,'capabilities.plist')).catch(()=>({}));
      return {...type,displays:capabilities.capabilities?.displays||[]};
    })().catch(e=>{models.delete(identifier);throw e;}));
    return models.get(identifier);
  }
  async function load(type,panel){
    const which=panel?.deviceName==='primary-1'?'unfolded':'cover',key=type.name+':'+which;
    if(!artwork.has(key))artwork.set(key,(async()=>{
      const args=['--device-name',type.name,'--panel',which];
      const [layout,png]=await Promise.all([json(binary,['chrome','layout',...args]),run(binary,['chrome','composite',...args],{encoding:'buffer',trimOutput:false,timeout:10000,maxBuffer:8*1024*1024})]);
      let mask=null;const id=panel?.framebufferMaskIdentifier;
      if(typeof id==='string'&&/^[a-f0-9-]{36}$/i.test(id)){
        await fs.mkdir(path.join(root,'chrome'),{recursive:true,mode:0o700});
        const dir=await fs.mkdtemp(path.join(root,'chrome','mask-')),out=path.join(dir,'mask.png');
        try{
          await run('/usr/bin/sips',['-s','format','png',`/Library/Developer/DeviceKit/FramebufferMasks/${id}.pdf`,'--out',out],{timeout:10000});
          mask=await fs.readFile(out);
        }finally{await fs.rm(dir,{recursive:true,force:true});}
      }
      return {layout,png:png.stdout,mask,crease:which==='unfolded'};
    })().catch(e=>{artwork.delete(key);throw e;}));
    return artwork.get(key);
  }
  return {async definition(device,screen){
    if(!run)return null;
    const type=await model(device.model);if(!type)return null;
    const panel=selectPanel(type.displays,screen);
    // A known multi-panel profile must never borrow the other panel's bezel.
    if(type.displays.some(d=>d.displayType==='integrated')&&!panel)return null;
    const art=await load(type,panel),r=art.layout.screen,v=art.layout.composite;
    if(Math.abs(Math.min(r.width,r.height)/Math.max(r.width,r.height)-Math.min(screen.width,screen.height)/Math.max(screen.width,screen.height))>.01)return null;
    const angle=rotationFor(r,screen),key=type.name+':'+(panel?.deviceName||'primary')+':'+angle;
    if(!definitions.has(key)){
      const data=bytes=>'data:image/png;base64,'+turnPNG(bytes,angle).toString('base64');
      const image=data(art.png);
      definitions.set(key,{viewport:angle%180?{width:v.height,height:v.width}:v,rect:turnRect(r,v,angle),clipRadius:art.layout.innerCornerRadius,
        maskImage:art.mask?data(art.mask):null,crease:art.crease,bezelImage:{rest:image,bare:image}});
    }
    return {model:type.name,screen:definitions.get(key)};
  },clear(){catalog=null;models.clear();artwork.clear();definitions.clear();}};
}
module.exports={createChrome,selectPanel,rotationFor,turnRect,turnPNG};
