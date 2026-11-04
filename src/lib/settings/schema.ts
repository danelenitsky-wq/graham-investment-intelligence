import { z } from "zod";
import { DEFAULT_FRESHNESS } from "@/lib/freshness";
import { ENTERPRISING_THRESHOLDS } from "@/lib/graham/rules";

/** A macro input the user typed in, with its provenance. */
export const manualValueSchema = z.object({
  value: z.number().positive(),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.string().min(1).max(200),
});
export type ManualValue = z.infer<typeof manualValueSchema>;

export const settingsSchema = z.object({
  /** Moody's Seasoned Aaa corporate bond yield, percent (e.g. 5.3). Used only by modern extensions. */
  aaaBondYield: manualValueSchema.nullable().default(null),
  /** Current CPI-U index level (1982-84 = 100). Used only by modern extensions. */
  currentCpi: manualValueSchema.nullable().default(null),
  freshness: z
    .object({
      priceAgingDays: z.number().int().min(1).max(60),
      priceStaleDays: z.number().int().min(1).max(365),
      fundamentalsAgingMonths: z.number().int().min(1).max(60),
      fundamentalsStaleMonths: z.number().int().min(1).max(120),
    })
    .default(DEFAULT_FRESHNESS),
  enterprisingLookbackYears: z.number().int().min(1).max(10).default(ENTERPRISING_THRESHOLDS.earningsGrowthLookbackYears),
  priceHistoryYears: z.number().int().min(1).max(40).default(20),
});
export type AppSettings = z.infer<typeof settingsSchema>;
export const SETTINGS_KEY = "app";
export const DEFAULT_SETTINGS: AppSettings = settingsSchema.parse({});
