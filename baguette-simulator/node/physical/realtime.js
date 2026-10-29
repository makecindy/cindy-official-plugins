'use strict';
(() => {
  class VideoWatchdog {
    constructor(now=()=>performance.now()){this.now=now;this.lastFrame=now();this.hasFrame=false;this.inputAt=null;}
    input(){if(this.inputAt===null)this.inputAt=this.now();}
    frame(){this.lastFrame=this.now();this.hasFrame=true;this.inputAt=null;}
    expired(held=false){
      const active=held||this.inputAt!==null,anchor=Math.max(this.lastFrame,this.inputAt??this.lastFrame);
      return this.now()-anchor>(active?5000:this.hasFrame?40000:25000);
    }
  }
  class TouchStream {
    constructor(send,onerror){this.send=send;this.onerror=onerror;this.current=null;}
    begin(points,screen){
      if(this.current)return false;
      const g={id:crypto.randomUUID(),screen,first:points,latest:null,begin:true,ending:false,busy:false};this.current=g;
      g.timer=setInterval(()=>{g.heartbeat=true;void this.pump(g);},500);void this.pump(g);return true;
    }
    move(points){const g=this.current;if(!g||g.ending)return;g.latest=points;void this.pump(g);}
    end(points){const g=this.current;if(!g)return;g.ending=true;g.last=points;g.latest=null;void this.pump(g);}
    cancel(){const g=this.current;if(!g)return;g.cancelled=true;g.latest=null;void this.pump(g);}
    async pump(g){
      if(g.busy||this.current!==g)return;g.busy=true;
      try{
        while(this.current===g){
          let op,points;
          if(g.begin){op='begin';points=g.first;g.begin=false;}
          else if(g.cancelled)op='cancel';
          else if(g.ending){op='end';points=g.last;}
          else if(g.latest){op='move';points=g.latest;g.latest=null;}
          else if(g.heartbeat){op='heartbeat';g.heartbeat=false;}
          else break;
          await this.send({op,gesture:g.id,screen:g.screen,points});
          if(op==='end'||op==='cancel'){this.clear(g);break;}
        }
      }catch(e){
        this.clear(g);
        // A lost acknowledgement is never replayed. Release this exact contact
        // if transport still works; the helper's lease covers a broken pipe.
        void this.send({op:'cancel',gesture:g.id}).catch(()=>{});this.onerror(e);
      }finally{g.busy=false;}
    }
    clear(g){clearInterval(g.timer);if(this.current===g)this.current=null;}
  }
  class PhysicalLive {
    constructor({udid,token,api,onframe,onstate,onerror}){
      Object.assign(this,{udid,token,api,onframe,onstate,onerror});this.closed=false;this.ready=false;
      this.input=new TouchStream(p=>{if(p.op==='begin')this.videoWatchdog?.input();return this.api('live-input',{...p,session:this.session});},onerror);
    }
    home(){this.videoWatchdog?.input();return this.api('live-input',{op:'home',session:this.session});}
    async run(){
      while(!this.closed){
        if(document.hidden){await new Promise(resolve=>setTimeout(resolve,500));continue;}
        let reader,decoder,watchdog;
        try{
          if(typeof VideoDecoder==='undefined')throw Error('当前浏览器不支持实时视频解码，请使用 Cindy 桌面端查看。');
          const r=await this.api('live');if(this.closed)return;this.onstate(r.control);
          if(!r.control.ready){await new Promise(resolve=>setTimeout(resolve,1000));continue;}
          this.session=r.control.session;this.screen=r.control.screen;
          this.abort=new AbortController();this.videoWatchdog=new VideoWatchdog();let count=0,stamp=0,config=null,needsKey=true;
          const response=await fetch(`/physical-stream?udid=${encodeURIComponent(this.udid)}&session=${encodeURIComponent(this.session)}`,{headers:{'X-Cindy-Clipboard':this.token},signal:this.abort.signal});
          if(!response.ok)throw Error('实时画面正在重新连接。');reader=response.body.getReader();
          const rebuild=()=>{
            if(decoder&&decoder.state!=='closed')decoder.close();
            decoder=new VideoDecoder({output:frame=>{
              try{if(!this.closed&&!document.hidden){this.videoWatchdog.frame();this.ready=true;this.onframe(frame,this.screen,++count);}}
              finally{frame.close();}
            },error:()=>this.abort.abort()});decoder.configure(config);
          };
          watchdog=setInterval(()=>{if(this.videoWatchdog.expired(!!this.input.current))this.abort.abort();},500);
          let bytes=new Uint8Array(0);
          while(!this.closed){
            const {value,done}=await reader.read();if(done)throw Error('实时画面已断开，正在恢复。');
            const merged=new Uint8Array(bytes.length+value.length);merged.set(bytes);merged.set(value,bytes.length);bytes=merged;
            while(bytes.length>=5){
              const size=new DataView(bytes.buffer,bytes.byteOffset,4).getUint32(0);
              if(size<1||size>8*1024*1024)throw Error('视频数据无效。');if(bytes.length<size+4)break;
              const type=bytes[4],data=bytes.subarray(5,size+4);bytes=bytes.subarray(size+4);
              if(type===3){
                const c=JSON.parse(new TextDecoder().decode(data));if(c.type!=='codec')continue;
                config={codec:c.codec,description:Uint8Array.from(atob(c.description),v=>v.charCodeAt(0)),optimizeForLatency:true};
                const supported=await VideoDecoder.isConfigSupported(config);if(!supported.supported)throw Error('当前设备不支持手机的视频格式。');
                rebuild();needsKey=true;continue;
              }
              if(!decoder||type>2)continue;
              // Hardware decode is asynchronous. Yield instead of discarding
              // the initial keyframe whenever one network read holds a burst.
              if(decoder.decodeQueueSize>3)await new Promise((resolve,reject)=>{
                const timer=setTimeout(()=>{decoder.removeEventListener('dequeue',next);reject(Error('视频解码暂时跟不上，正在恢复。'));},250);
                function next(){if(decoder.decodeQueueSize<=1){clearTimeout(timer);decoder.removeEventListener('dequeue',next);resolve();}}
                decoder.addEventListener('dequeue',next);next();
              });
              if(type===1&&needsKey)continue;
              if(type===2)rebuild();if(type!==1)needsKey=false;
              decoder.decode(new EncodedVideoChunk({type:type===1?'delta':'key',timestamp:stamp+=16667,data}));
            }
          }
        }catch(e){if(!this.closed)this.onerror(['AbortError','TypeError'].includes(e.name)?Error('实时连接暂时中断，正在自动恢复。'):e);}
        finally{
          this.ready=false;this.input.cancel();clearInterval(watchdog);this.abort?.abort();
          await reader?.cancel().catch(()=>{});if(decoder&&decoder.state!=='closed')decoder.close();
        }
        if(!this.closed)await new Promise(resolve=>setTimeout(resolve,1500));
      }
    }
    close(){this.closed=true;this.input.cancel();this.abort?.abort();}
  }
  if(typeof module!=='undefined')module.exports={TouchStream,VideoWatchdog};
  else window.PhysicalLive=PhysicalLive;
})();
