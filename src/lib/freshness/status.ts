/**
 * One status vocabulary for every dataset (pure):
 * FRESH · DELAYED · LAST_CLOSE · CACHED · STALE · UNAVAILABLE · CONFLICTED.
 *
 * Quotes are classified by `classifyQuote` (./quote). This module applies the
 * same vocabulary to filings-based data. Freshness of financial statements is
 * judged by the reporting period and by whether a newer filing exists, never
 * by when the API was last called: a statement retrieved a minute ago for a
 * fiscal year that ended two years ago is still STALE.
 */
import type { DatasetFreshness } from "./index";
import type { QuoteStatus } from "./quote";

export type DataStatus = QuoteStatus;

export const DATA_STATUSES: DataStatus[] = ["FRESH", "DELAYED", "LAST_CLOSE", "CACHED", "STALE", "UNAVAILABLE", "CONFLICTED"];

export type FundamentalsReason =
  | "NO_FILINGS_DATA"
  | "OPEN_CONFLICT"
  | "NEWER_FILING_NOT_LOADED"
  | "PERIOD_TOO_OLD"
  | "ANNUAL_REPORT_OVERDUE"
  | "LAST_REFRESH_FAILED"
  | "LATEST_FILING_LOADED";

export function fundamentalsStatus(input: {
  freshness: DatasetFreshness;
  newerFiling: boolean;
  lastRefreshFailed: boolean;
  conflicted: boolean;
}): { status: DataStatus; reasons: FundamentalsReason[] } {
  const { freshness, newerFiling, lastRefreshFailed, conflicted } = input;
  if (freshness.level === "MISSING") return { status: "UNAVAILABLE", reasons: ["NO_FILINGS_DATA"] };
  if (conflicted) return { status: "CONFLICTED", reasons: ["OPEN_CONFLICT"] };
  if (newerFiling) return { status: "STALE", reasons: ["NEWER_FILING_NOT_LOADED"] };
  if (freshness.level === "STALE") return { status: "STALE", reasons: ["PERIOD_TOO_OLD"] };
  if (lastRefreshFailed) return { status: "CACHED", reasons: ["LAST_REFRESH_FAILED"] };
  // Older than a normal annual cycle (fiscal year end + filing lag): the next annual report is late.
  if (freshness.level === "AGING") return { status: "DELAYED", reasons: ["ANNUAL_REPORT_OVERDUE"] };
  return { status: "FRESH", reasons: ["LATEST_FILING_LOADED"] };
}

/** Status of one stored figure: its own conflict wins, otherwise its dataset's status. */
export function metricStatus(dataset: DataStatus, verification: string | null | undefined): DataStatus {
  if (verification === "CONFLICT") return "CONFLICTED";
  return dataset;
}
