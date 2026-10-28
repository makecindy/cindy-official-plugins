'use strict';
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {randomBytes,randomUUID}=require('node:crypto');
const {MAX_BYTES,extension}=require('./files.cjs');
const {rpc}=require('./grpc.cjs');
// Same controller assets as iOS. Only the inner screen transport differs.
function createViewer({devices,agent,root}){
  const intent=path.join(root,'viewer-intent.json');
  const forget=()=>{try{require('node:fs').rmSync(intent,{force:true});}catch{}};
  let server=null,token=null,controls=null,base=null,starting=null,lastSeen=0;const opened=new Set(),streams=new Set();
  const assets={'/android-screen-actions.js':['screen-actions.js','text/javascript'],'/control.js':['../control.js','text/javascript'],'/control-model.js':['../control-model.js','text/javascript'],'/control.css':['../control.css','text/css'],'/android-screen.js':['screen.js','text/javascript'],'/android-screen.css':['screen.css','text/css']};
  assets['/gesture-overlay.js']=['../../vendor/baguette/Baguette_Baguette.bundle/Web/baguette/gestures/pinch-overlay.js','text/javascript'];
  const url=(id,locale)=>base+'/control?udid='+encodeURIComponent(id)+'&lang='+(locale==='zh-CN'?'zh-CN':'en')+'#cindyClipboard='+new URL(base).port+'.'+token;
  function start(){
    if(starting)return starting;
    if(base)return Promise.resolve();
    starting=listen().finally(()=>{starting=null;});return starting;
  }
  async function listen(){
    token=randomBytes(32).toString('hex');
    server=http.createServer(async(req,res)=>{
      const own=new URL(base).host,origin=new URL(base).origin;
      const reply=(status,p)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(p));};
      res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
      if(req.headers.host!==own)return reply(403,{error:'Invalid host'});
      let u;try{u=new URL(req.url,base);}catch{return reply(400,{error:'Invalid URL'});}
      const authorized=req.headers['x-cindy-clipboard']===token||u.searchParams.get('cindyViewer')===token||(()=>{try{const r=new URL(req.headers.referer);return r.origin===origin&&r.searchParams.get('cindyViewer')===token;}catch{return false;}})();
      try{
        if(req.method==='GET'&&assets[u.pathname]){const [name,type]=assets[u.pathname];res.writeHead(200,{'Content-Type':type});return res.end(await fs.readFile(path.join(__dirname,name)));}
        if(req.method==='GET'&&u.pathname==='/control'){
          res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"frame-ancestors 'self' cindy-ghost://baguette-simulator",'Referrer-Policy':'no-referrer'});
          return res.end(await fs.readFile(path.join(__dirname,u.searchParams.get('lang')==='zh-CN'?'../control.zh-CN.html':'../control.html')));
        }
        if(!authorized)return reply(403,{error:'Viewer expired. Reopen the device from the plugin.'});
        const match=/^\/simulators\/([a-f0-9-]{36})(\/definition.json)?$/i.exec(u.pathname);
        if(req.method==='GET'&&match){
          if(!opened.has(match[1]))return reply(404,{error:'Device not opened'});
          if(match[2]){const d=await devices.target({udid:match[1]}),f=await agent.frame(d);return reply(200,{screen:{viewport:{width:f.screen.width,height:f.screen.height}}});}
          res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(await fs.readFile(path.join(__dirname,'screen.html')));
        }
        if(req.method==='GET'&&u.pathname==='/android-stream'){
          const udid=u.searchParams.get('udid');if(!opened.has(udid))return reply(404,{error:'Device not opened'});
          await controls.assertEnabled();const d=await devices.target({udid}),cancel=new AbortController();streams.add(cancel);
          res.once('close',()=>{cancel.abort();streams.delete(cancel);});
          // Frames carry Android display rotation (to reject stale initial
          // touches) and emulator device rotation (the viewer follows it).
          try{await require('./stream.cjs').serve({d,agent,res,signal:cancel.signal,format:u.searchParams.get('format')});}
          catch{/* The screen reconnects when the stream ends. */}
          finally{streams.delete(cancel);cancel.abort();if(!res.headersSent)res.writeHead(503);res.end();}return;
        }
        if(req.method!=='POST'||req.headers.origin!==origin||req.headers['x-cindy-clipboard']!==token||!['/control-api','/android-input','/android-file'].includes(u.pathname))return reply(403,{error:'Invalid origin or capability'});
        if(u.pathname==='/android-file'){
          const udid=u.searchParams.get('udid');if(!opened.has(udid))return reply(404,{error:'Device not opened'});
          await controls.assertEnabled();await devices.target({udid});
          const ext=extension(u.searchParams.get('name'));
          const storage=await require('./artifacts.cjs').directory(root,'uploads');
          const dir=await fs.mkdtemp(path.join(storage,'upload-'));
          const file=path.join(dir,randomUUID()+ext);let preserve=false;
          try{
            const handle=await fs.open(file,'wx',0o600);let bytes=0;
            try{for await(const chunk of req){bytes+=chunk.length;if(bytes>MAX_BYTES)throw Object.assign(Error('Files must be at most 128 MiB.'),{code:'FILE_SIZE',execution:'not_executed'});await handle.writeFile(chunk);}}finally{await handle.close();}
            if(!bytes)throw Object.assign(Error('The file is empty.'),{code:'FILE_SIZE',execution:'not_executed'});
            const result=ext==='.apk'?await controls.request('app_install',{udid,appPath:file,wait:0}):await controls.request('import_media',{udid,path:file});
            // Install jobs inspect the upload asynchronously. Remove it only
            // when the existing job settles, including failures.
            if(result.job&&result.state==='running'){
              preserve=true;
              const cleanup=async()=>{try{const job=await controls.request('app_install_status',{udid,job:result.job,wait:0});if(job.state==='running'){setTimeout(cleanup,1000).unref();return;}}catch{return;}await fs.rm(dir,{recursive:true,force:true});};
              setTimeout(cleanup,1000).unref();
            }
            if(!preserve){await fs.rm(dir,{recursive:true,force:true});preserve=true;}
            return reply(200,{ok:true,...result});
          }finally{if(!preserve)await fs.rm(dir,{recursive:true,force:true});}
        }
        const chunks=[];let bytes=0;for await(const c of req){bytes+=c.length;if(bytes>40000)return reply(413,{error:'Input too large'});chunks.push(c);}
        const p=JSON.parse(Buffer.concat(chunks));if(!opened.has(p.udid))return reply(404,{error:'Device not opened'});
        if(u.pathname==='/android-input'){
          if(p.action==='rotate')return reply(200,{ok:true,...await controls.request('set_state',{udid:p.udid,orientation:p.orientation})});
          const result=await controls.exclusive(async()=>{
            await controls.assertEnabled();const d=await devices.target(p);controls.touch();
            if(p.action==='touch'){
              if(!Array.isArray(p.touches)||p.touches.length>10||p.touches.some(t=>!Number.isInteger(t.identifier)||t.identifier<0||t.identifier>9||![0,1024].includes(t.pressure)||!Number.isFinite(t.x)||!Number.isFinite(t.y)||t.x<0||t.x>1||t.y<0||t.y>1))throw Error('Invalid touch');
              if(!Number.isInteger(p.rotation)||p.rotation<0||p.rotation>3||!Number.isInteger(p.deviceRotation)||p.deviceRotation<0||p.deviceRotation>3||(p.start!==undefined&&typeof p.start!=='boolean'))throw Error('Invalid touch orientation');
              // Validate once at pointer-down, as Agent gestures do. Running
              // dumpsys for every move/release destroys swipe velocity.
              const rotation=p.start===false?p.rotation:await agent.displayRotation(d);
              if(p.rotation!==rotation)throw Object.assign(Error('Android display turned. Wait for the new frame before touching.'),{code:'SCREEN_CHANGED',execution:'not_executed'});
              const size={width:p.deviceRotation%2?d.model.height:d.model.width,height:p.deviceRotation%2?d.model.width:d.model.height,rotation:p.deviceRotation};
              const touches=p.touches.map(t=>({...t,...require('./geometry.cjs').toNative(d.model,size.rotation,t.x*size.width,t.y*size.height)}));
              await rpc(d.endpoint,'sendTouch',{touches});
            }else if(p.action==='press')await agent.press(d,{button:p.button});
            else if(p.action==='type')await agent.typeText(d,{text:p.text,keys:p.keys,method:'paste',observe:'none'});
            else if(p.action==='clipboard'){
              if(p.copy===true){await agent.typeText(d,{keys:'ctrl+c',method:'paste',observe:'none'});await new Promise(r=>setTimeout(r,200));}
              return {ok:true,text:(await rpc(d.endpoint,'getClipboard')).text};
            }
            else if(p.action==='release')await agent.release(d);
            else throw Error('Invalid action');
            return {ok:true};
          },'device:'+p.udid.toUpperCase());return reply(200,result);
        }
        let result;
        switch(p.action){
          case 'status':{lastSeen=Date.now();const s=await controls.status();result={...s,device:s.devices.find(d=>d.udid===p.udid),viewerPlatform:'android',ready:s.devices.some(d=>d.udid===p.udid&&d.state==='Booted'),generation:1};break;}
          case 'activity':await controls.assertEnabled();controls.touch();result={ok:true};break;
          case 'install_status':result=await controls.request('app_install_status',{udid:p.udid,job:p.job,wait:0});break;
          case 'open':result=await controls.request('open_viewer',{udid:p.udid,_locale:p.locale});break;
          case 'catalog':result=await controls.request('viewer_catalog');break;
          case 'resources':result=await controls.request('resource_usage',{udid:p.udid,refresh:p.refresh===true});break;
          case 'create':{const created=await controls.request('create_device',{name:p.name,deviceType:p.deviceType,runtime:p.runtime});result={ok:created.ok!==false,created};break;}
          case 'rename':await controls.request('rename_device',{udid:p.targetUdid,name:p.name});result={devices:(await controls.status()).devices};break;
          case 'switch':result={job:await controls.request('viewer_switch',{udid:p.udid,targetUdid:p.targetUdid,_locale:p.locale,task:p.task})};if(result.job.activeUdid)opened.add(result.job.activeUdid);break;
          case 'boot':result=await controls.request('settings_boot',{udid:p.udid,memoryMode:p.memoryMode});break;
          case 'shutdown':result=await controls.request('settings_shutdown',{udid:p.udid});break;
          case 'release':result=await controls.request('press',{udid:p.udid,button:'release-input'});break;
          case 'restart':await controls.assertEnabled();result={ready:true,generation:Date.now()};break;
          case 'screenshot':result=await controls.request('screenshot',{udid:p.udid,destination:p.to==='clipboard'?'clipboard':'desktop'});break;
          case 'screenshot_destination':result=await controls.request('screenshot_destination',{destination:p.destination});break;
          case 'reveal':result=await controls.request('reveal_screenshot',{path:p.path,platform:'android'});break;
          default:return reply(400,{error:'Unknown action'});
        }
        return reply(200,{ok:true,...result});
      }catch(e){if(!res.headersSent)reply(409,{ok:false,errorCode:e.code||'ANDROID_VIEWER_FAILED',message:e.message,execution:e.execution||'unknown'});else res.end();}
    });
    server.requestTimeout=15000;server.headersTimeout=10000;
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});base='http://127.0.0.1:'+server.address().port;
  }
  return {
    configure:c=>{controls=c;},viewing:()=>streams.size>0||Date.now()-lastSeen<15000,
    wanted:()=>require('node:fs').existsSync(intent),forget,
    async open(udid,locale){await devices.target({udid});await start();opened.add(udid);await fs.mkdir(root,{recursive:true,mode:0o700});await fs.writeFile(intent,'true\n',{mode:0o600});return {url:url(udid,locale),ready:true};},
    existing:(udid,locale)=>server&&opened.has(udid)?url(udid,locale):null,
    async close(){await starting?.catch(()=>{});for(const c of streams)c.abort();streams.clear();if(server){server.close();server.closeAllConnections();}server=null;base=null;token=null;lastSeen=0;opened.clear();},
  };
}
module.exports={createViewer};
