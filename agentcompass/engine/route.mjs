// The built-in AgentCompass router for Cindy: profiles the task, applies the split and self gates, and scores every
// route the user's Cindy can actually run (its live `tasks.models()` catalog) with the AgentCompass allocator, adjusted by
// the Codex CLI's own rate-limit telemetry. No network, no credentials, no third-party modules.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {rankCandidates} from './allocator.mjs';
import {inferTaskProfile} from './profiler.mjs';
import {resolveModelSpec} from './catalog.mjs';

export const HARNESS = {cc: 'claude', codex: 'codex', pi: 'pi'};
const MODE = {claude: 'bypassPermissions', codex: 'full-access', pi: 'full-access'};
// AgentCompass harness order: Pi first for read-and-report work, the native coding CLI otherwise.
const PI_FIRST = new Set(['exploration_analysis', 'research_packet', 'web_research', 'text_in_text_out']);
// Models the shared catalog does not name, mapped to the closest profile (never to a stronger one).
const LOCAL_ALIASES = [[/spark/i, 'gpt-6-luna']];

// ---- gates ---------------------------------------------------------------------------------------------------------
const ITEM = /^\s{0,3}(?:\d{1,2}[.)、]|[(（]\d{1,2}[)）]|[一二三四五六七八九十]{1,3}[、.]|[-*•])\s+\S/;
const HEADING = /^\s{0,3}(?:#{1,4}\s*)?(?:task|deliverable|任务|交付物|子任务)\s*(?:#?\s*\d{1,2}|[一二三四五六七八九十]{1,3}|[A-Z])\s*[:：.)、]/i;
const INDEPENDENT = /\bindependent(?:ly)?\b|\bseparate(?:ly)?\b|\bunrelated\b|\bin parallel\b|\bparallel\b|互不(?:相关|依赖|影响)|相互独立|各自独立|彼此独立|独立(?:的)?(?:任务|交付|模块|子任务)|分别(?:完成|交付|实现)|并行|不相关/i;
const SEQUENTIAL = /\bstep\s*\d|\bsteps\b|\bthen\b|\bafterwards\b|\bin order\b|\bfirst\b.*\bthen\b|步骤|第\s*[一二三四五六七八九十\d]+\s*步|然后|接着|依次|按顺序|基于上一步|之后再/i;

// Several independent deliverables in one assignment: the parent splits them, one worker per task.
export function splitGate(task) {
  const lines = task.split(/\r?\n/);
  const headings = lines.filter(line => HEADING.test(line)).length;
  const items = lines.filter(line => ITEM.test(line)).length;
  const independent = INDEPENDENT.test(task), sequential = SEQUENTIAL.test(task);
  let count = 0, reason = '';
  if (headings >= 2 && !sequential) {count = headings; reason = `${headings} task or deliverable headings`;}
  else if (items >= 2 && independent && !sequential) {count = items; reason = `${items} listed items marked as independent`;}
  if (count < 2) return null;
  return {task_count: count > 3 ? '>3' : String(count), reason};
}

const SELF = /\b(?:answer|reply|respond)\s+(?:it\s+)?(?:directly|here|in this (?:session|chat|conversation))\b|\bdo(?:n't| not)\s+(?:delegate|dispatch|start a (?:task|worker))\b|\bno (?:worker|sub-?task|delegation)\b|直接(?:回答|答复|回复|告诉我)|不要(?:派发|委派|开(?:子)?任务|启动(?:子)?任务)|无需(?:派发|委派)|在(?:当前|本)会话(?:里|中|内)?(?:直接)?(?:回答|完成)/i;
const QUESTION = /^(?:what|why|how|when|where|which|who|is|are|does|do|can|should|explain|define)\b|^(?:什么|为什么|为何|怎么|如何|是否|哪个|哪些|解释|请问)|[?？]\s*$/i;
const WORK = /\b(?:implement|fix|refactor|write|create|build|add|remove|delete|update|edit|change|migrate|run|test|deploy|install|commit|generate|rename)\b|实现|修复|重构|编写|写(?:一个|入)?|创建|新增|添加|删除|修改|更新|迁移|运行|测试|部署|安装|提交|生成|重命名|[\w.-]+\.(?:py|js|ts|mjs|cjs|go|rs|java|json|md|toml|yaml|yml)\b/i;

// Work the current session should do itself: an explicit request not to delegate, or a short pure question.
export function selfGate(task) {
  const text = task.trim();
  if (SELF.test(text)) return {reason: 'the assignment asks to be answered in the current session'};
  if (text.length <= 240 && !text.includes('\n') && QUESTION.test(text) && !WORK.test(text))
    return {reason: 'a short question with no work to delegate'};
  return null;
}

const FAST = /\bfast mode\b|\buse fast\b|\burgent(?:ly)?\b|\basap\b|\bas soon as possible\b|快速模式|加急|紧急|尽快|越快越好/i;

// ---- quota: the newest rate-limit snapshot the Codex CLI wrote into its own session logs --------------------------
// Cindy runs Codex with its own CODEX_HOME (<app data>/CindyGlobal/codex-home), which the plugin process does not inherit.
export function codexHomes(env = process.env, home = os.homedir()) {
  if (env.CODEX_HOME) return [env.CODEX_HOME];
  const appData = process.platform === 'win32' ? env.APPDATA || path.join(home, 'AppData', 'Roaming')
    : process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support')
    : env.XDG_CONFIG_HOME || path.join(home, '.config');
  return [path.join(home, '.codex'), ...['CindyGlobal', 'Cindy'].map(product => path.join(appData, product, 'codex-home'))];
}

const QUOTA_TAIL_BYTES = 256 * 1024;
let quotaCache = {key: '', limits: null};

function newestSession(home) {
  let newest = null;
  try {
    // sessions/YYYY/MM/DD/rollout-*.jsonl: walk the newest days only.
    const desc = dir => fs.readdirSync(dir).filter(n => /^\d+$/.test(n)).sort().reverse().map(n => path.join(dir, n));
    outer: for (const year of desc(path.join(home, 'sessions'))) for (const month of desc(year)) for (const day of desc(month)) {
      for (const name of fs.readdirSync(day).filter(n => n.endsWith('.jsonl'))) {
        const file = path.join(day, name), stat = fs.statSync(file);
        if (!newest || stat.mtimeMs > newest.mtime) newest = {file, mtime: stat.mtimeMs, size: stat.size, home};
      }
      if (newest) break outer;
    }
  } catch {}
  return newest;
}

function readTail(file, size, maxBytes = QUOTA_TAIL_BYTES) {
  const fd = fs.openSync(file, 'r');
  try {
    const length = Math.min(size, maxBytes);
    const offset = Math.max(0, size - length);
    const buf = Buffer.allocUnsafe(length);
    const bytesRead = fs.readSync(fd, buf, 0, length, offset);
    const text = buf.subarray(0, bytesRead).toString('utf8');
    return offset > 0 ? text.slice(text.indexOf('\n') + 1) : text;
  } finally {
    fs.closeSync(fd);
  }
}

export function codexQuota(env = process.env, now = Date.now(), homes = codexHomes(env)) {
  // Prefer Cindy's managed codex-home when it has session logs so a standalone ~/.codex login does not override it.
  const cindySessions = homes.length > 1 ? homes.slice(1).map(newestSession).filter(Boolean).sort((a, b) => b.mtime - a.mtime) : [];
  const newest = cindySessions[0] || homes.map(newestSession).filter(Boolean).sort((a, b) => b.mtime - a.mtime)[0];
  if (!newest) return {source: 'codex-cli-sessions', status: 'unknown', reason: 'no Codex session log'};
  const cacheKey = `${newest.file}:${newest.mtime}:${newest.size}`;
  let limits = quotaCache.key === cacheKey ? quotaCache.limits : undefined;
  if (limits === undefined) {
    let text = '';
    try {
      text = readTail(newest.file, newest.size);
    } catch {
      return {source: 'codex-cli-sessions', status: 'unknown', reason: 'unreadable Codex session log', file: newest.file};
    }
    const at = text.lastIndexOf('"rate_limits"');
    limits = null;
    if (at >= 0) {
      const line = text.slice(text.lastIndexOf('\n', at) + 1, (text.indexOf('\n', at) + 1 || text.length + 1) - 1);
      try {
        const row = JSON.parse(line);
        limits = row.payload?.rate_limits || row.rate_limits || row.msg?.rate_limits || null;
      } catch {}
    }
    quotaCache = {key: cacheKey, limits};
  }
  if (!limits) return {source: 'codex-cli-sessions', status: 'unknown', reason: 'no rate-limit snapshot in the newest session'};
  const windows = ['primary', 'secondary'].map(k => limits?.[k]).filter(w => w && Number.isFinite(w.used_percent))
    // A window that has already reset says nothing about now.
    .filter(w => !w.resets_at || w.resets_at * 1000 > now);
  if (!windows.length) return {source: 'codex-cli-sessions', status: 'unknown', reason: 'snapshot windows have reset', file: newest.file};
  const used = Math.max(...windows.map(w => w.used_percent));
  return {source: 'codex-cli-sessions', status: used >= 95 ? 'exhausted' : used >= 80 ? 'high' : 'ok', used_percent: used,
    observed_at: new Date(newest.mtime).toISOString(), plan: limits.plan_type || null, file: newest.file};
}

// ---- routing -------------------------------------------------------------------------------------------------------
function canonicalOf(model) {
  for (const [pattern, name] of LOCAL_ALIASES) if (pattern.test(model)) return name;
  return resolveModelSpec(model).canonical;
}

/**
 * task: the assignment, unchanged. catalog: Cindy's `tasks.models()` reply. Returns the router answer:
 *   {status:'split'|'self', ...}  the parent's job; nothing is started
 *   {status:'native', route:{bundle}, decision}  one exact catalog row, effort and fast mode
 *   {status:'blocked', error}  nothing in the catalog can run it
 */
export function routeTask(task, catalog, {env = process.env, now = Date.now(), quota = null} = {}) {
  const split = splitGate(task);
  const profile = inferTaskProfile({objective: task});
  if (split) return {status: 'split', engine: 'builtin', task_count: split.task_count, reason: split.reason,
    profile: {...profile, multi_task: true, task_count: split.task_count},
    next_action: 'This assignment holds several independent deliverables. Split it and roll each task separately; nothing was started.'};
  const self = selfGate(task);
  if (self) return {status: 'self', engine: 'builtin', reason: self.reason, profile,
    next_action: 'Do this in the current session; no Cindy task was started.'};

  const rows = (catalog?.models || []).filter(row => HARNESS[row?.route?.agentKind] && row.route.providerId && row.route.model);
  if (!rows.length) return {status: 'blocked', engine: 'builtin',
    error: 'Cindy reports no Claude, Codex or Pi model. Sign in to one in Cindy, then roll again; nothing was started.'};
  // Connections the Codex CLI's telemetry describes: only an explicitly matched providerId, or the sole Codex connection.
  const codexProviders = new Set(rows.filter(r => r.route.agentKind === 'codex').map(r => r.route.providerId));
  const codex = quota || (codexProviders.size === 1 ? codexQuota(env, now)
    : {source: 'codex-cli-sessions', status: 'unknown', reason: codexProviders.size ? 'multiple Codex connections' : 'no Codex connection in catalog'});
  const matchesCodex = providerId => codexProviders.has(providerId) &&
    (codex.providerId ? providerId === codex.providerId : codexProviders.size === 1);
  const usage = row => matchesCodex(row.route.providerId) && codex.status !== 'unknown' ? codex : null;

  const pool = new Map();
  for (const row of rows) {
    const canonical = canonicalOf(row.route.model);
    const spec = resolveModelSpec(canonical).spec;
    const offered = (row.efforts?.length ? row.efforts : [row.route.effort]).filter(Boolean);
    const efforts = offered.filter(e => (spec.efforts || []).includes(e));
    const fallbackEffort = (spec.efforts || []).includes('high') ? 'high' : (spec.efforts || [])[0] || 'medium';
    row._canonical = canonical;
    row._emptyEffort = !offered.length;
    row._efforts = efforts.length ? efforts : offered.length ? offered.slice(0, 1) : [fallbackEffort];
    const entry = pool.get(canonical) || new Set();
    row._efforts.forEach(e => entry.add(e));
    pool.set(canonical, entry);
  }
  const ranked = rankCandidates(profile, {objective: task, candidateModels: [...pool].map(([model, efforts]) => ({model, efforts: [...efforts]}))});
  const scores = new Map(ranked.ranking.map(r => [`${r.canonicalModel}:${r.effort}`, r]));
  const kind = ranked.task.kind;
  const wantsFast = FAST.test(task);

  const candidates = [];
  for (const row of rows) {
    const harness = HARNESS[row.route.agentKind];
    const q = usage(row);
    for (const effort of row._efforts) {
      const scored = scores.get(`${row._canonical}:${effort}`);
      if (!scored) continue;
      let score = scored.score;
      const notes = [];
      if (q?.status === 'exhausted') {notes.push(`quota ${q.used_percent}% used`); score -= 1;}
      else if (q?.status === 'high') {score -= 0.1 * (q.used_percent - 80) / 15; notes.push(`quota ${q.used_percent}% used`);}
      // Same model on two harnesses: the AgentCompass harness order decides.
      if (harness === 'pi') score += PI_FIRST.has(kind) ? 0.01 : -0.01;
      const spec = resolveModelSpec(row._canonical).spec;
      const fast = wantsFast && harness === 'codex' && Boolean(row.supportsFastMode) && Boolean(spec.fast_capable) &&
        (q ? q.used_percent < 60 : false);
      const launchEffort = row._emptyEffort ? (row.route.effort ?? '') : effort;
      candidates.push({row, harness, effort: launchEffort, fast, score: Math.round(score * 10000) / 10000, components: scored.components, notes});
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) return {status: 'blocked', engine: 'builtin', profile, work_kind: kind,
    error: `No model in the Cindy catalog meets the ${ranked.task.difficulty} ${kind} floor; nothing was started.`};
  const route = best.row.route;
  const bundle = {provider: best.harness, harness: best.harness, account: route.providerId, providerId: route.providerId,
    model: route.model, effort: best.effort, fast: best.fast, modeId: MODE[best.harness]};
  return {
    status: 'native', engine: 'builtin', route: {bundle},
    decision: {work_kind: kind, difficulty: ranked.task.difficulty, required_ability: ranked.task.required_ability, profile,
      canonical_model: best.row._canonical, score: best.score, components: best.components, wants_fast: wantsFast,
      quota: codex, quota_penalized_routes: candidates.filter(c => c.notes.length).length,
      ...(best.notes.length ? {warning: `every runnable route is short of quota (${best.notes.join(', ')}); it may stop early`} : {}),
      alternatives: candidates.slice(1, 6).map(c => ({agentKind: c.row.route.agentKind, providerId: c.row.route.providerId,
        model: c.row.route.model, effort: c.effort, fast: c.fast, score: c.score, notes: c.notes}))},
  };
}
