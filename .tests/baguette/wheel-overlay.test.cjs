const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness(width, height) {
  const rect = { left: 30, top: 70, width, height };
  let wheel, idle, contacts, dots;
  const copy = (points) => JSON.parse(JSON.stringify(points));
  const screen = {
    size: { width: 400, height: 800 },
    touchDown() {}, touchUp() {},
    touchMove(points) { contacts = copy(points); },
  };
  const overlay = {
    setFingers(points) { dots = copy(points); },
    clear() { dots = []; },
  };
  const context = { window: {}, setTimeout(fn) { idle = fn; return 1; }, clearTimeout() {} };
  const dir = path.join(__dirname, '../../baguette-simulator/vendor/baguette/Baguette_Baguette.bundle/Web/baguette/gestures');
  for (const name of ['attachable-event-source', 'wheel-gesture-source']) {
    vm.runInNewContext(fs.readFileSync(path.join(dir, name + '.js'), 'utf8'), context);
  }
  new context.window.Baguette._WheelGestureSource(screen, { overlay }).attach({
    getBoundingClientRect: () => rect,
    addEventListener(name, callback) { if (name === 'wheel') wheel = callback; },
  });
  return {
    move(event) {
      wheel({ clientX: 130, clientY: 270, deltaX: 0, deltaY: 0, preventDefault() {}, ...event });
      for (let i = 0; i < 2; i++) {
        assert.ok(Math.abs(dots[i].x - contacts[i].x * width / 400) < 1e-9);
        assert.ok(Math.abs(dots[i].y - contacts[i].y * height / 800) < 1e-9);
      }
      return dots;
    },
    end() { idle(); assert.deepEqual(dots, []); },
  };
}

test('wheel pan indicators stay parallel and follow both dispatched contacts', () => {
  for (const [width, height] of [[400, 800], [200, 400], [300, 400]]) {
    const h = harness(width, height);
    for (const event of [
      { deltaY: 20 }, { deltaX: 30 }, { deltaX: -15, deltaY: -40 },
      { clientX: 155, clientY: 310, deltaX: 10, deltaY: 15 },
    ]) {
      const dots = h.move(event);
      assert.ok(Math.abs(dots[0].x - dots[1].x - 160 * width / 400) < 1e-9);
      assert.equal(dots[0].y, dots[1].y);
    }
    h.end();
  }
});

test('wheel pinch indicators follow actual scaling and a moving pointer', () => {
  const h = harness(200, 400);
  const expanded = h.move({ ctrlKey: true, deltaY: -40 });
  assert.ok(expanded[0].x - expanded[1].x > 80);
  const contracted = h.move({ ctrlKey: true, deltaY: 80, clientX: 160, clientY: 300 });
  assert.ok(contracted[0].x - contracted[1].x < 80);
  h.end();
});

// Regression: iPhone's backend clips edge contacts but the overlay used raw
// pinch coordinates. Exercise the production source at every edge and scale;
// the existing centre-only cases could not distinguish these positions.
test('wheel pan and pinch indicators match bounded contacts at every screen edge', () => {
  for (const [width, height] of [[400, 800], [200, 400], [300, 400]]) {
    for (const [x, y] of [[.02, .5], [.98, .5], [.5, .02], [.5, .98]]) {
      for (const ctrlKey of [false, true]) {
        const h = harness(width, height);
        for (const deltaY of [-400, 80]) {
          const dots = h.move({ctrlKey, deltaY, clientX:30+x*width, clientY:70+y*height});
          assert.ok(dots.every(p => p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height));
        }
        h.end();
      }
    }
  }
});
