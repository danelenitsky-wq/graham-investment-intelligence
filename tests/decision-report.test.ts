import { describe, expect, it } from "vitest";
import { buildResearchReport, REPORT_SECTION_IDS, reportToMarkdown, type ReportInputs } from "@/lib/decision";
import { getDictionary, type Locale } from "@/lib/i18n";
import { scenario, type ScenarioOptions } from "./decision-fixtures";

function reportFor(o: ScenarioOptions, locale: Locale = "en") {
  const s = scenario(o);
  const last = s.annual[s.annual.length - 1];
  const inputs: ReportInputs = {
    security: { ticker: "SYNT", name: "Synthetic Industrial Co.", nameHe: "חברה תעשייתית סינתטית", exchangeCode: "TEST", exchangeName: "Test Exchange", cik: null, sector: null, industry: null, sicCode: "3560", fiscalYearEndMonth: 12, reportingCurrency: "USD" },
    price: s.dashboard.price.price ? { value: s.dashboard.price.price.value, date: s.dashboard.price.price.date, currency: "USD", sourceKey: "tiingo", status: "LAST_CLOSE", sourceTimestamp: s.dashboard.price.price.timestamp } : null,
    quoteSourceName: "Tiingo",
    priceHistory: Array.from({ length: 300 }, (_, i) => ({ date: new Date(Date.parse("2024-03-01") + i * 86_400_000 * 1.22).toISOString().slice(0, 10), close: 50 + i * 0.05 })),
    priceHistorySource: "Tiingo",
    annual: s.annual,
    provenance: s.annual.map((a) => ({ fiscalYear: a.fiscalYear, periodEnd: a.periodEnd, sourceName: "SEC EDGAR", form: "10-K", accessionNumber: `0000000000-${String(a.fiscalYear).slice(2)}-000001`, filingUrl: `https://www.sec.gov/x/${a.fiscalYear}`, filedAt: `${a.fiscalYear + 1}-02-15`, retrievedAt: "2025-03-03T10:00:00Z" })),
    latestFiling: { form: "10-K", filingDate: `${last.fiscalYear + 1}-02-15`, accessionNumber: "0000000000-25-000001", url: "https://www.sec.gov/x/latest" },
    graham: s.graham,
    dashboard: s.dashboard,
    intrinsic: s.intrinsic,
    marginOfSafetyTarget: 0.3,
    decision: s.decision,
    position: s.inputs.position,
    versions: { graham: "2.0.0", dashboard: "1.0.0", intrinsic: "1.0.0", decision: "1.0.0", report: "1.0.0" },
    generatedAt: "2025-03-03T12:00:00Z",
  };
  return { s, report: buildResearchReport(inputs, getDictionary(locale), locale) };
}

const allText = (r: ReturnType<typeof reportFor>["report"]) =>
  r.sections.flatMap((s) => [s.title, ...s.paragraphs, ...s.bullets, ...s.tables.flatMap((t) => [...t.columns, ...t.rows.flat()])]).join("\n");

describe("research report", () => {
  it.each(["en", "he"] as const)("%s: has the fifteen sections in order, fully rendered", (locale) => {
    const { report } = reportFor({ price: 60 }, locale);
    expect(report.sections.map((s) => s.id)).toEqual(REPORT_SECTION_IDS);
    expect(report.sections).toHaveLength(15);
    expect(report.narrator).toBe("DETERMINISTIC_TEMPLATE");
    const text = allText(report);
    expect(text).not.toMatch(/\{\w+\}/);
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("NaN");
    for (const s of report.sections) expect(s.paragraphs.length + s.bullets.length + s.tables.length, s.id).toBeGreaterThan(0);
  });

  it.each(["en", "he"] as const)("%s: fills the SIC code into the issuer-type sentence", (locale) => {
    const { report } = reportFor({ price: 60, industry: { sicCode: "3560" } }, locale);
    const overview = report.sections.find((x) => x.id === "companyOverview")!.paragraphs.join(" ");
    expect(overview).toContain("3560");
    expect(overview).not.toMatch(/\{\w+\}/);
  });

  it("does not present the excessive-valuation level as the intrinsic value", () => {
    const { s, report } = reportFor({ price: 200 });
    const iv = s.intrinsic.value!;
    const line = allText(report)
      .split("\n")
      .find((l) => l.includes("excessive-valuation level"));
    expect(line).toBeDefined();
    expect(line).toContain(`$${iv.toFixed(2)}`);
    expect(line).toContain(`$${(iv * 1.5).toFixed(2)}`);
    expect(line).toMatch(/intrinsic value estimate of ⁦\$/);
  });

  it("states the classification and figures that come from the engines", () => {
    const { s, report } = reportFor({ price: 60 });
    const summary = report.sections[0].paragraphs.join(" ");
    expect(summary).toContain("Buy candidate");
    expect(summary).toContain("Defensive investor");
    const valuation = allText({ ...report, sections: [report.sections.find((x) => x.id === "valuation")!] });
    expect(valuation).toContain("$150.00"); // the defensive ceiling computed by the valuation engine
    const mos = report.sections.find((x) => x.id === "marginOfSafety")!.paragraphs.join(" ");
    expect(mos).toContain(`$${s.intrinsic.value!.toFixed(2)}`);
  });

  it("never presents an intrinsic value that was not established", () => {
    const { report } = reportFor({ price: 60, intrinsicEnabled: false });
    const mos = report.sections.find((x) => x.id === "marginOfSafety")!.paragraphs.join(" ");
    expect(mos).toContain("No intrinsic value is established");
    expect(mos).not.toMatch(/Intrinsic value \(/);
  });

  it("lists sources with accession numbers, links and calculation versions", () => {
    const { report } = reportFor({ price: 60 });
    const src = report.sections.find((x) => x.id === "sources")!;
    const t = src.tables[0];
    expect(t.rows.some((r) => r[0].includes("0000000000-24-000001"))).toBe(true);
    expect(t.links).toContain("https://www.sec.gov/x/2024");
    expect(src.paragraphs.join(" ")).toContain("decision engine 1.0.0");
  });

  it("explains the strategy-relative nature of AVOID and WAIT", () => {
    const { report } = reportFor({ price: 200, intrinsicEnabled: false });
    const risks = report.sections.find((x) => x.id === "risks")!.bullets.join(" ");
    expect(risks).toContain("does not mean the business is fundamentally weak");
  });

  it("renders Markdown with fifteen section headings and the disclaimer", () => {
    const { report } = reportFor({ price: 60 }, "he");
    const md = reportToMarkdown(report);
    expect(md.match(/^## /gm)).toHaveLength(15);
    expect(md).toContain(getDictionary("he").decision.disclaimer);
    expect(md).toContain("[FY2024 10-K");
  });
});
