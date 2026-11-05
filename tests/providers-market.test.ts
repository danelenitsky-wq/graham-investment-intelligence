import { afterEach, describe, expect, it, vi } from "vitest";
import { httpGet, bodySnippet } from "@/lib/providers/http";
import { ProviderError } from "@/lib/providers/types";
import { fmpQuoteSchema, mergeFmpStatements, parseFmpDividends, parseFmpQuote, parseFmpSplits } from "@/lib/providers/fmp/parse";
import { parseTiingoEodQuote, parseTiingoIex } from "@/lib/providers/tiingo/parse";
import { filingUrl, parsePeriodicFilings } from "@/lib/providers/sec-edgar/parse";
import { normalizeQuarterlyFacts } from "@/lib/normalization/statements";
import type { CompanyFacts } from "@/lib/providers/sec-edgar/types";

// Shapes follow the providers' documented responses; values are synthetic test data.

describe("FMP parsers", () => {
  it("parses a quote, keeping the provider timestamp and converting percent units", () => {
    const rows = fmpQuoteSchema.parse([
      { symbol: "TEST", name: "Test Co", price: 101, changePercentage: 1, change: 1, previousClose: 100, marketCap: 1e9, yearHigh: 120, yearLow: 80, exchange: "NASDAQ", timestamp: 1_793_890_800 },
    ]);
    const q = parseFmpQuote(rows, { currency: "USD", feed: "REALTIME", delayMinutes: null })!;
    expect(q.sourceTimestamp).toBe(new Date(1_793_890_800 * 1000).toISOString());
    expect(q.changePercent).toBeCloseTo(0.01);
    expect(q).toMatchObject({ price: 101, previousClose: 100, marketCap: 1e9, yearHigh: 120, yearLow: 80, exchange: "NASDAQ", feed: "REALTIME" });
  });

  it("rejects a quote without a usable price or timestamp", () => {
    expect(parseFmpQuote([], { currency: "USD", feed: "REALTIME", delayMinutes: null })).toBeNull();
    expect(fmpQuoteSchema.safeParse([{ symbol: "X", price: 10 }]).success).toBe(false);
  });

  it("merges income, balance and cash-flow rows into sourced periods", () => {
    const base = { date: "2025-12-31", reportedCurrency: "USD", fiscalYear: "2025", period: "FY", filingDate: "2026-02-20" };
    const r = mergeFmpStatements(
      [{ ...base, revenue: 1000, netIncome: 100, epsDiluted: 1.1 }],
      [{ ...base, totalAssets: 5000, totalCurrentAssets: 2000, totalCurrentLiabilities: 900, totalStockholdersEquity: 3000 }],
      [{ ...base, operatingCashFlow: 150, capitalExpenditure: -40 }],
    );
    expect(r.currency).toBe("USD");
    expect(r.periods).toHaveLength(1);
    expect(r.periods[0]).toMatchObject({ periodEnd: "2025-12-31", fiscalYear: 2025, fiscalPeriod: "FY" });
    expect(r.periods[0].values).toMatchObject({ revenue: 1000, totalAssets: 5000, currentAssets: 2000, operatingCashFlow: 150, capitalExpenditures: -40 });
    expect(r.periods[0].values.goodwill).toBeUndefined(); // absent stays absent
  });

  it("parses dividends and splits", () => {
    expect(parseFmpDividends([{ date: "2024-02-09", dividend: 0.24 }, { date: "2023-11-10", dividend: 0.24 }, { date: "2023-08-11", dividend: 0 }], "USD")).toEqual([
      { exDate: "2023-11-10", amount: 0.24, currency: "USD" },
      { exDate: "2024-02-09", amount: 0.24, currency: "USD" },
    ]);
    expect(parseFmpSplits([{ date: "2020-08-31", numerator: 4, denominator: 1 }])).toEqual([{ exDate: "2020-08-31", ratio: 4 }]);
  });
});

describe("Tiingo IEX parser", () => {
  it("uses the actual IEX last sale and its timestamp, never tngoLast", () => {
    const q = parseTiingoIex([{ ticker: "test", last: 50.5, lastSaleTimestamp: "2026-11-04T15:00:01.123-05:00", prevClose: 50, tngoLast: 51 }])!;
    expect(q).toMatchObject({ price: 50.5, feed: "REALTIME", feedNote: "IEX_ONLY", sourceTimestamp: "2026-11-04T20:00:01.123Z" });
    expect(q.changePercent).toBeCloseTo(0.01);
    expect(parseTiingoIex([{ ticker: "test", last: null, tngoLast: 51, lastSaleTimestamp: null }])).toBeNull();
  });

  it("falls back to the latest official close, labelled EOD and stamped at the NY session close", () => {
    const q = parseTiingoEodQuote("aapl", [
      { date: "2026-11-04T00:00:00+00:00", close: 349.51, open: 341.565, high: 354.5, low: 340.99, volume: 89637749 },
      { date: "2026-11-03T00:00:00+00:00", close: 340 },
    ])!;
    expect(q).toMatchObject({ symbol: "AAPL", price: 349.51, previousClose: 340, feed: "EOD", feedNote: "TIINGO_EOD_CLOSE", sourceTimestamp: "2026-11-04T21:00:00.000Z" });
    expect(q.change).toBeCloseTo(9.51);
    // Early close (day after Thanksgiving 2026 closes at 13:00 ET).
    expect(parseTiingoEodQuote("x", [{ date: "2026-11-27", close: 10 }])!.sourceTimestamp).toBe("2026-11-27T18:00:00.000Z");
    expect(parseTiingoEodQuote("x", [])).toBeNull();
  });
});

