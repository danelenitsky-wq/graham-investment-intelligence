import { PageHeader } from "@/components/finance/page-header";
import { SecurityPickerPage } from "@/components/analysis/security-picker-page";
import { ValuationPanel } from "@/components/analysis/valuation-panel";
import { resolveLocale } from "@/lib/i18n/server";
import { href } from "@/lib/i18n/paths";

export default async function ValuationPage({ params, searchParams }: PageProps<"/[locale]/valuation">) {
  const { locale, dict } = await resolveLocale(params);
  const base = href(locale, "/valuation");
  return (
    <>
      <PageHeader title={dict.valuation.title} subtitle={dict.valuation.subtitle} />
      <SecurityPickerPage
        locale={locale}
        dict={dict}
        basePath={base}
        searchParams={searchParams}
        pickText={dict.valuation.pick}
        render={(a) => <ValuationPanel a={a} dict={dict} locale={locale} action={base} hidden={{ s: `${a.security.exchangeCode}:${a.security.ticker}` }} />}
      />
    </>
  );
}
