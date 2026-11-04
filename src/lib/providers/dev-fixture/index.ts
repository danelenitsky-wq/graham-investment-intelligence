/**
 * ⚠️  DEVELOPMENT FIXTURES — NOT REAL MARKET DATA ⚠️
 *
 * Fictional companies on a fictional exchange ("DEVX") used to exercise the
 * full ingestion → normalization → analysis → UI pipeline without network
 * access. Every row written from here is attributed to the `dev-fixture`
 * DataSource (isDevFixture = true) and the UI shows a prominent banner.
 *
 * The fixtures are emitted in SEC companyfacts shape so they travel through
 * the same normalization code as real EDGAR data. Loaded only when
 * ENABLE_DEV_FIXTURES=true (see `npm run db:seed:fixtures`).
 */
import type { CompanyFacts, SecFact } from "@/lib/providers/sec-edgar/types";
import { validatePriceBars, type NormalizedDividend, type NormalizedPriceBar } from "@/lib/normalization/market";
import type { ProviderDescriptor } from "../types";

export const DEV_FIXTURE: ProviderDescriptor = {
  key: "dev-fixture",
  name: "Development fixtures (fictional data)",
  capabilities: ["REFERENCE", "FUNDAMENTALS", "PRICES"],
  markets: ["US"],
  baseUrl: "fixture://local",
  requiredEnv: ["ENABLE_DEV_FIXTURES"],
  isDevFixture: true,
};

export const DEV_EXCHANGE = {
  code: "DEVX",
  name: "Development Fixture Exchange (fictional)",
  nameHe: "בורסת פיתוח (פיקטיבית)",
  country: "US",
  currency: "USD",
  timezone: "America/New_York",
} as const;

interface YearSpec {
  fy: number;
  revenue: number;
  netIncome: number;
  shares: number;
  dps: number;
  currentAssets: number;
  currentLiabilities: number;
  longTermDebt: number;
  totalAssets: number;
  totalLiabilities: number;
  goodwill: number;
  operatingCashFlow: number;
  capex: number;
}

export interface FixtureCompany {
  ticker: string;
  name: string;
  nameHe: string;
  cik: string; // fictional, outside the SEC's real range
  sector: string;
  isUtility: boolean;
  years: YearSpec[];
  /** Approximate P/E used to generate the fictional price path. */
  priceToEarnings: number;
}

/** Small deterministic PRNG so fixtures are identical on every machine. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildYears(params: {
  seed: number;
  startYear: number;
  count: number;
  revenue0: number;
  growth: number;
  margins: number[];
  shares0: number;
  payout: number;
  debtRatio: number;
}): YearSpec[] {
  const rnd = mulberry32(params.seed);
  const out: YearSpec[] = [];
  let revenue = params.revenue0;
  let shares = params.shares0;
  for (let i = 0; i < params.count; i++) {
    revenue *= 1 + params.growth + (rnd() - 0.5) * 0.04;
    shares *= 0.99;
    const margin = params.margins[i % params.margins.length];
    const netIncome = Math.round(revenue * margin);
    const eps = netIncome / shares;
    const totalAssets = Math.round(revenue * 1.6);
    const currentAssets = Math.round(totalAssets * 0.42);
    const currentLiabilities = Math.round(currentAssets / (2.1 + rnd() * 0.6));
    const longTermDebt = Math.round((currentAssets - currentLiabilities) * params.debtRatio);
    const totalLiabilities = currentLiabilities + longTermDebt + Math.round(totalAssets * 0.05);
    out.push({
      fy: params.startYear + i,
      revenue: Math.round(revenue),
      netIncome,
      shares: Math.round(shares),
      dps: eps > 0 ? Math.round(eps * params.payout * 100) / 100 : 0,
      currentAssets,
      currentLiabilities,
      longTermDebt,
      totalAssets,
      totalLiabilities,
      goodwill: Math.round(totalAssets * 0.04),
      operatingCashFlow: Math.round(netIncome * 1.25),
      capex: Math.round(revenue * 0.04),
    });
  }
  return out;
}

export const FIXTURE_COMPANIES: FixtureCompany[] = [
  {
    ticker: "FXTR",
    name: "Fixture Industries Inc. (DEV FIXTURE)",
    nameHe: "פיקסצ'ר תעשיות (נתוני פיתוח)",
    cik: "9900000001",
    sector: "Industrials (fictional)",
    isUtility: false,
    priceToEarnings: 13,
    years: buildYears({
      seed: 7,
      startYear: 2014,
      count: 12,
      revenue0: 800_000_000,
      growth: 0.05,
      margins: [0.08, 0.085, 0.09, 0.082, 0.088],
      shares0: 50_000_000,
      payout: 0.4,
      debtRatio: 0.55,
    }),
  },
  {
    ticker: "PHTX",
    name: "Placeholder Technologies Corp. (DEV FIXTURE)",
    nameHe: "פלייסהולדר טכנולוגיות (נתוני פיתוח)",
    cik: "9900000002",
    sector: "Technology (fictional)",
    isUtility: false,
    priceToEarnings: 32,
    years: buildYears({
      seed: 11,
      startYear: 2018,
      count: 8,
      revenue0: 60_000_000,
      growth: 0.22,
      margins: [-0.05, 0.02, -0.01, 0.06, 0.09, 0.11, 0.12, 0.13],
      shares0: 80_000_000,
      payout: 0,
      debtRatio: 1.4,
    }),
  },
];

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);

/**
 * Emit SEC companyfacts-shaped JSON. Each fictional 10-K reports the current
 * year plus two comparative years (flows) / one comparative year (balance
 * sheet), and revenue switches tag in 2018 — mirroring real EDGAR quirks.
 */
