/**
 * Headline Digest — Cindy plugin (Manifest v3) exercising the Host-managed
 * credential path.
 *
 * Credential model (authoring reference §4.7): the plugin declares
 *   network.hosts            → which hosts it may reach
 *   network.secrets[].inject → which header the Host adds, on which hosts
 * and never receives the value. `cindy.fetch` below sends NO credential: the
 * Host injects the declared header for newsapi.org. A redirect out of the declared
 * host does not carry the credential, and the sandbox cannot read it back.
 *
 * Tool contract:
 *   Host   → { type: 'tool-call', tool, args, callId }
 *   Plugin → { type: 'tool-result', callId, ok: true, result }
 *          | { type: 'tool-result', callId, ok: false, errorCode, message }
 */

/* global cindy */

var ENDPOINT = 'https://newsapi.org/v2/top-headlines';
var CATEGORIES = {
  business: true,
  entertainment: true,
  general: true,
  health: true,
  science: true,
  sports: true,
  technology: true
};
var DEFAULT_LIMIT = 5;
var MAX_LIMIT = 20;
var MAX_QUERY_LENGTH = 200;
var MAX_DESCRIPTION = 200;

function succeed(callId, result) {
  return cindy.send({ type: 'tool-result', callId: callId, ok: true, result: result });
}

function fail(callId, errorCode, message) {
  return cindy.send({
    type: 'tool-result',
    callId: callId,
    ok: false,
    errorCode: errorCode,
    message: message
  });
}

function trim(value, limit) {
  var text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
}

/** Validate and normalise arguments; returns { error } or { params }. */
function readArgs(args) {
  var query = typeof args.query === 'string' ? args.query.trim() : '';
  if (query.length > MAX_QUERY_LENGTH) {
    return {
      error: [
        'INVALID_ARGUMENT',
        'The `query` is limited to ' + MAX_QUERY_LENGTH + ' characters. Shorten it to the two or three words that identify the topic.'
      ]
    };
  }

  var country = 'us';
  if (args.country !== undefined && args.country !== null && args.country !== '') {
    if (typeof args.country !== 'string' || !/^[a-zA-Z]{2}$/.test(args.country)) {
      return {
        error: [
          'INVALID_ARGUMENT',
          '`country` must be a two-letter ISO code such as us, gb, jp or de — or omit it.'
        ]
      };
    }
    country = args.country.toLowerCase();
  }

  var category = null;
  if (args.category !== undefined && args.category !== null && args.category !== '') {
    if (typeof args.category !== 'string' || !CATEGORIES[args.category.toLowerCase()]) {
      return {
        error: [
          'INVALID_ARGUMENT',
          '`category` must be one of business, entertainment, general, health, science, sports, technology — or omitted.'
        ]
      };
    }
    category = args.category.toLowerCase();
  }

  var limit = DEFAULT_LIMIT;
  if (args.limit !== undefined && args.limit !== null) {
    if (typeof args.limit !== 'number' || !isFinite(args.limit) || Math.floor(args.limit) !== args.limit) {
      return { error: ['INVALID_ARGUMENT', '`limit` must be a whole number between 1 and ' + MAX_LIMIT + '.'] };
    }
    if (args.limit < 1 || args.limit > MAX_LIMIT) {
      return { error: ['INVALID_ARGUMENT', '`limit` must be between 1 and ' + MAX_LIMIT + '.'] };
    }
    limit = args.limit;
  }

  return { params: { query: query, country: country, category: category, limit: limit } };
}

function buildUrl(params) {
  var parts = ['pageSize=' + params.limit];
  if (params.query) parts.push('q=' + encodeURIComponent(params.query));
  if (params.country) parts.push('country=' + encodeURIComponent(params.country));
  if (params.category) parts.push('category=' + encodeURIComponent(params.category));
  return ENDPOINT + '?' + parts.join('&');
}

function upstreamCode(body) {
  try {
    var parsed = JSON.parse(body);
    return parsed && typeof parsed.code === 'string' ? parsed.code : '';
  } catch (error) {
    return '';
  }
}

/**
 * `apiKeyExhausted` is not a bad key: the key is valid and its plan budget is
 * spent. NewsAPI answers it with HTTP 401, so it has to be recognized before
 * the generic "replace the key" reply — otherwise the user is told to replace a
 * key that works and the real fix (wait or upgrade) is never mentioned.
 */
function planLimitMessage(upstreamMessage, code) {
  return 'NewsAPI accepted the saved key but its request budget is spent' +
    (code ? ' (' + code + ')' : '') +
    (upstreamMessage ? ': ' + upstreamMessage : '.') +
    ' The free Developer plan is for development only and allows a small number of requests per day, then refuses until the daily reset. Wait for the reset or upgrade the plan at newsapi.org/pricing — replacing the key will not help.';
}

function mapArticles(articles) {
  if (!Array.isArray(articles)) return [];
  var mapped = [];
  for (var i = 0; i < articles.length; i += 1) {
    var article = articles[i] || {};
    var title = trim(article.title, 300);
    if (!title) continue;
    mapped.push({
      title: title,
      source: article.source && article.source.name ? trim(article.source.name, 80) : null,
      url: typeof article.url === 'string' ? article.url : null,
      publishedAt: typeof article.publishedAt === 'string' ? article.publishedAt : null,
      description: trim(article.description, MAX_DESCRIPTION)
    });
  }
  return mapped;
}

