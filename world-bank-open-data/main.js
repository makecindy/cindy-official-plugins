/**
 * World Bank Open Data · Cindy 官方只读数据插件。
 *
 * 数据源:World Bank Indicators API v2 (api.worldbank.org)。
 * - 公开 API，无凭证、无设置页；
 * - 只读 GET 请求；
 * - 默认只取最近一期有效值，避免无意拉取完整历史；
 * - 结果明确携带 lastUpdated，避免把统计指标误解为实时行情。
 */

/* global cindy */

var API = 'https://api.worldbank.org/v2';
var MAX_RESULT_CHARS = 50 * 1000;

var COMMON_INDICATORS = {
  gdp: {
    code: 'NY.GDP.MKTP.CD',
    name: 'GDP (current US$)',
    description: '国内生产总值，现价美元',
  },
  gdp_growth: {
    code: 'NY.GDP.MKTP.KD.ZG',
    name: 'GDP growth (annual %)',
    description: 'GDP 年增长率',
  },
  gdp_per_capita: {
    code: 'NY.GDP.PCAP.CD',
    name: 'GDP per capita (current US$)',
    description: '人均 GDP，现价美元',
  },
  population: {
    code: 'SP.POP.TOTL',
    name: 'Population, total',
    description: '总人口',
  },
  population_growth: {
    code: 'SP.POP.GROW',
    name: 'Population growth (annual %)',
    description: '人口年增长率',
  },
  inflation: {
    code: 'FP.CPI.TOTL.ZG',
    name: 'Inflation, consumer prices (annual %)',
    description: '居民消费价格通胀率',
  },
  unemployment: {
    code: 'SL.UEM.TOTL.ZS',
    name: 'Unemployment, total (% of total labor force)',
    description: '失业率',
  },
  life_expectancy: {
    code: 'SP.DYN.LE00.IN',
    name: 'Life expectancy at birth, total (years)',
    description: '出生时预期寿命',
  },
  internet_users: {
    code: 'IT.NET.USER.ZS',
    name: 'Individuals using the Internet (% of population)',
    description: '互联网用户占人口比例',
  },
  urban_population: {
    code: 'SP.URB.TOTL.IN.ZS',
    name: 'Urban population (% of total population)',
    description: '城镇人口占总人口比例',
  },
  exports_share_gdp: {
    code: 'NE.EXP.GNFS.ZS',
    name: 'Exports of goods and services (% of GDP)',
    description: '货物和服务出口占 GDP 比例',
  },
  imports_share_gdp: {
    code: 'NE.IMP.GNFS.ZS',
    name: 'Imports of goods and services (% of GDP)',
    description: '货物和服务进口占 GDP 比例',
  },
};

function fail(message) {
  return { ok: false, message: message };
}

