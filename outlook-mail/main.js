/* global cindy */
'use strict';
var OutlookMail = (() => {
  const CLOUDS = Object.freeze({
    global: { key: 'outlook_global', base: 'https://graph.microsoft.com/v1.0' },
    china: { key: 'outlook_china', base: 'https://microsoftgraph.chinacloudapi.cn/v1.0' },
  });
  const ACTIONS = ['search', 'read', 'send', 'draft', 'list_folders', 'mark_read', 'mark_unread', 'move'];
  const WRITES = ['send', 'draft', 'mark_read', 'mark_unread', 'move'];
  const SUMMARY = 'id,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead,isDraft,hasAttachments,parentFolderId,webLink,internetMessageId';
  class MailError extends Error {
    constructor(code, message, execution = 'not_executed') { super(message); this.code = code; this.execution = execution; }
  }
  const invalid = message => { throw new MailError('INVALID_ARGUMENT', message); };
  function text(value, name, max = 2048, empty = false) {
    if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) invalid(name + ' 必须是有效文本，请检查参数。');
    return value;
  }
  function segment(value, name) {
    const s = text(value, name);
    if (s === '.' || s === '..' || /[\x00-\x1f\x7f]/.test(s)) invalid(name + ' 无效，请使用插件返回的原始 ID。');
    return encodeURIComponent(s);
  }
  function recipients(value, name) {
    if (value === undefined) return [];
    const values = Array.isArray(value) ? value : text(value, name, 20000).split(/[,;]/);
    if (values.length > 100) invalid(name + ' 最多支持 100 个地址。');
    return values.map(v => {
      const address = text(v, name, 320).trim();
      if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(address)) invalid(name + ' 请填写完整邮箱地址，不带姓名或换行。');
      return { emailAddress: { address } };
    });
  }
  function date(value, name) {
    text(value, name, 40);
    if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) invalid(name + ' 请使用 ISO 日期或含时区的时间。');
    const calendar = new Date(value.slice(0, 10) + 'T00:00:00Z');
    if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== value.slice(0, 10)) invalid(name + ' 日期无效。');
    const d = new Date(value);
    if (!Number.isFinite(d.getTime()) || (value.length === 10 && d.toISOString().slice(0, 10) !== value)) invalid(name + ' 日期无效。');
    return d.toISOString();
  }
  function validate(a) {
    if (!a || !ACTIONS.includes(a.action)) invalid('请选择支持的邮件操作。');
    const fields = {
      search: ['query','from','subject','unread','since','before','folder','max_results','page_token'],
      list_folders: ['folder','max_results','page_token'],
      read: ['message_id'], send: ['to','cc','bcc','subject','body_text'], draft: ['to','cc','bcc','subject','body_text'],
      mark_read: ['message_id'], mark_unread: ['message_id'], move: ['message_id','target_folder'],
    };
    const allowed = ['action','cloud','account',...fields[a.action]];
    if (Object.keys(a).some(k => !allowed.includes(k))) invalid('此操作包含不适用的参数，请按工具说明调整；指定发件账号请使用 account。');
    if (a.cloud !== undefined && !Object.hasOwn(CLOUDS, a.cloud)) invalid('cloud 仅支持 global 或 china。');
    if (a.account !== undefined) text(a.account, 'account');
    if (a.max_results !== undefined && (!Number.isInteger(a.max_results) || a.max_results < 1 || a.max_results > 50)) invalid('max_results 必须是 1–50 的整数。');
    if (a.page_token !== undefined) {
      if (!['search', 'list_folders'].includes(a.action)) invalid('此操作不支持分页。');
      text(a.page_token, 'page_token', 24000);
      if (['query','from','subject','unread','since','before','folder','max_results'].some(k => a[k] !== undefined)) invalid('继续分页时只传 action、account、cloud 和 page_token。');
    }
    if (['read','mark_read','mark_unread','move'].includes(a.action)) segment(a.message_id, 'message_id');
    if (a.folder !== undefined) segment(a.folder, 'folder');
    if (a.action === 'move') segment(a.target_folder, 'target_folder');
    if (a.action === 'search') {
      if (a.query !== undefined) {
        text(a.query, 'query', 1000);
        if (['from','subject','unread','since','before'].some(k => a[k] !== undefined)) invalid('query 与结构化筛选请分开使用，可将条件写入 Microsoft KQL query。');
      }
      for (const k of ['from','subject']) if (a[k] !== undefined) text(a[k], k, 500);
      if (a.unread !== undefined && typeof a.unread !== 'boolean') invalid('unread 必须是布尔值。');
      for (const k of ['since','before']) if (a[k] !== undefined) date(a[k], k);
      if (a.since && a.before && date(a.since,'since') >= date(a.before,'before')) invalid('since 必须早于 before。');
    }
    if (['send','draft'].includes(a.action)) {
      text(a.subject,'subject',998,true); text(a.body_text,'body_text',200000,true);
      const total = ['to','cc','bcc'].map(k => recipients(a[k],k).length).reduce((x,y) => x+y,0);
      if (a.action === 'send' && total === 0) invalid('发送邮件至少需要一个收件人。');
      if (total > 100) invalid('单封邮件最多支持 100 个收件人。');
    }
  }
  async function local(path) {
    try {
      const r = await fetch(path);
      if (!r.ok) throw new Error('LOCAL_STATE_FAILED');
      return await r.json();
    } catch (_) {
      throw new MailError('LOCAL_STATE_FAILED','无法读取插件配置，请重新打开插件详情页后重试。');
    }
  }
  async function accounts() {
    const entries = await local('/oauth');
    if (!Array.isArray(entries)) throw new MailError('LOCAL_STATE_FAILED','账号状态异常，请重新打开插件详情页。');
    return Object.entries(CLOUDS).map(([cloud,cfg]) => {
      const e = entries.find(e => e.key === cfg.key);
      return { cloud, configured: !!e?.clientConfigured, accounts: (e?.accounts || []).map(a => ({
        id:a.id, label:a.label, status:a.status, is_default:!!a.isDefault, needs_reauthorization:!!a.scopeStale,
      })) };
    });
  }
  async function choose(a) {
    const groups = await accounts();
    let cloud = a.cloud;
    if (a.account) {
      const found = groups.filter(g => (!cloud || g.cloud === cloud) && g.accounts.some(x => x.id === a.account));
      if (found.length !== 1) throw new MailError('ACCOUNT_NOT_FOUND','账号不属于所选服务区域或不存在，请先调用 outlook_accounts。');
      cloud = found[0].cloud;
    }
    if (!cloud) {
      const cfg = await local('/kv') || {};
      cloud = Object.hasOwn(CLOUDS,cfg.default_cloud) ? cfg.default_cloud : 'global';
    }
    const g = groups.find(g => g.cloud === cloud);
    if (!g.configured) throw new MailError('CLIENT_NOT_CONFIGURED','此区域尚未配置微软应用身份，请在插件详情页配置 Client ID，再连接账号。');
    const account = a.account ? g.accounts.find(x => x.id === a.account) : g.accounts.find(x => x.is_default);
    if (!account) throw new MailError('ACCOUNT_NOT_CONNECTED','此区域没有默认账号，请在插件详情页连接并设为默认，或明确指定 account。');
    if (account.status !== 'connected') throw new MailError('ACCOUNT_EXPIRED','账号授权已失效，请在插件详情页重新连接同一账号。');
    return { ...CLOUDS[cloud], cloud, account:account.id };
  }
  function validPageUrl(raw,ctx,action) {
    let u; try { u = new URL(raw); } catch (_) { invalid('分页地址无效，请重新查询。'); }
    const valid = action === 'search' ? /^\/v1\.0\/me\/(?:messages|mailFolders\/[^/]+\/messages)$/.test(u.pathname)
      : /^\/v1\.0\/me\/mailFolders(?:\/[^/]+\/childFolders)?$/.test(u.pathname);
    if (u.origin !== new URL(ctx.base).origin || u.username || u.password || u.hash || !valid) invalid('分页地址不属于当前邮箱区域或操作，请重新查询。');
    return u.href;
  }
  function encodePage(url,ctx,action) {
    validPageUrl(url,ctx,action);
    const bytes = new TextEncoder().encode(JSON.stringify({url,cloud:ctx.cloud,account:ctx.account,action}));
    return btoa(Array.from(bytes,b => String.fromCharCode(b)).join(''));
  }
  function decodePage(token,ctx,action) {
    let p; try { p = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(token),c => c.charCodeAt(0)))); }
    catch (_) { invalid('分页凭据无效，请重新查询。'); }
    if (!p || p.cloud !== ctx.cloud || p.account !== ctx.account || p.action !== action) invalid('分页凭据与账号或操作不匹配，请重新查询。');
    return validPageUrl(p.url,ctx,action);
  }
  function build(a,ctx) {
    const method = ['mark_read','mark_unread'].includes(a.action) ? 'PATCH' : WRITES.includes(a.action) ? 'POST' : 'GET';
    let path, body;
    const q = new URLSearchParams();
    if (['search','list_folders'].includes(a.action)) {
      if (a.page_token) return {url:decodePage(a.page_token,ctx,a.action),method};
      path = a.action === 'list_folders'
        ? a.folder ? '/me/mailFolders/'+segment(a.folder,'folder')+'/childFolders' : '/me/mailFolders'
        : a.folder ? '/me/mailFolders/'+segment(a.folder,'folder')+'/messages' : '/me/messages';
      q.set('$top',String(a.max_results || 10));
      if (a.action === 'list_folders') q.set('$select','id,displayName,parentFolderId,childFolderCount,unreadItemCount,totalItemCount');
      else {
        q.set('$select',SUMMARY);
        if (a.query !== undefined) q.set('$search',JSON.stringify(a.query));
        else {
          const filters = [];
          if (a.since) filters.push('receivedDateTime ge '+date(a.since,'since'));
          if (a.before) filters.push('receivedDateTime lt '+date(a.before,'before'));
          const quote = s => "'"+s.replace(/'/g,"''")+"'";
          if (a.from) filters.push('from/emailAddress/address eq '+quote(a.from));
          if (a.subject) filters.push('contains(subject,'+quote(a.subject)+')');
          if (a.unread !== undefined) filters.push('isRead eq '+!a.unread);
          if (filters.length) q.set('$filter',filters.join(' and '));
          // Graph requires ordered properties to lead the filter; do not add a hidden date cutoff.
          if (!filters.length || a.since || a.before) q.set('$orderby','receivedDateTime desc');
        }
      }
    } else if (['send','draft'].includes(a.action)) {
      const message = {subject:a.subject,body:{contentType:'Text',content:a.body_text},
        toRecipients:recipients(a.to,'to'),ccRecipients:recipients(a.cc,'cc'),bccRecipients:recipients(a.bcc,'bcc')};
      path = a.action === 'send' ? '/me/sendMail' : '/me/messages';
      body = a.action === 'send' ? {message,saveToSentItems:true} : message;
    } else {
      path = '/me/messages/'+segment(a.message_id,'message_id');
      if (a.action === 'read') q.set('$select',SUMMARY+',body,ccRecipients,bccRecipients,replyTo,conversationId');
      if (a.action === 'move') { path += '/move'; body = {destinationId:a.target_folder}; }
      if (['mark_read','mark_unread'].includes(a.action)) body = {isRead:a.action === 'mark_read'};
    }
    const request = {url:ctx.base+path+(q.size ? '?'+q : ''),method};
    if (body !== undefined) request.body = JSON.stringify(body);
    if (request.body && new TextEncoder().encode(request.body).length > 250000) invalid('邮件内容过大，请缩短正文后重试（请求上限约 250 KB）。');
    return request;
  }
  function failureMessage(status,code) {
    if (/MailboxNotEnabledForRESTAPI/.test(code)) return '此账号没有可用的云端邮箱，请确认已分配 Exchange Online 邮箱；本地 Exchange 或其他服务商邮箱不能通过此插件连接。';
    if (status === 401) return '微软授权已失效，请在插件详情页重新连接账号。';
    if (status === 403) return '微软拒绝此操作，请重新连接以授权邮件读写／发送权限；若仍失败，请让企业管理员检查应用访问策略。';
    if (status === 404) return '未找到邮件或文件夹，请重新查询并使用最新 ID。';
    if (status === 429) return '微软暂时限制请求频率，请稍后重试。';
    if (status >= 500) return '微软邮件服务暂时异常，请稍后查询状态。';
    return '微软拒绝了请求（HTTP '+status+'），请检查参数、服务区域及邮箱权限。';
  }
  async function api(request,ctx,callId,action,transport) {
    const write = WRITES.includes(action);
    let r;
    try { r = await transport({...request,callId,authAccount:ctx.account,as:'text',timeoutMs:30000,
      headers:{Accept:'application/json',Prefer:'outlook.body-content-type="text"',...(request.body ? {'Content-Type':'application/json'} : {})}}); }
    catch (_) { throw new MailError('REQUEST_FAILED','连接中断；'+(write ? '结果未知，请先检查邮箱，勿直接重复执行。' : '请检查网络后重试。'),write ? 'unknown' : 'not_executed'); }
    if (!r.ok) throw new MailError('REQUEST_FAILED','主机未能完成请求；'+(write ? '结果未知，请先检查邮箱，勿直接重复执行。' : '请检查账号授权和网络后重试。'),write ? 'unknown' : 'not_executed');
    if (!Number.isInteger(r.status) || r.status < 100 || r.status > 599) throw new MailError('INVALID_RESPONSE','主机未返回有效的 HTTP 状态，请检查邮箱中的实际状态。',write ? 'unknown' : 'not_executed');
    const success = r.status >= 200 && r.status < 300;
    const state = success && write ? 'executed' : write && (r.status >= 500 || r.status === 408) ? 'unknown' : 'not_executed';
    let data = null;
    if (!r.truncated && r.body) { try { data = JSON.parse(r.body); } catch (_) { /* checked below */ } }
    if (!success) throw new MailError('GRAPH_REQUEST_FAILED',failureMessage(r.status,typeof data?.error?.code === 'string' ? data.error.code : '')
      +(state === 'unknown' ? ' 操作结果未知，请先检查邮箱，勿直接重复执行。' : ''),state);
    if (action === 'send' && r.status === 202) return {accepted:true,delivery_confirmed:false,execution_status:'executed',note:'微软已接受发送请求；不代表收件人已收到邮件。'};
    if (r.truncated || !data || typeof data !== 'object' || Array.isArray(data)) throw new MailError('INVALID_RESPONSE',
      '微软响应不完整；'+(write ? '服务已接受操作，请先检查邮箱，勿直接重复执行。' : '请减小 max_results 后重新查询。'),state);
    if (action === 'send') throw new MailError('UNEXPECTED_SEND_RESPONSE','微软返回了非预期发送响应，请先检查已发送邮件，勿直接重发。','unknown');
    return data;
  }
  function summary(m) {
    return {id:m.id,subject:m.subject,from:m.from?.emailAddress,to:m.toRecipients?.map(r => r.emailAddress),
      received_at:m.receivedDateTime,preview:m.bodyPreview,is_read:m.isRead,is_draft:m.isDraft,
      has_attachments:m.hasAttachments,folder_id:m.parentFolderId,web_url:m.webLink,internet_message_id:m.internetMessageId};
  }
  async function run(a,callId,transport) {
    validate(a);
    const ctx = await choose(a);
    const data = await api(build(a,ctx),ctx,callId,a.action,transport);
    const common = {cloud:ctx.cloud,account:ctx.account};
    if (['search','list_folders'].includes(a.action)) {
      if (!Array.isArray(data.value)) throw new MailError('INVALID_RESPONSE','微软返回的列表不完整，请重新查询。');
      const page = data['@odata.nextLink'] ? encodePage(data['@odata.nextLink'],ctx,a.action) : null;
      if (a.action === 'search') return {...common,messages:data.value.map(summary),next_page_token:page,returned_count:data.value.length,search_limit:a.query ? 1000 : undefined};
      return {...common,folders:data.value.map(f => ({id:f.id,name:f.displayName,parent_id:f.parentFolderId,
        child_folder_count:f.childFolderCount,unread_count:f.unreadItemCount,total_count:f.totalItemCount})),next_page_token:page};
    }
    if (a.action === 'send') return {...common,...data};
    if (!data.id) throw new MailError('INVALID_RESPONSE','微软响应缺少邮件 ID，请重新查询邮箱状态。',WRITES.includes(a.action) ? 'executed' : 'not_executed');
    if (a.action === 'read') {
      const body = data.body?.content || '';
      return {...common,...summary(data),cc:data.ccRecipients?.map(r => r.emailAddress),bcc:data.bccRecipients?.map(r => r.emailAddress),
        body:body.slice(0,50000),body_content_type:data.body?.contentType,body_truncated:body.length > 50000,conversation_id:data.conversationId};
    }
    return {...common,execution_status:'executed',message:summary(data),...(a.action === 'move' ? {previous_id:a.message_id,note:'后续操作请使用返回的新 ID。'} : {})};
  }
  return {CLOUDS,MailError,validate,build,accounts,run,encodePage,decodePage};
})();
// OAuth, token refresh and Authorization injection belong to the Host.
// The plugin receives account metadata only; every mail request uses cindy.fetch.
if (typeof cindy !== 'undefined') cindy.onHostMessage(async msg => {
  if (msg.type !== 'tool-call') return;
  try {
    let result;
    if (msg.tool === 'outlook_accounts') result = {regions:await OutlookMail.accounts()};
    else if (msg.tool === 'outlook_mail') result = await OutlookMail.run(msg.args || {},msg.callId,req=>cindy.fetch(req));
    else throw new OutlookMail.MailError('UNKNOWN_MAIL_TOOL','未知邮件工具，请重新获取插件工具清单。');
    await cindy.send({type:'tool-result',callId:msg.callId,ok:true,result});
  } catch (err) {
    const known = err instanceof OutlookMail.MailError;
    const execution = known ? err.execution : 'unknown';
    const message = execution === 'unknown' ? '操作结果不确定；请先检查邮箱中的实际状态，不要直接重复执行。'
      : execution === 'executed' ? '服务已接受操作，但结果未能完整返回；请先检查邮箱中的实际状态，不要直接重复执行。' : err.message;
    await cindy.send({type:'tool-result',callId:msg.callId,ok:false,errorCode:known ? err.code : 'MAIL_OPERATION_FAILED',
      message:'[execution_status='+execution+'] '+message});
  }
});
