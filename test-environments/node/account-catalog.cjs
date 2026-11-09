'use strict';
// Public references only. Session credentials remain in the target application's vault.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function rememberAccounts(home, plan, application, snapshot) {
  const lock = path.join(home, '.catalog-lock');
  try { fs.mkdirSync(lock, {mode: 0o700}); }
  catch (error) { if (error.code === 'EEXIST') return {saved: false, reason: 'CATALOG_BUSY'}; throw error; }
  try {
    const file = path.join(home, 'catalog.json');
    const db = JSON.parse(fs.readFileSync(file, 'utf8'));
    const profile = db.profiles[plan.profile];
    // A live job must not resurrect deleted or rebound catalog entries.
    if (!profile || profile.project !== plan.project || db.projects[plan.project]?.root !== plan.projectRoot ||
        profile.isolated !== plan.configuration.isolated) return {saved: false, reason: 'PROFILE_CHANGED'};
    let changed = false;
    const visible = new Set();
    for (const item of snapshot.accounts) {
      if (typeof item.accountKey !== 'string' || !item.accountKey || item.accountKey.length > 512 || item.accountKey.includes('\0'))
        throw Object.assign(new Error('Invalid application account reference.'), {code: 'INVALID_ACCOUNT_SNAPSHOT'});
      const label = typeof item.displayName === 'string' && item.displayName.trim() ? item.displayName.slice(0, 256) : 'Cindy account';
      let record = Object.values(db.accounts).find(a => a.project === plan.project && a.selector === item.accountKey);
      if (!record) {
        record = {id: crypto.randomUUID(), project: plan.project, selector: item.accountKey, label};
        db.accounts[record.id] = record;
        changed = true;
      }
      visible.add(record.id);
      const old = record.sessions?.[plan.profile];
      const session = {profile: plan.profile, isolated: profile.isolated, userDataDir: application.userDataDir,
        listed: true, ...(old?.lastAuthenticatedAt ? {lastAuthenticatedAt: old.lastAuthenticatedAt} : {})};
      if (item.isCurrent === true && snapshot.authenticated === true && !session.lastAuthenticatedAt)
        session.lastAuthenticatedAt = Date.now();
      if (JSON.stringify(old) !== JSON.stringify(session)) {
        record.sessions = {...record.sessions, [plan.profile]: session}; changed = true;
      }
    }
    // Historical references survive logout. Listed does not promise unexpired auth.
    for (const record of Object.values(db.accounts)) {
      const old = record.project === plan.project && record.sessions?.[plan.profile];
      if (old?.listed && !visible.has(record.id)) { old.listed = false; changed = true; }
    }
    const beforeLibrary = JSON.stringify(db.loginAccounts);
    require('./login-library.cjs').migrateLoginAccounts(db);
    require('./login-library.cjs').rememberLoginAccounts(db, profile, application, snapshot);
    if (JSON.stringify(db.loginAccounts) !== beforeLibrary) changed = true;
    if (!changed) return {saved: true, changed: false};
    db.revision++;
    const tmp = `${file}.${crypto.randomUUID()}.tmp`;
    try { fs.writeFileSync(tmp, JSON.stringify(db, null, 2) + '\n', {flag: 'wx', mode: 0o600}); fs.renameSync(tmp, file); }
    finally { try { fs.unlinkSync(tmp); } catch {} }
    return {saved: true, changed: true};
  } finally { fs.rmdirSync(lock); }
}

module.exports = {rememberAccounts};
