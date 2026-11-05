/**
 * Daily new-filing check, change detection and statement verification against
 * a real PostgreSQL with scripted providers (synthetic values, no network).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { NormalizedAnnualPeriod, NormalizationResult } from "@/lib/normalization/statements";
import type { FilingRef, FundamentalsProvider, FilingsProvider, ProviderDescriptor, VerificationStatementsProvider } from "@/lib/providers/types";
import type { SourcedPeriod } from "@/lib/verification";

const SEC: ProviderDescriptor = { key: "sec-edgar", name: "SEC EDGAR (XBRL company facts)", capabilities: ["FUNDAMENTALS", "FILINGS"], markets: ["US"], baseUrl: "https://data.sec.gov", requiredEnv: [], isDevFixture: false };
const VER: ProviderDescriptor = { key: "fake-verifier", name: "fake verifier", capabilities: ["VERIFICATION"], markets: ["US"], baseUrl: "https://verifier.test", requiredEnv: [], isDevFixture: false };

const state = {
  filings: [] as FilingRef[],
  accession: "0000000001-26-000001",
  netIncome: 100_000_000,
  verifierNetIncome: 100_000_000,
  fundamentalsCalls: 0,
};

function period(fy: number, accession: string, netIncome: number): NormalizedAnnualPeriod {
  const v = (value: number, tag: string, unit = "USD") => ({ value, sourceConcept: tag, unit, accessionNumber: accession, filedAt: `${fy + 1}-02-15`, form: "10-K", restated: false, splitAdjusted: false });
  return {
    fiscalYear: fy,
    fiscalPeriod: "FY",
    periodStart: `${fy}-01-01`,
    periodEnd: `${fy}-12-31`,
    currency: "USD",
    values: {
      revenue: v(1_000_000_000, "us-gaap:Revenues"),
      netIncome: v(netIncome, "us-gaap:NetIncomeLoss"),
      epsDiluted: v(netIncome / 50_000_000, "us-gaap:EarningsPerShareDiluted", "USD/shares"),
      totalAssets: v(2_000_000_000, "us-gaap:Assets"),
      currentAssets: v(800_000_000, "us-gaap:AssetsCurrent"),
      currentLiabilities: v(300_000_000, "us-gaap:LiabilitiesCurrent"),
      stockholdersEquity: v(1_200_000_000, "us-gaap:StockholdersEquity"),
    },
  };
}

const fundamentals: FundamentalsProvider = {
  descriptor: SEC,
  async getAnnualFinancials() {
    state.fundamentalsCalls++;
    const result: NormalizationResult = { entityName: "Synthetic", currency: "USD", periods: [period(2025, state.accession, state.netIncome)], warnings: [] };
    return { result, quarterly: { ...result, periods: [] }, meta: { endpoint: "https://data.sec.gov/api/xbrl/companyfacts/CIK0000000001.json", httpStatus: 200, payloadHash: `${state.accession}:${state.netIncome}`, fetchedAt: new Date().toISOString() } };
  },
};
const filings: FilingsProvider = {
  descriptor: SEC,
  async latestPeriodicFilings() {
    return { filings: state.filings, meta: { endpoint: "https://data.sec.gov/submissions/CIK0000000001.json", httpStatus: 200, payloadHash: "f", fetchedAt: new Date().toISOString() } };
  },
};
const verifier: VerificationStatementsProvider = {
  descriptor: VER,
  async getStatements(_ref, p) {
    const periods: SourcedPeriod[] =
      p === "annual" ? [{ periodEnd: "2025-12-31", fiscalYear: 2025, fiscalPeriod: "FY", values: { revenue: 1_000_000_000, netIncome: state.verifierNetIncome, totalAssets: 2_000_000_000 }, reference: "verifier FY2025" }] : [];
    return { periods, currency: "USD", meta: { endpoint: "https://verifier.test/income", httpStatus: 200, payloadHash: "v", fetchedAt: new Date().toISOString() } };
  },
};

vi.mock("@/lib/providers/registry", () => ({
  quoteProvidersFor: () => [],
  providerStatuses: () => [],
  fundamentalsProviderFor: () => fundamentals,
  filingsProviderFor: () => filings,
  verificationStatementsProviderFor: () => verifier,
}));

const { db } = await import("@/server/db");
const { refreshFundamentals } = await import("@/server/ingestion");
const { checkFilings } = await import("@/server/filings");
const { verifyFundamentals } = await import("@/server/verification");
const { getSecurityAnalysis, saveAnalysisSnapshots } = await import("@/server/analysis");
const { getMetricProvenance } = await import("@/server/provenance");

let securityId = "";
const filing = (accessionNumber: string, filingDate: string): FilingRef => ({ accessionNumber, form: "10-K", filingDate, acceptedAt: null, reportDate: "2025-12-31", url: "https://www.sec.gov/Archives/edgar/data/1/x/" });

beforeAll(async () => {
  const exchange = await db.exchange.upsert({
    where: { code: "NYSE" },
    create: { code: "NYSE", mic: "XNYS", name: "New York Stock Exchange", market: "US", country: "US", currency: "USD", timezone: "America/New_York" },
    update: {},
  });
  await db.security.deleteMany({ where: { ticker: "ZZFIL" } });
  securityId = (await db.security.create({ data: { ticker: "ZZFIL", name: "Integration filings test (synthetic)", cik: "0000000001", exchangeId: exchange.id } })).id;
});

afterAll(async () => {
  await db.dataFetch.deleteMany({ where: { securityId } });
  await db.security.deleteMany({ where: { id: securityId } });
  await db.dataSource.deleteMany({ where: { key: "fake-verifier" } });
  await db.$disconnect();
});

describe("financial statements freshness", () => {
  it("stores statements, then detects an unchanged payload without rewriting", async () => {
    expect((await refreshFundamentals(securityId)).status).toBe("SUCCESS");
    expect(await db.financialStatement.count({ where: { securityId } })).toBeGreaterThan(0);
    expect((await refreshFundamentals(securityId)).status).toBe("UNCHANGED");
  });

  it("re-records calculations only when their inputs change", async () => {
    expect((await saveAnalysisSnapshots(securityId)).saved).toBe(true);
    expect((await saveAnalysisSnapshots(securityId)).saved).toBe(false);
  });

  it("daily check: up to date when the latest filing is already stored", async () => {
    state.filings = [filing(state.accession, "2026-02-15")];
    const calls = state.fundamentalsCalls;
    const r = await checkFilings(securityId, { force: true });
    expect(r.status).toBe("UP_TO_DATE");
    expect(state.fundamentalsCalls).toBe(calls);
    // Not due again within 24 h.
    expect((await checkFilings(securityId)).status).toBe("NOT_DUE");
  });

  it("daily check: a newly published filing triggers a refresh and new calculations", async () => {
    state.accession = "0000000001-26-000099";
    state.netIncome = 120_000_000;
    state.verifierNetIncome = 120_000_000;
    state.filings = [filing(state.accession, "2026-03-01"), filing("0000000001-26-000001", "2026-02-15")];
    const r = await checkFilings(securityId, { force: true });
    expect(r).toMatchObject({ status: "NEW_FILING", refreshed: "SUCCESS", latest: { accessionNumber: "0000000001-26-000099" } });
    const ni = await db.financialLineItem.findFirst({ where: { concept: "netIncome", statement: { securityId } } });
    expect(Number(ni!.value)).toBe(120_000_000);
    expect(ni!.accessionNumber).toBe("0000000001-26-000099");
    const snaps = await db.analysisSnapshot.count({ where: { securityId, engine: "graham-defensive" } });
    expect(snaps).toBe(2);
  });

  it("verification: agreement is VERIFIED, disagreement is a CONFLICT that blocks analysis", async () => {
    let v = await verifyFundamentals(securityId);
    expect(v).toMatchObject({ status: "SUCCESS", conflicts: 0 });
    let li = await db.financialLineItem.findFirst({ where: { concept: "netIncome", statement: { securityId } } });
    expect(li!.verificationStatus).toBe("VERIFIED");

    state.verifierNetIncome = 90_000_000;
    v = await verifyFundamentals(securityId);
    expect(v.conflicts).toBe(1);
    li = await db.financialLineItem.findFirst({ where: { concept: "netIncome", statement: { securityId } } });
    expect(li!.verificationStatus).toBe("CONFLICT");

    const a = (await getSecurityAnalysis(securityId))!;
    expect(a.health.gate.sufficient).toBe(false);
    expect(a.health.gate.conflicting).toContain("netIncome FY2025");
    expect(a.health.gate.missing).toContain("price"); // no quote provider configured in this test
    expect(a.health.conflicts[0]).toMatchObject({ metric: "netIncome", primaryValue: 120_000_000, secondaryValue: 90_000_000 });
    // Earlier checks are superseded, not deleted.
    expect(await db.dataVerification.count({ where: { securityId, resolvedAt: { not: null } } })).toBeGreaterThan(0);
    expect(a.health.fundamentalsStatus.status).toBe("CONFLICTED");
  });

  it("provenance: every stored figure carries provider, source URL, period, filing date, retrieval time, unit and statuses", async () => {
    const p = await getMetricProvenance(securityId);
    const sec = p.records.filter((r) => r.provider.key === "sec-edgar");
    expect(sec.length).toBeGreaterThan(0);
    for (const r of sec) {
      expect(r.sourceUrl).toBe("https://www.sec.gov/Archives/edgar/data/1/000000000126000099/");
      expect(r.periodEnd).toBe("2025-12-31");
      expect(r.publishedAt).toBe("2026-02-15");
      expect(r.retrievedAt).not.toBeNull();
      // Retrieval time is now; the reporting period is a year earlier — never confused.
      expect(Date.parse(r.retrievedAt!)).toBeGreaterThan(Date.parse(r.periodEnd!) + 300 * 86_400_000);
      expect(r.unit).toBeTruthy();
      expect(r.verificationStatus).toBeTruthy();
    }
    const ni = sec.find((r) => r.metric === "netIncome")!;
    expect(ni).toMatchObject({ currency: "USD", unit: "USD", periodType: "ANNUAL", fiscalYear: 2025, form: "10-K", verificationStatus: "CONFLICT", status: "CONFLICTED" });
    expect(sec.find((r) => r.metric === "totalAssets")!.periodType).toBe("INSTANT");
    expect(p.coverage.annualYears).toEqual({ count: 1, first: 2025, last: 2025 });
  });
});
