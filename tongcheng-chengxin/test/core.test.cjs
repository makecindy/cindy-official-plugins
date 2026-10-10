const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRequestParams, createTongchengClient, validateQuery } = require('../node/tongcheng.cjs');

test('request parameters use camelCase, omit blank values, and pin API version', () => {
  assert.deepEqual(buildRequestParams({
    departure_station: '虹桥',
    arrival_station: '',
    extra: '明天',
    version: 'attacker-value'
  }), { departureStation: '虹桥', extra: '明天', version: '1.0.0' });
});

test('required query combinations follow each travel route', () => {
  assert.equal(validateQuery('flight_search', { departure: '杭州', low_price: true }).ok, true);
  assert.equal(validateQuery('flight_search', { departure: '杭州' }).ok, false);
  assert.equal(validateQuery('train_search', { departure: '杭州', destination: '上海' }).ok, true);
  assert.equal(validateQuery('hotel_search', { destination: '上海' }).ok, true);
  assert.equal(validateQuery('traffic_search', { destination: '上海' }).ok, false);
});

test('client calls only the fixed HTTPS gateway and returns business data', async () => {
  let captured;
  const client = createTongchengClient({
    request: async (request) => {
      captured = request;
      return { code: 0, data: { flightDataList: [{ flightList: [{ flightNo: 'CA123' }] }] } };
    }
  });
  const result = await client.call('flight_search', { departure: '杭州', destination: '上海' }, 'fake-secret');
  assert.equal(captured.url, 'https://wx.17u.cn/skills/gateway/api/v1/gateway/flightResource');
  assert.equal(captured.headers.authorization, 'Bearer fake-secret');
  assert.equal(captured.body.departure, '杭州');
  assert.equal(captured.body.version, '1.0.0');
  assert.equal(result.data.flightDataList[0].flightList[0].flightNo, 'CA123');
});

test('client treats no-match separately and never includes secrets in errors', async () => {
  const client = createTongchengClient({
    request: async () => ({ code: 1, message: 'no match', data: null })
  });
  const result = await client.call('hotel_search', { destination: '上海' }, 'fake-secret');
  assert.equal(result.status, 'no_results');
  const failed = createTongchengClient({
    request: async () => { throw new Error('failed with fake-secret'); }
  });
  await assert.rejects(failed.call('hotel_search', { destination: '上海' }, 'fake-secret'), /[redacted]/);
});

test('date mismatch triggers exactly one retry and succeeds when the retry matches', async () => {
  let calls = 0;
  const client = createTongchengClient({
    request: async () => {
      calls += 1;
      return calls === 1
        ? { code: 0, data: { trainDataList: [{ trainList: [{ trainNo: 'G12', depDate: '2026-10-10' }] }] } }
        : { code: 0, data: { trainDataList: [{ trainList: [{ trainNo: 'G12', depDate: '2026-10-15' }] }] } };
    }
  });
  const result = await client.call('train_search', { departure: '上海', destination: '北京', date: '2026-10-15' }, 'fake-secret');
  assert.equal(calls, 2);
  assert.equal(result.status, 'ok');
  assert.equal(result.data.trainDataList[0].trainList[0].depDate, '2026-10-15');
});

test('date mismatch falls back to an explicit warning when the retry still mismatches', async () => {
  let calls = 0;
  const client = createTongchengClient({
    request: async () => {
      calls += 1;
      return { code: 0, data: { flightDataList: [{ flightList: [{ flightNo: 'KN5978', depDate: '2026-10-10' }] }] } };
    }
  });
  const result = await client.call('flight_search', { departure: '上海', destination: '北京', date: '2026-10-15' }, 'fake-secret');
  assert.equal(calls, 2);
  assert.equal(result.status, 'date_mismatch');
  assert.match(result.message, /2026-10-10/);
  assert.match(result.message, /2026-10-15/);
});

test('responses honouring the requested date are returned without retry', async () => {
  let calls = 0;
  const client = createTongchengClient({
    request: async () => {
      calls += 1;
      return { code: 0, data: { hotelDataList: [{ hotelName: '某酒店', checkInDate: '2026-10-15' }] } };
    }
  });
  const result = await client.call('hotel_search', { destination: '上海', date: '2026-10-15' }, 'fake-secret');
  assert.equal(calls, 1);
  assert.equal(result.status, 'ok');
});

