'use strict';
// The Agent works in "view points": the screen as the user sees it (upright,
// the way the viewer shows it), in logical points, origin top-left. Baguette's
// screenshots, accessibility frames and HID input all use the panel's native,
// unrotated axes. These helpers convert between the two so the model never
// rotates a screenshot or converts pixels itself.
//
// Rotation is the clockwise turn from the native frame to the view, matching
// the viewer (sim-native.js: landscape-left = rotate(90deg)).
const ROTATION = {portrait: 0, 'landscape-left': 90, 'portrait-upside-down': 180, 'landscape-right': 270};

function rotation(screen) { return ROTATION[screen?.orientation] ?? 0; }

/** Native screen ({width, height, orientation}) → the size the user sees. */
function viewSize(screen) {
  return rotation(screen) % 180 ? {width: screen.height, height: screen.width} : {width: screen.width, height: screen.height};
}

/** A view point → the native point HID input expects. */
function toNative(screen, vx, vy) {
  const W = screen.width, H = screen.height;
  switch (rotation(screen)) {
    case 90: return {x: vy, y: H - vx};
    case 180: return {x: W - vx, y: H - vy};
    case 270: return {x: W - vy, y: vx};
    default: return {x: vx, y: vy};
  }
}

/** A native point → the view point. */
function toView(screen, x, y) {
  const W = screen.width, H = screen.height;
  switch (rotation(screen)) {
    case 90: return {x: H - y, y: x};
    case 180: return {x: W - x, y: H - y};
    case 270: return {x: y, y: W - x};
    default: return {x, y};
  }
}

// On iPhone Duo's unfolded (secondary) panel, SpringBoard reports accessibility
// frames turned a quarter from the framebuffer that touches use, while apps
// report framebuffer frames. Measured on iOS 27.1: SpringBoard's frame
// (x, y, w, h) is the native frame (H − y − h, x, h, w); its root has a blank
// label and its frames run far past the panel's native width.
function axTurned(tree, screen) {
  if (screen?.target?.litPanel !== 'secondary' || !tree) return false;
  if (typeof tree.label === 'string' && !tree.label.trim()) return true;
  let right = 0;
  const pending = [...(tree.children || [])];
  while (pending.length) { const n = pending.pop(); if (n?.frame) right = Math.max(right, n.frame.x + n.frame.width); if (Array.isArray(n?.children)) pending.push(...n.children); }
  return right > screen.width * 1.15;
}
function axFrameToNative(screen, f, turned) {
  return turned ? {x: screen.height - f.y - f.height, y: f.x, width: f.height, height: f.width} : f;
}
/** A native point → the point describe-ui's hit test expects. */
function nativeToAx(screen, x, y, turned) { return turned ? {x: y, y: screen.height - x} : {x, y}; }

function frameToView(screen, frame) {
  const a = toView(screen, frame.x, frame.y), b = toView(screen, frame.x + frame.width, frame.y + frame.height);
  return {x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y)};
}

const r1 = n => Math.round(n * 10) / 10;
const ROLE = {AXButton: 'button', AXStaticText: 'text', AXTextField: 'field', AXSecureTextField: 'secure-field', AXTextArea: 'text-area',
  AXSearchField: 'search', AXCell: 'cell', AXLink: 'link', AXImage: 'image', AXSwitch: 'switch', AXSlider: 'slider', AXTab: 'tab',
  AXTabGroup: 'tabs', AXHeading: 'heading', AXCheckBox: 'checkbox', AXPopUpButton: 'popup', AXMenuItem: 'menu-item', AXIncrementor: 'stepper',
  AXPicker: 'picker', AXProgressIndicator: 'progress', AXActivityIndicator: 'spinner', AXKeyboardKey: 'key', AXToolbar: 'toolbar',
  AXNavigationBar: 'nav-bar', AXAlert: 'alert', AXSheet: 'sheet', AXWebArea: 'web', AXGenericElement: 'element', AXGroup: 'group',
  AXScrollArea: 'scroll', AXTable: 'table', AXCollection: 'collection', AXApplication: 'app'};
const INTERACTIVE = new Set(['button', 'field', 'secure-field', 'text-area', 'search', 'cell', 'link', 'switch', 'slider', 'tab', 'checkbox', 'popup', 'menu-item', 'stepper', 'picker', 'key']);
const text = v => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);

/**
 * Flatten an accessibility tree into the elements worth acting on or reading,
 * in reading order, with view-space frames and centres.
 */
