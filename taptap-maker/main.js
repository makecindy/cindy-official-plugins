/**
 * TapTap Maker 官方插件。
 *
 * 业务与 Runtime 全部在插件包内；宿主只提供通用 session-context、pick、
 * preview 与 node 能力。
 */

/* global BroadcastChannel, cindy, fetch */

var ACCOUNT_ENTRY = 'node/account.cjs';
var ACCOUNT_TOOL = 'cindy_maker_account';
var MAKER_ADS_GUIDE_URI = 'maker://ads-integration-guide';
var FIXED_MAKER_TOOLS = {
  maker_status_lite: true,
  maker_build_current_directory: true,
};
var SETTINGS_CHANNEL = 'taptap-maker-settings';
var WORKSPACE_HINT = '请先在 Cindy 中打开目标 TapTap Maker 项目目录，再重新调用本插件。';
var READ_ONLY_HINT = '当前会话处于计划或只读模式，不能修改 TapTap Maker 项目。';
var nextProgressToken = 1;
var identityInitializations = new Map();

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function errorMessage(error) {
  return error && error.message ? error.message : String(error);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function previewCardHtml(url) {
  var safeUrl = escapeHtml(url);
  return [
    '<div style="padding:12px;border:1px solid var(--border-default);border-radius:10px;">',
    '<div style="font-weight:600;">TapTap Maker 预览已在右侧打开</div>',
    '<div style="margin-top:6px;color:var(--text-secondary);">如需在浏览器中打开：</div>',
    '<a href="' + safeUrl + '" style="display:block;margin-top:4px;word-break:break-all;">',
    safeUrl,
    '</a>',
    '</div>',
  ].join('');
}

async function nodeRequest(request) {
  var response = await cindy.node.request(request);
  if (!response || response.ok !== true) {
    throw new Error(response && response.message ? response.message : 'TapTap Maker Node Runtime 调用失败');
  }
  return response.result;
}

function parseAccountResult(result) {
  if (isObject(result) && isObject(result.structuredContent)) {
    return result.structuredContent;
  }
  var content = isObject(result) && Array.isArray(result.content) ? result.content : [];
  for (var i = 0; i < content.length; i += 1) {
    if (!isObject(content[i]) || content[i].type !== 'text' || typeof content[i].text !== 'string') continue;
    try {
      var parsed = JSON.parse(content[i].text);
      if (isObject(parsed)) return parsed;
    } catch (_error) {
      // 检查下一段。
    }
  }
  throw new Error('TapTap Maker 账号 Runtime 返回了无法识别的结果');
}

async function accountRequest(action, payload, longRunning) {
  var args = Object.assign({ action: action }, payload || {});
  var result = await nodeRequest({
    entry: ACCOUNT_ENTRY,
    method: 'tools/call',
    params: {
      name: ACCOUNT_TOOL,
      arguments: args,
    },
    timeoutMs: longRunning ? 60000 : 30000,
    ...(longRunning ? { maxTotalMs: 900000 } : {}),
  });
  var parsed = parseAccountResult(result);
  if (parsed.ok === false) throw new Error(parsed.message || 'TapTap Maker 账号操作失败');
  return parsed;
}

function requireLocalContext(message) {
  var context = isObject(message.args) && isObject(message.args.session_context)
    ? message.args.session_context
    : null;
  if (!context || context.workdir_is_local !== true || typeof context.workdir !== 'string' || !context.workdir) {
    throw new Error('当前会话没有可用的本地工作目录。' + WORKSPACE_HINT);
  }
  return context;
}

function requireWritableContext(context) {
  // 字段由新版宿主铸造；缺字段表示旧版宿主，保持向后兼容。
  if (context.workdir_is_read_only === true) {
    throw new Error(READ_ONLY_HINT);
  }
  return context;
}

function withoutSessionContext(args) {
  var result = {};
  var source = isObject(args) ? args : {};
  for (var key in source) {
    if (!Object.prototype.hasOwnProperty.call(source, key) || key === 'session_context') continue;
    result[key] = source[key];
  }
  return result;
}

async function listMakerTools(workdir) {
  var result = await nodeRequest({
    method: 'cindy/tools-list',
    params: { target_dir: workdir },
    timeoutMs: 60000,
  });
  var tools = isObject(result) && Array.isArray(result.tools) ? result.tools : [];
  return tools.filter(function visible(tool) {
    return isObject(tool) && typeof tool.name === 'string' && !FIXED_MAKER_TOOLS[tool.name];
  });
}

async function callMakerTool(name, args, longRunning) {
  var progressToken = longRunning ? 'cindy-maker-' + nextProgressToken++ : null;
  return nodeRequest({
    method: 'tools/call',
    params: {
      name: name,
      arguments: args,
      ...(progressToken ? { _meta: { progressToken: progressToken } } : {}),
    },
    timeoutMs: longRunning ? 60000 : 30000,
    ...(longRunning ? { maxTotalMs: 900000 } : {}),
  });
}

async function readMakerAdsGuide() {
  return nodeRequest({
    method: 'resources/read',
    params: { uri: MAKER_ADS_GUIDE_URI },
    timeoutMs: 30000,
  });
}

function makerErrorResult(message, details) {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
    structuredContent: Object.assign({ success: false, message: message }, details || {}),
  };
}

