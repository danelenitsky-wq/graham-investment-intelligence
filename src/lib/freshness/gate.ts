/**
 * Data sufficiency gate (pure). Downstream analysis (Graham screens, valuation,
 * margins of safety) is only presented as a conclusion when this gate passes;
 * otherwise the UI shows INSUFFICIENT VERIFIED DATA together with the reasons.
 *
 * A recent API retrieval does not prove the underlying information is recent:
 * fundamentals are judged by their fiscal period end and by whether a newer
 * filing exists than the one stored, not by when we last called the API.
 */
import type { CanonicalConcept } from "@/lib/normalization/concepts";
import type { DatasetFreshness } from "./index";
import { isUsableQuoteStatus, type QuoteStatus } from "./quote";

export const REQUIRED_CONCEPTS: CanonicalConcept[] = [
  "revenue",
  "netIncome",
  "epsDiluted",
  "totalAssets",
  "currentAssets",
  "currentLiabilities",
  "stockholdersEquity",
];

export type GateField = "price" | "financials" | `concept:${CanonicalConcept}` | "dividends";

export interface GateInput {
  quoteStatus: QuoteStatus;
  fundamentals: DatasetFreshness;
  /** Values of the latest annual period (missing = absent key). */
  latestAnnual: Partial<Record<CanonicalConcept, number>> | null;
  /** Unresolved conflicts on material metrics. */
  conflicts: { metric: string; fiscalYear: number | null; fiscalPeriod: string | null }[];
  /** A filing newer than the stored statements is known to exist. */
  newerFiling: { form: string; filedAt: string; accessionNumber: string } | null;
  quoteConflict: boolean;
  usesDevFixtureData: boolean;
}

export interface GateResult {
  sufficient: boolean;
  missing: GateField[];
  stale: GateField[];
  conflicting: string[];
  notes: ("DEV_FIXTURE" | "NEWER_FILING_AVAILABLE")[];
}

export function evaluateDataSufficiency(input: GateInput): GateResult {
  const missing: GateField[] = [];
  const stale: GateField[] = [];
  const conflicting: string[] = [];
  const notes: GateResult["notes"] = [];

  if (input.quoteStatus === "UNAVAILABLE") missing.push("price");
  else if (!isUsableQuoteStatus(input.quoteStatus)) stale.push("price");

  if (input.fundamentals.level === "MISSING" || !input.latestAnnual) missing.push("financials");
  else if (input.fundamentals.level === "STALE") stale.push("financials");

  if (input.latestAnnual) {
    for (const c of REQUIRED_CONCEPTS) if (input.latestAnnual[c] === undefined) missing.push(`concept:${c}`);
  }
  if (input.newerFiling) {
    stale.push("financials");
    notes.push("NEWER_FILING_AVAILABLE");
  }
  for (const c of input.conflicts) conflicting.push(`${c.metric}${c.fiscalYear ? ` FY${c.fiscalYear}` : ""}${c.fiscalPeriod && c.fiscalPeriod !== "FY" ? ` ${c.fiscalPeriod}` : ""}`);
  if (input.quoteConflict) conflicting.push("price");
  if (input.usesDevFixtureData) notes.push("DEV_FIXTURE");

  const uniq = <T,>(a: T[]) => [...new Set(a)];
  const result = { missing: uniq(missing), stale: uniq(stale), conflicting: uniq(conflicting), notes };
  return {
    ...result,
    sufficient: result.missing.length === 0 && result.stale.length === 0 && result.conflicting.length === 0 && !input.usesDevFixtureData,
  };
}