function clampInt(value, fallback, min, max) {
  var number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function normalizeCodes(value, label, max) {
  if (value === undefined || value === null) return { values: [] };
  if (!Array.isArray(value)) return { err: label + ' 必须是数组' };
  var result = [];
  for (var i = 0; i < value.length; i++) {
    var code = String(value[i] || '').trim().toUpperCase();
    if (!code) continue;
    if (!/^[A-Z0-9]{2,10}$/.test(code)) return { err: label + ' 含非法代码:' + code };
    if (result.indexOf(code) < 0) result.push(code);
  }
  if (result.length > max) return { err: label + ' 最多支持 ' + max + ' 个代码' };
  return { values: result };
}

function resolveIndicator(value) {
  var raw = String(value || '').trim();
  if (!raw) return { err: 'indicator 不能为空' };
  var alias = raw.toLowerCase().replace(/[\s-]+/g, '_');
  if (COMMON_INDICATORS[alias]) {
    return {
      code: COMMON_INDICATORS[alias].code,
      alias: alias,
      common: COMMON_INDICATORS[alias],
    };
  }
  if (!/^[A-Za-z0-9_.-]{2,80}$/.test(raw)) {
    return { err: 'indicator 不是合法的世界银行指标代码或常用别名:' + raw };
  }
  return { code: raw };
}

function qs(params) {
  var parts = [];
  for (var key in params) {
    if (!Object.prototype.hasOwnProperty.call(params, key)) continue;
    var value = params[key];
    if (value === undefined || value === null || value === '') continue;
    parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
  }
  return parts.length ? '?' + parts.join('&') : '';
}

function extractApiMessage(data) {
  var root = Array.isArray(data) ? data[0] : data;
  var messages = root && Array.isArray(root.message) ? root.message : [];
  if (!messages.length) return '';
  return messages.map(function (item) {
    return item && (item.value || item.key || item.id);
  }).filter(Boolean).join('; ');
}

function parseWorldBankResponse(body) {
  var data;
  try {
    data = JSON.parse(body);
  } catch (err) {
    return { err: '世界银行 API 返回的不是合法 JSON' };
  }
  var apiMessage = extractApiMessage(data);
  if (apiMessage) return { err: '世界银行 API 拒绝了请求:' + apiMessage };
  if (!Array.isArray(data) || data.length < 2 || !Array.isArray(data[1])) {
    return { err: '世界银行 API 返回结构异常' };
  }
  return { meta: data[0] || {}, rows: data[1] };
}

function classifyStatus(status) {
  if (status === 404) return '世界银行 API 没有找到该国家、地区、主题或指标，请检查代码';
  if (status === 429) return '世界银行 API 请求过于频繁，请稍后重试';
  if (status >= 500) return '世界银行 API 暂时不可用(HTTP ' + status + ')，请稍后重试';
  return '世界银行 API 返回 HTTP ' + status;
}

async function api(path, params, callId) {
  var response;
  try {
    response = await cindy.fetch({
      url: API + path + qs(Object.assign({ format: 'json' }, params || {})),
      headers: { Accept: 'application/json' },
      callId: callId,
    });
  } catch (err) {
    return { err: '连接世界银行 API 失败，请检查网络:' + (err && err.message ? err.message : String(err)) };
  }
  if (!response || !response.ok) {
    return { err: response && response.message || '连接世界银行 API 失败，请稍后重试' };
  }
  if (response.status < 200 || response.status >= 300) {
    return { err: classifyStatus(response.status) };
  }
  return parseWorldBankResponse(response.body || '');
}

function compactCountry(row) {
  return {
    id: row.id,
    iso2Code: row.iso2Code,
    name: row.name,
    region: row.region && row.region.value || '',
    incomeLevel: row.incomeLevel && row.incomeLevel.value || '',
    lendingType: row.lendingType && row.lendingType.value || '',
    capitalCity: row.capitalCity || '',
    longitude: row.longitude || '',
    latitude: row.latitude || '',
    aggregate: Boolean(row.region && row.region.id === 'NA'),
  };
}

function compactIndicator(row) {
  return {
    id: row.id,
    name: row.name,
    unit: row.unit || '',
    source: row.source && row.source.value || '',
    sourceNote: row.sourceNote || '',
    sourceOrganization: row.sourceOrganization || '',
    topics: Array.isArray(row.topics)
      ? row.topics.map(function (topic) { return { id: topic.id, name: topic.value }; })
      : [],
  };
}

function compactDataRow(row) {
  return {
    country: row.country && row.country.value || '',
    countryCode: row.countryiso3code || row.country && row.country.id || '',
    year: row.date,
    value: row.value,
    unit: row.unit || '',
    observationStatus: row.obs_status || '',
  };
}

function boundedResult(result) {
  var text = JSON.stringify(result);
  if (text.length <= MAX_RESULT_CHARS) return result;
  var records = Array.isArray(result.records) ? result.records : [];
  var bounded = Object.assign({}, result, {
    records: [],
    responseTruncated: true,
    recordsAvailableInPage: records.length,
    recordsReturned: 0,
    hint: '单页结果过大，已保留结构化元数据和部分 records；请缩小年份范围、国家数量或每页数量',
  });
  for (var i = 0; i < records.length; i++) {
    bounded.records.push(records[i]);
    bounded.recordsReturned = bounded.records.length;
    if (JSON.stringify(bounded).length > MAX_RESULT_CHARS) {
      bounded.records.pop();
      bounded.recordsReturned = bounded.records.length;
      break;
    }
  }
  return bounded;
}

function applyRecentParams(params, args) {
  var recent = clampInt(args && args.recent, 1, 1, 20);
  if (args && args.includeNulls) {
    params.MRV = recent;
  } else {
    params.MRNEV = recent;
  }
}

async function countriesTool(args, callId) {
  var codes = normalizeCodes(args && args.codes, 'codes', 50);
  if (codes.err) return fail(codes.err);
  var limit = clampInt(args && args.limit, 20, 1, 100);
  var response;
  if (codes.values.length) {
    response = await api('/country/' + codes.values.join(';'), { per_page: 100 }, callId);
  } else {
    response = await api('/country', { per_page: 400 }, callId);
  }
  if (response.err) return fail(response.err);
  var rows = response.rows.map(compactCountry);
  if (!(args && args.includeAggregates)) {
    rows = rows.filter(function (row) { return !row.aggregate; });
  }
  var query = String(args && args.query || '').trim().toLowerCase();
  if (query) {
    rows = rows.filter(function (row) {
      return [
        row.id,
        row.iso2Code,
        row.name,
        row.region,
        row.incomeLevel,
        row.capitalCity,
      ].some(function (value) { return String(value || '').toLowerCase().indexOf(query) >= 0; });
    });
  }
  return {
    ok: true,
    result: {
      count: Math.min(rows.length, limit),
      totalMatched: rows.length,
      countries: rows.slice(0, limit),
    },
  };
}

function commonCatalog() {
  return Object.keys(COMMON_INDICATORS).sort().map(function (alias) {
    return {
      alias: alias,
      code: COMMON_INDICATORS[alias].code,
      name: COMMON_INDICATORS[alias].name,
      description: COMMON_INDICATORS[alias].description,
    };
  });
}

async function catalogTool(args, callId) {
  var action = String(args && args.action || 'common');
  if (action === 'common') {
    return { ok: true, result: { indicators: commonCatalog() } };
  }
  if (action === 'topics') {
    var topics = await api('/topic', { per_page: 100 }, callId);
    if (topics.err) return fail(topics.err);
    return {
      ok: true,
      result: {
        topics: topics.rows.map(function (row) {
          return { id: row.id, name: row.value, description: row.sourceNote || '' };
        }),
      },
    };
  }
  if (action === 'topic_indicators') {
    var topicId = String(args && args.topicId || '').trim();
    if (!/^\d{1,4}$/.test(topicId)) return fail('topicId 必须来自 topics 返回的数字 id');
    var page = clampInt(args && args.page, 1, 1, 10000);
    var limit = clampInt(args && args.limit, 20, 1, 100);
    var topicIndicators = await api('/topic/' + topicId + '/indicator', {
      page: page,
      per_page: limit,
    }, callId);
    if (topicIndicators.err) return fail(topicIndicators.err);
    return {
      ok: true,
      result: {
        page: Number(topicIndicators.meta.page || page),
        pages: Number(topicIndicators.meta.pages || 1),
        total: Number(topicIndicators.meta.total || topicIndicators.rows.length),
        indicators: topicIndicators.rows.map(compactIndicator),
      },
    };
  }
  if (action === 'indicator') {
    var indicator = resolveIndicator(args && args.indicator);
    if (indicator.err) return fail(indicator.err);
    var indicatorInfo = await api('/indicator/' + encodeURIComponent(indicator.code), {}, callId);
    if (indicatorInfo.err) return fail(indicatorInfo.err);
    return {
      ok: true,
      result: {
        requested: args.indicator,
        resolvedCode: indicator.code,
        indicator: compactIndicator(indicatorInfo.rows[0] || {}),
      },
    };
  }
  return fail('未知 action:' + action);
}

function validateYearRange(args) {
  var hasStart = args && args.startYear !== undefined && args.startYear !== null;
  var hasEnd = args && args.endYear !== undefined && args.endYear !== null;
  if (hasStart !== hasEnd) return { err: 'startYear 和 endYear 必须一起传' };
  if (!hasStart) return {};
  var start = Number(args.startYear);
  var end = Number(args.endYear);
  var maxYear = new Date().getUTCFullYear() + 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1960 || end > maxYear || start > end) {
    return { err: '年份范围无效：须满足 1960 ≤ startYear ≤ endYear ≤ ' + maxYear };
  }
  if (end - start > 100) return { err: '单次年份范围最多 101 年' };
  return { start: start, end: end };
}

