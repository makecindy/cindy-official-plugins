import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import vm from 'node:vm';

const pluginDir = path.resolve(import.meta.dirname, '..', 'cindy-contacts');
const mainSource = fs.readFileSync(path.join(pluginDir, 'main.js'), 'utf8');

/* ───────── 模拟宿主：Library SQL、Node worker、工具派发、BroadcastChannel ───────── */

function isReader(sql) {
  return /^\s*(SELECT|WITH)\b/i.test(sql);
}

const migrations = { count: 0 };

function makeLibrary(dir) {
  const dbs = new Map();
  const open = (dbPath) => {
    if (!dbs.has(dbPath)) {
      const db = new DatabaseSync(path.join(dir, dbPath));
      db.exec('PRAGMA foreign_keys = ON');
      dbs.set(dbPath, db);
    }
    return dbs.get(dbPath);
  };
  const bind = (params) => (Array.isArray(params) ? params : params && typeof params === 'object' ? [params] : []);
  const run = (db, sql, params) => {
    const stmt = db.prepare(sql);
    if (isReader(sql)) return { rows: stmt.all(...bind(params)).map((r) => ({ ...r })) };
    const out = stmt.run(...bind(params));
    return { changes: Number(out.changes) };
  };
  const library = async (req) => {
    try {
      switch (req.op) {
        case 'open':
          return { ok: true, state: 'ready' };
        case 'db.open':
          open(req.dbPath);
          return { ok: true };
        case 'db.exec': {
          const rows = run(open(req.dbPath), req.sql, req.params);
          if (rows.rows && rows.rows.length > 2000) return { ok: false, errorCode: 'DB_ROW_LIMIT', message: 'too many rows' };
          return { ok: true, op: 'db.exec', ...rows };
        }
        case 'db.batch': {
          const db = open(req.dbPath);
          assert.ok(req.statements.length <= 200, 'batch over 200 statements');
          db.exec('BEGIN');
          try {
            for (const st of req.statements) run(db, st.sql, st.params);
            db.exec('COMMIT');
          } catch (e) {
            db.exec('ROLLBACK');
            throw e;
          }
          return { ok: true, applied: req.statements.length };
        }
        case 'db.userVersion':
          return { ok: true, op: 'db.userVersion', version: Number(open(req.dbPath).prepare('PRAGMA user_version').get().user_version) };
        case 'db.migrate': {
          migrations.count += 1;
          const db = open(req.dbPath);
          const current = Number(db.prepare('PRAGMA user_version').get().user_version);
          for (const step of req.steps) {
            if (step.toVersion <= current) continue;
            db.exec('BEGIN');
            for (const sql of step.sql) db.prepare(sql).run();
            db.exec(`PRAGMA user_version = ${step.toVersion}`);
            db.exec('COMMIT');
          }
          return { ok: true };
        }
        default:
          return { ok: false, errorCode: 'UNSUPPORTED', message: req.op };
      }
    } catch (e) {
      return { ok: false, errorCode: 'DB_ERROR', message: e.message };
    }
  };
  library.close = () => {
    for (const db of dbs.values()) db.close();
  };
  library.db = (dbPath) => open(dbPath);
  return library;
}

function makeWorker(env, workerFile = path.join(pluginDir, 'node', 'worker.cjs')) {
  const child = spawn(process.execPath, ['--no-warnings', workerFile], {
    env: { PATH: process.env.PATH, ...env },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const pending = new Map();
  let next = 1;
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const msg = JSON.parse(line);
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    p(msg.error ? { ok: false, message: msg.error.message } : { ok: true, result: msg.result });
  });
  return {
    request: ({ method, params }) =>
      new Promise((resolve) => {
        const id = next++;
        pending.set(id, resolve);
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      }),
    close: () => child.kill(),
  };
}

function boot({ libDir, legacyDb = '', systemFixture = '', locale = '', deviceSync = null, timers = null }) {
  const library = makeLibrary(libDir);
  const worker = makeWorker({
    CINDY_CONTACTS_LEGACY_DB_FOR_TEST: legacyDb,
    CINDY_CONTACTS_SYSTEM_FIXTURE_FOR_TEST: systemFixture,
  });
  const listeners = [];
  const results = new Map();
  const waiters = new Map();
  const channels = [];
  class Channel extends BroadcastChannel {
    constructor(name) {
      super(name);
      channels.push(this);
    }
  }
  const schedules = [];
  const oneshots = [];
  const tasks = { created: [], sent: [], access: [], tooHigh: new Set(), reply: '已经记下了。', runStatus: 'completed', quick: { ok: true, text: '她在推进 Pi 清单。' } };
  const cindy = {
    ...(deviceSync ? { deviceSync } : {}),
    ...(locale ? { request: async (req) => (req.kind === 'app-context' ? { ok: true, context: { locale } } : { ok: false }) } : {}),
    tasks: {
      capabilities: async () => ({ operations: ['create', 'get', 'send', 'getRun', 'readMessages'] }),
      create: async (req) => {
        const taskId = `task-${tasks.created.length + 1}`;
        tasks.created.push({ ...structuredClone(req), taskId });
        return { taskId, revision: 1 };
      },
      get: async ({ taskId }) => {
        if (!tasks.created.some((t) => t.taskId === taskId)) throw new Error('NOT_FOUND');
        return { taskId, revision: tasks.sent.filter((x) => x.taskId === taskId).length + 1 };
      },
      send: async (req) => {
        if (tasks.tooHigh.has(req.taskId)) throw Object.assign(new Error('Task permission exceeds plugin dispatch policy'), { code: 'PERMISSION_DENIED' });
        tasks.sent.push(structuredClone(req));
        return { runId: `run-${tasks.sent.length}` };
      },
      requestWriteAccess: async (req) => {
        tasks.access.push(structuredClone(req));
        return { granted: tasks.grant !== false };
      },
      getRun: async () => ({ status: tasks.runStatus }),
      readMessages: async () => ({
        messages: [
          { role: 'user', text: 'q', createdAt: new Date(Date.now() - 1000).toISOString() },
          { role: 'assistant', content: [{ type: 'text', text: tasks.reply }], createdAt: new Date(Date.now() + 1000).toISOString() },
        ],
      }),
    },
    library,
    node: { request: worker.request },
    agent: {
      requestSchedule: async (req) => {
        schedules.push(structuredClone(req));
        return { ok: true };
      },
    },
    onHostMessage: (cb) => listeners.push(cb),
    send: async (raw) => {
      // 真实宿主经 IPC 结构化克隆传递；这里同样克隆，脱离沙箱 realm。
      const m = structuredClone(raw);
      if (m.type === 'tool-result') {
        results.set(m.callId, m);
        waiters.get(m.callId)?.(m);
      }
      if (m.type === 'cindy-request' && m.kind === 'oneshot_text') {
        oneshots.push(m);
        return structuredClone(tasks.quick);
      }
      return { ok: true };
    },
  };
  // 宿主沙箱页的计时器不会阻止测试进程退出。
  const unrefTimeout = (fn, ms) => {
    const t = setTimeout(fn, ms);
    t.unref();
    return t;
  };
  // 任务轮询用的计时器在测试里加速。
  const fastTimeout = (fn, ms) => unrefTimeout(fn, deviceSync && ms >= 2000 ? ms : Math.min(ms, 20));
  const ctx = vm.createContext({ cindy, BroadcastChannel: Channel, crypto: globalThis.crypto, TextEncoder, console, setTimeout: timers?.setTimeout || fastTimeout, clearTimeout: timers?.clearTimeout || clearTimeout });
  vm.runInContext(mainSource, ctx, { filename: 'main.js' });
  let n = 0;
  const call = (tool, args = {}) =>
    new Promise((resolve) => {
      const callId = `call-${++n}`;
      waiters.set(callId, resolve);
      for (const l of listeners) l({ type: 'tool-call', tool, args, callId });
    });
  const view = (method, params = {}) =>
    new Promise((resolve) => {
      const ch = new BroadcastChannel('cindy-contacts');
      const id = `req-${++n}`;
      ch.onmessage = (ev) => {
        if (ev.data && ev.data.kind === 'res' && ev.data.id === id) {
          ch.close();
          resolve(ev.data);
        }
      };
      ch.postMessage({ kind: 'req', id, method, params });
    });
  const close = () => {
    vm.runInContext('clearTimeout(syncTimer); syncStatus.supported = false;', ctx);
    for (const c of channels) c.close();
    worker.close();
    library.close();
  };
  // 页面会收到的广播事件（任务进度等）
  const events = [];
  const tap = new Channel('cindy-contacts');
  tap.onmessage = (ev) => {
    if (ev.data && ev.data.kind === 'event') events.push(ev.data);
  };
  return { call, view, close, library, schedules, oneshots, tasks, events, ctx, deliver: async msg => { for (const listener of listeners) await listener(msg); } };
}

/* ───────── 旧版通讯录夹具（与旧版内置 schema 同构，数据全部为占位） ───────── */

