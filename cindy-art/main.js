/**
 * Art 电子脑：定义图片/视频创作的上层语义，不直接发媒体请求。
 *
 * 工具只整理普通业务参数；当前 Agent 读取结果后调用 Cindy Core media。
 * 模型默认使用 Host 在插件详情页为当前能力保存的配置，只有用户在本次
 * 对话明确点名模型时才使用工具参数中的 model。
 */

/* global cindy, console */

const MANAGED_MEDIA_URL_RE = /^cindy-media:\/\/blobs\/([0-9a-f]{64})(\.[a-z0-9]{1,10})$/;
const MEDIA_REQUIREMENTS = {
  'image.generate': { type: 'image', input: ['text'], output: 'image', label: '出图' },
  'image.edit': { type: 'image', input: ['text', 'image'], output: 'image', label: '改图' },
  'video.generate': { type: 'video', input: ['text'], output: 'video', label: '生成视频' },
  'video.image_to_video': {
    type: 'video',
    input: ['text', 'image'],
    output: 'video',
    label: '图生视频',
  },
};

function extractHash(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/[0-9a-f]{64}/);
  return match ? match[0] : null;
}

function failCall(callId, message) {
  return cindy
    .send({ type: 'tool-result', callId: callId, ok: false, message: message })
    .catch(function () {});
}

async function finishCall(callId, result) {
  await cindy.send({ type: 'tool-result', callId: callId, ok: true, result: result });
}

function optionalString(args, key) {
  return args && typeof args[key] === 'string' && args[key].trim()
    ? args[key].trim()
    : undefined;
}

async function readMediaCatalog(type) {
  let response;
  try {
    response = await fetch('/media-models?type=' + type);
  } catch (_error) {
    throw new Error('无法连接 Cindy 媒体模型目录，请检查 Cindy 服务状态后重试');
  }
  if (!response.ok) {
    console.warn('[cindy-art] media catalog request failed', {
      type: type,
      status: response.status,
    });
    throw new Error('暂无可用模型');
  }
  let result;
  try {
    result = await response.json();
  } catch (_error) {
    throw new Error('Cindy 媒体模型目录响应无法解析，请重启 Cindy 后重试');
  }
  if (!result || result.ok !== true || result.type !== type || !Array.isArray(result.models)) {
    throw new Error('Cindy 媒体模型目录返回不合法，请升级或重启 Cindy 后重试');
  }
  return result.models;
}

function supportsCapability(model, capability) {
  const requirement = MEDIA_REQUIREMENTS[capability];
  const modalities = model && model.modalities;
  if (
    !requirement ||
    !modalities ||
    !Array.isArray(modalities.input) ||
    !Array.isArray(modalities.output)
  ) {
    return false;
  }
  return (
    requirement.input.every(function (modality) {
      return modalities.input.indexOf(modality) !== -1;
    }) && modalities.output.indexOf(requirement.output) !== -1
  );
}

function hostCapability(invocationCapability) {
  return invocationCapability === 'video.image_to_video'
    ? 'video.edit'
    : invocationCapability;
}

async function readConfiguredModel(invocationCapability) {
  const capability = hostCapability(invocationCapability);
  let result;
  try {
    result = await cindy.send({
      type: 'host-request',
      kind: 'cindy-preference',
      capability: capability,
    });
  } catch (_error) {
    throw new Error('无法读取 Art 详情页中的模型配置，请重启 Cindy 后重试');
  }
  if (
    !result ||
    result.ok !== true ||
    result.capability !== capability ||
    typeof result.modelId !== 'string' ||
    !result.modelId.trim() ||
    typeof result.providerId !== 'string' ||
    !result.providerId.trim()
  ) {
    throw new Error(
      result && typeof result.message === 'string'
        ? result.message
        : '无法读取 Art 详情页中的模型配置',
    );
  }
  return {
    modelId: result.modelId.trim(),
    providerId: result.providerId.trim(),
  };
}

async function selectedModel(args, invocationCapability) {
  const requirement = MEDIA_REQUIREMENTS[invocationCapability];
  if (!requirement) throw new Error('Art 不认识媒体能力：' + invocationCapability);

  const explicitModelId = optionalString(args, 'model');
  if (!explicitModelId) {
    // Host preference is authoritative. Subscription-backed models may be
    // intentionally absent from the public catalog, but Core can still route
    // them when given the exact (modelId, providerId) pair from Host.
    return readConfiguredModel(invocationCapability);
  }

  const models = await readMediaCatalog(requirement.type);
  const modelId = explicitModelId;
  const model = models.find(function (candidate) {
    return candidate && candidate.id === modelId;
  });
  if (!model) throw new Error('模型「' + modelId + '」当前不可用');
  if (!supportsCapability(model, invocationCapability)) {
    throw new Error('模型「' + modelId + '」未声明支持' + requirement.label + '所需的输入输出模态');
  }
  return { modelId: modelId, providerId: model.providerId };
}

