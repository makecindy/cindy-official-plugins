/**
 * Notion · Notion 官方 REST API 连接插件。
 *
 * - Internal Integration Token 由 Cindy 保险库保管并只注入 api.notion.com；
 * - 常规 API 使用 Notion-Version 2025-09-03（data source 版）；
 * - page Markdown API 按官方契约单独使用 2026-03-11；
 * - data source 属性写入前先读取 schema，避免凭空猜属性；
 * - 覆盖正文、归档、移入回收站与允许删除子内容必须 confirm:true；
 * - 大结果可经 fs 槽写到当前会话工作目录，沙箱不接触本机路径。
 */

/* global cindy, BroadcastChannel, fetch */

'use strict';

var API = 'https://api.notion.com/v1';
var NOTION_VERSION = '2025-09-03';
var MARKDOWN_VERSION = '2026-03-11';
var RESULT_MAX_CHARS = 60 * 1000;

function fail(message, errorCode) {
  return {
    ok: false,
    message: message,
    errorCode: errorCode || undefined,
  };
}

function clampPageSize(value, fallback) {
  var number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(100, Math.floor(number)));
}

function normalizeId(value) {
  var raw = String(value || '').trim();
  if (!raw) return '';
  try {
    raw = decodeURIComponent(raw);
  } catch (e) {
    /* 非 URL 编码字符串直接继续。 */
  }
  var compact = raw.replace(/-/g, '');
  if (/^[0-9a-f]{32}$/i.test(compact)) {
    return compact.slice(0, 8) + '-' + compact.slice(8, 12) + '-' +
      compact.slice(12, 16) + '-' + compact.slice(16, 20) + '-' + compact.slice(20);
  }
  var matches = raw.match(/[0-9a-f]{32}/ig);
  if (!matches || !matches.length) return '';
  var id = matches[matches.length - 1];
  return id.slice(0, 8) + '-' + id.slice(8, 12) + '-' +
    id.slice(12, 16) + '-' + id.slice(16, 20) + '-' + id.slice(20);
}

function parseBody(body) {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch (e) {
    return body;
  }
}

function bodyMessage(data, rawBody) {
  if (data && typeof data === 'object' && typeof data.message === 'string') {
    return data.message.slice(0, 400);
  }
  return typeof rawBody === 'string' ? rawBody.slice(0, 400) : '';
}

function classifyStatus(status, data, rawBody) {
  var detail = bodyMessage(data, rawBody);
  if (status === 400) return 'Notion 拒绝了请求参数（HTTP 400）' + (detail ? '：' + detail : '');
  if (status === 401) {
    return 'Notion token 未配置或已失效，请到主界面侧边栏「插件」→「Notion」详情页重新连接';
  }
  if (status === 403) {
    return 'Notion integration 权限不足（HTTP 403），请在集成设置中开启所需 capability，并确认目标页面已分享给该 integration' +
      (detail ? '：' + detail : '');
  }
  if (status === 404) {
    return 'Notion 对象不存在或尚未分享给该 integration（HTTP 404）';
  }
  if (status === 409) return 'Notion 数据冲突（HTTP 409）' + (detail ? '：' + detail : '');
  if (status === 429) return 'Notion API 限流（HTTP 429），请稍后重试';
  if (status >= 500) return 'Notion 服务暂时不可用（HTTP ' + status + '），请稍后重试';
  return 'Notion API 返回 HTTP ' + status + (detail ? '：' + detail : '');
}

async function api(options) {
  var request = {
    url: options.url,
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      'Notion-Version': options.version || NOTION_VERSION,
    },
    timeoutMs: options.timeoutMs || 60000,
    callId: options.callId,
  };
  if (options.body !== undefined) {
    request.headers['Content-Type'] = 'application/json';
    request.body = JSON.stringify(options.body);
  }
  var response = await cindy.fetch(request);
  if (!response || !response.ok) {
    return {
      err: response && response.message
        ? response.message
        : 'Notion 网络请求失败，请检查网络后重试',
    };
  }
  var data = parseBody(response.body);
  if (response.status < 200 || response.status >= 300) {
    return { err: classifyStatus(response.status, data, response.body), status: response.status };
  }
  return {
    data: data,
    status: response.status,
    headers: response.headers || {},
  };
}

