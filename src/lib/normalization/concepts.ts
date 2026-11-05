/**
 * Canonical financial concepts used throughout the platform, and how they map
 * from source taxonomies (US GAAP XBRL tags as published by SEC EDGAR).
 *
 * Mapping candidates are ordered by priority. Normalization picks, *per
 * period*, the first candidate that has a value for that period. That matters
 * because issuers switch tags over time (e.g. SalesRevenueNet →
 * RevenueFromContractWithCustomerExcludingAssessedTax after ASC 606 in 2018).
 */

export type StatementKind = "INCOME" | "BALANCE_SHEET" | "CASH_FLOW";
export type ConceptUnit = "currency" | "shares" | "perShare";

export interface ConceptDefinition {
  statement: StatementKind;
  unit: ConceptUnit;
  /** Balance-sheet items are point-in-time ("instant"); flows have a duration. */
  instant: boolean;
  /** Ordered list of `taxonomy:Tag` candidates. */
  candidates: readonly string[];
}

export const CONCEPTS = {
  // Income statement
  revenue: {
    statement: "INCOME",
    unit: "currency",
    instant: false,
    candidates: [
      "us-gaap:Revenues",
      "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
      "us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax",
      "us-gaap:SalesRevenueNet",
      "us-gaap:SalesRevenueGoodsNet",
      "us-gaap:RevenuesNetOfInterestExpense",
    ],
  },
  operatingIncome: {
    statement: "INCOME",
    unit: "currency",
    instant: false,
    candidates: ["us-gaap:OperatingIncomeLoss"],
  },
  pretaxIncome: {
    statement: "INCOME",
    unit: "currency",
    instant: false,
    candidates: [
      "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
      "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
    ],
  },
  interestExpense: {
    statement: "INCOME",
    unit: "currency",
    instant: false,
    candidates: ["us-gaap:InterestExpense", "us-gaap:InterestExpenseNonoperating", "us-gaap:InterestExpenseDebt"],
  },
  netIncome: {
    statement: "INCOME",
    unit: "currency",
    instant: false,
    // Net income attributable to the parent (excludes non-controlling interests).
    candidates: ["us-gaap:NetIncomeLoss", "us-gaap:NetIncomeLossAvailableToCommonStockholdersBasic"],
  },
  epsBasic: {
    statement: "INCOME",
    unit: "perShare",
    instant: false,
    candidates: ["us-gaap:EarningsPerShareBasic", "us-gaap:EarningsPerShareBasicAndDiluted"],
  },
  epsDiluted: {
    statement: "INCOME",
    unit: "perShare",
    instant: false,
    candidates: ["us-gaap:EarningsPerShareDiluted", "us-gaap:EarningsPerShareBasicAndDiluted"],
  },
  dilutedShares: {
    statement: "INCOME",
    unit: "shares",
    instant: false,
    candidates: ["us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding"],
  },
  dividendsPerShare: {
    statement: "INCOME",
    unit: "perShare",
    instant: false,
    candidates: ["us-gaap:CommonStockDividendsPerShareDeclared", "us-gaap:CommonStockDividendsPerShareCashPaid"],
  },

  // Balance sheet
  totalAssets: { statement: "BALANCE_SHEET", unit: "currency", instant: true, candidates: ["us-gaap:Assets"] },
  currentAssets: { statement: "BALANCE_SHEET", unit: "currency", instant: true, candidates: ["us-gaap:AssetsCurrent"] },
  cashAndEquivalents: {
    statement: "BALANCE_SHEET",
    unit: "currency",
    instant: true,
    candidates: [
      "us-gaap:CashAndCashEquivalentsAtCarryingValue",
      "us-gaap:CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    ],
  },
  accountsReceivable: {
    statement: "BALANCE_SHEET",
    unit: "currency",
    instant: true,
    candidates: ["us-gaap:AccountsReceivableNetCurrent", "us-gaap:ReceivablesNetCurrent"],
  },
  inventory: { statement: "BALANCE_SHEET", unit: "currency", instant: true, candidates: ["us-gaap:InventoryNet"] },
  goodwill: { statement: "BALANCE_SHEET", unit: "currency", instant: true, candidates: ["us-gaap:Goodwill"] },
  intangibleAssets: {
    statement: "BALANCE_SHEET",
    unit: "currency",
    instant: true,
    candidates: ["us-gaap:IntangibleAssetsNetExcludingGoodwill", "us-gaap:FiniteLivedIntangibleAssetsNet"],
  },
  currentLiabilities: {
    statement: "BALANCE_SHEET",
    unit: "currency",
    instant: true,
    candidates: ["us-gaap:LiabilitiesCurrent"],
  },
  totalLiabilities: { statement: "BALANCE_SHEET", unit: "currency", instant: true, candidates: ["us-gaap:Liabilities"] },
  longTermDebt: {
    statement: "BALANCE_SHEET",
    unit: "currency",
    instant: true,
    // Non-current portion only: Graham compares *long-term* debt to working capital.
    candidates: [
      "us-gaap:LongTermDebtNoncurrent",
      "us-gaap:LongTermDebtAndCapitalLeaseObligations",
      "us-gaap:LongTermDebtAndFinanceLeaseObligationsNoncurrent",
    ],
  },
  /** Debt due within a year. DebtCurrent already includes short-term borrowings; the other tags do not. */
  debtCurrent: {
    statement: "BALANCE_SHEET",
    unit: "currency",
    instant: true,
    candidates: ["us-gaap:DebtCurrent", "us-gaap:LongTermDebtAndCapitalLeaseObligationsCurrent", "us-gaap:LongTermDebtCurrent"],
  },
  shortTermBorrowings: {
    statement: "BALANCE_SHEET",
    unit: "currency",
    instant: true,
    candidates: ["us-gaap:ShortTermBorrowings", "us-gaap:CommercialPaper"],
  },
  /** Principal of long-term debt maturing in the next twelve months (debt-maturity footnote). */
  debtMaturingNext12m: {
    statement: "BALANCE_SHEET",
    unit: "currency",
    instant: true,
    candidates: ["us-gaap:LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths"],
  },
  preferredStock: {
    statement: "BALANCE_SHEET",
    unit: "currency",
    instant: true,
    candidates: ["us-gaap:PreferredStockValue", "us-gaap:PreferredStockValueOutstanding"],
  },
  stockholdersEquity: {
    statement: "BALANCE_SHEET",
    unit: "currency",
    instant: true,
    candidates: ["us-gaap:StockholdersEquity"],
  },
  totalEquityInclNci: {
    statement: "BALANCE_SHEET",
    unit: "currency",
    instant: true,
    candidates: ["us-gaap:StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
  },
  liabilitiesAndEquity: {
    statement: "BALANCE_SHEET",
    unit: "currency",
    instant: true,
    candidates: ["us-gaap:LiabilitiesAndStockholdersEquity"],
  },
  sharesOutstanding: {
    statement: "BALANCE_SHEET",
    unit: "shares",
    instant: true,
    candidates: ["us-gaap:CommonStockSharesOutstanding", "dei:EntityCommonStockSharesOutstanding"],
  },

  // Cash flow
  operatingCashFlow: {
    statement: "CASH_FLOW",
    unit: "currency",
    instant: false,
    candidates: [
      "us-gaap:NetCashProvidedByUsedInOperatingActivities",
      "us-gaap:NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    ],
  },
  capitalExpenditures: {
    statement: "CASH_FLOW",
    unit: "currency",
    instant: false,
    candidates: ["us-gaap:PaymentsToAcquirePropertyPlantAndEquipment", "us-gaap:PaymentsToAcquireProductiveAssets"],
  },
  dividendsPaid: {
    statement: "CASH_FLOW",
    unit: "currency",
    instant: false,
    candidates: ["us-gaap:PaymentsOfDividendsCommonStock", "us-gaap:PaymentsOfDividends"],
  },
  depreciationAmortization: {
    statement: "CASH_FLOW",
    unit: "currency",
    instant: false,
    candidates: [
      "us-gaap:DepreciationDepletionAndAmortization",
      "us-gaap:DepreciationAndAmortization",
      "us-gaap:DepreciationAmortizationAndAccretionNet",
    ],
  },
} as const satisfies Record<string, ConceptDefinition>;

export type CanonicalConcept = keyof typeof CONCEPTS;
export const CANONICAL_CONCEPTS = Object.keys(CONCEPTS) as CanonicalConcept[];

export function conceptsForStatement(statement: StatementKind): CanonicalConcept[] {
  return CANONICAL_CONCEPTS.filter((c) => CONCEPTS[c].statement === statement);
}
