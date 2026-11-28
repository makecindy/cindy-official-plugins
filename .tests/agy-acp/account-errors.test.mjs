'use strict';

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../cindy-antigravity-acp');
const require = createRequire(import.meta.url);
const { accountErrorRelay, classifyAccountErrorResponse } = require(path.join(root, 'agy-account-errors.js'));

const NOW = Date.parse('2026-11-27T01:00:00.000Z');
const QUOTA_MSG = 'Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 2h13m2s.';
const EXPECTED_RESET_MS = NOW + ((2 * 60 + 13) * 60 + 2) * 1000;

function makeFakeAgyEnv(t, scriptBody) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-official-quota-err-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const jsPath = path.join(dir, 'fake-agy.js');
  fs.writeFileSync(jsPath, scriptBody, 'utf8');
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir);
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(binDir, 'agy.cmd'), `@echo off\r\n"${process.execPath}" "${jsPath}" %*\r\n`, 'utf8');
  } else {
    const sh = path.join(binDir, 'agy');
    fs.writeFileSync(sh, `#!/bin/sh\nexec "${process.execPath}" "${jsPath}" "$@"\n`, { mode: 0o755 });
  }
  const configRoot = path.join(dir, 'config');
  fs.mkdirSync(configRoot);
  return {
    ...process.env,
    PATH: binDir + path.delimiter + (process.env.PATH || ''),
    XDG_CONFIG_HOME: configRoot,
    HOME: dir,
    USERPROFILE: dir,
    APPDATA: configRoot,
  };
}

function startRelay(env, args = []) {
  const child = spawn(process.execPath, [path.join(root, 'agy-acp.js'), ...args], {
    env,
    cwd: os.tmpdir(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = [];
  let buf = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) lines.push(JSON.parse(line));
    }
  });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  const closed = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  return {
    child,
    lines,
    stderr: () => stderr,
    send: (msg) => child.stdin.write(JSON.stringify(msg) + '\n'),
    closed,
  };
}

