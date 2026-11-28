const base = 'https://api.cloudflare.com/client/v4/zones';
const methods = new Map([
  ['create_dns_record', 'POST'],
  ['update_dns_record', 'PATCH'],
  ['delete_dns_record', 'DELETE'],
]);

class DnsError extends Error {}

function requireValue(condition, message) {
  if (!condition) throw new DnsError(message);
}

function identifier(value) {
  requireValue(typeof value === 'string' && /^[a-f0-9]{32}$/.test(value), 'Invalid zone or record ID.');
  return value;
}

function fields(value) {
  const {type, name, content, ttl, proxied} = value || {};
  requireValue(['A', 'AAAA', 'CNAME'].includes(type), 'Writes support A, AAAA and CNAME records.');
  for (const text of [name, content]) {
    requireValue(typeof text === 'string' && text.length <= 253 && /^[a-z0-9_.:*-]+$/i.test(text),
      'Use ASCII DNS names and address values.');
  }
  requireValue(Number.isSafeInteger(ttl) && ttl >= 1 && typeof proxied === 'boolean', 'Invalid TTL or proxy flag.');
  return {type, name, content, ttl, proxied};
}

async function request(callId, path, method = 'GET', data, verifyDelete = false) {
  const spec = {url: base + path, method, callId, as: 'text', timeoutMs: 15000};
  if (data) {
    spec.headers = {'Content-Type': 'application/json'};
    spec.body = JSON.stringify(data);
  }
  const reply = await cindy.fetch(spec);
  requireValue(reply?.ok === true && !reply.truncated, 'Cloudflare response unavailable.');
  let envelope;
  try { envelope = JSON.parse(reply.body); } catch { throw new DnsError('Invalid Cloudflare response.'); }
  if (verifyDelete && reply.status === 404 && envelope?.success === false &&
      envelope.errors?.some(e => e.code === 81044)) return null;
  const status = Number.isInteger(reply.status) ? reply.status : 0;
  requireValue(status >= 200 && status < 300 && envelope?.success === true && envelope.result != null,
    'Cloudflare request failed (HTTP ' + status + ').');
  return envelope;
}

function summary(record) {
  return record.type + ' ' + record.name + ' → ' + record.content + ' TTL ' + record.ttl +
    (record.proxied ? ' proxied' : ' DNS only');
}

async function run(msg, state) {
  const a = msg.args || {};
  const path = msg.tool === 'list_zones' ? '' : '/' + identifier(a.zone_id) + '/dns_records';
  if (msg.tool === 'list_zones' || msg.tool === 'list_dns_records') {
    const page = a.page ?? 1;
    requireValue(Number.isSafeInteger(page) && page >= 1, 'Invalid page.');
    const query = '?per_page=25&page=' + page + (a.name ? '&name=' + encodeURIComponent(a.name) : '');
    const reply = await request(msg.callId, path + query);
    requireValue(Array.isArray(reply.result), 'Invalid list response.');
    const items = reply.result.map(({id, name, type, content, ttl, proxied}) =>
      msg.tool === 'list_zones' ? {id, name} : {id, name, type, content, ttl, proxied});
    return {items, page, total_pages: reply.result_info?.total_pages};
  }

  const method = methods.get(msg.tool);
  requireValue(method, 'Unknown tool.');
  const before = method === 'POST' ? null : fields(a.before);
  const target = before ? identifier(a.before.id) : null;
  const after = method === 'DELETE' ? null : fields(a.record);
  const body = ['Zone ' + a.zone_id, target && 'ID ' + target, before && '− ' + summary(before),
    after && '+ ' + summary(after)].filter(Boolean).join('\n');
  requireValue(body.length <= 297, 'Record preview exceeds the host confirmation limit.');
  const action = {POST: 'Create', PATCH: 'Update', DELETE: 'Delete'}[method];
  const approval = await cindy.confirm({body, confirmText: action, cancelText: 'Cancel',
    danger: method === 'DELETE', mobilePageId: msg.mobilePageId});
  requireValue(approval?.ok === true && approval.confirmed === true, 'Change was not confirmed.');

  const itemPath = target ? path + '/' + target : path;
  if (before) {
    const current = (await request(msg.callId, itemPath)).result;
    requireValue(current.id === target && JSON.stringify(fields(current)) === JSON.stringify(before),
      'Record changed. List records and review a new preview.');
  }
  state.outcome = 'unknown';
  const receipt = (await request(msg.callId, itemPath, method, after)).result;
  state.outcome = 'executed';
  const id = identifier(receipt.id);
  requireValue(!target || id === target, 'Unexpected record ID in write response.');
  const observed = await request(msg.callId, path + '/' + id, 'GET', null, !after);
  if (after) {
    requireValue(observed.result.id === id && JSON.stringify(fields(observed.result)) === JSON.stringify(after),
      'Read-back differs from the approved record.');
  } else {
    requireValue(observed === null, 'Record still exists after deletion.');
  }
  return {outcome: 'executed', verified: true, id, record: after};
}

cindy.onHostMessage(async msg => {
  if (msg?.type !== 'tool-call') return;
  const state = {outcome: 'not_executed'};
  const reply = {type: 'tool-result', callId: msg.callId};
  try {
    reply.result = await run(msg, state);
    reply.ok = true;
  } catch (error) {
    reply.ok = false;
    reply.errorCode = state.outcome;
    reply.message = error instanceof DnsError ? error.message : 'Host request unavailable.';
    if (state.outcome !== 'not_executed') reply.message += ' Check current DNS state before another write.';
  }
  await cindy.send(reply);
});