const { API_TIMEOUT_MS, TOTAL_TIMEOUT_MS, MAX_RESPONSE_BYTES, requestGateway } = require('../node/tongcheng.cjs');
const query = { departure: '上海', destination: '北京', date: '2026-10-15' };

test('mixed dates are filtered per resource on both initial and retry responses', async () => {
  for (const retry of [false, true]) {
    let calls = 0;
    const client = createTongchengClient({ request: async () => {
      calls++;
      const trainList = [{ trainNo: 'wrong', depDate: '2026-10-10' }];
      if (!retry || calls > 1) trainList.push({ trainNo: 'correct', depDate: query.date, arrDate: '2026-10-16' });
      return { code: 0, data: { trainDataList: [{ trainList }] } };
    } });
    const result = await client.call('train_search', query, '');
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.data.trainDataList[0].trainList.map((item) => item.trainNo), ['correct']);
    assert.equal(calls, retry ? 2 : 1);
  }
});

test('matching query metadata does not make entirely mismatched resources successful', async () => {
  const client = createTongchengClient({ request: async () => ({ code: 0, data: {
    queryDate: query.date, trainList: [{ depDate: '2026-10-10', trainNo: 'wrong' }]
  } }) });
  const result = await client.call('train_search', query, '');
  assert.equal(result.status, 'date_mismatch');
  assert.deepEqual(result.data.trainList, []);
});

test('natural-language and impossible dates cannot bypass date validation', async () => {
  const client = createTongchengClient({ request: async () => { assert.fail('must not request'); } });
  for (const date of ['明天', '2026-02-30']) {
    await assert.rejects(client.call('train_search', { ...query, date }, ''), /YYYY-MM-DD/);
  }
});

test('resources without dates are explicitly unverified', async () => {
  const client = createTongchengClient({ request: async () => ({ code: 0, data: [{ trainNo: 'G1' }] }) });
  assert.equal((await client.call('train_search', query, '')).status, 'date_unverified');
});

test('retry receives only remaining total budget and is skipped when exhausted', async () => {
  for (const elapsed of [14000, 20001]) {
    let clock = 100, calls = 0;
    const timeouts = [];
    const client = createTongchengClient({ now: () => clock, request: async ({ timeoutMs }) => {
      calls++;
      timeouts.push(timeoutMs);
      clock += elapsed;
      return { code: 0, data: [{ depDate: '2026-10-10' }] };
    } });
    assert.equal((await client.call('train_search', query, '')).status, 'date_mismatch');
    assert.deepEqual(timeouts, elapsed < TOTAL_TIMEOUT_MS ? [API_TIMEOUT_MS, TOTAL_TIMEOUT_MS - elapsed] : [API_TIMEOUT_MS]);
    assert.equal(calls, elapsed < TOTAL_TIMEOUT_MS ? 2 : 1);
  }
});

test('HTTP authorization and network failures give actionable, redacted errors', async () => {
  for (const [message, expected] of [['HTTP 401', /重新保存/], ['HTTP 403', /账号权限/], ['fetch failed', /网络连接/]]) {
    const client = createTongchengClient({ request: async () => { throw new Error(message + ' fake-secret'); } });
    await assert.rejects(client.call('train_search', query, 'fake-secret'), (error) => {
      assert.match(error.message, expected);
      assert.ok(!error.message.includes('fake-secret'));
      return true;
    });
  }
});

