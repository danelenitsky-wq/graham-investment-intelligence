/**
 * Bank of Israel representative exchange rates — SDMX CSV parser (pure).
 *
 * Endpoint (public, no key):
 *   https://edge.boi.org.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/RER_USD_ILS?startperiod=YYYY-MM-DD&endperiod=YYYY-MM-DD&format=csv
 * Verified live on 2026-11-06 from the user's machine. Response header:
 *   SERIES_CODE,FREQ,BASE_CURRENCY,COUNTER_CURRENCY,UNIT_MEASURE,DATA_TYPE,DATA_SOURCE,TIME_COLLECT,CONF_STATUS,PUB_WEBSITE,UNIT_MULT,COMMENTS,TIME_PERIOD,OBS_VALUE,RELEASE_STATUS
 * e.g. RER_USD_ILS,D,USD,ILS,ILS,OF00,BOI_MRKT,V,F,Y,0,,2026-11-05,3.167,YP
 * Rates are published on Israeli business days only; no row is returned for
 * other days (nothing is filled in for them).
 */
import { parseCsv } from "@/lib/portfolio/import/csv";

export interface BoiRate {
  base: string;
  quote: string;
  date: string;
  rate: number;
  dataType: string | null;
  series: string;
}

export class BoiParseError extends Error {}

export function boiSeriesCode(base: string, quote: string) {
  return `RER_${base}_${quote}`;
}

export function parseBoiCsv(text: string, expected: { base: string; quote: string }): BoiRate[] {
  const t = parseCsv(text);
  const idx = (name: string) => t.header.findIndex((h) => h.trim().toUpperCase() === name);
  const iDate = idx("TIME_PERIOD");
  const iValue = idx("OBS_VALUE");
  const iBase = idx("BASE_CURRENCY");
  const iQuote = idx("COUNTER_CURRENCY");
  const iType = idx("DATA_TYPE");
  const iSeries = idx("SERIES_CODE");
  const iMult = idx("UNIT_MULT");
  if (iDate < 0 || iValue < 0) throw new BoiParseError("TIME_PERIOD / OBS_VALUE columns missing");
  const out: BoiRate[] = [];
  for (const r of t.rows) {
    const date = (r.cells[iDate] ?? "").trim();
    const raw = (r.cells[iValue] ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d+(\.\d+)?$/.test(raw)) continue;
    const base = iBase >= 0 ? r.cells[iBase].trim() : expected.base;
    const quote = iQuote >= 0 ? r.cells[iQuote].trim() : expected.quote;
    if (base !== expected.base || quote !== expected.quote) continue;
    const mult = iMult >= 0 && r.cells[iMult]?.trim() ? Number(r.cells[iMult]) : 0;
    // UNIT_MULT is a power of ten (0 = units); refuse anything else rather than mis-scale.
    if (!Number.isInteger(mult) || mult !== 0) continue;
    const rate = Number(raw);
    if (!(rate > 0)) continue;
    out.push({ base, quote, date, rate, dataType: iType >= 0 ? r.cells[iType].trim() || null : null, series: iSeries >= 0 ? r.cells[iSeries].trim() : boiSeriesCode(base, quote) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
