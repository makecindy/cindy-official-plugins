'use strict';
// Small PNG decoder and frame comparisons for waiting on the screen: is it still
// changing, and is it a blank (single-colour) frame. Handles the 8-bit,
// non-interlaced RGB/RGBA images Baguette writes; anything else returns null
// and callers fall back to comparing bytes.
const zlib = require('node:zlib');

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function decodePng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33 || !buffer.subarray(0, 8).equals(SIGNATURE)) return null;
  let width = 0, height = 0, channels = 0, offset = 8;
  const data = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset), type = buffer.toString('latin1', offset + 4, offset + 8);
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4);
      const depth = chunk[8], colour = chunk[9], interlace = chunk[12];
      if (depth !== 8 || interlace !== 0 || (colour !== 2 && colour !== 6)) return null;
      channels = colour === 6 ? 4 : 3;
    } else if (type === 'IDAT') data.push(chunk);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (!width || !height || !channels || width * height > 4e6) return null;
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(data)); } catch { return null; }
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return null;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = y * stride, prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[row + x - channels] : 0, b = y ? out[prev + x] : 0, c = y && x >= channels ? out[prev + x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else if (filter !== 0) return null;
      out[row + x] = v & 0xff;
    }
  }
  return {width, height, channels, data: out};
}

/** Pixel rectangle {x, y, width, height} clamped to the image, or the whole image. */
function clampRect(image, rect) {
  if (!rect) return {x: 0, y: 0, width: image.width, height: image.height};
  const x = Math.max(0, Math.min(image.width - 1, Math.floor(rect.x))), y = Math.max(0, Math.min(image.height - 1, Math.floor(rect.y)));
  return {x, y, width: Math.max(1, Math.min(image.width - x, Math.ceil(rect.width))), height: Math.max(1, Math.min(image.height - y, Math.ceil(rect.height)))};
}

/** Share of pixels (0–1) whose colour moved by more than `threshold` on any channel. */
function changedShare(a, b, rect, threshold = 24) {
  if (!a || !b || a.width !== b.width || a.height !== b.height || a.channels !== b.channels) return 1;
  const r = clampRect(a, rect), ch = a.channels;
  let changed = 0;
  for (let y = r.y; y < r.y + r.height; y++) {
    for (let x = r.x; x < r.x + r.width; x++) {
      const i = (y * a.width + x) * ch;
      if (Math.abs(a.data[i] - b.data[i]) > threshold || Math.abs(a.data[i + 1] - b.data[i + 1]) > threshold || Math.abs(a.data[i + 2] - b.data[i + 2]) > threshold) changed++;
    }
  }
  return changed / (r.width * r.height);
}

/**
 * True when nearly every pixel is one colour (a black launch frame, a white
 * page still loading). Without a rect the top 8 % is left out: the status bar
 * and Dynamic Island are drawn over an otherwise empty frame.
 */
function isBlank(image, rect) {
  if (!image) return false;
  const top = Math.round(image.height * 0.08);
  const r = clampRect(image, rect || {x: 0, y: top, width: image.width, height: image.height - top}), ch = image.channels;
  const i0 = (r.y * image.width + r.x) * ch, base = [image.data[i0], image.data[i0 + 1], image.data[i0 + 2]];
  let off = 0;
  for (let y = r.y; y < r.y + r.height; y++) {
    for (let x = r.x; x < r.x + r.width; x++) {
      const i = (y * image.width + x) * ch;
      if (Math.abs(image.data[i] - base[0]) > 20 || Math.abs(image.data[i + 1] - base[1]) > 20 || Math.abs(image.data[i + 2] - base[2]) > 20) off++;
    }
  }
  return off / (r.width * r.height) < 0.015;
}

module.exports = {decodePng, changedShare, isBlank};
