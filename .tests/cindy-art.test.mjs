import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const root = new URL('../cindy-art/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('ghost.json', root), 'utf8'));
const localizedManifests = ['en', 'ja', 'ko', 'zh-CN'].map((locale) => [
  locale,
  JSON.parse(readFileSync(new URL(`locales/${locale}.json`, root), 'utf8')),
]);
const source = readFileSync(new URL('main.js', root), 'utf8');
const settingsSource = readFileSync(new URL('settings.html', root), 'utf8');
const settingsScriptSource = readFileSync(new URL('settings.js', root), 'utf8');

test('Art settings use a same-origin script allowed by the plugin sandbox CSP', () => {
  const scripts = [...settingsSource.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length > 0);
  for (const [, attributes, body] of scripts) {
    const scriptPath = attributes.match(/\bsrc=["']([^"']+)["']/)?.[1];
    assert.ok(scriptPath, 'Cindy blocks inline scripts, so settings need a bundled script entry');
    assert.equal(body.trim(), '');
    assert.doesNotMatch(scriptPath, /^(?:https?:|data:|\/\/)/);
    assert.ok(readFileSync(new URL(scriptPath, root), 'utf8').trim());
  }
});

const REQUIREMENTS = {
  'image.generate': { type: 'image', input: ['text'], output: ['image'] },
  'image.edit': { type: 'image', input: ['text', 'image'], output: ['image'] },
  'video.generate': { type: 'video', input: ['text'], output: ['video'] },
  'video.image_to_video': { type: 'video', input: ['text', 'image'], output: ['video'] },
};

function normalizePreference(preference) {
  return typeof preference === 'string'
    ? { modelId: preference, providerId: 'xd' }
    : preference;
}

function mediaCatalogsForPreferences(configuredModels) {
  const catalogs = { image: [], video: [] };
  for (const [capability, rawPreference] of Object.entries(configuredModels)) {
    const requirement = REQUIREMENTS[capability];
    if (!requirement) continue;
    const { modelId, providerId } = normalizePreference(rawPreference);
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
  preferences = {},
  mediaCatalogs = { image: [], video: [] },
  mediaCatalogFailure = null,
  options = {},
) {
  let handler;
  const catalogs = structuredClone(mediaCatalogs);
  const results = [];
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
      if (message.type === 'tool-result') {
        results.push(message);
        return { ok: true };
      }
      throw new Error(`unexpected cindy.send type: ${message.type}`);
    },
  };

  async function fetch(path) {
    fetches.push(path);
    if (path === '/kv') {
      if (options.readKv) return options.readKv();
      return {
        ok: true,
        json: async () => structuredClone(preferences),
      };
    }
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
            defaultModelId: options.defaults?.[type]?.modelId ?? models[0]?.id ?? null,
            defaultProviderId: options.defaults?.[type]?.providerId ?? models[0]?.providerId ?? null,
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
    warnings,
    async call(tool, args) {
      await handler({ type: 'tool-call', tool, callId: `call-${tool}`, args });
      await new Promise((resolve) => setImmediate(resolve));
      return results.at(-1);
    },
  };
}

function imageCatalogForTests() {
  return mediaCatalogsForPreferences({
    'image.generate': 'image-model',
    'image.edit': 'image-model',
  });
}

