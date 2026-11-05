/**
 * Research report (15 sections), generated from verified structured results
 * with deterministic templates. No LLM is configured or required: every
 * sentence is a fixed template, and every number in it is a value produced by
 * the Graham, valuation or decision engines (or a sourced fact such as a
 * filing accession number). Nothing is calculated here beyond formatting and
 * simple summaries of stored series (12-month price range, years with a
 * dividend), and nothing is invented: a missing value renders as "—".
 *
 * If an LLM narrator is ever added, it must take this report's structured
 * content as its only input and may not alter or add figures.
 */
import type { GrahamAnalysis } from "@/lib/graham";
import type { RuleCheck, RuleResult, ScreenResult, ValueUnit } from "@/lib/graham/types";
import type { AnnualFinancials } from "@/lib/normalization/statements";
import { fmt, type Dictionary, type Locale } from "@/lib/i18n";
import { formatCompact, formatDate, formatMetric, MISSING } from "@/lib/format";
import type { CeilingRow, ValuationDashboard } from "@/lib/valuation/engine";
import type { IntrinsicResult } from "@/lib/valuation/intrinsic";
import { renderFactorReason, renderStatement } from "./render";
import type { DecisionResult, PositionContext } from "./types";

export const REPORT_TEMPLATE_VERSION = "1.0.0";

export type ReportSectionId =
  | "executiveSummary"
  | "companyOverview"
  | "priceContext"
  | "defensive"
  | "enterprising"
  | "netNet"
  | "financialStrength"
  | "historicalEarnings"
  | "dividendRecord"
  | "valuation"
  | "marginOfSafety"
  | "risks"
  | "decision"
  | "conditions"
  | "sources";

export const REPORT_SECTION_IDS: ReportSectionId[] = [
  "executiveSummary",
  "companyOverview",
  "priceContext",
  "defensive",
  "enterprising",
  "netNet",
  "financialStrength",
  "historicalEarnings",
  "dividendRecord",
  "valuation",
  "marginOfSafety",
  "risks",
  "decision",
  "conditions",
  "sources",
];

export interface ReportTable {
  columns: string[];
  rows: string[][];
  /** Optional link per row (first column), e.g. the filing URL. */
  links?: (string | null)[];
}

export interface ReportSection {
  id: ReportSectionId;
  title: string;
  paragraphs: string[];
  bullets: string[];
  tables: ReportTable[];
}

export interface ResearchReport {
  templateVersion: string;
  narrator: "DETERMINISTIC_TEMPLATE";
  locale: Locale;
  generatedAt: string;
  title: string;
  disclaimer: string;
  narratorNote: string;
  sections: ReportSection[];
}

export interface ReportInputs {
  security: {
    ticker: string;
    name: string;
    nameHe?: string | null;
    exchangeCode: string;
    exchangeName: string;
    cik: string | null;
    sector: string | null;
    industry: string | null;
    sicCode: string | null;
    fiscalYearEndMonth: number | null;
    reportingCurrency: string | null;
  };
  price: { value: number; date: string; currency: string; sourceKey: string; status: string; sourceTimestamp: string | null } | null;
  quoteSourceName: string | null;
  priceHistory: { date: string; close: number }[];
  priceHistorySource: string | null;
  annual: AnnualFinancials[];
  provenance: {
    fiscalYear: number;
    periodEnd: string;
    sourceName: string;
    form: string | null;
    accessionNumber: string | null;
    filingUrl: string | null;
    filedAt: string | null;
    retrievedAt: string | null;
  }[];
  latestFiling: { form: string | null; filingDate: string | null; accessionNumber: string | null; url: string | null } | null;
  graham: GrahamAnalysis;
  dashboard: ValuationDashboard;
  intrinsic: IntrinsicResult | null;
  marginOfSafetyTarget: number;
  decision: DecisionResult;
  position: PositionContext | null;
  versions: Record<"graham" | "dashboard" | "intrinsic" | "decision" | "report", string>;
  generatedAt: string;
}

const section = (id: ReportSectionId, dict: Dictionary): ReportSection => ({
  id,
  title: dict.decision.report.sectionTitles[id],
  paragraphs: [],
  bullets: [],
  tables: [],
});

