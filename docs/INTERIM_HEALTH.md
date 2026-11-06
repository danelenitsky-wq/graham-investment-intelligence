# Latest quarter and TTM financial health

Graham's criteria (see `GRAHAM_ENGINE.md`) are applied to **annual statements
only**. That is unchanged. Annual figures can be up to a year old, so the stock
page has a separate tab, **Latest quarter & TTM**, built by
`src/lib/interim/index.ts`. It is an application-defined freshness check, not
one of Graham's rules, and its output never feeds the Graham screens, the
valuation engine or the decision engine.

## What it computes

- **TTM flows** (revenue, operating income, net income, diluted EPS, operating
  cash flow): latest annual + quarters reported since − the same quarters one
  year earlier. If that is not possible (for example the annual report is more
  than a year old), the sum of the four latest consecutive discrete quarters.
  A missing quarter leaves the value empty; Q4 is never derived as FY − 9M.
  TTM EPS is a sum of quarterly per-share figures and is labelled approximate.
- **Balance sheet as of the latest quarter end**: current ratio, working
  capital, total debt (long-term + current portion + short-term borrowings),
  common equity, cash.
- Each is compared with the latest annual report.

## Material deterioration flags (our thresholds, not Graham's)

| Flag | Condition |
| --- | --- |
| Revenue decline | TTM ≤ −10% |
| Operating income / net income / EPS / operating cash flow decline | TTM ≤ −25%, or turned ≤ 0 from positive |
| Current ratio | fell below 2.0 from ≥ 2.0, or ≤ −20% |
| Working capital | ≤ −20%, or turned ≤ 0 |
| Total debt | ≥ +25%, or any debt after none |
| Common equity | ≤ −15%, or turned ≤ 0 |

The thresholds live in `DETERIORATION_THRESHOLDS`. When any flag fires, the
Summary tab shows a warning banner that points to the tab; Graham's results
remain based on the annual report.

Percent changes are not computed from a non-positive annual base. Statements
in different currencies are not compared.
