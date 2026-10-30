// AttachableEventSource — the attach/detach lifecycle and listener
// bookkeeping every gesture source (mouse, touch, wheel, Safari
// GestureEvent) needs identically, plus the shared client-point mapping
// that honors 3D Interact mode's `mapClientPoint`. Concrete sources
// implement `_bind()`, called once `this._el` is set.
(function (root) {
  'use strict';

  class AttachableEventSource {
    /**
     * @param {Screen} screen
     * @param {object} [opts]
     * @param {(clientX:number, clientY:number) => {x:number,y:number,
     *   xNorm:number,yNorm:number,inside:boolean}} [opts.mapClientPoint]
     */
    constructor(screen, { mapClientPoint } = {}) {
      this.screen = screen;
      this._mapClientPoint = mapClientPoint || null;
      this._handlers = [];
      this._el = null;
    }

    attach(el) {
      if (this._el) this.detach();
      this._el = el;
      this._bind();
      // All gesture sources share the same cancellation boundary. Each source
      // owns its local state and supplies an idempotent cleanup in _bind().
      const cancel = () => this._cancel?.();
      this._on(root, 'blur', cancel);
      this._on(root, 'pagehide', cancel);
      this._on(root, 'message', e => {
        if (e.origin === root.location.origin && e.source === root.parent && e.data?.type === 'cindy-release-input') cancel();
      });
      this._on(root.document, 'visibilitychange', () => { if (root.document.hidden) cancel(); });
    }

    detach() {
      this._cancel?.();
      this._cancel = null;
      for (const [target, event, fn, opts] of this._handlers) {
        target.removeEventListener(event, fn, opts);
      }
      this._handlers = [];
      this._el = null;
    }

    _on(target, event, fn, opts) {
      target.addEventListener(event, fn, opts);
      this._handlers.push([target, event, fn, opts]);
    }

    /**
     * clientX/clientY → screen-space point, honoring `mapClientPoint`
     * when the bound element isn't a 1:1 crop of the screen (3D
     * Interact mode). Falls back to plain element-rect-relative math,
     * with `inside` always true, when no mapper is supplied.
     */
    _screenPoint(clientX, clientY) {
      if (this._mapClientPoint) return this._mapClientPoint(clientX, clientY);
      const r = this._el.getBoundingClientRect();
      const { width, height } = this.screen.size;
      const xNorm = r.width ? (clientX - r.left) / r.width : 0;
      const yNorm = r.height ? (clientY - r.top) / r.height : 0;
      return { x: xNorm * width, y: yNorm * height, xNorm, yNorm, inside: true };
    }

    /** Concrete sources wire their own listeners here via `this._on`. */
    _bind() {
      throw new Error('AttachableEventSource subclasses must implement _bind()');
    }
  }

  root.Baguette = root.Baguette || {};
  root.Baguette._AttachableEventSource = AttachableEventSource;
})(window);
