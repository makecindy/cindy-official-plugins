import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const root = new URL('../cindy-art/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('ghost.json', root), 'utf8'));
const source = readFileSync(new URL('main.js', root), 'utf8');

function normalizePreference(preference) {
  return typeof preference === 'string'
    ? { modelId: preference, providerId: 'xd' }
    : preference;
}

function mediaCatalogsForPreferences(configuredModels) {
  const catalogs = { image: [], video: [] };
  const requirements = {
    'image.generate': { type: 'image', input: ['text'], output: ['image'] },
    'image.edit': { type: 'image', input: ['text', 'image'], output: ['image'] },
    'video.generate': { type: 'video', input: ['text'], output: ['video'] },
    'video.image_to_video': { type: 'video', input: ['text', 'image'], output: ['video'] },
  };
  for (const [capability, rawPreference] of Object.entries(configuredModels)) {
    const requirement = requirements[capability];
    if (!requirement) continue;
    const preference = normalizePreference(rawPreference);
    const { modelId, providerId } = preference;
    let model = catalogs[requirement.type].find(
      (candidate) => candidate.id === modelId && candidate.providerId === providerId,
    );
    if (!model) {
      model = {
        id: modelId,
        name: modelId,
        providerId,
        modalities: { input: [], output: [] },
      };
      catalogs[requirement.type].push(model);
    }
    model.modalities.input = [...new Set([...model.modalities.input, ...requirement.input])];
    model.modalities.output = [...new Set([...model.modalities.output, ...requirement.output])];
  }
  return catalogs;
}

function createHarness(
  hostPreferences = {},
  mediaCatalogs = { image: [], video: [] },
  mediaCatalogFailure = null,
) {
  let handler;
  const catalogs = structuredClone(mediaCatalogs);
  const results = [];
  const hostRequests = [];
  const fetches = [];
  const warnings = [];

  const cindy = {
    onHostMessage(nextHandler) {
      handler = nextHandler;
    },
    ping() {
      return Promise.resolve();
    },
    async send(message) {
      if (message.type === 'host-request' && message.kind === 'cindy-preference') {
        hostRequests.push(structuredClone(message));
        const rawPreference = hostPreferences[message.capability];
        if (rawPreference instanceof Error) throw rawPreference;
        const preference = normalizePreference(rawPreference);
        return preference
          ? { ok: true, capability: message.capability, ...preference }
          : { ok: false, errorCode: 'NOT_AVAILABLE', message: '当前没有可用的媒体模型' };
      }
      if (message.type === 'tool-result') {
        results.push(message);
        return { ok: true };
      }
      throw new Error(`unexpected cindy.send type: ${message.type}`);
    },
  };

  async function fetch(path) {
    fetches.push(path);
    if (path === '/media-models?type=image' || path === '/media-models?type=video') {
      if (mediaCatalogFailure === 'network') throw new Error('Failed to fetch');
      if (typeof mediaCatalogFailure === 'string' && mediaCatalogFailure.startsWith('http-')) {
        return { ok: false, status: Number(mediaCatalogFailure.slice(5)) };
      }
      const type = path.endsWith('image') ? 'image' : 'video';
      const models = catalogs[type];
      return {
        ok: true,
        json: async () => {
          if (mediaCatalogFailure === 'json') throw new SyntaxError('Unexpected token');
          return {
            ok: true,
            type,
            models: structuredClone(models),
            defaultModelId: models[0]?.id ?? null,
          };
        },
      };
    }
    return { ok: false };
  }

  vm.runInNewContext(source, {
    Array,
    console: {
      warn(...args) {
        warnings.push(structuredClone(args));
      },
    },
    Error,
    JSON,
    Promise,
    String,
    cindy,
    fetch,
  });
  assert.equal(typeof handler, 'function');

  return {
    fetches,
    hostRequests,
    warnings,
    async call(tool, args) {
      await handler({ type: 'tool-call', tool, callId: `call-${tool}`, args });
      await new Promise((resolve) => setImmediate(resolve));
      return results.at(-1);
    },
  };
}

test('manifest exposes only the four media preparation tools', () => {
  assert.equal(manifest.version, '1.13.3');
  assert.equal(manifest.minCindyVersion, '0.1.56');
  assert.equal(manifest.slots.includes('card'), false);
  assert.deepEqual(
    manifest.tools.map(({ name }) => name),
    ['gen_image', 'edit_image', 'gen_video', 'edit_video'],
  );
  for (const tool of manifest.tools) {
    assert.equal(tool.parameters.properties.model.type, 'string');
    assert.equal(tool.parameters.properties.model.enum, undefined);
  }
  assert.doesNotMatch(JSON.stringify(manifest), /import_artwork|gallery|画廊/);
});

test('each operation uses the exact model configured by Host for that capability', async () => {
  const hash = 'b'.repeat(64);
  const hostPreferences = {
    'image.generate': 'google/gemini-3-pro-image',
    'image.edit': 'openai/gpt-image-2',
    'video.generate': 'bytedance-seed/seedance-2.5',
    'video.edit': 'minimax/minimax-h3',
  };
  const catalogs = mediaCatalogsForPreferences({
    'image.generate': hostPreferences['image.generate'],
    'image.edit': hostPreferences['image.edit'],
    'video.generate': hostPreferences['video.generate'],
    'video.image_to_video': hostPreferences['video.edit'],
  });
  const harness = createHarness(hostPreferences, catalogs);

  const image = await harness.call('gen_image', { prompt: 'a cat', tier: 'best' });
  const edit = await harness.call('edit_image', {
    prompt: 'add snow',
    images: [`cindy-media://blobs/${hash}.png`],
  });
  const video = await harness.call('gen_video', { prompt: 'a running cat' });
  const imageToVideo = await harness.call('edit_video', {
    prompt: 'make it move',
    images: [`cindy-media://blobs/${hash}.png`],
  });

  assert.equal(image.ok, true);
  assert.equal(image.result.request.modelId, hostPreferences['image.generate']);
  assert.equal(image.result.request.providerId, 'xd');
  assert.equal(edit.result.request.modelId, hostPreferences['image.edit']);
  assert.equal(edit.result.request.providerId, 'xd');
  assert.deepEqual(structuredClone(edit.result.request.referenceMedia.managedMediaUrls), [
    `cindy-media://blobs/${hash}.png`,
  ]);
  assert.equal(video.result.request.modelId, hostPreferences['video.generate']);
  assert.equal(video.result.request.providerId, 'xd');
  assert.equal(imageToVideo.result.request.capability, 'video.image_to_video');
  assert.equal(imageToVideo.result.request.modelId, hostPreferences['video.edit']);
  assert.equal(imageToVideo.result.request.providerId, 'xd');
  assert.deepEqual(
    harness.hostRequests.map(({ capability }) => capability),
    ['image.generate', 'image.edit', 'video.generate', 'video.edit'],
  );
  assert.equal(harness.fetches.some((path) => path === '/kv'), false);
});

test('a model explicitly named by the user overrides Host configuration', async () => {
  const hostPreferences = { 'image.generate': 'image-default' };
  const catalogs = mediaCatalogsForPreferences({
    'image.generate': 'image-default',
    'image.edit': 'image-explicit',
  });
  const harness = createHarness(hostPreferences, catalogs);

  const result = await harness.call('gen_image', {
    prompt: 'a cat',
    model: 'image-explicit',
  });

  assert.equal(result.ok, true);
  assert.equal(result.result.request.modelId, 'image-explicit');
  assert.equal(result.result.request.providerId, 'xd');
  assert.deepEqual(harness.hostRequests, []);
});

test('Host provider selection disambiguates duplicate model ids', async () => {
  const modelId = 'openai/gpt-image-2';
  const model = {
    id: modelId,
    name: 'GPT Image 2',
    modalities: { input: ['text'], output: ['image'] },
  };
  const harness = createHarness(
    { 'image.generate': { modelId, providerId: 'openai' } },
    {
      image: [
        { ...model, providerId: 'xd' },
        { ...model, providerId: 'openai' },
      ],
      video: [],
    },
  );

  const result = await harness.call('gen_image', { prompt: 'a cat' });

  assert.equal(result.ok, true);
  assert.equal(result.result.request.modelId, modelId);
  assert.equal(result.result.request.providerId, 'openai');
});

test('Art rejects a configured model whose modalities do not support the operation', async () => {
  const hash = 'c'.repeat(64);
  const harness = createHarness(
    { 'image.edit': 'text-only-image' },
    {
      image: [
        {
          id: 'text-only-image',
          name: 'Text Only Image',
          providerId: 'xd',
          modalities: { input: ['text'], output: ['image'] },
        },
      ],
      video: [],
    },
  );

  const result = await harness.call('edit_image', {
    prompt: 'add snow',
    images: [`cindy-media://blobs/${hash}.png`],
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /未声明支持改图所需的输入输出模态/);
});

test('Art reports Host preference failures instead of silently choosing the catalog default', async () => {
  const catalogs = mediaCatalogsForPreferences({ 'image.generate': 'image-default' });
  const harness = createHarness({}, catalogs);

  const result = await harness.call('gen_image', { prompt: 'a cat' });

  assert.equal(result.ok, false);
  assert.match(result.message, /当前没有可用的媒体模型/);
});

test('Art translates rejected Host preference requests into an actionable error', async () => {
  const catalogs = mediaCatalogsForPreferences({ 'image.generate': 'image-default' });
  const harness = createHarness(
    { 'image.generate': new Error('Failed to send') },
    catalogs,
  );

  const result = await harness.call('gen_image', { prompt: 'a cat' });

  assert.equal(result.ok, false);
  assert.match(result.message, /无法读取 Art 详情页中的模型配置.*重启 Cindy/);
  assert.doesNotMatch(result.message, /Failed to send/);
});

test('Art translates media catalog transport and JSON failures into actionable errors', async () => {
  const networkResult = await createHarness({}, { image: [], video: [] }, 'network').call(
    'gen_image',
    { prompt: 'a cat' },
  );
  const jsonResult = await createHarness({}, { image: [], video: [] }, 'json').call(
    'gen_image',
    { prompt: 'a cat' },
  );

  assert.equal(networkResult.ok, false);
  assert.match(networkResult.message, /无法连接 Cindy 媒体模型目录.*重试/);
  assert.doesNotMatch(networkResult.message, /Failed to fetch/);
  assert.equal(jsonResult.ok, false);
  assert.match(jsonResult.message, /媒体模型目录响应无法解析.*重启 Cindy/);
  assert.doesNotMatch(jsonResult.message, /Unexpected token/);
});

test('Art logs media catalog HTTP failures and returns one user-facing state', async () => {
  for (const status of [401, 403, 404, 500]) {
    const harness = createHarness({}, { image: [], video: [] }, `http-${status}`);
    const result = await harness.call(
      'gen_image',
      { prompt: 'a cat' },
    );
    assert.equal(result.ok, false);
    assert.equal(result.message, '暂无可用模型');
    assert.deepEqual(structuredClone(harness.warnings), [
      [
        '[cindy-art] media catalog request failed',
        { type: 'image', status },
      ],
    ]);
  }
});
