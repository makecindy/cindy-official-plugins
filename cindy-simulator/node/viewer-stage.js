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
  window.__cindyPose = {
    get: () => (live() ? hinge : null),
    set: (degrees) => { if (live()) posed.send({ type: 'set_pose', hingeDegrees: Number(degrees) }); },
    // How far the book is turned clockwise on screen. The server rolls it so the
    // guest stands the way it is held: the cover upright in portrait, the
    // unfolded panel in landscape-left.
    roll: () => (live() ? roll(posed) : null),
    turn: (step) => turn(step),
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
  function turn(step) {
    const rotate = window.__nativeRotateBy;
    if (typeof rotate !== 'function') return false;
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
    const { attach, detach } = Panel.prototype;
    if (typeof attach !== 'function' || typeof Panel.prototype.setBackground !== 'function') return;
    Panel.prototype.attach = function (...args) {
      panels.add(this);
      const result = attach.apply(this, args);
      Promise.resolve(result).then(sync, () => {});
      return result;
    };
    // The controller draws the foldable posture switch: remember the hinge the
    // stage reports and let it set one (window.__cindyPose).
    const place = Panel.prototype.placePosePicker;
    if (typeof place === 'function') {
      Panel.prototype.placePosePicker = function (pose) {
        posed = this;
        if (pose && Number.isFinite(Number(pose.hingeDegrees))) hinge = Number(pose.hingeDegrees);
        return place.call(this, pose);
      };
    }
    if (typeof detach === 'function') {
      Panel.prototype.detach = function (...args) {
        panels.delete(this);
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
