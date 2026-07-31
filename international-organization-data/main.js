/* global cindy */

/**
 * International Organization Data
 *
 * WHO uses its public GHO OData API and needs no credential.
 * FAOSTAT uses the official API and receives its Bearer token only through the
 * network.secrets declaration in ghost.json. The token never enters plugin
 * code, tool arguments, result objects, or logs.
 */

var WHO_BASE = 'https://ghoapi.azureedge.net/api';
var FAO_BASE = 'https://faostatservices.fao.org/api/v1';
var MAX_COUNTRIES = 25;
var MAX_LIMIT = 200;

var WHO_ALIASES = {
  life_expectancy: {
    code: 'WHOSIS_000001',
    name: 'Life expectancy at birth'
  },
  life_expectancy_at_birth: {
    code: 'WHOSIS_000001',
    name: 'Life expectancy at birth'
  },
  under5_mortality: {
    code: 'MDG_0000000007',
    name: 'Under-five mortality rate'
  },
  maternal_mortality: {
    code: 'MDG_0000000026',
    name: 'Maternal mortality ratio'
  },
  tuberculosis: {
    code: 'MDG_0000000020',
    name: 'Incidence of tuberculosis'
  },
  malaria: {
    code: 'MALARIA_EST_CASES',
    name: 'Malaria cases'
  }
};

var WHO_COMMON_INDICATORS = Object.keys(WHO_ALIASES).map(function (alias) {
  return {
    alias: alias,
    code: WHO_ALIASES[alias].code,
    name: WHO_ALIASES[alias].name
  };
});

