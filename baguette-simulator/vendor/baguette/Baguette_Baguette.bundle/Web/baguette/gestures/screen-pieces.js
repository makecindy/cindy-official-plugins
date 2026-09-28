// ScreenPieces — where the lit screen lands in a rendered 3D frame, as
// the server's `screen_quad` names it: one quad for a phone, or, for a
// foldable whose unfolded screen bends at the hinge, flat pieces that
// each carry the part of the framebuffer they show. A click maps
// through whichever piece it lands on straight into framebuffer space,
// so the page needs no orientation of its own.
(function (root) {
  'use strict';

  class ScreenPieces {
    /** @param {Array<{quad, u:[number,number], v:[number,number]}>} pieces */
    constructor(pieces) {
      this.pieces = pieces || [];
    }

    get length() { return this.pieces.length; }

    /** From a `screen_quad` envelope: `pieces`, else `corners`. */
    static fromMessage(envelope) {
      const ScreenQuad = root.Baguette._ScreenQuad;
      if (!envelope) return new ScreenPieces([]);
      if (Array.isArray(envelope.pieces)) {
        const pieces = envelope.pieces.map((p) => {
          const quad = p && ScreenQuad.fromCorners(p.corners);
          const range = (r) => (Array.isArray(r) && r.length === 2 ? r : [0, 1]);
          return quad ? { quad, u: range(p.u), v: range(p.v) } : null;
        }).filter(Boolean);
        return new ScreenPieces(pieces);
      }
      const quad = ScreenQuad.fromCorners(envelope.corners);
      return new ScreenPieces(quad ? [{ quad, u: [0, 1], v: [0, 1] }] : []);
    }

    /** Frame point (normalized) → framebuffer point (normalized). Off
     *  every piece, the point is still placed — clamped onto the nearest
     *  piece — so a drag that leaves the screen keeps a position. */
    locate(px, py) {
      let fallback = { u: 0, v: 0, inside: false };
      let nearest = Infinity;
      for (const piece of this.pieces) {
        const hit = piece.quad.locate(px, py);
        const placed = {
          u: piece.u[0] + Math.max(0, Math.min(1, hit.u)) * (piece.u[1] - piece.u[0]),
          v: piece.v[0] + Math.max(0, Math.min(1, hit.v)) * (piece.v[1] - piece.v[0]),
          inside: !!hit.inside,
        };
        if (placed.inside) return placed;
        // Compare distances in rendered-frame space, not local UV space:
        // folded pieces can have different sizes and perspective transforms.
        const q = piece.quad;
        const corners = [q.topLeft, q.topRight, q.bottomRight, q.bottomLeft];
        for (let i = 0; i < corners.length; i++) {
          const a = corners[i], b = corners[(i + 1) % corners.length];
          const dx = b.u - a.u, dy = b.v - a.v;
          const length2 = dx * dx + dy * dy;
          const t = length2 ? Math.max(0, Math.min(1, ((px - a.u) * dx + (py - a.v) * dy) / length2)) : 0;
          const distance = (px - a.u - t * dx) ** 2 + (py - a.v - t * dy) ** 2;
          if (distance < nearest) { nearest = distance; fallback = placed; }
        }
      }
      return fallback;
    }
  }

  root.Baguette = root.Baguette || {};
  root.Baguette._ScreenPieces = ScreenPieces;
})(window);
