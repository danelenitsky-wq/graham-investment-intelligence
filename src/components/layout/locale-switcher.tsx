"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "./providers";

export function LocaleSwitcher() {
  const { locale, dict } = useI18n();
  const pathname = usePathname();
  const search = useSearchParams();
  const target = locale === "he" ? "en" : "he";
  const rest = pathname.replace(/^\/(he|en)(?=\/|$)/, "");
  const qs = search.toString();
  return (
    <Button variant="ghost" size="sm" asChild aria-label={dict.common.language}>
      <Link href={`/${target}${rest}${qs ? `?${qs}` : ""}`} hrefLang={target} prefetch={false}>
        <Languages className="size-4" />
        <span className="text-xs font-medium">{target === "en" ? "English" : "עברית"}</span>
      </Link>
    </Button>
  );
}