function clampNumber(value, fallback, min, max) {
  var n = typeof value === 'number' && isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

function quoteOData(value) {
  return String(value).replace(/'/g, "''");
}

function buildQuery(parts) {
  return parts.filter(Boolean).join(' and ');
}

function truncateMessage(value) {
  return String(value || '').replace(/\s+/g, ' ').slice(0, 300);
}

async function getJson(url) {
  var response;
  try {
    response = await cindy.fetch({
      url: url,
      headers: { Accept: 'application/json' }
    });
  } catch (error) {
    return {
      ok: false,
      message: '请求失败：' + truncateMessage(error && error.message ? error.message : error)
    };
  }
  if (!response || !response.ok) {
    return {
      ok: false,
      message: response && response.message
        ? response.message
        : '请求失败'
    };
  }
  if (response.status < 200 || response.status >= 300) {
    var errorText = response.body ? truncateMessage(response.body) : '';
    return {
      ok: false,
      message: '上游返回 HTTP ' + response.status + (errorText ? '：' + errorText : '')
    };
  }
  try {
    return { ok: true, data: JSON.parse(response.body || '{}') };
  } catch (error) {
    return { ok: false, message: '上游返回了无法解析的 JSON' };
  }
}

function envelopeRows(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.value)) return data.value;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

function normalizeCountries(args) {
  var countries = args && Array.isArray(args.countries) ? args.countries : [];
  return countries
    .filter(function (item) { return typeof item === 'string'; })
    .map(function (item) { return item.trim().toUpperCase(); })
    .filter(Boolean)
    .slice(0, MAX_COUNTRIES);
}

function resolveWhoIndicator(value) {
  var input = typeof value === 'string' ? value.trim() : '';
  if (!input) return null;
  var alias = WHO_ALIASES[input.toLowerCase()];
  return alias || { code: input, name: input };
}

function isoDate(value) {
  return typeof value === 'string' && value ? value : null;
}

async function whoCatalog(args) {
  var action = args.action || 'common';
  var limit = clampNumber(args.limit, 20, 1, 100);
  var query = typeof args.query === 'string' ? args.query.trim() : '';

  if (action === 'common') {
    return {
      ok: true,
      source: 'WHO',
      action: 'common',
      indicators: WHO_COMMON_INDICATORS,
      note: '传 action=indicators 搜索 WHO 完整指标目录，传 action=countries 查询国家代码。'
    };
  }

  if (action === 'countries') {
    var countryUrl = WHO_BASE + '/Dimension/COUNTRY/DimensionValues?$top=' + limit + '&$format=json';
    if (query) {
      countryUrl += '&$filter=contains(Title,%27' + encodeURIComponent(quoteOData(query)) + '%27)';
    }
    var countryResult = await getJson(countryUrl);
    if (!countryResult.ok) return countryResult;
    return {
      ok: true,
      source: 'WHO',
      action: 'countries',
      countries: envelopeRows(countryResult.data).map(function (row) {
        return {
          code: row.Code,
          name: row.Title,
          regionCode: row.ParentCode,
          region: row.ParentTitle
        };
      })
    };
  }

  if (action !== 'indicators') {
    return { ok: false, message: 'WHO 目录 action 只支持 common、indicators、countries' };
  }

  var indicatorUrl = WHO_BASE + '/Indicator?$top=' + limit + '&$format=json';
  if (query) {
    indicatorUrl += '&$filter=contains(IndicatorName,%27' + encodeURIComponent(quoteOData(query)) + '%27)';
  }
  var indicatorResult = await getJson(indicatorUrl);
  if (!indicatorResult.ok) return indicatorResult;
  return {
    ok: true,
    source: 'WHO',
    action: 'indicators',
    indicators: envelopeRows(indicatorResult.data).map(function (row) {
      return {
        code: row.IndicatorCode,
        name: row.IndicatorName,
        language: row.Language
      };
    })
  };
}

function faoMissingToken(result) {
  return !result.ok && typeof result.message === 'string'
    && (result.message.indexOf('401') >= 0
      || result.message.indexOf('Authorization') >= 0
      || result.message.indexOf('尚未配置') >= 0);
}

async function faoGet(path, params) {
  var query = Object.keys(params || {})
    .filter(function (key) {
      return params[key] !== undefined && params[key] !== null && params[key] !== '';
    })
    .map(function (key) {
      return encodeURIComponent(key) + '=' + encodeURIComponent(String(params[key]));
    })
    .join('&');
  var result = await getJson(FAO_BASE + path + (query ? '?' + query : ''));
  if (faoMissingToken(result)) {
    return {
      ok: false,
      message: 'FAOSTAT 需要 API Token。请在插件设置页配置官方 FAOSTAT API Token 后重试。'
    };
  }
  return result;
}

async function faoCatalog(args) {
  var action = args.action || 'groups';
  var lang = 'en';
  var result;

  if (action === 'groups') {
    result = await faoGet('/' + lang + '/groupsanddomains');
  } else if (action === 'domains') {
    if (!args.groupCode) return { ok: false, message: 'FAO action=domains 需要 groupCode' };
    result = await faoGet('/' + lang + '/domains/' + encodeURIComponent(args.groupCode) + '/', {});
  } else if (action === 'dimensions') {
    if (!args.domainCode) return { ok: false, message: 'FAO action=dimensions 需要 domainCode' };
    result = await faoGet('/' + lang + '/dimensions/' + encodeURIComponent(args.domainCode) + '/', {});
  } else if (action === 'codes') {
    if (!args.domainCode || !args.dimension) {
      return { ok: false, message: 'FAO action=codes 需要 domainCode 和 dimension' };
    }
    result = await faoGet(
      '/' + lang + '/codes/' + encodeURIComponent(args.dimension) + '/' + encodeURIComponent(args.domainCode),
      {}
    );
  } else {
    return { ok: false, message: 'FAO 目录 action 只支持 groups、domains、dimensions、codes' };
  }
  if (!result.ok) return result;

  var rows = envelopeRows(result.data);
  var limit = clampNumber(args.limit, 20, 1, 100);
  return {
    ok: true,
    source: 'FAO',
    action: action,
    data: rows.slice(0, limit),
    total: rows.length
  };
}

async function internationalOrgCatalog(args) {
  var source = args && typeof args.source === 'string' ? args.source.toLowerCase() : '';
  if (source === 'who') return whoCatalog(args || {});
  if (source === 'fao') return faoCatalog(args || {});
  return { ok: false, message: 'source 必须是 who 或 fao' };
}

function whoFilter(countries, startYear, endYear, overallOnly) {
  var countryPart = countries.length === 1
    ? "SpatialDim eq '" + quoteOData(countries[0]) + "'"
    : countries.length
      ? '(' + countries.map(function (country) {
        return "SpatialDim eq '" + quoteOData(country) + "'";
      }).join(' or ') + ')'
      : '';
  var parts = [countryPart];
  if (typeof startYear === 'number') parts.push('TimeDim ge ' + Math.floor(startYear));
  if (typeof endYear === 'number') parts.push('TimeDim le ' + Math.floor(endYear));
  if (overallOnly) parts.push("Dim1 eq 'SEX_BTSX'");
  return buildQuery(parts);
}

function normalizeWhoRows(rows, indicator) {
  return rows.map(function (row) {
    return {
      indicator: row.IndicatorCode || indicator.code,
      indicatorName: indicator.name,
      country: row.SpatialDim || null,
      year: row.TimeDim || null,
      value: row.NumericValue === undefined ? null : row.NumericValue,
      displayValue: row.Value === undefined ? null : row.Value,
      low: row.Low === undefined ? null : row.Low,
      high: row.High === undefined ? null : row.High,
      unit: row.Dim1Type || null,
      dimension: row.Dim1 || null,
      sourceUpdatedAt: isoDate(row.Date),
      source: 'WHO GHO'
    };
  });
}

async function whoHealthData(args) {
  var indicator = resolveWhoIndicator(args && args.indicator);
  if (!indicator) return { ok: false, message: 'indicator 不能为空；可先调用 international_org_catalog(source=who, action=common)' };

  var countries = normalizeCountries(args || {});
  var startYear = typeof args.startYear === 'number' ? args.startYear : null;
  var endYear = typeof args.endYear === 'number' ? args.endYear : null;
  if ((startYear === null) !== (endYear === null)) {
    return { ok: false, message: 'startYear 和 endYear 必须同时传入' };
  }
  if (startYear !== null && (startYear < 1900 || endYear > 2200 || startYear > endYear)) {
    return { ok: false, message: '年份范围无效' };
  }

  var limit = clampNumber(args.limit, 50, 1, MAX_LIMIT);
  var url = WHO_BASE + '/' + encodeURIComponent(indicator.code)
    + '?$top=' + limit
    + '&$format=json';
  var filter = whoFilter(countries, startYear, endYear, true);
  if (filter) url += '&$filter=' + encodeURIComponent(filter);
  var result = await getJson(url);
  if (!result.ok) return result;

  var rows = envelopeRows(result.data);
  if (!rows.length) {
    var fallbackUrl = WHO_BASE + '/' + encodeURIComponent(indicator.code)
      + '?$top=' + limit + '&$format=json';
    var fallbackFilter = whoFilter(countries, startYear, endYear, false);
    if (fallbackFilter) fallbackUrl += '&$filter=' + encodeURIComponent(fallbackFilter);
    var fallback = await getJson(fallbackUrl);
    if (!fallback.ok) return fallback;
    rows = envelopeRows(fallback.data);
  }
  var normalized = normalizeWhoRows(rows, indicator);
  if (startYear === null && normalized.length) {
    var byCountry = {};
    normalized.forEach(function (row) {
      var key = row.country || '_unknown';
      if (!byCountry[key]) byCountry[key] = [];
      byCountry[key].push(row);
    });
    var recent = clampNumber(args.recent, 1, 1, 20);
    normalized = Object.keys(byCountry).reduce(function (acc, key) {
      return acc.concat(byCountry[key].sort(function (a, b) {
        return (b.year || 0) - (a.year || 0);
      }).slice(0, recent));
    }, []);
  }
  return {
    ok: true,
    source: 'WHO',
    indicator: indicator,
    countries: countries,
    rows: normalized,
    count: normalized.length,
    note: 'WHO 健康统计数据仅供信息参考，不用于个人医疗诊断。'
  };
}

async function faoAgricultureData(args) {
  var domain = args && typeof args.domainCode === 'string' ? args.domainCode.trim().toUpperCase() : '';
  if (!domain) return { ok: false, message: 'domainCode 不能为空' };
  var filters = {
    area: args.area,
    element: args.element,
    item: args.item,
    year: args.year
  };
  var hasFilter = Object.keys(filters).some(function (key) {
    return typeof filters[key] === 'string' && filters[key].trim() !== '';
  });
  if (!hasFilter) {
    return { ok: false, message: 'FAO 查询至少需要一个过滤条件：area、item、element 或 year' };
  }
  var limit = clampNumber(args.limit, 50, 1, MAX_LIMIT);
  var params = {
    show_codes: Boolean(args.showCodes),
    show_unit: true,
    show_flags: false,
    null_values: false,
    output_type: 'objects',
    limit: limit
  };
  Object.keys(filters).forEach(function (key) {
    if (typeof filters[key] === 'string' && filters[key].trim()) params[key] = filters[key].trim();
  });
  var result = await faoGet('/en/data/' + encodeURIComponent(domain) + '/', params);
  if (!result.ok) return result;
  var rows = envelopeRows(result.data).slice(0, limit);
  return {
    ok: true,
    source: 'FAOSTAT',
    domainCode: domain,
    rows: rows,
    count: rows.length,
    note: 'FAOSTAT 数据来自联合国粮农组织官方统计数据库。'
  };
}

var handlers = {
  international_org_catalog: internationalOrgCatalog,
  who_health_data: whoHealthData,
  fao_agriculture_data: faoAgricultureData
};

cindy.onHostMessage(async function (message) {
  if (!message || message.type !== 'tool-call') return;
  var handler = handlers[message.tool];
  if (!handler) {
    cindy.send({
      type: 'tool-result',
      callId: message.callId,
      ok: false,
      message: '未知工具：' + String(message.tool)
    });
    return;
  }
  try {
    var result = await handler(message.args || {});
    if (result.ok) {
      cindy.send({
        type: 'tool-result',
        callId: message.callId,
        ok: true,
        result: result
      });
    } else {
      cindy.send({
        type: 'tool-result',
        callId: message.callId,
        ok: false,
        message: result.message
      });
    }
  } catch (error) {
    cindy.send({
      type: 'tool-result',
      callId: message.callId,
      ok: false,
      message: '国际组织数据查询失败：' + truncateMessage(error && error.message ? error.message : error)
    });
  }
});