function makeLegacyDb(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE contacts (id TEXT PRIMARY KEY, kind TEXT NOT NULL, display_name TEXT NOT NULL, aliases TEXT NOT NULL DEFAULT '[]',
      summary TEXT NOT NULL DEFAULT '', narrative TEXT NOT NULL DEFAULT '', agent_notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'confirmed', source TEXT NOT NULL DEFAULT 'manual', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE contact_identities (id TEXT PRIMARY KEY, contact_id TEXT NOT NULL, platform TEXT NOT NULL, value TEXT NOT NULL,
      normalized_value TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
      UNIQUE (platform, normalized_value));
    CREATE TABLE contact_events (id TEXT PRIMARY KEY, contact_id TEXT NOT NULL, date TEXT NOT NULL, text TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
    CREATE TABLE contact_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
    CREATE TABLE contact_group_members (group_id TEXT NOT NULL, contact_id TEXT NOT NULL, PRIMARY KEY (group_id, contact_id));
    CREATE TABLE contact_relations (id TEXT PRIMARY KEY, from_id TEXT NOT NULL, to_id TEXT NOT NULL, relation TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, UNIQUE (from_id, to_id, relation));
    CREATE TABLE contacts_sync_state (singleton INTEGER PRIMARY KEY, node_id TEXT NOT NULL, state_json TEXT NOT NULL, projection_json TEXT NOT NULL);
  `);
  const t = '2026-07-21T00:00:00.000Z';
  const ins = (sql, ...args) => db.prepare(sql).run(...args);
  // 120 人，跨越多页读取与多个写入批次
  for (let i = 0; i < 120; i++) {
    const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    ins(
      'INSERT INTO contacts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, 'person', `测试人${i}`, JSON.stringify([`Tester ${i}`]), `示例公司 · 职位${i}`, `第 ${i} 位的故事。`, '', i === 7 ? 'pending' : 'confirmed', 'agent', t, t,
    );
    ins('INSERT INTO contact_identities VALUES (?, ?, ?, ?, ?, ?, ?, ?)', `id-mail-${i}`, id, 'email', `t${i}@example.test`, `t${i}@example.test`, '', '', t);
    ins('INSERT INTO contact_events VALUES (?, ?, ?, ?, ?, ?)', `ev-${i}`, id, '2026-08-0' + ((i % 9) + 1), `事件 ${i}`, 'session', t);
  }
  ins('INSERT INTO contact_identities VALUES (?, ?, ?, ?, ?, ?, ?, ?)', 'id-phone-1', '00000000-0000-4000-8000-000000000001', 'phone', '+86 138 0000 0001', '+8613800000001', '', '', t);
  ins('INSERT INTO contacts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', 'org-1', 'org', '示例公司', '["Example Co"]', '一家示例公司', '', '', 'confirmed', 'agent', t, t);
  ins('INSERT INTO contact_groups VALUES (?, ?, ?, ?)', 'g-1', '同事', '', t);
  ins('INSERT INTO contact_group_members VALUES (?, ?)', 'g-1', '00000000-0000-4000-8000-000000000001');
  ins('INSERT INTO contact_group_members VALUES (?, ?)', 'g-1', '00000000-0000-4000-8000-000000000002');
  ins('INSERT INTO contact_relations VALUES (?, ?, ?, ?, ?, ?)', 'rel-1', '00000000-0000-4000-8000-000000000001', 'org-1', 'works_at', '', t);
  db.close();
}

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-contacts-test-'));
}

const ok = (r) => {
  assert.equal(r.ok, true, r.message);
  return r.result;
};

/* ───────── 测试 ───────── */

test('首次启动从旧版通讯录完整复制一份，保留 id、状态、身份、事件、分组与关系；再次启动不重复导入', async () => {
  const dir = tmp();
  const legacy = path.join(dir, 'legacy.db');
  makeLegacyDb(legacy);
  const libDir = path.join(dir, 'lib');
  fs.mkdirSync(libDir);

  const a = boot({ libDir, legacyDb: legacy });
  try {
    const s = ok(await a.call('stats'));
    assert.deepEqual({ people: s.people, orgs: s.orgs, pending: s.pending, groups: s.groups }, { people: 120, orgs: 1, pending: 1, groups: 1 });
    const one = ok(await a.call('get', { id: '00000000-0000-4000-8000-000000000001' }));
    assert.equal(one.name, '测试人1');
    assert.deepEqual(one.aliases, ['Tester 1']);
    assert.equal(one.identities.length, 2);
    assert.equal(one.events.length, 1);
    assert.deepEqual(one.groups.map((g) => g.name), ['同事']);
    assert.equal(one.relations[0].otherName, '示例公司');
    const st = await a.view('state');
    assert.equal(st.ok, true);
    assert.equal(st.result.legacy.status, 'done');
    assert.equal(st.result.legacy.counts.contacts.local, 121);
  } finally {
    a.close();
  }

  // 第二次启动：已导入，不重复；库已是最新版本，不再触发迁移（宿主每次迁移都会备份）
  const migrationsBefore = migrations.count;
  const b = boot({ libDir, legacyDb: legacy });
  try {
    const s = ok(await b.call('stats'));
    assert.equal(s.people, 120);
    assert.equal(migrations.count, migrationsBefore);
  } finally {
    b.close();
  }
  // 旧库未被改动
  const check = new DatabaseSync(legacy, { readOnly: true });
  assert.equal(check.prepare('SELECT count(*) AS n FROM contacts').get().n, 121);
  check.close();
});

// 回归：宿主把插件装在 cindy-brain/_ns/_root/<id> 下后，写死三层的路径推算找不到旧库，
// 真实用户的旧数据从未导入。不用测试环境变量，按真实安装布局启动工作进程。
test('工作进程按真实安装布局找到当前账号的旧版通讯录，不依赖固定层数', async () => {
  const dir = tmp();
  const owner = path.join(dir, 'owners', 'owner-a');
  for (const layout of [['cindy-brain', 'cindy-contacts'], ['cindy-brain', '_ns', '_root', 'cindy-contacts']]) {
    const nodeDir = path.join(owner, ...layout, 'node');
    fs.mkdirSync(nodeDir, { recursive: true });
    fs.copyFileSync(path.join(pluginDir, 'node', 'worker.cjs'), path.join(nodeDir, 'worker.cjs'));
    const w = makeWorker({}, path.join(nodeDir, 'worker.cjs'));
    try {
      assert.deepEqual(ok(await w.request({ method: 'legacy/probe', params: {} })), { found: false });
      fs.mkdirSync(path.join(owner, 'maker-contacts'), { recursive: true });
      makeLegacyDb(path.join(owner, 'maker-contacts', 'contacts.db'));
      const probe = ok(await w.request({ method: 'legacy/probe', params: {} }));
      assert.equal(probe.found, true, layout.join('/'));
      assert.equal(probe.counts.contacts, 121);
    } finally {
      w.close();
      fs.rmSync(path.join(owner, 'maker-contacts'), { recursive: true, force: true });
    }
  }
});

// 回归：资料库已有档案时旧版通讯录被静默跳过，且没有任何导入入口。现在记为可导入，由用户触发，
// 共用身份的旧档案并入已有档案、同名分组合并，不产生重复的人。
test('资料库已有档案时旧版通讯录标记为可导入，手动导入按共同身份合并到已有档案', async () => {
  const dir = tmp();
  const legacy = path.join(dir, 'legacy.db');
  makeLegacyDb(legacy);
  const libDir = path.join(dir, 'lib');
  fs.mkdirSync(libDir);
  const first = boot({ libDir });
  let existingId;
  try {
    existingId = ok(await first.call('save', { name: '一号同事', identities: [{ platform: 'email', value: 't1@example.test' }], groups: ['同事'] })).id;
  } finally {
    first.close();
  }

  const a = boot({ libDir, legacyDb: legacy });
  try {
    assert.equal(ok(await a.call('stats')).people, 1);
    const st = await a.view('state');
    assert.equal(st.result.legacy.status, 'available');
    assert.equal(st.result.legacy.counts.contacts, 121);

    const r = await a.view('importLegacy');
    assert.equal(r.ok, true, r.message);
    assert.equal(r.result.status, 'done');
    assert.equal(r.result.merged, true);
    const s = ok(await a.call('stats'));
    assert.deepEqual({ people: s.people, orgs: s.orgs, groups: s.groups }, { people: 120, orgs: 1, groups: 1 });
    const merged = ok(await a.call('get', { id: existingId }));
    assert.equal(merged.name, '一号同事');
    assert.ok(merged.identities.some((i) => i.platform === 'phone'), 'legacy identities move to the existing person');
    assert.ok(merged.events.some((e) => e.text === '事件 1'));
    assert.deepEqual(merged.groups.map((g) => g.name), ['同事']);
    assert.equal(merged.relations[0].otherName, '示例公司');
    // 旧档案的别名、摘要与故事按普通合并规则保留，不会随导入丢失（PR #264 review）。
    assert.ok(merged.aliases.includes('测试人1') && merged.aliases.includes('Tester 1'), 'legacy name and aliases kept');
    assert.equal(merged.summary, '示例公司 · 职位1');
    assert.match(merged.narrative, /第 1 位的故事。/);
    assert.equal((await a.call('get', { id: '00000000-0000-4000-8000-000000000001' })).ok, false);
    assert.equal((await a.view('state')).result.legacy.status, 'done');

    // 导入时的合并留有记录，合错了可以拆开，旧档案原样回来。
    assert.equal(merged.merges.length, 1);
    const split = await a.view('unmerge', { id: merged.merges[0].id });
    assert.equal(split.ok, true, split.message);
    const restored = ok(await a.call('get', { id: '00000000-0000-4000-8000-000000000001' }));
    assert.equal(restored.name, '测试人1');
    assert.ok(restored.events.some((e) => e.text === '事件 1'));
    assert.ok(restored.identities.some((i) => i.platform === 'phone'));
    assert.equal(ok(await a.call('get', { id: existingId })).summary, '');
  } finally {
    a.close();
  }
});

test('没有旧版通讯录时不导入，资料库保持为空', async () => {
  const dir = tmp();
  const a = boot({ libDir: dir });
  try {
    const s = ok(await a.call('stats'));
    assert.equal(s.people, 0);
    const st = await a.view('state');
    assert.equal(st.result.legacy.status, 'none');
  } finally {
    a.close();
  }
});

test('查人、建档去重、身份冲突、追加更新、记事件、整理分组、合并与删除', async () => {
  const dir = tmp();
  const a = boot({ libDir: dir });
  try {
    const created = ok(await a.call('save', {
      name: '林知夏', aliases: ['Connie'], summary: '星屿的设计负责人',
      identities: [{ platform: 'email', value: 'Zhixia@Example.test' }, { platform: 'phone', value: '+86 138-0000-2041' }],
      groups: ['星屿科技'],
    }));
    assert.equal(created.created, true);

    // 同名再建 → 疑似重复
    const dup = await a.call('save', { name: '林知夏' });
    assert.equal(dup.ok, false);
    assert.equal(dup.errorCode, 'DUPLICATE_SUSPECT');

    // 身份已属于别人 → 冲突
    const other = ok(await a.call('save', { name: '周叙白', identities: [{ platform: 'feishu', value: 'xubai' }] }));
    const conflict = await a.call('save', { id: other.id, identities: [{ platform: 'email', value: 'zhixia@example.test' }] });
    assert.equal(conflict.errorCode, 'IDENTITY_CONFLICT');

    // 各种线索都能找到
    for (const query of ['zhixia@example.test', '13800002041', '+86 138 0000 2041', 'connie', '知夏', '设计负责人']) {
      const r = ok(await a.call('find', { query }));
      assert.equal(r.results[0]?.id, created.id, `find ${query}`);
    }

    // 只记了名的人，用全名也能找到；短拉丁名不会被长词误中
    const short = ok(await a.call('save', { name: '紫旎', summary: 'QA' }));
    const al = ok(await a.call('save', { name: 'Al' }));
    const full = ok(await a.call('find', { query: '徐紫旎' }));
    assert.equal(full.results[0]?.id, short.id);
    assert.equal(full.results[0]?.matchType, 'partial');
    assert.ok(!ok(await a.call('find', { query: 'alan' })).results.some((r) => r.id === al.id));
    ok(await a.call('delete', { id: short.id, confirm: true }));
    ok(await a.call('delete', { id: al.id, confirm: true }));

    // 追加更新：别名并集，不丢旧值
    ok(await a.call('save', { id: created.id, aliases: ['Zhixia Lin'], summary: '增长设计负责人' }));
    let c = ok(await a.call('get', { id: created.id }));
    assert.deepEqual(c.aliases, ['Connie', 'Zhixia Lin']);
    assert.equal(c.summary, '增长设计负责人');

    ok(await a.call('log_event', { contact_id: created.id, date: '2026-10-08', text: '转到增长团队' }));
    c = ok(await a.call('get', { id: created.id }));
    assert.equal(c.events[0].text, '转到增长团队');

    ok(await a.call('organize', { action: 'move_to_group', contact_ids: [created.id], group: '前同事' }));
    c = ok(await a.call('get', { id: created.id }));
    assert.deepEqual(c.groups.map((g) => g.name), ['前同事']);

    ok(await a.call('relate', { from_id: created.id, to_id: other.id, relation: '同组' }));

    // 合并：other 并入 created
    const m = ok(await a.call('merge', { source_id: other.id, target_id: created.id }));
    assert.equal(m.id, created.id);
    c = ok(await a.call('get', { id: created.id }));
    assert.ok(c.aliases.includes('周叙白'));
    assert.ok(c.identities.some((i) => i.platform === 'feishu'));
    assert.equal(c.relations.length, 0, 'self relation removed after merge');
    assert.equal((await a.call('get', { id: other.id })).errorCode, 'NOT_FOUND');

    // 删除必须显式确认
    assert.equal((await a.call('delete', { id: created.id })).errorCode, 'CONFIRM_REQUIRED');
    ok(await a.call('delete', { id: created.id, confirm: true }));
    assert.equal(ok(await a.call('stats')).people, 0);
  } finally {
    a.close();
  }
});

test('从 macOS 通讯录导入：先预览，再按锚点、邮箱、电话合并；重名进待确认；重复导入不重复建档', async () => {
  const dir = tmp();
  const fixture = path.join(dir, 'system.json');
  fs.writeFileSync(fixture, JSON.stringify([
    { name: '林知夏', org: '星屿科技', title: '设计', id: 'AB-1', isCompany: false, emails: [{ v: 'zhixia@example.test', l: '_$!<Work>!$_' }], phones: [] },
    { name: '新朋友', org: '', title: '', id: 'AB-2', isCompany: false, emails: [], phones: [{ v: '+1 (555) 010-0002', l: 'mobile' }] },
    { name: '林知夏', org: '', title: '', id: 'AB-3', isCompany: false, emails: [], phones: [] },
    { name: '星屿科技', org: '星屿科技', title: '', id: 'AB-4', isCompany: true, emails: [], phones: [] },
  ]));
  const a = boot({ libDir: dir, systemFixture: fixture });
  try {
    const existing = ok(await a.call('save', { name: '林知夏', identities: [{ platform: 'email', value: 'zhixia@example.test' }] }));
    const preview = ok(await a.call('import_macos', {}));
    assert.equal(preview.dryRun, true);
    assert.equal(ok(await a.call('stats')).people, 1, 'dry run writes nothing');

    const r = ok(await a.call('import_macos', { dry_run: false }));
    assert.deepEqual({ created: r.created, updated: r.updated }, { created: 3, updated: 1 });
    assert.equal(r.needsReview.length, 1);
    const c = ok(await a.call('get', { id: existing.id }));
    assert.ok(c.identities.some((i) => i.platform === 'apple-contacts' && i.value === 'AB-1'));
    const s = ok(await a.call('stats'));
    assert.deepEqual({ people: s.people, orgs: s.orgs, pending: s.pending }, { people: 3, orgs: 1, pending: 1 });

    const again = ok(await a.call('import_macos', { dry_run: false }));
    assert.equal(again.created, 0);
    assert.equal(again.unchanged, 4);
  } finally {
    a.close();
  }
});

test('主视图请求通道：列表、详情与修改后的变更通知', async () => {
  const dir = tmp();
  const a = boot({ libDir: dir });
  try {
    const saved = await a.view('save', { name: '许嘉言', summary: '律师', groups: ['物业与生活'] });
    assert.equal(saved.ok, true);
    const list = await a.view('list');
    assert.equal(list.result.contacts.length, 1);
    assert.deepEqual(list.result.contacts[0].groups, ['物业与生活']);
    assert.equal(list.result.groups[0].members, 1);
    const detail = await a.view('get', { id: saved.result.id });
    assert.equal(detail.result.summary, '律师');
    const bad = await a.view('nope');
    assert.equal(bad.ok, false);
  } finally {
    a.close();
  }
});

test('按时间段整理：第一次只看最近两周；之后从上次整理接着往后；回补所有人或一个人都往前推进覆盖范围', async () => {
  const dir = tmp();
  const a = boot({ libDir: dir, locale: 'zh-CN' });
  try {
    const DAY = 86400000;
    const b1 = ok(await a.call('maintenance', { action: 'begin' }));
    assert.equal(b1.scope, 'recent');
    assert.equal(b1.first_run, true);
    assert.equal(b1.max_changes, 30);
    const span = Date.parse(b1.to) - Date.parse(b1.from);
    assert.ok(Math.abs(span - 14 * DAY) < 60000, 'first run covers 14 days');
    assert.equal(b1.segments.length, 2, 'split into weeks');
    assert.ok(Date.parse(b1.segments[0].from) > Date.parse(b1.segments[1].from), 'newest first');
    assert.deepEqual(b1.sources.map((x) => x.source), ['mail', 'calendar', 'im', 'cindy']);
    assert.match(b1.first_step, /sources/);
    assert.match(b1.channel_rule, /钥匙串/);
    assert.match(b1.manual, /path: "tidy"/);
    assert.match(b1.channel_rule, /不要尝试解密/);
    // 先报告来源能不能用，页面据此告诉用户哪些没连
    const rs = ok(
      await a.call('maintenance', {
        action: 'sources',
        sources_status: [
          { source: 'mail', status: 'ok' },
          { source: 'im', status: 'unauthorized', note: '没连接飞书' },
        ],
      }),
    );
    assert.deepEqual(rs.usable, ['mail']);
    const st0 = (await a.view('state')).result;
    assert.equal(st0.sourcesStatus.items.find((x) => x.source === 'im').note, '没连接飞书');
    // 消息类来源要求群聊、单聊分别找
    assert.match(b1.sources.find((x) => x.source === 'im').how, /p2p_chat/);
    // 没报告覆盖情况不能收尾
    const noCov = await a.call('maintenance', { action: 'end', run_id: b1.run_id });
    assert.equal(noCov.ok, false);
    assert.equal(noCov.errorCode, 'COVERAGE_REQUIRED');
    const full = (src) => ({ source: src, coverage: 'complete' });
    ok(
      await a.call('maintenance', {
        action: 'end',
        run_id: b1.run_id,
        scanned: 4,
        created: 2,
        updated: 1,
        note: '新认识两位',
        coverage: ['mail', 'calendar', 'im', 'cindy'].map(full),
      }),
    );
    // 同一个 run 不能结束两次
    assert.equal((await a.call('maintenance', { action: 'end', run_id: b1.run_id })).ok, false);

    const b2 = ok(await a.call('maintenance', { action: 'begin' }));
    assert.equal(b2.first_run, false);
    assert.ok(Math.abs(Date.parse(b2.from) - (Date.parse(b1.to) - 3600000)) < 5, 'continues from last run with 1h overlap');
    // 这次：一个群没读完、Cindy 对话没读到。读完的来源推进，没读完的留缺口，没读到的保持原位
    ok(
      await a.call('maintenance', {
        action: 'end',
        run_id: b2.run_id,
        coverage: [
          full('mail'),
          full('calendar'),
          { source: 'im', coverage: 'partial', gaps: [{ where: 'Cindy 群', from: b2.from, to: b2.to, reason: '超过 200 条' }] },
          { source: 'cindy', coverage: 'none', note: '这个任务里读不到' },
        ],
      }),
    );
    const b2b = ok(await a.call('maintenance', { action: 'begin' }));
    assert.equal(b2b.backlog.length, 1);
    assert.equal(b2b.backlog[0].where, 'Cindy 群');
    const imFrom = b2b.sources.find((x) => x.source === 'im').from;
    const cindyFrom = b2b.sources.find((x) => x.source === 'cindy').from;
    assert.ok(Math.abs(Date.parse(imFrom) - (Date.parse(b2.to) - 3600000)) < 5, 'partially read source moves on, gap kept in backlog');
    assert.ok(Math.abs(Date.parse(cindyFrom) - (Date.parse(b1.to) - 3600000)) < 5, 'unread source stays where it was');
    assert.equal(b2b.from, cindyFrom);
    ok(
      await a.call('maintenance', {
        action: 'end',
        run_id: b2b.run_id,
        backlog_done: [b2b.backlog[0].id],
        coverage: ['mail', 'calendar', 'im', 'cindy'].map(full),
      }),
    );
    assert.equal(ok(await a.call('maintenance', { action: 'begin' })).backlog.length, 0);
    const stCov = (await a.view('state')).result;
    assert.equal(stCov.maintenance.checkpoint, b2b.to);
    const st = (await a.view('state')).result;
    assert.equal(st.maintenance.runs.length, 3);
    assert.equal(st.coverage.from, b1.from);

    // 所有人往前补 3 个月：从覆盖起点往前
    const b3 = ok(await a.call('maintenance', { action: 'begin', scope: 'backfill' }));
    assert.equal(b3.to, b1.from);
    assert.ok(Date.parse(b3.from) < Date.parse(b3.to) - 80 * DAY);
    ok(await a.call('maintenance', { action: 'end', run_id: b3.run_id, coverage: b3.sources.map((x) => ({ source: x.source, coverage: 'complete' })) }));
    assert.equal((await a.view('state')).result.coverage.from, b3.from);
    // 回补不移动「上次整理到」的检查点
    assert.equal((await a.view('state')).result.maintenance.checkpoint, b2b.to);

    // 只补一个人：只给这个人的身份，结束后记下这个人补到了哪天
    const p = ok(await a.call('save', { name: '林知夏', identities: [{ platform: 'email', value: 'zhixia@example.test' }] }));
    const b4 = ok(await a.call('maintenance', { action: 'begin', scope: 'contact', contact_id: p.id, months: 6 }));
    assert.equal(b4.contact.name, '林知夏');
    assert.equal(b4.contact.identities[0].value, 'zhixia@example.test');
    assert.equal(b4.to, b3.from);
    ok(await a.call('maintenance', { action: 'end', run_id: b4.run_id, coverage: b4.sources.map((x) => ({ source: x.source, coverage: 'complete' })) }));
    assert.equal(ok(await a.call('get', { id: p.id })).coveredFrom, b4.from);

    // 设置：初始天数与来源开关
    const set = (await a.view('settings', { profile: 'clients', initialDays: 7, sources: { github: true, cindy: false } })).result;
    assert.equal(set.initialDays, 7);
    assert.equal(set.sources.github, true);
    const b5 = ok(await a.call('maintenance', { action: 'begin' }));
    assert.equal(b5.max_changes, 100);
    assert.deepEqual(b5.sources.map((x) => x.source), ['mail', 'calendar', 'im', 'github']);

    const req = await a.view('requestAutomation');
    assert.equal(req.ok, true);
    assert.equal(a.schedules[0].intervalMs, 6 * 3600 * 1000);
    assert.match(a.schedules[0].prompt, /run_id/);
    assert.ok(a.schedules[0].prompt.length <= 2000);
    // 宿主是中文时，自动化和整理任务用中文名
    assert.equal(a.schedules[0].name, '整理通讯录');
    await a.view('tidy', { scope: 'recent' });
    assert.equal(a.tasks.created.at(-1).title, '通讯录 · 整理');
    assert.match(a.tasks.sent.at(-1).text, /path: "tidy"/);
  } finally {
    a.close();
  }
});

test('往来：按身份或名字归到人、按来源 id 去重；还没完的事、要点与最新动态写进档案', async () => {
  const dir = tmp();
  const a = boot({ libDir: dir });
  try {
    const kim = ok(await a.call('save', { name: 'Kim Wager', identities: [{ platform: 'email', value: 'kim@example.test' }] }));
    const zx = ok(await a.call('save', { name: '徐紫旎', aliases: ['mila'], identities: [{ platform: 'feishu', value: 'ou_zixi' }] }));
    const r1 = ok(
      await a.call('record', {
        items: [
          { email: 'KIM@example.test', occurred_at: '2026-10-11T15:46:00Z', channel: 'mail', title: 'Bug', summary: '更新后 Android 仍收不到', quote: 'still don’t load', ref: 'gm-1', link: 'javascript:alert(1)' },
          { identity: { platform: 'feishu', value: 'ou_zixi' }, occurred_at: '2026-10-10T09:16:00Z', channel: 'im', title: '周六发版', ref: 'om-1' },
          { name: 'mila', occurred_at: '2026-10-11T15:29:00Z', channel: 'mail', title: '回复 5 个用户', ref: 'gm-2', link: 'https://mail.example.test/x' },
          { name: '没有这个人', occurred_at: '2026-10-11T15:29:00Z', channel: 'mail', title: 'x', ref: 'gm-3' },
          { contact_id: kim.id, occurred_at: 'not a date', channel: 'mail', title: 'x', ref: 'gm-4' },
        ],
      }),
    );
    assert.equal(r1.added, 3);
    assert.equal(r1.failed, 2);
    assert.equal(r1.results.find((x) => x.index === 3).errorCode, 'UNRESOLVED');
    // 重复提交不重复记
    const r2 = ok(await a.call('record', { items: [{ contact_id: kim.id, occurred_at: '2026-10-11T15:46:00Z', channel: 'mail', title: 'Bug', ref: 'gm-1' }] }));
    assert.equal(r2.added, 0);
    assert.equal(r2.duplicates, 1);

    ok(
      await a.call('save', {
        id: kim.id,
        latest: '更新后 Android 仍收不到',
        facts: [{ label: '设备', value: 'Android、iPad、MacBook' }],
        open_loops: [{ text: 'Android + iCloud 仍收不到', detail: '新诊断待看', since: '2026-10-11', source: 'mail' }],
      }),
    );
    // 同一句未完的事不重复开
    ok(await a.call('save', { id: kim.id, open_loops: [{ text: 'Android + iCloud 仍收不到' }] }));
    const k = ok(await a.call('get', { id: kim.id }));
    assert.equal(k.interactions.length, 1);
    assert.equal(k.interactions[0].link, '', 'only http(s) links are kept');
    assert.equal(k.interactions[0].quote, 'still don’t load');
    assert.equal(k.loops.length, 1);
    assert.equal(k.facts[0].value, 'Android、iPad、MacBook');
    assert.equal(k.latest, '更新后 Android 仍收不到');
    ok(await a.call('save', { id: kim.id, close_loops: [{ id: k.loops[0].id, detail: '紫旎已回复' }] }));
    const k2 = ok(await a.call('get', { id: kim.id }));
    assert.equal(k2.loops[0].status, 'done');
    assert.equal(k2.loops[0].detail, '紫旎已回复');

    const z = ok(await a.call('get', { id: zx.id }));
    assert.equal(z.interactions.length, 2);
    assert.equal(z.interactions[0].ref, 'gm-2', 'newest first');

    const list = (await a.view('list')).result.contacts;
    const kRow = list.find((c) => c.id === kim.id);
    assert.equal(kRow.rich, true);
    assert.equal(kRow.openLoops, 0);
    assert.equal(kRow.latest, '更新后 Android 仍收不到');
    assert.equal(kRow.last, '2026-10-11T15:46:00.000Z');
  } finally {
    a.close();
  }
});

test('合并会留下记录，可以拆开：原档案连同它带来的身份、往来、未完的事和分组都还回去', async () => {
  const dir = tmp();
  const a = boot({ libDir: dir });
  try {
    const t = ok(await a.call('save', { name: '徐紫旎', summary: 'Filo 实习生', identities: [{ platform: 'feishu', value: 'ou_zixi' }] }));
    const s = ok(await a.call('save', { name: 'mila', identities: [{ platform: 'email', value: 'xuzini@example.test' }], groups: ['Filo'], allow_duplicate: true }));
    ok(await a.call('record', { items: [{ contact_id: s.id, occurred_at: '2026-10-11T15:29:00Z', channel: 'mail', title: '回复用户', ref: 'gm-9' }] }));
    ok(await a.call('save', { id: s.id, open_loops: [{ text: '等 Kim 回复' }] }));
    const m = ok(await a.call('merge', { source_id: s.id, target_id: t.id, reason: '同一个支持邮箱' }));
    const merged = ok(await a.call('get', { id: t.id }));
    assert.equal(merged.identities.length, 2);
    assert.equal(merged.interactions.length, 1);
    assert.equal(merged.loops.length, 1);
    assert.equal(merged.merges[0].reason, '同一个支持邮箱');
    assert.ok(merged.aliases.includes('mila'));

    const u = await a.view('unmerge', { id: m.mergeId });
    assert.equal(u.ok, true, JSON.stringify(u.error));
    const back = ok(await a.call('get', { id: s.id }));
    assert.equal(back.name, 'mila');
    assert.equal(back.identities[0].value, 'xuzini@example.test');
    assert.equal(back.interactions.length, 1);
    assert.equal(back.loops.length, 1);
    assert.deepEqual(back.groups.map((g) => g.name), ['Filo']);
    const kept = ok(await a.call('get', { id: t.id }));
    assert.equal(kept.identities.length, 1);
    assert.equal(kept.interactions.length, 0);
    assert.ok(!kept.aliases.includes('mila'));
    assert.equal(kept.merges.length, 0);
    assert.equal((await a.view('unmerge', { id: m.mergeId })).error.code, 'ALREADY_UNDONE');
  } finally {
    a.close();
  }
});

test('人物页提问：只问这个人的事当场回答，写邮件和回补发到这个人的固定任务里，结果读回页面', async () => {
  const dir = tmp();
  const a = boot({ libDir: dir });
  try {
    const p = ok(await a.call('save', { name: '徐紫旎', summary: 'Filo 实习生' }));
    ok(await a.call('record', { items: [{ contact_id: p.id, occurred_at: '2026-10-11T15:29:00Z', channel: 'mail', title: '回复 5 个用户', ref: 'gm-1' }] }));

    const q1 = (await a.view('ask', { contactId: p.id, text: '她最近在忙什么' })).result;
    assert.equal(q1.kind, 'answer');
    assert.equal(q1.a, '她在推进 Pi 清单。');
    assert.equal(a.tasks.created.length, 0, 'quick questions do not open tasks');
    assert.match(a.oneshots[0].prompt, /回复 5 个用户/);

    const q2 = (await a.view('ask', { contactId: p.id, text: '给她写封邮件，问问六项需求的进度' })).result;
    assert.equal(q2.kind, 'task');
    assert.equal(a.tasks.created.length, 1);
    assert.match(a.tasks.sent[0].text, /只创建草稿/);
    // 宿主没给语言时任务标题按英文回退
    assert.match(a.tasks.created[0].title, /^Contacts · /);
    // 新任务先请宿主切到「自动审查」，只问一次
    assert.deepEqual(a.tasks.access, [{ taskId: 'task-1', mode: 'auto' }]);
    // 结果读回页面：任务结束后广播回复，并记进这个人的问答
    for (let i = 0; i < 100 && !a.events.some((e) => e.name === 'task' && e.data.status === 'done'); i++) await new Promise((r) => setTimeout(r, 20));
    const done = a.events.find((e) => e.name === 'task' && e.data.status === 'done');
    assert.equal(done.data.reply, '已经记下了。');
    const qa = (await a.view('qa', { contactId: p.id })).result;
    assert.equal(qa.length, 2);
    assert.equal(qa[1].a, '已经记下了。');

    // 同一个人再发：复用同一个任务
    ok({ ok: true, result: (await a.view('tidy', { scope: 'contact', contactId: p.id })).result });
    assert.equal(a.tasks.created.length, 1);
    assert.equal(a.tasks.sent.length, 2);
    assert.match(a.tasks.sent[1].text, /scope: "contact"/);
    assert.match(a.tasks.sent[1].text, /path: "tidy"/);
    assert.equal(a.tasks.access.length, 1, 'reused task is not asked again');
    assert.equal((await a.view('state')).result.autoAccess.granted, true);

    // 用户把任务切到完全访问后，插件不能再往里发：新开一个任务继续，并重新请求自动审查
    a.tasks.tooHigh.add('task-1');
    for (let i = 0; i < 100 && a.events.filter((e) => e.name === 'task' && e.data.status === 'done').length < 2; i++) await new Promise((r) => setTimeout(r, 20));
    const q4 = (await a.view('ask', { contactId: p.id, text: '帮我查一下她这周的会' })).result;
    assert.equal(q4.kind, 'task');
    assert.equal(q4.taskId, 'task-2');
    assert.deepEqual(a.tasks.access.at(-1), { taskId: 'task-2', mode: 'auto' });

    // 没有快速通道时改走任务
    a.tasks.quick = { ok: false, errorCode: 'NO_CANDIDATE', message: 'none' };
    for (let i = 0; i < 100 && a.events.filter((e) => e.name === 'task' && e.data.status === 'done').length < 3; i++) await new Promise((r) => setTimeout(r, 20));
    const q3 = (await a.view('ask', { contactId: p.id, text: '她是谁' })).result;
    assert.equal(q3.kind, 'task');
    // 回补跑完却没有调用 end：页面会提示没走完
    assert.equal((await a.view('state')).result.lastTidy.status, 'incomplete');

    // 打开页面：半小时内反复打开不刷新「上次看过」
    const v1 = (await a.view('opened')).result;
    const v2 = (await a.view('opened')).result;
    assert.equal(v1.current, v2.current);
  } finally {
    a.close();
  }
});

test('批量建档：逐条返回结果，单条失败不影响其它', async () => {
  const dir = tmp();
  const a = boot({ libDir: dir });
  try {
    ok(await a.call('save', { name: '已存在客户', identities: [{ platform: 'email', value: 'old@example.test' }] }));
    const items = Array.from({ length: 60 }, (_, i) => ({ name: `客户${i}`, kind: 'person', groups: ['客户A公司'], identities: [{ platform: 'email', value: `c${i}@example.test` }] }));
    items.push({ name: '冲突的人', identities: [{ platform: 'email', value: 'OLD@example.test' }] });
    items.push({ name: '已存在客户' });
    const r = ok(await a.call('save_many', { items }));
    assert.equal(r.saved, 60);
    assert.equal(r.failed, 2);
    assert.deepEqual(r.results.filter((x) => !x.ok).map((x) => x.errorCode).sort(), ['DUPLICATE_SUSPECT', 'IDENTITY_CONFLICT']);
    const g = ok(await a.call('groups', { action: 'list' }));
    assert.equal(g.groups.find((x) => x.name === '客户A公司').members, 60);
  } finally {
    a.close();
  }
});

test('导入过 macOS 通讯录后，超过一天会在自动维护开始时自动增量对账（不需要模型）', async () => {
  const dir = tmp();
  const fixture = path.join(dir, 'system.json');
  const write = (list) => fs.writeFileSync(fixture, JSON.stringify(list));
  write([{ name: '甲', org: '', title: '', id: 'AB-1', isCompany: false, emails: [], phones: [{ v: '+1 555 010 0001', l: '' }] }]);
  const a = boot({ libDir: dir, systemFixture: fixture });
  try {
    ok(await a.call('import_macos', { dry_run: false }));
    write([
      { name: '甲', org: '', title: '', id: 'AB-1', isCompany: false, emails: [], phones: [{ v: '+1 555 010 0001', l: '' }] },
      { name: '乙丙', org: '', title: '', id: 'AB-2', isCompany: false, emails: [], phones: [] },
    ]);
    // 未满一天：不对账
    ok(await a.call('maintenance', { action: 'begin' }));
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(ok(await a.call('stats')).people, 1);
    // 把上次导入时间改到两天前
    a.library.db('contacts.sqlite').prepare("UPDATE plugin_meta SET value = json_set(value, '$.at', ?) WHERE key = 'system_import'").run(new Date(Date.now() - 2 * 86400000).toISOString());
    ok(await a.call('maintenance', { action: 'begin' }));
    let people = 0;
    for (let i = 0; i < 40 && people < 2; i++) {
      await new Promise((r) => setTimeout(r, 100));
      people = ok(await a.call('stats')).people;
    }
    assert.equal(people, 2);
    // 关掉每日对账后不再自动执行
    await a.view('settings', { macAutoSync: false });
    a.library.db('contacts.sqlite').prepare("UPDATE plugin_meta SET value = json_set(value, '$.at', ?) WHERE key = 'system_import'").run(new Date(Date.now() - 2 * 86400000).toISOString());
    write([{ name: '丁', org: '', title: '', id: 'AB-3', isCompany: false, emails: [], phones: [] }]);
    ok(await a.call('maintenance', { action: 'begin' }));
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(ok(await a.call('stats')).people, 2);
  } finally {
    a.close();
  }
});

test('几千人的规模：批量写入、列表与查重都在可接受时间内完成', async () => {
  const dir = tmp();
  const a = boot({ libDir: dir });
  try {
    const t0 = Date.now();
    for (let b = 0; b < 30; b++) {
      const items = Array.from({ length: 100 }, (_, i) => {
        const n = b * 100 + i;
        return { name: `客户联系人${n}`, aliases: [`Client ${n}`], groups: [`公司${n % 50}`], identities: [{ platform: 'email', value: `p${n}@example.test` }] };
      });
      const r = ok(await a.call('save_many', { items }));
      assert.equal(r.failed, 0);
    }
    const list = await a.view('list');
    assert.equal(list.result.contacts.length, 3000);
    const t1 = Date.now();
    const d = ok(await a.call('find_duplicates'));
    const dupMs = Date.now() - t1;
    assert.ok(Array.isArray(d.pairs));
    assert.ok(dupMs < 8000, `find_duplicates took ${dupMs}ms`);
    const f = ok(await a.call('find', { query: 'p2999@example.test' }));
    assert.equal(f.results[0].name, '客户联系人2999');
    console.log(`# 3000 people: write+list ${t1 - t0}ms, duplicates ${dupMs}ms`);
  } finally {
    a.close();
  }
});

