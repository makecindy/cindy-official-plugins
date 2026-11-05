// OptionHoverPreview — holding Option (with the cursor over the screen)
// shows two virtual finger dots WITHOUT clicking, matching Apple
// Simulator.app: pinch preview = cursor + mirror-through-centre; pan
// preview = parallel finger pair at centre.
//
// Suppressed while a real mouse gesture is active (`setDragActive`) so
// it doesn't repaint the overlay out from under MouseGestureSource's own
// pinch/pan preview — call `setDragActive(true/false)` from there rather
// than having either class reach into the other's state.
(function (root) {
  'use strict';

  const BASE_SPREAD_PT = 80; // sim-pt for the pan preview's finger pair

  class OptionHoverPreview extends root.Baguette._AttachableEventSource {
    constructor(screen, { overlay, mapClientPoint, mapScreenPoint } = {}) {
      super(screen, { mapClientPoint, mapScreenPoint });
      this.overlay = overlay || null;
      this._optionHeld = false;
      this._shiftHeld = false;
      this._cursorVx = 0; this._cursorVy = 0;
      this._cursorInside = false;
      this._dragActive = false;
    }

    /** Called by MouseGestureSource when a real gesture starts/ends. */
    setDragActive(active) {
      this._dragActive = active;
      this._updatePreview();
    }

    _updatePreview() {
      if (!this.overlay) return;
      if (this._dragActive) return;
      if (!this._optionHeld || !this._cursorInside) { this.overlay.clear(); return; }
      const {width,height}=this.screen.size;
      if(!width||!height)return;
      const centre={x:width/2,y:height/2};
      const point=this._screenPoint(this._clientX,this._clientY);
      if(!point.inside){this.overlay.clear();return;}
      this._showFingers(this._shiftHeld ? [
        {x:centre.x+BASE_SPREAD_PT,y:centre.y},{x:centre.x-BASE_SPREAD_PT,y:centre.y},
      ] : [point,{x:width-point.x,y:height-point.y}]);
    }

    _bind() {
      this._cancel = () => {
        this._optionHeld = false; this._shiftHeld = false;
        this._cursorInside = false; this._dragActive = false;
        this.overlay?.clear();
      };
      const updateCursor = (e) => {
        this._clientX=e.clientX;this._clientY=e.clientY;
      };
      this._on(this._el, 'mousemove', (e) => {
        updateCursor(e); this._cursorInside = true;
        if (!this._dragActive) this._updatePreview();
      });
      this._on(this._el, 'mouseenter', (e) => {
        updateCursor(e); this._cursorInside = true;
        this._updatePreview();
      });
      this._on(this._el, 'mouseleave', () => {
        this._cursorInside = false; this._updatePreview();
      });
      this._on(window, 'keydown', (e) => {
        let changed = false;
        if (e.key === 'Alt' || e.key === 'AltGraph' || e.key === 'Option') {
          if (!this._optionHeld) { this._optionHeld = true; changed = true; }
        }
        if (e.key === 'Shift') {
          if (!this._shiftHeld) { this._shiftHeld = true; changed = true; }
        }
        if (changed) this._updatePreview();
      });
      this._on(window, 'keyup', (e) => {
        let changed = false;
        if (e.key === 'Alt' || e.key === 'AltGraph' || e.key === 'Option') {
          if (this._optionHeld) { this._optionHeld = false; changed = true; }
        }
        if (e.key === 'Shift') {
          if (this._shiftHeld) { this._shiftHeld = false; changed = true; }
        }
        if (changed) this._updatePreview();
      });
    }
  }

  root.Baguette = root.Baguette || {};
  root.Baguette._OptionHoverPreview = OptionHoverPreview;
})(window);