function sourceMedia(args, maxItems) {
  const urls = args && Array.isArray(args.images) ? args.images : [];
  const granted = args && Array.isArray(args.attachments) ? args.attachments : [];
  if (urls.length + granted.length === 0) return null;
  if (urls.length + granted.length > maxItems) {
    throw new Error('参考图数量超过上限(' + maxItems + ' 张)');
  }
  const normalized = [];
  for (let index = 0; index < urls.length; index += 1) {
    if (typeof urls[index] !== 'string' || !MANAGED_MEDIA_URL_RE.test(urls[index])) {
      throw new Error('源图地址不合法:' + String(urls[index]));
    }
    normalized.push(urls[index]);
  }
  return {
    managedMediaUrls: normalized,
    attachedMediaCount: granted.map(extractHash).filter(Boolean).length,
  };
}

async function returnArtRequest(msg, capability, options) {
  const args = msg.args || {};
  const prompt = optionalString(args, 'prompt');
  if (!prompt) return failCall(msg.callId, '缺少 prompt');

  let references;
  try {
    references = options && options.maxInputImages
      ? sourceMedia(args, options.maxInputImages)
      : undefined;
  } catch (error) {
    return failCall(msg.callId, String((error && error.message) || error));
  }
  if (options && options.requireImages && !references) {
    return failCall(msg.callId, '缺少参考图(images 或用户图片附件)');
  }

  let selected;
  try {
    selected = await selectedModel(args, capability);
  } catch (error) {
    return failCall(msg.callId, String((error && error.message) || error));
  }
  const aspectRatio = optionalString(args, 'aspectRatio');
  const qualityIntent = optionalString(args, 'tier');
  const request = {
    capability: capability,
    prompt: prompt,
    modelId: selected.modelId,
    providerId: selected.providerId,
  };
  if (aspectRatio) request.aspectRatioIntent = aspectRatio;
  if (qualityIntent) request.qualityIntent = qualityIntent;
  if (references) request.referenceMedia = references;

  await finishCall(msg.callId, {
    note:
      'Art 已整理创作参数。除非用户在本次对话明确点名模型，request.modelId/request.providerId 就是 Art 详情页「Cindy 能力」为当前操作配置的精确模型来源；调用 Cindy Core media（完整工具名 mcp__cindy__media）prepare 时必须分别原样作为 model_id/provider_id，不要另行选型。referenceMedia.managedMediaUrls 是 Core 可读取的受管地址；attachedMediaCount 对应用户随当前消息交出的媒体，调用 Core 时继续使用对话中的原始媒体地址。Core 成功返回的 cindy-media:// 或历史 xdt-*:// 地址是可直接展示、复用和通过 attachments 交接的受管地址，不需要本地路径；图片结果请在最终回复中使用返回地址只嵌入展示一次。仅当用户明确询问文件存储位置或本地路径时，调用 mcp__cindy__media 的 resolve_local_path，并把 cindy-media://、xdt-image:// 或 xdt-video:// 地址原样放进 url。不要寻找或猜测路径，也不要扫描本地磁盘。',
    request: request,
  });
}

function handleGenImage(msg) {
  return returnArtRequest(msg, 'image.generate');
}

function handleEditImage(msg) {
  return returnArtRequest(msg, 'image.edit', {
    requireImages: true,
    maxInputImages: 4,
  });
}

function handleGenVideo(msg) {
  return returnArtRequest(msg, 'video.generate');
}

function handleEditVideo(msg) {
  return returnArtRequest(msg, 'video.image_to_video', {
    requireImages: true,
    maxInputImages: 2,
  });
}

const HANDLERS = {
  gen_image: handleGenImage,
  edit_image: handleEditImage,
  gen_video: handleGenVideo,
  edit_video: handleEditVideo,
};

cindy.onHostMessage(function (msg) {
  if (!msg || msg.type !== 'tool-call') return;
  const handler = HANDLERS[msg.tool] || null;
  if (!handler) {
    failCall(msg.callId, '未知工具:' + msg.tool);
    return;
  }
  handler(msg).catch(function (error) {
    failCall(msg.callId, String((error && error.message) || error));
  });
});

cindy.ping().catch(function () {});
