# Market data providers, freshness engine and configuration checkpoint

This document records the provider evaluation, the design that was implemented,
the exact credentials needed, and the acceptance test. It was written on
2026‑11‑04. Provider plans and prices change, so check the linked pages before
you subscribe.

## 1. Provider evaluation

Sources consulted: the FMP pricing page, the Twelve Data pricing page, the
Tiingo IEX product page, SEC EDGAR API documentation, the TASE DataHub SDK page,
and third‑party summaries of Finnhub's and EODHD's pricing. Finnhub's own
pricing page and FMP's endpoint reference render client‑side and could not be
read from this environment. Cells marked *unverified* come from those
summaries or from earlier knowledge, not from an official page read today.

| | **Financial Modeling Prep** | **Finnhub** | **Twelve Data** | **SEC EDGAR** | **Tiingo** | **EODHD** |
|---|---|---|---|---|---|---|
| Latest quote | `/stable/quote` (price, change, market cap, 52‑w range, unix timestamp) | `/quote` (c, d, dp, h, l, o, pc, t) | `/quote`, `/price` | — (no prices) | IEX last sale and top of book (`/iex`) | Live (delayed) endpoint |
| Real‑time vs delayed | Basic: end of day only. Starter and above: real‑time | Free: "real‑time US quotes" (*unverified*) | US real‑time from Basic; other markets EOD on Grow, real‑time EU on Pro | — | Real‑time, but **IEX venue only** (~2–3 % of US volume) | 15‑min delayed on paid plans; real‑time on higher tiers |
| 10+ yrs statements | Starter: US statements. Premium: US/UK/CA and 30+ yrs of history. Ultimate: global | Standardized and as‑reported financials on All‑in‑One ($50/mo, *unverified*) | Fundamentals from Grow; depth not stated | **Yes**, primary filings, XBRL from ~2009 (10‑K, 10‑Q, 20‑F) | Fundamentals add‑on (not used) | Fundamentals plan, 30+ yrs (*unverified*) |
| 20+ yrs dividends | Premium (30+ yrs); Starter is limited to 5 yrs of history | Premium | Not stated | Only per‑share dividends tagged in filings | **Yes**, in daily history (30+ yrs) | Yes |
| Historical prices | EOD full and dividend‑adjusted | Yes | Yes | — | **Yes**, 30+ yrs EOD with adjClose | Yes |
| Split adjustment | `/splits` and adjusted series | Yes | Yes | — | `splitFactor` per day and `adjClose` | Yes |
| Pricing and rate limits | Free 250/day. Starter $19/mo annual ($29 monthly), 300/min. Premium $49 ($69), 750/min. Ultimate $99 ($139), 3,000/min | Free 60/min. All‑in‑One $50/mo, 300/min (*unverified*) | Basic free 8/min (800/day). Grow $29+ (55/min). Pro $99+ (610/min) | Free; ≤ 10 req/s; declared User‑Agent required | Free: 50 req/h and 1,000/day (IEX). Power $30/mo: 10k/h | $19.99–$99.99/mo, 100k/day, 1,000/min (*unverified*) |
| TASE coverage | Ultimate "full global coverage" (`.TA` symbols, *unverified*) | International on paid plans (*unverified*) | Not stated on the pricing page | No | No | Tel Aviv exchange listed (`TA`, *unverified*) |
| Licence | Personal and commercial tabs; display or redistribution needs a separate agreement | Personal or commercial | Individual or business | Public domain | Free, Power and Commercial plans are for internal use only | Personal |

