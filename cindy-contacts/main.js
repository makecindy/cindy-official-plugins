'use strict';
/**
 * cindy-contacts 电子脑：数据层 + AI 工具 + 主视图请求通道。
 *
 * 数据放在插件 Library 的 contacts.sqlite（按账号隔离、卸载插件不删资料）。
 * 表结构沿用旧版内置通讯录（contacts / contact_identities / contact_events /
 * contact_groups / contact_group_members / contact_relations），旧数据按行原样
 * 复制，id、状态与时间戳都不变。全文索引与设备同步状态不迁移：前者用子串检索
 * 代替（中文为主的通讯录里 FTS 本来就要回落子串），后者通过插件自己的字段合并状态重新建立。
 *
 * 并发：所有读改写都排进同一条串行队列；对外入口（工具、主视图请求）各自只进一次队列，
 * 队列内部的函数互相调用时不再排队，避免自锁。
 */

const DB = 'contacts.sqlite';
const CHANNEL = 'cindy-contacts';
const BATCH_MAX = 200;

/* ───────────── 基础工具 ───────────── */

function fail(code, message, extra) {
  const e = new Error(message);
  e.code = code;
  if (extra) e.extra = extra;
  return e;
}

function uuid() {
  if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const nowIso = () => new Date().toISOString();
const today = () => nowIso().slice(0, 10);
const str = (v) => (typeof v === 'string' ? v.trim() : '');

function parseAliases(raw) {
  try {
    const a = JSON.parse(raw || '[]');
    return Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x.trim()) : [];
  } catch (_) {
    return [];
  }
}

/** 要点：[{ label, value }]，至多 12 条。 */
function parseFacts(raw) {
  try {
    const a = JSON.parse(raw || '[]');
    return Array.isArray(a) ? a.filter((f) => f && str(f.label) && str(f.value)).slice(0, 12) : [];
  } catch (_) {
    return [];
  }
}

function normalizeFacts(list) {
  const out = [];
  for (const f of Array.isArray(list) ? list : []) {
    const label = Array.isArray(f) ? str(f[0]) : str(f && f.label);
    const value = Array.isArray(f) ? str(f[1]) : str(f && f.value);
    if (label && value) out.push({ label: label.slice(0, 20), value: value.slice(0, 200) });
  }
  return out.slice(0, 12);
}

function uniqueStrings(list) {
  const seen = new Set();
  const out = [];
  for (const v of list) {
    const s = str(v);
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
  }
  return out;
}

/** platform 归一化：trim + 小写；与旧版一致校验 [a-z0-9_-]{1,32}。 */
function normalizePlatform(platform) {
  const p = str(platform).toLowerCase();
  if (!/^[a-z0-9_-]{1,32}$/.test(p)) throw fail('INVALID_PARAMS', `invalid platform: ${platform}`);
  return p;
}

/** 身份匹配键：与旧版一致（小写、去 @ 前缀；电话只留数字和 +）。 */
function normalizeIdentityValue(value, platform) {
  let v = str(value).toLowerCase();
  if (v.startsWith('@')) v = v.slice(1);
  if (platform === 'phone') {
    const c = v.replace(/[^0-9+]/g, '');
    if (c.replace(/\+/g, '').length > 0) return c;
  }
  return v;
}

function nameFacet(name) {
  const lower = str(name).toLowerCase();
  const norm = lower.replace(/[\s·.,_-]+/g, '');
  return {
    norm,
    cjk: /[㐀-鿿豈-﫿]/.test(norm),
    toks: new Set(lower.split(/[\s·.,_-]+/).filter(Boolean)),
  };
}

/** 名字相似：完全相同；含中文时短名（≥2 字）被长名包含；拉丁名按整词子集。 */
function facetsSimilar(a, b) {
  if (!a.norm || !b.norm) return false;
  if (a.norm === b.norm) return true;
  // 只差编号的名字（客户1 / 客户10、门店 A2 / A20）不是同一个人。
  const da = a.norm.replace(/\D+/g, ' ').trim();
  const db = b.norm.replace(/\D+/g, ' ').trim();
  if ((da || db) && da !== db) return false;
  if (a.cjk || b.cjk) {
    const [s, l] = a.norm.length <= b.norm.length ? [a, b] : [b, a];
    if (s.cjk) return s.norm.length >= 2 && l.norm.includes(s.norm);
  }
  const [sm, bg] = a.toks.size <= b.toks.size ? [a.toks, b.toks] : [b.toks, a.toks];
  if (sm.size === 0) return false;
  for (const t of sm) if (!bg.has(t)) return false;
  return [...sm].some((t) => t.length >= 3);
}

/* ───────────── Library 访问 ───────────── */

async function lib(req) {
  const r = await cindy.library(req);
  if (!r || r.ok === false) {
    throw fail((r && r.errorCode) || 'LIBRARY_ERROR', (r && r.message) || 'Library request failed');
  }
  return r;
}

async function q(sql, params) {
  const r = await lib({ op: 'db.exec', dbPath: DB, sql, params: params || [] });
  return r.rows || [];
}

/** 分页取全量（宿主单次结果最多 2000 行）。 */
async function qAll(sql, params) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const rows = await q(`${sql} LIMIT ? OFFSET ?`, [...(params || []), 1000, offset]);
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

/** 单批原子提交；超过 200 条的写入由调用方自行切成多个幂等批次。 */
async function batch(statements) {
  const list = statements.filter(Boolean);
  if (!list.length) return;
  if (list.length > BATCH_MAX) throw fail('INTERNAL', 'batch too large');
  await lib({ op: 'db.batch', dbPath: DB, statements: list });
}

async function batchChunks(statements) {
  for (let i = 0; i < statements.length; i += BATCH_MAX) {
    await batch(statements.slice(i, i + BATCH_MAX));
  }
}

let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

/* ───────────── 建库 ───────────── */

