# Deployment and operations

This is a single-user research application. It runs on any machine with
Node ≥ 20.19 and PostgreSQL 16. No paid service is required.

## 1. Environment

Copy `.env.example` to `.env` and fill in:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string. Use a dedicated role that owns only this database. |
| `SEC_USER_AGENT` | yes | `"AppName your-name your-email"` (SEC fair-access policy). |
| `TIINGO_API_KEY` | yes | Free plan. Daily prices, dividends, splits, official last close. |
| `TIINGO_PLAN` | no | `free` (default). Only set `power`/`commercial` if you pay Tiingo. |
| `FINNHUB_API_KEY` | no | Free plan. Intraday (delayed) quote; enables the 60 s auto refresh. |
| `TWELVE_DATA_API_KEY` | no | Free Basic plan. Second quote source with 52-week range. |
| `FMP_API_KEY` | no | Free Basic plan only. Annual statement cross-check (about 5 years). |
| `APP_PASSWORD` | **yes in production** | HTTP Basic password for every page and API route. 16+ random characters. |
| `APP_USERNAME` | no | Defaults to `graham`. |
| `APP_AUTH_DISABLED` | no | `true` only on a machine that listens on localhost. |
| `CRON_SECRET` | for scheduled jobs | 16+ random characters. Enables `GET /api/cron/check-filings`. |
| `ENABLE_DEV_FIXTURES` | no | Keep `false` in production. |

Secrets are read only in server code (`src/server/env.ts`, `server-only`).
Nothing in `NEXT_PUBLIC_*` is used. Never commit `.env`.

