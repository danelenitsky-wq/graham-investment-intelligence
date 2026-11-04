"use client";
import Link from "next/link";
import { href } from "@/lib/i18n/paths";
import { useI18n } from "./providers";

export function Brand() {
  const { locale, dict } = useI18n();
  return (
    <Link href={href(locale, "/")} className="flex items-center gap-2.5">
      <span className="grid size-8 place-items-center rounded-md bg-primary font-mono text-sm font-bold text-primary-foreground">G</span>
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-semibold tracking-tight">Graham</span>
        <span className="text-[11px] text-muted-foreground">Investment Intelligence</span>
      </span>
      <span className="sr-only">{dict.app.name}</span>
    </Link>
  );
}
