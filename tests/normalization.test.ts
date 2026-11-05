import { describe, expect, it } from "vitest";
import { fiscalYearFromPeriodEnd, normalizeCompanyFacts, toAnnualFinancials } from "@/lib/normalization/statements";
import { normalizeCurrencyUnit, validatePriceBars, type NormalizedPriceBar } from "@/lib/normalization/market";
import type { CompanyFacts } from "@/lib/providers/sec-edgar/types";

/** Synthetic companyfacts payload in SEC's format (test-only, fictional issuer). */
function facts(): CompanyFacts {
  const f = (o: Record<string, unknown>) => ({ fp: "FY", fy: 2023, ...o }) as never;
  return {
    cik: 9999999999,
    entityName: "Test Issuer",
    facts: {
      dei: {
        EntityCommonStockSharesOutstanding: {
          label: "",
          units: { shares: [f({ end: "2024-02-15", val: 1_050, accn: "A-24", form: "10-K", filed: "2024-02-20" })] },
        },
      },
      "us-gaap": {
        SalesRevenueNet: {
          label: "",
          units: {
            USD: [
              f({ start: "2017-01-01", end: "2017-12-31", val: 900, accn: "A-18", form: "10-K", filed: "2018-02-20" }),
              f({ start: "2017-10-01", end: "2017-12-31", val: 250, accn: "A-18", form: "10-K", filed: "2018-02-20" }), // quarter: ignored
            ],
          },
        },
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          label: "",
          units: {
            USD: [
              f({ start: "2022-01-01", end: "2022-12-31", val: 1_000, accn: "A-23", form: "10-K", filed: "2023-02-20" }),
              // restated in the next annual report
              f({ start: "2022-01-01", end: "2022-12-31", val: 1_010, accn: "A-24", form: "10-K", filed: "2024-02-20" }),
              f({ start: "2023-01-01", end: "2023-12-31", val: 1_100, accn: "A-24", form: "10-K", filed: "2024-02-20" }),
              f({ start: "2023-01-01", end: "2023-03-31", val: 260, accn: "Q-23", form: "10-Q", filed: "2023-05-01" }), // 10-Q: ignored
            ],
          },
        },
        EarningsPerShareDiluted: {
          label: "",
          units: {
            "USD/shares": [
              f({ start: "2022-01-01", end: "2022-12-31", val: 4, accn: "A-23", form: "10-K", filed: "2023-02-20" }),
              f({ start: "2023-01-01", end: "2023-12-31", val: 2.2, accn: "A-24", form: "10-K", filed: "2024-02-20" }),
            ],
          },
        },
        Assets: {
          label: "",
          units: { USD: [f({ end: "2023-12-31", val: 5_000, accn: "A-24", form: "10-K", filed: "2024-02-20" })] },
        },
      },
    },
  };
}