test('数据完整性：同卡重复值不阻塞导入；没写缺口的 partial 不推进；久未读的整段记成待补；删除不留副本', async () => {
  const dir = tmp();
  const fixture = path.join(dir, 'system.json');
  fs.writeFileSync(fixture, JSON.stringify([
    { name: '重复邮箱', org: '', title: '', id: 'AB-9', isCompany: false, emails: [{ v: 'dup@example.test', l: 'work' }, { v: 'DUP@example.test', l: 'home' }], phones: [] },
  ]));
  const a = boot({ libDir: dir, systemFixture: fixture });
  const sql = async (s, p = []) => (await a.library({ op: 'db.exec', dbPath: 'contacts.sqlite', sql: s, params: p })).rows;
  try {
    // 同一张名片写了两遍同一个邮箱：只建一条身份，整批不失败
    const r = ok(await a.call('import_macos', { dry_run: false }));
    assert.equal(r.created, 1);
    assert.equal((await sql("SELECT count(*) AS n FROM contact_identities WHERE platform = 'email'"))[0].n, 1);

    // 旧做法不带 run_id 也不带时间：不再把检查点推到现在
    const b0 = ok(await a.call('maintenance', { action: 'begin' }));
    ok(await a.call('maintenance', { action: 'end' }));
    const b1 = ok(await a.call('maintenance', { action: 'begin' }));
    assert.ok(Date.parse(b1.from) < Date.now() - 2 * 86400000, 'still starts from the first-run window');
    ok(await a.call('maintenance', { action: 'end', run_id: b0.run_id, coverage: b0.sources.map((s) => ({ source: s.source, coverage: 'complete' })) }));

    // 说 partial 却没写缺口：按没读到处理，这个来源的检查点不动
    const b2 = ok(await a.call('maintenance', { action: 'begin' }));
    const imFrom = b2.sources.find((s) => s.source === 'im').from;
    ok(await a.call('maintenance', { action: 'end', run_id: b2.run_id, coverage: b2.sources.map((s) => ({ source: s.source, coverage: s.source === 'im' ? 'partial' : 'complete' })) }));
    const b3 = ok(await a.call('maintenance', { action: 'begin' }));
    assert.equal(b3.sources.find((s) => s.source === 'im').from, imFrom);
    ok(await a.call('maintenance', { action: 'end', run_id: b3.run_id, coverage: b3.sources.map((s) => ({ source: s.source, coverage: 'complete' })) }));

    // 40 天没读：这一轮只读最近 30 天，更早的整段记成待补
    const old = new Date(Date.now() - 40 * 86400000).toISOString();
    ok(await a.call('maintenance', { action: 'end', checkpoint: old }));
    await a.library({ op: 'db.exec', dbPath: 'contacts.sqlite', sql: "UPDATE plugin_meta SET value = json_remove(value, '$.sources') WHERE key = 'maintenance'", params: [] });
    const b4 = ok(await a.call('maintenance', { action: 'begin' }));
    assert.ok(b4.backlog.some((g) => g.source === 'mail' && g.reason.includes('30 天')));
    const again = ok(await a.call('maintenance', { action: 'begin' }));
    assert.equal(again.backlog.filter((g) => g.source === 'mail').length, 1, 'same gap is recorded once');

    // 删除：往来、待办、问答和合并快照都不留
    const p = ok(await a.call('save', { name: '要删的人', identities: [{ platform: 'email', value: 'gone@example.test' }] }));
    const q = ok(await a.call('save', { name: '被并入的人', identities: [{ platform: 'email', value: 'merged@example.test' }], allow_duplicate: true }));
    ok(await a.call('record', { items: [{ contact_id: p.id, occurred_at: '2026-10-11T15:29:00Z', channel: 'mail', title: 'x', ref: 'gm-del' }] }));
    ok(await a.call('merge', { target_id: p.id, source_id: q.id, reason: '同一个人' }));
    await a.library({ op: 'db.exec', dbPath: 'contacts.sqlite', sql: 'INSERT OR REPLACE INTO plugin_meta (key, value) VALUES (?, ?)', params: [`qa:${p.id}`, '[]'] });
    ok(await a.call('delete', { id: p.id, confirm: true }));
    assert.equal((await sql('SELECT count(*) AS n FROM contact_interactions WHERE contact_id = ?', [p.id]))[0].n, 0);
    assert.equal((await sql('SELECT count(*) AS n FROM contact_merges WHERE target_id = ? OR source_id = ?', [p.id, p.id]))[0].n, 0);
    assert.equal((await sql('SELECT count(*) AS n FROM plugin_meta WHERE key = ?', [`qa:${p.id}`]))[0].n, 0);
  } finally {
    a.close();
  }
});

