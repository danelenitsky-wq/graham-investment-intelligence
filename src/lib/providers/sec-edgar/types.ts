import { z } from "zod";

/**
 * Shape of SEC EDGAR XBRL "companyfacts" responses:
 * https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json
 * Documented at https://www.sec.gov/search-filings/edgar-application-programming-interfaces
 */
export const secFactSchema = z.object({
  start: z.string().optional(),
  end: z.string(),
  val: z.number(),
  accn: z.string(),
  fy: z.number().nullable().optional(),
  fp: z.string().nullable().optional(),
  form: z.string(),
  filed: z.string(),
  frame: z.string().optional(),
});
export type SecFact = z.infer<typeof secFactSchema>;

export const secConceptSchema = z.object({
  label: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  units: z.record(z.string(), z.array(secFactSchema)),
});

export const companyFactsSchema = z.object({
  cik: z.union([z.number(), z.string()]),
  entityName: z.string(),
  facts: z.record(z.string(), z.record(z.string(), secConceptSchema)),
});
export type CompanyFacts = z.infer<typeof companyFactsSchema>;

/**
 * https://www.sec.gov/files/company_tickers_exchange.json
 * { fields: ["cik","name","ticker","exchange"], data: [[320193,"Apple Inc.","AAPL","Nasdaq"], ...] }
 */
export const tickerExchangeSchema = z.object({
  fields: z.array(z.string()),
  data: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
});
export type TickerExchangeFile = z.infer<typeof tickerExchangeSchema>;

/** https://data.sec.gov/submissions/CIK##########.json (subset we use) */
export const submissionsSchema = z.object({
  cik: z.union([z.string(), z.number()]),
  name: z.string(),
  sic: z.string().nullable().optional(),
  sicDescription: z.string().nullable().optional(),
  fiscalYearEnd: z.string().nullable().optional(), // "0930"
  tickers: z.array(z.string()).optional(),
  exchanges: z.array(z.string().nullable()).optional(),
  filings: z
    .object({
      recent: z.object({
        accessionNumber: z.array(z.string()),
        filingDate: z.array(z.string()),
        reportDate: z.array(z.string().nullable()).optional(),
        acceptanceDateTime: z.array(z.string().nullable()).optional(),
        form: z.array(z.string()),
        primaryDocument: z.array(z.string().nullable()).optional(),
      }),
    })
    .optional(),
});
export type Submissions = z.infer<typeof submissionsSchema>;
