// WheelGestureSource — trackpad/mouse wheel as a synthesized 2-finger
// pinch (Ctrl+wheel) or pan (plain wheel), auto-closing after a short
// idle window since wheel events have no natural "finger up".
(function (root) {
  'use strict';

  const BASE_SPREAD_PT = 80; // sim-pt for the synthesized finger pair
  const WHEEL_IDLE_MS = 120; // wheel idle → close 2-finger

  class WheelGestureSource extends root.Baguette._AttachableEventSource {
    constructor(screen, { overlay, mapClientPoint, mapScreenPoint } = {}) {
      super(screen, { mapClientPoint, mapScreenPoint });
      this.overlay = overlay || null;
    }

    _bind() {
      let state = null;

      const close = () => {
        if (!state) return;
        clearTimeout(state.idleTimer);
        this.screen.touchUp([state.f1, state.f2]);
        if (this.overlay) this.overlay.clear();
        state = null;
      };
      this._cancel = close;

      this._on(this._el, 'wheel', (e) => {
        e.preventDefault();
        const { width, height } = this.screen.size;
        if (!width || !height) return;
        const r = this._el.getBoundingClientRect();
        const centre=this._screenPoint(e.clientX,e.clientY);
        if(!state&&!centre.inside)return;
        const factor=e.deltaMode===1?16:e.deltaMode===2?r.height:1;
        const wantKind = e.ctrlKey ? 'pinch' : 'pan';

        if (!state || state.kind !== wantKind) {
          if (state) close();
          state = {
            kind: wantKind,
            f1: { x: centre.x + BASE_SPREAD_PT, y: centre.y },
            f2: { x: centre.x - BASE_SPREAD_PT, y: centre.y },
            scale: 1, idleTimer: null,
          };
          this.screen.touchDown([state.f1, state.f2]);
        }

        if (state.kind === 'pinch') {
          const maxScale=Math.min(6,Math.max(centre.x,width-centre.x)/BASE_SPREAD_PT);
          state.scale = Math.max(0.25, Math.min(maxScale, state.scale * Math.exp(-e.deltaY*factor / 200)));
          const rr = BASE_SPREAD_PT * state.scale;
          state.f1 = { x: centre.x + rr, y: centre.y };
          state.f2 = { x: centre.x - rr, y: centre.y };
        } else {
          // Keep the visible pair together and consume offscreen travel, just
          // like Android. Reversing at an edge must not repay hidden distance.
          for (const finger of [state.f1, state.f2]) {
            finger.x = Math.max(0, Math.min(width, finger.x));
            finger.y = Math.max(0, Math.min(height, finger.y));
          }
          const shiftX = Math.max(-Math.min(state.f1.x, state.f2.x),
            Math.min(width - Math.max(state.f1.x, state.f2.x), (this._screenPoint(e.clientX-e.deltaX*factor,e.clientY-e.deltaY*factor).x-centre.x)));
          const shiftY = Math.max(-Math.min(state.f1.y, state.f2.y),
            Math.min(height - Math.max(state.f1.y, state.f2.y), (this._screenPoint(e.clientX-e.deltaX*factor,e.clientY-e.deltaY*factor).y-centre.y)));
          state.f1.x += shiftX; state.f1.y += shiftY;
          state.f2.x += shiftX; state.f2.y += shiftY;
        }

        // Use the backend's bounded positions for both dispatch and display;
        // a pinch near an edge can keep its raw pair outside the screen.
        const points = [state.f1, state.f2].map(finger => ({
          x: Math.max(0, Math.min(width, finger.x)),
          y: Math.max(0, Math.min(height, finger.y)),
        }));
        this.screen.touchMove(points);

        this._showFingers(points);

        clearTimeout(state.idleTimer);
        state.idleTimer = setTimeout(close, WHEEL_IDLE_MS);
      }, { passive: false });
    }
  }

  root.Baguette = root.Baguette || {};
  root.Baguette._WheelGestureSource = WheelGestureSource;
})(window);
