# Valuation engine

Deterministic TypeScript, free data only (SEC EDGAR statements, Tiingo free last-close prices).
Analysis only; no recommendation.

| File | Role |
| --- | --- |
| `src/lib/valuation/engine.ts` | Price ceilings, Graham Number, Net-Net threshold, price basis, margin of safety, dashboard |
| `src/lib/valuation/intrinsic.ts` | Optional conservative intrinsic value (MODERN EXTENSION): DCF / normalized earnings, defaults, sensitivity |
| `src/components/valuation/valuation-dashboard.tsx` | Hebrew RTL dashboard, live assumptions, interactive chart, sensitivity grid |

## Price ceilings (screening limits, not intrinsic value)

Every ceiling reads the inputs the Graham rules engine already used (D6/D7/E6/E7/NN1), so the
dashboard and the rule panels cannot disagree.

| Ceiling | Formula | Verification |
| --- | --- | --- |
| Graham Number | √(22.5 × avgEPS₃ × BVPS) — price where P/E₃ × P/B = 22.5 | derived; never treated as intrinsic value |
| Defensive (D6 + D7) | min(15 × avgEPS₃, max(1.5 × BVPS, Graham Number)) | VERIFIED_SECONDARY |
| Enterprising (E6 + E7) | min(1.2 × 9 × avgEPS₃, 1.2 × NTAPS); E7 is strict (<) | **E6 UNVERIFIED** — flag shown on the ceiling |
| Net-Net (NN1) | ⅔ × NCAV/share | **⅔ factor UNVERIFIED** — flag shown |

The Graham Number alone never qualifies a price: P/E ≤ 15 stays a separate limit. Each ceiling
also lists the screen's non-price criteria (a price below the ceiling does not qualify the stock).
Missing or non-positive EPS, book value, tangible book or NCAV → `NOT_ESTABLISHED`; no target is
fabricated. Sector applicability follows the rules engine (`NOT_APPLICABLE`).

"Change required" = (threshold − price) / price.

## Price basis

`CURRENT` for a FRESH / DELAYED / LAST_CLOSE / CACHED quote no older than `priceStaleDays`;
`HISTORICAL` for a stale or conflicted quote, an aged price, or the last stored daily close used
when no quote exists (all labelled on the page); `UNAVAILABLE` with no price (no comparisons).
A price in another currency than the statements is never compared.

## Intrinsic value (optional, MODERN ANALYTICAL EXTENSION)

Not an original Graham rule. User-configurable: revenue growth, profit margin, discount rate,
terminal growth, earnings normalization years, share dilution, projection years.

- **DCF**: revenue × margin per share (diluted yearly), discounted, + Gordon terminal value (per-share
  terminal growth net of dilution).
- **Normalized earnings**: avg EPS over the window × (1 + g′) / (r − g′).

Conservative defaults: historical revenue CAGR capped at 8%; the normalized net-income margin
(the FCF margin only when net income is missing; an FCF margin below half the net margin, as in
heavy-capex years, is flagged on the bottom-line card rather than used, because it would value a
profitable business at almost nothing); dilution = historical share growth floored at 0 (buybacks not extrapolated); r = 10%,
g = 2%, 5-year normalization, 10 projection years (all in Settings).
`NOT_ESTABLISHED` for financial issuers, < 3 years of history, missing revenue/shares/EPS,
non-positive margin or normalized EPS, r ≤ g, or a non-positive result. More than 75% of value in
the terminal value is flagged.

Sensitivity: 5 × 5 grid, discount rate ±1pp steps × revenue growth ±2pp (DCF) or terminal growth
±0.5pp (normalized). Range = min/max of the inner 3 × 3 band.

## Margin of safety

MoS = (Intrinsic value − Price) / Intrinsic value × 100, only against the intrinsic value model;
otherwise **NOT ESTABLISHED**. The target (default 30%) is an application assumption, adjustable
on the page and in Settings; the page shows the price meeting the target and the change required.

## Bottom-line fair value (`src/lib/valuation/fair-value.ts`)

A plain-language card at the top of the stock page: market price, an estimated fair value
(low / base / high), the % gap between them, a range bar with one dot per scenario, and the
revenue growth the market price implies.

| Model | Counted? |
| --- | --- |
| DCF intrinsic value (modern extension) | Yes, when established. Range = its sensitivity band; its 5 × 5 grid supplies the scenarios |
| Graham growth formula E × (8.5 + 2G) | Yes, when G is accepted (default G above 20% is refused). Scenarios G − 2pp, G, G + 2pp |
| NCAV per share | Only as a fallback when neither earnings model is available (asset value, flagged) |
| Graham Number, defensive / enterprising ceilings | Never: screening limits, not values |
| Net-Net ⅔ × NCAV threshold | Never: a bargain entry price, far below the value of a profitable company |

Base = equal-weight average of the counted models; range = lowest low to highest high. Verdict:
price within ±10% of the base is "near the estimate". Models more than 2× apart are flagged.
"Scenarios above price" counts computed scenarios whose value exceeds the price. It shows how much
the result depends on the assumptions and is **not** a probability or a price forecast.
"Implied growth" solves the DCF (bisection, −30% to +60%) for the yearly revenue growth at which
the value equals the price, all other assumptions unchanged. The margin of safety elsewhere on the
page is still measured against the DCF intrinsic value only.
