/* global cindy */

var SECRET_KEY = 'outlook_account';
var PLUGIN_NAME = 'Outlook';
var BASE = 'https://graph.microsoft.com/v1.0/me';
var IMMUTABLE_ID_PREFER = 'IdType="ImmutableId"';

function fail(message) {
  return { ok: false, message: message };
}

function clampInt(value, fallback, max) {
  var n = typeof value === 'number' && isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(1, n));
}

function errorMessage(data, fallback) {
  if (data && data.error && data.error.message) return data.error.message;
  return fallback;
}

async function api(opts) {
  var request = {
    url: opts.url,
    method: opts.method || 'GET',
    headers: {
      Accept: 'application/json',
      Prefer: opts.prefer || IMMUTABLE_ID_PREFER,
    },
    callId: opts.callId,
  };
  if (opts.account) request.authAccount = opts.account;
  if (opts.consistencyLevel) request.headers.ConsistencyLevel = opts.consistencyLevel;
  if (opts.body !== undefined) {
    request.headers['Content-Type'] = 'application/json';
    request.body = JSON.stringify(opts.body);
  }
  var response = await cindy.fetch(request);
  if (!response.ok) return { err: response.message };

  var data = null;
  if (response.body) {
    try {
      data = JSON.parse(response.body);
    } catch (_err) {
      return { err: 'Microsoft 返回了无法解析的响应(HTTP ' + response.status + ')' };
    }
  }
  if (response.status < 200 || response.status >= 300) {
    return {
      err: 'Microsoft Graph 返回 HTTP ' + response.status + ':' +
        errorMessage(data, (response.body || '').slice(0, 200)),
    };
  }
  return { data: data };
}

async function listAccounts() {
  var response = await fetch('/oauth');
  if (!response.ok) return fail('账号状态查询失败(' + response.status + ')');
  var list = await response.json();
  var entry = list.find(function (item) { return item && item.key === SECRET_KEY; });
  if (!entry || !entry.clientConfigured) {
    return fail('内置应用身份缺失，请升级 Cindy 后重试');
  }
  if (!entry.accounts.length) {
    return fail('尚未连接 Microsoft 账号，请到「' + PLUGIN_NAME + '」详情页单独授权');
  }
  return {
    ok: true,
    result: {
      accounts: entry.accounts.map(function (account) {
        return {
          id: account.id,
          email: account.label,
          status: account.status,
          is_default: account.isDefault,
        };
      }),
    },
  };
}

function emailAddress(value) {
  return value && value.emailAddress ? value.emailAddress.address || '' : '';
}

function emailAddresses(values) {
  return (Array.isArray(values) ? values : []).map(emailAddress).filter(Boolean);
}

function recipientList(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    return { recipients: [] };
  }
  if (/[\r\n]/.test(String(value))) {
    return { error: fieldName + ' 不得包含换行符' };
  }
  var addresses = String(value)
    .split(',')
    .map(function (item) { return item.trim(); })
    .filter(Boolean);
  if (!addresses.length) return { error: fieldName + ' 不能为空' };
  return {
    recipients: addresses.map(function (address) {
      return { emailAddress: { address: address } };
    }),
  };
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function messageSummary(message) {
  return {
    id: message.id,
    conversation_id: message.conversationId || '',
    from: emailAddress(message.from),
    to: emailAddresses(message.toRecipients),
    subject: message.subject || '',
    date: message.receivedDateTime || message.sentDateTime || '',
    snippet: message.bodyPreview || '',
    is_read: !!message.isRead,
    has_attachments: !!message.hasAttachments,
    importance: message.importance || 'normal',
    folder_id: message.parentFolderId || '',
    web_link: message.webLink || '',
  };
}

function buildMessage(args) {
  var to = recipientList(args.to, 'to');
  if (to.error) return { error: to.error };
  if (!to.recipients.length) return { error: 'to 不能为空' };
  var cc = recipientList(args.cc, 'cc');
  if (cc.error) return { error: cc.error };
  var bcc = recipientList(args.bcc, 'bcc');
  if (bcc.error) return { error: bcc.error };
  if (/[\r\n]/.test(String(args.subject))) {
    return { error: 'subject 不得包含换行符' };
  }
  return {
    message: {
      subject: String(args.subject),
      body: {
        contentType: 'Text',
        content: String(args.body_text),
      },
      toRecipients: to.recipients,
      ccRecipients: cc.recipients,
      bccRecipients: bcc.recipients,
    },
  };
}

