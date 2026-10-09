# Tongcheng Chengxin — Cindy Plugin

Tongcheng Chengxin (同程程心) gives Cindy one-stop travel search backed by the Tongcheng Travel official gateway: flights, trains, hotels, attractions, bus tickets, vacation packages and multimodal transport options.

> 中文说明见 [README.zh-CN.md](README.zh-CN.md)。

## Install & Configure

1. Drag the downloaded `.cindy` package into Cindy and approve the requested permissions.
2. Open the Tongcheng Travel app or its WeChat mini program, sign in, search for 「程心激活码」 (Chengxin activation code) and claim one.
3. In Cindy, open **Plugins → Tongcheng Chengxin → Settings**, paste the activation code and click **Save Key**.

The settings page links to the [Tongcheng website](https://www.ly.com/) and [official customer service](https://www.ly.com/public/newhelp/CustomerService.html). Activation codes must be claimed inside the app or mini program; the website is not a direct claim page.

Each user supplies their own API key. The credential is stored securely by Cindy and is never distributed with the package.

## Usage

After saving your API key in the plugin settings, just ask Cindy in natural language, e.g. "Use Tongcheng Chengxin to find trains from Shanghai to Beijing on 15 November 2026, only trains departing that day."

Tool selection guidance for the agent:

- `flight_search` / `train_search` / `hotel_search` / `scenery_search` — dedicated lookups.
- `travel_search` — vacation packages and multi-day itinerary planning (preferred over splitting into single-item requests).
- `traffic_search` — when the travel mode is not specified.

A query succeeds only when real gateway data comes back. Always double-check the returned dates and stations; seat availability shown as `*` must not be read as "tickets available". Prices and booking status are authoritative only on Tongcheng or 12306 pages.

## Reliability Notes

- The gateway is pinned to `https://wx.17u.cn/skills/gateway/api/v1/gateway` (HTTPS only, POST JSON, `version: 1.0.0`, camelCase params).
- When the request carries a `date`, the worker verifies that returned resource dates match the requested date. If the gateway ignores the date and returns another day, the worker retries once and otherwise reports a `date_mismatch` warning instead of silently showing the wrong day.
- Offline tests (`npm test`) do not exercise real accounts, network or booking links; real calls require a valid user API key.

## Development

- `npm run check` — syntax and hygiene checks.
- `npm test` — offline unit tests (node:test).
- `npm run build` — check + tests + package member check.
- Package with Cindy's `ghost_forge_pack` from this directory to produce the `.cindy` artifact.
