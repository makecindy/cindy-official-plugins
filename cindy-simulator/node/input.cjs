'use strict';
// Real HID touches through one `baguette input` session per tool call. Every
// gesture goes through the simulator's system touch path, the same one a
// finger uses: no window, no host mouse, and it works while the Mac is locked.
// Coordinates arrive in view points (geometry.cjs) and leave in native points.
const {spawn} = require('node:child_process');
const {toNative} = require('./geometry.cjs');
const {commandBudget} = require('./budget.cjs');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function openSession(binary, args, {spawnImpl = spawn, deadline, now = Date.now} = {}) {
  const child = spawnImpl(binary, ['input', ...args], {stdio: ['pipe', 'pipe', 'pipe']});
  const waiting = [];
  let buffer = '', stderr = '', closed = false;
  const end = (error, execution = 'unknown') => {
    closed = true;
    while (waiting.length) waiting.shift()({ok: false, error, execution});
  };
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim(); buffer = buffer.slice(i + 1);
      if (!line) continue;
      let ack; try { ack = JSON.parse(line); } catch { ack = {ok: false, error: 'invalid ack', execution: 'unknown'}; }
      if (!ack || typeof ack.ok !== 'boolean') ack = {ok: false, error: 'invalid ack', execution: 'unknown'};
      waiting.shift()?.(ack);
    }
  });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
  child.on('exit', () => end(stderr.trim().split('\n').pop() || 'input session ended', /display bind failed/i.test(stderr) ? 'not_executed' : 'unknown'));
  child.on('error', error => end(error.message));
  child.stdin.on('error', error => end(error.message));
  return {
    send(envelope) {
      if (closed) return Promise.resolve({ok: false, error: 'input session ended', execution: 'not_executed'});
      let timeout;
      try { ({timeout} = commandBudget(10000, deadline, now)); }
      catch (error) { return Promise.resolve({ok: false, error: error.message, execution: 'not_executed'}); }
      return new Promise(resolve => {
        const timer = setTimeout(() => { end('no acknowledgement within the input time budget'); child.kill('SIGKILL'); }, timeout);
        waiting.push(ack => { clearTimeout(timer); resolve(ack); });
        try { child.stdin.write(JSON.stringify(envelope) + '\n'); }
        catch (error) { end(error.message); }
      });
    },
    close() { if (!closed) { child.stdin.end(); setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, 3000).unref?.(); } },
  };
}

/**
 * Turn one Agent gesture into timed HID steps. Returns [{envelope, waitMs}].
 * `screen` is the observed native screen ({width, height, orientation}).
 */
