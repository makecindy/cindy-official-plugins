// Contact sheet of captured frames, run with `osascript -l JavaScript`.
// argv: <out.jpg> <json options>
// options: {frames: [{path, label}], rotate: 0|90|180|270 (clockwise), cell: {width, height}
//           (view points per frame), columns, quality}
// Each frame is turned upright and labelled (time since the action started),
// left to right, top to bottom.
ObjC.import('AppKit');
function run(argv) {
  const [output, raw] = argv;
  const o = JSON.parse(raw);
  const cw = Math.round(o.cell.width), ch = Math.round(o.cell.height);
  const cols = Math.max(1, Math.min(o.columns || 4, o.frames.length));
  const rows = Math.ceil(o.frames.length / cols), gap = 6, band = 18;
  const W = cols * cw + (cols + 1) * gap, H = rows * (ch + band) + (rows + 1) * gap;
  const out = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
    null, W, H, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0);
  const ctx = $.NSGraphicsContext.graphicsContextWithBitmapImageRep(out);
  $.NSGraphicsContext.saveGraphicsState;
  $.NSGraphicsContext.setCurrentContext(ctx);
  ctx.setImageInterpolation($.NSImageInterpolationHigh);
  $.NSColor.colorWithSRGBRedGreenBlueAlpha(0.12, 0.12, 0.12, 1).setFill;
  $.NSRectFill($.NSMakeRect(0, 0, W, H));
  const attrs = $.NSDictionary.dictionaryWithObjectsForKeys(
    $([$.NSFont.monospacedDigitSystemFontOfSizeWeight(12, 0.4), $.NSColor.whiteColor]),
    $([$.NSFontAttributeName, $.NSForegroundColorAttributeName]));
  const quarter = (o.rotate || 0) % 180 !== 0;
  o.frames.forEach((f, i) => {
    const image = $.NSImage.alloc.initWithContentsOfFile(f.path);
    if (!image || image.isNil()) return;
    const rep = image.representations.objectAtIndex(0);
    const col = i % cols, row = Math.floor(i / cols);
    const x = gap + col * (cw + gap), top = gap + row * (ch + band + gap);
    const y = H - top - band - ch; // AppKit origin is bottom-left
    $(String(f.label)).drawAtPointWithAttributes($.NSMakePoint(x + 2, y + ch + 2), attrs);
    ctx.saveGraphicsState;
    const t = $.NSAffineTransform.transform;
    t.translateXByYBy(x + cw / 2, y + ch / 2);
    t.rotateByDegrees(-(o.rotate || 0));
    t.concat;
    const dw = quarter ? ch : cw, dh = quarter ? cw : ch;
    rep.drawInRectFromRectOperationFractionRespectFlippedHints($.NSMakeRect(-dw / 2, -dh / 2, dw, dh), $.NSMakeRect(0, 0, rep.pixelsWide, rep.pixelsHigh), $.NSCompositingOperationCopy, 1, true, $());
    ctx.restoreGraphicsState;
  });
  ctx.flushGraphics;
  $.NSGraphicsContext.restoreGraphicsState;
  const data = out.representationUsingTypeProperties($.NSBitmapImageFileTypeJPEG, $.NSDictionary.dictionaryWithObjectForKey($(o.quality || 0.75), $.NSImageCompressionFactor));
  if (!data.writeToFileAtomically(output, true)) throw new Error('Cannot write contact sheet');
  return JSON.stringify({width: W, height: H});
}
