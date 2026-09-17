const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const {build} = require('../../opendesign-trial/source/build/node_modules/esbuild');

test('upstream adapters preserve unknown outcomes and escape titles once', async () => {
  const root = path.resolve(__dirname, '../../opendesign-trial/source/latest');
  const result = await build({
    stdin: {contents: `export {injectPrintScript, requestPreviewSnapshotResult} from './apps/web/src/runtime/exports';
      export {renderMarkdownToSafeHtml} from './apps/web/src/artifacts/markdown';
      export {extractSpeakerNotesFromHtml} from './apps/web/src/runtime/speaker-notes';
      export {extractBabelScriptSrcs} from './apps/web/src/runtime/jsx-module-refs';
      export {randomUUID} from './apps/web/src/utils/uuid';
      export {sanitizeTitleInDoc} from './apps/web/src/runtime/srcdoc';
      export {commentSendSucceeded} from './apps/web/src/components/comment-send-result';`, resolveDir: root},
    bundle: true, write: false, platform: 'node', format: 'cjs',
    nodePaths: [path.resolve(root, '../build/node_modules')],
    alias: {'@open-design/contracts': root + '/packages/contracts/src', '@open-design/host': root + '/packages/host/src'},
  });
  const sandbox = {module: {exports: {}}, exports: {}, require, console, TextEncoder, TextDecoder};
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(result.outputFiles[0].text, sandbox);
  const {injectPrintScript, sanitizeTitleInDoc, commentSendSucceeded, randomUUID} = sandbox.module.exports;
  const {renderMarkdownToSafeHtml,extractSpeakerNotesFromHtml,extractBabelScriptSrcs}=sandbox.module.exports;
  assert.equal(extractSpeakerNotesFromHtml('<aside class="notes">hello<script>bad()</script >world</aside>')[0],'hello world');
  assert.equal(extractSpeakerNotesFromHtml('<aside class="notes">hello<script>bad()</script\t\n bar>world</aside>')[0],'hello world');
  assert.deepEqual(Array.from(extractBabelScriptSrcs('<scr<!-- gap -->ipt type="text/babel" src="fake.jsx"></script><script type="text/babel" src="real.jsx"></script>')),['real.jsx']);
  const markdown=renderMarkdownToSafeHtml('| Code | Value |\n| --- | --- |\n| \`a\\|b\` | <script>alert(1)</script> |');
  assert.ok(!markdown.includes('<script>'));
  assert.ok(markdown.includes('&lt;script'),markdown);
  const webcrypto = require('node:crypto').webcrypto;
  sandbox.crypto = {getRandomValues: webcrypto.getRandomValues.bind(webcrypto)};
  const ids = new Set(Array.from({length:100}, () => randomUUID()));
  assert.equal(ids.size,100);
  for (const id of ids) assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  // Exercise the persisted pod initializer with a frozen clock.
  const viewer=require('node:fs').readFileSync(path.join(root,'apps/web/src/components/FileViewer.tsx'),'utf8');
  const podExpression=viewer.match(/elementId:\s*(`pod-[^`]+`)/)[1];
  const podIds=new Set(Array.from({length:100},()=>vm.runInNewContext(podExpression,{randomUUID,Date:{now:()=>1}})));
  assert.equal(podIds.size,100);
  for(const id of podIds) assert.match(id,/^pod-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  // The srcdoc bridge embeds this same self-contained function into its realm.
  const embedded = vm.runInNewContext('(' + randomUUID.toString() + ')()', {crypto:sandbox.crypto});
  assert.match(embedded,/^[0-9a-f-]{36}$/);
  const listeners=new Set(),messages=[];
  sandbox.window={addEventListener:(_,fn)=>listeners.add(fn),removeEventListener:(_,fn)=>listeners.delete(fn)};
  sandbox.setTimeout=()=>0;
  const win={postMessage:m=>messages.push(m)};
  const first=sandbox.module.exports.requestPreviewSnapshotResult({contentWindow:win});
  const second=sandbox.module.exports.requestPreviewSnapshotResult({contentWindow:win});
  assert.notEqual(messages[0].id,messages[1].id);
  for(const m of messages) assert.match(m.id,/^snap-[0-9a-f-]{36}$/);
  for(const [index,dataUrl] of [[1,'second'],[0,'first']])
    for(const listener of [...listeners]) listener({source:win,data:{type:'od:snapshot:result',id:messages[index].id,dataUrl,w:1,h:1}});
  assert.equal((await first).snapshot.dataUrl,'first');
  assert.equal((await second).snapshot.dataUrl,'second');
  assert.equal(listeners.size,0);
  delete sandbox.crypto;
  const count=messages.length;
  assert.throws(()=>sandbox.module.exports.requestPreviewSnapshotResult({contentWindow:win}),/Web Crypto is required/);
  assert.equal(messages.length,count);
  assert.throws(()=>randomUUID(),/Web Crypto is required/);
  assert.equal(commentSendSucceeded({status:'unknown',commentIds:[]}), false);
  assert.equal(commentSendSucceeded({status:'queued',commentIds:['a']}), true);
  const output = injectPrintScript('<html><body>Example</body></html>', '</script><script>attack()</script>');
  assert.equal((output.match(/<script>/g) || []).length, 1);
  assert.ok(output.includes('\\u003c/script>'));
  assert.equal(sanitizeTitleInDoc('<title>&amp;lt;</title>'), '<title>-lt;</title>');
});
