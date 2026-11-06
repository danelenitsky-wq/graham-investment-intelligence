import "server-only";
import { httpGet } from "../http";
import { ProviderError, type FetchMeta, type ProviderDescriptor } from "../types";
import { boiSeriesCode, BoiParseError, parseBoiCsv, type BoiRate } from "./parse";

/** Bank of Israel — official representative exchange rates (free, public, no key). */
export const BOI: ProviderDescriptor = {
  key: "boi",
  name: "Bank of Israel (representative exchange rates)",
  capabilities: ["REFERENCE"],
  markets: ["IL"],
  baseUrl: "https://edge.boi.org.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0",
  termsUrl: "https://www.boi.org.il/en/economic-roles/statistics/",
  requiredEnv: [],
  isDevFixture: false,
};

export async function fetchBoiRates(base: string, quote: string, range: { start: string; end: string }): Promise<{ rates: BoiRate[]; meta: FetchMeta }> {
  const url = `${BOI.baseUrl}/${boiSeriesCode(base, quote)}?startperiod=${range.start}&endperiod=${range.end}&format=csv`;
  const res = await httpGet(BOI.key, url, { headers: { Accept: "text/csv" } });
  try {
    const rates = parseBoiCsv(res.text, { base, quote });
    return { rates, meta: { endpoint: res.endpoint, httpStatus: res.status, payloadHash: res.payloadHash, fetchedAt: new Date().toISOString() } };
  } catch (e) {
    if (e instanceof BoiParseError) throw new ProviderError(BOI.key, "PARSE_ERROR", e.message, res.status, res.endpoint);
    throw e;
  }
}