/** Formatted engine value, isolated left-to-right so signs read correctly in Hebrew sentences. */
function value(locale: string, v: number | null | undefined, unit: ValueUnit, currency: string): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return MISSING;
  return `\u2066${rawValue(locale, v, unit, currency)}\u2069`;
}

function rawValue(locale: string, v: number, unit: ValueUnit, currency: string): string {
  switch (unit) {
    case "currency":
      return formatMetric(locale, v, "compactCurrency", currency);
    case "currencyUsd":
      return formatMetric(locale, v, "compactCurrency", "USD");
    case "perShare":
      return formatMetric(locale, v, "currency", currency);
    case "ratio":
      return formatMetric(locale, v, "ratio");
    case "multiple":
      return formatMetric(locale, v, "multiple");
    case "percent":
      return formatMetric(locale, v, "percent");
    case "count":
      return formatMetric(locale, v, "integer");
    case "year":
      return String(v);
    case "shares":
      return formatCompact(locale, v);
    default:
      return formatMetric(locale, v, "number");
  }
}

function ruleTable(screen: ScreenResult, dict: Dictionary, locale: string, currency: string): ReportTable {
  const c = dict.decision.report.columns;
  const rules = dict.graham.rules as Record<string, { name: string }>;
  const firstDecisive = (r: RuleResult): RuleCheck | undefined => r.checks.find((k) => k.passed === false) ?? r.checks[0];
  return {
    columns: [c.rule, c.status, c.actual, c.required, c.period],
    rows: screen.rules.map((r) => {
      const k = firstDecisive(r);
      const flags = [r.verification === "UNVERIFIED" ? dict.graham.verification.UNVERIFIED : "", r.counted ? "" : dict.graham.advisory].filter(Boolean).join(" · ");
      return [
        `${rules[r.id]?.name ?? r.id}${flags ? ` (${flags})` : ""}`,
        dict.decision.report.ruleStatus[r.status],
        k ? value(locale, k.actual, k.unit, currency) : MISSING,
        k ? `${k.op} ${value(locale, k.threshold, k.unit, currency)}` : MISSING,
        r.period ?? MISSING,
      ];
    }),
  };
}

function screenParagraphs(screen: ScreenResult, dict: Dictionary): string[] {
  const t = dict.decision.report.t;
  const counts = fmt(dict.graham.counts, { passed: screen.passed, failed: screen.failed, insufficient: screen.insufficient, na: screen.notApplicable });
  const out = [fmt(t.screenOutcome, { outcome: dict.graham.outcome[screen.outcome], counts })];
  const unverified = screen.rules.filter((r) => r.counted && r.verification === "UNVERIFIED").map((r) => r.id);
  if (unverified.length) out.push(fmt(t.unverifiedNote, { rules: unverified.join(", ") }));
  return out;
}

function ruleReason(r: RuleResult | undefined, dict: Dictionary): string | null {
  if (!r) return null;
  const tpl = (dict.graham.reasons as Record<string, string>)[r.reason];
  if (!tpl) return null;
  const params = Object.fromEntries(Object.entries(r.reasonParams ?? {}).map(([k, v]) => [k, String(v)]));
  const name = (dict.graham.rules as Record<string, { name: string }>)[r.id]?.name ?? r.id;
  return `${name}: ${fmt(tpl, params)}`;
}

const find = (s: ScreenResult, id: string) => s.rules.find((r) => r.id === id);

function priceRange(history: { date: string; close: number }[], asOf: string | null) {
  if (history.length < 2) return null;
  const end = asOf ?? history[history.length - 1].date;
  const startDate = new Date(Date.parse(end) - 365 * 86_400_000).toISOString().slice(0, 10);
  const window = history.filter((h) => h.date >= startDate && h.date <= end);
  if (window.length < 2 || window[0].date > new Date(Date.parse(startDate) + 31 * 86_400_000).toISOString().slice(0, 10)) return null;
  const closes = window.map((w) => w.close);
  return { low: Math.min(...closes), high: Math.max(...closes), change: window[window.length - 1].close / window[0].close - 1 };
}