describe("SEC submissions (new-filing detection)", () => {
  it("lists periodic reports newest first with the original filing URL", () => {
    const filings = parsePeriodicFilings({
      cik: "320193",
      name: "Test",
      filings: {
        recent: {
          accessionNumber: ["0000320193-26-000010", "0000320193-26-000009", "0000320193-25-000079"],
          filingDate: ["2026-01-30", "2026-01-29", "2025-10-31"],
          reportDate: ["", "2025-12-27", "2025-09-27"],
          acceptanceDateTime: ["2026-01-30T16:30:00.000Z", "2026-01-29T16:31:05.000Z", "2025-10-31T16:01:00.000Z"],
          form: ["8-K", "10-Q", "10-K"],
        },
      },
    });
    expect(filings.map((f) => f.form)).toEqual(["10-Q", "10-K"]);
    expect(filings[0]).toMatchObject({ accessionNumber: "0000320193-26-000009", filingDate: "2026-01-29", reportDate: "2025-12-27" });
    expect(filingUrl("0000320193", "0000320193-26-000009")).toBe("https://www.sec.gov/Archives/edgar/data/320193/000032019326000009/");
  });
});

describe("SEC quarterly normalization", () => {
  it("extracts discrete quarters with fiscal labels from the original 10-Q", () => {
    const fact = (start: string, end: string, val: number, fy: number, fp: string, form: string, filed: string, accn: string) => ({ start, end, val, fy, fp, form, filed, accn });
    const facts: CompanyFacts = {
      cik: 1,
      entityName: "Test",
      facts: {
        "us-gaap": {
          Assets: { units: { USD: [{ end: "2025-03-31", val: 900, fy: 2025, fp: "Q1", form: "10-Q", filed: "2025-05-01", accn: "a1" }] } },
          Revenues: {
            units: {
              USD: [
                fact("2025-01-01", "2025-03-31", 100, 2025, "Q1", "10-Q", "2025-05-01", "a1"),
                fact("2025-01-01", "2025-06-30", 210, 2025, "Q2", "10-Q", "2025-08-01", "a2"), // 6-month YTD: excluded
                fact("2025-04-01", "2025-06-30", 110, 2025, "Q2", "10-Q", "2025-08-01", "a2"),
                fact("2025-04-01", "2025-06-30", 111, 2026, "Q2", "10-Q", "2026-08-01", "a9"), // later comparative (restated)
              ],
            },
          },
        },
      },
    };
    const r = normalizeQuarterlyFacts(facts);
    expect(r.periods.map((p) => [p.fiscalYear, p.fiscalPeriod, p.periodEnd])).toEqual([
      [2025, "Q1", "2025-03-31"],
      [2025, "Q2", "2025-06-30"],
    ]);
    expect(r.periods[0].values.totalAssets?.value).toBe(900);
    expect(r.periods[1].values.revenue).toMatchObject({ value: 111, restated: true, accessionNumber: "a9" });
  });
});

describe("failed provider requests", () => {
  afterEach(() => vi.unstubAllGlobals());
  const respond = (status: number, body = "{}") => new Response(body, { status });

  it("maps 402 to NOT_ENTITLED without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(402, '{"Error Message":"Premium endpoint"}'));
    vi.stubGlobal("fetch", fetchMock);
    const err = await httpGet("fmp", "https://example.test/quote?apikey=SECRET", { retries: 2 }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.code).toBe("NOT_ENTITLED");
    expect(err.endpoint).toContain("apikey=REDACTED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries 429 and 5xx, then reports RATE_LIMITED / HTTP_ERROR", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => respond(429));
    vi.stubGlobal("fetch", fetchMock);
    const err = await httpGet("fmp", "https://example.test/q", { retries: 1 }).catch((e) => e);
    expect(err.code).toBe("RATE_LIMITED");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("recovers when a retry succeeds", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(respond(503)).mockResolvedValueOnce(respond(200, "[1]"));
    vi.stubGlobal("fetch", fetchMock);
    const r = await httpGet("fmp", "https://example.test/q", { retries: 2 });
    expect(r.status).toBe(200);
    expect(r.text).toBe("[1]");
  });

  it("reports network failures as NETWORK_ERROR", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const err = await httpGet("tiingo", "https://example.test/q", { retries: 0 }).catch((e) => e);
    expect(err.code).toBe("NETWORK_ERROR");
  });

  it("maps 401/403 to HTTP_ERROR and scrubs credentials from the message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(401, '{"detail":"Invalid token abcdefghijklmnopqrstuvwxyz123456"}')));
    const err = await httpGet("tiingo", "https://example.test/q", { retries: 0 }).catch((e) => e);
    expect(err.code).toBe("HTTP_ERROR");
    expect(err.message).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(bodySnippet("token=abcdefghijklmnopqrstuvwxyz123456")).toBe("token=***");
  });
});
