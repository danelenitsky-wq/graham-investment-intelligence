import { PageHeader } from "@/components/finance/page-header";
import { SecurityPickerPage } from "@/components/analysis/security-picker-page";
import { FinancialHistory } from "@/components/analysis/financial-history";
import { resolveLocale } from "@/lib/i18n/server";
import { href } from "@/lib/i18n/paths";

export default async function FinancialsPage({ params, searchParams }: PageProps<"/[locale]/financials">) {
  const { locale, dict } = await resolveLocale(params);
  return (
    <>
      <PageHeader title={dict.financials.title} subtitle={dict.financials.subtitle} />
      <SecurityPickerPage
        locale={locale}
        dict={dict}
        basePath={href(locale, "/financials")}
        searchParams={searchParams}
        pickText={dict.financials.pick}
        render={(a) => <FinancialHistory a={a} dict={dict} locale={locale} />}
      />
    </>
  );
}