function ceilingRow(name: string, row: CeilingRow, dict: Dictionary, locale: string, currency: string): string[] {
  const c = row.ceiling;
  return [
    name,
    dict.decision.report.ceilingStatus[c.status],
    c.value === null ? (dict.valuationDashboard.ceilingReasons as Record<string, string>)[c.reason] ?? c.reason : value(locale, c.value, "perShare", currency),
    row.comparison.changeRequired === null ? MISSING : value(locale, row.comparison.changeRequired, "percent", currency),
  ];
}

export function buildResearchReport(inputs: ReportInputs, dict: Dictionary, locale: Locale): ResearchReport {
  const d = dict.decision;
  const t = d.report.t;
  const cols = d.report.columns;
  const { security: s, graham, dashboard, decision } = inputs;
  const currency = dashboard.currency ?? inputs.price?.currency ?? s.reportingCurrency ?? "USD";
  const name = locale === "he" && s.nameHe ? s.nameHe : s.name;
  const sections: ReportSection[] = [];
  const stmt = (x: Parameters<typeof renderStatement>[0]) => renderStatement(x, dict, locale, currency);
  const trends = graham.trends;
  const last = trends[trends.length - 1];

  // 1. Executive summary
  {
    const x = section("executiveSummary", dict);
    x.paragraphs.push(fmt(t.summary, { name, ticker: s.ticker, category: d.categories[decision.category], strategy: d.strategies[decision.strategy] }));
    if (decision.confidence) x.paragraphs.push(fmt(t.summaryConfidence, { confidence: d.confidence[decision.confidence] }));
    x.paragraphs.push(decision.owned ? t.summaryOwned : t.summaryNotOwned);
    x.bullets.push(...decision.reasons.map(stmt), ...decision.reviewTriggers.map(stmt));
    x.paragraphs.push(d.disclaimer);
    sections.push(x);
  }

  // 2. Company overview
  {
    const x = section("companyOverview", dict);
    const cls = graham.classification;
    const issuerType = fmt(dict.graham.issuerType, {
      type: (dict.graham.industryClass as Record<string, string>)[cls.industryClass] ?? cls.industryClass,
      basis: (dict.graham.classificationBasis as Record<string, string>)[cls.basis] ?? cls.basis,
    });
    x.paragraphs.push(fmt(t.overview, { name, exchange: s.exchangeName, ticker: s.ticker, issuerType }));
    x.tables.push({
      columns: [cols.item, cols.value],
      rows: [
        [dict.stock.exchange, `${s.exchangeName} (${s.exchangeCode})`],
        [dict.stock.cik, s.cik ?? MISSING],
        [dict.stock.sector, [s.sector, s.industry].filter(Boolean).join(" · ") || MISSING],
        ["SIC", s.sicCode ?? MISSING],
        [dict.stock.reportingCurrency, s.reportingCurrency ?? currency],
      ],
    });
    sections.push(x);
  }

  // 3. Price and market context
  {
    const x = section("priceContext", dict);
    const p = dashboard.price;
    if (p.price) {
      x.paragraphs.push(
        fmt(t.priceLine, {
          price: value(locale, p.price.value, "perShare", p.price.currency),
          date: formatDate(locale, p.price.date),
          basis: d.report.basis[p.basis],
          status: p.price.quoteStatus ?? MISSING,
          source: p.price.source ?? MISSING,
        }),
      );
      if (p.warning) x.paragraphs.push(fmt((dict.valuationDashboard.price.warning as Record<string, string>)[p.warning] ?? p.warning, { days: p.ageDays ?? MISSING }));
    } else x.paragraphs.push(t.priceNone);
    const r = priceRange(inputs.priceHistory, p.price?.date ?? null);
    x.paragraphs.push(
      r ? fmt(t.range, { low: value(locale, r.low, "perShare", currency), high: value(locale, r.high, "perShare", currency), change: value(locale, r.change, "percent", currency) }) : t.rangeNone,
    );
    sections.push(x);
  }

  // 4–5. Defensive and Enterprising
  for (const [id, screen] of [
    ["defensive", graham.defensive],
    ["enterprising", graham.enterprising],
  ] as const) {
    const x = section(id, dict);
    x.paragraphs.push(...screenParagraphs(screen, dict));
    x.tables.push(ruleTable(screen, dict, locale, currency));
    const f = decision.factors.find((ff) => ff.id === id)!;
    x.paragraphs.push(renderFactorReason(f, dict, locale, currency));
    if (id === "enterprising") x.paragraphs.push(dict.graham.enterprisingScope);
    sections.push(x);
  }

  // 6. Net-Net
  {
    const x = section("netNet", dict);
    const nn = graham.netNet;
    x.paragraphs.push(...screenParagraphs(nn.screen, dict));
    const price = dashboard.price.comparable;
    x.paragraphs.push(
      fmt(t.netNetLine, {
        ncav: value(locale, nn.ncav, "currency", currency),
        ncavps: value(locale, nn.ncavPerShare, "perShare", currency),
        threshold: value(locale, nn.purchaseThreshold, "perShare", currency),
        ratio: price !== null && nn.ncavPerShare !== null && nn.ncavPerShare > 0 ? value(locale, price / nn.ncavPerShare, "multiple", currency) : MISSING,
      }),
    );
    x.tables.push(ruleTable(nn.screen, dict, locale, currency));
    x.paragraphs.push(t.notBuy);
    sections.push(x);
  }

  // 7. Financial strength
  {
    const x = section("financialStrength", dict);
    const ltd = last?.longTermDebt ?? null;
    x.paragraphs.push(
      fmt(t.financialLine, {
        cr: value(locale, last?.currentRatio ?? null, "ratio", currency),
        nwc: value(locale, last?.netWorkingCapital ?? null, "currency", currency),
        ltd: value(locale, ltd, "currency", currency),
        bvps: value(locale, last?.bookValuePerShare ?? null, "perShare", currency),
      }),
    );
    const f = decision.factors.find((ff) => ff.id === "financialStrength")!;
    x.paragraphs.push(renderFactorReason(f, dict, locale, currency));
    for (const r of [find(graham.defensive, "D2") ?? find(graham.defensive, "D2U"), find(graham.enterprising, "E1"), find(graham.enterprising, "E2")]) {
      const line = ruleReason(r, dict);
      if (line) x.bullets.push(line);
    }
    sections.push(x);
  }

  // 8. Historical earnings
  {
    const x = section("historicalEarnings", dict);
    const rows = trends.slice(-10);
    if (last) x.paragraphs.push(fmt(t.earningsLine, { eps3: value(locale, last.eps3yAvg, "perShare", currency), eps: value(locale, last.eps, "perShare", currency), fy: last.fiscalYear }));
    x.tables.push({
      columns: [cols.year, cols.revenue, cols.netIncome, cols.eps],
      rows: rows.map((r) => [`FY${r.fiscalYear}`, value(locale, r.revenue, "currency", currency), value(locale, r.netIncome, "currency", currency), value(locale, r.eps, "perShare", currency)]),
    });
    const f = decision.factors.find((ff) => ff.id === "earningsStability")!;
    x.paragraphs.push(renderFactorReason(f, dict, locale, currency));
    for (const id of ["D3", "D5"]) {
      const line = ruleReason(find(graham.defensive, id), dict);
      if (line) x.bullets.push(line);
    }
    for (const id of ["E3", "E5"]) {
      const line = ruleReason(find(graham.enterprising, id), dict);
      if (line) x.bullets.push(line);
    }
    sections.push(x);
  }

  // 9. Dividend record
  {
    const x = section("dividendRecord", dict);
    const withData = trends.slice(-20).filter((r) => r.providerDividends !== null || r.dividendsPerShare !== null);
    const paid = withData.filter((r) => (r.providerDividends ?? r.dividendsPerShare ?? 0) > 0);
    if (withData.length) {
      const dps = last?.providerDividends ?? last?.dividendsPerShare ?? null;
      x.paragraphs.push(fmt(t.dividendLine, { paid: paid.length, covered: withData.length, dps: value(locale, dps, "perShare", currency) }));
      x.tables.push({
        columns: [cols.year, cols.dps],
        rows: withData.slice(-10).map((r) => [`FY${r.fiscalYear}`, value(locale, r.providerDividends ?? r.dividendsPerShare, "perShare", currency)]),
      });
    } else x.paragraphs.push(t.dividendNone);
    for (const [screen, id] of [
      [graham.defensive, "D4"],
      [graham.enterprising, "E4"],
    ] as const) {
      const line = ruleReason(find(screen, id), dict);
      if (line) x.bullets.push(line);
    }
    sections.push(x);
  }

  // 10. Valuation
  {
    const x = section("valuation", dict);
    const cards = dict.valuationDashboard.cards;
    x.paragraphs.push(t.ceilingsNote);
    x.tables.push({
      columns: [cols.ceiling, cols.status, cols.value, cols.vsPrice],
      rows: [
        ceilingRow(cards.grahamNumber, dashboard.grahamNumber, dict, locale, currency),
        ceilingRow(cards.defensive, dashboard.defensive, dict, locale, currency),
        ceilingRow(cards.enterprising, dashboard.enterprising, dict, locale, currency),
        ceilingRow(cards.netNet, dashboard.netNet, dict, locale, currency),
      ],
    });
    const f = decision.factors.find((ff) => ff.id === "valuation")!;
    x.paragraphs.push(renderFactorReason(f, dict, locale, currency));
    sections.push(x);
  }

  // 11. Margin of safety
  {
    const x = section("marginOfSafety", dict);
    const iv = inputs.intrinsic;
    if (iv && iv.status === "ESTABLISHED" && iv.value !== null) {
      x.paragraphs.push(
        fmt(t.intrinsicLine, {
          method: dict.valuationDashboard.intrinsic.methods[iv.method],
          value: value(locale, iv.value, "perShare", currency),
          low: value(locale, iv.low, "perShare", currency),
          high: value(locale, iv.high, "perShare", currency),
          r: value(locale, iv.assumptions.discountRate, "percent", currency),
          g: value(locale, iv.assumptions.terminalGrowth, "percent", currency),
        }),
      );
      if (decision.keyFigures.marginOfSafetyPercent !== null)
        x.paragraphs.push(
          fmt(t.mosLine, {
            percent: value(locale, decision.keyFigures.marginOfSafetyPercent / 100, "percent", currency),
            target: value(locale, inputs.marginOfSafetyTarget, "percent", currency),
            targetPrice: value(locale, decision.keyFigures.marginOfSafetyTargetPrice, "perShare", currency),
          }),
        );
    } else {
      x.paragraphs.push(fmt(t.intrinsicNone, { reason: (dict.valuationDashboard.intrinsic.reasons as Record<string, string>)[iv?.reason ?? "disabled"] || (iv?.reason ?? "disabled") }));
    }
    const f = decision.factors.find((ff) => ff.id === "marginOfSafety")!;
    x.paragraphs.push(renderFactorReason(f, dict, locale, currency));
    sections.push(x);
  }

  // 12. Main investment risks
  {
    const x = section("risks", dict);
    const risks = graham.netNet.risks;
    const names = dict.graham.risks.names as Record<string, string>;
    const reasons = dict.graham.risks.reasons as Record<string, string>;
    if (risks.length) {
      x.tables.push({
        columns: [cols.indicator, cols.level, cols.explanation, cols.period],
        rows: risks.map((r) => [
          names[r.id] ?? r.id,
          dict.graham.risks.levels[r.level],
          fmt(reasons[r.reason] ?? r.reason, Object.fromEntries(Object.entries(r.reasonParams ?? {}).map(([k, v]) => [k, String(v)]))),
          r.period ?? MISSING,
        ]),
      });
      x.paragraphs.push(dict.graham.risks.note);
    } else x.paragraphs.push(t.noRisks);
    x.bullets.push(...decision.caveats.map(stmt));
    sections.push(x);
  }

  // 13. Decision assessment
  {
    const x = section("decision", dict);
    x.paragraphs.push(`**${d.categories[decision.category]}** — ${d.categoryHelp[decision.category]}`);
    x.tables.push({
      columns: [d.factorColumns.factor, d.factorColumns.status, d.factorColumns.explanation],
      rows: decision.factors.map((f) => [d.factors[f.id], d.factorStatus[f.status], renderFactorReason(f, dict, locale, currency)]),
    });
    x.bullets.push(...decision.reasons.map(stmt), ...decision.reviewTriggers.map(stmt));
    if (inputs.position) {
      const p = inputs.position;
      x.paragraphs.push(
        fmt(t.position, {
          quantity: formatMetric(locale, p.quantity, "number"),
          cost: value(locale, p.averageCost, "perShare", p.currency),
          weight: p.weight === null ? MISSING : value(locale, p.weight, "percent", currency),
        }),
      );
    }
    sections.push(x);
  }

  // 14. Conditions that would change the assessment
  {
    const x = section("conditions", dict);
    x.bullets.push(...decision.conditions.map(stmt));
    sections.push(x);
  }

  // 15. Sources and timestamps
  {
    const x = section("sources", dict);
    const r = d.report.sourceRows;
    x.paragraphs.push(t.sourcesIntro);
    const priceRows: string[][] = [];
    if (inputs.price) priceRows.push([r.quote, inputs.quoteSourceName ?? inputs.price.sourceKey, `${inputs.price.date}`, inputs.price.sourceTimestamp ?? MISSING]);
    if (inputs.priceHistory.length)
      priceRows.push([r.priceHistory, inputs.priceHistorySource ?? MISSING, `${inputs.priceHistory[0].date} – ${inputs.priceHistory[inputs.priceHistory.length - 1].date}`, MISSING]);
    if (inputs.latestFiling) priceRows.push([r.latestFiling, inputs.latestFiling.form ?? MISSING, inputs.latestFiling.filingDate ?? MISSING, inputs.latestFiling.accessionNumber ?? MISSING]);
    const fyRows = inputs.provenance.slice(-10).reverse();
    x.tables.push({
      columns: [cols.document, cols.source, cols.period, cols.retrieved],
      rows: [
        ...priceRows,
        ...fyRows.map((p) => [`FY${p.fiscalYear} ${p.form ?? ""}${p.accessionNumber ? ` · ${p.accessionNumber}` : ""}`.trim(), p.sourceName, `${p.periodEnd}${p.filedAt ? ` (${p.filedAt})` : ""}`, p.retrievedAt ?? MISSING]),
      ],
      links: [...priceRows.map((row) => (row[0] === r.latestFiling ? inputs.latestFiling?.url ?? null : null)), ...fyRows.map((p) => p.filingUrl)],
    });
    const v = inputs.versions;
    x.paragraphs.push(fmt(t.versions, { graham: v.graham, dashboard: v.dashboard, intrinsic: v.intrinsic, decision: v.decision, report: v.report }));
    x.paragraphs.push(fmt(d.report.generatedAt, { at: inputs.generatedAt }));
    sections.push(x);
  }

  return {
    templateVersion: REPORT_TEMPLATE_VERSION,
    narrator: "DETERMINISTIC_TEMPLATE",
    locale,
    generatedAt: inputs.generatedAt,
    title: `${d.report.title}: ${name} (${s.exchangeCode}:${s.ticker})`,
    disclaimer: d.disclaimer,
    narratorNote: d.report.narrator,
    sections,
  };
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** Markdown rendering of the report (download, snapshot archive, CLI output). */
export function reportToMarkdown(r: ResearchReport): string {
  const out: string[] = [`# ${r.title}`, "", `> ${r.disclaimer}`, "", `_${r.narratorNote}_`, ""];
  for (const s of r.sections) {
    out.push(`## ${s.title}`, "");
    for (const p of s.paragraphs) out.push(p, "");
    for (const tb of s.tables) {
      out.push(`| ${tb.columns.map(cell).join(" | ")} |`, `| ${tb.columns.map(() => "---").join(" | ")} |`);
      tb.rows.forEach((row, i) => {
        const link = tb.links?.[i];
        const cells = row.map(cell);
        if (link) cells[0] = `[${cells[0]}](${link})`;
        out.push(`| ${cells.join(" | ")} |`);
      });
      out.push("");
    }
    if (s.bullets.length) {
      for (const b of s.bullets) out.push(`- ${b}`);
      out.push("");
    }
  }
  return out.join("\n");
}
