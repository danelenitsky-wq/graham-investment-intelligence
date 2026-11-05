"use client";
import { useActionState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useI18n } from "@/components/layout/providers";
import { addPositionAction, removePositionAction, type ActionResult } from "@/app/actions";

export function PositionForm({ exchanges }: { exchanges: string[] }) {
  const { dict } = useI18n();
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(addPositionAction, null);
  const error = state && !state.ok ? (state.code === "NOT_FOUND" ? dict.portfolio.securityNotFound : dict.portfolio.invalid) : null;
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">{dict.portfolio.ticker}</span>
        <Input name="ticker" required className="w-28 font-mono uppercase" dir="ltr" />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">{dict.portfolio.exchange}</span>
        <NativeSelect name="exchange" defaultValue={exchanges[0]}>
          {exchanges.map((e) => (
            <option key={e}>{e}</option>
          ))}
        </NativeSelect>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">{dict.portfolio.quantity}</span>
        <Input name="quantity" type="number" step="any" min="0" required className="w-28" dir="ltr" />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">{dict.portfolio.averageCost}</span>
        <Input name="averageCost" type="number" step="any" min="0" required className="w-32" dir="ltr" />
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Plus />} {dict.portfolio.addPosition}
      </Button>
      {error && <p className="w-full text-xs text-negative">{error}</p>}
    </form>
  );
}

export function RemovePositionButton({ id, label }: { id: string; label: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      className="text-muted-foreground hover:text-negative"
      onClick={() => start(async () => void (await removePositionAction(id)))}
    >
      {label}
    </Button>
  );
}
