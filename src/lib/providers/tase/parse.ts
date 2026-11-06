/**
 * TASE Data Hub (DataWise) — Securities Basic parser (pure).
 *
 * Free product, needs a free API key from https://openapi.tase.co.il.
 *   GET https://datawise.tase.co.il/v1/basic-securities/trade-securities-list/{yyyy}/{m}/{d}
 *   headers: apikey: <key>, accept: application/json, accept-language: en-US | he-IL
 * Response shape (per the open-source tasepy 0.2.1 client; the live endpoint
 * answered 401 without a key on 2026-11-06, so the shape is not yet verified
 * against a live payload — the parser rejects anything that does not match):
 *   { "tradeSecuritiesList": { "result": [ { "tradeDate", "securityId",
 *     "securityFullTypeCode", "isin", "corporateId", "issuerId", "securityName",
 *     "symbol", "companySuperSector", "companySector", "companySubSector",
 *     "companyName", ... } ], "total": n } }
 *
 * This product maps symbols ↔ TASE security numbers ↔ ISIN. It carries NO
 * prices: end-of-day and intraday trading data are separate TASE Data Hub
 * products that require commercial approval.
 */
import { z } from "zod";

const item = z.object({
  tradeDate: z.string().optional(),
  securityId: z.union([z.number(), z.string()]),
  securityFullTypeCode: z.string().nullish(),
  isin: z.string().nullish(),
  securityName: z.string().nullish(),
  symbol: z.string().nullish(),
  companyName: z.string().nullish(),
  companySector: z.string().nullish(),
  companySubSector: z.string().nullish(),
});

export const tradeSecuritiesListSchema = z.object({
  tradeSecuritiesList: z.object({ result: z.array(item.passthrough()), total: z.number().optional() }),
});

export interface TaseSecurityRef {
  securityNumber: string;
  symbol: string | null;
  isin: string | null;
  securityName: string | null;
  companyName: string | null;
  sector: string | null;
  typeCode: string | null;
  tradeDate: string | null;
}

export function parseTradeSecuritiesList(json: unknown): TaseSecurityRef[] | null {
  const parsed = tradeSecuritiesListSchema.safeParse(json);
  if (!parsed.success) return null;
  return parsed.data.tradeSecuritiesList.result.map((r) => ({
    securityNumber: String(r.securityId),
    symbol: r.symbol?.trim().toUpperCase() || null,
    isin: r.isin?.trim() || null,
    securityName: r.securityName?.trim() || null,
    companyName: r.companyName?.trim() || null,
    sector: r.companySector?.trim() || null,
    typeCode: r.securityFullTypeCode ?? null,
    tradeDate: r.tradeDate ? r.tradeDate.slice(0, 10) : null,
  }));
}

/** A symbol maps to a security only when exactly one traded security carries it. */
export function resolveTaseSymbol(list: TaseSecurityRef[], symbol: string): { status: "FOUND"; ref: TaseSecurityRef } | { status: "NOT_FOUND" } | { status: "AMBIGUOUS"; refs: TaseSecurityRef[] } {
  const s = symbol.trim().toUpperCase();
  const hits = list.filter((r) => r.symbol === s || r.securityNumber === s);
  if (hits.length === 0) return { status: "NOT_FOUND" };
  if (hits.length > 1) return { status: "AMBIGUOUS", refs: hits };
  return { status: "FOUND", ref: hits[0] };
}
