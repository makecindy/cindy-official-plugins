// Screenshot post-processing for the Agent, run with `osascript -l JavaScript`.
// argv: <in.png> <out> <json options>
// options: {rotate: 0|90|180|270 (clockwise, native → view),
//           view: {width, height} (view points), scale (output pixels per point),
//           region: {x, y, width, height} (view points; default whole screen),
//           radius (screen corner radius in points, 0 = none),
//           grid (spacing in points, 0 = none), format: 'jpeg'|'png', quality}
// Output pixel (px, py) is view point (region.x + px/scale, region.y + py/scale),
// so a point read off the image is the point to tap.
ObjC.import('AppKit');
function run(argv) {
  const [input, output, raw] = argv;
  const o = JSON.parse(raw);
  const source = $.NSImage.alloc.initWithContentsOfFile(input);
  if (!source || source.isNil()) throw new Error('Cannot read screenshot');
  const rep = source.representations.objectAtIndex(0);
  const sw = rep.pixelsWide, sh = rep.pixelsHigh;
  const s = o.scale || 1, vw = o.view.width, vh = o.view.height;
  const r = o.region || {x: 0, y: 0, width: vw, height: vh};
  const W = Math.max(1, Math.round(r.width * s)), H = Math.max(1, Math.round(r.height * s));
  const FW = vw * s, FH = vh * s;
  const out = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
    null, W, H, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0);
  const ctx = $.NSGraphicsContext.graphicsContextWithBitmapImageRep(out);
  $.NSGraphicsContext.saveGraphicsState;
  $.NSGraphicsContext.setCurrentContext(ctx);
  ctx.setImageInterpolation($.NSImageInterpolationHigh);
  $.NSColor.blackColor.setFill;
  $.NSRectFill($.NSMakeRect(0, 0, W, H));
  ctx.saveGraphicsState;
  // AppKit's origin is bottom-left: move the full view so the region fills the canvas.
  const shift = $.NSAffineTransform.transform;
  shift.translateXByYBy(-r.x * s, -(FH - (r.y + r.height) * s));
  shift.concat;
  if (o.radius > 0) $.NSBezierPath.bezierPathWithRoundedRectXRadiusYRadius($.NSMakeRect(0, 0, FW, FH), o.radius * s, o.radius * s).addClip;
  const turn = $.NSAffineTransform.transform;
  turn.translateXByYBy(FW / 2, FH / 2);
  turn.rotateByDegrees(-(o.rotate || 0)); // AppKit turns counter-clockwise; ours is clockwise
  turn.concat;
  const quarter = (o.rotate || 0) % 180 !== 0;
  const dw = quarter ? FH : FW, dh = quarter ? FW : FH;
  rep.drawInRectFromRectOperationFractionRespectFlippedHints($.NSMakeRect(-dw / 2, -dh / 2, dw, dh), $.NSMakeRect(0, 0, sw, sh), $.NSCompositingOperationCopy, 1, true, $());
  ctx.restoreGraphicsState;
  if (o.grid > 0) {
    const step = o.grid;
    const ink = $.NSColor.colorWithSRGBRedGreenBlueAlpha(1, 0, 0.35, 0.5);
    const size = Math.max(9, Math.round(9 * Math.min(s, 2)));
    const attrs = $.NSDictionary.dictionaryWithObjectsForKeys(
      $([$.NSFont.monospacedDigitSystemFontOfSizeWeight(size, 0.3), $.NSColor.colorWithSRGBRedGreenBlueAlpha(0.85, 0, 0.3, 1), $.NSColor.colorWithSRGBRedGreenBlueAlpha(1, 1, 1, 0.85)]),
      $([$.NSFontAttributeName, $.NSForegroundColorAttributeName, $.NSBackgroundColorAttributeName]));
    ink.setStroke;
    for (let x = Math.ceil(r.x / step) * step; x < r.x + r.width; x += step) {
      if (x <= r.x) continue;
      const px = Math.round((x - r.x) * s) + 0.5;
      const p = $.NSBezierPath.bezierPath; p.setLineWidth(1); p.moveToPoint($.NSMakePoint(px, 0)); p.lineToPoint($.NSMakePoint(px, H)); p.stroke;
      $(String(x)).drawAtPointWithAttributes($.NSMakePoint(px + 2, H - size - 4), attrs);
    }
    for (let y = Math.ceil(r.y / step) * step; y < r.y + r.height; y += step) {
      if (y <= r.y) continue;
      const py = H - Math.round((y - r.y) * s) - 0.5;
      const p = $.NSBezierPath.bezierPath; p.setLineWidth(1); p.moveToPoint($.NSMakePoint(0, py)); p.lineToPoint($.NSMakePoint(W, py)); p.stroke;
      $(String(y)).drawAtPointWithAttributes($.NSMakePoint(2, py + 1), attrs);
    }
  }
  ctx.flushGraphics;
  $.NSGraphicsContext.restoreGraphicsState;
  const png = o.format === 'png';
  const props = png ? $({}) : $.NSDictionary.dictionaryWithObjectForKey($(o.quality || 0.8), $.NSImageCompressionFactor);
  const data = out.representationUsingTypeProperties(png ? $.NSBitmapImageFileTypePNG : $.NSBitmapImageFileTypeJPEG, props);
  if (!data.writeToFileAtomically(output, true)) throw new Error('Cannot write screenshot');
  return JSON.stringify({width: W, height: H});
}
