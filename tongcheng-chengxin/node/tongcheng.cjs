'use strict';

const API_BASE = 'https://wx.17u.cn/skills/gateway/api/v1/gateway';
const API_VERSION = '1.0.0';
const API_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

const COMMON = {
  departure: { type: 'string', description: '出发城市或出发地。' },
  destination: { type: 'string', description: '目的城市、目的地或所在城市。' },
  date: { type: 'string', description: '出发、入住或游玩日期；可使用自然语言。' },
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

// 同程网关偶发忽略 date 参数、回落返回其它日期的资源且不报错。
// 这里对成功响应做返回日期与请求日期的一致性校验，不一致时自动重试一次。
const DATE_VALUE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_KEYS = new Set(['depDate', 'arrDate', 'date', 'queryDate', 'checkInDate', 'checkOutDate', 'playDate', 'startDate', 'departDate']);

function collectReturnedDates(value) {
  const dates = new Set();
  const budget = { remaining: 20000 };
  (function walk(node) {
    if (budget.remaining <= 0 || dates.size > 64 || node === null || typeof node !== 'object') return;
    budget.remaining -= 1;
    if (Array.isArray(node)) { for (const item of node) walk(item); return; }
    for (const [key, item] of Object.entries(node)) {
      if (DATE_KEYS.has(key) && typeof item === 'string' && DATE_VALUE_RE.test(item)) { dates.add(item); continue; }
      walk(item);
    }
  })(value);
  return dates;
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
    const raw = await response.text();
    if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) throw new Error('同程网关响应超过 8 MB 上限');
    if (response.status < 200 || response.status >= 300) throw new Error(`同程网关 HTTP ${response.status}`);
    try { return JSON.parse(raw); } catch { throw new Error('同程网关返回了无法解析的 JSON'); }
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error('同程网关请求超时（15 秒）');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function createTongchengClient({ request = requestGateway } = {}) {
  return {
    async call(toolName, args, apiKey) {
      const validation = validateQuery(toolName, args);
      if (!validation.ok) throw new Error(validation.message);
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
      catch (error) { throw new Error(redact(error && error.message, apiKey)); }
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
        const dates = collectReturnedDates(response.data);
        if (dates.size > 0 && !dates.has(requestedDate)) {
          let retryData = null;
          try {
            const retry = await request({ url, headers, body: requestBody, timeoutMs: API_TIMEOUT_MS });
            if (retry && typeof retry === 'object' && (retry.code === 0 || retry.code === '0') && retry.data !== undefined) {
              const retryDates = collectReturnedDates(retry.data);
              if (retryDates.size > 0 && retryDates.has(requestedDate)) retryData = retry.data;
            }
          } catch { /* 重试失败时保留首次结果并明确提示 */ }
          if (retryData) return { status: 'ok', message: '查询成功；以下内容来自同程接口响应。', data: retryData };
          const returned = [...dates].sort().join('、');
          return { status: 'date_mismatch', message: `注意：同程接口返回的资源日期（${returned}）与请求的 ${requestedDate} 不一致，已自动重试仍未修正；以下内容仅供参考，请核对日期后再使用。`, data: response.data };
        }
      }
      return { status: 'ok', message: '查询成功；以下内容来自同程接口响应。', data: response.data };
    }
  };
}

module.exports = { API_BASE, API_VERSION, API_TIMEOUT_MS, ROUTES, TOOL_DEFINITIONS, buildRequestParams, validateQuery, createTongchengClient };
