'use strict';
const path = require('node:path');
const {tree} = require('./activity.cjs');
const {commandBudget} = require('./budget.cjs');

// An explicit snapshot, never a polling loop. Callers resolve an owned device
// and its directory/PID; page-supplied paths or process IDs are not accepted.
async function resourceUsage({device, directory, pid, run, deadline, host = process.platform, metrics = ['memory','disk']}) {
  const unavailable = status => ({bytes:null, status});
  async function memory() {
    if (!['darwin','linux'].includes(host)) return unavailable('unsupported');
    const {stdout} = await run('/bin/ps', ['-axww','-o','pid=,ppid=,rss=,args='], {...commandBudget(3000,deadline), maxBuffer:8*1024*1024});
    const lines = stdout.trim().split('\n').filter(line => line.trim());
    const processes = lines.map(line => {
      const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
      return m && {pid:Number(m[1]), ppid:Number(m[2]), bytes:Number(m[3])*1024, args:m[4]};
    });
    if (!processes.length || processes.some(p => !p || !Number.isSafeInteger(p.bytes))) return unavailable('unavailable');
    let roots;
    if (device.platform === 'android') roots = processes.filter(p => p.pid === pid);
    else {
      const bootstrap = path.join(directory,'data/var/run/launchd_bootstrap.plist');
      roots = processes.filter(p => p.args.match(/(?:^|\/)launchd_sim (.+)$/)?.[1] === bootstrap);
    }
    if (roots.length !== 1) return device.platform !== 'android' && device.state === 'Shutdown' && !roots.length
      ? {bytes:0, status:'ok', processCount:0} : unavailable('unattributed');
    let measured = processes;
    // macOS RSS repeats the shared runtime's resident libraries in every guest
    // process. top's MEM is the physical footprint (see macOS top(1)), which is
    // a much more useful estimate here. Use one fresh parent/process snapshot.
    if (host === 'darwin') {
      const result = await run('/usr/bin/top', ['-l','1','-stats','pid,ppid,mem,command','-n','99999'], {...commandBudget(5000,deadline),maxBuffer:8*1024*1024});
      const rows = result.stdout.split('\n').filter(line => /^\s*\d+\s+\d+\s/.test(line));
      measured = rows.map(line => {
        const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)([BKMGT])(?:[+-])?\s+(.+)$/);
        return m && {pid:Number(m[1]),ppid:Number(m[2]),bytes:Math.round(Number(m[3])*1024**'BKMGT'.indexOf(m[4])),args:m[5].trim()};
      });
      if (!measured.length || measured.some(p => !p || !Number.isSafeInteger(p.bytes))) return unavailable('unavailable');
      const root = measured.find(p => p.pid === roots[0].pid);
      if (!root || (device.platform !== 'android' && root.args !== 'launchd_sim')) return unavailable('unattributed');
    }
    const members = tree(measured, roots[0].pid);
    const own = measured.filter(p => members.has(p.pid));
    return {bytes:own.reduce((sum,p) => sum+p.bytes,0), status:'ok', processCount:own.length,method:host==='darwin'?'physical-footprint':'rss'};
  }
  async function disk() {
    if (!['darwin','linux'].includes(host)) return unavailable('unsupported');
    // Allocated blocks, not the virtual disk's advertised capacity. Never
    // follow symlinks or cross mounts into shared runtimes / other volumes.
    const {stdout} = await run('/usr/bin/du', ['-sk','-P','-x',directory], commandBudget(10000,deadline));
    const match = stdout.trim().match(/^(\d+)\s+[^\n]+$/);
    const bytes = match ? Number(match[1])*1024 : NaN;
    return Number.isSafeInteger(bytes) ? {bytes,status:'ok'} : unavailable('unavailable');
  }
  const results = await Promise.allSettled(metrics.map(metric => metric === 'memory' ? memory() : disk()));
  const value = r => r.status === 'fulfilled' ? r.value : unavailable('unavailable');
  return {udid:device.udid, sampledAt:new Date().toISOString(), ...Object.fromEntries(metrics.map((metric,i) => [metric,value(results[i])]))};
}

// Worker-local cache shared by all GUI surfaces. Ownership is resolved by the
// caller before every read; neither paths nor PIDs are accepted from a page.
// No timer or persistence: only a visible device or explicit refresh samples.
function createResourceCache({measure = resourceUsage, now = Date.now} = {}) {
  const entries = new Map();
  const ttl = {memory:15000, disk:300000};
  async function read(options) {
    const {device,directory,pid,host = process.platform,refresh = false} = options;
    const key = JSON.stringify([host,directory,device.udid]);
    let entry = entries.get(key);
    if (!entry) { entry = {}; entries.set(key,entry); }
    // A known lifecycle change must not carry running memory into an off
    // device (or vice versa). Disk remains an explicitly timestamped estimate.
    const identity = JSON.stringify([device.state,pid]);
    if (entry.identity !== identity) { entry.identity = identity; delete entry.memory; }
    entries.delete(key); entries.set(key,entry);
    for (const [oldKey,old] of entries) {
      if (entries.size <= 64) break;
      if (!old.memory?.pending && !old.disk?.pending) entries.delete(oldKey);
    }
    async function metric(name) {
      let slot = entry[name];
      if (!slot) slot = entry[name] = {value:null, checkedAt:-Infinity, pending:null};
      if (slot.pending) return slot.pending;
      const age = now() - slot.checkedAt;
      const lifetime = slot.value?.status === 'ok' && !slot.value.stale ? ttl[name] : 30000;
      if (!refresh && age >= 0 && age < lifetime) return slot.value;
      slot.pending = Promise.resolve().then(async () => {
        let measured;
        try { measured = (await measure({...options,metrics:[name]}))[name]; } catch {}
        const sampledAt = new Date(now()).toISOString();
        slot.value = measured?.status === 'ok' || !slot.value || slot.value.status !== 'ok'
          ? {...(measured || {bytes:null,status:'unavailable'}),sampledAt}
          : {...slot.value,stale:true};
        slot.checkedAt = now();
        return slot.value;
      });
      try { return await slot.pending; } finally { slot.pending = null; }
    }
    const [memory,disk] = await Promise.all([metric('memory'),metric('disk')]);
    return {udid:device.udid,memory,disk,sampledAt:memory.sampledAt};
  }
  return {read};
}
const shared = createResourceCache();
module.exports = {resourceUsage,createResourceCache,cachedResourceUsage:options=>shared.read(options)};
