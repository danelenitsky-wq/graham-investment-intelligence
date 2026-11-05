import "server-only";
import { notFound } from "next/navigation";
import { getDictionary, isLocale, type Locale } from "./index";

/** Resolve the [locale] route param into a dictionary (404 for unknown locales). */
export async function resolveLocale(params: Promise<{ locale: string }>): Promise<{ locale: Locale; dict: ReturnType<typeof getDictionary> }> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return { locale, dict: getDictionary(locale) };
}
