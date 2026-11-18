'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const nodemailer = require('nodemailer');
const { simpleParser } = require('mailparser');
const { createHash } = require('node:crypto');
const { performAction, createRuntimeDeps } = require('../src/worker.cjs');
const credentials = { email: 'test@example.com', authorizationCode: 'test-only-not-a-secret' };
const base = { action: 'send', to: 'test@example.com', subject: '附件测试', body_text: '测试正文' };
const hash = b => createHash('sha256').update(b).digest('hex');
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qq-mail-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
function smtpCapture() {
  let source, calls = 0;
  const composer = nodemailer.createTransport({ streamTransport: true, buffer: true });
  return {
    get source() { return source; }, get calls() { return calls; },
    deps: { createSmtp: () => ({ sendMail: async options => {
      calls++; source = (await composer.sendMail(options)).message;
      return { messageId: 'test', accepted: ['test@example.com'], rejected: [] };
    }, close() {} }) },
  };
}
test('send round-trips Unicode names, empty files and >256 KiB binary through real MIME', async t => {
  const dir = await fixture(t);
  const files = [['中文附件.txt', Buffer.from('中文内容\n')], ['binary.bin', Buffer.alloc(300*1024, 0xa5)], ['empty.txt', Buffer.alloc(0)]];
  for (const [name, bytes] of files) await fs.writeFile(path.join(dir, name), bytes);
  const capture = smtpCapture();
  const result = await performAction(credentials, { ...base, attachment_paths: files.map(([name]) => path.join(dir, name)) }, capture.deps);
  const parsed = await simpleParser(capture.source);
  assert.equal(parsed.attachments.length, files.length);
  parsed.attachments.forEach((a, i) => { assert.equal(a.filename, files[i][0]); assert.deepEqual(a.content, files[i][1]); });
  assert.deepEqual(result.attachments.map(a => a.sha256), files.map(([,b])=>hash(b)));
  assert.ok(!JSON.stringify(result).includes(dir));
});
test('plain mail stays plain without attachments', async () => {
  const capture = smtpCapture();
  await performAction(credentials, base, capture.deps);
  assert.equal((await simpleParser(capture.source)).attachments.length, 0);
});
test('invalid, missing, directory and oversized attachments fail before SMTP sending', async t => {
  const dir = await fixture(t);
  const large = path.join(dir, 'large.bin');
  await fs.writeFile(large, Buffer.alloc(32*1024*1024+1));
  for (const paths of [['relative.txt'], ['https://example.com/file'], [path.join(dir,'missing')], [dir], [large], Array(11).fill(large), 'not-an-array']) {
    const capture = smtpCapture();
    await assert.rejects(performAction(credentials, { ...base, attachment_paths: paths }, capture.deps));
    assert.equal(capture.calls,0);
  }
});
test('total size limit is enforced across multiple files', async t => {
  const dir = await fixture(t);
  const file = path.join(dir,'seventeen.bin'); await fs.writeFile(file,Buffer.alloc(17*1024*1024));
  const capture=smtpCapture();
  await assert.rejects(performAction(credentials,{...base,attachment_paths:[file,file]},capture.deps));
  assert.equal(capture.calls,0);
});
test('draft uses the same MIME attachment path', async t => {
  const dir = await fixture(t), file = path.join(dir,'draft.txt'); await fs.writeFile(file,'draft');
  let appended;
  const client = { connect:async()=>{}, logout:async()=>{}, list:async()=>[{path:'Drafts',specialUse:'\\Drafts'}], append:async(folder,bytes)=>{appended=bytes;return {uid:7};} };
  const result = await performAction(credentials,{...base,action:'draft',attachment_paths:[file]}, { ...createRuntimeDeps(),createImap:()=>client });
  assert.equal(result.draft,true);
  assert.equal((await simpleParser(appended)).attachments[0].content.toString(),'draft');
});
test('main passes draft attachment paths to the shared compose worker without attachment bytes', async () => {
  let handler, request, response;
  const context = { cindyMail: { version: 1, sendGraceMs: 10000, register: () => ({ present: async () => true, beforeTool: async () => null, resolveDraft: async () => null }) }, Map, setTimeout, fetch: async url=>({ok:true,json:async()=>url==='/kv'?{email:'test@example.com'}:[{key:'qq_mail_authorization_code',saved:true}]}), cindy: {
    onHostMessage: fn=>{handler=fn;},node:{request:async r=>{request=r;return {ok:true,result:{ok:true,execution:'executed',data:{draft:true,draftId:'<d@example.com>',readBack:{status:'unavailable',message:'x'}}}};}},send: async r=>{response=r;},
  }};
  vm.runInNewContext(await fs.readFile(path.join(__dirname,'../main.js'),'utf8'),context);
  handler({type:'tool-call',tool:'qq_mail',callId:'current-call',args:{...base,action:'draft',attachment_paths:['/tmp/test.txt'],session_context:{workdir_is_read_only:false}}});
  for(let i=0;i<20&&!response;i++) await new Promise(r=>setImmediate(r));
  assert.equal(response.ok,true);
  assert.equal(request.method,'mail/action');
  assert.equal(request.params.action.action,'compose_create');
  assert.deepEqual(Array.from(request.params.action.attachment_paths),['/tmp/test.txt']);
  assert.ok(!JSON.stringify(request).includes('content'));
});
test('main refuses direct send before contacting the worker', async () => {
  let handler, response, calls = 0;
  const context = { Map, setTimeout, fetch: async url=>({ok:true,json:async()=>url==='/kv'?{email:'test@example.com'}:[{key:'qq_mail_authorization_code',saved:true}]}), cindy: {
    onHostMessage: fn=>{handler=fn;},node:{request:async()=>{calls++;return {ok:true,result:{sent:true}};}},send: async r=>{response=r;},
  }};
  vm.runInNewContext(await fs.readFile(path.join(__dirname,'../main.js'),'utf8'),context);
  handler({type:'tool-call',tool:'qq_mail',callId:'send-call',args:base});
  for(let i=0;i<20&&!response;i++) await new Promise(r=>setImmediate(r));
  assert.equal(response.ok,false);
  assert.match(response.message,/^\[not_executed\]/);
  assert.match(response.message,/send_draft/);
  assert.equal(calls,0);
});
test('connect verifies saved secret before persisting email, and keeps configuration on failure', async () => {
  for (const success of [true,false]) {
    let handler, response, request, written;
    const context={Map,setTimeout,navigator:{locks:{request:async(_name,fn)=>fn()}},fetch:async(url,options)=>{
      if(options?.method==='PUT'){written=JSON.parse(options.body);return {ok:true};}
      return {ok:true,json:async()=>({untouched:'keep'})};
    },cindy:{onHostMessage:fn=>{handler=fn;},node:{request:async r=>{request=r;return success?{ok:true,result:{connected:true,email:'test@example.com'}}:{ok:false,message:'connection failed'};}},send:async r=>{response=r;}}};
    vm.runInNewContext(await fs.readFile(path.join(__dirname,'../main.js'),'utf8'),context);
    handler({type:'tool-call',tool:'qq_mail_connect',callId:'connect-call',args:{email:'test@example.com'}});
    for(let i=0;i<20&&!response;i++)await new Promise(r=>setImmediate(r));
    assert.equal(response.ok,success);
    assert.equal(request?.method,'account/connect');
    assert.equal(request?.callId,'connect-call');
    assert.deepEqual(JSON.parse(JSON.stringify(request.params)),{email:'test@example.com'});
    assert.deepEqual(written,success?{untouched:'keep',email:'test@example.com'}:undefined);
  }
});
test('32 MiB boundary survives MIME encoding and plugin readback', async t => {
  const { Readable } = require('node:stream');
  const dir=await fixture(t), file=path.join(dir,'large-32MiB.bin');
  const bytes=Buffer.alloc(32*1024*1024,0xa7);
  await fs.writeFile(file,bytes);
  const capture=smtpCapture();
  const sent=await performAction(credentials,{...base,attachment_paths:[file]},capture.deps);
  assert.equal(sent.attachments[0].size,bytes.length);
  assert.ok(capture.source.length>12*1024*1024);
  assert.ok(capture.source.length<48*1024*1024);
  const client={connect:async()=>{},logout:async()=>{},getMailboxLock:async()=>({release(){}}),
    fetchOne:async()=>({uid:1,size:capture.source.length}),
    download:async()=>({meta:{expectedSize:capture.source.length},content:Readable.from([capture.source])})};
  const read=await performAction(credentials,{action:'read',folder:'INBOX',message_uid:1},
    {...createRuntimeDeps(),createImap:()=>client});
  assert.equal(read.attachments[0].sha256,hash(bytes));
  assert.equal(read.attachments[0].size,bytes.length);
});

