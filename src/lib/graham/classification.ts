/**
 * Issuer-type classification. Graham's Chapter 14/15 statistical tests are
 * written for industrial companies (with separate size and debt tests for
 * public utilities); they must not be applied blindly to banks, insurers,
 * REITs or funds.
 *
 * Classification uses the SEC Standard Industrial Classification code from
 * the EDGAR submissions record (https://www.sec.gov/search-filings/standard-industrial-classification-sic-code-list),
 * then the security's asset type, then the stored utility flag. When nothing
 * is known, an issuer without a classified balance sheet (no current assets /
 * current liabilities, typical of banks and insurers) is treated as financial.
 */
import type { AnnualFinancials } from "@/lib/normalization/statements";

export type IndustryClass = "INDUSTRIAL" | "UTILITY" | "BANK" | "INSURANCE" | "REIT" | "ETF" | "OTHER_FINANCIAL";

export interface IndustryClassification {
  industryClass: IndustryClass;
  basis: "SIC" | "ASSET_TYPE" | "UTILITY_FLAG" | "UNCLASSIFIED_BALANCE_SHEET" | "DEFAULT";
  sicCode: string | null;
}

/** SIC codes of regulated electric, gas, water and steam utilities (SIC 49xx, excluding waste management). */
const UTILITY_SIC = new Set(["4900", "4910", "4911", "4920", "4922", "4923", "4924", "4930", "4931", "4932", "4939", "4940", "4941", "4961", "4991"]);

export function classifyBySic(sic: string | null | undefined): IndustryClass | null {
  if (!sic || !/^\d{4}$/.test(sic)) return null;
  const n = Number(sic);
  if (UTILITY_SIC.has(sic)) return "UTILITY";
  if (n >= 6000 && n <= 6099) return "BANK"; // depository institutions
  if (n >= 6300 && n <= 6411) return "INSURANCE"; // insurance carriers, agents
  if (n === 6798) return "REIT";
  if ((n >= 6100 && n <= 6299) || (n >= 6700 && n <= 6799)) return "OTHER_FINANCIAL"; // credit, brokers, holding & investment offices, SPACs
  return "INDUSTRIAL";
}

export function classifyIssuer(params: {
  sicCode?: string | null;
  assetType?: string | null;
  isUtility?: boolean;
  latest?: AnnualFinancials | null;
}): IndustryClassification {
  const sicCode = params.sicCode ?? null;
  if (params.assetType === "ETF") return { industryClass: "ETF", basis: "ASSET_TYPE", sicCode };
  if (params.assetType === "REIT") return { industryClass: "REIT", basis: "ASSET_TYPE", sicCode };
  const bySic = classifyBySic(sicCode);
  if (bySic) return { industryClass: bySic, basis: "SIC", sicCode };
  if (params.isUtility) return { industryClass: "UTILITY", basis: "UTILITY_FLAG", sicCode };
  const v = params.latest?.values;
  if (v && v.totalAssets !== undefined && v.currentAssets === undefined && v.currentLiabilities === undefined) {
    return { industryClass: "OTHER_FINANCIAL", basis: "UNCLASSIFIED_BALANCE_SHEET", sicCode };
  }
  return { industryClass: "INDUSTRIAL", basis: "DEFAULT", sicCode };
}

export const isFinancialEnterprise = (c: IndustryClass) => c === "BANK" || c === "INSURANCE";
