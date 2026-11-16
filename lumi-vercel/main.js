/* All remote traffic and credential injection go through Lumi's Host. */
(function () {
  'use strict';
  const host = globalThis.lumi || globalThis.cindy;
  const API = 'https://api.vercel.com';
  const tools = [];
  const str = (description, maxLength = 128) => ({ type: 'string', maxLength, description });
  const team = str('Exact team ID. Omit for the saved default; empty string explicitly selects the personal account.');
  const project = { ...str('Exact project ID or name. Required explicitly for changes.'), minLength: 1 };
  const deployment = { ...str('Deployment ID or HTTPS deployment hostname returned by Vercel.', 512), minLength: 1 };
  const limit = { type: 'integer', minimum: 1, maximum: 100, default: 20 };
  const target = { type: 'string', enum: ['production', 'preview'] };
  const timestamp = { type: 'integer', minimum: 0 };
  const pick = (o, keys) => Object.fromEntries(keys.filter(k => o && o[k] !== undefined).map(k => [k, o[k]]));
  const enc = encodeURIComponent;
  const scope = (s, p) => ({ accountScope: s ? 'team' : 'personal', teamId: s || null, ...(p ? { projectId: p.id, projectName: p.name } : {}) });
  const deploymentView = d => ({ ...pick(d, ['id', 'uid', 'projectId', 'name', 'url', 'readyState', 'state', 'target', 'createdAt', 'created', 'buildingAt', 'ready', 'errorCode']), git: pick(d.gitSource, ['type', 'ref', 'sha']), aliases: Array.isArray(d.alias) ? d.alias.filter(v => typeof v === 'string') : [] });
  const projectView = p => ({ ...pick(p, ['id', 'name', 'accountId', 'framework', 'buildCommand', 'installCommand', 'outputDirectory', 'rootDirectory', 'nodeVersion', 'createdAt', 'updatedAt']), git: pick(p.link, ['type', 'org', 'repo', 'repoId', 'projectId', 'productionBranch']), production: p.targets?.production ? deploymentView(p.targets.production) : null });
  const envView = e => pick(e, ['id', 'key', 'type', 'target', 'gitBranch', 'customEnvironmentIds', 'createdAt', 'updatedAt', 'comment']);
  const domainView = d => pick(d, ['name', 'projectId', 'apexName', 'verified', 'gitBranch', 'redirect', 'redirectStatusCode', 'verification']);
  class Failure extends Error {
    constructor(code, message, details = {}) { super(message); this.code = code; this.details = details; }
  }
  function invalid(message) { throw new Failure('INVALID_ARGS', message); }
  function redact(text, hidden = []) {
    let s = String(text || '');
    for (const value of hidden) if (value) s = s.split(value).join('[redacted]');
    return s.replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [redacted]')
      .replace(/((?:postgres(?:ql)?|mysql|redis):\/\/)[^\s"']+/gi, '$1[redacted]')
      .replace(/((?:[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|DATABASE_URL))\s*[=:]\s*)[^\s,;]+/g, '$1[redacted]');
  }
  function validate(schema, value, path = 'args') {
    const matches = t => t === 'null' ? value === null : t === 'array' ? Array.isArray(value) : t === 'object' ? !!value && typeof value === 'object' && !Array.isArray(value) : t === 'integer' ? Number.isSafeInteger(value) : typeof value === t;
    if (schema.type && !(Array.isArray(schema.type) ? schema.type : [schema.type]).some(matches)) invalid(path + ' has the wrong type.');
    if (schema.enum && !schema.enum.includes(value)) invalid(path + ' must be one of: ' + schema.enum.join(', '));
    if (typeof value === 'string' && ((schema.minLength !== undefined && value.length < schema.minLength) || (schema.maxLength !== undefined && value.length > schema.maxLength) || (schema.pattern && !new RegExp(schema.pattern).test(value)))) invalid(path + ' has an invalid length or format.');
    if (typeof value === 'number' && (!Number.isFinite(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) invalid(path + ' is outside the allowed range.');
    if (Array.isArray(value)) {
      if (value.length < (schema.minItems || 0) || value.length > (schema.maxItems || Infinity) || (schema.uniqueItems && new Set(value).size !== value.length)) invalid(path + ' has an invalid item count or duplicate items.');
      value.forEach((v, i) => validate(schema.items || {}, v, path + '[' + i + ']'));
    }
    if (value && typeof value === 'object' && !Array.isArray(value) && schema.properties) {
      if (Object.keys(value).length < (schema.minProperties || 0)) invalid(path + ' requires at least one field.');
      for (const key of schema.required || []) if (value[key] === undefined) invalid(path + '.' + key + ' is required.');
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(schema.properties, key)) { if (schema.additionalProperties === false) invalid('Unknown parameter: ' + path + '.' + key); }
        else validate(schema.properties[key], value[key], path + '.' + key);
      }
    }
  }
  async function config() {
    const r = await fetch('/kv');
    if (!r.ok) throw new Failure('SETTINGS_UNAVAILABLE', 'Could not read plugin settings. Reopen the settings and try again.');
    return r.json();
  }
  async function teamFor(a) { const c = await config(); return a.teamId !== undefined ? a.teamId : c.defaultTeamId || ''; }
  const teamLabel = s => s ? 'team ' + s : 'personal account';
  async function api(method, path, s, query, body, msg, hidden) {
    if (typeof host.fetch !== 'function') throw new Failure('HOST_UNSUPPORTED', 'This host does not support managed HTTP requests. Update the app before using Vercel.');
    const url = new URL(API + path), writing = method !== 'GET';
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    if (s) url.searchParams.set('teamId', s);
    let r;
    if (writing && msg) msg.execution = 'unknown';
    try { r = await host.fetch({ url: url.href, method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), timeoutMs: 30000, ...(msg?.callId ? { callId: msg.callId } : {}) }); }
    catch { throw new Failure(writing ? 'OUTCOME_UNKNOWN' : 'NETWORK_FAILED', writing ? 'The request may have completed. Check the target in Vercel before retrying.' : 'Could not reach Vercel. Check the connection and try again.', { outcomeKnown: !writing }); }
    if (!r.ok) throw new Failure(writing ? 'OUTCOME_UNKNOWN' : 'HOST_REQUEST_FAILED', writing ? 'The request may have completed. Check plugin connection settings and the target in Vercel before retrying.' : redact(r.message || 'Check the Vercel connection in plugin settings.', hidden), { hostErrorCode: r.errorCode, outcomeKnown: !writing });
    if (r.truncated) throw new Failure(writing ? 'OUTCOME_UNKNOWN' : 'RESPONSE_TOO_LARGE', 'The response was incomplete. Check the target; use a smaller page for reads.', { outcomeKnown: !writing });
    let data;
    try { data = r.body ? JSON.parse(r.body) : {}; }
    catch { throw new Failure(writing ? 'OUTCOME_UNKNOWN' : 'INVALID_RESPONSE', 'Unexpected Vercel response. Check the target before retrying a change.', { outcomeKnown: !writing }); }
    if (r.status < 200 || r.status >= 300) {
      if (writing && msg && r.status >= 400 && r.status < 500) msg.execution = 'not_executed';
      const hint = r.status === 401 ? 'Reconnect with a valid token in plugin settings.' : r.status === 403 ? 'Check token permissions and the selected team.' : r.status === 404 ? 'Check the project, deployment and team IDs.' : r.status === 429 ? 'Wait before trying again.' : writing && (r.status < 400 || r.status >= 500) ? 'The change may have completed. Check the target before retrying.' : 'Check the parameters and try again.';
      // Never echo an upstream body: error messages can repeat submitted environment values.
      throw new Failure(writing && (r.status < 400 || r.status >= 500) ? 'OUTCOME_UNKNOWN' : 'VERCEL_API_ERROR', 'Vercel returned HTTP ' + r.status + '. ' + hint, { status: r.status, outcomeKnown: !(writing && (r.status < 400 || r.status >= 500)) });
    }
    if (writing && msg) msg.execution = 'executed';
    return data;
  }
  async function resolveProject(a, msg, s) {
    const name = a.project || (await config()).defaultProject;
    if (!name) invalid('Specify project or save a default project in plugin settings.');
    return api('GET', '/v9/projects/' + enc(name), s, {}, null, msg);
  }
  async function approve(body, danger = false) {
    if (typeof host.confirm !== 'function') throw new Failure('HOST_UNSUPPORTED', 'Native confirmation is unavailable. Update the app before making changes.');
    if (body.length > 300) invalid('The change summary is too long. Use shorter identifiers.');
    const r = await host.confirm({ body, confirmText: 'Continue', cancelText: 'Cancel', danger });
    if (!r.ok) throw new Failure('CONFIRM_UNAVAILABLE', 'Confirmation could not be displayed. Reopen Lumi and try again.');
    if (!r.confirmed) throw new Failure('CANCELLED', 'Cancelled. No change was sent to Vercel.', { executed: false });
  }
  function deploymentId(value) {
    if (value.startsWith('https://')) {
      const u = new URL(value);
      if (u.username || u.password || u.port || u.search || u.hash || u.pathname !== '/') invalid('Use the deployment ID or HTTPS hostname without a path, query or credentials.');
      return u.hostname;
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(value)) invalid('Use the deployment ID or hostname.');
    return value;
  }
  async function resolvedDeployment(a, msg, s) {
    const p = await resolveProject(a, msg, s), d = await api('GET', '/v13/deployments/' + enc(deploymentId(a.deployment)), s, { withGitRepoInfo: 'true' }, null, msg);
    if (d.projectId !== p.id) throw new Failure('PROJECT_MISMATCH', 'This deployment belongs to another project. Specify its actual project.');
    return { p, d };
  }
  function define(name, description, properties, required, run) {
    tools.push({ name, description, parameters: { type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) }, run });
  }
  define('connection_status', 'Check the Vercel identity and saved defaults. Credentials are never returned.', {}, [], async (a, msg) => {
    const c = await config(), d = await api('GET', '/v2/user', '', {}, null, msg);
    return { user: pick(d.user, ['id', 'username', 'name', 'email']), defaults: pick(c, ['defaultTeamId', 'defaultProject']) };
  });
  define('list_teams', 'List accessible teams and pagination. Select the exact returned team ID.', { limit, until: timestamp }, [], async (a, msg) => {
    const d = await api('GET', '/v2/teams', '', { limit: a.limit || 20, until: a.until }, null, msg);
    return { teams: (d.teams || []).map(t => pick(t, ['id', 'name', 'slug'])), pagination: d.pagination };
  });
  define('list_projects', 'List a bounded page of real projects in one account scope, with pagination.', { teamId: team, search: str('Project search text.'), limit, from: str('Pagination cursor from Vercel.') }, [], async (a, msg) => {
    const s = await teamFor(a), d = await api('GET', '/v10/projects', s, { search: a.search, limit: a.limit || 20, from: a.from }, null, msg);
    return { scope: scope(s), projects: (d.projects || []).map(projectView), pagination: d.pagination };
  });
  define('get_project', 'Inspect build settings, Git link and the active production deployment. Environment values are omitted.', { teamId: team, project }, [], async (a, msg) => {
    const s = await teamFor(a), p = await resolveProject(a, msg, s); return { scope: scope(s, p), project: projectView(p) };
  });
  define('create_project', 'Create a project after native confirmation. Does not deploy or purchase a domain.', { teamId: team, name: { ...str('New project name.', 100), pattern: '^[a-z0-9][a-z0-9._-]*$' } }, ['name'], async (a, msg) => {
    const s = await teamFor(a); await approve('Create project ' + a.name + ' in ' + teamLabel(s) + '?');
    const p = await api('POST', '/v11/projects', s, {}, { name: a.name }, msg); return { scope: scope(s, p), project: projectView(p) };
  });
  define('update_project', 'Update only supplied build settings after native confirmation. Null restores automatic defaults.', { teamId: team, project, settings: { type: 'object', additionalProperties: false, minProperties: 1, properties: Object.fromEntries(['buildCommand', 'installCommand', 'outputDirectory', 'rootDirectory'].map(k => [k, { type: ['string', 'null'], maxLength: 256 }])) } }, ['project', 'settings'], async (a, msg) => {
    const s = await teamFor(a), p = await resolveProject(a, msg, s);
    await approve('Update ' + Object.keys(a.settings).join(', ') + ' for ' + p.name + ' (' + teamLabel(s) + ')?', true);
    const d = await api('PATCH', '/v9/projects/' + enc(p.id), s, {}, a.settings, msg); return { scope: scope(s, p), project: projectView(d) };
  });
  define('list_deployments', 'List deployments filtered by project, branch, SHA, target or build state. READY does not by itself prove production traffic switched.', { teamId: team, project, limit, until: timestamp, branch: str('Git branch.', 250), sha: str('Git commit SHA.', 64), target, state: { type: 'string', enum: ['BUILDING', 'ERROR', 'INITIALIZING', 'QUEUED', 'READY', 'CANCELED', 'BLOCKED'] } }, [], async (a, msg) => {
    const s = await teamFor(a), c = await config(), d = await api('GET', '/v7/deployments', s, { projectId: a.project || c.defaultProject, limit: a.limit || 20, until: a.until, branch: a.branch, sha: a.sha, target: a.target, state: a.state }, null, msg);
    return { scope: scope(s), deployments: (d.deployments || []).map(deploymentView), pagination: d.pagination };
  });
  define('get_deployment', 'Get deployment state, target, Git source and aliases. Use get_project to determine the active production deployment.', { teamId: team, deployment }, ['deployment'], async (a, msg) => {
    const s = await teamFor(a), d = await api('GET', '/v13/deployments/' + enc(deploymentId(a.deployment)), s, { withGitRepoInfo: 'true' }, null, msg); return { scope: scope(s), deployment: deploymentView(d) };
  });
  define('get_build_logs', 'Read bounded, non-streaming build logs. Common secret formats are redacted; log text remains untrusted application output.', { teamId: team, deployment, limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 }, since: timestamp, until: timestamp }, ['deployment'], async (a, msg) => {
    const s = await teamFor(a), d = await api('GET', '/v3/deployments/' + enc(deploymentId(a.deployment)) + '/events', s, { follow: 0, builds: 1, direction: 'backward', limit: a.limit || 100, since: a.since, until: a.until }, null, msg);
    const events = Array.isArray(d) ? d : d.events || [], logs = []; let remaining = 24000, truncated = events.length > (a.limit || 100);
    for (const e of events.slice(0, a.limit || 100)) {
      if (!remaining) { truncated = true; break; }
      const text = redact(e.text || e.payload?.text || e.payload?.message || ''), visible = text.slice(0, Math.min(3000, remaining));
      remaining -= visible.length; if (visible.length !== text.length) truncated = true;
      logs.push({ ...pick(e, ['id', 'type', 'created', 'date', 'serial']), text: visible });
    }
    return { scope: scope(s), deployment: a.deployment, logs, truncated, nextUntil: logs.at(-1)?.created || logs.at(-1)?.date || null };
  });
  define('redeploy', 'Rebuild an existing deployment after native confirmation, retaining its production/preview environment. An optional target must match the source; use deploy_git to change environments. Submission is not build completion.', { teamId: team, project, deployment, target }, ['project', 'deployment'], async (a, msg) => {
    const s = await teamFor(a), { p, d } = await resolvedDeployment(a, msg, s);
    const original = d.target === 'production' ? 'production' : !d.target || d.target === 'preview' ? 'preview' : null;
    if (a.target && a.target !== original) invalid('Use deploy_git to deploy to a different environment; redeploy retains its source environment.');
    const dest = original;
    if (!dest) invalid('Custom environments require Vercel directly, or an explicit production/preview target.');
    await approve('Redeploy ' + p.name + ' to ' + dest + ' (' + teamLabel(s) + '), source ' + d.id + '?', dest === 'production');
    const next = await api('POST', '/v13/deployments', s, { forceNew: '1' }, { name: p.name, project: p.id, deploymentId: d.id, ...(dest === 'production' ? { target: 'production' } : {}) }, msg);
    return { scope: scope(s, p), submitted: true, completed: false, deployment: deploymentView(next) };
  });
  define('deploy_git', 'Deploy an explicit branch of an existing GitHub/GitLab project link after confirmation, using Vercel’s Git access.', { teamId: team, project, branch: { ...str('Exact Git branch.', 250), minLength: 1 }, target }, ['project', 'branch', 'target'], async (a, msg) => {
    const s = await teamFor(a), p = await resolveProject(a, msg, s), l = p.link || {}; let gitSource;
    if (l.type === 'github' && l.repoId !== undefined) gitSource = { type: 'github', repoId: l.repoId, ref: a.branch };
    else if (l.type === 'gitlab' && l.projectId !== undefined) gitSource = { type: 'gitlab', projectId: l.projectId, ref: a.branch };
    else throw new Failure('GIT_LINK_UNSUPPORTED', 'Link a GitHub or GitLab repository in Vercel before deploying with this tool.');
    await approve('Deploy branch ' + a.branch + ' of ' + p.name + ' to ' + a.target + ' (' + teamLabel(s) + ')?', a.target === 'production');
    const d = await api('POST', '/v13/deployments', s, {}, { name: p.name, project: p.id, gitSource, ...(a.target === 'production' ? { target: 'production' } : {}) }, msg);
    return { scope: scope(s, p), submitted: true, completed: false, deployment: deploymentView(d) };
  });
  define('cancel_deployment', 'Cancel a queued/building deployment after native confirmation. Completed deployments are left alone.', { teamId: team, project, deployment }, ['project', 'deployment'], async (a, msg) => {
    const s = await teamFor(a), { p, d } = await resolvedDeployment(a, msg, s);
    if (!['QUEUED', 'INITIALIZING', 'BUILDING'].includes(d.readyState || d.state)) throw new Failure('NOT_CANCELABLE', 'The deployment is no longer queued or building. Check its current state.');
    await approve('Cancel deployment ' + d.id + ' of ' + p.name + ' (' + teamLabel(s) + ')?', true);
    const result = await api('PATCH', '/v12/deployments/' + enc(d.id) + '/cancel', s, {}, null, msg); return { scope: scope(s, p), deployment: deploymentView(result) };
  });
  define('manage_env', 'List metadata, upsert or delete one environment variable. Values are never returned. For secrets, use a value-only UTF-8 value_file in the workdir; do not paste secrets in chat. Mutations require explicit project and native confirmation.', {
    teamId: team, project, action: { type: 'string', enum: ['list', 'upsert', 'delete'] },
    key: { ...str('Variable name.', 256), pattern: '^[A-Za-z_][A-Za-z0-9_]*$' }, envId: str('Exact variable ID returned by list.'),
    target: { type: 'array', minItems: 1, maxItems: 3, uniqueItems: true, items: { type: 'string', enum: ['production', 'preview', 'development'] } },
    type: { type: 'string', enum: ['plain', 'encrypted', 'sensitive'] }, value: str('Public plain values only; use value_file for secrets.', 64000),
    value_file: { ...str('Non-hidden relative workdir path to a UTF-8 value-only file. Bytes go straight to Vercel, never back to the model.', 512), minLength: 1 }, gitBranch: str('Preview-only Git branch.', 250)
  }, ['action'], async (a, msg) => {
    if (a.action !== 'list' && !a.project) invalid('Mutations require an explicit project.');
    if (a.action === 'list' && ['key', 'envId', 'target', 'type', 'value', 'value_file'].some(k => a[k] !== undefined)) invalid('List accepts only project, teamId and gitBranch.');
    if (a.action === 'upsert') {
      if (!a.key || !a.target || !a.type) invalid('Upsert requires key, target and type.');
      if (a.envId !== undefined || (a.value === undefined) === (a.value_file === undefined)) invalid('Upsert accepts exactly one of value and value_file, and no envId.');
      if (a.type !== 'plain' && a.value !== undefined) invalid('Use value_file for encrypted or sensitive variables.');
      if (a.gitBranch && (a.target.length !== 1 || a.target[0] !== 'preview')) invalid('gitBranch requires preview-only target.');
      if (a.type === 'sensitive' && a.target.includes('development')) invalid('Sensitive variables cannot target development.');
    }
    if (a.action === 'delete' && (!a.envId || ['key', 'target', 'type', 'value', 'value_file', 'gitBranch'].some(k => a[k] !== undefined))) invalid('Delete requires envId and accepts only project and teamId alongside it.');
    if (a.value_file !== undefined) {
      const parts = a.value_file.split('/');
      if (parts.length > 16 || parts.some(p => !/^[A-Za-z0-9_][A-Za-z0-9_. -]*$/.test(p) || p.endsWith('.'))) invalid('value_file must be a non-hidden relative workdir path without traversal.');
    }
    const s = await teamFor(a), p = await resolveProject(a, msg, s), path = '/v10/projects/' + enc(p.id) + '/env';
    if (a.action === 'list') { const d = await api('GET', path, s, { decrypt: 'false', gitBranch: a.gitBranch }, null, msg); return { scope: scope(s, p), envs: (d.envs || []).map(envView) }; }
    if (a.action === 'delete') {
      const d = await api('GET', path, s, { decrypt: 'false' }, null, msg), e = (d.envs || []).find(v => v.id === a.envId);
      if (!e) throw new Failure('ENV_NOT_FOUND', 'Variable not found in this project. List its variables again.');
      await approve('Delete ' + e.key + ' (' + (e.target || []).join(', ') + ') from ' + p.name + ' (' + teamLabel(s) + ')?', true);
      await api('DELETE', '/v9/projects/' + enc(p.id) + '/env/' + enc(e.id), s, {}, null, msg); return { scope: scope(s, p), deleted: envView(e), redeployRequired: true };
    }
    await approve('Set ' + a.key + ' on ' + p.name + ' for ' + a.target.join(', ') + ' (' + teamLabel(s) + ')? Value stays hidden.', true);
    let value = a.value;
    if (a.value_file !== undefined) {
      if (typeof host.fs !== 'function') throw new Failure('HOST_UNSUPPORTED', 'Workdir file access is unavailable. Update the app, or manage this value directly in Vercel.');
      const r = await host.fs({ op: 'read', root: 'workdir', path: a.value_file, callId: msg.callId });
      if (!r.ok) throw new Failure('VALUE_FILE_UNAVAILABLE', 'Could not read the value file. Check its workdir path and access permissions.');
      value = r.content;
      if (typeof value !== 'string' || value.length > 64000) invalid('Value file must be UTF-8 text of at most 64,000 characters.');
    }
    try {
      const d = await api('POST', path, s, { upsert: 'true' }, { key: a.key, value, type: a.type, target: a.target, ...(a.gitBranch ? { gitBranch: a.gitBranch } : {}) }, msg, [value]);
      const envs = Array.isArray(d) ? d : Array.isArray(d.created) ? d.created : Array.isArray(d.envs) ? d.envs : d.key ? [d] : [];
      if (Array.isArray(d.failed) && d.failed.length) throw new Failure('ENV_UPDATE_REJECTED', 'Vercel rejected the variable update. Check its name, type and targets, then list the project variables.');
      if (!envs.some(e => e.key === a.key)) throw new Failure('OUTCOME_UNKNOWN', 'Vercel returned no matching variable receipt. List the project variables before retrying.', { outcomeKnown: false });
      return { scope: scope(s, p), key: a.key, target: a.target, envs: envs.map(envView), redeployRequired: true };
    } finally { value = undefined; }
  });
  function domainName(name) {
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/i.test(name)) invalid('Use a hostname without a scheme, path or wildcard.');
    return name.toLowerCase();
  }
  define('manage_domains', 'List domains, attach an existing domain, or detach one after native confirmation. Does not buy/register domains or change DNS. Detaching can interrupt traffic.', { teamId: team, project, action: { type: 'string', enum: ['list', 'add', 'remove'] }, domain: str('Exact hostname without scheme or path.', 253), gitBranch: str('Optional Git branch for add.', 250), limit, until: timestamp }, ['action'], async (a, msg) => {
    if (a.action !== 'list' && (!a.project || !a.domain)) invalid('Changes require explicit project and domain.');
    if (a.action === 'list' && (a.domain !== undefined || a.gitBranch !== undefined)) invalid('List accepts project, teamId, limit and until.');
    if (a.action !== 'list' && (a.limit !== undefined || a.until !== undefined)) invalid('limit and until apply only to list.');
    if (a.action === 'remove' && a.gitBranch !== undefined) invalid('gitBranch applies only to add.');
    const name = a.domain === undefined ? null : domainName(a.domain), s = await teamFor(a), p = await resolveProject(a, msg, s);
    if (a.action === 'list') { const d = await api('GET', '/v9/projects/' + enc(p.id) + '/domains', s, { limit: a.limit || 20, until: a.until }, null, msg); return { scope: scope(s, p), domains: (d.domains || []).map(domainView), pagination: d.pagination }; }
    if (a.action === 'add') {
      await approve('Attach ' + name + ' to ' + p.name + ' (' + teamLabel(s) + ')?');
      const d = await api('POST', '/v10/projects/' + enc(p.id) + '/domains', s, {}, { name, ...(a.gitBranch ? { gitBranch: a.gitBranch } : {}) }, msg); return { scope: scope(s, p), domain: domainView(d) };
    }
    const d = await api('GET', '/v9/projects/' + enc(p.id) + '/domains/' + enc(name), s, {}, null, msg);
    await approve('Detach ' + name + ' from ' + p.name + ' (' + teamLabel(s) + ')? Traffic to this domain may stop.', true);
    await api('DELETE', '/v9/projects/' + enc(p.id) + '/domains/' + enc(name), s, {}, { removeRedirects: false }, msg); return { scope: scope(s, p), removed: domainView(d) };
  });
  async function execute(name, args, msg) {
    const tool = tools.find(t => t.name === name);
    if (!tool) throw new Failure('UNKNOWN_TOOL', 'Use a declared Vercel tool.', { tools: tools.map(t => t.name), execution: 'not_executed', outcomeKnown: true });
    const context = { ...(msg || {}), execution: 'not_executed' };
    try { validate(tool.parameters, args); return await tool.run(args, context); }
    catch (error) {
      const execution = error.details?.outcomeKnown === false ? 'unknown' : context.execution;
      const e = error instanceof Failure ? error : new Failure('PLUGIN_ERROR', execution === 'not_executed'
        ? 'No change was sent. Check the parameters and plugin settings before trying again.'
        : 'The request may have completed. Check the target in Vercel before retrying.');
      e.details = { ...(e.details || {}), execution, outcomeKnown: execution !== 'unknown', ...(e.code === 'INVALID_ARGS' ? { parameters: tool.parameters } : {}) };
      throw e;
    }
  }
  host.onHostMessage(async msg => {
    if (msg.type === 'host-context-changed') { channel.postMessage({ type: 'host-context-changed' }); return; }
    if (msg.type !== 'tool-call') return;
    try { await host.send({ type: 'tool-result', callId: msg.callId, ok: true, result: await execute(msg.tool, msg.args || {}, msg) }); }
    catch (e) { await host.send({ type: 'tool-result', callId: msg.callId, ok: false, errorCode: e.code || 'PLUGIN_ERROR', message: e instanceof Failure ? e.message : 'The operation could not finish. Check the target in Vercel before retrying a change.', result: e.details || {} }); }
  });
  // This channel carries connection status only, never credentials or environment values.
  const channel = new BroadcastChannel('lumi-vercel-settings');
  channel.onmessage = async event => {
    const m = event.data;
    if (!m || typeof m.id !== 'string') return;
    if (m.type === 'ping') { channel.postMessage({ type: 'pong', id: m.id }); return; }
    if (m.type !== 'connection-check') return;
    try { const r = await execute('connection_status', {}, null); channel.postMessage({ type: 'connection-result', id: m.id, ok: true, user: r.user }); }
    catch (e) { channel.postMessage({ type: 'connection-result', id: m.id, ok: false, message: e instanceof Failure ? e.message : 'Could not check the connection. Check plugin settings and try again.' }); }
  };
})();
