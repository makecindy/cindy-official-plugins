// Local bounded evidence. No comments, model explanations or API error text are retained.
import fs from 'node:fs';
import path from 'node:path';
const LIMIT = 2 * 1024 * 1024;
export function scrub(value, humanPattern) {
  if (Array.isArray(value)) return value.map(v => scrub(v, humanPattern));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (['body','title','reason','detail','report','error','stderr'].includes(key)) {
      if (key === 'body') out.body = String(item ?? '').trim() ? (humanPattern?.test(String(item)) ? 'approval' : 'redacted') : '';
      continue;
    }
    out[key] = scrub(item, humanPattern);
  }
  return out;
}
// Shared directory budget includes completed PRs. Only ordinary trace files are eligible.
export function pruneTraces(dir, now = Date.now()) {
  let files = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.trace.jsonl') && !name.endsWith('.trace.jsonl.1')) continue;
    const file = path.join(dir,name);
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile()) continue;
      if (now-stat.mtimeMs > 14*24*3600000) { fs.unlinkSync(file); continue; }
      files.push({file,mtime:stat.mtimeMs,size:stat.size});
    } catch { /* Another follower may have rotated a file. */ }
  }
  let total = files.reduce((n,f)=>n+f.size,0);
  for(const f of files.sort((a,b)=>a.mtime-b.mtime)) {
    if(total<=32*1024*1024) break;
    try { fs.unlinkSync(f.file);total-=f.size; } catch { }
  }
}
export function appendTrace(file, record) {
  try {
    let line = JSON.stringify(record) + '\n';
    if (Buffer.byteLength(line) > LIMIT) line = JSON.stringify({schema:1,at:record.at,replayable:false,exitCode:record.exitCode,decision:record.decision,omitted:'record-too-large'})+'\n';
    fs.mkdirSync(path.dirname(file), {recursive:true});
    if (fs.existsSync(file) && fs.statSync(file).size + Buffer.byteLength(line) > LIMIT) {
      fs.renameSync(file, file + '.1');
    }
    fs.appendFileSync(file, line, {mode:0o600});
    pruneTraces(path.dirname(file));
  } catch { /* A full disk must not change the follow decision. */ }
}