test('改写法不丢联系方式；回补没读到的部分记成待补；拆开合并时还回被去重的往来并撤回多出的分组', async () => {
  const dir = tmp();
  const a = boot({ libDir: dir });
  try {
    // 只改大小写：页面同时提交删除旧身份和新增新写法
    const p = ok(await a.call('save', { name: '改写法', identities: [{ platform: 'email', value: 'case@example.test' }] }));
    const old = ok(await a.call('get', { id: p.id })).identities.find((i) => i.platform === 'email');
    ok(await a.view('save', { id: p.id, identities: [{ platform: 'email', value: 'Case@Example.test' }], removeIdentityIds: [old.id] }));
    const after = ok(await a.call('get', { id: p.id })).identities.filter((i) => i.platform === 'email');
    assert.deepEqual(after.map((i) => i.value), ['Case@Example.test']);

    // 回补：邮件读全、聊天没读到 → 聊天这段记成待补，下一轮 recent 先补
    ok(await a.call('maintenance', { action: 'end', run_id: ok(await a.call('maintenance', { action: 'begin' })).run_id, coverage: ['mail', 'calendar', 'im', 'cindy'].map((s) => ({ source: s, coverage: 'complete' })) }));
    const bf = ok(await a.call('maintenance', { action: 'begin', scope: 'backfill', months: 1 }));
    assert.equal((await a.call('maintenance', { action: 'end', run_id: bf.run_id })).errorCode, 'COVERAGE_REQUIRED');
    ok(await a.call('maintenance', { action: 'end', run_id: bf.run_id, coverage: bf.sources.map((s) => ({ source: s.source, coverage: s.source === 'im' ? 'none' : 'complete', note: '这个任务里读不到' })) }));
    const next = ok(await a.call('maintenance', { action: 'begin' }));
    assert.ok(next.backlog.some((g) => g.source === 'im' && g.from === bf.from && g.to === bf.to));

    // 合并再拆开：同一来源的往来还给原档案；只因合并加入的分组撤回
    const x = ok(await a.call('save', { name: '甲', identities: [{ platform: 'email', value: 'jia@example.test' }], groups: ['客户'] }));
    const y = ok(await a.call('save', { name: '乙', identities: [{ platform: 'email', value: 'yi@example.test' }] }));
    ok(await a.call('record', { items: [
      { contact_id: x.id, occurred_at: '2026-10-11T15:29:00Z', channel: 'calendar', title: '同一次会议', ref: 'ev-1' },
      { contact_id: y.id, occurred_at: '2026-10-11T15:29:00Z', channel: 'calendar', title: '同一次会议', ref: 'ev-1' },
    ] }));
    const mg = ok(await a.call('merge', { target_id: y.id, source_id: x.id, reason: '测试' }));
    ok(await a.view('unmerge', { id: mg.mergeId }));
    const back = ok(await a.call('get', { id: x.id }));
    assert.ok(back.interactions.some((i) => i.ref === 'ev-1'), 'source keeps its copy of the shared exchange');
    assert.deepEqual(back.groups.map((g) => g.name), ['客户']);
    assert.deepEqual(ok(await a.call('get', { id: y.id })).groups, [], 'target loses the group it only got from the merge');
  } finally {
    a.close();
  }
});

