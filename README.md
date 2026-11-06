# Graham Investment Intelligence

A personal investment research platform that analyzes publicly traded stocks with
Benjamin Graham's methodology from **The Intelligent Investor (4th revised edition, 1973)**,
with modern extensions kept clearly separate and always labelled.

- Hebrew (RTL) by default, English one click away (`/he/…`, `/en/…`)
- Dark and light mode, desktop-first, responsive on mobile
- US stocks first, **free-first data: no paid subscription required.** SEC EDGAR filings
  (source of record), Tiingo free (20+ years of official daily prices, dividends, splits,
  last close), optional free Finnhub / Twelve Data intraday quotes, optional FMP *Basic*
  statement cross-check; data model ready for TASE
- **Data freshness engine**: Fresh / Delayed / Last close / Cached / Stale / Unavailable / Conflicted,
  exchange calendars and timezones, 60 s refresh, Refresh Now, daily new-filing check,
  cross-source verification, and an INSUFFICIENT VERIFIED DATA gate.
  See [docs/DATA_PROVIDERS.md](docs/DATA_PROVIDERS.md) for the provider evaluation and setup.
- **No fabricated data.** Missing values are shown as missing. Fictional data only
  exists as explicitly labelled development fixtures.
- **No recommendations.** The decision engine assigns research classifications (BUY CANDIDATE, HOLD, WAIT, REVIEW FOR SALE, AVOID, INSUFFICIENT VERIFIED DATA), never trading instructions.
- **No backtesting.** There is no point-in-time fundamentals dataset, so historical backtests are disabled on purpose (see docs/DEPLOYMENT.md, Known limitations).

## Stack

Next.js 16 (App Router, Cache Components, Turbopack) · React 19 · TypeScript ·
Tailwind CSS 4 · shadcn/ui (vendored, Radix) · Recharts 3 · PostgreSQL 16 ·
Prisma 7 (`@prisma/adapter-pg`) · Zod · Vitest 5

## Quick start

Requirements: Node ≥ 20.19, PostgreSQL 16 (or Docker).

```bash
npm install                      # also runs `prisma generate`
cp .env.example .env             # then edit SEC_USER_AGENT and TIINGO_API_KEY (both free)
docker compose up -d db          # or point DATABASE_URL at your own PostgreSQL
npm run db:deploy                # apply migrations
npm run data:sync-universe       # load US tickers/names/CIKs from SEC (~10k rows)
npm run dev                      # http://localhost:3000 → redirects to /he
```

Then search a ticker (top bar, or press `/`) and press **Refresh data** on its
analysis page, or from the command line:

```bash
npm run data:refresh -- AAPL NYSE:KO
```

### Trying it without API access (fictional data)

```bash
# in .env: ENABLE_DEV_FIXTURES="true"
npm run db:seed:fixtures
```

This loads two fictional companies (`DEVX:FXTR`, `DEVX:PHTX`) that travel through
the real normalization → engines → UI pipeline. Every page that shows them carries a
"Development fixture — not real market data" banner.

## Scripts

| Script | What it does |
| --- | --- |
| `dev` / `build` / `start` | Next.js |
| `test` | Vitest unit tests (engines, normalization, parsers, portfolio) |
| `lint` / `typecheck` | ESLint / TypeScript (`next typegen` first) |
| `db:migrate` / `db:deploy` / `db:studio` | Prisma |
| `data:sync-universe` | SEC security master sync |
| `data:refresh -- TICKER …` | Fetch prices + annual/quarterly statements, cross-check (FMP Basic if set, SEC dividends) |
| `graham:real [-- TICKERS] [--no-refresh] [--out file]` | Graham engine end to end on real companies (needs network) |
| `decision:real [-- TICKERS] [--strategy S] [--no-refresh] [--out-dir dir]` | Decision engine end to end: classification, snapshot, Markdown reports (needs network) |
| `validate:free [-- TICKERS] [--db] [--out file]` | Live validation of the free providers (MSFT, NVDA, GOOGL by default): PASS / FAIL / BLOCKED / SKIPPED |
| `data:check-filings [-- --force]` | Daily check for new 10-K/10-Q filings; refreshes only what changed |
| `acceptance:quote -- TICKER [--url URL]` | Live quote acceptance test (stops at the configuration checkpoint without keys) |
| `test:integration` | Database-backed tests (quote service, filings check, verification) with scripted providers |
| `db:seed:fixtures` | Load fictional dev fixtures (requires `ENABLE_DEV_FIXTURES=true`) |

## Architecture

