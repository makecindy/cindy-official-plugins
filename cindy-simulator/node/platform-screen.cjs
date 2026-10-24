'use strict';
// tvOS and visionOS expose a fixed framebuffer, not an iPhone orientation.
// Read the connected screen rather than guessing a resolution from the model.
function fixedScreen(output) {
  const screens = String(output).split(/(?=^\s*Screen ID:)/m).filter(block => /^\s*Screen ID:/m.test(block)).map(block => {
    const id = block.match(/^\s*Screen ID:\s*(\d+)/m);
    const pixels = block.match(/^\s*Pixel Size:\s*\{(\d+),\s*(\d+)\}/m);
    const scale = block.match(/^\s*Preferred UI Scale:\s*([\d.]+)/m);
    const name = block.match(/^\s*Device Name:\s*(\S+)/m)?.[1];
    if (!id || !pixels || !scale || !name) return null;
    const width = Number(pixels[1]), height = Number(pixels[2]), density = Number(scale[1]);
    if (!(width > 0 && height > 0 && density > 0 && density <= 4)) return null;
    return {name, width: width / density, height: height / density, orientation: 'portrait',
      target: {screenId: Number(id[1]), litPanel: 'primary', pixelSize: {width, height}}};
  }).filter(Boolean);
  const selected = screens.find(s => s.name === 'primary') || (screens.length === 1 ? screens[0] : null);
  if (!selected) throw Object.assign(new Error('No unambiguous connected simulator screen'), {code: 'SCREEN_UNAVAILABLE', execution: 'not_executed'});
  const {name, ...screen} = selected;
  return screen;
}
module.exports = {fixedScreen};