test('gateway streams JSON and cancels oversized responses before reading the rest', async (t) => {
  let reads = 0, cancelled = false;
  t.mock.method(globalThis, 'fetch', async () => ({ status: 200, body: new ReadableStream({
    pull(controller) { reads++; controller.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { cancelled = true; }
  }, { highWaterMark: 0 }) }));
  await assert.rejects(requestGateway({ url: 'https://wx.17u.cn/test', headers: {}, body: {} }), /8 MB/);
  assert.equal(reads, MAX_RESPONSE_BYTES / (1024 * 1024) + 1);
  assert.equal(cancelled, true);
});

test('gateway decodes UTF-8 split across chunks and respects HTTP errors', async (t) => {
  const buffer = Buffer.from(JSON.stringify({ code: 0, data: '上海' }));
  t.mock.method(globalThis, 'fetch', async () => ({ status: 200, body: new ReadableStream({
    start(controller) { for (const byte of buffer) controller.enqueue(Uint8Array.of(byte)); controller.close(); }
  }) }));
  assert.deepEqual(await requestGateway({ url: 'https://wx.17u.cn/test', headers: {}, body: {} }), { code: 0, data: '上海' });
});

test('queryDate echoes and dates belonging to other resource types are not proof', async () => {
  for (const data of [
    { queryDate: query.date, trainList: [{ trainNo: 'G1' }] },
    { trainList: [{ trainNo: 'G1', checkInDate: query.date, arrDate: query.date }] }
  ]) {
    const client = createTongchengClient({ request: async () => ({ code: 0, data }) });
    assert.equal((await client.call('train_search', query, '')).status, 'date_unverified');
  }
});

test('hotel check-out dates do not reject a matching check-in date', async () => {
  const client = createTongchengClient({ request: async () => ({ code: 0, data: [
    { hotelName: 'Example hotel', checkInDate: query.date, checkOutDate: '2026-10-16' },
    { hotelName: 'Wrong date', checkInDate: '2026-10-10' }
  ] }) });
  const result = await client.call('hotel_search', { destination: '上海', date: query.date }, '');
  assert.equal(result.status, 'ok');
  assert.equal(result.data.length, 1);
});

test('gateway checks HTTP authorization before attempting to consume an error body', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ status: 401, body: null }));
  const client = createTongchengClient();
  await assert.rejects(client.call('train_search', query, ''), /重新保存/);
});

test('gateway aborts stalled requests within the supplied remaining budget', async (t) => {
  let aborted = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      aborted = true;
      reject(new DOMException('aborted', 'AbortError'));
    });
  }));
  await assert.rejects(requestGateway({ url: 'https://wx.17u.cn/test', headers: {}, body: {}, timeoutMs: 15 }), /超时/);
  assert.equal(aborted, true);
});

test('a matching resource does not silently verify undated siblings', async () => {
  const client = createTongchengClient({ request: async () => ({ code: 0, data: [
    { trainNo: 'correct', depDate: query.date }, { trainNo: 'unknown' }
  ] }) });
  assert.equal((await client.call('train_search', query, '')).status, 'date_unverified');
});

test('matching dated resources remain valid with empty arrays, string arrays and child objects', async () => {
  for (const extra of [{ tags: [] }, { tags: ['fast', 'direct'] }, { seats: [] }, { price: { amount: 100 }, tags: [] }]) {
    let calls = 0;
    const client = createTongchengClient({ request: async () => {
      calls++;
      return { code: 0, data: { trainDataList: [{ trainList: [
        { trainNo: 'example-train', depDate: query.date, ...extra },
        { trainNo: 'wrong-date', depDate: '2026-10-10', tags: [] }
      ] }] } };
    } });
    const result = await client.call('train_search', query, '');
    assert.equal(result.status, 'ok');
    assert.equal(calls, 1);
    assert.deepEqual(result.data.trainDataList[0].trainList.map((item) => item.trainNo), ['example-train']);
  }
});

test('a date-bearing group does not prove a match after all child resources are removed', async () => {
  const client = createTongchengClient({ request: async () => ({ code: 0, data: {
    depDate: query.date, trainList: [{ trainNo: 'wrong', depDate: '2026-10-10' }]
  } }) });
  assert.equal((await client.call('train_search', query, '')).status, 'date_mismatch');
});

test('undated resources with nested properties cannot inherit a sibling match', async () => {
  for (const details of [{ tags: [] }, { tags: ['direct'] }, { price: { amount: 100 } }]) {
    const client = createTongchengClient({ request: async () => ({ code: 0, data: {
      trainList: [{ trainNo: 'correct', depDate: query.date }, { trainNo: 'unknown', ...details }]
    } }) });
    const result = await client.call('train_search', query, '');
    assert.equal(result.status, 'date_unverified');
    assert.equal(result.data.trainList.length, 2);
  }
});