async function deliver(payload, outFile, callId, prefix) {
  var text = JSON.stringify(payload === undefined ? null : payload, null, 2);
  if (!outFile && text.length <= RESULT_MAX_CHARS) {
    return { ok: true, result: payload };
  }
  var spillMessage = '';
  if (callId) {
    var path = outFile || (prefix || 'notion-result') + '-' + String(callId).slice(0, 8) + '.json';
    var write = await cindy.send({
      type: 'fs-request',
      op: 'write',
      root: 'workdir',
      path: path,
      content: text,
      callId: callId,
    });
    if (write && write.ok) {
      return {
        ok: true,
        result: {
          saved_to: write.path,
          bytes: write.bytes,
          hint: '完整结果已写入当前会话工作目录，可用文件工具继续读取或处理',
        },
      };
    }
    spillMessage = write && write.message ? String(write.message) : '当前会话不允许写文件';
  }
  if (text.length <= RESULT_MAX_CHARS) {
    return {
      ok: true,
      result: {
        data: payload,
        note: outFile ? '未能写入 out_file：' + spillMessage + '；已改为内联返回' : undefined,
      },
    };
  }
  return {
    ok: true,
    result: {
      truncated: true,
      preview: text.slice(0, RESULT_MAX_CHARS),
      hint: (spillMessage ? spillMessage + '；' : '') +
        '结果过大已截断，请缩小 page_size、使用 cursor 分页，或在可写会话中传 out_file',
    },
  };
}

function makeRichText(text) {
  var value = String(text || '');
  var richText = [];
  for (var offset = 0; offset < value.length; offset += 1900) {
    richText.push({
      type: 'text',
      text: { content: value.slice(offset, offset + 1900) },
    });
  }
  return richText;
}

function codeLanguage(raw) {
  var value = String(raw || '').trim().toLowerCase();
  var aliases = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    rb: 'ruby',
    sh: 'bash',
    shell: 'bash',
    yml: 'yaml',
    md: 'markdown',
    cs: 'c#',
    cpp: 'c++',
    ps1: 'powershell',
    dockerfile: 'docker',
    txt: 'plain text',
    text: 'plain text',
  };
  return aliases[value] || value || 'plain text';
}

/**
 * 把常用 Markdown 结构转换成 Notion block。
 * Cindy 首版保持结构稳定与可预期，不尝试实现完整 Markdown AST。
 */
