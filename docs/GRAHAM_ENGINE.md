# Graham analysis engine (v2)

Deterministic TypeScript over normalized, sourced data (SEC EDGAR statements, Tiingo free
prices and dividends). No LLM computes any number. No valuation and no recommendation.

Reference: Benjamin Graham, *The Intelligent Investor*, fourth revised edition (1973),
Chapters 14 and 15.

## Code

| File | Role |
| --- | --- |
| `src/lib/graham/registry.ts` | Rules registry: every rule, derivation, modern adaptation and interpretation, with category and verification level |
| `src/lib/graham/rules.ts` | Defensive (D1–D7, D1U/D2U for utilities, D1-M advisory) and Enterprising (E1–E7) |
| `src/lib/graham/netnet.ts` | Net-Net (NN1) and the five risk indicators; per-year trends for the charts |
| `src/lib/graham/dividends.ts` | Dividend evidence, fiscal-year attribution, non-cash distribution filter |
| `src/lib/graham/classification.ts` | Issuer type from the SEC SIC code (industrial, utility, bank, insurer, REIT, ETF, other financial) |
| `src/lib/graham/index.ts` | `analyzeGraham(inputs)` → all three panels |
| `src/components/analysis/graham-panels.tsx` | Hebrew RTL panels (Graham tab of the stock page) |

## Registry categories

- **ORIGINAL_GRAHAM** — D1–D7, D1U, D2U, D-FIN, E1–E7, NN-NCAV, NN1
- **MATHEMATICAL_DERIVATION** — current ratio, NWC, 3-year average, 22.5 = 15 × 1.5, 10.8×, NCAV/share, derived total liabilities
- **MODERN_ADAPTATION** — D1-M (CPI-U: 1973 = 44.4, 2025 = 321.9 → ≈ $725M), advisory, not counted
- **APPLICATION_INTERPRETATION** — fiscal-year windows, diluted EPS, dividend attribution and coverage, distribution filter, total debt, tangible assets, absent balance-sheet lines, sector applicability, risk thresholds

Verification: nothing is checked against a primary copy of the 1973 text (none is available
to this code base). Rules whose wording matches independent reproductions are
`VERIFIED_SECONDARY`. **E6** (price ≤ 120% of 9 × average earnings) and the **two-thirds**
factor of **NN1** could not be verified and are flagged `UNVERIFIED` wherever they appear;
they are still evaluated as specified and counted.

## Data rules

- PASS / FAIL only when the data proves it; otherwise `INSUFFICIENT_DATA`. Missing values are never zero.
- A known failure is reported even when other years are missing (e.g. a loss year; long-term
  debt alone already above 110% of NCA).
- Untagged preferred stock, goodwill, intangibles and short-term borrowings count as "not
  presented" only on a complete balance sheet, and every such input is marked *inferred absent*.
- Shareholders' equity falls back to total equity incl. noncontrolling interests − NCI when the
  10-K tags only the total (Johnson & Johnson); flagged `AI-EQUITY-NCI`.
- Operating income, when untagged, is proxied by pre-tax income + interest expense for the
  informational risk indicators only (`AI-OPINC-PROXY`, flagged *derived*).
- D4: 20 fiscal years of dividends. A year without dividends fails only when the daily history
  covers that whole fiscal year (or a 10-K reports zero). The default price history is 22 years.
- Provider "dividends" ≥ 25% of the share price are excluded as non-cash distributions
  (Tiingo records GOOGL's 2014-04-02 Class C distribution as a $567.97 dividend).
- Banks and insurers: D1, D2, E1, E2, E7, Net-Net not applicable. REITs, ETFs and other financial
  companies: everything not applicable. Utilities: Graham's utility size and debt tests.

## Real companies

```bash
npm run graham:real                       # MSFT NVDA GOOGL KO JNJ JPM O (needs network + .env)
npm run graham:real -- AAPL --out graham-real.json
```
