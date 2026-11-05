import { describe, expect, it } from "vitest";
import { canonicalExchange, padCik, parseTickerExchangeFile } from "@/lib/providers/sec-edgar/parse";
import { parseTiingoPrices } from "@/lib/providers/tiingo/parse";
import { redactUrl } from "@/lib/providers/http";
import { FIXTURE_COMPANIES, fixtureCompanyFacts, fixturePriceHistory } from "@/lib/providers/dev-fixture";
import { normalizeCompanyFacts, toAnnualFinancials } from "@/lib/normalization/statements";
import { evaluateDefensive } from "@/lib/graham/rules";

describe("SEC parsers", () => {
  it("parses the ticker/exchange file and maps exchanges", () => {
    const entries = parseTickerExchangeFile({
      fields: ["cik", "name", "ticker", "exchange"],
      data: [
        [1234, "Example Corp", "exm", "Nasdaq"],
        [1234, "Example Corp", "EXM", "Nasdaq"], // duplicate
        [5678, "Other Inc", "OTH", "NYSE"],
        [9, "Unknown venue", "UNK", null],
      ],
    });
    expect(entries).toEqual([
      { ticker: "EXM", name: "Example Corp", exchangeCode: "NASDAQ", cik: "0000001234" },
      { ticker: "OTH", name: "Other Inc", exchangeCode: "NYSE", cik: "0000005678" },
    ]);
    expect(canonicalExchange("NYSE American")).toBe("NYSEAMERICAN");
    expect(padCik("320193")).toBe("0000320193");
  });
});

describe("Tiingo parser", () => {
  it("extracts bars, dividends and splits", () => {
    const r = parseTiingoPrices([
      { date: "2024-01-02T00:00:00.000Z", open: 10, high: 11, low: 9, close: 10, volume: 5, adjClose: 10, divCash: 0, splitFactor: 1 },
      { date: "2024-01-03T00:00:00.000Z", open: 5, high: 5.5, low: 4.5, close: 5, volume: 10, adjClose: 5, divCash: 0.1, splitFactor: 2 },
    ]);
    expect(r.bars).toHaveLength(2);
    expect(r.dividends).toEqual([{ exDate: "2024-01-03", amount: 0.1, currency: "USD" }]);
    expect(r.splits).toEqual([{ exDate: "2024-01-03", ratio: 2 }]);
  });
});

describe("secrets", () => {
  it("redacts credentials from URLs", () => {
    expect(redactUrl("https://api.example.com/x?token=abc&b=1")).toBe("https://api.example.com/x?token=REDACTED&b=1");
  });
});

describe("development fixtures", () => {
  it("are fictional, clearly labelled, and flow through the real normalization path", () => {
    for (const c of FIXTURE_COMPANIES) {
      expect(c.name).toMatch(/DEV FIXTURE/);
      expect(c.cik.startsWith("99")).toBe(true);
    }
    const result = normalizeCompanyFacts(fixtureCompanyFacts(FIXTURE_COMPANIES[0]), { splits: [] });
    expect(result.periods).toHaveLength(FIXTURE_COMPANIES[0].years.length);
    const r = evaluateDefensive({ annual: toAnnualFinancials(result.periods), price: null, isUtility: false });
    expect(r.rules).toHaveLength(7);
  });
  it("generate deterministic price paths", () => {
    const a = fixturePriceHistory(FIXTURE_COMPANIES[0], "2024-01-01", "2024-03-01");
    const b = fixturePriceHistory(FIXTURE_COMPANIES[0], "2024-01-01", "2024-03-01");
    expect(a).toEqual(b);
    expect(a.bars.length).toBeGreaterThan(30);
  });
});
