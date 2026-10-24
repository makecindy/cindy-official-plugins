// osascript -l JavaScript ocr.jxa.js <image> '<options JSON>'
// Reads the text on a screenshot with Vision (on-device, nothing leaves the Mac).
// Options: {find?: string, languages?: [string]}. With `find`, a line containing
// it also reports the box of just that part, so a word inside a longer line can
// be tapped. Boxes are normalised to the image with a top-left origin.
ObjC.import('Foundation');
ObjC.import('Vision');

function box(rect) {
  // Vision's origin is the bottom-left corner.
  return [rect.origin.x, 1 - rect.origin.y - rect.size.height, rect.size.width, rect.size.height];
}

function run(argv) {
  const options = argv[1] ? JSON.parse(argv[1]) : {};
  const request = $.VNRecognizeTextRequest.alloc.init;
  // Accurate (0): the fast level garbles CJK text.
  request.setRecognitionLevel(0);
  request.setRecognitionLanguages($(options.languages || ['zh-Hans', 'en-US']));
  request.setUsesLanguageCorrection(true);
  const handler = $.VNImageRequestHandler.alloc.initWithURLOptions($.NSURL.fileURLWithPath(argv[0]), $({}));
  const error = Ref();
  if (!handler.performRequestsError($([request]), error)) throw new Error('Text recognition failed');
  const find = typeof options.find === 'string' ? options.find.toLowerCase() : null;
  const out = [];
  const results = request.results;
  for (let i = 0; i < results.count; i++) {
    const observation = results.objectAtIndex(i);
    const candidate = observation.topCandidates(1).objectAtIndex(0);
    const text = candidate.string.js;
    const item = {text, confidence: Math.round(candidate.confidence * 100) / 100, box: box(observation.boundingBox)};
    const at = find ? text.toLowerCase().indexOf(find) : -1;
    if (at >= 0 && find.length < text.length) {
      const part = candidate.boundingBoxForRangeError($.NSMakeRange(at, find.length), Ref());
      if (part && !part.isNil()) item.part = box(part.boundingBox);
    }
    out.push(item);
  }
  return JSON.stringify(out);
}
