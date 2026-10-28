'use strict';
const path=require('node:path'),fs=require('node:fs/promises');
const {createSdk}=require('./sdk.cjs'),{createDevices}=require('./devices.cjs'),{createAgent}=require('./agent.cjs'),{createApps,packageId}=require('./apps.cjs');
function createAndroid({root,run,children}){
  root=path.join(root,'android');
  const sdk=createSdk(root),devices=createDevices({root,sdk,run,children}),agent=createAgent({root,devices,run}),apps=createApps({root,devices});
  const setState=require('./state.cjs').createState({devices,agent});
  const viewer=require('./viewer.cjs').createViewer({root,devices,agent});
  const fail=(code,message,execution='not_executed')=>Object.assign(Error(message),{code,execution});
  async function environment(){
    const local=await sdk.inspect();
    return {platform:'android',ready:local.ready,deviceTypes:devices.models,runtimes:local.images.map(({directory,abi,...r})=>({...r,supportedDeviceTypes:devices.models.map(d=>d.identifier)})),setup:{required:!local.ready,job:sdk.status(),sdkDirectory:local.managed},note:local.ready?'Android environment ready. Only this plugin’s private devices are controlled.':'Open simulator settings to review and install the Android environment.'};
  }
  async function dispatch(method,p={}){
    if(method==='environment')return environment();
    if(method==='devices')return {devices:await devices.devices()};
    if(method==='resource_usage'){
      const d=await devices.target(p,false);
      return require('../resource-usage.cjs').cachedResourceUsage({refresh:p.refresh===true,device:{...d,platform:'android'},directory:d.directory,pid:d.endpoint?.pid,run,deadline:p._deadline});
    }
    if(method==='android_setup_plan')return sdk.plan();
    if(method==='android_setup_install')return sdk.install(p);
    if(method==='android_setup_status')return sdk.status();
    if(method==='create_device')return devices.create(p);
    if(method==='boot'){
      const result=await devices.boot(p);
      if(p.screenshot)try{const d=await devices.target(p),{_modelImages,...shot}=await agent.screenshot(d,p);result.screenshot=shot;if(_modelImages)result._modelImages=_modelImages;}catch(e){result.screenshot={error:e.message};}
      return result;
    }
    if(method==='shutdown')return devices.shutdown(p);
    if(['rename_device','delete_device','erase_device'].includes(method))return devices.manage(method,p);
    if(method==='close_viewer'){await viewer.close();return {execution:'executed'};}
    if(method==='reveal_screenshot')return agent.reveal(p);
    if(method==='app_install_status')return apps.status(p);
    const d=await devices.target(p);
    const direct={describe_ui:'describe',screenshot:'screenshot',tap:'tap',gesture:'gesture',type_text:'typeText',press:'press',wait_for:'waitFor',logs:'logs'}[method];
    if(direct)return agent[direct](d,p);
    if(method==='swipe')return agent.gesture(d,{...p,kind:'swipe',from:[p.startX,p.startY],to:[p.endX,p.endY],observe:'none'});
    if(method==='open_viewer')return {udid:d.udid,...await viewer.open(d.udid,p._locale),execution:'executed'};
    if(method==='import_media')return require('./files.cjs').importMedia(devices,d,p);
    if(method==='set_state')return setState(d,p);
    if(method==='app_info')return apps.info(d,p);
    if(method==='app_install'||method==='install_app')return apps.install(d,p);
    if(method==='app_bundle')return apps.bundle(d,p);
    if(method==='launch_app'){
      const result=await apps.launch(d,p);
      if(!result.appLaunched)return result;
      if(p.showViewer!==false)try{result.viewer=await viewer.open(d.udid,p._locale);}catch(e){result.viewer={ready:false,previewOpened:false,error:e.message};result.outcome='partial';result.nextAction='Retry viewer action=open; do not relaunch the App.';}
      if(p.screenshot||result.viewer?.previewOpened===false)try{const {_modelImages,...shot}=await agent.screenshot(d,{...p,_deadline:Math.min(p._deadline??Infinity,Date.now()+12000)});result.screenshot=shot;if(_modelImages)result._modelImages=_modelImages;}catch(e){result.screenshot={error:e.message};}
      return result;
    }
    if(method==='app_terminate'||method==='app_uninstall'){
      const id=packageId(p.bundleId);await devices.adb(d,method==='app_terminate'?['shell','am','force-stop',id]:['uninstall',id],{deadline:p._deadline,mutation:true});return {udid:d.udid,bundleId:id,execution:'executed'};
    }
    if(method==='open_url'){
      if(typeof p.url!=='string'||p.url.length>4096||! /^[A-Za-z][A-Za-z0-9+.-]*:/.test(p.url)||p.url.includes('\0'))throw fail('INVALID_ARGUMENT','Use a URL with a scheme.');
      const r=await devices.adb(d,['shell','am','start','-W','-a','android.intent.action.VIEW','-d',p.url],{deadline:p._deadline,mutation:true});if(/Error:|Exception/.test(r.stdout))throw fail('OPEN_URL_FAILED','Android could not open that URL. Check the installed App and its deep links.','unknown');return {udid:d.udid,execution:'executed'};
    }
    if(method==='heal'){
      await devices.adb(d,['reboot'],{deadline:p._deadline,mutation:true});return {udid:d.udid,execution:'executed',note:'Android reboot requested; Apps were terminated. Wait for devices to report Booted before continuing.'};
    }
    if(method==='capture')return require('./capture.cjs').capture({d,p,root,agent,perform:action=>{
      const allowed={tap:'tap',gesture:'gesture',press:'press',type_text:'type_text',open_url:'open_url',app_launch:'launch_app'};
      if(!allowed[action?.tool])throw fail('INVALID_ARGUMENT','Unsupported capture action.');
      return dispatch(allowed[action.tool],{...action.args,udid:d.udid,observe:'none',showViewer:false,_deadline:p._deadline});
    }});
    throw fail('UNKNOWN_TOOL','Unknown Android operation.');
  }
  return {dispatch,owns:devices.owns,viewer,pending:id=>apps.pending(id),runningFor:id=>apps.runningFor(id),installing:()=>!!sdk.pending()||!!apps.pending(),configure:c=>viewer.configure(c)};
}
module.exports={createAndroid};