test('worker distinguishes rejected attachment input from ambiguous SMTP failure', async () => {
  const { handleRequest } = require('../src/worker.cjs');
  const request = action => ({ method: 'mail/action', params: { email: credentials.email, action }, cindy: { secrets: { qq_mail_authorization_code: 'dummy-test-code' } } });
  await assert.rejects(handleRequest(request({ ...base, attachment_paths: ['relative.txt'] }), {}), error => error.executionState === 'not_executed');
  await assert.rejects(handleRequest(request(base), { createSmtp: () => ({ sendMail: async () => { throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }); }, close() {} }) }), error => {
    assert.equal(error.executionState, 'unknown');
    assert.match(error.message, /核对/);
    assert.doesNotMatch(error.message, /后重试|稍后重试/);
    return true;
  });
});

test('host timeouts on draft writes are unknown and never invite blind retries', async () => {
  let handler, response;
  const context = { cindyMail: { version: 1, sendGraceMs: 10000, register: () => ({ present: async () => true, beforeTool: async () => null, resolveDraft: async () => null }) }, Map, setTimeout, fetch: async url => ({ ok: true, json: async () => url === '/kv' ? { email: credentials.email } : [{ key: 'qq_mail_authorization_code', saved: true }] }), cindy: {
    onHostMessage: fn => { handler = fn; }, node: { request: async () => ({ ok: false, errorCode: 'TIMEOUT', message: '请求超时，请重试' }) }, send: async r => { response = r; },
  } };
  vm.runInNewContext(await fs.readFile(path.join(__dirname, '../main.js'), 'utf8'), context);
  handler({ type: 'tool-call', tool: 'qq_mail', callId: 'timeout-call', args: { ...base, action: 'draft', session_context: { workdir_is_read_only: false } } });
  for (let i = 0; i < 20 && !response; i++) await new Promise(r => setImmediate(r));
  assert.equal(response.ok, false);
  assert.match(response.message, /^\[unknown\]/);
  assert.doesNotMatch(response.message, /请重试/);
});

