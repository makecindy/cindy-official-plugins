'use strict';
const {number}=require('./agent.cjs'),{packageId}=require('./apps.cjs'),{rpc}=require('./grpc.cjs');
const fail=(message)=>Object.assign(Error(message),{code:'INVALID_ARGUMENT',execution:'not_executed'});
function createState({devices,agent}){
  return async function setState(d,p){
    const operations=[],applied=[],appliedSteps=[];
    const add=(name,args)=>operations.push({name,run:()=>devices.adb(d,args,{deadline:p._deadline,mutation:true})});
    const setting=(name,space,key,value)=>add(name,['shell','settings','put',space,key,String(value)]);
    if(p.orientation!==undefined){
      const index=['portrait','landscape-left','portrait-upside-down','landscape-right'].indexOf(p.orientation);if(index<0)throw fail('Unknown orientation.');
      // Rotate the physical device, letting Android respect each activity's
      // orientation. A forced user_rotation plus a sensor override leaves
      // stale upside-down activity surfaces in Launcher transitions.
      operations.push({name:'orientation',run:()=>rpc(d.endpoint,'setPhysicalModel',{target:1,value:{data:[0,0,index*90]},interpolation:1},{deadline:p._deadline})});
    }
    if(p.posture!==undefined)throw fail('This Android phone/tablet has no hinge. Choose orientation instead.');
    if(p.appearance!==undefined){if(!['light','dark'].includes(p.appearance))throw fail('appearance must be light or dark.');add('appearance',['shell','cmd','uimode','night',p.appearance==='dark'?'yes':'no']);}
    if(p.contrast!==undefined){if(typeof p.contrast!=='boolean')throw fail('contrast must be boolean.');setting('contrast','secure','high_text_contrast_enabled',p.contrast?1:0);}
    if(p.text_size!==undefined){const sizes={'extra-small':0.8,small:0.9,medium:1,large:1.1,'extra-large':1.2,'extra-extra-large':1.3,'extra-extra-extra-large':1.4,'accessibility-medium':1.5,'accessibility-large':1.6,'accessibility-extra-large':1.7,'accessibility-extra-extra-large':1.8,'accessibility-extra-extra-extra-large':2};if(!sizes[p.text_size])throw fail('Unknown text size.');setting('text_size','system','font_scale',sizes[p.text_size]);}
    if(p.network!==undefined){
      const presets={wifi:['full','none'],dsl:['5500','none'],lte:['20000','50'], '3g':['umts','umts'],edge:['edge','edge'],'very-bad-network':['gsm','gprs'],clear:['full','none']};
      if(['offline','100-loss'].includes(p.network)){add('network',['shell','svc','wifi','disable']);add('network',['shell','svc','data','disable']);}
      else{let speed,delay;if(typeof p.network==='string'){const n=presets[p.network];if(!n)throw fail('Unknown network profile.');[speed,delay]=n;}else{const n=p.network;if(!n||typeof n!=='object'||n.loss!==undefined)throw fail('Android supports bandwidth and latency, or offline. Arbitrary packet loss is unavailable.');speed=String(number(n.bandwidth,'bandwidth',1,1e7,100000));delay=String(number(n.latency,'latency',0,60000,0));}
        add('network',['emu','network','speed',speed]);add('network',['emu','network','delay',delay]);add('network',['shell','svc','wifi','enable']);add('network',['shell','svc','data','enable']);}
    }
    if(p.location!==undefined){if(p.location==='clear')throw fail('location=clear is iOS-only. Android cannot restore an unsimulated location; no settings were changed.');const lat=number(p.location?.lat,'latitude',-90,90),lon=number(p.location?.lon,'longitude',-180,180);if(lat===undefined||lon===undefined)throw fail('location needs lat and lon.');add('location',['shell','cmd','location','set-location-enabled','true']);add('location',['emu','geo','fix',String(lon),String(lat)]);}
    if(p.status_bar!==undefined){
      if(!['clean','clear'].includes(p.status_bar))throw fail('status_bar must be clean or clear.');
      setting('status_bar','global','sysui_demo_allowed',1);
      const demo=(command,args=[])=>add('status_bar',['shell','am','broadcast','-a','com.android.systemui.demo','-e','command',command,...args]);
      if(p.status_bar==='clear')demo('exit');else{demo('enter');demo('clock',['-e','hhmm','0941']);demo('battery',['-e','level','100','-e','plugged','false']);demo('network',['-e','wifi','show','-e','level','4']);}
    }
    if(p.privacy!==undefined){
      const q=p.privacy,id=packageId(q.bundleId);
      if(!['grant','revoke','reset'].includes(q.action))throw fail('Unknown privacy action.');
      if(q.action==='reset')throw fail('Android supports grant/revoke only. Permission reset is iOS-only; no permissions were changed.');
      if(!['camera','microphone','contacts','calendar','location','location-always','photos','motion','media-library'].includes(q.service))throw fail('Choose a specific Android permission: camera, microphone, contacts, calendar, location, location-always, photos, motion or media-library.');
      // Resolve the running guest API before executing any field in the batch.
      const {stdout}=await devices.adb(d,['shell','getprop','ro.build.version.sdk'],{deadline:p._deadline,timeout:4000});
      const api=/^\d+$/.test(stdout.trim())?Number(stdout.trim()):0;
      if(!Number.isSafeInteger(api)||api<23)throw fail('Android runtime permissions require a confirmed device API level of 23 or later; no settings were changed.');
      if(q.service==='motion'&&api<29)throw fail('Android motion runtime permission requires API 29 or later; no settings were changed.');
      const permissions={camera:['CAMERA'],microphone:['RECORD_AUDIO'],contacts:['READ_CONTACTS','WRITE_CONTACTS'],calendar:['READ_CALENDAR','WRITE_CALENDAR'],location:['ACCESS_FINE_LOCATION','ACCESS_COARSE_LOCATION'],'location-always':['ACCESS_FINE_LOCATION','ACCESS_COARSE_LOCATION',...(api>=29?['ACCESS_BACKGROUND_LOCATION']:[])],photos:api>=33?['READ_MEDIA_IMAGES','READ_MEDIA_VIDEO']:['READ_EXTERNAL_STORAGE'],motion:['ACTIVITY_RECOGNITION'],'media-library':api>=33?['READ_MEDIA_AUDIO']:['READ_EXTERNAL_STORAGE']};
      for(const permission of permissions[q.service])add('privacy',['shell','pm',q.action==='grant'?'grant':'revoke',id,'android.permission.'+permission]);
    }
    for(const [index,operation] of operations.entries()){try{await operation.run();appliedSteps.push({field:operation.name,step:operations.slice(0,index+1).filter(o=>o.name===operation.name).length});if(operations[index+1]?.name!==operation.name)applied.push(operation.name);}catch(e){return {udid:d.udid,execution:e.execution==='not_executed'&&!appliedSteps.length?'not_executed':'unknown',outcome:'partial',applied:[...new Set(applied)],appliedSteps,stateError:{field:operation.name,step:appliedSteps.filter(s=>s.field===operation.name).length+1,code:e.code||'STATE_FAILED',message:e.message,execution:e.execution||'unknown'},nextAction:'Inspect the failed field and its completed steps; do not repeat the entire batch.'};}}
    const result={udid:d.udid,execution:operations.length?'executed':'not_executed',applied:[...new Set(applied)],appliedSteps};
    try{result.screen=(await agent.frame(d,p)).screen;}catch(e){result.observationError={code:e.code,message:e.message};}
    return result;
  };
}
module.exports={createState};
