/**
 * Rules registry — every rule, derivation and interpretation the Graham engine
 * uses, with its origin and how far it has been verified.
 *
 * Reference: Benjamin Graham, The Intelligent Investor, fourth revised edition
 * (Harper & Row, 1973). Chapter 14, "Stock Selection for the Defensive
 * Investor"; Chapter 15, "Stock Selection for the Enterprising Investor".
 *
 * Verification policy. No primary copy of the 1973 text is available to this
 * code base, so nothing is marked as verified against the primary text. A
 * rule is VERIFIED_SECONDARY when its wording matches independent
 * reproductions of the 1973 criteria (sources listed per entry). Where the
 * requested definition could not be confirmed it is UNVERIFIED: it is still
 * implemented exactly as specified, and the flag is shown with every result.
 * Page numbers are deliberately omitted (they differ between printings and
 * could not be checked).
 */
import type { Citation, RuleCategory, VerificationLevel } from "./types";

export interface RegistryEntry {
  id: string;
  category: RuleCategory;
  verification: VerificationLevel;
  citation: Citation | null;
  /** Rule statement in English (Graham's wording where it is an original rule). */
  statement: string;
  /** Implementation notes: what the code does and why. */
  implementation: string;
  /** Secondary sources consulted for VERIFIED_SECONDARY entries. */
  references?: { label: string; url: string }[];
}

const CH14 = (section: string): Citation => ({ source: "INTELLIGENT_INVESTOR_1973", chapter: 14, section });
const CH15 = (section: string): Citation => ({ source: "INTELLIGENT_INVESTOR_1973", chapter: 15, section });

const REF_CH14 = { label: "The Intelligent Investor Series — Chapter 14 summary", url: "https://medium.com/the-intelligent-investor-series/chapter-14-stock-selection-for-the-defensive-investor-b50f847a2783" };
const REF_CH15 = { label: "The Intelligent Investor Series — Chapter 15 summary", url: "https://medium.com/the-intelligent-investor-series/chapter-15-stock-selection-for-the-enterprising-investor-729645a6cc91" };
const REF_STOCKOPEDIA = { label: "Stockopedia — Graham defensive investor screen", url: "https://www.stockopedia.com/content/benjamin-graham-defensive-investor-screen-how-does-it-work-56297" };
const REF_AAII_NCAV = { label: "AAII — Benjamin Graham's Net Current Asset Value Approach", url: "https://www.aaii.com/journal/article/benjamin-graham-s-net-current-asset-value-approach" };

const DEFENSIVE_SECTION = "Seven statistical requirements for the defensive investor";
const ENTERPRISING_SECTION = "Application of criteria to the Stock Guide (secondary companies)";

