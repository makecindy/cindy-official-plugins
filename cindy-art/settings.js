(function () {
  'use strict';

  var COPY = {
    zh: {
      title: 'Cindy 能力',
      desc: '分别为出图、改图、生成视频和图生视频选择模型，配置保存在 Art 插件内。',
      imageGenerate: '出图',
      imageEdit: '改图',
      videoGenerate: '生成视频',
      videoEdit: '图生视频',
      defaultOption: '{model}(默认)',
      noModels: '暂无可用模型',
      loading: '正在读取模型目录…',
      loadFailed: '模型配置加载失败，请重新打开设置页',
      saving: '正在保存…',
      saved: '已保存',
      saveFailed: '模型配置保存失败，请重试'
    },
    en: {
      title: 'Cindy abilities',
      desc: 'Choose a model for image generation, image editing, video generation and image-to-video. These settings are saved in the Art plugin.',
      imageGenerate: 'Image generation',
      imageEdit: 'Image editing',
      videoGenerate: 'Video generation',
      videoEdit: 'Image to video',
      defaultOption: '{model} (default)',
      noModels: 'No models available',
      loading: 'Loading model catalog…',
      loadFailed: 'Could not load model settings. Reopen this page.',
      saving: 'Saving…',
      saved: 'Saved',
      saveFailed: 'Could not save model settings. Try again.'
    },
    ja: {
      title: 'Cindy 機能',
      desc: '画像生成、画像編集、動画生成、画像から動画のモデルを個別に選択できます。設定は Art プラグイン内に保存されます。',
      imageGenerate: '画像生成',
      imageEdit: '画像編集',
      videoGenerate: '動画生成',
      videoEdit: '画像から動画',
      defaultOption: '{model}(既定)',
      noModels: '利用可能なモデルがありません',
      loading: 'モデル一覧を読み込み中…',
      loadFailed: 'モデル設定を読み込めませんでした。設定ページを開き直してください。',
      saving: '保存中…',
      saved: '保存しました',
      saveFailed: 'モデル設定を保存できませんでした。再試行してください。'
    },
    ko: {
      title: 'Cindy 기능',
      desc: '이미지 생성, 이미지 편집, 동영상 생성, 이미지에서 동영상 생성에 사용할 모델을 각각 선택하세요. 설정은 Art 플러그인에 저장됩니다.',
      imageGenerate: '이미지 생성',
      imageEdit: '이미지 편집',
      videoGenerate: '동영상 생성',
      videoEdit: '이미지에서 동영상',
      defaultOption: '{model}(기본)',
      noModels: '사용 가능한 모델이 없습니다',
      loading: '모델 목록을 불러오는 중…',
      loadFailed: '모델 설정을 불러오지 못했습니다. 설정 페이지를 다시 열어 주세요.',
      saving: '저장 중…',
      saved: '저장됨',
      saveFailed: '모델 설정을 저장하지 못했습니다. 다시 시도해 주세요.'
    }
  };

  async function loadLocale() {
    var locale = 'en';
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 2000);
    try {
      var response = await fetch('/app-context', { signal: controller.signal });
      if (!response.ok) throw new Error('app-context read failed');
      var result = await response.json();
      var requested = result && result.ok === true && result.context && result.context.locale;
      if (['zh-CN', 'en', 'ja', 'ko'].indexOf(requested) !== -1) locale = requested;
    } catch (error) {
      locale = 'en';
    } finally {
      clearTimeout(timeout);
    }
    copy = COPY[locale === 'zh-CN' ? 'zh' : locale];
    document.documentElement.lang = locale;
    document.getElementById('capability-card').setAttribute('aria-label', t('title'));
    document.getElementById('card-title').textContent = t('title');
    document.getElementById('card-desc').textContent = t('desc');
  }

  var copy = COPY.en;
  function t(key, vars) {
    var value = copy[key] || COPY.en[key] || key;
    return vars ? value.replace(/\{(\w+)\}/g, function (_, name) { return String(vars[name] || ''); }) : value;
  }

  var CAPABILITIES = [
    { key: 'image.generate', type: 'image', label: 'imageGenerate', input: ['text'], output: 'image' },
    { key: 'image.edit', type: 'image', label: 'imageEdit', input: ['text', 'image'], output: 'image' },
    { key: 'video.generate', type: 'video', label: 'videoGenerate', input: ['text'], output: 'video' },
    { key: 'video.edit', type: 'video', label: 'videoEdit', input: ['text', 'image'], output: 'video' }
  ];

  var providerMark = artSettingsIcons.providerMark;

  var root = document.getElementById('capabilities');
  var status = document.getElementById('status');
  var catalogs = { image: { models: [], defaultModelId: null }, video: { models: [], defaultModelId: null } };
  var state = {};
  var overrides = {};
  var lastSavedOverrides = {};
  var writeQueue = Promise.resolve();
  var editRevision = 0;

  function setStatus(message, isError) {
    status.textContent = message || '';
    status.classList.toggle('is-error', Boolean(isError));
  }

  function readCatalog(path) {
    return fetch(path)
      .then(function (response) {
        if (!response.ok) throw new Error('request failed');
        return response.json();
      })
      .then(function (value) {
        if (!value || value.ok !== true || !Array.isArray(value.models)) throw new Error('catalog invalid');
        return value;
      });
  }

  async function readKvForWrite() {
    var response = await fetch('/kv');
    if (!response.ok) throw new Error('kv read failed');
    var value = await response.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('kv state invalid');
    return value;
  }

  function normalizeOverride(value) {
    if (typeof value === 'string' && value.trim()) return { modelId: value.trim() };
    if (value && typeof value === 'object' && typeof value.modelId === 'string' && value.modelId.trim()) {
      return {
        modelId: value.modelId.trim(),
        ...(typeof value.providerId === 'string' && value.providerId.trim()
          ? { providerId: value.providerId.trim() }
          : {})
      };
    }
    return null;
  }

  function legacyOverride(capability) {
    var id = state[capability.type + 'ModelId'];
    var providerId = state[capability.type + 'ModelProviderId'];
    return typeof id === 'string' && id.trim()
      ? { modelId: id.trim(), ...(typeof providerId === 'string' && providerId.trim() ? { providerId: providerId.trim() } : {}) }
      : null;
  }

  function configuredOverride(capability) {
    var map = state.modelOverrides && typeof state.modelOverrides === 'object' && !Array.isArray(state.modelOverrides)
      ? state.modelOverrides
      : null;
    if (map && Object.prototype.hasOwnProperty.call(map, capability.key)) {
      var normalized = normalizeOverride(map[capability.key]);
      if (normalized) return normalized;
    }
    return legacyOverride(capability);
  }

  function supportsCapability(model, capability) {
    var modalities = model && model.modalities;
    if (!modalities || !Array.isArray(modalities.input) || !Array.isArray(modalities.output)) return false;
    return capability.input.every(function (input) { return modalities.input.indexOf(input) !== -1; }) &&
      modalities.output.indexOf(capability.output) !== -1;
  }

  function availableModels(capability) {
    return catalogs[capability.type].models.filter(function (model) {
      return model && typeof model.id === 'string' && supportsCapability(model, capability);
    });
  }

  function defaultModel(capability, models) {
    var catalog = catalogs[capability.type];
    return models.find(function (model) {
      return model.id === catalog.defaultModelId &&
        (!catalog.defaultProviderId || model.providerId === catalog.defaultProviderId);
    }) || models[0] || null;
  }

  function escapeHtml(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  function providerLabel(model) {
    return model.providerName && model.providerId
      ? model.providerName + ' / ' + model.providerId
      : model.providerName || model.providerId || '';
  }

  function modelLabel(model, models) {
    var label = model.name || model.id;
    var duplicate = models.some(function (other) {
      return (other.name || other.id) === label && other.providerId !== model.providerId;
    });
    return duplicate ? label + ' (' + providerLabel(model) + ')' : label;
  }

  function optionRow(option, selected, capability) {
    return '<button class="model-option" type="button" role="option" aria-selected="' + selected + '"' +
      ' data-capability="' + capability.key + '"' +
      ' data-model-id="' + escapeHtml(option.modelId) + '"' +
      ' data-provider-id="' + escapeHtml(option.providerId) + '"' +
      ' title="' + escapeHtml(providerLabel(option)) + '"' +
      ' data-default="' + String(option.isDefault) + '">' +
      (option.stale ? '' : providerMark(option)) +
      '<span class="option-label">' + escapeHtml(option.label) + '</span>' +
      (selected ? artSettingsIcons.icon('check', 'check') : '') +
      '</button>';
  }

  function renderRow(capability) {
    var models = availableModels(capability);
    var fallback = defaultModel(capability, models);
    var configured = configuredOverride(capability);
    var selected = configured
      ? models.find(function (model) {
          return model.id === configured.modelId &&
            model.providerId === (configured.providerId || 'xd');
        }) || (!configured.providerId
          ? models.find(function (model) { return model.id === configured.modelId; })
          : null) || null
      : null;
    var stale = configured && !selected ? configured : null;
    var pinnedDefault = selected && fallback && selected.id === fallback.id && selected.providerId === fallback.providerId;
    var triggerLabel = selected
      ? modelLabel(selected, models)
      : stale
        ? stale.modelId
        : fallback
          ? t('defaultOption', { model: modelLabel(fallback, models) })
          : t('noModels');
    var options = models.filter(function (model) {
      return pinnedDefault || !fallback || model.id !== fallback.id || model.providerId !== fallback.providerId;
    }).map(function (model) {
      return {
        modelId: model.id,
        providerId: model.providerId,
        providerName: model.providerName,
        routing: model.routing,
        label: modelLabel(model, models),
        isDefault: false,
        selected: selected && selected.id === model.id && selected.providerId === model.providerId
      };
    });
    if (fallback) options.unshift({
      modelId: fallback.id,
      providerId: fallback.providerId,
      providerName: fallback.providerName,
      routing: fallback.routing,
      label: t('defaultOption', { model: modelLabel(fallback, models) }),
      isDefault: true,
      selected: !configured
    });
    if (stale) options.push({
      modelId: stale.modelId,
      providerId: stale.providerId || '',
      label: stale.modelId,
      stale: true,
      isDefault: false,
      selected: true
    });
    options.sort(function (left, right) {
      return Number(left.providerId === 'xd') - Number(right.providerId === 'xd');
    });
    var row = document.createElement('div');
    row.className = 'cap-row';
    row.dataset.capability = capability.key;
    row.innerHTML =
      '<span class="cap-label">' + t(capability.label) + '</span>' +
      (models.length === 0 && !stale
        ? '<span class="no-models">' + t('noModels') + '</span>'
        : '<div class="model-picker" data-capability="' + capability.key + '">' +
          '<button class="model-trigger" type="button" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-label="' + t(capability.label) + '" title="' + escapeHtml(providerLabel(selected || stale || fallback)) + '">' +
          (stale ? '' : providerMark(selected || fallback)) +
          '<span class="model-name">' + escapeHtml(triggerLabel) + '</span>' +
          artSettingsIcons.icon('chevron-down', 'chevron') +
          '</button>' +
          '<div class="model-popover"><div class="model-list" role="listbox" aria-label="' + t(capability.label) + '">' +
          options.map(function (option) {
            return optionRow(option, option.selected, capability);
          }).join('') +
          '</div></div></div>');
    root.appendChild(row);

    var picker = row.querySelector('.model-picker');
    if (!picker) return;
    var trigger = picker.querySelector('.model-trigger');
    var popover = picker.querySelector('.model-popover');
    trigger.addEventListener('click', function (event) {
      event.stopPropagation();
      var open = !popover.classList.contains('open');
      document.querySelectorAll('.model-popover.open').forEach(function (item) { item.classList.remove('open'); });
      document.querySelectorAll('.model-trigger[aria-expanded="true"]').forEach(function (item) { item.setAttribute('aria-expanded', 'false'); });
      popover.classList.toggle('open', open);
      trigger.setAttribute('aria-expanded', String(open));
      if (open) positionPopover(trigger, popover);
    });
    popover.querySelectorAll('.model-option').forEach(function (option) {
      option.addEventListener('click', function (event) {
        event.stopPropagation();
        if (option.dataset.default === 'true') delete overrides[capability.key];
        else overrides[capability.key] = {
          modelId: option.dataset.modelId,
          ...(option.dataset.providerId ? { providerId: option.dataset.providerId } : {})
        };
        persistPreferences();
      });
    });
  }

  function positionPopover(trigger, popover) {
    var bounds = trigger.getBoundingClientRect();
    var list = popover.querySelector('.model-list');
    var below = Math.max(0, window.innerHeight - bounds.bottom - 6);
    var above = Math.max(0, bounds.top - 6);
    var desired = Math.min(300, list.scrollHeight) + 10;
    var placeAbove = desired > below && above > below;
    popover.dataset.side = placeAbove ? 'top' : 'bottom';
    popover.style.top = placeAbove ? 'auto' : '38px';
    popover.style.bottom = placeAbove ? '38px' : 'auto';
    list.style.maxHeight = Math.max(0, Math.min(300, (placeAbove ? above : below) - 10)) + 'px';
  }

  function render() {
    root.textContent = '';
    CAPABILITIES.forEach(renderRow);
  }

  function persistPreferences() {
    var revision = ++editRevision;
    var next = {};
    CAPABILITIES.forEach(function (capability) {
      var value = overrides[capability.key];
      if (value) next[capability.key] = value;
    });
    writeQueue = writeQueue.then(async function () {
      setStatus(t('saving'), false);
      var kv = await readKvForWrite();
      kv.modelOverrides = next;
      delete kv.imageModelId;
      delete kv.imageModelProviderId;
      delete kv.videoModelId;
      delete kv.videoModelProviderId;
      var response = await fetch('/kv', { method: 'PUT', body: JSON.stringify(kv) });
      if (!response.ok) throw new Error('kv write failed');
      state.modelOverrides = next;
      delete state.imageModelId;
      delete state.imageModelProviderId;
      delete state.videoModelId;
      delete state.videoModelProviderId;
      lastSavedOverrides = JSON.parse(JSON.stringify(next));
      if (revision !== editRevision) return;
      render();
      setStatus('', false);
    }).catch(function () {
      if (revision !== editRevision) return;
      overrides = JSON.parse(JSON.stringify(lastSavedOverrides));
      render();
      setStatus(t('saveFailed'), true);
    });
  }

  function load() {
    setStatus(t('loading'), false);
    Promise.all([
      readKvForWrite(),
      readCatalog('/media-models?type=image'),
      readCatalog('/media-models?type=video')
    ]).then(function (values) {
      state = values[0] && typeof values[0] === 'object' && !Array.isArray(values[0]) ? values[0] : {};
      catalogs.image = values[1];
      catalogs.video = values[2];
      overrides = {};
      CAPABILITIES.forEach(function (capability) {
        var configured = configuredOverride(capability);
        if (configured) overrides[capability.key] = configured;
      });
      lastSavedOverrides = JSON.parse(JSON.stringify(overrides));
      render();
      var noModels = CAPABILITIES.every(function (capability) { return availableModels(capability).length === 0; });
      setStatus(noModels ? t('noModels') : '', noModels);
    }).catch(function () {
      setStatus(t('loadFailed'), true);
    });
  }

  document.getElementById('card-icon').innerHTML = artSettingsIcons.icon('sparkles');
  document.addEventListener('click', function () {
    document.querySelectorAll('.model-popover.open').forEach(function (item) { item.classList.remove('open'); });
    document.querySelectorAll('.model-trigger[aria-expanded="true"]').forEach(function (item) { item.setAttribute('aria-expanded', 'false'); });
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      document.querySelectorAll('.model-popover.open').forEach(function (item) { item.classList.remove('open'); });
      document.querySelectorAll('.model-trigger[aria-expanded="true"]').forEach(function (item) {
        item.setAttribute('aria-expanded', 'false');
        item.focus();
      });
    }
  });
  loadLocale().then(load);
})();
