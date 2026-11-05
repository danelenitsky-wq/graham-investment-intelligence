# Market data providers — free-first

**The application does not require any paid data subscription.** This document
records the audit of the previous design, the free providers and endpoints now
used, the credentials needed, how freshness and provenance work, and how the
integration is validated. Last revised 2026‑11‑05. Free plans change; check the
linked pages before relying on a limit.

## 1. Audit of the previous implementation (2026‑11‑04 design)

| Area | Before | Problem |
|---|---|---|
| Latest quote | FMP `/stable/quote` primary (Starter or higher declared via `FMP_PLAN`), Tiingo IEX fallback | Real‑time quotes and 60 s refresh assumed **FMP Starter ($19–29/mo)** |
| Daily history | Tiingo EOD; FMP `/historical-price-eod/full`, `/dividend-adjusted`, `/dividends`, `/splits` as fallback | FMP history beyond 5 years needs **Premium** |
| Statement verification | FMP income / balance / cash‑flow, annual (limit 15) **and quarterly** (limit 20) | Quarterly and long history are **paid** on FMP |
| Statements of record | SEC EDGAR companyfacts (annual + quarterly) | Free — kept |
| Filings check | SEC EDGAR submissions, daily | Free — kept |
| Tiingo quote (free plan) | IEX call first, then official close | IEX returns no last sale on the free plan (live test 2026‑11‑05), so every quote cost two of the 50 hourly requests |
| Credentials | `SEC_USER_AGENT`, `TIINGO_API_KEY`, `TIINGO_PLAN`, `FMP_API_KEY`, `FMP_PLAN`, `CRON_SECRET` | `FMP_PLAN` existed only to unlock paid behaviour |
| Statuses | Live, Delayed, Last close, Cached, Stale, Unavailable | No Conflicted status; statements had only freshness levels |
| Provenance | Source, fetch run, XBRL tag, accession, filing date, unit, verification on line items | No per‑figure source URL or retrieval time; dividends had no verification status |

Kept unchanged: provider contracts (`src/lib/providers/types.ts`), the SEC
adapter and normaliser, the market calendar, the cache policy, the
`QuoteSnapshot` / `DataFetch` / `DataVerification` models, the sufficiency gate
and the whole UI.

## 2. Providers now used