const entries: RegistryEntry[] = [
  // ───────────────────────────── Original Graham rules: Chapter 14 ─────────────────────────────
  {
    id: "D1",
    category: "ORIGINAL_GRAHAM",
    verification: "VERIFIED_SECONDARY",
    citation: CH14(DEFENSIVE_SECTION),
    statement: "Adequate size of the enterprise: not less than $100 million of annual sales for an industrial company (1973 dollars).",
    implementation: "Latest fiscal year's revenue in USD ≥ $100,000,000 nominal. The inflation-adjusted comparison is a separate modern adaptation (D1-M) and does not change D1's status.",
    references: [REF_CH14, REF_STOCKOPEDIA],
  },
  {
    id: "D1U",
    category: "ORIGINAL_GRAHAM",
    verification: "VERIFIED_SECONDARY",
    citation: CH14(DEFENSIVE_SECTION),
    statement: "Adequate size for a public utility: not less than $50 million of total assets.",
    implementation: "Used in place of D1 for public utilities: latest total assets in USD ≥ $50,000,000.",
    references: [REF_CH14],
  },
  {
    id: "D2",
    category: "ORIGINAL_GRAHAM",
    verification: "VERIFIED_SECONDARY",
    citation: CH14(DEFENSIVE_SECTION),
    statement: "Sufficiently strong financial condition: current assets at least twice current liabilities (2:1 current ratio); long-term debt should not exceed the net current assets (working capital).",
    implementation: "CA / CL ≥ 2 and LTD ≤ CA − CL, both on the latest balance sheet. Either failing check fails the rule.",
    references: [REF_CH14, REF_STOCKOPEDIA],
  },
  {
    id: "D2U",
    category: "ORIGINAL_GRAHAM",
    verification: "VERIFIED_SECONDARY",
    citation: CH14(DEFENSIVE_SECTION),
    statement: "Public utilities: debt should not exceed twice the stock equity (at book value).",
    implementation: "Used in place of D2 for public utilities: long-term debt ≤ 2 × common equity.",
    references: [REF_CH14],
  },
  {
    id: "D3",
    category: "ORIGINAL_GRAHAM",
    verification: "VERIFIED_SECONDARY",
    citation: CH14(DEFENSIVE_SECTION),
    statement: "Earnings stability: some earnings for the common stock in each of the past ten years.",
    implementation: "Net income attributable to the parent > 0 in each of the ten latest fiscal years. Any reported loss fails; a missing year (with no loss found) is INSUFFICIENT_DATA.",
    references: [REF_CH14, REF_STOCKOPEDIA],
  },
  {
    id: "D4",
    category: "ORIGINAL_GRAHAM",
    verification: "VERIFIED_SECONDARY",
    citation: CH14(DEFENSIVE_SECTION),
    statement: "Dividend record: uninterrupted payments for at least the past 20 years.",
    implementation: "A cash dividend in each of the 20 latest fiscal years. A year without dividends fails only when the data covers that year; otherwise the result is INSUFFICIENT_DATA.",
    references: [REF_CH14, REF_STOCKOPEDIA],
  },
  {
    id: "D5",
    category: "ORIGINAL_GRAHAM",
    verification: "VERIFIED_SECONDARY",
    citation: CH14(DEFENSIVE_SECTION),
    statement: "Earnings growth: a minimum increase of at least one-third in per-share earnings in the past ten years using three-year averages at the beginning and end.",
    implementation: "avg EPS(Y−2..Y) / avg EPS(Y−9..Y−7) − 1 ≥ 1/3, Y = latest fiscal year (ten fiscal years inclusive).",
    references: [REF_CH14, REF_STOCKOPEDIA],
  },
  {
    id: "D6",
    category: "ORIGINAL_GRAHAM",
    verification: "VERIFIED_SECONDARY",
    citation: CH14(DEFENSIVE_SECTION),
    statement: "Moderate price/earnings ratio: current price should not be more than 15 times average earnings of the past three years.",
    implementation: "Price / avg EPS(Y−2..Y) ≤ 15. Non-positive average earnings fail (no positive multiple exists).",
    references: [REF_CH14, REF_STOCKOPEDIA],
  },
  {
    id: "D7",
    category: "ORIGINAL_GRAHAM",
    verification: "VERIFIED_SECONDARY",
    citation: CH14(DEFENSIVE_SECTION),
    statement:
      "Moderate ratio of price to assets: current price should not be more than 1½ times the book value last reported. A multiplier of earnings below 15 could justify a correspondingly higher multiplier of assets; as a rule of thumb the product of the multiplier times the ratio of price to book value should not exceed 22.5.",
    implementation: "PASS when P/B ≤ 1.5 or (P/E₃ × P/B) ≤ 22.5, P/E₃ being D6's multiple. D7 never overrides D6: the separate P/E ≤ 15 requirement is still evaluated and counted on its own.",
    references: [REF_CH14, REF_STOCKOPEDIA],
  },
  {
    id: "D-FIN",
    category: "ORIGINAL_GRAHAM",
    verification: "VERIFIED_SECONDARY",
    citation: CH14("Investing in stocks of financial enterprises"),
    statement: "Financial enterprises (banks, insurance companies): Graham suggests applying the same price-to-earnings and price-to-book standards as for industrial and utility stocks.",
    implementation: "Banks and insurers: D6 and D7 are evaluated; D1 and D2 (industrial size and working-capital tests) are NOT_APPLICABLE because no verified specialized size or strength test exists.",
    references: [REF_CH14],
  },

  // ───────────────────────────── Original Graham rules: Chapter 15 ─────────────────────────────
  {
    id: "E1",
    category: "ORIGINAL_GRAHAM",
    verification: "VERIFIED_SECONDARY",
    citation: CH15(ENTERPRISING_SECTION),
    statement: "Financial condition (a): current assets at least 1.5 times current liabilities.",
    implementation: "CA / CL ≥ 1.5 on the latest balance sheet (industrial companies).",
    references: [REF_CH15],
  },
  {
    id: "E2",
    category: "ORIGINAL_GRAHAM",
    verification: "VERIFIED_SECONDARY",
    citation: CH15(ENTERPRISING_SECTION),
    statement: "Financial condition (b): debt not more than 110% of net current assets (for industrial companies).",
    implementation: "Total debt ≤ 1.1 × (CA − CL). Graham writes \"debt\"; this application uses total borrowings (see AI-TOTAL-DEBT).",
    references: [REF_CH15],
  },
  {
    id: "E3",
    category: "ORIGINAL_GRAHAM",
    verification: "VERIFIED_SECONDARY",
    citation: CH15(ENTERPRISING_SECTION),
    statement: "Earnings stability: no deficit in the last five years covered in the Stock Guide.",
    implementation: "Net income > 0 in each of the five latest fiscal years.",
    references: [REF_CH15],
  },
  {
    id: "E4",
    category: "ORIGINAL_GRAHAM",
    verification: "VERIFIED_SECONDARY",
    citation: CH15(ENTERPRISING_SECTION),
    statement: "Dividend record: some current dividend.",
    implementation: "At least one cash dividend with an ex-date in the twelve months before the price date (see AI-CURRENT-DIV).",
    references: [REF_CH15],
  },
  {
    id: "E5",
    category: "ORIGINAL_GRAHAM",
    verification: "VERIFIED_SECONDARY",
    citation: CH15(ENTERPRISING_SECTION),
    statement: "Earnings growth: last year's earnings more than those of 1966 (the text is written with 1971 as the last year, i.e. five years earlier).",
    implementation: "EPS(Y) > EPS(Y−5).",
    references: [REF_CH15],
  },
  {
    id: "E6",
    category: "ORIGINAL_GRAHAM",
    verification: "UNVERIFIED",
    citation: CH15(ENTERPRISING_SECTION),
    statement:
      "Price not more than 120% of the value based on 9 times average earnings — as specified for this application. Not found in the reproductions of Graham's five Stock Guide criteria; the secondary sources only mention a preliminary list of issues selling at a multiplier of less than 9.",
    implementation: "Price ≤ 1.2 × (9 × avg EPS of the last three fiscal years). The averaging period is an interpretation (AI-E6-AVERAGE). Flagged UNVERIFIED wherever it is shown; counted in the qualification as requested.",
    references: [REF_CH15],
  },
  {
    id: "E7",
    category: "ORIGINAL_GRAHAM",
    verification: "VERIFIED_SECONDARY",
    citation: CH15(ENTERPRISING_SECTION),
    statement: "Price: less than 120% of net tangible assets.",
    implementation: "Price < 1.2 × net tangible assets per share (strictly less, as printed). Net tangible assets: AI-TANGIBLE.",
    references: [REF_CH15],
  },
  {
    id: "NN-NCAV",
    category: "ORIGINAL_GRAHAM",
    verification: "VERIFIED_SECONDARY",
    citation: CH15("Bargain issues, or net-current-asset stocks"),
    statement: "Net current asset value: current assets less all liabilities (Graham also deducts preferred stock), counting fixed and other assets as zero.",
    implementation: "NCAV = CA − TL, as specified for this application. When preferred stock is reported the preferred-adjusted NCAV is shown alongside.",
    references: [REF_AAII_NCAV],
  },
  {
    id: "NN1",
    category: "ORIGINAL_GRAHAM",
    verification: "UNVERIFIED",
    citation: CH15("Bargain issues, or net-current-asset stocks"),
    statement:
      "Net-net purchase threshold: price at or below two-thirds of NCAV per share. Widely attributed to Graham (Graham-Newman practice); the exact 1973 wording of the two-thirds figure could not be verified.",
    implementation: "Price ≤ (2/3) × NCAV / shares outstanding. A numerical qualification is not a buy recommendation.",
    references: [REF_AAII_NCAV],
  },

  // ───────────────────────────── Mathematical derivations ─────────────────────────────
  { id: "X-CR", category: "MATHEMATICAL_DERIVATION", verification: "NOT_A_GRAHAM_RULE", citation: null, statement: "Current ratio = current assets / current liabilities.", implementation: "Undefined (null) when current liabilities are zero or negative; never divided by zero." },
  { id: "X-NWC", category: "MATHEMATICAL_DERIVATION", verification: "NOT_A_GRAHAM_RULE", citation: null, statement: "Net working capital (net current assets) = current assets − current liabilities.", implementation: "Requires both lines; no default." },
  { id: "X-AVG3", category: "MATHEMATICAL_DERIVATION", verification: "NOT_A_GRAHAM_RULE", citation: null, statement: "Three-year average EPS = arithmetic mean of the three fiscal years' EPS.", implementation: "All three years are required; a missing year makes the average unknown." },
  { id: "X-PEPB", category: "MATHEMATICAL_DERIVATION", verification: "NOT_A_GRAHAM_RULE", citation: null, statement: "22.5 = 15 × 1.5: the P/E × P/B product equals the two separate limits multiplied.", implementation: "P/E × P/B = price² / (avg EPS × BVPS)." },
  { id: "X-E6", category: "MATHEMATICAL_DERIVATION", verification: "NOT_A_GRAHAM_RULE", citation: null, statement: "120% of 9 × average earnings = 10.8 × average earnings.", implementation: "Shown with E6." },
  { id: "X-NCAVPS", category: "MATHEMATICAL_DERIVATION", verification: "NOT_A_GRAHAM_RULE", citation: null, statement: "NCAV per share = NCAV / shares outstanding; purchase threshold = 2/3 × NCAV per share.", implementation: "Undefined when shares are missing or zero." },
  { id: "X-TL", category: "MATHEMATICAL_DERIVATION", verification: "NOT_A_GRAHAM_RULE", citation: null, statement: "Total liabilities = total liabilities and equity − total equity (when no total-liabilities line is tagged).", implementation: "Uses total equity including non-controlling interests when tagged, else parent equity (which overstates liabilities, the conservative direction for NCAV). Flagged as derived." },

  // ───────────────────────────── Modern adaptations ─────────────────────────────
  {
    id: "D1-M",
    category: "MODERN_ADAPTATION",
    verification: "NOT_A_GRAHAM_RULE",
    citation: CH14(DEFENSIVE_SECTION),
    statement: "Graham's $100 million (industrial) / $50 million (utility) size floors restated in current dollars with the US CPI-U.",
    implementation:
      "Threshold × CPI(current) / CPI(1973). Default CPI-U annual averages (1982-84 = 100, BLS series CUUR0000SA0): 1973 = 44.4, 2025 = 321.9 → factor ≈ 7.25 → ≈ $725M. A CPI value entered in Settings replaces the 2025 level. Advisory: not counted in the qualification.",
    references: [
      { label: "BLS — Consumer Price Index (CPI-U, series CUUR0000SA0)", url: "https://www.bls.gov/cpi/" },
      { label: "Federal Reserve Bank of Minneapolis — CPI 1913–", url: "https://www.minneapolisfed.org/about-us/monetary-policy/inflation-calculator/consumer-price-index-1913-" },
    ],
  },

  // ───────────────────────────── Application-specific interpretations ─────────────────────────────
  { id: "AI-FY-WINDOW", category: "APPLICATION_INTERPRETATION", verification: "NOT_A_GRAHAM_RULE", citation: null, statement: "\"Past N years\" means the N latest fiscal years reported in 10-K filings, inclusive of the latest.", implementation: "D3: Y−9..Y; D4: Y−19..Y; D5: start Y−9..Y−7, end Y−2..Y; E3: Y−4..Y." },
  { id: "AI-EPS", category: "APPLICATION_INTERPRETATION", verification: "NOT_A_GRAHAM_RULE", citation: null, statement: "Per-share earnings are diluted EPS as reported (split-adjusted), falling back to basic EPS, then net income / diluted shares.", implementation: "Graham's 1973 figures predate the diluted-EPS standard." },
  { id: "AI-EARNINGS-COMMON", category: "APPLICATION_INTERPRETATION", verification: "NOT_A_GRAHAM_RULE", citation: null, statement: "\"Earnings for the common stock\" = net income attributable to the parent (falls back to EPS when net income is not reported).", implementation: "A value of exactly zero is not \"some earnings\" and counts as a deficit." },
  { id: "AI-D5-BASE", category: "APPLICATION_INTERPRETATION", verification: "NOT_A_GRAHAM_RULE", citation: null, statement: "A percentage increase is undefined from a non-positive base.", implementation: "If the starting average is ≤ 0: FAIL when the ending average is not higher, otherwise INSUFFICIENT_DATA." },
  { id: "AI-DIV-FY", category: "APPLICATION_INTERPRETATION", verification: "NOT_A_GRAHAM_RULE", citation: null, statement: "A dividend belongs to the fiscal year containing its ex-dividend date.", implementation: "Uses the issuer's fiscal-year-end month from EDGAR (December when unknown). SEC dividends-per-share in 10-K filings are additional evidence." },
  { id: "AI-DIV-COVERAGE", category: "APPLICATION_INTERPRETATION", verification: "NOT_A_GRAHAM_RULE", citation: null, statement: "A year counts as dividend-free only when the data proves it.", implementation: "Proof: the price provider's daily history spans the whole fiscal year with no dividend, or a 10-K reports zero dividends. Otherwise the year is unknown and D4 returns INSUFFICIENT_DATA, never FAIL." },
  { id: "AI-DIST-FILTER", category: "APPLICATION_INTERPRETATION", verification: "NOT_A_GRAHAM_RULE", citation: null, statement: "Provider \"dividends\" worth 25% or more of the share price on the ex-date are treated as non-cash distributions and excluded.", implementation: "Catches share-class distributions recorded as cash, e.g. Tiingo's $567.97 entry for GOOGL on 2014-04-02 (Class C share distribution). Excluded rows are listed with the result." },
  { id: "AI-CURRENT-DIV", category: "APPLICATION_INTERPRETATION", verification: "NOT_A_GRAHAM_RULE", citation: null, statement: "\"Some current dividend\" = a cash dividend with an ex-date in the 365 days before the price date.", implementation: "FAIL only when the provider's daily history covers the whole window." },
  { id: "AI-TOTAL-DEBT", category: "APPLICATION_INTERPRETATION", verification: "NOT_A_GRAHAM_RULE", citation: null, statement: "Total debt = long-term debt (non-current) + debt due within a year.", implementation: "Current debt: DebtCurrent (includes short-term borrowings) or current maturities of long-term debt + short-term borrowings / commercial paper. When current debt is not reported, long-term debt alone is a lower bound that can only prove a FAIL." },
  { id: "AI-TANGIBLE", category: "APPLICATION_INTERPRETATION", verification: "NOT_A_GRAHAM_RULE", citation: null, statement: "Net tangible assets = common equity − goodwill − other intangible assets.", implementation: "Common equity = stockholders' equity − preferred stock. Per share: ÷ period-end shares outstanding." },
  { id: "AI-ABSENT-LINE", category: "APPLICATION_INTERPRETATION", verification: "NOT_A_GRAHAM_RULE", citation: null, statement: "Preferred stock, goodwill, intangibles and short-term borrowings that are not tagged on an otherwise complete balance sheet (total assets, total liabilities or liabilities-and-equity, and equity all reported) are treated as not presented (none).", implementation: "The input is marked \"inferred absent\" in every result that uses it. Without a complete balance sheet the value stays unknown." },
  { id: "AI-EQUITY-NCI", category: "APPLICATION_INTERPRETATION", verification: "NOT_A_GRAHAM_RULE", citation: null, statement: "When the 10-K tags only total equity including noncontrolling interests, shareholders' equity = total equity − noncontrolling interests.", implementation: "An untagged noncontrolling-interest line on an otherwise complete balance sheet is treated as not presented (none); the equity input is flagged." },
  { id: "AI-OPINC-PROXY", category: "APPLICATION_INTERPRETATION", verification: "NOT_A_GRAHAM_RULE", citation: null, statement: "When operating income is not tagged, the risk indicators use pre-tax income + interest expense as a proxy.", implementation: "Flagged \"derived\"; used only by the informational Net-Net risk indicators and trend chart, never by a counted rule." },
  { id: "AI-LTD", category: "APPLICATION_INTERPRETATION", verification: "NOT_A_GRAHAM_RULE", citation: null, statement: "Long-term debt is inferred as zero only when total liabilities equal current liabilities.", implementation: "Otherwise an untagged long-term debt stays unknown." },
  { id: "AI-SHARES", category: "APPLICATION_INTERPRETATION", verification: "NOT_A_GRAHAM_RULE", citation: null, statement: "Per-share balance-sheet values use period-end shares outstanding (10-K), falling back to diluted weighted-average shares.", implementation: "Shares of all classes as tagged without dimensions." },
  { id: "AI-PRICE", category: "APPLICATION_INTERPRETATION", verification: "NOT_A_GRAHAM_RULE", citation: null, statement: "\"Current price\" = latest available price (live quote or last official close), in the statements' currency.", implementation: "A price in another currency is not mixed with the statements (INSUFFICIENT_DATA)." },
  { id: "AI-E5-EPS", category: "APPLICATION_INTERPRETATION", verification: "NOT_A_GRAHAM_RULE", citation: null, statement: "E5 compares per-share earnings.", implementation: "Per-share figures neutralize share-count changes over the five years." },
  { id: "AI-E6-AVERAGE", category: "APPLICATION_INTERPRETATION", verification: "NOT_A_GRAHAM_RULE", citation: null, statement: "E6's \"average earnings\" = the three-year average EPS used by D6.", implementation: "Chosen for consistency with Chapter 14; not confirmed by the source text." },
  { id: "AI-SECTOR", category: "APPLICATION_INTERPRETATION", verification: "NOT_A_GRAHAM_RULE", citation: null, statement: "Industrial-company tests are not applied blindly to banks, insurers, REITs, other financial companies or ETFs.", implementation: "Utilities: D1U and D2U replace D1/D2; E1, E2 and Net-Net are NOT_APPLICABLE. Banks and insurers: D1, D2, E1, E2, E7 and Net-Net are NOT_APPLICABLE; earnings, dividend and price tests are evaluated (D-FIN). REITs, other financial companies and ETFs: everything NOT_APPLICABLE." },
  { id: "AI-RISK", category: "APPLICATION_INTERPRETATION", verification: "NOT_A_GRAHAM_RULE", citation: null, statement: "Net-Net risk indicators (cash burn, operating losses, debt maturities, receivables and inventory quality, dilution) use this application's thresholds.", implementation: "Graham gives no numeric thresholds for these; they are informational and never change a rule status." },
];

export const RULES_REGISTRY: Readonly<Record<string, RegistryEntry>> = Object.freeze(Object.fromEntries(entries.map((e) => [e.id, e])));

export function registryEntry(id: string): RegistryEntry {
  const e = RULES_REGISTRY[id];
  if (!e) throw new Error(`Unknown Graham registry id: ${id}`);
  return e;
}

export const REGISTRY_CATEGORIES: RuleCategory[] = ["ORIGINAL_GRAHAM", "MATHEMATICAL_DERIVATION", "MODERN_ADAPTATION", "APPLICATION_INTERPRETATION"];

/** Sourced CPI-U annual averages (1982-84 = 100) used by D1-M when Settings has no CPI value. */
export const CPI_DEFAULT = {
  baseYear: 1973,
  baseValue: 44.4,
  currentLabel: "2025",
  currentValue: 321.9,
  sourceLabel: "BLS CPI-U (CUUR0000SA0), annual averages, via the Federal Reserve Bank of Minneapolis table",
  sourceUrl: "https://www.minneapolisfed.org/about-us/monetary-policy/inflation-calculator/consumer-price-index-1913-",
} as const;
