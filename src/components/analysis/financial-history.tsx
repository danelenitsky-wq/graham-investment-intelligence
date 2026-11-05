import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AnnualBarChart, PerShareLineChart } from "@/components/charts/history-charts";
import { EmptyState } from "@/components/finance/states";
import { Num } from "@/components/finance/num";
import { CONCEPTS, conceptsForStatement, type StatementKind } from "@/lib/normalization/concepts";
import { formatCompact, formatMetric } from "@/lib/format";
import type { Dictionary, Locale } from "@/lib/i18n";
import type { SecurityAnalysis } from "@/server/analysis";
import { bookValuePerShare } from "@/lib/graham/metrics";

const STATEMENTS: StatementKind[] = ["INCOME", "BALANCE_SHEET", "CASH_FLOW"];

export function FinancialHistory({ a, dict, locale }: { a: SecurityAnalysis; dict: Dictionary; locale: Locale }) {
  if (a.annual.length === 0) return <EmptyState title={dict.stock.noFundamentals} body={dict.stock.noFundamentalsHint} />;
  const currency = a.annual[a.annual.length - 1].currency;
  const years = a.annual.slice(-12);
  const chartData = years.map((y) => ({
    fiscalYear: y.fiscalYear,
    revenue: y.values.revenue ?? null,
    netIncome: y.values.netIncome ?? null,
    eps: y.values.epsDiluted ?? y.values.epsBasic ?? null,
    bvps: bookValuePerShare(y),
    dps: y.values.dividendsPerShare ?? null,
  }));
  const prov = new Map(a.provenance.map((p) => [p.fiscalYear, p]));

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{dict.financials.revenueIncome}</CardTitle>
          </CardHeader>
          <CardContent>
            <AnnualBarChart
              data={chartData}
              currency={currency}
              series={[
                { key: "revenue", label: dict.concepts.revenue, color: "var(--color-chart-3)" },
                { key: "netIncome", label: dict.concepts.netIncome, color: "var(--color-chart-1)" },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{dict.financials.perShare}</CardTitle>
          </CardHeader>
          <CardContent>
            <PerShareLineChart
              data={chartData}
              currency={currency}
              series={[
                { key: "eps", label: dict.concepts.epsDiluted, color: "var(--color-chart-1)" },
                { key: "bvps", label: dict.metrics.bookValuePerShare, color: "var(--color-chart-3)" },
                { key: "dps", label: dict.concepts.dividendsPerShare, color: "var(--color-chart-2)" },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      {STATEMENTS.map((st) => {
        const concepts = conceptsForStatement(st).filter((c) => years.some((y) => y.values[c] !== undefined));
        if (!concepts.length) return null;
        return (
          <Card key={st}>
            <CardHeader>
              <CardTitle>{dict.statements[st]}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky start-0 bg-card">{dict.common.fiscalYear}</TableHead>
                    {years.map((y) => (
                      <TableHead key={y.fiscalYear} className="text-end">
                        <span className="num font-mono">{y.fiscalYear}</span>
                        {prov.get(y.fiscalYear)?.isRestated && (
                          <Badge variant="warning" className="ms-1 px-1 py-0 text-[9px]">
                            {dict.financials.restated}
                          </Badge>
                        )}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {concepts.map((c) => (
                    <TableRow key={c}>
                      <TableCell className="sticky start-0 bg-card text-muted-foreground" title={prov.get(years[years.length - 1].fiscalYear)?.concepts[c] ?? ""}>
                        {dict.concepts[c]}
                      </TableCell>
                      {years.map((y) => {
                        const v = y.values[c];
                        const unit = CONCEPTS[c].unit;
                        const text = unit === "currency" ? formatCompact(locale, v, currency) : unit === "shares" ? formatCompact(locale, v) : formatMetric(locale, v, "currency", currency);
                        return (
                          <TableCell key={y.fiscalYear} className="text-end" title={prov.get(y.fiscalYear)?.concepts[c]}>
                            <Num>{text}</Num>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
