'use strict';
// Only Cindy stdio can enqueue work or approve a new extension identity.
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const P = require('../extension/policy.js');
const manifest = require('../extension/manifest.json');
const distribution = require('../distribution.json');
const EXT_ID = crypto.createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32).replace(/[0-9a-f]/g,c => String.fromCharCode(97+parseInt(c,16)));
const PROTOCOL = 3;
const failure = (error,message,execution = 'not_executed') => ({ok:false,error,message,execution});
function createBridge(options = {}) {
  let policy = P.defaults(), pins = [];
  let server, starting, port = 0;
  const unconfirmedDispatches = new Map();
  let unconfirmedOverflow = false;
  const jobs = new Map(), clients = new Map(), waiting = new Map();
  const session = crypto.randomUUID();
  const live = c => Date.now()-c.seen < 35000;
  const connected = () => [...clients.values()].filter(c => c.trusted && live(c) && c.version === manifest.version);
  const publicClient = c => ({id:c.id,browser:c.browser,version:c.version,connected:c.trusted && live(c) && c.version === manifest.version,trusted:c.trusted,origin:c.origin,extensionId:c.extensionId});
  // An isolated embedding/test can pin its own extension identity; the stdio runtime exposes no such override.
  const primaryId = options.extensionId || EXT_ID;
  const knownIds = new Set([primaryId,...[distribution.chrome.extensionId,distribution.edge.extensionId].filter(Boolean)]);
  const approved = c => (c.origin === 'chrome-extension://'+c.extensionId && knownIds.has(c.extensionId)) || pins.some(p => p.id === c.id && p.origin === c.origin && p.extensionId === c.extensionId);
  const isHttp = value => typeof value === 'string' && /^https?:\/\//i.test(value);
  // The declared per-field limit. It is enforced after redaction, because masking a short credential
  // into REDACTED lengthens the string.
  const FIELD_VALUE_MAX = 4000;
  // Extracted field names are chosen by the caller, so every field value that is itself an http(s)
  // URL is sanitized too, not just the ones with well-known keys.
  function redactFields(record) {
    if (!record || typeof record !== 'object') return {record,dropped:false};
    let out = null, dropped = false;
    for (const [key,value] of Object.entries(record)) {
      if (!isHttp(value)) continue;
      let clean = P.redactUrl(value);
      // Redaction can lengthen the value, so the limit is checked on the redacted string; an over-long
      // value is dropped whole rather than cut.
      if (clean.length > FIELD_VALUE_MAX) { clean = null; dropped = true; }
      if (clean === value) continue;
      out = out || {...record};
      out[key] = clean;
    }
    return {record: out || record,dropped};
  }
  // Last gate before a result reaches the model: policy checks above still used the real URL, but
  // nothing leaves with live OAuth/magic-link credentials in a query or fragment. Every shape that
  // carries a URL is covered: the page URL, tab rows, content links and extracted field values.
  function redactResult(result, maxChars = 6000) {
    if (!result || typeof result !== 'object') return result;
    const out = {...result};
    if (typeof out.url === 'string') out.url = P.redactUrl(out.url);
    if (Array.isArray(out.tabs)) out.tabs = out.tabs.map(t => t && !t.redacted && typeof t.url === 'string' ? {...t,url:P.redactUrl(t.url)} : t);
    if (Array.isArray(out.links)) out.links = out.links.map(l => l && typeof l.url === 'string' ? {...l,url:P.redactUrl(l.url)} : l);
    // One budget for the entire extraction, measured after URL redaction.
    let remaining = maxChars;
    const boundRecord = entry => {
      if (!entry || typeof entry !== 'object') return entry;
      const r = redactFields(entry); const record = r.record; let truncated = r.dropped;
      const bounded = {};
      for (const [key, value] of Object.entries(record)) {
        let finalValue = value;
        if (typeof value === 'string') {
          const limit = Math.min(remaining, FIELD_VALUE_MAX);
          if (value.length > limit) {
            finalValue = isHttp(value) ? null : value.slice(0, limit);
            truncated = true;
          }
          remaining -= finalValue?.length || 0;
        }
        // Field names are caller-controlled, including "__proto__".
        Object.defineProperty(bounded, key, {value:finalValue, enumerable:true});
      }
      if (truncated) out.truncated = true;
      return bounded;
    };
    if (Array.isArray(out.records)) out.records = out.records.map(boundRecord);
    if (out.record) out.record = boundRecord(out.record);
    return out;
  }
  function finish(job,result, browserFinished = false) {
    if (!jobs.has(job.id)) return;
    clearTimeout(job.timer); jobs.delete(job.id);
    if (job.dispatchSettled && !browserFinished) {
      // History is not runnable work. Keep only bounded authorization metadata,
      // never payload text, result promises or task timers.
      if (unconfirmedDispatches.size >= 128) {
        unconfirmedDispatches.delete(unconfirmedDispatches.keys().next().value);
        unconfirmedOverflow = true; // Forgetting identity is not evidence of completion.
      }
      unconfirmedDispatches.set(job.id,{clientId:job.clientId,action:job.action,payload:{url:job.payload.url},authorizedUrl:job.authorizedUrl});
    }
    job.settleDispatch?.(browserFinished);
    const safe = redactResult(result, job.payload.maxChars || 6000);
    job.resolve({...safe,browser:job.clientId,timing:{...(safe.timing || {}),totalMs:Date.now()-job.created},...(P.READ.includes(job.action) && job.action !== 'tabs' ? {untrusted_content:true} : {})});
  }
  const jobFailure = (job,error,message) => failure(error,message,job.state === 'acknowledged' && job.action !== 'tabs' ? 'unknown' : 'not_executed');
  function take(clientId) {
    for (const job of jobs.values()) {
      if (job.state !== 'queued' || job.clientId !== clientId) continue;
      const gate = P.check(policy,job.action,job.payload.url);
      if (!gate.ok) { finish(job,gate); continue; }
      job.state = 'delivered'; // Never redeliver a lost operation.
      return {id:job.id,action:job.action,payload:job.payload};
    }
    return null;
  }
  function send(res,value,status = 200) {
    if (res.destroyed || res.writableEnded) return;
    const data = JSON.stringify(value);
    res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Length':Buffer.byteLength(data)}); res.end(data);
  }
  async function body(req) {
    const chunks = []; let bytes = 0;
    for await (const c of req) { bytes += c.length; if (bytes > 512000) throw new Error('Too large'); chunks.push(c); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  }
  async function route(req,res) {
    // Custom headers require preflight on websites. Never enable CORS, including on /health.
    const h = req.headers;
    const extensionId = h['x-my-browser-extension'];
    const origin = h['x-my-browser-origin'] || 'chrome-extension://'+extensionId;
    const id = h['x-my-browser-client'];
    if ((options.extensionId && extensionId !== primaryId) || h.host !== '127.0.0.1:'+port || req.method === 'OPTIONS' ||
        !/^[a-zA-Z0-9._-]{1,200}$/.test(extensionId || '') ||
        !/^[a-f0-9-]{36}$/.test(id || '') ||
        !(origin === 'chrome-extension://'+extensionId || /^safari-web-extension:\/\/[a-zA-Z0-9.-]+$/.test(origin)) ||
        (h.origin && h.origin !== origin)) return send(res,failure('FORBIDDEN','Only an extension origin can connect.'),403);
    let client = clients.get(id);
    if (client && (client.origin !== origin || client.extensionId !== extensionId)) return send(res,failure('IDENTITY_CHANGED','Reconnect with the correct browser profile.'),403);
    if (req.method === 'GET' && req.url === '/health') {
      for (const [key,c] of clients) if (Date.now()-c.seen > 180000 && ![...jobs.values()].some(j => j.clientId === key)) clients.delete(key);
      if (!client && clients.size >= 16) return send(res,failure('TOO_MANY_BROWSERS','Close unused browser connections.'),429);
      client = {id,origin,extensionId,browser:['chrome','edge','safari'].includes(h['x-my-browser-family']) ? h['x-my-browser-family'] : 'chrome',version:String(h['x-my-browser-version'] || '').slice(0,30),seen:Date.now()};
      client.trusted = approved(client); clients.set(id,client);
      return send(res,{ok:true,plugin:'my-browser',protocol:PROTOCOL,version:manifest.version,extensionId,clientId:id,pairing_required:!client.trusted,...(client.trusted ? {session} : {})});
    }
    if (!client?.trusted || !live(client) || client.version !== manifest.version || h['x-my-browser-session'] !== session) return send(res,failure('SESSION_CHANGED','Reconnect or approve this browser in Cindy.'),409);
    client.seen = Date.now();
    if (req.method === 'GET' && req.url === '/poll') {
      const job = take(id); if (job) return send(res,{job});
      if (waiting.has(id)) return send(res,failure('BUSY','This profile is already polling.'),429);
      const cleanup = () => { clearTimeout(timer); if (waiting.get(id) === waiter) waiting.delete(id); };
      const waiter = () => { cleanup(); send(res,{job:take(id)}); };
      const timer = setTimeout(waiter,options.pollTimeout || 20000);
      waiting.set(id,waiter); res.on('close',cleanup); return;
    }
    if (req.method !== 'POST' || !['/ack','/authorize','/result'].includes(req.url)) return send(res,failure('NOT_FOUND','Unknown endpoint.'),404);
    const b = await body(req), job = jobs.get(b.id);
    // A late completion closes uncertainty, but never revives or returns the expired result.
    if (req.url === '/result' && unconfirmedDispatches.get(b.id)?.clientId === id) {
      if (b.result && typeof b.result === 'object' && !Array.isArray(b.result) && b.result.execution !== 'unknown') unconfirmedDispatches.delete(b.id);
      return send(res,failure('JOB_EXPIRED','The operation result expired.'),409);
    }
    if (!job || job.clientId !== id || job.state !== (req.url === '/ack' ? 'delivered' : 'acknowledged')) return send(res,failure('JOB_EXPIRED','Do not execute this job.'),409);
    if (job.revoked && req.url !== '/result') return send(res,jobFailure(job,job.revoked.error,job.revoked.message),403);
    if (req.url === '/ack' || req.url === '/authorize') {
      const gate = P.check(policy,job.action,req.url === '/authorize' ? b.url : job.payload.url);
      if (!gate.ok) { const result = jobFailure(job,gate.error,gate.message); finish(job,result); return send(res,result,403); }
      if (req.url === '/ack') job.state = 'acknowledged';
      else {
        job.authorizedUrl = b.url;
        // The document is ready to run. A successful revocation must wait for this
        // dispatch to settle; cancelling its result alone does not stop the DOM.
        if (b.dispatch === true && !job.dispatchSettled) {
          job.dispatchSettled = new Promise(resolve => { job.settleDispatch = resolve; });
        }
      }
      return send(res,{ok:true,policy});
    }
    let result = job.revoked ? jobFailure(job,job.revoked.error,job.revoked.message) : b.result;
    if (!result || typeof result !== 'object' || Array.isArray(result)) result = jobFailure(job,'INVALID_RESULT','Invalid browser result. Verify before retrying.');
    if (job.action === 'tabs' && !result.error) result = {...result,ok:true,tabs:(Array.isArray(result.tabs) ? result.tabs : []).slice(0,100).map(t => P.check(policy,'text',t.url).ok ? t : {id:t.id,redacted:true})};
    else if (!result.error && result.url && !P.check(policy,job.action,result.url).ok) result = jobFailure(job,'REDIRECT_BLOCKED','No content returned from a blocked destination.');
    if (result.error && !['not_executed','executed','unknown'].includes(result.execution)) result = {...result,execution:jobFailure(job,'','').execution};
    finish(job,result,!!b.result && typeof b.result === 'object' && !Array.isArray(b.result) && b.result.execution !== 'unknown'); return send(res,{ok:true});
  }
  async function start() {
    if (server) return; if (starting) return starting;
    starting = (async () => {
      for (const candidate of options.ports || [18810,18811,18812,18813,18814,18815,18816,18817,18818,18819]) {
        const srv = http.createServer((req,res) => route(req,res).catch(() => send(res,failure('INVALID_REQUEST','Invalid bridge request.'),400)));
        srv.requestTimeout = 30000; srv.headersTimeout = 10000;
        try { await new Promise((resolve,reject) => { srv.once('error',reject); srv.listen(candidate,'127.0.0.1',resolve); }); server = srv; port = srv.address().port; return; }
        catch (e) { srv.close(); if (e.code !== 'EADDRINUSE') throw e; }
      }
      throw new Error('My Browser ports are occupied. Close stale plugin instances.');
    })();
    try { await starting; } finally { starting = null; }
  }
  async function request(method,params = {}) {
    if (method === 'setPolicy') {
      policy = P.normalizePolicy(params.policy);
      const dispatches = [];
      for (const job of [...jobs.values()]) {
        // Revocation applies to the original request as well as its redirected destination.
        // Replacing the former with the latter silently kept blocked requests alive.
        const original = P.check(policy,job.action,job.payload.url);
        const gate = original.ok && job.authorizedUrl ? P.check(policy,job.action,job.authorizedUrl) : original;
        if (!gate.ok) {
          if (job.dispatchSettled) {
            job.revoked = gate;
            dispatches.push(job.dispatchSettled);
          } else finish(job,jobFailure(job,gate.error,gate.message));
        }
      }
      const completed = await Promise.all(dispatches);
      const uncertain = [...unconfirmedDispatches.values()].some(job => !P.check(policy,job.action,job.payload.url).ok || (job.authorizedUrl && !P.check(policy,job.action,job.authorizedUrl).ok));
      if (completed.some(finished => !finished) || uncertain || unconfirmedOverflow) {
        return {...failure('REVOCATION_UNCONFIRMED','Permissions are applied, but an earlier browser action did not confirm completion. Check the page before continuing.','unknown'),applied:true};
      }
      return {ok:true,policy};
    }
    if (method === 'setTrustedClients') {
      if (!Array.isArray(params.clients) || params.clients.length > 16) throw new Error('Invalid paired browsers.');
      pins = params.clients;
      for (const c of clients.values()) c.trusted = approved(c);
      return {ok:true};
    }
    await start();
    if (method === 'status') return {ok:true,version:manifest.version,protocol:PROTOCOL,port,extension_connected:connected().length>0,extension_id:primaryId,extension_dir:path.resolve(__dirname,'../extension'),policy,pending:jobs.size,clients:[...clients.values()].filter(live).map(publicClient)};
    if (method !== 'act') return failure('UNKNOWN_METHOD','Choose a supported bridge method.');
    const payload = P.validate(params.action,params.payload || {}), gate = P.check(policy,params.action,payload.url);
    if (!gate.ok) return gate;
    const until = Date.now()+(options.connectWait ?? 6000);
    while (!connected().length && Date.now()<until) await new Promise(r => setTimeout(r,100));
    const candidates = connected();
    const client = payload.browser ? candidates.find(c => c.id === payload.browser) : candidates.length === 1 ? candidates[0] : null;
    if (!client) return {...failure(candidates.length>1 && !payload.browser ? 'BROWSER_REQUIRED' : 'EXTENSION_DISCONNECTED',candidates.length>1 ? 'Choose a browser connection id; never guess the account/profile.' : 'Open My Browser settings to install, enable or reconnect the extension.'),clients:candidates.map(publicClient)};
    if (jobs.size >= 16) return failure('BRIDGE_BUSY','Wait for browser tasks to finish.');
    return new Promise(resolve => {
      const job = {id:crypto.randomUUID(),action:params.action,payload,clientId:client.id,state:'queued',resolve,created:Date.now()};
      job.timer = setTimeout(() => finish(job,jobFailure(job,'BROWSER_TIMEOUT','Verify an unknown operation; it will not be replayed.')),options.jobTimeout || 45000);
      jobs.set(job.id,job); waiting.get(client.id)?.();
    });
  }
  async function close() {
    for (const job of [...jobs.values()]) finish(job,jobFailure(job,'BRIDGE_STOPPED','Check the page before repeating an interrupted action.'));
    for (const waiter of [...waiting.values()]) waiter();
    if (server) { const s = server; server = null; s.closeAllConnections(); await new Promise(r => s.close(r)); }
  }
  return {request,close};
}
module.exports = {createBridge,EXT_ID,PROTOCOL};
