'use strict';

const API_BASE = 'https://wx.17u.cn/skills/gateway/api/v1/gateway';
const API_VERSION = '1.0.0';
const API_TIMEOUT_MS = 15_000;
const TOTAL_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

const COMMON = {
  departure: { type: 'string', description: '出发城市或出发地。' },
  destination: { type: 'string', description: '目的城市、目的地或所在城市。' },
  date: { type: 'string', description: '出发、入住或游玩日期；请使用 YYYY-MM-DD。' },
  extra: { type: 'string', description: '保留日期、人数、时间、偏好、星级、席别等其它需求。' }
};

const ROUTES = Object.freeze({
  flight_search: { path: '/flightResource', label: '机票', required: 'flight', properties: {
    ...COMMON, flight_number: { type: 'string', description: '明确的航班号，例如 CA1234。' },
    low_price: { type: 'boolean', description: '是否查询特价或低价机票。' }
  } },
  train_search: { path: '/trainResource', label: '火车票', required: 'route', properties: {
    ...COMMON, departure_station: { type: 'string', description: '精确出发车站。' },
    arrival_station: { type: 'string', description: '精确到达车站。' },
    train_number: { type: 'string', description: '明确的车次号。' }
  } },
  hotel_search: { path: '/hotelResource', label: '酒店', required: 'destination', properties: COMMON },
  scenery_search: { path: '/sceneryResource', label: '景区门票', required: 'destination', properties: COMMON },
  bus_search: { path: '/busResource', label: '汽车票', required: 'route', properties: COMMON },
  travel_search: { path: '/travelResource', label: '度假与行程', required: 'destination', properties: {
    ...COMMON, days: { type: 'integer', description: '行程天数。' }
  } },
  traffic_search: { path: '/trafficResource', label: '综合交通', required: 'route', properties: COMMON }
});

const TOOL_DEFINITIONS = Object.entries(ROUTES).map(([name, route]) => ({
  name,
  description: `查询同程程心实时${route.label}资源；只返回接口实际提供的信息，不编造价格、余票或开放状态。`,
  inputSchema: { type: 'object', properties: route.properties, additionalProperties: false }
}));

function cleanString(value, maxLength = 500) {
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, maxLength);
}

function buildRequestParams(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('查询参数必须是对象');
  const params = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === '' || value === null || value === undefined) continue;
    if (typeof value === 'string') {
      const name = key.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase());
      params[name] = cleanString(value, name === 'extra' ? 1000 : 500);
    } else if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
      params[key.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase())] = value;
    } else {
      throw new Error(`参数 ${key} 只接受字符串、数字或布尔值`);
    }
  }
  params.version = API_VERSION;
  return params;
}

function validateQuery(toolName, args) {
  const route = ROUTES[toolName];
  if (!route) return { ok: false, message: '不支持的查询类型。' };
  if (!args || typeof args !== 'object' || Array.isArray(args)) return { ok: false, message: '查询参数必须是对象。' };
  const hasRoute = Boolean(args.departure && args.destination);
  const complete = route.required === 'route' ? hasRoute
    : route.required === 'destination' ? Boolean(args.destination)
      : Boolean(hasRoute || args.flight_number || (args.departure && args.low_price));
  if (complete) return { ok: true };
  if (toolName === 'flight_search') {
    return { ok: false, message: '机票查询请提供出发地和目的地、航班号，或出发地并开启 low_price。' };
  }
  if (route.required === 'route') return { ok: false, message: `${route.label}查询需要提供出发地和目的地。` };
  return { ok: false, message: `${route.label}查询需要提供目的地或所在城市。` };
}

function redact(message, secret) {
  const text = String(message || '请求失败');
  return secret ? text.split(secret).join('[redacted]') : text;
}