**Official TASE source:** TASE DataHub (<https://www.tase.co.il/en/content/products_lobby/datahub>)
has free endpoints (securities basic, indices, funds) and paid market data
products. Israeli issuers' IFRS statements come from MAYA/MAGNA, not XBRL.

## 2. Decision

| Role | Provider | Why |
|---|---|---|
| **Financial statements (source of record)** | **SEC EDGAR** companyfacts (annual and quarterly) | Primary filings, free, with accession numbers, filing dates, restatements and split adjustment |
| **New‑filing detection** | **SEC EDGAR** submissions index | Lists every 10‑K and 10‑Q with acceptance time; checked daily |
| **Latest quote (primary)** | **Financial Modeling Prep** | One call returns price, provider timestamp, change, market cap, 52‑week range and exchange. Starter and above document real‑time US quotes |
| **Quote fallback and cross‑check** | **Tiingo IEX** | Independent real‑time IEX last sale. Always labelled "IEX venue only" |
| **Daily history, dividends and splits** | **Tiingo EOD** (FMP as fallback) | 30+ years of daily bars on the free plan, with `divCash`, `splitFactor` and `adjClose` |
| **Statement verification** | **FMP** income, balance and cash‑flow statements | Independent of SEC parsing. Material figures are compared and conflicts flagged |
| **TASE** | Not implemented (NOT_CONFIGURED) | No evaluated provider offers both TASE prices and IFRS statements. Candidates: TASE DataHub (official) or EODHD (`TA`) for prices, MAYA for statements |

Finnhub and Twelve Data were not chosen. Twelve Data's free tier (8/min) cannot
sustain 60‑second refresh, and its fundamentals history and TASE coverage are
not documented on its pricing page. Finnhub's financials need the $50/mo plan,
which costs as much as FMP Premium while giving fewer fields per quote call.
Both fit the same `QuoteProvider` contract, so either can be added later.

## 3. What you need to configure

Nothing is filled in by default, and nothing falls back to demo data. Without
keys the UI shows **Unavailable** or **INSUFFICIENT VERIFIED DATA**.

| Variable | Required for | Where to get it |
|---|---|---|
| `SEC_USER_AGENT` | Statements, filings, security master | Free. Set to `"AppName your-name your-email"`, as the [SEC fair‑access policy](https://www.sec.gov/os/accessing-edgar-data) requires |
| `FMP_API_KEY` | Latest quotes, statement verification | <https://site.financialmodelingprep.com/developer/docs/dashboard>. **Starter or higher** for real‑time quotes and 60‑second refresh. **Premium** for 30+ years of history |
| `FMP_PLAN` | Declares your FMP plan: `basic`, `starter`, `premium`, `ultimate` or `enterprise` | Only `starter` and above are treated as real‑time. `basic` quotes are never labelled Live |
| `TIINGO_API_KEY` | Daily history, dividends, splits, IEX fallback quotes | <https://www.tiingo.com/account/api/token> (free) |
| `TIINGO_PLAN` | `free`, `power` or `commercial` | The free plan's 50 requests/hour cannot sustain 60‑second polling, so auto refresh with Tiingo needs `power` |
| `CRON_SECRET` | `GET /api/cron/check-filings` | Any random string of 16+ characters |

Minimum useful setup: `SEC_USER_AGENT` + `TIINGO_API_KEY` (free). This gives
Last Close quotes and full fundamentals. Add `FMP_API_KEY` with
`FMP_PLAN=starter` for live quotes, 60‑second refresh and statement
verification.

Keys live only in server environment variables (`src/server/env.ts` is
`server-only`). They are sent in headers where the provider supports it, and
redacted from every stored or logged URL.

## 4. How freshness works

- **Page open** fetches the latest quote on the server (`getQuoteView`), subject to the cache.
- **Cache policy** (`src/lib/freshness/quote.ts › decideQuoteFetch`): 55 s TTL while open, 30 min while closed. Cache is invalidated when the session changes (open→closed, new trading day). After a failure it backs off for 30 s.
- **Auto refresh**: the client polls `GET /api/quote/:id` every 60 s, only when the primary provider's plan supports it and the market is not closed. When closed, it wakes at the next open.
- **Refresh Now**: `POST /api/quote/:id` always makes a new provider request (2 s spam guard). The response lists every request made (`attempts[]` with the `DataFetch` id).
- **Status** (`classifyQuote`): Live, Delayed, Last close, Cached, Stale, Unavailable. **Live** requires a provider‑documented real‑time feed, an open market, and a quote under 2 minutes old.
- **Market calendar** (`src/lib/market/calendar.ts`): NYSE/Nasdaq holidays, including Good Friday, observed‑day rules, early closes and special closures. All timestamps are shown in the exchange's timezone. The TASE calendar is not modelled, so its state is UNKNOWN and its quotes are never Live or Last close.
- **Outages**: every successful quote is stored (`QuoteSnapshot`). When providers fail, the last verified value is shown as **Cached**, then **Stale**.
- **Daily filings check**: `npm run data:check-filings`, or the cron endpoint, or automatically after a quote request when the last check is over 24 h old. A newer 10‑K or 10‑Q than any stored one triggers a statements refresh, verification and recalculation. Analysis snapshots are only re‑recorded when their inputs hash changes.
- **Sufficiency gate** (`src/lib/freshness/gate.ts`): stale or unavailable price, missing required concepts, stale statements, a newer unloaded filing, unresolved conflicts, or development fixtures all mean **INSUFFICIENT VERIFIED DATA**. Graham screens, margins of safety and the screening "meets all" filter are then withheld.

Every stored figure carries: provider (`DataSource`), filing reference
(accession number and EDGAR URL), source timestamp (filing date / quote time),
retrieval timestamp (`DataFetch.completedAt`), fiscal year and period, currency
and unit, and `verificationStatus`.

## 5. Acceptance test and configuration checkpoint

```bash
npm run acceptance:quote -- AAPL                              # through the server module
npm run acceptance:quote -- AAPL --url http://localhost:3000  # through the HTTP API
```

The script queries the ticker, prints the provider's source timestamp in exchange
time and UTC, then presses Refresh Now. It passes only if a **new provider
request** was recorded (new `DataFetch` row, new fetch id) and the provider
returned a quote with a source timestamp.

**Status on 2026‑11‑04: stopped at the configuration checkpoint.** The build
environment had no API credentials. Its network policy also blocked
`financialmodelingprep.com`, `api.tiingo.com`, `data.sec.gov`, `finnhub.io` and
`api.twelvedata.com` (proxy 403). So **live retrieval has not been tested**.
The script exits with code 2 and prints:

```
CONFIGURATION CHECKPOINT — no quote provider is configured, so live retrieval was NOT tested.
  Financial Modeling Prep: missing FMP_API_KEY
  Tiingo (end-of-day prices, IEX quotes): missing TIINGO_API_KEY
```

The same flow was tested against PostgreSQL with scripted providers
(`npm run test:integration`): page‑open fetch, cache hit, Refresh Now making a
new request, fallback, preserved last value on outage, conflict recording, the
daily filings check, and change detection. The FMP field mapping follows FMP's
stable API but has **not** been checked against a live FMP response. Run the
acceptance script once you add a key.