test('包含命中不冒充精确命中；合并链上的快照随最终档案一起删除', async () => {
  const dir = tmp();
  const a = boot({ libDir: dir });
  const sql = async (s, p = []) => (await a.library({ op: 'db.exec', dbPath: 'contacts.sqlite', sql: s, params: p })).rows;
  try {
    ok(await a.call('save', { name: 'Joann', identities: [{ platform: 'email', value: 'joann@example.test' }] }));
    const r = ok(await a.call('find', { query: 'ann@example.test' }));
    assert.equal(r.results[0].matchType, 'text');

    const jia = ok(await a.call('save', { name: '链甲', identities: [{ platform: 'email', value: 'chain-a@example.test' }] }));
    const yi = ok(await a.call('save', { name: '链乙', identities: [{ platform: 'email', value: 'chain-b@example.test' }] }));
    const bing = ok(await a.call('save', { name: '链丙', identities: [{ platform: 'email', value: 'chain-c@example.test' }] }));
    ok(await a.call('merge', { target_id: yi.id, source_id: jia.id, reason: '测试' }));
    ok(await a.call('merge', { target_id: bing.id, source_id: yi.id, reason: '测试' }));
    // 先拆外层（乙←丙），再拆里层（甲←乙）：甲的联系方式要回到甲
    const merges = await sql('SELECT id, source_id FROM contact_merges');
    ok(await a.view('unmerge', { id: merges.find((x) => x.source_id === yi.id).id }));
    ok(await a.view('unmerge', { id: merges.find((x) => x.source_id === jia.id).id }));
    assert.ok(ok(await a.call('get', { id: jia.id })).identities.some((i) => i.value === 'chain-a@example.test'));
    // 再合并一次链，删除最终档案时整条链的快照都清掉
    ok(await a.call('merge', { target_id: yi.id, source_id: jia.id, reason: '测试' }));
    ok(await a.call('merge', { target_id: bing.id, source_id: yi.id, reason: '测试' }));
    ok(await a.call('delete', { id: bing.id, confirm: true }));
    assert.equal((await sql('SELECT count(*) AS n FROM contact_merges'))[0].n, 0);
  } finally {
    a.close();
  }
});