async function waitFor(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

describe('cindy-antigravity-acp account-errors', () => {
  test('classifies Individual quota reached with relative reset countdown, structured quota, auth and overload', () => {
    const individual = classifyAccountErrorResponse({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32603, message: QUOTA_MSG },
    }, NOW);
    assert.deepEqual(individual.error.data._meta.cindy, { kind: 'usage-limit', resetsAt: EXPECTED_RESET_MS });

    const structured = classifyAccountErrorResponse({
      jsonrpc: '2.0',
      id: 2,
      error: { code: -32603, message: 'quota', data: { reason: 'QUOTA_EXHAUSTED', resetTime: '2026-11-27T04:00:00.000Z' } },
    }, NOW);
    assert.deepEqual(structured.error.data._meta.cindy, {
      kind: 'usage-limit',
      resetsAt: Date.parse('2026-11-27T04:00:00.000Z'),
    });

    const overloaded = classifyAccountErrorResponse({
      jsonrpc: '2.0',
      id: 3,
      error: { code: -32603, message: 'MODEL_CAPACITY_EXHAUSTED', data: { reason: 'MODEL_CAPACITY_EXHAUSTED' } },
    }, NOW);
    assert.deepEqual(overloaded.error.data._meta.cindy, { kind: 'overloaded' });

    const auth = classifyAccountErrorResponse({
      jsonrpc: '2.0',
      id: 4,
      error: { code: -32000, message: 'Authentication required' },
    }, NOW);
    assert.deepEqual(auth.error.data._meta.cindy, { kind: 'auth-required' });

    const unrelated = { jsonrpc: '2.0', id: 5, error: { code: -32603, message: 'Tool timed out' } };
    assert.equal(classifyAccountErrorResponse(unrelated, NOW), unrelated);
  });

  test('accountErrorRelay converts terminal agy warning chunk + end_turn into classified usage-limit RPC error', () => {
    const relay = accountErrorRelay(() => NOW);
    relay.request({ jsonrpc: '2.0', id: 10, method: 'session/prompt', params: { sessionId: 's1', prompt: [] } });

    assert.deepEqual(
      relay.notification({
        jsonrpc: '2.0',
        method: 'session/update',
        params: { sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `\n⚠ ${QUOTA_MSG}\n` } } },
      }),
      { hold: true },
    );

    assert.equal(
      relay.notification({
        jsonrpc: '2.0',
        method: 'session/update',
        params: { sessionId: 's1', update: { sessionUpdate: 'usage_update', used: 100, size: 100000 } },
      }),
      null,
    );

    const converted = relay.response({ jsonrpc: '2.0', id: 10, result: { stopReason: 'end_turn' } });
    assert.equal(converted.result, undefined);
    assert.equal(converted.error.code, -32603);
    assert.equal(converted.error.message, QUOTA_MSG);
    assert.deepEqual(converted.error.data._meta.cindy, { kind: 'usage-limit', resetsAt: EXPECTED_RESET_MS });
  });

  test('accountErrorRelay flushes held warning if real content follows and never converts cancelled or replay chunks', () => {
    const relay = accountErrorRelay(() => NOW);
    const warnMsg = {
      jsonrpc: '2.0',
      method: 'session/update',
      params: { sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `\n⚠ ${QUOTA_MSG}\n` } } },
    };

    assert.equal(relay.notification(warnMsg), null);

    relay.request({ jsonrpc: '2.0', id: 11, method: 'session/prompt', params: { sessionId: 's1', prompt: [] } });
    assert.deepEqual(relay.notification(warnMsg), { hold: true });
    assert.deepEqual(
      relay.notification({
        jsonrpc: '2.0',
        method: 'session/update',
        params: { sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Normal reply.' } } },
      }),
      { hold: false, flush: [warnMsg] },
    );
    const okResult = { jsonrpc: '2.0', id: 11, result: { stopReason: 'end_turn' } };
    assert.equal(relay.response(okResult), okResult);

    relay.request({ jsonrpc: '2.0', id: 12, method: 'session/prompt', params: { sessionId: 's1', prompt: [] } });
    assert.deepEqual(relay.notification(warnMsg), { hold: true });
    const cancelled = { jsonrpc: '2.0', id: 12, result: { stopReason: 'cancelled' } };
    const flushed = [];
    assert.equal(relay.response(cancelled, message => flushed.push(message)), cancelled);
    assert.deepEqual(flushed, [warnMsg]);

    // Interleaved prompts share a sessionId on update frames. A pending quotation cannot
    // turn either request into a quota failure when its origin is ambiguous.
    const start = id => relay.request({ id, method: 'session/prompt', params: { sessionId: 's1' } });
    start(13);
    assert.deepEqual(relay.notification(warnMsg), { hold: true });
    start(14);
    const original = { id: 13, result: { stopReason: 'end_turn' } };
    assert.equal(relay.response(original, message => flushed.push(message)), original);
    assert.deepEqual(flushed, [warnMsg, warnMsg]);
    assert.equal(relay.notification(warnMsg), null);
    const overlapping = { id: 14, result: { stopReason: 'end_turn' } };
    assert.equal(relay.response(overlapping), overlapping);
  });

  test('local and remote bridges preserve quoted warnings and classify native quota failures', async (t) => {
    const fakeAgy = `'use strict';
const readline = require('node:readline');
if (process.argv.includes('--version')) { console.log('1.5.18'); process.exit(0); }
const rl = readline.createInterface({ input: process.stdin });
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\\n');
rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1, agentInfo: { name: 'Antigravity ACP Server', version: '1.5.18' }, agentCapabilities: {} } });
  } else if (msg.method === 'session/new') {
    send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'sess-1' } });
  } else if (msg.method === 'session/prompt') {
    const scenario = msg.params.prompt[0].text;
    if (scenario === 'quote' || scenario === 'explicit') {
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'sess-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'The CLI displayed this message:' } } } });
    }
    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'sess-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '\\n⚠ ${QUOTA_MSG}\\n' } } } });
    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'sess-1', update: { sessionUpdate: 'usage_update', used: 200, size: 100000 } } });
    if (scenario === 'explicit') {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: 'Quota exhausted', data: { reason: 'QUOTA_EXHAUSTED' } } });
    } else {
      send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: scenario === 'cancel' ? 'cancelled' : 'end_turn' } });
    }
  }
});
`;
    for (const args of [[], ['--cindy-remote-workspace']]) {
      const env = makeFakeAgyEnv(t, fakeAgy);
      const bridge = startRelay(env, args);
      t.after(() => bridge.child.kill());

      bridge.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } });
      await waitFor(() => bridge.lines.find((m) => m.id === 1), 5_000, 'initialize');
      bridge.send({
        jsonrpc: '2.0',
        id: 2,
        method: 'session/new',
        params: {
          cwd: os.tmpdir(),
          mcpServers: args.length ? [{ name: 'cindy_exec', type: 'http', url: 'http://127.0.0.1:9/mcp' }] : [],
        },
      });
      await waitFor(() => bridge.lines.find((m) => m.id === 2), 5_000, 'session/new');
      const quotaWarning = `\n⚠ ${QUOTA_MSG}\n`;
      let id = 2;
      async function prompt(text) {
        const offset = bridge.lines.length;
        const requestId = ++id;
        bridge.send({ jsonrpc: '2.0', id: requestId, method: 'session/prompt', params: {
          sessionId: 'sess-1', prompt: [{ type: 'text', text }],
        } });
        const response = await waitFor(() => bridge.lines.find(m => m.id === requestId), 5_000, 'prompt response');
        const slice = bridge.lines.slice(offset, bridge.lines.indexOf(response) + 1);
        return { response, text: slice.filter(m => m.params?.update?.sessionUpdate === 'agent_message_chunk')
          .map(m => m.params.update.content.text) };
      }

      // #411: the final chunk of an ordinary answer may reproduce the exact CLI warning.
      const quoted = await prompt('quote');
      assert.deepEqual(quoted.text, ['The CLI displayed this message:', quotaWarning]);
      assert.deepEqual(quoted.response.result, { stopReason: 'end_turn' });

      const quota = await prompt('quota');
      assert.deepEqual(quota.text, []);
      assert.equal(quota.response.error?.message, QUOTA_MSG);
      assert.equal(quota.response.error?.data?._meta?.cindy?.kind, 'usage-limit');
      assert.equal(typeof quota.response.error?.data?._meta?.cindy?.resetsAt, 'number');

      const failed = await prompt('explicit');
      assert.equal(failed.response.error?.data?._meta?.cindy?.kind, 'usage-limit');
      assert.deepEqual(failed.text, quoted.text);

      const cancelled = await prompt('cancel');
      assert.deepEqual(cancelled.text, [quotaWarning]);
      assert.deepEqual(cancelled.response.result, { stopReason: 'cancelled' });

      bridge.child.stdin.end();
      await bridge.closed;
    }
  });
});
