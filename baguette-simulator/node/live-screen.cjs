'use strict';
// Live Screen v1: Cindy itself shows one of this plugin's running devices on a
// phone. Cindy's main process calls the liveScreen.* worker methods directly;
// they are not Agent tools (main.js never forwards them). Frames go to Cindy
// from a loopback URL with a one-time capability, as repeated
// [u32 BE length][type][payload]: 0x01 avcC, 0x02 keyframe, 0x03 delta
// (Baguette's envelope as is), 0x04 JPEG, 0x06 PNG, 0x10 screen JSON
// {type:'screen', width, height, rotation} before the first frame and on change.
// An open stream counts as a viewer; every call honours the run switch.
const http=require('node:http');
const {randomBytes}=require('node:crypto');
const {deviceId}=require('./device-id.cjs');
const M=require('./control-model.js');
const {chord}=require('./keys.cjs');
const {toNative}=require('./android/geometry.cjs');

const SCREEN=0x10,PNG=0x06,MAX_MESSAGE=8*1024*1024,MAX_BUFFERED=4*1024*1024;
const FETCH_MS=30000,IDLE_MS=60000,READY_MS=8000,PROBE_MS=5000,MAX_PROBE=1024*1024;
// A probe takes about 1.5 s and one taken mid-turn reads the old orientation,
// while a still screen sends no more frames: probe once the frames pause.
const QUIET_MS=200;
// After the viewer asks for a pose, a run of picture changes within this window
// means the interface is turning: show the pose at once and let a probe
// confirm it. A turn animates about 50 changes; a Home Screen that refuses
// the pose still sends a handful, and a keyframe is not a change.
const TURN_MS=1500,TURN_FRAMES=12;
// A device shut down while shown keeps its stream open and simply stops
// sending, like a still screen: once the picture is still this long, check
// (at most this often) that it still runs.
const ALIVE_MS=4000;
const ID=/^[A-Za-z0-9._:-]{1,128}$/,PATH=/^\/live-screen\/([0-9a-f]{64})$/;
const ORIENTATIONS=['portrait','landscape-left','portrait-upside-down','landscape-right'];
const PHASES=['began','moved','stationary','ended','cancelled'],ENDED=new Set(['ended','cancelled']);
const MODIFIERS=['shift','control','option','command'];
const HEAD={'Content-Type':'application/x-cindy-live-screen','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const CAPS={ios:{touches:2,keyboard:true},ipados:{touches:2,keyboard:true},android:{touches:10,keyboard:true},tvos:{touches:0,keyboard:false},visionos:{touches:0,keyboard:true}};
// [button id, Cindy icon]. Ids are this plugin's existing press buttons where one exists.
// orientation-* set an absolute pose, so a phone can make the device follow its own.
const TURN=[['orientation-portrait','rotate-right'],['orientation-landscape','rotate-left']];
const ORIENTATION_BUTTONS={'orientation-portrait':'portrait','orientation-landscape':'landscape-left'};
const HANDHELD=[['home','home'],['app-switcher','recents'],['lock','lock'],['volume-up','volume-up'],['volume-down','volume-down'],['rotate-left','rotate-left'],['rotate-right','rotate-right'],['shake','shake'],...TURN];
const BUTTONS={ios:HANDHELD,ipados:HANDHELD,
  android:[['back','back'],['home','home'],['recents','recents'],['power','power'],['volume-up','volume-up'],['volume-down','volume-down'],['rotate-left','rotate-left'],['rotate-right','rotate-right'],...TURN],
  tvos:[['home','home'],['menu','menu'],['play-pause','play-pause']],visionos:[['home','home']]};
const LABELS={
  en:{home:'Home','app-switcher':'App Switcher',back:'Back',recents:'Recents',lock:'Lock',power:'Power','volume-up':'Volume Up','volume-down':'Volume Down','rotate-left':'Rotate Left','rotate-right':'Rotate Right','orientation-portrait':'Portrait','orientation-landscape':'Landscape',shake:'Shake',menu:'Menu','play-pause':'Play/Pause'},
  'zh-CN':{home:'主屏幕','app-switcher':'App 切换器',back:'返回',recents:'最近任务',lock:'锁定',power:'电源','volume-up':'调高音量','volume-down':'调低音量','rotate-left':'向左旋转','rotate-right':'向右旋转','orientation-portrait':'竖屏','orientation-landscape':'横屏',shake:'摇一摇',menu:'菜单','play-pause':'播放/暂停'},
};
const MESSAGES={
  en:{NOT_FOUND:'This device is not in the simulator plugin. Refresh the device list.',NOT_OPEN:'This screen is not open. Open it again.',NOT_RUNNING:'The device is not running. Start it first.',
    STREAM:'The device screen did not start. Check that the device finished starting, then open it again.',DISABLED:'Simulators are turned off in the plugin settings.',
    UNSUPPORTED:'This device or input is not available on the phone yet.',INVALID_ARGUMENT:'Invalid live screen request.',UNKNOWN_METHOD:'Unknown live screen method.'},
  'zh-CN':{NOT_FOUND:'模拟器插件里没有这台设备，请刷新设备列表。',NOT_OPEN:'这个画面没有打开，请重新打开。',NOT_RUNNING:'设备没有运行，请先启动。',
    STREAM:'设备画面没有启动。确认设备已启动完成后重新打开。',DISABLED:'模拟器运行已在插件设置中关闭。',
    UNSUPPORTED:'手机上暂不支持这台设备或这种操作。',INVALID_ARGUMENT:'实时画面请求无效。',UNKNOWN_METHOD:'未知的实时画面方法。'},
};
const failure=(code,message,execution='not_executed')=>Object.assign(Error(message),{code,execution});
const fail=(code,locale,key=code,detail)=>failure(code,MESSAGES[locale][key]+(detail?` (${detail})`:''));
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
// Host-injected fields start with "_"; anything else must be known.
const only=(v,keys)=>Object.keys(v).every(k=>k.startsWith('_')||keys.includes(k));
const unit=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1;

function message(type,payload){const out=Buffer.alloc(5+payload.length);out.writeUInt32BE(payload.length+1);out[4]=type;payload.copy(out,5);return out;}
// Picture size from an avcC record (ISO 14496-15) and its first SPS (H.264 7.3.2.1.1).
function avccSize(record){
  if(record.length<8||record[0]!==1||!(record[5]&31))return null;
  const length=record.readUInt16BE(6),nal=record.subarray(8,8+length),rbsp=[];
  if(nal.length<length)return null;
  for(let i=1,zeros=0;i<nal.length;i++){const b=nal[i];if(zeros>=2&&b===3){zeros=0;continue;}zeros=b?0:zeros+1;rbsp.push(b);}
  let bit=0;
  const u=n=>{let v=0;for(let k=0;k<n;k++,bit++){const byte=rbsp[bit>>3];if(byte===undefined)throw Error('short SPS');v=v*2+((byte>>(7-(bit&7)))&1);}return v;};
  const ue=()=>{let z=0;while(!u(1))if(++z>31)throw Error('bad SPS');return 2**z-1+u(z);};
  const se=()=>{const k=ue();return k%2?(k+1)/2:-k/2;};
  try{
    const profile=u(8);u(16);ue();
    let chroma=1,separate=0;
    if([100,110,122,244,44,83,86,118,128,138,139,134,135].includes(profile)){
      chroma=ue();if(chroma===3)separate=u(1);ue();ue();u(1);
      if(u(1))for(let i=0;i<(chroma===3?12:8);i++)if(u(1))for(let j=0,last=8,next=8;j<(i<6?16:64);j++){if(next)next=(last+se()+256)%256;last=next||last;}
    }
    ue();const poc=ue();
    if(poc===0)ue();else if(poc===1){u(1);se();se();for(let i=ue();i>0;i--)se();}
    ue();u(1);
    const mbWidth=ue()+1,mbHeight=ue()+1,frames=u(1);if(!frames)u(1);u(1);
    const crop=u(1)?[ue(),ue(),ue(),ue()]:[0,0,0,0],type=separate?0:chroma;
    const cropX=type===1||type===2?2:1,cropY=(type===1?2:1)*(2-frames);
    return {width:mbWidth*16-cropX*(crop[0]+crop[1]),height:(2-frames)*mbHeight*16-cropY*(crop[2]+crop[3])};
  }catch{return null;}
}
function pngSize(b){return b.length>=24&&b.readUInt32BE(0)===0x89504e47&&b.toString('latin1',12,16)==='IHDR'?{width:b.readUInt32BE(16),height:b.readUInt32BE(20)}:null;}
function jpegSize(b){
  for(let i=2;i+9<b.length;){
    if(b[i]!==0xff){return null;}
    const marker=b[i+1];if(marker===0xff){i++;continue;}
    if(marker>=0xc0&&marker<=0xcf&&![0xc4,0xc8,0xcc].includes(marker))return {width:b.readUInt16BE(i+7),height:b.readUInt16BE(i+5)};
    i+=2+b.readUInt16BE(i+2);
  }
  return null;
}
// Upright (what the phone shows) to the native portrait picture: the inverse
// of `rotation` clockwise quarter turns (sim-native.js visualToPortraitNorm).
function toPortrait(x,y,rotation){return rotation===1?{x:y,y:1-x}:rotation===2?{x:1-x,y:1-y}:rotation===3?{x:1-y,y:x}:{x,y};}
// Baguette's edge hint for a turned screen (sim-native.js visualToPortraitEdge).
function portraitEdge(edge,rotation){return edge==='bottom'&&rotation?(rotation===3?'top':'right'):edge;}
function kindOf(device){const p=M.platform(device);return p==='android'?'android':p==='tvOS'?'tvos':p==='visionOS'?'visionos':M.family(device)==='ipad'?'ipados':'ios';}
const stateOf=device=>({Booted:'running',Booting:'starting'})[device.state]||'off';
const PUNCTUATION={Minus:'-',Equal:'=',BracketLeft:'[',BracketRight:']',Backslash:'\\',Semicolon:';',Quote:"'",Backquote:'`',Comma:',',Period:'.',Slash:'/'};
// KeyboardEvent.code to the Android key names typeText accepts.
function androidKey(code,modifiers){
  const base=/^Key[A-Z]$/.test(code)?code.slice(3).toLowerCase():/^Digit\d$/.test(code)?code.slice(5):code==='Space'?'space':PUNCTUATION[code]
    ||(/^(Enter|Escape|Tab|Backspace|Delete|Arrow(Up|Down|Left|Right)|F([1-9]|1[0-2]))$/.test(code)?code:null);
  if(!base)throw Error('Unsupported key');
  return [...modifiers.map(m=>({shift:'shift',control:'ctrl',option:'alt',command:'cmd'})[m]),base].join('+');
}
function validEvents(events,locale){
  if(!Array.isArray(events)||events.length>64)throw fail('INVALID_ARGUMENT',locale,undefined,'events: an array of at most 64');
  return events.map((e,i)=>{
    const bad=what=>fail('INVALID_ARGUMENT',locale,undefined,`events[${i}]: ${what}`);
    if(!plain(e))throw bad('not an object');
    if(e.kind==='touch'){
      if(!only(e,['kind','touches','edge'])||!Array.isArray(e.touches)||!e.touches.length||e.touches.length>10)throw bad('touch needs 1–10 touches');
      const ids=new Set();
      for(const t of e.touches){if(!plain(t)||!only(t,['id','x','y','phase'])||!Number.isInteger(t.id)||t.id<0||t.id>9||ids.has(t.id)||!unit(t.x)||!unit(t.y)||!PHASES.includes(t.phase))throw bad('invalid touch');ids.add(t.id);}
      if(e.edge!==undefined&&(!['bottom','top','left','right'].includes(e.edge)||!e.touches.some(t=>t.phase==='began')))throw bad('edge is bottom, top, left or right, only as a touch begins');
      return {kind:'touch',touches:e.touches.map(({id,x,y,phase})=>({id,x,y,phase})),...(e.edge?{edge:e.edge}:{})};
    }
    if(e.kind==='press'){if(!only(e,['kind','button'])||typeof e.button!=='string'||!/^[a-z0-9-]{1,32}$/.test(e.button))throw bad('invalid button');return {kind:'press',button:e.button};}
    if(e.kind==='text'){if(!only(e,['kind','text'])||typeof e.text!=='string'||!e.text.length||e.text.length>4096||e.text.includes('\0'))throw bad('text must be 1–4096 characters');return {kind:'text',text:e.text};}
    if(e.kind==='key'){
      const m=e.modifiers??[];
      if(!only(e,['kind','code','modifiers'])||typeof e.code!=='string'||!/^[A-Za-z0-9]{1,32}$/.test(e.code)||!Array.isArray(m)||m.length>4||new Set(m).size!==m.length||m.some(x=>!MODIFIERS.includes(x)))throw bad('invalid key');
      return {kind:'key',code:e.code,modifiers:[...m]};
    }
    if(e.kind==='release'){if(!only(e,['kind']))throw bad('release takes no fields');return {kind:'release'};}
    throw bad('unknown kind');
  });
}
// Baguette carries one or two fingers (touch1-* / touch2-*). The first two
// contacts are sent; a second finger landing lifts the first and starts a
// two-finger touch, as Baguette's own touch source does. Contacts left over
// after a touch ends are ignored until they lift.
function appleTouches(st,event,size,rotation){
  const out=[],live=event.touches.filter(t=>!ENDED.has(t.phase)),by=new Map(event.touches.map(t=>[t.id,t]));
  const at=id=>{const t=by.get(id);if(t){const p=toPortrait(t.x,t.y,rotation);st.last.set(id,{x:p.x*size.width,y:p.y*size.height});}return st.last.get(id);};
  const one=phase=>{const p=at(st.ids[0]);out.push({type:`touch1-${phase}`,x:p.x,y:p.y,...size,...(st.edge?{edge:st.edge}:{})});};
  const two=phase=>{const a=at(st.ids[0]),b=at(st.ids[1]);out.push({type:`touch2-${phase}`,x1:a.x,y1:a.y,x2:b.x,y2:b.y,...size});};
  const gone=id=>!by.has(id)||ENDED.has(by.get(id).phase);
  let restart=false;
  if(st.mode==='one'){
    if(gone(st.ids[0])){one('up');st.mode=null;}
    else if(live.length>1){one('up');st.mode=null;restart=true;}
    else if(by.get(st.ids[0]).phase==='moved')one('move');
  }else if(st.mode==='two'){
    if(st.ids.some(gone)){two('up');st.mode=null;}
    else if(st.ids.some(id=>by.get(id).phase==='moved'))two('move');
  }
  if(st.mode===null){
    st.edge=null;
    const fresh=restart?live:live.filter(t=>t.phase==='began');
    if(live.length>fresh.length)st.mode='drain';
    else if(fresh.length===1){st.mode='one';st.ids=[fresh[0].id];st.edge=event.edge?portraitEdge(event.edge,rotation):null;one('down');}
    else if(fresh.length>1){st.mode='two';st.ids=[fresh[0].id,fresh[1].id];two('down');}
  }else if(st.mode==='drain'&&!live.length)st.mode=null;
  return out;
}
function appleRelease(st,size){
  const out=[];
  if(st.mode==='one'){const p=st.last.get(st.ids[0]);out.push({type:'touch1-up',x:p.x,y:p.y,...size,...(st.edge?{edge:st.edge}:{})});}
  if(st.mode==='two'){const a=st.last.get(st.ids[0]),b=st.last.get(st.ids[1]);out.push({type:'touch2-up',x1:a.x,y1:a.y,x2:b.x,y2:b.y,...size});}
  st.mode=null;st.edge=null;return out;
}

// The interface orientation, from Baguette's accessibility hit test. Over
// HTTP: Baguette handles a stream's messages one at a time, so a probe on the
// stream would hold every touch behind it for the 1–2 s it takes.
function describeOrientation(base,udid){
  return new Promise((resolve,reject)=>{
    const request=http.get(`${base}/simulators/${encodeURIComponent(udid)}/describe-ui.json?x=1&y=1`,{timeout:PROBE_MS,headers:{origin:base}},res=>{
      const chunks=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>MAX_PROBE)request.destroy(Error('Probe answer too large'));else chunks.push(chunk);});
      res.on('end',()=>{try{resolve(res.statusCode===200?JSON.parse(Buffer.concat(chunks).toString('utf8')):null);}catch{resolve(null);}});
      res.on('error',reject);
    });
    request.once('timeout',()=>request.destroy(Error('Probe timed out')));
    request.once('error',reject);
  });
}
function createLiveScreen({devices,tasks,controls,appleBase,android,appleHost=process.platform==='darwin'&&process.arch==='arm64',describeUi=describeOrientation,
  serve=(...a)=>require('./android/stream.cjs').serve(...a),rpc=(...a)=>require('./android/grpc.cjs').rpc(...a),WebSocket=globalThis.WebSocket,now=Date.now}){
  const sessions=new Map(),tokens=new Map();let server=null,listening=null;
  const timer=setInterval(()=>sweep(),1000);timer.unref?.();
  function listen(){
    listening||=new Promise((resolve,reject)=>{
      const s=http.createServer((req,res)=>{
        const match=PATH.exec(req.url||''),session=req.method==='GET'&&req.headers.host===`127.0.0.1:${s.address().port}`&&match?tokens.get(match[1]):null;
        if(!session){res.writeHead(404,{'Cache-Control':'no-store'});return res.end();}
        // One GET per capability; it also ends with the stream or close().
        tokens.delete(match[1]);attach(session,res);
      });
      s.headersTimeout=10000;s.requestTimeout=0;
      s.once('error',reject);s.listen(0,'127.0.0.1',()=>{server=s;resolve(`http://127.0.0.1:${s.address().port}`);});
    }).catch(error=>{listening=null;throw error;});
    return listening;
  }
  const enabled=async locale=>{
    try{await controls().assertEnabled();}
    catch(error){if(['RUNTIME_DISABLED','SETTINGS_UNREADABLE'].includes(error.code))throw fail('DISABLED',locale);throw error;}
  };
  const checkId=(id,locale)=>{if(typeof id!=='string'||!ID.test(id))throw fail('INVALID_ARGUMENT',locale,undefined,'id');return deviceId(id);};
  function opened(p,locale){const s=sessions.get(checkId(p.id,locale));if(!s)throw fail('NOT_FOUND',locale,'NOT_OPEN');return s;}
  const send=(s,value)=>{if(s.ws?.readyState!==1)return false;s.ws.send(JSON.stringify(value));return true;};
  function probe(s){
    if((s.kind!=='ios'&&s.kind!=='ipados')||s.probing||s.closed||s.ws?.readyState!==1)return;
    s.probing=true;const at=s.probeAt=now();
    describeUi(s.base,s.udid).then(env=>answered(s,at,env),()=>answered(s,at,null));
  }
  const keyframe=s=>s.kind==='android'?s.control.keyframe?.():send(s,{type:'force_idr'});
  function write(s,data){const head=Buffer.alloc(4);head.writeUInt32BE(data.length);s.res.write(head);s.res.write(data);}
  function screen(s){
    const value=JSON.stringify({type:'screen',width:s.size.width,height:s.size.height,rotation:s.rotation});
    if(value!==s.sent){s.sent=value;s.res.write(message(SCREEN,Buffer.from(value)));}
  }
  // `data` is a Baguette envelope (type byte first).
  function forward(s,type,data){
    if(![1,2,3,4].includes(type)||!s.size)return;
    const backlog=s.res.writableLength>MAX_BUFFERED;
    if(data.length>MAX_MESSAGE||(type!==1&&backlog)){
      // A dropped picture breaks the delta chain: restart from a keyframe.
      if(type===1)return;
      s.awaitingKey=true;
      if(!backlog)keyframe(s);else if(!s.draining){s.draining=true;s.res.once('drain',()=>{s.draining=false;keyframe(s);});}
      return;
    }
    if(type===3&&s.awaitingKey)return;
    if(type===2)s.awaitingKey=false;
    screen(s);write(s,data);
  }
  function binary(s,data){
    const type=data[0];s.framed=true;s.lastFrameAt=now();settle(s);
    // The interface moved right after a requested turn: it is following it.
    const turn=s.pendingTurn;
    if(turn&&now()>turn.until)s.pendingTurn=null;
    else if(turn&&type===3&&++turn.frames>=TURN_FRAMES){
      s.pendingTurn=null;
      if(turn.rotation!==s.rotation){s.rotation=turn.rotation;s.turnedAt=now();if(s.res&&s.size)screen(s);}
    }
    if(type===1){s.avcc=data;s.size=avccSize(data.subarray(1))||s.size;}
    else if(type===4&&!s.size)s.size=jpegSize(data.subarray(1));
    if(s.res)forward(s,type,data);
  }
  // Probe when the picture has paused; a change during a probe asks for another.
  function settle(s){
    if(s.kind!=='ios'&&s.kind!=='ipados')return;
    clearTimeout(s.quiet);
    s.quiet=setTimeout(()=>{if(s.closed||!s.res)return;if(s.probing)s.reprobe=true;else{s.framed=false;probe(s);}},QUIET_MS);
    s.quiet.unref?.();
  }
  function answered(s,at,env){
    // Closed, or given up on (the sweep) and asked again since.
    if(s.closed||!s.probing||s.probeAt!==at)return;
    s.probing=false;
    // Asked before a turn was shown, it describes the old pose: ignore it.
    const stale=s.turnedAt>s.probeAt;
    if(s.reprobe||stale){s.reprobe=false;s.framed=false;probe(s);}
    if(stale)return;
    const rotation=ORIENTATIONS.indexOf(env?.ok&&env.tree?.screen?.orientation);
    if(rotation<0)return;
    s.oriented=true;
    // Someone else turned the device (or the App did): step from what shows.
    if(rotation!==s.rotation)s.requested=undefined;
    s.rotation=rotation;if(s.res&&s.size)screen(s);
  }
  async function connect(s,device,locale){
    s.base=await appleBase();
    const ws=new WebSocket(`${s.base.replace(/^http:/,'ws:')}/simulators/${encodeURIComponent(device.udid)}/stream?format=avcc&version=v2${s.kind==='ios'||s.kind==='ipados'?'&display=phone':''}`);
    ws.binaryType='arraybuffer';s.ws=ws;
    let settle;const ready=new Promise((resolve,reject)=>{settle={resolve,reject};});
    const timeout=setTimeout(()=>settle.reject(fail('NOT_RUNNING',locale,'STREAM')),READY_MS);
    ws.onopen=()=>{send(s,{type:'set_fps',fps:s.fps||60});send(s,{type:'force_idr'});probe(s);};
    ws.onmessage=e=>{if(typeof e.data!=='string'){binary(s,Buffer.from(e.data));if(s.size)settle.resolve();}};
    ws.onerror=ws.onclose=()=>{settle.reject(fail('NOT_RUNNING',locale,'STREAM'));end(s);};
    try{await ready;}finally{clearTimeout(timeout);}
    // The first orientation, so the first 0x10 is usually already right.
    for(let i=0;i<15&&s.probing&&!s.oriented&&!s.closed;i++)await new Promise(r=>setTimeout(r,100));
    return s.size;
  }
  function attach(s,res){
    s.res=res;s.awaitingKey=true;s.seen=now();
    res.once('close',()=>end(s));
    if(s.kind!=='android'){
      res.writeHead(200,HEAD);screen(s);
      if(s.avcc)write(s,s.avcc);
      keyframe(s);return;
    }
    s.abort=new AbortController();
    const sink={begin:()=>{res.writeHead(200,HEAD);res.flushHeaders();if(s.fps)s.control.fps?.(s.fps);},frame:(pose,payload)=>{
      // The emulator turns its own picture with the device, so it is upright.
      s.device=pose.device;
      if(!pose.png){s.size={width:pose.width,height:pose.height};return forward(s,payload[0],payload);}
      const size=pngSize(payload);if(!size||payload.length>=MAX_MESSAGE)return;
      s.size=size;screen(s);res.write(message(PNG,payload));
    }};
    serve({d:s.d,agent:android().agent,res,signal:s.abort.signal,format:'avcc',sink,control:s.control}).catch(()=>{}).finally(()=>end(s));
  }
  function end(s){
    if(s.closed)return;s.closed=true;clearTimeout(s.quiet);
    if(sessions.get(s.key)===s)sessions.delete(s.key);
    tokens.delete(s.token);
    // Lift a finger the phone left down.
    if(s.kind!=='android'&&s.size)for(const value of appleRelease(s.touch,s.size))send(s,value);
    if(s.kind==='android'&&s.down)androidStep(s,{kind:'release'}).catch(()=>{});
    try{s.ws?.close();}catch{}
    s.abort?.abort();
    if(s.res&&!s.res.writableEnded)s.res.end();
  }
  function closeAll(){
    for(const s of [...sessions.values()])end(s);
    if(server){server.close();server.closeAllConnections?.();}
    server=null;listening=null;
  }
  function sweep(){
    const t=now();
    for(const s of [...sessions.values()]){
      if(t-s.seen>(s.res?IDLE_MS:FETCH_MS)){end(s);continue;}
      if(s.probing&&t-s.probeAt>PROBE_MS)s.probing=false;
      // A still screen sends nothing and cannot have turned: probe after frames,
      // once they pause (mid-turn reads the old pose); a picture that never
      // pauses is still probed every few seconds.
      if(s.res&&s.framed&&!s.probing&&(t-(s.lastFrameAt||0)>=QUIET_MS||t-(s.probeAt||0)>=3000)){s.framed=false;probe(s);}
      if(s.res&&!s.checking&&t-(s.lastFrameAt||0)>=ALIVE_MS&&t-(s.checkedAt||0)>=ALIVE_MS){
        s.checking=true;s.checkedAt=t;
        simulators().then(all=>{const d=all.find(x=>deviceId(x.udid)===s.key);if(!d||stateOf(d)!=='running')end(s);},()=>{})
          .finally(()=>{s.checking=false;});
      }
    }
    if(sessions.size)Promise.resolve().then(()=>controls().assertEnabled()).catch(()=>closeAll());
  }
  // Simulators only: a physical device has its own live view and is not offered here yet.
  const simulators=async()=>(await devices()).filter(d=>d.kind!=='physical');
  async function list(){
    const all=(await simulators()).filter(d=>typeof d.udid==='string'&&ID.test(d.udid));
    return {screens:await Promise.all(all.map(async d=>({id:d.udid,name:String(d.name||'').slice(0,128),platform:kindOf(d),state:stateOf(d),
      taskIds:await Promise.resolve(tasks?.forDevice(d.udid,32)).catch(()=>[])||[]})))};
  }
  async function open(p,locale){
    const key=checkId(p.id,locale);
    if(!only(p,['id']))throw fail('INVALID_ARGUMENT',locale);
    await enabled(locale);
    const device=(await simulators()).find(d=>deviceId(d.udid)===key);
    if(!device)throw fail('NOT_FOUND',locale);
    if(stateOf(device)!=='running')throw fail('NOT_RUNNING',locale);
    const kind=kindOf(device);
    if(kind!=='android'&&(!appleHost||typeof WebSocket!=='function'))throw fail('UNSUPPORTED',locale);
    const previous=sessions.get(key);if(previous)end(previous);
    const s={key,udid:device.udid,kind,token:randomBytes(32).toString('hex'),seen:now(),res:null,size:null,sent:null,rotation:0,
      touch:{mode:null,ids:[],last:new Map(),edge:null},control:{},closed:false};
    sessions.set(key,s);
    try{
      const base=await listen();
      if(kind==='android'){s.d=await android().devices.target({udid:device.udid}).catch(error=>{throw error.code==='DEVICE_NOT_BOOTED'?fail('NOT_RUNNING',locale):error;});s.size={width:s.d.model.width,height:s.d.model.height};}
      else await connect(s,device,locale);
      if(s.closed)throw fail('NOT_RUNNING',locale,'STREAM');
      tokens.set(s.token,s);s.seen=now();controls().touch();
      const caps=CAPS[kind];
      return {url:`${base}/live-screen/${s.token}`,screen:{platform:kind,width:s.size.width,height:s.size.height,cornerRadius:M.screenCorner(device),
        maxTouches:caps.touches,keyboard:caps.keyboard,buttons:BUTTONS[kind].map(([id,icon])=>({id,icon,label:LABELS[locale][id]}))}};
    }catch(error){end(s);throw error;}
  }
  // Results of the existing guarded operations (run switch, device lock, activity).
  async function operation(method,params){
    const result=await controls().request(method,params);
    if(result?.ok===false)throw failure(result.errorCode||'FAILED',result.message||'Operation failed.',result.execution||'unknown');
    if(result?.stateError)throw failure(result.stateError.code,result.stateError.message,result.execution||'unknown');
    return result;
  }
  async function shake(s){
    const c=controls();
    await c.exclusive(async()=>{
      await c.assertEnabled();
      // The controller page's shake route on the native server.
      const status=await new Promise((resolve,reject)=>{
        const request=http.request(`${s.base}/simulators/${encodeURIComponent(s.udid)}/shake`,{method:'POST',timeout:10000,headers:{origin:s.base}},res=>{res.resume();resolve(res.statusCode);});
        request.once('timeout',()=>request.destroy(Error('Shake timed out')));request.once('error',error=>reject(failure('SHAKE_UNCONFIRMED',error.message,'unknown')));request.end();
      });
      if(status<200||status>299)throw failure('SHAKE_FAILED',`Shake was not accepted (HTTP ${status}).`,'unknown');
      c.touch();
    },'device:'+deviceId(s.udid));
  }
  async function appleStep(s,e,locale){
    if(e.kind==='touch'||e.kind==='release'){
      if(e.kind==='touch'&&(s.ws?.readyState!==1||!s.size))throw fail('NOT_RUNNING',locale,'STREAM');
      for(const value of e.kind==='touch'?appleTouches(s.touch,e,s.size,s.rotation):appleRelease(s.touch,s.size||{width:0,height:0}))
        if(!send(s,value))throw failure('NOT_RUNNING',MESSAGES[locale].STREAM,'unknown');
      return;
    }
    if(e.kind==='text')return operation('type_text',{udid:s.udid,text:e.text,method:'paste'});
    if(e.kind==='key')return operation('type_text',{udid:s.udid,keys:[[...e.modifiers,e.code].join('+')]});
    if(Object.hasOwn(ORIENTATION_BUTTONS,e.button)){
      const orientation=ORIENTATION_BUTTONS[e.button];
      s.pendingTurn={rotation:ORIENTATIONS.indexOf(orientation),until:now()+TURN_MS,frames:0};
      await operation('set_state',{udid:s.udid,orientation});
      s.requested=ORIENTATIONS.indexOf(orientation);s.framed=true;settle(s);return;
    }
    if(e.button==='rotate-left'||e.button==='rotate-right'){
      // An iPhone's Home Screen and most Apps never turn upside down: skip that
      // pose, so every press visibly turns the picture. An iPad takes all four.
      const turn=e.button==='rotate-right'?1:3;
      let next=((s.requested??s.rotation??0)+turn)%4;
      if(s.kind==='ios'&&ORIENTATIONS[next]==='portrait-upside-down')next=(next+turn)%4;
      const orientation=ORIENTATIONS[next];
      s.pendingTurn={rotation:next,until:now()+TURN_MS,frames:0};
      await operation('set_state',{udid:s.udid,orientation});
      s.requested=ORIENTATIONS.indexOf(orientation);s.framed=true;settle(s);return;
    }
    if(e.button==='shake')return shake(s);
    return operation('press',{udid:s.udid,button:e.button});
  }
  async function androidStep(s,e){
    if(e.kind==='press'&&Object.hasOwn(ORIENTATION_BUTTONS,e.button))
      return operation('set_state',{udid:s.udid,orientation:ORIENTATION_BUTTONS[e.button]});
    if(e.kind==='press'&&e.button.startsWith('rotate-')){
      // Like the viewer: turn the emulator's physical pose from what it shows.
      const next=((s.device||0)-(e.button==='rotate-right'?1:-1)+4)%4;
      return operation('set_state',{udid:s.udid,orientation:ORIENTATIONS[next]});
    }
    const c=controls(),{devices:own,agent}=android();
    return c.exclusive(async()=>{
      await c.assertEnabled();const d=await own.target({udid:s.udid});c.touch();
      if(e.kind==='touch'){
        const turned=(s.device||0)%2,size={width:turned?d.model.height:d.model.width,height:turned?d.model.width:d.model.height};
        s.down=true;
        await rpc(d.endpoint,'sendTouch',{touches:e.touches.map(t=>({identifier:t.id,pressure:ENDED.has(t.phase)?0:1024,...toNative(d.model,s.device||0,t.x*size.width,t.y*size.height)}))});
        s.down=e.touches.some(t=>!ENDED.has(t.phase));
      }
      else if(e.kind==='release'){await agent.release(d);s.down=false;}
      else if(e.kind==='text')await agent.typeText(d,{text:e.text,method:'paste',observe:'none'});
      else if(e.kind==='key')await agent.typeText(d,{keys:androidKey(e.code,e.modifiers),method:'paste',observe:'none'});
      else await agent.press(d,{button:e.button==='recents'?'app-switcher':e.button});
    },'device:'+deviceId(s.udid));
  }
  const fingerMove=e=>e.kind==='touch'&&!e.edge&&e.touches.every(t=>t.phase==='moved'||t.phase==='stationary');
  const sameFingers=(a,b)=>a.touches.length===b.touches.length&&a.touches.every(t=>b.touches.some(u=>u.id===t.id));
  async function input(p,locale){
    const s=opened(p,locale);
    if(!only(p,['id','events']))throw fail('INVALID_ARGUMENT',locale);
    const events=validEvents(p.events,locale),caps=CAPS[s.kind];
    // The whole batch is checked before anything is sent.
    events.forEach((e,i)=>{
      if((e.kind==='touch'&&!caps.touches)||((e.kind==='text'||e.kind==='key')&&!caps.keyboard))throw fail('UNSUPPORTED',locale,undefined,`events[${i}]`);
      if(e.kind==='press'&&!BUTTONS[s.kind].some(([id])=>id===e.button))throw fail('INVALID_ARGUMENT',locale,undefined,`events[${i}]: unknown button`);
      if(e.kind==='key')try{if(s.kind==='android')androidKey(e.code,e.modifiers);else chord(e.code,e.modifiers);}catch{throw fail('INVALID_ARGUMENT',locale,undefined,`events[${i}]: unsupported key`);}
    });
    await enabled(locale);
    s.seen=now();controls().touch();
    let completed=0;
    // Only the latest position of a moving finger matters; earlier moves in the
    // batch would replay behind the finger (a phone samples at up to 120 Hz).
    const steps=[];
    for(const e of events){
      const last=steps.at(-1);
      if(last&&fingerMove(e)&&fingerMove(last.e)&&sameFingers(last.e,e)){last.e=e;last.n++;}else steps.push({e,n:1});
    }
    try{for(let i=0;i<steps.length;){
      // A run of keys is one keyboard operation (up to type_text's 40), not one helper launch per key.
      let run=0;if(s.kind!=='android')while(run<40&&steps[i+run]?.e.kind==='key')run++;
      if(run>1){await operation('type_text',{udid:s.udid,keys:steps.slice(i,i+run).map(({e})=>[...e.modifiers,e.code].join('+'))});completed+=run;i+=run;continue;}
      await (s.kind==='android'?androidStep(s,steps[i].e):appleStep(s,steps[i].e,locale));completed+=steps[i].n;i++;
    }}
    catch(error){throw Object.assign(failure(error.code||'INPUT_FAILED',error.message,completed?'unknown':error.execution||'unknown'),{completed});}
    return {execution:completed?'executed':'not_executed',completed};
  }
  async function control(p,locale){
    const s=opened(p,locale);
    if(!only(p,['id','fps','keyframe'])||(p.fps!==undefined&&(!Number.isInteger(p.fps)||p.fps<1||p.fps>60))||(p.keyframe!==undefined&&typeof p.keyframe!=='boolean'))throw fail('INVALID_ARGUMENT',locale,undefined,'fps 1–60, keyframe boolean');
    await enabled(locale);
    // Also the keepalive: an open phone screen is activity, like an open viewer.
    s.seen=now();controls().touch();
    if(p.fps!==undefined){s.fps=p.fps;if(s.kind==='android')s.control.fps?.(p.fps);else send(s,{type:'set_fps',fps:p.fps});}
    if(p.keyframe)keyframe(s);
    return {};
  }
  async function request(method,p){
    p=plain(p)?p:{};
    const locale=p._locale==='zh-CN'?'zh-CN':'en';
    if(method==='liveScreen.list')return list();
    if(method==='liveScreen.open')return open(p,locale);
    if(method==='liveScreen.input')return input(p,locale);
    if(method==='liveScreen.control')return control(p,locale);
    if(method==='liveScreen.close'){const key=checkId(p.id,locale),s=sessions.get(key);if(s)end(s);return {closed:!!s};}
    throw fail('UNKNOWN_METHOD',locale);
  }
  return {request,closeAll,sweep,viewing:()=>[...sessions.values()].some(s=>s.res&&!s.closed),
    stop(){clearInterval(timer);closeAll();}};
}
module.exports={createLiveScreen,validEvents,appleTouches,appleRelease,toPortrait,portraitEdge,avccSize,pngSize,jpegSize,androidKey,message,kindOf};