function compactTree(tree, screen, {query, role, limit = 250, turned = axTurned(tree, screen)} = {}) {
  const view = viewSize(screen), out = [], seen = new Set();
  const q = typeof query === 'string' && query.trim() ? query.trim().toLowerCase() : null;
  const pending = [tree];
  while (pending.length) {
    const node = pending.shift();
    if (Array.isArray(node)) { pending.unshift(...node); continue; }
    if (!node || typeof node !== 'object') continue;
    if (node.hidden === true) continue;
    if (Array.isArray(node.children)) pending.unshift(...node.children);
    if (!node.frame) continue;
    const kind = ROLE[node.role] || (typeof node.role === 'string' ? node.role.replace(/^AX/, '').toLowerCase() : 'element');
    if (kind === 'app') continue;
    const label = text(node.label) || text(node.title), value = text(node.value);
    const id = typeof node.identifier === 'string' && node.identifier.trim() ? node.identifier : null;
    if (!label && !id && !value && !INTERACTIVE.has(kind)) continue;
    const f = frameToView(screen, axFrameToNative(screen, node.frame, turned));
    if (f.width < 1 || f.height < 1 || f.x >= view.width || f.y >= view.height || f.x + f.width <= 0 || f.y + f.height <= 0) continue;
    // Baguette's status-bar sweep reports its items in a different frame once
    // the screen rotates; they would point at the wrong place, so drop them.
    if (kind === 'element' && !id && rotation(screen)) continue;
    if (role && kind !== role) continue;
    if (q && ![label, id, value].some(s => s && s.toLowerCase().includes(q))) continue;
    const key = `${kind}|${label}|${id}|${Math.round(f.x)}|${Math.round(f.y)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = {role: kind};
    if (label) entry.label = label.length > 160 ? label.slice(0, 157) + '…' : label;
    if (id) entry.id = id;
    if (value && value !== label) entry.value = value.length > 120 ? value.slice(0, 117) + '…' : value;
    if (node.enabled === false) entry.enabled = false;
    if (node.focused === true) entry.focused = true;
    entry.frame = [r1(f.x), r1(f.y), r1(f.width), r1(f.height)];
    entry.center = [r1(f.x + f.width / 2), r1(f.y + f.height / 2)];
    out.push(entry);
  }
  out.sort((a, b) => (a.frame[1] - b.frame[1]) || (a.frame[0] - b.frame[0]));
  const elements = out.slice(0, limit).map((e, i) => ({i, ...e}));
  return {elements, total: out.length, truncated: out.length > limit};
}

/**
 * Pick the element a tap, scroll or wait should target. An explicit id only
 * matches the identifier. Text prefers exact label/id/value over partial matches.
 */
function validateSelector(selector) {
  for (const key of ['text', 'id', 'role']) {
    const value = selector[key];
    if (value !== undefined && (typeof value !== 'string' || !value.trim())) {
      throw Object.assign(new Error(`${key} must be a non-blank string`), {code: 'INVALID_ARGUMENT', execution: 'not_executed'});
    }
  }
}

function findElement(elements, selector) {
  validateSelector(selector);
  const {text: wanted, id, role, nth = 0, view} = selector;
  const w = typeof wanted === 'string' ? wanted.trim().toLowerCase() : null;
  const want = typeof id === 'string' ? id : null;
  let pool = elements.filter(e => (!role || e.role === role));
  if (want !== null) pool = pool.filter(e => e.id === want);
  if (w) {
    const exact = pool.filter(e => [e.label, e.id, e.value].some(s => s && s.toLowerCase() === w));
    pool = exact.length ? exact : pool.filter(e => [e.label, e.id, e.value].some(s => s && s.toLowerCase().includes(w)));
  }
  // A finger can only reach what is on screen: drop matches whose centre is off it.
  if (view) {
    const onScreen = pool.filter(e => e.center[0] >= 0 && e.center[0] <= view.width && e.center[1] >= 0 && e.center[1] <= view.height);
    pool = onScreen;
  }
  // Prefer something a finger can act on over static text that merely mentions it.
  const actionable = pool.filter(e => INTERACTIVE.has(e.role) && e.enabled !== false);
  if (actionable.length) pool = actionable;
  return {element: pool[nth] || null, matches: pool.length};
}

module.exports = {ROTATION, rotation, viewSize, toNative, toView, frameToView, axTurned, axFrameToNative, nativeToAx, compactTree, validateSelector, findElement, INTERACTIVE};