function plan(screen, g) {
  const W = screen.width, H = screen.height, size = {width: W, height: H};
  const at = (x, y) => { const p = toNative(screen, x, y); return {x: clamp(p.x, 0, W), y: clamp(p.y, 0, H)}; };
  const steps = [];
  const push = (envelope, waitMs = 0) => steps.push({envelope: {...envelope, ...(envelope.type.startsWith('touch') || ['tap', 'swipe', 'pinch', 'pan'].includes(envelope.type) ? size : {})}, waitMs});
  const line = (from, to, ms, kind, extra = {}) => {
    const n = Math.max(2, Math.round(ms / 16));
    for (let i = 1; i <= n; i++) {
      const p = at(from[0] + (to[0] - from[0]) * i / n, from[1] + (to[1] - from[1]) * i / n);
      push({type: kind, ...p, ...extra}, ms / n);
    }
  };
  switch (g.kind) {
    case 'tap': {
      const p = at(g.x, g.y), count = g.count || 1, hold = g.duration ?? 0.05;
      if (count === 1) { push({type: 'tap', ...p, duration: hold}); break; }
      // Two touches on one session: what UITapGestureRecognizer(numberOfTaps: 2) needs.
      for (let i = 0; i < count; i++) { push({type: 'touch1-down', ...p}, 40); push({type: 'touch1-up', ...p}, i < count - 1 ? 90 : 0); }
      break;
    }
    case 'swipe': {
      const a = at(g.from[0], g.from[1]), b = at(g.to[0], g.to[1]);
      push({type: 'swipe', startX: a.x, startY: a.y, endX: b.x, endY: b.y, duration: g.duration ?? 0.3});
      break;
    }
    case 'drag': {
      // Press, hold long enough to pick the item up, move, pause, release.
      const hold = (g.hold ?? 0.6) * 1000, ms = (g.duration ?? 0.8) * 1000;
      push({type: 'touch1-down', ...at(g.from[0], g.from[1])}, hold);
      line(g.from, g.to, ms, 'touch1-move');
      steps[steps.length - 1].waitMs = 150;
      push({type: 'touch1-up', ...at(g.to[0], g.to[1])});
      break;
    }
    case 'edge': {
      // System edge gestures: bottom = home indicator, top = Notification/Control Center.
      const view = g.view, edge = g.edge || 'bottom';
      const from = edge === 'bottom' ? [view.width / 2, view.height - 2] : edge === 'top' ? [g.x ?? view.width * 0.25, 2]
        : edge === 'left' ? [2, view.height / 2] : [view.width - 2, view.height / 2];
      const to = g.to || (edge === 'bottom' ? [view.width / 2, view.height * 0.55] : edge === 'top' ? [from[0], view.height * 0.6]
        : edge === 'left' ? [view.width * 0.7, view.height / 2] : [view.width * 0.3, view.height / 2]);
      const nativeEdge = nativeEdgeOf(screen, edge);
      push({type: 'touch1-down', ...at(from[0], from[1]), edge: nativeEdge}, 30);
      line(from, to, (g.duration ?? 0.35) * 1000, 'touch1-move', {edge: nativeEdge});
      push({type: 'touch1-up', ...at(to[0], to[1]), edge: nativeEdge});
      break;
    }
    case 'pinch': {
      // Two fingers along the view's horizontal axis, spread in points.
      const [cx, cy] = g.center, from = g.from ?? 60, to = g.to ?? 240, ms = (g.duration ?? 0.6) * 1000;
      const pair = s => { const a = at(cx - s / 2, cy), b = at(cx + s / 2, cy); return {x1: a.x, y1: a.y, x2: b.x, y2: b.y}; };
      const n = Math.max(4, Math.round(ms / 16));
      push({type: 'touch2-down', ...pair(from)}, 30);
      for (let i = 1; i <= n; i++) push({type: 'touch2-move', ...pair(from + (to - from) * i / n)}, ms / n);
      push({type: 'touch2-up', ...pair(to)});
      break;
    }
    case 'pan': {
      // Two fingers side by side moved together (maps, two-finger scroll).
      const [x, y] = g.from, [dx, dy] = g.by, ms = (g.duration ?? 0.5) * 1000, gap = 40;
      const pair = t => { const a = at(x - gap / 2 + dx * t, y + dy * t), b = at(x + gap / 2 + dx * t, y + dy * t); return {x1: a.x, y1: a.y, x2: b.x, y2: b.y}; };
      const n = Math.max(4, Math.round(ms / 16));
      push({type: 'touch2-down', ...pair(0)}, 30);
      for (let i = 1; i <= n; i++) push({type: 'touch2-move', ...pair(i / n)}, ms / n);
      push({type: 'touch2-up', ...pair(1)});
      break;
    }
    default: throw Object.assign(new Error('Unknown gesture'), {code: 'INVALID_ARGUMENT'});
  }
  return steps;
}

// Which native edge the user's edge is, given the rotation.
function nativeEdgeOf(screen, edge) {
  const order = ['top', 'right', 'bottom', 'left'], turns = ({90: 1, 180: 2, 270: 3})[{portrait: 0, 'landscape-left': 90, 'portrait-upside-down': 180, 'landscape-right': 270}[screen.orientation] || 0] || 0;
  // View edge rotated back counter-clockwise by the screen's clockwise turn.
  return order[(order.indexOf(edge) - turns + 4) % 4];
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

async function perform(session, steps, {deadline, now = Date.now} = {}) {
  let sent = 0;
  for (const {envelope, waitMs} of steps) {
    const ack = await session.send(envelope).catch(error => ({ok: false, error: error.message, execution: 'unknown'}));
    if (!ack.ok) {
      // Never leave a finger down.
      if (/touch[12]-(down|move)/.test(envelope.type)) await session.send({...envelope, type: envelope.type.replace(/down|move/, 'up')}).catch(() => {});
      throw Object.assign(new Error(`Touch not confirmed: ${ack.error || 'rejected'}`), {code: 'INPUT_FAILED', execution: sent || ack.execution !== 'not_executed' ? 'unknown' : 'not_executed'});
    }
    sent++;
    if (waitMs > 0) {
      try {
        const {timeout} = commandBudget(waitMs, deadline, now);
        if (timeout < waitMs) throw new Error('Input time budget exhausted during gesture');
        await sleep(waitMs);
      } catch (error) {
        await session.send({...envelope, type: envelope.type.replace(/down|move/, 'up')}).catch(() => {});
        throw Object.assign(error, {code: 'INPUT_FAILED', execution: 'unknown'});
      }
    }
  }
  return sent;
}

module.exports = {openSession, plan, perform, nativeEdgeOf};
