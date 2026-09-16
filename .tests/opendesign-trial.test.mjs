import './opendesign/session.cjs';
import './opendesign/worker.cjs';
import './opendesign/feedback.cjs';

import assert from 'node:assert/strict';
import test from 'node:test';
import preview from '../opendesign-trial/node/card-preview.cjs';
test('preview preserves class-based styling as inline CSS without script execution', () => {
  const html = preview('<html><style>:root{--accent:#123456}body{background:#faf6f0}.hero{text-align:center}.btn{background:var(--accent);border-radius:20px}nav{display:flex}</style><body><nav>Example</nav><div class="hero"><a class="btn" onclick="alert(1)" data-ghost-action="fake">预览</a></div><script>throw Error("must never run")</script></body></html>');
  assert.match(html, /text-align: center/);
  assert.match(html, /background: #123456/);
  assert.match(html, /background: #faf6f0/);
  assert.match(html, /display: flex/);
  assert.match(html, /预览/);
  assert.doesNotMatch(html, /<script|onclick|data-ghost-action|class=/);
});
