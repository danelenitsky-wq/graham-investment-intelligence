"use client";
import { Camera, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/layout/providers";
import { saveDecisionSnapshotAction } from "@/app/actions";

/** Saves a timestamped decision snapshot of the current analysis. */
export function SaveSnapshotButton({ securityId, strategy }: { securityId: string; strategy: string | null }) {
  const { dict } = useI18n();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await saveDecisionSnapshotAction(securityId, strategy);
            if (!r.ok) setMsg({ ok: false, text: r.error });
            else setMsg({ ok: true, text: r.data?.saved ? dict.decision.snapshots.saved : dict.decision.snapshots.unchanged });
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" /> : <Camera />} {dict.decision.snapshots.save}
      </Button>
      {msg && <span className={msg.ok ? "text-xs text-muted-foreground" : "text-xs text-negative"}>{msg.text}</span>}
    </div>
  );
}
