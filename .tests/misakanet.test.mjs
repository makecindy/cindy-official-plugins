// Behaviour tests for the Cindy plugin package (`.cindy-plugin/main.js`).
//
// This file is not a worker; it lives in `workers/` because that is the glob CI runs
// (`node --test 'workers/**/*.test.mjs'` in pr-checks.yml) — the package is a shipped artifact,
// like the hook that lives next door for the same reason.
//
// `tests/test_cindy_plugin_package.py` asks whether the package is *well formed* (manifest shape,
// every named file exists, the docs name the version the manifest has, the entry point parses).
// Nothing asked what the code does with the endpoint's answers — and the answers are where this
// plugin earns its keep: the endpoint decides whether a zero-hit query is a question or a
// knowledge gap, and the plugin's job is to hand that decision on instead of inventing one.
//
// The endpoint is stubbed, so these tests are about the shaping layer, not about the corpus.
// Run: node --test workers/misakanet-cindy-plugin.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE = join(root, 'misakanet');
const MAIN = join(PACKAGE, 'main.js');
const MANIFEST = JSON.parse(readFileSync(join(PACKAGE, 'ghost.json'), 'utf8'));

/**
 * Load the package's entry point against a stubbed host.
 *
 * The package is a browser-sandbox script: it exports nothing and it registers a message
 * handler when it runs. The harness evaluates the file the way the host does — once, in a
 * sandbox, with the host stub already in place.
 */
let loads = 0;

async function loadPlugin({ respond, fetchResult } = {}) {
  const sent = [];
  const requests = [];
  const dataDir = new Map();
  const stub = {
    handler: null,
    onHostMessage(cb) { stub.handler = cb; },
    async send(payload) {
      // The private data directory is the only host capability the plugin claims beyond the
      // network, and it is where the per-machine client id lives.
      if (payload.type === 'fs-request') {
        if (payload.op === 'write') {
          dataDir.set(payload.path, payload.content);
          return { ok: true, op: 'write', path: payload.path };
        }
        if (payload.op === 'read') {
          if (!dataDir.has(payload.path)) return { ok: false, errorCode: 'NOT_FOUND' };
          return { ok: true, op: 'read', path: payload.path, content: dataDir.get(payload.path) };
        }
      }
      sent.push(payload);
      return { ok: true };
    },
    async fetch(req) {
      requests.push(req);
      if (fetchResult) return fetchResult(req);
      const payload = respond ? respond(req) : { results: [] };
      return {
        ok: true,
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            content: [{ type: 'text', text: JSON.stringify(payload) }],
            structuredContent: payload,
          },
        }),
      };
    },
  };
  loads += 1;
  // The repository runs plugin sources in a sandbox, not as modules: `vm.runInNewContext`
  // evaluates the file the way the host does, with the host stub already in place.
  const context = vm.createContext({
    cindy: stub,
    crypto: globalThis.crypto ?? webcrypto,
    console,
    JSON,
    Math,
    Date,
    Promise,
    Buffer,
    setTimeout,
    clearTimeout,
  });
  vm.runInNewContext(readFileSync(MAIN, 'utf8'), context, { filename: MAIN });
  return { stub, sent, requests, dataDir };
}