`npm start` (NODE_ENV=production) answers **503** until `APP_PASSWORD` is set
or `APP_AUTH_DISABLED=true` is set explicitly. Always put HTTPS in front of
the app (Caddy, nginx, a platform's TLS) because Basic credentials are only
base64-encoded.

## 2. Database and migrations

```bash
npm ci                          # also runs prisma generate
npm run db:deploy               # prisma migrate deploy: applies pending migrations, never resets data
npm run data:sync-universe      # SEC ticker/CIK master (~10k rows), re-run monthly
```

- Use `db:deploy` in every non-development environment. `db:migrate`
  (`prisma migrate dev`) is for creating migrations locally and may ask to
  reset the database.
- Take a backup before applying a migration (section 6).
- Migrations live in `prisma/migrations`. The PR #7 branch adds one more
  (FxRate, ImportBatch, AlertEvent, AlertRun); apply it with the same command
  after merging.
- The local `docker-compose.yml` binds PostgreSQL to 127.0.0.1 only. Do not
  publish port 5432 on a server; change the default `graham_dev_pw` password
  for anything beyond local development.

## 3. Build and run

```bash
npm run build
npm start                       # port 3000; set PORT to change
```

Health probe: `GET /api/health` returns `{"status":"ok","database":"up"}` or
HTTP 503. It is the only unauthenticated route besides the cron endpoint.

Any Node host works (a small VPS, a home server, Railway/Render/Fly with a
managed PostgreSQL). The provider budgets in `src/lib/providers/rate-limit.ts`
are **per process**: run a single instance, or the free limits can be
exceeded by the sum of instances.

## 4. Background jobs

| Job | Command / endpoint | Schedule | Provider cost |
|---|---|---|---|
| New 10-K/10-Q check | `npm run data:check-filings` or `GET /api/cron/check-filings` with `Authorization: Bearer $CRON_SECRET` | daily, e.g. 06:30 America/New_York | 1 SEC request per followed security, plus a statements reload when a new filing exists |
| Price + statement refresh | `npm run data:refresh -- TICKER …` | weekly, or after earnings | 1 Tiingo + 1–2 SEC requests per ticker |
| Security master | `npm run data:sync-universe` | monthly | 1 SEC request |
| (PR #7) FX rate, alerts | `npm run fx:refresh`, `npm run alerts:check` or `GET /api/cron/check-alerts` | daily after 17:00 Asia/Jerusalem (BOI publishes ~15:45) | 1 BOI request; up to 40 provider calls per alert run |

Example crontab on the app host:

```cron
30 11 * * 1-5  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://your-host/api/cron/check-filings > /dev/null
0  12 * * 6    cd /srv/graham && npm run data:refresh -- MSFT NVDA GOOGL >> /var/log/graham-refresh.log 2>&1
```

Page opens also trigger the filings check when the last one is older than
24 hours, so a missed cron run is caught on the next visit.

## 5. Monitoring and logging

- Every provider request is a `DataFetch` row (endpoint with secrets removed,
  HTTP status, record count, payload hash, error). The **Data health** page
  shows the latest of each per security; query failures with
  `SELECT * FROM "DataFetch" WHERE status = 'FAILED' ORDER BY "startedAt" DESC LIMIT 50;`
- Quote retrievals are append-only `QuoteSnapshot` rows (source timestamp,
  retrieval time, feed, verification).
- Data problems are `DataQualityIssue` rows; open conflicts are
  `DataVerification` rows with `status = 'CONFLICT' AND "resolvedAt" IS NULL`.
- Server logs go to stdout/stderr (`console.error` with a `[area]` prefix).
  Keep them with your process manager (systemd journal, Docker logs, platform
  log drain).
- Point an uptime monitor at `/api/health`. Alert when it returns 503 or when
  no `DataFetch` for `filings-check` succeeded in 26 hours.

## 6. Backups

- Nightly logical backup, kept 14 days, plus a weekly copy off the host:
  `pg_dump --format=custom --no-owner "$DATABASE_URL" > graham-$(date +%F).dump`
- Restore test once a month into a scratch database:
  `pg_restore --clean --no-owner -d "$SCRATCH_URL" graham-YYYY-MM-DD.dump`
- What matters most: `Position`, `PortfolioTransaction`, `Watchlist*`,
  `AppSetting`, `AnalysisSnapshot` (your history; it cannot be refetched).
  Market data and statements can be reloaded from the providers.
- Back up `.env` separately (a password manager), not with the dump.

## 7. Free API usage estimates

Assumptions: 25 followed securities, page views on weekdays, Finnhub
configured, Twelve Data not configured.

| Provider | Free limit | Typical daily use | Headroom |
|---|---|---|---|
| SEC EDGAR | 10 req/s (app caps at 8/s) | ~25 filings checks + a few statement reloads | very large |
| Tiingo | 50/hour, 1,000/day, 500 symbols/month | ~25 history refreshes a week, 1 quote cross-check per open security every 15 min | fine for ~10 securities open at once; the app refuses locally above 48/hour |
| Finnhub | 60/min | 1 call per open security page per minute while the market is open | about 50 pages open at once |
| Twelve Data | 8/min, 800/day | on demand only (never auto-polled) | — |
| FMP Basic | 250/day | 3 calls per refresh (5 annual periods) | ~80 refreshes/day |
| Bank of Israel (PR #7) | public | 1/day | — |

Monthly recurring cost with these providers: **$0**. Hosting is the only
cost: $0 on your own computer, roughly $5–7 a month for a small VPS, or a
free/low tier of a managed platform plus PostgreSQL.

## 8. Known limitations

- **No backtesting.** The app has no point-in-time fundamentals dataset
  (statements as they were known on each past date, before restatements), so
  a historical backtest would apply today's figures to past prices. Backtesting
  is therefore not implemented and must not be added on the current data.
  Saved analysis snapshots record the exact inputs, filing accessions, price
  date and quote timestamp used at the time, which is the supported way to
  look back.
- Free quotes are never real time: Finnhub/Twelve Data are shown as Delayed,
  Tiingo as Last close. Nothing is labelled Live on the free plans.
- US SEC filers only (10-K/10-Q, US GAAP). IFRS 20-F/40-F filers, TASE
  fundamentals and TTM statements are not supported. TASE prices (PR #7) are
  manual entries.
- Statements come from SEC companyfacts, which omits dimensional facts
  (per-class share counts, segment data).
- Tiingo reports some share distributions as cash dividends (GOOGL
  2014-04-02, $567.97). Amounts of 25% of the price or more are excluded from
  the dividend rules and flagged in the provenance API.
- Graham's growth formula gives no default value when past EPS growth is above
  20% a year; enter a growth assumption explicitly to compute it.
- Single user, single process. No accounts, roles or multi-tenant data
  separation; protect the instance with `APP_PASSWORD` and HTTPS.
