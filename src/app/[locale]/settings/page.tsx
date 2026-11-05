import { Suspense } from "react";
import { CheckCircle2, KeyRound, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/finance/page-header";
import { PageSkeleton } from "@/components/finance/states";
import { SettingsForm } from "@/components/finance/settings-form";
import { resolveLocale } from "@/lib/i18n/server";
import type { Dictionary } from "@/lib/i18n";
import { getSettings } from "@/server/settings";
import { providerStatuses } from "@/lib/providers/registry";

export default async function SettingsPage({ params }: PageProps<"/[locale]/settings">) {
  const { dict } = await resolveLocale(params);
  return (
    <>
      <PageHeader title={dict.settings.title} subtitle={dict.settings.subtitle} />
      <Suspense fallback={<PageSkeleton />}>
        <Content dict={dict} />
      </Suspense>
    </>
  );
}

async function Content({ dict }: { dict: Dictionary }) {
  const settings = await getSettings();
  // Only names and configured/not-configured flags are sent to the browser — never key values.
  const keys = providerStatuses().flatMap((p) => p.requiredEnv.map((name) => ({ name, set: !p.missingEnv.includes(name) })));
  return (
    <div className="flex flex-col gap-5">
      <SettingsForm settings={settings} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" /> {dict.settings.providers}
          </CardTitle>
          <CardDescription>{dict.settings.providersNote}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 sm:grid-cols-2">
            {keys.map((k) => (
              <li key={k.name} className="flex items-center gap-2 rounded-md border px-3 py-2 font-mono text-xs" dir="ltr">
                {k.set ? <CheckCircle2 className="size-4 text-positive" /> : <XCircle className="size-4 text-muted-foreground" />}
                {k.name}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