function makerResultText(result) {
  var content = isObject(result) && Array.isArray(result.content) ? result.content : [];
  return content
    .filter(function textItem(item) {
      return isObject(item) && item.type === 'text' && typeof item.text === 'string';
    })
    .map(function itemText(item) { return item.text; })
    .join('\n');
}

function makerResultPayloads(result) {
  if (!isObject(result)) return [];
  var payloads = [];
  if (isObject(result.structuredContent)) payloads.push(result.structuredContent);
  var content = Array.isArray(result.content) ? result.content : [];
  for (var i = 0; i < content.length; i += 1) {
    if (!isObject(content[i]) || content[i].type !== 'text' || typeof content[i].text !== 'string') continue;
    var text = content[i].text.trim();
    if (!text.startsWith('{') || !text.endsWith('}')) continue;
    try {
      var parsed = JSON.parse(text);
      if (isObject(parsed)) payloads.push(parsed);
    } catch (_error) {
      // 普通文本结果，不是结构化 payload。
    }
  }
  return payloads;
}

function redactLocalPaths(value) {
  return String(value || '')
    .replace(
      /(?:file:\/\/)?\/(?:Users|home|private|tmp|var\/folders|opt|Applications|Library|Volumes|workspace|root)\/[^\s"'`),}\]]+/g,
      '<local-path>',
    )
    .replace(/[A-Za-z]:\\[^\s"'`),}\]]+/g, '<local-path>');
}

function redactLocalPathsInValue(value) {
  if (typeof value === 'string') return redactLocalPaths(value);
  if (Array.isArray(value)) return value.map(redactLocalPathsInValue);
  if (!isObject(value)) return value;
  var result = {};
  for (var key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    result[key] = redactLocalPathsInValue(value[key]);
  }
  return result;
}

function redactSensitiveText(value, shouldRedactLocalPaths) {
  var text = String(value || '')
    .replace(/(https?:\/\/)[^/\s:@]+:[^@\s/]+@/gi, '$1<redacted>@')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer <redacted>')
    .replace(
      /\b(pat|token|authorization|jwt|secret|password)\s*[:=]\s*["']?[^"',}\s]+/gi,
      '$1: <redacted>',
    )
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '<redacted-jwt>');
  return shouldRedactLocalPaths ? redactLocalPaths(text) : text;
}

function publicAccountResult(value) {
  var result = redactLocalPathsInValue(value);
  if (!isObject(result) || result.patHint === undefined) return result;
  var withoutPatHint = Object.assign({}, result);
  delete withoutPatHint.patHint;
  return withoutPatHint;
}

function publicMakerErrorMessage(result) {
  var payloads = makerResultPayloads(result);
  var payloadMessage = '';
  for (var i = 0; i < payloads.length; i += 1) {
    if (typeof payloads[i].error === 'string') {
      payloadMessage = payloads[i].error;
      break;
    }
    if (typeof payloads[i].message === 'string') {
      payloadMessage = payloads[i].message;
      break;
    }
  }
  var text = payloadMessage || makerResultText(result);
  var messageLine = /(?:^|\n)-\s*message:\s*([^\n]+)/i.exec(text);
  var publicText = messageLine
    ? messageLine[1]
    : text.split(/\n(?:error_details|debug|stack(?: trace)?):/i)[0];
  publicText = redactSensitiveText(publicText, true)
    .split(/\r?\n/)
    .filter(function publicLine(line) {
      return !/^\s*(?:✗\s*)?Maker MCP tool failed\s*$/i.test(line)
        && !/^\s*-\s*(?:tool|error_name):/i.test(line);
    })
    .join('\n')
    .trim();
  return (publicText || 'Maker Runtime 未返回可公开的错误详情').slice(0, 2000);
}

function sanitizeMakerFailure(result) {
  if (!makerResultIsFailure(result)) return result;
  var message = publicMakerErrorMessage(result);
  var executionDetails = makerExecutionDetails(result);
  if (executionDetails.execution_state === 'unknown') {
    message = 'TapTap Maker 操作执行结果不确定。请先核对 Maker 端实际状态、产物和用量，再决定是否重试；不要自动或盲目重试。\n'
      + message;
  }
  return makerErrorResult(
    message,
    Object.assign({}, makerFailureDetails(message), executionDetails),
  );
}

function makerFailureDetails(message) {
  var codeMatch = /MCP error\s+(-?\d+)/i.exec(message);
  var details = {};
  if (codeMatch) details.errorCode = Number(codeMatch[1]);
  if (/MCP error\s+-32600:\s*INSUFFICIENT_BALANCE/i.test(message)) {
    details.reason = 'INSUFFICIENT_BALANCE';
  }
  return details;
}

function makerDiagnosticPayload(text, label) {
  var marker = label + ':\n';
  var markerIndex = text.indexOf('\n' + marker);
  var valueStart = markerIndex >= 0
    ? markerIndex + marker.length + 1
    : text.startsWith(marker) ? marker.length : -1;
  if (valueStart < 0) return null;
  var section = text.slice(valueStart);
  var sectionEnd = section.indexOf('\n\n');
  var candidate = (sectionEnd >= 0 ? section.slice(0, sectionEnd) : section).trim();
  if (!candidate.startsWith('{') || !candidate.endsWith('}')) return null;
  try {
    var parsed = JSON.parse(candidate);
    return isObject(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function makerExecutionDetailsFromValue(value) {
  if (!isObject(value)) return null;
  var state = value.execution_state !== undefined
    ? value.execution_state
    : value.executionState;
  if (state === 'not_executed' || state === 'executed' || state === 'unknown') {
    var automaticRetry = typeof value.automatic_retry === 'boolean'
      ? value.automatic_retry
      : value.automaticRetry;
    return {
      execution_state: state,
      ...(typeof automaticRetry === 'boolean' ? { automatic_retry: automaticRetry } : {}),
    };
  }
  return makerExecutionDetailsFromValue(value.structuredContent)
    || makerExecutionDetailsFromValue(value.remote_structured_content);
}

function makerExecutionDetails(result) {
  var payloads = makerResultPayloads(result);
  for (var i = 0; i < payloads.length; i += 1) {
    var payloadDetails = makerExecutionDetailsFromValue(payloads[i]);
    if (payloadDetails) return payloadDetails;
  }
  var content = isObject(result) && Array.isArray(result.content) ? result.content : [];
  for (var contentIndex = 0; contentIndex < content.length; contentIndex += 1) {
    if (
      !isObject(content[contentIndex])
      || content[contentIndex].type !== 'text'
      || typeof content[contentIndex].text !== 'string'
    ) continue;
    var diagnosticLabels = ['remote_result', 'error_details'];
    for (var labelIndex = 0; labelIndex < diagnosticLabels.length; labelIndex += 1) {
      var diagnosticPayload = makerDiagnosticPayload(
        content[contentIndex].text,
        diagnosticLabels[labelIndex],
      );
      var diagnosticDetails = makerExecutionDetailsFromValue(diagnosticPayload);
      if (diagnosticDetails) return diagnosticDetails;
    }
  }
  return {};
}

function makerAllowsIdentityRecovery(result) {
  var details = makerExecutionDetails(result);
  return details.execution_state === undefined || details.execution_state === 'not_executed';
}

function normalizeMakerAuthGuidance(value) {
  return String(value || '')
    .replace(
      'Maker PAT 和 TapTap auth 缺失。请运行 `taptap-maker login` 刷新登录授权。',
      'Maker PAT 和 TapTap auth 缺失。请调用 `maker_login` 重新连接账号，或在 TapTap Maker 插件设置页配置 PAT。',
    )
    .replace(
      'TapTap auth 缺失。请运行 `taptap-maker login` 刷新登录授权。',
      'TapTap auth 缺失。请在 TapTap Maker 插件设置页重新保存 PAT，或调用 `maker_login` 重新连接账号。',
    )
    .replace(
      'Maker PAT 缺失。请运行 `taptap-maker login` 刷新登录授权。',
      'Maker PAT 缺失。请调用 `maker_login` 重新连接账号，或在 TapTap Maker 插件设置页配置 PAT。',
    );
}

function normalizeMakerPluginGuidance(value) {
  var reportGuidanceAdded = false;
  var readyDiagnosticsGuidanceAdded = false;
  var unreadyDiagnosticsGuidanceAdded = false;
  var localDiagnosticsReady = false;
  return normalizeMakerAuthGuidance(value)
    .replace(
      /Maker initialization next_step: execute `taptap-maker init(?: --skip-mcp-install)?`(?: through the bundled plugin CLI)?\./g,
      'Maker initialization next_step: call `maker_apps`, then `maker_init` through the Cindy plugin.',
    )
    .replace(
      /当前目录尚未绑定 Maker 项目。请运行 `taptap-maker init`。/g,
      '当前目录尚未绑定 Maker 项目。请先调用 `maker_apps` 选择应用，再调用 `maker_init` 初始化当前目录。',
    )
    .replace(
      /如果缺少 Maker PAT，CLI 会在 init 流程内自动打开登录授权页面并完成本地保存。/g,
      '如果缺少 Maker PAT，请调用 `maker_login`，或在 TapTap Maker 插件设置页配置 PAT。',
    )
    .replace(
      /本地 Maker 工作流请参考 taptap-maker-local workflow guide document；CLI 负责初始化\/PAT\/app\/clone，MCP 只保留状态和同步构建。/g,
      '本地 Maker 工作流请参考 taptap-maker-local workflow guide document；Cindy 插件的 `maker_login`、`maker_apps` 和 `maker_init` 负责账号与项目初始化。',
    )
    .replace(
      /Maker PAT not found\. Run `taptap-maker login` to complete Maker CLI login,\s*or provide MAKER_PAT\/PAT only for CI\/emergency fallback\./g,
      'Maker PAT not found. Call `maker_login` to reconnect the account, or configure PAT in TapTap Maker plugin settings.',
    )
    .replace(
      /Maker CLI login timed out\. Run `taptap-maker login` and try again\./g,
      'Maker account connection timed out. Call `maker_login` and try again.',
    )
    .split(/\r?\n/)
    .map(function normalizeMakerGuidanceLine(line) {
      if (line === 'Python environment' || line === 'Lua LSP environment') {
        localDiagnosticsReady = false;
      } else if (/^\s*-\s*ready:\s*yes\s*$/i.test(line)) {
        localDiagnosticsReady = true;
      }
      if (/\bmcp report\b|active client(?:'s)? exact Maker command|unversioned npm package/i.test(line)) {
        if (reportGuidanceAdded) return '';
        reportGuidanceAdded = true;
        return '- 经用户同意后，请通过 Cindy 的反馈渠道提交已脱敏的问题信息；不要运行独立 Maker CLI。';
      }
      if (
        /\btaptap-maker (?:python|lua-lsp) (?:setup|path|doctor)\b/i.test(line)
        || /\bmaker-lua-lsp\s+install\b/i.test(line)
      ) {
        if (!/^\s*-\s*next_action:/i.test(line)) return '';
        if (localDiagnosticsReady) {
          if (readyDiagnosticsGuidanceAdded) return '';
          readyDiagnosticsGuidanceAdded = true;
          return '- 本地诊断环境已就绪；Cindy 插件暂不提供 Python 或 Lua LSP 自动升级入口，不影响远端构建。';
        }
        if (unreadyDiagnosticsGuidanceAdded) return '';
        unreadyDiagnosticsGuidanceAdded = true;
        return '- 本地诊断环境未就绪；Cindy 插件暂不提供 Python 或 Lua LSP 自动安装入口，不影响远端构建。';
      }
      var normalized = line
        .replace(/`?maker_status_lite`?/g, '`maker_status`')
        .replace(/`?maker_build_current_directory`?/g, '`maker_build`')
        .replace(/`?taptap-maker login`?/g, '`maker_login`')
        .replace(/`?taptap-maker apps(?:\s+--json)?`?/g, '`maker_apps`')
        .replace(/`?taptap-maker dev-kit update`?/g, '`maker_init`')
        .replace(/`?taptap-maker doctor`?/g, '`maker_doctor`')
        .replace(/`?taptap-maker init(?:\s+--skip-mcp-install)?`?/g, '`maker_init`')
        .replace(/Maker CLI login/g, 'Maker account connection');
      return normalized;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sanitizeMakerStatus(result) {
  if (!isObject(result) || !Array.isArray(result.content)) return result;
  return Object.assign({}, result, {
    content: result.content.map(function sanitizeStatusItem(item) {
      if (!isObject(item) || item.type !== 'text' || typeof item.text !== 'string') return item;
      return Object.assign({}, item, {
        text: normalizeMakerPluginGuidance(redactLocalPaths(item.text)),
      });
    }),
    ...(result.structuredContent !== undefined
      ? { structuredContent: redactLocalPathsInValue(result.structuredContent) }
      : {}),
  });
}

function makerResultIsFailure(result) {
  if (!isObject(result)) return false;
  if (result.isError === true) return true;
  return makerResultPayloads(result).some(function failedPayload(payload) {
    return payload.ok === false || payload.success === false;
  });
}

function makerIdentityRecoveryText(text) {
  return (
    /(?:status\s*:\s*)?missing_taptap_identity/i.test(text)
    || (
      /(?:缺少|missing)[^\n]*(?:app_id|developer_id)/i.test(text)
      && /generate_test_qrcode/i.test(text)
    )
  );
}

function makerRequestsIdentityRecovery(result) {
  if (!isObject(result)) return false;
  var payloads = makerResultPayloads(result);
  for (var i = 0; i < payloads.length; i += 1) {
    if (payloads[i].status === 'missing_taptap_identity') return true;
    var message = typeof payloads[i].error === 'string'
      ? payloads[i].error
      : payloads[i].message;
    if (typeof message === 'string' && makerIdentityRecoveryText(message)) return true;
  }
  var text = makerResultText(result);
  return makerIdentityRecoveryText(text) && /generate_test_qrcode/i.test(text);
}

async function initializeMakerIdentity(workdir) {
  var existing = identityInitializations.get(workdir);
  if (existing) return existing;
  var initializing = callMakerTool(
    'generate_test_qrcode',
    { target_dir: workdir },
    true,
  );
  identityInitializations.set(workdir, initializing);
  try {
    return await initializing;
  } finally {
    identityInitializations.delete(workdir);
  }
}

async function callMakerToolWithIdentityRecovery(name, args, workdir) {
  var firstResult = await callMakerTool(name, args, true);
  if (
    name === 'generate_test_qrcode'
    || !makerAllowsIdentityRecovery(firstResult)
    || !makerRequestsIdentityRecovery(firstResult)
  ) {
    return sanitizeMakerFailure(firstResult);
  }
  var initialized = await initializeMakerIdentity(workdir);
  if (makerResultIsFailure(initialized)) {
    var initializationMessage = publicMakerErrorMessage(initialized);
    var initializationDetails = Object.assign(
      {},
      makerFailureDetails(initializationMessage),
      makerExecutionDetails(initialized),
    );
    if (initializationDetails.execution_state === 'unknown') {
      return makerErrorResult(
        'TapTap Maker 自动初始化 App 身份的执行结果不确定。请先核对 Maker 端实际状态和上传结果，不要自动或盲目重试。\n'
          + initializationMessage,
        Object.assign({ step: 'generate_test_qrcode' }, initializationDetails),
      );
    }
    if (initializationDetails.reason === 'INSUFFICIENT_BALANCE') {
      return makerErrorResult(initializationMessage, initializationDetails);
    }
    if (/无效的游戏类型|invalid game type/i.test(initializationMessage)) {
      return makerErrorResult(
        'TapTap Maker 生成测试二维码前还缺少有效的项目构建信息。请先明确执行一次构建或预览，并按提示完成游戏类型、屏幕方向等选择后再重试。',
        Object.assign({ step: 'generate_test_qrcode' }, initializationDetails),
      );
    }
    return makerErrorResult(
      'TapTap Maker 自动初始化 App 身份失败：\n' + initializationMessage,
      Object.assign({ step: 'generate_test_qrcode' }, initializationDetails),
    );
  }
  var retried = await callMakerTool(name, args, true);
  if (makerRequestsIdentityRecovery(retried)) {
    return makerErrorResult(
      'TapTap Maker 已完成一次身份初始化，但项目仍缺少可用的 App 身份，已停止自动重试。',
      Object.assign(
        { step: 'retry_after_identity_initialization' },
        makerExecutionDetails(retried),
      ),
    );
  }
  return sanitizeMakerFailure(retried);
}

function previewUrlFromResult(result) {
  var content = isObject(result) && Array.isArray(result.content) ? result.content : [];
  for (var i = 0; i < content.length; i += 1) {
    if (!isObject(content[i]) || content[i].type !== 'text' || typeof content[i].text !== 'string') continue;
    var match = /(?:^|\n)-?\s*maker_url:\s*(https:\/\/maker\.taptap\.cn\/app\/[^\s]+)/i.exec(content[i].text);
    if (!match) continue;
    try {
      var url = new URL(match[1]);
      if (url.protocol !== 'https:' || url.hostname !== 'maker.taptap.cn') continue;
      if (!url.pathname.startsWith('/app/') || url.searchParams.get('localDev') !== '1') continue;
      url.searchParams.set('hide_chat', '1');
      return url.toString();
    } catch (_error) {
      // 检查下一段。
    }
  }
  return null;
}

async function handleTool(message) {
  var args = withoutSessionContext(message.args);
  if (message.tool === 'maker_login') {
    return publicAccountResult(await accountRequest('login', {}, true));
  }
  if (message.tool === 'maker_apps') {
    return accountRequest('apps', {}, false);
  }
  if (message.tool === 'maker_init') {
    var initContext = requireWritableContext(requireLocalContext(message));
    return publicAccountResult(await accountRequest(
      'init',
      Object.assign({}, args, { workdir: initContext.workdir }),
      true,
    ));
  }
  if (message.tool === 'maker_doctor') {
    var doctorContext = requireLocalContext(message);
    return publicAccountResult(await accountRequest(
      'doctor',
      { workdir: doctorContext.workdir },
      true,
    ));
  }
  if (message.tool === 'maker_status') {
    var statusContext = requireLocalContext(message);
    return sanitizeMakerStatus(sanitizeMakerFailure(await callMakerTool(
      'maker_status_lite',
      Object.assign({}, args, { target_dir: statusContext.workdir }),
      false,
    )));
  }
  if (message.tool === 'maker_ads_guide') {
    return readMakerAdsGuide();
  }
  if (message.tool === 'maker_build') {
    var buildContext = requireWritableContext(requireLocalContext(message));
    var built = await callMakerTool(
      'maker_build_current_directory',
      Object.assign({}, args, { target_dir: buildContext.workdir }),
      true,
    );
    if (makerResultIsFailure(built)) return sanitizeMakerFailure(built);
    var previewUrl = previewUrlFromResult(built);
    if (!previewUrl) return built;
    var preview;
    try {
      preview = await cindy.preview({
        url: previewUrl,
        ...(typeof buildContext.session_id === 'string' ? { sessionId: buildContext.session_id } : {}),
      });
    } catch (error) {
      preview = { ok: false, message: errorMessage(error) };
    }
    return Object.assign({}, built, {
      preview: preview && preview.ok === true
        ? { ok: true, url: previewUrl }
        : { ok: false, url: previewUrl, message: preview && preview.message ? preview.message : '右侧预览打开失败' },
      preview_url: previewUrl,
      user_facing_markdown: '[打开 TapTap Maker 预览](' + previewUrl + ')',
    });
  }
  if (message.tool === 'maker_list_tools') {
    var listContext = requireLocalContext(message);
    return { tools: await listMakerTools(listContext.workdir) };
  }
  if (message.tool === 'maker_call_tool') {
    var callContext = requireLocalContext(message);
    // Maker 动态工具没有纯只读契约：query_video_task 会落盘完成的视频，
    // get_debug_feedbacks 即使不标记已处理也会下载附件，因此统一按可能写工作区处理。
    requireWritableContext(callContext);
    if (typeof args.name !== 'string' || !args.name || (args.args !== undefined && !isObject(args.args))) {
      throw new Error('maker_call_tool 需要 name 与可选的 args 对象');
    }
    if (FIXED_MAKER_TOOLS[args.name]) {
      throw new Error('固定 Maker 工具必须使用 maker_status 或 maker_build');
    }
    var available = await listMakerTools(callContext.workdir);
    if (!available.some(function sameTool(tool) { return tool.name === args.name; })) {
      throw new Error('Maker 动态工具不存在或当前不可用：' + args.name);
    }
    var toolArgs = Object.assign({}, args.args || {}, { target_dir: callContext.workdir });
    return callMakerToolWithIdentityRecovery(
      args.name,
      toolArgs,
      callContext.workdir,
    );
  }
  throw new Error('未知 TapTap Maker 工具：' + String(message.tool));
}

async function sendToolResult(message) {
  try {
    var result = await handleTool(message);
    if (
      message.tool === 'maker_build'
      && isObject(result)
      && typeof result.preview_url === 'string'
    ) {
      try {
        await cindy.send({
          type: 'card-update',
          callId: message.callId,
          v: 2,
          state: 'done',
          html: previewCardHtml(result.preview_url),
        });
      } catch (_error) {
        // 卡片只是可点击地址的补充；右侧预览和构建结果不受影响。
      }
    }
    await cindy.send({
      type: 'tool-result',
      callId: message.callId,
      ok: true,
      result: result,
    });
  } catch (error) {
    await cindy.send({
      type: 'tool-result',
      callId: message.callId,
      ok: false,
      message: redactSensitiveText(errorMessage(error), true).slice(0, 2000),
    });
  }
}

var SETTINGS_LOCALE_TEXT = {
  en: {
    pickParent: 'Choose a parent folder for TapTap Maker projects',
    pickFailed: 'Could not choose a parent folder',
    missingPath: 'The host did not return a usable parent folder path',
    unknownAction: 'Unknown settings action: ',
  },
  'zh-CN': {
    pickParent: '选择 TapTap Maker 项目父目录',
    pickFailed: '父目录选择失败',
    missingPath: '宿主没有返回可用的父目录路径',
    unknownAction: '未知设置动作：',
  },
  ja: {
    pickParent: 'TapTap Maker プロジェクトの親フォルダを選択',
    pickFailed: '親フォルダを選択できませんでした',
    missingPath: 'ホストから有効な親フォルダのパスが返されませんでした',
    unknownAction: '不明な設定操作：',
  },
  ko: {
    pickParent: 'TapTap Maker 프로젝트의 상위 폴더 선택',
    pickFailed: '상위 폴더를 선택하지 못했습니다',
    missingPath: '호스트가 사용 가능한 상위 폴더 경로를 반환하지 않았습니다',
    unknownAction: '알 수 없는 설정 작업: ',
  },
};

function settingsText(locale, key) {
  var normalized = Object.prototype.hasOwnProperty.call(SETTINGS_LOCALE_TEXT, locale)
    ? locale
    : 'en';
  return SETTINGS_LOCALE_TEXT[normalized][key];
}

function settingsError(code, message) {
  var error = new Error(message);
  error.settingsCode = code;
  return error;
}

function settingsErrorCode(action, error) {
  if (error && typeof error.settingsCode === 'string') return error.settingsCode;
  var codes = {
    status: 'STATUS_FAILED',
    login: 'LOGIN_FAILED',
    open_pat_page: 'PAT_PAGE_FAILED',
    set_pat: 'PAT_SAVE_FAILED',
    projects: 'PROJECTS_FAILED',
    sync_projects: 'SYNC_FAILED',
  };
  return codes[action] || 'UNKNOWN_ACTION';
}

async function handleSettingsRequest(action, payload, locale) {
  if (action === 'status') return accountRequest('status', {}, false);
  if (action === 'login') return accountRequest('login', {}, true);
  if (action === 'open_pat_page') return accountRequest('open_pat_page', {}, false);
  if (action === 'set_pat') {
    return accountRequest('set_pat', { pat: payload && payload.pat }, true);
  }
  if (action === 'projects') return accountRequest('projects', {}, false);
  if (action === 'sync_projects') {
    var picked = await cindy.pick({
      mode: 'directory',
      title: settingsText(locale, 'pickParent'),
    });
    if (!picked || picked.ok !== true) {
      if (picked && picked.errorCode === 'CANCELLED') return { ok: true, canceled: true };
      throw settingsError(
        'PICK_FAILED',
        picked && picked.message ? picked.message : settingsText(locale, 'pickFailed'),
      );
    }
    if (typeof picked.path !== 'string' || !picked.path) {
      throw settingsError('MISSING_PATH', settingsText(locale, 'missingPath'));
    }
    return accountRequest('sync_projects', {
      parentDir: picked.path,
      projectIds: payload && payload.projectIds,
    }, true);
  }
  throw settingsError('UNKNOWN_ACTION', settingsText(locale, 'unknownAction') + String(action));
}

var settingsChannel = typeof BroadcastChannel === 'function'
  ? new BroadcastChannel(SETTINGS_CHANNEL)
  : null;
var settingsRequests = new Map();

if (settingsChannel) {
  settingsChannel.onmessage = function onSettingsMessage(event) {
    var message = event && event.data;
    if (
      !isObject(message)
      || message.type !== 'settings-request'
      || typeof message.reqId !== 'string'
      || typeof message.action !== 'string'
    ) {
      return;
    }
    var existing = settingsRequests.get(message.reqId);
    if (existing) {
      if (existing.response) settingsChannel.postMessage(existing.response);
      return;
    }
    var entry = { response: null };
    var promise = handleSettingsRequest(
      message.action,
      isObject(message.payload) ? message.payload : {},
      typeof message.locale === 'string' ? message.locale : 'en',
    )
      .then(function success(result) {
        return { type: 'settings-result', reqId: message.reqId, ok: true, result: result };
      })
      .catch(function failure(error) {
        return {
          type: 'settings-result',
          reqId: message.reqId,
          ok: false,
          errorCode: settingsErrorCode(message.action, error),
          message: redactSensitiveText(errorMessage(error), true).slice(0, 2000),
        };
      });
    settingsRequests.set(message.reqId, entry);
    promise.then(function reply(response) {
      entry.response = response;
      settingsChannel.postMessage(response);
    }).finally(function retainResultForLateRetries() {
      setTimeout(function releaseRequest() {
        if (settingsRequests.get(message.reqId) === entry) {
          settingsRequests.delete(message.reqId);
        }
      }, 60000);
    });
  };
}

cindy.onHostMessage(function onHostMessage(message) {
  if (!message || message.type !== 'tool-call') return;
  void sendToolResult(message);
});
