"use client";
import { useActionState, useState, useTransition } from "react";
import { Bell, Check, Loader2, Plus, RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useI18n } from "@/components/layout/providers";
import { fmt } from "@/lib/i18n";
import {
  acknowledgeAlertAction,
  addWatchlistBySymbolAction,
  refreshPortfolioQuotesAction,
  removePositionAction,
  runAlertChecksAction,
  setAlertRuleStatusAction,
  setBaseCurrencyAction,
  updateWatchlistItemAction,
  type ActionResult,
} from "@/app/actions";

export function RefreshQuotesButton() {
  const { dict } = useI18n();
  const [pending, start] = useTransition();
  return (
    <Button type="button" size="sm" variant="outline" disabled={pending} title={dict.holdings.portfolio.refreshQuotesNote} onClick={() => start(async () => void (await refreshPortfolioQuotesAction()))}>
      {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />} {dict.holdings.portfolio.refreshQuotes}
    </Button>
  );
}

export function BaseCurrencySelect({ value }: { value: string }) {
  const { dict } = useI18n();
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">{dict.holdings.portfolio.baseCurrency}</span>
      <NativeSelect value={value} disabled={pending} onChange={(e) => start(async () => void (await setBaseCurrencyAction(e.target.value)))}>
        <option value="USD">USD</option>
        <option value="ILS">ILS</option>
      </NativeSelect>
    </label>
  );
}

export function RemoveHoldingButton({ id }: { id: string }) {
  const { dict } = useI18n();
  const [pending, start] = useTransition();
  return (
    <Button type="button" variant="ghost" size="sm" disabled={pending} className="text-muted-foreground hover:text-negative" onClick={() => start(async () => void (await removePositionAction(id)))}>
      {dict.holdings.portfolio.remove}
    </Button>
  );
}

export function RunAlertsButtons() {
  const { dict } = useI18n();
  const t = dict.holdings.alerts;
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fetch: boolean) =>
    start(async () => {
      const r = await runAlertChecksAction(fetch);
      setMsg(r.ok ? { ok: true, text: fmt(t.runResult, { checked: r.data!.checked, newEvents: r.data!.newEvents, duplicates: r.data!.duplicates, providerCalls: r.data!.providerCalls }) } : { ok: false, text: r.error });
    });
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={() => run(true)} data-testid="run-alerts">
          {pending ? <Loader2 className="animate-spin" /> : <Bell />} {t.runNow}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(false)}>
          {t.runStored}
        </Button>
      </div>
      {msg && <p className={msg.ok ? "text-xs text-muted-foreground" : "text-xs text-negative"} data-testid="run-alerts-result">{msg.text}</p>}
    </div>
  );
}

export function AcknowledgeButton({ id }: { id: string | null }) {
  const { dict } = useI18n();
  const [pending, start] = useTransition();
  return (
    <Button type="button" size="sm" variant={id ? "ghost" : "outline"} disabled={pending} onClick={() => start(async () => void (await acknowledgeAlertAction(id)))}>
      <Check /> {id ? dict.holdings.alerts.acknowledge : dict.holdings.alerts.acknowledgeAll}
    </Button>
  );
}

export function RuleToggle({ id, active }: { id: string; active: boolean }) {
  const { dict } = useI18n();
  const [pending, start] = useTransition();
  return (
    <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => void (await setAlertRuleStatusAction(id, !active)))}>
      {active ? dict.holdings.alerts.disable : dict.holdings.alerts.enable}
    </Button>
  );
}

export function AddWatchlistForm({ exchanges }: { exchanges: string[] }) {
  const { dict } = useI18n();
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(addWatchlistBySymbolAction, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">{dict.holdings.form.ticker}</span>
        <Input name="ticker" required className="w-28 font-mono uppercase" dir="ltr" />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">{dict.holdings.form.exchange}</span>
        <NativeSelect name="exchange" defaultValue={exchanges[0]}>
          {exchanges.map((e) => (
            <option key={e}>{e}</option>
          ))}
        </NativeSelect>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">{dict.holdings.watchlist.notes}</span>
        <Input name="notes" className="w-56" maxLength={500} />
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Plus />} {dict.holdings.watchlist.add}
      </Button>
      {state && !state.ok && <p className="w-full text-xs text-negative">{state.code === "NOT_FOUND" ? dict.holdings.watchlist.notFound : dict.holdings.manualPrice.errors.INVALID}</p>}
    </form>
  );
}

export function WatchlistTargetForm({ itemId, targetPrice, mosTarget, notes }: { itemId: string; targetPrice: number | null; mosTarget: number | null; notes: string | null }) {
  const { dict } = useI18n();
  const t = dict.holdings.watchlist;
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(updateWatchlistItemAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-1">
      <input type="hidden" name="itemId" value={itemId} />
      <Input name="targetPrice" defaultValue={targetPrice ?? ""} inputMode="decimal" placeholder={t.targetPrice} aria-label={t.targetPrice} className="h-8 w-24 text-xs" dir="ltr" />
      <Input name="marginOfSafetyTarget" defaultValue={mosTarget === null ? "" : Math.round(mosTarget * 1000) / 10} inputMode="decimal" placeholder={t.mosTargetPct} aria-label={t.mosTargetPct} className="h-8 w-20 text-xs" dir="ltr" />
      <Input name="notes" defaultValue={notes ?? ""} placeholder={t.notes} aria-label={t.notes} className="h-8 w-32 text-xs" />
      <Button type="submit" size="sm" variant="ghost" disabled={pending} aria-label={t.save}>
        {pending ? <Loader2 className="animate-spin" /> : <Save />}
      </Button>
      {state && !state.ok && <span className="text-xs text-negative">!</span>}
    </form>
  );
}
