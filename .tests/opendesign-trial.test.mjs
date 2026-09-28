import './opendesign/session.cjs';
import './opendesign/worker.cjs';
import './opendesign/feedback.cjs';

import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import preview from '../opendesign-trial/node/card-preview.cjs';
test('packaged source archive preserves every tracked source file byte for byte', () => {
  execFileSync('python3', [fileURLToPath(new URL('../.github/scripts/package-opendesign-source.py', import.meta.url)), '--check']);
});
test('card blocks remote and escaped resource URLs while preserving colors and embedded images', () => {
  const html = preview(String.raw`<html style="background:url(https://example.test/root)"><body><img src="https://example.test/a"><img src="//example.test/b"><img src="data:image/png;base64,AAAA"><div style="color:#123456;background:u\72l(https://example.test/c);border:1px solid red">Safe</div><div style='background:image-set("https://example.test/d" 1x);padding:20px'>Safe</div></body></html>`);
  assert.doesNotMatch(html, /example\.test|u\\72l|image-set/);
  assert.match(html, /data:image\/png;base64,AAAA/);
  assert.match(html, /color:\s*#123456/);
  assert.match(html, /padding:\s*20px/);
});
test('preview preserves class-based styling as inline CSS without script execution', () => {
  const html = preview('<html><style>:root{--accent:#123456}body{background:#faf6f0}.hero{text-align:center}.btn{background:var(--accent);border-radius:20px}nav{display:flex}</style><body><nav>Example</nav><div class="hero"><a class="btn" onclick="alert(1)" data-ghost-action="fake">预览</a></div><script>throw Error("must never run")</script></body></html>');
  assert.match(html, /text-align: center/);
  assert.match(html, /background: #123456/);
  assert.match(html, /background: #faf6f0/);
  assert.match(html, /display: flex/);
  assert.match(html, /预览/);
  assert.doesNotMatch(html, /<script|onclick|data-ghost-action|class=/);
});

test('preview budget also bounds direct text, entities, multibyte text and root attributes', () => {
  for (const source of ['x'.repeat(40000),'咖啡'.repeat(20000),'&amp;'.repeat(20000),'<body style="font-family:'+ 'x'.repeat(40000)+'">small</body>','<p>short</p>'+'x'.repeat(40000)]) {
    const html=preview(source);
    assert.ok(Buffer.byteLength(html,'utf8') <= 26000);
    assert.match(html, /^<div[ >]/);
    assert.match(html, /<\/div>$/);
  }
});