async function dataTool(args, callId) {
  var countries = normalizeCodes(args && args.countries, 'countries', 25);
  if (countries.err) return fail(countries.err);
  if (!countries.values.length) return fail('countries 不能为空');
  var indicator = resolveIndicator(args && args.indicator);
  if (indicator.err) return fail(indicator.err);
  var years = validateYearRange(args);
  if (years.err) return fail(years.err);
  var page = clampInt(args && args.page, 1, 1, 10000);
  var limit = clampInt(args && args.limit, 200, 1, 1000);
  var params = { page: page, per_page: limit };
  if (years.start !== undefined) {
    params.date = years.start + ':' + years.end;
  } else {
    applyRecentParams(params, args);
  }
  var response = await api(
    '/country/' + countries.values.join(';') + '/indicator/' + encodeURIComponent(indicator.code),
    params,
    callId,
  );
  if (response.err) return fail(response.err);
  var rows = response.rows.map(compactDataRow);
  if (!(args && args.includeNulls)) {
    rows = rows.filter(function (row) { return row.value !== null && row.value !== undefined; });
  }
  var first = response.rows[0] || {};
  return {
    ok: true,
    result: boundedResult({
      indicator: {
        requested: args.indicator,
        code: indicator.code,
        name: first.indicator && first.indicator.value || indicator.common && indicator.common.name || '',
      },
      lastUpdated: response.meta.lastupdated || '',
      page: Number(response.meta.page || page),
      pages: Number(response.meta.pages || 1),
      total: Number(response.meta.total || rows.length),
      records: rows,
      note: '世界银行统计数据不是实时市场行情；请结合 lastUpdated 与每条记录的 year 解读',
    }),
  };
}