const SCHEMA_V1 = [
  `CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('person', 'org')),
    display_name TEXT NOT NULL,
    aliases TEXT NOT NULL DEFAULT '[]',
    summary TEXT NOT NULL DEFAULT '',
    narrative TEXT NOT NULL DEFAULT '',
    agent_notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'pending')),
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'agent', 'import')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS contact_identities (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    value TEXT NOT NULL,
    normalized_value TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE (platform, normalized_value)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_contact_identities_contact ON contact_identities(contact_id)',
  `CREATE TABLE IF NOT EXISTS contact_events (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    text TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_contact_events_contact ON contact_events(contact_id, date DESC)',
  `CREATE TABLE IF NOT EXISTS contact_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS contact_group_members (
    group_id TEXT NOT NULL REFERENCES contact_groups(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, contact_id)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_contact_group_members_contact ON contact_group_members(contact_id)',
  `CREATE TABLE IF NOT EXISTS contact_relations (
    id TEXT PRIMARY KEY,
    from_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    to_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    relation TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE (from_id, to_id, relation)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_contact_relations_from ON contact_relations(from_id)',
  'CREATE INDEX IF NOT EXISTS idx_contact_relations_to ON contact_relations(to_id)',
  `CREATE TABLE IF NOT EXISTS plugin_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];

/**
 * v2：往来（每条来自邮件/飞书/日历/对话的原始往来摘要，按来源 id 去重）、未完的事、
 * 合并记录（可拆开）、档案上的要点/最新动态/回补进度。
 */
const SCHEMA_V2 = [
  `CREATE TABLE IF NOT EXISTS contact_interactions (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    occurred_at TEXT NOT NULL,
    channel TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    quote TEXT NOT NULL DEFAULT '',
    link TEXT NOT NULL DEFAULT '',
    ref TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (contact_id, ref)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_contact_interactions_contact ON contact_interactions(contact_id, occurred_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_contact_interactions_created ON contact_interactions(created_at)',
  `CREATE TABLE IF NOT EXISTS contact_loops (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
    since TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_contact_loops_contact ON contact_loops(contact_id, status)',
  `CREATE TABLE IF NOT EXISTS contact_merges (
    id TEXT PRIMARY KEY,
    target_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    snapshot TEXT NOT NULL,
    at TEXT NOT NULL,
    undone_at TEXT NOT NULL DEFAULT ''
  )`,
  'CREATE INDEX IF NOT EXISTS idx_contact_merges_target ON contact_merges(target_id)',
  "ALTER TABLE contacts ADD COLUMN facts TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE contacts ADD COLUMN latest TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE contacts ADD COLUMN latest_at TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE contacts ADD COLUMN covered_from TEXT NOT NULL DEFAULT ''",
];

const SCHEMA_VERSION = 2;

const state = {
  ready: false,
  error: null,
  platform: null,
  importing: null, // 'legacy' | 'system' | null
  progress: null,
  legacy: null, // { status, counts?, at? }
};

let readyPromise = null;
function ensureReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const opened = await lib({ op: 'open' });
      if (opened.state && opened.state !== 'ready') {
        throw fail('LIBRARY_UNAVAILABLE', `资料库当前不可用（${opened.reason || opened.state}），请在 Cindy 设置中检查插件资料库位置。`);
      }
      await lib({ op: 'db.open', dbPath: DB });
      // 宿主每次 db.migrate 都会先做一份备份；已是最新版本时跳过，避免每次启动都多一份备份。
      let version = -1;
      try {
        version = Number((await lib({ op: 'db.userVersion', dbPath: DB })).version);
      } catch (_) {
        version = -1;
      }
      if (!(version >= SCHEMA_VERSION)) {
        await lib({
          op: 'db.migrate',
          dbPath: DB,
          targetVersion: SCHEMA_VERSION,
          steps: [
            { toVersion: 1, sql: SCHEMA_V1 },
            { toVersion: 2, sql: SCHEMA_V2 },
          ],
        });
      }
      state.ready = true;
      state.error = null;
      state.legacy = await getMeta('legacy_import');
      startLegacyImportOnce();
    })();
    readyPromise.catch((e) => {
      state.error = { code: e.code || 'INTERNAL', message: e.message };
      readyPromise = null;
    });
  }
  return readyPromise;
}

async function getMeta(key) {
  const rows = await q('SELECT value FROM plugin_meta WHERE key = ?', [key]);
  if (!rows.length) return null;
  try {
    return JSON.parse(rows[0].value);
  } catch (_) {
    return null;
  }
}

function setMetaStmt(key, value) {
  return { sql: 'REPLACE INTO plugin_meta (key, value) VALUES (?, ?)', params: [key, JSON.stringify(value)] };
}

/* ───────────── Node 工作进程 ───────────── */

async function nodeCall(method, params, opts) {
  const r = await cindy.node.request({ method, params: params || {}, timeoutMs: (opts && opts.timeoutMs) || 30000 });
  if (!r || !r.ok) {
    const message = (r && r.message) || 'Node worker request failed';
    const m = /^([A-Z_]+): /.exec(message);
    throw fail(m ? m[1] : 'NODE_FAILED', m ? message.slice(m[0].length) : message);
  }
  return r.result;
}

async function platform() {
  if (!state.platform) {
    try {
      state.platform = (await nodeCall('env/info')).platform;
    } catch (_) {
      state.platform = 'unknown';
    }
  }
  return state.platform;
}

/* ───────────── 读 ───────────── */

const LIST_SQL = `SELECT c.id, c.kind, c.display_name, c.aliases, c.summary, c.status, c.source, c.updated_at,
  c.latest, c.latest_at, length(c.narrative) AS story_len,
  (SELECT MAX(e.date) FROM contact_events e WHERE e.contact_id = c.id) AS last_event,
  (SELECT count(*) FROM contact_events e WHERE e.contact_id = c.id) AS event_count,
  (SELECT MAX(i.occurred_at) FROM contact_interactions i WHERE i.contact_id = c.id) AS last_ix,
  (SELECT MAX(i.created_at) FROM contact_interactions i WHERE i.contact_id = c.id) AS last_ingest,
  (SELECT count(*) FROM contact_interactions i WHERE i.contact_id = c.id) AS ix_count,
  (SELECT count(*) FROM contact_loops l WHERE l.contact_id = c.id AND l.status = 'open') AS open_loops,
  (SELECT group_concat(g.name, char(31)) FROM contact_group_members m JOIN contact_groups g ON g.id = m.group_id
    WHERE m.contact_id = c.id) AS group_names
  FROM contacts c ORDER BY c.display_name`;

/** 最近一次往来的时间；没有往来记录时退回事件日期和档案更新日期。 */
function lastTouched(row) {
  const ix = str(row.last_ix);
  if (ix) return ix;
  const a = str(row.last_event).slice(0, 10);
  const b = str(row.updated_at).slice(0, 10);
  return a > b ? a : b;
}

function listRow(r) {
  return {
    id: r.id,
    kind: r.kind,
    name: r.display_name,
    aliases: parseAliases(r.aliases),
    summary: r.summary,
    status: r.status,
    source: r.source,
    last: lastTouched(r),
    groups: r.group_names ? String(r.group_names).split('\u001f') : [],
    latest: r.latest || '',
    latestAt: r.latest_at || '',
    lastIngest: r.last_ingest || '',
    interactions: Number(r.ix_count) || 0,
    openLoops: Number(r.open_loops) || 0,
    // 有往来、有事件或写过像样的介绍，才算「整理过的人」；其余只有联系方式，名单里折叠。
    rich: Number(r.ix_count) > 0 || Number(r.event_count) > 0 || Number(r.story_len) > 40,
  };
}

async function listContacts() {
  return (await qAll(LIST_SQL)).map(listRow);
}

async function listGroups() {
  return q(
    `SELECT g.id, g.name, g.description, (SELECT count(*) FROM contact_group_members m WHERE m.group_id = g.id) AS members
     FROM contact_groups g ORDER BY g.name`,
  );
}

async function requireContact(id) {
  const rows = await q('SELECT * FROM contacts WHERE id = ?', [str(id)]);
  if (!rows.length) throw fail('NOT_FOUND', `contact not found: ${id}`);
  return rows[0];
}

async function getContact(id, opts) {
  const c = await requireContact(id);
  const eventLimit = (opts && opts.eventLimit) || 500;
  const ixLimit = (opts && opts.interactionLimit) || 200;
  const [identities, events, groups, relations, interactions, loops, merges] = await Promise.all([
    q('SELECT id, platform, value, label, note FROM contact_identities WHERE contact_id = ? ORDER BY created_at', [c.id]),
    q('SELECT id, date, text, source FROM contact_events WHERE contact_id = ? ORDER BY date DESC, created_at DESC LIMIT ?', [c.id, eventLimit]),
    q(
      `SELECT g.id, g.name FROM contact_group_members m JOIN contact_groups g ON g.id = m.group_id
       WHERE m.contact_id = ? ORDER BY g.name`,
      [c.id],
    ),
    q(
      `SELECT r.id, r.relation, r.note, CASE WHEN r.from_id = :id THEN 'out' ELSE 'in' END AS direction,
         o.id AS other_id, o.display_name AS other_name, o.kind AS other_kind
       FROM contact_relations r JOIN contacts o ON o.id = CASE WHEN r.from_id = :id THEN r.to_id ELSE r.from_id END
       WHERE r.from_id = :id OR r.to_id = :id ORDER BY r.created_at`,
      { id: c.id },
    ),
    q(
      `SELECT id, occurred_at, channel, title, summary, quote, link, ref, created_at FROM contact_interactions
       WHERE contact_id = ? ORDER BY occurred_at DESC LIMIT ?`,
      [c.id, ixLimit],
    ),
    q(
      `SELECT id, text, detail, status, since, source, created_at, updated_at FROM contact_loops
       WHERE contact_id = ? ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, updated_at DESC LIMIT 50`,
      [c.id],
    ),
    q(`SELECT id, source_name, reason, at FROM contact_merges WHERE target_id = ? AND undone_at = '' ORDER BY at DESC LIMIT 20`, [c.id]),
  ]);
  const [{ n: ixTotal }] = await q('SELECT count(*) AS n FROM contact_interactions WHERE contact_id = ?', [c.id]);
  return {
    id: c.id,
    kind: c.kind,
    name: c.display_name,
    aliases: parseAliases(c.aliases),
    summary: c.summary,
    narrative: c.narrative,
    agentNotes: c.agent_notes,
    status: c.status,
    source: c.source,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    facts: parseFacts(c.facts),
    latest: c.latest || '',
    latestAt: c.latest_at || '',
    coveredFrom: c.covered_from || '',
    identities,
    events,
    interactions: interactions.map((i) => ({
      id: i.id,
      at: i.occurred_at,
      channel: i.channel,
      title: i.title,
      summary: i.summary,
      quote: i.quote,
      link: i.link,
      ref: i.ref,
      addedAt: i.created_at,
    })),
    interactionTotal: Number(ixTotal) || 0,
    loops: loops.map((l) => ({ id: l.id, text: l.text, detail: l.detail, status: l.status, since: l.since, source: l.source, updatedAt: l.updated_at })),
    merges: merges.map((m) => ({ id: m.id, sourceName: m.source_name, reason: m.reason, at: m.at })),
    groups,
    relations: relations.map((r) => ({
      id: r.id,
      relation: r.relation,
      note: r.note,
      direction: r.direction,
      otherId: r.other_id,
      otherName: r.other_name,
      otherKind: r.other_kind,
    })),
  };
}

/** 任意线索找人：身份精确 → 名字/别名精确 → 子串检索。 */
async function findContacts(query, limit) {
  const raw = str(query);
  if (!raw) throw fail('INVALID_PARAMS', 'query is required');
  const max = Math.min(50, Math.max(1, Number(limit) || 10));
  const hits = new Map();
  const add = (id, matchType, matched) => {
    if (!hits.has(id)) hits.set(id, { id, matchType, matched });
  };
  const lower = raw.toLowerCase();
  const asPhone = normalizeIdentityValue(raw, 'phone');
  for (const r of await q(
    'SELECT contact_id, platform, value FROM contact_identities WHERE normalized_value = ? OR (platform = ? AND normalized_value = ?) LIMIT 50',
    [normalizeIdentityValue(raw), 'phone', asPhone],
  )) {
    add(r.contact_id, 'identity', `${r.platform}: ${r.value}`);
  }
  for (const r of await q(
    `SELECT id FROM contacts WHERE lower(display_name) = :name OR instr(lower(aliases), :alias) > 0 LIMIT 50`,
    { name: lower, alias: JSON.stringify(lower).toLowerCase() },
  )) {
    add(r.id, 'name');
  }
  // 已存的短名被线索包含（查「徐紫旎」找到「紫旎」）。只认 ≥2 字的中文名或 ≥4 字母的名字，避免 al ⊂ alan 这类误中。
  for (const r of await q(
    `SELECT id FROM contacts
     WHERE instr(:q, lower(display_name)) > 0 AND lower(display_name) <> :q
       AND ((length(display_name) >= 2 AND display_name GLOB '*[^ -~]*') OR length(display_name) >= 4)
     LIMIT 20`,
    { q: lower },
  )) {
    add(r.id, 'partial');
  }
  if (hits.size < max) {
    const rows = await q(
      `SELECT c.id,
         CASE WHEN instr(lower(c.display_name), :q) > 0 OR instr(lower(c.aliases), :q) > 0 THEN 'name'
              WHEN EXISTS (SELECT 1 FROM contact_identities i WHERE i.contact_id = c.id AND instr(i.normalized_value, :q) > 0) THEN 'identity'
              WHEN instr(lower(c.summary), :q) > 0 THEN 'summary'
              WHEN instr(lower(c.narrative), :q) > 0 OR instr(lower(c.agent_notes), :q) > 0 THEN 'story'
              ELSE 'event' END AS field
       FROM contacts c
       WHERE instr(lower(c.display_name), :q) > 0 OR instr(lower(c.aliases), :q) > 0
          OR instr(lower(c.summary), :q) > 0 OR instr(lower(c.narrative), :q) > 0 OR instr(lower(c.agent_notes), :q) > 0
          OR EXISTS (SELECT 1 FROM contact_identities i WHERE i.contact_id = c.id AND instr(i.normalized_value, :q) > 0)
          OR EXISTS (SELECT 1 FROM contact_events e WHERE e.contact_id = c.id AND instr(lower(e.text), :q) > 0)
       LIMIT :lim`,
      { q: lower, lim: max * 3 },
    );
    const order = { name: 0, identity: 1, summary: 2, story: 3, event: 4 };
    rows.sort((a, b) => order[a.field] - order[b.field]);
    // 这里都是「包含」命中（如查 ann@ 命中 joann@），只按字段排序，类型一律 text，不冒充精确命中
    for (const r of rows) add(r.id, 'text');
  }
  const ids = [...hits.keys()].slice(0, max);
  const out = [];
  for (const id of ids) {
    const c = await getContact(id, { eventLimit: 3 });
    out.push({
      id: c.id,
      name: c.name,
      kind: c.kind,
      status: c.status,
      summary: c.summary,
      aliases: c.aliases,
      matchType: hits.get(id).matchType,
      matched: hits.get(id).matched,
      identities: c.identities.map((i) => ({ platform: i.platform, value: i.value })),
      groups: c.groups.map((g) => g.name),
      agentNotes: c.agentNotes,
      recentEvents: c.events,
    });
  }
  return out;
}

async function similarNamed(name, aliases, excludeId) {
  const want = [name, ...(aliases || [])].map(nameFacet);
  // 先用分桶键在 SQL 里粗筛候选，再逐个精判；避免每次建档都扫全表。
  const terms = [...blockingKeys(want)].map((k) => k.slice(2)).filter(Boolean).slice(0, 24);
  if (!terms.length) return [];
  const where = terms.map((_, i) => `instr(lower(display_name), :t${i}) > 0 OR instr(lower(aliases), :t${i}) > 0`).join(' OR ');
  const params = Object.fromEntries(terms.map((t, i) => [`t${i}`, t]));
  const rows = await q(`SELECT id, display_name, aliases, summary, kind FROM contacts WHERE ${where} LIMIT 500`, params);
  const out = [];
  for (const r of rows) {
    if (r.id === excludeId) continue;
    const theirs = [r.display_name, ...parseAliases(r.aliases)].map(nameFacet);
    if (want.some((a) => theirs.some((b) => facetsSimilar(a, b)))) {
      out.push({ id: r.id, name: r.display_name, summary: r.summary, kind: r.kind });
    }
  }
  return out.slice(0, 10);
}

async function stats() {
  const [row] = await q(
    `SELECT
      (SELECT count(*) FROM contacts WHERE kind = 'person') AS people,
      (SELECT count(*) FROM contacts WHERE kind = 'org') AS orgs,
      (SELECT count(*) FROM contacts WHERE status = 'pending') AS pending,
      (SELECT count(*) FROM contact_groups) AS groups`,
  );
  return row;
}

/* ───────────── 写 ───────────── */

async function groupIdFor(name, statements, createdAt) {
  const n = str(name);
  if (!n) throw fail('INVALID_PARAMS', 'group name is required');
  const rows = await q('SELECT id FROM contact_groups WHERE name = ?', [n]);
  if (rows.length) return rows[0].id;
  const id = uuid();
  statements.push({
    sql: 'INSERT INTO contact_groups (id, name, description, created_at) VALUES (?, ?, ?, ?)',
    params: [id, n, '', createdAt],
  });
  return id;
}

/** 规范化并检查身份冲突；返回待插入的身份。 */
async function prepareIdentities(contactId, list, removing = new Set()) {
  const out = [];
  for (const raw of list || []) {
    if (!raw || !str(raw.value)) continue;
    const platform = normalizePlatform(raw.platform || 'other');
    const normalized = normalizeIdentityValue(raw.value, platform);
    if (!normalized) continue;
    if (out.some((o) => o.platform === platform && o.normalized === normalized)) continue;
    const owner = await q('SELECT id, contact_id FROM contact_identities WHERE platform = ? AND normalized_value = ?', [platform, normalized]);
    // 本次同时要删掉的本人旧身份（只改了大小写或格式）：先删后加，按新写法重新插入。
    if (owner.length && !(owner[0].contact_id === contactId && removing.has(owner[0].id))) {
      if (owner[0].contact_id === contactId) continue;
      throw fail('IDENTITY_CONFLICT', `${platform}:${str(raw.value)} already belongs to another contact`, {
        conflictContactId: owner[0].contact_id,
      });
    }
    out.push({ platform, value: str(raw.value), normalized, label: str(raw.label) });
  }
  return out;
}

function identityInsert(contactId, i, createdAt) {
  return {
    sql: `INSERT INTO contact_identities (id, contact_id, platform, value, normalized_value, label, note, created_at)
          VALUES (?, ?, ?, ?, ?, ?, '', ?)`,
    params: [uuid(), contactId, i.platform, i.value, i.normalized, i.label || '', createdAt],
  };
}

/**
 * 新建或更新档案。
 * - 新建：同名/相似名已存在且未传 allowDuplicate 时返回 DUPLICATE_SUSPECT 及候选。
 * - 更新：只改传入的字段；aliases / identities / groups 为追加。
 */
async function saveContact(input) {
  const createdAt = nowIso();
  const statements = [];
  const isCreate = !str(input.id);
  if (isCreate) {
    const name = str(input.name);
    if (!name) throw fail('INVALID_PARAMS', 'name is required to create a contact');
    const kind = input.kind === 'org' ? 'org' : 'person';
    const aliases = uniqueStrings(input.aliases || []);
    if (!input.allowDuplicate) {
      const similar = await similarNamed(name, aliases);
      if (similar.length) {
        throw fail('DUPLICATE_SUSPECT', 'A contact with a similar name already exists. Use get to confirm; update it by id, or pass allow_duplicate if this is a different person.', { candidates: similar });
      }
    }
    const id = uuid();
    const identities = await prepareIdentities(id, input.identities);
    const status = input.status === 'pending' ? 'pending' : 'confirmed';
    const source = ['manual', 'agent', 'import'].includes(input.source) ? input.source : 'manual';
    const latest = str(input.latest).slice(0, 120);
    statements.push({
      sql: `INSERT INTO contacts (id, kind, display_name, aliases, summary, narrative, agent_notes, status, source, created_at, updated_at, facts, latest, latest_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id, kind, name, JSON.stringify(aliases), str(input.summary), str(input.narrative), str(input.agentNotes), status, source, createdAt, createdAt,
        JSON.stringify(normalizeFacts(input.facts)), latest, latest ? createdAt : '',
      ],
    });
    for (const i of identities) statements.push(identityInsert(id, i, createdAt));
    statements.push(...loopStatements(id, input, createdAt));
    for (const g of uniqueStrings(input.groups || [])) {
      const gid = await groupIdFor(g, statements, createdAt);
      statements.push({ sql: 'INSERT OR IGNORE INTO contact_group_members (group_id, contact_id) VALUES (?, ?)', params: [gid, id] });
    }
    await batch(statements);
    return { id, created: true };
  }

  const c = await requireContact(input.id);
  const sets = [];
  const params = [];
  const setField = (col, v) => {
    sets.push(`${col} = ?`);
    params.push(v);
  };
  if (input.name !== undefined && str(input.name)) setField('display_name', str(input.name));
  if (input.kind === 'person' || input.kind === 'org') setField('kind', input.kind);
  if (input.summary !== undefined) setField('summary', str(input.summary));
  if (input.narrative !== undefined) setField('narrative', str(input.narrative));
  if (input.agentNotes !== undefined) setField('agent_notes', str(input.agentNotes));
  if (input.status === 'pending' || input.status === 'confirmed') setField('status', input.status);
  if (Array.isArray(input.facts)) setField('facts', JSON.stringify(normalizeFacts(input.facts)));
  if (typeof input.latest === 'string') {
    setField('latest', str(input.latest).slice(0, 120));
    setField('latest_at', str(input.latest) ? createdAt : '');
  }
  let aliases = parseAliases(c.aliases);
  if (Array.isArray(input.aliases)) aliases = uniqueStrings([...aliases, ...input.aliases]);
  if (Array.isArray(input.removeAliases)) {
    const drop = new Set(input.removeAliases.map((a) => str(a).toLowerCase()));
    aliases = aliases.filter((a) => !drop.has(a.toLowerCase()));
  }
  setField('aliases', JSON.stringify(aliases));
  setField('updated_at', createdAt);
  params.push(c.id);
  statements.push({ sql: `UPDATE contacts SET ${sets.join(', ')} WHERE id = ?`, params });
  const removing = new Set((input.removeIdentityIds || []).map((rid) => str(rid)).filter(Boolean));
  for (const rid of removing) {
    statements.push({ sql: 'DELETE FROM contact_identities WHERE id = ? AND contact_id = ?', params: [rid, c.id] });
  }
  for (const i of await prepareIdentities(c.id, input.identities, removing)) statements.push(identityInsert(c.id, i, createdAt));
  for (const g of uniqueStrings(input.groups || [])) {
    const gid = await groupIdFor(g, statements, createdAt);
    statements.push({ sql: 'INSERT OR IGNORE INTO contact_group_members (group_id, contact_id) VALUES (?, ?)', params: [gid, c.id] });
  }
  statements.push(...loopStatements(c.id, input, createdAt));
  await batch(statements);
  return { id: c.id, created: false };
}

/** 「还没完的事」：新增时同一句话已开着就不重复；关闭可带一句结果。 */
function loopStatements(contactId, input, at) {
  const out = [];
  for (const l of Array.isArray(input.openLoops) ? input.openLoops.slice(0, 20) : []) {
    const text = str(l && (typeof l === 'string' ? l : l.text)).slice(0, 200);
    if (!text) continue;
    const o = typeof l === 'object' && l ? l : {};
    out.push({
      sql: `INSERT INTO contact_loops (id, contact_id, text, detail, status, since, source, created_at, updated_at)
            SELECT ?, ?, ?, ?, 'open', ?, ?, ?, ?
            WHERE NOT EXISTS (SELECT 1 FROM contact_loops WHERE contact_id = ? AND status = 'open' AND text = ?)`,
      params: [uuid(), contactId, text, str(o.detail).slice(0, 300), str(o.since).slice(0, 32), str(o.source).slice(0, 32), at, at, contactId, text],
    });
  }
  for (const l of Array.isArray(input.closeLoops) ? input.closeLoops.slice(0, 50) : []) {
    const id = typeof l === 'string' ? str(l) : str(l && l.id);
    if (!id) continue;
    const detail = typeof l === 'object' && l ? str(l.detail).slice(0, 300) : '';
    out.push({
      sql: `UPDATE contact_loops SET status = 'done', detail = CASE WHEN ? <> '' THEN ? ELSE detail END, updated_at = ? WHERE id = ? AND contact_id = ?`,
      params: [detail, detail, at, id, contactId],
    });
  }
  return out;
}

async function setLoopStatus(input) {
  const status = input.status === 'open' ? 'open' : 'done';
  await batch([{ sql: 'UPDATE contact_loops SET status = ?, updated_at = ? WHERE id = ?', params: [status, nowIso(), str(input.id)] }]);
  return { id: str(input.id), status };
}

/* ───────────── 往来 ───────────── */

const CHANNELS = new Set(['mail', 'im', 'calendar', 'cindy', 'github', 'call', 'other']);

function safeLink(v) {
  const s = str(v);
  return /^https?:\/\/[^\s]+$/i.test(s) ? s.slice(0, 500) : '';
}

/** 往来归到人：contact_id → 身份（邮箱/平台账号）→ 唯一同名。找不到就交回调用方。 */
async function resolveContact(it) {
  const tries = [];
  if (it.identity && str(it.identity.value)) tries.push([str(it.identity.platform) || 'email', str(it.identity.value)]);
  if (str(it.email)) tries.push(['email', str(it.email)]);
  for (const [platform, value] of tries) {
    let p;
    try {
      p = normalizePlatform(platform);
    } catch (_) {
      continue;
    }
    const rows = await q('SELECT contact_id FROM contact_identities WHERE platform = ? AND normalized_value = ?', [p, normalizeIdentityValue(value, p)]);
    if (rows.length) return rows[0].contact_id;
  }
  const name = str(it.name).toLowerCase();
  if (name) {
    const rows = await q(
      `SELECT id FROM contacts WHERE lower(display_name) = :name OR instr(lower(aliases), :alias) > 0 LIMIT 2`,
      { name, alias: JSON.stringify(name).toLowerCase() },
    );
    if (rows.length === 1) return rows[0].id;
  }
  return '';
}

/** 批量记往来；同一个人同一来源 id（ref）只记一次。单条失败不影响其它条。 */
async function recordInteractions(items) {
  const list = Array.isArray(items) ? items.slice(0, 200) : [];
  if (!list.length) throw fail('INVALID_PARAMS', 'items is required');
  const at = nowIso();
  const statements = [];
  const results = [];
  const seen = new Set();
  for (let i = 0; i < list.length; i++) {
    const it = list[i] || {};
    try {
      let contactId = str(it.contactId);
      if (contactId) await requireContact(contactId);
      else contactId = await resolveContact(it);
      if (!contactId) {
        results.push({ index: i, ok: false, errorCode: 'UNRESOLVED', message: 'No contact matches; find or save the person first, then pass contact_id.' });
        continue;
      }
      const when = Date.parse(str(it.occurredAt));
      if (Number.isNaN(when)) throw fail('INVALID_PARAMS', 'occurred_at must be an ISO 8601 time');
      if (when > Date.now() + 2 * 86400000) throw fail('INVALID_PARAMS', 'occurred_at is in the future');
      const channel = CHANNELS.has(str(it.channel)) ? str(it.channel) : 'other';
      const occurred = new Date(when).toISOString();
      const ref = (str(it.ref) || `${channel}:${occurred}:${str(it.title).slice(0, 60)}`).slice(0, 300);
      const key = `${contactId}|${ref}`;
      const dup = seen.has(key) || (await q('SELECT 1 FROM contact_interactions WHERE contact_id = ? AND ref = ?', [contactId, ref])).length > 0;
      seen.add(key);
      if (dup) {
        results.push({ index: i, ok: true, contactId, duplicate: true });
        continue;
      }
      statements.push({
        sql: `INSERT OR IGNORE INTO contact_interactions (id, contact_id, occurred_at, channel, title, summary, quote, link, ref, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [uuid(), contactId, occurred, channel, str(it.title).slice(0, 200), str(it.summary).slice(0, 600), str(it.quote).slice(0, 400), safeLink(it.link), ref, at],
      });
      results.push({ index: i, ok: true, contactId, duplicate: false });
    } catch (e) {
      results.push({ index: i, ok: false, errorCode: e.code || 'CONTACTS_ERROR', message: e.message });
    }
  }
  await batchChunks(statements);
  return {
    added: results.filter((r) => r.ok && !r.duplicate).length,
    duplicates: results.filter((r) => r.duplicate).length,
    failed: results.filter((r) => !r.ok).length,
    results: results.filter((r) => !r.ok || r.duplicate),
  };
}

async function logEvent(input) {
  const c = await requireContact(input.contactId);
  const text = str(input.text);
  if (!text) throw fail('INVALID_PARAMS', 'text is required');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(str(input.date)) ? str(input.date) : today();
  const id = uuid();
  const at = nowIso();
  await batch([
    { sql: 'INSERT INTO contact_events (id, contact_id, date, text, source, created_at) VALUES (?, ?, ?, ?, ?, ?)', params: [id, c.id, date, text, str(input.source), at] },
    { sql: 'UPDATE contacts SET updated_at = ? WHERE id = ?', params: [at, c.id] },
  ]);
  return { id, contactId: c.id, date };
}

async function deleteEvent(eventId) {
  await batch([{ sql: 'DELETE FROM contact_events WHERE id = ?', params: [str(eventId)] }]);
  return { deleted: true };
}

async function relate(input) {
  const a = await requireContact(input.fromId);
  const b = await requireContact(input.toId);
  const relation = str(input.relation);
  if (!relation) throw fail('INVALID_PARAMS', 'relation is required');
  if (input.remove) {
    await batch([{ sql: 'DELETE FROM contact_relations WHERE from_id = ? AND to_id = ? AND relation = ?', params: [a.id, b.id, relation] }]);
    return { removed: true };
  }
  if (a.id === b.id) throw fail('INVALID_PARAMS', 'cannot relate a contact to itself');
  await batch([
    {
      sql: 'INSERT OR IGNORE INTO contact_relations (id, from_id, to_id, relation, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      params: [uuid(), a.id, b.id, relation, str(input.note), nowIso()],
    },
  ]);
  return { related: true };
}

async function organize(input) {
  const ids = uniqueStrings(input.contactIds || []);
  if (!ids.length) throw fail('INVALID_PARAMS', 'contact_ids is required');
  for (const id of ids) await requireContact(id);
  const at = nowIso();
  const statements = [];
  const action = input.action;
  if (action === 'add_to_group' || action === 'remove_from_group' || action === 'move_to_group') {
    const groupName = str(input.group);
    if (!groupName) throw fail('INVALID_PARAMS', 'group is required');
    if (action === 'remove_from_group') {
      for (const id of ids) {
        statements.push({
          sql: 'DELETE FROM contact_group_members WHERE contact_id = ? AND group_id = (SELECT id FROM contact_groups WHERE name = ?)',
          params: [id, groupName],
        });
      }
    } else {
      const gid = await groupIdFor(groupName, statements, at);
      for (const id of ids) {
        if (action === 'move_to_group') statements.push({ sql: 'DELETE FROM contact_group_members WHERE contact_id = ?', params: [id] });
        statements.push({ sql: 'INSERT OR IGNORE INTO contact_group_members (group_id, contact_id) VALUES (?, ?)', params: [gid, id] });
      }
    }
  } else if (action === 'confirm' || action === 'mark_pending') {
    for (const id of ids) {
      statements.push({ sql: 'UPDATE contacts SET status = ?, updated_at = ? WHERE id = ?', params: [action === 'confirm' ? 'confirmed' : 'pending', at, id] });
    }
  } else {
    throw fail('INVALID_PARAMS', 'action must be one of add_to_group, remove_from_group, move_to_group, confirm, mark_pending');
  }
  await batchChunks(statements);
  return { action, count: ids.length };
}

/**
 * 合并：source 的身份、事件、往来、未完的事、分组、关系整体并入 target，别名取并集，叙事拼接，然后删除 source。
 * 单批原子；同时留一份快照，用户可以在资料页「拆开」。
 */
async function mergeContacts(input) {
  const src = await requireContact(input.sourceId);
  const dst = await requireContact(input.targetId);
  if (src.id === dst.id) throw fail('INVALID_PARAMS', 'source and target are the same contact');
  const aliases = uniqueStrings([...parseAliases(dst.aliases), src.display_name, ...parseAliases(src.aliases)]).filter(
    (a) => a.toLowerCase() !== dst.display_name.toLowerCase(),
  );
  const joinText = (a, b) => [str(a), str(b)].filter(Boolean).join('\n\n');
  const ids = async (sql, params) => (await qAll(sql, params)).map((r) => r.id);
  const snapshot = {
    source: src,
    target: {
      aliases: parseAliases(dst.aliases), summary: dst.summary, narrative: dst.narrative, agent_notes: dst.agent_notes,
      status: dst.status, facts: dst.facts, latest: dst.latest, latest_at: dst.latest_at, covered_from: dst.covered_from,
    },
    aliasesAfter: aliases,
    identityIds: await ids('SELECT id FROM contact_identities WHERE contact_id = ? ORDER BY id', [src.id]),
    eventIds: await ids('SELECT id FROM contact_events WHERE contact_id = ? ORDER BY id', [src.id]),
    interactionIds: await ids(
      'SELECT id FROM contact_interactions WHERE contact_id = ? AND ref NOT IN (SELECT ref FROM contact_interactions WHERE contact_id = ?) ORDER BY id',
      [src.id, dst.id],
    ),
    loopIds: await ids('SELECT id FROM contact_loops WHERE contact_id = ? ORDER BY id', [src.id]),
    groupIds: (await q('SELECT group_id FROM contact_group_members WHERE contact_id = ?', [src.id])).map((r) => r.group_id),
    // 并入者名下的旧合并记录会改挂到目标；记下来，拆开这次合并时挂回去
    repointedMergeIds: await ids('SELECT id FROM contact_merges WHERE target_id = ? ORDER BY id', [src.id]),
    // 目标原有的分组：拆开时撤回只因这次合并加进来的分组
    targetGroupIds: (await q('SELECT group_id FROM contact_group_members WHERE contact_id = ?', [dst.id])).map((r) => r.group_id),
    // 两边都有的同一来源往来，合并时会去掉来源这条；存下全文，拆开时还回去
    droppedInteractions: await qAll(
      'SELECT * FROM contact_interactions WHERE contact_id = ? AND ref IN (SELECT ref FROM contact_interactions WHERE contact_id = ?) ORDER BY id',
      [src.id, dst.id],
    ),
    relations: (await q('SELECT * FROM contact_relations WHERE from_id = ? OR to_id = ? LIMIT 100', [src.id, src.id])),
  };
  const facts = normalizeFacts([...parseFacts(dst.facts), ...parseFacts(src.facts).filter((f) => !parseFacts(dst.facts).some((g) => g.label === f.label))]);
  const covered = [str(dst.covered_from), str(src.covered_from)].filter(Boolean).sort()[0] || '';
  const at = nowIso();
  const mergeId = uuid();
  await batch([
    { sql: 'UPDATE contact_identities SET contact_id = ? WHERE contact_id = ?', params: [dst.id, src.id] },
    { sql: 'UPDATE contact_events SET contact_id = ? WHERE contact_id = ?', params: [dst.id, src.id] },
    { sql: 'UPDATE OR IGNORE contact_interactions SET contact_id = ? WHERE contact_id = ?', params: [dst.id, src.id] },
    { sql: 'DELETE FROM contact_interactions WHERE contact_id = ?', params: [src.id] },
    { sql: 'UPDATE contact_loops SET contact_id = ? WHERE contact_id = ?', params: [dst.id, src.id] },
    { sql: 'INSERT OR IGNORE INTO contact_group_members (group_id, contact_id) SELECT group_id, ? FROM contact_group_members WHERE contact_id = ?', params: [dst.id, src.id] },
    { sql: 'DELETE FROM contact_group_members WHERE contact_id = ?', params: [src.id] },
    { sql: 'UPDATE OR IGNORE contact_relations SET from_id = ? WHERE from_id = ? AND to_id <> ?', params: [dst.id, src.id, dst.id] },
    { sql: 'UPDATE OR IGNORE contact_relations SET to_id = ? WHERE to_id = ? AND from_id <> ?', params: [dst.id, src.id, dst.id] },
    { sql: 'DELETE FROM contact_relations WHERE from_id = ? OR to_id = ?', params: [src.id, src.id] },
    {
      sql: `UPDATE contacts SET aliases = ?, summary = ?, narrative = ?, agent_notes = ?, status = ?, facts = ?, covered_from = ?, updated_at = ? WHERE id = ?`,
      params: [
        JSON.stringify(aliases),
        str(dst.summary) || str(src.summary),
        joinText(dst.narrative, src.narrative),
        joinText(dst.agent_notes, src.agent_notes),
        dst.status === 'confirmed' || src.status === 'confirmed' ? 'confirmed' : 'pending',
        JSON.stringify(facts),
        covered,
        at,
        dst.id,
      ],
    },
    { sql: 'DELETE FROM contacts WHERE id = ?', params: [src.id] },
    // 甲并入乙、乙再并入丙：甲的合并记录改挂到丙，删丙时快照一起清掉
    { sql: 'UPDATE contact_merges SET target_id = ? WHERE target_id = ?', params: [dst.id, src.id] },
    {
      sql: 'INSERT INTO contact_merges (id, target_id, source_id, source_name, reason, snapshot, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      params: [mergeId, dst.id, src.id, src.display_name, str(input.reason).slice(0, 200), JSON.stringify(snapshot), at],
    },
  ]);
  return { id: dst.id, mergedFrom: src.id, mergeId };
}

/** 拆开一次合并：按快照把原档案和它带来的身份、事件、往来、未完的事、分组、关系还回去。 */
async function undoMerge(mergeId) {
  const rows = await q('SELECT * FROM contact_merges WHERE id = ?', [str(mergeId)]);
  if (!rows.length) throw fail('NOT_FOUND', `merge not found: ${mergeId}`);
  const m = rows[0];
  if (m.undone_at) throw fail('ALREADY_UNDONE', 'This merge was already undone.');
  const snap = JSON.parse(m.snapshot);
  const src = snap.source;
  if ((await q('SELECT 1 FROM contacts WHERE id = ?', [src.id])).length) throw fail('CONFLICT', 'The original contact already exists again.');
  const dst = await requireContact(m.target_id);
  const at = nowIso();
  const list = (a) => JSON.stringify(Array.isArray(a) ? a : []);
  const added = new Set((snap.aliasesAfter || []).map((a) => a.toLowerCase()));
  for (const a of snap.target.aliases || []) added.delete(a.toLowerCase());
  const keptAliases = parseAliases(dst.aliases).filter((a) => !added.has(a.toLowerCase()));
  const untouched = dst.updated_at === m.at;
  const t = snap.target;
  // 目标名下还有别的合并没拆开：那些合并带来的分组仍要保留
  const keepGroups = new Set(Array.isArray(snap.targetGroupIds) ? snap.targetGroupIds : []);
  for (const o of await q("SELECT snapshot FROM contact_merges WHERE target_id = ? AND id <> ? AND (undone_at IS NULL OR undone_at = '')", [dst.id, m.id])) {
    try {
      for (const g of JSON.parse(o.snapshot).groupIds || []) keepGroups.add(g);
    } catch (_) {
      /* 旧快照读不出就跳过 */
    }
  }
  const statements = [
    {
      sql: `INSERT INTO contacts (id, kind, display_name, aliases, summary, narrative, agent_notes, status, source, created_at, updated_at, facts, latest, latest_at, covered_from)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        src.id, src.kind, src.display_name, src.aliases || '[]', src.summary || '', src.narrative || '', src.agent_notes || '', src.status || 'confirmed',
        src.source || 'manual', src.created_at || at, at, src.facts || '[]', src.latest || '', src.latest_at || '', src.covered_from || '',
      ],
    },
    { sql: 'UPDATE contact_identities SET contact_id = ? WHERE contact_id = ? AND id IN (SELECT value FROM json_each(?))', params: [src.id, dst.id, list(snap.identityIds)] },
    { sql: 'UPDATE contact_events SET contact_id = ? WHERE contact_id = ? AND id IN (SELECT value FROM json_each(?))', params: [src.id, dst.id, list(snap.eventIds)] },
    { sql: 'UPDATE OR IGNORE contact_interactions SET contact_id = ? WHERE contact_id = ? AND id IN (SELECT value FROM json_each(?))', params: [src.id, dst.id, list(snap.interactionIds)] },
    { sql: 'UPDATE contact_loops SET contact_id = ? WHERE contact_id = ? AND id IN (SELECT value FROM json_each(?))', params: [src.id, dst.id, list(snap.loopIds)] },
    {
      sql: 'INSERT OR IGNORE INTO contact_group_members (group_id, contact_id) SELECT value, ? FROM json_each(?) WHERE value IN (SELECT id FROM contact_groups)',
      params: [src.id, list(snap.groupIds)],
    },
    ...(Array.isArray(snap.targetGroupIds)
      ? [{
          sql: 'DELETE FROM contact_group_members WHERE contact_id = ? AND group_id IN (SELECT value FROM json_each(?)) AND group_id NOT IN (SELECT value FROM json_each(?))',
          params: [dst.id, list(snap.groupIds), list([...keepGroups])],
        }]
      : []),
    untouched
      ? {
          sql: 'UPDATE contacts SET aliases = ?, summary = ?, narrative = ?, agent_notes = ?, status = ?, facts = ?, covered_from = ?, updated_at = ? WHERE id = ?',
          params: [JSON.stringify(keptAliases), t.summary || '', t.narrative || '', t.agent_notes || '', t.status || 'confirmed', t.facts || '[]', t.covered_from || '', at, dst.id],
        }
      : { sql: 'UPDATE contacts SET aliases = ?, updated_at = ? WHERE id = ?', params: [JSON.stringify(keptAliases), at, dst.id] },
  ];
  if (Array.isArray(snap.droppedInteractions) && snap.droppedInteractions.length) {
    // 一条语句还原全部，单批语句数不随往来数量增长
    statements.push({
      sql: `INSERT OR IGNORE INTO contact_interactions (id, contact_id, occurred_at, channel, title, summary, quote, link, ref, created_at)
            SELECT json_extract(value, '$.id'), ?, json_extract(value, '$.occurred_at'), json_extract(value, '$.channel'),
                   coalesce(json_extract(value, '$.title'), ''), coalesce(json_extract(value, '$.summary'), ''),
                   coalesce(json_extract(value, '$.quote'), ''), coalesce(json_extract(value, '$.link'), ''),
                   json_extract(value, '$.ref'), coalesce(json_extract(value, '$.created_at'), ?)
            FROM json_each(?)`,
      params: [src.id, at, JSON.stringify(snap.droppedInteractions)],
    });
  }
  for (const r of (snap.relations || []).slice(0, 80)) {
    const other = r.from_id === src.id ? r.to_id : r.from_id;
    statements.push({
      sql: `INSERT OR IGNORE INTO contact_relations (id, from_id, to_id, relation, note, created_at)
            SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM contacts WHERE id = ?)`,
      params: [r.id, r.from_id, r.to_id, r.relation, r.note || '', r.created_at || at, other],
    });
    statements.push({
      sql: 'UPDATE OR IGNORE contact_relations SET from_id = ?, to_id = ? WHERE id = ? AND EXISTS (SELECT 1 FROM contacts WHERE id = ?)',
      params: [r.from_id, r.to_id, r.id, other],
    });
  }
  // 合并时改挂到目标的旧合并记录挂回原档案，之后还能接着拆开里层的合并
  statements.push({
    sql: 'UPDATE contact_merges SET target_id = ? WHERE target_id = ? AND id IN (SELECT value FROM json_each(?))',
    params: [src.id, dst.id, list(snap.repointedMergeIds)],
  });
  statements.push({ sql: 'UPDATE contact_merges SET undone_at = ? WHERE id = ?', params: [at, m.id] });
  await batch(statements);
  return { restored: src.id, name: src.display_name, targetId: dst.id, textRestored: untouched };
}

async function deleteContact(id) {
  const c = await requireContact(id);
  // Capture the post-delete projection before committing, even with sync disabled.
  // The business rows and their cached payload disappear in the same transaction.
  const syncState = await syncCapture({ deletedContactId: c.id });
  await batch([
    { sql: 'DELETE FROM contact_identities WHERE contact_id = ?', params: [c.id] },
    { sql: 'DELETE FROM contact_events WHERE contact_id = ?', params: [c.id] },
    { sql: 'DELETE FROM contact_group_members WHERE contact_id = ?', params: [c.id] },
    { sql: 'DELETE FROM contact_relations WHERE from_id = ? OR to_id = ?', params: [c.id, c.id] },
    { sql: 'DELETE FROM contact_interactions WHERE contact_id = ?', params: [c.id] },
    { sql: 'DELETE FROM contact_loops WHERE contact_id = ?', params: [c.id] },
    // 合并快照里存着被并入的人的完整档案；目标被删就一起删，不留可恢复的副本。
    { sql: 'DELETE FROM contact_merges WHERE target_id = ? OR source_id = ?', params: [c.id, c.id] },
    { sql: 'DELETE FROM plugin_meta WHERE key IN (?, ?)', params: [`qa:${c.id}`, `task:c:${c.id}`] },
    { sql: 'DELETE FROM contacts WHERE id = ?', params: [c.id] },
    ...(syncState ? [setMetaStmt('device_sync_state', syncState)] : []),
  ]);
  return { deleted: c.id, name: c.display_name };
}

async function manageGroups(input) {
  const action = input.action || 'list';
  if (action === 'list') return { groups: await listGroups() };
  const name = str(input.name);
  if (!name) throw fail('INVALID_PARAMS', 'name is required');
  if (action === 'create') {
    const exists = await q('SELECT id FROM contact_groups WHERE name = ?', [name]);
    if (exists.length) return { id: exists[0].id, created: false };
    const id = uuid();
    await batch([{ sql: 'INSERT INTO contact_groups (id, name, description, created_at) VALUES (?, ?, ?, ?)', params: [id, name, str(input.description), nowIso()] }]);
    return { id, created: true };
  }
  const rows = await q('SELECT id FROM contact_groups WHERE name = ?', [name]);
  if (!rows.length) throw fail('NOT_FOUND', `group not found: ${name}`);
  if (action === 'rename') {
    const next = str(input.newName);
    if (!next) throw fail('INVALID_PARAMS', 'new_name is required');
    await batch([{ sql: 'UPDATE contact_groups SET name = ? WHERE id = ?', params: [next, rows[0].id] }]);
    return { id: rows[0].id, name: next };
  }
  if (action === 'delete') {
    await batch([
      { sql: 'DELETE FROM contact_group_members WHERE group_id = ?', params: [rows[0].id] },
      { sql: 'DELETE FROM contact_groups WHERE id = ?', params: [rows[0].id] },
    ]);
    return { deleted: name };
  }
  throw fail('INVALID_PARAMS', 'action must be list, create, rename or delete');
}

/** 相似名候选的分桶键：中文取双字片段，拉丁名取 ≥3 字母的词。只在同桶内两两比较，几千人也很快。 */
function blockingKeys(facets) {
  const keys = new Set();
  for (const f of facets) {
    if (f.cjk) {
      for (let i = 0; i + 2 <= f.norm.length; i++) keys.add(`c:${f.norm.slice(i, i + 2)}`);
    }
    for (const t of f.toks) if (t.length >= 3) keys.add(`t:${t}`);
    if (f.norm) keys.add(`n:${f.norm}`);
  }
  return keys;
}

async function findDuplicates() {
  const rows = await qAll('SELECT id, kind, display_name, aliases, summary FROM contacts ORDER BY id');
  const items = rows.map((r) => {
    const facets = [r.display_name, ...parseAliases(r.aliases)].map(nameFacet);
    return { r, facets, keys: blockingKeys(facets) };
  });
  const buckets = new Map();
  items.forEach((it, idx) => {
    for (const k of it.keys) {
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(idx);
    }
  });
  const seen = new Set();
  const pairs = [];
  for (const list of buckets.values()) {
    if (list.length < 2 || list.length > 200) continue; // 超大桶是常见字，不代表重复
    for (let x = 0; x < list.length && pairs.length < 100; x++) {
      for (let y = x + 1; y < list.length && pairs.length < 100; y++) {
        const a = items[list[x]];
        const b = items[list[y]];
        const key = `${list[x]}|${list[y]}`;
        if (seen.has(key) || a.r.kind !== b.r.kind) continue;
        seen.add(key);
        if (a.facets.some((f) => b.facets.some((g) => facetsSimilar(f, g)))) {
          pairs.push({
            a: { id: a.r.id, name: a.r.display_name, summary: a.r.summary },
            b: { id: b.r.id, name: b.r.display_name, summary: b.r.summary },
          });
        }
      }
    }
  }
  return { pairs };
}

/* ───────────── 设置与自动维护 ───────────── */

/**
 * 两种规模档位。只影响自动维护的节奏和单次改动上限；数据结构一致。
 * colleagues：同事、朋友为主，每天一次。clients：客户很多，频率更高、上限更大，并按客户公司组织。
 */
const PROFILES = {
  colleagues: {
    intervalHours: 24,
    maxChanges: 30,
    guidance: '以同事、朋友、家人为主：记录职位与团队变化、新联系方式、约定和值得记住的往来。',
  },
  clients: {
    intervalHours: 6,
    maxChanges: 100,
    guidance:
      '客户很多：每位客户联系人都挂到其公司（relate 任职，公司不存在时先建 kind:"org" 的档案），并放进以公司名命名的分组；' +
      '重点记录需求、报价、合同、跟进约定和下次联系时间，事件里写清日期。',
  },
};
const SOURCES = ['mail', 'calendar', 'im', 'cindy', 'github'];
const DEFAULT_SETTINGS = {
  profile: 'colleagues',
  macAutoSync: true,
  initialDays: 14,
  backfillMonths: 3,
  sources: { mail: true, calendar: true, im: true, cindy: true, github: false },
};

async function getSettings() {
  const saved = (await getMeta('settings')) || {};
  return { ...DEFAULT_SETTINGS, ...saved, sources: { ...DEFAULT_SETTINGS.sources, ...(saved.sources || {}) } };
}

async function setSettings(patch) {
  const next = await getSettings();
  if (patch.profile === 'colleagues' || patch.profile === 'clients') next.profile = patch.profile;
  if (typeof patch.macAutoSync === 'boolean') next.macAutoSync = patch.macAutoSync;
  if ([7, 14, 30].includes(Number(patch.initialDays))) next.initialDays = Number(patch.initialDays);
  if ([1, 3, 6, 12].includes(Number(patch.backfillMonths))) next.backfillMonths = Number(patch.backfillMonths);
  if (patch.sources && typeof patch.sources === 'object') {
    for (const k of SOURCES) if (typeof patch.sources[k] === 'boolean') next.sources[k] = patch.sources[k];
  }
  await batch([setMetaStmt('settings', next)]);
  return next;
}

/**
 * 每个来源「按时间段取新往来」的做法。不限插件：这个任务里能用的办法都可以用，
 * 按 CHANNEL_RULE 的顺序逐个试；本机加密的应用数据不去解。
 */
const CHANNEL_RULE =
  '每个来源用这个任务里一切能用的办法读，按顺序试，前一个读全了就不用后一个：' +
  '① 已安装的插件（ghost_info 查 tools）；② Cindy 自带工具；③ 本机命令行工具（gh、gog、lark-cli 等，先 which）；④ 本机能直接读的应用数据（只读，如 sqlite3 -readonly）。' +
  '微信、Telegram、飞书桌面版等应用的本地库是加密的，不要尝试解密或读取进程内存。' +
  '读不到时把原因写进 note：系统隐私保护拦住（authorization denied / Operation not permitted）写「需要给 Cindy 开完全磁盘访问」；' +
  '命令行工具在沙盒里读不到钥匙串（gh auth status 显示 (default) 且说 token invalid，或 gog 报 keyring 错误）写「任务沙盒读不到钥匙串」，这不是登录失效，不要让用户重新登录。';

const SOURCE_GUIDE = {
  mail:
    '邮件：Gmail 插件（先 gmail_accounts，再 gmail_run 的 messages search）或 gog CLI（gog gmail search）。按时间段查，query 写 `after:<from 的 Unix 秒> before:<to 的 Unix 秒> -category:promotions -category:social`，真人来信再读整串，只取要点。' +
    '其它邮箱用对应插件；Apple 邮件可只读 ~/Library/Mail/V*/MailData/Envelope Index（sqlite），需要完全磁盘访问。ref 填邮件 message id。',
  calendar:
    '日历：日历插件（如 google_calendar 的 list_events）或 gog CLI（gog calendar events），time_min / time_max 用本时间段。参会人和会议主题记成往来，ref 填 event id。50 人以上的大会只记组织者。',
  im:
    '即时消息：群聊和单聊要分别找，单聊优先。' +
    '单聊（飞书）：im_list_chats 只列群，不含单聊；用 im_search_messages，query 传一个空格 " "、chat_type 传 "p2p_chat"，结果按时间倒序，翻页直到消息早于本时间段开始，收集出现过的单聊 chat_id 和对方。' +
    '群聊（飞书）：im_list_chats，sort_type=ByActiveTimeDesc，取本时间段内有活动的群。' +
    '然后用 im_read_messages（start_time / end_time 用本时间段，page_size 50）逐个会话读；has_more 为 true 就带 page_token 继续，单个会话最多读 200 条，读不完的那一段写进 coverage 的 gaps。' +
    'iMessage / 短信：sqlite3 -readonly ~/Library/Messages/chat.db，message 表 date 是 2001-01-01 起的纳秒，handle.id 是对方手机号或邮箱，群聊看 chat_message_join 和 chat；需要完全磁盘访问。' +
    'Slack 等其它消息工具同理：私聊和群各自找全。ref 填消息 id；机器人消息不记。',
  cindy:
    'Cindy 对话：cindy_helper 的 get_chat_history（from / to 用本时间段，只看 user 和 assistant；list_sessions 按会话创建时间筛，开了很久的会话会漏，不要用它找）。插件发起的任务里这组工具可能不可用，不可用就跳过。ref 填消息 id。',
  github:
    'GitHub：已授权的 GitHub 插件或 gh CLI，查本时间段内与用户相关的 PR、review 和 issue 评论（作者、评审人、被 @ 的人）。ref 填 PR 或评论的 URL。',
};

const DAY = 86400000;
const isoOf = (ms) => new Date(ms).toISOString();

function addMonths(ms, n) {
  const d = new Date(ms);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.getTime();
}

/** 把一段时间切成不超过 days 天的小段，新的在前。 */
function splitWindow(from, to, days) {
  const out = [];
  for (let end = to; end > from; end -= days * DAY) out.push({ from: isoOf(Math.max(from, end - days * DAY)), to: isoOf(end) });
  return out.slice(0, 60);
}

function automationPrompt(profile) {
  const p = PROFILES[profile] || PROFILES.colleagues;
  return [
    '整理我的通讯录（cindy-contacts 插件）。先读整理手册：ghost_manual({ ghost_id: "cindy-contacts", path: "tidy" })，照它做。',
    '1. 调用 ghost_call({ ghost_id: "cindy-contacts", tool: "maintenance", args: { action: "begin" } })，先按 first_step 检查并报告来源，再按时间段（segments）和来源说明（sources）逐段查找。',
    '2. 每个来源只拉这段时间里的新内容；与我真实往来的人，用 record 记下每条往来（ref 填来源 id，重复的会自动跳过）。',
    '3. 有新往来的人：先 get，再用 save 更新 summary、narrative、latest（一句话说这次的新动静）、facts，并用 open_loops / close_loops 维护还没完的事。值得记的真人没有档案就新建；明显是同一个人的两份档案直接 merge 并写 reason。',
    `4. 本次最多改 ${p.maxChanges} 个人，其余留到下次。`,
    '5. 最后调用 maintenance，action 为 "end"，带上 begin 返回的 run_id、扫描与新增更新的数量，以及 coverage（每个来源读全了没有、哪里没读完）。',
  ].join('\n');
}

async function requestAutomation() {
  const settings = await getSettings();
  const p = PROFILES[settings.profile] || PROFILES.colleagues;
  if (!cindy.agent || typeof cindy.agent.requestSchedule !== 'function') {
    throw fail('UNSUPPORTED', '当前 Cindy 版本不支持由插件请求新建自动化');
  }
  const r = await cindy.agent.requestSchedule({
    name: (await taskNames()).schedule,
    prompt: automationPrompt(settings.profile),
    intervalMs: p.intervalHours * 3600 * 1000,
  });
  if (!r || r.ok === false) throw fail((r && r.errorCode) || 'SCHEDULE_FAILED', (r && r.message) || '没有打开自动化面板');
  const requested = { at: nowIso(), profile: settings.profile };
  await batch([setMetaStmt('automation_requested', requested)]);
  return requested;
}

/**
 * 按时间段整理。三种范围共用一套做法，只是时间段不同：
 * - recent：上次整理 → 现在（往前多看 1 小时防漏）；第一次是最近 initialDays 天。
 * - backfill：所有人往前补 months 个月。
 * - contact：只补一个人，往前补 months 个月，只按这个人的身份去查。
 */
async function maintenanceBegin(input) {
  const settings = await getSettings();
  const p = PROFILES[settings.profile] || PROFILES.colleagues;
  const meta = (await getMeta('maintenance')) || { runs: [] };
  const coverage = await getMeta('coverage');
  const scope = ['recent', 'backfill', 'contact'].includes(input.scope) ? input.scope : 'recent';
  const months = Math.min(24, Math.max(1, Math.floor(Number(input.months) || settings.backfillMonths)));
  const now = Date.now();
  const initialFrom = now - settings.initialDays * DAY;
  let from;
  let to;
  let contact = null;
  const enabled = SOURCES.filter((k) => settings.sources[k]);
  // 每个来源各自从上次读完的地方接着读（往前多看 1 小时防漏）；最多往前 30 天，更早的交给回补。
  const sourceFrom = {};
  const skipped = [];
  if (scope === 'recent') {
    to = now;
    for (const k of enabled) {
      const cp = (meta.sources && meta.sources[k] && meta.sources[k].checkpoint) || meta.checkpoint || '';
      let f = cp ? Date.parse(cp) - 3600000 : initialFrom;
      // 超过 30 天没读的部分不塞进这一轮，记成待补，下一轮先补，不会被跳过。
      if (f < now - 30 * DAY) skipped.push({ source: k, where: '整个来源', from: isoOf(f), to: isoOf(now - 30 * DAY), reason: '超过 30 天没读到' });
      f = Math.max(f, now - 30 * DAY);
      if (!(f < to)) f = to - 3600000;
      sourceFrom[k] = f;
    }
    from = enabled.length ? Math.min(...enabled.map((k) => sourceFrom[k])) : initialFrom;
  } else if (scope === 'backfill') {
    to = coverage && coverage.from ? Date.parse(coverage.from) : initialFrom;
    from = addMonths(to, -months);
  } else {
    const c = await requireContact(input.contactId);
    to = c.covered_from ? Date.parse(c.covered_from) : coverage && coverage.from ? Date.parse(coverage.from) : initialFrom;
    from = addMonths(to, -months);
    const identities = await q("SELECT platform, value FROM contact_identities WHERE contact_id = ? AND platform <> 'apple-contacts' ORDER BY created_at", [c.id]);
    contact = { id: c.id, name: c.display_name, aliases: parseAliases(c.aliases), identities };
  }
  const run = {
    runId: uuid(),
    scope,
    from: isoOf(from),
    to: isoOf(to),
    contactId: contact ? contact.id : '',
    contactName: contact ? contact.name : '',
    firstRun: scope === 'recent' && !meta.checkpoint,
    sources: enabled,
    startedAt: nowIso(),
  };
  const metaWrites = [setMetaStmt(`run:${run.runId}`, run)];
  if (skipped.length) {
    const known = meta.backlog || [];
    const added = skipped
      .filter((g) => !known.some((b) => b.source === g.source && b.where === g.where && b.from === g.from))
      .map((g) => ({ id: uuid(), ...g, addedAt: nowIso() }));
    if (added.length) {
      meta.backlog = [...known, ...added].slice(-200);
      metaWrites.push(setMetaStmt('maintenance', meta));
    }
  }
  await batch(metaWrites);
  const sources = enabled.map((k) => ({
    source: k,
    from: isoOf(sourceFrom[k] !== undefined ? sourceFrom[k] : from),
    to: isoOf(to),
    how: SOURCE_GUIDE[k],
  }));
  const backlog = scope === 'recent' ? (meta.backlog || []).filter((g) => enabled.includes(g.source)).slice(0, 20) : [];
  return {
    run_id: run.runId,
    scope,
    from: run.from,
    to: run.to,
    first_run: run.firstRun,
    segments: splitWindow(from, to, scope === 'recent' ? 7 : 14),
    sources,
    backlog,
    contact,
    max_changes: scope === 'contact' ? 1 : p.maxChanges,
    guidance:
      (scope === 'contact'
        ? `只查与「${contact.name}」有关的往来：用上面的身份（邮箱、平台账号）和名字去各来源搜索这段时间。`
        : p.guidance) + ' 每条往来用 record 记下（ref 填来源 id）；有新往来的人再用 save 改写 summary、narrative、latest、facts 和还没完的事。',
    stats: await stats(),
    coverage_rule:
      '收尾 end 必须带 coverage：每个来源写 complete（这段时间读全了）/ partial（读了一部分，gaps 写清哪个会话或哪类、哪段时间没读到、为什么）/ none（没读到）。' +
      '读完的来源才推进检查点；partial 的缺口和 none 的整段会留到下次先补。backlog 里是上次没读完的，先补，补完的 id 放进 backlog_done。',
    first_step:
      '先逐个确认 sources 里的来源能不能用、用哪个办法读（按 channel_rule 的顺序试：插件是否已安装并连接、命令行工具是否在、本机数据能否打开；Cindy 对话看 cindy_helper 历史工具是否可用），' +
      '再调用 maintenance，action 为 "sources"，sources_status 写每个来源的 status：ok / missing（没装）/ unauthorized（没连接或没授权）/ unavailable（这个任务里用不了）/ error，note 写一句用的办法或读不到的原因。',
    channel_rule: CHANNEL_RULE,
    manual: 'ghost_manual({ ghost_id: "cindy-contacts", path: "tidy" })',
  };
}

function normalizeCoverage(list) {
  const out = [];
  for (const c of Array.isArray(list) ? list.slice(0, 10) : []) {
    const source = str(c && c.source);
    if (!SOURCES.includes(source) || out.some((x) => x.source === source)) continue;
    let coverage = ['complete', 'partial', 'none'].includes(str(c.coverage)) ? str(c.coverage) : 'none';
    const gaps = [];
    for (const g of Array.isArray(c.gaps) ? c.gaps.slice(0, 20) : []) {
      const where = str(g && g.where).slice(0, 120);
      const from = str(g && g.from);
      const to = str(g && g.to);
      if (!where && !from) continue;
      gaps.push({ where, from: Number.isNaN(Date.parse(from)) ? '' : from, to: Number.isNaN(Date.parse(to)) ? '' : to, reason: str(g && g.reason).slice(0, 160) });
    }
    // 说读了一部分却没写缺口在哪：推进检查点会把没读的部分永久跳过，按没读到处理。
    if (coverage === 'partial' && !gaps.length) coverage = 'none';
    out.push({ source, coverage, gaps, note: str(c.note).slice(0, 160) });
  }
  return out;
}

async function maintenanceEnd(input) {
  const meta = (await getMeta('maintenance')) || { runs: [] };
  const now = nowIso();
  const num = (v) => Math.max(0, Math.floor(Number(v) || 0));
  const statements = [];
  let run = null;
  if (str(input.runId)) {
    run = await getMeta(`run:${str(input.runId)}`);
    if (!run) throw fail('NOT_FOUND', 'run_id not found or already ended; call begin again.');
    statements.push({ sql: 'DELETE FROM plugin_meta WHERE key = ?', params: [`run:${run.runId}`] });
  }
  const record = {
    at: now,
    scope: run ? run.scope : 'recent',
    from: run ? run.from : '',
    to: run ? run.to : '',
    scanned: num(input.scanned),
    created: num(input.created),
    updated: num(input.updated),
    pending: num(input.pending),
    note: str(input.note).slice(0, 300),
    contactId: run ? run.contactId || '' : '',
  };
  const next = { ...meta, runs: [record, ...(meta.runs || [])].slice(0, 10) };
  let checkpoint = meta.checkpoint || '';
  const covs = normalizeCoverage(input.coverage);
  if (run && Array.isArray(run.sources)) {
    const missing = run.sources.filter((k) => !covs.some((c) => c.source === k));
    if (missing.length) {
      throw fail('COVERAGE_REQUIRED', `end 需要 coverage：给 ${missing.join('、')} 各写 complete / partial / none（partial 带 gaps）。`);
    }
  }
  if (run && run.scope !== 'recent' && Array.isArray(run.sources)) {
    // 回补：没读到的整段和读了一部分的缺口记成待补，下一轮先补，不会因覆盖日期前移被跳过。
    const where = run.scope === 'contact' ? `只补「${run.contactName || run.contactId}」` : '整个来源';
    const gaps = [];
    for (const c of covs) {
      if (!run.sources.includes(c.source)) continue;
      if (c.coverage === 'none') gaps.push({ source: c.source, where, from: run.from, to: run.to, reason: c.note || '回补时没读到' });
      for (const g of c.gaps) gaps.push({ source: c.source, ...g, where: g.where || where });
    }
    if (gaps.length) next.backlog = [...(meta.backlog || []), ...gaps.map((g) => ({ id: uuid(), ...g, addedAt: now }))].slice(-200);
  }
  if (run && run.scope === 'recent' && Array.isArray(run.sources)) {
    // 只有读全或读了一部分（缺口记成待补）的来源才推进；没读到的来源保持原位。
    const sources = { ...(meta.sources || {}) };
    let backlog = (meta.backlog || []).filter((g) => !(Array.isArray(input.backlogDone) && input.backlogDone.includes(g.id)));
    for (const c of covs) {
      if (!run.sources.includes(c.source)) continue;
      if (c.coverage === 'complete' || c.coverage === 'partial') sources[c.source] = { checkpoint: run.to, coverage: c.coverage, at: now };
      else sources[c.source] = { ...(sources[c.source] || {}), coverage: 'none', at: now };
      for (const g of c.gaps) backlog.push({ id: uuid(), source: c.source, ...g, addedAt: now });
    }
    // 缺口补完前一直留着（检查点已越过它们）；只设上限防止无限增长。
    backlog = backlog.slice(-200);
    next.sources = sources;
    next.backlog = backlog;
    const cps = run.sources.map((k) => (sources[k] && sources[k].checkpoint) || '').filter(Boolean).sort();
    checkpoint = cps.length && cps.length === run.sources.length ? cps[0] : meta.checkpoint || run.from;
    next.checkpoint = checkpoint;
    next.lastRunAt = now;
    next.last = { ...record, coverage: covs.map((c) => ({ source: c.source, coverage: c.coverage, gaps: c.gaps.length })) };
  } else if (run ? run.scope === 'recent' : str(input.checkpoint)) {
    // 不带 run_id 的旧做法只按调用方明确给的时间推进，不再默认推到现在。
    checkpoint = run ? run.to : str(input.checkpoint);
    if (Number.isNaN(Date.parse(checkpoint)) || Date.parse(checkpoint) > Date.now() + 3600000) checkpoint = now;
    next.checkpoint = checkpoint;
    next.lastRunAt = now;
    next.last = record;
  }
  statements.push(setMetaStmt('maintenance', next));
  const coverage = (await getMeta('coverage')) || {};
  // 回补报了 coverage 却一个来源都没读到时，不算补过这段。
  const readSome = !covs.length || covs.some((c) => c.coverage !== 'none');
  if (run && run.scope !== 'recent' && !readSome) {
    // 不推进 coverage / covered_from
  } else if (run && run.scope === 'recent' && (run.firstRun || !coverage.from)) {
    statements.push(setMetaStmt('coverage', { from: coverage.from && coverage.from < run.from ? coverage.from : run.from }));
  } else if (run && run.scope === 'backfill') {
    statements.push(setMetaStmt('coverage', { from: coverage.from && coverage.from < run.from ? coverage.from : run.from }));
  } else if (run && run.scope === 'contact') {
    statements.push({
      sql: "UPDATE contacts SET covered_from = CASE WHEN covered_from <> '' AND covered_from < ? THEN covered_from ELSE ? END WHERE id = ?",
      params: [run.from, run.from, run.contactId],
    });
  }
  await batch(statements);
  return { recorded: true, scope: record.scope, checkpoint };
}

const SOURCE_STATES = new Set(['ok', 'missing', 'unauthorized', 'unavailable', 'error', 'skipped']);

/** 整理开始时 AI 先逐个确认来源能不能用，报回来给页面显示（插件自己看不到装了哪些插件）。 */
async function reportSources(list) {
  const items = [];
  for (const x of Array.isArray(list) ? list.slice(0, 10) : []) {
    const source = str(x && x.source);
    if (!SOURCES.includes(source)) continue;
    items.push({ source, status: SOURCE_STATES.has(str(x.status)) ? str(x.status) : 'error', note: str(x.note).slice(0, 160) });
  }
  if (!items.length) throw fail('INVALID_PARAMS', 'sources_status is required');
  const prev = (await getMeta('sources_status')) || { items: [] };
  const merged = [...items, ...prev.items.filter((p) => !items.some((i) => i.source === p.source))];
  await batch([setMetaStmt('sources_status', { at: nowIso(), items: merged })]);
  const usable = items.filter((i) => i.status === 'ok').map((i) => i.source);
  return {
    recorded: items.length,
    usable,
    next: usable.length
      ? '按 segments 逐段读这些可用的来源。'
      : '没有可用的来源：不要继续查找，直接调用 maintenance end（带 run_id），note 里写清每个来源为什么不能用。',
  };
}

async function maintenance(input) {
  if (input.action === 'sources') return reportSources(input.sourcesStatus);
  if (input.action === 'begin') {
    maybeAutoSyncMac();
    return maintenanceBegin(input);
  }
  if (input.action === 'end') {
    if (Array.isArray(input.sourcesStatus) && input.sourcesStatus.length) await reportSources(input.sourcesStatus);
    const result = await maintenanceEnd(input);
    const cov = normalizeCoverage(input.coverage);
    if (cov.length) {
      const prev = (await getMeta('sources_status')) || { at: nowIso(), items: [] };
      const items = prev.items.map((i) => {
        const c = cov.find((x) => x.source === i.source);
        return c ? { ...i, coverage: c.coverage, gaps: c.gaps.length, coverageNote: c.note || (c.gaps[0] && `${c.gaps[0].where} ${c.gaps[0].reason}`.trim()) || '' } : i;
      });
      for (const c of cov) {
        if (!items.some((i) => i.source === c.source)) items.push({ source: c.source, status: c.coverage === 'none' ? 'error' : 'ok', note: '', coverage: c.coverage, gaps: c.gaps.length, coverageNote: c.note });
      }
      await batch([setMetaStmt('sources_status', { ...prev, items })]);
    }
    return result;
  }
  throw fail('INVALID_PARAMS', 'action must be begin, sources or end');
}

/** 批量建档/更新，单次最多 100 条；逐条返回结果，单条失败不影响其它条。 */
async function saveMany(items) {
  const list = Array.isArray(items) ? items.slice(0, 100) : [];
  if (!list.length) throw fail('INVALID_PARAMS', 'items is required');
  const results = [];
  for (let i = 0; i < list.length; i++) {
    try {
      const r = await saveContact(list[i]);
      results.push({ index: i, ok: true, id: r.id, created: r.created });
    } catch (e) {
      results.push({ index: i, ok: false, errorCode: e.code || 'CONTACTS_ERROR', message: e.message, ...(e.extra || {}) });
    }
  }
  return { saved: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}

let macSyncing = false;
/**
 * 用户曾经手动从 macOS 通讯录导入过，才在之后每天自动增量对账一次（不调用模型）。
 * 在后台排进串行队列，不阻塞当前请求；失败（如用户撤销了授权）只记录不打扰。
 */
async function maybeAutoSyncMac() {
  if (macSyncing || state.importing) return;
  try {
    const settings = await getSettings();
    const last = await getMeta('system_import');
    if (!settings.macAutoSync || !last || !last.at) return;
    if (Date.now() - Date.parse(last.at) < 24 * 3600 * 1000) return;
    if ((await platform()) !== 'darwin') return;
    macSyncing = true;
    serial(() => importSystem({ dryRun: false, auto: true }))
      .then((r) => {
        if (r && (r.created || r.updated)) notifyChanged();
      })
      .catch((e) =>
        serial(() => batch([setMetaStmt('system_import', { ...last, at: nowIso(), lastError: e.code || 'FAILED' })])).catch(() => {}),
      )
      .finally(() => {
        macSyncing = false;
      });
  } catch (_) {
    macSyncing = false;
  }
}

/* ───────────── 导入：旧版内置通讯录 ───────────── */

const LEGACY_IMPORT = [
  {
    table: 'contacts',
    page: 50,
    sql: `INSERT OR IGNORE INTO contacts (id, kind, display_name, aliases, summary, narrative, agent_notes, status, source, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    cols: ['id', 'kind', 'display_name', 'aliases', 'summary', 'narrative', 'agent_notes', 'status', 'source', 'created_at', 'updated_at'],
  },
  {
    table: 'contact_groups',
    page: 200,
    sql: 'INSERT OR IGNORE INTO contact_groups (id, name, description, created_at) VALUES (?, ?, ?, ?)',
    cols: ['id', 'name', 'description', 'created_at'],
  },
  {
    table: 'contact_identities',
    page: 200,
    sql: `INSERT OR IGNORE INTO contact_identities (id, contact_id, platform, value, normalized_value, label, note, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    cols: ['id', 'contact_id', 'platform', 'value', 'normalized_value', 'label', 'note', 'created_at'],
  },
  {
    table: 'contact_events',
    page: 100,
    sql: 'INSERT OR IGNORE INTO contact_events (id, contact_id, date, text, source, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    cols: ['id', 'contact_id', 'date', 'text', 'source', 'created_at'],
  },
  {
    table: 'contact_group_members',
    page: 200,
    sql: 'INSERT OR IGNORE INTO contact_group_members (group_id, contact_id) VALUES (?, ?)',
    cols: ['group_id', 'contact_id'],
  },
  {
    table: 'contact_relations',
    page: 200,
    sql: 'INSERT OR IGNORE INTO contact_relations (id, from_id, to_id, relation, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    cols: ['id', 'from_id', 'to_id', 'relation', 'note', 'created_at'],
  },
];

function cell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'string') return v;
  return String(v);
}

/**
 * 资料库里已有档案时导入旧版：旧档案与已有档案共用同一身份（同一邮箱、手机号或平台账号）时视为
 * 同一个人——先按原 id 导入旧档案，再用普通合并（mergeContacts）并入已有档案：别名取并集、摘要补空、
 * 叙事与备注拼接，并留下可「拆开」的合并记录。同名分组并入已有分组。
 * 只有名字相似、没有共同身份的旧档案照常导入，之后可用「查找重复」合并。
 * pending 是上次中断或合并失败时留下的映射：那些旧档案已按原 id 在库里，不能再靠「库里没有」识别，
 * 两边都还在就继续合并。
 * mergedAway 是已经并入别处、库里不再有的档案（有未拆开的合并记录）：重试时不再插回、不再合并，
 * 它名下的旧行改挂到当前目标，避免故事和备注重复拼接、合并记录重复。
 */
async function legacyMergeMaps(pending) {
  const contacts = new Map();
  const mergedAway = new Map();
  for (const m of await q(
    "SELECT source_id, target_id FROM contact_merges WHERE (undone_at IS NULL OR undone_at = '') AND source_id NOT IN (SELECT id FROM contacts)",
  )) {
    const [dst] = await q('SELECT id FROM contacts WHERE id = ?', [m.target_id]);
    mergedAway.set(m.source_id, dst ? dst.id : null);
  }
  for (const [sourceId, targetId] of Array.isArray(pending) ? pending : []) {
    if (!sourceId || !targetId || sourceId === targetId || mergedAway.has(sourceId)) continue;
    const [src] = await q('SELECT id FROM contacts WHERE id = ?', [cell(sourceId)]);
    const [dst] = await q('SELECT id FROM contacts WHERE id = ?', [cell(targetId)]);
    if (src && dst) contacts.set(sourceId, targetId);
  }
  for (let offset = 0; ; offset += 200) {
    const { rows } = await nodeCall('legacy/read', { table: 'contact_identities', offset, limit: 200 }, { timeoutMs: 60000 });
    for (const r of rows) {
      if (contacts.has(r.contact_id) || mergedAway.has(r.contact_id)) continue;
      const [own] = await q('SELECT id FROM contacts WHERE id = ?', [r.contact_id]);
      if (own) continue;
      const [hit] = await q('SELECT contact_id FROM contact_identities WHERE platform = ? AND normalized_value = ?', [cell(r.platform), cell(r.normalized_value)]);
      if (hit) contacts.set(r.contact_id, hit.contact_id);
    }
    if (rows.length < 200) break;
  }
  const groups = new Map();
  for (let offset = 0; ; offset += 200) {
    const { rows } = await nodeCall('legacy/read', { table: 'contact_groups', offset, limit: 200 }, { timeoutMs: 60000 });
    for (const r of rows) {
      const [hit] = await q('SELECT id FROM contact_groups WHERE name = ? AND id <> ?', [cell(r.name), cell(r.id)]);
      if (hit) groups.set(r.id, hit.id);
    }
    if (rows.length < 200) break;
  }
  return { contacts, groups, mergedAway };
}

/**
 * 同名分组改挂到已有分组；已并入别处的旧档案不再插回，名下的行改挂到当前目标（目标已删则不再插入）。
 * 返回 null 表示这行不再插入。其余旧档案按原 id 导入，导入后再合并。
 */
function remapLegacyRow(table, row, maps) {
  const away = maps.mergedAway;
  const c = (id) => (away.has(id) ? away.get(id) : id);
  switch (table) {
    case 'contacts': return away.has(row.id) ? null : row;
    case 'contact_groups': return maps.groups.has(row.id) ? null : row;
    case 'contact_identities':
    case 'contact_events': {
      const contactId = c(row.contact_id);
      return contactId ? { ...row, contact_id: contactId } : null;
    }
    case 'contact_group_members': {
      const contactId = c(row.contact_id);
      return contactId ? { ...row, contact_id: contactId, group_id: maps.groups.get(row.group_id) || row.group_id } : null;
    }
    case 'contact_relations': {
      const fromId = c(row.from_id);
      const toId = c(row.to_id);
      return fromId && toId && fromId !== toId ? { ...row, from_id: fromId, to_id: toId } : null;
    }
    default: return row;
  }
}

/**
 * 从旧版内置通讯录复制一份。资料库为空时首次启动自动进行；已有档案时只记下「有旧数据可导入」，
 * 由用户在页面上明确选择导入（按共同身份合并到已有档案）。重复执行幂等（INSERT OR IGNORE，
 * 保留原 id）。完成后按表核对数量并记下结果，之后不再自动执行。
 */
async function importLegacy(opts) {
  const force = !!(opts && opts.force);
  const done = await getMeta('legacy_import');
  if (done && done.status === 'done' && !force) return done;
  let probe;
  try {
    probe = await nodeCall('legacy/probe', {}, { timeoutMs: 60000 });
  } catch (e) {
    // 写进状态：页面重新读取时能看到失败原因和「重试」
    const failed = { status: 'error', code: e.code, message: e.message, at: nowIso() };
    state.legacy = failed;
    return failed;
  }
  if (!probe.found) {
    const none = { status: 'none', at: nowIso() };
    await batch([setMetaStmt('legacy_import', none)]);
    state.legacy = none;
    return none;
  }
  const [{ n }] = await q('SELECT count(*) AS n FROM contacts');
  if (n > 0 && !force && !(done && done.status === 'partial')) {
    const available = { status: 'available', counts: probe.counts, at: nowIso() };
    await batch([setMetaStmt('legacy_import', available)]);
    state.legacy = available;
    nodeCall('legacy/close').catch(() => {});
    return available;
  }
  const merged = n > 0;
  state.importing = 'legacy';
  try {
    const maps = merged ? await legacyMergeMaps(done && done.status === 'partial' ? done.pending : null) : null;
    // 先记下待合并映射再复制：中途退出后重试，已按原 id 落库的旧档案仍能找回要并入的目标。
    await batch([setMetaStmt('legacy_import', { status: 'partial', at: nowIso(), ...(maps ? { pending: [...maps.contacts] } : {}) })]);
    const total = Object.values(probe.counts).reduce((a, b) => a + b, 0) || 1;
    let copied = 0;
    for (const spec of LEGACY_IMPORT) {
      for (let offset = 0; ; offset += spec.page) {
        const { rows } = await nodeCall('legacy/read', { table: spec.table, offset, limit: spec.page }, { timeoutMs: 60000 });
        if (!rows.length) break;
        const keep = maps ? rows.map((r) => remapLegacyRow(spec.table, r, maps)).filter(Boolean) : rows;
        if (keep.length) await batchChunks(keep.map((r) => ({ sql: spec.sql, params: spec.cols.map((c) => cell(r[c])) })));
        copied += rows.length;
        state.progress = { done: copied, total };
        broadcast({ kind: 'event', name: 'progress', data: { phase: 'legacy', done: copied, total } });
        if (rows.length < spec.page) break;
      }
    }
    const mergeFailures = [];
    if (maps) {
      for (const [sourceId, targetId] of maps.contacts) {
        try {
          await mergeContacts({ sourceId, targetId, reason: '旧版智能通讯录导入：与已有档案共用同一联系方式' });
        } catch (e) {
          mergeFailures.push({ sourceId, targetId, code: e.code || 'INTERNAL' });
        }
      }
    }
    const counts = {};
    let verified = mergeFailures.length === 0;
    for (const spec of LEGACY_IMPORT) {
      const [{ n: local }] = await q(`SELECT count(*) AS n FROM ${spec.table}`);
      counts[spec.table] = { legacy: probe.counts[spec.table] || 0, local };
      // 合并导入时部分旧行按共同身份并入已有档案，数量不再一一对应。
      if (!merged && local < (probe.counts[spec.table] || 0)) verified = false;
    }
    const result = {
      status: verified ? 'done' : 'partial',
      at: nowIso(),
      counts,
      ...(merged ? { merged: true, mergedInto: maps.contacts.size - mergeFailures.length } : {}),
      ...(mergeFailures.length
        ? {
            message: `${mergeFailures.length} 份旧档案未能并入已有档案，可重试导入或用「查找重复」手动合并`,
            mergeFailures,
            pending: mergeFailures.map((f) => [f.sourceId, f.targetId]),
          }
        : {}),
    };
    await batch([setMetaStmt('legacy_import', result)]);
    state.legacy = result;
    return result;
  } finally {
    state.importing = null;
    state.progress = null;
    nodeCall('legacy/close').catch(() => {});
  }
}

/* ───────────── 导入：macOS 系统通讯录 ───────────── */

/**
 * 读取系统通讯录并按 anchor → 邮箱 → 电话 匹配已有档案：命中则补齐缺失身份与锚点；
 * 否则新建（与已有档案重名的放进待确认，等用户判断）。只读系统通讯录，不改它。
 */
async function importSystem(opts) {
  const dryRun = !!(opts && opts.dryRun);
  const groupName = str(opts && opts.group);
  if ((await platform()) !== 'darwin') throw fail('UNSUPPORTED', 'macOS 系统通讯录只在 Mac 上可用');
  state.importing = 'system';
  broadcast({ kind: 'event', name: 'progress', data: { phase: 'system-read' } });
  try {
    const { total } = await nodeCall('system/read', {}, { timeoutMs: 120000 });
    const records = [];
    for (let offset = 0; offset < total; offset += 200) {
      const page = await nodeCall('system/page', { offset, limit: 200 });
      records.push(...page.records);
      if (page.done) break;
    }
    const owners = new Map();
    for (const r of await qAll(
      "SELECT platform, normalized_value, contact_id FROM contact_identities WHERE platform IN ('apple-contacts', 'email', 'phone') ORDER BY id",
    )) {
      owners.set(`${r.platform}:${r.normalized_value}`, r.contact_id);
    }
    const facets = (await qAll('SELECT id, display_name, aliases FROM contacts ORDER BY id')).map((r) => ({
      id: r.id,
      facets: [r.display_name, ...parseAliases(r.aliases)].map(nameFacet),
    }));
    const at = nowIso();
    const head = [];
    const perRecord = [];
    const result = { total: records.length, created: 0, updated: 0, unchanged: 0, needsReview: [] };
    let groupId = null;
    if (groupName && !dryRun) groupId = await groupIdFor(groupName, head, at);

    for (const rec of records) {
      const ids = [{ platform: 'apple-contacts', value: rec.id, label: '' }]
        .concat(rec.emails.map((e) => ({ platform: 'email', value: e.value, label: e.label })))
        .concat(rec.phones.map((p) => ({ platform: 'phone', value: p.value, label: p.label })))
        .map((i) => ({ ...i, normalized: normalizeIdentityValue(i.value, i.platform) }))
        // 同一张名片里同一个邮箱/电话写了两遍（大小写、格式不同）只算一次，否则撞唯一约束让整批失败
        .filter((i, k, all) => i.normalized && all.findIndex((x) => x.platform === i.platform && x.normalized === i.normalized) === k);
      let match = null;
      for (const i of ids) {
        const owner = owners.get(`${i.platform}:${i.normalized}`);
        if (owner) {
          match = owner;
          break;
        }
      }
      const fresh = ids.filter((i) => !owners.has(`${i.platform}:${i.normalized}`));
      if (match) {
        if (!fresh.length) {
          result.unchanged += 1;
          continue;
        }
        result.updated += 1;
        const statements = [];
        perRecord.push(statements);
        for (const i of fresh) {
          owners.set(`${i.platform}:${i.normalized}`, match);
          statements.push(identityInsert(match, i, at));
        }
        statements.push({ sql: 'UPDATE contacts SET updated_at = ? WHERE id = ?', params: [at, match] });
        if (groupId) statements.push({ sql: 'INSERT OR IGNORE INTO contact_group_members (group_id, contact_id) VALUES (?, ?)', params: [groupId, match] });
        continue;
      }
      const f = nameFacet(rec.name);
      const similar = facets.find((x) => x.facets.some((y) => facetsSimilar(f, y)));
      const id = uuid();
      const status = similar ? 'pending' : 'confirmed';
      if (similar) result.needsReview.push({ name: rec.name, similarTo: similar.id });
      result.created += 1;
      const statements = [];
      perRecord.push(statements);
      const kind = rec.isCompany ? 'org' : 'person';
      const summary = rec.isCompany ? '' : [rec.title, rec.org].filter(Boolean).join(' · ');
      statements.push({
        sql: `INSERT INTO contacts (id, kind, display_name, aliases, summary, narrative, agent_notes, status, source, created_at, updated_at)
              VALUES (?, ?, ?, '[]', ?, '', '', ?, 'import', ?, ?)`,
        params: [id, kind, rec.name, summary, status, at, at],
      });
      for (const i of ids) {
        owners.set(`${i.platform}:${i.normalized}`, id);
        statements.push(identityInsert(id, i, at));
      }
      if (groupId) statements.push({ sql: 'INSERT OR IGNORE INTO contact_group_members (group_id, contact_id) VALUES (?, ?)', params: [groupId, id] });
      facets.push({ id, facets: [f] });
    }
    if (!dryRun) {
      // 按档案装批：一个人的语句不会被拆进两个批次，中断时不会留下半个档案。
      let chunk = head.slice();
      for (const group of perRecord) {
        if (chunk.length + group.length > BATCH_MAX) {
          await batch(chunk);
          chunk = [];
        }
        chunk.push(...group);
      }
      await batch(chunk);
      await batch([setMetaStmt('system_import', { at, total: result.total, created: result.created, updated: result.updated, auto: !!(opts && opts.auto) })]);
    }
    result.needsReview = result.needsReview.slice(0, 50);
    result.dryRun = dryRun;
    return result;
  } finally {
    state.importing = null;
  }
}

/* ───────────── 问 AI ───────────── */

async function tasksAvailable() {
  if (!cindy.tasks || typeof cindy.tasks.capabilities !== 'function') return false;
  try {
    const caps = await cindy.tasks.capabilities();
    const ops = (caps && caps.operations) || [];
    return ops.includes('create') && ops.includes('send');
  } catch (_) {
    return false;
  }
}

/** 去掉导入时留下的 <!-- … --> 标记；反复到不再变化，嵌套或拼接出的标记也去干净。 */
function stripMarkers(text) {
  let s = String(text || '');
  for (let prev = ''; prev !== s; ) {
    prev = s;
    s = s.replace(/<!--[\s\S]*?-->/g, '');
  }
  return s;
}

/** 给模型看的一份档案：介绍、要点、还没完的事和最近的往来。 */
function dossierText(d) {
  const lines = [`姓名：${d.name}${d.aliases.length ? `（也叫 ${d.aliases.join('、')}）` : ''}`];
  if (d.summary) lines.push(`一句话：${d.summary}`);
  if (d.narrative) lines.push(`介绍：${stripMarkers(d.narrative).trim()}`);
  for (const f of d.facts) lines.push(`${f.label}：${f.value}`);
  const ids = d.identities.filter((i) => i.platform !== 'apple-contacts').map((i) => `${i.platform} ${i.value}`);
  if (ids.length) lines.push(`联系方式：${ids.join('；')}`);
  const open = d.loops.filter((l) => l.status === 'open');
  if (open.length) lines.push('还没完的事：', ...open.map((l) => `- ${l.text}${l.detail ? `（${l.detail}）` : ''}`));
  if (d.interactions.length) {
    lines.push('往来（新的在前）：');
    for (const i of d.interactions.slice(0, 60)) {
      lines.push(`- ${i.at.slice(0, 16).replace('T', ' ')} [${i.channel}] ${i.title}${i.summary ? `：${i.summary}` : ''}${i.quote ? `「${i.quote}」` : ''}`);
    }
  }
  if (d.events.length) lines.push('记下的事：', ...d.events.slice(0, 30).map((e) => `- ${e.date} ${e.text}`));
  return lines.join('\n');
}

async function getQa(contactId) {
  return (await getMeta(`qa:${contactId}`)) || [];
}

async function pushQa(contactId, entry) {
  const list = (await getQa(contactId)).filter((x) => x.key !== entry.key);
  list.push(entry);
  await batch([setMetaStmt(`qa:${contactId}`, list.slice(-12))]);
}

/** 这个人页面上最近几轮问答，让「对」「帮我删了」这类接着上文的话有着落。 */
async function recentTalk(contactId, n = 6) {
  const lines = [];
  for (const x of (await getQa(contactId)).slice(-n)) {
    if (x.q) lines.push(`用户：${str(x.q).slice(0, 300)}`);
    if (x.a) lines.push(`Cindy：${str(x.a).slice(0, 600)}`);
  }
  return lines.join('\n');
}

/** 快速通道判断出用户要动手（改档案、去查、发消息）时只回这个记号，改交给任务。 */
const HANDOFF = '[[TASK]]';

/** 只问这个人的事：把档案交给 Cindy 的快速通道，几秒出答案，不开任务。 */
async function quickAsk(d, text, talk) {
  const prompt = [
    `你是用户的私人通讯录助手。下面是用户通讯录里「${d.name}」的档案和往来记录。`,
    '只根据这些内容回答：第一句直接给结论，总共不超过 5 句；档案里没有的就说「档案里没有记录」，不要猜。用提问的语言回答。',
    `你只能读、不能改。用户要你删除、修改、更正档案里的内容（包括关掉一条还没完的事、说某件事没发生），或者是对你上一句确认问题的肯定回答，或者要你去查邮件、聊天、日历、发消息、安排事情：不要再追问，只回复 ${HANDOFF} 这一个词。`,
    '',
    dossierText(d).slice(0, 26000),
    '',
    ...(talk ? ['之前的对话：', talk, ''] : []),
    `用户的问题：${text}`,
  ].join('\n');
  const r = await cindy.send({ type: 'cindy-request', kind: 'oneshot_text', prompt });
  if (!r || r.ok === false) {
    throw fail(r && r.errorCode === 'NO_CANDIDATE' ? 'NO_QUICK_MODEL' : 'ASK_FAILED', (r && r.message) || 'No answer');
  }
  return str(r.text);
}

const running = new Map();
const TERMINAL = /complete|succeed|success|done|finish|fail|error|cancel|abort|stop|interrupt/i;

function messageText(m) {
  if (!m) return '';
  if (typeof m.text === 'string') return m.text;
  if (typeof m.content === 'string') return m.content;
  const parts = Array.isArray(m.content) ? m.content : Array.isArray(m.parts) ? m.parts : [];
  return parts.map((p) => (typeof p === 'string' ? p : p && typeof p.text === 'string' ? p.text : '')).join('');
}

async function lastReply(taskId, since) {
  const page = await cindy.tasks.readMessages({ taskId, limit: 30 });
  const msgs = (page && (page.messages || page.items)) || [];
  let best = null;
  for (const m of msgs) {
    if (!/assistant/i.test(String(m.role || m.kind || ''))) continue;
    const t = Date.parse(m.createdAt || m.created_at || m.at || '') || 0;
    if (since && t && t < Date.parse(since)) continue;
    if (!best || t >= best.t) best = { t, text: messageText(m) };
  }
  return best ? best.text.trim() : '';
}

/* 宿主语言：只用于侧栏任务标题和自动化名称。不支持或取不到时按英文。 */
const TASK_NAMES = {
  'zh-CN': { app: '通讯录', tidy: '整理', schedule: '整理通讯录' },
  en: { app: 'Contacts', tidy: 'Tidy-up', schedule: 'Tidy up contacts' },
  ja: { app: '連絡先', tidy: '整理', schedule: '連絡先を整理' },
  ko: { app: '연락처', tidy: '정리', schedule: '연락처 정리' },
};
async function taskNames() {
  // 不缓存：用户在 Cindy 里切换语言后，下一个任务就用新语言命名。
  try {
    if (typeof cindy.request !== 'function') return TASK_NAMES.en;
    // 宿主不回应时不能卡住发任务：3 秒取不到就按英文。
    const r = await Promise.race([cindy.request({ kind: 'app-context' }), new Promise((resolve) => setTimeout(() => resolve(null), 3000))]);
    const l = r && r.ok && r.context && r.context.locale;
    return TASK_NAMES[l] || TASK_NAMES.en;
  } catch (_) {
    return TASK_NAMES.en;
  }
}

/** 每个人一个固定任务（全局整理共用一个）；再问都发到同一个任务里。 */
async function taskFor(key, title, fresh) {
  const saved = fresh ? null : await getMeta(`task:${key}`);
  if (saved && saved.taskId) {
    try {
      const t = await cindy.tasks.get({ taskId: saved.taskId });
      if (t && t.revision !== undefined) {
        const view = { taskId: saved.taskId, revision: t.revision, permissionMode: t.permissionMode };
        return ensureAutoReview(key, saved, view);
      }
    } catch (_) {
      /* 任务被删了：新建一个 */
    }
  }
  const t = await cindy.tasks.create({ requestKey: `${key}-${uuid()}`, title: title.slice(0, 100) });
  const record = { taskId: t.taskId, at: nowIso() };
  await batch([setMetaStmt(`task:${key}`, record)]);
  return ensureAutoReview(key, record, { taskId: t.taskId, revision: t.revision, permissionMode: t.permissionMode });
}

/**
 * 整理要连续调用邮件、飞书、日历和本插件的工具；任务停在「每步都问」时，每调一次都要用户点一下。
 * 每个任务第一次使用时请宿主弹一次确认，把它切到「自动审查」（插件拿不到完全访问）。
 * 用户拒绝后宿主不会再自动弹，这里也只问一次。
 */
async function ensureAutoReview(key, record, view) {
  const mode = String(view.permissionMode || '');
  if (mode === 'auto') {
    const known = await getMeta('auto_access');
    if (!known || !known.granted) await batch([setMetaStmt('auto_access', { granted: true, at: nowIso() })]);
    return view;
  }
  if (record.autoAsked || typeof cindy.tasks.requestWriteAccess !== 'function') return view;
  let granted = false;
  try {
    const r = await cindy.tasks.requestWriteAccess({ taskId: view.taskId, mode: 'auto' });
    granted = !!(r && (r.granted || (r.task && r.task.permissionMode === 'auto')));
  } catch (e) {
    // 任务正忙、宿主没准备好时还没问过用户，下次再问；其它情况（拒绝、不支持）不再打扰。
    if (e && (e.code === 'TASK_BUSY' || e.code === 'HOST_NOT_READY')) return view;
  }
  // 用户没同意时页面要说清楚：整理会每步确认，以及去哪里改。
  await batch([setMetaStmt(`task:${key}`, { ...record, autoAsked: true }), setMetaStmt('auto_access', { granted, at: nowIso() })]);
  try {
    const t = await cindy.tasks.get({ taskId: view.taskId });
    if (t && t.revision !== undefined) return { ...view, revision: t.revision, permissionMode: t.permissionMode };
  } catch (_) {
    /* 用原来的 revision */
  }
  return view;
}

async function sendToTask(key, title, text, info) {
  if (!(await tasksAvailable())) throw fail('UNSUPPORTED', '当前 Cindy 版本不支持由插件新建任务');
  if (running.has(key) && running.get(key).status === 'running') throw fail('BUSY', '上一件事还在处理，等它完成再说。');
  let t = await taskFor(key, title);
  const sentAt = nowIso();
  let run;
  try {
    run = await cindy.tasks.send({ taskId: t.taskId, expectedRevision: t.revision, requestKey: `${key}-${uuid()}`, text });
  } catch (e) {
    // 用户把这个任务改成了插件不能使用的权限（如完全访问），或任务配置刚变过：
    // 旧任务留给用户，新开一个继续。
    if (!e || !['PERMISSION_DENIED', 'REVISION_CONFLICT', 'TASK_NOT_FOUND', 'TASK_BUSY'].includes(e.code)) throw e;
    if (e.code === 'TASK_BUSY' && !/Archived/i.test(String(e.message))) throw e;
    t = await taskFor(key, title, true);
    run = await cindy.tasks.send({ taskId: t.taskId, expectedRevision: t.revision, requestKey: `${key}-${uuid()}`, text });
  }
  const entry = { key, taskId: t.taskId, runId: (run && (run.runId || run.id)) || '', status: 'running', sentAt, reply: '', ...info };
  running.set(key, entry);
  broadcast({ kind: 'event', name: 'task', data: entry });
  if (entry.contactId && entry.question) {
    await pushQa(entry.contactId, { key: `${key}@${sentAt}`, q: entry.question, a: '', at: sentAt, via: 'task', status: 'running', taskId: t.taskId });
  }
  watchRun(entry);
  return entry;
}

/** 轮询任务进度，结束后把 AI 的最后一条回复取回来，画回页面。 */
function watchRun(entry) {
  let tries = 0;
  const finish = async (status) => {
    try {
      entry.reply = (await lastReply(entry.taskId, entry.sentAt)).slice(0, 6000);
    } catch (_) {
      entry.reply = '';
    }
    entry.status = status;
    if (entry.key === 'maintain' || entry.purpose === 'backfill') {
      await serial(async () => {
        const m = (await getMeta('maintenance')) || {};
        // 只认同一范围（单人回补还要是同一个人）的收尾，别的整理恰好结束不算
        const ended = (m.runs || []).some(
          (r) => r.at >= entry.sentAt && (entry.contactId ? r.scope === 'contact' && r.contactId === entry.contactId : r.scope === entry.purpose),
        );
        await batch([
          setMetaStmt('last_tidy', {
            at: nowIso(),
            purpose: entry.purpose || '',
            contactId: entry.contactId || '',
            status: status === 'done' && !ended ? 'incomplete' : status,
            reply: entry.reply.slice(0, 600),
          }),
        ]);
      }).catch(() => {});
    }
    if (entry.contactId && entry.question) {
      await serial(() =>
        pushQa(entry.contactId, { key: `${entry.key}@${entry.sentAt}`, q: entry.question, a: entry.reply, at: entry.sentAt, via: 'task', status, taskId: entry.taskId }),
      ).catch(() => {});
    }
    broadcast({ kind: 'event', name: 'task', data: entry });
    notifyChanged();
  };
  const tick = async () => {
    tries += 1;
    let status = '';
    if (entry.runId) {
      try {
        const r = await cindy.tasks.getRun({ runId: entry.runId });
        status = String((r && (r.status || r.state || (r.run && r.run.status))) || '');
      } catch (_) {
        status = '';
      }
    }
    if (status && TERMINAL.test(status) && !/running|queued|pending|reconcil|progress/i.test(status)) {
      return finish(/fail|error|cancel|abort|interrupt/i.test(status) ? 'failed' : 'done');
    }
    if (tries >= 360) return finish('unknown');
    setTimeout(tick, tries < 20 ? 3000 : 10000);
  };
  setTimeout(tick, 3000);
}

const DRAFT_RE = /(写|起草|拟|回).{0,8}(邮件|信|email)|草稿|draft|e-?mail/i;
/** 删改档案的请求：快速通道只能读，直接交给能写档案的任务。 */
const EDIT_RE =
  // 只认明确要动手的说法；「不对」「错了」这类评价交给快速通道带着上文判断，真要改时它会转交。
  /删|去掉|移除|改成|改为|改一下|更正|纠正|没这事|没有这回事|标记(成|为)|关掉|合并|\b(delete|remove|close|merge|didn'?t happen)\b|削除|消して|修正して|삭제|지워|수정해/i;
const ACTION_RE =
  /回补|补全|往前补|去查|查一下|查查|搜一下|找一下|帮我(发|约|安排|问)|发给|提醒|\b(check|look ?up|search|find|backfill|schedule|remind|send|book|arrange)\b|調べ|探し|確認して|予定|送って|リマインド|찾아|확인해|검색|일정|보내|알려/i;

/**
 * 人物页的提问：只问这个人的事就用快速通道当场回答；写邮件、去各渠道查、回补这类要动用别的插件的事，
 * 发到这个人的固定任务里，结果读回页面。
 */
async function ask(input) {
  const text = str(input.text);
  if (!text) throw fail('INVALID_PARAMS', 'text is required');
  const contactId = str(input.contactId);
  if (!contactId) {
    return sendToTask('general', (await taskNames()).app, `${text}\n\n请使用 ${CHANNEL} 插件的工具（ghost_call，ghost_id 为 ${CHANNEL}）查询和修改通讯录。`, { purpose: 'general' });
  }
  const d = await getContact(contactId, { interactionLimit: 60, eventLimit: 30 });
  const wantsDraft = DRAFT_RE.test(text);
  const talk = await recentTalk(d.id);
  // 问句（「她这样做不对吗？」）不按关键词直接交给会改档案的任务；快速通道带着上文，真要改时会转交。
  // 句尾问号或语气词，或「删不删」「要不要」「是不是」这类正反问
  const isQuestion = /[?？吗嘛呢]$/.test(text.replace(/[\s。.!！~～…]+$/, '')) || /(\S)不\1|要不要|是不是|该不该|能不能|需不需要/.test(text);
  const useTask = input.mode === 'task' || wantsDraft || (EDIT_RE.test(text) && !isQuestion) || ACTION_RE.test(text);
  if (!useTask) {
    try {
      const answer = await quickAsk(d, text, talk);
      // 快速通道判断要动手：不记这句记号，改走任务
      // 整句就是记号才转交；回答里引用到这个字面量不算
      if (answer.replace(/^[\s`'"“”「」]+|[\s`'"“”「」。.]+$/g, '') !== HANDOFF) {
        const entry = { key: `quick@${nowIso()}`, q: text, a: answer, at: nowIso(), via: 'quick', status: 'done' };
        await pushQa(d.id, entry);
        return { kind: 'answer', ...entry };
      }
    } catch (e) {
      if (e.code !== 'NO_QUICK_MODEL') throw e;
      // 没有可用的快速通道：改走任务。
    }
  }
  const prompt = [
    `关于通讯录里的「${d.name}」（${CHANNEL} 档案 id：${d.id}）：${text}`,
    ...(talk ? ['', '这句话接着人物页上之前的对话（「对」「帮我删了」这类指的就是上文说的那件事）：', talk] : []),
    '',
    `先用 ghost_call({ ghost_id: "${CHANNEL}", tool: "get", args: { id: "${d.id}" } }) 读这个人的档案和往来。`,
    '只有用户明确要求删除、修改或更正（如「删了」「改成…」「关掉」，或对你上一句确认问题回答「对」）时才直接改，不要再问确认；用户只是在问要不要改、征求意见时，只回答和给建议，不改档案。要改时：还没完的事用 save 的 close_loops 关掉（id 来自 get，detail 写清是用户说没有这回事还是已完成），说错的内容用 save 改写；只有删除整个人才需要用户明确说要删这个人。改完一句话说改了什么。',
    wantsDraft
      ? '写邮件：用已安装的邮件插件只创建草稿，不要发送。回复已有往来时接在原邮件串里，并先确认这串往来在哪个邮箱账号里、用同一个账号。最终回复只写：草稿所在账号、收件人、主题和正文全文。'
      : '需要时去邮件、飞书、日历里查；查到的新往来用 record 记进档案，必要时用 save 更新 summary、narrative、latest 和还没完的事。最终回复简短，第一句给结论。',
  ].join('\n');
  const entry = await sendToTask(`c:${d.id}`, `${(await taskNames()).app} · ${d.name}`, prompt, { purpose: wantsDraft ? 'draft' : 'ask', contactId: d.id, question: text });
  return { ...entry, kind: 'task' };
}

/** 页面上的「整理最近 N 天 / 往前补 / 补这个人更早的往来」，都交给 AI 按时间段去做。 */
async function tidy(input) {
  const scope = ['recent', 'backfill', 'contact'].includes(input.scope) ? input.scope : 'recent';
  const settings = await getSettings();
  const months = Number(input.months) || settings.backfillMonths;
  if (scope === 'contact') {
    const c = await requireContact(input.contactId);
    const text = [
      `回补通讯录里「${c.display_name}」更早的往来。`,
      `先读整理手册：ghost_manual({ ghost_id: "${CHANNEL}", path: "tidy" })，照它做。`,
      `1. 调用 ghost_call({ ghost_id: "${CHANNEL}", tool: "maintenance", args: { action: "begin", scope: "contact", contact_id: "${c.id}", months: ${months} } })。`,
      '2. 按返回的时间段和来源说明，只用这个人的身份和名字去查；查到的往来用 record 记下（contact_id 用上面的 id）。',
      '3. 用 save 重写这个人的 summary、narrative、facts、latest，并整理还没完的事。',
      '4. 调用 maintenance，action 为 "end"，带上 run_id 和 coverage（每个来源读全了没有、哪里没读完）。最终回复一句话说补到了哪天、多了几条往来。',
    ].join('\n');
    return sendToTask(`c:${c.id}`, `${(await taskNames()).app} · ${c.display_name}`, text, { purpose: 'backfill', contactId: c.id, question: `往前补 ${months} 个月` });
  }
  const text = [
    scope === 'recent' ? '整理我的通讯录：把最近的往来整理进去。' : `回补我的通讯录：往前补 ${months} 个月的往来。`,
    `先读整理手册：ghost_manual({ ghost_id: "${CHANNEL}", path: "tidy" })，照它做；这个任务专门用来维护我的通讯录，我在这里追问时按手册「用户在这个任务里追问时」一节回答。`,
    `1. 调用 ghost_call({ ghost_id: "${CHANNEL}", tool: "maintenance", args: { action: "begin", scope: "${scope}"${scope === 'backfill' ? `, months: ${months}` : ''} } })，先按返回的 first_step 检查并报告来源。`,
    '2. 按返回的时间段（segments，新的在前）和来源说明逐段查找；与我真实往来的人，用 record 记下每条往来。',
    '3. 有新往来的人：get 之后用 save 更新 summary、narrative、latest、facts 和还没完的事；值得记的真人没有档案就新建，明显重复的直接 merge 并写 reason。先写来往最多的人。',
    '4. 最后调用 maintenance，action 为 "end"，带上 run_id、数量和 coverage（每个来源读全了没有、哪里没读完）。',
    '最终回复只写两行：第一行「整理了 N 个人」（或为什么没整理成）；第二行写哪些来源没读到、为什么，都读到了就不写。',
  ].join('\n');
  const n = await taskNames();
  return sendToTask('maintain', `${n.app} · ${n.tidy}`, text, { purpose: scope });
}

/* ───────────── 广播与主视图请求 ───────────── */

let channel = null;
function broadcast(message) {
  try {
    if (!channel) channel = new BroadcastChannel(CHANNEL);
    channel.postMessage(message);
  } catch (_) {
    /* 没有页面在听时忽略 */
  }
}

function notifyChanged() {
  broadcast({ kind: 'event', name: 'changed' });
  scheduleDeviceSync(2000);
}

async function viewState() {
  const s = state.ready ? await stats() : null;
  return {
    deviceSync: { ...syncStatus, enabled: state.ready ? !!await getMeta('device_sync_enabled') : false },
    ready: state.ready,
    error: state.error,
    importing: state.importing,
    progress: state.progress,
    legacy: state.legacy,
    systemImport: state.ready ? await getMeta('system_import') : null,
    platform: await platform(),
    stats: s,
    tasks: await tasksAvailable(),
    schedule: !!(cindy.agent && typeof cindy.agent.requestSchedule === 'function'),
    settings: state.ready ? await getSettings() : null,
    maintenance: state.ready ? await getMeta('maintenance') : null,
    automationRequested: state.ready ? await getMeta('automation_requested') : null,
    coverage: state.ready ? await getMeta('coverage') : null,
    sourcesStatus: state.ready ? await getMeta('sources_status') : null,
    autoAccess: state.ready ? await getMeta('auto_access') : null,
    lastTidy: state.ready ? await getMeta('last_tidy') : null,
    view: state.ready ? await getMeta('view') : null,
    running: [...running.values()].filter((r) => r.status === 'running'),
  };
}

/** 记下用户这次打开的时间；「上次看过之后」以前一次打开为准（半小时内反复打开不算新的一次）。 */
async function opened() {
  const view = (await getMeta('view')) || {};
  const now = Date.now();
  if (!view.current || now - Date.parse(view.current) > 30 * 60000) {
    const next = { prev: view.current || '', current: isoOf(now) };
    await batch([setMetaStmt('view', next)]);
    return next;
  }
  return view;
}

const VIEW_METHODS = {
  state: () => viewState(),
  list: async () => ({ contacts: await listContacts(), groups: await listGroups() }),
  get: (p) => getContact(p.id),
  save: (p) => saveContact(p),
  logEvent: (p) => logEvent(p),
  deleteEvent: (p) => deleteEvent(p.id),
  relate: (p) => relate(p),
  organize: (p) => organize(p),
  merge: (p) => mergeContacts(p),
  delete: (p) => deleteContact(p.id),
  groups: (p) => manageGroups(p),
  duplicates: () => findDuplicates(),
  importSystem: (p) => importSystem(p),
  importLegacy: () => importLegacy({ force: true }),
  ask: (p) => ask(p),
  qa: (p) => getQa(str(p.contactId)),
  tidy: (p) => tidy(p),
  unmerge: (p) => undoMerge(p.id),
  loop: (p) => setLoopStatus(p),
  opened: () => opened(),
  settings: (p) => setSettings(p || {}),
  requestAutomation: () => requestAutomation(),
};
const MUTATING = new Set(['save', 'logEvent', 'deleteEvent', 'relate', 'organize', 'merge', 'delete', 'groups', 'importSystem', 'importLegacy', 'unmerge', 'loop']);

const answered = new Map();
function startViewChannel() {
  let listen;
  try {
    listen = new BroadcastChannel(CHANNEL);
  } catch (_) {
    return;
  }
  listen.onmessage = (ev) => {
    const msg = ev.data;
    if (!msg || msg.kind !== 'req' || typeof msg.id !== 'string') return;
    // 页面会按 id 重发直到收到回执；同一 id 只执行一次。
    if (answered.has(msg.id)) {
      const prev = answered.get(msg.id);
      if (prev) broadcast(prev);
      return;
    }
    answered.set(msg.id, null);
    const handler = VIEW_METHODS[msg.method];
    const run = async () => {
      if (!handler) throw fail('INVALID_PARAMS', `unknown method ${msg.method}`);
      // 状态查询不排队：导入进行中时页面要靠它显示进度。
      if (msg.method === 'state') {
        if (!state.ready) ensureReady().catch(() => {});
        else if (!pendingImport) maybeAutoSyncMac();
        return handler(msg.params || {});
      }
      await ensureReady();
      if (pendingImport) await pendingImport;
      return serial(() => handler(msg.params || {}));
    };
    run()
      .then((result) => ({ kind: 'res', id: msg.id, ok: true, result }))
      .catch((e) => ({ kind: 'res', id: msg.id, ok: false, error: { code: e.code || 'INTERNAL', message: e.message, extra: e.extra } }))
      .then((res) => {
        answered.set(msg.id, res);
        setTimeout(() => answered.delete(msg.id), 60000);
        broadcast(res);
        if (res.ok && MUTATING.has(msg.method)) notifyChanged();
      });
  };
}

/* ───────────── AI 工具 ───────────── */

const arr = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);

const TOOLS = {
  find: (a) => findContacts(a.query, a.limit).then((results) => ({ results })),
  get: (a) => getContact(a.id),
  list: async (a) => {
    let rows = await listContacts();
    if (str(a.group)) rows = rows.filter((r) => r.groups.includes(str(a.group)));
    if (a.status === 'pending' || a.status === 'confirmed') rows = rows.filter((r) => r.status === a.status);
    if (a.kind === 'person' || a.kind === 'org') rows = rows.filter((r) => r.kind === a.kind);
    const offset = Math.max(0, Number(a.offset) || 0);
    const limit = Math.min(200, Math.max(1, Number(a.limit) || 50));
    return { total: rows.length, offset, contacts: rows.slice(offset, offset + limit) };
  },
  save: (a) =>
    saveContact({
      id: a.id,
      name: a.name,
      kind: a.kind,
      aliases: arr(a.aliases),
      removeAliases: arr(a.remove_aliases),
      summary: a.summary,
      narrative: a.narrative,
      agentNotes: a.agent_notes,
      status: a.status,
      identities: arr(a.identities),
      removeIdentityIds: arr(a.remove_identity_ids),
      groups: arr(a.groups),
      facts: a.facts === undefined ? undefined : arr(a.facts),
      latest: a.latest,
      openLoops: arr(a.open_loops),
      closeLoops: arr(a.close_loops),
      source: 'agent',
      allowDuplicate: !!a.allow_duplicate,
    }),
  record: (a) =>
    recordInteractions(
      (Array.isArray(a.items) ? a.items : []).map((x) => ({
        contactId: x.contact_id,
        identity: x.identity,
        email: x.email,
        name: x.name,
        occurredAt: x.occurred_at,
        channel: x.channel,
        title: x.title,
        summary: x.summary,
        quote: x.quote,
        link: x.link,
        ref: x.ref,
      })),
    ),
  log_event: (a) => logEvent({ contactId: a.contact_id, date: a.date, text: a.text, source: a.source || 'agent' }),
  relate: (a) => relate({ fromId: a.from_id, toId: a.to_id, relation: a.relation, note: a.note, remove: !!a.remove }),
  organize: (a) => organize({ action: a.action, contactIds: arr(a.contact_ids), group: a.group }),
  merge: (a) => mergeContacts({ sourceId: a.source_id, targetId: a.target_id, reason: a.reason }),
  delete: (a) => {
    if (a.confirm !== true) throw fail('CONFIRM_REQUIRED', '删除不可恢复：确认用户明确要求后，传 confirm:true 再调用');
    return deleteContact(a.id);
  },
  groups: (a) => manageGroups({ action: a.action, name: a.name, newName: a.new_name, description: a.description }),
  find_duplicates: () => findDuplicates(),
  import_macos: (a) => importSystem({ dryRun: a.dry_run !== false, group: a.group }),
  stats: () => stats(),
  save_many: (a) =>
    saveMany(
      (Array.isArray(a.items) ? a.items : []).map((x) => ({
        id: x.id,
        name: x.name,
        kind: x.kind,
        aliases: arr(x.aliases),
        summary: x.summary,
        narrative: x.narrative,
        agentNotes: x.agent_notes,
        status: x.status,
        identities: arr(x.identities),
        groups: arr(x.groups),
        facts: x.facts === undefined ? undefined : arr(x.facts),
        latest: x.latest,
        openLoops: arr(x.open_loops),
        source: 'agent',
        allowDuplicate: !!x.allow_duplicate,
      })),
    ),
  maintenance: (a) =>
    maintenance({
      action: a.action,
      scope: a.scope,
      contactId: a.contact_id,
      months: a.months,
      runId: a.run_id,
      sourcesStatus: a.sources_status,
      coverage: a.coverage,
      backlogDone: a.backlog_done,
      checkpoint: a.checkpoint,
      scanned: a.scanned,
      created: a.created,
      updated: a.updated,
      pending: a.pending,
      note: a.note,
    }),
};
const MUTATING_TOOLS = new Set(['save', 'save_many', 'record', 'log_event', 'relate', 'organize', 'merge', 'delete', 'groups', 'import_macos', 'maintenance']);

let pendingImport = null;
// 宿主保留的错误码不能由插件写入（与 Cindy 的 GHOST_HOST_ERROR_CODES 一致）。
const HOST_ERROR_CODES = new Set(['GHOST_NOT_FOUND', 'GHOST_ASLEEP', 'GHOST_DISABLED_IN_WORKDIR', 'TOOL_NOT_FOUND', 'GHOST_CRASHED', 'TIMEOUT', 'ATTACHMENT_INVALID', 'DIR_INVALID', 'INTERNAL']);

cindy.onHostMessage(async (msg) => {
  if (!msg || msg.type !== 'tool-call') return;
  const handler = TOOLS[msg.tool];
  try {
    if (!handler) throw fail('UNKNOWN_TOOL', `unknown tool ${msg.tool}`);
    await ensureReady();
    if (pendingImport) await pendingImport;
    const result = await serial(() => handler(msg.args || {}));
    await cindy.send({ type: 'tool-result', callId: msg.callId, ok: true, result });
    if (MUTATING_TOOLS.has(msg.tool) && !(msg.tool === 'import_macos' && result && result.dryRun)) notifyChanged();
  } catch (e) {
    const extra = e.extra ? ` ${JSON.stringify(e.extra)}` : '';
    await cindy.send({
      type: 'tool-result',
      callId: msg.callId,
      ok: false,
      errorCode: e.code && /^[A-Z][A-Z0-9_]{0,63}$/.test(e.code) && !HOST_ERROR_CODES.has(e.code) ? e.code : 'CONTACTS_ERROR',
      message: `${e.message}${extra}`,
    });
  }
});

/* ───────────── 启动 ───────────── */

let legacyKicked = false;
/** 首次启动：资料库为空且找得到旧版通讯录时，自动复制一份。排在串行队列最前面。 */
function startLegacyImportOnce() {
  if (legacyKicked) return;
  legacyKicked = true;
  pendingImport = serial(() => importLegacy())
    .catch((e) => ({ status: 'error', code: e.code, message: e.message }))
    .then(async (r) => {
      try {
        syncStatus.enabled = !!await getMeta('device_sync_enabled');
        if (syncStatus.supported && syncStatus.enabled) await serial(syncCapture);
      } catch (e) { syncStatus.error = { code: e.code || 'SYNC_UNAVAILABLE', message: e.message }; }
      pendingImport = null;
      broadcast({ kind: 'event', name: 'legacy', data: r });
      notifyChanged();
    });
}

startViewChannel();
ensureReady().catch(() => {});

/* ───────────── 同账号电脑同步：字段寄存器 + 独立删除标记 ───────────── */
// Only business data crosses devices. Tasks, source cursors, settings and imports stay local.
const SYNC_TABLES = {
  contacts: 'id kind display_name aliases summary narrative agent_notes status source created_at updated_at facts latest latest_at covered_from',
  contact_identities: 'id contact_id platform value normalized_value label note created_at',
  contact_events: 'id contact_id date text source created_at',
  contact_groups: 'id name description created_at',
  contact_group_members: 'group_id contact_id',
  contact_relations: 'id from_id to_id relation note created_at',
  contact_interactions: 'id contact_id occurred_at channel title summary quote link ref created_at',
  contact_loops: 'id contact_id text detail status since source created_at updated_at',
  contact_merges: 'id target_id source_id source_name reason snapshot at undone_at',
};
const SYNC_MAX = 12 * 1024 * 1024;
const SYNC_CHUNK = 8000; // UTF-16; JSON escaping still checked against the Host's byte bound.
const syncStatus = { supported: typeof cindy.deviceSync === 'function', enabled: false, phase: 'off', lastAt: null, error: null, peers: [] };
let syncBusy = false;
let syncTimer = null;
const syncTransfers = new Map();
const syncCompare = (a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
const syncKey = (table, row) => JSON.stringify(table === 'contact_group_members' ? [row.group_id, row.contact_id] : [row.id]);
const syncClone = (v) => JSON.parse(JSON.stringify(v));
const syncEmpty = () => ({ version: 1, node: uuid(), clock: 0, tables: {}, projection: {}, origins: {}, contactLinks: [] });

async function syncReadRows() {
  const out = {};
  for (const [table, columns] of Object.entries(SYNC_TABLES)) out[table] = await qAll(`SELECT ${columns.split(' ').join(', ')} FROM ${table} ORDER BY ${table === 'contact_group_members' ? 'group_id, contact_id' : 'id'}`);
  return out;
}

/** Compare with the last committed projection, including after a crash or upgrade. */
async function syncCapture({ deletedContactId = null } = {}) {
  const stored = await q("SELECT value FROM plugin_meta WHERE key = 'device_sync_state'");
  let saved = null;
  if (stored.length) {
    try { saved = JSON.parse(stored[0].value); syncValidate(saved); if (!saved.projection || !saved.origins || !Number.isSafeInteger(saved.clock) || saved.clock < 0 || !/^[a-f0-9-]{36}$/.test(saved.node)) throw Error('invalid'); }
    catch (_) { throw fail('SYNC_CORRUPT', '本机同步记录无法读取，已暂停同步并保留通讯录资料。'); }
  }
  if (deletedContactId && !saved) return null; // Never initialize sync for a local-only delete.
  const s = saved || syncEmpty();
  if (s.version !== 1) throw fail('SYNC_VERSION', '同步数据版本不兼容，请更新两台电脑上的通讯录插件。');
  const rows = await syncReadRows();
  if (deletedContactId) for (const table of Object.keys(SYNC_TABLES)) {
    rows[table] = rows[table].filter(row => table === 'contacts' ? row.id !== deletedContactId :
      !['contact_id', 'from_id', 'to_id', 'target_id', 'source_id'].some(col => row[col] === deletedContactId));
  }
  // Remember prior automatic reconciliation even when its shared identity is removed.
  const links = Object.values(s.origins.contacts || {}).flatMap(keys => keys.slice(1).map(key => [JSON.parse(keys[0])[0], JSON.parse(key)[0]]));
  const contactLinks = syncMergeLinks(s.contactLinks || [], links);
  let changed = !saved || JSON.stringify(contactLinks) !== JSON.stringify(s.contactLinks);
  s.contactLinks = contactLinks;
  const tick = (value) => { if (!saved) return [0, s.node, value]; if (s.clock >= Number.MAX_SAFE_INTEGER - 1) throw fail('SYNC_CLOCK', '同步版本计数已达上限。'); return [++s.clock, s.node, value]; };
  for (const table of Object.keys(SYNC_TABLES)) {
    const stateRows = s.tables[table] || (s.tables[table] = {});
    const before = new Map((s.projection[table] || []).map(r => [syncKey(table, r), r]));
    const after = new Map(rows[table].map(r => [syncKey(table, r), r]));
    for (const [key, row] of after) {
      const old = before.get(key);
      const targets = s.origins[table]?.[key] || [key];
      if (!old) {
        // A user-created/restored row deliberately revives its id. Ordinary edits never do.
        for (const target of targets) {
          const entry = stateRows[target] || (stateRows[target] = { alive: tick(true), fields: {} });
          if (!entry.alive[2] || entry.pruned) entry.alive = tick(true);
          delete entry.pruned;
          for (const [col, value] of Object.entries(row)) entry.fields[col] = tick(col === 'id' ? JSON.parse(target)[0] : value);
        }
        changed = true;
      } else {
        for (const [col, value] of Object.entries(row)) if (old[col] !== value) {
          for (const target of targets) {
            stateRows[target].fields[col] = tick(value);
            if (table === 'contacts' && col === 'aliases' && targets.length > 1) stateRows[target].fields.display_name = tick(row.display_name);
          }
          changed = true;
        }
      }
    }
    for (const [key] of before) if (!after.has(key)) {
      for (const target of s.origins[table]?.[key] || [key]) if (stateRows[target]) stateRows[target].alive = tick(false);
      changed = true;
    }
  }
  // Also compact snapshots saved by earlier versions. Tombstones need no content.
  for (const entries of Object.values(s.tables)) for (const entry of Object.values(entries)) {
    if (!entry.alive[2] && Object.keys(entry.fields).length) { entry.fields = {}; changed = true; }
  }
  if (syncPruneDeletedChildren(s)) changed = true;
  s.projection = rows;
  if (changed && !deletedContactId) await batch([setMetaStmt('device_sync_state', s)]);
  return s;
}

function syncMergeLinks(...sets) {
  return [...new Set(sets.flat().map(pair => JSON.stringify([...pair].sort())))].sort().map(key => JSON.parse(key));
}

function syncValidate(remote) {
  if (!remote || remote.version !== 1 || !remote.tables || typeof remote.tables !== 'object' || Array.isArray(remote.tables)) throw fail('SYNC_VERSION', '同步格式不兼容，请更新两台电脑上的通讯录插件。');
  if (remote.contactLinks !== undefined && (!Array.isArray(remote.contactLinks) || remote.contactLinks.some(pair => !Array.isArray(pair) || pair.length !== 2 || !pair.every(id => typeof id === 'string' && id.length > 0)))) throw fail('SYNC_INVALID', '同步归并关系无效，本机资料未更改。');
  const stamp = (s, boolean = false) => Array.isArray(s) && s.length === 3 && Number.isSafeInteger(s[0]) && s[0] >= 0 && s[0] < Number.MAX_SAFE_INTEGER - 1 && typeof s[1] === 'string' && /^[a-f0-9-]{36}$/.test(s[1]) && (boolean ? typeof s[2] === 'boolean' : typeof s[2] === 'string');
  for (const [table, rows] of Object.entries(remote.tables)) {
    if (!Object.hasOwn(SYNC_TABLES, table) || !rows || typeof rows !== 'object' || Array.isArray(rows)) throw fail('SYNC_INVALID', '收到的同步数据无效，本机资料未更改。');
    const cols = SYNC_TABLES[table].split(' ');
    for (const [key, entry] of Object.entries(rows)) {
      if (!entry || !stamp(entry.alive, true) || !entry.fields || typeof entry.fields !== 'object' || Array.isArray(entry.fields)) throw fail('SYNC_INVALID', '收到的同步数据无效，本机资料未更改。');
      let ids;
      try { ids = JSON.parse(key); } catch (_) { throw fail('SYNC_INVALID', '同步记录标识无效，本机资料未更改。'); }
      if (!Array.isArray(ids) || ids.length !== (table === 'contact_group_members' ? 2 : 1) || !ids.every(id => typeof id === 'string')) throw fail('SYNC_INVALID', '同步记录标识无效，本机资料未更改。');
      if (entry.pruned !== undefined) {
        const parents = cols.filter(c => ['contact_id', 'from_id', 'to_id'].includes(c));
        if (!entry.alive[2] || Object.keys(entry.fields).length || !parents.length || !entry.pruned || typeof entry.pruned !== 'object' || Array.isArray(entry.pruned) ||
            Object.keys(entry.pruned).length !== parents.length || !parents.every(c => Array.isArray(entry.pruned[c]) && entry.pruned[c].length === 2 && stamp([...entry.pruned[c], '']))) throw fail('SYNC_INVALID', '收到的同步数据无效，本机资料未更改。');
        continue;
      }
      if (!entry.alive[2] && Object.keys(entry.fields).length === 0) continue;
      // Accept old, full tombstones for migration; never retain their payload.
      if (Object.keys(entry.fields).length !== cols.length || !cols.every(c => Object.hasOwn(entry.fields, c) && stamp(entry.fields[c]))) throw fail('SYNC_INVALID', '收到的同步数据无效，本机资料未更改。');
      const row = Object.fromEntries(cols.map(c => [c, entry.fields[c][2]]));
      // Keys are immutable; mapped foreign keys may evolve during duplicate reconciliation.
      if (table !== 'contact_group_members' && syncKey(table, row) !== key) throw fail('SYNC_INVALID', '同步记录标识无效，本机资料未更改。');
      if (table === 'contact_group_members') { const k = JSON.parse(key); if (!Array.isArray(k) || k.length !== 2 || !k.every(x => typeof x === 'string')) throw fail('SYNC_INVALID', '同步分组标识无效。'); }
    }
  }
}

/** Remove offline additions whose parent deletion won, including old hidden rows. */
function syncPruneDeletedChildren(s) {
  // A manual merge tombstones its source but keeps a live redirect and undo data.
  // Preserve those children; syncProject handles redirects and opposing-merge conflicts.
  const mergedSources = new Set(Object.values(s.tables.contact_merges || {})
    .filter(e => e.alive[2] && !e.fields.undone_at[2]).map(e => e.fields.source_id[2]));
  let changed = false;
  for (const entries of Object.values(s.tables)) for (const entry of Object.values(entries)) {
    if (!entry.alive[2] || entry.pruned) continue;
    const deletedParents = ['contact_id', 'from_id', 'to_id'].flatMap(col => {
      const id = entry.fields[col]?.[2];
      const parent = s.tables.contacts?.[JSON.stringify([id])];
      return parent && !parent.alive[2] && !mergedSources.has(id) ? [parent.alive] : [];
    });
    if (!deletedParents.length) continue;
    // This is derived cleanup, not an explicit deletion of the child. Keep only
    // ownership versions, so a later legitimate reassignment can supply its payload.
    entry.pruned = Object.fromEntries(['contact_id', 'from_id', 'to_id'].filter(c => entry.fields[c]).map(c => [c, entry.fields[c].slice(0, 2)]));
    entry.fields = {}; changed = true;
  }
  return changed;
}

function syncMergeEntry(existing, incoming) {
  if (!existing) return incoming.alive[2] ? syncClone(incoming) : { alive: syncClone(incoming.alive), fields: {} };
  const order = syncCompare(incoming.alive, existing.alive);
  const winner = order > 0 ? incoming : existing;
  if (!winner.alive[2]) return { alive: syncClone(winner.alive), fields: {} };
  if (existing.pruned && incoming.pruned) {
    if (order !== 0) return syncClone(winner);
    const pruned = Object.fromEntries(Object.keys(existing.pruned).map(c => [c, syncCompare(existing.pruned[c], incoming.pruned[c]) >= 0 ? existing.pruned[c] : incoming.pruned[c]]));
    return syncClone({ alive: winner.alive, fields: {}, pruned });
  }
  if (existing.pruned || incoming.pruned) {
    const pruned = existing.pruned ? existing : incoming, live = existing.pruned ? incoming : existing;
    const life = syncCompare(live.alive, pruned.alive);
    const reassigned = life === 0 && Object.entries(pruned.pruned).some(([c, version]) => syncCompare(live.fields[c], version) > 0);
    // A cleanup from an older lifecycle or ownership cannot erase a moved record.
    return syncClone(life > 0 || reassigned ? live : pruned);
  }
  const result = syncClone(existing); result.alive = syncClone(winner.alive);
  if (incoming.alive[2]) for (const [col, field] of Object.entries(incoming.fields)) if (!result.fields[col] || syncCompare(field, result.fields[col]) > 0) result.fields[col] = syncClone(field);
  return result;
}

/** Deterministic projection: identical identities/groups collapse, preserving all linked records. */
function syncProject(s) {
  const live = {}, parent = new Map();
  for (const table of Object.keys(SYNC_TABLES)) live[table] = Object.entries(s.tables[table] || {}).filter(([, e]) => e.alive[2] && !e.pruned).map(([key, e]) => ({ key, entry: e, row: Object.fromEntries(Object.entries(e.fields).map(([c, v]) => [c, v[2]])) }));
  for (const x of live.contacts) parent.set(x.row.id, x.row.id);
  const root = (id) => { let p = id; while (parent.has(p) && parent.get(p) !== p) p = parent.get(p); return p; };
  const links = [...(s.contactLinks || [])];
  const unite = (one, two) => {
    const a = root(one), b = root(two);
    if (a !== b) { parent.set(a < b ? b : a, a < b ? a : b); links.push([a, b]); }
  };
  for (const [a, b] of s.contactLinks || []) if (parent.has(a) && parent.has(b)) unite(a, b);
  const seen = new Map();
  for (const x of live.contact_identities) if (parent.has(x.row.contact_id)) {
    const key = JSON.stringify([x.row.platform, x.row.normalized_value]);
    if (seen.has(key)) unite(seen.get(key), x.row.contact_id);
    else seen.set(key, x.row.contact_id);
  }
  s.contactLinks = syncMergeLinks(links);
  // An offline addition to a merged source follows the retained target. Undo restores
  // the source row and removes this redirect without losing the offline addition.
  const redirects = live.contact_merges.filter(x => !x.row.undone_at).sort((a, b) => syncCompare(b.entry.fields.at, a.entry.fields.at) || (a.key < b.key ? -1 : 1));
  let redirected;
  do {
    redirected = false;
    for (const { row: r } of redirects) if (!parent.has(r.source_id) && parent.has(r.target_id)) {
      parent.set(r.source_id, root(r.target_id)); redirected = true;
    }
  } while (redirected);
  // Opposing offline merges can delete both targets. Stop atomically instead of
  // projecting an empty address book; undoing a merge on either device resolves it.
  if (redirects.some(({ row: r }) => !parent.has(r.target_id))) throw fail('SYNC_MERGE_CONFLICT', '联系人合并发生冲突，请先在一台电脑撤销对应合并后重试。');
  const groups = new Map(), groupIds = new Map();
  for (const x of live.contact_groups) { const old = groups.get(x.row.name); if (!old || x.row.id < old) groups.set(x.row.name, x.row.id); }
  for (const x of live.contact_groups) groupIds.set(x.row.id, groups.get(x.row.name));
  const output = {}, origins = {};
  for (const table of Object.keys(SYNC_TABLES)) {
    const buckets = new Map();
    for (const x of live[table]) {
      const r = { ...x.row };
      if (r.contact_id !== undefined) { if (!parent.has(r.contact_id)) continue; r.contact_id = root(r.contact_id); }
      if (table === 'contacts') r.id = root(r.id);
      if (table === 'contact_groups') r.id = groupIds.get(r.id);
      if (table === 'contact_group_members') { if (!groupIds.has(r.group_id)) continue; r.group_id = groupIds.get(r.group_id); }
      if (table === 'contact_relations') {
        if (!parent.has(r.from_id) || !parent.has(r.to_id)) continue;
        r.from_id = root(r.from_id); r.to_id = root(r.to_id); if (r.from_id === r.to_id) continue;
      }
      if (table === 'contact_merges' && parent.has(r.target_id)) r.target_id = root(r.target_id);
      const key = table === 'contact_identities' ? JSON.stringify([r.platform, r.normalized_value]) :
        table === 'contact_interactions' ? JSON.stringify([r.contact_id, r.ref]) :
        table === 'contact_relations' ? JSON.stringify([r.from_id, r.to_id, r.relation]) : syncKey(table, r);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ ...x, row: r });
    }
    output[table] = []; origins[table] = {};
    for (const items of buckets.values()) {
      items.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
      const row = { ...items[0].row };
      for (const col of SYNC_TABLES[table].split(' ')) {
        if (['id', 'contact_id', 'group_id', 'from_id', 'to_id', 'target_id'].includes(col)) continue;
        const winner = items.reduce((a, b) => syncCompare(a.entry.fields[col], b.entry.fields[col]) >= 0 ? a : b);
        row[col] = winner.row[col];
      }
      if (table === 'contacts' && items.length > 1) row.aliases = JSON.stringify(uniqueStrings(items.flatMap(x => [x.row.display_name, ...parseAliases(x.row.aliases)]).filter(n => n !== row.display_name)));
      output[table].push(row); origins[table][syncKey(table, row)] = items.map(x => x.key);
    }
    output[table].sort((a, b) => syncKey(table, a) < syncKey(table, b) ? -1 : 1);
  }
  return { rows: output, origins };
}

async function syncApply(remote) {
  syncValidate(remote);
  const s = await syncCapture();
  for (const [table, rows] of Object.entries(remote.tables)) {
    const local = s.tables[table];
    for (const [key, incoming] of Object.entries(rows)) {
      s.clock = Math.max(s.clock, incoming.alive[0], ...Object.values(incoming.fields).map(v => v[0]), ...Object.values(incoming.pruned || {}).map(v => v[0]));
      local[key] = syncMergeEntry(local[key], incoming);
    }
  }
  s.contactLinks = syncMergeLinks(s.contactLinks || [], remote.contactLinks || []);
  syncPruneDeletedChildren(s);
  const { rows, origins } = syncProject(s);
  s.projection = rows; s.origins = origins;
  if (JSON.stringify(s).length > SYNC_MAX) throw fail('SYNC_LIMIT', '通讯录同步数据超过当前上限，本机资料保留。');
  // One Host transaction, regardless of contact count. FK children are removed first.
  const tables = Object.keys(SYNC_TABLES);
  const writes = [...tables].reverse().map(table => ({ sql: `DELETE FROM ${table}`, params: [] }));
  for (const table of tables) {
    const cols = SYNC_TABLES[table].split(' ');
    writes.push({ sql: `INSERT INTO ${table} (${cols.join(',')}) SELECT ${cols.map(c => `json_extract(value, '$.${c}')`).join(',')} FROM json_each(?)`, params: [JSON.stringify(rows[table])] });
  }
  writes.push(setMetaStmt('device_sync_state', s));
  await batch(writes);
  notifyChanged();
}

async function syncSnapshot() {
  const s = await syncCapture();
  const tables = {};
  for (const table of Object.keys(SYNC_TABLES)) {
    tables[table] = {};
    for (const key of Object.keys(s.tables[table]).sort()) {
      const e = s.tables[table][key];
      tables[table][key] = { alive: e.alive, fields: e.alive[2] && !e.pruned ? Object.fromEntries(SYNC_TABLES[table].split(' ').map(c => [c, e.fields[c]])) : {}, ...(e.pruned ? { pruned: e.pruned } : {}) };
    }
  }
  const text = JSON.stringify({ version: 1, tables, contactLinks: s.contactLinks });
  if (text.length > SYNC_MAX) throw fail('SYNC_LIMIT', '通讯录同步数据超过当前上限，本机资料保留。');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return { text, digest: Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('') };
}

async function syncIncoming(peer, data) {
  if (!await getMeta('device_sync_enabled')) return { disabled: true };
  if (!data || data.version !== 1) return { error: 'SYNC_VERSION' };
  const now = Date.now();
  for (const [k, v] of syncTransfers) if (now - v.at > 120000) syncTransfers.delete(k);
  if (data.kind === 'hello') {
    const current = await syncSnapshot();
    return { digest: current.digest, want: current.digest !== data.digest };
  }
  if (data.kind !== 'chunk' || typeof data.digest !== 'string' || !/^[a-f0-9]{64}$/.test(data.digest) || !Number.isInteger(data.total) || data.total < 1 || data.total > Math.ceil(SYNC_MAX / SYNC_CHUNK) || !Number.isInteger(data.index) || data.index < 0 || data.index >= data.total || typeof data.text !== 'string' || data.text.length > SYNC_CHUNK) return { error: 'SYNC_INVALID' };
  let transfer = syncTransfers.get(peer);
  if (!transfer || transfer.digest !== data.digest) {
    if (data.index !== 0 || (!transfer && syncTransfers.size >= 2)) return { error: 'SYNC_RESTART' };
    transfer = { digest: data.digest, total: data.total, chunks: [], at: now };
    syncTransfers.set(peer, transfer);
  }
  if (transfer.total !== data.total || data.index > transfer.chunks.length) return { error: 'SYNC_RESTART' };
  transfer.chunks[data.index] = data.text; transfer.at = now;
  if (transfer.chunks.length < transfer.total) return { received: data.index };
  const text = transfer.chunks.join('');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const digest = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
  if (text.length > SYNC_MAX || digest !== data.digest) { syncTransfers.delete(peer); return { error: 'SYNC_INVALID' }; }
  await syncApply(JSON.parse(text));
  syncTransfers.delete(peer);
  syncStatus.lastAt = nowIso(); syncStatus.error = null;
  return { applied: true };
}

async function syncRequest(peer, data) {
  const r = await cindy.deviceSync({ op: 'request', peer, data: { version: 1, ...data } });
  if (!r?.ok) throw fail(r?.errorCode || 'SYNC_UNAVAILABLE', '设备同步暂时不可用，资料已保存在本机。');
  if (r.data?.error) throw fail(r.data.error, r.data.error === 'SYNC_VERSION' ? '同步数据版本不兼容，请更新两台电脑上的通讯录插件。' : '对方尚未接收本次同步，资料已保存在本机。');
  if (r.data?.disabled) throw fail('SYNC_PEER_DISABLED', '请在另一台电脑的通讯录设置中开启设备同步。');
  return r.data;
}

async function syncNow() {
  if (syncBusy) return syncStatus;
  syncBusy = true;
  try {
    await ensureReady(); if (pendingImport) await pendingImport;
    syncStatus.enabled = !!await getMeta('device_sync_enabled');
    if (!syncStatus.enabled) { syncStatus.phase = 'off'; return syncStatus; }
    if (!syncStatus.supported) { syncStatus.phase = 'unsupported'; return syncStatus; }
    const status = await cindy.deviceSync({ op: 'status' });
    if (!status?.ok) throw fail(status?.errorCode || 'SYNC_UNAVAILABLE', '当前无法连接设备同步，请检查 Cindy 登录状态和插件权限。');
    syncStatus.peers = status.peers || []; syncStatus.error = null;
    syncStatus.phase = syncStatus.peers.length ? 'syncing' : 'waiting';
    const snapshot = await serial(syncSnapshot);
    let success = syncStatus.peers.length > 0;
    for (const peer of syncStatus.peers) {
      try {
        const hello = await syncRequest(peer.deviceId, { kind: 'hello', digest: snapshot.digest });
        if (!hello || typeof hello.want !== 'boolean' || typeof hello.digest !== 'string' || !/^[a-f0-9]{64}$/.test(hello.digest)) throw fail('SYNC_INVALID', '对方返回的同步状态无效，资料已保存在本机。');
        if (hello.want) {
          const total = Math.ceil(snapshot.text.length / SYNC_CHUNK);
          for (let index = 0; index < total; index++) {
            if (!await getMeta('device_sync_enabled')) { syncStatus.phase = 'off'; return syncStatus; }
            const reply = await syncRequest(peer.deviceId, { kind: 'chunk', digest: snapshot.digest, index, total, text: snapshot.text.slice(index * SYNC_CHUNK, (index + 1) * SYNC_CHUNK) });
            if (index === total - 1 && !reply?.applied) throw fail('SYNC_UNCONFIRMED', '对方尚未确认保存。');
          }
        }
        if (hello.digest !== snapshot.digest) success = false;
      } catch (e) { success = false; syncStatus.error = { code: e.code || 'SYNC_UNAVAILABLE', message: e.message }; }
    }
    if (success && (await serial(syncSnapshot)).digest !== snapshot.digest) success = false;
    if (success) syncStatus.lastAt = nowIso();
    syncStatus.phase = !syncStatus.enabled ? 'off' : syncStatus.error || !syncStatus.peers.length ? 'waiting' : success ? 'synced' : 'syncing';
  } catch (e) { syncStatus.phase = 'error'; syncStatus.error = { code: e.code || 'SYNC_UNAVAILABLE', message: e.message }; }
  finally { syncBusy = false; broadcast({ kind: 'event', name: 'sync' }); }
  return syncStatus;
}

function scheduleDeviceSync(delay = 15000) {
  if (!syncStatus.supported || !syncStatus.enabled) return;
  if (syncTimer) { if (delay === 15000) return; clearTimeout(syncTimer); }
  syncTimer = setTimeout(async () => { syncTimer = null; await syncNow(); scheduleDeviceSync(); }, delay);
}

cindy.onHostMessage(async (msg) => {
  if (msg?.type !== 'device-sync-request' || typeof cindy.deviceSync !== 'function') return;
  let data;
  try {
    await ensureReady(); if (pendingImport) await pendingImport;
    data = await serial(() => syncIncoming(msg.peer, msg.data));
  } catch (e) { data = { error: e.code || 'SYNC_INVALID' }; }
  await cindy.deviceSync({ op: 'reply', requestId: msg.requestId, data }).catch(() => {});
});

VIEW_METHODS.deviceSync = async (p) => {
  if (typeof p.enabled === 'boolean') {
    await batch([setMetaStmt('device_sync_enabled', p.enabled)]);
    syncStatus.enabled = p.enabled;
    if (!p.enabled) { clearTimeout(syncTimer); syncTimer = null; syncTransfers.clear(); syncStatus.phase = 'off'; }
  }
  scheduleDeviceSync(0);
  return syncStatus;
};