async function createSettingsHarness(preferences, mediaCatalogs, options = {}) {
  function control(dataset = {}) {
    const listeners = new Map();
    return {
      dataset,
      style: {},
      textContent: '',
      attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      classList: { toggle() {}, remove() {} },
      addEventListener(event, listener) { listeners.set(event, listener); },
      click() { return listeners.get('click')({ stopPropagation() {} }); },
    };
  }
  const rootElement = { children: [], appendChild(row) { this.children.push(row); } };
  Object.defineProperty(rootElement, 'textContent', { set() { this.children = []; } });
  const status = control();
  const writes = [];
  const fetches = [];
  const elements = new Map([
    ['capabilities', rootElement], ['status', status], ['card-icon', control()],
    ['card-title', control()], ['card-desc', control()], ['capability-card', control()],
  ]);
  function attribute(attributes, name) {
    return attributes.match(new RegExp('\\b' + name + '="([^"]*)"'))?.[1];
  }
  const document = {
    documentElement: { lang: 'zh-CN' },
    getElementById(id) { return elements.get(id); },
    addEventListener() {},
    querySelectorAll() { return []; },
    createElement() {
      const row = control();
      let html;
      let picker;
      Object.defineProperty(row, 'innerHTML', {
        get() { return html; },
        set(value) {
          html = value;
          row.choices = [...html.matchAll(/<button class="model-option"([^>]*)>/g)].map(([, attributes]) => ({
            ...control({
              modelId: attribute(attributes, 'data-model-id'),
              providerId: attribute(attributes, 'data-provider-id'),
              default: attribute(attributes, 'data-default'),
            }),
            selected: attribute(attributes, 'aria-selected'),
          }));
          const trigger = control();
          const popover = {
            querySelectorAll() { return row.choices; },
          };
          picker = html.includes('class="model-picker"') ? {
            querySelector(selector) { return selector === '.model-trigger' ? trigger : popover; },
          } : null;
        },
      });
      row.querySelector = () => picker;
      return row;
    },
  };
  const context = vm.createContext({
    document,
    URL,
    JSON,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: async (path, init = {}) => {
      fetches.push(path);
      if (path === '/app-context') {
        return options.readAppContext ? options.readAppContext() : {
          ok: true, json: async () => ({ ok: true, context: { locale: options.locale ?? 'zh-CN' } }),
        };
      }
      if (path === '/kv') {
        if (init.method === 'PUT') {
          const next = JSON.parse(init.body);
          writes.push(next);
          const response = options.writeKv ? await options.writeKv(next, writes.length) : { ok: true, status: 204 };
          if (!response.ok) return response;
          for (const key of Object.keys(preferences)) delete preferences[key];
          Object.assign(preferences, next);
          return response;
        }
        return options.readKv ? options.readKv() : { ok: true, json: async () => structuredClone(preferences) };
      }
      assert.ok(['/media-models?type=image', '/media-models?type=video'].includes(path));
      const type = path.endsWith('image') ? 'image' : 'video';
      if (options.readCatalog) return options.readCatalog(type);
      const models = mediaCatalogs[type];
      return { ok: true, json: async () => ({
        ok: true, type, models: structuredClone(models),
        defaultModelId: options.defaults?.[type]?.modelId ?? models[0]?.id ?? null,
        defaultProviderId: options.defaults?.[type]?.providerId ?? models[0]?.providerId ?? null,
      }) };
    },
  });
  vm.runInContext(readFileSync(new URL('settings-icons.js', root), 'utf8'), context);
  vm.runInContext(settingsScriptSource, context);
  await new Promise((resolve) => setImmediate(resolve));
  const row = (capability) => rootElement.children.find((entry) => entry.dataset.capability === capability);
  return {
    row,
    status,
    writes,
    fetches,
    document,
    element(id) { return elements.get(id); },
    async choose(capability, modelId, providerId, isDefault = false) {
      const choice = row(capability)?.choices.find((entry) =>
        entry.dataset.modelId === modelId && entry.dataset.providerId === providerId &&
        entry.dataset.default === String(isDefault));
      assert.ok(choice, `missing ${capability} choice: ${providerId}/${modelId}`);
      choice.click();
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

test('settings review: all four host locales are used instead of HTML language', async () => {
  for (const [locale, title] of [
    ['en', 'Cindy abilities'], ['zh-CN', 'Cindy 能力'], ['ja', 'Cindy 機能'], ['ko', 'Cindy 기능'],
    ['de', 'Cindy abilities'], ['zh-TW', 'Cindy abilities'],
  ]) {
    const settings = await createSettingsHarness({}, imageCatalogForTests(), { locale });
    assert.equal(settings.element('card-title').textContent, title, locale);
    assert.equal(settings.document.documentElement.lang, ['en', 'zh-CN', 'ja', 'ko'].includes(locale) ? locale : 'en');
    assert.equal(settings.element('capability-card').attributes['aria-label'], title);
    assert.ok(settings.fetches.includes('/app-context'));
    assert.ok(settings.row('image.generate'));
  }
});

test('settings review: unavailable host context falls back to English without blocking settings', async () => {
  for (const readAppContext of [
    async () => { throw new Error('unavailable'); },
    async () => ({ ok: false }),
    async () => ({ ok: true, json: async () => { throw new SyntaxError('invalid'); } }),
    async () => ({ ok: true, json: async () => ({ ok: false }) }),
  ]) {
    const settings = await createSettingsHarness({}, imageCatalogForTests(), { readAppContext });
    assert.equal(settings.element('card-title').textContent, 'Cindy abilities');
    assert.equal(settings.document.documentElement.lang, 'en');
    assert.ok(settings.row('image.generate'));
  }
});

test('settings review: a failed save cannot erase a newer queued selection', async () => {
  let finishFirstWrite;
  const preferences = { unrelated: 'preserved' };
  const catalogs = imageCatalogForTests();
  catalogs.image.push({ id: 'second-image', name: 'Second image', providerId: 'custom', modalities: { input: ['text', 'image'], output: ['image'] } });
  const settings = await createSettingsHarness(preferences, catalogs, {
    writeKv: async (next, attempt) => attempt === 1
      ? new Promise((resolve) => { finishFirstWrite = resolve; })
      : { ok: true, status: 204 },
  });
  await settings.choose('image.generate', 'second-image', 'custom');
  assert.equal(settings.writes.length, 1);
  await settings.choose('image.edit', 'second-image', 'custom');
  assert.equal(settings.writes.length, 1);
  finishFirstWrite({ ok: false, status: 500 });
  await new Promise((resolve) => setImmediate(resolve));
  const expected = {
    'image.generate': { modelId: 'second-image', providerId: 'custom' },
    'image.edit': { modelId: 'second-image', providerId: 'custom' },
  };
  assert.deepEqual(preferences.modelOverrides, expected);
  assert.deepEqual(settings.writes[0].modelOverrides, { 'image.generate': expected['image.generate'] });
  assert.deepEqual(settings.writes[1].modelOverrides, expected);
  assert.equal(preferences.unrelated, 'preserved');
  assert.equal(settings.status.textContent, '');
  assert.equal(settings.row('image.edit').choices.find((choice) => choice.dataset.modelId === 'second-image').selected, 'true');
});

test('settings review: the latest failed save keeps the last successful selection and its error', async () => {
  const preferences = { unrelated: 'preserved' };
  const catalogs = imageCatalogForTests();
  catalogs.image.push({ id: 'second-image', name: 'Second image', providerId: 'custom', modalities: { input: ['text', 'image'], output: ['image'] } });
  const settings = await createSettingsHarness(preferences, catalogs, {
    writeKv: async (next, attempt) => ({ ok: attempt === 1, status: attempt === 1 ? 204 : 500 }),
  });
  await settings.choose('image.generate', 'second-image', 'custom');
  await settings.choose('image.edit', 'second-image', 'custom');
  assert.deepEqual(preferences.modelOverrides, { 'image.generate': { modelId: 'second-image', providerId: 'custom' } });
  assert.match(settings.status.textContent, /模型配置保存失败.*重试/);
  assert.equal(settings.row('image.edit').choices.filter((choice) => choice.selected === 'true').length, 0);
  assert.match(settings.row('image.edit').innerHTML, /class="model-name">未配置模型<\/span>/);
});

test('settings review: duplicate model labels identify providers in the menu and current selection', async () => {
  for (const providerName of [undefined, 'Same brand']) {
    const catalogs = { image: ['custom-a', 'custom-b'].map((providerId) => ({
      id: 'shared-model', name: 'Shared Model', providerId, providerName,
      modalities: { input: ['text'], output: ['image'] },
    })), video: [] };
    const preferences = { modelOverrides: { 'image.generate': { modelId: 'shared-model', providerId: 'custom-b' } } };
    const settings = await createSettingsHarness(preferences, catalogs);
    const html = settings.row('image.generate').innerHTML;
    assert.match(html, /class="model-name">Shared Model[^<]*custom-b[^<]*<\/span>/);
    assert.match(html, /class="option-label">[^<]*custom-a[^<]*<\/span>/);
    assert.match(html, /class="option-label">[^<]*custom-b[^<]*<\/span>/);
    assert.match(html, /title="[^"]*custom-b[^"]*"/);
  }
});

test('settings review: catalog failures are distinct from successful empty directories', async () => {
  for (const failure of [
    async () => { throw new Error('unavailable'); },
    async () => ({ ok: false, status: 500 }),
    async () => ({ ok: true, json: async () => { throw new SyntaxError('invalid'); } }),
    async () => ({ ok: true, json: async () => ({ ok: false, models: [] }) }),
    async () => ({ ok: true, json: async () => ({ ok: true, models: {} }) }),
  ]) {
    for (const failedType of ['image', 'video', 'both']) {
      const settings = await createSettingsHarness({}, imageCatalogForTests(), {
        readCatalog: async (type) => type === failedType || failedType === 'both'
          ? failure()
          : { ok: true, json: async () => ({ ok: true, models: imageCatalogForTests()[type] }) },
      });
      assert.match(settings.status.textContent, /模型配置加载失败.*重新打开/);
      assert.doesNotMatch(settings.status.textContent, /暂无可用模型/);
      assert.equal(settings.writes.length, 0);
    }
  }
  const empty = await createSettingsHarness({}, { image: [], video: [] });
  assert.equal(empty.status.textContent, '暂无可用模型');
});

test('all four settings can explicitly save the only catalog model and use it without asking again', async (t) => {
  const catalogs = Object.fromEntries(['image', 'video'].map((type) => [type, [{
    id: `only-${type}`, providerId: 'xd',
    modalities: { input: ['text', 'image'], output: [type] },
  }]]));
  for (const [tool, capability, type] of [
    ['gen_image', 'image.generate', 'image'], ['edit_image', 'image.edit', 'image'],
    ['gen_video', 'video.generate', 'video'], ['edit_video', 'video.edit', 'video'],
  ]) {
    await t.test(capability, async () => {
      const otherCapability = capability === 'image.generate' ? 'video.edit' : 'image.generate';
      const existing = { modelId: 'saved-model', providerId: 'saved-provider' };
      const preferences = { unrelated: 'preserved', modelOverrides: { [otherCapability]: existing } };
      const settings = await createSettingsHarness(preferences, catalogs);
      const initialRow = settings.row(capability);
      const choice = initialRow.choices.find((entry) => entry.dataset.modelId === `only-${type}`);
      assert.ok(choice);
      assert.equal(settings.writes.length, 0);
      await settings.choose(capability, choice.dataset.modelId, choice.dataset.providerId, choice.dataset.default === 'true');
      const expected = { modelId: `only-${type}`, providerId: 'xd' };
      assert.deepEqual(preferences.modelOverrides[capability], expected);
      assert.deepEqual(preferences.modelOverrides[otherCapability], existing);
      assert.equal(preferences.unrelated, 'preserved');
      assert.equal(initialRow.choices.filter((entry) => entry.selected === 'true').length, 0);
      assert.match(initialRow.innerHTML, /class="model-name">未配置模型<\/span>/);
      const reopened = await createSettingsHarness(preferences, catalogs);
      assert.equal(reopened.row(capability).choices.filter((entry) => entry.selected === 'true').length, 1);
      const runtime = createHarness(preferences, catalogs);
      const result = await runtime.call(tool, { prompt: 'check explicit selection', images: [`cindy-media://blobs/${'a'.repeat(64)}.png`] });
      assert.equal(result.ok, true, tool);
      assert.equal(result.result.request.modelId, expected.modelId);
      assert.equal(result.result.request.providerId, expected.providerId);
    });
  }
});

test('settings review: a saved default tuple stays pinned and has exactly one selected option', async () => {
  const preferences = { modelOverrides: { 'image.generate': { modelId: 'image-model', providerId: 'xd' } } };
  const catalogs = imageCatalogForTests();
  const settings = await createSettingsHarness(preferences, catalogs);
  const selected = settings.row('image.generate').choices.filter((choice) => choice.selected === 'true');
  assert.equal(selected.length, 1);
  assert.equal(selected[0].dataset.default, 'false');
  assert.equal(selected[0].dataset.modelId, 'image-model');
  assert.equal(selected[0].dataset.providerId, 'xd');
  assert.equal(settings.writes.length, 0);
  catalogs.image.push({ id: 'another-default', providerId: 'custom', modalities: { input: ['text'], output: ['image'] } });
  const changedDefault = await createSettingsHarness(preferences, catalogs, {
    defaults: { image: { modelId: 'another-default', providerId: 'custom' } },
  });
  assert.equal(changedDefault.row('image.generate').choices.filter((choice) => choice.selected === 'true').length, 1);
  await settings.choose('image.generate', 'image-model', 'xd');
  assert.deepEqual(preferences.modelOverrides['image.generate'], { modelId: 'image-model', providerId: 'xd' });
  assert.equal(settings.row('image.generate').choices.filter((choice) => choice.selected === 'true').length, 1);
});

test('settings keep same-name providers distinct through save, reopen and tool reads', async () => {
  const preferences = {};
  const catalogs = { image: [
    { id: 'shared-model', name: 'Shared Model', providerId: 'other-provider', modalities: { input: ['text'], output: ['image'] } },
    { id: 'shared-model', name: 'Shared Model', providerId: 'xd', modalities: { input: ['text'], output: ['image'] } },
  ], video: [] };
  const options = { defaults: { image: { modelId: 'shared-model', providerId: 'xd' } } };
  const settings = await createSettingsHarness(preferences, catalogs, options);
  assert.deepEqual(settings.row('image.generate').choices.map((choice) => choice.dataset.providerId), ['other-provider', 'xd']);
  const runtime = createHarness(preferences, catalogs, null, options);
  await settings.choose('image.generate', 'shared-model', 'other-provider');
  assert.deepEqual(preferences.modelOverrides['image.generate'], { modelId: 'shared-model', providerId: 'other-provider' });
  let result = await runtime.call('gen_image', { prompt: 'check saved provider' });
  assert.equal(result.result.request.providerId, 'other-provider');
  const reopened = await createSettingsHarness(preferences, catalogs, options);
  assert.equal(reopened.row('image.generate').choices.find((choice) => choice.dataset.providerId === 'other-provider').selected, 'true');
  await reopened.choose('image.generate', 'shared-model', 'xd');
  assert.deepEqual(preferences.modelOverrides['image.generate'], { modelId: 'shared-model', providerId: 'xd' });
  result = await runtime.call('gen_image', { prompt: 'check saved Cindy provider' });
  assert.equal(result.ok, true);
  assert.equal(result.result.request.providerId, 'xd');
});

test('all four model menus put personal providers before Cindy without changing selections', async () => {
  const models = (output) => [
    { id: 'cindy-a', providerId: 'xd' },
    { id: 'personal-b', providerId: 'custom-b' },
    { id: 'personal-openai', providerId: 'openai' },
    { id: 'cindy-b', providerId: 'xd' },
    { id: 'personal-a', providerId: 'custom-a' },
  ].map((model) => ({ ...model, name: model.id, modalities: { input: ['text', 'image'], output: [output] } }));
  const catalogs = { image: models('image'), video: models('video') };
  const defaults = Object.fromEntries(['image', 'video'].map((type) => [type, { modelId: 'cindy-b', providerId: 'xd' }]));
  for (const capability of ['image.generate', 'image.edit', 'video.generate', 'video.edit']) {
    for (const selection of [null, { modelId: 'personal-openai', providerId: 'openai' }, { modelId: 'cindy-b', providerId: 'xd' }]) {
      const preferences = selection ? { modelOverrides: { [capability]: selection } } : {};
      const original = structuredClone(preferences);
      const settings = await createSettingsHarness(preferences, catalogs, { defaults });
      const choices = settings.row(capability).choices;
      assert.deepEqual(choices.filter((choice) => choice.dataset.providerId !== 'xd').map((choice) => choice.dataset.modelId), ['personal-b', 'personal-openai', 'personal-a']);
      const firstCindy = choices.findIndex((choice) => choice.dataset.providerId === 'xd');
      assert.equal(firstCindy, 3, capability);
      assert.ok(choices.slice(firstCindy).every((choice) => choice.dataset.providerId === 'xd'));
      assert.deepEqual(choices.slice(firstCindy).map((choice) => choice.dataset.modelId), ['cindy-b', 'cindy-a']);
      const selected = choices.filter((choice) => choice.selected === 'true');
      assert.equal(selected.length, selection ? 1 : 0);
      if (selection) assert.equal(selected[0].dataset.modelId, selection.modelId);
      assert.deepEqual(preferences, original);
      assert.equal(settings.writes.length, 0);
    }
  }
});

test('settings preserve an unavailable provider pin instead of displaying a different source', async () => {
  const preferences = { modelOverrides: { 'image.generate': { modelId: 'shared-model', providerId: 'saved-provider' } } };
  const catalogs = { image: [{ id: 'shared-model', name: 'Other source label', providerId: 'xd', modalities: { input: ['text'], output: ['image'] } }], video: [] };
  const settings = await createSettingsHarness(preferences, catalogs);
  assert.match(settings.row('image.generate').innerHTML, /class="model-name">shared-model<\/span>/);
  assert.equal(settings.row('image.generate').choices.find((choice) => choice.dataset.providerId === 'saved-provider').selected, 'true');
  assert.equal(settings.writes.length, 0);
});

test('settings configuration read failures show an error without rendering default selections', async () => {
  for (const readKv of [
    async () => { throw new Error('unavailable'); },
    async () => ({ ok: false }),
    async () => ({ ok: true, json: async () => { throw new SyntaxError('invalid'); } }),
    async () => ({ ok: true, json: async () => [] }),
  ]) {
    const settings = await createSettingsHarness({}, imageCatalogForTests(), { readKv });
    assert.match(settings.status.textContent, /模型配置加载失败/);
    assert.equal(settings.row('image.generate'), undefined);
    assert.equal(settings.writes.length, 0);
  }
});

test('all four settings are saved, reloaded and read by their corresponding tools', async () => {
  const expected = {
    'image.generate': { modelId: 'picked-image-generate', providerId: 'image-provider' },
    'image.edit': { modelId: 'picked-image-edit', providerId: 'edit-provider' },
    'video.generate': { modelId: 'picked-video-generate', providerId: 'video-provider' },
    'video.edit': { modelId: 'picked-video-edit', providerId: 'motion-provider' },
  };
  const catalogs = mediaCatalogsForPreferences({ ...expected, 'video.image_to_video': expected['video.edit'] });
  catalogs.image.unshift({ id: 'default-image', name: 'Default image', providerId: 'xd', modalities: { input: ['text', 'image'], output: ['image'] } });
  catalogs.video.unshift({ id: 'default-video', name: 'Default video', providerId: 'xd', modalities: { input: ['text', 'image'], output: ['video'] } });
  const preferences = { unrelated: 'preserved' };
  const settings = await createSettingsHarness(preferences, catalogs);
  const runtime = createHarness(preferences, catalogs);
  for (const [capability, selection] of Object.entries(expected)) {
    await settings.choose(capability, selection.modelId, selection.providerId);
  }
  assert.deepEqual(preferences.modelOverrides, expected);
  assert.equal(preferences.unrelated, 'preserved');
  assert.equal(settings.writes.length, 4);
  const reopened = await createSettingsHarness(preferences, catalogs);
  for (const [tool, capability] of [
    ['gen_image', 'image.generate'], ['edit_image', 'image.edit'],
    ['gen_video', 'video.generate'], ['edit_video', 'video.edit'],
  ]) {
    const selection = expected[capability];
    assert.ok(reopened.row(capability).choices.some((choice) => choice.dataset.modelId === selection.modelId && choice.dataset.providerId === selection.providerId && choice.selected === 'true'));
    const result = await runtime.call(tool, { prompt: 'check settings round trip', images: [`cindy-media://blobs/${'a'.repeat(64)}.png`] });
    assert.equal(result.ok, true, tool);
    assert.equal(result.result.request.modelId, selection.modelId);
    assert.equal(result.result.request.providerId, selection.providerId);
  }
});

test('manifest exposes only the four media preparation tools and the Art settings page', () => {
  assert.equal(manifest.version, '1.15.7');
  assert.equal(manifest.minCindyVersion, '0.1.68');
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(manifest.settingsHtml, 'settings.html');
  assert.equal(manifest.card, undefined);
  assert.equal(manifest.slots, undefined);
  assert.match(manifest.whenToUse, /未明确指定其它媒体生成渠道时,优先使用 Art/);
  assert.deepEqual(
    manifest.tools.map(({ name }) => name),
    ['gen_image', 'edit_image', 'gen_video', 'edit_video'],
  );
  for (const tool of manifest.tools) {
    assert.equal(tool.parameters.properties.model.type, 'string');
    assert.equal(tool.parameters.properties.model.enum, undefined);
    assert.match(tool.description, /request\.providerId/);
    assert.match(tool.description, /provider_id/);
    assert.match(tool.description, /cindy-media:\/\//);
    assert.match(tool.description, /xdt-\*:\/\//);
    assert.match(tool.description, /attachments/);
    assert.match(tool.description, /mcp__cindy__media/);
    assert.match(tool.description, /resolve_local_path/);
  }
  for (const [locale, localized] of localizedManifests) {
    assert.deepEqual(Object.keys(localized.tools), manifest.tools.map(({ name }) => name), locale);
    for (const { name } of manifest.tools) {
      const description = localized.tools[name].description;
      assert.match(description, /cindy-media:\/\//, locale);
      assert.match(description, /xdt-\*:\/\//, locale);
      assert.match(description, /attachments/, locale);
      assert.match(description, /mcp__cindy__media/, locale);
      assert.match(description, /resolve_local_path/, locale);
    }
  }
  assert.doesNotMatch(JSON.stringify(manifest), /import_artwork|gallery|画廊/);
});

test('Art settings page reproduces the four Cindy capability rows', () => {
  assert.match(settingsScriptSource, /\/media-models\?type=image/);
  assert.match(settingsScriptSource, /\/media-models\?type=video/);
  assert.match(settingsScriptSource, /modelOverrides/);
  assert.match(settingsScriptSource, /image\.generate/);
  assert.match(settingsScriptSource, /image\.edit/);
  assert.match(settingsScriptSource, /video\.generate/);
  assert.match(settingsScriptSource, /video\.edit/);
  assert.match(settingsScriptSource, /supportsCapability/);
  assert.match(settingsScriptSource, /fetch\('\/kv', \{ method: 'PUT'/);
});

test('Art settings describe plugin-owned choices without the removed system-default Proxy wording', () => {
  const descriptions = [...settingsScriptSource.matchAll(/^\s+desc: '([^']+)'/gm)].map((match) => match[1]);
  assert.equal(descriptions.length, 4);
  for (const description of descriptions) {
    assert.ok(description.includes('Art'), 'settings must describe Art-owned model preferences');
    assert.ok(!/Proxy|proxy|プロキシ|프록시|跟随系统|follow the system|システム|시스템/.test(description),
      'the removed client system-default behavior must not be presented as an Art setting');
  }
  assert.equal(settingsSource.match(/<p class="card-desc" id="card-desc">([^<]+)<\/p>/)[1], descriptions[1]);
});

test('Art settings reuse the pre-6073 provider and Lucide SVGs without substitute icons', () => {
  assert.match(settingsSource, /<script src="settings-icons\.js"><\/script>/);
  const context = { URL };
  vm.runInNewContext(readFileSync(new URL('settings-icons.js', root), 'utf8'), context);
  const { providerMark, icon } = context.artSettingsIcons;
  const paths = (svg) => [...svg.matchAll(/\bd="([^"]+)"/g)].map((match) => match[1]);
  const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const xd = providerMark({ providerId: 'xd', providerName: 'Cindy AI' });
  assert.equal(digest(paths(xd)), '1e4b09088de6f3da49e7f1c38ed29234bcc17f84443395f6b5079fc338048689');
  assert.match(xd, /viewBox="136 137 282 158"/);
  assert.match(xd, /width="14\.2" height="8\.4"/);
  assert.match(providerMark({ providerId: 'openai' }), /width="12\.3" height="12\.3"/);
  assert.match(providerMark({ providerId: 'custom', providerName: 'Custom' }), /provider-monogram[^>]*>C<\/span>/);
  assert.equal(providerMark({ providerId: 'unknown' }), '');
  assert.doesNotMatch(settingsScriptSource, /var providerMarks\s*=/);
  assert.doesNotMatch(settingsSource, /\.provider-mark\.(?:qwen|volc|grok|openai)/);
  for (const [name, expected] of Object.entries({"sparkles":[["path",{"d":"M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z","key":"4pj2yx"}],["path",{"d":"M20 3v4","key":"1olli1"}],["path",{"d":"M22 5h-4","key":"1gvqau"}],["path",{"d":"M4 17v2","key":"vumght"}],["path",{"d":"M5 18H3","key":"zchphs"}]],"chevron-down":[["path",{"d":"m6 9 6 6 6-6","key":"qrunsl"}]],"check":[["path",{"d":"M20 6 9 17l-5-5","key":"1gmf2c"}]]})) {
    assert.deepEqual(paths(icon(name)), expected.map(([, attributes]) => attributes.d));
    assert.match(icon(name), /stroke-width="2"/);
  }
});

test('Art settings constrain the original picker to its sandbox viewport', () => {
  const match = settingsScriptSource.match(/  function positionPopover\(trigger, popover\) \{[\s\S]*?\n  \}/);
  assert.ok(match, 'the picker must avoid clipping at the settings webview boundary');
  const position = vm.runInNewContext('(' + match[0] + ')', { window: { innerHeight: 280 } });
  for (const [top, bottom, expectedSide, expectedHeight] of [[70, 102, 'bottom', '162px'], [220, 252, 'top', '204px']]) {
    const list = { scrollHeight: 600, style: {} };
    const popover = { style: {}, dataset: {}, querySelector: () => list };
    position({ getBoundingClientRect: () => ({ top, bottom }) }, popover);
    assert.equal(popover.dataset.side, expectedSide);
    assert.equal(list.style.maxHeight, expectedHeight);
  }
});

test('each capability uses the model saved in Art settings', async () => {
  const hash = 'b'.repeat(64);
  const preferences = {
    modelOverrides: {
      'image.generate': { modelId: 'image-gen-model', providerId: 'xd' },
      'image.edit': { modelId: 'image-edit-model', providerId: 'xd' },
      'video.generate': { modelId: 'video-gen-model', providerId: 'xd' },
      'video.edit': { modelId: 'video-edit-model', providerId: 'xd' },
    },
  };
  const catalogs = mediaCatalogsForPreferences({
    'image.generate': 'image-gen-model',
    'image.edit': 'image-edit-model',
    'video.generate': 'video-gen-model',
    'video.image_to_video': 'video-edit-model',
  });
  const harness = createHarness(preferences, catalogs);

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
  assert.equal(image.result.request.modelId, 'image-gen-model');
  assert.equal(image.result.request.providerId, 'xd');
  assert.equal(edit.result.request.modelId, 'image-edit-model');
  assert.equal(edit.result.request.providerId, 'xd');
  assert.equal(video.result.request.modelId, 'video-gen-model');
  assert.equal(video.result.request.providerId, 'xd');
  assert.equal(imageToVideo.result.request.modelId, 'video-edit-model');
  assert.equal(imageToVideo.result.request.providerId, 'xd');
  assert.equal(harness.fetches.filter((path) => path === '/kv').length, 4);
  assert.equal(harness.fetches.filter((path) => path.startsWith('/media-models')).length, 0);
});

test('legacy image/video settings still apply to both operations of that type', async () => {
  const hash = 'e'.repeat(64);
  const harness = createHarness(
    { imageModelId: 'legacy-image', videoModelId: 'legacy-video' },
    mediaCatalogsForPreferences({
      'image.generate': 'legacy-image',
      'image.edit': 'legacy-image',
      'video.generate': 'legacy-video',
      'video.image_to_video': 'legacy-video',
    }),
  );

  const image = await harness.call('gen_image', { prompt: 'a cat' });
  const edit = await harness.call('edit_image', {
    prompt: 'add snow',
    images: [`cindy-media://blobs/${hash}.png`],
  });
  const video = await harness.call('gen_video', { prompt: 'a running cat' });
  const imageToVideo = await harness.call('edit_video', {
    prompt: 'make it move',
    images: [`cindy-media://blobs/${hash}.png`],
  });

  assert.equal(image.result.request.modelId, 'legacy-image');
  assert.equal(edit.result.request.modelId, 'legacy-image');
  assert.equal(video.result.request.modelId, 'legacy-video');
  assert.equal(imageToVideo.result.request.modelId, 'legacy-video');
});

test('per-capability Art settings win over legacy image/video settings', async () => {
  const harness = createHarness(
    {
      imageModelId: 'legacy-image',
      modelOverrides: {
        'image.generate': { modelId: 'capability-image', providerId: 'xd' },
      },
    },
    mediaCatalogsForPreferences({
      'image.generate': 'capability-image',
      'image.edit': 'legacy-image',
    }),
  );

  const image = await harness.call('gen_image', { prompt: 'a cat' });
  const edit = await harness.call('edit_image', {
    prompt: 'add snow',
    images: [`cindy-media://blobs/${'f'.repeat(64)}.png`],
  });

  assert.equal(image.result.request.modelId, 'capability-image');
  assert.equal(edit.result.request.modelId, 'legacy-image');
});

test('a model explicitly named by the user overrides Art settings', async () => {
  const preferences = { imageModelId: 'image-default', imageModelProviderId: 'xd' };
  const catalogs = mediaCatalogsForPreferences({
    'image.generate': 'image-default',
    'image.edit': 'image-explicit',
  });
  const harness = createHarness(preferences, catalogs);

  const result = await harness.call('gen_image', {
    prompt: 'a cat',
    model: 'image-explicit',
  });

  assert.equal(result.ok, true);
  assert.equal(result.result.request.modelId, 'image-explicit');
  assert.equal(result.result.request.providerId, 'xd');
});

test('Art settings provider selection disambiguates duplicate model ids', async () => {
  const modelId = 'openai/gpt-image-2';
  const model = {
    id: modelId,
    name: 'GPT Image 2',
    modalities: { input: ['text'], output: ['image'] },
  };
  const harness = createHarness(
    { modelOverrides: { 'image.generate': { modelId, providerId: 'openai' } } },
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

test('without a saved model Art asks the user which model to use', async () => {
  const catalogs = mediaCatalogsForPreferences({ 'image.generate': 'catalog-default' });
  const harness = createHarness({}, catalogs);

  const result = await harness.call('gen_image', { prompt: 'a cat' });

  assert.equal(result.ok, false);
  assert.match(result.message, /没有配置模型.*询问.*哪个模型.*等待用户回答/);
  assert.equal(result.result, undefined);
  assert.deepEqual(harness.fetches, ['/kv']);
});

test('a saved model tuple is not replaced when absent from the public catalog', async () => {
  const catalogs = mediaCatalogsForPreferences({ 'image.generate': 'catalog-default' });
  const harness = createHarness(
    { imageModelId: 'removed-model', imageModelProviderId: 'xd' },
    catalogs,
  );

  const result = await harness.call('gen_image', { prompt: 'a cat' });

  assert.equal(result.ok, true);
  assert.equal(result.result.request.modelId, 'removed-model');
  assert.equal(result.result.request.providerId, 'xd');
});

test('all four tools preserve saved model/provider tuples when the public catalog is unavailable', async () => {
  const media = `cindy-media://blobs/${'a'.repeat(64)}.png`;
  const tools = [
    ['gen_image', 'image.generate'],
    ['edit_image', 'image.edit'],
    ['gen_video', 'video.generate'],
    ['edit_video', 'video.edit'],
  ];
  const preferences = { modelOverrides: Object.fromEntries(tools.map(([, capability]) => [
    capability, { modelId: `${capability}-subscription`, providerId: 'subscription-provider' },
  ])) };
  const harness = createHarness(preferences, { image: [], video: [] }, 'network');
  for (const [tool, capability] of tools) {
    const result = await harness.call(tool, { prompt: 'check configured model', images: [media] });
    assert.equal(result.ok, true, tool);
    assert.equal(result.result.request.modelId, preferences.modelOverrides[capability].modelId);
    assert.equal(result.result.request.providerId, 'subscription-provider');
  }
  assert.deepEqual(harness.fetches, ['/kv', '/kv', '/kv', '/kv']);
});

test('a saved provider is not silently replaced by another provider offering the same model id', async () => {
  const modelId = 'shared-image';
  const catalogs = mediaCatalogsForPreferences({ 'image.generate': { modelId, providerId: 'other-provider' } });
  const harness = createHarness({ modelOverrides: {
    'image.generate': { modelId, providerId: 'saved-provider' },
  } }, catalogs);
  const result = await harness.call('gen_image', { prompt: 'check provider' });
  assert.equal(result.ok, true);
  assert.equal(result.result.request.modelId, modelId);
  assert.equal(result.result.request.providerId, 'saved-provider');
});

test('configuration read failures stop the call rather than silently selecting a default model', async () => {
  for (const readKv of [
    async () => { throw new Error('network unavailable'); },
    async () => ({ ok: false, status: 500 }),
    async () => ({ ok: true, json: async () => { throw new SyntaxError('invalid JSON'); } }),
    async () => ({ ok: true, json: async () => [] }),
  ]) {
    const harness = createHarness({}, imageCatalogForTests(), null, { readKv });
    const result = await harness.call('gen_image', { prompt: 'check config' });
    assert.equal(result.ok, false);
    assert.match(result.message, /Art.*模型配置.*重试/);
    assert.equal(result.result, undefined);
    assert.deepEqual(harness.fetches, ['/kv']);
  }
});

test('unconfigured tools ask the user instead of choosing a catalog model', async () => {
  const catalogs = {
    image: [
      { id: 'image-shared', providerId: 'other-provider', modalities: { input: ['text'], output: ['image'] } },
      { id: 'image-shared', providerId: 'xd', modalities: { input: ['text'], output: ['image'] } },
      { id: 'image-edit', providerId: 'edit-provider', modalities: { input: ['text', 'image'], output: ['image'] } },
    ],
    video: [
      { id: 'video-default', providerId: 'xd', modalities: { input: ['text'], output: ['video'] } },
      { id: 'video-edit', providerId: 'video-provider', modalities: { input: ['text', 'image'], output: ['video'] } },
    ],
  };
  const harness = createHarness({}, catalogs, null, {
    defaults: { image: { modelId: 'image-shared', providerId: 'xd' } },
  });
  for (const tool of ['gen_image', 'edit_image', 'gen_video', 'edit_video']) {
    const result = await harness.call(tool, { prompt: 'check compatible default', images: [`cindy-media://blobs/${'a'.repeat(64)}.png`] });
    assert.equal(result.ok, false, tool);
    assert.match(result.message, /没有配置模型.*询问.*哪个模型/);
    assert.equal(result.result, undefined);
  }
});

test('legacy model-only selections do not silently switch to an unrelated default', async () => {
  const harness = createHarness({ modelOverrides: { 'image.generate': 'missing-image' } }, imageCatalogForTests());
  const result = await harness.call('gen_image', { prompt: 'check model-only selection' });
  assert.equal(result.ok, false);
  assert.match(result.message, /missing-image.*Art.*重新选择/);
});

test('Art still validates explicitly named models against the media catalog', async () => {
  const hash = 'd'.repeat(64);
  const harness = createHarness(
    {},
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
    model: 'text-only-image',
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /未声明支持改图所需的输入输出模态/);
});

test('Art translates media catalog transport and JSON failures into actionable errors', async () => {
  const networkResult = await createHarness({}, { image: [], video: [] }, 'network').call(
    'gen_image',
    { prompt: 'a cat', model: 'explicit-image' },
  );
  const jsonResult = await createHarness({}, { image: [], video: [] }, 'json').call(
    'gen_image',
    { prompt: 'a cat', model: 'explicit-image' },
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
      { prompt: 'a cat', model: 'explicit-image' },
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

for (const tool of ['gen_image', 'edit_image']) {
  test(tool + ' rejects malformed explicit aspect ratios but preserves omission and trimmed values', async () => {
    const harness = createHarness(
      { imageModelId: 'image-model', imageModelProviderId: 'xd' },
      imageCatalogForTests(),
    );
    const args = { prompt: 'wallpaper', images: ['cindy-media://blobs/' + 'a'.repeat(64) + '.png'] };
    for (const aspectRatio of ['', '   ', '\t\n', null, 169, {}, []]) {
      const result = await harness.call(tool, { ...args, aspectRatio });
      assert.equal(result.ok, false);
      assert.equal(result.message, 'aspectRatio 必须是非空字符串');
      assert.equal(result.result, undefined);
    }
    const omitted = await harness.call(tool, args);
    assert.equal(omitted.ok, true);
    assert.equal(omitted.result.request.aspectRatioIntent, undefined);
    const valid = await harness.call(tool, { ...args, aspectRatio: ' 110:239 ' });
    assert.equal(valid.ok, true);
    assert.equal(valid.result.request.aspectRatioIntent, '110:239');
  });

  test(tool + ' preserves exact size, quality, resolution and phone aspect ratio', async () => {
    const harness = createHarness(
      { imageModelId: 'image-model', imageModelProviderId: 'xd' },
      imageCatalogForTests(),
    );
    const result = await harness.call(tool, {
      prompt: 'wallpaper',
      images: ['cindy-media://blobs/' + 'a'.repeat(64) + '.png'],
      size: '1320x2868',
      aspectRatio: '110:239',
      resolution: '4K',
      quality: 'max',
      tier: 'best',
    });
    assert.equal(result.ok, true);
    assert.equal(result.result.request.size, '1320x2868');
    assert.equal(result.result.request.aspectRatioIntent, '110:239');
    assert.equal(result.result.request.resolution, '4K');
    assert.equal(result.result.request.quality, 'max');
    assert.equal(result.result.request.qualityIntent, 'best');
    assert.match(result.result.parameterGuidance, /invocation_id/);
    const properties = manifest.tools.find((entry) => entry.name === tool).parameters.properties;
    assert.equal(properties.aspectRatio.enum, undefined);
    for (const key of ['size', 'resolution', 'quality']) assert.equal(properties[key].type, 'string');
  });
}

test('omitted native parameters remain unspecified; malformed explicit values fail', async () => {
  const harness = createHarness(
    { imageModelId: 'image-model', imageModelProviderId: 'xd' },
    imageCatalogForTests(),
  );
  const result = await harness.call('gen_image', { prompt: 'cat' });
  for (const key of ['size', 'resolution', 'quality', 'aspectRatioIntent']) {
    assert.equal(result.result.request[key], undefined);
  }
  assert.equal((await harness.call('gen_image', { prompt: 'cat', size: 2048 })).ok, false);
});
