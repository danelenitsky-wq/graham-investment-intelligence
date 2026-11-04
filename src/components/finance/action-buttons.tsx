"use client";
import { Eye, EyeOff, FlaskConical, Loader2, RefreshCw, DownloadCloud } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/components/layout/providers";
import { fmt } from "@/lib/i18n";
import { loadFixturesAction, refreshSecurityAction, syncUniverseAction, toggleWatchlistAction } from "@/app/actions";

function Message({ tone, children }: { tone: "ok" | "error"; children: React.ReactNode }) {
  return <p className={tone === "ok" ? "text-xs text-muted-foreground" : "max-w-md text-xs text-negative"}>{children}</p>;
}

export function RefreshButton({ securityId }: { securityId: string }) {
  const { dict } = useI18n();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        onClick={() =>
          start(async () => {
            const r = await refreshSecurityAction(securityId);
            if (!r.ok) return setMsg({ tone: "error", text: r.error });
            const p = r.data!.prices;
            const f = r.data!.fundamentals;
            const describe = (x: { status: string; error?: string }) => (x.status === "FAILED" ? `${x.status} (${x.error})` : x.status);
            setMsg({ tone: p.status === "FAILED" || f.status === "FAILED" ? "error" : "ok", text: fmt(dict.stock.refreshResult, { prices: describe(p), fundamentals: describe(f) }) });
          })
        }
        disabled={pending}
        size="sm"
      >
        {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        {pending ? dict.common.refreshing : dict.common.refreshData}
      </Button>
      {msg && <Message tone={msg.tone}>{msg.text}</Message>}
    </div>
  );
}

export function WatchlistButton({ securityId, initial }: { securityId: string; initial: boolean }) {
  const { dict } = useI18n();
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();
  return (
    <Button
      variant={on ? "secondary" : "outline"}
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await toggleWatchlistAction(securityId);
          if (r.ok && r.data) setOn(r.data.onWatchlist);
        })
      }
    >
      {on ? <Eye /> : <EyeOff />}
      {on ? dict.stock.removeFromWatchlist : dict.stock.addToWatchlist}
    </Button>
  );
}

export function SyncUniverseButton() {
  const { dict } = useI18n();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await syncUniverseAction();
            setMsg(r.ok ? { tone: "ok", text: fmt(dict.dataHealth.syncDone, { n: r.data!.upserted }) } : { tone: "error", text: r.error });
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" /> : <DownloadCloud />}
        {pending ? dict.dataHealth.syncing : dict.dataHealth.syncUniverse}
      </Button>
      {msg && <Message tone={msg.tone}>{msg.text}</Message>}
    </div>
  );
}

export function LoadFixturesButton() {
  const { dict } = useI18n();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await loadFixturesAction();
            setMsg(r.ok ? { tone: "ok", text: dict.dataHealth.fixturesLoaded } : { tone: "error", text: r.error });
          })
        }
      >
        {pending ? <Loader2 className="animate-spin" /> : <FlaskConical />}
        {dict.dataHealth.loadFixtures}
      </Button>
      {msg && <Message tone={msg.tone}>{msg.text}</Message>}
    </div>
  );
}