const requestFor = action => ({ method: 'mail/action', params: { email: credentials.email, action }, cindy: { secrets: { qq_mail_authorization_code: 'dummy-test-code' } } });
test('all mail preparation failures are not_executed with actionable reasons', async t => {
  const { handleRequest } = require('../src/worker.cjs');
  const dir = await fixture(t), file = path.join(dir, 'ordinary.txt');
  await fs.writeFile(file, 'ordinary');
  for (const action of ['send', 'draft']) {
    for (const [extra, reason] of [
      [{ subject: 'x'.repeat(999) }, /主题|内容/],
      [{ body_text: 'x'.repeat(500001) }, /正文|内容/],
      [{ attachment_paths: [path.join(file, 'child.txt')] }, /附件|路径/],
    ]) {
      await assert.rejects(handleRequest(requestFor({ ...base, action, ...extra }), {
        createSmtp() { assert.fail('must not create SMTP'); },
        createComposer() { assert.fail('must not compose invalid input'); },
      }), error => {
        assert.equal(error.executionState, 'not_executed');
        assert.match(error.message, reason);
        assert.doesNotMatch(error.message, /结果不确定/);
        return true;
      });
    }
  }
});
test('draft composition and connection failures precede remote append', async () => {
  const { handleRequest } = require('../src/worker.cjs');
  for (const deps of [
    { createComposer: () => ({ sendMail: async () => { throw new Error('compose failed'); }, close() {} }) },
    { createComposer: () => ({ sendMail: async () => ({ message: Buffer.from('draft') }), close() {} }),
      createImap: () => ({ connect: async () => { throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }); }, close() {}, append() { assert.fail('must not append'); } }) },
  ]) await assert.rejects(handleRequest(requestFor({ ...base, action: 'draft' }), deps), error => error.executionState === 'not_executed');
});
test('remote mutation failures stay unknown regardless of their error name', async () => {
  const { handleRequest } = require('../src/worker.cjs');
  const fail = async () => { throw new Error('MESSAGE_TOO_LARGE'); };
  for (const action of ['send', 'draft']) {
    const deps = { createSmtp: () => ({ sendMail: fail, close() {} }),
      createComposer: () => ({ sendMail: async () => ({ message: Buffer.from('draft') }), close() {} }),
      createImap: () => ({ connect: async () => {}, logout: async () => {}, list: async () => [{ path: 'Drafts', specialUse: '\\Drafts' }], append: fail }) };
    await assert.rejects(handleRequest(requestFor({ ...base, action }), deps), error => {
      assert.equal(error.executionState, 'unknown');
      assert.match(error.message, /核对/);
      return true;
    });
  }
});
test('successful send followed by cleanup failure reports executed', async () => {
  const { handleRequest } = require('../src/worker.cjs');
  await assert.rejects(handleRequest(requestFor(base), { createSmtp: () => ({
    sendMail: async () => ({ accepted: ['test@example.test'] }), close() { throw new Error('close failed'); },
  }) }), error => error.executionState === 'executed' && /已执行/.test(error.message));
});
test('ten tiny attachments use bounded scratch allocations', async t => {
  const dir = await fixture(t), file = path.join(dir, 'tiny.txt');
  await fs.writeFile(file, 'tiny');
  const original = Buffer.alloc;
  const allocations = [];
  t.mock.method(Buffer, 'alloc', function (size, ...args) { allocations.push(size); return original(size, ...args); });
  const result = await performAction(credentials, { ...base, attachment_paths: Array(10).fill(file) }, {
    createSmtp: () => ({ sendMail: async () => ({}), close() {} }),
  });
  assert.equal(result.attachments.length, 10);
  assert.ok(Math.max(...allocations) <= 64 * 1024, `largest allocation: ${Math.max(...allocations)}`);
});
test('files growing after stat are read completely or rejected at the total limit', async t => {
  const dir = await fixture(t), file = path.join(dir, 'growing.bin');
  const originalOpen = fs.open.bind(fs);
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await originalOpen(...args), originalStat = handle.stat.bind(handle);
    handle.stat = async () => Object.assign(await originalStat(), { size: 0 });
    return handle;
  });
  await fs.writeFile(file, Buffer.alloc(100000, 0xab));
  let received;
  const deps = { createSmtp: () => ({ sendMail: async options => { received = options.attachments[0].content; return {}; }, close() {} }) };
  await performAction(credentials, { ...base, attachment_paths: [file] }, deps);
  assert.equal(received.length, 100000);
  assert.equal(received[99999], 0xab);
  await fs.truncate(file, 32 * 1024 * 1024 + 1);
  await assert.rejects(performAction(credentials, { ...base, attachment_paths: [file] }, deps), /ATTACHMENTS_TOO_LARGE/);
});
test('draft cleanup runs after append and preserves its known result', async () => {
  const { handleRequest } = require('../src/worker.cjs');
  let appended = false;
  await assert.rejects(handleRequest(requestFor({ ...base, action: 'draft' }), {
    createComposer: () => ({ sendMail: async () => ({ message: Buffer.from('draft') }), close() { assert.equal(appended, true); throw new Error('cleanup failed'); } }),
    createImap: () => ({ connect: async () => {}, logout: async () => {}, list: async () => [{ path: 'Drafts', specialUse: '\\Drafts' }],
      append: async () => { await new Promise(resolve => setImmediate(resolve)); appended = true; return { uid: 1 }; } }),
  }), error => error.executionState === 'executed');
});
test('main preserves known executed failures instead of suggesting another mutation', async () => {
  let handler, response;
  const context = { Map, setTimeout, fetch: async url => ({ ok: true, json: async () => url === '/kv' ? { email: credentials.email } : [{ key: 'qq_mail_authorization_code', saved: true }] }), cindy: {
    onHostMessage: fn => { handler = fn; }, node: { request: async () => ({ ok: false, message: '操作已执行，请核对邮箱', data: { execution_state: 'executed' } }) }, send: async r => { response = r; },
  } };
  vm.runInNewContext(await fs.readFile(path.join(__dirname, '../main.js'), 'utf8'), context);
  handler({ type: 'tool-call', tool: 'qq_mail', callId: 'completed-call', args: { ...base, action: 'move', message_uid: 1, target_folder: 'Archive' } });
  for (let i = 0; i < 20 && !response; i++) await new Promise(r => setImmediate(r));
  assert.equal(response.ok, false);
  assert.equal(response.message, '操作已执行，请核对邮箱');
});
test('flag and move failures use the actual remote mutation stage', async () => {
  const { handleRequest } = require('../src/worker.cjs');
  for (const action of ['mark_read', 'mark_unread', 'move']) {
    for (const phase of ['before', 'during', 'after']) {
      const client = { connect: async () => {}, logout: async () => {}, getMailboxLock: async () => ({ release() {} }),
        fetchOne: async () => { if (phase === 'before') throw new Error('fetch failed'); return { uid: 1, flags: action === 'mark_unread' ? new Set(['\\Seen']) : new Set() }; },
        messageFlagsAdd: async () => { if (phase === 'during') throw new Error('INVALID_EMAIL'); return true; },
        messageFlagsRemove: async () => { if (phase === 'during') throw new Error('INVALID_EMAIL'); return true; },
        messageMove: async () => { if (phase === 'during') throw new Error('INVALID_EMAIL'); return { uidMap: new Map() }; } };
      await assert.rejects(handleRequest(requestFor({ action, message_uid: 1, target_folder: 'Archive' }), { createImap: () => client }),
        error => error.executionState === ({ before: 'not_executed', during: 'unknown', after: 'executed' })[phase]);
    }
  }
});