test('拆开合并：共同往来很多也能一次拆开；别的合并仍需要的分组不撤回', async () => {
  const dir = tmp();
  const a = boot({ libDir: dir });
  try {
    const x = ok(await a.call('save', { name: '多甲', identities: [{ platform: 'email', value: 'many-a@example.test' }], groups: ['客户'] }));
    const y = ok(await a.call('save', { name: '多乙', identities: [{ platform: 'email', value: 'many-b@example.test' }] }));
    const z = ok(await a.call('save', { name: '多丙', identities: [{ platform: 'email', value: 'many-c@example.test' }], groups: ['客户'] }));
    for (const id of [x.id, y.id]) {
      for (let k = 0; k < 2; k++) {
        const items = Array.from({ length: 110 }, (_, i) => ({ contact_id: id, occurred_at: '2026-10-11T15:29:00Z', channel: 'calendar', title: '会', ref: `ev-${k * 110 + i}` }));
        ok(await a.call('record', { items }));
      }
    }
    const m1 = ok(await a.call('merge', { target_id: y.id, source_id: x.id, reason: '测试' }));
    ok(await a.call('merge', { target_id: y.id, source_id: z.id, reason: '测试' }));
    ok(await a.view('unmerge', { id: m1.mergeId }));
    assert.equal(ok(await a.call('get', { id: x.id })).interactionTotal, 220);
    assert.deepEqual(ok(await a.call('get', { id: y.id })).groups.map((g) => g.name), ['客户'], 'still needed by the other merge');
  } finally {
    a.close();
  }
});

