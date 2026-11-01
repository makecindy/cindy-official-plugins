'use strict';
/**
 * cindy-contacts Node 工作进程。
 *
 * 只做两件 main.js 沙箱做不到的事：
 *  1. 只读读取旧版内置通讯录（同账号 owner 目录下 maker-contacts/contacts.db），
 *     供插件首次启动时复制一份数据；旧库永不写入。
 *  2. 经 osascript（JXA）读取 macOS 系统通讯录，供用户主动导入。
 *
 * 结果一律分页返回：单行 stdout 有 1MB 上限，整库或整本通讯录不能一次塞进一条响应。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { execFile } = require('node:child_process');

function reply(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}
function ok(id, result) {
  reply({ jsonrpc: '2.0', id, result });
}
function fail(id, code, message) {
  reply({ jsonrpc: '2.0', id, error: { code: -32000, message: code + ': ' + message, data: { code } } });
}

/* ───────────── 旧版内置通讯录 ───────────── */

// 插件安装在 <userData>/owners/<ownerId>/cindy-brain/…/<ghostId>/node/worker.cjs；中间层级随宿主
// 安装布局变化（如 cindy-brain/_ns/_root/<ghostId>），不能写死层数。
// 只从自身安装位置向上找到「当前账号」的 owner 目录（父目录名为 owners），不枚举其它账号。
function legacyDbPath(startDir = __dirname) {
  let dir = path.resolve(startDir);
  for (let depth = 0; depth < 12; depth++) {
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    if (path.basename(parent) === 'owners') {
      const file = path.join(dir, 'maker-contacts', 'contacts.db');
      return fs.existsSync(file) ? file : null;
    }
    dir = parent;
  }
  return null;
}

const LEGACY_TABLES = {
  contacts: {
    cols: 'id, kind, display_name, aliases, summary, narrative, agent_notes, status, source, created_at, updated_at',
    order: 'created_at, id',
  },
  contact_identities: {
    cols: 'id, contact_id, platform, value, normalized_value, label, note, created_at',
    order: 'created_at, id',
  },
  contact_events: { cols: 'id, contact_id, date, text, source, created_at', order: 'created_at, id' },
  contact_groups: { cols: 'id, name, description, created_at', order: 'created_at, id' },
  contact_group_members: { cols: 'group_id, contact_id', order: 'group_id, contact_id' },
  contact_relations: {
    cols: 'id, from_id, to_id, relation, note, created_at',
    order: 'created_at, id',
    optional: true,
  },
};

let legacyDb = null;
let legacyTmpDir = null;

function openLegacy() {
  if (legacyDb) return legacyDb;
  const file = process.env.CINDY_CONTACTS_LEGACY_DB_FOR_TEST || legacyDbPath();
  if (!file || !fs.existsSync(file)) return null;
  const { DatabaseSync } = require('node:sqlite');
  try {
    legacyDb = new DatabaseSync(file, { readOnly: true });
    legacyDb.prepare('SELECT count(*) AS n FROM contacts').get();
    return legacyDb;
  } catch (_) {
    // WAL 共享内存不可用时，复制一份快照（含 -wal/-shm）再只读打开，旧库本身不动。
    try {
      if (legacyDb) legacyDb.close();
    } catch (_) { /* ignore */ }
    legacyTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-contacts-'));
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(file + suffix)) fs.copyFileSync(file + suffix, path.join(legacyTmpDir, 'contacts.db' + suffix));
    }
    legacyDb = new DatabaseSync(path.join(legacyTmpDir, 'contacts.db'), { readOnly: true });
    return legacyDb;
  }
}

function closeLegacy() {
  try {
    if (legacyDb) legacyDb.close();
  } catch (_) { /* ignore */ }
  legacyDb = null;
  if (legacyTmpDir) {
    try {
      fs.rmSync(legacyTmpDir, { recursive: true, force: true });
    } catch (_) { /* ignore */ }
    legacyTmpDir = null;
  }
}

function tableExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function legacyProbe() {
  const db = openLegacy();
  if (!db) return { found: false };
  const counts = {};
  for (const [name, spec] of Object.entries(LEGACY_TABLES)) {
    if (!tableExists(db, name)) {
      if (spec.optional) {
        counts[name] = 0;
        continue;
      }
      return { found: false, reason: 'schema-mismatch' };
    }
    counts[name] = Number(db.prepare(`SELECT count(*) AS n FROM ${name}`).get().n);
  }
  return { found: true, counts };
}

function legacyRead(params) {
  const spec = LEGACY_TABLES[params && params.table];
  if (!spec) throw Object.assign(new Error('unknown table'), { code: 'INVALID_PARAMS' });
  const db = openLegacy();
  if (!db) throw Object.assign(new Error('legacy contacts not found'), { code: 'NOT_FOUND' });
  if (spec.optional && !tableExists(db, params.table)) return { rows: [] };
  const offset = Math.max(0, Number(params.offset) || 0);
  const limit = Math.min(200, Math.max(1, Number(params.limit) || 100));
  const rows = db
    .prepare(`SELECT ${spec.cols} FROM ${params.table} ORDER BY ${spec.order} LIMIT ? OFFSET ?`)
    .all(limit, offset)
    .map((r) => ({ ...r }));
  return { rows };
}

/* ───────────── macOS 系统通讯录 ───────────── */