function markdownToBlocks(markdown) {
  var lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  var blocks = [];
  var paragraph = [];
  var inCode = false;
  var language = '';
  var codeLines = [];

  function flushParagraph() {
    if (!paragraph.length) return;
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: makeRichText(paragraph.join('\n')),
        color: 'default',
      },
    });
    paragraph = [];
  }

  function flushCode() {
    blocks.push({
      object: 'block',
      type: 'code',
      code: {
        rich_text: makeRichText(codeLines.join('\n')),
        language: codeLanguage(language),
        caption: [],
      },
    });
    codeLines = [];
    language = '';
  }

  for (var index = 0; index < lines.length; index++) {
    var line = lines[index];
    var fence = line.match(/^```(.*)$/);
    if (fence) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushParagraph();
        inCode = true;
        language = fence[1];
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    var heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      var headingType = 'heading_' + heading[1].length;
      var headingValue = {};
      headingValue[headingType] = {
        rich_text: makeRichText(heading[2]),
        color: 'default',
        is_toggleable: false,
      };
      headingValue.object = 'block';
      headingValue.type = headingType;
      blocks.push(headingValue);
      continue;
    }

    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      flushParagraph();
      blocks.push({ object: 'block', type: 'divider', divider: {} });
      continue;
    }

    var todo = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (todo) {
      flushParagraph();
      blocks.push({
        object: 'block',
        type: 'to_do',
        to_do: {
          rich_text: makeRichText(todo[2]),
          checked: todo[1].toLowerCase() === 'x',
          color: 'default',
        },
      });
      continue;
    }

    var bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: makeRichText(bullet[1]),
          color: 'default',
        },
      });
      continue;
    }

    var numbered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (numbered) {
      flushParagraph();
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: {
          rich_text: makeRichText(numbered[1]),
          color: 'default',
        },
      });
      continue;
    }

    var quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      blocks.push({
        object: 'block',
        type: 'quote',
        quote: {
          rich_text: makeRichText(quote[1]),
          color: 'default',
        },
      });
      continue;
    }
    paragraph.push(line);
  }

  if (inCode) flushCode();
  flushParagraph();
  return blocks;
}

async function appendBlocks(blockId, blocks, callId) {
  var appended = 0;
  var lastData = null;
  for (var offset = 0; offset < blocks.length; offset += 100) {
    var batch = blocks.slice(offset, offset + 100);
    var response = await api({
      url: API + '/blocks/' + encodeURIComponent(blockId) + '/children',
      method: 'PATCH',
      body: { children: batch },
      callId: callId,
    });
    if (response.err) {
      return {
        err: response.err,
        appended: appended,
      };
    }
    appended += batch.length;
    lastData = response.data;
  }
  return { appended: appended, data: lastData };
}

function titleProperty(title) {
  return {
    title: [{
      type: 'text',
      text: { content: String(title || '') },
    }],
  };
}

function propertyExists(schema, key) {
  if (Object.prototype.hasOwnProperty.call(schema, key)) return true;
  for (var name in schema) {
    if (!Object.prototype.hasOwnProperty.call(schema, name)) continue;
    if (schema[name] && String(schema[name].id) === String(key)) return true;
  }
  return false;
}

function validateProperties(schema, properties) {
  var unknown = [];
  for (var key in properties) {
    if (!Object.prototype.hasOwnProperty.call(properties, key)) continue;
    if (!propertyExists(schema, key)) unknown.push(key);
  }
  if (unknown.length) {
    return '这些 properties 不在 data source schema 中：' + unknown.join('、') +
      '。请先用 notion_fetch(object_type=data_source) 获取正确属性名或属性 ID';
  }
  return '';
}

function findTitleProperty(schema) {
  for (var name in schema) {
    if (!Object.prototype.hasOwnProperty.call(schema, name)) continue;
    if (schema[name] && schema[name].type === 'title') return name;
  }
  return '';
}

async function getDataSourceSchema(dataSourceId, callId) {
  var response = await api({
    url: API + '/data_sources/' + encodeURIComponent(dataSourceId),
    callId: callId,
  });
  if (response.err) return response;
  var properties = response.data && response.data.properties;
  if (!properties || typeof properties !== 'object') {
    return { err: 'Notion data source 响应缺少 properties schema，拒绝继续写入' };
  }
  return {
    data: response.data,
    properties: properties,
  };
}

function pageDataSourceId(page) {
  var parent = page && page.parent;
  if (!parent || typeof parent !== 'object') return '';
  return normalizeId(parent.data_source_id || '');
}

function validateHttpsUrl(value, label) {
  if (!value) return '';
  if (!/^https:\/\//i.test(String(value))) {
    return (label || 'URL') + ' 必须使用 https://';
  }
  return '';
}

function objectTitle(value) {
  if (!value || typeof value !== 'object') return '';
  if (Array.isArray(value.title)) {
    return value.title.map(function (part) {
      return part && (part.plain_text || (part.text && part.text.content)) || '';
    }).join('');
  }
  var properties = value.properties;
  if (!properties || typeof properties !== 'object') return '';
  for (var key in properties) {
    if (!Object.prototype.hasOwnProperty.call(properties, key)) continue;
    var property = properties[key];
    if (!property || property.type !== 'title' || !Array.isArray(property.title)) continue;
    var title = property.title.map(function (part) {
      return part && (part.plain_text || (part.text && part.text.content)) || '';
    }).join('');
    return title || key;
  }
  return '';
}

async function probeVisibleContent(callId) {
  var response = await api({
    url: API + '/search',
    method: 'POST',
    body: {
      page_size: 10,
      sort: {
        direction: 'descending',
        timestamp: 'last_edited_time',
      },
    },
    callId: callId,
  });
  if (response.err) return { err: response.err };
  var data = response.data || {};
  var results = Array.isArray(data.results) ? data.results : [];
  return {
    count: results.length,
    hasMore: data.has_more === true,
    samples: results.slice(0, 5).map(function (item) {
      return {
        id: item && item.id || '',
        object: item && item.object || '',
        title: objectTitle(item) || '未命名内容',
      };
    }),
  };
}

async function notionStatus(args, callId) {
  var response = await api({ url: API + '/users/me', callId: callId });
  if (response.err) return fail(response.err);
  var user = response.data || {};
  var visibility = await probeVisibleContent(callId);
  return {
    ok: true,
    result: {
      connected: true,
      bot: {
        id: user.id || '',
        name: user.name || '',
        type: user.type || '',
        workspace_name: user.bot && user.bot.workspace_name ? user.bot.workspace_name : '',
      },
      visible_content: visibility.err
        ? {
          check_ok: false,
          message: visibility.err,
        }
        : {
          check_ok: true,
          visible_count_in_first_page: visibility.count,
          has_more: visibility.hasMore,
          samples: visibility.samples,
          authorization_required: visibility.count === 0,
          guidance: visibility.count === 0
            ? 'Token 有效，但 integration 看不到任何内容。请在 Notion Internal connections 的 Content access 中添加页面，或打开目标页面 → ··· → Connections/连接 → 选择本 integration。'
            : 'Token 与页面授权均正常。',
        },
    },
  };
}

async function notionSearch(args, callId) {
  var body = {
    page_size: clampPageSize(args.page_size, 50),
    sort: {
      direction: args.sort_direction === 'ascending' ? 'ascending' : 'descending',
      timestamp: 'last_edited_time',
    },
  };
  if (typeof args.query === 'string' && args.query.trim()) body.query = args.query.trim();
  if (args.object_type === 'page' || args.object_type === 'data_source') {
    body.filter = { property: 'object', value: args.object_type };
  }
  if (args.cursor) body.start_cursor = String(args.cursor);
  var response = await api({
    url: API + '/search',
    method: 'POST',
    body: body,
    callId: callId,
  });
  if (response.err) return fail(response.err);
  if (response.data && Array.isArray(response.data.results) && response.data.results.length === 0) {
    response.data.authorization_diagnostic = {
      request_authenticated: true,
      message: args.query
        ? '请求已通过 Notion 验证，但没有匹配该关键词。若所有关键词都为空，请先调用 notion_status 检查 integration 可见内容。'
        : 'Token 有效，但当前 integration 没有可列出的内容。请在 Notion Internal connections 的 Content access 中添加页面，或在目标页面的 Connections/连接菜单中选择本 integration。',
    };
  }
  return deliver(response.data, args.out_file, callId, 'notion-search');
}

async function notionFetch(args, callId) {
  var id = normalizeId(args.id);
  if (!id) return fail('无法从 id/URL 中识别 Notion 对象 ID');
  var type = args.object_type;
  var includeContent = args.include_content !== false;
  var response;

  if (type === 'data_source') {
    response = await api({
      url: API + '/data_sources/' + encodeURIComponent(id),
      callId: callId,
    });
    if (response.err) return fail(response.err);
    return deliver(response.data, args.out_file, callId, 'notion-data-source');
  }

  if (type === 'database') {
    response = await api({
      url: API + '/databases/' + encodeURIComponent(id),
      callId: callId,
    });
    if (response.err) return fail(response.err);
    return deliver(response.data, args.out_file, callId, 'notion-database');
  }

  if (type === 'block') {
    response = await api({
      url: API + '/blocks/' + encodeURIComponent(id),
      callId: callId,
    });
    if (response.err) return fail(response.err);
    var blockResult = { block: response.data };
    if (includeContent) {
      var query = '?page_size=' + clampPageSize(args.page_size, 100);
      if (args.cursor) query += '&start_cursor=' + encodeURIComponent(String(args.cursor));
      var children = await api({
        url: API + '/blocks/' + encodeURIComponent(id) + '/children' + query,
        callId: callId,
      });
      if (children.err) return fail(children.err);
      blockResult.children = children.data;
    }
    return deliver(blockResult, args.out_file, callId, 'notion-block');
  }

  if (type !== 'page') return fail('object_type 只支持 page / data_source / database / block');
  response = await api({
    url: API + '/pages/' + encodeURIComponent(id),
    callId: callId,
  });
  if (response.err) return fail(response.err);
  var pageResult = { page: response.data };
  if (includeContent) {
    var markdownUrl = API + '/pages/' + encodeURIComponent(id) + '/markdown';
    if (args.include_transcript === true) markdownUrl += '?include_transcript=true';
    var markdown = await api({
      url: markdownUrl,
      version: MARKDOWN_VERSION,
      callId: callId,
    });
    if (markdown.err) {
      var fallbackUrl = API + '/blocks/' + encodeURIComponent(id) + '/children?page_size=' +
        clampPageSize(args.page_size, 100);
      if (args.cursor) fallbackUrl += '&start_cursor=' + encodeURIComponent(String(args.cursor));
      var fallback = await api({ url: fallbackUrl, callId: callId });
      if (fallback.err) return fail(markdown.err + '；同时读取 block children 也失败：' + fallback.err);
      pageResult.content_format = 'blocks';
      pageResult.content = fallback.data;
      pageResult.note = 'Markdown 端点不可用，已回退为一级 block children';
    } else {
      pageResult.content_format = 'markdown';
      pageResult.content = markdown.data;
    }
  }
  return deliver(pageResult, args.out_file, callId, 'notion-page');
}

async function notionQueryDataSource(args, callId) {
  var id = normalizeId(args.data_source_id);
  if (!id) return fail('无法从 data_source_id/URL 中识别 Notion data source ID');
  var body = {
    page_size: clampPageSize(args.page_size, 50),
  };
  if (args.filter && typeof args.filter === 'object') body.filter = args.filter;
  if (Array.isArray(args.sorts)) body.sorts = args.sorts;
  if (args.cursor) body.start_cursor = String(args.cursor);
  var response = await api({
    url: API + '/data_sources/' + encodeURIComponent(id) + '/query',
    method: 'POST',
    body: body,
    callId: callId,
  });
  if (response.err) return fail(response.err);
  return deliver(response.data, args.out_file, callId, 'notion-query');
}

async function notionCreatePage(args, callId) {
  var parentId = normalizeId(args.parent_id);
  if (!parentId) return fail('无法从 parent_id/URL 中识别 Notion 对象 ID');
  if (args.parent_type !== 'page' && args.parent_type !== 'data_source') {
    return fail('parent_type 必须是 page 或 data_source');
  }
  var properties = args.properties && typeof args.properties === 'object'
    ? Object.assign({}, args.properties)
    : {};
  var schemaData = null;

  if (args.parent_type === 'data_source') {
    schemaData = await getDataSourceSchema(parentId, callId);
    if (schemaData.err) return fail(schemaData.err);
    var propertyError = validateProperties(schemaData.properties, properties);
    if (propertyError) return fail(propertyError);
    if (args.title) {
      var titleName = findTitleProperty(schemaData.properties);
      if (!titleName) return fail('该 data source schema 中没有 title 属性，无法自动写入页面标题');
      if (!Object.prototype.hasOwnProperty.call(properties, titleName)) {
        properties[titleName] = titleProperty(args.title);
      }
    }
  } else if (args.title && !Object.prototype.hasOwnProperty.call(properties, 'title')) {
    properties.title = titleProperty(args.title);
  }

  if (!Object.keys(properties).length) {
    return fail('创建页面至少需要 title 或 properties');
  }
  var coverError = validateHttpsUrl(args.cover_url, 'cover_url');
  if (coverError) return fail(coverError);

  var blocks = typeof args.markdown === 'string' && args.markdown
    ? markdownToBlocks(args.markdown)
    : [];
  var body = {
    parent: args.parent_type === 'data_source'
      ? { type: 'data_source_id', data_source_id: parentId }
      : { type: 'page_id', page_id: parentId },
    properties: properties,
  };
  if (blocks.length) body.children = blocks.slice(0, 100);
  if (args.icon_emoji) {
    body.icon = { type: 'emoji', emoji: String(args.icon_emoji) };
  }
  if (args.cover_url) {
    body.cover = {
      type: 'external',
      external: { url: String(args.cover_url) },
    };
  }

  var created = await api({
    url: API + '/pages',
    method: 'POST',
    body: body,
    callId: callId,
  });
  if (created.err) return fail(created.err);
  var appended = Math.min(blocks.length, 100);
  if (blocks.length > 100) {
    var pageId = normalizeId(created.data && created.data.id);
    if (!pageId) {
      return fail('页面已创建，但响应缺少 page id，剩余正文未能追加');
    }
    var rest = await appendBlocks(pageId, blocks.slice(100), callId);
    if (rest.err) {
      return {
        ok: true,
        result: {
          page: created.data,
          partial: true,
          appended_blocks: appended + rest.appended,
          warning: '页面已创建，但追加剩余正文失败：' + rest.err,
        },
      };
    }
    appended += rest.appended;
  }
  return {
    ok: true,
    result: {
      page: created.data,
      appended_blocks: appended,
    },
  };
}

async function notionUpdatePage(args, callId) {
  var pageId = normalizeId(args.page_id);
  if (!pageId) return fail('无法从 page_id/URL 中识别 Notion page ID');
  var replacing = typeof args.replace_markdown === 'string';
  var movingToTrash = args.in_trash === true;
  var archiving = args.archived === true;
  var permitsDeletion = args.allow_deleting_content === true;
  if ((replacing || movingToTrash || archiving || permitsDeletion) && args.confirm !== true) {
    return fail(
      '该操作会覆盖整页正文、归档/移入回收站或允许删除子内容；请先向用户明确确认，再传 confirm:true 重试',
      'CONFIRM_REQUIRED'
    );
  }
  if (replacing && Array.isArray(args.content_updates) && args.content_updates.length) {
    return fail('replace_markdown 与 content_updates 只能二选一');
  }
  if (Array.isArray(args.content_updates) && args.content_updates.length > 100) {
    return fail('content_updates 最多 100 项');
  }
  var coverError = validateHttpsUrl(args.cover_url, 'cover_url');
  if (coverError) return fail(coverError);

  var metadataBody = {};
  var hasMetadata = false;
  var properties = args.properties && typeof args.properties === 'object' ? args.properties : null;

  if (properties) {
    var current = await api({
      url: API + '/pages/' + encodeURIComponent(pageId),
      callId: callId,
    });
    if (current.err) return fail(current.err);
    var dataSourceId = pageDataSourceId(current.data);
    if (dataSourceId) {
      var schemaData = await getDataSourceSchema(dataSourceId, callId);
      if (schemaData.err) return fail(schemaData.err);
      var propertyError = validateProperties(schemaData.properties, properties);
      if (propertyError) return fail(propertyError);
    }
    metadataBody.properties = properties;
    hasMetadata = true;
  }
  if (args.icon_emoji) {
    metadataBody.icon = { type: 'emoji', emoji: String(args.icon_emoji) };
    hasMetadata = true;
  }
  if (args.cover_url) {
    metadataBody.cover = {
      type: 'external',
      external: { url: String(args.cover_url) },
    };
    hasMetadata = true;
  }
  if (typeof args.archived === 'boolean') {
    metadataBody.archived = args.archived;
    hasMetadata = true;
  }
  if (typeof args.in_trash === 'boolean') {
    metadataBody.in_trash = args.in_trash;
    hasMetadata = true;
  }

  var metadataResult = null;
  if (hasMetadata) {
    var metadata = await api({
      url: API + '/pages/' + encodeURIComponent(pageId),
      method: 'PATCH',
      body: metadataBody,
      callId: callId,
    });
    if (metadata.err) return fail(metadata.err);
    metadataResult = metadata.data;
  }

  var contentResult = null;
  if (replacing) {
    var replacement = await api({
      url: API + '/pages/' + encodeURIComponent(pageId) + '/markdown',
      method: 'PATCH',
      version: MARKDOWN_VERSION,
      body: {
        type: 'replace_content',
        replace_content: {
          new_str: args.replace_markdown,
          allow_deleting_content: permitsDeletion,
        },
      },
      callId: callId,
    });
    if (replacement.err) {
      if (metadataResult) {
        return {
          ok: true,
          result: {
            partial: true,
            page: metadataResult,
            warning: '页面属性已更新，但 Markdown 覆盖失败：' + replacement.err,
          },
        };
      }
      return fail(replacement.err);
    }
    contentResult = replacement.data;
  } else if (Array.isArray(args.content_updates) && args.content_updates.length) {
    var updates = [];
    for (var index = 0; index < args.content_updates.length; index++) {
      var item = args.content_updates[index] || {};
      if (typeof item.old_str !== 'string' || typeof item.new_str !== 'string') {
        return fail('content_updates[' + index + '] 需要 old_str 与 new_str');
      }
      updates.push({
        old_str: item.old_str,
        new_str: item.new_str,
        replace_all_matches: item.replace_all_matches === true,
      });
    }
    var targeted = await api({
      url: API + '/pages/' + encodeURIComponent(pageId) + '/markdown',
      method: 'PATCH',
      version: MARKDOWN_VERSION,
      body: {
        type: 'update_content',
        update_content: {
          content_updates: updates,
          allow_deleting_content: permitsDeletion,
        },
      },
      callId: callId,
    });
    if (targeted.err) {
      if (metadataResult) {
        return {
          ok: true,
          result: {
            partial: true,
            page: metadataResult,
            warning: '页面属性已更新，但 Markdown 定向修改失败：' + targeted.err,
          },
        };
      }
      return fail(targeted.err);
    }
    contentResult = targeted.data;
  }

  if (!metadataResult && !contentResult) {
    return fail('没有可更新的字段；请传 properties、图标/封面、归档状态、replace_markdown 或 content_updates');
  }
  return {
    ok: true,
    result: {
      page: metadataResult,
      content: contentResult,
    },
  };
}

async function notionAppendContent(args, callId) {
  var blockId = normalizeId(args.block_id);
  if (!blockId) return fail('无法从 block_id/URL 中识别 Notion page/block ID');
  if (typeof args.markdown !== 'string' || !args.markdown.trim()) {
    return fail('markdown 不能为空');
  }
  var blocks = markdownToBlocks(args.markdown);
  if (!blocks.length) return fail('markdown 没有可追加的内容');
  var appended = await appendBlocks(blockId, blocks, callId);
  if (appended.err) {
    if (appended.appended) {
      return {
        ok: true,
        result: {
          partial: true,
          appended_blocks: appended.appended,
          warning: '部分内容已追加，后续批次失败：' + appended.err,
        },
      };
    }
    return fail(appended.err);
  }
  return {
    ok: true,
    result: {
      block_id: blockId,
      appended_blocks: appended.appended,
    },
  };
}

async function notionCreateComment(args, callId) {
  var pageId = normalizeId(args.page_id);
  if (!pageId) return fail('无法从 page_id/URL 中识别 Notion page ID');
  if (typeof args.text !== 'string' || !args.text.trim()) return fail('评论 text 不能为空');
  var response = await api({
    url: API + '/comments',
    method: 'POST',
    body: {
      parent: { page_id: pageId },
      rich_text: makeRichText(args.text),
    },
    callId: callId,
  });
  if (response.err) return fail(response.err);
  return { ok: true, result: response.data };
}

var TOOL_HANDLERS = {
  notion_status: notionStatus,
  notion_search: notionSearch,
  notion_fetch: notionFetch,
  notion_query_data_source: notionQueryDataSource,
  notion_create_page: notionCreatePage,
  notion_update_page: notionUpdatePage,
  notion_append_content: notionAppendContent,
  notion_create_comment: notionCreateComment,
};

/* 设置页连接测试：先 /wake，再用同源 BroadcastChannel 递活。 */
var bc = new BroadcastChannel('cindy-notion');
var seenTests = {};
var latestTestId = '';
var identityWriteQueue = Promise.resolve();
var SETTINGS_MESSAGES = {
  en: {
    failed: 'Notion connection test failed: ',
    visibilityFailed: 'The token is valid, but the page access check failed: ',
    noPages: 'The token is valid, but no Notion pages are authorized yet.',
    connected: 'Notion connected. Accessible content: {count}',
  },
  'zh-CN': {
    failed: 'Notion 连接测试失败：',
    visibilityFailed: 'Token 有效，但页面授权检查失败：',
    noPages: 'Token 有效，但还没有授权任何 Notion 页面',
    connected: 'Notion 已连接，可读取 {count} 项内容',
  },
  ja: {
    failed: 'Notion 接続テストに失敗しました：',
    visibilityFailed: 'トークンは有効ですが、ページのアクセス確認に失敗しました：',
    noPages: 'トークンは有効ですが、Notion ページがまだ許可されていません。',
    connected: 'Notion に接続しました。アクセス可能な内容：{count} 件',
  },
  ko: {
    failed: 'Notion 연결 테스트 실패: ',
    visibilityFailed: '토큰은 유효하지만 페이지 접근 확인에 실패했습니다: ',
    noPages: '토큰은 유효하지만 아직 허용된 Notion 페이지가 없습니다.',
    connected: 'Notion 연결됨. 접근 가능한 콘텐츠: {count}개',
  },
};

function settingsMessage(locale, key, values) {
  var messages = SETTINGS_MESSAGES[locale] || SETTINGS_MESSAGES.en;
  return messages[key].replace(/\{(\w+)\}/g, function (_match, name) {
    return values && values[name] !== undefined ? String(values[name]) : '';
  });
}

function clearCachedIdentity() {
  identityWriteQueue = identityWriteQueue.then(async function () {
    try {
      var kv = await (await fetch('/kv')).json();
      kv = kv && typeof kv === 'object' ? kv : {};
      if (!Object.prototype.hasOwnProperty.call(kv, 'notionIdentity')) return;
      delete kv.notionIdentity;
      await fetch('/kv', { method: 'PUT', body: JSON.stringify(kv) });
    } catch (e) {
      /* 身份展示缓存清理失败不影响连接测试。 */
    }
  });
  return identityWriteQueue;
}

async function cacheIdentityIfLatest(reqId, identity) {
  identityWriteQueue = identityWriteQueue.then(async function () {
    if (latestTestId !== reqId) return;
    try {
      var kv = await (await fetch('/kv')).json();
      if (latestTestId !== reqId) return;
      kv = kv && typeof kv === 'object' ? kv : {};
      kv.notionIdentity = identity;
      await fetch('/kv', { method: 'PUT', body: JSON.stringify(kv) });
    } catch (e) {
      /* 身份展示缓存写失败不影响连接测试。 */
    }
  });
  await identityWriteQueue;
  return latestTestId === reqId;
}

bc.onmessage = function (event) {
  var message = event && event.data;
  if (!message || message.type !== 'test-connection' || !message.reqId) return;
  if (seenTests[message.reqId]) return;
  if (Object.keys(seenTests).length > 200) seenTests = {};
  seenTests[message.reqId] = true;
  latestTestId = message.reqId;
  var identityReset = clearCachedIdentity();

  void (async function () {
    var status = await api({ url: API + '/users/me' });
    if (latestTestId !== message.reqId) return;
    if (status.err) {
      await identityReset;
      if (latestTestId !== message.reqId) return;
      bc.postMessage({
        type: 'test-connection-result',
        reqId: message.reqId,
        ok: false,
        message: status.err,
      });
      void cindy.send({
        type: 'notify',
        text: settingsMessage(message.locale, 'failed') + String(status.err).slice(0, 145),
        tone: 'error',
      });
      return;
    }
    var user = status.data || {};
    var visibility = await probeVisibleContent();
    if (latestTestId !== message.reqId) return;
    var identity = {
      botName: user.name || 'Notion integration',
      workspaceName: user.bot && user.bot.workspace_name ? user.bot.workspace_name : '',
      botId: user.id || '',
      visibilityChecked: !visibility.err,
      visibleCount: visibility.err ? 0 : visibility.count,
      visibleHasMore: visibility.err ? false : visibility.hasMore,
      visibleSamples: visibility.err ? [] : visibility.samples,
      visibilityError: visibility.err || '',
    };
    if (!await cacheIdentityIfLatest(message.reqId, identity)) return;
    bc.postMessage({
      type: 'test-connection-result',
      reqId: message.reqId,
      ok: true,
      botName: identity.botName,
      workspaceName: identity.workspaceName,
      visibilityChecked: identity.visibilityChecked,
      visibleCount: identity.visibleCount,
      visibleHasMore: identity.visibleHasMore,
      visibleSamples: identity.visibleSamples,
      visibilityError: identity.visibilityError,
    });
    if (identity.visibilityError) {
      void cindy.send({
        type: 'notify',
        text: settingsMessage(message.locale, 'visibilityFailed') +
          String(identity.visibilityError).slice(0, 125),
        tone: 'warning',
      });
    } else if (identity.visibleCount === 0) {
      void cindy.send({
        type: 'notify',
        text: settingsMessage(message.locale, 'noPages'),
        tone: 'warning',
      });
    } else {
      void cindy.send({
        type: 'notify',
        text: settingsMessage(message.locale, 'connected', {
          count: identity.visibleCount + (identity.visibleHasMore ? '+' : ''),
        }),
        tone: 'success',
      });
    }
  })();
};

cindy.onHostMessage(async function (message) {
  if (!message || message.type !== 'tool-call') return;
  try {
    var handler = TOOL_HANDLERS[message.tool];
    var result = handler
      ? await handler(message.args || {}, message.callId)
      : fail('未知工具：' + message.tool);
    if (result.ok) {
      cindy.send({
        type: 'tool-result',
        callId: message.callId,
        ok: true,
        result: result.result,
      });
    } else {
      cindy.send({
        type: 'tool-result',
        callId: message.callId,
        ok: false,
        errorCode: result.errorCode,
        message: result.message,
      });
    }
  } catch (error) {
    cindy.send({
      type: 'tool-result',
      callId: message.callId,
      ok: false,
      message: 'Notion 工具执行失败：' +
        (error && error.message ? error.message : String(error)),
    });
  }
});