// Arrival/check-out dates can differ from departure/check-in dates.
const DATE_VALUE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Only resource collections make an object a grouping envelope. Tags, seats,
// prices and other child properties do not invalidate a resource's own date.
const RESOURCE_COLLECTIONS = new Set([
  'flightDataList', 'flightList', 'trainDataList', 'trainList',
  'hotelDataList', 'hotelList', 'sceneryDataList', 'sceneryList',
  'busDataList', 'busList', 'tripDataList', 'tripList',
  'holidayDataList', 'holidayList', 'tripPlanDataList', 'trafficList'
]);
const DATE_KEYS_BY_TOOL = {
  flight_search: ['depDate', 'departDate', 'date'],
  train_search: ['depDate', 'departDate', 'date'],
  bus_search: ['depDate', 'departDate', 'date'],
  hotel_search: ['checkInDate', 'date'],
  scenery_search: ['playDate', 'startDate', 'date'],
  travel_search: ['startDate', 'depDate', 'departDate', 'date'],
  traffic_search: ['depDate', 'departDate', 'startDate', 'date']
};

function filterDataByDate(value, requestedDate, toolName) {
  const dateKeys = new Set(DATE_KEYS_BY_TOOL[toolName]);
  const dates = new Set();
  let matched = false;
  let unverified = false;
  const removed = Symbol('removed');
  function walk(node, inheritedDate = null) {
    if (node === null || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((item) => {
      if (!inheritedDate && item && typeof item === 'object'
        && !Array.isArray(item) && !Object.values(item).some((child) => child && typeof child === 'object')
        && !Object.keys(item).some((key) => dateKeys.has(key) && DATE_VALUE_RE.test(item[key]))) {
        unverified = true;
      }
      return walk(item, inheritedDate);
    }).filter((item) => item !== removed);
    const ownDates = Object.entries(node)
      .filter(([key, item]) => dateKeys.has(key) && typeof item === 'string' && DATE_VALUE_RE.test(item))
      .map(([, item]) => item);
    ownDates.forEach((date) => dates.add(date));
    if (ownDates.some((date) => date !== requestedDate)) return removed;
    const effectiveDate = ownDates[0] || inheritedDate;
    const isGroup = Object.keys(node).some((key) => RESOURCE_COLLECTIONS.has(key));
    if (!isGroup && effectiveDate === requestedDate) matched = true;
    const result = {};
    for (const [key, item] of Object.entries(node)) {
      const filtered = walk(item, effectiveDate);
      if (filtered !== removed) result[key] = filtered;
    }
    return result;
  }
  const filtered = walk(value);
  return { value: filtered === removed ? null : filtered, dates, matched, unverified };
}

function gatewayError(error, secret) {
  const message = redact(error && error.message, secret);
  if (/HTTP 401\b/.test(message)) return '同程授权失败（401），请在插件设置中重新保存有效的程心激活码。';
  if (/HTTP (?:429|5\d\d)\b/.test(message)) return '同程服务繁忙或暂时不可用，请稍后重试。';
  if (/HTTP 403\b/.test(message)) return '同程拒绝访问（403），请核对账号权限和激活码状态。';
  if (/fetch failed|network|ENOTFOUND|ECONN|连接|网络/i.test(message)) return '无法连接同程网关，请检查网络连接后重试。';
  if (/HTTP \d{3}\b/.test(message)) return '同程网关拒绝了请求，请核对查询参数后重试。';
  return message;
}

async function requestGateway({ url, headers, body, timeoutMs = API_TIMEOUT_MS }) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'wx.17u.cn' || parsed.port) {
    throw new Error('同程网关地址不在固定官方 HTTPS 范围内');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST', redirect: 'manual', signal: controller.signal,
      headers, body: JSON.stringify(body)
    });
    if (response.status >= 300 && response.status < 400) throw new Error('同程网关拒绝重定向');
    if (response.status < 200 || response.status >= 300) {
      if (response.body) await response.body.cancel().catch(() => {});
      throw new Error(`同程网关 HTTP ${response.status}`);
    }
    const chunks = [];
    let bytes = 0;
    if (!response.body) throw new Error('同程网关返回了空响应，请稍后重试。');
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          controller.abort();
          await reader.cancel().catch(() => {});
          throw new Error('同程网关响应超过 8 MB 上限，请缩小查询范围。');
        }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    const raw = Buffer.concat(chunks).toString('utf8');
    try { return JSON.parse(raw); } catch { throw new Error('同程网关返回了无法解析的 JSON'); }
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error('同程网关请求超时，请稍后重试。');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function createTongchengClient({ request = requestGateway, now = Date.now } = {}) {
  return {
    async call(toolName, args, apiKey) {
      const validation = validateQuery(toolName, args);
      if (!validation.ok) throw new Error(validation.message);
      if (args.date && (typeof args.date !== 'string' || !DATE_VALUE_RE.test(args.date)
        || !Number.isFinite(Date.parse(args.date)) || new Date(args.date).toISOString().slice(0, 10) !== args.date)) {
        throw new Error('请将查询日期明确为 YYYY-MM-DD（例如 2026-10-15），以便核对返回资源日期。');
      }
      const deadline = now() + TOTAL_TIMEOUT_MS;
      const route = ROUTES[toolName];
      const requestBody = buildRequestParams(args);
      const url = `${API_BASE}${route.path}`;
      const headers = {
        'content-type': 'application/json',
        accept: 'application/json, text/plain, */*',
        origin: 'https://www.ly.com',
        referer: 'https://www.ly.com/',
        'user-agent': `TC-Chengxin-Cindy/${API_VERSION}`
      };
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      let response;
      try { response = await request({ url, headers, body: requestBody, timeoutMs: API_TIMEOUT_MS }); }
      catch (error) { throw new Error(gatewayError(error, apiKey)); }
      if (!response || typeof response !== 'object') throw new Error('同程网关响应格式无效');
      if (response.code === 1 || response.code === '1') {
        return { status: 'no_results', message: response.message || `没有找到符合条件的${route.label}资源。`, data: response.data ?? null };
      }
      if (response.code !== 0 && response.code !== '0') {
        throw new Error(redact(response.message || `同程业务接口返回错误码 ${String(response.code ?? 'unknown')}`, apiKey));
      }
      if (response.data === undefined) throw new Error('同程网关成功响应缺少 data 字段');
      const requestedDate = typeof requestBody.date === 'string' && DATE_VALUE_RE.test(requestBody.date)
        ? requestBody.date : null;
      if (requestedDate) {
        const filtered = filterDataByDate(response.data, requestedDate, toolName);
        if (filtered.matched) {
          return { status: filtered.unverified ? 'date_unverified' : 'ok', message: filtered.unverified ? '已移除日期不符的资源，但部分资源没有可核对的日期，请在预订页面确认。' : '查询成功；已移除日期不符的资源。', data: filtered.value };
        }
        if (filtered.dates.size === 0) {
          return { status: 'date_unverified', message: '同程响应没有可核对的资源日期，请在预订页面确认日期。', data: filtered.value };
        }
        const remainingMs = deadline - now();
        if (remainingMs > 0) {
          try {
            const retry = await request({ url, headers, body: requestBody, timeoutMs: Math.min(API_TIMEOUT_MS, remainingMs) });
            if (retry && (retry.code === 0 || retry.code === '0') && retry.data !== undefined) {
              const retryFiltered = filterDataByDate(retry.data, requestedDate, toolName);
              if (retryFiltered.matched) return { status: retryFiltered.unverified ? 'date_unverified' : 'ok', message: retryFiltered.unverified ? '已移除日期不符的资源，但部分资源没有可核对的日期，请在预订页面确认。' : '查询成功；已移除日期不符的资源。', data: retryFiltered.value };
            }
          } catch { /* Never expose unchecked retry data. */ }
        }
        const returned = [...filtered.dates].sort().join('、');
        return { status: 'date_mismatch', message: '同程资源日期（' + returned + '）与请求的 ' + requestedDate + ' 不一致；重试未修正或时间预算已耗尽，请核对日期后重试。', data: filtered.value };
      }
      return { status: 'ok', message: '查询成功；以下内容来自同程接口响应。', data: response.data };
    }
  };
}

module.exports = { API_BASE, API_VERSION, API_TIMEOUT_MS, TOTAL_TIMEOUT_MS, MAX_RESPONSE_BYTES, requestGateway, ROUTES, TOOL_DEFINITIONS, buildRequestParams, validateQuery, createTongchengClient };
