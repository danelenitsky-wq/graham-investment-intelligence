"use client";
import { useActionState } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/components/layout/providers";
import { saveSettingsAction, type ActionResult } from "@/app/actions";
import type { AppSettings } from "@/lib/settings/schema";
import { MethodologyBadge } from "./badges";
import { NativeSelect } from "@/components/ui/native-select";
import { STRATEGIES } from "@/lib/decision/types";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function ManualValueFields({ prefix, label, value }: { prefix: string; label: string; value: AppSettings["aaaBondYield"] }) {
  const { dict } = useI18n();
  return (
    <fieldset className="flex flex-col gap-2 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">{label}</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label={dict.settings.value}>
          <Input name={`${prefix}Value`} type="number" step="any" min="0" defaultValue={value?.value ?? ""} dir="ltr" />
        </Field>
        <Field label={dict.settings.asOf}>
          <Input name={`${prefix}AsOf`} type="date" defaultValue={value?.asOf ?? ""} dir="ltr" />
        </Field>
        <Field label={dict.settings.sourceLabel}>
          <Input name={`${prefix}Source`} defaultValue={value?.source ?? ""} placeholder="e.g. FRED AAA / BLS CPI-U" />
        </Field>
      </div>
    </fieldset>
  );
}

export function SettingsForm({ settings }: { settings: AppSettings }) {
  const { dict } = useI18n();
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveSettingsAction, null);
  return (
    <form action={action} className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {dict.settings.macro} <MethodologyBadge methodology="MODERN_EXTENSION" dict={dict} />
          </CardTitle>
          <CardDescription>{dict.settings.macroNote}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ManualValueFields prefix="aaa" label={dict.settings.aaaYield} value={settings.aaaBondYield} />
          <ManualValueFields prefix="cpi" label={dict.settings.cpi} value={settings.currentCpi} />
        </CardContent>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{dict.settings.freshness}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            {(["priceAgingDays", "priceStaleDays", "fundamentalsAgingMonths", "fundamentalsStaleMonths"] as const).map((k) => (
              <Field key={k} label={dict.settings[k]}>
                <Input name={k} type="number" min="1" required defaultValue={settings.freshness[k]} dir="ltr" />
              </Field>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{dict.settings.methodology}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <Field label={dict.settings.enterprisingLookbackYears}>
              <Input name="enterprisingLookbackYears" type="number" min="1" max="10" required defaultValue={settings.enterprisingLookbackYears} dir="ltr" />
            </Field>
            <Field label={dict.settings.priceHistoryYears}>
              <Input name="priceHistoryYears" type="number" min="1" max="40" required defaultValue={settings.priceHistoryYears} dir="ltr" />
            </Field>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{dict.settings.valuation}</CardTitle>
          <CardDescription>{dict.settings.valuationNote}</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label={dict.settings.marginOfSafetyTarget}>
            <Input name="marginOfSafetyTarget" type="number" min="0" max="90" step="1" required defaultValue={Math.round(settings.valuation.marginOfSafetyTarget * 100)} dir="ltr" />
          </Field>
          <Field label={dict.settings.discountRate}>
            <Input name="discountRate" type="number" min="4" max="25" step="0.1" required defaultValue={+(settings.valuation.discountRate * 100).toFixed(2)} dir="ltr" />
          </Field>
          <Field label={dict.settings.terminalGrowth}>
            <Input name="terminalGrowth" type="number" min="-2" max="4" step="0.1" required defaultValue={+(settings.valuation.terminalGrowth * 100).toFixed(2)} dir="ltr" />
          </Field>
          <Field label={dict.settings.normalizationYears}>
            <Input name="normalizationYears" type="number" min="3" max="10" step="1" required defaultValue={settings.valuation.normalizationYears} dir="ltr" />
          </Field>
          <label className="col-span-2 flex items-center gap-2 text-sm md:col-span-4">
            <input type="checkbox" name="intrinsicEnabled" defaultChecked={settings.valuation.intrinsicEnabled} className="size-4 accent-primary" />
            {dict.settings.intrinsicEnabled}
          </label>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{dict.decision.settings.title}</CardTitle>
          <CardDescription>{dict.decision.settings.note}</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label={dict.decision.settings.strategy}>
            <NativeSelect name="decisionStrategy" defaultValue={settings.decision.strategy}>
              {STRATEGIES.map((s) => (
                <option key={s} value={s}>
                  {dict.decision.strategies[s]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={dict.decision.settings.maxPositionWeight}>
            <Input name="maxPositionWeight" type="number" min="1" max="100" step="1" required defaultValue={Math.round(settings.decision.maxPositionWeight * 100)} dir="ltr" />
          </Field>
          <Field label={dict.decision.settings.excessiveValuationMultiple}>
            <Input name="excessiveValuationMultiple" type="number" min="1" max="10" step="0.1" required defaultValue={settings.decision.excessiveValuationMultiple} dir="ltr" />
          </Field>
          <label className="col-span-2 flex items-center gap-2 text-sm md:col-span-4">
            <input type="checkbox" name="requireIntrinsicMarginOfSafety" defaultChecked={settings.decision.requireIntrinsicMarginOfSafety} className="size-4 accent-primary" />
            {dict.decision.settings.requireIntrinsicMarginOfSafety}
          </label>
        </CardContent>
      </Card>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />} {dict.common.save}
        </Button>
        {state?.ok && <span className="text-sm text-positive">{dict.common.saved}</span>}
        {state && !state.ok && (
          <span className="text-sm text-negative">
            {dict.settings.invalid} <span dir="ltr" className="font-mono text-xs">{state.error}</span>
          </span>
        )}
      </div>
    </form>
  );
}
