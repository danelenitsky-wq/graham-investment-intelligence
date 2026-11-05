"use client";
import { ThemeProvider } from "next-themes";
import { Direction } from "radix-ui";
import { createContext, useContext } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Dictionary, Locale } from "@/lib/i18n";

const I18nContext = createContext<{ locale: Locale; dict: Dictionary } | null>(null);

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <Providers>");
  return ctx;
}

export function Providers({ locale, dict, children }: { locale: Locale; dict: Dictionary; children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <Direction.Provider dir={dict.meta.dir as "rtl" | "ltr"}>
        <I18nContext.Provider value={{ locale, dict }}>
          <TooltipProvider>{children}</TooltipProvider>
        </I18nContext.Provider>
      </Direction.Provider>
    </ThemeProvider>
  );
}