async function handleTopHeadlines(callId, args) {
  var parsed = readArgs(args);
  if (parsed.error) return fail(callId, parsed.error[0], parsed.error[1]);

  var params = parsed.params;
  var url = buildUrl(params);

  var response;
  try {
    // No credential here on purpose: the Host injects the declared header.
    response = await cindy.fetch({
      url: url,
      method: 'GET',
      headers: { Accept: 'application/json' },
      as: 'text',
      timeoutMs: 20000,
      callId: callId
    });
  } catch (error) {
    // Read-only request: retrying cannot duplicate a write.
    return fail(
      callId,
      'NETWORK_ERROR',
      'Could not reach newsapi.org from Cindy. Check the network or proxy settings and try again; this request only reads headlines, so a retry is safe.'
    );
  }

  if (!response || response.ok === false) {
    // Host-level failure — usually "credential not configured yet". Its message
    // already tells the user where to enter it, so pass it through.
    return fail(
      callId,
      'CREDENTIAL_MISSING',
      (response && response.message) ||
        'Cindy could not complete the NewsAPI request. Open this plugin\'s settings and add your NewsAPI key, then try again.'
    );
  }

  var status = typeof response.status === 'number' ? response.status : 0;

  if (status === 401 || status === 403) {
    var code = upstreamCode(response.body);
    // Spent daily budget arrives as a 401 with code "apiKeyExhausted".
    if (code === 'apiKeyExhausted') {
      return fail(callId, 'RATE_LIMITED', planLimitMessage('', code));
    }
    return fail(
      callId,
      'CREDENTIAL_REJECTED',
      'NewsAPI rejected the saved key' + (code ? ' (' + code + ')' : '') +
        '. Replace it in this plugin\'s settings — Headline Digest → NewsAPI key. Keys are free at newsapi.org/register, and the plugin cannot read the stored value to fix it for you.'
    );
  }

  if (status === 429) {
    return fail(
      callId,
      'RATE_LIMITED',
      'NewsAPI rate limit reached for this key. Wait before asking for more headlines; the free tier allows a limited number of requests per day and resets on its own.'
    );
  }

  if (status < 200 || status >= 300) {
    return fail(
      callId,
      'UPSTREAM_ERROR',
      'NewsAPI returned HTTP ' + status + '. Try a narrower `query`, fewer results, or retry later; if it persists, check NewsAPI service status.'
    );
  }

  if (response.truncated) {
    return fail(
      callId,
      'RESPONSE_TOO_LARGE',
      'NewsAPI returned more data than this plugin accepts. Ask for fewer headlines (lower `limit`) or a narrower `query`.'
    );
  }

  var payload;
  try {
    payload = JSON.parse(response.body);
  } catch (error) {
    return fail(
      callId,
      'UPSTREAM_INVALID',
      'NewsAPI returned a response this plugin could not parse. Nothing was changed; retry once, and if it repeats the service may be degraded.'
    );
  }

  if (payload && payload.status === 'error') {
    var errorCode = typeof payload.code === 'string' ? payload.code : '';
    var upstreamMessage = trim(payload.message, 240);
    if (errorCode === 'apiKeyExhausted') {
      return fail(callId, 'RATE_LIMITED', planLimitMessage(upstreamMessage, errorCode));
    }
    if (errorCode === 'apiKeyMissing' || errorCode === 'apiKeyInvalid' || errorCode === 'apiKeyDisabled') {
      return fail(
        callId,
        'CREDENTIAL_REJECTED',
        'NewsAPI rejected the saved key' + (errorCode ? ' (' + errorCode + ')' : '') +
          '. Replace it in this plugin\'s settings — Headline Digest → NewsAPI key.' +
          (upstreamMessage ? ' NewsAPI said: ' + upstreamMessage : '')
      );
    }
    if (errorCode === 'rateLimited' || errorCode === 'maximumResultsReached') {
      return fail(
        callId,
        'RATE_LIMITED',
        'NewsAPI refused the request because of plan limits' + (upstreamMessage ? ': ' + upstreamMessage : '.') +
          ' Ask for fewer headlines or try later.'
      );
    }
    return fail(
      callId,
      'UPSTREAM_ERROR',
      'NewsAPI returned an error' + (errorCode ? ' (' + errorCode + ')' : '') + '.' +
        (upstreamMessage ? ' It said: ' + upstreamMessage : '') +
        ' Adjust the request or retry later.'
    );
  }

  var articles = mapArticles(payload && payload.articles);
  return succeed(callId, {
    untrusted: true,
    origin: 'newsapi.org',
    count: articles.length,
    query: params.query || null,
    country: params.country,
    category: params.category,
    articles: articles,
    note: articles.length
      ? null
      : 'NewsAPI returned no matching articles. Try a broader query, a different country, or drop the category filter.'
  });
}

cindy.onHostMessage(async function (message) {
  if (!message || message.type !== 'tool-call') return;

  var callId = message.callId;
  if (typeof callId !== 'string' || callId === '') return;

  try {
    if (message.tool === 'top_headlines') {
      return await handleTopHeadlines(callId, message.args || {});
    }
    return fail(
      callId,
      'UNKNOWN_TOOL',
      'This plugin version exposes only top_headlines. Update the plugin, or call top_headlines.'
    );
  } catch (error) {
    return fail(
      callId,
      'INTERNAL_ERROR',
      'Headline Digest stopped before finishing. Nothing was changed. Retry once; if it fails again, report the plugin version (1.0.1).'
    );
  }
});
