# Tel Aviv Stock Exchange (TASE) coverage

Investigated 2026-11-06. The rule is the same as for US data: no invented
prices, ticker mappings or FX rates, and nothing that needs a paid feed.

## What exists, and what the app uses

| Need | Lawful free source | Status in the app |
| --- | --- | --- |
| Prices (end of day or intraday) | None. TASE Data Hub sells end-of-day and intraday securities data as commercial products that need approval. Scraping tase.co.il is not done. | **Manual price updates** (below). The `tase` provider refuses with `NOT_SUPPORTED`. |
| Symbol ↔ security number ↔ ISIN | TASE Data Hub **Securities Basic**, free with a free API key from <https://openapi.tase.co.il> (`GET https://datawise.tase.co.il/v1/basic-securities/trade-securities-list/{yyyy}/{m}/{d}`, header `apikey`, 10 requests per 2 s). | Adapter and parser in `src/lib/providers/tase/` (`taseTradedSecurities`, `resolveTaseSymbol`). The response shape follows the open-source tasepy 0.2.1 client; the live endpoint answered 401 without a key, so the shape is not yet verified against a real payload and the parser rejects anything else. Not wired into import validation yet. |
| Financial statements (IFRS) | MAYA / MAGNA publish PDF and HTML reports, with no free structured API comparable to SEC XBRL. | Not available. Graham screens show INSUFFICIENT DATA for TASE companies, and stale-fundamentals alerts are not raised for them. |
| USD/ILS rate | **Bank of Israel** representative rate, public SDMX API, no key (`https://edge.boi.org.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/RER_USD_ILS?startperiod=…&endperiod=…&format=csv`). Verified live: 2026-11-05 = 3.167. | `npm run fx:refresh`, the "Fetch Bank of Israel rate" button, or `alerts:check -- --fx`. Rates are published on Israeli business days only; nothing is filled in for other days. |

## Prices in agorot

TASE quotes most securities in agorot (1/100 shekel). Every amount is stored in
shekels (ILS) and the unit it was entered in is kept:

- Imports and the holding form **require an explicit unit** for TASE rows
  (`ILS` or `ILA`/`agorot`); the app never guesses which one a number is in.
- If an entered average price is more than 30× away from the latest stored
  price, the preview warns about a likely agorot/shekel mix-up.

## Manual price updates

Portfolio → *TASE prices* → enter the price, its unit, the exchange-local date
and time the price refers to, and a source label (for example "TASE website,
closing price"). It is stored as a `QuoteSnapshot` with `isManual = true`, the
entered value and unit, and the label. It is shown as **Delayed (manual
entry)** while it is within the stale-price setting, and **Stale** after that;
it is never shown as live or as an official close.

## FX and portfolio totals

USD and ILS holdings are valued in their own currency and totalled per
currency. A consolidated total (and portfolio weights) appear only when a
sourced USD/ILS rate dated within 7 days is stored: the Bank of Israel rate,
or a rate you type in with its date and source (labelled MANUAL; an official
rate of the same date wins).