export function fixtureCompanyFacts(c: FixtureCompany): CompanyFacts {
  const gaap: Record<string, { label: string; units: Record<string, SecFact[]> }> = {};
  const add = (tag: string, unit: string, fact: SecFact) => {
    gaap[tag] ??= { label: tag, units: {} };
    (gaap[tag].units[unit] ??= []).push(fact);
  };
  const byFy = new Map(c.years.map((y) => [y.fy, y]));
  for (const filing of c.years) {
    const filed = iso(filing.fy + 1, 2, 25);
    const accn = `99${c.cik.slice(-4)}-${String(filing.fy + 1).slice(-2)}-000001`;
    const meta = { accn, fy: filing.fy, fp: "FY", form: "10-K", filed };
    for (const fy of [filing.fy, filing.fy - 1, filing.fy - 2]) {
      const y = byFy.get(fy);
      if (!y) continue;
      const span = { start: iso(fy, 1, 1), end: iso(fy, 12, 31) };
      const revenueTag = filing.fy >= 2018 ? "RevenueFromContractWithCustomerExcludingAssessedTax" : "SalesRevenueNet";
      add(revenueTag, "USD", { ...span, val: y.revenue, ...meta });
      add("NetIncomeLoss", "USD", { ...span, val: y.netIncome, ...meta });
      add("EarningsPerShareDiluted", "USD/shares", { ...span, val: Math.round((y.netIncome / y.shares) * 100) / 100, ...meta });
      add("WeightedAverageNumberOfDilutedSharesOutstanding", "shares", { ...span, val: y.shares, ...meta });
      if (y.dps > 0) add("CommonStockDividendsPerShareDeclared", "USD/shares", { ...span, val: y.dps, ...meta });
      add("NetCashProvidedByUsedInOperatingActivities", "USD", { ...span, val: y.operatingCashFlow, ...meta });
      add("PaymentsToAcquirePropertyPlantAndEquipment", "USD", { ...span, val: y.capex, ...meta });
      add("OperatingIncomeLoss", "USD", { ...span, val: Math.round(y.netIncome * 1.35), ...meta });
      add("InterestExpense", "USD", { ...span, val: Math.round(y.longTermDebt * 0.045), ...meta });
    }
    for (const fy of [filing.fy, filing.fy - 1]) {
      const y = byFy.get(fy);
      if (!y) continue;
      const end = iso(fy, 12, 31);
      const equity = y.totalAssets - y.totalLiabilities;
      add("Assets", "USD", { end, val: y.totalAssets, ...meta });
      add("AssetsCurrent", "USD", { end, val: y.currentAssets, ...meta });
      add("LiabilitiesCurrent", "USD", { end, val: y.currentLiabilities, ...meta });
      add("Liabilities", "USD", { end, val: y.totalLiabilities, ...meta });
      add("LongTermDebtNoncurrent", "USD", { end, val: y.longTermDebt, ...meta });
      add("StockholdersEquity", "USD", { end, val: equity, ...meta });
      add("LiabilitiesAndStockholdersEquity", "USD", { end, val: y.totalAssets, ...meta });
      add("Goodwill", "USD", { end, val: y.goodwill, ...meta });
      add("CommonStockSharesOutstanding", "shares", { end, val: y.shares, ...meta });
    }
  }
  return { cik: Number(c.cik), entityName: c.name, facts: { "us-gaap": gaap } };
}

/**
 * Fictional daily closes on weekdays from `start` to `end`: a seeded random
 * walk around `priceToEarnings × EPS` of the relevant fiscal year.
 */
export function fixturePriceHistory(c: FixtureCompany, start: string, end: string): {
  bars: NormalizedPriceBar[];
  dividends: NormalizedDividend[];
} {
  const rnd = mulberry32(c.cik.length * 1000 + Number(c.cik.slice(-2)));
  const bars: NormalizedPriceBar[] = [];
  const dividends: NormalizedDividend[] = [];
  const epsByYear = new Map(c.years.map((y) => [y.fy, y.netIncome / y.shares]));
  const lastEps = c.years[c.years.length - 1].netIncome / c.years[c.years.length - 1].shares;
  let drift = 1;
  for (let t = Date.parse(start + "T00:00:00Z"); t <= Date.parse(end + "T00:00:00Z"); t += 86_400_000) {
    const d = new Date(t);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const year = d.getUTCFullYear();
    const e = Math.max(epsByYear.get(year - 1) ?? lastEps, 0.25);
    drift = Math.min(1.35, Math.max(0.7, drift * (1 + (rnd() - 0.5) * 0.03)));
    const close = Math.round(e * c.priceToEarnings * drift * 100) / 100;
    const spread = close * 0.012 * rnd();
    const open = Math.round((close + (rnd() - 0.5) * spread) * 100) / 100;
    const high = Math.round(Math.max(open, close, close + spread) * 100) / 100;
    const low = Math.round(Math.min(open, close, close - spread) * 100) / 100;
    const date = d.toISOString().slice(0, 10);
    bars.push({ date, open, high, low, close, adjClose: close, volume: Math.round(200_000 + rnd() * 800_000), currency: "USD" });
    const fy = c.years.find((y) => y.fy === year - 1) ?? c.years[c.years.length - 1];
    if (fy.dps > 0 && d.getUTCDate() <= 7 && [3, 6, 9, 12].includes(d.getUTCMonth() + 1) && dow === 3) {
      dividends.push({ exDate: date, amount: Math.round((fy.dps / 4) * 100) / 100, currency: "USD" });
    }
  }
  return { bars: validatePriceBars(bars).bars, dividends };
}