/** Hand the plugin a tool-call and wait for its answer. */
async function callTool(load, tool, args) {
  load.sent.length = 0;
  await load.stub.handler({ type: 'tool-call', tool, args, callId: 'test-call' });
  for (let i = 0; i < 100 && load.sent.length === 0; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(load.sent.length, 1, 'the plugin must answer exactly one tool-result');
  return load.sent[0];
}

function forwarded(load, index = 0) {
  return JSON.parse(load.requests[index].body).params.arguments;
}

test('search: only the hosted endpoint\'s own parameters reach the wire', async () => {
  const load = await loadPlugin({ respond: () => ({ results: [], source: 'worker-bm25' }) });
  await callTool(load, 'misakanet_search', {
    query: 'pip install timeout',
    top: 3,
    // `explain` and `include_stale` exist in the **local stdio** schema only. Forwarding them
    // would be promising a parameter the hosted endpoint does not have.
    explain: true,
    include_stale: true,
  });
  assert.deepEqual(forwarded(load), { query: 'pip install timeout', top: 3 });
});

test('search: asks for JSON, never the event stream', async () => {
  // The hosted endpoint also speaks SSE, and that stream never ends — a client waiting for it
  // waits for a body that does not arrive. This is the one header that decides whether the
  // plugin works at all.
  const load = await loadPlugin({ respond: () => ({ results: [] }) });
  await callTool(load, 'misakanet_search', { query: 'anything' });
  assert.equal(load.requests[0].headers.Accept, 'application/json');
  assert.equal(load.requests[0].method, 'POST');
  assert.equal(load.requests[0].url, 'https://misakanet.org/mcp');
});

test('search: the client id is per machine, stable, and says who is asking', async () => {
  const load = await loadPlugin({ respond: () => ({ results: [] }) });
  await callTool(load, 'misakanet_search', { query: 'first' });
  await callTool(load, 'misakanet_search', { query: 'second' });

  const first = load.requests[0].headers['X-MisakaNet-Client'];
  const second = load.requests[1].headers['X-MisakaNet-Client'];
  assert.ok(first, 'the client header must be present');
  assert.equal(first, second, 'the same machine must present the same id, or E4 reuse counts lie');
  assert.match(first, /^[A-Za-z0-9._-]{8,64}$/, `the id shape the endpoint accepts: ${first}`);
  assert.ok(load.dataDir.size > 0, 'the id must be persisted, not regenerated per call');
  assert.equal(load.requests[0].headers['X-MisakaNet-Agent'], 'cindy');
  assert.ok(load.requests[0].headers['X-MisakaNet-Os'], 'the platform belongs in the headers');
});

test('the version header cannot drift away from the manifest', async () => {
  // `PLUGIN_VERSION` is a literal in main.js and `version` is a literal in ghost.json. Bump one
  // and forget the other and the endpoint records the wrong client version forever.
  const load = await loadPlugin({ respond: () => ({ results: [] }) });
  await callTool(load, 'misakanet_search', { query: 'anything' });
  assert.equal(load.requests[0].headers['X-MisakaNet-Version'], MANIFEST.version);
});

test('search: hands on the endpoint\'s plain-language summary', async () => {
  // The official rules block tells the agent to repeat `summary_plain` verbatim instead of
  // inventing a sentence of its own. Dropping the field makes the model paraphrase by guess.
  const load = await loadPlugin({
    respond: () => ({
      results: [{
        id: 'pip-install-proxy-timeout',
        title: 'pip install timeout behind a proxy',
        problem: 'ReadTimeoutError behind a corporate proxy.',
        summary_plain: 'pip install fails behind a proxy; check the CA bundle.',
        freshness: 'established',
        evidence_level: 'E2',
        score: 14.9,
      }],
      source: 'worker-bm25',
    }),
  });
  const answer = await callTool(load, 'misakanet_search', { query: 'pip install timeout' });
  assert.equal(answer.ok, true);
  assert.equal(answer.result.count, 1);
  assert.equal(answer.result.results[0].summary_plain,
    'pip install fails behind a proxy; check the CA bundle.');
  assert.equal(answer.result.results[0].id, 'pip-install-proxy-timeout');
});

test('a zero hit hands on the endpoint\'s own routing', async () => {
  // The endpoint decides whether a miss is a question or a knowledge gap, and returns the next
  // intake call with it. Rewriting that decision locally would be the plugin guessing.
  const load = await loadPlugin({
    respond: () => ({
      results: [],
      no_match: true,
      voice: 'failure-warning',
      source: 'worker-bm25',
      suggestion: 'No MisakaNet lesson matched "how do I configure MCP auth".',
      intake: {
        tool: 'misakanet_submit_intake',
        args: { kind: 'question', problem: '<your question>', source: 'mcp' },
      },
    }),
  });
  const answer = await callTool(load, 'misakanet_search', { query: 'how do I configure MCP auth' });
  assert.equal(answer.result.no_match, true);
  assert.match(answer.result.suggestion, /No MisakaNet lesson matched/);
  assert.equal(answer.result.intake.tool, 'misakanet_submit_intake');
  assert.equal(answer.result.intake.args.kind, 'question');
  // The endpoint says "mcp" because it does not know who is asking; this plugin does.
  assert.equal(answer.result.intake.args.source, 'cindy');
  assert.match(answer.result.note, /没有命中任何教训/);
});

test('submit_intake: refuses without the user\'s confirmation, and sends nothing', async () => {
  const load = await loadPlugin({ respond: () => ({ submitted: true }) });
  const answer = await callTool(load, 'misakanet_submit_intake', { problem: 'a failure' });
  assert.equal(answer.ok, false);
  assert.equal(answer.errorCode, 'CONFIRM_REQUIRED');
  assert.equal(load.requests.length, 0, 'nothing may reach the endpoint before the user says so');
});

test('submit_intake: lets the endpoint decide the kind when none is given', async () => {
  // The hosted endpoint routes question-shaped content to `question` and failure-shaped content
  // to `missing_lesson`. Sending a default would override that routing.
  const load = await loadPlugin({ respond: () => ({ submitted: true, intake_id: 'issue-1' }) });
  await callTool(load, 'misakanet_submit_intake', { problem: 'a question', user_confirmed: true });
  assert.equal(forwarded(load).kind, undefined);

  const explicit = await loadPlugin({ respond: () => ({ submitted: true, intake_id: 'issue-2' }) });
  await callTool(explicit, 'misakanet_submit_intake', {
    problem: 'a failure',
    kind: 'missing_lesson',
    user_confirmed: true,
  });
  assert.equal(forwarded(explicit).kind, 'missing_lesson');
});

test('submit_intake: hands on an answered question', async () => {
  const load = await loadPlugin({
    respond: () => ({ answered: true, answer: 'Use the Authorization header.', dedup_key: 'abc12345' }),
  });
  const answer = await callTool(load, 'misakanet_submit_intake', {
    problem: 'how do I configure MCP auth',
    kind: 'question',
    user_confirmed: true,
  });
  assert.equal(answer.ok, true);
  assert.equal(answer.result.answered, true);
  assert.equal(answer.result.answer, 'Use the Authorization header.');
  assert.equal(answer.result.dedup_key, 'abc12345');
});

test('submit_intake: hands on a converted lesson and a duplicate', async () => {
  const converted = await loadPlugin({
    respond: () => ({ converted: true, receipt: 'lesson lessons/core/x.md', events: [{ type: 'lesson_created' }] }),
  });
  const one = await callTool(converted, 'misakanet_submit_intake', {
    problem: 'a failure',
    kind: 'missing_lesson',
    user_confirmed: true,
  });
  assert.equal(one.result.converted, true);
  assert.match(one.result.receipt, /lessons\/core/);
  assert.equal(one.result.events.length, 1);

  const duplicate = await loadPlugin({
    respond: () => ({ submitted: false, duplicate: true, previous_issue: 'issue-4242', dedup_key: 'abc12345' }),
  });
  const two = await callTool(duplicate, 'misakanet_submit_intake', {
    problem: 'a failure',
    kind: 'missing_lesson',
    user_confirmed: true,
  });
  assert.equal(two.result.duplicate, true);
  assert.equal(two.result.previous_issue, 'issue-4242');
});

test('get_lesson: the full text comes back as markdown', async () => {
  const load = await loadPlugin({
    respond: () => ({ path: 'lessons/core/auto-merge-ci-pipeline.md', content: '## Root Cause\n\nManual merge.' }),
  });
  const answer = await callTool(load, 'misakanet_get_lesson', { id: 'auto-merge-ci-pipeline' });
  assert.equal(answer.ok, true);
  assert.match(answer.result.content, /## Root Cause/);
  assert.equal(answer.result.path, 'lessons/core/auto-merge-ci-pipeline.md');
});

test('preflight: the risk level and the guards come back', async () => {
  const load = await loadPlugin({
    respond: () => ({
      risk_level: 'medium',
      intent: 'rebuild the RAG index',
      matched_lessons: [{ id: 'x', title: 'x', domain: 'rag', relevance: 3 }],
      guards: ['Check the lock file before proceeding.'],
    }),
  });
  const answer = await callTool(load, 'misakanet_preflight', { intent: 'rebuild the RAG index' });
  assert.equal(answer.result.risk_level, 'medium');
  assert.equal(answer.result.guards.length, 1);
  assert.equal(answer.result.matched_lessons[0].id, 'x');
});

test('the package declares exactly five tools, and answers nothing else', async () => {
  // The host only dispatches a tool the manifest declares, so the plugin's handler ignores
  // anything else **on purpose**: answering a tool it does not own would be answering on
  // behalf of somebody else's manifest. The declaration is what the host reads.
  const load = await loadPlugin();
  load.sent.length = 0;
  await load.stub.handler({
    type: 'tool-call',
    tool: 'misakanet_write_lesson',
    args: { title: 'x' },
    callId: 'test-call',
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(load.sent.length, 0, 'a tool this package does not declare gets no answer');
  assert.deepEqual(MANIFEST.tools.map((tool) => tool.name).sort(), [
    'misakanet_get_lesson',
    'misakanet_me_inbox',
    'misakanet_preflight',
    'misakanet_search',
    'misakanet_submit_intake',
  ]);
});

test('me_inbox: looks one submitted report up and hands the answer back', async () => {
  const load = await loadPlugin({
    respond: () => ({
      intake_id: 'issue-4238',
      status: 'answered',
      answer: 'Use the Authorization header.',
      dedup_key: 'a28a0593',
    }),
  });
  const answer = await callTool(load, 'misakanet_me_inbox', { intake_id: 'issue-4238' });
  assert.equal(answer.ok, true);
  assert.equal(answer.result.answered, true);
  assert.equal(answer.result.answer, 'Use the Authorization header.');
  assert.equal(answer.result.dedup_key, 'a28a0593');
  // The lookup is a query: exactly the reference it was given, nothing else.
  assert.deepEqual(JSON.parse(load.requests[0].body).params.arguments, { intake_id: 'issue-4238' });
});

test('me_inbox: without a reference it asks for one and sends nothing', async () => {
  const load = await loadPlugin();
  const answer = await callTool(load, 'misakanet_me_inbox', {});
  assert.equal(answer.ok, false);
  assert.equal(answer.errorCode, 'MISSING_INTAKE_REF');
  assert.equal(load.requests.length, 0, 'a lookup without a reference must not reach the endpoint');
});

test('me_inbox: a dedup_key is a reference too', async () => {
  const load = await loadPlugin({ respond: () => ({ intake_id: 'issue-4238', status: 'pending' }) });
  const answer = await callTool(load, 'misakanet_me_inbox', { dedup_key: 'a28a0593' });
  assert.equal(answer.ok, true);
  assert.equal(answer.result.status, 'pending');
  assert.deepEqual(JSON.parse(load.requests[0].body).params.arguments, { dedup_key: 'a28a0593' });
});

test('the manifest declares the turn subscription, the resident launch and the notice capability', async () => {
  // The three fields are the plugin's whole reason for being resident: without them the turn
  // counter never runs, and a manifest that only promises tools would be a lie about the
  // behaviour (the same reason the marketplace brief had to be corrected once).
  assert.deepEqual(MANIFEST.subscribe, { topics: ['turn'] });
  assert.equal(MANIFEST.launch, 'resident');
  assert.equal(MANIFEST.notify, true);
});

test('the first turn announces once, then the reminder comes every 10 turns from the 20th', async () => {
  const load = await loadPlugin();
  const notices = () => load.sent.filter((m) => m.type === 'notify');
  const endTurn = async (sessionId) => {
    await load.stub.handler({ type: 'event', name: 'did-turn-end', data: { sessionId } });
    await new Promise((resolve) => setTimeout(resolve, 5));
  };

  await endTurn('s1');
  assert.equal(notices().length, 1, 'the first turn announces that the library is connected');

  for (let i = 2; i <= 19; i += 1) await endTurn('s1');
  assert.equal(notices().length, 1, 'nothing is said before the 20th turn');

  await endTurn('s1');
  assert.equal(notices().length, 2, 'the 20th turn reminds about writing lessons up');

  for (let i = 21; i <= 29; i += 1) await endTurn('s1');
  assert.equal(notices().length, 2, 'the reminder is every 10 turns, not every turn');

  await endTurn('s1');
  assert.equal(notices().length, 3, 'the 30th turn reminds again');
});

test('a dropped event batch resets the counter and does not announce twice', async () => {
  // The host drops events while the plugin is asleep; the derived count is then wrong, and the
  // reference says: reset the state and believe the events that follow.
  const load = await loadPlugin();
  const notices = () => load.sent.filter((m) => m.type === 'notify');
  await load.stub.handler({ type: 'event', name: 'did-turn-end', data: { sessionId: 's2' } });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(notices().length, 1);

  await load.stub.handler({
    type: 'event',
    name: 'did-turn-end',
    data: { sessionId: 's2' },
    dropped: 4,
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(notices().length, 1, 'the announcement is not repeated after a drop');

  const state = JSON.parse(load.dataDir.get('checkpoint.json'));
  assert.equal(state.sessions.s2.turns, 1, 'the count restarts from the event that did arrive');
});

test('me_inbox: an unknown status says "cannot be determined", not "still waiting"', async () => {
  // The endpoint finds details for questions, lessons and the dedup store. A proposal is in
  // none of them, so it answers "cannot be determined" — and the plugin used to dress that up
  // as "still waiting", which is a different claim about the machine.
  const load = await loadPlugin({
    respond: () => ({
      intake_id: 'issue-4424',
      status: 'unknown',
      note: 'Nothing found in the D1 question table, the lesson corpus, or the dedup store.',
    }),
  });
  const answer = await callTool(load, 'misakanet_me_inbox', { intake_id: 'issue-4424' });
  assert.equal(answer.ok, true);
  assert.equal(answer.result.status, 'unknown');
  assert.match(answer.result.note, /查不到/);
  assert.doesNotMatch(answer.result.note, /状态：unknown。还在等人处理/,
    'the old wording claimed a status it could not know');
  assert.match(answer.result.note, /≠ 没发生/);
  assert.match(answer.result.note, /提问表/, 'the note says where the endpoint looked');
});

/* ── 不可逆外发的三态（官方插件仓审查条款）──────────────────────────────────── */

test('submit_intake: a timeout is "uncertain" — it must not tell the agent to resend', async () => {
  // The report creates a public issue in a third-party repository; it cannot be taken back.
  // A timeout leaves one question open: did the request arrive? If the plugin answers that
  // with "retry", the retry can become a second public issue.
  const load = await loadPlugin({
    fetchResult: () => ({ ok: false, message: 'request timed out after 45000ms' }),
  });
  const answer = await callTool(load, 'misakanet_submit_intake', {
    problem: 'pip install times out behind a corporate proxy',
    user_confirmed: true,
  });
  assert.equal(answer.ok, false);
  assert.equal(answer.delivery, 'uncertain');
  assert.match(answer.message, /不要重发/);
  assert.doesNotMatch(answer.message, /可以重试/);
});

test('submit_intake: a 5xx is "uncertain" for the same reason', async () => {
  const load = await loadPlugin({
    fetchResult: () => ({ ok: true, status: 502, headers: {}, body: 'bad gateway' }),
  });
  const answer = await callTool(load, 'misakanet_submit_intake', {
    problem: 'CI fails while resolving a private registry',
    user_confirmed: true,
  });
  assert.equal(answer.ok, false);
  assert.equal(answer.delivery, 'uncertain');
  assert.match(answer.message, /不要重发/);
});

test('submit_intake: a rejected request is "not sent" — retrying it is safe', async () => {
  const load = await loadPlugin({
    fetchResult: () => ({ ok: true, status: 400, headers: {}, body: '{"error":"problem is required"}' }),
  });
  const answer = await callTool(load, 'misakanet_submit_intake', {
    problem: 'a report the endpoint rejects',
    user_confirmed: true,
  });
  assert.equal(answer.ok, false);
  assert.equal(answer.delivery, 'not_sent');
  assert.match(answer.message, /可以重试/);
});

test('submit_intake: a failure it cannot place stays "uncertain", never "safe to retry"', async () => {
  // The conservative rule: without proof that the request never left, the plugin must not call it
  // retryable — a duplicate public issue is worse than a cautious message.
  const load = await loadPlugin({
    fetchResult: () => ({ ok: false, message: 'getaddrinfo ENOTFOUND misakanet.org' }),
  });
  const answer = await callTool(load, 'misakanet_submit_intake', {
    problem: 'a report that never left the machine',
    user_confirmed: true,
  });
  assert.equal(answer.ok, false);
  assert.equal(answer.delivery, 'uncertain');
  assert.match(answer.message, /不要重发/);
});

test('search: a network failure keeps the plain retry advice', async () => {
  // Reads are harmless to repeat, so the three-state rule does not apply: the plugin must not
  // make the agent treat a failed lookup as "possibly already done".
  const load = await loadPlugin({
    fetchResult: () => ({ ok: false, message: 'request timed out after 45000ms' }),
  });
  const answer = await callTool(load, 'misakanet_search', { query: 'anything' });
  assert.equal(answer.ok, false);
  assert.equal(answer.delivery, undefined);
  assert.match(answer.message, /稍后重试/);
});

/* ── 自动 review 的其余几处修复 ────────────────────────────────────────────── */

test('the outward client id comes from a CSPRNG, never a weak fallback', async () => {
  // The id travels to the endpoint as X-MisakaNet-Client and the endpoint counts distinct
  // clients with it, so a predictable value would make that count meaningless.
  const source = readFileSync(MAIN, 'utf8');
  assert.doesNotMatch(source, /Math\.random\s*\(/, 'no weak randomness for an outward id');
  const load = await loadPlugin({ respond: () => ({ results: [] }) });
  await callTool(load, 'misakanet_search', { query: 'anything' });
  const id = load.requests[0].headers['X-MisakaNet-Client'];
  assert.match(id, /^cindy-[a-z0-9]{16}$/, `CSPRNG id shape: ${id}`);
});

test('submit_intake: an unknown network failure is "uncertain", not "not sent"', async () => {
  // Only a failure that proves the request never left may be called "not sent".
  const load = await loadPlugin({
    fetchResult: () => ({ ok: false, message: 'proxy closed the connection unexpectedly' }),
  });
  const answer = await callTool(load, 'misakanet_submit_intake', {
    problem: 'a report whose fate is unknown',
    user_confirmed: true,
  });
  assert.equal(answer.ok, false);
  assert.equal(answer.delivery, 'uncertain');
  assert.match(answer.message, /不要重发/);
});

test('submit_intake: a fetch that throws is "uncertain"', async () => {
  const load = await loadPlugin({
    fetchResult: () => { throw new Error('socket hang up'); },
  });
  const answer = await callTool(load, 'misakanet_submit_intake', {
    problem: 'a report whose fetch threw',
    user_confirmed: true,
  });
  assert.equal(answer.ok, false);
  assert.equal(answer.delivery, 'uncertain');
  assert.match(answer.message, /不要重发/);
});

test('search: detail=full keeps the whole record the endpoint returned', async () => {
  const load = await loadPlugin({
    respond: () => ({
      detail: 'full',
      results: [
        {
          id: 'lesson-x',
          title: 'Lesson X',
          problem: 'the problem',
          content: '# the whole markdown body',
          fix: 'the fix',
          verification: 'the verification',
          path: 'lessons/core/lesson-x.md',
          score: 3.2,
        },
      ],
    }),
  });
  const answer = await callTool(load, 'misakanet_search', { query: 'anything', detail: 'full' });
  assert.equal(answer.ok, true);
  const first = answer.result.results[0];
  assert.equal(first.content, '# the whole markdown body', 'full detail must not be trimmed to a summary');
  assert.equal(first.fix, 'the fix');
  assert.equal(first.verification, 'the verification');
});

test('the turn counter advances in memory when the private write fails', async () => {
  // If the file were the only source of truth, a failing write would re-announce the first-turn
  // notice on every turn.
  const load = await loadPlugin({ respond: () => ({ results: [] }) });
  const originalSend = load.stub.send.bind(load.stub);
  load.stub.send = async (payload) => {
    if (payload.type === 'fs-request') return { ok: false };
    return originalSend(payload);
  };
  await load.stub.handler({ type: 'event', name: 'did-turn-end', data: { sessionId: 's1' } });
  // The turn handler is fire-and-forget: the host does not await it, so the test waits for it.
  for (let i = 0; i < 100 && load.sent.filter((m) => m.type === 'notify').length === 0; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await load.stub.handler({ type: 'event', name: 'did-turn-end', data: { sessionId: 's1' } });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const notices = load.sent.filter((m) => m.type === 'notify');
  assert.equal(notices.length, 1, 'the first-turn notice must not repeat when the write fails');
});