```
src/
  lib/                      pure, framework-free, unit-tested
    providers/              financial data providers (contracts + adapters)
      sec-edgar/            security master, XBRL companyfacts (annual + quarterly), submissions (new filings)
      fmp/                  latest quotes, statements for verification, EOD fallback
      tiingo/               end-of-day prices, dividends, splits, IEX quotes (US)
      tase/                 Tel Aviv Stock Exchange placeholder (NOT_CONFIGURED)
      dev-fixture/          fictional fixtures, SEC-shaped
      registry.ts           provider selection per market; config status (no secrets)
    normalization/
      concepts.ts           canonical concepts ← ordered XBRL tag candidates
      statements.ts         companyfacts → annual periods (restatements, split adjustment)
      market.ts             price bar validation, ILA→ILS
    graham/                 Graham engine (1973): registry, defensive Ch.14, enterprising Ch.15, net-net — see docs/GRAHAM_ENGINE.md
    valuation/
      graham.ts             Ch.11 formula, Graham number (derived), NCAV, margin of safety
      modern.ts             MODERN_EXTENSION: CPI-adjusted size, 4.4/Y formula, FCF, ROE…
    decision/               explainable decision engine (research classifications) — see docs/DECISION_ENGINE.md
    security/               access control (HTTP Basic when APP_PASSWORD is set)
    portfolio/              position valuation (no price → no value, never cost)
    freshness/              freshness grading, quote status + cache policy (quote.ts), sufficiency gate (gate.ts)
    market/                 exchange calendars (NYSE holidays, early closes), session state, timezones
    verification/           cross-source comparison of statements and quotes
    i18n/, format/          dictionaries (he/en), locale-aware formatting
  server/                   server-only services (Prisma, ingestion, analysis assembly)
  app/[locale]/…            pages (Server Components, streamed with Suspense)
  app/actions.ts            Server Actions (refresh, watchlist, portfolio, settings)
  app/api/search, /health   route handlers
  components/               ui (shadcn), layout, finance (metrics/badges/states), charts
prisma/schema.prisma        data model + migrations
```

Key rules the code enforces:

- **Tri-state criteria.** Every Graham rule returns `PASS`, `FAIL` or
  `INSUFFICIENT_DATA`. A rule fails only when the data proves it (for example, one
  known loss year fails earnings stability even with a short history).
- **Missing ≠ zero.** Unreported long-term debt is inferred as 0 only when total
  liabilities equal current liabilities. Prices in another currency than the
  statements are not mixed.
- **Provenance.** Every price bar, statement and line item records its `DataSource`,
  ingestion run (`DataFetch`), original XBRL tag, accession number and filing date.
  Engine runs are stored as immutable `AnalysisSnapshot`s with their inputs and hash.
- **Secrets stay on the server.** Keys are read in `src/server/env.ts`
  (`server-only`), Tiingo, Finnhub and Twelve Data keys go in headers, and URLs are redacted before being
  stored. The UI only ever sees "configured / not configured".

### Data model (Prisma)

`Exchange`, `Security`, `PriceBar`, `CorporateAction`, `FinancialStatement`,
`FinancialLineItem`, `DataSource`, `DataFetch`, `DataQualityIssue`,
`AnalysisSnapshot`, `Portfolio`, `Position`, `PortfolioTransaction`, `Watchlist`,
`WatchlistItem`, `Alert`, `AppSetting`.

## Methodology notes

| Item | Implementation |
| --- | --- |
| Defensive size | Sales ≥ $100M (industrial) / assets ≥ $50M (utility), **nominal 1973 dollars** |
| Financial condition | CR ≥ 2 and LTD ≤ net current assets; utilities debt ≤ 2× equity |
| Earnings stability | Positive earnings each of the last 10 fiscal years |
| Dividend record | 20 uninterrupted years (a year counts as dividend-free only when covered by stored data) |
| Earnings growth | ≥ +⅓ between 3-yr average EPS at the start and end of a 10-year window |
| Moderate P/E | Price ≤ 15× 3-year average EPS |
| Price to assets | P/B ≤ 1.5, or P/E × P/B ≤ 22.5 |
| Enterprising | CR ≥ 1.5; debt ≤ 110% NCA; no deficit 5 yrs; current dividend; EPS > EPS 5 yrs earlier (configurable); price < 120% net tangible assets |
| Value formula | V = E × (8.5 + 2G), E = 3-yr avg EPS, G defaults to historical EPS growth and can be overridden |
| Modern extensions | CPI-scaled size threshold, V = E × (8.5 + 2G) × 4.4 / Y, FCF yield, ROE, coverage. CPI and AAA yield are **entered by you in Settings** with date and source. |

## Status

Implemented: everything above. See "What remains" in the delivery notes, or the
open items below.

- Decision engine: application-defined research classifications (BUY CANDIDATE, HOLD, WAIT,
  REVIEW FOR SALE, AVOID, INSUFFICIENT VERIFIED DATA), not trading instructions. See docs/DECISION_ENGINE.md.
- Not yet: alerts evaluation (model exists), TASE provider and calendar, IFRS (20-F) filers,
  TTM statements, FX conversion, user accounts (single-user app; protect it with APP_PASSWORD).
- Deployment, monitoring, backups and free-plan usage: docs/DEPLOYMENT.md. Audit: docs/AUDIT_2026-11-06.md.
- Live retrieval runs on a machine with network access (`npm run validate:free -- --db`);
  the cloud build environment blocks the provider hosts. See docs/DATA_PROVIDERS.md.
