'use strict';
// Keep the live canvas and its input listeners while replacing only the body.
// Model lookup / PDF conversion never run on the preview's frame path.
window.PhysicalShell=class {
  constructor(frame,area,onchange){this.frame=frame;this.area=area;this.onchange=onchange;this.key=null;this.viewport=null;this.generation=0;this.cache=new Map();this.pending=false;this.retryAt=0;}
  update(screen){
    const key=JSON.stringify(screen);if(key===this.key&&(this.viewport||this.pending||Date.now()<this.retryAt))return;
    this.key=key;const generation=++this.generation;this.viewport=null;this.pending=true;
    this.frame.replaceChildren(this.area);this.frame.removeAttribute('data-bezel');this.onchange();
    const mount=async()=>{
      let def=this.cache.get(key);
      if(!def){
        const url=new URL(location.href);url.pathname+='/definition.json';
        const response=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!response.ok)return;
        const result=await response.json();
        if(JSON.stringify(result.deviceScreen)!==key||!result.screen?.bezelImage)return;
        def=result.screen;
        await Promise.all([def.bezelImage.rest,def.maskImage].filter(Boolean).map(async src=>{const image=new Image();image.src=src;await image.decode();}));
        this.cache.set(key,def);
      }
      if(generation!==this.generation)return;
      const bezel=new window.Baguette._Bezel(def,{bare:false});bezel.mount(this.frame);
      bezel.canvas.replaceWith(this.area);
      bezel.wrapper.className='physical-bezel';bezel.frameImg.className='physical-bezel-image';
      this.viewport=def.viewport;this.frame.setAttribute('data-bezel','');this.onchange();
    };
    // Retry transient lookup/fold races without putting work on every frame.
    void mount().catch(()=>{}).finally(()=>{if(generation===this.generation){this.pending=false;this.retryAt=Date.now()+5000;}});
  }
};
