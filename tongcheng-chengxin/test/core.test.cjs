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