// 一次 Apple Event 取全量属性数组；逐条访问会慢几个数量级。
const JXA_READ = `
(() => {
  const Contacts = Application('Contacts');
  const people = Contacts.people;
  const names = people.name();
  const orgs = people.organization();
  const titles = people.jobTitle();
  const ids = people.id();
  const companies = people.company();
  const emailValues = people.emails.value();
  const emailLabels = people.emails.label();
  const phoneValues = people.phones.value();
  const phoneLabels = people.phones.label();
  const out = [];
  for (let i = 0; i < names.length; i++) {
    out.push({
      name: names[i] || '',
      org: orgs[i] || '',
      title: titles[i] || '',
      id: ids[i] || '',
      isCompany: !!companies[i],
      emails: (emailValues[i] || []).map((v, j) => ({ v: v || '', l: (emailLabels[i] || [])[j] || '' })),
      phones: (phoneValues[i] || []).map((v, j) => ({ v: v || '', l: (phoneLabels[i] || [])[j] || '' })),
    });
  }
  return JSON.stringify(out);
})()
`;

function cleanLabel(raw) {
  const m = String(raw || '').match(/^_\$!<(.+)>!\$_$/);
  return (m ? m[1] : String(raw || '')).trim().toLowerCase();
}

let systemCache = null;

function normalizeSystemRecords(raw) {
  return raw
    .filter((p) => String(p.name || '').trim())
    .map((p) => ({
      id: String(p.id || ''),
      name: String(p.name).trim(),
      org: String(p.org || '').trim(),
      title: String(p.title || '').trim(),
      isCompany: !!p.isCompany,
      emails: (p.emails || [])
        .filter((e) => String(e.v || '').trim())
        .map((e) => ({ value: String(e.v).trim(), label: cleanLabel(e.l) })),
      phones: (p.phones || [])
        .filter((e) => String(e.v || '').trim())
        .map((e) => ({ value: String(e.v).trim(), label: cleanLabel(e.l) })),
    }));
}

function systemRead() {
  return new Promise((resolve, reject) => {
    if (process.env.CINDY_CONTACTS_SYSTEM_FIXTURE_FOR_TEST) {
      systemCache = normalizeSystemRecords(JSON.parse(fs.readFileSync(process.env.CINDY_CONTACTS_SYSTEM_FIXTURE_FOR_TEST, 'utf8')));
      resolve({ total: systemCache.length });
      return;
    }
    if (process.platform !== 'darwin') {
      reject(Object.assign(new Error('macOS only'), { code: 'UNSUPPORTED' }));
      return;
    }
    // 首次调用会弹系统授权，osascript 阻塞到用户点击；超时要给足决策时间。
    execFile(
      'osascript',
      ['-l', 'JavaScript', '-e', JXA_READ],
      { timeout: 110_000, maxBuffer: 128 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          const msg = String(err.message || err);
          if (msg.includes('-1743') || /not authori[sz]ed/i.test(msg)) {
            reject(Object.assign(new Error('Cindy 没有读取「通讯录」的权限：到「系统设置 → 隐私与安全性 → 自动化」里允许 Cindy 控制「通讯录」，然后重试。'), { code: 'PERMISSION_DENIED' }));
          } else if (err.killed) {
            reject(Object.assign(new Error('读取 macOS 通讯录超时：可能是系统授权弹窗还没点，或通讯录很大。点掉授权弹窗后重试；仍超时就先打开「通讯录」App 再试。'), { code: 'TIMEOUT' }));
          } else {
            reject(Object.assign(new Error(msg.slice(0, 300)), { code: 'INTERNAL' }));
          }
          return;
        }
        let raw;
        try {
          raw = JSON.parse(String(stdout).trim());
        } catch (_) {
          reject(Object.assign(new Error('unexpected output'), { code: 'INTERNAL' }));
          return;
        }
        systemCache = normalizeSystemRecords(raw);
        resolve({ total: systemCache.length });
      },
    );
  });
}

function systemPage(params) {
  if (!systemCache) throw Object.assign(new Error('call system/read first'), { code: 'INVALID_STATE' });
  const offset = Math.max(0, Number(params && params.offset) || 0);
  const limit = Math.min(300, Math.max(1, Number(params && params.limit) || 200));
  const records = systemCache.slice(offset, offset + limit);
  const done = offset + limit >= systemCache.length;
  // 最后一页取走后释放内存，联系人明文不在 worker 里久留。
  if (done) systemCache = null;
  return { records, done };
}

/* ───────────── JSON-RPC ───────────── */

const handlers = {
  // 测试夹具只能经测试进程的环境变量开启；宿主启动 worker 时不透传这些变量。
  'env/info': () => ({ platform: process.env.CINDY_CONTACTS_SYSTEM_FIXTURE_FOR_TEST ? 'darwin' : process.platform }),
  'legacy/probe': () => legacyProbe(),
  'legacy/read': (p) => legacyRead(p),
  'legacy/close': () => {
    closeLegacy();
    return { closed: true };
  },
  'system/read': () => systemRead(),
  'system/page': (p) => systemPage(p),
};

readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch (_) {
    reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  const handler = handlers[request.method];
  if (!handler) {
    reply({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } });
    return;
  }
  try {
    ok(request.id, await handler(request.params || {}));
  } catch (e) {
    fail(request.id, e.code || 'INTERNAL', String(e.message || e));
  }
});
