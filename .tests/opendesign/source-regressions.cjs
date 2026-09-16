const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const {build} = require('../../opendesign-trial/source/build/node_modules/esbuild');

test('upstream adapters preserve unknown outcomes and escape titles once', async () => {
  const root = path.resolve(__dirname, '../../opendesign-trial/source/latest');
  const result = await build({
    stdin: {contents: `export {injectPrintScript} from './apps/web/src/runtime/exports';
      export {sanitizeTitleInDoc} from './apps/web/src/runtime/srcdoc';
      export {commentSendSucceeded} from './apps/web/src/components/comment-send-result';`, resolveDir: root},
    bundle: true, write: false, platform: 'node', format: 'cjs',
    nodePaths: [path.resolve(root, '../build/node_modules')],
    alias: {'@open-design/contracts': root + '/packages/contracts/src', '@open-design/host': root + '/packages/host/src'},
  });
  const sandbox = {module: {exports: {}}, exports: {}, require, console, TextEncoder, TextDecoder};
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(result.outputFiles[0].text, sandbox);
  const {injectPrintScript, sanitizeTitleInDoc, commentSendSucceeded} = sandbox.module.exports;
  assert.equal(commentSendSucceeded({status:'unknown',commentIds:[]}), false);
  assert.equal(commentSendSucceeded({status:'queued',commentIds:['a']}), true);
  const output = injectPrintScript('<html><body>Example</body></html>', '</script><script>attack()</script>');
  assert.equal((output.match(/<script>/g) || []).length, 1);
  assert.ok(output.includes('\\u003c/script>'));
  assert.equal(sanitizeTitleInDoc('<title>&amp;lt;</title>'), '<title>-lt;</title>');
});
