"use client";
import { useActionState, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useI18n } from "@/components/layout/providers";
import { STRATEGIES } from "@/lib/decision/types";
import { SECURITY_TYPES } from "@/lib/portfolio/import/validate";
import { addHoldingAction, type HoldingFormResult } from "@/app/actions";
import { IssueList } from "./issue-list";

const EXCHANGE_MARKET: Record<string, "US" | "IL"> = { TASE: "IL" };

/** Manual entry of one holding, validated by the same rules as CSV imports. */
export function HoldingForm({ exchanges }: { exchanges: string[] }) {
  const { dict } = useI18n();
  const f = dict.holdings.form;
  const [state, action, pending] = useActionState<HoldingFormResult | null, FormData>(addHoldingAction, null);
  const [exchange, setExchange] = useState(exchanges[0] ?? "NASDAQ");
  const il = (EXCHANGE_MARKET[exchange] ?? "US") === "IL";
  const preview = state && !state.ok ? state.preview : undefined;
  const needsConfirm = state && !state.ok && state.code === "NEEDS_CONFIRMATION" && preview;
  const field = (label: string, el: React.ReactNode) => (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {el}
    </label>
  );
  return (
    <form action={action} className="flex flex-col gap-3" data-testid="holding-form">
      <div className="flex flex-wrap items-end gap-2">
        {field(f.ticker, <Input name="ticker" required className="w-28 font-mono uppercase" dir="ltr" />)}
        {field(
          f.exchange,
          <NativeSelect name="exchange" value={exchange} onChange={(e) => setExchange(e.target.value)}>
            {exchanges.map((e) => (
              <option key={e}>{e}</option>
            ))}
          </NativeSelect>,
        )}
        {field(
          f.securityType,
          <NativeSelect name="securityType" defaultValue="COMMON_STOCK">
            {SECURITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {f.types[t]}
              </option>
            ))}
          </NativeSelect>,
        )}
        {field(f.quantity, <Input name="quantity" inputMode="decimal" required className="w-28" dir="ltr" />)}
        {field(f.averagePrice, <Input name="averagePrice" inputMode="decimal" required className="w-32" dir="ltr" />)}
        <input type="hidden" name="currency" value={il ? "ILS" : "USD"} />
        {field(f.currency, <Input value={il ? "ILS" : "USD"} readOnly disabled className="w-20" dir="ltr" />)}
        {field(
          f.priceUnit,
          il ? (
            <NativeSelect name="priceUnit" defaultValue="" required key="il">
              <option value="" disabled>
                {f.chooseUnit}
              </option>
              <option value="ILS">{f.units.ILS}</option>
              <option value="ILA">{f.units.ILA}</option>
            </NativeSelect>
          ) : (
            <NativeSelect name="priceUnit" defaultValue="USD" key="us">
              <option value="USD">{f.units.USD}</option>
            </NativeSelect>
          ),
        )}
        {field(f.purchaseDate, <Input name="purchaseDate" type="date" className="w-40" dir="ltr" />)}
        {field(
          f.thesis,
          <NativeSelect name="thesisStrategy" defaultValue="">
            <option value="">{dict.decision.settings.thesisNone}</option>
            {STRATEGIES.map((s) => (
              <option key={s} value={s}>
                {dict.decision.strategies[s]}
              </option>
            ))}
          </NativeSelect>,
        )}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        {il && field(f.name, <Input name="name" className="w-56" />)}
        {field(f.notes, <Input name="notes" className="w-72" maxLength={500} />)}
        {needsConfirm && <input type="hidden" name="confirmed" value={preview.contentHash} />}
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Plus />} {needsConfirm ? f.confirmAdd : f.add}
        </Button>
      </div>
      {il && <p className="text-xs text-muted-foreground">{f.unitHelp}</p>}
      {state?.ok && <p className="text-xs text-positive">{f.saved}</p>}
      {needsConfirm && <p className="text-xs font-medium">{f.needsConfirmation}</p>}
      {preview && <IssueList issues={preview.rows.flatMap((r) => r.issues)} dict={dict} />}
      {state && !state.ok && !preview && <p className="text-xs text-negative">{state.error}</p>}
    </form>
  );
}