var handlers = {
  world_bank_countries: countriesTool,
  world_bank_catalog: catalogTool,
  world_bank_data: dataTool,
};

cindy.onHostMessage(async function (message) {
  if (!message || message.type !== 'tool-call') return;
  var handler = handlers[message.tool];
  if (!handler) {
    cindy.send({ type: 'tool-result', callId: message.callId, ok: false, message: '未知工具:' + message.tool });
    return;
  }
  try {
    var result = await handler(message.args || {}, message.callId);
    if (result.ok) {
      cindy.send({ type: 'tool-result', callId: message.callId, ok: true, result: result.result });
    } else {
      cindy.send({ type: 'tool-result', callId: message.callId, ok: false, message: result.message });
    }
  } catch (err) {
    cindy.send({
      type: 'tool-result',
      callId: message.callId,
      ok: false,
      message: '世界银行数据查询失败:' + (err && err.message ? err.message : String(err)),
    });
  }
});

if (typeof module !== 'undefined') {
  module.exports = {
    COMMON_INDICATORS,
    applyRecentParams,
    boundedResult,
    classifyStatus,
    compactCountry,
    compactDataRow,
    compactIndicator,
    normalizeCodes,
    parseWorldBankResponse,
    resolveIndicator,
    validateYearRange,
  };
}
