'use strict';
// Injected into the embedded device page before its scripts run.
// - The 3D stage bakes the page background into its stream when it attaches and
//   only changes it from the workbench theme button, which Cindy hides. A nested
//   frame can attach before Cindy's light/dark mode reaches it, so the stage
//   would keep the wrong backdrop; re-send the page background on mode changes.
// - Streams are throttled while the page is hidden (see below).
// - window.__cindyPose lets the controller read and set a foldable's hinge.
(function () {
  const panels = new Set();
  let posed = null, hinge = null;
  const live = () => (posed && panels.has(posed) ? posed : null);
  const controller = () => {
    try { return typeof window.parent?.cindySim?.measure === 'function' ? window.parent.cindySim : null; }
    catch { return null; }
  };
  function layout(animate = false) {
    // Same-origin embedded controller; data arrival drives calibration instead
    // of waiting for its periodic posture/resize timers.
    try { controller()?.measure({animate})?.catch?.(() => {}); } catch {}
  }
  window.__cindyLayoutReady = () => live()?.cindyReveal?.();
  window.__cindyPose = {
    get: () => (live() ? hinge : null),
    set: (degrees) => { if (live()) posed.send({ type: 'set_pose', hingeDegrees: Number(degrees) }); },
    // How far the book is turned clockwise on screen. The server rolls it so the
    // guest stands the way it is held: the cover upright in portrait, the
    // unfolded panel in landscape-left.
    roll: () => (live() ? roll(posed) : null),
    turn: (step) => turn(step),
  };
  // Screen corners are normalized to the rendered frame, not to its CSS
  // box. Measure only the lit screen, accounting for object-fit letterboxing.
  window.__cindyView = () => {
    const panel = live(), canvas = panel && panel.canvas;
    const pieces = panel && panel.screenQuad && panel.screenQuad.pieces;
    if (!canvas?.hasAttribute('data-painted') || !canvas.width || !canvas.height || !pieces?.length) return null;
    const box = canvas.getBoundingClientRect();
    const rect = window.Baguette._ScreenQuad.contentRect(canvas);
    const corners = pieces.flatMap(({quad:q}) => [q.topLeft,q.topRight,q.bottomRight,q.bottomLeft]);
    if (!corners.every(p => Number.isFinite(p.u) && Number.isFinite(p.v))) return null;
    const width = (Math.max(...corners.map(p=>p.u))-Math.min(...corners.map(p=>p.u))) * rect.width;
    const height = (Math.max(...corners.map(p=>p.v))-Math.min(...corners.map(p=>p.v))) * rect.height;
    if (!(width > 0 && height > 0 && rect.width > 0 && rect.height > 0)) return null;
    // The stream contains generous camera margins. Fit the device and the
    // hardware controls, not that whole image. Screen metadata has no body
    // silhouette, so reserve a small proportional bezel allowance around it.
    const bezel = Math.max(width, height) * .04;
    let left = Math.min(...corners.map(p=>p.u))*rect.width - bezel;
    let right = Math.max(...corners.map(p=>p.u))*rect.width + bezel;
    let top = Math.min(...corners.map(p=>p.v))*rect.height - bezel;
    let bottom = Math.max(...corners.map(p=>p.v))*rect.height + bezel;
    for (const button of panel.cindyButtons || []) {
      for (const point of [button.at, button.control]) {
        if (!Array.isArray(point) || !point.every(Number.isFinite)) continue;
        left = Math.min(left, point[0]*rect.width); right = Math.max(right, point[0]*rect.width);
        top = Math.min(top, point[1]*rect.height); bottom = Math.max(bottom, point[1]*rect.height);
      }
    }
    return {
      panel: panel.litPanel || 'primary', width, height,
      centerX:rect.left+(Math.min(...corners.map(p=>p.u))+Math.max(...corners.map(p=>p.u)))*rect.width/2,
      centerY:rect.top+(Math.min(...corners.map(p=>p.v))+Math.max(...corners.map(p=>p.v)))*rect.height/2,
      stageWidth: rect.width, stageHeight: rect.height,
      insetX: Math.max(0, window.innerWidth - box.width),
      insetY: Math.max(0, window.innerHeight - box.height),
      fit: {width:right-left,height:bottom-top,
        centerX:rect.left+(left+right)/2,centerY:rect.top+(top+bottom)/2},
    };
  };
  const CYCLE = ['portrait', 'landscape-left', 'portrait-upside-down', 'landscape-right'];
  function roll(panel) {
    const at = CYCLE.indexOf(panel.interfaceOrientation);
    if (at < 0) return 0;
    return ((at - (panel.litPanel === 'secondary' ? 1 : 0)) % 4 + 4) % 4 * 90;
  }

  // The server rolls the book in place at once. Turn it the way the iPhone
  // chrome turns (sim-native.html's curve): the last frame turns about the
  // book's centre while the live stream, already rolled, waits underneath and
  // fades in as the turn lands.
  const TURN_MS = 320, FADE_MS = 140;
  let turning = null;
  function settle() {
    if (!turning) return;
    clearTimeout(turning.timer);
    turning.ghost.remove();
    turning.canvas.style.removeProperty('opacity');
    turning.canvas.style.removeProperty('transition');
    turning = null;
  }
  // Keep the turning snapshot in the controller's coordinate space. Resizing
  // the embedded live frame must not move/resize that snapshot underneath a
  // separate CSS rotation. One animation owns angle, visible size and centre.
  let embeddedTurn = null;
  window.__cindyTurnActive = () => !!embeddedTurn;
  function finishEmbeddedTurn() {
    const motion = embeddedTurn;
    if (!motion) return;
    cancelAnimationFrame(motion.raf);clearTimeout(motion.timer);
    motion.iframe.removeEventListener('load',finishEmbeddedTurn);
    motion.root.remove();
    motion.surface.style.removeProperty('opacity');
    motion.surface.style.removeProperty('transition');
    motion.surface.style.removeProperty('pointer-events');
    embeddedTurn = null;
  }
  window.addEventListener?.('pagehide',finishEmbeddedTurn);
  function turnEmbedded(step) {
    const host = controller(), panel = live(), canvas = panel?.canvas;
    const parentDoc = host && window.parent.document, iframe = window.frameElement;
    const stage = parentDoc?.getElementById('stage');
    if (!host || !stage || !iframe || !canvas?.isConnected ||
        typeof requestAnimationFrame !== 'function') return false;
    const view = window.__cindyView();
    if (!view) return false;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
      finishEmbeddedTurn();window.__nativeRotateBy(step);layout();return true;
    }
    if (embeddedTurn?.fading) finishEmbeddedTurn();
    let motion = embeddedTurn;
    if (!motion) {
      const box = window.Baguette._ScreenQuad.contentRect(canvas);
      const outer = iframe.getBoundingClientRect(), bounds = stage.getBoundingClientRect();
      const root = parentDoc.createElement('div'), ghost = parentDoc.createElement('canvas');
      ghost.width=canvas.width;ghost.height=canvas.height;
      try { ghost.getContext('2d').drawImage(canvas,0,0); } catch { return false; }
      root.setAttribute('data-cindy-turn','');root.setAttribute('aria-hidden','true');
      root.style.cssText='position:fixed;overflow:hidden;pointer-events:none;z-index:20;' +
        `left:${bounds.left}px;top:${bounds.top}px;width:${bounds.width}px;height:${bounds.height}px;`;
      const x=outer.left+view.centerX-bounds.left,y=outer.top+view.centerY-bounds.top;
      ghost.style.cssText='position:absolute;pointer-events:none;margin:0;' +
        `left:${outer.left+box.left-bounds.left}px;top:${outer.top+box.top-bounds.top}px;width:${box.width}px;height:${box.height}px;` +
        `transform-origin:${view.centerX-box.left}px ${view.centerY-box.top}px;`;
      const padding=window.parent.getComputedStyle(parentDoc.getElementById('frame'));
      root.style.clipPath=`inset(${padding.paddingTop} ${padding.paddingRight} ${padding.paddingBottom} ${padding.paddingLeft})`;
      root.append(ghost);parentDoc.body.append(root);
      motion={root,ghost,canvas,surface:panel.stage||canvas,stage,iframe,host,panel,
        width:view.width,height:view.height,baseX:x,baseY:y,
        shown:{angle:0,scale:1,x,y},total:0,raf:0,timer:0,fading:false};
      embeddedTurn=motion;
      iframe.addEventListener('load',finishEmbeddedTurn,{once:true});
      motion.surface.style.transition='none';motion.surface.style.opacity='0';motion.surface.style.pointerEvents='none';
    }
    const before=roll(panel);
    window.__nativeRotateBy(step);
    const delta=((roll(panel)-before)%360+540)%360-180;
    if (!delta) { if(!motion.raf)finishEmbeddedTurn();return true; }
    motion.total+=delta;motion.from={...motion.shown};motion.start=performance.now();
    cancelAnimationFrame(motion.raf);
    const tick=now=>{
      if(embeddedTurn!==motion)return;
      if(!canvas.isConnected || live()!==panel){finishEmbeddedTurn();return;}
      const current=window.__cindyView(),bounds=stage.getBoundingClientRect(),outer=iframe.getBoundingClientRect();
      if(!current){finishEmbeddedTurn();return;}
      const progress=Math.min(1,(now-motion.start)/TURN_MS),ease=1-(1-progress)**3;
      const angle=motion.from.angle+(motion.total-motion.from.angle)*ease;
      const targetScale=Math.max(current.width,current.height)/Math.max(motion.width,motion.height);
      let scale=motion.from.scale+(targetScale-motion.from.scale)*ease;
      const x=motion.from.x+(outer.left+current.centerX-bounds.left-motion.from.x)*ease;
      const y=motion.from.y+(outer.top+current.centerY-bounds.top-motion.from.y)*ease;
      const css=window.parent.getComputedStyle(parentDoc.getElementById('frame'));
      motion.root.style.clipPath=`inset(${css.paddingTop} ${css.paddingRight} ${css.paddingBottom} ${css.paddingLeft})`;
      if(host.state.zoom.mode==='fit'){
        // Reserve bezel space at every intermediate angle, not just 0/90°.
        const availableWidth=bounds.width-parseFloat(css.paddingLeft)-parseFloat(css.paddingRight)-36;
        const availableHeight=bounds.height-parseFloat(css.paddingTop)-parseFloat(css.paddingBottom)-36;
        const radians=angle*Math.PI/180,c=Math.abs(Math.cos(radians)),s=Math.abs(Math.sin(radians));
        scale=Math.max(0,Math.min(scale,availableWidth/((motion.width*c+motion.height*s)*1.08),
          availableHeight/((motion.width*s+motion.height*c)*1.08)));
      }
      motion.shown={angle,scale,x,y};
      Object.assign(motion.root.style,{left:bounds.left+'px',top:bounds.top+'px',width:bounds.width+'px',height:bounds.height+'px'});
      motion.ghost.style.transform=`translate(${x-motion.baseX}px,${y-motion.baseY}px) rotate(${angle}deg) scale(${scale})`;
      if(progress<1)motion.raf=requestAnimationFrame(tick);
      else{
        motion.fading=true;
        motion.surface.style.transition=`opacity ${FADE_MS}ms ease`;motion.surface.style.opacity='1';
        motion.root.style.transition=`opacity ${FADE_MS}ms ease`;motion.root.style.opacity='0';
        motion.timer=setTimeout(()=>{if(embeddedTurn===motion)finishEmbeddedTurn();},FADE_MS);
      }
    };
    layout();motion.raf=requestAnimationFrame(tick);return true;
  }
  function turn(step) {
    const rotate = window.__nativeRotateBy;
    if (typeof rotate !== 'function') return false;
    if (turnEmbedded(step)) return true;
    // A turn still under way keeps its frame and carries on from the angle it
    // shows: a new snapshot could still be the old picture, turning too little.
    const carry = turning && !turning.fading ? turning : null;
    if (!carry) settle();
    const panel = live(), canvas = panel && panel.canvas;
    const box = canvas && canvas.isConnected ? canvas.getBoundingClientRect() : null;
    const still = !box || !box.width || !box.height || !canvas.width ||
      (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const before = panel ? roll(panel) : 0;
    let ghost = null;
    if (carry) {
      rotate(step);
      const more = panel ? ((roll(panel) - before) % 360 + 540) % 360 - 180 : 0;
      if (!more) return true;
      carry.total += more;
      carry.ghost.style.transform = `rotate(${carry.total}deg)`;
      clearTimeout(carry.timer);
      carry.timer = setTimeout(carry.land, TURN_MS - FADE_MS / 2);
      return true;
    }
    if (!still) {
      ghost = document.createElement('canvas');
      ghost.width = canvas.width; ghost.height = canvas.height;
      try { ghost.getContext('2d').drawImage(canvas, 0, 0); } catch { ghost = null; }
    }
    rotate(step);
    const delta = panel ? ((roll(panel) - before) % 360 + 540) % 360 - 180 : 0;
    if (!ghost || !delta) return true;
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.cssText = 'position:fixed;margin:0;pointer-events:none;z-index:2147483647;transform-origin:50% 50%;' +
      `left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;` +
      `object-fit:${getComputedStyle(canvas).objectFit || 'contain'};` +
      `transition:transform ${TURN_MS}ms cubic-bezier(0.32,0.72,0,1),opacity ${FADE_MS}ms ease`;
    document.body.append(ghost);
    canvas.style.transition = 'none';
    canvas.style.opacity = '0';
    void ghost.offsetWidth;
    ghost.style.transform = `rotate(${delta}deg)`;
    turning = { ghost, canvas, timer: 0, total: delta, fading: false, land: null };
    const current = turning;
    current.land = () => {
      if (turning !== current) return;
      current.fading = true;
      canvas.style.transition = `opacity ${FADE_MS}ms ease`;
      canvas.style.opacity = '1';
      ghost.style.opacity = '0';
      current.timer = setTimeout(() => { if (turning === current) settle(); }, FADE_MS);
    };
    current.timer = setTimeout(current.land, TURN_MS - FADE_MS / 2);
    return true;
  }
  function background() {
    const root = document.getElementById('simNativeView');
    const value = root ? getComputedStyle(root).getPropertyValue('--nv-page-bg').trim() : '';
    return /^#[0-9a-f]{6}$/i.test(value) ? value : null;
  }
  function sync() {
    const value = background();
    if (!value) return;
    for (const panel of panels) {
      try { panel.setBackground(value); } catch { /* a stale panel must not stop the others */ }
    }
  }
  function track(Panel) {
    if (typeof Panel !== 'function' || !Panel.prototype || Panel.prototype.cindyStageTracked) return;
    const { attach, detach, start, stop, setState, outputSize } = Panel.prototype;
    const clearStartup = panel => {
      if (panel.cindyStartupTimer) clearTimeout(panel.cindyStartupTimer);
      panel.cindyStartupTimer = null;
    };
    const fallback = (panel, delay) => {
      clearStartup(panel);
      const session = panel.session;
      panel.cindyStartupTimer = setTimeout(() => {
        panel.cindyStartupTimer = null;
        if (!panels.has(panel) || panel.session !== session || !session) return;
        panel.cindyH264Failed = true;
        panel.start();
      }, delay);
    };
    // Use a standard high-resolution 3D frame from the first connection.
    // Its aspect comes from the device, never the window or zoom. The browser
    // scales this same stream for Fit and percentage zoom without reconnecting.
    if (typeof outputSize === 'function' && typeof start === 'function') {
      Panel.prototype.outputSize = function () {
        const device = this.deviceSize;
        const valid = Number.isFinite(device?.width) && device.width > 0 &&
          Number.isFinite(device?.height) && device.height > 0;
        const width = valid ? device.width : 1, height = valid ? device.height : 1;
        const scale = 4096 / Math.max(width, height);
        // The native 3D renderer accepts at most 4096px per edge; this is a
        // composed model frame, not a claim of native screen pixel mapping.
        const even = value => Math.max(2, Math.min(4096, Math.round(value/2)*2));
        return {width:even(width*scale),height:even(height*scale)};
      };
      Panel.prototype.start = function (...args) {
        this.cindyStreamSize = this.outputSize();
        const preferred = this.format, size = this.cindyStreamSize;
        // The native H.264 path can emit only its JPEG seed above this pixel
        // budget (2560x4096 reproduced it). Preserve density using MJPEG;
        // keep the user's codec preference for smaller streams and other views.
        this.cindyStreamFormat = preferred === 'avcc' &&
          (size.width*size.height > 2048*4096 || this.cindyH264Failed) ? 'mjpeg' : preferred;
        this.cindyPaints = 0;
        this.format = this.cindyStreamFormat;
        try { return start.apply(this, args); }
        finally { this.format = preferred; }
      };
    }
    if (typeof stop === 'function') {
      Panel.prototype.stop = function (...args) {
        clearStartup(this);
        return stop.apply(this, args);
      };
    }
    if (typeof setState === 'function') {
      Panel.prototype.setState = function (message, busy, error) {
        const paint = !message && !busy && !error;
        const firstPaint = paint && !this.canvas?.hasAttribute('data-painted');
        // The first decoded frame has real dimensions, but must not become
        // visible until the controller has fitted and centred it. Keep the
        // existing loading state; errors are still rendered immediately.
        let result;
        if (paint && this.cindyLayoutPending) this.canvas?.setAttribute('data-painted', '');
        else result = setState.call(this, message, busy, error);
        if (firstPaint) layout();
        if (this.cindyStreamFormat !== 'avcc') return result;
        // A painted JPEG seed is not proof that H.264 playback has started.
        // React immediately to decoder errors; allow four seconds after the
        // seed for the first video frame, then recover once using MJPEG.
        if (error && /^(decoder:|config:)/i.test(message || '')) fallback(this, 0);
        else if (!message && !busy && !error) {
          if (++this.cindyPaints === 1) fallback(this, 4000);
          else clearStartup(this);
        }
        return result;
      };
    }
    if (typeof attach !== 'function' || typeof Panel.prototype.setBackground !== 'function') return;
    const placeButtons = Panel.prototype.placeButtons;
    Panel.prototype.cindyReveal = function () {
      if (!this.cindyLayoutPending || !this.canvas?.hasAttribute('data-painted') || !this.screenQuad) return;
      if (typeof placeButtons === 'function') placeButtons.call(this, this.cindyButtons || []);
      this.cindyLayoutPending = false;
      this.stage?.removeAttribute('data-cindy-layout-pending');
      if (typeof setState === 'function') setState.call(this, '', false);
    };
    if (typeof placeButtons === 'function') {
      Panel.prototype.placeButtons = function (buttons) {
        this.cindyButtons = buttons;
        return placeButtons.call(this, buttons);
      };
    }
    Panel.prototype.attach = function (...args) {
      panels.add(this);
      this.cindyH264Failed = false;
      this.cindyButtons = [];
      const result = attach.apply(this, args);
      this.cindyLayoutPending = !!controller();
      if (this.cindyLayoutPending) this.stage?.setAttribute('data-cindy-layout-pending', '');
      Promise.resolve(result).then(() => {
        sync();
        if (!panels.has(this) || !this.stage || typeof placeButtons !== 'function' ||
            typeof ResizeObserver !== 'function') return;
        this.cindyButtonLayout?.disconnect();
        // Metadata changes with the pose, not CSS layout. Reposition controls
        // on zoom/resize without touching the stream or its resolution.
        this.cindyButtonLayout = new ResizeObserver(() => {
          if (panels.has(this)) placeButtons.call(this, this.cindyButtons || []);
        });
        this.cindyButtonLayout.observe(this.stage);
      }, () => {});
      return result;
    };
    // The controller draws the foldable posture switch: remember the hinge the
    // stage reports and let it set one (window.__cindyPose).
    const place = Panel.prototype.placePosePicker;
    if (typeof place === 'function') {
      Panel.prototype.placePosePicker = function (pose) {
        if (embeddedTurn && pose && Number(pose.hingeDegrees)!==hinge) finishEmbeddedTurn();
        posed = this;
        if (pose && Number.isFinite(Number(pose.hingeDegrees))) hinge = Number(pose.hingeDegrees);
        const result = place.call(this, pose);
        layout(!this.cindyLayoutPending);
        return result;
      };
    }
    if (typeof detach === 'function') {
      Panel.prototype.detach = function (...args) {
        if (embeddedTurn?.panel===this) finishEmbeddedTurn();
        panels.delete(this);
        this.cindyButtonLayout?.disconnect();
        this.cindyButtonLayout = null;
        return detach.apply(this, args);
      };
    }
    Object.defineProperty(Panel.prototype, 'cindyStageTracked', { value: true });
  }
  let current = window.Sim3DPanel;
  track(current);
  try {
    Object.defineProperty(window, 'Sim3DPanel', {
      configurable: true,
      enumerable: true,
      get() { return current; },
      set(value) { current = value; track(value); },
    });
  } catch { /* already locked by the page; the stage just keeps its first backdrop */ }
  const scheme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
  if (scheme && typeof scheme.addEventListener === 'function') scheme.addEventListener('change', sync);

  // The page never paces its streams, so a hidden tab (another sidebar tab,
  // a covered or minimised window) keeps the server capturing, encoding and
  // rendering 3D at full rate. Throttle while hidden; the page never sets a
  // rate itself, so visible goes back to the server default.
  const VISIBLE_FPS = 60;
  const HIDDEN_FPS = 2;
  const STREAM_PATH = /^\/simulators\/[^/]+\/stream(?:\.3d\.(?:mjpeg|avcc))?$/;
  const streams = new Set();
  function rate() { return document.visibilityState === 'hidden' ? HIDDEN_FPS : VISIBLE_FPS; }
  function pace(socket) {
    if (socket.readyState !== 1) return;
    try { socket.send(JSON.stringify({ type: 'set_fps', fps: rate() })); } catch { /* closing */ }
  }
  function paced(url) {
    try {
      const parsed = new URL(String(url), location.href);
      // Atomic 3D frames reject stream controls with an error reply.
      return parsed.host === location.host && STREAM_PATH.test(parsed.pathname) && parsed.searchParams.get('frameMetadata') !== '1';
    } catch { return false; }
  }
  const Native = window.WebSocket;
  if (typeof Native === 'function') {
    const Paced = function (url, protocols) {
      const socket = protocols === undefined ? new Native(url) : new Native(url, protocols);
      if (paced(url)) {
        streams.add(socket);
        socket.addEventListener('open', () => { if (rate() !== VISIBLE_FPS) pace(socket); });
        socket.addEventListener('close', () => streams.delete(socket));
      }
      return socket;
    };
    Paced.prototype = Native.prototype;
    for (const name of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Paced[name] = Native[name];
    window.WebSocket = Paced;
  }
  document.addEventListener('visibilitychange', () => {
    for (const socket of streams) pace(socket);
    if (document.visibilityState === 'visible') sync();
  });
})();
