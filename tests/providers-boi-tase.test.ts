import { describe, expect, it } from "vitest";
import { boiSeriesCode, parseBoiCsv } from "@/lib/providers/boi/parse";
import { parseTradeSecuritiesList, resolveTaseSymbol } from "@/lib/providers/tase/parse";
import { classifyManualQuote } from "@/lib/freshness/quote";

const HEADER = "SERIES_CODE,FREQ,BASE_CURRENCY,COUNTER_CURRENCY,UNIT_MEASURE,DATA_TYPE,DATA_SOURCE,TIME_COLLECT,CONF_STATUS,PUB_WEBSITE,UNIT_MULT,COMMENTS,TIME_PERIOD,OBS_VALUE,RELEASE_STATUS";

describe("Bank of Israel representative rates", () => {
  it("parses the SDMX CSV, sorted, and skips rows it cannot trust", () => {
    const csv = [
      HEADER,
      "RER_USD_ILS,D,USD,ILS,ILS,OF00,BOI_MRKT,V,F,Y,0,,2026-11-05,3.167,YP",
      "RER_USD_ILS,D,USD,ILS,ILS,OF00,BOI_MRKT,V,F,Y,0,,2026-11-04,3.151,YP",
      "RER_USD_ILS,D,USD,ILS,ILS,OF00,BOI_MRKT,V,F,Y,3,,2026-11-03,3151,YP",
      "RER_EUR_ILS,D,EUR,ILS,ILS,OF00,BOI_MRKT,V,F,Y,0,,2026-11-05,3.6,YP",
      "RER_USD_ILS,D,USD,ILS,ILS,OF00,BOI_MRKT,V,F,Y,0,,2026-11-02,,YP",
    ].join("\n");
    const r = parseBoiCsv(csv, { base: "USD", quote: "ILS" });
    expect(r.map((x) => [x.date, x.rate])).toEqual([
      ["2026-11-04", 3.151],
      ["2026-11-05", 3.167],
    ]);
    expect(r[0]).toMatchObject({ series: "RER_USD_ILS", dataType: "OF00" });
    expect(boiSeriesCode("USD", "ILS")).toBe("RER_USD_ILS");
  });
});

describe("TASE Data Hub securities list", () => {
  it("maps symbols to security numbers and refuses ambiguous symbols", () => {
    const list = parseTradeSecuritiesList({
      tradeSecuritiesList: {
        result: [
          { tradeDate: "2026-11-05T00:00:00", securityId: 629014, symbol: "teva", isin: "IL0006290147", companyName: "Teva" },
          { securityId: "1111", symbol: "DUP" },
          { securityId: "2222", symbol: "DUP" },
        ],
        total: 3,
      },
    })!;
    expect(list[0]).toMatchObject({ securityNumber: "629014", symbol: "TEVA", isin: "IL0006290147", tradeDate: "2026-11-05" });
    expect(resolveTaseSymbol(list, "teva")).toMatchObject({ status: "FOUND", ref: { securityNumber: "629014" } });
    expect(resolveTaseSymbol(list, "629014").status).toBe("FOUND");
    expect(resolveTaseSymbol(list, "DUP").status).toBe("AMBIGUOUS");
    expect(resolveTaseSymbol(list, "NONE").status).toBe("NOT_FOUND");
    expect(parseTradeSecuritiesList({ unexpected: true })).toBeNull();
  });
});

describe("manual quotes", () => {
  const now = new Date("2026-11-06T12:00:00Z");
  it("are never fresh: DELAYED while recent, STALE when old or future-dated", () => {
    expect(classifyManualQuote({ sourceTimestamp: "2026-11-05T15:25:00Z", now, staleAfterDays: 5 })).toMatchObject({ status: "DELAYED", reasons: ["MANUAL_ENTRY"] });
    expect(classifyManualQuote({ sourceTimestamp: "2026-10-01T15:25:00Z", now, staleAfterDays: 5 })).toMatchObject({ status: "STALE", reasons: ["MANUAL_ENTRY", "MANUAL_TOO_OLD"] });
    expect(classifyManualQuote({ sourceTimestamp: "2026-11-07T15:25:00Z", now, staleAfterDays: 5 }).status).toBe("STALE");
  });
});
