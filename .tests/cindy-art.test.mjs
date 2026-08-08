import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const root = new URL('../cindy-art/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('ghost.json', root), 'utf8'));
const source = readFileSync(new URL('main.js', root), 'utf8');

class FakeBroadcastChannel {
  constructor() {}
  postMessage() {}
}

function createHarness() {
  let handler;
  const requests = [];
  const results = [];
  const cindy = {
    onHostMessage(nextHandler) {
      handler = nextHandler;
    },
    ping() {
      return Promise.resolve();
    },
    async send(message) {
      if (message.type === 'cindy-request') {
        requests.push(message);
        return {
          ok: true,
          hash: 'a'.repeat(64),
          ext: message.kind === 'gen_image' ? '.png' : '.mp4',
          url: `https://example.test/${message.kind}.media`,
        };
      }
      if (message.type === 'card-update') return { ok: true };
      if (message.type === 'tool-result') {
        results.push(message);
        return { ok: true };
      }
      throw new Error(`unexpected cindy.send type: ${message.type}`);
    },
  };

  vm.runInNewContext(source, {
    BroadcastChannel: FakeBroadcastChannel,
    cindy,
    Promise,
    String,
  });
  assert.equal(typeof handler, 'function');

  return {
    requests,
    results,
    async call(tool, model) {
      const args = { prompt: 'a short test video', model };
      if (tool === 'edit_video') args.images = ['a'.repeat(64)];
      await handler({
        type: 'tool-call',
        tool,
        callId: `call-${tool}`,
        args,
      });
      return results.at(-1);
    },
  };
}

test('manifest exposes Seedance 2.5 for generation and image-to-video tools', () => {
  assert.equal(manifest.version, '1.11.1');
  for (const toolName of ['gen_video', 'edit_video']) {
    const tool = manifest.tools.find(({ name }) => name === toolName);
    assert.ok(tool, `${toolName} declaration is missing`);
    assert.deepEqual(tool.parameters.properties.model.enum, [
      'seedance-fast',
      'seedance-pro',
      'seedance-2.5',
      'happyhorse',
    ]);
  }
});

test('video requests map only Seedance 2.5 to its LiteLLM model id', async () => {
  const harness = createHarness();

  await harness.call('gen_video', 'seedance-2.5');
  await harness.call('edit_video', 'seedance-2.5');
  await harness.call('gen_video', 'seedance-pro');
  await harness.call('gen_image', 'seedance-2.5');

  assert.equal(harness.requests[0].model, 'bytedance/seedance-2.5');
  assert.equal(harness.requests[1].model, 'bytedance/seedance-2.5');
  assert.equal(harness.requests[2].model, 'seedance-pro');
  assert.equal(harness.requests[3].model, 'seedance-2.5');
  assert.equal(harness.results.every((result) => result.ok), true);
});