async function outlook(args, callId) {
  var account = args.account;

  if (args.action === 'search') {
    var query = String(args.query || '').trim();
    if (!query) return fail('search 需要 query(纯文本关键词或短语)');
    var escapedQuery = '"' + query.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    var select = [
      'id',
      'conversationId',
      'subject',
      'from',
      'toRecipients',
      'receivedDateTime',
      'sentDateTime',
      'bodyPreview',
      'isRead',
      'hasAttachments',
      'importance',
      'parentFolderId',
      'webLink',
    ].join(',');
    var listed = await api({
      url: BASE + '/messages?$search=' + encodeURIComponent(escapedQuery) +
        '&$top=' + clampInt(args.max_results, 5, 10) +
        '&$select=' + encodeURIComponent(select),
      account: account,
      callId: callId,
      consistencyLevel: 'eventual',
    });
    if (listed.err) return fail(listed.err);
    var messages = ((listed.data && listed.data.value) || []).map(messageSummary);
    return {
      ok: true,
      result: {
        messages: messages,
        has_more: !!(listed.data && listed.data['@odata.nextLink']),
      },
    };
  }

  if (args.action === 'read') {
    if (!args.message_id) return fail('read 需要 message_id');
    var selectRead = [
      'id',
      'conversationId',
      'subject',
      'from',
      'toRecipients',
      'ccRecipients',
      'bccRecipients',
      'receivedDateTime',
      'sentDateTime',
      'body',
      'bodyPreview',
      'isRead',
      'hasAttachments',
      'importance',
      'categories',
      'parentFolderId',
      'webLink',
    ].join(',');
    var full = await api({
      url: BASE + '/messages/' + encodeURIComponent(args.message_id) +
        '?$select=' + encodeURIComponent(selectRead),
      account: account,
      callId: callId,
      prefer: IMMUTABLE_ID_PREFER + ', outlook.body-content-type="text"',
    });
    if (full.err) return fail(full.err);
    var content = full.data && full.data.body ? full.data.body.content || '' : '';
    if (full.data && full.data.body && String(full.data.body.contentType).toLowerCase() === 'html') {
      content = stripHtml(content);
    }
    if (content.length > 20000) content = content.slice(0, 20000) + '\n…(正文过长已截断)';
    return {
      ok: true,
      result: {
        id: full.data.id,
        conversation_id: full.data.conversationId || '',
        from: emailAddress(full.data.from),
        to: emailAddresses(full.data.toRecipients),
        cc: emailAddresses(full.data.ccRecipients),
        bcc: emailAddresses(full.data.bccRecipients),
        subject: full.data.subject || '',
        date: full.data.receivedDateTime || full.data.sentDateTime || '',
        body: content,
        is_read: !!full.data.isRead,
        has_attachments: !!full.data.hasAttachments,
        importance: full.data.importance || 'normal',
        categories: full.data.categories || [],
        folder_id: full.data.parentFolderId || '',
        web_link: full.data.webLink || '',
      },
    };
  }

  if (args.action === 'list_folders') {
    var folders = await api({
      url: BASE + '/mailFolders?includeHiddenFolders=true&$top=100&$select=' +
        encodeURIComponent(
          'id,displayName,parentFolderId,childFolderCount,totalItemCount,unreadItemCount,isHidden',
        ),
      account: account,
      callId: callId,
    });
    if (folders.err) return fail(folders.err);
    return {
      ok: true,
      result: {
        folders: ((folders.data && folders.data.value) || []).map(function (folder) {
          return {
            id: folder.id,
            name: folder.displayName,
            parent_folder_id: folder.parentFolderId || '',
            child_folder_count: folder.childFolderCount || 0,
            total_count: folder.totalItemCount || 0,
            unread_count: folder.unreadItemCount || 0,
            is_hidden: !!folder.isHidden,
          };
        }),
      },
    };
  }

  if (args.action === 'mark_read' || args.action === 'mark_unread') {
    if (!args.message_id) return fail(args.action + ' 需要 message_id');
    var isRead = args.action === 'mark_read';
    var marked = await api({
      url: BASE + '/messages/' + encodeURIComponent(args.message_id),
      method: 'PATCH',
      body: { isRead: isRead },
      account: account,
      callId: callId,
    });
    if (marked.err) return fail(marked.err);
    return { ok: true, result: { modified: true, id: args.message_id, is_read: isRead } };
  }

  if (args.action === 'move') {
    if (!args.message_id || !args.destination_folder_id) {
      return fail('move 需要 message_id 和 destination_folder_id');
    }
    var moved = await api({
      url: BASE + '/messages/' + encodeURIComponent(args.message_id) + '/move',
      method: 'POST',
      body: { destinationId: String(args.destination_folder_id) },
      account: account,
      callId: callId,
    });
    if (moved.err) return fail(moved.err);
    return {
      ok: true,
      result: {
        moved: true,
        id: moved.data && moved.data.id ? moved.data.id : args.message_id,
        destination_folder_id: args.destination_folder_id,
      },
    };
  }

  if (args.action === 'send' || args.action === 'draft') {
    if (!args.to || args.subject === undefined || args.body_text === undefined) {
      return fail(args.action + ' 需要 to / subject / body_text');
    }
    var built = buildMessage(args);
    if (built.error) return fail(built.error);
    if (args.action === 'send') {
      var sent = await api({
        url: BASE + '/sendMail',
        method: 'POST',
        body: { message: built.message, saveToSentItems: true },
        account: account,
        callId: callId,
      });
      if (sent.err) return fail(sent.err);
      return { ok: true, result: { sent: true } };
    }
    var draft = await api({
      url: BASE + '/messages',
      method: 'POST',
      body: built.message,
      account: account,
      callId: callId,
    });
    if (draft.err) return fail(draft.err);
    return {
      ok: true,
      result: {
        draft: true,
        id: draft.data.id,
        web_link: draft.data.webLink || '',
      },
    };
  }

  return fail('未知 action:' + args.action);
}

cindy.onHostMessage(async function (message) {
  if (!message || message.type !== 'tool-call') return;
  try {
    var result = message.tool === 'outlook_accounts'
      ? await listAccounts()
      : message.tool === 'outlook'
        ? await outlook(message.args || {}, message.callId)
        : fail('未知工具:' + message.tool);
    if (result.ok) {
      cindy.send({ type: 'tool-result', callId: message.callId, ok: true, result: result.result });
    } else {
      cindy.send({ type: 'tool-result', callId: message.callId, ok: false, message: result.message });
    }
  } catch (error) {
    cindy.send({
      type: 'tool-result',
      callId: message.callId,
      ok: false,
      message: 'Outlook 工具执行失败:' +
        (error && error.message ? error.message : String(error)),
    });
  }
});