test('symlink loops report a local attachment problem, not QQ rate limiting', async t => {
  const { handleRequest } = require('../src/worker.cjs');
  const dir = await fixture(t), link = path.join(dir, 'loop');
  await fs.symlink('loop', link);
  for (const action of ['send', 'draft']) {
    await assert.rejects(handleRequest(requestFor({ ...base, action, attachment_paths: [link] }), {}), error => {
      assert.equal(error.executionState, 'not_executed');
      assert.match(error.message, /附件.*路径/);
      assert.doesNotMatch(error.message, /频繁|稍后再试|结果不确定/);
      return true;
    });
  }
});
test('attachment open/stat/read/close errors stay in the local file error domain', async t => {
  const { handleRequest } = require('../src/worker.cjs');
  for (const operation of ['open', 'stat', 'read', 'close']) {
    let closed = false;
    const fail = () => { throw Object.assign(new Error('too many symbolic links'), { code: 'ELOOP' }); };
    const handle = { stat: async () => ({ isFile: () => true, size: 0 }), read: async () => ({ bytesRead: 0 }), close: async () => { closed = true; } };
    if (operation !== 'open') handle[operation] = async () => { if (operation === 'close') closed = true; fail(); };
    const mock = t.mock.method(fs, 'open', operation === 'open' ? fail : async () => handle);
    try {
      await assert.rejects(handleRequest(requestFor({ ...base, attachment_paths: [path.resolve('fixture.txt')] }), {}), error => {
        assert.equal(error.executionState, 'not_executed');
        assert.match(error.message, /附件.*路径/);
        assert.doesNotMatch(error.message, /频繁/);
        return true;
      });
      assert.equal(closed, operation !== 'open');
    } finally { mock.mock.restore(); }
  }
});

