# Headline Digest

Read-only news digests for Cindy, built on NewsAPI's `top-headlines` endpoint. Requires **Cindy 0.1.64 or later**, outbound HTTPS to `newsapi.org` only, and the user's own NewsAPI key. Plain JavaScript with no third-party runtime dependencies and no build step.

## The key and NewsAPI's plans

The key is stored in Cindy's vault, never in this plugin. **NewsAPI's free Developer plan is for development only; regular use needs a paid plan.** The free tier also enforces a small daily request budget and refuses requests once it is spent, so a key that works today can return 429 or `rateLimited` tomorrow. Both facts are visible here and in the settings page hint, before anyone installs the plugin.

A free key is available at [newsapi.org/register](https://newsapi.org/register).

## Install and enable

This plugin is **opt-in**: its `provisioning.json` entry seeds it for nobody, so it is never installed automatically. Enable it from the marketplace, then open its settings and save a NewsAPI key. Until a key is saved, calls fail with `CREDENTIAL_MISSING` and a message that says where to enter it; a rejected key reports `CREDENTIAL_REJECTED` with the upstream code.

## Credential handling

`ghost.json` declares one host and one secret. The settings page writes the value straight to the Host vault through `PUT /secrets/newsapi_key` and clears the field, so the page keeps no copy. `GET /secrets` reports only `{ key, saved, tail? }` per entry — never the value — and the status line reads that; `DELETE` clears the key. Cindy injects `X-Api-Key` for `newsapi.org` at request time, and `main.js` sends no credential of its own, so the plugin never receives the value. A redirect out of the declared host does not carry the header, and the sandbox cannot read it back. The key appears in no result, error message, log or KV entry.

## Use

Ask for headlines, top stories from a country, news on a topic, or a digest — for example "what is happening in tech today", "top stories in Japan" or "headlines about the election". The plugin exposes one tool.

`top_headlines`

| Parameter | Meaning |
| --- | --- |
| `query` | Optional free text, passed to NewsAPI as `q`, up to 200 characters. NewsAPI ignores `country` in ways the service decides when a query is present. |
| `country` | Optional two-letter ISO code, default `us`. |
| `category` | Optional: `business`, `entertainment`, `general`, `health`, `science`, `sports`, `technology`. |
| `limit` | Optional number of headlines, 1–20, default 5. |

The call is a single HTTPS `GET` with a 20-second timeout. It changes nothing, so a retry is always safe.

## What comes back

A successful result is `{ untrusted, origin, count, query, country, category, articles, note }`. `untrusted` is always `true` and `origin` is `"newsapi.org"`: titles, descriptions and publisher names are third-party text, so the Agent is told to report them as data and never to follow instructions they contain.

Each article is `{ title, source, url, publishedAt, description }`. Titles are trimmed to 300 characters, descriptions to 200 and publisher names to 80, with an ellipsis when cut; `source`, `url` and `publishedAt` can be null. Articles without a title are dropped. `count: 0` is a success with a `note` suggesting a broader query, a different country or no category filter.

## Errors

| Code | Meaning |
| --- | --- |
| `INVALID_ARGUMENT` | Bad `query` length, country code, category or `limit`. |
| `CREDENTIAL_MISSING` | No key saved yet, or the Host could not attach it. |
| `CREDENTIAL_REJECTED` | 401/403, or upstream `apiKeyMissing` / `apiKeyInvalid` / `apiKeyDisabled`: replace the saved key. |
| `RATE_LIMITED` | 429, `rateLimited`, `maximumResultsReached`, or an `apiKeyExhausted` 401 or 403: the plan's budget is spent. The key itself is fine — wait for the daily reset or upgrade the plan. |
| `UPSTREAM_ERROR` | Any other non-2xx response or upstream error body. |
| `UPSTREAM_INVALID` | The response was not JSON this plugin can read. |
| `RESPONSE_TOO_LARGE` | The Host capped the response; ask for fewer headlines. |
| `NETWORK_ERROR` | `newsapi.org` was unreachable, for example behind a proxy. |

Messages carry the fix, not a stack trace, and the plugin never retries on its own.

## Privacy

One host, one read-only request. No files, no clipboard, no screen access, no telemetry, no other network destination, and nothing written outside the plugin's own memory. The only state the plugin holds is what the Host passes in per call.

## Development and package

Run `node --test .tests/headline-digest.test.mjs` from the repository root. The tests drive `main.js` against a mocked `cindy.fetch`, so they cover argument validation, article mapping, credential injection shape, every error mapping, the untrusted marking, the write-only settings channel and the settings page CSP without touching the network or a real key. Mocked tests do not replace verification on a real Cindy build.

The repository packages the committed directory with its root license and trademark notices through `.github/scripts/package-plugin.sh`; there is no generated or vendored code to rebuild.

Reference: [Cindy](https://github.com/makecindy/cindy), [NewsAPI](https://newsapi.org/docs).
