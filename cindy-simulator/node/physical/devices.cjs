'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),net=require('node:net');
const {randomUUID}=require('node:crypto');
const {commandBudget}=require('../budget.cjs');
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const fail=(code,message,execution='not_executed')=>Object.assign(Error(message),{code,execution});
function normalize(row){
  const h=row.properties?.hardware||row.hardwareProperties||{},s=row.properties?.state||row.deviceProperties||{};
  const c=row.properties?.connection||row.connectionProperties||{},software=row.properties?.software||row.deviceProperties||{};
  if(h.reality!=='physical'||!['iPhone','iPad'].includes(h.deviceType)||!UUID.test(row.identifier)||typeof h.udid!=='string'||! /^[a-f0-9-]{20,40}$/i.test(h.udid))return null;
  const connected=(c.state||c.tunnelState)==='connected',version=software.osVersionNumber?.stringValue||software.osVersionNumber||'';
  const developerMode=s.developerModeStatus==='enabled'||!!s.developerModeStatus?.enabled;
  // Use CoreDevice's stable UUID throughout the shared task/selection model.
  return {udid:row.identifier.toUpperCase(),hardwareUdid:h.udid,name:s.name||h.marketingName||h.deviceType,
    platform:'ios',kind:'physical',runtime:`iOS ${version}`,deviceType:h.deviceType,model:h.productType,
    state:connected?'Booted':'Disconnected',isAvailable:connected,connection:c.transportType||'unknown',developerMode,
    tunnelAddress:c.tunnelIPAddressString||c.tunnelIPAddress||null};
}
function activeDisplay(result){
  const integrated=(result.displays||[]).filter(d=>d.type?.integrated);
  // Single-screen iPhones (including Air) omit `active` and `uniqueId`.
  // Absence is not false. Never extend this fallback to a foldable's panels.
  const active=integrated.filter(d=>d.active===true||(integrated.length===1&&d.active===undefined));
  const d=active.find(d=>d.primary)||(active.length===1?active[0]:null);
  if(d?.backlightState==='off'||(!d&&integrated.length&&integrated.every(p=>p.backlightState==='off')))throw fail('DISPLAY_ASLEEP','手机屏幕已熄灭，请唤醒并解锁手机。');
  if(!d)throw fail('DISPLAY_UNAVAILABLE','暂时无法获取手机画面，请保持手机亮屏并解锁。');
  const scale=d.pointScale,[width,height]=d.bounds?.[1]||[];
  if(!Number.isInteger(d.displayId)||d.displayId<1||d.displayId>1024||!(scale>0&&width>0&&height>0))throw fail('DISPLAY_UNAVAILABLE','设备未返回有效屏幕坐标。');
  return d;
}
function activeScreen(result){
  const d=activeDisplay(result);
  return {displayId:d.displayId,width:d.bounds[1][0]/d.pointScale,height:d.bounds[1][1]/d.pointScale,rotation:d.currentOrientation};
}
function createDevices({root,run,host=process.platform}){
  async function command(args,p={},mutation=false){
    if(host!=='darwin')throw fail('UNSUPPORTED_HOST','iPhone 真机连接需要安装 Xcode 的 Mac。');
    const dir=path.join(root,'commands');await fs.mkdir(dir,{recursive:true,mode:0o700});
    const file=path.join(dir,randomUUID()+'.json');
    try{
      await run('/usr/bin/xcrun',['devicectl',...args,'--json-output',file,'--quiet'],{...commandBudget(90000,p._deadline),mutation,maxBuffer:8*1024*1024});
      const data=JSON.parse(await fs.readFile(file,'utf8'));
      if(data.info?.outcome!=='success')throw fail('DEVICE_COMMAND_FAILED','真机命令未确认完成，请检查设备状态。',mutation?'unknown':'not_executed');
      return data.result;
    }finally{await fs.rm(file,{force:true}).catch(()=>{});}
  }
  async function list(p={}){if(host!=='darwin')return [];return ((await command(['list','devices'],{...p,_deadline:Math.min(p._deadline||Infinity,Date.now()+10000)})).devices||[]).map(normalize).filter(Boolean);}
  async function target(p,connected=true){
    if(!UUID.test(p.udid||''))throw fail('INVALID_DEVICE','请使用 devices 返回的精确设备 ID。');
    const d=(await list(p)).find(d=>d.udid===p.udid.toUpperCase());
    if(!d)throw fail('DEVICE_NOT_FOUND','未找到这台已配对的 iPhone / iPad，请刷新设备列表。');
    if(connected&&!d.isAvailable)throw fail('DEVICE_DISCONNECTED','手机未连接。请连接 USB 或已配对的网络，解锁并信任这台 Mac。');
    return d;
  }
  function endpoint(d,port){
    // Never accept a caller-supplied address. Only the current paired device's
    // CoreDevice tunnel is allowed; ordinary LAN/WAN hosts are not endpoints.
    if(net.isIP(d.tunnelAddress)!==6||!/^fd[0-9a-f]{2}:/i.test(d.tunnelAddress))throw fail('DEVICE_TUNNEL_UNAVAILABLE','设备调试隧道尚未就绪，请在 Xcode 中完成配对后重新连接。');
    return `http://[${d.tunnelAddress}]:${port}`;
  }
  const displays=(d,p)=>command(['device','info','displays','--device',d.udid],p);
  async function capture(d,p={}){
    const before=await displays(d,p),display=activeDisplay(before),screen=activeScreen(before);
    const uniqueId=typeof display.uniqueId==='string'&&display.uniqueId;
    // devicectl defaults to the primary display. Use that documented default
    // only for an unambiguous primary panel; a secondary must name its ID.
    if(!uniqueId&&!display.primary)throw fail('DISPLAY_UNAVAILABLE','暂时无法获取手机画面，正在等待屏幕恢复。');
    const dir=path.join(root,'frames');await fs.mkdir(dir,{recursive:true,mode:0o700});
    const file=path.join(dir,randomUUID()+'.png');
    try{
      await command(['device','capture','screenshot','--device',d.udid,...(uniqueId?['--display-unique-id',uniqueId]:[]),'--destination',file],p);
      if(JSON.stringify(screen)!==JSON.stringify(activeScreen(await displays(d,p))))throw fail('SCREEN_CHANGED','手机屏幕已变化，正在刷新画面。');
      return {bytes:await fs.readFile(file),screen};
    }finally{await fs.rm(file,{force:true}).catch(()=>{});}
  }
  return {command,list,target,endpoint,capture,screen:async(d,p)=>activeScreen(await displays(d,p))};
}
module.exports={createDevices,normalize,activeScreen,fail};