| Role | Provider (plan) | Endpoint | Free‑plan limit |
|---|---|---|---|
| Statements of record (annual + quarterly), EPS, shares, dividends declared per share | **SEC EDGAR** (free, public domain) | `data.sec.gov/api/xbrl/companyfacts/CIK##########.json` | ≤ 10 req/s, declared User‑Agent ([fair access](https://www.sec.gov/os/accessing-edgar-data)) |
| New‑filing detection (10‑K, 10‑Q, 20‑F, 40‑F) | **SEC EDGAR** | `data.sec.gov/submissions/CIK##########.json` | same |
| Security master (ticker → CIK, exchange) | **SEC EDGAR** | `www.sec.gov/files/company_tickers_exchange.json` | same |
| Daily prices (20+ years), dividends, splits, adjusted close | **Tiingo** (free) | `api.tiingo.com/tiingo/daily/{ticker}/prices` | 50 req/hour, 1,000/day, 500 symbols/month |
| Quote of record: official last close | **Tiingo** (free) | same endpoint, last 14 days | same |
| Intraday quote (optional) | **Finnhub** (free) | `finnhub.io/api/v1/quote` | 60 calls/min |
| Intraday quote with 52‑week range (optional) | **Twelve Data** (free Basic) | `api.twelvedata.com/quote` | 8 credits/min, 800/day |
| Statement cross‑check (optional) | **FMP** (free **Basic** only) | `/stable/income-statement`, `/balance-sheet-statement`, `/cash-flow-statement`, `period=annual&limit=5` | 250 calls/day |
| 52‑week high / low | Derived from Tiingo official daily bars (labelled *derived*), or Twelve Data's own range when it is the quote source | — | — |
| TASE | Not implemented (NOT_CONFIGURED) | — | — |

Quote order: Finnhub → Twelve Data → Tiingo, using whichever are configured.
The next configured provider cross‑checks the first one. With only the
minimum setup the quote is Tiingo's official last close.

**Why these.** Finnhub's free `/quote` is the only free intraday quote with a
60/min budget; its candles, fundamentals and dividends are premium and are not
used. Twelve Data's free tier is too small for auto refresh but returns a
52‑week range and works as a second opinion. Neither documents real‑time
delivery for every symbol on the free plan, so both are classified as feed
`UNKNOWN`. FMP Basic can still cross‑check about five annual periods; nothing
else is taken from FMP.

## 3. Paid dependencies removed

- FMP latest quotes (`/stable/quote`) and the `FMP_PLAN` switch (no longer read).
- FMP daily history, dividend‑adjusted prices, dividends and splits.
- FMP quarterly statements and the 15‑year annual request (Premium history).
- 60 s auto refresh that assumed FMP Starter. Auto refresh now runs only with
  Finnhub (free, 60/min) or a paid Tiingo plan the user declares.
- Tiingo IEX call on the free plan (it returned no trades and wasted quota).

If FMP answers any request with “not included in your plan” (HTTP 402 or an
`Error Message`), the cross‑check records `NOT_ENTITLED`, pauses for 24 hours,
and nothing else is affected.

## 4. Credentials

| Variable | Needed for | Required? |
|---|---|---|
| `SEC_USER_AGENT` | Statements, filings, security master | **Yes** (free). `"AppName your-name your-email"` |
| `TIINGO_API_KEY` | Daily history, dividends, splits, last close | **Yes** (free) |
| `TIINGO_PLAN` | `free` (default), `power`, `commercial` | Optional. Paid plans enable IEX quotes and auto refresh |
| `FINNHUB_API_KEY` | Intraday quote, auto refresh every 60 s | Optional (free) |
| `TWELVE_DATA_API_KEY` | Intraday quote + 52‑week range, cross‑check | Optional (free) |
| `FMP_API_KEY` | Annual statement cross‑check (Basic) | Optional (free) |
| `CRON_SECRET` | `GET /api/cron/check-filings` | Optional |

Keys are read only in `src/server/env.ts` (`server-only`). Tiingo, Finnhub and
Twelve Data keys travel in request headers; FMP's in a query parameter that is
redacted before anything is stored or logged. The UI and the validation script
only print “set / missing”.

## 5. Status vocabulary

One vocabulary for every dataset (`src/lib/freshness/quote.ts`, `status.ts`):

| Status | Quote | Financial statements |
|---|---|---|
| **FRESH** | Real‑time feed documented for the plan, market open, < 2 min old. *Not reachable with free plans.* | Latest 10‑K/10‑Q loaded, period within the normal cycle |
| **DELAYED** | Market open, feed delayed or not confirmed real‑time (Finnhub, Twelve Data free) | Next annual report overdue (15–24 months since fiscal year end) |
| **LAST_CLOSE** | Official close of the latest session (Tiingo free) | — |
| **CACHED** | Latest provider request failed; last verified value shown | Latest statements request failed; stored filings shown |
| **STALE** | Older than the market state allows | A newer filing exists but is not loaded, or the period is > 24 months old |
| **UNAVAILABLE** | No quote ever retrieved | No statements |
| **CONFLICTED** | Another provider disagrees beyond 0.5 % on the same trading date | An open conflict with the independent source |

A recent API retrieval never makes statements FRESH: they are judged by the
reporting period and by whether a newer filing exists. CONFLICTED, STALE and
UNAVAILABLE all block conclusions (INSUFFICIENT VERIFIED DATA).

**Quote cross‑checks match trading dates.** A delayed intraday quote vouches
for the previous session's close; an end‑of‑day quote for its own close. They
are compared on the latest date both vouch for
(`quoteCloses` / `verifyQuote`), so a Finnhub intraday quote is never compared
with a Tiingo close from another day.

## 6. Provenance of every figure

`GET /api/securities/:id/metrics` (and `getMetricProvenance`) returns every
stored figure with:

| Field | Statements (SEC) | Daily close | Dividends |
|---|---|---|---|
| Provider | `sec-edgar` | `tiingo` | `tiingo` |
| Source document / URL | EDGAR filing index (`FinancialLineItem.sourceUrl`) + XBRL tag | Redacted request URL | Redacted request URL |
| Reporting period | fiscal year, period, start, end (instant for balance sheet) | session date | ex‑date |
| Filing / publication date | `filedAt`, form, accession number | session date | ex‑date |
| Retrieval timestamp | `FinancialLineItem.retrievedAt` (moves on every confirmed refresh) | `DataFetch.completedAt` | `DataFetch.completedAt` |
| Currency, unit | reporting currency; `USD`, `shares`, `USD/shares` | `USD/share` | `USD/share` |
| Verification | VERIFIED / CONFLICT / SINGLE_SOURCE / UNVERIFIED (FMP Basic) | SINGLE_SOURCE | VERIFIED when the fiscal year's payments add up to the SEC “dividends declared per share”, else SINGLE_SOURCE |
| Status | as in §5 | LAST_CLOSE etc. | — |

Coverage per security (fiscal years, quarters, years of prices, dividend
years, and missing required concepts in the last 10 years) is in the same
response. Missing values stay missing; nothing is interpolated.

## 7. Refresh, filings check and rate limits

- **Refresh Now** (`POST /api/quote/:id`) always sends a new provider request
  (2 s spam guard) and lists every request with its `DataFetch` id. It then
  re‑checks EDGAR for a newer 10‑K/10‑Q (at most once per 10 min); a new filing
  reloads statements, re‑verifies and re‑records the dependent calculations.
- **Refresh data** (security page action, `npm run data:refresh`) re‑fetches
  prices and statements. Unchanged payloads are not rewritten and calculations
  are only re‑recorded when their inputs hash changes.
- **Daily filings check**: `npm run data:check-filings`, the cron endpoint, or
  automatically after a page‑open quote request when the last check is > 24 h old.
- **Rate budgets** (`src/lib/providers/rate-limit.ts`): requests beyond a free
  plan's limit are refused locally (`RATE_LIMITED`) before anything is sent:
  Finnhub 55/min, Twelve Data 7/min and 780/day, Tiingo 48/hour and 950/day,
  FMP 240/day, SEC 8/s (plus the existing 120 ms SEC spacing). Budgets are per
  server process.

## 8. Coverage and unsupported metrics

| Requirement | Source | Notes |
|---|---|---|
| Annual income statement, balance sheet, cash flow | SEC | XBRL since ~2009, so 10+ fiscal years for most large filers |
| Quarterly statements | SEC | 10‑Q periods; Q4 is derived only where SEC reports it |
| EPS history, revenue, net income | SEC | |
| Current assets / liabilities, long‑term debt, total liabilities, equity | SEC | `us-gaap:Liabilities` is not tagged by every filer; the gap is shown as missing |
| Shares outstanding | SEC (dei cover page / balance sheet) | |
| Dividend history | Tiingo (per payment, 20+ years) | Cross‑checked with SEC where “dividends declared per share” is tagged |
| Latest price | Tiingo last close; Finnhub / Twelve Data intraday | Intraday is **Delayed** at best |
| Historical prices | Tiingo | 20 years requested by default (`priceHistoryYears`) |
| 52‑week high / low | Derived from Tiingo bars; Twelve Data when it is the quote source | |

Not supported: real‑time (“Fresh”) quotes on free plans, provider market
capitalisation (derived as price × SEC shares and labelled), TASE securities
and IFRS (20‑F) filers, TTM statements, FX conversion.

## 9. Validation

```bash
npm run validate:free                          # MSFT, NVDA, GOOGL — provider level
npm run validate:free -- --db --out validation.json   # + refresh, Refresh Now and provenance through PostgreSQL
```

Each check is **PASS**, **FAIL**, **BLOCKED** (credential missing or host
unreachable, so *not tested*) or **SKIPPED** (optional provider not set). The
script checks actual responses: filing periods and dates, the latest session's
close and its timestamp in New York time, quote age, 20 years of bars,
dividend years, the 52‑week range, cross‑provider agreement on the same
trading date, that Refresh Now creates new `DataFetch` rows, and that every
stored figure carries all provenance fields. Exit code 0 = all pass, 1 = a
failure, 2 = something was blocked.

The cloud build environment blocks the provider hosts (proxy 403), so live
validation runs on the user's machine. Results of the latest run are in the
pull request description.
