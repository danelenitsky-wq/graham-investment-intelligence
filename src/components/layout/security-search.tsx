"use client";
import { Loader2, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { fmt } from "@/lib/i18n";
import { securityPath } from "@/lib/i18n/paths";
import { cn } from "@/lib/utils";
import { useI18n } from "./providers";

interface Result {
  id: string;
  ticker: string;
  name: string;
  nameHe: string | null;
  exchangeCode: string;
  isDevFixture: boolean;
  hasData: boolean;
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "done"; results: Result[]; universeEmpty: boolean };

/**
 * Typeahead over the local security master (server route /api/search).
 * `variant="hero"` adds an exchange filter and a larger input for the Stock Analysis page.
 */
export function SecuritySearch({ variant = "compact", exchanges = [], linkTo }: { variant?: "compact" | "hero"; exchanges?: string[]; /** Navigate to `${linkTo}?s=EXCHANGE:TICKER` instead of the analysis page. */ linkTo?: string }) {
  const { locale, dict } = useI18n();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [exchange, setExchange] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && variant === "compact" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [variant]);

  useEffect(() => {
    const query = q.trim();
    if (!query) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setState({ kind: "loading" });
      try {
        const params = new URLSearchParams({ q: query });
        if (exchange) params.set("exchange", exchange);
        const res = await fetch(`/api/search?${params}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { results: Result[]; universeEmpty: boolean };
        setState({ kind: "done", results: data.results, universeEmpty: data.universeEmpty });
        setActive(0);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setState({ kind: "error" });
      }
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, exchange]);

  const results = state.kind === "done" ? state.results : [];
  const go = (r: Result) => {
    setOpen(false);
    setQ("");
    router.push(linkTo ? `${linkTo}?s=${encodeURIComponent(`${r.exchangeCode}:${r.ticker}`)}` : securityPath(locale, r.exchangeCode, r.ticker));
  };

  return (
    <div className={cn("relative w-full", variant === "compact" ? "max-w-md" : "max-w-2xl")}>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
              if (!e.target.value.trim()) setState({ kind: "idle" });
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, results.length - 1));
              else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
              else if (e.key === "Enter" && results[active]) go(results[active]);
              else if (e.key === "Escape") setOpen(false);
            }}
            placeholder={dict.search.placeholder}
            className={cn("ps-9", variant === "hero" && "h-11 text-base")}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-label={dict.search.shortcut}
          />
          {state.kind === "loading" && <Loader2 className="absolute end-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
          {variant === "compact" && state.kind !== "loading" && (
            <kbd className="pointer-events-none absolute end-2.5 top-1/2 hidden -translate-y-1/2 rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground sm:block">/</kbd>
          )}
        </div>
        {variant === "hero" && exchanges.length > 0 && (
          <NativeSelect value={exchange} onChange={(e) => setExchange(e.target.value)} className="h-11" aria-label={dict.search.exchange}>
            <option value="">{dict.search.allExchanges}</option>
            {exchanges.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </NativeSelect>
        )}
      </div>
      {open && q.trim() && state.kind !== "idle" && (
        <div id={listId} role="listbox" className="absolute inset-x-0 top-full z-50 mt-1 max-h-96 overflow-y-auto rounded-md border bg-popover p-1 shadow-lg">
          {state.kind === "loading" && <div className="px-3 py-2 text-sm text-muted-foreground">{dict.common.loading}</div>}
          {state.kind === "error" && <div className="px-3 py-2 text-sm text-negative">{dict.search.failed}</div>}
          {state.kind === "done" && state.universeEmpty && <div className="px-3 py-2 text-sm text-muted-foreground">{dict.search.emptyUniverse}</div>}
          {state.kind === "done" && !state.universeEmpty && results.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">{fmt(dict.search.noResults, { q: q.trim() })}</div>
          )}
          {results.map((r, i) => (
            <button
              key={r.id}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(r)}
              className={cn("flex w-full items-center gap-3 rounded-sm px-2 py-1.5 text-start text-sm", i === active && "bg-accent text-accent-foreground")}
            >
              <span className="w-16 shrink-0 font-mono font-semibold" dir="ltr">
                {r.ticker}
              </span>
              <span className="min-w-0 flex-1 truncate">{locale === "he" && r.nameHe ? r.nameHe : r.name}</span>
              {r.isDevFixture && <Badge variant="warning">{dict.common.devFixtureShort}</Badge>}
              <span className={cn("size-1.5 rounded-full", r.hasData ? "bg-positive" : "bg-muted-foreground/40")} title={r.hasData ? dict.search.hasData : dict.search.noStoredData} />
              <span className="w-24 shrink-0 text-end font-mono text-xs text-muted-foreground">{r.exchangeCode}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