test('a transient result-delivery failure preserves known outcomes without repeating mailbox operations', async () => {
  for (const action of ['move', 'mark_read', 'mark_unread']) {
    for (const state of ['success', 'not_executed', 'executed', 'unknown', 'invalid']) {
      let handler, delivered, calls = 0, deliveries = 0;
      const args = { ...base, action, message_uid: 1, target_folder: 'Archive' };
      if (state === 'invalid') delete args.message_uid;
      const expectedMessage = state === 'not_executed' ? '操作未执行：附件路径错误' : '操作已执行，请核对邮箱';
      const context = { Map, setTimeout, fetch: async url => ({ ok: true, json: async () => url === '/kv' ? { email: credentials.email } : [{ key: 'qq_mail_authorization_code', saved: true }] }), cindy: {
        onHostMessage: fn => { handler = fn; }, node: { request: async () => {
          calls++;
          if (state === 'success') return { ok: true, result: { action, uid: 123 } };
          if (state === 'unknown') return { ok: false, message: 'timeout' };
          return { ok: false, message: expectedMessage, data: { execution_state: state } };
        } }, send: async result => { if (++deliveries === 1) throw new Error('transient delivery failure'); delivered = result; },
      } };
      vm.runInNewContext(await fs.readFile(path.join(__dirname, '../main.js'), 'utf8'), context);
      handler({ type: 'tool-call', tool: 'qq_mail', callId: 'delivery-call', args });
      for (let i = 0; i < 20 && !delivered; i++) await new Promise(r => setImmediate(r));
      assert.equal(deliveries, 2);
      assert.equal(calls, state === 'invalid' ? 0 : 1);
      assert.equal(delivered.callId, 'delivery-call');
      if (state === 'success') {
        assert.equal(delivered.ok, true);
        assert.deepEqual(JSON.parse(JSON.stringify(delivered.result)), { action, uid: 123 });
      } else {
        assert.equal(delivered.ok, false);
        if (state === 'unknown') assert.match(delivered.message, /结果不确定/);
        else if (state === 'invalid') assert.match(delivered.message, /操作未执行/);
        else assert.equal(delivered.message, expectedMessage);
      }
    }
  }
});
