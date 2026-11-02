'use strict';
const path=require('node:path'),fs=require('node:fs/promises');
const {randomUUID}=require('node:crypto');
const {createDevices,fail}=require('./devices.cjs');
const {createWda}=require('./wda.cjs');
const {createAgent,number}=require('./agent.cjs');
const {commandBudget}=require('../budget.cjs');
function createPhysical({root,run,children}){
  root=path.join(root,'physical');const devices=createDevices({root,run}),wda=createWda({root,devices,run,children});
  const live=require('./realtime.cjs').createRealtime({root,run,devices,children});
  const interactive=require('./live-agent.cjs').createLiveAgent(live),agent=createAgent({root,wda,run,devices,live:interactive});
  const viewer=require('./viewer.cjs').createViewer({root,run,devices,wda,agent,children,live});
  const publicDevice=d=>{const {tunnelAddress,hardwareUdid,...rest}=d;return {...rest,control:wda.state(d.udid)};};
  const known=new Set();let discovered=false;
  const list=async p=>{const found=await devices.list(p);for(const d of found)known.add(d.udid);discovered=true;return found.map(publicDevice);};
  const bundle=value=>{if(typeof value!=='string'||! /^[A-Za-z0-9][A-Za-z0-9.-]{1,254}$/.test(value))throw fail('INVALID_ARGUMENT','App bundle ID 无效。');return value;};
  async function appInfo(d,p){
    const id=bundle(p.bundleId),apps=(await devices.command(['device','info','apps','--device',d.udid],p)).apps||[];
    const info=apps.find(a=>a.bundleIdentifier===id);
    return {udid:d.udid,bundleId:id,installed:!!info,app:info||null,matchesLocal:null,verification:'unconfirmed',note:'真机安装信息不能证明与本地构建完全一致。'};
  }
  async function logs(d,p){
    const seconds=number(p.last_seconds,'last_seconds',1,600,120),limit=number(p.limit,'limit',1,1000,150);
    if(p.bundleId)throw fail('UNSUPPORTED_LOG_FILTER','真机日志请指定精确 process 名称；bundleId 无法可靠映射历史日志进程。');
    if(p.process!==undefined&&(typeof p.process!=='string'||! /^[A-Za-z0-9_. -]{1,100}$/.test(p.process)))throw fail('INVALID_ARGUMENT','进程名无效。');
    let regex;try{if(p.match)regex=new RegExp(p.match);}catch{throw fail('INVALID_ARGUMENT','日志匹配表达式无效。');}
    const dir=await require('../android/artifacts.cjs').directory(root,'logs'),archive=path.join(dir,randomUUID()+'.logarchive');
    const args=['collect','--device-udid',d.hardwareUdid,'--last',`${Math.ceil(seconds)}s`,'--size','20m','--output',archive];
    if(p.process)args.push('--predicate',`process == "${p.process}"`);
    try{await run('/usr/bin/log',args,commandBudget(80000,p._deadline));}
    catch(e){if(/Must be root|permission|not permitted/i.test(e.message))throw fail('DEVICE_LOG_PERMISSION','当前 macOS 要求管理员权限才能采集真机统一日志。尚未读取日志；可在 macOS Console 中选择此设备查看。插件不会自动提权。');throw e;}
    const show=['show','--archive',archive,'--style','compact','--last',`${Math.ceil(seconds)}s`];
    const predicates=[];if(p.process)predicates.push(`process == "${p.process}"`);
    if(p.level==='error')predicates.push('(messageType == error OR messageType == fault)');
    if(predicates.length)show.push('--predicate',predicates.join(' AND '));
    if(p.level==='info'||p.level==='debug')show.push('--info');if(p.level==='debug')show.push('--debug');
    const output=await run('/usr/bin/log',show,{...commandBudget(20000,p._deadline),maxBuffer:8*1024*1024});
    const lines=output.stdout.split('\n').filter(l=>!regex||regex.test(l));
    return {udid:d.udid,lines:lines.slice(-limit),total:lines.length,archive,note:'真机统一日志；未包含独立的崩溃报告，空日志不能证明没有崩溃。'};
  }
  async function dispatch(method,p={}){
    if(method==='devices')return {devices:await list(p)};
    if(method==='close_viewer'){await viewer.close();if(p._stopControls){await interactive.close();await live.close();await wda.close();}return {execution:'executed'};}
    if(method==='reveal_screenshot')return agent.reveal(p);
    // The phone may disappear mid-build. Cancellation acts only on a job we
    // already own and must not depend on rediscovering the unplugged device.
    if(method==='physical_disconnect'&&typeof p.udid==='string'){await interactive.release(p.udid);await live.disconnect(p.udid);return wda.disconnect(p.udid);}
    const d=await devices.target(p,!['physical_disconnect','physical_status','resource_usage'].includes(method));
    if(['shutdown','erase_device','delete_device','rename_device','heal','boot'].includes(method))throw fail('PHYSICAL_DEVICE_PROTECTED','真机不支持模拟器的开关机、抹除、删除、重命名或修复操作。连接控制使用 device action=connect。');
    if(method==='physical_connect')return wda.start(d,p);
    if(method==='physical_status')return {udid:d.udid,control:wda.state(d.udid),...wda.state(d.udid)};
    if(method==='physical_disconnect')return wda.disconnect(d.udid);
    if(method==='physical_touch'){
      if(!Array.isArray(p.paths)||p.paths.length<1||p.paths.length>2)throw fail('INVALID_ARGUMENT','触摸需要一到两个触点。');
      return agent.actions(d,p,p.paths,number(p.duration,'duration',0,10000,300),number(p.hold,'hold',0,10000,0));
    }
    if(method==='resource_usage')return {udid:d.udid,memory:{status:'unsupported'},disk:{status:'unsupported'}};
    if(method==='open_viewer')return {udid:d.udid,...await viewer.open(d.udid,p._locale),execution:'executed'};
    if(method==='app_info')return appInfo(d,p);
    if(method==='logs')return logs(d,p);
    if(method==='app_install'||method==='install_app'){
      if(typeof p.appPath!=='string'||!path.isAbsolute(p.appPath)||!p.appPath.endsWith('.app'))throw fail('INVALID_APP','真机需要已签名的 iphoneos .app 绝对路径。');
      const app=await fs.realpath(p.appPath),raw=await run('/usr/bin/plutil',['-convert','json','-o','-',path.join(app,'Info.plist')],commandBudget(5000,p._deadline));
      const info=JSON.parse(raw.stdout);
      if(!info.CFBundleSupportedPlatforms?.includes('iPhoneOS'))throw fail('INVALID_APP_PLATFORM','这是模拟器构建，请使用 iphoneos 真机构建。');
      const id=bundle(info.CFBundleIdentifier);await run('/usr/bin/codesign',['--verify','--deep',app],commandBudget(15000,p._deadline));
      await devices.command(['device','install','app','--device',d.udid,app],p,true);
      return {udid:d.udid,bundleId:id,state:'done',installed:true,execution:'executed'};
    }
    if(method==='app_uninstall'){const id=bundle(p.bundleId);await devices.command(['device','uninstall','app','--device',d.udid,id],p,true);return {udid:d.udid,bundleId:id,execution:'executed'};}
    if(method==='launch_app'){
      const id=bundle(p.bundleId);
      if(p.arguments!==undefined&&(!Array.isArray(p.arguments)||p.arguments.length>50||!p.arguments.every(x=>typeof x==='string'&&x.length<=1000&&!x.includes('\0'))))throw fail('INVALID_ARGUMENT','arguments 必须是最多 50 个字符串。');
      if(p.env!==undefined&&(!p.env||typeof p.env!=='object'||Array.isArray(p.env)||Object.entries(p.env).some(([k,v])=>! /^[A-Za-z_][A-Za-z0-9_]{0,100}$/.test(k)||typeof v!=='string'||v.length>4000)))throw fail('INVALID_ARGUMENT','env 必须是环境变量名到字符串的映射。');
      let terminated=false,result;
      try{
        if(p.relaunch!==false){await wda.call(d,'/wda/apps/terminate',p,{bundleId:id});terminated=true;}
        result=await wda.call(d,'/wda/apps/launch',p,{bundleId:id,arguments:p.arguments||[],environment:p.env||{},shouldWaitForQuiescence:false});
      }catch(e){if(terminated)e.execution='unknown';throw e;}
      const out={udid:d.udid,bundleId:id,appLaunched:true,execution:'executed',result};
      if(p.showViewer!==false)try{out.viewer=await viewer.open(d.udid,p._locale);}catch(e){out.viewer={ready:false,previewOpened:false,error:e.message};out.outcome='partial';}
      if(p.screenshot)await agent.after(d,{...p,observe:'screenshot'},out);return out;
    }
    if(method==='app_terminate'){await wda.call(d,'/wda/apps/terminate',p,{bundleId:bundle(p.bundleId)});return {udid:d.udid,execution:'executed'};}
    if(method==='open_url'){
      if(typeof p.url!=='string'||p.url.length>4096||! /^[A-Za-z][A-Za-z0-9+.-]*:/.test(p.url))throw fail('INVALID_ARGUMENT','URL 需要有效 scheme。');
      await wda.call(d,'/url',p,{url:p.url});return {udid:d.udid,execution:'executed'};
    }
    const direct={screenshot:'screenshot',describe_ui:'describe',tap:'tap',gesture:'gesture',type_text:'typeText',press:'press',wait_for:'waitFor'}[method];
    if(direct)return agent[direct](d,p);
    throw fail('UNSUPPORTED_PHYSICAL_OPERATION','此操作尚不支持真机。请使用截图、界面读取、点击、滑动、双指手势、输入、App 管理或日志。');
  }
  return {list,dispatch,viewer,configure:c=>viewer.configure(c),pending:wda.pending,
    // Listing refreshes membership. Never put CoreDevice discovery on every
    // simulator gesture; retain known offline IDs so they cannot fall through
    // to simulator lifecycle operations.
    owns:async(id,p={})=>{if(typeof id!=='string')return false;if(!discovered)await list(p);return known.has(id.toUpperCase());}};
}
module.exports={createPhysical};
