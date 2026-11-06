"use client";
import { useActionState, useState, useTransition } from "react";
import { Loader2, RefreshCw, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useI18n } from "@/components/layout/providers";
import { fmt } from "@/lib/i18n";
import { addManualFxAction, deleteFxRateAction, recordManualPriceAction, refreshFxAction, type ActionResult } from "@/app/actions";

export interface ManualPriceTarget {
  securityId: string;
  ticker: string;
  exchangeCode: string;
  currency: string;
  timezone: string;
}

/** Manual price with the time it refers to (exchange-local) and its source label. */
export function ManualPriceForm({ targets }: { targets: ManualPriceTarget[] }) {
  const { dict } = useI18n();
  const t = dict.holdings.manualPrice;
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(recordManualPriceAction, null);
  const [sel, setSel] = useState(targets[0]?.securityId ?? "");
  const target = targets.find((x) => x.securityId === sel) ?? targets[0];
  if (!target) return <p className="text-xs text-muted-foreground">{t.none}</p>;
  const il = target.currency === "ILS";
  const field = (label: string, el: React.ReactNode) => (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {el}
    </label>
  );
  return (
    <form action={action} className="flex flex-col gap-2" data-testid="manual-price-form">
      <div className="flex flex-wrap items-end gap-2">
        {field(
          t.security,
          <NativeSelect name="securityId" value={sel} onChange={(e) => setSel(e.target.value)}>
            {targets.map((x) => (
              <option key={x.securityId} value={x.securityId}>
                {x.ticker} · {x.exchangeCode}
              </option>
            ))}
          </NativeSelect>,
        )}
        {field(t.price, <Input name="price" inputMode="decimal" required className="w-28" dir="ltr" />)}
        {field(
          t.unit,
          il ? (
            <NativeSelect name="unit" defaultValue="" required key={`il-${sel}`}>
              <option value="" disabled>
                {dict.holdings.form.chooseUnit}
              </option>
              <option value="ILS">{dict.holdings.form.units.ILS}</option>
              <option value="ILA">{dict.holdings.form.units.ILA}</option>
            </NativeSelect>
          ) : (
            <NativeSelect name="unit" defaultValue="USD" key={`us-${sel}`}>
              <option value="USD">{dict.holdings.form.units.USD}</option>
            </NativeSelect>
          ),
        )}
        {field(t.date, <Input name="date" type="date" required className="w-40" dir="ltr" />)}
        {field(fmt(t.timezone, { tz: target.timezone }), <Input name="time" type="time" required className="w-28" dir="ltr" />)}
        {field(t.source, <Input name="sourceLabel" required minLength={2} maxLength={200} placeholder={t.sourcePlaceholder} className="w-64" />)}
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />} {t.save}
        </Button>
      </div>
      {state?.ok && <p className="text-xs text-positive">{t.saved}</p>}
      {state && !state.ok && <p className="text-xs text-negative">{t.errors[(state.code ?? "INVALID") as keyof typeof t.errors] ?? state.error}</p>}
    </form>
  );
}

export function FetchFxButton() {
  const { dict } = useI18n();
  const t = dict.holdings.fx;
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await refreshFxAction();
            setMsg(r.ok ? { ok: true, text: fmt(t.fetched, { n: r.data!.stored, date: r.data!.latest ?? "—" }) } : { ok: false, text: fmt(t.failed, { error: r.error }) });
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />} {t.fetch}
      </Button>
      {msg && <p className={msg.ok ? "text-xs text-muted-foreground" : "max-w-md text-xs break-words text-negative"}>{msg.text}</p>}
    </div>
  );
}

export function ManualFxForm() {
  const { dict } = useI18n();
  const t = dict.holdings.fx;
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(addManualFxAction, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">{t.rate}</span>
        <Input name="rate" inputMode="decimal" required className="w-28" dir="ltr" />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">{t.date}</span>
        <Input name="date" type="date" required className="w-40" dir="ltr" />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">{t.source}</span>
        <Input name="sourceLabel" required minLength={2} maxLength={200} className="w-56" />
      </label>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Save />} {t.add}
      </Button>
      {state && !state.ok && <p className="w-full text-xs text-negative">{dict.holdings.manualPrice.errors.INVALID}</p>}
    </form>
  );
}

export function DeleteFxButton({ id }: { id: string }) {
  const { dict } = useI18n();
  const [pending, start] = useTransition();
  return (
    <Button type="button" size="sm" variant="ghost" disabled={pending} className="text-muted-foreground hover:text-negative" onClick={() => start(async () => void (await deleteFxRateAction(id)))} aria-label={dict.holdings.fx.delete}>
      <Trash2 />
    </Button>
  );
}
