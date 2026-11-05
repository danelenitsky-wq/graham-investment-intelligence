/** Pure parser for Tiingo end-of-day prices (https://www.tiingo.com/documentation/end-of-day). */
import { z } from "zod";
import { makeBar, toIsoDate, validatePriceBars, type NormalizedDividend, type NormalizedPriceBar, type NormalizedSplit } from "@/lib/normalization/market";

export const tiingoRowSchema = z.object({
  date: z.string(),
  open: z.number().nullable().optional(),
  high: z.number().nullable().optional(),
  low: z.number().nullable().optional(),
  close: z.number(),
  volume: z.number().nullable().optional(),
  adjClose: z.number().nullable().optional(),
  divCash: z.number().nullable().optional(),
  splitFactor: z.number().nullable().optional(),
});
export const tiingoResponseSchema = z.array(tiingoRowSchema);

export function parseTiingoPrices(rows: z.infer<typeof tiingoResponseSchema>, currency = "USD") {
  const bars: NormalizedPriceBar[] = [];
  const dividends: NormalizedDividend[] = [];
  const splits: NormalizedSplit[] = [];
  for (const r of rows) {
    const bar = makeBar({ ...r, currency });
    if (bar) bars.push(bar);
    const date = toIsoDate(r.date);
    if (!date) continue;
    if (r.divCash && r.divCash > 0) dividends.push({ exDate: date, amount: r.divCash, currency });
    if (r.splitFactor && r.splitFactor !== 1) splits.push({ exDate: date, ratio: r.splitFactor });
  }
  const validated = validatePriceBars(bars);
  return { bars: validated.bars, rejected: validated.rejected, dividends, splits };
}
