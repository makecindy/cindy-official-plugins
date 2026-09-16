const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const {build} = require('../../opendesign-trial/source/build/node_modules/esbuild');

test('upstream adapters preserve unknown outcomes and escape titles once', async () => {
  const root = path.resolve(__dirname, '../../opendesign-trial/source/latest');
  const result = await build({
    stdin: {contents: `export {injectPrintScript} from './apps/web/src/runtime/exports';
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
  const webcrypto = require('node:crypto').webcrypto;
  sandbox.crypto = {getRandomValues: webcrypto.getRandomValues.bind(webcrypto)};
  const ids = new Set(Array.from({length:100}, () => randomUUID()));
  assert.equal(ids.size,100);
  for (const id of ids) assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  // The srcdoc bridge embeds this same self-contained function into its realm.
  const embedded = vm.runInNewContext('(' + randomUUID.toString() + ')()', {crypto:sandbox.crypto});
  assert.match(embedded,/^[0-9a-f-]{36}$/);
  delete sandbox.crypto;
  assert.throws(()=>randomUUID(),/Web Crypto is required/);
  assert.equal(commentSendSucceeded({status:'unknown',commentIds:[]}), false);
  assert.equal(commentSendSucceeded({status:'queued',commentIds:['a']}), true);
  const output = injectPrintScript('<html><body>Example</body></html>', '</script><script>attack()</script>');
  assert.equal((output.match(/<script>/g) || []).length, 1);
  assert.ok(output.includes('\\u003c/script>'));
  assert.equal(sanitizeTitleInDoc('<title>&amp;lt;</title>'), '<title>-lt;</title>');
});