test('人物页对话：记得上文；删改档案交给任务直接改；快速通道判断要动手时转交', async () => {
  const dir = tmp();
  const a = boot({ libDir: dir });
  try {
    const p = ok(await a.call('save', { name: '姚刘浏', open_loops: ['核对最新日历接口并推进提案或 PR'] }));
    a.tasks.quick = { ok: true, text: '档案里有一条还没完的事：核对最新日历接口。' };
    const q1 = (await a.view('ask', { contactId: p.id, text: '她还有什么事没完' })).result;
    assert.equal(q1.kind, 'answer');

    // 第二句「对的」：快速回答的提示里带着上一轮问答
    a.tasks.quick = { ok: true, text: '[[TASK]]' };
    const q2 = (await a.view('ask', { contactId: p.id, text: '对的' })).result;
    assert.match(a.oneshots.at(-1).prompt, /之前的对话：[\s\S]*她还有什么事没完[\s\S]*核对最新日历接口/);
    // 快速通道判断要动手：转交任务，任务提示带上文并要求直接改
    assert.equal(q2.kind, 'task');
    assert.match(a.tasks.sent.at(-1).text, /之前的对话|接着人物页上之前的对话/);
    assert.match(a.tasks.sent.at(-1).text, /她还有什么事没完/);
    assert.match(a.tasks.sent.at(-1).text, /不要再问确认/);
    assert.match(a.tasks.sent.at(-1).text, /征求意见时，只回答和给建议，不改档案/);
    assert.ok(!(await a.view('qa', { contactId: p.id })).result.some((x) => String(x.a || '').includes('[[TASK]]')));

    // 回答里只是引用到记号，不算转交
    for (let i = 0; i < 100 && !a.events.some((e) => e.name === 'task' && e.data.status === 'done'); i++) await new Promise((r) => setTimeout(r, 20));
    a.tasks.quick = { ok: true, text: '档案里提到了 [[TASK]] 这个写法。' };
    assert.equal((await a.view('ask', { contactId: p.id, text: '档案里有没有写 [[TASK]]' })).result.kind, 'answer');
    // 「帮我删了」不经快速通道，直接交给任务
    const before = a.oneshots.length;
    // 等上一件交给任务的事做完（同一个人同时只跑一件）
    for (let i = 0; i < 100 && !a.events.some((e) => e.name === 'task' && e.data.status === 'done'); i++) await new Promise((r) => setTimeout(r, 20));
    const q3 = (await a.view('ask', { contactId: p.id, text: '没这事儿，帮我删了' })).result;
    assert.equal(q3.kind, 'task');
    assert.equal(a.oneshots.length, before, 'edit requests skip the read-only quick path');
    // 「对不对」是提问，不当成要改
    a.tasks.quick = { ok: true, text: '对。' };
    assert.equal((await a.view('ask', { contactId: p.id, text: '她是做设计的，对不对' })).result.kind, 'answer');
    // 带「不对」「删」的问句也不直接交给会改档案的任务
    assert.equal((await a.view('ask', { contactId: p.id, text: '她这样做不对吗？' })).result.kind, 'answer');
    assert.equal((await a.view('ask', { contactId: p.id, text: '那条待办删了吗' })).result.kind, 'answer');
    assert.equal((await a.view('ask', { contactId: p.id, text: '那条待办删了吗。' })).result.kind, 'answer');
    // 「不对」「错了」是评价，不算要改；「删了吧」是要删
    assert.equal((await a.view('ask', { contactId: p.id, text: '她这样做不对吧' })).result.kind, 'answer');
    assert.equal((await a.view('ask', { contactId: p.id, text: '要不要删这条' })).result.kind, 'answer');
    assert.equal((await a.view('ask', { contactId: p.id, text: '这条删不删' })).result.kind, 'answer');
    for (let i = 0; i < 100 && a.events.filter((e) => e.name === 'task' && e.data.status === 'done').length < 2; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal((await a.view('ask', { contactId: p.id, text: '那就帮我删了吧' })).result.kind, 'task');
  } finally {
    a.close();
  }
});


// Sync uses real Library SQLite transactions in two isolated stores. These cases protect
// offline edits/deletion, unique identities, idempotent transfer and atomic failure.
test('device sync merges offline fields and deletions without resurrecting stale contacts', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contacts-sync-'));
  fs.mkdirSync(path.join(dir, 'a')); fs.mkdirSync(path.join(dir, 'b'));
  let a = boot({ libDir: path.join(dir, 'a') }), b = boot({ libDir: path.join(dir, 'b') });
  const snapshot = async app => JSON.parse((await vm.runInContext('serial(syncSnapshot)', app.ctx)).text);
  const apply = async (app, state) => { app.ctx.remoteState = structuredClone(state); return vm.runInContext('serial(() => syncApply(remoteState))', app.ctx); };
  t.after(() => { a.close(); b.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const person = ok(await a.call('save', { name: 'Example Contact', summary: 'before', identities: [{ platform: 'email', value: 'person@example.test' }] }));
  await b.call('stats');
  await apply(b, await snapshot(a));
  const base = await snapshot(a);
  ok(await a.call('save', { id: person.id, summary: 'A edit' }));
  ok(await b.call('save', { id: person.id, narrative: 'B edit', open_loops: [{ text: 'Reply to example' }] }));
  const as = await snapshot(a), bs = await snapshot(b);
  await apply(a, bs); await apply(b, as);
  for (const app of [a, b]) {
    const contact = ok(await app.call('get', { id: person.id }));
    assert.equal(contact.summary, 'A edit'); assert.equal(contact.narrative, 'B edit');
  }
  assert.deepEqual(await snapshot(a), await snapshot(b));
  ok(await a.call('delete', { id: person.id, confirm: true }));
  ok(await b.call('save', { id: person.id, summary: 'stale offline edit' }));
  const deleted = await snapshot(a);
  await apply(b, deleted); await apply(a, base);
  assert.equal(ok(await a.call('stats')).people, 0);
  assert.equal(ok(await b.call('stats')).people, 0);
  // Crash/restart keeps the tombstone and still captures later local edits.
  b.close(); b = boot({ libDir: path.join(dir, 'b') }); await b.call('stats');
  await apply(b, base);
  assert.equal(ok(await b.call('stats')).people, 0);
});

// P1: irreversible deletion used to retain contact/merge payload in sync metadata.
// Unit regression through real tool + SQLite: disabled sync, rollback, restart and stale replay.
test('device sync erases deleted payload atomically and migrates full tombstones', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contacts-sync-erase-'));
  for (const name of ['a', 'b']) fs.mkdirSync(path.join(dir, name));
  let a = boot({ libDir: path.join(dir, 'a') });
  const b = boot({ libDir: path.join(dir, 'b') });
  t.after(() => { a.close(); b.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const snapshot = async app => JSON.parse((await vm.runInContext('serial(syncSnapshot)', app.ctx)).text);
  const apply = async (app, state) => { app.ctx.remoteState = structuredClone(state); return vm.runInContext('serial(() => syncApply(remoteState))', app.ctx); };
  const stored = app => app.library.db('contacts.sqlite').prepare("SELECT value FROM plugin_meta WHERE key = 'device_sync_state'").get()?.value;
  const source = ok(await a.call('save', { name: 'Private Source', narrative: 'private biography', identities: [{ platform: 'email', value: 'private@example.test' }] }));
  const target = ok(await a.call('save', { name: 'Private Target' }));
  assert.equal(stored(a), undefined);
  await b.call('stats');
  const beforeMerge = await snapshot(a);
  const merge = ok(await a.call('merge', { source_id: source.id, target_id: target.id }));
  const merged = await snapshot(a);
  assert.ok(JSON.stringify(merged).includes('private biography'), 'live merge retains its undo snapshot');
  await apply(b, merged);
  // Both apps have sync disabled/unsupported, but deleting must still clean existing state.
  const beforeDelete = stored(a);
  const db = a.library.db('contacts.sqlite');
  db.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON contacts BEGIN SELECT RAISE(ABORT, 'test rollback'); END");
  const failed = await a.call('delete', { id: target.id, confirm: true });
  assert.equal(failed.ok, false);
  assert.equal(stored(a), beforeDelete, 'sync cleanup must roll back with the business delete');
  assert.equal(ok(await a.call('stats')).people, 1);
  db.exec('DROP TRIGGER fail_delete');
  ok(await a.call('delete', { id: target.id, confirm: true }));
  const assertErased = app => {
    const text = stored(app);
    for (const payload of ['Private Source', 'Private Target', 'private biography', 'private@example.test']) assert.ok(!text.includes(payload), payload);
    const state = JSON.parse(text);
    for (const rows of Object.values(state.tables)) for (const entry of Object.values(rows)) if (!entry.alive[2]) assert.deepEqual(entry.fields, {});
  };
  assertErased(a); // Before any subsequent sync/capture call.
  const deleted = await snapshot(a);
  assert.deepEqual(deleted.tables.contact_merges[JSON.stringify([merge.mergeId])].fields, {});
  await apply(b, deleted); assertErased(b);
  // Simulate a snapshot persisted by the old build, including full deleted merge snapshots.
  const old = JSON.parse(stored(a));
  for (const [table, rows] of Object.entries(old.tables)) for (const [key, entry] of Object.entries(rows)) {
    if (!entry.alive[2]) entry.fields = structuredClone(merged.tables[table]?.[key]?.fields || {});
  }
  old.tables.contacts[JSON.stringify([source.id])].fields = beforeMerge.tables.contacts[JSON.stringify([source.id])].fields;
  db.prepare("UPDATE plugin_meta SET value = ? WHERE key = 'device_sync_state'").run(JSON.stringify(old));
  a.close(); a = boot({ libDir: path.join(dir, 'a') }); await a.call('stats');
  await snapshot(a); assertErased(a);
  await apply(a, beforeMerge); await apply(a, old); assertErased(a);
  await apply(b, old); assertErased(b);
  assert.equal(ok(await a.call('stats')).people, 0);
  assert.equal(ok(await b.call('stats')).people, 0);
});

// P1: children created offline after the other device deletes the parent were hidden
// from SQL but retained/transmitted in CRDT. Exercise both arrival orders and restart.
test('device sync erases concurrent children of a deleted contact', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contacts-sync-children-'));
  for (const name of ['a', 'b']) fs.mkdirSync(path.join(dir, name));
  let a = boot({ libDir: path.join(dir, 'a') });
  const b = boot({ libDir: path.join(dir, 'b') });
  t.after(() => { a.close(); b.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const snapshot = async app => JSON.parse((await vm.runInContext('serial(syncSnapshot)', app.ctx)).text);
  const apply = async (app, state) => { app.ctx.remoteState = structuredClone(state); return vm.runInContext('serial(() => syncApply(remoteState))', app.ctx); };
  const state = app => JSON.parse(app.library.db('contacts.sqlite').prepare("SELECT value FROM plugin_meta WHERE key = 'device_sync_state'").get().value);
  const person = ok(await a.call('save', { name: 'Deleted parent' }));
  const kept = ok(await a.call('save', { name: 'Retained parent' }));
  await b.call('stats'); await apply(b, await snapshot(a));
  ok(await a.call('delete', { id: person.id, confirm: true }));
  const deleted = await snapshot(a);
  ok(await b.call('log_event', { contact_id: person.id, text: 'private-event', date: '2026-10-19' }));
  ok(await b.call('record', { items: [{ contact_id: person.id, title: 'private-exchange', summary: 'private-summary', occurred_at: '2026-10-19T12:00:00Z', channel: 'mail', ref: 'private-ref' }] }));
  ok(await b.call('save', { id: person.id, identities: [{ platform: 'email', value: 'private@example.test' }], open_loops: [{ text: 'private-loop' }], groups: ['Shared group'] }));
  ok(await b.call('relate', { from_id: kept.id, to_id: person.id, relation: 'private-relation' }));
  ok(await b.call('log_event', { contact_id: kept.id, text: 'Keep this event', date: '2026-10-19' }));
  const offline = await snapshot(b);
  const childTables = ['contact_events', 'contact_interactions', 'contact_loops', 'contact_identities', 'contact_group_members', 'contact_relations'];
  const childKeys = childTables.flatMap(table => Object.entries(offline.tables[table]).filter(([, e]) => [e.fields.contact_id?.[2], e.fields.from_id?.[2], e.fields.to_id?.[2]].includes(person.id)).map(([key]) => [table, key]));
  assert.equal(childKeys.length, 6);
  const assertErased = async app => {
    const saved = state(app), outgoing = await snapshot(app);
    for (const value of [saved, outgoing]) {
      assert.ok(!JSON.stringify(value).includes('private-'));
      assert.ok(!JSON.stringify(value).includes('private@example.test'));
      for (const [table, key] of childKeys) { const entry = value.tables[table][key]; assert.ok(entry.pruned, 'derived cleanup retains only ownership versions'); assert.ok(Object.values(entry.pruned).every(version => version.length === 2)); assert.deepEqual(entry.fields, {}); }
    }
    assert.equal(ok(await app.call('stats')).people, 1);
    assert.equal(ok(await app.call('get', { id: kept.id })).events[0].text, 'Keep this event');
  };
  await apply(a, offline); await apply(b, deleted);
  await assertErased(a); await assertErased(b);
  assert.deepEqual(await snapshot(a), await snapshot(b));
  // Old builds could persist hidden children without a business row. Snapshot creation
  // must clean those too, rather than requiring a fresh inbound transfer.
  const legacy = state(a);
  for (const [table, key] of childKeys) legacy.tables[table][key] = offline.tables[table][key];
  a.library.db('contacts.sqlite').prepare("UPDATE plugin_meta SET value = ? WHERE key = 'device_sync_state'").run(JSON.stringify(legacy));
  a.close(); a = boot({ libDir: path.join(dir, 'a') }); await a.call('stats');
  await snapshot(a); await assertErased(a);
  await apply(a, offline); await apply(b, offline);
  await assertErased(a); await assertErased(b);
  assert.deepEqual(await snapshot(a), await snapshot(b));
});

test('device sync reconciles independently imported identities and keeps linked exchanges', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contacts-sync-'));
  for (const name of ['a', 'b', 'c']) fs.mkdirSync(path.join(dir, name));
  let a = boot({ libDir: path.join(dir, 'a') }), b = boot({ libDir: path.join(dir, 'b') });
  const third = boot({ libDir: path.join(dir, 'c') });
  t.after(() => { a.close(); b.close(); third.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const snapshot = async app => JSON.parse((await vm.runInContext('serial(syncSnapshot)', app.ctx)).text);
  const apply = async (app, state) => { app.ctx.remoteState = structuredClone(state); return vm.runInContext('serial(() => syncApply(remoteState))', app.ctx); };
  const ca = ok(await a.call('save', { name: 'Example', identities: [{ platform: 'email', value: 'same@example.test' }], groups: ['Work'] }));
  const cb = ok(await b.call('save', { name: 'Example Alias', identities: [{ platform: 'email', value: 'same@example.test' }], groups: ['Work'] }));
  for (const [app, c, ref] of [[a, ca, 'a'], [b, cb, 'b']]) ok(await app.call('record', { items: [{ contact_id: c.id, occurred_at: '2026-10-19T00:00:00Z', channel: 'mail', title: ref, ref }] }));
  const sa = await snapshot(a), sb = await snapshot(b);
  await apply(a, sb); await apply(b, sa);
  const rows = ok(await a.call('list')).contacts;
  assert.equal(rows.length, 1);
  const c = ok(await a.call('get', { id: rows[0].id }));
  assert.equal(c.interactions.length, 2); assert.deepEqual(c.groups.map(g => g.name), ['Work']);
  await apply(a, sb);
  assert.equal(ok(await a.call('get', { id: rows[0].id })).interactions.length, 2);
  // Removing the shared identity must not split the reconciled profile or exchanges,
  // including on a device that never saw the identity-based reconciliation.
  await third.call('stats'); await apply(third, sb);
  ok(await a.call('save', { id: c.id, remove_identity_ids: c.identities.map(i => i.id) }));
  const removed = await snapshot(a);
  a.close(); a = boot({ libDir: path.join(dir, 'a') }); await a.call('stats');
  for (const app of [a, b, third]) {
    await apply(app, removed); await apply(app, sb);
    assert.equal(ok(await app.call('list')).contacts.length, 1);
    const retained = ok(await app.call('get', { id: c.id }));
    assert.equal(retained.identities.length, 0);
    assert.equal(retained.interactions.length, 2);
  }
  // Deleting the merged projection tombstones every underlying identity, across restart.
  ok(await a.call('delete', { id: rows[0].id, confirm: true }));
  await apply(b, await snapshot(a));
  assert.equal(ok(await b.call('list')).contacts.length, 0);
  // A malformed remote batch cannot partially erase a valid local contact.
  const local = ok(await b.call('save', { name: 'Keep me' }));
  const bad = await snapshot(b);
  const badRow = bad.tables.contacts[JSON.stringify([local.id])];
  badRow.fields.kind = [badRow.fields.kind[0] + 100, badRow.fields.kind[1], 'invalid-kind'];
  await assert.rejects(apply(b, bad));
  assert.equal(ok(await b.call('get', { id: local.id })).name, 'Keep me');
});


test('device sync transfers multiple chunks through the plugin request/reply entry and rejects a partial update', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contacts-wire-'));
  for (const name of ['a', 'b']) fs.mkdirSync(path.join(dir, name));
  const apps = {}, pending = new Map(); let chunks = 0, drop = false, online = true, incompatible = false;
  const transport = name => async req => {
    if (req.op === 'status') return { ok: true, peers: online ? [{ deviceId: name === 'a' ? 'b' : 'a' }] : [] };
    if (req.op === 'reply') { pending.get(req.requestId)?.(req.data); return { ok: true }; }
    if (req.op === 'request') {
      if (incompatible) return { ok: true, data: { error: 'SYNC_VERSION' } };
      if (req.data.kind === 'chunk') { chunks++; if (drop && req.data.index === 1) return { ok: false, errorCode: 'SYNC_RESULT_UNKNOWN' }; }
      const id = crypto.randomUUID(); let reply;
      pending.set(id, value => { reply = structuredClone(value); });
      await apps[req.peer].deliver({ type: 'device-sync-request', requestId: id, peer: name, data: structuredClone(req.data) });
      pending.delete(id); return { ok: true, data: reply };
    }
  };
  apps.a = boot({ libDir: path.join(dir, 'a'), deviceSync: transport('a') });
  apps.b = boot({ libDir: path.join(dir, 'b'), deviceSync: transport('b') });
  t.after(() => { apps.a.close(); apps.b.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  await apps.a.call('stats'); await apps.b.call('stats');
  for (const app of Object.values(apps)) await vm.runInContext("serial(() => batch([setMetaStmt('device_sync_enabled', true)]))", app.ctx);
  for (let i = 0; i < 35; i++) ok(await apps.a.call('save', { name: 'Record ' + i, narrative: 'Example content '.repeat(50) }));
  drop = true;
  await vm.runInContext('syncNow()', apps.a.ctx);
  assert.equal(ok(await apps.b.call('stats')).people, 0, 'no partial rows committed');
  drop = false;
  await vm.runInContext('syncNow()', apps.a.ctx);
  assert.equal(ok(await apps.b.call('stats')).people, 35);
  assert.ok(chunks > 2);
  await vm.runInContext('syncNow()', apps.b.ctx);
  await vm.runInContext('syncNow()', apps.a.ctx);
  assert.equal(vm.runInContext('syncStatus.phase', apps.a.ctx), 'synced');
  // Disabled receivers keep their local data and report the actual status.
  await vm.runInContext("serial(() => batch([setMetaStmt('device_sync_enabled', false)]))", apps.b.ctx);
  ok(await apps.a.call('save', { name: 'Not yet shared' }));
  await vm.runInContext('syncNow()', apps.a.ctx);
  assert.equal(ok(await apps.b.call('stats')).people, 35);
  assert.equal(vm.runInContext('syncStatus.error.code', apps.a.ctx), 'SYNC_PEER_DISABLED');
  incompatible = true;
  await vm.runInContext('syncNow()', apps.a.ctx);
  assert.equal(vm.runInContext('syncStatus.error.code', apps.a.ctx), 'SYNC_VERSION');
  assert.match(vm.runInContext('syncStatus.error.message', apps.a.ctx), /更新两台电脑上的通讯录插件/);
  online = false;
  await vm.runInContext('syncNow()', apps.a.ctx);
  assert.equal(vm.runInContext('syncStatus.phase', apps.a.ctx), 'waiting');
});


// P1: derived cleanup must not defeat a later legitimate reassignment. Exercise
// both arrival orders through real SQLite/sync, then replay and explicit deletion.
test('device sync preserves a legitimately moved event regardless of cleanup arrival order', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contacts-sync-move-'));
  const apps = [];
  t.after(() => { for (const app of apps) app.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const snapshot = async app => JSON.parse((await vm.runInContext('serial(syncSnapshot)', app.ctx)).text);
  const apply = async (app, state) => { app.ctx.remoteState = structuredClone(state); return vm.runInContext('serial(() => syncApply(remoteState))', app.ctx); };
  for (const early of [true, false]) {
    for (const name of ['a', 'b']) fs.mkdirSync(path.join(dir, `${early}-${name}`));
    const a = boot({ libDir: path.join(dir, `${early}-a`) }), b = boot({ libDir: path.join(dir, `${early}-b`) }); apps.push(a, b);
    const x = ok(await a.call('save', { name: 'X' })), y = ok(await a.call('save', { name: 'Y' }));
    await b.call('stats'); await apply(b, await snapshot(a));
    ok(await a.call('delete', { id: x.id, confirm: true }));
    ok(await b.call('log_event', { contact_id: x.id, text: 'Moved event payload', date: '2026-10-19' }));
    const before = await snapshot(b);
    let cleaned;
    if (early) {
      await apply(a, before); cleaned = await snapshot(a);
      assert.ok(!JSON.stringify(cleaned).includes('Moved event payload'));
    }
    ok(await b.call('merge', { source_id: x.id, target_id: y.id }));
    const moved = await snapshot(b);
    await apply(a, moved);
    if (cleaned) await apply(b, cleaned);
    await apply(b, await snapshot(a)); await apply(a, before);
    for (const app of [a, b]) {
      const contact = ok(await app.call('get', { id: y.id }));
      assert.deepEqual(contact.events.map(e => e.text), ['Moved event payload']);
      assert.equal(ok(await app.call('stats')).people, 1);
    }
    assert.deepEqual(await snapshot(a), await snapshot(b));
    ok(await a.call('delete', { id: y.id, confirm: true }));
    await apply(b, await snapshot(a)); await apply(a, moved); await apply(b, moved);
    for (const app of [a, b]) {
      assert.equal(ok(await app.call('stats')).people, 0);
      assert.ok(!JSON.stringify(await snapshot(app)).includes('Moved event payload'));
    }
  }
});

test('device sync retains an offline event added to a contact merged on another device', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contacts-merge-sync-'));
  for (const name of ['a', 'b']) fs.mkdirSync(path.join(dir, name));
  const a = boot({ libDir: path.join(dir, 'a') }), b = boot({ libDir: path.join(dir, 'b') });
  t.after(() => { a.close(); b.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const snapshot = async app => JSON.parse((await vm.runInContext('serial(syncSnapshot)', app.ctx)).text);
  const apply = async (app, state) => { app.ctx.remoteState = structuredClone(state); return vm.runInContext('serial(() => syncApply(remoteState))', app.ctx); };
  const from = ok(await a.call('save', { name: 'Source' })), to = ok(await a.call('save', { name: 'Target' }));
  await b.call('stats'); await apply(b, await snapshot(a));
  ok(await a.call('merge', { source_id: from.id, target_id: to.id, reason: 'same person' }));
  ok(await b.call('log_event', { contact_id: from.id, text: 'Offline event', date: '2026-10-19' }));
  const sa = await snapshot(a), sb = await snapshot(b);
  await apply(a, sb); await apply(b, sa);
  for (const app of [a,b]) {
    assert.equal(ok(await app.call('list')).contacts.length, 1);
    assert.ok(ok(await app.call('get', { id: to.id })).events.some(e => e.text === 'Offline event'));
  }
});

test('device sync stops opposing offline merges without deleting either local target', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contacts-conflict-sync-'));
  for (const name of ['a', 'b']) fs.mkdirSync(path.join(dir, name));
  const a = boot({ libDir: path.join(dir, 'a') }), b = boot({ libDir: path.join(dir, 'b') });
  t.after(() => { a.close(); b.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const snapshot = async app => JSON.parse((await vm.runInContext('serial(syncSnapshot)', app.ctx)).text);
  const apply = async (app, value) => { app.ctx.remoteState = structuredClone(value); return vm.runInContext('serial(() => syncApply(remoteState))', app.ctx); };
  const one = ok(await a.call('save', { name: 'One' })), two = ok(await a.call('save', { name: 'Two' }));
  await b.call('stats'); await apply(b, await snapshot(a));
  const merged = ok(await a.call('merge', { source_id: one.id, target_id: two.id, reason: 'duplicate' }));
  ok(await b.call('merge', { source_id: two.id, target_id: one.id, reason: 'duplicate' }));
  const sa = await snapshot(a), sb = await snapshot(b);
  await assert.rejects(apply(a, sb), { code: 'SYNC_MERGE_CONFLICT' });
  await assert.rejects(apply(b, sa), { code: 'SYNC_MERGE_CONFLICT' });
  assert.equal(ok(await a.call('list')).contacts[0].id, two.id);
  assert.equal(ok(await b.call('list')).contacts[0].id, one.id);
  ok(await a.view('unmerge', { id: merged.mergeId }));
  await apply(b, await snapshot(a));
  await apply(a, await snapshot(b));
  assert.deepEqual(await snapshot(a), await snapshot(b));
  assert.equal(ok(await a.call('list')).contacts.length, 1);
});

// Regression: default-off startup must not duplicate business data or poll Library.
// Real settings/SQL entry points, controlled timers; no wall-clock polling wait.
test('device sync stays idle until enabled and stops polling when disabled', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contacts-sync-idle-'));
  const apps = [];
  t.after(() => { for (const app of apps) app.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  for (const supported of [false, true]) {
    const libDir = path.join(dir, String(supported)); fs.mkdirSync(libDir);
    const scheduled = new Map(); let next = 0, requests = 0;
    const timers = {
      setTimeout: (fn, ms) => { const id = ++next; scheduled.set(id, { fn, ms }); return id; },
      clearTimeout: id => scheduled.delete(id),
    };
    const app = boot({ libDir, timers, deviceSync: supported ? async () => { requests++; return { ok: true, peers: [] }; } : null });
    apps.push(app);
    ok(await app.call('save', { name: 'Local only' }));
    const state = () => app.library.db('contacts.sqlite').prepare("SELECT value FROM plugin_meta WHERE key = 'device_sync_state'").get();
    const polls = () => [...scheduled.entries()].filter(([, timer]) => timer.ms < 60000);
    assert.equal(state(), undefined);
    assert.equal(polls().length, 0);
    if (!supported) continue;
    ok(await app.view('deviceSync', { enabled: true }));
    const [id, timer] = polls()[0]; scheduled.delete(id); await timer.fn();
    assert.ok(state()); assert.equal(requests, 1);
    const pendingPoll = polls()[0][1];
    assert.equal(pendingPoll.ms, 15000);
    ok(await app.view('deviceSync', { enabled: false }));
    assert.equal(polls().length, 0);
    // An already-dispatched callback must not re-arm after disabling.
    await pendingPoll.fn();
    assert.equal(polls().length, 0); assert.equal(requests, 1);
    ok(await app.call('save', { name: 'Still local' }));
    assert.equal(polls().length, 0);
  }
});
