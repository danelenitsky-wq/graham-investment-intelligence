# Portfolio, watchlist, alerts and analysis history

## Portfolio

- **Entry**: the holding form or CSV import (Portfolio page). Fields: ticker,
  exchange, security type, quantity, average purchase price, purchase
  currency, price unit, purchase date, notes (optional: name, TASE security
  number, thesis strategy). Download the template from the import card.
- **Validation** (`src/lib/portfolio/import/validate.ts`), the same for every
  source: symbol format per exchange, known exchange and type, positive
  quantities and prices with bounded decimals, ISO dates not in the future,
  the currency must be the exchange's trading currency (US → USD,
  TASE → ILS), TASE prices need an explicit unit. Duplicate rows of one
  security are merged with a warning (quantity-weighted average).
- **Preview and confirmation**: the server resolves each row against the
  security master and existing positions (`previewImport`), shows errors and
  warnings per row, and saves nothing. *Confirm import* re-validates and must
  match the previewed content hash (`commitImport`), then records an
  `ImportBatch`, the positions and BUY transactions in one transaction.
  Israeli securities and ETFs not in the master are created as
  "user-entered" (labelled in the UI); unknown US companies are rejected.
- **PDF statements**: `StatementExtractor` (`src/lib/portfolio/import/sources.ts`)
  is the extension point. A PDF extractor produces the same raw rows and goes
  through the same validation and preview; the current one returns
  `NOT_IMPLEMENTED`. No paid OCR or parsing service is planned.

### Dashboard columns

Name, ticker, quantity, average price, latest price, quote time and source,
market value, unrealized gain/loss, return, weight, distance from 52-week
high, P/E and P/B (company statements' currency only), Graham screens
(defensive / enterprising / Net-Net, passed of applicable), valuation
thresholds (price ceiling, margin-of-safety price, intrinsic value), decision
assessment, data freshness. Opening the page reads stored data only;
*Refresh quotes* requests new quotes within at most 20 provider calls.

Weights are shown within each currency, and as portfolio weights only when
every currency converts with a sourced rate (see docs/TASE.md).

### ETFs

Graham's company criteria are `NOT_APPLICABLE` to funds. Instead, where the
stored data supports it: trailing-12-month distribution yield (non-cash
"distributions" removed, as in the Graham engine), 1- and 3-year total return
from adjusted closes, 52-week range. Expense ratio and holdings are not
available from the free sources and are not shown.

## Watchlist

Add a researched stock without buying it (from its analysis page or by
symbol). Each row shows the latest stored price, Graham qualification for the
selected strategy, your target purchase price and its distance, margin of
safety (current and your target), last analysis date and data freshness.
Saving a target creates or updates the matching alert rule.

## Alerts

Rules (one per security and type, created automatically for every holding
and watchlist item):

| Type | Fires when | Notes |
| --- | --- | --- |
| Graham purchase threshold | current price ≤ strategy price ceiling | price in the statements' currency |
| Custom target price | price ≤ your watchlist target | trading currency must match |
| Margin of safety target | MoS ≥ your target | needs an established intrinsic value |
| New filing | a filing newer than the one seen at setup | first run records a baseline |
| Current ratio deterioration | CR falls ≥ 10% y/y or below 2 | both years' figures required |
| Debt increase | long-term debt +20% y/y, or from zero | |
| Earnings deterioration | EPS −25% y/y, or a swing to a loss | |
| Dividend interruption | the filings report 0 after a paying year, or the usual payment is overdue (median interval × 1.5, at least +45 days) | requires price history up to the last 10 days; provider "dividends" ≥ 25% of the price are excluded (the 2014 GOOGL Class C issuance listed as a $567.97 dividend) |
| Net-Net change | NN1 changes between qualified and not | first run records a baseline |
| Stale data | price or (US) fundamentals are stale or unavailable | once per stale data point |

ETFs skip the company-only rules. A rule that cannot be judged records why
(for example `NO_CURRENT_PRICE`) instead of guessing.

**Duplicate prevention**: level conditions are edge-triggered (they fire on
entering the condition and re-arm on leaving it), and every occurrence has a
deterministic `dedupeKey` that the database enforces as unique, so repeated
runs never record the same occurrence twice, even if a rule's state is lost.
History is kept in `AlertEvent`, each run in `AlertRun`.

### Running checks

| How | Trigger recorded | Fetches |
| --- | --- | --- |
| Alerts page: *Check now* / *Check stored data* | MANUAL | optional |
| `npm run alerts:check [-- --no-fetch] [-- --fx]` | SCRIPT | yes, unless `--no-fetch` |
| `GET /api/cron/check-alerts` with `Authorization: Bearer $CRON_SECRET` (`?fetch=0` for stored data only) | SCHEDULED | yes |

Each fetching run stays inside the free plans: at most 40 provider requests,
the SEC filings check at most once per 24 h per security, and quotes under the
normal cache policy and rate limiter.

**Background monitoring is reported as active only** when `CRON_SECRET` is
set **and** a scheduled run completed in the last 26 hours. The app does not
run a scheduler by itself. To schedule one on macOS, for example hourly:

```bash
# crontab -e
0 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/check-alerts > /dev/null
```

## Analysis history

The History page lists securities with saved decision snapshots and compares
any two: price, financial statement inputs (per fiscal year and concept:
new, revised or dropped), Graham rule results, valuation metrics, the
decision factors and the final assessment, with the drivers of the change.
Snapshots are saved on data refresh and with *Save snapshot* on a stock's
Decision tab.