describe("SEC companyfacts normalization", () => {
  it("builds annual periods from 10-K facts only, ignoring quarters and 10-Qs", () => {
    const r = normalizeCompanyFacts(facts(), { splits: [] });
    expect(r.periods.map((p) => p.fiscalYear)).toEqual([2017, 2022, 2023]);
    expect(r.currency).toBe("USD");
  });

  it("falls back to alternate tags per period (ASC 606 tag switch)", () => {
    const r = normalizeCompanyFacts(facts(), { splits: [] });
    const p2017 = r.periods.find((p) => p.fiscalYear === 2017)!;
    expect(p2017.values.revenue?.value).toBe(900);
    expect(p2017.values.revenue?.sourceConcept).toBe("us-gaap:SalesRevenueNet");
    const p2023 = r.periods.find((p) => p.fiscalYear === 2023)!;
    expect(p2023.values.revenue?.sourceConcept).toBe("us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax");
  });

  it("prefers the latest filing and flags restatements", () => {
    const p2022 = normalizeCompanyFacts(facts(), { splits: [] }).periods.find((p) => p.fiscalYear === 2022)!;
    expect(p2022.values.revenue?.value).toBe(1_010);
    expect(p2022.values.revenue?.restated).toBe(true);
    expect(p2022.values.revenue?.accessionNumber).toBe("A-24");
  });

  it("split-adjusts per-share values filed before a split", () => {
    const r = normalizeCompanyFacts(facts(), { splits: [{ exDate: "2023-06-01", ratio: 2 }] });
    const p2022 = r.periods.find((p) => p.fiscalYear === 2022)!;
    const p2023 = r.periods.find((p) => p.fiscalYear === 2023)!;
    expect(p2022.values.epsDiluted?.value).toBe(2); // filed 2023-02 (pre-split) → 4 / 2
    expect(p2022.values.epsDiluted?.splitAdjusted).toBe(true);
    expect(p2023.values.epsDiluted?.value).toBe(2.2); // filed after split: as reported
  });

  it("warns when split history is unknown and when fiscal years are missing", () => {
    const codes = normalizeCompanyFacts(facts()).warnings.map((w) => w.code);
    expect(codes).toContain("PER_SHARE_NOT_SPLIT_ADJUSTED");
    expect(codes).toContain("MISSING_FISCAL_YEARS");
  });

  it("matches dei cover-page share counts dated shortly after year end", () => {
    const p2023 = normalizeCompanyFacts(facts(), { splits: [] }).periods.find((p) => p.fiscalYear === 2023)!;
    expect(p2023.values.sharesOutstanding?.value).toBe(1_050);
    expect(p2023.values.sharesOutstanding?.sourceConcept).toBe("dei:EntityCommonStockSharesOutstanding");
  });

  it("does not zero-fill missing concepts", () => {
    const annual = toAnnualFinancials(normalizeCompanyFacts(facts(), { splits: [] }).periods);
    expect(annual.find((a) => a.fiscalYear === 2017)!.values.totalAssets).toBeUndefined();
  });

  it("rejects IFRS-only filers explicitly", () => {
    const r = normalizeCompanyFacts({ cik: 1, entityName: "IFRS Co", facts: { "ifrs-full": {} } });
    expect(r.periods).toHaveLength(0);
    expect(r.warnings[0].code).toBe("UNSUPPORTED_TAXONOMY");
  });

  it("labels 52/53-week years ending in early January as the prior fiscal year", () => {
    expect(fiscalYearFromPeriodEnd("2022-01-01")).toBe(2021);
    expect(fiscalYearFromPeriodEnd("2024-01-28")).toBe(2024);
    expect(fiscalYearFromPeriodEnd("2023-09-30")).toBe(2023);
  });
});

describe("market data normalization", () => {
  const bar = (date: string, o: Partial<NormalizedPriceBar> = {}): NormalizedPriceBar => ({
    date, open: 10, high: 11, low: 9, close: 10.5, adjClose: 10.5, volume: 100, currency: "USD", ...o,
  });

  it("rejects invalid bars instead of repairing them", () => {
    const { bars, rejected } = validatePriceBars([
      bar("2024-01-03"),
      bar("2024-01-02"),
      bar("2024-01-02"),
      bar("2024-01-04", { close: 0 }),
      bar("2024-01-05", { high: 9, low: 11 }),
      bar("2024-01-08", { close: 12 }),
      bar("2024-13-01"),
    ]);
    expect(bars.map((b) => b.date)).toEqual(["2024-01-02", "2024-01-03"]);
    expect(rejected.map((r) => r.reason).sort()).toEqual(
      ["DUPLICATE_DATE", "INVALID_DATE", "NON_POSITIVE_CLOSE", "OHLC_INCONSISTENT", "OHLC_INCONSISTENT"].sort(),
    );
  });

  it("converts TASE agorot to shekels", () => {
    expect(normalizeCurrencyUnit(4520, "ILA")).toEqual({ price: 45.2, currency: "ILS" });
    expect(normalizeCurrencyUnit(10, "USD")).toEqual({ price: 10, currency: "USD" });
  });
});
