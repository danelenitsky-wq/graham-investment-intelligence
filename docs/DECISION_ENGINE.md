# Decision engine

Explainable, deterministic research classification on top of the Graham rules engine, the
valuation engine and the data-quality gate. Free data only (SEC EDGAR + Tiingo free); no paid
API and no LLM is required.

> The categories are **application-defined research classifications**, not mechanical trading
> instructions and not rules written by Benjamin Graham.

| File | Role |
| --- | --- |
| `src/lib/decision/engine.ts` | Ten factors → one category, reasons, review triggers, caveats, conditions |
| `src/lib/decision/report.ts` | 15-section research report from deterministic templates (Hebrew / English), Markdown export |
| `src/lib/decision/snapshot.ts` | Timestamped snapshot (inputs, sources, versions, assumptions, assessment) and comparison |
| `src/lib/decision/render.ts` | Coded statement → localized sentence (formatting only) |
| `src/server/decision.ts` | Snapshot persistence (`AnalysisSnapshot`, engine `decision`), report helpers |
| `src/components/analysis/decision-panel.tsx` | "Decision & report" tab: classification, factors, report, snapshots, comparison |
| `scripts/decision-real.ts` | `npm run decision:real` — end to end on real companies (needs network) |

## Factors

| # | Factor | Read from |
| --- | --- | --- |
| 1 | Defensive qualification | D1–D7, split into non-price criteria and price criteria (D6, D7) |
| 2 | Enterprising qualification | E1–E7 (price criteria E6, E7; E6 wording UNVERIFIED) |
| 3 | Net-Net qualification | NN1: NCAV > 0 (business) and price ≤ ⅔ NCAV/share (price; factor UNVERIFIED) |
| 4 | Financial strength | D2 (or D2U), E1, E2, debt-maturity risk, book value per share |
| 5 | Earnings stability | D3 (10 years), E3 (5 years), operating-loss indicator |
| 6 | Valuation | Strategy price ceiling vs. comparable price; "excessive" above a multiple of intrinsic value (or of the ceiling when no intrinsic value) |
| 7 | Margin of safety | Intrinsic value when ESTABLISHED; Net-Net: discount to NCAV; otherwise UNKNOWN (never invented) |
| 8 | Investment risks | Risk indicators (cash burn, operating losses, debt maturity, working-capital quality, dilution) |
| 9 | Portfolio ownership | Position, market-value weight vs. limit, thesis strategy |
| 10 | Data freshness and completeness | Data-sufficiency gate, validation errors, price basis, cross-source verification |

## Classification (evaluated in this order)

1. **INSUFFICIENT VERIFIED DATA** — gate fails (missing / stale / conflicting / fixture data),
   validation errors, or only a historical price. Applies to owned positions too: nothing is
   flagged for sale on unreliable data. Also when the strategy has no applicable rules for the
   issuer type, or required non-price criteria lack data. The gate does not require current
   assets or current liabilities for banks, insurers, REITs and other financials (their balance
   sheets are unclassified), and accepts total equity including noncontrolling interests where
   parent equity is not tagged (the Graham engine derives parent equity from it).
2. Owned positions (assessed under the position's **thesis strategy** when recorded):
   - **REVIEW FOR SALE** when a trigger fires: thesis invalidated (strategy's non-price criteria
     fail), fundamentals deteriorated (critical risk, weak financial condition, recent deficit),
     valuation excessive (price > multiple × intrinsic value, else × ceiling), or concentration
     (weight > limit). A review, not an instruction.
   - **HOLD** otherwise. A price above the purchase ceiling but below the excessive level is not a
     trigger.
   - The purchase cost is **never** read: a fall in the price alone never triggers a review.
3. Not owned:
   - **AVOID** — a non-price criterion of the strategy fails, NCAV ≤ 0 (Net-Net), or a critical
     financial risk (debt due within a year > cash, short cash runway, negative equity).
   - **WAIT** — business criteria pass but the price is above the ceiling, or the intrinsic-value
     margin of safety is below target. Failing Graham's P/E or P/B limits is **never** AVOID.
   - **BUY CANDIDATE** — everything passes with verified data. Confidence is LOW (with the reason
     listed) when the strategy counts a rule whose wording is UNVERIFIED, when no intrinsic value
     margin exists, when figures are not cross-verified, or when risk data is partial.
   - Confidence is set only for BUY CANDIDATE and HOLD (STANDARD or LOW). For AVOID, WAIT,
     REVIEW FOR SALE and INSUFFICIENT VERIFIED DATA it is `null` by design: those are not
     positive calls whose strength needs qualifying.

Application assumptions (Settings → Decision assumptions): default strategy (DEFENSIVE), maximum
position weight (20%), excessive valuation multiple (1.5×), optional requirement of an intrinsic
value margin of safety before BUY CANDIDATE.

## Report

Fifteen sections: executive summary, company overview, price and market context, Defensive,
Enterprising, Net-Net, financial strength, historical earnings, dividend record, valuation,
margin of safety, main risks, decision assessment, conditions that would change the assessment,
data sources and timestamps. Every sentence is a fixed template; every number is a value from an
engine or a sourced fact. Download: `GET /api/securities/{id}/report?locale=he|en[&strategy=…][&snapshot=…]`.

## Snapshots and comparison

A snapshot stores the price (with source and timestamp), the annual statements read (last 12
years), the position, the gate, source references (filings with accession numbers and retrieval
time), calculation versions, valuation assumptions (strategy, margin-of-safety target, intrinsic
model assumptions, decision settings), every counted rule status, key metrics and the full
assessment, plus the report in both languages. Snapshots are saved manually, after each data
refresh / new filing (deduplicated by an inputs hash that ignores retrieval timestamps) and by
`npm run decision:real`.

The comparison view diffs two snapshots: classification change, drivers (new price, new
financial statements, changed assumptions, new calculation version, portfolio change, data
quality), price change, fiscal-year change or restatement, factor, rule and metric changes, and
added or removed review triggers.
